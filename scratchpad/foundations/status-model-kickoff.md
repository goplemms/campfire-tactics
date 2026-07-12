# Kickoff — Generalize the status model (timed + scaled/banded, cross-phase)

> Paste into a fresh session on a new branch to activate the parked status-model track. This is a
> **foundational systems** change, orthogonal to the arc. The direction + guardrails are already
> settled (design-drafted and adversarially red-teamed). **Do NOT edit code until a plan is agreed.**

## Read first (canon)
- `decisions.md` — the **Roadmap** entry "**Status-model generalization**" (the direction + the **four
  red-team revisions**, which are canon for this track). Also **D90** (why captured stayed a boolean —
  the taste deliberately did *not* wait on this) and **D80** (the overworld fatigue/effort loop).
- Code: `src/core/status.ts` (the `StatusInstance` data model; `tickStatuses` fires at exactly one
  site — the *combat* turn-open, `turn.ts`), `src/core/fatigue.ts` (the bespoke banded scalar — the
  pattern this generalizes; recovered nightly), `src/core/num.ts` (`bandFor` — the generic band engine
  that already exists), `src/core/battle-undo.ts` + the golden/replay tests (the determinism surface).

## The direction (do NOT re-litigate — it survived the red-team)
A `StatusInstance` gains a **cadence** (`turn | night | node | never`) + two **shapes**:
- **`timed`** — today's countdown (Exposed, Swift, Immobilized). Unchanged.
- **`scaled`** — a **magnitude** banded into named tiers via `bandFor`, **accruing** on apply and
  **decaying** per tick; effects key off the **tier**, not the raw value (poison: lightly → badly).

## The four red-team revisions (canon — bake these in)
1. **Decouple from the taste** — it shipped on the boolean (D90). Captured→status is at most an
   optional *epilogue* here, never a prerequisite.
2. **Concrete-first, not abstraction-first** — build **tiered poison** hand-rolled via `bandFor`
   first; extract the general `scaled` shape only when a *second* scaled consumer appears (YAGNI —
   the `scaled` shape has ~one consumer until then).
3. **Fatigue: coexist, likely don't migrate** — its "decay" is bespoke (tier-floor-step-per-night ·
   Deep-Rest-wipe · resolve-time gate · raw story deltas across ~10 systems). Forcing it into the
   general model fakes generality. Coexistence may be the destination, not a way station.
4. **Sequence by replay cost** — combat/deploy-cadence decay is replay-safe *for free* (reconstructed
   in the `tickStatuses` turn-open path, like `duration`; re-pin numeric goldens). But **overworld/
   night cadence needs new `snapshotRun` serialization** (it does not persist `statuses` today) — the
   expensive frontier. Captured→status is replay-safe but a ~30-site `u.captured`→`hasStatus`
   migration + a snapshot-shape edit — deferred.

## The first move (deliver a design + phased plan — no code)
1. **Model** — the two shapes + cadence + shape-aware apply (timed *replaces*; scaled *accrues*) on
   `status.ts`, additive (today's statuses become `timed`).
2. **Prove on poison** — a new `scaled`/`turn` condition via `bandFor`, greenfield, no shipped economy
   disturbed. Decide poison's identity first (combat-attrition vs campaign-attrition — it sets the
   cadence and whether it needs the overworld serialization).
3. **Overworld cadence** — only after poison proves the shape; budget the `snapshotRun` work.
4. **Captured→status** — optional epilogue, on its own merits (cleanse/Deadeye/render uniformity),
   with the replay + `kind`-opt-out due diligence.

**Deliverable:** the model design + the phased build plan (PRs · tests · guards) + the decision
re-drafted as a full `## D##` entry when build starts (it's a Roadmap candidate until then).

## Working rules
- Investigation → agreed plan → incremental PRs. Determinism: no `Math.random` in `core/`; keep replay
  byte-identical (re-pin goldens deliberately where a magnitude changes).
- Guards green every PR: `tsc` · `vitest run` · `build` · e2e · `sim`.
