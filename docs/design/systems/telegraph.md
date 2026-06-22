# System — Telegraph & action forecast

> Referenced by: [Combat](../03-combat.md) (targeting, the strike forecast),
> [Deployment](../02-deployment.md) (placement reads), [Combat actions](combat-actions.md)
> (the per-effect taxonomy), [Vision](vision.md) (telegraphs are gated by what you
> perceive), [Action economy](action-economy.md). Decision: **D64**.

## Description

Before a player commits an action they should be able to **see what it will do** —
where it reaches, who it hits, and the forecasted outcome (damage, status, push,
heal). Today the board answers some of this (a lit path to the hovered tile, a
strike badge on foes you can hit in place, enemy-intent threat links) but goes
**dark the moment a skill is armed**: the preview collapses to "these tiles are
legal targets" and shows nothing about the *effect*. A Heavy Knight player arming
**Cleave** never sees the arc; arming **Shove** never sees the push direction or the
"into a trap" payoff; the **tarpit** aura is never drawn at all.

The **Telegraph** is the visual preview layer that closes this gap, and **Forecast**
is the numeric prediction behind it. The rule:

> **Every action a player can take has a telegraph; every telegraph that resolves to
> a number is backed by a forecast.** Arming an ability shows its *footprint* (the
> tiles/units it affects from where you are aiming) and a *forecast box* (its
> predicted outcome), for **every** ability — present and future.

This is the in-combat sibling of the [route **Forecast**](../systems/purse-journal.md)
(D48): same fantasy — *cost/outcome is knowable before you commit* — one timescale
down, and gated by [Vision](vision.md) the way the route forecast is gated by intel
(you can only telegraph onto tiles you perceive; a **Pinged** blip gets an AoE
telegraph but not a single-target one — mirrors D18).

## The two halves

| Half | What it is | Lives in | Player word |
|---|---|---|---|
| **Footprint** | The set of tiles/units an armed action affects, **given the current aim** — Cleave's 90° arc, Shove's destination tile, a single target, a self/party set, a passive's aura ring. | `core/` (pure geometry) | (shown, not named) |
| **Forecast** | The **non-mutating** predicted outcome of resolving the action on that footprint — damage (+flank/lethal), heal amount, status name+duration, push outcome ("into trap"), per-target list for AoE. | `core/` (pure) | **Forecast** |

The render layer reads both and paints them; it computes neither.

## The keystone: a forecast registry over the *whole* effect union

Skills are **declarative data partitioned by effect kind**, and crucially the
partition is *by which interpreter owns the kind* ([combat-actions](combat-actions.md),
`core/skills.ts`):

- `BattleEffect` — `damage · heal · status · channel · triage-heal · cleanse` (resolved
  unit-vs-unit by the exhaustive `BATTLE_EFFECT_HANDLERS`).
- `FieldEffect` — `forced-move · cleave · med-heal` (need the grid/roster/stash; resolved
  by `Battle` methods, **not** `resolveSkill`).
- `CampEffect` — `morale` (resolved by `applyCampSkill`).
- `DeploymentEffect` — `placeTrap` (realized when the field is built).

**The forecast registry must mirror the full `SkillEffect` union — all four partitions —
not just `BATTLE_EFFECT_HANDLERS`.** This is a correction the per-job audit forced: three
of the five signature jobs act through a *non-battle* partition (Survivalist `placeTrap`,
Chef `morale`, the Heavy Knight's own `cleave`/`forced-move`). A registry keyed only on
`BattleEffect` would silently omit them.

So the keystone is a `FORECAST_HANDLERS` map whose key set is the **same exhaustive union**
`SkillEffect["kind"]`. Adding *any* effect kind — in any partition — fails the build until
a forecaster exists. That is what makes the telegraph a **system, not a per-class feature**:
it cannot fall out of sync with the ability roster (the guarantee the [job roster ↔ board
palette](../../../src/game/roles.ts) type already gives us).

```
SkillEffect["kind"] ──┬── resolvers (mutate):  BATTLE_EFFECT_HANDLERS · Battle methods
   (all 4 partitions)  │                         · applyCampSkill · trap layer
                       └── FORECAST_HANDLERS (predict, read-only)
                           exhaustive over the SAME union
```

### Single source of truth (read-only)

A forecast must **never mutate** (the resolvers call `removeItem`, `applyStatus`,
`markPrey`, `clock.schedule`; the preview must not). And it must **not duplicate** the
resolver's arithmetic, or the two drift. The rule:

> The predicted outcome is computed by the **same pure function** the resolver uses; the
> resolver applies that result, the forecaster only reads it.

Where a resolver currently fuses computation with mutation (e.g. `resolveMedHeal` computes
the heal *and* consumes the herb *and* applies the rider), the build extracts the pure
**predict-core** (e.g. `medHealAmount(medic, target, herbId)`) that both call. `computeDamage`
already has this shape (pure, used by both combat and the existing strike forecast) — it is
the template.

## A forecast is a tagged outcome, not a number

The audit killed the "one number" assumption. An `AbilityForecast` is a small tagged
structure, because outcomes come in kinds:

| Outcome kind | Shown as | Example (job) |
|---|---|---|
| **immediate** | a value (+ flank/lethal glyphs) | `Damage 14 ⚔` (HK Cleave) |
| **computed** | a value derived live from caster/target/passive state | `Heal +16` = base + level-scale + ⌊triage × missingHP⌋ (Medic) |
| **conditional** | `if <cond>: <outcome>` | `vs debuffed +4` (Hunter Deadeye); `if a foe enters: 12 + Immobilize 2t` (trap) |
| **deferred** | `<outcome> in ~Nt` / per-future-hit | Mark: `0 now → +2/hit (cap +8)`; Mend: `+18 in ~2t` |
| **banked** | `<outcome> next battle` (cross-screen) | Chef: `+8 HP party · next battle` |
| **tiered** | `<from> → <to>` + the bundle the tier grants | Chef: `Morale Neutral → High (+6 init, +1 depth, −20% capture…)` |
| **branching** | one row per sub-choice, inventory-gated | Medic Heal: `Salve +24 · Stimulant +16 & Hastened · Antidote +16 & cleanse` |

The forecast box reuses the docked `MiniCard` (label→value rows, optional HP bar, per-row
colour/emphasis). It is **recomputed live** (target HP, caster level, stacks all change
between frames) and is purely read-only. Lethal/flank keep their existing glyphs (D60).

## Footprint shapes (the geometry half)

The Heavy Knight's footprints are static board sets; the others are not. The footprint
model must cover:

| Footprint | Where it comes from | Telegraph |
|---|---|---|
| **single tile** (`damage`/`heal`/`status`/`channel`/`cleanse`) | the aimed unit's tile | outline + forecast badge |
| **arc** (`cleave`) | direction = caster→aim, depth = `reach`, masked by walls | wash over arc tiles + a badge per foe caught |
| **push + landing** (`forced-move`) | target tile **and** where it lands | push arrow; landing flagged if blocker/trap (the combo) |
| **placement tile** (`placeTrap`, target `camp`) | a *tile* target, not a unit — chosen in **Deployment** | the claimed tile + the trap's deferred payload (dmg, +rider) |
| **mutable reach** (self-buff, e.g. Swift) | the move budget *after* the buff resolves | the reach wash **grows** to the buffed budget |
| **dual reach** (ranged, attackRange > 1) | movement reach **and** strike zone are different sets | both overlays, distinct (walk-here vs hit-from-here) |
| **persistent hazard** (a placed trap, in Battle) | the standing trap entity + which foes could enter it | a held threat marker; on hover, "→dmg + rider" like enemy intent |
| **none** (`party`/`morale`, meta) | a roster/camp target — no board at all | a floating forecast box, no board anchor |

## Action availability is part of the telegraph

"Can I take this action, and when?" is as load-bearing as "what will it do." The telegraph
surfaces availability/timing by **reading the same state the action gate reads** (never a
second source):

- **cooldown** (`onSkillCooldown`) → `cooling ~Nt`.
- **charge** (`clock.scheduledProgress`) → `charging ~Nt` (committed-but-unresolved is a
  distinct state from "available").
- **`usesPerNode`** (camp actions) → `1 use left` / `spent here` *before* the player arms it.
- **resource/inventory** → branching rows for unaffordable/out-of-stock sub-choices are
  greyed, not hidden (you learn what provisioning would unlock).

## Interactions

- **Sub-choice arming (Medic).** Some actions pick a resource *before* a target (which
  herb). The arming flow is *sub-choice → forecast branches → target → confirm*; the
  forecast is re-evaluated per sub-choice and gated by `run.inventory` (read-only).
- **Vision (D18).** A telegraph never reveals more than the player perceives: single-target
  telegraphs require **Seen**; AoE/placement footprints may fall on a **Pinged** blip.
- **Enemy intent.** The existing intent links (each foe → the ally it will hit, with
  incoming damage) are the *enemy-side* telegraph; they fold into the same forecast
  vocabulary, and the **persistent-hazard** footprint reuses them for placed traps.
- **Deployment.** Footprints/auras/placement render in Deployment too — place a control
  unit for its Cleave arc and tarpit ring, see a trap's payload before committing it.
- **Forced movement + entities (D19).** Shove's destination reads the
  [field-entity](field-entities.md) registry so "push into a trap/blocker" is shown.
- **Action economy (D5).** Arming is always cancellable — a telegraph is a *preview*, never
  a commit; the in-place strike telegraph is still suppressed once the Act is spent.

## Non-goals

- **Label deferred/conditional outcomes; don't *simulate* them.** We show "12 + Immobilize
  *if* a foe enters" or "Morale → High (bundle)", but we do **not** predict whether the AI
  walks into the trap, or how a higher morale tier changes a future capture roll. Forecasts
  stay **single-action** reads, not multi-step lookahead.
- **Best-case, not banded.** One figure (the best-case-per-target), honest about variance
  the way the route forecast is honest about fog (see open question).
- No new player **keyword**: "Forecast" already covers the numeric read (glossary);
  "telegraph" stays an internal/feel term, surfaced as visuals, not labels.

## Open questions (🔶)

- **Variance display.** Best-case today; whether to band forecasts (min–max) like the route
  loot band (D48) is deferred until accuracy/variance lands.
- **Tier-bundle verbosity.** A tiered forecast (Chef) could dump the whole modifier bundle
  or just the delta vs the current tier — to be decided when the morale tier UI is built.
- **Mobile/touch.** Hover-driven telegraphs (and sub-choice arming) need a tap-to-arm,
  tap-to-preview, tap-to-confirm equivalent on touch — tracked with the platform wrappers (D1).

## Per-job constraints validated

The spec above was pressure-tested by tracing five jobs start-to-end; each anchors a
constraint a Heavy-Knight-only design would have missed:

| Job | Constraint it anchors |
|---|---|
| **Heavy Knight** | the baseline — static arc/push/aura footprints, immediate deterministic outcomes |
| **Hunter** | computed/conditional damage (Deadeye vs debuffed, Mark stacks); deferred channel value; mutable reach (Swift); dual move-vs-strike reach |
| **Medic** | branching-by-sub-choice + inventory-gated forecast; computed target-dependent heal; charge-vs-cooldown timing; the read-only / single-source-of-truth rule |
| **Survivalist** (& Scout snare) | tile/placement footprint; cross-phase deferred, movement-conditional trigger; persistent-hazard telegraph; the full-union registry correction |
| **Chef** | no-footprint floating forecast; tiered (banded) outcome; banked cross-screen payoff; `usesPerNode` availability in-preview |
