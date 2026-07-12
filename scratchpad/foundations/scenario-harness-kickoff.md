# Kickoff — A visual scenario harness (boot an arbitrary encounter for isolated testing)

> Paste into a fresh session on a new branch. Tooling: let us stage **any** board from a config
> (units · layout · items · objective) and *see* it, without threading it through a full run first —
> the visual twin of the headless `stageEncounter`. **Do NOT edit code until a plan is agreed.**

## The motivation
To screenshot the D90 cuffed captive we had to **hijack the live E1 node** and mutate it via `bsEval`
(set `release`, transiently grant a unit the Thief job). That's the smell: there's no way to boot the
scene onto an *arbitrary, ad-hoc encounter*. Every future board feature (a new status, objective,
ability, the whole status-model track) wants an isolated, screenshottable scene from a config.

## Read first — most of this already exists
- `src/game/boot/debug.ts` — the scene-boot harness: `buildDebugBattle()` builds a `RunHandoff` and
  boots `BattleScene` via URL hash (`#battle`); there's a **jump tool** (`node`/`route`/`salt`) too.
  **But it's anchored to the live Hollow Mill expedition** — it assembles a real caravan and parks on
  a real combat node. There is no "stage *this* arbitrary encounter" path. That's the whole gap.
- `src/core/staging.ts` — `stageEncounter(AuthoredEncounter, party, opts)`: the **headless** "arbitrary
  scene from config" already exists (D90 PR-2 used it directly).
- `src/core/authored.ts` — `AuthoredEncounter` **is** the config format (board · enemies · captives ·
  traps · objectives · reward); a party is `UnitSpec[]`; items are the inventory.
- `src/game/scenes/BattleScene.ts` — `init(data: RunHandoff)` / `create()` (stages from the handoff's
  loop node). `src/game/boot/demos.ts` — the sibling demo-boot pattern.
- The **taste fixture** currently lives in `src/core/taste-infiltration.test.ts` (trapped in a test) —
  promote it to the first shared scenario.

## The first move (deliver a design + plan — no code)
1. **`buildScenarioBattle(config)`** — wrap an arbitrary `AuthoredEncounter` + party (+ optional
   inventory/morale) into a minimal `RunHandoff` (a synthetic **one-node run**), reusing the
   `buildDebugBattle` assembly pattern. The one real bit of plumbing: standing up a minimal run/loop
   around a standalone encounter (the run expects some caravan/camp scaffolding).
2. **A `#scene=<id>` boot route** in `debug.ts` + a small **scenario registry** of named fixtures.
3. **Promote the taste fixture** into the registry as the first entry, so the *same* config drives the
   headless test **and** the visual harness (single source of truth); point a `shots`/e2e stage at
   `#scene=taste-cell-block` instead of hijacking E1.
- **Design call to settle first (JIT):** how much beyond `AuthoredEncounter + party` the config needs
  on day one (inventory items? starting morale / intel tier?). Start minimal, extend at use sites.

**Deliverable:** the config shape + the `buildScenarioBattle` seam + the registry + the harness wiring,
as a design + build plan (PRs · tests · guards). Flag any BattleScene assumption that resists a
run-less boot — that's the real risk to surface early.

## Working rules
- Investigation → agreed plan → incremental PRs. Pure logic stays in `src/core`; this is `src/game`
  tooling over it. Determinism: no `Math.random` in `core/`.
- Guards green every PR: `tsc` · `vitest run` · `build` · e2e (the harness's natural home) · `sim`.
