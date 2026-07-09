/**
 * Recovery economy (D23/D47/D80) — the no-battle rest rules, as free functions.
 *
 * Split out of `RunLoop` (R3, #120): the recovery *rules* — the Deep Rest at a
 * Clearing ({@link deepRest}) and the repeatable in-place rest ({@link inPlaceRest})
 * — live here as pure functions over a {@link RunState}. `RunLoop` keeps the *wiring*:
 * it calls these, then records the night (run history) and the playtest telemetry.
 * Pure code motion out of the orchestrator: behaviour unchanged.
 *
 * Pure logic: no Phaser, no DOM.
 */

import { healUnit, woundedBySeverity, type Unit } from "./units";
import {
  type RunState,
  runDifficulty,
  combatRoster,
  removeFromRoster,
  breakCamp,
} from "./run";
import { nudgeMorale } from "./camp";
import { tickDyingClocks } from "./mortality";
import { rpPerNight, payUpkeep, restHeal, computeUpkeep, accrueRp, spendRp, RECOVERY, type UpkeepResult } from "./upkeep";
import { restoreFatigue, nightlyFatigue, isFatigueTier0 } from "./fatigue";
import type { InPlaceRestResult } from "./runloop";

/** Rest-node tuning — the recovery a no-battle camp grants (data, D23). */
export const REST = {
  /**
   * Healing chunks a restful night funds, in addition to the nightly Rest
   * Points. Denominated in **chunks** (each costs `policy.rpPerChunk` RP) so a
   * rest is meaningful at every difficulty — the dying-clock dial scales with it.
   */
  chunks: 3,
  /** Morale a good rest restores (D8). */
  moraleGain: 2,
} as const;

/**
 * What {@link deepRest} recovered (D80) — everything the render's rest screen reads,
 * plus the dying-clock casualties `RunLoop` records the night with. The run terminal
 * (`over`) is not decided here: `RunLoop` owns {@link "./run".recordNight}.
 */
export interface DeepRestOutcome {
  upkeep: UpkeepResult;
  rpAdded: number;
  /** Units that cashed the **big heal** (Tier 0 at rest-time) and the HP each gained (D80). */
  healed: { unitId: string; hp: number }[];
  /** Wounded units too worn for the big heal that got only the free nightly **chip** (D80). */
  chipHealed: { unitId: string; hp: number }[];
  moraleGained: number;
  /** Units whose overworld fatigue was wiped to Rested by the Deep Rest (D35/D80). */
  fatigueRestored: string[];
  /** Accumulated worn-gear debt the premium rest cleared in one swipe (D47). */
  debtCleared: number;
  /** Dying-clock casualties this rest — already removed from the roster; `RunLoop` records them. */
  lost: Unit[];
}

/**
 * A Clearing's **Deep Rest** (D23/D80): a night of recovery with **no fight**. Pays Upkeep (a
 * night still costs), banks the nightly Rest Points **plus a rest bonus**, wipes **every**
 * member's fatigue to Rested (the Deep Rest, no opt-out), heals by the **Tier-0 gate** (the big
 * heal for units at Tier 0 at rest-time; the too-worn get only the free nightly chip), nudges
 * morale up (D8), clears worn-gear debt, and ticks any dying clocks (removing the fallen from the
 * roster). Returns the recovery outcome; `RunLoop` records the night + telemetry.
 */
export function deepRest(run: RunState): DeepRestOutcome {
  const policy = runDifficulty(run);
  // The premium tier pays a full night (no voluntary skips) — it clears debt, it
  // doesn't add to it (D47).
  const upkeep = payUpkeep(run.camp, run.party, { skip: [] });
  const rpAdded = rpPerNight(run.party) + REST.chunks * policy.rpPerChunk;
  accrueRp(run, rpAdded);

  // D80: the big heal is gated on **Tier 0 at rest-time** — snapshot eligibility *before* the
  // Deep Rest wipes fatigue (else the wipe would make everyone trivially eligible). One check
  // folds in both *how worn a unit arrived* and *what it did here* (heavy effort at the Clearing
  // tips it out of Tier 0 → wipe only, no heal).
  const bigHealEligible = new Set(
    run.party.filter((u) => isFatigueTier0(u.fatigue)).map((u) => u.id),
  );

  // The Deep Rest (D80): wipe **every** member's overworld fatigue to Rested — no assignment,
  // no opt-out (units already Rested are a no-op, not listed).
  const fatigueRestored: string[] = [];
  for (const u of run.party) {
    if (u.fatigue > 0) {
      u.fatigue = restoreFatigue(u.fatigue);
      fatigueRestored.push(u.id);
    }
  }

  // The heal, tiered by the gate (D80): a **Tier-0** unit cashes the **big heal** (rest-heal down
  // the RP pool, worst-first); the too-worn (or an eligible unit once the pool's spent) get only
  // the free nightly **chip** — they rested off their fatigue, not their wounds. So route hurt
  // units to a Clearing *at Tier 0* to bank the full recovery ("rest the hurt, work the healthy").
  const healed: { unitId: string; hp: number }[] = [];
  const chipHealed: { unitId: string; hp: number }[] = [];
  const wounded = woundedBySeverity(combatRoster(run));
  for (const u of wounded) {
    if (bigHealEligible.has(u.id) && run.rp >= policy.rpPerChunk) {
      const res = restHeal(u, run.rp, policy);
      if (res.rpSpent > 0) {
        spendRp(run, res.rpSpent);
        healed.push({ unitId: u.id, hp: res.hpHealed });
        continue;
      }
    }
    // Not Tier 0, or the pool's spent: the free nightly chip — the floor at every node (D80).
    const hp = healUnit(u, RECOVERY.nightlyChipHp);
    if (hp > 0) chipHealed.push({ unitId: u.id, hp });
  }

  nudgeMorale(run.camp, REST.moraleGain);

  // Premium tier (D47): clear accumulated Upkeep debt (hunger / worn gear from
  // voluntary underfunding) in one swipe — what in-place rest does *not* do.
  const debtCleared = run.camp.gearWear;
  run.camp.gearWear = 0;
  run.camp.skippedUpkeep = [];

  const lost = tickDyingClocks(run.party);
  for (const u of lost) removeFromRoster(run, u);
  return { upkeep, rpAdded, healed, chipHealed, moraleGained: REST.moraleGain, fatigueRestored, debtCleared, lost };
}

/**
 * **In-place rest** (D47) — the lesser, repeatable recovery tier: a costed lever
 * at any *finished* node (the D46 Survey beat). Pays a night's Upkeep → banks the
 * night's Rest Points (support classes boost it via `rpPerNight` — *that is* the
 * class boost, already in the model) → a **small** rest-heal of the
 * most-wounded, **floored at ≥1** so a paid rest never reads "healed 0" like a
 * bug. **Each rest is a full node-step**: it Breaks Camp (ticks cooldowns +
 * accrues interest, D35) and a night passes — a deliberate lever: *buy HP **and**
 * cooldown progress for a night's rations.*
 *
 * Two caps by design: **gold** (refuses, spending nothing, when the purse can't
 * afford another night) and the **per-night RP rate** (one night banks only so
 * much → rate-limited regardless of wealth → the rest node stays faster/better).
 * **Refuses** at full HP (no empty drain). Unlike the rest node, it does **not**
 * restore fatigue or clear worn-gear debt — those stay rest-node-only (D47).
 * Returns the result; `RunLoop` records the telemetry when applied.
 */
export function inPlaceRest(run: RunState): InPlaceRestResult {
  const policy = runDifficulty(run);
  const refuse = (reason: string): InPlaceRestResult => ({
    applied: false, reason, goldSpent: 0, rpAdded: 0, healed: [], hpHealed: 0, streak: run.overworld.restStreak,
  });

  // Refuse at full health (no empty drain, D47) — only wounded fighters count.
  const wounded = woundedBySeverity(combatRoster(run));
  if (wounded.length === 0) return refuse("The party is already at full health.");

  // Soft cap (D80): if a max consecutive-nights cap is set, refuse past it (uncapped by default).
  const cap = RECOVERY.maxInPlaceStreak;
  if (cap != null && run.overworld.restStreak >= cap) {
    return refuse(`The party has rested here ${run.overworld.restStreak} night(s) — time to move on.`);
  }

  // Gold cap (D47): refuse if the purse can't cover a full night's rations — no
  // breach, no morale teeth; the in-place rest only proceeds when fully funded.
  const bill = computeUpkeep(run.party);
  if (run.camp.gold < bill.total) {
    return refuse(`Not enough gold for a night's rations (${bill.total}g).`);
  }

  const upkeep = payUpkeep(run.camp, run.party, { skip: [] });
  const rpAdded = rpPerNight(run.party);
  accrueRp(run, rpAdded);

  const healed: { unitId: string; hp: number }[] = [];
  let hpHealed = 0;
  const credit = (unitId: string, hp: number) => {
    if (hp <= 0) return;
    hpHealed += hp;
    const row = healed.find((h) => h.unitId === unitId);
    if (row) row.hp += hp;
    else healed.push({ unitId, hp });
  };

  // The **free floor** (D80): every alive unit heals the flat nightly chip — the baseline you
  // always get, even with zero RP (this is why a paid rest never reads "healed 0").
  for (const u of run.party) if (u.alive) credit(u.id, healUnit(u, RECOVERY.nightlyChipHp));

  // The **RP accelerator** (D80): spend banked Rest Points to heal the wounded *beyond* the floor,
  // worst-first. RP banks per night and is boosted by support roles (Cook/Medic) — bringing
  // support heals the party faster. No Clearing bonus RP here, so it stays slower than a Clearing.
  for (const u of woundedBySeverity(combatRoster(run))) {
    if (run.rp < policy.rpPerChunk) break;
    const res = restHeal(u, run.rp, policy);
    if (res.rpSpent > 0) {
      spendRp(run, res.rpSpent);
      credit(u.id, res.hpHealed);
    }
  }

  // D73/D80: an in-place rest is an ordinary night — step Fatigue down one tier (nightlyFatigue).
  // (The heal above already paid any Weary RP surcharge; the step-down follows it.)
  for (const u of run.party) u.fatigue = nightlyFatigue(u.fatigue, false);

  // Each rest is a full node-step (D47): Break Camp ticks the spine + accrues interest, and a
  // night passes — but the run stays at this node (repeatable). Count the consecutive-night streak
  // (reset when the caravan moves on, in chooseNode) — a hook for a cap + streak-triggered events.
  breakCamp(run);
  run.night += 1;
  run.overworld.restStreak += 1;
  return { applied: true, goldSpent: upkeep.paid, rpAdded, healed, hpHealed, streak: run.overworld.restStreak };
}
