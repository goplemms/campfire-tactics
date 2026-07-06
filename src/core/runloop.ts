/**
 * Run-loop orchestrator (M6) — the single entry the render layer drives.
 *
 * Steps a seeded run through the phase pipeline Camp → Deployment → Battle →
 * Resolution → next, applying Upkeep/recovery (D9/D15), rewards, material
 * recovery (D13), auto-rescue (D21) and the mortality policy (D9) between
 * encounters, until {@link RunLoop.isOver}. The orchestrator owns the *wiring*;
 * each rule still lives in its own core module — it just sequences them and
 * threads the run's single RNG so the whole run is deterministic.
 *
 * Pure logic: no Phaser, no DOM. Headlessly testable: {@link RunLoop.autoBattle}
 * plays a battle to a decision deterministically so a test can run a full run to
 * a wipe and replay a seed.
 */

import { healUnit, woundedBySeverity, createUnit, type Unit } from "./units";
import type { SkillDef } from "./skills";
import { Battle } from "./turn";
import {
  type RunState,
  runDifficulty,
  currentNode,
  currentEncounter,
  combatRoster,
  isRunOver,
  removeFromRoster,
  recordNight,
  reachableNodes,
  chooseNode,
  breakCamp,
} from "./run";
import {
  stageEncounter,
  encounterOutcome,
  isAuthoredEncounter,
  type StagedEncounter,
  type EncounterSource,
} from "./staging";
import type { EncounterResult } from "./authored";
import {
  trackCombatXp,
  commitCombatXp,
  grantXp,
  type CombatXpTally,
} from "./leveling";
import type { MapNode } from "./overworld";
import { influenceTier } from "./economy";
import { moraleModifiers } from "./morale";
import { moraleTier } from "./camp";
import { applyCampToParty } from "./camp";
import { freeCaptive } from "./deployment";
import { isConcealedTrap, type ConcealedTrap } from "./entities";
import { recoverMaterials } from "./resolution";
import { grantItem } from "./inventory";
import { resolveDowned, resolveCaptured, tickDyingClocks, type DownedOutcome, type RescueQuest } from "./mortality";
import { rpPerNight, payUpkeep, restHeal, computeUpkeep, RECOVERY, type UpkeepResult } from "./upkeep";
import { intelFloor, readEncounter, clampTier, MAX_TIER, TRAP_INTEL, type IntelReport, type IntelTier } from "./intel";
import { PILOT_POLICY, type BattlePolicy } from "./ai";
import { restoreFatigue, nightlyFatigue, isFatigueTier0 } from "./fatigue";
import { useOverworldSkill, scoutedTier, type ActionOpts, type CampSkillResult } from "./overworld-actions";
import { gainRunGold } from "./economy";
import { applyGearCondition } from "./gear-condition";
import {
  type PlaytestLog,
  recordCamp,
  recordEncounter,
  recordRestNode,
  recordInPlaceRest,
  recordEventNode,
} from "./playtest-log";
import {
  eventForNode,
  resolveEvent,
  eventChoices,
  chooseEventOption,
  bypassXp,
  type EventDef,
  type EventOutcome,
  type EventChoice,
} from "./node-events";

/**
 * How the party engaged the **concealed enemy traps** an encounter staged (D12/D54)
 * — the trap-field lever's readout, so a trap node whose field was never touched
 * shows up in telemetry instead of passing silently. All counts are enemy-owned
 * concealed traps only (a player's own Set Trap is a different lever).
 */
export interface TrapEngagement {
  /** Concealed enemy traps on the field at staging. */
  staged: number;
  /** Traps revealed by an Awareness read (includes any later disarmed). */
  spotted: number;
  /** Traps that went off on a party body. */
  sprung: number;
  /** Traps removed by a deliberate disarm (the kit harvested). */
  disarmed: number;
  /** Unsprung traps swept to storage by the win (D82 — needs a standing trap-trained survivor). */
  salvaged: number;
}

/** What a resolved encounter produced (for the render/run-end screen). */
export interface ResolveResult {
  winner?: "player" | "enemy";
  /** The graded outcome (D50/D51) — the renderer's 3-way terminal reads this. */
  result: EncounterResult;
  goldEarned: number;
  recovered: string[];
  rescued: string[];
  downed: DownedOutcome[];
  permadeaths: string[];
  rescueQuests: RescueQuest[];
  /** Per-unit level gains from combat XP + the objective reward (D53) — feedback. */
  levels: Record<string, { charLevels: number; jobLevels: number }>;
  /** Enemy-trap engagement at this node (zeroes when none were staged). */
  traps: TrapEngagement;
  over: boolean;
}

/** What the nightly camp step produced. */
export interface CampResult {
  upkeep: UpkeepResult;
  rpAdded: number;
  dyingLost: string[];
}

/** What a rest node's recovery produced (no battle, D23). */
export interface RestResult {
  upkeep: UpkeepResult;
  rpAdded: number;
  /** Units that cashed the **big heal** (Tier 0 at rest-time) and the HP each gained (D80). */
  healed: { unitId: string; hp: number }[];
  /**
   * Wounded units too worn for the big heal (not Tier 0 at rest-time) that got only the free
   * nightly **chip** (D80) — they rested off their fatigue, not their wounds. The teaching signal
   * for the Tier-0 gate.
   */
  chipHealed: { unitId: string; hp: number }[];
  moraleGained: number;
  /** Units whose overworld fatigue was wiped to Rested by the Deep Rest (D35/D80). */
  fatigueRestored: string[];
  /** Accumulated worn-gear debt the premium rest cleared in one swipe (D47). */
  debtCleared: number;
  dyingLost: string[];
  over: boolean;
}

/** What an {@link RunLoop.bypassEncounter} produced (D80) — the EXP kept, levels gained, terminal. */
export interface BypassResult {
  /** Flat bypass EXP granted to each combatant (below a won fight). */
  xpEach: number;
  /** Per-unit character levels gained from the bypass EXP. */
  levels: Record<string, number>;
  /** The run terminal after recording the night. */
  over: boolean;
}

/** What an {@link RunLoop.inPlaceRest} produced (D47 — the lesser, repeatable tier). */
export interface InPlaceRestResult {
  /** False if the rest was refused (party already full, or can't afford a night). */
  applied: boolean;
  /** When refused: why (render-facing). */
  reason?: string;
  /** Gold paid for the night's upkeep (0 when refused). */
  goldSpent: number;
  /** Rest Points banked this night — the per-night rate cap. */
  rpAdded: number;
  /** Units healed and the HP each gained (the whole wounded party, worst-first, D80). */
  healed: { unitId: string; hp: number }[];
  /** Total HP restored — ≥1 on an applied rest (the floor, D47); 0 only on a refusal. */
  hpHealed: number;
  /** Consecutive in-place-rest nights at this node after this rest (0 on a refusal, D80). */
  streak: number;
}

/**
 * What an **event** node produced (no battle, M11) — the chosen/auto-resolved
 * {@link EventDef} plus its structured {@link EventOutcome} and the run terminal.
 */
export interface EventResolution {
  /** The event that fired at this node (deterministic for a seed, D22). */
  def: EventDef;
  /** The structured outcome (already applied to the run). */
  outcome: EventOutcome;
  over: boolean;
}

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

/** The concealed **enemy** traps currently on `battle`'s field, in any state. */
function enemyTraps(battle: Battle): ConcealedTrap[] {
  return battle.entities.all().filter((e): e is ConcealedTrap => isConcealedTrap(e) && e.owner === "enemy");
}

/** The run-loop orchestrator. */
export class RunLoop {
  readonly run: RunState;
  /** The encounter source currently being played (set by {@link startEncounter}). */
  source?: EncounterSource;
  /** The staged encounter (battle + armed objectives) for the current node. */
  staged?: StagedEncounter;
  /** The live battle for the current encounter. */
  battle?: Battle;
  /** Player combatants placed for the current encounter. */
  combatants: Unit[] = [];
  /** Combat XP tallied on the battle bus, committed at {@link resolve} (D53). */
  private xpTally?: CombatXpTally;
  /**
   * Enemy traps on the field at staging — the {@link TrapEngagement} baseline.
   * Disarmed traps leave the entity registry, so the staged total must be read
   * before play; the delta at {@link resolve} is the disarm count.
   */
  private stagedEnemyTraps = 0;
  /**
   * An optional playtest telemetry sink (the logistics-integrity instrument).
   * When set, the loop snapshots the lever state at each camp/encounter/rest
   * seam into a reviewable timeline. Unset by default — zero behaviour change.
   */
  log?: PlaytestLog;
  /**
   * Battle policies for headless auto-play (D56), one per side — the seam the sim
   * sets to **A/B AI variants** over identical seeds. Defaults to the **pilot**
   * policy on both sides, so play is unchanged unless a caller swaps one in. Set it
   * like {@link log} (before {@link autoTraverse}); {@link autoBattle} reads it.
   */
  policy: { player: BattlePolicy; enemy: BattlePolicy } = { player: PILOT_POLICY, enemy: PILOT_POLICY };

  constructor(run: RunState) {
    this.run = run;
  }

  /** True once the run has ended (a wipe, or a lost battle). */
  isOver(): boolean {
    return this.run.over;
  }

  /** True once the run has been completed (the final node cleared, D23). */
  isComplete(): boolean {
    return this.run.complete;
  }

  /** True once the run has reached any terminal (over or complete). */
  isTerminal(): boolean {
    return this.run.over || this.run.complete;
  }

  // --- Overworld (D22) ------------------------------------------------------

  /** The branch choices reachable from the run's current map position (D22). */
  reachable(): MapNode[] {
    return reachableNodes(this.run);
  }

  /** Commit to a reachable node — moves the run there so it can be played (D22). */
  choose(id: string): MapNode {
    return chooseNode(this.run, id);
  }

  // --- The unified overworld camp (D35) -------------------------------------

  /**
   * Use an **overworld / camp skill** at the current node (D29/D35/D72) — the unified
   * camp verb for *any* between-nodes action (Survey, Cook Stew, the triad's verbs).
   * Delegates to the single cost-gating interpreter ({@link useOverworldSkill}): the
   * capability gate, the two-axis cost gate, the effect, the spend + node-step pacing.
   * `opts` carries a target (Survey's chosen node). Never throws on a refusal — returns
   * the {@link CampSkillResult} the render reads. Replaces the old `overworldAction`
   * (registry id) path (D72).
   */
  useOverworldSkill(unit: Unit, skill: SkillDef, opts: ActionOpts = {}): CampSkillResult {
    return useOverworldSkill(this.run, unit, skill, opts);
  }

  /**
   * Use a **camp job skill** at the current node (D35) — the signature non-combat action
   * (Cook Stew). A thin alias of {@link useOverworldSkill} for the no-target call sites.
   */
  useCampSkill(unit: Unit, skill: SkillDef): CampSkillResult {
    return useOverworldSkill(this.run, unit, skill);
  }

  // --- Rest node (no battle, D23) -------------------------------------------

  /**
   * Play a **rest** node — a Clearing's **Deep Rest** (D23/D80): a night of recovery with **no
   * fight**. Pays Upkeep (a night still costs), banks the nightly Rest Points **plus a rest
   * bonus**, wipes **every** member's fatigue to Rested (the Deep Rest, no opt-out), heals by the
   * **Tier-0 gate** (the big heal for units at Tier 0 at rest-time; the too-worn get only the free
   * nightly chip), nudges morale up (D8), clears worn-gear debt, ticks any dying clocks, and
   * records the night. Returns a summary for the render's rest screen.
   */
  restNode(): RestResult {
    const policy = runDifficulty(this.run);
    // The premium tier pays a full night (no voluntary skips) — it clears debt, it
    // doesn't add to it (D47).
    const upkeep = payUpkeep(this.run.camp, this.run.party, { skip: [] });
    const rpAdded = rpPerNight(this.run.party) + REST.chunks * policy.rpPerChunk;
    this.run.rp += rpAdded;

    // D80: the big heal is gated on **Tier 0 at rest-time** — snapshot eligibility *before* the
    // Deep Rest wipes fatigue (else the wipe would make everyone trivially eligible). One check
    // folds in both *how worn a unit arrived* and *what it did here* (heavy effort at the Clearing
    // tips it out of Tier 0 → wipe only, no heal).
    const bigHealEligible = new Set(
      this.run.party.filter((u) => isFatigueTier0(u.fatigue)).map((u) => u.id),
    );

    // The Deep Rest (D80): wipe **every** member's overworld fatigue to Rested — no assignment,
    // no opt-out (units already Rested are a no-op, not listed).
    const fatigueRestored: string[] = [];
    for (const u of this.run.party) {
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
    const wounded = woundedBySeverity(combatRoster(this.run));
    for (const u of wounded) {
      if (bigHealEligible.has(u.id) && this.run.rp >= policy.rpPerChunk) {
        const res = restHeal(u, this.run.rp, policy);
        if (res.rpSpent > 0) {
          this.run.rp -= res.rpSpent;
          healed.push({ unitId: u.id, hp: res.hpHealed });
          continue;
        }
      }
      // Not Tier 0, or the pool's spent: the free nightly chip — the floor at every node (D80).
      const hp = healUnit(u, RECOVERY.nightlyChipHp);
      if (hp > 0) chipHealed.push({ unitId: u.id, hp });
    }

    this.run.camp.morale += REST.moraleGain;

    // Premium tier (D47): clear accumulated Upkeep debt (hunger / worn gear from
    // voluntary underfunding) in one swipe — what in-place rest does *not* do.
    const debtCleared = this.run.camp.gearWear;
    this.run.camp.gearWear = 0;
    this.run.camp.skippedUpkeep = [];

    const lost = tickDyingClocks(this.run.party);
    for (const u of lost) removeFromRoster(this.run, u);
    const node = currentNode(this.run);
    const over = recordNight(this.run, {
      nodeId: node.id,
      layer: node.layer,
      kind: node.kind,
      goldEarned: 0,
      fallen: lost.map((u) => u.id),
    });
    const result: RestResult = { upkeep, rpAdded, healed, chipHealed, moraleGained: REST.moraleGain, fatigueRestored, debtCleared, dyingLost: lost.map((u) => u.id), over };
    recordRestNode(this.log, this.run, result);
    return result;
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
   */
  inPlaceRest(): InPlaceRestResult {
    const policy = runDifficulty(this.run);
    const refuse = (reason: string): InPlaceRestResult => ({
      applied: false, reason, goldSpent: 0, rpAdded: 0, healed: [], hpHealed: 0, streak: this.run.overworld.restStreak,
    });

    // Refuse at full health (no empty drain, D47) — only wounded fighters count.
    const wounded = woundedBySeverity(combatRoster(this.run));
    if (wounded.length === 0) return refuse("The party is already at full health.");

    // Soft cap (D80): if a max consecutive-nights cap is set, refuse past it (uncapped by default).
    const cap = RECOVERY.maxInPlaceStreak;
    if (cap != null && this.run.overworld.restStreak >= cap) {
      return refuse(`The party has rested here ${this.run.overworld.restStreak} night(s) — time to move on.`);
    }

    // Gold cap (D47): refuse if the purse can't cover a full night's rations — no
    // breach, no morale teeth; the in-place rest only proceeds when fully funded.
    const bill = computeUpkeep(this.run.party);
    if (this.run.camp.gold < bill.total) {
      return refuse(`Not enough gold for a night's rations (${bill.total}g).`);
    }

    const upkeep = payUpkeep(this.run.camp, this.run.party, { skip: [] });
    const rpAdded = rpPerNight(this.run.party);
    this.run.rp += rpAdded;

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
    for (const u of this.run.party) if (u.alive) credit(u.id, healUnit(u, RECOVERY.nightlyChipHp));

    // The **RP accelerator** (D80): spend banked Rest Points to heal the wounded *beyond* the floor,
    // worst-first. RP banks per night and is boosted by support roles (Cook/Medic) — bringing
    // support heals the party faster. No Clearing bonus RP here, so it stays slower than a Clearing.
    for (const u of woundedBySeverity(combatRoster(this.run))) {
      if (this.run.rp < policy.rpPerChunk) break;
      const res = restHeal(u, this.run.rp, policy);
      if (res.rpSpent > 0) {
        this.run.rp -= res.rpSpent;
        credit(u.id, res.hpHealed);
      }
    }

    // D73/D80: an in-place rest is an ordinary night — step Fatigue down one tier (nightlyFatigue).
    // (The heal above already paid any Weary RP surcharge; the step-down follows it.)
    for (const u of this.run.party) u.fatigue = nightlyFatigue(u.fatigue, false);

    // Each rest is a full node-step (D47): Break Camp ticks the spine + accrues interest, and a
    // night passes — but the run stays at this node (repeatable). Count the consecutive-night streak
    // (reset when the caravan moves on, in chooseNode) — a hook for a cap + streak-triggered events.
    breakCamp(this.run);
    this.run.night += 1;
    this.run.overworld.restStreak += 1;
    const result: InPlaceRestResult = { applied: true, goldSpent: upkeep.paid, rpAdded, healed, hpHealed, streak: this.run.overworld.restStreak };
    recordInPlaceRest(this.log, this.run, result);
    return result;
  }

  // --- Event node (the data-driven registry, no battle, M11) ----------------

  /** The event the current node runs — deterministic for a seed (M11, D22). */
  eventDef(): EventDef {
    return eventForNode(this.run.seed, currentNode(this.run), influenceTier(this.run.overworld.influence));
  }

  /**
   * Play an **event** node **headlessly** (M11, D4/D22): resolve the node's event
   * through its {@link EventDef.autoResolve} (the deterministic default — a thief
   * skims, a shop/recruiter is passed, a story takes its seed-picked option), then
   * record the night/cooldown tick. This is the path {@link autoTraverse} and {@link
   * playCurrentNode} take; the interactive render uses {@link eventChoices}/{@link
   * chooseEvent}/{@link recordEventNight} instead.
   */
  eventNode(): EventResolution {
    const node = currentNode(this.run);
    const def = eventForNode(this.run.seed, node, influenceTier(this.run.overworld.influence));
    const outcome = resolveEvent(this.run, node);
    const over = this.recordEventNight(outcome.goldDelta);
    const result: EventResolution = { def, outcome, over };
    recordEventNode(this.log, this.run, result);
    return result;
  }

  /** The interactive options for the current event node (M11) — render-facing. */
  eventChoices(): EventChoice[] {
    return eventChoices(this.run, currentNode(this.run));
  }

  /**
   * Apply one interactive event option (M11) — a shop buy, a recruiter Hire/Decline,
   * a story option. Does **not** record the night; the render calls {@link
   * recordEventNight} once the player is done interacting.
   */
  chooseEvent(choiceId: string): EventOutcome {
    return chooseEventOption(this.run, currentNode(this.run), choiceId);
  }

  /**
   * Record the event node's night/cooldown tick once the player has finished
   * interacting (M11). `goldEarned` is the net purse delta the render accumulated
   * (informational in the history). Returns the run terminal.
   */
  recordEventNight(goldEarned = 0): boolean {
    const node = currentNode(this.run);
    return recordNight(this.run, {
      nodeId: node.id,
      layer: node.layer,
      kind: node.kind,
      goldEarned,
      fallen: [],
    });
  }

  // --- Camp (between battles, D9/D15) ---------------------------------------

  /**
   * Run the nightly camp upkeep + recovery (D9/D15): pay Upkeep (underfunding a
   * line hits morale), bank Rest Points, and tick any Hard-mode dying clocks —
   * removing units whose clock ran out (permadeath). RP triage and cleric
   * revives are explicit player actions on {@link "./upkeep"}.
   */
  camp(): CampResult {
    const upkeep = payUpkeep(this.run.camp, this.run.party);
    const rpAdded = rpPerNight(this.run.party);
    this.run.rp += rpAdded;
    const lost = tickDyingClocks(this.run.party);
    const dyingLost = lost.map((u) => u.id);
    for (const u of lost) removeFromRoster(this.run, u);
    this.run.over = isRunOver(this.run);
    const result: CampResult = { upkeep, rpAdded, dyingLost };
    recordCamp(this.log, this.run, result);
    return result;
  }

  // --- Intel (D10) ----------------------------------------------------------

  /** The current encounter's intel report at the party's floor tier (D10). */
  intel(extraTier = 0): IntelReport {
    const def = this.source ?? currentEncounter(this.run);
    const tier = Math.min(3, intelFloor(this.run.party) + extraTier) as IntelTier;
    return readEncounter(def, tier);
  }

  // --- Battle setup ---------------------------------------------------------

  /**
   * Stage the current node's encounter through the **converged seam** (D50): one
   * {@link stageEncounter} turns either a procedural or authored source into the
   * `{ battle, objectives }` shape, places the active roster (authored spawns or
   * the auto home edge), arms its objectives, and wires the combat-XP accumulator
   * (D53). `deploymentPenalty` shrinks the procedural home columns (the D9 rescue
   * "ambush-in-reverse" modifier).
   */
  startEncounter(deploymentPenalty = 0): Battle {
    const source = currentEncounter(this.run);
    const players = combatRoster(this.run);
    // Scouting the node to full positional intel (tier 3) blows any hidden ambush
    // — the bodies stage visible instead of springing a surprise (D10 reveal).
    const node = currentNode(this.run);
    const tier = clampTier(intelFloor(this.run.party) + scoutedTier(this.run.overworld, node.id));
    // Blanket gear-condition stamp (D52): the iron-weapons +attack edge (decayed by
    // worn gear) and the worn-gear −defense, applied party-wide before the fight.
    applyGearCondition(this.run, players);
    const staged = stageEncounter(source, players, {
      deploymentPenalty,
      revealHidden: tier >= MAX_TIER,
      // The tier-3 trap-lane read (D83): the survey marks the careless snares.
      markTrapsUpTo: tier >= TRAP_INTEL.markTier ? TRAP_INTEL.markConcealmentMax : undefined,
      seed: this.run.seed,
    });
    this.source = source;
    this.staged = staged;
    this.combatants = players;
    this.battle = staged.battle;
    this.stagedEnemyTraps = enemyTraps(staged.battle).length;
    this.xpTally = trackCombatXp(staged.battle.bus); // subscribe before any turns (D53)
    return staged.battle;
  }

  /**
   * Begin the staged battle: apply the Cook's banked heal and seed initiative
   * warmed by the current morale tier (D8). Returns the HP healed.
   */
  beginBattle(): number {
    if (!this.battle) throw new Error("RunLoop.beginBattle: no staged battle");
    const healed = applyCampToParty(this.run.camp, this.battle.units, this.battle.bus);
    const mods = moraleModifiers(moraleTier(this.run.camp.morale));
    this.battle.seed(mods.initiativeBonus);
    return healed;
  }

  // --- Resolution (D13/D21/D9) ----------------------------------------------

  /**
   * Resolve the finished encounter on the **graded** outcome (D50/D51). One
   * {@link encounterOutcome} classifies it: **win** (all required objectives met) →
   * reward gold (morale gold-find, D8) + material drops + recover unsprung
   * materials (D13) + commit combat XP and the objective reward.xp to survivors
   * (D53); **objective-failure** (a required objective lost) → **no reward** but the
   * party retreats alive; **wipe** → the run-ending loss. On **either survivable**
   * outcome (win *or* objective-failure) downed units resolve per the D9 mortality
   * policy (the same retreat-alive path, not auto-permadeath); a wipe has no camp to
   * recover in. Captives auto-rescue on a win, else become rescue quests (D21).
   * Records the graded result so the final-node terminal grades correctly (D51).
   */
  resolve(): ResolveResult {
    if (!this.battle || !this.staged || !this.source) throw new Error("RunLoop.resolve: no battle");
    const battle = this.battle;
    const source = this.source;
    const policy = runDifficulty(this.run);
    const result = encounterOutcome(this.staged) ?? "wipe";
    const won = result === "win";
    const survivable = result !== "wipe"; // win or objective-failure: the party retreats alive

    // Rewards + material recovery + XP — **win only** (forfeited otherwise, D51/D53).
    let goldEarned = 0;
    let recovered: string[] = [];
    let levels: ResolveResult["levels"] = {};
    let sweptTraps = 0;
    if (won) ({ goldEarned, recovered, levels, sweptTraps } = this.applyRewards(source, battle));

    // Captives: auto-rescued on a win, else turned into rescue follow-ups (D21).
    // Persist the follow-ups on the run so an abandoned companion is never lost
    // from view — the Captain's Journal nags from `run.rescueQuests` (D9).
    const { rescued, rescueQuests } = this.resolveRescues(won, policy);
    this.run.rescueQuests.push(...rescueQuests);

    // On-board captive **recruits** (D52): an authored captive (the L1 Cook) is freed and
    // **joins the party on the win** — even if the player never reached him (the captors
    // fell), and even if a mid-fight-freed captive was downed (demo-friendly: a won node
    // always delivers the recruit, replacing the old post-win `grants.recruit`). Win-only,
    // idempotent. Recruits are folded into `rescued` (the resolution names the join) and
    // their completion-XP level-ups into `levels` (the captive joins leveled, not at base).
    const captives = this.resolveCaptiveRecruits(won, source);
    rescued.push(...captives.recruited);
    levels = { ...levels, ...captives.levels };

    // Mortality (D9): downed player combatants resolve on a survivable outcome (D51).
    const { downed, permadeaths } = this.resolveMortalities(survivable, policy);

    // Trap engagement (D12/D54) — read before the battle is discarded. A disarmed
    // trap left the registry (the staged snapshot supplies the delta) and required
    // a spot first, so it counts as spotted too.
    const present = enemyTraps(battle);
    const disarmed = this.stagedEnemyTraps - present.length;
    const traps: TrapEngagement = {
      staged: this.stagedEnemyTraps,
      spotted: present.filter((t) => t.revealed).length + disarmed,
      sprung: present.filter((t) => t.sprung).length,
      disarmed,
      salvaged: sweptTraps,
    };

    // Record the graded node outcome + advance the night/terminal (D51). recordNight
    // sets the run terminal: a win at the final node = complete; any other final-node
    // resolution ends the run (returned-alive without the prize, or a wipe).
    const node = currentNode(this.run);
    const winner: "player" | "enemy" = result === "wipe" ? "enemy" : "player";
    const fallen = result === "wipe"
      ? this.combatants.filter((u) => !u.alive).map((u) => u.id)
      : [...permadeaths];
    const over = recordNight(this.run, {
      nodeId: node.id,
      layer: node.layer,
      kind: node.kind,
      type: isAuthoredEncounter(source) ? undefined : source.type,
      winner,
      result,
      goldEarned,
      fallen,
    });

    this.battle = undefined;
    this.source = undefined;
    this.staged = undefined;
    this.combatants = [];
    this.xpTally = undefined;
    this.stagedEnemyTraps = 0;

    const out: ResolveResult = { winner, result, goldEarned, recovered, rescued, downed, permadeaths, rescueQuests, levels, traps, over };
    recordEncounter(this.log, this.run, out);
    return out;
  }

  /**
   * **Bypass** the current node's encounter (D80) — the paid short-circuit of a tailored bypass
   * event. No fight: each combatant keeps a flat {@link "./node-events".bypassXp} (below a won
   * fight, so bypassing is never strictly better), the **loot is forgone** (`goldEarned: 0`), and
   * the night is recorded as a player resolution so the run advances. The passage fee was already
   * spent by the event's `choose` handler; this is the run-flow half. Never offered on the final
   * node (guarded in {@link "./node-events".tailoredEarlyEventFor}), so it can't end the run.
   */
  bypassEncounter(): BypassResult {
    const node = currentNode(this.run);
    const xpEach = bypassXp(node);
    const levels: Record<string, number> = {};
    for (const u of combatRoster(this.run)) {
      const lv = grantXp(u, xpEach);
      if (lv > 0) levels[u.id] = lv;
    }
    const over = recordNight(this.run, {
      nodeId: node.id,
      layer: node.layer,
      kind: node.kind,
      winner: "player",
      result: "win",
      goldEarned: 0,
      fallen: [],
    });
    return { xpEach, levels, over };
  }

  /**
   * The **win payout** (D8/D13/D53): reward gold (morale gold-find) routed to the
   * purse, material drops under the storage cap, recovered unsprung materials, and
   * the combat-event tally + objective `reward.xp` committed to resolution's
   * survivors. Mutates the run; returns the feedback slice. Win-only (D51/D53).
   */
  private applyRewards(
    source: EncounterSource,
    battle: Battle,
  ): Pick<ResolveResult, "goldEarned" | "recovered" | "levels"> & { sweptTraps: number } {
    const mods = moraleModifiers(moraleTier(this.run.camp.morale));
    const goldEarned = Math.round(source.reward.gold * (1 + mods.goldFindBonus));
    // Loot routes to the PURSE (D34), auto-repaying any Banker debt first (D30).
    gainRunGold(this.run, goldEarned);
    for (const drop of source.reward.materials) {
      // Drops always land (D75) — overflow is resolved by a discard at Break Camp, never silently lost.
      grantItem(this.run.inventory, drop.id, drop.count);
    }
    // The survivors of resolution: they sweep the won field's snares (D82) and
    // bank the XP (D53).
    const survivors = this.combatants.filter((u) => u.alive && !u.captured);
    const recovery = recoverMaterials(battle.entities.all(), "player", this.run.inventory, survivors);
    const recovered = recovery.recovered;

    // Combat-event XP (D53): commit the bus tally + the objective reward.xp to the
    // survivors of resolution — no mid-battle level-ups, none on a non-win.
    const tally: CombatXpTally = { ...(this.xpTally ?? {}) };
    const objXp = source.reward.xp ?? 0;
    if (objXp > 0) for (const u of survivors) tally[u.id] = (tally[u.id] ?? 0) + objXp;
    const levels = commitCombatXp(tally, survivors);

    // Post-win authored grants (D52): a rescued recruit joins the party, a relic drops
    // into the stash, and/or a run flag is set. Win-only (this is applyRewards, called
    // on a win), idempotent (a recruit already aboard is not re-added).
    if (isAuthoredEncounter(source) && source.grants) this.applyGrant(source.grants);

    return { goldEarned, recovered, levels, sweptTraps: recovery.swept };
  }

  /**
   * Apply an authored encounter's **post-win grant** (D52): push the recruit onto the
   * run party (a fresh, authored body — joins permanently), drop the relic/item into
   * the stash under the cap, and set any run flag (read by conditional node access).
   * Idempotent on the recruit (an id already in the party is skipped).
   */
  private applyGrant(grant: import("./authored").EncounterGrant): void {
    if (grant.recruit && !this.run.party.some((u) => u.id === grant.recruit!.id)) {
      this.run.party.push(createUnit({ ...grant.recruit, authored: true }));
    }
    if (grant.item) grantItem(this.run.inventory, grant.item); // the relic always lands (D75)
    if (grant.flag) this.run.flags[grant.flag] = true;
  }

  /**
   * Resolve captives (D21): auto-freed on a win, else turned into rescue follow-up
   * quests (not death). Mutates freed units; returns the rescue slice.
   */
  private resolveRescues(
    won: boolean,
    policy: ReturnType<typeof runDifficulty>,
  ): Pick<ResolveResult, "rescued" | "rescueQuests"> {
    const rescued: string[] = [];
    const rescueQuests: RescueQuest[] = [];
    for (const u of this.combatants) {
      if (!u.captured) continue;
      if (won) {
        freeCaptive(u);
        rescued.push(u.id);
      } else {
        rescueQuests.push(resolveCaptured(policy, u)); // a follow-up quest, not death
      }
    }
    return { rescued, rescueQuests };
  }

  /**
   * Recruit an authored encounter's on-board **captive recruits** (D52) on the win — the
   * L1 Cook's "freeing → joins permanently" path, replacing the old post-win
   * `grants.recruit`. The captive is staged in the battle but never in `combatants`/the
   * roster, so {@link resolveRescues} (which iterates the roster) doesn't touch it; this is
   * its single recruit seam. On a **win** each declared captive joins `run.party` as a
   * fresh authored body that **banks the encounter's completion XP** (the objective
   * `reward.xp`, routed through {@link "./leveling".commitCombatXp} to the same char + job
   * axes the survivors level on) — so it joins **leveled with the party**, not at base —
   * **regardless of whether it was freed mid-fight or even downed after** (the win-recruit
   * guarantee: a captor's fall frees the captive). It earns only this flat completion XP,
   * **not** the per-unit combat-event tally (it was never a tracked combatant). On a
   * **non-win** nothing is recruited (the rescue failed; it was never in the party, so
   * there's nothing to lose and no quest to mount). Idempotent (an id already aboard is
   * skipped). Returns the recruited **ids** (folded into the resolution's `rescued`; the
   * render maps them to names) and their **level-ups** (folded into the resolution `levels`).
   *
   * **Seam limitation (reuse note):** win-gated, so it's only sound for encounters that end
   * **win or wipe** — E1 is elimination-only, so a survivable non-win can't happen there. A
   * future captive in an **objective-failure-capable** encounter would currently vanish on a
   * survivable loss (no recruit *and* no rescue quest, unlike a roster captive). Extend this
   * (a captive → rescue-quest fallback) before standing a captive up in such a node.
   */
  private resolveCaptiveRecruits(
    won: boolean,
    source: EncounterSource,
  ): { recruited: string[]; levels: ResolveResult["levels"] } {
    if (!won || !isAuthoredEncounter(source) || !source.captives) return { recruited: [], levels: {} };
    const recruited: string[] = [];
    const fresh: Unit[] = [];
    for (const c of source.captives) {
      if (this.run.party.some((u) => u.id === c.spec.id)) continue; // idempotent
      const unit = createUnit({ ...c.spec, authored: true });
      this.run.party.push(unit);
      fresh.push(unit);
      recruited.push(c.spec.id); // ids (like resolveRescues); the render maps to names
    }
    // A freed captive shares the encounter's **completion XP** (D52) — the flat objective
    // `reward.xp` every survivor banks at resolution — so it joins leveled with the party.
    const objXp = source.reward.xp ?? 0;
    const tally: CombatXpTally = {};
    if (objXp > 0) for (const u of fresh) tally[u.id] = objXp;
    return { recruited, levels: commitCombatXp(tally, fresh) };
  }

  /**
   * Mortality (D9): on a **survivable** outcome (win OR objective-failure), resolve
   * every downed player combatant per the difficulty policy — the same retreat path
   * (D51). A **wipe** is the run-ending loss; there's no camp to recover in, so this
   * resolves nothing. Mutates the roster (permadeath removal); returns the slice.
   */
  private resolveMortalities(
    survivable: boolean,
    policy: ReturnType<typeof runDifficulty>,
  ): Pick<ResolveResult, "downed" | "permadeaths"> {
    const downed: DownedOutcome[] = [];
    const permadeaths: string[] = [];
    if (survivable) {
      for (const u of this.combatants) {
        if (u.alive || u.captured) continue;
        const res = resolveDowned(policy, u);
        downed.push(res);
        if (res.permadeath) {
          removeFromRoster(this.run, u);
          permadeaths.push(u.id);
        }
      }
    }
    return { downed, permadeaths };
  }

  // --- Headless auto-play (tests / fast-forward) ----------------------------

  /**
   * Play **one** node at the run's current position to completion (D22/D23): a
   * **combat** node runs camp → stage → auto-battle → resolve; a **rest** node
   * runs the recovery step. The orchestrator must already be positioned (via
   * {@link choose}). Returns the node played. The interactive render drives the
   * battle itself — this is the headless fast-forward used by {@link autoTraverse}.
   */
  playCurrentNode(): MapNode {
    const node = currentNode(this.run);
    if (node.kind === "rest") {
      this.restNode();
      return node;
    }
    if (node.kind === "event") {
      this.eventNode();
      return node;
    }
    this.camp();
    if (this.isOver()) return node; // a dying clock ran out at camp → wipe
    this.startEncounter();
    this.beginBattle();
    this.autoBattle();
    this.resolve();
    return node;
  }

  /**
   * **Pick-first-reachable** traversal of the whole map to a terminal state
   * (D22) — deterministically choosing the first reachable node each step and
   * playing it, until the run is **over** (wipe / lost) or **complete** (final
   * node cleared). Returns the route taken. Lets a headless test play an entire
   * map to a wipe/clear and replay a seed.
   */
  autoTraverse(maxNodes = 100): string[] {
    let guard = 0;
    while (!this.isTerminal() && guard++ < maxNodes) {
      const next = this.reachable();
      if (next.length === 0) break; // only the final node has none — defensive
      this.choose(next[0].id);
      this.playCurrentNode();
    }
    return [...this.run.path];
  }

  /**
   * Play the current battle to a decision **deterministically** — each side plans
   * through its {@link BattlePolicy} (defaulting to {@link RunLoop.policy}, pilot on
   * both sides), threading no randomness beyond the clock's stable tie-breaks. Pass
   * `player`/`enemy` to **A/B two AI variants** in one call. Returns the winning
   * side. Used by the simulator + full-loop test; the interactive render drives the
   * battle itself.
   */
  autoBattle(opts: { maxTurns?: number; player?: BattlePolicy; enemy?: BattlePolicy } = {}): "player" | "enemy" | undefined {
    if (!this.battle) throw new Error("RunLoop.autoBattle: no staged battle");
    const battle = this.battle;
    const maxTurns = opts.maxTurns ?? 1000;
    const player = opts.player ?? this.policy.player;
    const enemy = opts.enemy ?? this.policy.enemy;
    // Stop the moment the encounter is **decided** (D50) — a closing-gate can fail
    // the fight while enemies still stand, so poll the graded outcome, not just the
    // elimination primitive. resolve() reads the same classifier for the grade.
    const decided = () =>
      this.staged ? encounterOutcome(this.staged) !== undefined : battle.outcome().over;
    for (let i = 0; i < maxTurns; i++) {
      if (decided()) return battle.outcome().winner;
      const actor = battle.nextActor();
      if (!actor) break;
      // The whole plan→execute→endTurn step lives in Battle.runEnemyTurn — drive it
      // with the acting side's policy (the seam the sim swaps for A/B, D56).
      battle.runEnemyTurn(actor, actor.side === "player" ? player : enemy);
    }
    return battle.outcome().winner;
  }
}
