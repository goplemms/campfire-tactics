# System — Influence (the Noble's standing)

> Referenced by: [The overworld](overworld.md), [The guild & caravans](guild.md),
> [Combat](../03-combat.md).
> Decisions: **D62** (Influence as its own subsystem), **D61** (the two-axis limiter the
> faucets obey), **D34** (Influence is a walled-off currency), **D30** (one verb per
> economy class), **D33** (bribe → temp/permanent recruit).

## Description

The three economy classes each turn a **different input** into a **different output**, so
none is just "gives gold":

| Class | Input → output | Cadence |
|---|---|---|
| **Merchant** | goods → **gold** (sell, needs a Market) | active |
| **Banker** | time → **gold** (interest) | passive per node-step |
| **Noble** | **presence/patronage → Influence** | passive per node-step + active (Patronize) |

The Noble's fantasy isn't *gold* — it's **opportunity**. As a Noble travels, people seek
them out for patronage and work, so **standing accrues just by being on the road**. That
standing is **Influence**: a separate currency that can **never** pay Upkeep or buy gear
(*D34*), spent to **sway enemies** and read as a **band that gates the quality of what
happens on the map**.

## What Influence *is*

- **Per-expedition, not guild-persistent.** Influence lives on the **run**
  (`run.overworld.influence`), like the carried purse — it is **rebuilt each expedition**
  and does not bank to the guild. Rapport is *local and current*: a renowned caravan this
  run starts unknown the next. (Spending it on a **permanent** bribe recruit still sticks —
  only the standing resets, exactly as a purse-funded gear buy outlives the purse.)
- **Banded (Standing).** The raw value bands into an ordered **Standing** tier — the
  Noble's twin of the Market/intel tiers:

  | Standing | `unknown` | `known` | `respected` | `favored` | `renowned` |
  |---|---|---|---|---|---|

  The **current band** — not the raw number — drives every sink, which creates the core
  tension below.

## Faucets (where it comes from)

Both are keyed to a **Noble in the party** — the dedicated **Noble job** (`hasNoble`, D71),
which replaced the interim "a member with Intelligence ≥ 3" proxy. With no Noble present there
is **no faucet at all** (no free Influence from walking).

1. **Passive presence accrual** — a flat trickle per **node-step** (the Noble's twin of the
   Banker's interest), credited at Break Camp.
2. **Patronize** — an *active* camp verb: spend purse **gold → Influence**, **once per
   node**. It is gated through the **D61 two-axis limiter** (pacing `usesPerNode: 1` ×
   price `gold`), the fold reaching the economy verbs.

> **Why two faucets, both gated.** The retired `Gather Influence` button was *unpaced and
> unpriced* — the exact "free and unlimited" faucet the D61 invariant now forbids. Passive
> accrual is paced by the node-step and gated by Noble presence; Patronize is paced (per
> node) and priced (gold). Neither can be spammed.

## Sinks (what it buys) — and the hoard-vs-spend tension

A high **current** band passively gates good outcomes, but **spending** draws the band
down. That is the deliberate decision the system is built around: *keep my standing high
for opportunities, or cash it in to flip this enemy now?*

- **Bribe** (mid-combat, *D30/D33*): sway an enemy. Both **price and odds read Standing** —
  a higher band sways **cheaper** and **likelier**. The sway is a **roll**: it can **fail**,
  and a failed roll still **spends the Influence and the unit's Act** (the gamble). The roll
  is **deterministic per target + node**, so it can't be save-scummed — *raise your standing
  to shift the odds; you can't reroll the same foe*. A generic turns coat for the fight; an
  authored one joins the guild **permanently** (*D33*).
- **Event quality** (*the map*): Standing **biases the deterministic event pick** — **boons**
  (markets, sellswords, story beats) grow likelier, **banes** (thieves, tolls) rarer — and
  **unlocks premium events** gated behind a band. The first is the **Patron's Welcome**
  (gated at `favored`+): a feast paying **morale + a sellable Valuables gift + a touch of
  Influence**. *No gold-from-nothing* — the boon is an upside you **earn** with standing, and
  the gift routes back through the Merchant's sell loop, keeping gold scarce.

## Determinism (*D22*)

Passive accrual and Patronize are flat (no RNG). The bribe roll and the event pick derive
from seeds (`streamFor(seed, "bribe:<node>:<enemy>")`, `streamFor(seed, "event:<node>")`),
never live RNG — so a replay reproduces exactly.

## Open / deferred

- **Richer sinks** — sway-to-avoid-a-fight, faction access/unlocks, recruitment gates.
- **Tuning** — accrual rate, Patronize cost/yield, band thresholds, bribe cost/chance
  curves, and event-bias magnitudes are all first-pass numbers, parked for a balance sweep.
