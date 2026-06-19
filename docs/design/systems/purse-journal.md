# System — Purse journal (the run-economy transaction substrate)

> Referenced by: [Logistics & inventory](logistics.md), [The overworld](overworld.md),
> the ledger (`src/core/ledger.ts`).
> Decisions: **D34** (two pools + Influence — the purse vs. treasury split this honors),
> **D45** (the ledger readout this will eventually feed), **D61** (the standardized
> action-cost gate). Implementation: `src/core/purse-journal.ts`, `src/core/camp.ts`.
>
> Status: **substrate built & verified; presentation deliberately deferred.**

## Why

The run is, to a large degree, a **numbers-balancing game**, and the purse
(`camp.gold`) is its single bottom line. But that bottom line used to move
**invisibly**: gold was mutated inline at ~11 sites across six modules, and
`buildLedger` *re-derived* an approximation of the flow after the fact from node
history. When a run felt too poor or too rich there was no way to point at *which
sink or source* was responsible.

The fix is **provenance**: record *where each gold movement came from and went*,
not just the resulting number. This serves two audiences from one record:

- **Playtesting / balancing** — dump the log out of the headless sim → a per-run
  income/expense table with every line, so a designer tunes against evidence.
- **Power players** — feed the same log into the [ledger](logistics.md) screen,
  which already follows *“broad totals → expand for crunch”* (D45) progressive
  disclosure: a casual player sees the totals; a power player expands to the lines.

## The shape

A **purse journal** — an append-only log of every gold movement, each a signed
delta tagged with a typed source, mutated only through one chokepoint.

- **`camp.purseLog: PurseEntry[]`** — `{ delta, source, label, nodeId?, night? }`,
  in order. Seeded with the carried-purse **opening** entry by `createCamp`.
- **`earn(camp, amount, source, label, ctx?)` / `spend(...)`** — the single
  credit/debit chokepoint (an intent-named pair). It mutates the purse **and**
  records why. `spend` does not itself gate affordability — callers still check
  first, exactly as before.
- **`PurseSource`** — a typed union: `opening · loot · sale · toll · upkeep ·
  cleric · theft · recovery · banker · interest · recruit · event · action`.
- **Report primitives** — `purseFromLog(camp)` and `purseTotalBySource(camp, src)`
  fold the log (the latter is the grouped-report seam).

All eleven purse-mutation sites now route through the chokepoint (theft skim &
recover, node-event recruit/event/toll, loot & Merchant sale via `gainRunGold`,
Banker loan, Upkeep, cleric revive, Banker interest, overworld-ability gold cost).

## The invariant

Because every movement flows through `earn`/`spend`, the journal reconciles to the
purse **by construction**:

```
sum(camp.purseLog deltas) === camp.gold
```

A test asserts this after **five full simulated runs** — so any future gold
mutation that bypasses the chokepoint (a missed site) fails the build, not silently
drifts. This is the combat-economy analog of a balanced ledger: cheap to check
because the purse is a conserved scalar.

## Scope & non-goals

- **Purse-scoped only (D34).** The guild **treasury** and **Influence** are separate
  currencies and are *not* journaled here. The same `earn`/`spend` shape can adopt
  them later (the entry already carries a `source`), but each would need its own
  routing pass + invariant.
- **Behaviour-preserving.** The log is purely additive; no gold *value* changed.

## Deferred — the “how should it look” question (open)

The substrate is intentionally **not yet read by any presentation**. Still to decide:

1. **Ledger fold** — rewrite `buildLedger` to fold `purseLog` (a `groupBy(source)`)
   instead of re-deriving categories from node history. The realized categories
   become a projection of the log; Upkeep/Banker stay forward *forecasts*.
2. **Sim balance-report** — a headless dump of the log (per-run, grouped by source,
   with node/night) as a designer-facing balancing instrument.
3. **In-game surfacing** — how much of the per-line detail the ledger screen exposes,
   and behind how much progressive disclosure.

## Open questions

- **`PurseSource` taxonomy isn’t final.** It’s cheap to revise (add/rename a member
  + adjust the emitting site); don’t treat it as locked.
- **Extending to treasury / Influence / RP** — whether the guild-tier and the other
  per-run currencies get the same treatment, or stay bespoke.
- **A combat analog** — whether the same *record-actions-going-forward* idea applies
  to the battle state (it’s a command log + replay, not a cheap scalar fold — a
  separate, harder shape; see the combat-actions discussion).
