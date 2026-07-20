# Structural audit — 2026-07-20

Six-lens sweep of `src/core` + `src/game` for uncodified shared structure: duplicated
machinery, near-miss helper functions, contract drift between sibling patterns, and
terminology drift. Method: six parallel search/collation subagents (numeric helpers ·
registries/resolvers · result shapes · RNG labels · render layer · terminology), findings
verified against the D87–D89 refactor-campaign canon before ranking.

**Framing.** The R1/R2/R4 campaign (D87–D89) already built the canon this audit measures
against: `rng-labels.ts` as the registered label namespace, one `Cost` grammar, the Verb
Cell (SkillDef → one interpreter → effect registry → `availableActions` projection),
`num.ts` tier primitives (`bandFor`/`rankOf`/`clampUp`), and single-spelling chokepoints
(`accrueRp`/`spendRp`/`nudgeMorale`, `fieldedUnits`/`fieldsJob`). The audit's verdict is
that the canon **held where it was enforced by a guard** (banding is 100% consolidated;
every weighted pick routes through `rng.pickWeighted`; every literal `streamFor(` call in
flat `src/core` is `Labels.*`-routed) and **drifted exactly where no guard reaches**
(one level above `streamFor`, in `src/game`, in the registries/result-shapes the campaign
never covered). The recommendations below follow the campaign's own playbook: pick one
spelling, migrate stragglers, and **add the tripwire that keeps it true**.

---

## Tier A — correctness findings (fix regardless of any consolidation)

### A1. Battles are not salted per encounter — `deploy`/`trap-spot` streams repeat every battle ⚠️
- `runloop.ts:437` wires `seed: this.run.seed` (constant for the whole run) into
  `stageEncounter` → `new Battle(..., { seed })` (`staging.ts:181`).
- `turn.ts:76-77`'s doc claims production wires `streamFor(run.seed, "battle:<node>:<night>")`.
  **It does not** — no per-node/night salt exists anywhere in the call path.
- Consequence: `Battle.stream(Labels.deploy())` and `Battle.stream(Labels.trapSpot())` are
  `streamFor(<constant>, <constant>)` — **every encounter in a run replays the identical
  front-capture and trap-spotting roll sequences**. `Battle.roll` is partially shielded by
  the `dmg:<atk>-><def>` salt, but generated enemy ids are `e<layer>-<i>-<tpl>` — two
  same-layer nodes rolling the same template produce identical ids, so damage-variance
  collisions across nodes are possible at equal draw index.
- Fix: salt the battle seed per node (+ night for re-entry safety) via a **registered**
  label (`Labels.battle(nodeId, night)` in `rng-labels.ts`, value-pinned). This is a
  replay-affecting change by the D87 contract — expect a sim digest re-pin **only if** the
  sim path exercises these streams (the naive bot skips the deploy phase, so likely
  byte-identical; verify, don't assume). Add the missing test: `Battle.stream`/`roll`
  outputs differ across two nodes of one run.

### A2. `GuildScene.drawBanner` is a seventh unmigrated modal with **no input backdrop**
- `GuildScene.ts:327-355`: hand-rolled rect + title + body + Dismiss. GuildScene never
  imports `overlay-card`. This is the exact bug class `showModal` was built to kill
  (clicks bleed through to the roster/pool/stable behind the banner).
- Fix: migrate to `showModal`. Extend `test:e2e` if the banner isn't already stepped through.

### A3. RNG guard holes (the label canon is unenforced exactly where it drifted)
- `rng-labels.test.ts` + `rng.test.ts` scan `import.meta.glob("./*.ts")` — **non-recursive**:
  `core/jobs-data/`, `core/scenarios/`, and all of `src/game` are unscanned (currently
  clean, structurally unprotected).
- Four sites hand-assemble `streamFor`'s private `#`-join one level above the call, invisible
  to the grep guard: `guild.ts:204` (`"quest:main"` — unregistered), `guild.ts:224`,
  `node-events.ts:273` (`"recruit:<nodeId>"` — unregistered), `expedition-sim.ts:121`.
- Fix: register the two ad-hoc labels; add a `saltSeed(seed, label)` helper in `rng.ts` so
  the `#` convention lives in one place; recurse the guard globs and extend them over
  `src/game`.

### A4. Small confirmed hazards
- `EditorScene.ts:438`: raw `0x9a6bc0` is one digit off `COLOR.captive` (`0x9a6bd0`) — almost
  certainly a typo of the theme token. (`:442` `0x62c6d6`, `:451` `0x000000` also bypass theme.)
- `EQUIPMENT` ↔ `MATERIALS` dual-registration (same id in both, per `equipment.ts:94`'s own
  comment) has **no load-time check** — add one (the `SKILLS`-IIFE collision-check pattern).
- `registerEvent` (`node-events.ts:467`) silently no-ops a duplicate id while `SKILLS` and
  `LEVELS` **throw at load** — make it throw for consistency (fail-fast on authored-content bugs).
- Stale docs contradicting shipped design: `economy-actions.ts:629` still describes a fatigue
  "over-extension surcharge" (retired by D73); `turn.ts:76` describes the battle salt that A1
  shows doesn't exist.

---

## Tier B — codify the shared structures (the main ask)

### B1. Result/refusal shapes: name the two-layer convention, fix the stragglers
Census: **10 distinct shape families** answer "did it work, and why not." The two dominant
ones are already layered, not competing:
- **Verb layer** (player-facing action surfaces): `ActionOutcome { applied, reason?, detail? }`
  (`overworld-actions.ts:81`) — self-documented as "the single canonical result type", extended
  by 9 result interfaces.
- **Core/effect layer** (mechanism internals): discriminated `{ ok: true; ... } | { ok: false; reason }`
  (`BattleActionResult`, `checkOverworldCost`, `OverworldEffectResult`, effect cores).

Recommendation: **ratify both, as a two-layer convention** (verb = `applied`, core = `ok`
discriminated), document it in one place (a `docs/design/implementation` note or a small
`core/result.ts` exporting the generic shapes), and migrate the stragglers:
- `traps.ts:187-238` — loose `{ ok: boolean; reason? }` (not narrowable) → discriminated union.
- `equip`/`unequip` (`equipment.ts:211,243`) — bare `boolean`, no reason at all → core-layer union.
- `applyBorrowEffect`/`applyGuardPurseEffect`/`applyPatronizeEffect` — no failure variant while
  sibling cores in the same file have one → give them the union (or an explicit `AlwaysOk` type
  so "cannot refuse" is a stated contract, not an inference from a missing field).
- `EventOutcome` refusals hide as prose in `summary` (`shopBuy`/`hireRecruit`,
  `node-events.ts:242-302`) → add an `applied`/`refused` flag; keep `summary`.
- `bribeEnemy`'s tri-state (`applied:false` vs `applied:false, failed:true`) is the one shape
  the render genuinely branches on (`BattleScene.ts:1895` reads the two-boolean combination) —
  if touched, replace with an explicit `status: "refused" | "failed" | "swayed"` and update that
  one site in the same commit. Otherwise leave it and document it.
- `applyStoryChoice` **short-pays** (`stories.ts:298` clamps a cost to the purse) while every
  cost-gated verb refuses all-or-nothing — decide which philosophy story costs follow and
  record it (this is a design call, not a mechanical fix).
- Refusal reasons are free-form strings everywhere; the render never string-matches, only
  displays. Keep strings (typed reason codes are cost without a consumer today), but state
  that contract: *reasons are display-only prose; never branch on their content.*

### B2. Registries: one contract, one tripwire
17 registries share the Def+const+getter shape with drifted contracts: getters return
`undefined` (9) vs **throw** (`getVessel`, `getEvent`) vs silent-default (`getDifficulty`,
`statusVisual`); `string` vs `string | undefined` acceptance is uncorrelated with anything;
id-as-key duplication is manual in most (drift-possible) while `scenarios/index.ts` (`[X.id]: X`)
and `expedition.ts` (`CATALOG[exp.id] = exp`) are structurally immune.

Recommendation: don't build a registry *class* — codify the **contract** and the safe idiom:
- `getX(id)` returns `undefined`; a throwing variant is spelled `mustGetX` (or callers use
  `getX(id)!` past a validation seam). Align `getVessel`/`getEvent` (their throw sites become
  `mustGet`).
- Registry keys are **derived from `.id`** (the scenarios pattern), never hand-duplicated.
- Duplicate-id registration **throws at load** (the `SKILLS`/`LEVELS` pattern; fixes A4's
  `registerEvent`).
- Add one guard test that walks every exported `Record<string, {id}>`-shaped registry and
  asserts key === `.id` (kills the whole drift class, including the `BANDIT_TEMPLATES` risk).

### B3. `num.ts` adoption + one new helper
- Mechanical swaps (behavior-identical, verified by the audit): `arrivals.ts:163` `unit01`
  (exact `clamp01` twin, 8 call sites; the file imports nothing from num.ts) ·
  `deployment.ts:248` → `clamp01` · `camp.ts:124` `moraleTierIndex` → `rankOf` ·
  `intel.ts:114` `clampTier` → `clamp(Math.round(t), 0, MAX_TIER)` (keep round-then-clamp
  order) · render-layer inline clamps in `info-cards.ts:70`, `GuildScene.ts:369`,
  `combat-view.ts:586`.
- **Do not blind-swap**: `market-view.ts:104` (min/max order differs from `clamp` when
  `hi < lo` — currently guarded, but check) and `EditorScene.ts:820` (the `|| 1` falsy guard
  must survive; `clamp` doesn't handle `NaN`).
- New helper: `pct(frac): string` — 12 sites hand-roll fraction→percent with **two disagreeing
  idioms** (`Math.round(x*100)` vs `(x*100).toFixed(0)`, which differ at `.5` boundaries).
  Standardize on the `Math.round` law; migrate all sites.
- Explicitly **not** worth helpers: roster averages (2 sites, domain-different empty fallbacks),
  banding (already 100% on `bandFor`), asymmetric-floor (design retired by D73 — only the A4
  stale comment remains).

### B4. Render layer: extract the four real components, add depth constants
- `drawHpBar(scene, x, y, w, h, frac)` — the two-rect + `hpColor` geometry is hand-built **5×**
  (`combat-view.ts:802,641` two sizes in one file; `info-cards.ts:48`;
  `party-dossier-view.ts:538,546` near-clones).
- One tab/chip component — 4 independent implementations (`situation-card.ts:144`,
  `camp-panel.ts:435` (documented depth exception), `party-dossier-view.ts:119`,
  `GuildScene.ts:404`), each reinventing active/inactive fill+stroke+ink.
- `showModal` completion: migrate `market-view.ts:63` and `OverworldScene.showLedgerTransition`
  (:1716) — both already `installBackdrop` then hand-draw exactly what `showModal` draws.
  (A2's GuildScene banner is the urgent one.)
- `DEPTH` constants in `theme.ts` (or `ui.ts`): today every module invents a private band
  (10/11/25/26/43/60…, 27 uses of bare `setDepth(10)` across 6 files, cross-surface stacking
  coordinated by comments). One named scheme ends the manual coordination.
- Small: `onEscClose(scene, fn)` (3 verbatim copies in OverworldScene); route `Button.enabled`
  through the 4 hand-rolled disabled-state copies; theme-bridge the four DOM tool overlays
  (`debug-menu`/`dev-tray`/`repro-capture`/`playtest-log-ui` each hardcode a near-identical
  dark palette; `cssHex`/`ED` prove the bridge works) — dev-tools-only, lowest priority.
- D96 stale-GameObject discipline is applied consistently but ad hoc (per-field comments);
  no unguarded instance found. No action beyond awareness.

---

## Tier C — terminology (rank = confusion ÷ blast radius)

Dominant conventions are real and worth ratifying in `docs/design/glossary.md`:
**`kind`** for discriminants · **`*Def`** for authored registry records · verb ladder
**`resolve`** (compute outcome) / **`apply`** (mutate per effect) / **`use`** (skill-invocation
entry) / **`play`** (node/route orchestration) · **`*Tier`** noun + **`band`** quantizer ·
**`node-step`** as the overworld clock unit · **`party`** (run-scoped fielded group) vs
**`roster`** (guild-scoped stable) vs **`pool`** (hire candidates).

Renames, ranked:
1. `Camp.gold` → `Camp.purse` — the field's own doc calls it "the run purse"; aligns with
   `Caravan.purse`/`ExpeditionBundle.purse`. Widest blast radius on the list; batch alone.
2. `activeRoster`/`combatRoster` → `activeParty`/`combatParty` (`run.ts:356,365`) — they read
   `run.party`; removes the roster/party conflation at its hottest call site.
3. `EncounterDef.type`/`NightRecord.type`/`encounterType` → `kind` — the one `type` holdout
   against the `kind` convention; mechanical, checker-guided.
4. `EnemyTemplate` → `EnemyDef` — the codebase's only `*Template`, same file as `EncounterDef`.
5. `bribeCost` → `bribePrice` — matches `merchantPrice`/`sellPrice` ("resolved number the
   player pays").
6. `fatigue.ts` `level` params → `fatigue` — collides with the unrelated `Unit.level`.
7. `PlaytestEvent.at` → `kind` — the lone third discriminant name; debug-only file.
8. `tickDyingClocks` → a night-suffixed name — `tick` currently serves four different clocks
   (CT · combat-turn · night · node-step), disambiguated only by docstrings.
9. Doc-only (free): fix `RunState.party`'s "persistent party roster" comment; purge the dead
   `takeOverworldAction`/`useCampSkillAtNode` verb names from `overworld-actions.ts:243` prose;
   the A4 stale comments.
- **Defer**: `floor`'s five meanings (baseline / clamp-min / range-bound / prose threshold) —
  real but renames would churn `intelFloor`/`merchantFloor` public surface for modest gain;
  glossary entry instead. `Spec`-vs-`Def` unification beyond `EnemyTemplate` (7 `*Spec` types,
  `UnitSpec` imported everywhere) — glossary rules for *new* types; migrate opportunistically.

---

## Wave 1 — SHIPPED (2026-07-20, D114) with challenge revisions

A `memento:challenge` pass ran before build; three plan claims were revised by it:
- **A1 upgraded:** `variance` defaults to 0 and nothing in the production path sets it, so
  `Battle.roll` never draws headlessly — the salt fix is *provably* sim/vitest-invisible
  (the "maybe re-pin sim" hedge was unnecessary). Verified: digest byte-identical.
- **A4c reversed:** `registerEvent`'s idempotency-by-id is deliberate (double-load safety);
  making it throw would break that. Landed instead as a reference-equality completeness
  test that catches the silent-shadowing case the idempotency hides.
- **A4a narrowed:** the captive `0x9a6bc0` was a token typo (fixed → `COLOR.captive`); the
  lever `0x62c6d6` is a distinct shade from `INK.cyan`, not a typo — left alone.
- **Owner's "perfect model file" suggestion revised to *point, don't create*:** a synthetic
  exemplar is a drift surface nothing executes (this audit's own exhibits: two stale doc
  comments contradicting shipped design) and would trip the export-surface guards. The
  conventions doc (`docs/design/implementation/conventions.md`) cites living, guard-covered
  exemplars instead; CLAUDE.md, the glossary, and the level-author brief now point at it.

Landed: the battle salt + divergence guard · `saltSeed` + 4 registered labels + recursive
core+game guard globs (now scanning `saltSeed(` too) · `registry-contracts.test.ts` (zero
drift found; tripwire keeps it) · GuildScene banner on `showModal` + `test:e2e:guild-banner`
in CI (the hall's first e2e) · stale docs fixed (`turn.ts` salt claim, D73 surcharge remnant).

## Suggested sequencing

Each wave keeps all guards green (`build` · `test` · `sim` · e2e suites · `audit:visual`);
sim re-pin only where a wave is *expected* to move rewards/routing (none should except
possibly Wave 1's A1).

1. **Wave 1 — correctness + tripwires** (A1–A4, B2's guard test, A3's guard widening).
   Highest value, smallest diffs, and the tripwires protect every later wave.
2. **Wave 2 — mechanical consolidation** (B3 num.ts swaps + `pct`; B1's straggler shapes
   *except* bribe/story which need design calls; registry contract alignment).
3. **Wave 3 — render extraction** (B4: hpBar, chip, showModal completion, DEPTH, escClose).
   Follow with `audit:visual` + the e2e sweeps; these are the surfaces headless tests miss.
4. **Wave 4 — renames** (C list top-down; `Camp.gold`→`purse` as its own PR).
5. **Design calls to make before/while Wave 2** (owner input): story short-pay vs refuse
   (B1); whether bribe's tri-state becomes an explicit status enum; whether the battle-seed
   fix should also salt by night (re-entry semantics).
