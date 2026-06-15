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
- **Deployment:** **range & throughput** — how far a unit can venture *and still get
  home*, and how many placements it can fit.
- **Initiative seed:** a side's starting CT seed is computed from its **deployed,
  non-captured** units' Speed.

#### Awareness

- **Deployment:** **safety** — a **deeper safe depth** and a **quieter footprint**
  past it (less noise, gentler capture odds) (D46). The high-Awareness unit preps deep
  without getting spotted.
- **Combat:** **ping** — a sense radius (ignores line-of-sight) that reveals enemy
  **presence/location without identity** (the **Pinged** state, see
  [vision](vision.md), D18). High Awareness = harder to ambush.

#### Intelligence *(working name)*

- **Intel:** seeds the party's free **[Intel](intel.md) floor** — the baseline tier
  of pre-battle knowledge (types → numbers → positions) the party reads without
  paying. A *different* stat from Awareness, held by *different* archetypes.
- **Naming note:** "Intelligence" may collide with a future magic-power stat; treat
  it as provisional (candidates: Insight, Lore, Cunning). The role is settled.

#### Fatigue *(overworld meter, D29 · shaped by D35)*

- **Overworld:** a single **per-character** stamina meter that **overworld abilities
  spend and rest restores** — restored chiefly at **rest nodes** (rest's second job).
  Deliberately **one meter, not per-ability** (D15 restraint).
- **A LOOSE guardrail, not a tight pool (D35).** Fatigue is **not** the spine of the
  overworld action economy — **per-ability cooldowns are** (see
  [the overworld action economy](overworld.md#the-overworld-action-economy-d35)). Fatigue
  follows the codebase's **shallow asymmetric-floor** shape (D7/D11 deployment overdraw,
  D8 morale): a **generous allowance, invisible in normal play, that bites only when you
  greedily skip rest and over-extend** night after night. The point is the
  *over-extension stake*, not a per-camp rationing chore — a depleting meter is used here
  *because* it has been given the shallow-floor shape that avoids hoarding/agony.
- **Not a combat stat:** Fatigue governs the *overworld* action economy (node-steps),
  not the CT clock, and **does not affect combat readiness** (D29's two-economies
  separation). Keep it off the combat block.

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
