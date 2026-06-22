# Phase 3 — Combat (the iso grid)

> Pipeline position: `Pre-deployment → Deployment → [COMBAT] → Resolution`
> Related systems: [Action economy](systems/action-economy.md),
> [Field entities & the trigger bus](systems/field-entities.md),
> [Stats](systems/stats.md)

## Description

Combat is the isometric battle. It is, deliberately, a **solid genre-standard
tactics fight** — the novelty of this game lives in the phases *around* it. What
makes Combat distinctive is that it is the phase where all the **prep pays off**:
the field entities placed in Deployment trigger here, and captured allies can be
rescued here.

Three pillars define Combat:

### 1. An FFT-style continuous CT clock

There are **no discrete rounds**. Every unit has a **Speed** stat and a hidden
**Charge-Time (CT)** gauge. The clock ticks; each tick, every unit's `CT += Speed`;
at `CT ≥ 100` that unit takes an **active turn** (**Move** and **Act**, either
order); acting then spends its CT back down. Fast units act more often. Full
mechanics, including **charged abilities** that resolve *later* on the timeline,
are in [action-economy](systems/action-economy.md).

Each side enters Combat with a **starting CT seed** set in
[Deployment](02-deployment.md) — so prep gambles that got a unit captured cost the
whole side early tempo.

### 2. Field entities fire via a trigger bus

Traps, nests, and runes placed in Deployment are **field entities** that register
as **listeners on the battle trigger bus**. The Combat loop announces moments —
`onUnitEnterTile`, `onTurnStart`, `onUnitDamaged`, etc. — and entities react. This
is the architectural hook (decision **D4**) that M3 builds **before** any entity
exists, so traps/nests/runes are later just listeners, not special cases. See
[field-entities](systems/field-entities.md).

- **Trap** → one-shot listener on `onUnitEnterTile` (enemy steps on it → damage).
- **Defensive nest** → passive aura: whoever holds the tile gets cover / range /
  elevation benefits.
- **Ritual rune** → a **pre-paid charged ability** (the charge was bought in
  Deployment, not spent as a battle turn). **Auto-trigger** = resolves on a
  condition; **manual-trigger** = a unit spends its **Act** to detonate now.

### 3. Rescue of captured allies

A unit captured during Deployment is on the map, guarded. Freeing it mid-Combat
converts the side's **−1 to +1**; an ally left captured at battle's end is lost in
[Resolution](04-resolution.md).

Capture can *also begin during combat*: an enemy **Snare** (a fortified-encounter
[field entity](systems/field-entities.md)) applies **Immobilized** plus a banded
**capture countdown** — the abstraction being enemy reinforcements closing on that
spot. Fail to free the unit (an ally **Act**) before it expires and they enter the
same captured state. So capture is **one mechanic with two entry points** —
pre-battle overreach and in-combat helplessness — both resolving through the
[D9](systems/mortality-recovery.md) policy.

### Vision & fog of war

Combat is fought under **symmetric fog of war** (see [vision](systems/vision.md), D18):
each side perceives enemies on a banded ladder — **Hidden → Pinged** (Awareness sense,
location not identity, ignores LoS) **→ Seen** (sight + line-of-sight, full info), with
**ghost markers** for spotted-then-lost foes. **Direct** attacks/casts need **Seen**;
**AoE** can hit a perceived (incl. Pinged) tile. A unit breaking from **Hidden** lands
an **ambush bonus**. A **Tier-3 [intel](systems/intel.md)** read grants starting vision.

### Forced movement — push / pull (D19)

Effects can **push** (away) or **pull** (toward) a unit a banded number of tiles. It's
**involuntary** — costs the target no CT and doesn't consume their turn — and
**target-agnostic** (shove an enemy *or* pull an ally out of danger, a clean
support tool). The payoff is the **combo**: a forced move **onto a field-entity tile
fires that entity** (push an enemy into a trap → it springs; into a net → Grounded;
into a snare → capture countdown) — just the [trigger bus](systems/field-entities.md)
emitting `onUnitEnterTile` for the forced move. A pushed unit **stops** at a
wall/blocker/another unit, with **optional collision damage** (a tuning knob). Vision
applies (D18): an **AoE** push can catch a **Pinged** tile; a single-target push needs
**Seen**.

### Win/lose

Standard objectives (defeat all enemies / survive N / reach a tile). The roguelike
framing means **permadeath**: fallen and unrescued-captured units do not come back.

## Pseudo-example

> Continuing from Deployment: enemy holds the initiative seed; 2 traps at the
> canyon mouth; 1 fire rune live; **Vale captured** on a ledge with 2 guards.
> Illustrative Speeds — Rook 10, Ember 7, enemy Vanguard 9, guards 8.
>
> | Clock | Event |
> |------:|-------|
> | t=0 | Seeds applied. Because Vale was lost from the seed, the **enemy Vanguard starts warmer** and reaches 100 first. |
> | t≈11 | **Vanguard turn:** advances through the canyon mouth → steps on a tile → **`onUnitEnterTile` fires Bram's trap.** Vanguard takes damage; a second enemy trips the **second trap** moments later. The greedy enemy tempo walked straight into the prep. |
> | t≈14 | **Rook turn:** Rook sprints toward the ledge (Move) and strikes a guard (Act). CT spent. |
> | t≈19 | **Ember turn:** Ember casts *Frost* — a **charged** spell — onto the cluster near the rune. It does **not** resolve yet; it schedules on the timeline. |
> | t≈22 | **Rook's next turn:** he reaches **Vale** and **frees her** (`Act`). Side is now **4 active**; Vale re-enters the clock. |
> | t≈23 | **Frost resolves** on the cluster (they didn't scatter in time). |
> | t≈24 | **Vale turn:** freed, she spends her **Act** to **manually detonate the fire rune** on the frosted, clustered enemies — the pre-paid charge collapses to zero and erupts now. |
>
> The fight tips: prep placed an hour earlier (traps + rune) plus a rescue turned a
> bad initiative seed into a win.

## Open questions / future scope

- Concrete combat stats beyond Speed (HP, attack, defense, range, move) are
  defined alongside M3 implementation; see [Stats](systems/stats.md).
- Exact CT spend-down costs for Move vs. Act, and per-ability charge times, are
  tuning values (illustrative in these docs).
- Enemy AI on a continuous clock is meaningfully harder than round-based AI; this
  is an accepted cost of the FFT model (decision D5).
- **Revisit the two-step turn close (End Turn → Advance Clock).** The clock only
  steps on an explicit **Advance Clock** press, kept separate from the **End Turn**
  that closes a unit's turn (D60); in both Combat and Deployment (D63) a full cycle is
  two deliberate inputs. The split buys a board-reading beat between turns and gates
  Deployment's closing net behind intent — but it reads as "end turn twice" and is a
  known point of confusion (see the glossary's *End Turn vs Advance Clock* note). Open
  question: should **End Turn** auto-advance to the next actor (one press), reserving a
  manual **Advance Clock** only where stepping the clock is itself the decision (the
  growing net, or watching a charge land)? A UX/tuning pass — the CT model is
  unaffected either way.
