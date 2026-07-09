# System — Combat actions (command interpreter + action log + undo)

> Referenced by: [Combat](../03-combat.md), [Deployment](../02-deployment.md).
> Decisions: **D4** (the event bus / "actions announce, listeners react"),
> **D5** (the CT clock), **D42** (the scoring AI — `AIPlan` as intent-as-data),
> **D56** (swappable battle policy), **D87** (the log is *total* — every mutation
> flows through `apply`). Touches: `src/core/turn.ts` (the `Battle` driver),
> `src/core/ai.ts` (`AIPlan`), `src/core/combat.ts`, `src/core/event-bus.ts`.
>
> Status: **Phase 1 & Phase 2 built & verified** — command interpreter + action log
> + replay, the label-derived RNG seam, *and* turn-scoped undo (the take-back), all
> on one substrate. Sibling in spirit to the [purse journal](purse-journal.md): the
> *substrate* (commands + log) came first, the *product feature* (undo) layered on
> top. Implementation: `src/core/combat-actions.ts` (the `CombatAction` union +
> `ActionResult`), `src/core/turn.ts` (`Battle.apply`, `battle.log`, `replay`, the
> `roll` seam, and `beginUndo`/`undo`/`undoAll`), `src/core/clock.ts` +
> `src/core/entities.ts` (snapshot/restore), wired into `BattleScene` as the
> **Undo Turn** verb. Tests: `combat-actions` / `combat-rng` / `combat-undo`.

## Motivation

Two concrete needs drive this:

1. **A consistent way to add actions.** We will keep adding battle actions. Today
   each is an ad-hoc `Battle` method with its own validate/mutate/emit shape; the
   player path and the AI path differ. We want a single, uniform way to define and
   execute an action so "add an action" is a small, mechanical change.
2. **Stage for undo.** A player should be able to take back moves within their turn
   before committing (the *Into the Breach* model). That needs actions to be
   **data taken against the combat state and recorded going forward**, not opaque
   method calls.

Both point at the same architecture: the **Command pattern** (actions as data +
one interpreter) plus an **action log** (event sourcing of commands).

## What exists today (we're ~60% there)

- **The event bus (D4)** — `EventBus` already records *what happened*
  (`unitDamaged`, `unitDefeated`, `unitEnterTile`, `trapSprung`, …); listeners
  (field entities, render FX) react. This is the *announce* side, already in place.
- **`AIPlan` is already a command** — `ai.ts` produces intent-as-data
  (`{ unit, path, target, ability }`), and `Battle.runEnemyTurn` **lowers it into the
  primitive methods**:
  ```ts
  if (plan.path.length > 0) this.moveUnit(unit, plan.path);
  if (plan.ability && plan.target?.alive) { this.useSkill(...); return plan; }
  if (plan.target?.alive) this.attack(unit, plan.target);
  this.endTurn(unit, { moved, acted });
  ```
  So a *plan → primitive actions* lowering already exists for one side.
- **The primitive action set** lives as separate `Battle` methods:
  `moveUnit` · `attack` · `useSkill` · `cleave` · `endTurn` (+ deployment-phase verbs).
- **The core combat loop is deterministic.** There is **no `rng` / `Math.random`** in
  `turn.ts`, `combat.ts`, `status.ts`, `clock.ts`, or `charge.ts`; damage is the pure
  `max(1, atk − def)` plus positional/status modifiers, and the sim's *"same seed
  replays identically"* test proves the whole battle path is a function of seed +
  actions. **This is the load-bearing fact for undo.**
- **No clone/snapshot seam** for `Battle`/units exists yet — relevant to the undo
  mechanism choice below.

The gap: there is no single `CombatAction` type or one interpreter; player input and
`AIPlan` reach the primitives by different routes.

## Design — Phase 1: the command interpreter + log

Introduce a discriminated union and one interpreter on `Battle`:

```ts
// A battle action as data — the unit of player input, AI output, log, and replay.
type CombatAction =
  | { kind: "move";   unit: UnitId; path: GridCoord[] }
  | { kind: "attack"; unit: UnitId; target: UnitId }
  | { kind: "skill";  unit: UnitId; skill: SkillId; target: UnitId }
  | { kind: "cleave"; unit: UnitId; skill: SkillId; dir: GridCoord }
  | { kind: "defend"; unit: UnitId }            // the D41 standing order, etc.
  | { kind: "endTurn"; unit: UnitId; spend: TurnSpend };
// (ids, not object refs, so an action serializes / survives a replay rebuild.)

interface Battle {
  // Validate → mutate → emit → append to the log. The single execution path.
  apply(action: CombatAction): ActionResult;   // ActionResult: ok | refused(reason)
  readonly log: readonly CombatAction[];
}
```

- **Player input and `AIPlan` both lower to `CombatAction[]`** and flow through
  `apply()`. `runEnemyTurn` becomes "plan → `CombatAction[]` → `apply` each".
- **Adding an action = a new union variant + a case in `apply`** (+ its effect). The
  same registry ergonomics the skill-effect dispatch already has. The AI and player
  can no longer drift, because there is one path.
- **The log is the combat analog of the purse journal** — `apply` pushes each action.
  It is the substrate every later feature (undo, replay, netcode, debugging, an
  action-level sim trace) reads.
- Keep the existing methods initially as **thin wrappers** that build the action and
  call `apply` — so the migration is incremental and the 500+ combat tests stay green
  the whole way.

### The invariant (and why it's not ledger-cheap)

The purse journal reconciles by **summing a conserved scalar** (`sum(log) === gold`).
Combat state is **not** a scalar — it's a graph (units × hp/pos/status/ct/cooldowns +
field entities + the CT clock). So state is reconstructed by **replay**, not sum:

```
replay(initialState, log) === currentState
```

This is a real, testable invariant (re-run a recorded battle from its start, assert
identical end state — a strong determinism/refactor net), just **not a one-liner**.
That asymmetry is inherent to combat state; it's the reason undo needs the machinery
below rather than falling out for free.

| | Purse journal | Combat log |
|---|---|---|
| State | one scalar (`gold`), conserved | a graph (units, statuses, CT, entities) |
| Reconstruct | **sum** deltas (O(n), trivial) | **replay** commands through `apply` |
| Invariant | `sum(log) === gold` | `replay(log) === state` |
| Undo | implicit (reporting only) | replay-from-checkpoint or snapshot/restore |

## Design — Phase 2: undo ✅ Built

**Mechanism — snapshot-per-action with identity-stable in-place restore.** We
evaluated three and shipped the one that the live render makes *safest*:

- **Snapshot-per-action (shipped).** Before each successfully-applied action,
  `apply` pushes a checkpoint: the log length + the RNG draw cursor + the units'
  mutable state + the clock state (time **and** in-flight charges) + entity flags.
  `undo()` pops it and restores **in place** — units/clock/entities keep their
  **object identity**; only field *values* revert. This is why it's clean now
  although the doc first deferred it: keeping identities stable means (a) field
  entities never need *cloning* (their bus wiring + tile callbacks are untouched —
  the "awkward part" evaporates), and (b) a charge's captured closure stays bound to
  the same live units, so an in-flight charge undoes correctly.
- **Why not checkpoint + replay** (the originally-recommended path): re-applying
  `log[turnStart…]` through `apply` would re-emit `unitDamaged`/`unitDefeated` on the
  **live bus** — double-counting the RunLoop's combat-XP tally and replaying render
  FX. In-place restore touches no listeners. (The two still *agree*: a test asserts
  `replay(log) === state` after mid-turn undos — the log stays the canonical record.)
- **Inverse-events — avoided**, as planned: fragile and bug-prone; determinism makes
  state-restore strictly better.

**Composes with the RNG seam.** The checkpoint captures the draw cursor, so undoing
a hit and re-doing it re-rolls **identically** (same `draw#` ⇒ same value) — the
take-back is faithful even with damage variance on (tested).

**Scope & guardrails (shipped).** Undo is **armed only for a player turn**
(`beginUndo` at turn start, `endUndo` on commit) — the headless sim and enemy turns
pay nothing. It's **turn-scoped**: no take-back across the turn boundary (the history
is dropped on commit) or across the enemy turn, which sidesteps the info-leak. The
render forbids it once a **sprung trap has locked the turn** (no take-back on damage
*taken*). In `BattleScene` this generalizes the old movement-only "Undo Move" into
**Undo Turn** (Esc) — now also taking back a **strike or skill** (the *Into the
Breach* move: hit, see it didn't help, take it back), reviving the foe and all.
`Battle.undo()` (single-step) is also exposed for a future finer-grained UX.

**Scope — player-turn undo, *Into the Breach* style.** The game already telegraphs
enemy intent (`forecastEnemyAction`), so "make moves, watch the forecast update, undo
freely, then commit the turn" is a natural, expected fit. Guardrails:

- **No undo across the enemy turn or across a fog reveal.** Undoing after seeing new
  information is an info-leak (you keep the knowledge). Per-turn, pre-commit undo
  sidesteps this cleanly.
- **RNG-in-effects audit (prerequisite).** The *core* loop is RNG-free, but confirm no
  individual **skill/status effect** consumes seeded RNG mid-turn. If one does, the
  checkpoint must also capture the RNG **stream position** so replay re-derives the same
  rolls. (Trap spot-rolls / theft use `streamFor(seed, label)` and are deterministic by
  label, but they sit at the deployment/field edge, not the core turn loop.)

### Step 0 finding — the RNG-in-effects audit (run for Phase 1) ✅

**Result: the skill / status / charge resolution path is RNG-free.** Greps of the
combat-action path (`turn.ts`, `combat.ts`, `status.ts`, `clock.ts`, `skills.ts`)
turn up **no `Math.random`, no `Rng` import, and no seeded stream** of any kind.
Concretely:

- **Skill effects** (`skills.ts` `BATTLE_EFFECT_HANDLERS`: damage / heal / triage-heal
  / status / channel / cleanse) and the field effects resolved on `Battle`
  (`resolveShove` / `cleave` / `useHeal`) are all **pure** functions of the unit pair +
  roster — `max(1, atk − def)` plus positional/status modifiers, fixed heal/status magnitudes.
- **Status ticks** (`status.ts` `tickStatuses`) and **charge resolution** (`clock.ts`
  `tick` → `ScheduledEffect.run`) carry no rolls; a charge re-runs its captured closure
  deterministically, and the fizzle predicate is a pure caster-alive check.
- **Trap *springing*** (a field entity's `onUnitEnterTile`, fired mid-`moveUnit`) deals
  its entity's **fixed** `damage` — no roll at spring time.

The **only** combat-adjacent randomness is the trap **spot-roll** (`traps.ts`
`revealTrapsNear` → `rng.chance`, an *Awareness search*) and **theft skim**
(`theft.ts`). Both are **player-initiated field-edge actions** routed from the render
layer (`spotTrapsForActor` / the thief's pre-turn skim), **not** part of
`Battle.apply`'s validate→mutate→emit path, and both are deterministic by
`streamFor(seed, label)`. They never fire during action resolution.

**Implication for Phase 2:** the checkpoint+replay undo mechanism needs **no RNG
stream-position capture** for the core action set — replaying the action log
reconstructs combat state exactly. The stream position only matters if/when a
field-edge verb (Search / theft) is folded into the action log; until then it's
out of scope.

### Soft-randomization seam — label-derived combat RNG (built, off by default)

We **will** want "a range of possibility" in combat (damage variance, hit/crit,
effect procs). Rather than reach for `Math.random` (which a `core/` grep test
forbids and which would break replay), the seam is the **label/coordinate** PRNG the
trap/encounter rolls already use — `streamFor(seed, label)`:

- **`Battle.roll(label)`** returns a fresh deterministic `Rng` keyed by
  `(battleSeed, label, draw#)`, where `draw#` is a monotonic counter that advances
  **only inside `apply`**. Because it is label-derived, there is **no stateful cursor
  to snapshot** — a replay re-derives every roll from the same coordinates, so the
  `replay(log) === state` invariant holds *with the RNG on* (there's a test).
- **`BattleOptions = { seed?, variance? }`** on the constructor. The defaults
  (`seed 0`, `variance 0`) take **no draw**, so an unconfigured battle is
  byte-identical to the deterministic baseline — the 537-test suite and the headless
  sim digest were unchanged when the seam landed. Production wires
  `streamFor(run.seed, \`battle:${node}:${night}\`)` so the run still reproduces from
  its run seed.
- **The flagship wiring is damage variance** (a ±`variance` multiplier on final
  damage in `resolveAttack`, fast-pathed to the exact integer when off). Hit/crit and
  proc rolls ride the **same** `roll(label).chance(p)` seam (demonstrated by tests);
  wiring them into specific effects is the same mechanical "new roll site" change.
- **The one rule the seam imposes:** *only resolution (`apply`) may draw.* Planning
  (`planEnemyTurn`) and the telegraph (`forecastEnemyAction`) score on the
  **mean** (`computeDamage`, no draw), so the act of thinking never consumes the
  battle stream and never desyncs a replay.

**This revises the Step-0 conclusion's "no draw to capture" for Phase 2:** still
true, *because* the seam is label-derived rather than a threaded cursor. If a future
roll ever needs a stateful stream, `Rng` is already serializable (`state()` /
`setState()`) — the checkpoint would snapshot that one 32-bit int.

## Phasing

1. **Phase 1 — command + log. ✅ Built.** `CombatAction` union + `Battle.apply`;
   the existing methods (`moveUnit`/`attack`/`useSkill`/`cleave`/`endTurn`) are now
   thin wrappers that build an action and call `apply`; `runEnemyTurn` lowers an
   `AIPlan` to a `CombatAction[]` via `planActions` and applies each, so the AI and
   player input share one route; every applied action appends to `battle.log`. The
   `replay(initial, log) === state` invariant has a test (1-on-1 + full-roster + a
   partial-log mid-state). Each public method's behaviour is unchanged (the 528-test
   suite passed untouched, and the headless sim digest is byte-identical).
   - **Internal sub-effects stay unlogged**: a shove's forced steps (`resolveShove`
     → raw `execMove`) and a skill/cleave's turn-commit (`commitSkill` → raw
     `execEndTurn`) are part of the one logged `skill`/`cleave` action, so the log
     carries exactly one entry per public call (and replay doesn't double-apply).
   - **Reference rule applied:** mutable per-battle units are referenced by `id`
     (resolved in `apply`, the load-bearing requirement for the replay rebuild);
     immutable authored `SkillDef`s ride in the action directly (not rebuilt on
     replay; also keeps ad-hoc test skills working). A pure-id skill form for
     wire-format is a Phase-2 refinement, gated on a skill registry that doesn't exist.
   - **The union is now total (D87, R1).** The formerly-deferred verbs all landed as
     logged `CombatAction`s: the **deployment-phase verbs** (`digIn` / `placeTrap` /
     `capture` / `beginBattle` / `escape`) flow through `apply` with a logged phase
     boundary + a replay-drained prelude (`combat-actions.ts`, `turn.ts`), and
     **`useHeal`** — the med-bridge — is a logged action too (D87 closed the "heal
     mutated outside the log" gap; a golden rescue+heal battle replays byte-identically,
     `r1-log-totality.test.ts`). So **nothing** genuinely remains outside `apply`.
     `defend` **shipped** as a universal `SkillDef` (`DEFEND`, `jobs-data/support.ts`)
     resolved through the `skill` action — not reserved/unbuilt.
2. **Phase 2 — undo. ✅ Built.** Snapshot-per-action checkpoints on the log;
   identity-stable in-place restore (units + clock + charges + entities + RNG cursor);
   player-turn-scoped, trap-lock-guarded; surfaced as **Undo Turn** in `BattleScene`.
   The RNG-in-effects audit (Step 0) cleared it, and the label-derived seam keeps the
   take-back faithful with variance on. **Delivers take-back.**

This mirrors the purse-journal sequencing: prove the substrate, then layer the feature.

## Risks

- **This re-routes the heart of the battle loop** (unlike the purse journal, which was
  purely additive). Higher risk. Mitigate by migrating one action at a time behind the
  existing methods, leaning on the combat test suite as the net.
- **Determinism must hold** for replay-undo. Strong evidence it already does (RNG-free
  core + the sim determinism test), but the per-effect audit is a real gate.
- **Serialization choice** — actions should reference unit/skill **ids**, not object
  refs, so the log survives a replay that rebuilds fresh unit objects (and so it could
  later serialize for netcode/debug repros).

## Concrete starting point for the next session

1. Define `CombatAction` + `ActionResult` (ids, not refs) in `turn.ts` (or a new
   `combat-actions.ts`).
2. Add `Battle.apply(action)` that dispatches to the *current* method bodies; convert
   each public method to build an action and call `apply` (behaviour-identical).
3. Lower `runEnemyTurn` and the player input layer to emit `CombatAction[]` → `apply`.
4. Add `battle.log` + a `replay(initial, log)` helper and the equality test.
5. Stop here (Phase 1 shipped). Open Phase 2 (undo) as its own pass after the RNG audit.

## Open questions

- **Action granularity** — is "move + attack" one composite turn action or two logged
  actions? (Undo granularity and the `endTurn` spend model depend on this.)
- **Deployment-phase verbs** (trap placement, capture, range-back) — *resolved (D87):*
  the **same `CombatAction` union** (`digIn`/`placeTrap`/`capture`/`beginBattle`/`escape`),
  with the deploy→battle handoff a single logged `beginBattle` boundary.
- **How much state the checkpoint must hold** — *resolved (Phase 2):* the units'
  mutable fields + the clock (time + scheduled effects) + entity flags + the log
  length + the RNG draw cursor. The entity/bus relationship is never cloned —
  identity-stable in-place restore keeps it intact.
- **Multi-step / charged skills (D5/D16/D37)** — *resolved (Phase 2):* an in-flight
  charge is captured in the clock snapshot (shallow-copied so its `gauge` reverts by
  value while its `run` closure stays bound to the same live units), so undoing the
  cast rolls the scheduled effect cleanly off the timeline (tested).
