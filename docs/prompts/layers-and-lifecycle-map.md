# Investigation prompt — Layer & lifecycle map (state ownership + reset propagation)

> Reusable brief for an agent (or a person) auditing how Campfire Tactics is layered
> and how its runtime lifecycle behaves. Hand it over verbatim; it is self-contained.

## Why this exists

We keep discovering bugs that are really **one class**: a piece of state lives in one
layer, a lifecycle event (reset / teardown / re-entry) fires in another, and the event
never propagates across the boundary. The worked example: the initiative-rail **chevron**
is a UI-layer `Phaser.Text` created lazily and destroyed when the `BattleScene` shuts
down — but Phaser **reuses the one scene instance** across a run, and the scene's
"start a new encounter" reset never reached that UI-owned field. The dangling reference
survived a lazy `if (!this.railChevron)` guard and `setText` crashed the 4th fight of a
run (`Cannot read properties of null (reading 'drawImage')`).

That was patched (`BattleScene.resetEncounterState`, `?.scene` guard). This audit is the
**structural** follow-up: produce an accurate map of *what state lives where*, *what
happens when*, and *which lifecycle actions must cross a layer boundary but don't* — so
the whole class becomes visible and, ideally, structurally impossible.

"Levels" here means **architectural layers** (core → scenes → components → primitives)
read against the **runtime lifecycle timeline** (boot → run → node → phase → turn). If
the requester meant the in-game run structure instead, note that and cover both — the
lifecycle timeline already spans it.

## Layers to map (verify against the tree; don't assume)

| Layer | Path | Owns |
|---|---|---|
| Sim / rules | `src/core/**` (pure, no Phaser, unit-tested) | **persistent run state** — `RunState`, `RunLoop`, `Battle`, overworld map, jobs |
| Boot | `src/game/boot/` (`debug.ts`, `demos.ts`) | builds a `RunHandoff`, starts a scene |
| Scenes | `src/game/scenes/` — `GuildScene`, `OverworldScene`, `BattleScene` | per-scene UI + input; drive the loop |
| Components / views | `src/game/*.ts` (~26: `info-cards`/MiniCard, `situation-card`, `command-menu`, `combat-view`, `camp-panel`, `ledger-sheet`, `market-view`, `party-dossier-view`, `forecast-cards`, `hint-panel`, `legend-strip`, `map-view`, `trap-markers`, `overlay-card`, `resolution-report`, `deploy-fx`, `deploy-zones`, …) | scoped view state + GameObjects |
| Primitives | `ui.ts` (`clearLayer`/`fitText`/`fitRow`), `theme.ts`, `button.ts` | shared helpers + tokens |

Known cross-layer facts to confirm and build on:
- **`RunHandoff`** (`{ run, loop, guild, caravanId }`, defined in `OverworldScene.ts`) is the
  *only* state that legitimately crosses a scene transition. Everything else should be
  rebuilt on entry.
- Scene transitions: `Guild → Overworld → [Overworld ⇄ Battle]* → Overworld`, plus
  `Overworld → Guild`. Boot enters `Overworld`/`Battle` directly.
- Scenes declare **`init(data)` and `create()` but no `shutdown()`** — teardown is
  entirely Phaser's implicit GameObject destruction. This absence is the seam to probe.
- Phaser keys scenes by name and **reuses the instance** across entries; instance fields
  keep their previous value unless a hook re-sets them.

## Deliverables — produce all four

### 1. Layer diagram + dependency rules
The tiers, what each owns, and the **allowed import direction**. Explicitly check for
inversions: does anything in `core/` import from `game/`? Does a component reach *into* a
scene (vs. receiving intent/data)? List every violation with `file:line`.

### 2. Lifecycle timeline ("when")
Two interleaved timelines:
- **Run flow:** boot → Guild (assemble caravan) → Overworld (run) → `[pick node → Battle
  (deploy → battle → resolution) → return to Overworld]`\* → run-end / quest-complete.
- **Phaser scene lifecycle per entry:** constructor (once per reused instance) → `init(data)`
  → `create()` → update loop → implicit shutdown (Phaser destroys display objects). Mark
  where instances are **reused vs. fresh**, and that no explicit `shutdown()` exists.

For each transition, state **what crosses** (the `RunHandoff`) and **what is discarded**.

### 3. State-ownership × lifecycle matrix — *the core deliverable*
Enumerate every significant piece of **mutable** state. For each row:

| Field (module) | Owning layer | Category | scene-enter | encounter-start | turn-start | teardown | Gap? | Evidence |
|---|---|---|---|---|---|---|---|---|

- **Category:** persistent-run / per-scene / per-encounter / per-turn / per-frame /
  UI-toggle / cached-GameObject / lazy-pooled.
- In each lifecycle column record **should → actual** (init / reset / destroy / persist),
  cited to `file:line`. A mismatch is a **Gap**.
- Run a dedicated pass over **lazily-created cached GameObjects** (the chevron class):
  any field created behind an `if (!this.x)` guard — is it reset when its scene re-enters?
  Can a destroyed-but-referenced object slip past the guard? (`BattleScene` alone has
  several: `railChevron`, `safeZoneGfx`, `dangerZoneGfx`, `deployReachGfx`, `gridGfx` —
  check each, and sweep the other scenes/components the same way.)
- Don't forget **listeners, timers, tweens, and event-bus subscriptions** created in
  `create()` or components — these leak differently (double-fire, not crash) when an
  instance is reused without teardown.

### 4. Cross-layer propagation audit + recommendation
- List each lifecycle action that **must cascade across a boundary** (e.g. scene
  "reset encounter" → component-owned + lazily-created UI state; scene teardown →
  dispose component listeners/timers/tweens). For each: does it cascade, and **where does
  it stop?**
- Inventory today's **reset/teardown vocabulary** and show it is ad-hoc and
  inconsistently named — no single protocol: `clearLayer` (ui), `CombatView.clear*`,
  `trap-markers.reset/resetPlayer`, `situation-card.resetView`, `command-menu.clear`,
  `map-view.clear`, `party-dossier-view.clear/destroy`, `BattleScene.resetEncounterState`
  / `rebuildBoard`.
- Recommend the **smallest convention** that makes the chevron class structurally
  impossible — e.g. a uniform `reset()` / `dispose()` on resettable components, a scene
  that holds a registry of resettable children and cascades at each boundary, or moving
  all per-entry state behind one enforced reset checklist. Weigh each against Phaser's
  reuse model (don't recommend churning scene instances — that trades a crash bug for
  leaked listeners/timers).

## Method / rules
- **Evidence over assertion.** Cite `file:line` for every ownership and lifecycle claim.
  Read the code; never infer behavior from a name.
- Verify the Phaser-lifecycle claims against the actual scenes (`init`/`create` present,
  `shutdown` absent; instance reuse).
- Use the chevron (`BattleScene.layoutRailChevron` / `resetEncounterState`) as the worked
  failure mode, then **generalize** — the value is the gaps you find *elsewhere*.
- Prefer scannable tables to prose. **Rank gaps by blast radius:** crash > wrong-state
  (stale tally / leaked subscription) > cosmetic.
- Propose the *smallest* structural change that closes the class — not a rewrite.

## Output
One Markdown report, in this order: **Layer diagram → Dependency-rule violations →
Lifecycle timeline → State×Lifecycle matrix → Ranked propagation gaps → Recommended
convention (with the 1–2 smallest concrete changes to adopt it).**
