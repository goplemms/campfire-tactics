/**
 * "The Hollow Mill" — the framework's first {@link AuthoredExpedition} (D44/D52),
 * **redesigned as a mechanics-teaching vertical slice** (the demo-expedition pass).
 *
 * The expedition is a layered DAG the player branches through. **Wave-0 topology (D#/#168):**
 * the shared spine runs camp → Skirmish → Traveler's-gift → Snares → the **pre-fork Market**
 * (the universal market mechanic introduced route-neutrally), then a **topology-exclusive fork**
 * — a genuine either/or the map (not an assertion) enforces (arc-plan **C8**): the two arms
 * share no nodes and reconverge **only** at the terminal finale, so committing to one makes the
 * other unreachable. The finale is **The Prison Assault** (D97/#169) — a **dual-OR** win (storm
 * the garrison OR pick the cells and extract the prisoners), the arms' investment cashing out.
 *
 * Topology:
 * ```
 *   L0 Camp ─► L1 Skirmish+Cook ─► L2 Traveler's-gift ─► L3 Snares ─► L4 Market (Merchant + market)
 *      ─► FORK
 *         Sustain:       L5 Prison Wagon (frees the Medic) ─► L6 Rest ───────────────────┐
 *         Infiltration:  L5 Guild-contact (C7 beat-1) ─► L6 Den (relic) ─► L7 Outer Yard  │
 *                          ─► L8 Guild-rite (C7 beat-2 → Thief) ─► L9 Cuffed Cell (D90) ──┤
 *      ─► L10 Prison Assault (dual-OR finale, D97) ◄────────────────────────────────────┘
 * ```
 * The **infiltration arm** carries the C3 job-XP fights (Den + Outer Yard tuned so guaranteed
 * objective-XP clears the Scout to the prestige floor by the rite) and the D90 lockpick cell
 * (the taste's first live home). The **sustain arm** frees Sela the Medic — no catch-up on the
 * other arm (skipping her is a real consequence, C8).
 *
 * Cast: starting trio Edrin/**Soldier** (lord) · Rook/**Hunter** · Vale/**Scout**.
 * Recruits join via their nodes (NOT the bundle): Pip the **Cook** is an **on-board captive** at
 * node 1 (freed mid-fight or by the win, D52) · Sela the **Medic** (the Wagon, sustain arm) and
 * Mira the **Merchant** (the pre-fork Market) join via authored post-win grants; the Cuffed Cell's
 * bound prisoner joins on the win (D90/D52 recruit-on-win).
 *
 * Pure logic: no Phaser, no DOM, no `Math.random`.
 */

import type { GridCoord } from "./iso";
import type { UnitSpec } from "./units";
import { getJob, type JobId } from "./jobs";
import type { AuthoredEncounter } from "./authored";
import type { OverworldMap, MapNode } from "./overworld";
import { registerExpedition, type AuthoredExpedition } from "./expedition";

// --- The cast (D52) — trio on the field; recruits join via their nodes ------

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

/**
 * The **starting trio** (D52) — Soldier-only front line. The party visibly has no
 * healer and no support, which motivates the Cook/Medic/Merchant recruits across the
 * run. Recruits are NOT in this bundle; they join via authored post-win grants.
 */
export const HOLLOW_MILL_PARTY: UnitSpec[] = [
  member("edrin", "Edrin", "soldier", { isLord: true }),
  member("rook", "Rook", "hunter"),
  // Vale the Scout is the party's eyes + field-craft (D10): high Intelligence floors
  // intel at tier 2 (the deploy edge is live, and a single Scout reaches tier 3 to
  // blow a hidden ambush); high Awareness spots the node-3 concealed snares.
  member("vale", "Vale", "scout", { intelligence: 7, awareness: 5 }),
];

// --- Recruit specs (granted on the win at their node, not in the bundle) -----

/**
 * Pip the Cook — the **on-board captive** at node 1 (E1_SKIRMISH.captives): freed by the
 * rescue mechanic mid-fight (then controllable) or recruited on the win. Introduces the
 * camp economy (Cook Stew/RP).
 */
export const PIP_COOK: UnitSpec = member("pip", "Pip", "cook", {
  standingOrder: "defend",
});

/** Sela the Medic — freed at 4B (or the dug-in Wagon); introduces sustain (Heal/cleanse). */
export const SELA_MEDIC: UnitSpec = member("sela", "Sela", "medic");

/** Mira the Merchant — recruited at the Market; introduces markets (presence/Find Trade). */
export const MIRA_MERCHANT: UnitSpec = member("mira", "Mira", "merchant");

// --- The encounters (authored.ts shapes) ------------------------------------

/**
 * Node 1 — Skirmish at the Mill Yard. The first fight (no-healer trio, winnable raw),
 * doubling as the **Cook rescue**, taught as one shape: Pip starts **on the board as a
 * bound captive** in the far corner, guarded by a cutthroat captor placed **apart** from
 * the main cluster — so the flank affordance and the rescue affordance are *the same
 * corner* ("isolating the captor IS the rescue"). The player frees Pip mid-fight with the
 * existing capture/rescue mechanic (reach him, then Free) and he becomes a controllable
 * party unit for the rest of the fight; winning the node frees/recruits him even if never
 * reached (the captors fall). He joins permanently. Teaches C1 CT clock + C2 flank/isolation.
 *
 * **L1 tuning is preserved:** the fight stays winnable **raw by the no-healer trio**
 * without freeing Pip — a bound (or freed-then-downed) Pip is a bonus, never a requirement,
 * and never makes the node unwinnable (a captive is off the clock and not a target; the win
 * check counts only active fighters).
 */
export const E1_SKIRMISH: AuthoredEncounter = {
  id: "e1-skirmish",
  name: "Skirmish at the Mill Yard",
  cols: 8,
  rows: 6,
  blocked: [{ col: 4, row: 1 }, { col: 4, row: 4 }],
  playerSpawns: [
    { col: 0, row: 1 }, { col: 0, row: 2 }, { col: 0, row: 3 }, { col: 0, row: 4 }, { col: 1, row: 2 },
  ],
  // Fight #1 — winnable raw by the no-healer trio (D52). The main cluster is two
  // bodies; the captor sits apart (the flank + rescue corner), so the player can
  // isolate and gang up rather than face all four at once.
  enemies: [
    { templateId: "bandit-thug", pos: { col: 6, row: 2 } },
    { templateId: "bandit-bowman", pos: { col: 7, row: 4 } },
    { templateId: "bandit-cutthroat", pos: { col: 7, row: 0 } }, // apart — the captor guarding Pip (flank + rescue)
  ],
  // Pip the Cook, bound in the corner beside his captor (col 7,row 0): reaching/rescuing
  // him IS the flank. Freed mid-fight he's controllable; won, he's recruited (see resolve).
  captives: [{ spec: PIP_COOK, pos: { col: 7, row: 1 } }],
  // XP tuned so every survivor's primary job reaches L2 after E1 (the 2nd-active unlock).
  reward: { gold: 60, materials: [{ id: "salve", count: 1 }], xp: 100 },
};

/**
 * Node 3 — The Sapper's Snares (trap-field). A **strong-field / weak-enemy** encounter
 * (D52): one lone bandit, but very strong concealed snares — the threat is the terrain.
 * Win or lose in the **pre-combat setup**: spot the strong traps (Vale's Awareness) and
 * position so the lone enemy is fought on your terms. Unsprung snares **sweep to the
 * stash on the win while a trap-trained survivor stands** (D82) — keep Vale on her feet
 * and the field pays out; lose her and the kits stay in the dirt.
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
  // LOCKED: one relatively weak enemy — the strong snares are the real encounter.
  // He HOLDS his post (D81) — the field's sapper oversees his snares rather than
  // charging across them, so the party must cross the trap-field to win — and he's
  // SKITTISH (D84): the first melee blow breaks him into flight, and his post is
  // the east edge, so the deserter bolts off-map — the exit ends the fight as a
  // player win (no kill, no kill credit; the field still sweeps, D82).
  enemies: [
    { templateId: "bandit-thug", pos: { col: 8, row: 2 }, id: "lone-straggler", overrides: { standingOrder: "hold-skittish" } },
  ],
  // The info lane (D83) — one rumor line per intel tier ("folk say…" → sharper hearsay).
  rumors: [
    "Folk around here say a deserter from the mill garrison has gone to ground past the cut — and that carts stopped coming back.",
    "A carter swears he watched the sapper dig along the narrows five separate times before slipping away.",
    "He worked hurriedly near the old wagon rut — a careful survey should spot the sloppiest of it.",
  ],
  // Very strong, concealed, mid-field traps the party must cross — high damage so
  // eating an unspotted one really stings (no Medic yet). Spot-and-avoid (no disarm req).
  traps: [
    { pos: { col: 3, row: 1 }, concealment: 4, damage: 22 },
    { pos: { col: 4, row: 2 }, concealment: 5, damage: 24 },
    { pos: { col: 4, row: 3 }, concealment: 5, damage: 24 },
    { pos: { col: 5, row: 1 }, concealment: 5, damage: 22 },
    { pos: { col: 5, row: 4 }, concealment: 6, damage: 26 },
  ],
  // Modest purse; unsprung snares sweep on the win via a standing trap-trained
  // survivor (D82) — the field itself is the real reward.
  reward: { gold: 70, materials: [{ id: "trap-kit", count: 1 }], xp: 70 },
};

/**
 * Node 4B — Prison Wagon (the hard road). A tougher **slaver escort** fought before you
 * have a healer (tense by design); on the win, **Sela the Medic** is freed (the gated
 * recruit). High risk, high reward — the elite combat tier.
 */
export const PRISON_WAGON: AuthoredEncounter = {
  id: "prison-wagon",
  name: "The Prison Wagon",
  cols: 9,
  rows: 6,
  blocked: [{ col: 4, row: 2 }, { col: 4, row: 3 }],
  playerSpawns: [
    { col: 0, row: 1 }, { col: 0, row: 2 }, { col: 0, row: 3 }, { col: 0, row: 4 }, { col: 1, row: 2 },
  ],
  enemies: [
    // The elite escort — a slaver lieutenant (a softened captain: the *introduction*
    // to the elite tier, not the finale brawler) + a small detail. Tougher than the
    // road bandits, tense without a healer, but winnable raw.
    { templateId: "bandit-captain", pos: { col: 8, row: 2 }, id: "slaver-lieutenant", role: "captain", overrides: { maxHp: 34, attack: 10, defense: 3 } },
    { templateId: "bandit-cutthroat", pos: { col: 7, row: 1 } },
    { templateId: "bandit-thug", pos: { col: 7, row: 4 } },
    { templateId: "bandit-bowman", pos: { col: 8, row: 4 } },
  ],
  reward: { gold: 120, materials: [{ id: "salve", count: 2 }], xp: 80 },
  // Free the captured medic + set the run flag the conditional map access reads.
  grants: { recruit: SELA_MEDIC, flag: "medic-freed" },
};

/**
 * L7 (infiltration arm) — **The Outer Yard**. The prison's mined, watched approach: an
 * **alert garrison** that has **laid its own snares** (spot/avoid ENEMY traps — the node-3
 * lesson inverted; the Thief's Expert Lockpick can disarm the spotted ones). The arm's
 * **second C3 fight** — its guaranteed objective-XP, with the Den's, clears a fielded Scout
 * to the prestige floor (L5) by the Guild's Rite that follows. Concealment 5–6 sits ABOVE
 * the D83 careless-mark cap, so a distant read marks NOTHING — the dug-in garrison resists
 * the scout's read, purely from the existing numbers (the intel-lane fixture, D83/D86).
 */
export const OUTER_YARD: AuthoredEncounter = {
  id: "outer-yard",
  name: "The Outer Yard",
  cols: 9,
  rows: 6,
  blocked: [{ col: 4, row: 0 }, { col: 4, row: 5 }],
  playerSpawns: [
    { col: 0, row: 1 }, { col: 0, row: 2 }, { col: 0, row: 3 }, { col: 0, row: 4 }, { col: 1, row: 2 },
  ],
  enemies: [
    // The garrison of the outer wall — a watch-sergeant (softened captain, not the finale
    // brawler) + an alert detail. The laid snares below are the real teeth.
    { templateId: "bandit-captain", pos: { col: 8, row: 2 }, id: "yard-sergeant", role: "captain", overrides: { maxHp: 34, attack: 10, defense: 3, awareness: 6 } },
    { templateId: "bandit-cutthroat", pos: { col: 7, row: 1 }, overrides: { awareness: 5 } },
    { templateId: "bandit-thug", pos: { col: 7, row: 4 }, overrides: { awareness: 4 } },
  ],
  // The info lane (D83): the mined approach telegraphed — the garrison expects company.
  rumors: [
    "The outer yard bristles — watchfires burn in pairs, and the ground before the wall has been worked over.",
    "A full watch holds the yard in alert shifts; the approach is seeded with something.",
    "No careless digging here — whoever laid these snares took their time. Nothing to mark from afar.",
  ],
  // The garrison laid its own snares — spot/avoid ENEMY traps (the node-3 lesson inverted).
  // Concealment 5–6 is ABOVE the D83 careless-mark cap: a tier-3 read marks NOTHING here.
  traps: [
    { pos: { col: 2, row: 2 }, concealment: 5, damage: 16 },
    { pos: { col: 3, row: 3 }, concealment: 6, damage: 18 },
    { pos: { col: 2, row: 4 }, concealment: 5, damage: 16 },
  ],
  // reward.xp with the Den's clears the C3 pacing budget (see the pacing-guard test).
  reward: { gold: 100, materials: [{ id: "salve", count: 1 }], xp: 100 },
};

/**
 * The **Cuffed Cell**'s bound prisoner (D90 / D52) — a sturdy fellow-captive only a Thief's
 * Expert Lockpick can free (`release: lockpick`). Deliberately a capable body deep in enemy
 * ground: freed early by the Thief it's a real **mid-fight tempo** swing (the Thief's edge —
 * the recruit-on-win itself is capability-blind, so a frontal party still gets the body on
 * the win, D52). Placeholder identity — a JIT content detail.
 */
const CAPTIVE_PRISONER: UnitSpec = member("cell-prisoner", "Bound Prisoner", "soldier", {
  standingOrder: "defend",
});

/**
 * L9 (infiltration arm) — **The Cuffed Cell**. The lean infiltration taste's (**D90**) first
 * **live home**: a **cuffed** prisoner behind the cell guard that only the Thief's Expert
 * Lockpick can pick free at deploy — a body carried into the fight deep in enemy ground. The
 * fresh Thief (prestiged at the Guild's Rite one node back) picks the cell; a non-Thief party
 * runs it **frontally** (the pick is refused as an unlogged no-op, C4) and still recruits the
 * prisoner on the win (recruit-on-win is capability-blind, D52). Win stays **eliminate-all** —
 * the freed body is a **bonus**, not a win condition (no parked extraction / any-of, C1/C2).
 */
export const CUFFED_CELL: AuthoredEncounter = {
  id: "cuffed-cell",
  name: "The Cuffed Cell",
  cols: 8,
  rows: 6,
  blocked: [{ col: 4, row: 2 }],
  playerSpawns: [
    { col: 0, row: 1 }, { col: 0, row: 2 }, { col: 0, row: 3 }, { col: 0, row: 4 }, { col: 1, row: 2 },
  ],
  enemies: [
    { templateId: "bandit-thug", pos: { col: 5, row: 2 } },
    { templateId: "bandit-bowman", pos: { col: 6, row: 4 } },
    { templateId: "bandit-cutthroat", pos: { col: 7, row: 0 } }, // the cell guard, in the corner
  ],
  // The cuffed prisoner (col 7,row 1), beside the corner guard — the pick + rescue affordance
  // are the same corner. `release: lockpick` gates the mid-fight free to an Expert Lockpick.
  captives: [{ spec: CAPTIVE_PRISONER, pos: { col: 7, row: 1 }, release: { kind: "lockpick" } }],
  reward: { gold: 80, materials: [{ id: "salve", count: 1 }], xp: 70 },
};

/**
 * Node 6 (offshoot) — Thieves' Den (the relic offshoot). Thief enemies skim the purse
 * and bolt for the edge (per theft.ts + ENEMY_TEMPLATES.thief) — kill them to drop the
 * gold; let them escape and it's gone. On the win, the **relic** drops (placeholder
 * unique; effect TBD). Stealth in play.
 *
 * **Shallow intel (D86): `intelDepth: 2`.** A hidden hideout resists a distant read —
 * you can learn *what* lurks and *how many*, but never *where* they'll spring from
 * (no tier-3 positions / starting vision). The first authored use of per-node depth:
 * you deploy into the den half-blind, sharpening the chase-the-thief tension.
 */
export const THIEVES_DEN: AuthoredEncounter = {
  id: "thieves-den",
  name: "The Thieves' Den",
  intelDepth: 2,
  cols: 9,
  rows: 6,
  blocked: [{ col: 3, row: 0 }, { col: 5, row: 5 }, { col: 6, row: 2 }],
  playerSpawns: [
    { col: 0, row: 1 }, { col: 0, row: 2 }, { col: 0, row: 3 }, { col: 0, row: 4 }, { col: 1, row: 2 },
  ],
  enemies: [
    // Thieves skim the purse and bolt — the chase-the-thief tension (theft.ts).
    { templateId: "thief", pos: { col: 7, row: 1 } },
    { templateId: "thief", pos: { col: 7, row: 4 } },
    { templateId: "bandit-cutthroat", pos: { col: 8, row: 2 } },
    { templateId: "bandit-thug", pos: { col: 8, row: 3 } },
  ],
  // reward.xp bumped (70→110) for the C3 pacing budget: Den + Outer Yard's guaranteed
  // objective-XP must clear a fielded Scout to the prestige floor (L5) by the Guild's Rite
  // (see the pacing-guard in hollow-mill.test.ts). The uncontested objXp does the work; the
  // combat kill/hit tally is only margin.
  reward: { gold: 90, materials: [{ id: "valuables", count: 1 }], xp: 110 },
  // The build-defining relic (placeholder unique — effect TBD with the user).
  grants: { item: "relic-hollow-blade" },
};

/**
 * The finale's **cell prisoners** (D97) — the liberation objective's escortees. Each is a
 * `release: lockpick` captive (only the Thief picks the cells) tagged `role: "prisoner"` so
 * the `extraction` objective binds to them. Placeholder identities — a JIT content detail.
 */
const CELL_PRISONER_A: UnitSpec = member("prisoner-a", "Gaunt Prisoner", "soldier", {
  role: "prisoner",
  standingOrder: "defend",
});
const CELL_PRISONER_B: UnitSpec = member("prisoner-b", "Shackled Prisoner", "soldier", {
  role: "prisoner",
  standingOrder: "defend",
});

/**
 * The finale **exit span** (D97) — the left/home edge the freed prisoners must be escorted
 * back to. The party deploys here (the way in *is* the way out); the extraction goal is met
 * only when every freed prisoner stands on one of these tiles.
 */
const FINALE_EXIT: GridCoord[] = [
  { col: 0, row: 0 }, { col: 0, row: 1 }, { col: 0, row: 2 },
  { col: 0, row: 3 }, { col: 0, row: 4 }, { col: 0, row: 5 },
];

/**
 * L10 — **The Prison Assault** (D97): the finale both arms converge on. "Liberate the prison"
 * is a genuine **either/or** win (C2), the arms' divergent investment finally cashing out:
 *
 * - **Frontal (any party)** — storm the fortified garrison (`eliminate-all`). The default any
 *   party can always take; the softened road captains (Wagon / Outer Yard) were the *warm-ups*,
 *   this is the real brawler at template strength.
 * - **Extraction (Thief party)** — pick the cells (`release: lockpick`, Thief-only) and **escort
 *   the freed prisoners to the exit** ({@link FINALE_EXIT}). A win *without* clearing the
 *   garrison — the deployment-pillar headline: the freed body deep in enemy ground, walked out.
 *
 * The two goals are **OR'd** by {@link "./staging".encounterOutcome} — either wins. A non-Thief
 * party simply can't open the cells, so extraction stays pending and it wins frontally (C4). The
 * prisoners recruit on the win either way (recruit-on-win is capability-blind, D52) — you free
 * them whichever path you take; extraction is the *harder, quieter* route to the same liberation.
 */
export const PRISON_ASSAULT: AuthoredEncounter = {
  id: "prison-assault",
  name: "The Prison Assault",
  cols: 9,
  rows: 6,
  // Interior walls — cell blocks the party threads on the way in (and the prisoners on the way out).
  blocked: [{ col: 4, row: 2 }, { col: 4, row: 3 }, { col: 6, row: 0 }, { col: 6, row: 5 }],
  playerSpawns: [
    { col: 0, row: 1 }, { col: 0, row: 2 }, { col: 0, row: 3 }, { col: 0, row: 4 }, { col: 1, row: 2 },
  ],
  enemies: [
    // The prison garrison — the finale brawler (the warden, full-strength captain) + the watch.
    { templateId: "bandit-captain", pos: { col: 8, row: 2 }, id: "prison-warden", role: "captain" },
    { templateId: "bandit-bowman", pos: { col: 8, row: 4 } },
    { templateId: "bandit-thug", pos: { col: 7, row: 1 } },
    { templateId: "bandit-thug", pos: { col: 7, row: 4 } },
    { templateId: "bandit-cutthroat", pos: { col: 7, row: 3 } },
  ],
  // Two cells in the far corners — `release: lockpick` (Thief-only), tagged for the extraction goal.
  captives: [
    { spec: CELL_PRISONER_A, pos: { col: 8, row: 0 }, release: { kind: "lockpick" } },
    { spec: CELL_PRISONER_B, pos: { col: 8, row: 5 }, release: { kind: "lockpick" } },
  ],
  rumors: [
    "They say the mill's heart is a gaol — the vanished carters are penned behind the garrison wall.",
    "Two cells still hold the living. The warden keeps the keys, and the watch never fully sleeps.",
    "The locks are old prison iron — no brute-forcing them; only a picked tumbler opens a cell quietly.",
  ],
  // The two win-paths (D97): storm the garrison OR free the cells and walk the prisoners out.
  objectives: [
    { id: "storm-garrison", kind: "eliminate-all", required: true, label: "Storm the prison — defeat the garrison" },
    {
      id: "liberate-prisoners",
      kind: "extraction",
      required: true,
      label: "Free the prisoners and escort them to the exit",
      span: FINALE_EXIT,
      escort: { role: "prisoner" },
    },
  ],
  reward: { gold: 200, materials: [{ id: "salve", count: 2 }], xp: 90 },
};

// --- The hand-built map (D52) — the layered DAG -----------------------------

function node(
  id: string,
  layer: number,
  kind: MapNode["kind"],
  edges: string[],
  opts: { authoredId?: string; eventId?: string; market?: MapNode["market"] } = {},
): MapNode {
  return { id, layer, index: 0, kind, edges, authoredId: opts.authoredId, eventId: opts.eventId, market: opts.market };
}

/**
 * Author the **Wave-0 topology** (see the file header). Past the shared pre-fork Market the map
 * splits into two arms that share **no** node or edge and reconverge **only** at the terminal
 * `finale` — so, with forward-only movement (`chooseNode` never backtracks), committing to one
 * arm makes the other unreachable. That is **C8 exclusivity enforced by topology, not asserted**
 * (a reachability test pins it). Arm lengths differ (rule 1 — routes need not be balanced, only
 * worth taking): the shorter sustain arm reaches `finale` via a skip-edge, which
 * `validateExpedition` allows (it checks edge targets + reachability, not strict `layer+1`).
 */
function hollowMillMap(): OverworldMap {
  const nodes: Record<string, MapNode> = {
    start: node("start", 0, "rest", ["e1"]), // L0 — the provisioning camp
    e1: node("e1", 1, "combat", ["camp2"], { authoredId: E1_SKIRMISH.id }), // L1 — Skirmish + Cook rescue
    camp2: node("camp2", 2, "event", ["snares"], { eventId: "provision-choice" }), // L2 — Traveler's gift (storage discard)
    snares: node("snares", 3, "combat", ["market"], { authoredId: TRAP_FIELD.id }), // L3 — the trap-field
    // L4 — the pre-fork Market: introduces the universal market mechanic route-neutrally
    // (both arms shop once; Mira recruits here), then the FORK. Infiltration is listed first so
    // the naive-bot robustness net (sim) walks the headline arm and proves it completes.
    market: node("market", 4, "event", ["guildContact", "wagon"], { eventId: "merchant-town", market: "basic" }),
    // --- Sustain arm (Medic) — no infiltration content; no Medic catch-up on the other arm (C8) ---
    wagon: node("wagon", 5, "combat", ["restCamp"], { authoredId: PRISON_WAGON.id }), // frees Sela the Medic
    restCamp: node("restCamp", 6, "rest", ["finale"]), // a breather before the finale
    // --- Infiltration arm (Thief) — the C7 mentor two-beat, the C3 fights, and the D90 cell ---
    guildContact: node("guildContact", 5, "event", ["den"], { eventId: "guild-contact" }), // C7 beat-1 (arm early)
    den: node("den", 6, "combat", ["outerYard"], { authoredId: THIEVES_DEN.id }), // C3 fight #1 (relic)
    outerYard: node("outerYard", 7, "combat", ["guildRite"], { authoredId: OUTER_YARD.id }), // C3 fight #2
    guildRite: node("guildRite", 8, "event", ["cuffedCell"], { eventId: "guild-rite" }), // C7 beat-2 (fire → Thief)
    cuffedCell: node("cuffedCell", 9, "combat", ["finale"], { authoredId: CUFFED_CELL.id }), // D90 taste's live home
    // L10 — The Prison Assault: the terminal finale both arms converge on, with the
    // dual-OR win (storm the garrison OR extract the prisoners), D97.
    finale: node("finale", 10, "combat", [], { authoredId: PRISON_ASSAULT.id }),
  };
  return {
    seed: "hollow-mill",
    layers: 11,
    nodes,
    startId: "start",
    finalIds: ["finale"],
    order: ["start", "e1", "camp2", "snares", "market", "wagon", "restCamp", "guildContact", "den", "outerYard", "guildRite", "cuffedCell", "finale"],
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
    [PRISON_WAGON.id]: PRISON_WAGON,
    [THIEVES_DEN.id]: THIEVES_DEN,
    [OUTER_YARD.id]: OUTER_YARD,
    [CUFFED_CELL.id]: CUFFED_CELL,
    [PRISON_ASSAULT.id]: PRISON_ASSAULT,
  },
  bundle: {
    party: HOLLOW_MILL_PARTY,
    purse: 120,
    supplies: { salve: 2, stimulant: 1, antidote: 2, "trap-kit": 2 },
    // A **deliberately full** stash (D79): the 5 starting supplies (salve+stimulant+antidote
    // each pack to 1 slot; the 2 trap-kits cost 2) fill the cap **exactly**, so storage is felt
    // from the first step. The Node-2 traveler then *gifts* trap-kits + iron-weapons (a grant that
    // always lands over the cap, D75/D78), forcing the **discard** lesson at Break Camp — whether
    // or not the player spent traps at Node 1 (using them only frees slots; the 3-slot gift still
    // overflows). Tuned tight on purpose; the run-wide squeeze is the storage through-line.
    storageCap: 5,
    morale: 2,
    difficultyId: "normal",
  },
});
