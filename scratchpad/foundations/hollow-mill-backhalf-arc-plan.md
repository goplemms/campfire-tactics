# Hollow Mill — the back-half arc: campaign plan (DRAFT)

> **Status: DESIGN DRAFT — not approved, no build.** The north-star for redesigning the
> Hollow Mill's back half into a **prison-assault arc** whose signature payoff is a **deeper
> deployment phase** (infiltration via the **Thief**). Supersedes
> [`node-4-fork-plan.md`](node-4-fork-plan.md). Settled calls graduate to a
> **`decisions.md` entry (next id: D90)** + updates to
> [`expedition-hollow-mill.md`](../../docs/design/expedition-hollow-mill.md); the waves become
> the umbrella issue + child issues. Numbers are **illustrative tunables**, not final.
>
> **Scope reset (owner ruling 2026-07-11).** Everything **past node 3 is open design** — the
> shipped `node 4+` topology/content (`rest4a`, `wagon4b`, `market`, `securedWagon`, `den`,
> `finale`) is **obsolete**: we may keep pieces, but we may just as easily replace it wholesale.
> The demo is also expected to be **longer** than today's 7-node slice, which gives room for
> natural leveling. So this plan designs a **fresh back-half topology**, not a patch.
>
> **Review cadence (working rule).** No decision is finalized until it clears an **adversarial
> red-team pass**: *settle (or batch) → red-team → finalize/revise*. **PROVISIONAL** = tentatively
> settled, not yet red-teamed; **CLEARED** = survived the red-team (with any constraints folded
> in) and safe to graduate.

## North star

The back half becomes one coherent **prison-assault arc**: the road leads to a **prison
facility the party assaults at the finale** (today an undesigned stub). It's a **vertical slice
that represents the whole game** — fun, interesting, honest — **not a tutorial**. Two headline
pillars:

1. **Meaningful, replayable routing.** Routes diverge (**sustain vs. infiltration**); missable
   content is the *replay engine*, not a trap. Routes need not be balanced — only *worth taking*.
2. **A deeper deployment phase — the game's signature mechanic.** The **Thief** prestige unlocks
   **infiltration** (lockpick a structure, act before the fight). The demo exists to *headline
   this*. A party without it runs the honest **frontal assault**. Deploying the Thief spotlight
   is deliberate — depth-via-one-class here is a **feature** (showcase the unique system), not the
   accidental narrowing Pass 2 warned about.

## Adversarial history (three passes)

- **Pass 1 (the L4 fork).** The shipped fork is a **dominated non-choice** → escalate to a layer redesign.
- **Pass 2 (the arc).** The first sketch **misrepresented the game**, buried feels-bad, was over-scoped
  → reoriented around replay + the deployment pillar + reuse.
- **Pass 3 (the Q1/Q2/Q3 batch) + re-review.** Found real, code-grounded holes; the **scope-reset +
  longer-demo** context above **dissolved the topology/length-dependent ones** (fake-fork via
  reconvergence, 4A combat-starvation), leaving a short list of **durable constraints** (below) that
  now act as design guardrails.

## Design rules

1. **No dead routes + real choices (balance relaxed).** Routes need **not** be evenly balanced;
   the only bar is **no route feels not-worth-taking**, and the fork stays a **genuine either/or**.
   Levers (consequence placement, where prestige sits) keep routes *appealing* and the choice
   *real*, not symmetric.
2. **Consequences must be *felt*, not scouted** — shown at the payoff (empty posts, a rumor line),
   never only behind a tier-3 intel read.
3. **Stay in the tactical idiom.** The finale is CT-clock tactics, not a bespoke stealth minigame.
4. **Reuse before invent.** Freed prisoners are **player-controlled captives** (the L1 Pip seam),
   not an AI-ally mode. Cross-node consequence is a **flag-keyed rumor**, not new intel plumbing.
5. **Represent honestly.** Don't lie about progression pacing or the game's shape. (The Thief
   spotlight is an *honest* headline of the signature mechanic — see north-star 2.)

## Durable constraints (Pass-3 keepers — guardrails for the new topology)

- **C1 — `free-captives` must be an *extraction* objective**, not a cell-open flag-flip (freeing is a
  one-tile flag flip today → a trivial garrison-skip). Escort freed prisoners to an exit under
  pressure. *(The mechanics live in the parked deployment deep-dive — see below.)*
- **C2 — OR-victory needs an "any-of" objective group + a `withDefaultGoal` fix.** `encounterOutcome`
  is AND-only and auto-injects a *required* `eliminate-all`; a free-captives finale would otherwise
  be forced to also clear the garrison. Bounded, reusable substrate.
- **C3 — Training grants scout *job-XP*** (dedicated drilling → proficiency), **not a conjured
  "level."** Needs a small `StoryOutcomeSpec` XP field; keeps the "you level by fighting/training"
  model honest. The **longer demo** must place enough combat that the Thief prestige fires **in a
  playable fight**, not at post-finale resolution.
- **C4 — Infiltration is gated on the Thief (deliberate).** The Thief prestige *is* the key to the
  deployment-phase depth; a non-Thief party runs the frontal finale (rule 1 — a fine, worth-taking
  default). "Not route-locked" is **dropped** as a goal — the split is the point.
- **C5 — "Deploy-inside" is a net-new sub-mode**, not concealment reuse (the deploy danger model runs
  home-edge-outward). Whether infiltration is true interior-deploy or a cheaper **pre-breached board
  reusing the existing net-as-alarm** is decided in the parked deep-dive.

## The arc, node by node (proposed — topology to be designed)

- **The fork — sustain vs. infiltration (a real either/or).**
  - **The Prison Wagon (combat):** rescue **Sela the Medic** on the board (**breadth / sustain** —
    a usable mid-expedition recruit; the captive set-piece is welcome). No Medic catch-up downstream —
    skipping her is a real, run-shaping consequence.
  - **The training road (combat/clearing):** a **mentor** runs a **dual-purpose training event** that
    (1) **telegraphs** the Thief prestige and **surfaces its L5 gate** (visible, not hidden), (2)
    **arms** it, and (3) grants scout **job-XP** toward L5 (C3). Vale reaches L5 through the back
    half's fights and **becomes a Thief** → **Expert Lockpick** → the **infiltration** approach to the
    finale. The distinct fantasy: *build toward the signature deployment mechanic.*
  - **Either/or:** the healer (frontal-finale sustain) **vs.** the Thief (the infiltration finale).
    Mutually exclusive, both worth taking, different fantasies. The **garrison-weakening consequence**
    (crush the Wagon → thinner finale) stays causally on the **Wagon road** (rule 2); the training
    road stands on its own Thief payoff (it does **not** get the wagon consequence teleported onto it).
- **The finale — assault the prison facility** (retires the stub). **Objective: liberate the
  prison**, ending on a **dual OR-victory**: `eliminate-all` **OR** a new `free-captives` kind (C2).
  - **Frontal (any party):** deploy at the gate vs. a **fortified** garrison; win by `eliminate-all`.
    The representative-of-core-combat climax. **Buildable now.**
  - **Infiltration (Thief party):** the Thief's lockpick opens the assault to a deployment-phase
    approach; win by **extracting** the captives (C1). **Mechanics parked** (see deep-dive).
  - **Prestige = Thief only.** Assassin is **dropped** from the demo (it doesn't serve the
    deployment-phase headline).

## Parked deep-dives (own discussions, not now — owner ruling 2026-07-11)

- **The deployment-phase expansion.** Extraction (C1), deploy-inside vs. pre-breached board (C5), and
  the alarm/detection model together imply a **larger rework of the deployment phase**. That's the
  game's signature system and deserves its **own in-depth discussion** — deferred (not on the critical
  path for a while). Until then, the infiltration finale's *mechanics* are undesigned; the **frontal
  finale is the buildable spine**.
- **Guild / economy bookend** (old Q4) — how much of the outer scales to show; scope vs. representativeness.
- **Medic-deletion representativeness** (old Q5) — the demo's in-run sustain read (Pip the Cook covers between-battle healing).

## Decision status

- **Q1 — the depth road → Thief prestige — CLEARED-with-constraints (2026-07-11).** Training arms the
  **Thief** (not Assassin) + grants job-XP (C3); fires in-run in the longer demo. Was the combat-starvation
  fail; resolved by the scope-reset (fresh topology) + longer demo + job-XP framing.
- **Q2 — the reward map — CLEARED (2026-07-11).** Medic recruitable on the Wagon road; balance relaxed
  (rule 1); the fork is sustain-vs-infiltration, a real either/or by construction (one prestige, exclusive).
- **Q3 — the finale — CLEARED-in-principle (2026-07-11).** Dual OR-victory; frontal (buildable) + infiltration
  (Thief-gated) approaches. The **infiltration/extraction mechanics are parked** to the deployment deep-dive;
  the frontal finale + the any-of objectives substrate (C2) are the buildable core.

## Waves (buildable-now core vs. parked)

| # | Work item | Wave | Tag |
|---|---|---|---|
| 0 | **Node 4+ topology design** — the fresh longer-demo map: node placements, the fork, fights that feed Vale to L5, where the finale sits | 0 | design (next) |
| 1a | **Objectives: any-of victory group + `free-captives` kind + `withDefaultGoal` fix** (C2) — reusable substrate | 1 | net-new |
| 1 | Author the **prison-facility finale — frontal spine** (retire the stub): fortified garrison, `eliminate-all`, captives on the board | 1 | net-new (needs 1a) |
| 2 | Freed prisoners as **player-controlled captives** (the L1 seam) | 1 | reuse |
| 3 | **Consequence made visible** — thinned garrison + a flag-keyed rumor (the Wagon-crush payoff) | 1 | reuse |
| 4 | **Thief route-seeding** — the training-event mentor (arm + job-XP + surface the L5 gate); the Thief prestige fires via D69 appear-when-eligible | 2 | D69 |
| 5 | **Sim route coverage** — force each route + finale win-condition; pin win-rates + the L5-in-run timing | 2 | test |
| — | **Infiltration finale + lockpick door + extraction (C1/C5)** | *parked* | awaits the **deployment-phase deep-dive** |
| — | **Guild/economy bookend** | *parked* | own discussion |

## Cut (with reasons)
- **Assassin prestige** — dropped; doesn't serve the deployment-phase headline (Thief does).
- **AI-controlled ally prisoners** — reuse the player-controlled `captives` seam (rule 4).
- **Cross-node "consequence-as-intel" category** — a flag-keyed rumor delivers it (rule 2/4).

## Guards every PR must keep green
`tsc` · `vitest run` · `npm run build` · e2e · `npm run sim` (digest re-pinned where routing/rewards
move) · `core/` free of Phaser/DOM and `Math.random`.
