# Build brief — grow `validateLevel` into the gate the JSON migration rests on

**Track:** content pipeline / authoring. **Gates:** the encounters-as-JSON migration (**D122**).
**Status:** briefed, not built. **Read first:** **D122**, `encounters-as-json-review.md` (the audit
behind the numbers), **D114** + `docs/design/implementation/conventions.md` (registry spellings).

> Every number below was produced by running probes against source at `f361219`. Re-verify anything
> you build on.

---

## Why this is a gate and not a follow-up

Moving an encounter from TS to JSON trades a **compiler** for a **hand-written validator**. Measured
today, that trade is a **downgrade**: of 13 single-field typo classes, `validateLevel` catches **2**.

| Caught | Silent |
|---|---|
| enemy `templateId` | captive `spec.jobId` · `spec.primaryJob` · `spec.role` |
| objective `kind` | enemy `role` · enemy `overrides.*` |
| | `reward.materials[].id` · `grants.recruit` / `grants.flag` |
| | **captive `release.kind`** · `intelDepth` out of range · trap `concealment` as a string |

A typo'd `jobId` resolves through `getJob()` to `undefined`, producing **a unit with no job and no
skills** — it deploys, it fights badly, nothing errors. That is the third instance of a class that bit
this repo twice in one day (#216: the untyped `run.flags` bag; `EQUIPMENT` ids skipped by
`equipmentDelta`). Both were fixed by **refusing an unknown id at load**. This is the same fix at the
content tier.

**Do not convert a body until the field it carries is on this list.** The rule that keeps it honest:
*every field that moves from TS to JSON gets an explicit check, in the same change.*

---

## Two things already shipped (D122) — don't redo them

1. **The walkover guard measures the placement tile**, not `spec.pos`. Pinned in both directions
   (`levels.test.ts` → "measures from the placement tile, not spec.pos").
2. **The validator's population is the whole repo** — a sweep runs `validateLevel` over every authored
   body (arc + harness + JSON), enumerated structurally. **Every check you add below is automatically
   enforced against all ~18 bodies.** Expect additions to surface *existing* content defects; that is
   the guard working, and each one is a real finding to fix, not a check to soften.

---

## The work

### M1 — unit identity (the `jobId` class)

Check on **every** authored `UnitSpec` — captives today, `grants.recruit` too:

- `jobId` and `primaryJob` resolve in `JOBS` (use `getJob`, never a hand-copied id list — the
  `OBJECTIVE_KINDS` import in `levels.ts:21` is the living exemplar for "never hand-copy a registry");
- `heldJobs[]` each resolve;
- `role` and any objective `escort` tag resolve against the tag registry — `assertRegisteredTags`
  (`authored.ts:244`) already exists at *staging*; this is the load-time twin.

**Watch for:** `jobId` is `JobId | undefined` and legitimately absent on some specs. Absent is fine;
*present and unknown* is the error. Don't turn an optional field into a required one.

### M2 — close the editor/loader inversion

A captive `release.kind` outside `reach`/`lockpick` is **fail-loud on editor import** and **silent at
JSON load**. The editor is stricter than the pipeline. Validate `release.kind` against
`ReleaseRequirement`'s kinds.

Ship this one **first** — it is a few lines, it is a strict improvement independent of the migration,
and it is the clearest statement of the principle.

### M3 — economy + grant ids

`reward.materials[].id`, `grants.recruit` (a full `UnitSpec` → runs M1's checks), `grants.relic`, and
`grants.flag`. **`grants.flag` must go through `run-flags.ts`** (#216) — that module exists precisely
because a misspelled flag silently drops a gated spawn zone. A flag is the highest-consequence untyped
string in the format; it must not re-enter through the content door.

### M4 — scalars and shapes

- `intelDepth` within `1..MAX_TIER` (currently any number passes, including `99`);
- `rumors.length <= intelDepth` — `authored.ts:171` already documents this as an authoring rule
  ("deeper lines are unreachable"); it is enforced nowhere;
- numeric fields are actually numbers — `concealment: "4"` passes today;
- `blocked` / `playerSpawns` / trap / gate / lever tiles are on-board. `spawnZoneIssues` already does
  this for zones (`levels.ts`) — **copy its shape**, don't invent a second spelling.

### M5 — trap params (only when trap-params authoring lands)

`id`/`damage`/`concealment` ranges. **Sequenced with the editor milestone (D122), not before** — the
2 bodies that carry these can't convert until then anyway.

---

## How to verify each milestone

The audit method, which is cheap and worth keeping:

1. **A typo probe.** Build a minimal valid level, corrupt exactly one field, assert `validateLevel`
   returns a *specific* issue. One case per field added. This is what proves a check is real rather
   than a message nobody triggers — the same discipline `audit:challenge` applies to visual gates.
2. **The whole-repo sweep** (already shipped) catches collateral damage on existing content for free.
3. `npm test` + `npm run build`.

**A check without a failing-input test is not done.** The walkover guard had four passing tests and was
measuring the wrong field for its entire life — because every test fixture set `spec.pos === pos`. Test
the divergent case, not the convenient one.

---

## Open — for the owner, not for the implementer

- **Should `validateLevel` gate the TS bodies at runtime, or only in CI?** Today the sweep is a test.
  Making `injectContentNodes()` validate on the way through would make it a *load-time* contract for
  arc bodies too — stronger, but it turns a content typo into a boot crash for a body that is not
  even JSON yet. **Recommendation: leave it in CI** until the migration is done, then reconsider.
- **How hard should the `rumors.length <= intelDepth` rule bite?** It is an authoring guideline today;
  as an error it may fail existing content. Worth checking the sweep before deciding error vs. warning
  — `validateLevel` currently has no warning tier, and adding one is a real design change.
