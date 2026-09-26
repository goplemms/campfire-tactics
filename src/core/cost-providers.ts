/**
 * Cost providers (design map, step 2) — the registry a **data** skill record names a dynamic
 * price by, instead of importing the module that computes it.
 *
 * A `SkillDef.overworldCost` price knob is a static number or a `{ provider }` id
 * ({@link "./overworld-cost".CostKnob}); the id resolves here, at check time, to the body its
 * owning module registered at load (`upkeep.ts` → `"food-upkeep"`; `economy-actions.ts` →
 * `"merchant-buy"` / `"triage-fallback"`). So `jobs-data/support.ts` is pure data with no runtime
 * import of `upkeep` or `economy-actions`: those "lazy / closure-only" imports were the edges that
 * closed the 14-module core cycle, and a cycle is init-order luck no test could see.
 *
 * Registry idiom (conventions, D114): duplicate ids **throw at load** ({@link registerCostProvider});
 * an unknown id **throws by name** ({@link costProvider}). `cost-providers.test.ts` proves every id a
 * shipped skill names is registered once the core barrel is loaded. Pure logic: no Phaser, no DOM;
 * no runtime imports (a leaf, by design).
 */

import type { RunState } from "./run";

/** A dynamic price: the run in, a raw amount out (the resolver sanitizes it to a non-negative int). */
export type CostProvider = (run: RunState) => number;

const PROVIDERS = new Map<string, CostProvider>();

/** Register the body behind a provider id — once, at the owning module's load. */
export function registerCostProvider(id: string, fn: CostProvider): void {
  if (PROVIDERS.has(id)) throw new Error(`cost provider "${id}" registered twice`);
  PROVIDERS.set(id, fn);
}

/** The registered body for `id` — throws, by name, if no loaded module registered it. */
export function costProvider(id: string): CostProvider {
  const fn = PROVIDERS.get(id);
  if (!fn) throw new Error(`cost provider "${id}" is not registered (is its owning module loaded?)`);
  return fn;
}

/** The registered provider ids, sorted (the contract guard's view). */
export function costProviderIds(): string[] {
  return [...PROVIDERS.keys()].sort();
}
