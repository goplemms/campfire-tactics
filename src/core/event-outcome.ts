/**
 * Event outcome (M11) — the **shape** an event resolution reports, in its own leaf.
 *
 * Split out of `node-events.ts` (design map, step 2): the registry imports the authored-event
 * modules (`stories.ts`, `hollow-mill-events.ts`) to register their records, and those modules
 * built their outcomes with {@link emptyOutcome} from the registry — a runtime cycle. The shape has
 * no dependencies of its own, so it lives here and both sides read it downward. `node-events.ts`
 * re-exports the types, so readers of the registry are unchanged.
 *
 * Pure logic: no Phaser, no DOM.
 */

import type { Unit } from "./units";

/**
 * An event kind (M11; **toll** added M13/D48). New kinds are new records on
 * {@link EVENTS} (D4). The **toll** is the forecast's visible node fee — "a thief
 * that tells you the price up front and doesn't sneak" — a *known*, deterministic
 * cost you see while planning and **route around** (vs. the fogged thief skim).
 */
export type EventKind = "thief" | "shop" | "recruiter" | "story" | "toll" | "patron" | "provision" | "town";

/**
 * The structured outcome an event resolution produces — the render reads it and the
 * run-history records its `goldDelta`. Every field is a *net* effect already applied
 * to the run (the resolvers mutate `run`); this is the report, not a command.
 */
export interface EventOutcome {
  kind: EventKind;
  /** Net purse (`run.camp.purse`) delta — negative for a skim/spend, positive for a find. */
  goldDelta: number;
  /** Net camp morale delta (story). */
  moraleDelta: number;
  /** Net fatigue delta applied across the party (story; + tires, − would rest). */
  fatigueDelta: number;
  /** Material ids added to storage (a shop buy / a story reward). */
  materials: string[];
  /**
   * Set when the interaction was **refused** (can't afford / already hired / no
   * stock) — nothing was applied and {@link summary} carries the reason. Absent on
   * every applied outcome (D114: refusals used to be detectable only by reading
   * the summary prose).
   */
  refused?: true;
  /** A body recruited into `run.party` (recruiter), if any. */
  recruited?: Unit;
  /** Theft only: gold skimmed off the purse (blunted by Banker protection, D30). */
  stolen?: number;
  /** A human-readable result line for the render. */
  summary: string;
  /**
   * A **prestige** applied to a party unit (D65 offer→accept), if any — reported so
   * the render + run-history can react. The job evolved in place; `jobId` is frozen.
   */
  prestiged?: { unitId: string; from: string; into: string };
  /** A **memory** flag written on a party unit (D65 linked-event chain), if any. */
  remembered?: string;
  /** **Job-XP** granted to a party unit's job (D65 / arc-plan C3 training grant), if any. */
  jobXp?: { job: string; amount: number; levelsGained: number };
  /**
   * D80 **encounter bypass**: this outcome **short-circuits the node's main encounter** — the day
   * resolves here (keep HP + EXP, forgo the loot) and the loop returns to camp with no fight. Set
   * by a tailored bypass event's paid choice; the scene calls {@link "./runloop".RunLoop.bypassEncounter}.
   */
  bypass?: boolean;
}

/** A blank outcome of a kind (resolvers fill in what they apply). */
export function emptyOutcome(kind: EventKind, summary = ""): EventOutcome {
  return { kind, goldDelta: 0, moraleDelta: 0, fatigueDelta: 0, materials: [], summary };
}
