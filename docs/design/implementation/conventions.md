# Code conventions — the shared machinery and where it lives

> Referenced by: `CLAUDE.md`, the agent briefs (`.claude/agents/*.md`).
> Scope: **internal identifiers and code structure** — the code-side twin of the
> player-facing [glossary](../glossary.md). Established by the D87–D89 refactor
> campaign; extended by the 2026-07-20 structural audit (D114).

The rule this doc exists to enforce: **when a structure repeats, it gets one home,
one spelling, and a tripwire.** Docs drift (the audit found `turn.ts` describing a
battle salt that didn't exist); executed code doesn't. So every convention below
points at a **living exemplar** — real, shipped, guard-covered code to copy — and
names the **guard** that fails if the convention is broken. There is deliberately
no synthetic "perfect model" file: it would be a new drift surface the moment it
stopped being executed.

## The canon, one table

| Concept | The one spelling | Living exemplar | Guard that enforces it |
|---|---|---|---|
| Randomness | `streamFor(seed, Labels.*)`; child seeds via `saltSeed(seed, Labels.*)`; **no `Math.random` in `core/`** | `src/core/rng-labels.ts` (every label, one typed constructor each) | `rng-labels.test.ts` (value pins + grep guard over core **and** game, incl. `saltSeed`), `rng.test.ts` |
| Battle RNG | `Battle.roll` (apply-driven, draw-counted) / `Battle.stream` (fixed-label deploy draws); seeded per encounter via `Labels.battle(nodeId, night)` | `src/core/turn.ts` `roll`/`stream` docs | `runloop.test.ts` "per-encounter battle seed" (cross-node divergence + same-coordinates determinism) |
| Registries | `Def` record + const registry + `getX(id)` returning `undefined`; keys **derived from `.id`**, never hand-duplicated; duplicate ids **throw at load** | `src/core/scenarios/index.ts` (`[X.id]: X` keys), `src/core/jobs.ts` `SKILLS` (load-time collision check) | `registry-contracts.test.ts` (key ⇔ id walk, dual-registration, event-registration completeness) |
| Unit tags (D117) | `hasTag(unit, tag, ctx)` over the `TAGS` registry — a tag is a **predicate/classification**, never a stateful status; one of three provenances (**intrinsic** `Unit.tags` · **conferred** by an active status · **derived** pure fn of battle state incl. the D87 log). Tag ids are kebab-case constants (`IN_COMBAT`, …), never inline strings | `src/core/tags.ts` (`in-combat` derived · `non-combatant`/`garrison` intrinsic) | `tags.test.ts`, `registry-contracts.test.ts` (key ⇔ id walk) |
| Costs / pacing | One `Cost` grammar (`src/core/cost.ts`), gated by `checkOverworldCost` → `{ ok, prices, commit() }` | `src/core/overworld-cost.ts` | `r2-verb-gate.test.ts` (every exported verb classified) |
| Verbs | A verb is a `SkillDef` resolved by the one interpreter through the effect registry (the Verb Cell, D89) | `src/core/overworld-actions.ts` | `r2-verb-gate.test.ts`, `overworld-actions.test.ts` |
| Result shapes | Verb layer: `ActionOutcome { applied, reason?, detail? }` · core/effect layer: `{ ok: true; … } \| { ok: false; reason }` discriminated | `src/core/overworld-actions.ts:ActionOutcome`, `src/core/combat-actions.ts:BattleActionResult` | (Wave-2: straggler migration; no mechanical guard yet) |
| Numeric helpers | `clamp`/`clamp01`/`bandFor`/`rankOf`/`clampUp` from `src/core/num.ts` — no hand-rolled clamps or tier tables | `src/core/num.ts` | (Wave-2 adoption pass) |
| Modals / overlays | `showModal` from `src/game/overlay-card.ts` — never a hand-rolled rect+title+backdrop; sheet-style surfaces use `titleAlign: "left"` (market/ledger ride it) | `src/game/overlay-card.ts` header (the D75 bug class it kills) | `test:e2e:guild-banner` (backdrop input-blocking, both banner variants) |
| Depth bands | cross-surface z-coordinates come from `DEPTH` (`theme.ts`) — hud / modal / sheet / banner; per-surface internals may offset from their band | `src/game/theme.ts` `DEPTH` | (visual: `audit:visual` sweep) |
| HP bars | immediate-mode bars via `pushHpBar` (`unit-readout.ts`); retained-mode bars (token nameplates, the rail) keep their create/update split and share only `hpColor` | `src/game/party-dossier-view.ts` `wideHpBar`/`miniHpBar` | (visual: `audit:visual`) |
| ESC-to-close | `onEscClose(scene, fn)` (`ui.ts`) — never inline `keyboard?.once("keydown-ESC", …)` | `src/game/scenes/OverworldScene.ts` tent/market | — |
| Buttons | `Button` (`button.ts`) with `enabled` passed through; a per-surface *style wrapper* over Button (campButton, listButton) is fine — hand-wired rect+pointerdown is not, for new work | `src/game/camp-panel.ts` `campButton` | — |
| Combat log | Every in-battle mutation flows through `Battle.apply`; skills log by id (D87) | `src/core/combat-actions.ts` | `r1-log-totality.test.ts`, `snapshot-drift.test.ts` |

## Code diction (the audit's terminology canon)

- **`kind`** is the discriminant field on tagged unions and defs. (the last `type` holdout,
  the encounter shape, renamed to `EncounterKind`/`kind` in Wave 4.)
- **`*Def`** for authored registry records. `*Policy` for rule-knob bundles.
  Don't mint new `*Template`/`*Spec` names for registry records.
- Verb ladder: **`resolve*`** computes an outcome from rules+state · **`apply*`**
  mutates state per a data-defined effect · **`use*`** is a skill-invocation entry
  point · **`play*`** orchestrates a node/route.
- Time units: **`night`** (the End-the-Night reconciliation counter) and
  **`node-step`** (the departure-fired pacing clock) are related but **not** the
  same seam — see `run.ts` `recordNight` vs `breakCamp`.
- Banded stats: **`*Tier`** is the named band, **`band`/`bandFor`** the quantizer.
- Money: **treasury** (guild vault) · **purse** (run spending money — `Camp.purse`;
  the repro-dump v1→v2 migration covers the old `gold` spelling) · **payout**
  (quest reward, treasury-bound). `*Price` is the resolved number the player pays.
- Unit collections: **`party`** (run-scoped fielded group) · **`roster`**
  (guild-scoped stable) · **`pool`** (hire candidates).

## When you add something new

1. **A new random decision** → a `Labels.*` constructor + a value pin. Never an
   inline label, never a hand-built `${seed}#${label}` string (use `saltSeed`).
2. **A new registry** → key off `.id` structurally, return `undefined` from the
   getter, throw at load on duplicate ids. The contract walk will find you.
3. **A new player-facing surface** → a visual e2e (`scripts/e2e-*.mjs`). The
   headless suite cannot see a scene freeze — see `CLAUDE.md`'s cautionary tale.
4. **A new modal** → `showModal`. If you're typing `installBackdrop` + a rect +
   a title yourself, stop.
5. **A repeated shape with no home yet** → give it one (module + guard) *before*
   the third copy ships, and add it to the table above.
