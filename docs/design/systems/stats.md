# System — Stats

> Referenced by: [Deployment](../02-deployment.md), [Combat](../03-combat.md),
> [Action economy](action-economy.md), [The overworld](overworld.md),
> [The guild & caravans](guild.md).
> Decisions: **D29** (Fatigue), **D32** (leveling), **D35** (Fatigue as a loose guardrail).

## Description

This doc tracks the stats the design has **committed** so far. The full combat
stat block (HP, attack, defense, range, move…) is intentionally **not** nailed
down here — it lands alongside the M3 battle-loop implementation. What's recorded
now are the two stats that the *signature* mechanics depend on, deliberately split
so they don't overlap.

### Committed stats

#### Speed

- **Combat:** drives the [CT clock](action-economy.md). Higher Speed → `CT` fills
  faster → more frequent turns and faster-landing charged effects.
- **Deployment:** **throughput** — how many placements a unit can fit in the setup
  window before it closes.
- **Initiative seed:** a side's starting CT seed is computed from its **deployed,
  non-captured** units' Speed.

#### Awareness

- **Deployment:** **safety** — a longer **safe period** and **gentler retreat odds**
  (D11). The high-Awareness unit preps deep without getting captured.
- **Combat (built):** **trap-spotting** — Awareness scales the passive spot radius and
  spot-roll that reveals concealed enemy traps (`traps.ts` `spotRadius`/`spotChance`),
  and a deliberate **Search** widens it. This is Awareness's actual in-battle role today.
- **Combat (designed, not built):** the **ping** — a sense radius (ignores line-of-sight)
  revealing enemy **presence/location without identity** (the **Pinged** state) — is part
  of the deferred D18 vision ladder (see [vision](vision.md), #143/#148), not yet in code.

#### Intelligence *(working name)*

- **Intel:** seeds the party's free **[Intel](intel.md) floor** — the baseline tier
  of pre-battle knowledge (types → numbers → positions) the party reads without
  paying. A *different* stat from Awareness, held by *different* archetypes.
- **Naming note:** "Intelligence" may collide with a future magic-power stat; treat
  it as provisional (candidates: Insight, Lore, Cunning). The role is settled.

#### Fatigue *(overworld meter, D29 · shaped by D35 · redesigned D73 · unified D80)*

- **Overworld:** a **per-character** effort meter — one per roster unit, on the Unit
  (like awareness), **not** a shared party pool and **not** per-ability. It is the one
  **effort meter** of the overworld: **everything a unit does out of combat is an effort
  skill** (D80) — from a heavy one (Survey ≈ 4) down to a negligible ~0 — plus **Rest**.
  Effort accrues Fatigue; nights shed it (below). There is no assignment board and no
  "arduous" category — one number, in and out.
- **Its main job — gate recovery (D80).** A **Clearing**'s Deep Rest grants a **big heal**,
  but **only to a unit at Tier 0 when the rest resolves** (`isFatigueTier0`). So
  over-extending (or spending heavy effort *at* the Clearing) **forfeits the heal** without
  ever locking a verb — the allocation puzzle falls out of unit state, no board. (This
  **supersedes** the D73 "clearing currency, not a general tax" framing: fatigue is no
  longer reserved for a clearing-verb family — Survey and the rest all cost effort now.)
- **Narrowing bands + one-tier nightly step-down (D80).** Tiers are banded with
  **tightening widths** (`FATIGUE_TIER_FLOORS`) — each costs less effort to reach than the
  last, so stacking heavy skills without a rest tips a unit deeper, faster. Every **nightly
  rest** (free, at any node) steps Fatigue **down one tier** (to the floor of the tier
  below, `nightlyFatigue`) with a small HP chip — replacing D73's `level − floor` carryover:

  | Band | Range | Consequence |
  |---|---|---|
  | **Rested / Worn** | 0 … `floor` | none — the safe allowance; **Tier 0 keeps the Deep-Rest big heal** |
  | **Weary** | `floor` … `exhausted` | above Tier 0, so a Clearing's **big heal is forfeited** until stepped/rested back down; steps down one tier each night |
  | **Exhausted** | ≥ `exhausted` | still no heal **and** a **combat consequence**: the unit enters its next battle **Slowed** (a tempo/CT debuff) |

  No hard action-lock — **consequence-based, not prohibition-based** ("recoverable and
  outplayable"); a `ceiling` clamp prevents runaway.
- **Reaches combat only at Exhausted (revises D29).** Worn/Weary stay overworld-only;
  **only Exhausted** bleeds into battle, and only as a **tempo status (Slowed)** — *never* a
  flat power debuff, preserving "punish choices, not execution." Combat **reads** fatigue (to
  Slow) but never **writes** it. It concentrates **eggs-in-one-basket** risk — a unit doing
  all the heavy effort tires faster, so spreading verbs across bodies is rewarded.
- **Open / tuning (D80):** the band floors, the Slowed magnitude + duration, the Deep-Rest
  heal size, and clearing/rest-node **frequency** (sparse clearings make Tier-0 harder to
  hold — a map-density balance lever). Numbers are illustrative.

### The deliberate split

Two prep stats that deliberately don't overlap, plus the clock stat:

| | **Awareness** | **Intelligence** | **Speed** |
|---|---|---|---|
| Deployment | *how safely* you prep | — | *how much* you prep |
| Pre-battle | — | *how much you see* (intel floor) | — |
| Combat | **trap-spotting** (built); ping/ambush defense (designed, #148) | — | turn frequency + charge speed |

This gives real archetype spread: a **Survivalist** is high-Awareness (preps
safely) but modest-Intelligence; a **Diplomat / Noble** is high-Intelligence (great
intel) but modest-Awareness; a **fast scout** crams in placements but lives on the
edge of capture.

## Pseudo-example

> Two units approach the same Deployment window:
>
> - **Bram** — **Awareness 8 / Speed 4.** Large safe allowance: he plants **2
>   traps** with the meter still at **0%**. But low throughput means he can't fit a
>   3rd placement before the window closes. *Few, but safe.*
> - **Vale** — **Awareness 3 / Speed 9.** High throughput: she could attempt **3–4**
>   placements — but her small safe allowance means the **2nd** already pushes her
>   into overdraw (**35%** and climbing). *Many, but risky.*
>
> In Combat the same split persists: Vale (Speed 9) takes turns far more often than
> Bram (Speed 4) and lands charged effects sooner. Meanwhile, back in camp, the
> **Noble** (high Intelligence, low Awareness) contributes nothing to placing traps
> safely but hands the party a free **Tier-2 intel** read on the coming fight.

## Open questions / future scope

- The full combat stat block (HP/attack/defense/range/move/**sight radius**) is
  defined with M3. (Sight radius drives the **Seen** state, [vision](vision.md).)
- Intel is **resolved** — it is its own stat (Intelligence) feeding the three intel
  lanes; see [intel](intel.md) (D10). The stat *name* remains provisional.
- Stat growth/leveling **direction is set (D32)**: **combat jobs** level via combat
  XP; **secondary** (FFT-style) abilities level through **use**; **non-combat jobs**
  level via a **passive trickle while deployed + a per-successful-use bump** (benched =
  no growth). The concrete curves/numbers remain to be tuned. See
  [the guild & caravans](guild.md).
