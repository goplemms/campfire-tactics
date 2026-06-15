# System — Intel (pre-battle knowledge)

> Referenced by: [Pre-deployment](../01-pre-deployment.md) (provisioning),
> [Deployment](../02-deployment.md), [Stats](stats.md), [The overworld](overworld.md).
> Decisions: **D10**, **D24** (the node preview), **D48** (the reach axis / overworld fog).

## Description

You provision **blind-ish** — you bet on a loadout in
[Pre-deployment](../01-pre-deployment.md) before you fully know the fight. **Intel**
is whatever lifts that fog. It is **per-encounter, party-wide** knowledge about
*this* battle, and it resets for each new one.

### Banded into tiers (breakpoints)

Intel is **banded** — discrete tiers separated by **breakpoints** — which gives us
clean, tunable balance levels (a convention we lean on across the game's number
systems):

| Tier | Reveals | Tells you… |
|---|---|---|
| **1 — Types** | what *kinds* of enemies | *what to pack* (canyon goblins ⇒ traps) |
| **2 — Numbers** | how *many* | *what to counter / how much ammo* |
| **3 — Positions** | *where* they start & their specials | *exactly how to deploy* |

"Crossing a breakpoint" means moving up a tier. Banding is what makes effects like
the Seer's "jump a breakpoint" meaningful.

### Three lanes up the ladder

Intel can be earned by **stat, by gold/risk, or by a specialist** — three
complementary lanes:

1. **Passive — the Intelligence stat.** A free **floor**. High-**Intelligence**
   units (Diplomat, Noble, Seer) raise the baseline tier the party reads for free.
   This is a *different stat from Awareness* (see [stats](stats.md)): Awareness is
   *how safely you prep*; Intelligence is *how much the party sees*.
2. **Scouting — paid + risky.** Spend **gold / a ration** to buy a tier, or **send a
   unit to scout** for the deepest read — that scout then starts the battle **out of
   position** (a risk that rhymes with the Deployment gamble, D7).
3. **Divination — the Seer.** Jump a **full breakpoint** (below).

### The Seer — exemplar Meta-phase intel job

The Seer is to **intel** what the Survivalist is to **traps**: the signature job
that proves the lane. It hooks the **Meta/Pre-deployment** phase.

- **Low rank:** spends a **divination reagent** (chicken bones for a fire-read) to
  jump **one** breakpoint — *reliable but costly*. This pulls divination reagents
  into the **[logistics](logistics.md)** pillar (bones compete for storage like any
  material).
- **Master rank:** reads **for free** (no reagent) with a **chance to jump multiple
  breakpoints** — *free but variable*, an occasional windfall reveal.

That reagent-vs-skill split is a deliberate risk/economy axis: pay for certainty,
or gamble on a gifted reader.

### Two axes: depth & reach (D48)

Intel has **two independent axes**. The tier ladder above is the first:

- **Depth** — *how much* you know about a single node (types → numbers → positions). Per-node,
  earned via the three lanes.
- **Reach** — *how far ahead* you can see **at all**, on the overworld. Intel drives an
  **overworld fog**: you see the route out to `baseReach + tier × bandStep` steps forward,
  with **base ≈ half the map** and each band extending it (tunable to effectively infinite).
  The **immediately-reachable nodes are always visible** (you can never be unable to choose);
  beyond your reach the map is fogged. This makes intel load-bearing for **planning the route**
  — the economic [forecast](overworld.md#the-route-forecast--overworld-fog-d48) (D48), where
  the nearest rest and the burn to reach it become things intel *reveals* — not just for
  sizing the next fight. A Seer who sees two fights ahead is reading **reach**; a Seer who
  reads an ambush's exact positions is reading **depth**.

> **Determinism.** The map is fully known internally; fog is a **pure visibility mask** (a
> BFS cut at the reach limit) — no live RNG, fully replayable for a seed.

> **Naming note.** "Intelligence" here means *intel-gathering*, which may collide
> with a future magic-power stat. Treat the name as provisional (candidates:
> Insight, Lore, Cunning) — the *role* is settled, the label is not.

## Pseudo-example

> The party eyes an unknown encounter. Storage is tight.
>
> 1. **Passive floor.** The Noble's **Intelligence** gives a free **Tier 1**: it's a
>    *goblin* warband. The player packs trap kits over anti-armor gear.
> 2. **Scouting.** They spend a ration to buy **Tier 2**: *eight* goblins — more
>    than feared. The player loads extra arrows, eating a storage slot they'd hoped
>    to save.
> 3. **Divination.** The party's low-rank **Seer** burns **chicken bones** (one
>    reagent) to jump to **Tier 3**: the goblins start massed at the canyon's *east
>    mouth*. Now the player knows *exactly* where to lay both traps in Deployment.
>
> A **master** Seer might have skipped the bones entirely — and, on a lucky read,
> vaulted straight from Tier 1 to Tier 3 for free.

## Open questions / future scope

- Exact breakpoint thresholds and what each tier costs (gold/ration/reagent): tuning.
- The "Intelligence" stat name (collision with a magic stat): provisional.
- **In-combat fog-of-war / vision** is its **in-battle twin** — now designed in
  [vision](vision.md) (D18). A Tier-3 intel read grants **starting vision** of the
  enemy's deployment, bridging the two.
