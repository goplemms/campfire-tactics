/**
 * "The Hollow Mill" — the framework's first {@link AuthoredExpedition} (D44/D52),
 * **redesigned as a mechanics-teaching vertical slice** (the demo-expedition pass).
 *
 * The expedition is a layered DAG the player branches through. The slice runs from
 * **camp (L0) through the Layer-5 region** (Market hub + dug-in Wagon + Thieves' Den)
 * and reaches a **stub finale** so the run is completable. Layers 6–10 are NOT
 * designed and are NOT built here — the finale is a placeholder.
 *
 * Topology (locked):
 * ```
 *   L0 Camp ─► L1 Skirmish+Cook ─► L2 Traveler's-gift (storage discard) ─► L3 Sapper's Snares
 *      ─► L4 FORK { 4A Rest (no Medic) | 4B Prison Wagon (frees Medic) }
 *      ─► L5 Market (hub — Merchant) ─► L6 { dug-in Wagon (Medic catch-up), Den (relic) }
 *      ─► L7 stub finale
 *   edges: 4A→Market, 4B→{Market, Den}, Market→{dug-in Wagon, Den}, {Wagon,Den}→finale
 * ```
 *
 * Cast: starting trio Edrin/**Soldier** (lord) · Rook/**Hunter** · Vale/**Scout**.
 * Recruits join via their nodes (NOT the bundle): Pip the **Cook** is an **on-board
 * captive** at node 1 — freed by the rescue mechanic mid-fight or by the win (D52
 * captive-recruit) · Sela the **Medic** (4B or the dug-in Wagon) and Mira the **Merchant**
 * (Market event) still join via authored post-win grants.
 *
 * Pure logic: no Phaser, no DOM, no `Math.random`.
 */

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
 * Node 6 (offshoot) — Prison Wagon, SECURED (the Medic catch-up, via the Market). A
 * second rescue attempt against **alert, dug-in captors** (higher Awareness) who have
 * **laid their own snares** — you must spot/avoid enemy traps (inverting node 3). Frees
 * Sela on the win. INACCESSIBLE once the Medic is already held (the party-state gate;
 * see the map's conditional access — STUBBED, see report).
 */
export const SECURED_WAGON: AuthoredEncounter = {
  id: "secured-wagon",
  name: "The Prison Wagon, Secured",
  cols: 9,
  rows: 6,
  blocked: [{ col: 4, row: 0 }, { col: 4, row: 5 }],
  playerSpawns: [
    { col: 0, row: 1 }, { col: 0, row: 2 }, { col: 0, row: 3 }, { col: 0, row: 4 }, { col: 1, row: 2 },
  ],
  enemies: [
    // Higher-Awareness captors — they resist the scout's free read (the pre-combat edge
    // turned against you). A softened captain (the catch-up, not the finale) + a small
    // alert detail; the laid snares below are the real teeth.
    { templateId: "bandit-captain", pos: { col: 8, row: 2 }, id: "secured-captain", role: "captain", overrides: { maxHp: 34, attack: 10, defense: 3, awareness: 6 } },
    { templateId: "bandit-cutthroat", pos: { col: 7, row: 1 }, overrides: { awareness: 5 } },
    { templateId: "bandit-thug", pos: { col: 7, row: 4 }, overrides: { awareness: 4 } },
  ],
  // The info lane (D83): the inversion telegraphed — these captors expect a second try.
  rumors: [
    "The wagon never moved on — it dug in. Watchfires burn in pairs there now.",
    "Three captors hold it in alert shifts, and the ground on the approach has been worked over.",
    "No careless digging here — whoever laid these snares took their time. Nothing to mark from afar.",
  ],
  // The captors laid their own snares — spot/avoid ENEMY traps (the node-3 lesson inverted).
  // Concealment 5–6 sits ABOVE the D83 careless-mark cap: a tier-3 read marks NOTHING
  // here — the dug-in captors resist the scout's read, purely from the existing numbers.
  traps: [
    { pos: { col: 2, row: 2 }, concealment: 5, damage: 16 },
    { pos: { col: 3, row: 3 }, concealment: 6, damage: 18 },
    { pos: { col: 2, row: 4 }, concealment: 5, damage: 16 },
  ],
  reward: { gold: 140, materials: [{ id: "salve", count: 2 }], xp: 80 }, // slightly richer — it's harder
  grants: { recruit: SELA_MEDIC, flag: "medic-freed" },
};

/**
 * Node 6 (offshoot) — Thieves' Den (the relic offshoot). Thief enemies skim the purse
 * and bolt for the edge (per theft.ts + ENEMY_TEMPLATES.thief) — kill them to drop the
 * gold; let them escape and it's gone. On the win, the **relic** drops (placeholder
 * unique; effect TBD). Stealth in play.
 */
export const THIEVES_DEN: AuthoredEncounter = {
  id: "thieves-den",
  name: "The Thieves' Den",
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
  reward: { gold: 90, materials: [{ id: "valuables", count: 1 }], xp: 70 },
  // The build-defining relic (placeholder unique — effect TBD with the user).
  grants: { item: "relic-hollow-blade" },
};

/**
 * The stub finale (L7) — a placeholder so the run is completable. Layers 6–10 are NOT
 * designed; this is a minimal holdout fight, NOT the authored finale. Replace when those
 * layers are designed.
 */
export const STUB_FINALE: AuthoredEncounter = {
  id: "stub-finale",
  name: "The Mill (stub finale)",
  cols: 8,
  rows: 6,
  blocked: [{ col: 4, row: 2 }],
  playerSpawns: [
    { col: 0, row: 1 }, { col: 0, row: 2 }, { col: 0, row: 3 }, { col: 0, row: 4 }, { col: 1, row: 2 },
  ],
  enemies: [
    { templateId: "bandit-captain", pos: { col: 7, row: 2 }, id: "mill-captain", role: "captain" },
    { templateId: "bandit-thug", pos: { col: 6, row: 1 } },
    { templateId: "bandit-thug", pos: { col: 6, row: 4 } },
  ],
  reward: { gold: 150, materials: [{ id: "salve", count: 1 }], xp: 60 },
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
 * Author the locked topology (see the file header). The Den is reachable from both 4B
 * and the Market; a strict layer-DAG requires in-edges from `layer-1` only, so the Den
 * lives in L6 and 4B reaches it **through** the Market normalization — except the spec
 * wants a **direct** `4B→Den`. Since 4B is L4 and the Market is L5, a direct `4B→Den`
 * (Den in L6) would skip a layer; `validateExpedition` allows cross-layer edges (it
 * only checks edge targets exist + reachability), so the direct edge is authored as a
 * skip-edge. See report — this is a deviation the strict-DAG note in the design flagged.
 */
function hollowMillMap(): OverworldMap {
  const nodes: Record<string, MapNode> = {
    start: node("start", 0, "rest", ["e1"]), // L0 — the provisioning camp
    e1: node("e1", 1, "combat", ["camp2"], { authoredId: E1_SKIRMISH.id }), // L1 — Skirmish + Cook rescue
    camp2: node("camp2", 2, "event", ["snares"], { eventId: "provision-choice" }), // L2 — Camp on the Road (pick-one + Cook Stew)
    snares: node("snares", 3, "combat", ["rest4a", "wagon4b"], { authoredId: TRAP_FIELD.id }), // L3 — the trap-field → the FORK
    // L4 FORK
    rest4a: node("rest4a", 4, "rest", ["market"]), // 4A — Rest (no Medic)
    wagon4b: node("wagon4b", 4, "combat", ["market", "den"], { authoredId: PRISON_WAGON.id }), // 4B — Prison Wagon (frees Medic) → Market + Den
    // L5 hub
    market: node("market", 5, "event", ["securedWagon", "den"], { eventId: "merchant-town", market: "basic" }), // Market hub (Merchant)
    // L6 offshoots
    securedWagon: node("securedWagon", 6, "combat", ["finale"], { authoredId: SECURED_WAGON.id }), // dug-in Wagon (Medic catch-up)
    den: node("den", 6, "combat", ["finale"], { authoredId: THIEVES_DEN.id }), // Thieves' Den (relic)
    // L7 stub finale
    finale: node("finale", 7, "combat", [], { authoredId: STUB_FINALE.id }),
  };
  return {
    seed: "hollow-mill",
    layers: 8,
    nodes,
    startId: "start",
    finalIds: ["finale"],
    order: ["start", "e1", "camp2", "snares", "rest4a", "wagon4b", "market", "securedWagon", "den", "finale"],
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
    [SECURED_WAGON.id]: SECURED_WAGON,
    [THIEVES_DEN.id]: THIEVES_DEN,
    [STUB_FINALE.id]: STUB_FINALE,
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
