# Kickoff — the visual scenario harness (boot an arbitrary encounter)

> Brief for issue **#170**. The visual twin of the headless `stageEncounter`: boot `BattleScene`
> onto an **arbitrary** `AuthoredEncounter` + party from a config, for isolated, screenshottable
> scenes. **Design-first: do NOT edit gameplay code until the plan is agreed.** Investigation →
> agreed plan → incremental PRs. This brief encodes the design the kickoff session converged on.

## Why (the motivation)

To screenshot the D90 cuffed captive we had to **hijack the live E1 node** and mutate it via
`bsEval`. Every future board feature — a new status, objective, ability, and the whole
**status-model track** — wants an *isolated scene from a config*, not a live-run hijack.

## Read first (canon)

- The **back-half arc plan** ([`hollow-mill-backhalf-arc-plan.md`](hollow-mill-backhalf-arc-plan.md))
  and **D90** ("Pick the Cell" — the lean infiltration taste, shipped #167). This harness is the
  tooling that lets D90-style board features be shot in isolation.
- `decisions.md` **Roadmap → "The visual scenario harness"** (the design-agreed record).
- Code seams:
  - `src/core/staging.ts` — `stageEncounter(source, roster, opts)` is already the headless
    "scene from config."
  - `src/core/runloop.ts` — `RunLoop.startEncounter()` (reads the run's intel/gear/morale/seed).
  - `src/core/run.ts` — `createRunFromExpedition`; `src/core/expedition.ts` — `registerExpedition` /
    `AuthoredExpedition`; the one-node-map pattern in `combat-xp.test.ts`.
  - `src/game/boot/debug.ts` — `buildDebugBattle` + the `#battle`/`#debug` boot scenes (the analog).
  - `src/game/config.ts` — the `#…` hash routing table (where `#scene` slots in).
  - `src/core/taste-infiltration.test.ts` — the fixture to **promote** as scenario #1.

## The gap (this issue)

A **run-less boot**: `buildScenarioBattle(config)` (a *synthetic one-node run*) + a `#scene=` route
+ a small scenario registry. Promote the taste fixture as the first entry, so **one config drives
both the headless test and the visual harness**.

## The approach (agreed — do not re-litigate)

`BattleScene` is **tightly coupled to `RunLoop`**: `init(RunHandoff = { run, loop, … })`, and
`create()` calls `loop.startEncounter()` + reads `run.*` widely. So the clean move is **not** to
decouple the renderer (that fattens the thin scene) — it is to **synthesize the run** the scene
already consumes:

- A single-node `OverworldMap` where **start == final == a `combat` node** (`authoredId: "scene"`).
- A **lazily-registered** throwaway `AuthoredExpedition` (`id: "scenario:<id>"`,
  `encounters: { scene: config.encounter }`, bundle = the party specs + knobs).
- `createRunFromExpedition` → `new RunLoop`. The run parks *on* the combat node, so
  `BattleScene.create()` → `loop.startEncounter()` stages it with **zero scene changes**.

Registration is **lazy** (inside the builder, never at import) so the expedition catalog and the
`sim` guard stay clean.

### Config = the single shared truth (party matrix)

```ts
interface ScenarioConfig {
  id: string;
  name: string;
  encounter: AuthoredEncounter;
  parties: Record<string, UnitSpec[]>;  // named variants, e.g. { thief: [...], scout: [...] }
  defaultParty: string;                 // which variant the visual harness boots
  seed?: string | number;
  gold?: number; morale?: number;
  supplies?: Record<string, number>; storageCap?: number; difficultyId?: string;
}
```

The **party matrix** lets the headless test (thief frees the cell; scout is refused) and the visual
harness pick from **one** list. `buildScenarioRun(config, party = config.defaultParty)` → `{ run, loop }`.

## Deliverable / plan (incremental PRs, guards green each)

- **PR-1 (core, headless):** `src/core/scenario.ts` — `ScenarioConfig` + `buildScenarioRun` +
  the single-node-map helper; `src/core/scenarios/` registry with `pick-the-cell` promoted out of
  `taste-infiltration.test.ts`; repoint that test to the shared fixture; `scenario.test.ts` (stages
  the right encounter, parks on combat, thief fields the freed captive, scout does not); update
  `barrel-surface.test.ts` for the new exports. Docs: this brief + the `decisions.md` candidate.
- **PR-2 (game, visual):** `buildScenarioBattle(id, party?)` in `debug.ts` → `RunHandoff`; a
  `ScenarioBootScene` that renders a `DebugBootScene`-style **clickable menu** on bare `#scene` and
  boots straight in on `#scene=<id>[&party=<name>]`; the routing + parse in `config.ts`; an e2e smoke
  booting `#scene=pick-the-cell` and asserting the board (and the lock glyph / bound captive) renders.

## Red-team flags (pressure-test in build)

1. **BattleScene's unaudited reads off a synthetic run** — the one real risk. Empty intel / 0 morale /
   empty inventory *should* be safe; the **PR-2 e2e boot is the proof**, and any gap is fixed by a
   **config default**, not a scene change.
2. **Resolution is out of scope** — this stages/renders for screenshots; playing a one-node run to
   win/loss (which hits `returnToOverworld` on a complete run) is a **later** ask, not this.
3. **No `sim` digest move** — the taste encounter is a test fixture, not wired into any live map;
   moving it to a registry does not touch routing/rewards. Re-run `sim` to confirm.

## Working rules

- Investigation → **agreed plan** → incremental PRs. Pure logic in `src/core` (headless, tested);
  the scene stays a thin renderer. Determinism: no `Math.random` in `core/`.
- Guards green every PR: `tsc` · `vitest run` · `npm run build` · e2e · `npm run sim`.
- **Review cadence:** settle a decision (or batch) → adversarial red-team → finalize/revise.
