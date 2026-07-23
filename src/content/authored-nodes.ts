/**
 * The **content→core injection seam** (D116) — where authored node *bodies* flow into
 * core's shared catalog at boot.
 *
 * D98 established `content/levels/*.json` as the "location the game pulls from": one
 * serialized {@link "../core".AuthoredEncounter} per file, glob-loaded and validated fail-loud
 * into {@link LEVELS}. D116 reuses that same store as the authored-node catalog and adds the
 * missing seam: {@link injectContentNodes} hands those resolved bodies **into core**
 * ({@link "../core".injectAuthoredNodes}) so an expedition can resolve a node's `authoredId`
 * against them — without core ever importing `content/` (the dependency flows content→core,
 * keeping core pure/Vite-agnostic).
 *
 * Call this **before** the expedition load pipeline runs ({@link "../core".loadExpedition}),
 * at game boot and in the CI guard. It is idempotent (backed by `injectAuthoredNodes`), so a
 * double boot is harmless. Any malformed file already threw at `LEVELS` load — this only moves
 * the (validated) bodies across the layer boundary.
 *
 * **Layering:** this is *content* (it depends on the Vite-glob'd {@link LEVELS}), not core.
 */

import { injectAuthoredNodes } from "../core";
import { LEVELS } from "./levels";

/**
 * Inject every glob-loaded content level into core's shared authored-node catalog (D116).
 * Idempotent; safe to call at every boot. Returns the injected ids (diagnostics).
 */
export function injectContentNodes(): string[] {
  injectAuthoredNodes(LEVELS);
  return Object.keys(LEVELS);
}
