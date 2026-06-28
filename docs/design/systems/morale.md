# System — Morale

> Referenced by: [Pre-deployment](../01-pre-deployment.md) (Cook),
> [Deployment](../02-deployment.md), [Combat](../03-combat.md),
> [Resolution](../04-resolution.md). Decision: **D8**.

## Description

Morale is a **passive, party-wide readiness meter**. It is *not* a resource you
spend or a meter you actively manage — you simply *are* at a morale tier, and a
small bundle of modifiers applies automatically. It is the connective tissue
between the **Cook** (who cooks it up) and the rest of the systems.

Two principles define it:

1. **A bundle of minor effects, never one big lever.** No single modifier swings a
   fight; morale is felt as a gentle, broad tilt.
2. **Asymmetric — upside you earn, with a shallow floor.** Neutral is baseline (no
   modifiers). High tiers *add* modest bonuses. The Low tier applies only
   *marginal* penalties — often just the absence of bonuses rather than going
   net-negative. The distance Neutral→Low is deliberately much smaller than
   Neutral→High, so the game never "kicks a player while they're down."

### Tiers (working model — breakpoints open)

| Tier | Effect |
|---|---|
| **High** | the full bonus bundle |
| **Neutral** | baseline — no modifiers |
| **Low** | one or two *marginal* penalties only |

(Finer tiers — e.g. two High bands — are possible later; the asymmetry rule holds
regardless.)

### The effect menu (open pool)

Effects are an **open menu** we draw from, not a locked list. Bias is toward
effects that reinforce systems we already have:

- **On-theme (preferred):**
  - **Deployment safe allowance** ±1 — confident troops set up bolder (ties to
    [Deployment](../02-deployment.md) / D7).
  - **Initiative seed** slightly warmer — a ready party starts the CT clock hotter
    (ties to [action economy](action-economy.md) / D5).
  - **Capture exposure** slightly lower at high morale — alert, confident units.
- **Flat / safe combat fillers:** crit chance, slight max-HP or small chip-heal,
  accuracy/evasion.
- **Run-flavored:** loot/gold find at high morale (ties to the Merchant economy).

> **Speed caution.** Speed compounds in the [CT clock](action-economy.md) (it sets
> both turn frequency *and* charge-landing speed), so a morale→speed effect must be
> the **smallest** in the bundle, or omitted entirely.

### What moves morale

- **Up:** the Cook's **morale meals** (see
  [Pre-deployment](../01-pre-deployment.md)); a clean **rescue**.
- **Down:** **abandoning** a captured ally (declining/expiring their rescue quest);
  losing a unit; **underfunding [Upkeep](logistics.md)** — skipping **food** is a
  fast, **high** hit, letting **repairs** slide is a slower, **moderate** one. Per
  the *punish-choices-not-execution* philosophy, the heaviest hits come from
  **choices** (abandonment, neglect), not from a hard-fought loss.
- **Desertion:** sustained **Low** morale, night over night, eventually makes a unit
  **walk** — the terminal stake of letting the party rot. (Party-wide morale must
  pick a victim, a natural hook toward the per-unit-morale lever below.)

## Pseudo-example

> The party finishes a run of good fights well-fed (Cook active) and pulls off a
> daring rescue → morale reaches **High**. The bundle applies: +1 Deployment safe
> allowance, a warmer initiative seed, a touch more crit. None of it decides a
> fight alone, but the party *feels* sharp and sets up boldly.
>
> Later they abandon a captured scout (declined the rescue quest) → morale drops to
> **Low**. The penalty is marginal — a slightly colder initiative seed — and the
> High-tier bonuses simply lapse. The run is harder, but not punishing.

## Open questions / future scope

- Exact tier breakpoints and the final selection + magnitudes of effects: tuning.
- Party-wide (current default) vs. per-unit morale: per-unit is a later depth lever
  (enables *specific* units' morale to drive desertion drama).
- Whether morale ever reaches into combat directly beyond the flat fillers:
  currently kept light on purpose.
