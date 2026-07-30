/**
 * **What the launcher boots (step 3 of the playtest launcher).**
 *
 * One descriptor covering the three things worth reaching — the draft you are editing, a shipped
 * `content/levels/` level, or an **expedition node** — and one resolver that turns it into
 * something launchable, **failing loud** on anything unreachable.
 *
 * ## The draft/content shape clash, and why this is a sibling rather than a draft field
 *
 * The editor is DRAFT-shaped and the launcher is CONTENT-shaped: soft play boots *the draft you
 * are editing*, while the launcher must also boot shipped levels and positioned runs. Rather than
 * grow `EditorDraft` a "launch target" field, {@link LaunchTarget} is a **sibling** value that
 * names the draft as one option among several and carries **no draft data at all** — the caller
 * hands the converted encounter in via {@link ResolveOpts.draftEncounter}. So this module never
 * imports `EditorDraft`, never reads editor state, and is testable headlessly; the draft stays the
 * editor's business and the target stays the launcher's.
 *
 * ## Two launch shapes, not one
 *
 * A draft and a level are **encounters** — there is no run, so `run.flags` is whatever the
 * launcher synthesises (see `run-flags.ts`). An expedition node is a **positioned run**: it has
 * real state, earned along a route. They cannot collapse into one shape, hence the
 * {@link ResolvedTarget} union.
 *
 * ⚠️ **For a node, the ROUTE is itself a flag lever — and the obvious route is the unreliable
 * one.** `traverseRoute` *auto-plays* every predecessor. On The Rescue, `[start, sideDoor, finale]`
 * earns `side-door-intel` only if the auto-pilot **wins** the wall-patrol fight, while
 * `[start, frontal, finale]` crosses a `rest` node and earns nothing. So the route that looks
 * canonical is the one whose outcome is a coin toss. {@link preferredRoute} therefore defaults to
 * the route with the **fewest auto-played combats** — the reproducible one — and the launcher
 * forces the flags it wants on top. Reaching a state is the tool's job; re-earning it is not.
 *
 * Thin glue over the pure core: no Phaser, no DOM, no rules of its own.
 */

import {
  enumeratePaths,
  getExpedition,
  getNode,
  resolveAuthored,
  type AuthoredEncounter,
  type AuthoredExpedition,
  type OverworldMap,
} from "../core";
import { getLevel, listLevels, validateLevel } from "../content/levels";

/** What to boot. A **descriptor** — plain, serialisable, and holding no draft or run state. */
export type LaunchTarget =
  /** The draft currently open in the editor; its encounter is supplied at resolve time. */
  | { kind: "draft" }
  /** A shipped `content/levels/` level, by id. */
  | { kind: "level"; levelId: string }
  /**
   * A node of a registered expedition. `route` pins the walk when given; omitted ⇒
   * {@link preferredRoute} picks the most reproducible one.
   */
  | { kind: "node"; expeditionId: string; nodeId: string; route?: string[] };

/** A resolved, launchable target — an encounter to stage, or an expedition to walk. */
export type ResolvedTarget =
  | { kind: "encounter"; label: string; encounter: AuthoredEncounter }
  | { kind: "node"; label: string; expedition: AuthoredExpedition; route: string[]; nodeId: string };

/** What {@link resolveLaunchTarget} needs from its caller. */
export interface ResolveOpts {
  /**
   * The editor's current draft, already converted (`draftToEncounter`). Required for a
   * `draft` target and ignored otherwise — this is the seam that keeps the module free of
   * editor state.
   */
  draftEncounter?: AuthoredEncounter;
}

/** A stable, human key for a target — the picker's row text and the launcher's "last launch" label. */
export function launchTargetLabel(target: LaunchTarget): string {
  switch (target.kind) {
    case "draft":
      return "Current draft";
    case "level":
      return `Level: ${getLevel(target.levelId)?.name ?? target.levelId}`;
    case "node":
      return `${target.expeditionId} → ${target.nodeId}`;
  }
}

/** The `content/levels/` targets, in registry order — the picker's level rows. */
export function levelTargets(): LaunchTarget[] {
  return listLevels().map((l) => ({ kind: "level", levelId: l.id }));
}

/**
 * Every node of `expeditionId` that is **reachable from the start**, as targets — the picker's
 * node rows. Unreachable nodes are omitted rather than offered-then-refused: a dead row in a dev
 * tool is a bug report waiting to happen. Throws on an unregistered expedition.
 */
export function nodeTargets(expeditionId: string): LaunchTarget[] {
  const exp = requireExpedition(expeditionId);
  return exp.map.order
    .filter((nodeId) => enumeratePaths(exp.map, nodeId).length > 0)
    .map((nodeId) => ({ kind: "node", expeditionId, nodeId }));
}

/** Every forward route from the map's start to `nodeId` (may be empty — an unreachable node). */
export function routesTo(map: OverworldMap, nodeId: string): string[][] {
  return enumeratePaths(map, nodeId);
}

/**
 * The route a launcher should take by default: the one that **auto-plays the fewest combats**,
 * then the shortest, then lexicographically — a total order, so the same target always resolves
 * to the same walk.
 *
 * Fewest-combats-first is the whole point. `traverseRoute` resolves every predecessor with the
 * auto-pilot, so each combat on the way is a fight that can be *lost*, taking its rewards and
 * granted flags with it. A `rest` predecessor is deterministic. For a tool whose job is to reach a
 * state reproducibly, the boring route is the correct one; anything the skipped fights would have
 * granted is forced explicitly instead.
 */
export function preferredRoute(map: OverworldMap, nodeId: string): string[] | undefined {
  const routes = routesTo(map, nodeId);
  if (routes.length === 0) return undefined;
  const combats = (route: string[]) =>
    // The target itself is chosen-but-unplayed, so only the predecessors are auto-played.
    route.slice(0, -1).filter((id) => getNode(map, id).kind === "combat").length;
  return [...routes].sort(
    (a, b) => combats(a) - combats(b) || a.length - b.length || a.join(">").localeCompare(b.join(">")),
  )[0];
}

/** Look up a registered expedition or fail loud, naming the id that missed. */
function requireExpedition(id: string): AuthoredExpedition {
  const exp = getExpedition(id);
  if (!exp) {
    throw new Error(
      `launch target: no registered expedition "${id}" ` +
        `(expeditions register at module load — is its module imported?)`,
    );
  }
  return exp;
}

/**
 * Resolve a {@link LaunchTarget} into something launchable, **throwing a specific, actionable
 * error** on anything unlaunchable: a missing draft, an unknown level id (listing what exists), an
 * unregistered expedition, an unknown or unreachable node, or a pinned route that is not a real
 * forward walk.
 *
 * Fail-loud is the requirement, not a nicety: every one of these would otherwise surface as a
 * blank board or a mid-boot crash, and a dev tool that boots the wrong state is worse than one
 * that refuses.
 */
export function resolveLaunchTarget(target: LaunchTarget, opts: ResolveOpts = {}): ResolvedTarget {
  switch (target.kind) {
    case "draft": {
      const enc = opts.draftEncounter;
      if (!enc) throw new Error('launch target "draft": no draft encounter supplied (pass opts.draftEncounter)');
      requirePlayable(enc, "draft");
      return { kind: "encounter", label: launchTargetLabel(target), encounter: enc };
    }

    case "level": {
      const enc = getLevel(target.levelId);
      if (!enc) {
        const known = listLevels().map((l) => l.id).join(", ") || "none";
        throw new Error(`launch target: no content level "${target.levelId}" (known: ${known})`);
      }
      requirePlayable(enc, `level "${target.levelId}"`);
      return { kind: "encounter", label: launchTargetLabel(target), encounter: enc };
    }

    case "node": {
      const exp = requireExpedition(target.expeditionId);
      getNode(exp.map, target.nodeId); // fail loud on an unknown node id
      const route = target.route ?? preferredRoute(exp.map, target.nodeId);
      if (!route) {
        throw new Error(
          `launch target: node "${target.nodeId}" of "${target.expeditionId}" is not reachable ` +
            `from "${exp.map.startId}" (no forward route exists)`,
        );
      }
      requireForwardWalk(exp.map, route, target);
      requireBodies(exp, route, target);
      return { kind: "node", label: launchTargetLabel(target), expedition: exp, route, nodeId: target.nodeId };
    }
  }
}

/** Refuse an encounter the battle could not stage, surfacing the reasons rather than crashing later. */
function requirePlayable(enc: AuthoredEncounter, what: string): void {
  const issues = validateLevel(enc);
  if (issues.length > 0) throw new Error(`launch target ${what} is not playable: ${issues.join("; ")}`);
}

/**
 * Pre-validate a pinned route so the error names the *target* rather than arriving from deep
 * inside `traverseRoute` mid-walk. Mirrors its rules (starts at the map start, every hop a real
 * forward edge, ends at the requested node) — `traverseRoute` still enforces them for real.
 */
function requireForwardWalk(map: OverworldMap, route: string[], target: { expeditionId: string; nodeId: string }): void {
  const where = `launch target "${target.expeditionId} → ${target.nodeId}"`;
  if (route.length === 0) throw new Error(`${where}: route is empty`);
  if (route[0] !== map.startId) throw new Error(`${where}: route must start at "${map.startId}", got "${route[0]}"`);
  if (route[route.length - 1] !== target.nodeId) {
    throw new Error(`${where}: route ends at "${route[route.length - 1]}", not the requested node`);
  }
  for (let i = 1; i < route.length; i++) {
    if (!getNode(map, route[i - 1]).edges.includes(route[i])) {
      throw new Error(`${where}: "${route[i]}" is not a forward edge from "${route[i - 1]}"`);
    }
  }
}

/**
 * Refuse a route whose nodes bind an `authoredId` with **no resolvable body** (D116) — before the
 * walk, not four nodes into it.
 *
 * This is not hypothetical: The Rescue's finale body is injected from content JSON rather than
 * declared inline, so importing the expedition module registers the *map* while leaving the body
 * absent until `injectContentNodes()` has run. Without this check the launch walks the whole route
 * and only then dies inside `runEncounter` with a message about a "dangling id" — technically true,
 * actively misleading, and after the state you wanted was already built.
 */
function requireBodies(
  exp: AuthoredExpedition,
  route: readonly string[],
  target: { expeditionId: string; nodeId: string },
): void {
  for (const id of route) {
    const authoredId = getNode(exp.map, id).authoredId;
    if (authoredId !== undefined && !resolveAuthored(exp, authoredId)) {
      throw new Error(
        `launch target "${target.expeditionId} → ${target.nodeId}": node "${id}" binds authoredId ` +
          `"${authoredId}" but no body is registered (checked inline + the injected catalog) — ` +
          `the content catalog is probably not injected yet (injectContentNodes() runs at boot).`,
      );
    }
  }
}
