/**
 * The Captain's Journal — a **pure projection** of the party's own *nagging* state
 * into the flat list of "concerns" the overworld surfaces between nodes (the
 * `projectDossier`/`buildLedger` pattern, one glance up).
 *
 * The overworld is deliberately information-light, but that scarcity was only ever
 * meant for the *enemy/world* (intel fog, D48). The party's own predicaments —
 * worn gear piling up, a companion bleeding out on the dying clock, someone left
 * behind and captured — are **accidental blindness**, not intentional fog: a
 * captain has no business *forgetting* them. The dossier already shows these
 * per-member; this gathers the same facts so they nag from the always-one-glance
 * camp surface too, where the routing decision is actually made.
 *
 * Honors the anti-agony stance (D7/D8/D35): a glance, never a chore. An empty list
 * means "nothing nags" and the host simply shows nothing — no per-camp bookkeeping.
 *
 * Two-layer rule (glossary): this owns the **canon facts** (counts, nights, names);
 * the view owns the **Layer-2 flavor** (the captain's grumbling prose).
 *
 * Pure logic: no Phaser, no DOM, no `Math.random` — a deterministic read.
 */

import type { RunState } from "./run";
import { DYING_COUNTER, isDying } from "./mortality";

/** What a concern is about — drives the view's flavor line + icon. */
export type ConcernKind = "gear-wear" | "dying" | "rescue";

/** How loudly a concern nags — also the worst-first ordering key. */
export type ConcernSeverity = "urgent" | "warning" | "note";

/**
 * One entry in the Captain's Journal: the canon facts behind a single nagging
 * predicament. The view turns it into a flavored line.
 */
export interface JournalConcern {
  kind: ConcernKind;
  severity: ConcernSeverity;
  /** The companion this concerns (dying/rescue). Absent for party-wide concerns. */
  subject?: string;
  /**
   * The headline number: worn-gear count (`gear-wear`), or nights left on a clock
   * (`dying`/`rescue`; `0` = no timer at this difficulty).
   */
  value: number;
}

/** At/above this worn-gear count the gear-wear concern escalates note → warning. */
export const GEAR_WEAR_WARN = 3;
/** At/below this many nights left, a clock (dying/rescue) reads as urgent. */
export const CLOCK_URGENT_NIGHTS = 1;

const SEVERITY_RANK: Record<ConcernSeverity, number> = { urgent: 0, warning: 1, note: 2 };

/**
 * Project a run into the Captain's Journal — every piece of the party's own state
 * that should nag the captain, worst-first. Reads only persisted run state, so it
 * stays in lockstep with the dossier and the ledger (one source of truth each):
 *
 * - **gear-wear** — worn-gear debt the next rest node clears (D45/D47).
 * - **dying** — a downed companion on the Hard-mode cleric clock (D9).
 * - **rescue** — a companion left captured, now an outstanding rescue follow-up
 *   (D9/D21); the name is recovered from the still-listed roster member.
 */
export function captainsJournal(run: RunState): JournalConcern[] {
  const out: JournalConcern[] = [];

  if (run.camp.gearWear > 0) {
    out.push({
      kind: "gear-wear",
      severity: run.camp.gearWear >= GEAR_WEAR_WARN ? "warning" : "note",
      value: run.camp.gearWear,
    });
  }

  for (const u of run.party) {
    if (!isDying(u)) continue;
    const nights = u.counters[DYING_COUNTER] ?? 0;
    out.push({
      kind: "dying",
      severity: nights <= CLOCK_URGENT_NIGHTS ? "urgent" : "warning",
      subject: u.name,
      value: nights,
    });
  }

  for (const quest of run.rescueQuests) {
    const member = run.party.find((u) => u.id === quest.unitId);
    out.push({
      kind: "rescue",
      severity: quest.nights > 0 && quest.nights <= CLOCK_URGENT_NIGHTS ? "urgent" : "warning",
      subject: member?.name ?? quest.unitId,
      value: quest.nights,
    });
  }

  return out.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

/** Whether anything nags right now — lets a host skip the surface entirely. */
export function hasConcerns(run: RunState): boolean {
  return run.camp.gearWear > 0 || run.rescueQuests.length > 0 || run.party.some(isDying);
}
