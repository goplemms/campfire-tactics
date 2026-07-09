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

1. **A bundle of effects, never one big lever.** No single modifier decides a
   fight, but the bundle is **deliberately felt**, not decorative. The magnitudes
   were **raised past D8's shallow first pass** (`morale.ts`): at ±3–8% the bundle
   sat below player perception, so the tuning was lifted so a High/Inspired party
   *visibly* hits harder, finds more gold, and holds formation (a tuning call made
   in code without its own logged decision — recorded here).
2. **Asymmetric — upside you earn, with a shallow floor.** Neutral is baseline (no
   modifiers). High tiers *add* modest bonuses. The Low tier applies only
   *marginal* penalties — often just the absence of bonuses rather than going
   net-negative. The distance Neutral→Low is deliberately much smaller than
   Neutral→High, so the game never "kicks a player while they're down."

### Tiers (four, built — breakpoints tunable)

`MoraleTier = "Low" | "Neutral" | "High" | "Inspired"` (`camp.ts`), banded on whole
morale points (Inspired ≥ 3, High ≥ 1, Neutral = 0, Low < 0). Real magnitudes from
`morale.ts`'s table:

| Tier | Effect (as built) |
|---|---|
| **Inspired** | +2 Deployment safe depth, +9 initiative seed, 0.7× capture exposure, **+18% crit**, **+25% gold find** |
| **High** | +1 safe depth, +6 initiative seed, 0.8× exposure, +10% crit, +12% gold find |
| **Neutral** | baseline — no modifiers |
| **Low** | −4 initiative seed, −4% crit (marginal only) |

(Finer tiers are possible later; the asymmetry rule — Neutral→Low much smaller than
Neutral→High/Inspired — holds regardless.)

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
- **Desertion:** *(**Designed, not built** — deferred, D15/#148; only a flavor comment
  in `hollow-mill.ts` today.)* sustained **Low** morale, night over night, is designed to
  eventually make a unit **walk** — the terminal stake of letting the party rot. (The
  outcome-driven movers above — clean-rescue up / abandonment down — are **also**
  designed-not-built, #148: `RunLoop.resolve()` doesn't write morale; today's real movers
  are Cook meals, the +2 rest tick, upkeep breaches, and event deltas.)

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
