# Combat-Actions Build Kickoff — Phase 1: command interpreter + action log

A self-contained brief to **begin implementing Phase 1** of the combat-actions system.
The design is **evaluated and written up** — build it, don't re-litigate it. Read first,
in order:

1. [`docs/design/systems/combat-actions.md`](../../docs/design/systems/combat-actions.md)
   — the full design (motivation, the `CombatAction` + `Battle.apply` interpreter, the
   action log, the `replay(log) === state` invariant, and the explicitly-deferred Phase 2
   undo). **This is the spec.**
2. [`docs/design/systems/purse-journal.md`](../../docs/design/systems/purse-journal.md)
   — the sibling substrate (built in this branch); same "substrate first, feature later"
   philosophy. Useful as a worked precedent.
3. The code seams you'll touch: `src/core/turn.ts` (the `Battle` driver — `moveUnit` ·
   `attack` · `useSkill` · `cleave` · `endTurn` · `runEnemyTurn`), `src/core/ai.ts`
   (`AIPlan`, which already lowers to the primitives), `src/core/events.ts` (the bus).

**Branch:** start a new feature branch **from the commit that carries the design docs**
(`claude/job-actions-review-28gszm`, or off `main` once that branch has merged) — the
`combat-actions.md` spec must be present. Repo state: **528 tests green** at the start.
Do **not** branch off a `main` that lacks the spec.

## Goal (Phase 1 only)

Make every battle action **data taken against the combat state through one interpreter,
and recorded going forward** — so adding an action is a small mechanical change and the
player and AI share one execution path. Concretely:

- A `CombatAction` discriminated union (`move | attack | skill | cleave | defend | endTurn`).
- One `Battle.apply(action): ActionResult` that **validates → mutates → emits → appends to
  the log** — the single execution path.
- Player input **and** `AIPlan` both **lower to `CombatAction[]`** and flow through `apply`.
- `battle.log: readonly CombatAction[]` + a `replay(initial, log)` helper.

**Explicit non-goals for this phase** (do not build): the **undo** feature (Phase 2,
separate pass), any UI, a serialization wire-format beyond using ids, and any balance/
behaviour change. Phase 1 is **behaviour-preserving plumbing**.

## Architectural rules (non-negotiable)

- **Core/render split (D2):** all logic in `src/core/`; no Phaser/DOM. Export new symbols
  via `core/index.ts`.
- **Ids, not object refs (D22-friendly):** a `CombatAction` references units/skills by
  **id**, so the log survives a `replay` that rebuilds fresh unit objects (and can later
  serialize for repros/netcode). Resolve ids → objects inside `apply`.
- **Determinism stays intact:** the core loop is RNG-free today — keep it that way. The
  `core/`-has-no-`Math.random` grep test must stay green.
- **Behaviour-preserving, incremental migration:** convert the existing `Battle` methods to
  **thin wrappers** that build a `CombatAction` and call `apply` — one method at a time, with
  the suite green after each. `apply` dispatches to the *current* method bodies; no resolution
  logic is rewritten.
- **Test-first discipline:** a phase isn't done until `npm test` + `npm run build` are green.

## Build order (each step lands green)

> **Step 0 — RNG-in-effects audit (do this first; it gates Phase 2 and de-risks Phase 1).**
> Grep the skill/status/charge effect path for any seeded or live RNG consumed *during a
> turn* (`rng`, `Math.random`, `streamFor`). The core loop (`turn`/`combat`/`status`/`clock`/
> `charge`) is already clean; confirm individual effects are too. Record the finding in the
> design doc's determinism section. If an effect *does* roll mid-turn, note it — replay-undo
> (Phase 2) will need to capture the RNG stream position; Phase 1 is unaffected.

1. **Types.** Define `CombatAction`, `ActionResult` (`ok | refused(reason)`), and id aliases
   in `turn.ts` (or a new `src/core/combat-actions.ts`). No behaviour yet.
2. **The interpreter.** Add `Battle.apply(action)` that resolves ids and **dispatches to the
   existing method bodies**. Add `battle.log` and have `apply` append on success.
3. **Wrap the primitives.** Convert `moveUnit` / `attack` / `useSkill` / `cleave` / `endTurn`
   into thin wrappers over `apply` (build the action, call `apply`). Suite green after each.
4. **Lower the callers.** Re-express `runEnemyTurn` as *plan → `CombatAction[]` → `apply` each*
   (it already lowers `AIPlan` to the primitives — now it goes through `apply`). Point the
   player-input layer (BattleScene) at `apply` too.
5. **Replay + the invariant test.** Add `replay(initialState, log)` and a test that records a
   real battle (drive a sim/auto-battle), replays its log from the start, and asserts an
   **identical end state** — the `replay(log) === state` net. Add a `*.test.ts` for the action
   types/`apply` (each action's validate/refuse paths).

## Definition of done (the gate)

- `CombatAction` + `Battle.apply` exist; **all** battle actions (player + AI) route through
  `apply`; `battle.log` records them in order.
- `replay(log) === state` holds for a recorded battle (the new test passes).
- The full suite is **green with no existing test modified** (only additions) — proving the
  migration is behaviour-preserving.
- Step 0's audit finding is written into `combat-actions.md`.
- **Phase 2 (undo) is NOT started** — open it as its own pass, informed by the audit.

## After Phase 1

Open Phase 2 (player-turn, *Into-the-Breach* undo via checkpoint + replay) per the design
doc's "Phase 2" section — scoped to pre-commit, single-turn undo, with the fog/info-leak
guardrails, gated on Step 0's audit.
