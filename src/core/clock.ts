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
import type { EventBus } from "./event-bus";
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

/**
 * Determinism-stable "who acts next" order for CT actors: **highest CT first**,
 * ties broken by **Speed**, then **id**. The single comparator the one {@link CTClock}
 * sorts its ready actors by, in **both** phases (combat, and deployment via the front
 * tempo source) — so initiative reads identically whichever phase is running.
 */
export function byReadiest<T extends { ct: number; speed: number; id: string }>(a: T, b: T): number {
  return b.ct - a.ct || b.speed - a.speed || a.id.localeCompare(b.id);
}

/** Stall guard — the most ticks {@link tickUntilReady} will advance before giving up. */
export const CLOCK_GUARD_MAX = 1_000_000;

/**
 * Drive a CT timeline to its next decision point — the shared loop both clocks run.
 * Tick until `ready()` holds, bounded by the stall guard **and** `canProgress()`,
 * which is re-checked each tick because a resolving charge can defeat the last
 * eligible actor mid-tick. Returns `true` once an actor is ready, `false` if the
 * timeline can't progress or trips the guard. The *policy* (which actors tick, how
 * the next actor is chosen) stays with each clock; only this engine is shared.
 */
export function tickUntilReady(ready: () => boolean, canProgress: () => boolean, tick: () => void): boolean {
  if (!canProgress()) return false;
  let guard = 0;
  while (!ready()) {
    tick();
    if (++guard > CLOCK_GUARD_MAX) return false;
    if (!canProgress()) return false;
  }
  return true;
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

/**
 * A **non-unit tempo participant** on the CT clock (D67 clock fold) — the
 * Deployment **front** is the one client today. It charges by `speed` alongside the
 * units and can take a "turn" when its gauge fills, but it is not a {@link Unit}
 * (no HP/position/statuses), so it rides the clock as data. `strictLeadTie` encodes
 * the front's deliberate policy: it acts **only on a strict CT lead** — units win
 * ties — so Speed/Awareness keep buying the party its positioning turns.
 */
export interface TempoSource {
  readonly id: string;
  /** Charge-time accumulator (mutated by the clock, like a unit's `ct`). */
  ct: number;
  readonly speed: number;
  /** Acts only on a strict CT lead (units win ties). The deploy front sets this. */
  readonly strictLeadTie?: boolean;
}

/**
 * Who the clock hands the next turn to — a unit, the registered {@link TempoSource},
 * or nothing (the timeline can't progress). The discriminated result the
 * tempo-aware {@link CTClock.nextTurn} returns; combat's {@link
 * CTClock.advanceToNextActor} is the thin unit-only projection of it.
 */
export type ClockTurn =
  | { kind: "unit"; unit: Unit }
  | { kind: "tempo"; source: TempoSource }
  | { kind: "idle" };

/** The CT clock over a fixed set of units. */
export class CTClock {
  /** Total ticks elapsed (the global timeline position). */
  time = 0;
  private readonly units: Unit[];
  private readonly bus?: EventBus;
  private scheduled: ScheduledEffect[] = [];
  /**
   * An optional non-unit tempo participant (D67 clock fold) — the Deployment front.
   * `undefined` for a combat clock, so the combat path is byte-identical to the
   * pre-fold behaviour (every tempo branch below is skipped when it's unset). Attached for
   * the deploy phase via {@link setTempo} and shed again at {@link resetForCombat} — the
   * **one** clock serves both phases rather than two instances trading off (D67 W2).
   */
  private tempo?: TempoSource;

  /**
   * Which units **participate** in this clock's turn order — they tick toward CT and can
   * be handed a turn (D67 one-clock fold). Defaults to {@link isActive} (alive + not
   * captured), so a combat clock is byte-identical to before. The Deployment phase narrows
   * it to active *players* (the enemies are frozen, pre-positioned and concealed, while the
   * front rides the clock as the tempo source). Settable so one clock can serve both phases.
   */
  private participates: (u: Unit) => boolean = isActive;

  constructor(units: Unit[], bus?: EventBus) {
    this.units = units;
    this.bus = bus;
  }

  /** Narrow (or restore) which units participate in the turn order — the phase seam. */
  setParticipants(predicate: (u: Unit) => boolean): void {
    this.participates = predicate;
  }

  /** Attach (or detach) the {@link TempoSource} — the Deployment front rides the clock as one. */
  setTempo(source?: TempoSource): void {
    this.tempo = source;
  }

  /**
   * Read-only snapshot of the tempo source's charge (the Deployment front's progress toward its
   * next net-closing turn), or `undefined` in combat — for the HUD rail. `threshold` is the CT a
   * turn fires at, so a renderer can show how close the next capture step is.
   */
  tempoState(): { ct: number; speed: number; threshold: number } | undefined {
    return this.tempo ? { ct: this.tempo.ct, speed: this.tempo.speed, threshold: TURN_THRESHOLD } : undefined;
  }

  /**
   * Shed the Deployment configuration and restore combat defaults at the pre-combat →
   * combat boundary (D67 W2): detach the front, re-widen participation to every active
   * unit, and clear the staging timeline so combat opens on a fresh clock. A **no-op** for
   * a clock that only ever fought (already in this state), so the combat path stays
   * byte-identical; `seedInitiative` then re-seeds CT over the now-combat roster.
   */
  resetForCombat(): void {
    this.tempo = undefined;
    this.participates = isActive;
    this.time = 0;
    this.scheduled = [];
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

    // 2) Every **participating** unit charges by its **effective** Speed
    //    (Slowed/Hastened, D41) and burns down its cooldowns by the same amount
    //    (D37). The default predicate is {@link isActive} (alive + not captured —
    //    a captured unit is bound and ticks toward neither); Deployment narrows it
    //    to active players, freezing the pre-positioned enemies off the same clock.
    for (const u of this.units) {
      if (!this.participates(u)) continue;
      const sp = effectiveSpeed(u);
      u.ct += sp;
      tickSkillCooldowns(u, sp);
    }

    // 3) The tempo source (the Deployment front) charges alongside the units — a
    //    no-op for a combat clock (no tempo). It always charges, so a clock that
    //    carries one can never stall (the front guarantees the timeline advances).
    if (this.tempo) this.tempo.ct += this.tempo.speed;
  }

  /**
   * Tick until a living unit is ready (`ct >= TURN_THRESHOLD`), then return the
   * readiest one (highest CT, ties broken by Speed, then id for determinism).
   * Returns `null` if no living unit can ever act. The combat entry — the
   * unit-only projection of {@link nextTurn} (a combat clock carries no tempo
   * source, so the two are identical by construction).
   */
  advanceToNextActor(): Unit | null {
    const t = this.nextTurn();
    return t.kind === "unit" ? t.unit : null;
  }

  /**
   * Drive the timeline to its next turn and hand it to a unit **or** the registered
   * {@link TempoSource} (the Deployment front), or report `idle` if it can't progress.
   * Tick until a unit *or* the tempo source is ready, take the readiest unit
   * ({@link byReadiest}), and let the tempo source win **only** on its lead policy
   * (`strictLeadTie` ⇒ a strict CT lead; units take ties — the front's deliberate
   * rule). A clock with a tempo source never stalls (the front always charges), so
   * `idle` only arises for a unit-only (combat) clock with no one left to act.
   */
  nextTurn(): ClockTurn {
    const canAct = this.participates;
    const tempoReady = () => this.tempo !== undefined && this.tempo.ct >= TURN_THRESHOLD;
    const advanced = tickUntilReady(
      () => this.units.some((u) => canAct(u) && u.ct >= TURN_THRESHOLD) || tempoReady(),
      () => this.tempo !== undefined || this.units.some(canAct),
      () => this.tick(),
    );
    if (!advanced) return { kind: "idle" };
    const ready = this.units.filter((u) => canAct(u) && u.ct >= TURN_THRESHOLD).sort(byReadiest);
    const best = ready[0];
    if (tempoReady()) {
      const t = this.tempo!;
      const leads = !best || (t.strictLeadTie ? t.ct > best.ct : t.ct >= best.ct);
      if (leads) return { kind: "tempo", source: t };
    }
    return best ? { kind: "unit", unit: best } : { kind: "idle" };
  }

  /**
   * Seed each participant's CT from its **own** Speed plus `bonus` (the Deployment
   * seed, D63) — a warmer party acts first; the tempo source (the front) starts cold.
   * Distinct from {@link seedInitiative}'s side-summed combat seed: deployment seeds
   * per-unit because the front, not a side, is the opposing tempo.
   */
  seedFlat(bonus = 0): void {
    for (const u of this.units) {
      if (!this.participates(u)) continue; // the frozen enemies aren't seeded — only the party
      u.ct = u.captured ? 0 : Math.max(0, u.speed + bonus);
    }
    if (this.tempo) this.tempo.ct = 0;
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

  /** Spend the tempo source's CT after its turn (the front's net-closing step, D63). */
  spendTempo(): void {
    if (this.tempo) this.tempo.ct -= TURN_THRESHOLD;
  }

  /**
   * Snapshot the clock's mutable state (the global time + the in-flight scheduled
   * effects) for a turn-undo checkpoint (the combat-actions Phase 2 substrate). The
   * effects are **shallow-copied** so each one's `gauge` is captured by value while
   * its `run`/`caster`/`fizzleWhen` keep pointing at the *same, identity-stable*
   * units — so a {@link restore} re-binds nothing and a charge's closure stays valid.
   */
  snapshot(): ClockSnapshot {
    return { time: this.time, scheduled: this.scheduled.map((e) => ({ ...e })), tempoCt: this.tempo?.ct };
  }

  /** Roll the clock's mutable state back to a {@link snapshot} (undo). */
  restore(snap: ClockSnapshot): void {
    this.time = snap.time;
    this.scheduled = snap.scheduled.map((e) => ({ ...e }));
    if (this.tempo && snap.tempoCt !== undefined) this.tempo.ct = snap.tempoCt;
  }
}

/** A captured clock state — the time cursor, in-flight scheduled effects, + tempo CT. */
export interface ClockSnapshot {
  time: number;
  scheduled: ScheduledEffect[];
  /** The tempo source's CT (deploy front), if one is registered — undefined in combat. */
  tempoCt?: number;
}
