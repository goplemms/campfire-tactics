/**
 * The **injected authored-node catalog** (D116) — the shared home authored node
 * *bodies* are resolved from, decoupled from where they are *stored*.
 *
 * Authored nodes are double-homed no more: their bodies live as JSON, one file per
 * node, in `content/` (D98's pipeline), and a resolved catalog is **handed into core
 * at boot** — the dependency flows content→core, so core stays pure (no `content/`
 * import, no Vite-ism, no `Math.random`). An {@link "./expedition".AuthoredExpedition}
 * resolves each node's `authoredId` against this catalog (falling back to any inline
 * `encounters` for the still-TS-authored arc, so the shipped Hollow Mill is untouched).
 *
 * The catalog is module-global, intentionally: it is a **boot-time injection point**,
 * populated once by the content layer (`injectContentNodes`) before the load pipeline
 * ({@link "./expedition".loadExpedition}) resolves against it. Tests that exercise it
 * inject explicitly and {@link clearInjectedNodes} for isolation.
 *
 * Pure logic: no Phaser, no DOM, no `Math.random`.
 */

import type { AuthoredEncounter } from "./authored";

/** The injected bodies, keyed by `authoredId`. Populated at boot by the content layer. */
const INJECTED: Record<string, AuthoredEncounter> = {};

/**
 * Inject resolved authored-node bodies into core's shared catalog (D116). Idempotent by
 * reference — re-injecting the same body under an id is a no-op (boot may run more than
 * once) — but **fail-loud** on a genuine collision: two *different* bodies claiming one
 * id is a content bug, surfaced here rather than as a silent last-writer-wins swap.
 */
export function injectAuthoredNodes(nodes: Record<string, AuthoredEncounter>): void {
  for (const [id, body] of Object.entries(nodes)) {
    const existing = INJECTED[id];
    if (existing && existing !== body) {
      throw new Error(`injectAuthoredNodes: conflicting bodies injected for authoredId "${id}"`);
    }
    INJECTED[id] = body;
  }
}

/** Resolve an injected authored-node body by `authoredId` (undefined if none injected). */
export function getAuthoredNode(id: string): AuthoredEncounter | undefined {
  return INJECTED[id];
}

/** The ids currently injected (diagnostics + the load-pipeline's fail-loud message). */
export function injectedNodeIds(): string[] {
  return Object.keys(INJECTED);
}

/** Drop every injected body — test isolation only (the catalog is boot-populated in prod). */
export function clearInjectedNodes(): void {
  for (const id of Object.keys(INJECTED)) delete INJECTED[id];
}
