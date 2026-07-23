/**
 * "The Rescue" — the first expedition whose finale **body is injected, not inline** (D116).
 *
 * Where the Hollow Mill (D52) ships every encounter as a TS const in its own catalog, The
 * Rescue carries **no inline `encounters`**: its finale node binds `authoredId: "the-rescue"`
 * and the body is resolved from the shared **injected catalog** — content-authored JSON
 * (`content/levels/the-rescue.json`) handed into core at boot ({@link
 * "./authored-catalog".injectAuthoredNodes}). This is the concrete driving case for the
 * injection storage architecture: the topology stays **curated in TS** (D116 keeps
 * JSON-defined graphs deferred), while the node *bodies* live as one-file-each JSON.
 *
 * Topology — a minimal branching approach to the prison, enough to exercise the D116
 * **prerequisite** rule end to end:
 * ```
 *   start (camp) ─► sideDoor (scout the wall — provides "side-door-intel") ─┐
 *              └──► frontal (form up at the gate) ───────────────────────────┤
 *                                                                            ▼
 *                                                            finale — The Rescue
 *                                                       (requires "side-door-intel")
 * ```
 * The finale's **infiltration flank** *wants* the side-door intel; the load pipeline
 * validates that the `sideDoor` provider sits reachable **upstream on some path** (the
 * *opportunity*), never splicing one in (D98 anti-silent-overwrite). A player may still take
 * the `frontal` arm and skip it — so the finale must **degrade gracefully to frontal-only**
 * (it stays fully winnable by storming the garrison; the flank is a reward for scouting, not a
 * hard gate — D99). The runtime flag itself (set on visiting `sideDoor`, read at the finale's
 * deploy) is parked with the v4 finale population; this slice ships the **validated
 * opportunity** only. **This session sets/reads no `sideDoorIntel` flag** — so the finale
 * currently plays *identically* on both arms (the frontal win is the whole game); `provides`/
 * `requires` are validated-but-inert placement markers until the flank is populated. Wiring a
 * future `requires` node therefore does nothing until that flag is built — don't assume the
 * provider grants anything yet.
 *
 * NOTE: this is a **standalone** expedition — the shipped D97 arc finale (Hollow Mill's
 * `PRISON_ASSAULT`) is untouched. Promoting The Rescue into the arc is a later owner step.
 *
 * Pure logic: no Phaser, no DOM, no `Math.random`.
 */

import type { UnitSpec } from "./units";
import { getJob, type JobId } from "./jobs";
import type { OverworldMap, MapNode } from "./overworld";
import { registerExpedition, type AuthoredExpedition } from "./expedition";

/** The named prerequisite flag the finale's flank wants — one string, not a vocabulary (D116). */
export const SIDE_DOOR_INTEL = "side-door-intel";

/** The authored-node id the finale resolves from the injected catalog (the JSON body's `id`). */
export const RESCUE_FINALE_ID = "the-rescue";

/** Build a party member from a job's baseline frame (mirrors the Hollow Mill's `member`, D39). */
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
 * The rescue party — a Soldier front line, a Hunter's reach, a Scout's eyes, and a **Thief**.
 * The Thief makes the finale's `release: lockpick` cells pickable (the quiet extraction route);
 * a party without one still wins **frontally** (the graceful fallback), so the Thief is an
 * enabler of the flank, never a requirement of the win.
 */
export const RESCUE_PARTY: UnitSpec[] = [
  member("cinder", "Cinder", "soldier", { isLord: true }),
  member("thane", "Thane", "hunter"),
  member("lark", "Lark", "scout", { intelligence: 6, awareness: 5 }),
  member("nyx", "Nyx", "thief"),
];

function node(
  id: string,
  layer: number,
  kind: MapNode["kind"],
  edges: string[],
  opts: { authoredId?: string; provides?: string; requires?: string } = {},
): MapNode {
  return { id, layer, index: 0, kind, edges, authoredId: opts.authoredId, provides: opts.provides, requires: opts.requires };
}

/** The curated Rescue DAG — camp → (scout the wall | form up) → the prison. */
function theRescueMap(): OverworldMap {
  const nodes: Record<string, MapNode> = {
    start: node("start", 0, "rest", ["sideDoor", "frontal"]),
    // The scouting beat that yields the side-door intel — the finale's flank prerequisite.
    sideDoor: node("sideDoor", 1, "rest", ["finale"], { provides: SIDE_DOOR_INTEL }),
    // The frontal approach — no intel; committing here skips the flank (graceful fallback).
    frontal: node("frontal", 1, "rest", ["finale"]),
    // The prison itself — body injected from content JSON; its flank *wants* the intel.
    finale: node("finale", 2, "combat", [], { authoredId: RESCUE_FINALE_ID, requires: SIDE_DOOR_INTEL }),
  };
  return {
    seed: "the-rescue",
    layers: 3,
    nodes,
    startId: "start",
    finalIds: ["finale"],
    order: ["start", "sideDoor", "frontal", "finale"],
  };
}

/**
 * The Rescue, as a registered {@link AuthoredExpedition} (D116). **No inline `encounters`** —
 * the finale resolves from the injected catalog. Registration here only *stores the topology*;
 * the fail-loud resolve/validate happens later via {@link "./expedition".loadExpedition} at
 * boot (after content has injected its bodies) and in the CI guard — never at import, so core
 * stays pure and import-order-independent.
 */
export const THE_RESCUE: AuthoredExpedition = registerExpedition({
  id: "the-rescue-expedition",
  name: "The Rescue",
  seed: "the-rescue",
  map: theRescueMap(),
  bundle: {
    party: RESCUE_PARTY,
    purse: 140,
    supplies: { salve: 2, stimulant: 1, antidote: 1 },
    storageCap: 6,
    morale: 2,
    difficultyId: "normal",
  },
});
