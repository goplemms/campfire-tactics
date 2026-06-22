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

## The keystone: a forecast registry parallel to the resolver

Skills are already **declarative data partitioned by effect kind**
([combat-actions](combat-actions.md)): `damage · heal · status · channel ·
triage-heal · cleanse · forced-move · cleave · med-heal · morale · placeTrap`. Battle
resolution dispatches through a **compile-time-exhaustive registry**
(`BATTLE_EFFECT_HANDLERS` in `core/skills.ts`) — add a kind and the build breaks until
its handler exists.

**The telegraph mirrors that pattern exactly.** A parallel `FORECAST_HANDLERS`
registry — the same mapped type over the same effect kinds — means *adding an ability
effect forces you to declare how it previews*, checked by the compiler. This is what
makes the telegraph a **system, not a per-class feature**: it cannot silently fall out
of sync with the ability roster (the same guarantee the [job roster ↔ board palette](../../../src/game/roles.ts)
type already gives us).

```
SkillEffect.kind ──┬── BATTLE_EFFECT_HANDLERS  → mutate the battle (resolve)
                   └── FORECAST_HANDLERS        → predict the outcome (telegraph)
                       (exhaustive over the same kinds)
```

## Footprint shapes (by effect / target)

| Effect / target | Footprint | Telegraph |
|---|---|---|
| Single-target (`damage`, `heal`, `status`, `channel`, `cleanse`) | the aimed tile | outline + forecast badge |
| `cleave` | the 90° arc, direction = caster→aim, depth = `reach`, masked by walls | wash over the arc tiles + a badge per foe caught |
| `forced-move` (Shove) | the target tile **and** its landing tile | a **push arrow**; landing tile flagged if it's a blocker/trap (the combo payoff) |
| `self` | the caster's tile | self-highlight |
| `party` / `camp` (Chef, Merchant) | the affected roster (not a board set) | forecast box only (no board footprint) |
| Passive **aura** (tarpit) | the ring of tiles the passive taxes | a persistent aura wash, shown in Deployment so you can position around it |

## What the forecast box shows

The forecast box reuses the existing docked `MiniCard` (label→value rows, an optional
HP bar, per-row colour + emphasis). Rows are the ability's predicted outcome, e.g.:

- Cleave → `Damage 14 ⚔ · Targets 3` (the emphasised figure is best-case per foe).
- Shove → `Push 1 → into trap 💥` (the payoff is the *destination*, not damage).
- Heal → `Heal +12` (Triage-scaled when the Medic has the passive).
- Status → `Exposed · 2t`.

Lethal and flank keep their existing glyphs (the strike badge vocabulary, D60).

## Interactions

- **Vision (D18).** A telegraph never reveals more than the player perceives:
  single-target telegraphs require **Seen**; AoE footprints may fall on a **Pinged**
  blip (lob it at the presence) — the same rule combat targeting already follows.
- **Enemy intent.** The existing intent links (each foe → the ally it will hit next,
  with incoming damage) are the *enemy-side* telegraph; they stay, and are folded into
  the same forecast vocabulary so "what I'll do" and "what they'll do" read alike.
- **Deployment.** Footprints/auras render in the Deployment phase too, so a melee/
  control unit can be placed for its Cleave arc and tarpit zone before the fight — the
  audit gap that motivated this system.
- **Forced movement + entities (D19).** Shove's destination telegraph reads the
  [field-entity](field-entities.md) registry so "push into a trap/blocker" is shown,
  not discovered after the fact.
- **Action economy (D5).** The in-place strike telegraph is still suppressed once the
  Act is spent; arming is cancellable, so a telegraph is always a *preview*, never a
  commit.

## Non-goals

- Not a full "simulate the turn" projection — forecasts are **single-action**,
  best-case-per-target reads, not multi-step lookahead (keeps it deterministic and
  cheap, and honest about variance the way the route forecast is honest about fog).
- No new player **keyword**: "Forecast" already covers the numeric read (glossary);
  "telegraph" stays an internal/feel term, surfaced as visuals, not labels.

## Open questions (🔶)

- **Variance display.** Forecasts are best-case today; whether to band them
  (min–max) like the route loot band (D48) is deferred until accuracy/variance lands.
- **Mobile/touch.** Hover-driven telegraphs need a tap-to-arm, tap-to-preview,
  tap-to-confirm equivalent on touch — tracked with the platform-wrapper work (D1).
