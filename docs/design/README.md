# Campfire Tactics — Design Overview

This folder is the **living vision** for the game's systems. It is intentionally
separate from the build plan in [`scratchpad/foundations/`](../../scratchpad/foundations/),
which tracks *milestones and status*; these docs track *what the game is*.

> Architectural calls that back these docs are logged as decisions in
> [`scratchpad/foundations/decisions.md`](../../scratchpad/foundations/decisions.md) —
> **always read to the latest entry** (the log is the running record and keeps growing;
> no fixed range bounds it).

## Identity

An isometric roguelike tactics game in the lineage of *Final Fantasy Tactics* and
*Fire Emblem*, with one deliberate twist: **the parts that matter most happen
around the battle, not just on the grid.** Combat is the genre standard done
well; the game's character is its **logistics** — provisioning, preparation, and
the gambles you take before a single blow is struck. The target player is someone
who enjoys *crunch*: legible systems with deep, interacting decisions.

## Conventions

- **Banding.** Many number systems are expressed as discrete **bands / breakpoints**
  rather than smooth curves (intel tiers, morale tiers, Awareness allowance, …).
  Bands are legible to the player and give us clean, isolated knobs to tune balance.
- **Wide logistics, micro at the unit.** Resource/logistics decisions live at the
  **party/macro** level (shared pools, provisioning); the turn-to-turn
  micro-management lives at **unit control** (positioning, action economy, placement,
  triage). Pre-answers many "shared vs. per-unit" forks.
- **Gold is the solvent for chores; bespoke systems for choices.** A mechanic that's
  an interesting in-the-moment *choice* gets its own system; a necessary *chore*
  collapses into a gold cost (the one **Upkeep** figure). Keeps the meter count low —
  a handful of tactical systems + one gold dial (decision D15).
- **Cooldowns over hoardable pools; shallow asymmetric floors.** Prefer **cooldowns**
  (use-it-or-waste-it → the decision is *timing*, and they *encourage* engagement) to
  tight hoardable resources (which punish use and breed agonized hoarding). When a
  depleting meter *is* wanted, give it a **shallow asymmetric floor** — a generous
  allowance that bites only on greed, never kicking a player when they're down. Applied
  to deployment overdraw (D7/D11), morale (D8), and overworld fatigue (D35).
- **One word per concept, two layers of voice.** Player-facing text follows the
  [**glossary**](glossary.md): **canonical keywords** for anything clickable or numbered
  (buttons, HUD, tiers, tooltips), **flavor** reserved for read-only prose (teasers,
  outcome lines, terminals). One keyword = one mechanic; the glossary is the source of
  truth for the words and their banned synonyms.

## The loop

The game is modeled as an ordered **phase pipeline** (decision D3) that runs
*inside* each combat mission. Each phase is where a different part of the fantasy
lives, and most of the signature jobs act in a *different* phase:

```
  ┌─────────────────────────────────────────────────────────────┐
  │                                                               │
  ▼                                                               │
1. PRE-DEPLOYMENT (Meta / world menu)   off-map resource logistics │
        │   provision: buy gear, load ammo & materials, cook       │
        ▼                                                          │
2. DEPLOYMENT ("earlier that day", on-map)  spatial setup gamble   │
        │   place traps / nests / runes; push your luck            │
        ▼                                                          │
3. COMBAT (the iso grid)   FFT-style CT clock + charged abilities  │
        │   prep pays off; field entities trigger                  │
        ▼                                                          │
4. RESOLUTION   recover materials, tally losses, rewards ──────────┘
```

That mission loop is itself wrapped in **the overworld** (decision D22): a seeded,
branching **run map** the player navigates between missions. You start a run, see
the map, pick a reachable **node** (combat or rest), play it through the loop
above, return to the map, and advance along a chosen path until you clear the
final mission (run complete) or wipe (run over) — all deterministic from the run
seed.

```
  OVERWORLD (seeded layered DAG) ── choose a reachable node ──┐
        ▲                                                     │
        │  return between nodes                               ▼
        │                                   ┌─ combat node ─→ the phase loop above
        └───────────────────────────────────┤
                                            └─ rest node ───→ recover (no battle)
```

## Phase docs

Each phase is described in its own doc, structured as **description → worked
pseudo-example**:

1. **[Pre-deployment (Meta / world menu)](01-pre-deployment.md)** — off-map
   provisioning. Buy/sell equipment, load ammo & materials within storage limits,
   cook for morale/healing, assign jobs. The constraint layer that gates the map.
2. **[Deployment](02-deployment.md)** — the on-map "earlier that day" setup. A
   turn-based **push-your-luck** placement of traps, nests, and runes against a
   **closing enemy net** (D63), on the same CT clock as Combat. Overreach and your
   unit gets captured.
3. **[Combat](03-combat.md)** — the isometric battle on an FFT-style continuous
   **Charge-Time (CT) clock**, where prepared field entities trigger.
4. **[Resolution](04-resolution.md)** — recover unsprung materials, resolve
   captures (rescued vs. lost), tally rewards, feed the next Meta phase.

## Cross-cutting subsystems

These span multiple phases and are documented independently so each phase can
reference them rather than re-explain:

- **[The guild & caravans](systems/guild.md)** — the persistent **home** tier above
  the overworld: one shared guild fed by a campaign + endless quest board, caravans as
  upgradeable vessels with uniform slots, stakes via permanent loss + Fire-Emblem
  lords, a three-tier recruitment roster, the treasury-vs-purse split, and
  class/secondary-job leveling (decisions D25–D27, D32–D34).
- **[The overworld](systems/overworld.md)** — the seeded, branching run **map**
  that wraps the mission loop; layered node DAG, combat/rest nodes, the banded intel
  preview that informs each branch, and (as a second hook surface) the gold routing
  economy + the overworld action economy (camp at every node, cooldown spine, loose
  fatigue) (decisions D22–D24, D28–D30, D34–D35).
- **[Action economy](systems/action-economy.md)** — the CT clock and charged
  abilities (combat).
- **[Action catalogue](systems/actions.md)** — a snapshot glossary of **every player
  verb and who owns it** (class / capability / stat / access / universal) — the audit
  view for design.
- **[Magic](systems/magic.md)** — Vancian spells (scribed castings, scrolls, runes, a
  default spell); magic as a logistics axis (decision D17).
- **[Field entities & the trigger bus](systems/field-entities.md)** — the single
  abstraction behind traps, nests, and runes; placed in Deployment, fired in
  Combat (decision D4).
- **[Logistics & inventory](systems/logistics.md)** — ammo, materials, rations,
  and storage; the game's headline pillar (decision D6).
- **[Intel](systems/intel.md)** — banded pre-battle knowledge via three lanes
  (Intelligence stat / scouting / the Seer's divination) (decision D10).
- **[Vision & fog of war](systems/vision.md)** — symmetric in-battle fog on a
  Hidden→Pinged→Seen ladder; the in-battle twin of Intel (decision D18). *Designed, not
  built — only a sight-radius seam ships today (see vision.md); the ladder is deferred (#148).*
- **[Telegraph & action forecast](systems/telegraph.md)** — preview-before-commit:
  an armed ability's footprint (arc/push/aura) + its forecasted outcome, via a
  forecast registry that mirrors the resolver (decision D64).
- **[Morale](systems/morale.md)** — a passive, tiered bundle of minor modifiers
  the Cook feeds (decision D8).
- **[Mortality, recovery & difficulty](systems/mortality-recovery.md)** — how units
  leave the run, between-night Rest-Point healing, and the per-difficulty
  consequence policy (decision D9).
- **[Stats](systems/stats.md)** — the stats committed so far (Speed, Awareness)
  and what each governs.
- **[Influence](systems/influence.md)** — the Noble's per-expedition *standing*
  currency: presence → opportunity (passive accrual + Patronize), spent on bribes and
  gating event quality (decision D62).
- **[Jobs, growth & prestige](systems/jobs.md)** — the character build axis: two growth axes
  (**breadth** = hold & mix more jobs · **depth** = prestige a job into a successor), one
  diegetic **grant seam** for acquiring jobs and triggering prestige, a symmetric tree (power
  attaches to *story*, not tier), and **emergent** combat/non-combat (decision D65).

## The demo expedition

- **[The Hollow Mill](expedition-hollow-mill.md)** — the framework's first authored
  expedition, redesigned as a **mechanics-teaching vertical slice** (D44/D52). Codifies
  the locked topology, each node's **teaching goal**, the recruit economy
  (Cook/Medic/Merchant), and a running **route-change / feel-pass log**. The data lives
  in [`src/core/hollow-mill.ts`](../../src/core/hollow-mill.ts); this doc is the intent.

## One run, end to end (pseudo-example)

> A full, beat-by-beat annotated playthrough lives in
> [`example-session.md`](example-session.md) — a living reference for sanity-checking
> changes against. The sketch below is the short version.

> **Meta.** The party loads its caravan storage: some arrows and two trap kits,
> then has the Cook provision a hearty stew (banks Rest Points **and** covers the
> night's Food upkeep). Loadout locked.
>
> **Deployment.** On the map — "earlier that day" — the Scout plants both trap kits
> across the chokepoint. A **closing enemy net** advances turn by turn on the same CT
> clock (D63); the player pushes one scout deep to pre-set a trap, but she lingers a
> beat too long and the net closes: she is **captured**, left **bound on the map where
> she stands**, and the side fields **−1** into the battle.
>
> **Combat.** On the CT clock, the enemy's early tempo is punished when their
> vanguard walks the chokepoint — both trap kits fire. A soldier cuts to the
> captor and **frees the bound scout** (−1 becomes +1), who rejoins the CT order.
>
> **Resolution.** The party holds the ground, so one **unsprung** trap kit is
> **recovered** to storage, captured allies come home, loot and gold roll in, and
> the run advances to the next node.

## Status

These docs describe the intended design; they will evolve. A **playable vertical
slice** now ships — *The Hollow Mill* demo runs end to end (overworld → deployment →
battle → resolution), with the guild/caravan tier, the overworld action economy, the
class slice, intel, and the economy all built. Some systems here remain **designed but
not yet built** (the D18 vision ladder, Vancian magic, nests/runes, the consumables
family, outcome-driven morale, desertion, upkeep grace nights); those carry a
"designed, not built" marker in their own docs (adjudicated in #148). For what is
actually implemented, read the decision log
[`scratchpad/foundations/decisions.md`](../../scratchpad/foundations/decisions.md) (to
the latest entry) and [`scratchpad/foundations/PROGRESS.md`](../../scratchpad/foundations/PROGRESS.md).
