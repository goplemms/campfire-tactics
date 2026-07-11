# Node 4 — the L4 fork: plan (DRAFT, post-adversarial)

> **Status: PLAN DRAFT — not approved, no build.** Output of the Node-4 discussion→plan
> step. Supersedes the initial four-mechanic sketch, which an adversarial design pass
> (four independent lenses: teaching, balance, architecture, narrative) found teaches the
> *inverse* of its lesson. Two decisions (▶ D-open-A, D-open-B below) are still open; once
> settled this graduates to staged build PRs + `decisions.md` entries. Numbers here are
> **illustrative tunables**, not "the right" values (that's a playtest pass).

## The node

L4 of the Hollow Mill demo — the game's **first real branching decision**. Teaching beat:
**risk/reward routing.** Topology (from `hollow-mill.ts`):

- `snares` (L3) → **{ `rest4a`, `wagon4b` }**
- **4A `rest4a`** (rest): the safe road — Deep Rest, no Medic → `market`
- **4B `wagon4b`** (combat): the hard road — a slaver escort; frees **Sela the Medic** (first
  healer) → `market`, `den`
- `securedWagon` (L6A): the harder, `medic-freed`-gated catch-up for the Medic

## What the adversarial pass found (the surviving objections)

1. **The fork is a dominated non-choice — structural, not a content gap (concept-threatening).**
   - 4B is the *only* route to **Medic + relic** (`wagon4b→den`); from 4A your single L6 pick is
     Medic (`securedWagon`) **or** relic (`den`), never both — safety permanently taxes a party
     member or a build-defining item.
   - The catch-up **out-pays** the brave road (`securedWagon` 140g vs `wagon4b` 120g) *and* still
     hands the full Medic — the safety net rewards *skipping* the risk.
   - A forecast that **guarantees** "first healer down the right branch" removes the gamble outright.
   - → No number tuning fixes a *dominated* choice. Fix the reward **structure** or the fork stays dead.

2. **Sela-as-captive re-teaches L1 — cut it.** On-board captive rescue is L1's beat (D52); repeating
   it at L4 teaches nothing new, muddies routing, makes 2/3 recruits prisoners (conveyor-belt
   fiction), and forces a grant-flag split that silently couples "captive Medic" to "this node must
   never gain an escort/timer objective" (a landmine for a *Prison Wagon*). **Keep Sela a post-win
   grant** (as shipped).

3. **The Q1/Q4 instincts are right; the deliveries backfire — clean versions exist.**
   - **Q1 (inform the choice):** correct instinct. But a *guaranteed-recruit spoiler* kills the
     gamble AND reads as "you're told a healer is caged here → resting = abandoning her." Not reuse
     either (intel/forecast never disclose grants; the band is gold-only). **Clean version: an
     ambiguous D83 rumor line** — risk and reward at equal weight ("a prisoner, held by an elite
     escort"), pure data, already tier-banded/rendered.
   - **Q4 (4A is too thin):** correct instinct. But **loot on a rest node breaks a load-bearing
     invariant** (`nodeLoot` rest = `{0,0}`; D48 "cost is knowable, income is fogged") and the
     fiction of resting. **Clean version: pay 4A on the recovery axis** (deeper heal / RP bank /
     fatigue+morale swing) — pure `deepRest` data.

4. **Smaller flags.** `hold-wary` was earmarked for **L6A**, and using it at 4B double-teaches L3 —
   leave it for L6A. **4B has zero sim coverage** (`autoTraverse` always takes `rest4a`) — the
   "tense no-healer elite" fight is never bot-tested; close that regardless.

## The reframed concept — "the honest fork"

Node 4's pass is **not "add mechanics"** — it is **"make the fork a genuine, informed, consequential
choice."** The two roads become a real two-axis trade: *full party health, kept whole now (4A)* vs
*a permanent healer won under fire, but battered (4B)*.

## Staged plan (each = its own PR: `tsc` clean · `vitest` green · doc + shots)

1. **Fix the domination (the load-bearing PR).** De-value `securedWagon` below `wagon4b` (a
   consolation, not a premium); decouple the relic axis so 4A isn't uniquely locked out of
   Medic+relic; optionally make a **late-rescued Sela join weaker** (under-levelled) so "Medic now
   vs later" has teeth. Pure data/topology + re-pinned feasibility/sim tests. ▶ **D-open-A** below.
2. **4A pays on the recovery axis.** Tune Deep Rest at `rest4a` into a real draw (heal/RP/fatigue/
   morale) — pure `deepRest` data. Keeps "safe = you recover, risky = loot + Medic" legible.
3. **Inform the fork with a rumor line.** Author an ambiguous `rumors` read on the branch(es) —
   D83 data, no code. ▶ **D-open-B** below (rumor-only vs. also build the D74 route-forecast).
4. **Sim route coverage.** Add a route policy that forces the `wagon4b` branch so the no-healer
   elite fight is actually balance-tested; pin its win-rate for the starting trio.

## Cut from this pass (with reasons)
- **Sela as on-board captive** — re-teaches L1 (finding 2). Keep the post-win grant.
- **`hold-wary` on the 4B captors** — reserved for L6A; double-teaches L3 (finding 4).
- A structured "recruit" chip on the forecast/intel report — redundant with rumors; a real build
  disguised as reuse (finding 3).

## Open decisions (must settle before build)
- ▶ **D-open-A — how to break the domination.** Options: (a) just de-value the catch-up + weaker
  late-Sela (minimal); (b) also decouple the relic axis (add a relic reach to the safe road, or
  gate the relic behind its own sub-fork); (c) accept the asymmetry but make it fully legible.
- ▶ **D-open-B — the informed read.** (a) Rumor line only — small, safe, ships this pass; or
  (b) also take on the parked **D74 route-forecast/Ledger** read (a *recovery-runway* preview at
  the fork) — genuinely new teaching, but a real bounded build (forecast is gold-only today, needs
  new plumbing).

## Guards every PR must keep green
`tsc` · `vitest run` · `npm run build` · e2e · `npm run sim` (digest re-pinned where routing/rewards
move) · `core/` free of Phaser/DOM and `Math.random`.
