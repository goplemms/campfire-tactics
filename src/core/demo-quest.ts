/**
 * "The Hollow Mill" — the M12 demo quest (D44) and its runner.
 *
 * A short, hand-authored 5-beat quest that makes **every M12 decision show up in
 * play** (the proof harness): Provision → Skirmish → Rest/Level-up → Ambush at
 * the chokepoint → Captain's Holdout. It plays in a **standalone demo mode**
 * (bypassing the guild/overworld) and reuses the combat pipeline with
 * {@link AuthoredEncounter}s instead of procedural output.
 *
 * The {@link DemoRunner} walks the beats, carrying party HP / levels / inventory
 * across them, and resolves each encounter with **graded failure** (D43).
 *
 * Pure logic: no Phaser, no DOM, no `Math.random`.
 */

import { createUnit, type Unit, type UnitSpec } from "./units";
import { Battle } from "./turn";
import { planEnemyTurn } from "./ai";
import { battleOutcome } from "./combat";
import { getJob } from "./jobs";
import { routeCombatXp } from "./leveling";
import {
  createInventory,
  addItem,
  countOf,
  type Inventory,
} from "./inventory";
import {
  buildAuthoredGrid,
  buildAuthoredEnemies,
  placeParty,
  armObjective,
  type AuthoredEncounter,
  type AuthoredQuest,
  type EncounterBeat,
  type ObjectiveState,
  type EncounterResult,
  type StoryOutcome,
} from "./authored";

// --- The demo party (D44) — reslots the cast onto the new classes -----------

/** Build a party member from a job's baseline frame (D39). */
function member(id: string, name: string, jobId: string, extra: Partial<UnitSpec> = {}): UnitSpec {
  const base = getJob(jobId)?.baseline;
  return {
    id,
    name,
    side: "player",
    pos: { col: 0, row: 0 },
    jobId,
    speed: base?.speed ?? 10,
    maxHp: base?.maxHp ?? 22,
    attack: base?.attack ?? 6,
    defense: base?.defense ?? 2,
    moveRange: base?.moveRange ?? 4,
    sightRadius: base?.sightRadius ?? 5,
    attackRange: base?.attackRange ?? 1,
    intelligence: 2,
    awareness: 2,
    ...extra,
  };
}

/** The five demo characters (Pip the Chef auto-Defends as a 5th body). */
export const DEMO_PARTY: UnitSpec[] = [
  member("edrin", "Edrin", "heavy-knight", { isLord: true }),
  member("rook", "Rook", "hunter"),
  member("vale", "Vale", "scout"),
  member("sela", "Sela", "medic"),
  member("pip", "Pip", "chef", { standingOrder: "defend", maxHp: 22, attack: 5, defense: 2, moveRange: 3, speed: 8 }),
];

// --- The five encounters ----------------------------------------------------

/** E1 — Skirmish: an open mill yard, four loose bandits incl. an apart straggler. */
export const E1_SKIRMISH: AuthoredEncounter = {
  id: "e1-skirmish",
  name: "Skirmish at the Mill Yard",
  cols: 8,
  rows: 6,
  blocked: [{ col: 4, row: 1 }, { col: 4, row: 4 }],
  playerSpawns: [
    { col: 0, row: 1 }, { col: 0, row: 2 }, { col: 0, row: 3 }, { col: 0, row: 4 }, { col: 1, row: 2 },
  ],
  enemies: [
    { templateId: "bandit-thug", pos: { col: 6, row: 2 } },
    { templateId: "bandit-thug", pos: { col: 6, row: 3 } },
    { templateId: "bandit-bowman", pos: { col: 7, row: 4 } },
    { templateId: "bandit-cutthroat", pos: { col: 7, row: 0 } }, // placed apart — the isolation moment
  ],
  reward: { gold: 60, materials: [{ id: "salve", count: 1 }] },
  xp: 40,
};

/** E2 — Ambush at the chokepoint: a sluice-bridge funnel, a snare debuffer, a hidden pair. */
export const E2_AMBUSH: AuthoredEncounter = {
  id: "e2-ambush",
  name: "Ambush at the Chokepoint",
  cols: 8,
  rows: 6,
  // A narrow sluice-bridge chokepoint: a wall band with a single gap at row 2-3.
  blocked: [
    { col: 4, row: 0 }, { col: 4, row: 1 }, { col: 4, row: 4 }, { col: 4, row: 5 },
  ],
  playerSpawns: [
    { col: 0, row: 2 }, { col: 0, row: 3 }, { col: 1, row: 2 }, { col: 1, row: 3 }, { col: 0, row: 1 },
  ],
  enemies: [
    { templateId: "bandit-thug", pos: { col: 6, row: 2 } },
    { templateId: "bandit-thug", pos: { col: 6, row: 3 } },
    { templateId: "bandit-bowman", pos: { col: 7, row: 1 } },
    { templateId: "snare-trapper", pos: { col: 7, row: 4 } }, // the Immobilize debuffer
    { templateId: "bandit-cutthroat", pos: { col: 7, row: 5 }, hidden: true }, // ambush, gated by the deserter choice
    { templateId: "bandit-cutthroat", pos: { col: 6, row: 5 }, hidden: true },
  ],
  reward: { gold: 80, materials: [{ id: "antidote", count: 1 }] },
  xp: 60,
};

/** E3 — The Captain's Holdout: the millrace bridge, a Sapper on an N-turn cut. */
export const E3_HOLDOUT: AuthoredEncounter = {
  id: "e3-holdout",
  name: "The Captain's Holdout",
  cols: 9,
  rows: 5,
  blocked: [{ col: 4, row: 0 }, { col: 4, row: 4 }],
  playerSpawns: [
    { col: 0, row: 2 }, { col: 0, row: 1 }, { col: 0, row: 3 }, { col: 1, row: 2 }, { col: 1, row: 1 },
  ],
  enemies: [
    { templateId: "bandit-captain", pos: { col: 8, row: 2 }, role: "captain", id: "captain" },
    { templateId: "sapper", pos: { col: 7, row: 0 }, role: "sapper", id: "sapper" },
    { templateId: "bandit-cutthroat", pos: { col: 7, row: 3 } },
    { templateId: "bandit-thug", pos: { col: 7, row: 4 } },
  ],
  reward: { gold: 150, materials: [{ id: "salve", count: 2 }] },
  xp: 80,
  // The bridge-cut: a visible ~3-turn timer (kill/Immobilize the Sapper to fizzle).
  objective: { kind: "bridge-cut", speed: 4, span: [{ col: 4, row: 2 }] },
};

/** The full authored quest (D44). */
export const THE_HOLLOW_MILL: AuthoredQuest = {
  id: "hollow-mill",
  name: "The Hollow Mill",
  party: DEMO_PARTY,
  beats: [
    {
      kind: "provision",
      storageCap: 8,
      gold: 120,
      offer: ["salve", "stimulant", "antidote"],
      intel: "~4 bandits, blades + a bow. (No debuffer — antidotes low-value here.)",
    },
    { kind: "encounter", encounter: E1_SKIRMISH },
    {
      kind: "rest",
      xp: 100, // tuned to take the party from job-L1 to L2 → 2nd actives unlock
      choice: {
        prompt: "A wounded bandit deserter begs for mercy.",
        // Keep the button labels terse — the tradeoff each implies rides in the
        // outcome `summary`, which the UI surfaces as the hover hint.
        spareLabel: "Spare him",
        pressLabel: "Press for coin",
        spare: {
          summary: "He warns of a hidden ambush and a snare-trapper — buy antidotes.",
          items: [{ id: "antidote", count: 1 }],
          revealAmbush: true,
        },
        press: { summary: "You take his coin; the way ahead is unscouted.", gold: 40 },
      },
    },
    { kind: "encounter", encounter: E2_AMBUSH },
    { kind: "encounter", encounter: E3_HOLDOUT },
  ],
};

// --- The runner -------------------------------------------------------------

/** A staged encounter ready to play (the render drives it; tests auto-resolve). */
export interface DemoStagedEncounter {
  battle: Battle;
  objective: ObjectiveState;
  encounter: AuthoredEncounter;
}

/**
 * Balance telemetry for one auto-played encounter (D43 instrumentation). The
 * auto-play is an AI-vs-AI sim (both sides on the scoring planner, no item use),
 * so treat these as a *relative* difficulty read — a way to spot pushovers and
 * coin-flips and to compare branches — not a substitute for human play.
 */
export interface EncounterReport {
  encounter: string;
  result: EncounterResult;
  /** Actor activations until the fight resolved. */
  turns: number;
  /** Party HP fraction (0–1) when the fight ended, before the retreat heal. */
  endHpPct: number;
  /** The lowest party HP fraction seen at any point — the closest call. */
  lowestHpPct: number;
  /** Party members downed at the fight's end. */
  downed: number;
  /** Foes still standing at the end (telling on a wipe / objective loss). */
  foesLeft: number;
  /** Most simultaneous party debuffs — how much the snare/debuffer pressure bit. */
  debuffPeak: number;
}

/** Telemetry for a whole auto-played run of a quest, one row per encounter. */
export interface RunReport {
  restChoice: "spare" | "press";
  outcome: "complete" | "failed" | "wipe";
  encounters: EncounterReport[];
}

/**
 * Walks an {@link AuthoredQuest}'s beats, carrying the party (HP / levels /
 * inventory) across them and resolving encounters with graded failure (D43).
 * The render layer drives it beat-by-beat; {@link autoResolveEncounter} gives
 * tests a headless playthrough.
 */
export class DemoRunner {
  readonly quest: AuthoredQuest;
  readonly party: Unit[];
  inventory: Inventory = createInventory(8);
  gold = 0;
  beatIndex = 0;
  ambushRevealed = false;
  /** Quest terminal once set: cleared / failed (retreat) / wiped. */
  outcome?: "complete" | "failed" | "wipe";
  readonly log: string[] = [];

  constructor(quest: AuthoredQuest = THE_HOLLOW_MILL) {
    this.quest = quest;
    this.party = quest.party.map(createUnit);
  }

  /** The current beat, or undefined past the end. */
  currentBeat() {
    return this.quest.beats[this.beatIndex];
  }

  /** Advance to the next beat. */
  advance(): void {
    this.beatIndex += 1;
  }

  /** Beat 1 — Provision: stock the offered herbs under the storage cap. */
  provision(loads: { id: string; count: number }[]): void {
    const beat = this.currentBeat();
    if (beat?.kind !== "provision") throw new Error("provision: not a provision beat");
    this.inventory = createInventory(beat.storageCap);
    this.gold += beat.gold;
    for (const { id, count } of loads) {
      if (!beat.offer.includes(id)) continue;
      for (let i = 0; i < count; i++) if (!addItem(this.inventory, id, 1)) break;
    }
    this.log.push(`Provisioned: ${beat.offer.map((h) => `${h}×${countOf(this.inventory, h)}`).join(", ")}`);
  }

  /** Reset a party member's combat-transient state for a fresh encounter. */
  private freshen(u: Unit): void {
    u.statuses = [];
    u.cooldowns = {};
    u.ct = 0;
    u.captured = false;
    if (!u.alive) u.alive = true; // a recovered (retreated) member returns
    if (u.hp <= 0) u.hp = Math.max(1, u.hp);
  }

  /** Stage an encounter beat: build the board with the persistent party. */
  stageEncounter(beat: EncounterBeat): DemoStagedEncounter {
    const enc = beat.encounter;
    const grid = buildAuthoredGrid(enc);
    for (const u of this.party) this.freshen(u);
    placeParty(this.party, enc.playerSpawns);
    const enemies = buildAuthoredEnemies(enc);
    // The "spare" branch pre-reveals the ambush; otherwise it stays hidden.
    if (this.ambushRevealed) for (const e of enemies) e.hidden = false;
    const units = [...this.party, ...enemies];
    const battle = new Battle(grid, units);
    battle.seed();
    const objective = armObjective(battle.clock, enc, units);
    return { battle, objective, encounter: enc };
  }

  /**
   * Headlessly auto-play a staged encounter (both sides via the scoring AI) and
   * return the graded result (D43). Stops the moment the objective is lost.
   */
  autoResolveEncounter(staged: DemoStagedEncounter, maxTurns = 2000, sink?: EncounterReport[]): EncounterResult {
    const { battle, objective } = staged;
    // Balance telemetry, sampled each step (cheap; pushed to `sink` if given).
    const party = battle.units.filter((u) => u.side === "player");
    const maxTotal = party.reduce((s, u) => s + u.maxHp, 0) || 1;
    const hpPct = () => party.reduce((s, u) => s + Math.max(0, u.hp), 0) / maxTotal;
    const debuffs = () => party.reduce((s, u) => s + u.statuses.filter((st) => st.kind === "debuff").length, 0);
    let turns = 0;
    let lowest = hpPct();
    let debuffPeak = debuffs();

    let result: EncounterResult | undefined;
    for (let i = 0; i < maxTurns; i++) {
      lowest = Math.min(lowest, hpPct());
      debuffPeak = Math.max(debuffPeak, debuffs());
      if (objective.failed) {
        result = "objective-failure";
        break;
      }
      const o = battleOutcome(battle.units);
      if (o.over) {
        result = o.winner === "player" ? "win" : "wipe";
        break;
      }
      const actor = battle.nextActor();
      if (!actor) break;
      turns++;
      if (objective.failed) {
        result = "objective-failure";
        break;
      }
      const plan = planEnemyTurn(actor, battle.units, battle.grid, {
        isCharging: (u) => battle.clock.isCharging(u),
      });
      if (plan.path.length > 0) battle.moveUnit(actor, plan.path);
      if (plan.ability && plan.target?.alive) {
        battle.useSkill(actor, plan.ability, plan.target);
        continue;
      }
      if (plan.target?.alive) battle.attack(actor, plan.target);
      battle.endTurn(actor, { moved: plan.path.length > 0, acted: plan.target !== null });
    }
    const final = result ?? (objective.failed ? "objective-failure" : "wipe");
    sink?.push({
      encounter: staged.encounter.name,
      result: final,
      turns,
      endHpPct: hpPct(),
      lowestHpPct: lowest,
      downed: party.filter((u) => u.hp <= 0).length,
      foesLeft: battle.units.filter((u) => u.side === "enemy" && u.alive).length,
      debuffPeak,
    });
    return final;
  }

  /**
   * Resolve a finished encounter: apply graded failure (D43) and rewards. On a
   * win the reward (gold + items under the cap) lands; on win **or** objective-
   * failure the party retreats alive (downed members recovered to 1 HP); a wipe
   * is terminal.
   */
  resolveEncounter(staged: DemoStagedEncounter, result: EncounterResult): void {
    const enc = staged.encounter;
    if (result === "wipe") {
      this.outcome = "wipe";
      this.log.push(`${enc.name}: party wiped.`);
      return;
    }
    // Survivable: bring everyone home (downed → recovered, retreat alive).
    for (const u of this.party) {
      u.alive = true;
      if (u.hp <= 0) u.hp = 1;
    }
    if (result === "win") {
      this.gold += enc.reward.gold;
      for (const m of enc.reward.materials) addItem(this.inventory, m.id, m.count);
      this.log.push(`${enc.name}: cleared (+${enc.reward.gold}g).`);
    } else {
      this.log.push(`${enc.name}: objective failed — the party retreats alive.`);
      if (enc.id === E3_HOLDOUT.id) this.outcome = "failed"; // the holdout's cut = quest failure
    }
  }

  /** Beat 3 — Rest: full heal, the level-up payoff, and the deserter choice. */
  rest(choice: "spare" | "press"): StoryOutcome | undefined {
    const beat = this.currentBeat();
    if (beat?.kind !== "rest") throw new Error("rest: not a rest beat");
    for (const u of this.party) {
      this.freshen(u);
      u.hp = u.maxHp; // recovery
      routeCombatXp(u, beat.xp); // the marquee growth payoff → 2nd active unlocks
    }
    const outcome = beat.choice ? beat.choice[choice] : undefined;
    if (outcome) {
      if (outcome.gold) this.gold += outcome.gold;
      for (const it of outcome.items ?? []) addItem(this.inventory, it.id, it.count);
      if (outcome.revealAmbush) this.ambushRevealed = true;
      this.log.push(`Rest — ${choice}: ${outcome.summary}`);
    }
    return outcome;
  }

  /**
   * Play the whole quest headlessly with a simple policy (provision a balanced
   * herb load, spare the deserter, auto-resolve each fight). Returns the
   * terminal outcome. Used by tests + as the demo's fast-forward.
   */
  autoPlay(restChoice: "spare" | "press" = "spare", sink?: EncounterReport[]): "complete" | "failed" | "wipe" {
    while (this.beatIndex < this.quest.beats.length && !this.outcome) {
      const beat = this.currentBeat()!;
      if (beat.kind === "provision") {
        this.provision([
          { id: "salve", count: 2 },
          { id: "stimulant", count: 1 },
          { id: "antidote", count: 2 },
        ]);
      } else if (beat.kind === "rest") {
        this.rest(restChoice);
      } else {
        const staged = this.stageEncounter(beat);
        const result = this.autoResolveEncounter(staged, 2000, sink);
        this.resolveEncounter(staged, result);
      }
      this.advance();
    }
    if (!this.outcome) this.outcome = "complete";
    return this.outcome;
  }

  /** {@link autoPlay} plus per-encounter balance telemetry (see {@link RunReport}). */
  autoPlayReport(restChoice: "spare" | "press" = "spare"): RunReport {
    const encounters: EncounterReport[] = [];
    const outcome = this.autoPlay(restChoice, encounters);
    return { restChoice, outcome, encounters };
  }
}
