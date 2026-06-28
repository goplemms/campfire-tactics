# System — Mortality, recovery & difficulty

> Referenced by: [Deployment](../02-deployment.md) (capture, rescue scenarios),
> [Combat](../03-combat.md) (downed units), [Resolution](../04-resolution.md),
> [Pre-deployment](../01-pre-deployment.md) (cleric, camp recovery).
> Decision: **D9**.

## Description

This system answers two questions a roguelike must: **how do units leave the run,
and how do they heal between fights?** The guiding philosophy is **punish choices,
not execution** — you should lose units because of *decisions you made*, not
because a single battle went badly.

Difficulty is the dial. Each difficulty is a **consequence policy**: a data object
the core consults when resolving a downed or captured unit. Policies are swappable
and headlessly testable, the same data-driven approach as jobs.

The universal time unit across the run is **a night**.

### Two loss vectors × difficulty

| Difficulty | **Combat down (HP→0)** | **Captured & unrescued** |
|---|---|---|
| **Easy** | Healed by a night's rest, no cost | Take the quest → **guaranteed** rescue, no timer |
| **Normal** | Redeploys at **½ HP**, heals over nights — no permadeath | Quest must be **earned** (a real fight), no timer |
| **Hard** | **Dying:** pay a **local cleric** within N **nights** or permadeath | Quest, **narrow** night-window + **reduced Deployment** |
| **Hardest** | Permadeath at **0**, flat | Quest, **tight** window + **heavily reduced Deployment** |

Two recurring ideas in that table:

- **The local cleric** is **emergency life-saving only** (the Hard-mode dying save).
  It costs gold — a deliberate **economy sink** that ties mortality to the Merchant
  loop. It is *not* general healing (that's Recovery, below).
- **Rescue missions are disadvantaged battles.** Because the enemy knows you're
  coming, a rescue uses **reduced Deployment** — an "ambush-in-reverse"
  [scenario modifier](../02-deployment.md) that scales with difficulty. (This
  modifier is reusable for any battle where you're the one being caught out.)

A captured-and-unrescued unit becomes a **rescue follow-up quest**, *not* an
instant death. Abandoning that quest (declining it, or letting its window expire on
Hard/Hardest) is what finally loses the unit — a **grace window** to grind
resources before the big save, with real loss only as the back-stop.

> **Capture has two entry points**, both resolving through this same policy:
> **pre-battle** (a Deployment overreach, D11) and **in-combat** (an enemy **Snare**
> runs its capture countdown out, D12 — see
> [field-entities](field-entities.md)). Either way the unit enters the rescuable
> captured state above.

### Recovery — the Rest-Point (RP) meter

Between-battle healing is **not flat**; it scales with the party's support
capability and is spent by **triage**.

- Each night, **support roles** (Cook, Medic, Bard, Survivalist, …) add **Rest
  Points** to a pool — a **data-driven** value per role, so adding a healer is
  adding a number.
- RP converts to healing at a threshold: **`RP_PER_CHUNK` rest points → one chunk
  = `CHUNK_FRACTION` of max HP.** Default `CHUNK_FRACTION = 1/8`; **every constant
  is configurable** (not hardcoded).
- **Difficulty scales `RP_PER_CHUNK` and nothing else** — one dial for the whole
  gradient (e.g. Easy `10`/chunk, Hardest `20`/chunk).
- RP is spent by **triage**: the player **allocates the pool to chosen units** each
  night. This is what gives the Hard-mode dying clock teeth — limited RP, multiple
  wounded, a deadline.

## Pseudo-example

> **Hard difficulty.** After a brutal fight: **Rook** is *dying* (3 nights on the
> cleric clock), **Vale** is at ¼ HP, **Ember** at ½ HP. The party's support
> (Bard `+3`, Cook `+2`) banks **5 RP/night**; `RP_PER_CHUNK = 20`, chunk = 1/8 HP.
>
> - **Night 1.** The player has 240 gold. They pay the **cleric** to pull Rook out
>   of *dying* (he survives, but battered). 5 RP banked → not yet a chunk; the
>   player holds it.
> - **Night 2.** 10 RP now. Still under 20 — but Vale (¼ HP) is deploying next
>   fight, so the player commits both incoming chunks-in-progress to her via
>   **triage** when they mature, leaving Ember to wait.
> - **Night 3.** 20 RP reached → **one 1/8 chunk** spent on **Vale**. She's the
>   priority; Ember rides into the next fight still at ½.
>
> The crunch is the *allocation under a deadline*: gold saved Rook's life, but RP is
> scarce enough that someone always goes into the next battle hurt.

## Open questions / future scope

- Exact numbers: per-role RP, `RP_PER_CHUNK` per difficulty, `CHUNK_FRACTION`,
  cleric cost, rescue-window lengths — all tuning.
- Whether difficulty scales anything **beyond** mortality (enemy strength, economy,
  exposure curve): **scoped out** for now — difficulty = the consequence dial.
- Per-unit morale interactions with desertion (see [morale](morale.md)): later.
