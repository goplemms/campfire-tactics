# Build prompt — R1: the combat log tells the whole truth + the permanent guards

> **Status:** ready to dispatch (audit-verified against the code 2026-07-08; build brief).
> **Campaign context:** milestone R1 of
> [`refactor-campaign-plan.md`](refactor-campaign-plan.md) (from the 2026-07-08 audit,
> issues index **#152**). Consumes issues **#111, #115, #116, #122, #124, #136**.
> **Decision to author:** one entry ≈ *"The combat log is total and serializable; the
> determinism surface is registered"* — confirm the free number at build time against
> `decisions.md` (the D80 backfill and the save-model session, #117, may shift ordering).

## Goal (one line)

Make the combat action log **total** (every state mutation flows through `apply`) and
**serializable** (skill-by-id), register the RNG-label and snapshot-field namespaces so
drift **fails loudly**, and delete the two retired deployment models — the regression
net every later refactor milestone leans on.

## Why first (the campaign's premise)

`replay(initial, log) === state` (`turn.ts:864`) is the tier's declared reconciliation
invariant and the future save/desync/sim foundation — **and it is currently false**
(#111). Undo and replay have invisible no-go zones; the sim's byte-identical guard
can't be trusted as a refactor tripwire until the log is honest. R2–R5's gates all
cite "sim/golden-trace byte-identical"; R1 is what makes that guard load-bearing.

## Project invariants (non-negotiable)

- **Pure core / render split (D2):** all logic in `src/core/`, no Phaser/DOM/`Math.random`;
  `src/game/` stays the thin renderer; flag render changes separately.
- **Determinism:** `npm run sim` summary byte-identical at every increment
  (`sim.test.ts` re-run equality) — this brief changes **no gameplay numbers**.
- **Green at every increment:** `npm run test` (896 at audit time), `npm run build`,
  `npm run test:e2e` after **each** increment; one commit per increment, each revertible.
- **Decision-driven:** cites **D63/D67** (the action-log substrate this completes —
  D67's own record flags `useHeal` as "a pre-existing gap, closable by making it a
  logged action"), **D65** (the injectable-lookup pattern the skill registry follows),
  **D27** (the save seam the serializable log serves), **D73** (the forage-label
  near-miss the label registry generalizes), **D9/D21** (rescue semantics unchanged —
  only the *logging* moves).

## Current state — the audit (verified 2026-07-08; re-verify line refs at build time)

1. **`Battle.rescue` mutates outside the log** (`turn.ts:579`): calls `freeCaptive` +
   emits `unitRescued`, no logged action. Its comment claims replay-safety — wrong for
   the state graph: freeing a captive changes `isActive`, the clock's participant set,
   and the win check. A battle where the player rescued **cannot be reconstructed from
   its log**, and undo cannot cross it.
2. **`useHeal` mutates outside the log** (`turn.ts:709`): herb consumption + heal via
   `resolveMedHeal`, then a raw `commitSkill → execEndTurn` (not `apply`) — even the
   turn-commit bypasses the log. Flagged twice before (D67's record;
   `substrate-candidates.md` #7), never closed. Note the undo checkpoint already
   snapshots the herb stash (`turn.ts:89`), so the refund comes free once logged.
3. **`CombatAction.skill` carries a live `SkillDef` object** (`combat-actions.ts:54`,
   deferral note `:18-20` — "a global skill registry that doesn't exist yet"). The log
   is not serializable; D27's save and any future desync check need it to be.
4. **Snapshot field lists are hand-maintained** and silently corruptible: `UnitSnapshot`/
   `snapshotUnit`/`restoreUnit` (`turn.ts:59-127` — `Unit` gained `escaped`, `concealed`,
   `dugIn`, `hidden`, `standingOrder`, `memory`, `fatigue`, `equipment` across
   D65/D67/D73/D76/D84); `cloneOverworldEconomy` (`overworld-actions.ts:228`, 10 fields);
   `EntityRegistry.snapshot` (`entities.ts:98`, duck-typed `"sprung" in e`). A missed
   field means undo **silently half-restores** — nothing throws.
5. **RNG stream labels are an unregistered namespace**: ad-hoc template strings across
   nine modules (`"map"`, `"node:<id>"`, `"event:<id>:…"`, `"early:"`, `"tailored:"`,
   `"forage:<node>:<night>:<idx>"`, `"deft:"`, `"bribe:"`, `"quest:"`, `"merc:"`,
   `"enc:N"`, `Battle.roll`'s `label#drawCount`). Hazards: collision (a reused label
   correlates two streams — invisible in tests), silent typo-forks, and unmarked
   save/replay-breaking renames. `economy-actions.test.ts:368` re-derives a production
   label by hand; D73 recorded the forage-label near-miss in a doc comment only.
6. **Two superseded deployment models still ship** (`deployment.ts`): the M5b exposure
   meter (lines 33–101, "kept for reference") and the D11 stealth-alert layer (122–249,
   whose header still **falsely** claims it's "the stealth model both scenes now run
   on"). Zero production callers (grep-verified); both publicly exported via the barrel
   (`index.ts:20`). Production runs only the D63/D67 closing net (251–603).
7. **`ActionResult` name collision blocks barrel hygiene**: `combat-actions.ts:95` vs
   `overworld-actions.ts:347` export different shapes under one name — the reason
   `combat-actions` (and, unrelatedly, `purse-journal`, `grants`) are missing from
   `index.ts`'s 63 modules while the game layer imports exclusively from the barrel.
   Verified: zero other duplicate export names; only `tuning.ts`'s exclusion is
   documented as deliberate.
8. **`CombatView.setActiveUnit` is never called** (`combat-view.ts:828`) — the active
   unit's nameplate (819–825), the initiative rail's active-chip styling (597–603), and
   the turn-handoff pop (835–838) are silently dead; the call was lost with the old demo
   driver. Render-only; the one intended visual change in this brief.

## Build plan — ordered, tested increments

> `[CORE]` = `src/core`, `[RENDER]` = `src/game`. Green test/build/e2e + stable sim
> after **each**. One commit per increment, citing its issue.

- **0 — Characterization safety net** `[CORE]`, no production code. A golden scripted
  battle (fixed seed) that uses **rescue and the Medic heal**, pinning the end-state.
  Add the *discrepancy witness*: assert that today `replay(initial, log)` does **NOT**
  reproduce it (so increment 4 flips one expectation, making the fix visible, exactly
  like D67's increment-0 reach test). Snapshot the sim summary.
- **1 — Logged `rescue`** `[CORE]` (#111). Add `{ kind: "rescue"; unit; target }` to
  `CombatAction`; route `Battle.rescue` through `apply`; undo across a rescue restores
  the captive + clock membership (checkpoint already snapshots `captured` via
  `UnitSnapshot`). Rescue *semantics* (D9/D21, the Act cost, `unitRescued` bus event)
  unchanged — only the dispatch moves.
- **2 — Logged `useHeal`** `[CORE]` (#111). Add `{ kind: "useHeal"; unit; herbId; target }`;
  consume the herb inside the apply path; undo refunds it (the `stash` snapshot,
  `turn.ts:89`, already covers it); the raw `commitSkill → execEndTurn` bypass dies.
- **3 — The global skill registry + skill-by-id log** `[CORE]` (#111). `SKILLS:
  Record<string, SkillDef>` derived at load from `JOBS` + `UNIVERSAL_SKILLS`; the log
  stores the **id**, `apply` looks the def up, with an **injectable lookup** for fixture
  skills (the D65 pattern). Serializability pin: `JSON.parse(JSON.stringify(log))`
  replays identically.
- **4 — The replay pin** `[CORE]` (#111). Flip increment 0's witness: the golden
  rescue+heal battle now replays **byte-identically**; undo/undoAll across both verbs
  round-trips. This closes #111.
- **5 — Snapshot drift tripwires** `[CORE]` (#115). A test constructs a `Unit`, mutates
  every enumerable own-property, snapshot/restores, asserts deep-equality — failing
  **with the missing key's name**; same round-trip for `cloneOverworldEconomy` and
  `EntityRegistry.snapshot`. Minimum bar is the tests; deriving the lists from a
  declared `UNIT_MUTABLE_KEYS` const is in-scope if it stays mechanical.
- **6 — The RNG label registry** `[CORE]` (#116). `core/rng-labels.ts`: one typed
  constructor per draw site (`Labels.map()`, `Labels.node(id)`, `Labels.forage(node,
  night, idx)`, `Labels.bribe(node, enemy)`, …), each documenting its replay/save
  contract (fold D73's forage lesson in); migrate call sites mechanically; tests import
  constructors (kill the hand-derived label at `economy-actions.test.ts:368`); a
  grep-based test asserts `streamFor(` outside the module only takes `Labels.`
  expressions. **Labels' string values do not change** — sim stays byte-identical.
- **7 — Delete the retired deployment models** `[CORE]` (#122). Remove the M5b exposure
  section, the D11 alert layer, and their self-identifying test blocks; rewrite the
  module header around the closing net only. Verify first that the net still reads
  `intelDeployBonus`'s `exposureMultiplier` (it does — keep that path).
- **8 — `ActionResult` renames + barrel completion** `[CORE]` (#124). Combat's →
  `BattleActionResult`, overworld's → `OverworldActionResult`; collapse the `VerbResult`
  alias; then `export *` `combat-actions` / `purse-journal` / `grants` from `index.ts`
  and add the comment naming `tuning.ts` as the one deliberate exclusion.
- **9 — Wire `setActiveUnit`** `[RENDER]` (#136). `view.setActiveUnit(actor)` at turn
  open (player, deploy, and policy turns), `null` at turn end. **The named visual blast
  radius:** nameplate + rail highlight + handoff pop start appearing; regenerate the
  affected `shots:*` screenshots and eyeball them; everything else diff-empty.

## Completeness checklist (do not open the PR until every box is true)

- [ ] `Battle.apply` is the **only** mutation path during a battle (rescue + useHeal
      logged; no raw `commitSkill`/`freeCaptive` calls outside it in `src/`).
- [ ] The golden rescue+heal battle **replays byte-identically**; undo crosses both
      verbs; the increment-0 witness expectation is flipped, not deleted.
- [ ] The log **JSON round-trips** (skill-by-id; fixture skills via injectable lookup).
- [ ] Tripwire tests fail **by field name** for `Unit` / `OverworldEconomy` / entity
      snapshots when a mutable field is added unlisted.
- [ ] Every `streamFor` call site outside `rng-labels.ts` uses a `Labels.` constructor;
      label string **values** unchanged; the grep test enforces the future.
- [ ] `deployment.ts` describes one model; the M5b/D11 sections and their tests are
      gone; nothing in `src/` references them (grep).
- [ ] The barrel exports `combat-actions`, `purse-journal`, `grants`; no duplicate
      export names; `tuning.ts` exclusion documented.
- [ ] The active-unit highlight follows the turn in-browser (deploy and combat), on
      both player and enemy turns.
- [ ] `npm run test` / `build` / `test:e2e` green and `npm run sim` **byte-identical**
      at every increment (increment 9's screenshots are the only intended visual delta).
- [ ] The decision record is authored (see below); issues #111/#115/#116/#122/#124/#136
      closed from the PR; #152's R1 row ticked.

## Decision record

Author one entry (number confirmed at build time): capture that (a) the combat log is
now **total** — every in-battle mutation is a logged action, making `replay` a true
invariant and the log the future save/desync **wire format** (the D27 seam, feeding
#117's save-model session); (b) skills log **by id** through the global `SKILLS`
registry (D65's injectable-lookup pattern for fixtures); (c) the **RNG label namespace
is registered** — `rng-labels.ts` is the enumeration of every random decision in the
game, and label renames are save-breaking changes by contract; (d) snapshot field lists
are **tripwired**; (e) the M5b/D11 deployment models are deleted (D63/D67 fully
supersede — this also retires D11's last code remnant). Cite D63/D67/D65/D27/D73/D9/D21.

## Boundaries

- **No behavior changes** beyond the named visual wire-up (increment 9). Rescue/heal
  rules, numbers, and bus events are untouched — only their dispatch path moves.
- **Do not** start the one-Cost-grammar migration (#113), the verb gating (#112 — R2),
  or any module split (R3) here, even where adjacent code invites it. Small-diff
  discipline; note temptations in the PR description instead.
- **Do not** design the save system (#117) — this brief only makes its inputs true.

## Operational

- Dedicated branch off current `main`; one commit per increment; one PR to `main` at
  the end. Commit-message footer per repo convention.
- Verification: `npm run test` · `npm run build` · `npm run test:e2e` · `npm run sim`.
- On landing: update `refactor-campaign-plan.md`'s R1 row + tick #152; author the R2
  brief next (its findings are already pinned in #112 step 1, #125, #126).
