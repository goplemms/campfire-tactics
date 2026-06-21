# Phase 2 — Deployment ("earlier that day", on-map)

> Pipeline position: `Pre-deployment → [DEPLOYMENT] → Combat → Resolution`
> Related systems: [Field entities & the trigger bus](systems/field-entities.md),
> [Stats](systems/stats.md), [Action economy](systems/action-economy.md)

## Description

Deployment is the **on-map "earlier that day"** phase: the party arrives at the
battlefield ahead of the enemy and sets up. This is **spatial logistics** — using
the materials provisioned in [Pre-deployment](01-pre-deployment.md) to place
**field entities** (traps, defensive nests, ritual runes — see
[field-entities](systems/field-entities.md)) against the real terrain.

It is **not** a free setup phase. It is a **push-your-luck race against a closing
net.** The enemy is advancing; the longer your units linger forward preparing, the
likelier one is caught out of position.

> **Note (D63).** The model below is the **implemented** one — *the closing net*. It
> replaces the earlier "safe period → auto-retreat at the buzzer → per-step capture
> roll" gamble specced in **D11** (which was never built). The banded, transparent,
> spatial *spirit* of D11 — and the Awareness/Speed/morale/intel roles, and the
> capture/rescue payoff — all carry over; only the resolution curve changed.

### The closing-net model — two influence sources on one clock (D63)

Deployment runs as a **turn-based phase on the same board and the same CT clock as
Combat** (see [action-economy](systems/action-economy.md)). Player units take real
turns — **move**, **Dig In**, or **place** a field entity — and the board is shaped
by **two radial influence sources**, measured in orthogonal steps:

- **Your campfire** — a home-edge anchor whose **safe radius** scales with the
  party's total combat **presence** (a sturdier party intimidates further out).
- **The enemy's danger source** — a single actor on the deployment clock that starts
  with no reach and **grows one step on each of its turns**. The danger **overrides**
  the campfire, so a growing enemy radius **eats into your safe ground** — your
  territory shrinks turn by turn.

```
   CAMP ★░░░░  Safe        (inside the campfire, not yet reached — ~0%)
        ░░░░░  Exposed     (neutral ground — safe for now)
        ▒▒▒▒▒  Warning     (the ring the net takes next turn)
   ENEMY█████★ Danger      (inside the enemy radius — rolls capture)
```

**Capture is rolled only on the net's turn** — never per player turn — for every unit
inside the danger radius, **deepest first**. The per-tile odds scale with how deep a
unit sits inside the radius (capped, so even a surrounded unit is never a sure loss),
and the party's **last un-captured fighter is never netted**. The **first** catch
raises the alarm and Combat begins; if the net overruns the last safe tile with
nobody caught, Combat begins anyway.

A unit may **Dig In**: hunker on its tile for a **sharply reduced** capture chance,
at the cost of its turn (moving breaks the stance). Or simply **hold safe ground** —
place nothing, take zero risk, be ready when Combat starts. Deployment is opt-in per
unit: *range forward (more setup, more risk)* vs. *hold / dig in (safe, less setup)*.

Two stats drive the gamble (see [Stats](systems/stats.md)):

| Stat | Role in Deployment |
|---|---|
| **Awareness** | **Safety.** Widens your safe radius (folded with morale + intel in `deployMods`), so you can place further forward before the net reaches you. |
| **Speed** | **Throughput.** Capture is on the *net's* clock, so a faster party earns **more positioning turns between net-closings** — more setup for the same risk. (Also the unit's Combat CT stat.) |

High party **morale** widens the safe radius (confident troops set up bolder) — see
[morale](systems/morale.md). And a **Tier-3 [intel](systems/intel.md)** read, plus
scouted ground (D10), further widens it — so investing in intel makes ranging out
safer, a deliberate cross-reinforcement of the prep systems.

### Capture — the cost of overreach

If a retreat-step roll fails, the unit is **captured** (and is **repositioned into
the enemy's safe zone** to start the battle). A captured unit:

- still **appears on the battlefield**, but **bound/guarded** under enemy control;
- does **not** count toward your **active fielded count** (effective **−1**);
- is **removed from your side's initiative seed** (see below), so the enemy gets
  earlier turns;
- may be **out of position / underequipped** from whatever it half-finished.

Capture is **recoverable**: a captured unit is a **rescue sub-objective** on the
map. Reaching and freeing them mid-Combat turns the **−1 back into +1**. A unit
**still captured when the battle ends** is *not* instantly lost — it becomes a
**rescue follow-up quest** whose harshness scales with difficulty (see
[mortality-recovery](systems/mortality-recovery.md), D9). This keeps the gamble
dramatic without being a blind death roll, and only *abandoning* the rescue
ultimately loses the unit.

> **Scenario modifier — ambush in reverse.** A rescue mission is a *disadvantaged*
> battle: the enemy knows you're coming, so the rescuing party fights with
> **reduced Deployment**. This "reduced-Deployment" modifier is reusable for any
> encounter where you're the one caught out.

> Emergent payoff: your *own* greedy prep authors the battle's objectives. A
> captured ally is a fight you created by overreaching.

### Enemy prep — fortified encounters (D12)

Prep isn't only yours. **Fortified encounters** (an enemy camp, a defended
chokepoint, *every rescue mission*) have the enemy pre-place hazards too — while
open-field scraps and ambushes don't. This makes enemy prep a *flavor of encounter*
rather than a universal tax, and it gives your **Intel/Awareness** a defensive job:

- **Detection** of enemy entities is gated by [Intel](systems/intel.md) / Awareness
  (Tier-3 or high Awareness reveals them; otherwise hidden until sprung).
- **Disarm** costs an **Act** (the Survivalist's defensive side) — or just route
  around what you've spotted.
- The exemplar enemy entity is the **Snare**, which can drag a unit into **capture
  mid-battle** — see [field-entities](systems/field-entities.md).

### Initiative seeding (link to the CT clock)

Combat uses a per-unit [CT clock](systems/action-economy.md), but each **side**
gets a **starting CT seed** computed from its **deployed, non-captured** units'
Speed. Two consequences:

- Heavy, greedy prep that gets a unit captured **lowers your seed** → the enemy
  acts first. This is the **"prep vs. readiness"** dial in concrete form.
- A side that mostly **held position** starts the clock **warmer**.

### Output of the phase

Deployment hands Combat: the set of **placed field entities**, each unit's
**starting tile**, any **captured** units (and their guards), and the **initiative
seed** for both sides.

## Pseudo-example

> The canyon map from Pre-deployment loads. The party has `2 × trap kit`,
> `1 × fire-rune reagent`, and Vale's arrows already on her. A sturdy party, so the
> **campfire's safe radius reaches the canyon mouth**; the enemy danger source starts
> cold at the far edge.
>
> 1. **Bram** (Survivalist) spends his turns inside the safe ring, planting **both
>    trap kits** on the chokepoint tiles. No risk taken — the net hasn't reached him.
> 2. **Vale** (Scout, **high Speed**) uses her extra positioning turns to range
>    **forward of the fire**, near the enemy approach, and **place the fire rune** on
>    a deep tile. The board flags that tile **Warning** — the net takes it next turn.
>    The player gambles for the value and leaves her there.
> 3. The clock steps to the **net's turn**: the danger radius grows over Vale's tile
>    and rolls capture. ✗ — **Vale is netted**, bound on the map, and the **alarm
>    goes up**.
>    - The side is now **3 active + 1 captured**.
>    - Vale's Speed drops from the **initiative seed** → the **enemy side acts first**.
> 4. **Rook** (Soldier) and **Ember** (Mage) had **held safe ground** behind the trap
>    line — ready, well-placed. The alarm starts Combat with everyone where they
>    stand: 2 traps armed at the canyon mouth, 1 fire rune live near the enemy
>    approach, Vale captured on the ledge, enemy holding the initiative. On to **Combat**.

## Open questions / future scope

- Exposure model is **resolved + built** (D63 — the closing net; supersedes the
  never-built D11 retreat-race): two radial sources on the CT clock (campfire safe
  radius sized by presence vs. an enemy danger source that grows one step per net
  turn and overrides the campfire); capture rolled **on the net's turn**, deepest
  first, banded and capped, last fighter spared; **Dig In** for a reduced chance;
  Awareness/morale/intel widen the safe radius, Speed buys more positioning turns.
  Only the radius/growth/capture-curve numbers are tuning. **Architecture:**
  Deployment is being unified into `Battle` as a true phase — see the
  [unification plan](../../scratchpad/foundations/deployment-combat-unification-plan.md).
- Enemy-prep symmetry is **resolved** (D12): A3 fortified-encounter type;
  Intel/Awareness-gated detection; Act-cost disarm or route-around; the Snare drags
  units into in-combat capture. See [field-entities](systems/field-entities.md).
- Guard composition for captured units (how hard a rescue is) is encounter-driven;
  generation rules come with the run loop (M6).
