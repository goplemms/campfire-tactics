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
- **`rumors.length <= intelDepth`, one-sided — an ERROR, and only when rumors EXCEED the depth.**
  `authored.ts:171` documents this as an authoring rule ("deeper lines are unreachable"); it is
  enforced nowhere. **Fewer rumors than `intelDepth` is intentional and must stay clean** (owner,
  2026-07-30) — some nodes simply have less hearsay to give, which is the point of a shallow node.
  So the only defect is an authored line **no read can ever reach**.
  **Verified 2026-07-30: no body in the repo violates this** — the max is 3 rumors, and every body
  carrying 3 has `intelDepth` at the default `MAX_TIER = 3`; the two `intelDepth: 2` bodies
  (`CUFFED_CELL`, `THIEVES_DEN`) carry none. It lands as a hard error with **zero content churn**.
- numeric fields are actually numbers — `concealment: "4"` passes today;
- `blocked` / `playerSpawns` / trap / gate / lever tiles are on-board. `spawnZoneIssues` already does
  this for zones (`levels.ts`) — **copy its shape**, don't invent a second spelling.
  **Captive placement is already done** (`captiveIssues`, shipped with the challenge pass) — copy *that*
  for the remaining collections; it is the closest exemplar.

### M5 — trap params — **this is what gates the last 2 bodies, and it is NOT the editor milestone**

`id`/`damage`/`concealment` presence + numeric + sane ranges.

**Corrected by the challenge pass (2026-07-30).** The original brief (and D122) said these bodies wait
on the *editor's* trap-params milestone. **Verified false:** `TRAP_FIELD` as JSON validates clean and
would load, inject and play today — only the *editor* refuses to import it. Since the promise is
**loadable, not editable**, the editor is irrelevant to whether it converts.

What actually gates it is **this milestone**. `TRAP_FIELD`'s entire design *is* its `damage` /
`concealment` numbers ("the threat is the terrain"), and nothing checks them — `concealment: "4"`
passes today. Converting it before M5 moves the encounter's whole substance into the silent-typo zone
with **neither a compiler nor a validator** covering it.

**So M5 is not the tail of this brief — it is the unblocker for finishing the migration.** The editor
milestone remains genuinely deferred, but it buys *editability*, not conversion.

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

## Settled (both former open questions — owner, 2026-07-30)

- **CI only, not a runtime gate — for now.** The whole-repo sweep stays a **test**.
  `injectContentNodes()` does **not** validate on the way through: that would turn a content typo in a
  TS body into a **boot crash** for something that isn't even JSON yet. Revisit once the migration is
  done and the arc bodies are JSON — at that point `loadLevels()` already gates them fail-loud, so the
  question mostly dissolves.
- **`rumors` vs `intelDepth` is a one-sided ERROR** — see M4. Fewer rumors than depth is intended, not
  a defect. **No warning tier is introduced**; `validateLevel` stays a flat list of real problems, which
  keeps it a gate rather than a report nobody reads.

## Still open — nothing blocking

None. The brief is implementable as written; M2 is the recommended first slice.

## What the challenge pass changed (2026-07-30)

Run before any conversion, and it moved two things:

- **M5 was re-scoped from "last, with the editor" to "the unblocker for finishing the migration"** —
  see above. The blocked bodies were never waiting on the editor.
- **Two gaps found and closed in `validateLevel`**, both shipped: captive **placement** validation
  (a `pos`-less captive was a TypeError mid-boot, checked by nothing), and a guard against a **stale
  inline `encounters` entry shadowing a converted JSON body** — the failure the natural
  add-then-verify-then-delete workflow walks straight into.

What **survived** the attempt to break it: the conversion path end-to-end (all 4 bodies serialize
exactly, validate clean, and round-trip), the `release`-default normalization (`deployment.ts:55` does
`?? { kind: "reach" }`, so absent and explicit really are identical), and the whole-repo sweep's
specificity (it independently catches unknown templates, duplicate ids, missing reward, bad dims —
it is not merely sensitive to the one bug that prompted it).
