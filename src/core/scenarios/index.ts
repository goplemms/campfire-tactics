/**
 * The scenario registry (#170) — the named, bootable {@link "../scenario".ScenarioConfig}s
 * the `#scene` harness lists and boots. **Pure data**: this module has no import-time
 * side effects (registration is lazy, in {@link "../scenario".buildScenarioRun}), so the
 * expedition catalog + sim digest stay clean.
 *
 * To add a scenario: author a config beside `pick-the-cell.ts`, then list it in
 * {@link SCENARIOS}.
 */

import type { ScenarioConfig } from "../scenario";
import { PICK_THE_CELL } from "./pick-the-cell";
import { PRISON_ASSAULT_SCENARIO } from "./prison-assault";
import { JAILBREAK } from "./jailbreak";

export * from "./pick-the-cell";
export * from "./prison-assault";
export * from "./jailbreak";

/** Every registered scenario, keyed by id. */
export const SCENARIOS: Record<string, ScenarioConfig> = {
  [PICK_THE_CELL.id]: PICK_THE_CELL,
  [PRISON_ASSAULT_SCENARIO.id]: PRISON_ASSAULT_SCENARIO,
  [JAILBREAK.id]: JAILBREAK,
};

/** Look up a scenario config by id (the `#scene=<id>` boot path). */
export function getScenario(id: string): ScenarioConfig | undefined {
  return SCENARIOS[id];
}

/** All scenario configs, in registration order (the `#scene` menu list). */
export function listScenarios(): ScenarioConfig[] {
  return Object.values(SCENARIOS);
}
