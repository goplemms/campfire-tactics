# Guide — Adding a scenario (the visual harness)

> Audience: anyone building a board feature (a new status, objective, ability,
> enemy, deploy affordance) who wants to **see and test it in isolation** — without
> hijacking a live expedition node. Assumes the codebase after the scenario harness
> (#170). Design rationale lives in [`docs/design/`](../design/); this is the
> *how-to*. For the encounter/party data shapes it composes, see
> [`adding-a-class.md`](adding-a-class.md) and the `AuthoredEncounter` type.

A **scenario** is **data** (a `ScenarioConfig`): an [`AuthoredEncounter`](../../src/core/authored.ts)
plus a **party matrix**. From that one config, two consumers run the *same* board — a
headless `vitest` and the visual `#scene=<id>` harness — so a feature is proved in
core **and** looked at on a real screen from a single source of truth. The harness
boots the board **run-less**: it synthesizes a one-node run the unchanged
`BattleScene` already knows how to stage, so **no scene edits** are needed to see a
new board.

> **Why this exists.** Before it, screenshotting a board feature meant booting the
> live Hollow Mill, walking to a node, and mutating it via `bsEval` (e.g. marking a
> captive cuffed by hand). That hijack was fragile and lied about the real data. A
> scenario is the genuine article, isolated. **Reach for a scenario before mutating a
> live node in a test.**

## The mental model

```
ScenarioConfig ──has──▶ encounter: AuthoredEncounter + parties:{ name→UnitSpec[] } + defaultParty
   │                                    │
   │ listed in SCENARIOS                │ consumed two ways off ONE config:
   ▼                                    ▼
scenarios/index.ts       headless → buildScenarioRun(config, party?) → { run, loop }   (vitest)
                         visual   → #scene=<id>[?party=<name>]        → BattleScene      (browser)

buildScenarioRun: a single-node OverworldMap (start == final == combat, authoredId)
   → registerExpedition (LAZY — only here) → createRunFromExpedition → new RunLoop
   → the { run, loop } BattleScene stages in its create(). The scene is untouched.
```

### The canonical example (`scenarios/pick-the-cell.ts`)

The D90 infiltration taste: a **cuffed** captive (`release: lockpick`) behind a
corner guard, a modest garrison, win = `eliminate-all`, and a two-arm party matrix —
`thief` (holds Expert Lockpick → picks the cell at deploy) and `scout` (no lockpick →
refused, runs the frontal fight). It is the first `SCENARIOS` entry and drives both
[`taste-infiltration.test.ts`](../../src/core/taste-infiltration.test.ts) (headless)
and [`e2e-scenario.mjs`](../../scripts/e2e-scenario.mjs) (visual). Copy it.

---

## The recipe (3 small parts)

### 1) Data — the config (encounter + party matrix)

Author a `ScenarioConfig` beside `pick-the-cell.ts`. The encounter is a plain
`AuthoredEncounter`; the **matrix** carries the party variants your feature
distinguishes (the arm that triggers it vs. the arm that doesn't), so the test and
the harness pick from one list.

```ts
// src/core/scenarios/my-feature.ts   (pure data — NO side effects at import)
import type { ScenarioConfig } from "../scenario";
import type { AuthoredEncounter } from "../authored";
import type { UnitSpec } from "../units";

const STATS = { speed: 12, maxHp: 24, attack: 9, defense: 3, moveRange: 4, sightRadius: 5 };

export const MY_FEATURE_ENCOUNTER: AuthoredEncounter = {
  id: "my-feature", name: "My Feature (scenario)", cols: 8, rows: 5, blocked: [],
  playerSpawns: [{ col: 0, row: 1 }, { col: 0, row: 2 }],
  enemies: [{ templateId: "bandit-thug", pos: { col: 6, row: 2 } }],
  reward: { gold: 40, materials: [], xp: 40 },
  // + captives / traps / objectives as your feature needs
};

export const MY_FEATURE: ScenarioConfig = {
  id: "my-feature",
  name: "My Feature (scenario)",
  encounter: MY_FEATURE_ENCOUNTER,
  parties: {
    with: [{ id: "hero", side: "player", pos: { col: 0, row: 0 }, jobId: "soldier", primaryJob: "soldier", ...STATS }],
    without: [/* the arm that does NOT trigger the feature */],
  },
  defaultParty: "with", // the arm the visual harness boots by default
  // optional knobs: seed?, gold?, morale?, supplies?, storageCap?, difficultyId?
};
```

### 2) Register — list it in `SCENARIOS`

One line in [`scenarios/index.ts`](../../src/core/scenarios/index.ts). This is a
**pure-data** registry — do **not** call `registerExpedition` here (that happens
lazily, inside `buildScenarioRun`).

```ts
import { MY_FEATURE } from "./my-feature";
export * from "./my-feature";

export const SCENARIOS: Record<string, ScenarioConfig> = {
  [PICK_THE_CELL.id]: PICK_THE_CELL,
  [MY_FEATURE.id]: MY_FEATURE,   // ← add this
};
```

New runtime exports (`MY_FEATURE`, `MY_FEATURE_ENCOUNTER`) cross the core barrel, so
add them to `EXPECTED_BARREL_SURFACE` in
[`barrel-surface.test.ts`](../../src/core/barrel-surface.test.ts) in the same commit
(the test names the delta). Type-only exports (like `ScenarioConfig`) don't count.

### 3) Test it — headless + visual, off the same config

**Headless** (`vitest`) — drive the board through core, either `stageEncounter`
directly (like `taste-infiltration.test.ts`) or the full `buildScenarioRun` run path:

```ts
import { buildScenarioRun } from "./scenario";
import { MY_FEATURE } from "./scenarios";

const battle = buildScenarioRun(MY_FEATURE, "with").loop.startEncounter();
// … assert your feature's effect on battle.units / objectives …
```

**Visual** (`npm run test:e2e:scenario`, or a new script) — boot the real
`BattleScene` in a headless browser via the arbitrary-hash harness and assert on the
rendered scene. `withGame({ hash })` boots any hash; `g.boot(hash)` re-boots (e.g. to
switch party arm); `g.bsEval(...)` runs inside the live `BattleScene` (`s`).

```js
await withGame(async (g) => {
  await sleep(1300);                    // ScenarioBootScene → BattleScene → deploy
  const st = await g.bsEval(`return { phase: s.phase, /* … */ };`);
  check("the board renders", st.phase === "deployment");
  await g.boot("#scene=my-feature?party=without");   // the other arm, same board
  await g.screenshot(path.join(OUT, "my-feature.png"));
}, { hash: "#scene=my-feature" });
```

---

## Driving the harness (dev + screenshots)

| Hash | Boots |
|---|---|
| `#scene` | the **picker** — one clickable row per scenario × party arm |
| `#scene=<id>` | that scenario, `defaultParty` |
| `#scene=<id>?party=<name>` | that scenario, a named party arm |

The route is dev-only (like `#battle`/`#debug`), wired in
[`config.ts`](../../src/game/config.ts); the boot seam is
[`ScenarioBootScene` / `buildScenarioBattle`](../../src/game/boot/debug.ts).

## Invariants the harness enforces (don't fight them)

- **Fail-loud (R1).** `buildScenarioRun` runs `validateExpedition` and **throws** on a
  malformed config; an unknown `party` name **throws** (no silent default). A typo
  surfaces at build time, not as a confusing mid-boot crash.
- **Default gold ≥ upkeep (R2).** `gold` defaults to `DEFAULT_SCENARIO_GOLD`, above any
  small party's Upkeep, so a boot never stages the board with a spurious
  "underfunded → morale took a hit" note. Override only deliberately.
- **Pure-data registry / lazy registration (R3).** `scenarios/` has **no** import-time
  side effects; only `buildScenarioRun` registers the throwaway expedition. This is
  what keeps the expedition catalog and the **sim digest** clean — a scenario module
  is inert until a harness/test asks for it.
- **Staging, not resolution (R4).** The harness stages and renders a board for
  inspection. Playing a one-node run *to a win/loss* resolves out to the overworld
  terminal — fine to drive in a test, but it is **not** what a screenshot scenario is
  for; keep smokes to "boots → renders → shows the affordance".

## Gotchas & conventions

- **Config is data; keep `core/` pure.** No Phaser/DOM and no `Math.random` in
  `src/core` — the scenario builder is deterministic (same config + seed → identical
  staged positions). Variety is a knob, not a random draw.
- **The scene is a thin renderer — don't touch it.** A new board should need **zero**
  `BattleScene` edits. If it seems to, the missing piece almost certainly belongs in
  core (`staging.ts` / the encounter data), not the scene.
- **Unique ids.** Party `UnitSpec` ids, enemy ids, and captive ids must not collide
  within one config (the run builds them all into one `Battle`). Reuse of an id
  across *party variants* is fine — each build makes fresh units.
- **Native affordances draw themselves.** State-driven render layers key off the data
  — e.g. `enterDeploy()` auto-marks a cuffed captive's lock glyph. If your feature's
  glyph/tint doesn't appear on boot, the render read is missing, not the scenario.
- **Prefer a scenario over a live-node hijack.** If a test mutates a live expedition
  node to fake a state, that state wants to be a scenario instead (see #170's
  retirement of the E1 cuffed-captive hijack).

## File map

| Concern | File |
|---|---|
| The builder + `ScenarioConfig` + `DEFAULT_SCENARIO_GOLD` | `src/core/scenario.ts` |
| The registry (`SCENARIOS` / `getScenario` / `listScenarios`) | `src/core/scenarios/index.ts` |
| A scenario's data (the example) | `src/core/scenarios/pick-the-cell.ts` |
| The barrel-surface pin (add new runtime exports) | `src/core/barrel-surface.test.ts` |
| Headless tests | `src/core/scenario.test.ts`, `src/core/taste-infiltration.test.ts` |
| The game boot + `#scene` route/menu | `src/game/boot/debug.ts`, `src/game/config.ts` |
| The visual e2e smoke + browser harness | `scripts/e2e-scenario.mjs`, `scripts/harness.mjs` |
