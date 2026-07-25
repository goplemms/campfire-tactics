# M3 (model A — seal-drive) — precise spec, pre-`/challenge`

Owner-confirmed 2026-07-25: **A + M3b**. Control-room target-priority splits to M3b.
Build against `DOCTRINE_HARNESS`. Every new branch garrison-scoped; non-garrison byte-identical
(`ai.test:90` + C3 canaries stay green).

## The claim

Make the garrison's door-drive **primary** and **`in-combat`-gated**, garrison-scoped, without
perturbing generic AI. A `garrison && !in-combat` unit that can reach an openable authored seal drives
to and opens it (keyholder→key, breakable→batter), **ignoring reachable un-engaged foes** (taking free
hits). The moment it is `in-combat` (took damage since its last `turnEnd` from a foe it can still strike)
it reverts to normal scoring and stops to fight.

## Plumbing (pure, read-only)

1. `AIOptions` gains `tagContext?: TagContext` (mirrors the `isCharging` / `gates` seams).
2. `Battle.runPolicyTurn` passes `tagContext: this.tagContext()` alongside `isCharging` + `gates`.
   No determinism risk — `tagContext()` is a read-only query over units + the event log.

## Planner change (`planEnemyTurn`)

Gated entirely on `isGarrison = hasTag(unit, GARRISON)` (intrinsic → no ctx needed).

```
// after the flee early-return, before the scoring loop:
const isGarrison = hasTag(unit, GARRISON);
const order = orderOf(unit)?.posture;               // hold / flee already handled / undefined
const engaged = isGarrison && opts.tagContext
  ? hasTag(unit, IN_COMBAT, opts.tagContext) : false;

// A drive-seal = the nearest authored seal this unit can OPEN and can REACH an opening-tile of.
//   openable: canKeyGate-eligible (keyholderOf + locked) OR isBreakable(locked)
//   reachable: findPath(unit.pos → some opening tile) !== null  (opening tile = adjacent for key,
//              within attackRange for batter); NOT this-turn-budget-limited (multi-turn approach)
//   nearest: by path length to the nearest opening tile
const driveSeal = (isGarrison && !engaged && order !== "hold")
  ? nearestOpenableReachableSeal(unit, units, grid, opts.gates ?? []) : undefined;

if (driveSeal) return planSealDrive(unit, units, grid, driveSeal);   // SEPARATE early-return branch
// …otherwise the existing generic scoring loop, byte-identical…
```

`planSealDrive`: enumerate `reachableTiles`; for each dest:
- if dest can **open** the seal (key: manhattan≤1; batter: manhattan≤attackRange) →
  `score = AI.garrisonDrive + movePart`, set `gateTarget`/`gateAct`.
- else → `score = -pathDistToOpeningTile(dest) * AI.approachWeight + movePart` (advance toward the seal).
Pick the best; return `{unit, path, destination, target:null, gateTarget?, gateAct?}`.
`movePart = -cost*movePenalty` (drop `isolationPenalty`? — the doctrine WANTS it to walk into danger;
see open Q4).

### Why a separate early-return branch, not a new score in the shared loop
Minimises blast radius: the generic loop stays byte-for-byte unchanged, so no non-garrison unit and no
`in-combat` garrison unit can be perturbed — the canaries can't move. The branch is only entered by a
`garrison && !in-combat && has-a-drive-seal` unit. (Trade-off vs the kickoff's "insert a score above
actionBase" — challenge this.)

## New weight

`AI.garrisonDrive` (e.g. 1400) — above `actionBase` (1000). Only read inside `planSealDrive`.
(Under the separate-branch design its absolute value barely matters — the branch never competes with an
attack score. Kept as a named constant for the record + a possible future in-loop merge.)

## What the harness proves (unchanged fixture)
- **Warden** (keyholder, garrison) at (1,1), infiltrator reachable at (2,0), seal keyed at (3,1):
  `!in-combat` ⇒ plan drives to (2,1) and keys the seal (`gateAct:"key"`), NOT attacks the infiltrator.
  `in-combat` (stub `exchangedDamageSince`) ⇒ plan attacks the infiltrator (generic loop).
- **runPolicyTurn integration**: un-engaged Warden converges over turns + keys the seal open (route
  revealed); a Warden fed an exchange stops and fights.
- The **guard** (thug, garrison, non-keyholder, no breakable seal) has no drive-seal ⇒ generic behavior.

## Guard-batter drive coverage (synthetic ai.test fixture, NOT the harness)
- garrison unit + breakable locked gate reachable + adjacent reachable foe, `!in-combat` ⇒ `gateAct:"attack"`.
- same, `in-combat` ⇒ attacks the foe.

## Canaries that MUST stay green
- `ai.test:90` "prefers attacking a reachable foe over a door" — non-garrison, never enters the branch.
- C3 "does NOT batter a door that doesn't open a route to a foe" — non-garrison.
- All M2c keyholder-drive cases — those units aren't garrison in those tests (verify), so `wallsOff`
  path is untouched. **If any M2c test unit is garrison, the new branch changes its plan → must reconcile.**

## Open questions for the challenge
- **Q1** separate-branch vs in-loop-score: does the early-return miss any interaction (charge-interrupt,
  debuff ability, hold-leash return-to-post) that a garrison unit legitimately needs while driving?
- **Q2** `nearestOpenableReachableSeal` reachability probe: cost, correctness on the locked-gate-tile
  (opening tiles are adjacent/off the gate, so findPath doesn't need the gate open — verify vs C3's probe).
- **Q3** the self-clearing window: a Warden hit on turn N is `in-combat` on turn N+1 (stops), then if the
  player doesn't hit again, `in-combat` lapses and he resumes the drive on turn N+2 → peel/return
  oscillation. Owner ruled the free hit is WANTED (no peel-clamp). Confirm the oscillation is the intended
  distraction economy, not a bug, and that tests assert it deterministically.
- **Q4** isolationPenalty inside the drive: the generic loop penalises ending isolated next to foes; the
  drive WANTS that. Drop it in `planSealDrive` — confirm no other consumer expects it.
- **Q5** does staging `overrides.tags:["garrison"]` actually reach `unit.tags` so `hasTag` sees it? (M2.5
  tag-guard proves registration; confirm the value lands on the Unit at build.)
- **Q6** M3b seam: `planSealDrive` returns `target:null` even post-open. Confirm M3b (control-room
  targeting) can layer on without reworking the branch.

---

## `/challenge` OUTCOME (2026-07-25) — SURVIVED, with 1 code guard + 3 documented contracts

Each break-case constructed against the real code and run, not the happy path.

### VERIFIED — the blast radius is contained by construction
- **Canaries + M2c stay green.** The `at()` helper builds `createUnit` with `tags: []` (units.ts:357
  defaults `spec.tags ?? []`); every M2c warden is `{ ...at(...), role:"captain" }` → still `tags: []`
  → **non-garrison** → the new branch is *never entered* → those plans are byte-identical. The
  **line-119 test** ("a keyholder with a REACHABLE foe attacks it… no priority reorder yet") becomes a
  **non-garrison canary** proving the reorder is garrison-scoped (its "yet" comment goes stale — cosmetic
  update).
- **Sim digest byte-identical.** Grep proved the **only** garrison-*tagged* units in the codebase are the
  doctrine-harness (via `overrides.tags`) and `tags.test.ts`'s direct `hasTag` unit tests. **No
  gallery/sim/production encounter carries the tag**, and the harness is not gallery-registered → the
  branch is dead code in every sim path → digest cannot move.
- **`overrides.tags` reaches `unit.tags`** (authored.ts:202 `...p.overrides` → `createUnit` → `tags:[...]`
  → `assertRegisteredTags`) ⇒ `hasTag(warden, GARRISON)` = true. (Q5 ✓)
- **Reachability probe is sound** (Q2). Opening tiles are *adjacent to / within range of* the seal, i.e.
  **off** the locked (blocked) gate tile, so `findPath` needs no gate-open — and it's immune to the
  `opensARoute` triviality because it selects by *openable-by-me + reachable*, never "reveals a route to a
  foe." `keyholderOf`/`isBreakable` both require `gate.locked`, so an opened seal self-excludes (no
  re-drive of an open door).
- **The separate-branch design sidesteps the score-tuning risk entirely** (Q1, the headline win). At
  harness (2,1) the infiltrator is *adjacent* (within the Warden's attackRange 1): an **in-loop** score
  would have to make `garrisonDrive` out-number `actionBase + dmg·perDamage + priority + lethalBonus` to
  key instead of attack — the exact fragile tuning the kickoff feared. The **early-return branch never
  competes** with an attack score, so `garrisonDrive`'s absolute value is inert. This is why separate-branch
  beats in-loop-score. **Decision: separate early-return branch, confirmed.**

### FINDINGS THAT CHANGE THE BUILD
- **F1 (CODE GUARD) — immobilized garrison idle.** A `!in-combat` garrison unit that is *immobilized*
  would enter `planSealDrive`, be unable to move, and idle — skipping an attack on an adjacent
  not-yet-engaged foe it could otherwise make (the line-181 behavior). **Fix:** enter the drive branch only
  when `!isImmobilized(unit)`; otherwise fall through to the generic loop (which attacks an adjacent foe in
  place). Cheap, preserves line-181 for garrison too.
- **F2 (AUTHORING CONTRACT → D117) — decorative-seal hijack.** Model A drops the `opensARoute` relevance
  filter for garrison, so a garrison unit drives to the **nearest openable seal even if incidental**. None
  exist in the harness or the concentric finale, but it's a latent footgun. This is *exactly* the tension
  M3b's control-room region resolves (the region becomes the relevance filter). Record the contract: **in a
  garrison encounter every authored openable seal is a real objective — no decorative openable seals near
  garrison** — and note M3b supersedes it.
- **F3 (DEFAULT, document) — no `tagContext` ⇒ drives.** A garrison unit planned without `opts.tagContext`
  defaults `engaged = false` → drives unconditionally. **Production always passes ctx** (`runPolicyTurn`),
  so the game is correct; the guard is `isGarrison && opts.tagContext ? hasTag(IN_COMBAT) : false` (never
  calls the derived tag without ctx — which would throw). Unit tests must pass a ctx stub to exercise the
  in-combat path.
- **F4 (KNOWN, documented) — lever-camp oscillation un-defused in M3.** A re-lock (lever) re-opens the
  drive → key → re-lock → … loop. M3 ships this un-defused; **M3b's control-room targeting closes it**
  (Decision G). Harness integration tests don't run the lever ⇒ deterministic.

### Net
Design **survives**. Build adds one guard (`!isImmobilized`), the `tagContext` plumbing, and the
`planSealDrive` early-return; F2/F3/F4 become D117 prose. Proceed to build.
