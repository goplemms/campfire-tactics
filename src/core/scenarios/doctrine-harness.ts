/**
 * The **guard-doctrine harness** (D108, tag-system M2.5) — the smallest encounter that holds every
 * piece the finale guard doctrine needs, so the doctrine (M3) has a real fixture to drive and the
 * visual e2e (M4) has a real scene to render. Deliberately **not** the finale itself: the live finale
 * rework ("The Rescue", the v4 concentric prison) is a separate owner-directed track (D97–D99). This is
 * a *microcosm* — a single seal between two regions, the garrison on the near side, the front sealed off.
 *
 * The pieces:
 *  - a **keyed + lever seal** (Decision G — the same door the Warden *keys* open and the player's lever
 *    *re-locks*), the sole chokepoint between the control room (left) and the front (right);
 *  - the **Warden** — `bandit-captain`, `role: "captain"`, tagged **`garrison`**, the seal's **keyholder**;
 *  - a **garrison guard** — `bandit-thug`, tagged **`garrison`**;
 *  - **two spawns** — an infiltrator on the control-room side, the party at the front (the D99 two-mouth shape).
 *
 * **Not gallery-registered.** Exported as a bare {@link AuthoredEncounter} that M3's headless tests stage
 * directly; M4 wraps it in a `ScenarioConfig`, registers it in the `#scene` gallery, and adds the walker.
 *
 * Pure data — no import-time side effects.
 */

import type { AuthoredEncounter } from "../authored";
import type { JobId } from "../jobs";
import type { UnitSpec } from "../units";
import type { ScenarioConfig } from "../scenario";

/**
 * Layout (6×3), col-3 is the chokepoint (walls at rows 0/2, the seal at row 1):
 * ```
 *   0 1 2 3 4 5
 * 0 . L I # . .     L = lever(1,0)   I = infiltrator spawn(2,0)   # = wall
 * 1 G W . S . P     G = guard(0,1)   W = Warden(1,1)   S = keyed+lever seal(3,1)   P = party spawn(5,1)
 * 2 . . . # . .
 * ```
 * The control room is the left region (cols 0–2, with the lever + garrison); the front is the right
 * region (cols 4–5). While the seal is locked, col-3 fully separates them — the front is unreachable.
 */
export const DOCTRINE_HARNESS: AuthoredEncounter = {
  id: "doctrine-harness",
  name: "Guard Doctrine Harness",
  cols: 6,
  rows: 3,
  blocked: [
    { col: 3, row: 0 },
    { col: 3, row: 2 },
  ],
  // Infiltrator on the control-room side (near the lever); the party at the front, sealed off.
  playerSpawns: [
    { col: 2, row: 0 },
    { col: 5, row: 1 },
  ],
  enemies: [
    { templateId: "bandit-captain", pos: { col: 1, row: 1 }, id: "warden", role: "captain", overrides: { tags: ["garrison"] } },
    { templateId: "bandit-thug", pos: { col: 0, row: 1 }, id: "guard", overrides: { tags: ["garrison"] } },
  ],
  // The control-room seal: the Warden's key opens it (D108); the lever re-locks it (Decision G, same door).
  gates: [{ id: "seal", pos: { col: 3, row: 1 }, openBy: [{ kind: "keyholder", tag: { role: "captain" } }] }],
  levers: [{ id: "control", pos: { col: 1, row: 0 }, targets: ["seal"] }],
  // The control room = the left region (cols 0–2, with the lever + the infiltrator working it). A garrison
  // unit prioritizes foes inside it as attack targets (D117/M3b, Decision G — the lever-camp defuser).
  controlRoom: { cols: [0, 2], rows: [0, 2] },
  reward: { gold: 0, materials: [] },
};

const PARTY_STATS = { speed: 12, maxHp: 24, attack: 9, defense: 3, moveRange: 4, sightRadius: 5 };

/**
 * The two-mouth party (D99): the **infiltrator** deploys on the control-room side (spawn 0 → `(2,0)`),
 * the **anchor** at the front (spawn 1 → `(5,1)`) — `placeParty` maps party[i] → `playerSpawns[i]`, so the
 * infiltrator is authored first. The arm swaps the infiltrator's job (thief vs scout) exactly like the
 * `pick-the-cell` taste, giving the visual harness two distraction reads off one board.
 */
function partySpecs(infilJob: JobId): UnitSpec[] {
  return [
    { id: "infil", side: "player", pos: { col: 0, row: 0 }, jobId: infilJob, primaryJob: infilJob, ...PARTY_STATS },
    { id: "anchor", side: "player", pos: { col: 0, row: 0 }, jobId: "soldier", primaryJob: "soldier", ...PARTY_STATS },
  ];
}

/**
 * The bootable **`#scene=doctrine-harness`** config (D117/M4) — wraps {@link DOCTRINE_HARNESS} so the guard
 * doctrine renders in the real scene: the first render surface for the door-drive (the D92/#168
 * freeze-catcher doctrine — a scene-render exception on this new surface reads as a *freeze*, so
 * `scripts/e2e-doctrine.mjs` walks it). The config id is independent of the encounter id.
 */
export const DOCTRINE_HARNESS_SCENARIO: ScenarioConfig = {
  id: "doctrine-harness",
  name: "Guard Doctrine Harness",
  encounter: DOCTRINE_HARNESS,
  parties: {
    thief: partySpecs("thief"),
    scout: partySpecs("scout"),
  },
  defaultParty: "thief",
};
