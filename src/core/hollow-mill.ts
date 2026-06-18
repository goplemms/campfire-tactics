/**
 * "The Hollow Mill" — the framework's first {@link AuthoredExpedition} (D44/D52).
 *
 * The M12 demo quest, **rebuilt as an authored expedition** so it plays inside the
 * real M13 routing economy through `OverworldScene → BattleScene` (M14). Where the
 * retired demo runner walked a linear beat list in its own renderer, the Hollow
 * Mill is now a hand-built {@link "./overworld".OverworldMap}
 * (a camp → three fights → a rest), `authoredId` on its combat nodes, a catalog of
 * {@link AuthoredEncounter}s, and a starting bundle — configured exactly like a
 * future campaign quest (D26) would be.
 *
 * The three fights keep their M12 shapes; E3's bridge-cut is the generalized
 * **closing-gate** objective (D50). The deserter spare/press branch (a cross-node
 * flag) is deferred — E2's ambush is plain **hidden-until-scouted** (D44 fog).
 *
 * Pure logic: no Phaser, no DOM, no `Math.random`.
 */

import type { UnitSpec } from "./units";
import { getJob, type JobId } from "./jobs";
import type { AuthoredEncounter } from "./authored";
import type { OverworldMap, MapNode } from "./overworld";
import { registerExpedition, type AuthoredExpedition } from "./expedition";

// --- The party (D44) — the cast on the combat-depth classes (D40) -----------

/** Build a party member from a job's baseline frame (D39). */
function member(id: string, name: string, jobId: JobId, extra: Partial<UnitSpec> = {}): UnitSpec {
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

/** The five Hollow Mill characters (Pip the Chef auto-Defends as a 5th body). */
export const HOLLOW_MILL_PARTY: UnitSpec[] = [
  member("edrin", "Edrin", "heavy-knight", { isLord: true }),
  member("rook", "Rook", "hunter"),
  // Vale is the party's eyes (D10): a high Intelligence floors intel at tier 2 —
  // the deploy edge is live, and a single Scout on E2 reaches tier 3 to blow its
  // hidden ambush. Without this the intel teeth would be unreachable on the short map.
  // Vale the Scout is the party's field-craft specialist (Survivalist subsumed):
  // high Intelligence/Awareness, plants and disarms snares, and her snares set up
  // Rook the Hunter's Deadeye. No dedicated trapper needed.
  member("vale", "Vale", "scout", { intelligence: 7, awareness: 4 }),
  member("sela", "Sela", "medic"),
  member("pip", "Pip", "chef", { standingOrder: "defend", maxHp: 22, attack: 5, defense: 2, moveRange: 3, speed: 8 }),
];

// --- The three fights (re-homed from the demo, on the D50 objectives) --------

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
  // The XP award is tuned so every survivor's primary job reaches L2 after E1 — the
  // 2nd-active unlock the rest beat used to grant (authoring, not a mechanics change).
  reward: { gold: 60, materials: [{ id: "salve", count: 1 }], xp: 100 },
};

/**
 * The Sapper's Snares — the trap-field set-piece (D12). A sapper has seeded the
 * approach with concealed traps; the party must cross them to reach the bandits.
 * Spot them with Awareness (or eat the damage), and let Bram the Survivalist
 * disarm the spotted ones to harvest their kits — which then feed her own snares at
 * the chokepoint (E2) and the holdout (E3), each Immobilizing prey for Rook's
 * Deadeye. The "why set traps" made felt.
 */
export const TRAP_FIELD: AuthoredEncounter = {
  id: "snares-trapfield",
  name: "The Sapper's Snares",
  cols: 9,
  rows: 6,
  blocked: [{ col: 4, row: 0 }, { col: 4, row: 5 }],
  playerSpawns: [
    { col: 0, row: 1 }, { col: 0, row: 2 }, { col: 0, row: 3 }, { col: 0, row: 4 }, { col: 1, row: 2 },
  ],
  enemies: [
    { templateId: "sapper", pos: { col: 8, row: 2 }, id: "field-sapper" }, // the trapper who laid them
    { templateId: "bandit-thug", pos: { col: 7, row: 1 } },
    { templateId: "bandit-thug", pos: { col: 7, row: 4 } },
    { templateId: "bandit-bowman", pos: { col: 8, row: 4 } },
  ],
  // Concealed across the mid-field the party must cross — a spread of easy and
  // well-hidden ones so Awareness (and a Search) genuinely matter.
  traps: [
    { pos: { col: 3, row: 1 }, concealment: 3 },
    { pos: { col: 4, row: 2 }, concealment: 4 },
    { pos: { col: 4, row: 3 }, concealment: 5 },
    { pos: { col: 5, row: 1 }, concealment: 4 },
    { pos: { col: 5, row: 4 }, concealment: 6 },
  ],
  // Modest purse + two visible kits; the real prize is the kits Bram harvests.
  reward: { gold: 70, materials: [{ id: "trap-kit", count: 2 }], xp: 60 },
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
    // The ambush — plain hidden-until-scouted (the deserter cross-node gate is deferred).
    { templateId: "bandit-cutthroat", pos: { col: 7, row: 5 }, hidden: true },
    { templateId: "bandit-cutthroat", pos: { col: 6, row: 5 }, hidden: true },
  ],
  reward: { gold: 80, materials: [{ id: "antidote", count: 1 }], xp: 60 },
};

/** E3 — The Captain's Holdout: the millrace bridge, a Sapper on an N-turn closing-gate. */
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
  reward: { gold: 150, materials: [{ id: "salve", count: 2 }], xp: 80 },
  // The bridge-cut, generalized (D50): a visible ~3-turn gauge sweeping the gap;
  // kill or Immobilize the Sapper (its tagged driver) to stop it.
  objectives: [
    {
      id: "bridge-cut",
      kind: "closing-gate",
      required: true,
      label: "The Sappers are cutting the bridge",
      speed: 4,
      span: [{ col: 4, row: 2 }],
      driver: { id: "sapper" },
    },
  ],
};

// --- The hand-built map (D52) -----------------------------------------------

function node(id: string, layer: number, kind: MapNode["kind"], edges: string[], authoredId?: string): MapNode {
  return { id, layer, index: 0, kind, edges, authoredId };
}

/** camp → E1 → snares → rest → E2 → E3(final). A linear authored arc on the real overworld. */
function hollowMillMap(): OverworldMap {
  const nodes: Record<string, MapNode> = {
    start: node("start", 0, "rest", ["e1"]), // the provisioning camp
    e1: node("e1", 1, "combat", ["snares"], E1_SKIRMISH.id),
    snares: node("snares", 2, "combat", ["rest"], TRAP_FIELD.id), // the trap-field (harvest kits here)
    rest: node("rest", 3, "rest", ["e2"]), // the grain-loft rest (recover + the level-up shows)
    e2: node("e2", 4, "combat", ["e3"], E2_AMBUSH.id),
    e3: node("e3", 5, "combat", [], E3_HOLDOUT.id), // the final holdout (closing-gate)
  };
  return {
    seed: "hollow-mill",
    layers: 6,
    nodes,
    startId: "start",
    finalIds: ["e3"],
    order: ["start", "e1", "snares", "rest", "e2", "e3"],
  };
}

/** The Hollow Mill, as a registered {@link AuthoredExpedition} (D52). */
export const THE_HOLLOW_MILL: AuthoredExpedition = registerExpedition({
  id: "hollow-mill",
  name: "The Hollow Mill",
  seed: "hollow-mill",
  map: hollowMillMap(),
  encounters: {
    [E1_SKIRMISH.id]: E1_SKIRMISH,
    [TRAP_FIELD.id]: TRAP_FIELD,
    [E2_AMBUSH.id]: E2_AMBUSH,
    [E3_HOLDOUT.id]: E3_HOLDOUT,
  },
  bundle: {
    party: HOLLOW_MILL_PARTY,
    purse: 120,
    supplies: { salve: 2, stimulant: 1, antidote: 2 },
    storageCap: 8,
    morale: 2,
    difficultyId: "normal",
  },
});
