/**
 * The Charge-Time (CT) clock (D5) — an FFT-style continuous action economy.
 *
 * No discrete rounds. The clock advances in **ticks**; on each tick every living
 * unit's `ct += speed`. A unit takes a turn at `ct >= TURN_THRESHOLD`; after the
 * turn its CT is **spent down** — acting costs more than only moving, so movers
 * come back up sooner. Speed therefore governs *how often* a unit acts.
 *
 * The clock also owns a **scheduled-effects queue** (the D5 charged-ability /
 * D16 entity-chain primitive): an effect carries its own `speed` gauge, fills it
 * each tick, and **resolves later** when the gauge fills — exactly how a slow
 * charged spell or a delayed combo lands on the timeline.
 *
 * Pure logic: no Phaser, no DOM.
 */

import { isActive, activeUnits, type Unit, type Side } from "./units";
import type { EventBus } from "./events";
import { hasStatus, statusAmount, SLOWED, HASTENED } from "./status";
import { decayCounters } from "./num";

/**
 * A unit's **effective** CT-gain speed this tick (D41): base Speed, plus
 * Hastened, then capped down by Slowed (the Heavy Knight's tarpit drives it to
 * 1). Floored at 1 so the clock can never stall. This is the single read-hook
 * for the speed-affecting statuses — nothing else should branch on them.
 */
export function effectiveSpeed(unit: Unit): number {
  let s = unit.speed;
  if (hasStatus(unit, HASTENED)) s += statusAmount(unit, HASTENED);
  if (hasStatus(unit, SLOWED)) s = Math.min(s, statusAmount(unit, SLOWED));
  return Math.max(1, s);
}

/**
 * Burn down a unit's per-skill cooldowns (D37) by `amount` CT (its effective
 * speed for the tick), dropping any that reach 0. Denominated in CT, so a
 * "~200 CT" cooldown re-arms in roughly two of the unit's turns.
 */
export function tickSkillCooldowns(unit: Unit, amount: number): void {
  decayCounters(unit.cooldowns, amount);
}

/** True if `skillId` is still cooling down on `unit` (D37). */
export function onSkillCooldown(unit: Unit, skillId: string): boolean {
  return (unit.cooldowns[skillId] ?? 0) > 0;
}

/** Arm a unit's cooldown for a skill (CT before reuse). */
export function armSkillCooldown(unit: Unit, skillId: string, ct: number): void {
  if (ct > 0) unit.cooldowns[skillId] = ct;
}

/** CT needed to take a turn. */
export const TURN_THRESHOLD = 100;
/** CT spent when a unit Acts (the expensive option). */
export const ACT_COST = 100;
/** CT spent when a unit only Moves (cheaper — it comes back up sooner). */
export const MOVE_COST = 50;
/** A scheduled effect resolves when its gauge reaches this. */
export const CHARGE_THRESHOLD = 100;

/** What a unit did on its turn, used to compute spend-down. */
export interface TurnSpend {
  moved?: boolean;
  acted?: boolean;
}

/**
 * An effect committed to the timeline. Its `gauge` fills by `speed` each tick;
 * when it reaches {@link CHARGE_THRESHOLD} the clock calls `run` and (if a bus
 * is wired) emits `chargeResolved`. `speed >= CHARGE_THRESHOLD` resolves on the
 * next tick (an "instant" chain); a small speed becomes a disruptable timer.
 */
export interface ScheduledEffect {
  id: string;
  speed: number;
  /** Current fill; starts at 0. */
  gauge?: number;
  run: () => void;
  /**
   * The committed caster (D37), if any — lets the clock cancel a charge whose
   * caster died and lets the AI ask "is this unit charging?" (the interrupt
   * bonus). A charge with no caster (an environmental timer) is uninterruptible.
   */
  caster?: Unit;
  /**
   * Data-driven **fizzle** predicate (D37): checked when the gauge fills; if it
   * returns true the effect is cancelled instead of run (`chargeFizzled` fires).
   * Caster-death is wired by default ({@link CTClock.schedule}); the rest
   * (target-moved, counter-spell) reserve this shape.
   */
  fizzleWhen?: () => boolean;
}

/**
 * Summed Speed of a side's **deployed, non-captured** living units — the
 * initiative seed source (D11). Sum (not average) so the seed reflects how much
 * a side fielded: a side that held more units starts the clock **warmer**, and
 * **losing a unit to capture lowers the seed**, handing the enemy earlier turns.
 */
export function sideSeed(units: readonly Unit[], side: Side): number {
  return activeUnits(units, side).reduce((sum, u) => sum + u.speed, 0);
}

/** The CT clock over a fixed set of units. */
export class CTClock {
  /** Total ticks elapsed (the global timeline position). */
  time = 0;
  private readonly units: Unit[];
  private readonly bus?: EventBus;
  private scheduled: ScheduledEffect[] = [];

  constructor(units: Unit[], bus?: EventBus) {
    this.units = units;
    this.bus = bus;
  }

  /**
   * Seed each side's starting CT from its units' average Speed (D11). The faster
   * side starts warmer and reaches the threshold first — so losing a unit (a
   * lower seed) hands the enemy early tempo.
   */
  seedInitiative(bonusBySide: Partial<Record<Side, number>> = {}): void {
    const seeds = new Map<Side, number>();
    for (const u of this.units) {
      if (!seeds.has(u.side)) {
        // Morale (D8) warms the seed by the smallest amount in the bundle —
        // Speed compounds in the clock, so this knob is kept gentle.
        seeds.set(u.side, sideSeed(this.units, u.side) + (bonusBySide[u.side] ?? 0));
      }
    }
    for (const u of this.units) {
      // Captured units start cold — they're bound until freed.
      u.ct = u.captured ? 0 : Math.max(0, seeds.get(u.side) ?? 0);
    }
  }

  /**
   * Commit an effect to the timeline. A `caster` arms the default **caster-death
   * fizzle** (D37) unless the effect already carries its own `fizzleWhen`.
   */
  schedule(effect: ScheduledEffect): void {
    const fizzleWhen =
      effect.fizzleWhen ??
      (effect.caster ? () => !effect.caster!.alive : undefined);
    this.scheduled.push({ gauge: 0, ...effect, fizzleWhen });
  }

  /** How many effects are still charging. */
  pendingEffects(): number {
    return this.scheduled.length;
  }

  /** True if `unit` is committed to an in-flight charge/channel (D37). */
  isCharging(unit: Unit): boolean {
    return this.scheduled.some((e) => e.caster === unit);
  }

  /**
   * Fill fraction (0..1) of a scheduled effect by id, or undefined if none — the
   * render reads it for the bridge-cut timer / charge readouts (D37/D43).
   */
  scheduledProgress(id: string): number | undefined {
    const e = this.scheduled.find((x) => x.id === id);
    return e ? Math.min(1, (e.gauge ?? 0) / CHARGE_THRESHOLD) : undefined;
  }

  /**
   * Advance the clock one tick: fill + resolve scheduled effects, then add each
   * living unit's Speed to its CT.
   */
  tick(): void {
    this.time += 1;

    // 1) Charged effects fill and resolve first, so a charge landing this tick
    //    is processed before units act on it. A filled effect whose fizzle
    //    predicate is true (e.g. its caster died) is cancelled, not run (D37).
    if (this.scheduled.length > 0) {
      const ready: ScheduledEffect[] = [];
      for (const e of this.scheduled) {
        e.gauge = (e.gauge ?? 0) + e.speed;
        if (e.gauge >= CHARGE_THRESHOLD) ready.push(e);
      }
      if (ready.length > 0) {
        this.scheduled = this.scheduled.filter((e) => !ready.includes(e));
        for (const e of ready) {
          if (e.fizzleWhen?.()) {
            this.bus?.emit("chargeFizzled", { id: e.id });
            continue;
          }
          e.run();
          this.bus?.emit("chargeResolved", { id: e.id });
        }
      }
    }

    // 2) Every living, non-captured unit charges by its **effective** Speed
    //    (Slowed/Hastened, D41) and burns down its cooldowns by the same amount
    //    (D37) — a captured unit is bound and ticks toward neither.
    for (const u of this.units) {
      if (!u.alive || u.captured) continue;
      const sp = effectiveSpeed(u);
      u.ct += sp;
      tickSkillCooldowns(u, sp);
    }
  }

  /**
   * Tick until a living unit is ready (`ct >= TURN_THRESHOLD`), then return the
   * readiest one (highest CT, ties broken by Speed, then id for determinism).
   * Returns `null` if no living unit can ever act.
   */
  advanceToNextActor(): Unit | null {
    const canAct = isActive;
    if (!this.units.some(canAct)) return null;
    let guard = 0;
    const GUARD_MAX = 1_000_000;
    while (!this.units.some((u) => canAct(u) && u.ct >= TURN_THRESHOLD)) {
      this.tick();
      if (++guard > GUARD_MAX) return null;
      if (!this.units.some(canAct)) return null;
    }
    const ready = this.units.filter((u) => canAct(u) && u.ct >= TURN_THRESHOLD);
    ready.sort(
      (a, b) => b.ct - a.ct || b.speed - a.speed || a.id.localeCompare(b.id),
    );
    return ready[0];
  }

  /**
   * Spend a unit's CT after its turn. Acting is the expensive option; a unit
   * that only moved comes back up sooner. A unit that did neither (waited) pays
   * the move cost so the clock can't stall.
   */
  spend(unit: Unit, spend: TurnSpend): void {
    const cost = spend.acted ? ACT_COST : MOVE_COST;
    unit.ct -= cost;
  }
}
