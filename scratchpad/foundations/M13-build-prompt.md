# M13 Build Kickoff — The overworld economic layer (ledger · lifecycle · recovery · forecast/fog)

A self-contained brief to **begin implementing M13**. The design is **finalized** (D45–D48,
written into the system specs) — do not re-litigate it; build it. Read these first, in order:

1. [`decisions.md`](decisions.md) → **D45** (the economic ledger), **D46** (the node
   lifecycle / phase contract), **D47** (the two-tier recovery economy), **D48** (the route
   forecast + overworld fog) — and their predecessors **D15** (Upkeep), **D9** (RP recovery),
   **D10/D24** (intel tiers + node preview), **D28** (gold as routing currency), **D34** (two
   pools), **D35** (camp at every node).
2. The specs (each section is a build target):
   - [`docs/design/systems/overworld.md`](../../docs/design/systems/overworld.md) → "The node
     lifecycle (D46)", "The economic ledger (D45)", "The two-tier recovery economy (D47)",
     "The route forecast & overworld fog (D48)".
   - [`docs/design/systems/intel.md`](../../docs/design/systems/intel.md) → "Two axes: depth &
     reach (D48)".
   - [`docs/design/systems/logistics.md`](../../docs/design/systems/logistics.md) → "Recovery
     is a spend; the forecast reads the burn (D47, D48)".
3. [`overworld-ideas.md`](overworld-ideas.md) → **Q17–Q20** (the reasoning trail, if you want
   the "why").

**Continue on branch `claude/jolly-volta-euogwo`** — the D45–D48 design + specs live here and
are **not yet on `main`**, so build on this branch to inherit them (do **not** branch off
`main`). Repo is at **end-of-M12** (M1–M12 shipped & green; **325 tests**). Add an **M13** row
to [`plan.md`](plan.md) as part of this work.

## Goal

Make the overworld's **economic routing** legible and playable: a purse-scoped **ledger**
(reconcile + forecast) on the unified camp (M8/D35), a clean **node lifecycle** (Make Camp →
End the Night → event → Survey → Break Camp, one node-step, tick at departure), a **two-tier
recovery** economy (repeatable in-place rest vs. the premium rest node), and an **intel-banded
forecast** under a new **overworld fog**. The decisions are the spec; the user-testable gate
(below) is the definition of done.

## Architectural rules (non-negotiable)

- **Core/render split (D2):** all logic in `src/core/` (plain TS, headless, no Phaser/DOM);
  Phaser only in `src/game/`. Export new modules via `core/index.ts`.
- **Determinism (D22):** no live RNG in core — the `core/`-has-no-`Math.random` grep test must
  stay green. Fog/forecast are **pure projections** (BFS over the seed-built map), like
  `previewNode`.
- **Projection, not new state (D45/D48):** the ledger, forecast and fog are **read-models**
  over existing `run` state — reuse `computeUpkeep`, `rpPerNight`, `triageHeal`, `rewardHint`,
  `reachableFrom`. Add new *state* only where a decision names it (the voluntary-skip seam; any
  node-fee data).
- **Data, not branches (D4):** node fees and the recovery/reach magnitudes are **records /
  named constants** — balance is a later numbers pass, not a reshape.
- **Test-first discipline:** every core module ships a `*.test.ts`; a phase isn't done until
  `npm test` + `npm run build` are green.

## Build order (dependency-phased; each phase lands green)

> Core first, render interleaved. The one **structural refactor** is moving the node-step tick
> to *departure* (D46) — call it out early; it touches `runloop`/`run` and `autoTraverse`.

**Phase 1 — recovery economy + the upkeep input (core).** *(D47, D45 voluntary underfunding)*
- `upkeep.ts`: `payUpkeep` accepts **voluntarily-skipped line ids** (vs. deriving `underfunded`
  purely from affordability); the broke-fallback behavior stays. This is the "ledger as input"
  seam (D45).
- `upkeep.ts` / `runloop.ts`: **in-place rest** — pay a night's rations → `rpPerNight` → a
  *small* `triageHeal`; **floors at ≥1** on a wounded party; **refuses when already full** (no
  spend); **repeatable**. Rate-capped by per-night RP. The **rest node** becomes the
  **premium** tier: large/full heal **+ full fatigue restore** (stays rest-node-only) **+
  clear accumulated Upkeep debt** (hunger / worn gear) in one swipe. All magnitudes are named
  constants.
- *Tests:* a voluntary skip frees gold + applies the morale/gear consequence; a can't-afford
  skip still breaches; in-place rest heals ≥1 and refuses at full; repeated rests drain the
  purse and stop when broke; the rest node full-heals + restores fatigue + clears debt.

**Phase 2 — overworld fog + the route forecast (core).** *(D48)*
- Visibility: `visibleNodes(run)` — a BFS forward from the current node, cut at
  `baseReach + tier × bandStep` (named constants; base ≈ half the map; tunable to ∞), with the
  **immediately-reachable nodes always included**. Pure.
- Node fees: a **visible, known** fee on special nodes (a `fee` field and/or a `toll` event
  kind reusing M11) — deterministic, shown in advance, routed-around.
- `forecast.ts`: `projectForecast(run)` → `{ visibleNodes, runway: { burnPerStep,
  nearestRestSteps, purseAtRest }, perEdge: [{ nodeId, costKnown, lootBand, purseAfter:
  {floor, ceiling}, warn }] }`. Cost = `upkeep × steps + visible fees`; loot = **intel-banded
  range** (never beyond the player's tier); `warn` evaluates on the **pessimistic** floor.
- *Tests:* fog widens by intel tier and always shows the immediate choices; a fee shows in the
  forecast and is avoidable on an alternate edge; loot never reveals beyond tier; the warning
  fires on the floor and **clears when intel raises the floor**; nearest-rest BFS respects fog.

**Phase 3 — the ledger projection + the soft gate (core).** *(D45)*
- `ledger.ts`: `buildLedger(run)` → **purse-scoped** categories (Upkeep / Loot / Field spend /
  Banker / balance) with totals **and** line items, embedding the Phase-2 forecast. Influence
  shown but **never summed into gold**.
- `nightEndGate(run)` → `{ warn, reasons }` — intent-aware: a projected shortfall /
  can't-afford-the-rest / outstanding debt / a **non-voluntary** underfunded line warns; a
  deliberately unticked line does **not**.
- *Tests:* categories sum to the balance; expand exposes the Upkeep lines; the gate warns on a
  real shortfall but stays quiet on a voluntary skip; Influence never enters the gold total.

**Phase 4 — render (`OverworldScene`) + the lifecycle.** *(D45, D46, D47, D48)*
- **Lifecycle (D46):** add the **Survey** post-event beat (after Resolution / rest / event,
  before returning to the map): scout, **in-place rest**, the forecast. Rename the gates —
  **"End the Night"** (prep→event) and **"Break Camp"** (depart→next). **Move the node-step
  tick (`recordNight` → `tickCooldowns` + `accruePurseInterest`) to departure** (the
  structural refactor); keep `autoTraverse` and its tests green.
- **Fog (D48):** a visibility pass in `drawMap` — mask nodes outside `visibleNodes` (silhouette
  / hidden), immediate choices always drawn.
- **Ledger (D45):** promote `refreshCampText` into a **panel** with broad totals + expand;
  the always-available glance + the **soft gate** on Break Camp; **jump-to-market** when
  usable.
- **Recovery (D47):** an in-place **Rest** button in Survey (repeatable, shows cost/heal,
  greys at full / when broke).
- *Render has no rules* — every number flows through the Phase 1–3 core.

**Phase 5 — the in-browser gate + wrap.**
- Confirm the **M13 gate** (below) in-browser; then PROGRESS M13 → done, flip the plan.md row;
  (on go-ahead) open the PR.

## Done-When

`npm test` green (recovery + voluntary skip, fog/forecast banding + floor-warning, ledger
categories + intent-aware gate); `npm run build` clean; `core/` free of Phaser/DOM **and**
`Math.random`; and the **M13 user-testable gate** confirmed in-browser:

> Start a seeded run → at a node, open the **ledger** (broad totals, expand to lines) → see the
> **fog** hide deep nodes and **widen with intel** → read the **forecast** on a reachable edge
> (a banded purse-after with a floor-based warning that **clears after you scout**) →
> **in-place rest** to heal (repeatable, costs rations, ticks cooldowns) → **voluntarily skip
> Food** to afford a buy and watch the gate *not* nag → **Break Camp** and see one node-step
> pass (cooldowns tick at departure) → route to a **rest node** for the premium full heal +
> debt clear.

## Deferred (out of M13 scope — leave parked)

- **Tuning numbers**: reach `base`/`bandStep`, node-fee amounts, in-place-rest heal size, the
  gold-as-HP balance (a dedicated numbers pass).
- Whether **Scout** extends *reach* or only *depth* (lean: reach = passive Int + Seer; Scout
  deepens a node).
- The richer **fee event** (pay-the-toll-or-fight-the-guards choice) — folds into the deferred
  event batch (D23/D30).
