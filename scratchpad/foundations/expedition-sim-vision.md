# Expedition-sim: a headless expedition-analysis engine

**Status:** in build (Phase 1). **Branch:** `claude/node-testing-tooling-voev53`.
**Owner of vision:** the orchestrating session; phases implemented by subagents.

## The vision (why this exists)

Demo-testing needs to **jump straight to a node** in a representative arrival state
instead of replaying the whole run every time. The same machinery — enumerate
routes, traverse headlessly, sample a population, score/aggregate — is also exactly
what's needed to **validate a future procedural quest generator** (is the expedition
feasible? where are the corner cases?).

So the thing we are building is **one headless expedition-analysis engine with two
front-ends**:

- **Jump tool** (demo-testing) — reads *percentiles* of a sampled population to boot
  best / average / worst-survivor arrivals at a node; also supports exact, named
  hand-picked scenarios.
- **Validator** (future quest generation) — reads *aggregates + invariant violations*
  over the same population to report feasibility, balance curve and corner cases.

```
generate/author an AuthoredExpedition
        │
        ▼
  expedition-sim  ── enumeratePaths / traverseRoute / playToTerminal / samplePopulation
        │                                  │
        ▼ (percentiles)                    ▼ (aggregates + invariants)
   arrivals (jump tool)             feasibility (validator)
```

## Load-bearing design rule

**The engine is expedition-generic from line one.** Every function takes an
`AuthoredExpedition` (or a `() => RunState` factory) — it NEVER hardcodes
`THE_HOLLOW_MILL`. Hollow Mill is only ever the *first argument* / the test fixture.
This is the single decision that makes the future generator validator free; retrofitting
genericity later is the painful path. (`validateExpedition` in `expedition.ts` is the
generic *structural* check; this engine is its *dynamic*, played-through counterpart.)

## Conventions (match the codebase)

- Pure logic only: no Phaser, no DOM, no `Math.random`. Determinism is load-bearing.
- House style: thorough JSDoc headers on every module + exported symbol (see
  `run.ts`, `runloop.ts`, `hollow-mill.ts` for the voice).
- Each new core module is wired into the barrel `src/core/index.ts` via `export *`.
- Tests with vitest (`npm test`), and `npm run build` (tsc + vite) must stay green.
- Reuse existing primitives — do not reinvent: `createRunFromExpedition`/`createRun`
  (`run.ts`), `RunLoop` (`runloop.ts`: `choose`, `playCurrentNode`, `autoTraverse`,
  `autoBattle`, `policy`), `PILOT_POLICY`/`BattlePolicy` (`ai.ts`), `OverworldMap`/
  `MapNode`/`getNode`/`reachableFrom`/`isFinalNode` (`overworld.ts`), `createUnit`/
  `grantXp`/`grantItem`/`autoTrim`/fatigue bands/camp helpers, `validateExpedition`
  (`expedition.ts`), `nodeAccessible`/`reachableNodes` (`run.ts`).

## Key facts

- `RunState` is plain serializable data; `RunLoop` is the stateful driver.
- `createRunFromExpedition(exp)` boots a run on the hand-built map using `exp.seed`.
  For the **variety knob**, the engine re-seeds the run per sample (a `seedSalt`):
  same authored map/encounters, different combat tie-breaks/variance. Implement a
  small builder that mirrors `createRunFromExpedition` but with a salted seed
  (`` `${exp.seed}#${salt}` ``) when a salt is given.
- An **arrival** = run positioned *at* the target node, **pre-resolution** (route's
  predecessors played, target chosen but not yet played). Works for combat/rest/event
  targets, and can be parked on `OverworldScene` or handed to `BattleScene`.
- `nodeAccessible` (`run.ts`) gates edges on run state (e.g. `medic-freed` drops the
  secured-wagon edge) — a place a generator could strand a player; the validator must
  respect it.

## Phases (each lands green; session reviews before the next)

1. **Engine core (generic):** `enumeratePaths`, `enumerateCompletions`,
   `traverseRoute`, `Arrival`, `TraverseOpts`, salted-seed builder. + tests. This is
   also the hand-picked-scenario substrate/fallback.
2. **Jump boot seam + harness `jumpTo`:** `#demo?node=…&route=…&salt=…` boot via a
   `JumpBootScene`; consolidate the duplicated `navTo` (`harness.mjs`,
   `shots-hollow-mill.mjs`) into one `jumpTo`.
3. **Population + scoring:** `samplePopulation` (routes × salts × policies),
   `scoreArrival` (default strength-weighted; weights overridable). + tests.
4. **Magic button:** `pickRepresentatives` → best (p95) / average (p50) /
   worst-survivor (p5, losses excluded); `#demo?node=…&arrival=best|average|worst`.
5. **Validator:** `playToTerminal`, an extensible **invariants** module, and
   `analyzeExpedition(exp) → FeasibilityReport` { completable, completingRoutes,
   perNode survival/casualties, unreachablePayloads, violations[], determinismOk,
   sampling{routesSampled,capped} }. CLI/test harness.
6. **Future:** point `analyzeExpedition` at a real `generateExpedition()` output — no
   engine change needed.

## Scale caveat (and itself a corner case)

Full path enumeration is exponential in branchiness. Hollow Mill is tiny, but the
engine must **bound enumeration and sample routes** past a cap — and **report the cap**
(`sampling.capped`), never silently analyze a fraction and call it complete.

## Honest caveats to keep visible

- Scoring is a heuristic; the default encodes "strongest run," which may not equal
  "best *demo*" (a tense near-loss can be the better showcase). Weights are a dial; a
  drama-weighted pass is a deferred follow-up.
- The three picks separate only as much as the population varies; the jump tool/report
  surface `stats`/`sampling` so a collapse is visible, not hidden.

## Git

Subagents implement + verify green but **do not commit or push** — the orchestrating
session reviews and commits per phase (clean history + correct trailers).
