# Build prompt — R5: render decomposition — the scenes become orchestration

> **Status:** ready to dispatch (R1–R4 landed: D87–D89; the camp verb surfaces already
> render from `availableActions(run)`, which pre-shrank OverworldScene's hardest wiring).
> **Campaign context:** the FINAL milestone of
> [`refactor-campaign-plan.md`](refactor-campaign-plan.md). Consumes issues
> **#131, #132, #133, #134, #135, #137, #138** (the extraction maps live IN those issues —
> read each before its batch; they are the spec, this brief is the sequencing).
> **Decision to author:** none (mechanical, per the campaign rule); the closeout updates
> the campaign plan + #152 and retires the campaign.

## Goal (one line)

BattleScene (3120 lines) and OverworldScene (~2500) become ≲1,200-line orchestrators over
extracted view components; one overlay/button kit is the only way panels and buttons get
built; the seven render-side rule leaks move into tested core functions — with **empty
screenshot diffs for every pure-motion step** (the render twin of R3's byte-identical sim).

## The scope rule

> **Pixels don't move.** Every extraction is code motion behind an identical visual
> result: run the relevant `scripts/shots-*.mjs` harness before and after each increment
> and diff the PNGs (byte-compare; if a diff appears, the motion changed behavior — fix
> the motion). The ONLY intended diffs are the ones #135's core-leak fixes name (none
> expected — moving a rule to core keeps its output) and any the increment's commit
> documents pixel-by-pixel. `npm run sim` stays byte-identical trivially (render-only)
> but run it anyway; e2e per batch.

## Batches (three PRs, the R4 rhythm)

- **Batch A — the kit + the leaks** (#133, #134, #135, #138):
  0 characterization (capture every shots-* harness's PNGs as the reference set; note
  which harnesses cover which surfaces) · 1 `overlay-card.ts` — `showModal` with the
  always-on input-swallowing backdrop; fold the two ~identical choice panels; migrate the
  six hand-rolled modals (#133) · 2 the button kit (#134): delete-or-adopt `ButtonColumn`
  (pick one, per the issue), export `probeWidth` and kill the two scene-local probes,
  extend `Button` with the left-anchored row variant + `onHover`, unify the three
  `makeTextButton` wrappers · 3 core-leaks part 1 (#135): starting roster → core
  `createStarterGuild`, `buyArmoryGear`, `toggleUpkeepSkip` · 4 core-leaks part 2 (#135):
  `Battle`-side bribe side-flip via a proper core verb + `unitSwayed` bus event (kills the
  type-cast), `medicalHerbs()`/`marketStock()` from core, `deployModifiers(run, encounter)`,
  `marketReadyAt(run, node)` · 5 theme hygiene + node-kind visuals table (#138): the INK
  heat-ramp entries, `FONT.figure`, the trap-marker literal → ICON registry,
  `NODE_KIND_VISUALS`, and the renames (`refreshCampText`→`refreshSituationCard`,
  `showSurvey`→`showReactCamp`, `refreshHp`→`refreshUnits`, the `debug-battle.ts` split
  into demos/debug).
- **Batch B — OverworldScene** (#132, in the issue's value order):
  6 `ledger-sheet.ts` (data-in/intent-out, the `PartyDossierView` pattern) · 7 `map-view.ts`
  (drawMap/drawNode/fog/intel-meter/EVENT_VISUALS + the node intel card; `onInspect`/
  `onChoose`/`interactive`) · 8 `camp-panel.ts` (readout tiles, drawers, action cards/cost
  chips, area nav — prep + react become two configurations) · 9 `market-view.ts` +
  `event-panels.ts` · 10 the #137 sweep items that live here (`campText`, the `packed`
  branch, `HintPanel.clearTip` adopted in the camp re-renders).
- **Batch C — BattleScene + closeout** (#131 order, then #137 remainder):
  11 `command-menu.ts` · 12 `forecast-cards.ts` (pure row-builders + the controller) ·
  13 `situation-card.ts` (tabbed) + `resolution-report.ts` · 14 `deploy-zones.ts` +
  `trap-markers.ts` · 15 the #137 remainder (`PartyDossierView` mode/embedded, `clearLog`,
  `ICON.warn`→objective markers) + line-count report + campaign closeout (plan R5 → DONE;
  #152 final comment; note the campaign's end state in PROGRESS.md's header pointer only
  if trivially safe — otherwise leave for the doc campaign).

## Working rules

House protocol throughout: one commit per increment, repo idiom, issue cited, committer
identity verified; `npm run test` + `npm run build` green + screenshot byte-compare + sim
at every increment; e2e per batch; no behavior changes except #135's rule moves (which
must be output-identical, now test-covered in core); no reach into the R4 substrate.
The scenes' hint/hover behavior is subtle (#134's risk note) — check hover states in the
shots harnesses where covered, and flag any uncovered hover surface honestly.
