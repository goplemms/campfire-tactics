# System — Magic (Vancian)

> Referenced by: [Combat](../03-combat.md) /
> [action economy](action-economy.md) (charge-time), [field entities](field-entities.md)
> (runes), [logistics](logistics.md) (scrolls/consumables),
> [Pre-deployment](../01-pre-deployment.md) (allocation). Decision: **D17**.

> ## ⚠️ Designed, not built (D17 / #148)
>
> **This entire system is unimplemented.** There is **no** casting, scribing, scroll,
> charge, or rune mechanic anywhere in `src/core` (only a `"rune-reagent"` description
> string in `manifest.ts` and `entities.ts`'s "no real traps/nests/runes yet" note);
> `OverworldCost` carries no `charge`/vancian knob. D17 stands as **intent** and nothing
> supersedes it — the owner ruling is **defer with this banner** (#148), not descope. The
> **consumables family** (D20 — scrolls/reagents/special arrows, recovery keywords) is
> deferred with it (see [logistics](logistics.md)). Everything below is design, not code.

## Description

**All magic is Vancian** — spells are a *limited, expended resource*, never at-will.
This is deliberate: it folds magic into the **logistics pillar** instead of bolting
on a separate mana/RPG subsystem. Magic comes in three forms, each tuned to avoid
the "my mage is useless" feeling:

| Form | What it is | Hooks |
|---|---|---|
| **Default spell** | every mage has **one free, unlimited, weak** at-will spell (Fire-Emblem-style floor) | so a depleted mage **always contributes** |
| **Scribed spells** | each mage scribes **X castings/day**; the player **allocates** those X across the mage's known spells | refreshed on a **night's rest** (reuses D9's night cadence); editable up to pre-deployment |
| **Scrolls** | consumable one-shot castings carried as **storage items** | slotted stacks (D14) + the **consumables family** (below) |

The scribing model keeps friction low: **one number per mage** to allocate
(re-allocatable freely **up until pre-deployment**, then locked like the loadout) —
no per-spell memorization minigame.

### Orthogonal to timing

Vancian governs **how many** casts you have; **charge-time** ([D5](action-economy.md))
governs **when** a cast resolves. A spell can be both *limited* and *slow*.

### Runes are Vancian too

A ritual **rune** is a Vancian casting **placed during Deployment**, paid in
**reagent/material cost** and subject to the **deployment peril** (the D11 retreat
gamble). Within those natural limits (cost + risk) runes are **freely placeable** —
no artificial cap; the material spend and the capture risk are the limiters.

### The consumables family

**Scrolls, reagents, and special [arrows](logistics.md)** are one family (D17/D20):
**storage-slotted, expended on use**, each with a **per-item recovery keyword** (its
own **N% chance to recover** on a win; Survivalist perk boosts it). The
**default-spell** floor has an exact ammo twin: **basic arrows are infinite**, so an
archer — like a depleted mage — always contributes. Archers and mages share one kit
shape: a **free basic** + a **limited pool of specials**.

## Pseudo-example

> At camp, **Ember** scribes **3 castings/day**. She allocates `2× Fireball,
> 1× Frost` — then, seeing canyon intel, **re-allocates** to `1× Fireball,
> 2× Whirlwind` before committing. She also carries **1 Whirlwind scroll** (a
> storage slot) as backup and will lay **1 Grounding rune** in Deployment (reagent
> cost + retreat peril). In battle she spends her 3 scribed casts + the scroll;
> once dry she falls back to her **default bolt** — weak, but still pressure. A
> night's rest refreshes her 3 casts.

## Open questions / future scope

- Exact `X` (scribing budget) by mage/level, scroll costs, default-spell power:
  tuning.
- How a mage's **known-spell list** grows (leveling / recruitment / finds): ties to
  XP & recruitment, later.
- **Ammo's** specific balance within the consumables family: its own discussion.
