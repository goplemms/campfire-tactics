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
- **Combat:** **ping** — a sense radius (ignores line-of-sight) that reveals enemy
  **presence/location without identity** (the **Pinged** state, see
  [vision](vision.md), D18). High Awareness = harder to ambush.

#### Intelligence *(working name)*

- **Intel:** seeds the party's free **[Intel](intel.md) floor** — the baseline tier
  of pre-battle knowledge (types → numbers → positions) the party reads without
  paying. A *different* stat from Awareness, held by *different* archetypes.
- **Naming note:** "Intelligence" may collide with a future magic-power stat; treat
  it as provisional (candidates: Insight, Lore, Cunning). The role is settled.

#### Fatigue *(overworld meter, D29 · shaped by D35 · redesigned D73)*

- **Overworld:** a **per-character** stamina meter — one per roster unit, on the Unit
  (like awareness), **not** a shared party pool and **not** per-ability. Slow,
  personal, gold-free overworld verbs **spend** it; **nights restore** it (below).
- **The clearing currency, not a general tax (D73).** Fatigue is **not** the spine of
  the overworld economy — **per-ability cooldowns / per-node caps are** (see
  [the overworld action economy](overworld.md#the-overworld-action-economy-d35)). It is the
  one cost that is **per-character**, so it is reserved for the **clearing-verb family**:
  slow, repeatable, gold-free actions done *at* a node (Forage, Train, Triage). Cheap
  recon (Survey) is paced by its cooldown and should **not** lean on fatigue. The rule the
  bands make legible: *if a verb costs fatigue, it's a clearing verb.*
- **Banded consequences (D73).** Fatigue keeps the D35 bands but each now does real work,
  shaped as the codebase's **shallow asymmetric floor** (D7/D11, D8) — invisible in normal
  play, biting only on deliberate over-extension:

  | Band | Range | Consequence |
  |---|---|---|
  | **Rested / Worn** | 0 … `floor` | none — the safe allowance; **wiped by any night** |
  | **Weary** | `floor` … `exhausted` | this unit's nightly **rest-heal costs more RP** (the shared pool, floored ≥1) **and** it **carries `level − floor` fatigue into the next day** — only an *improved rest* (a clearing/rest node) clears the carryover; an ordinary night just carries it |
  | **Exhausted** | ≥ `exhausted` | heaviest RP heal cost **and** full carryover **and** a **combat consequence**: the unit enters its next battle **Slowed** (a tempo/CT debuff, the `slowed` status) |

  No hard action-lock — the model is **consequence-based, not prohibition-based** ("recoverable
  and outplayable"); the `ceiling` clamp prevents runaway. Carryover compounds if you over-extend
  the same unit day after day, and resets the moment you back off (one easy day in Worn wipes it).
- **Reaches combat only at Exhausted (revises D29).** The old hard rule "fatigue never
  touches combat" is **dropped** (a consequence that never reaches the main loop is a weak
  consequence). Worn/Weary stay overworld-only; **only Exhausted** bleeds into battle, and only
  as a **tempo status (Slowed)** — *never* a flat power debuff (−attack/−defense), preserving
  "punish choices, not execution." The effect is **universal across playstyles**: a Slowed
  combatant loses turns/output; a Slowed engine unit (which fields too — D38) is harder to
  protect (slower to retreat/brace). It also concentrates **eggs-in-one-basket** risk — a unit
  *exercising* two clearing roles hard tires faster, so spreading verbs across bodies is rewarded.
- **Open / tuning (D73):** the RP heal-cost multipliers, the Slowed magnitude + duration
  (start gentle, whole-encounter, CT-only), whether Weary also bleeds a milder combat effect
  (start Exhausted-only), and clearing/rest-node **frequency** (sparse clearings make Exhausted
  punishing — a map-density balance lever).

### The deliberate split

Two prep stats that deliberately don't overlap, plus the clock stat:

| | **Awareness** | **Intelligence** | **Speed** |
|---|---|---|---|
| Deployment | *how safely* you prep | — | *how much* you prep |
| Pre-battle | — | *how much you see* (intel floor) | — |
| Combat | **ping** (sense enemies; ambush defense) | — | turn frequency + charge speed |

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
