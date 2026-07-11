# Hollow Mill — the back-half arc: campaign plan (DRAFT)

> **Status: DESIGN DRAFT — not approved, no build.** The north-star for redesigning the
> Hollow Mill's back half (L4 → finale) into a **prison-assault arc** with a **richer
> deployment phase**. Output of the Node-4 discussion, which escalated (correctly) from
> "fix one fork" to "redesign the layer." Shaped by **two adversarial passes** (recorded
> below). Supersedes [`node-4-fork-plan.md`](node-4-fork-plan.md). Once the open questions
> (§Open design questions) close, the settled calls graduate to a **`decisions.md` entry
> (next id: D90)** + updates to [`expedition-hollow-mill.md`](../../docs/design/expedition-hollow-mill.md),
> and the waves (§Waves) become the umbrella issue + child issues. Numbers are
> **illustrative tunables**, not final.
>
> **Review cadence (working rule).** No decision is finalized until it clears an **adversarial
> red-team pass**. The flow: *settle a decision (or a batch) → red-team it → finalize into the
> doc (or revise)*. Decisions are batched before a pass for efficiency. A question marked
> **PROVISIONAL** is tentatively settled but has **not** yet cleared the red-team; only a
> **CLEARED** question is safe to graduate.

## North star

The Hollow Mill's back half becomes one coherent **prison-assault arc**: the wagons on the
road lead to a **prison facility the party assaults at the finale** (today an undesigned
stub). The arc is a **vertical slice that represents the whole game** — fun, interesting,
and honest about what the game is — **not a tutorial**. It leans into two things the game
wants to be known for:

1. **Meaningful, replayable routing** — routes diverge on **breadth vs depth** and **frontal
   vs infiltration**, are **co-viable** (no dominant line), and are **worth re-running** to
   see the other path. Missable content is a *feature* (the replay engine), not a trap.
2. **A deeper deployment phase** — deployment becomes more than "place two units / reveal
   fog." An eligible party can **infiltrate the structure early** (deploy *inside*); a party
   without the tools runs a **frontal assault** (the honest default). This is the slice
   showcasing a **pillar the game is actively deepening**, not a bespoke detour.

## Why (the two adversarial passes)

- **Pass 1 (the L4 fork).** Found the shipped fork is a **dominated non-choice** (forecasted
  first-healer + winnable-raw fight + a richer catch-up ⇒ the "risky" road is never taken;
  teaches the *inverse* of risk/reward). → we escalated to a layer redesign.
- **Pass 2 (this arc).** Found the first arc sketch **misrepresented the game** (over-indexed
  on the Scout prestige fork + stealth), **buried feels-bad** (unvaluable exclusivity, a
  Medic-deletion death-spiral, AI-ally agency theft, a genre-switch finale), was **dominated
  four ways**, and was **~8 systems in a "node-4" costume**. The reorientation below keeps the
  fun/representative *spirit* while resolving those — chiefly: **structures-with-sections +
  involved deployment ARE the game** (so the facility is representative), and the demo is
  **built to be replayed** (so exclusivity drives replay). The surviving hard constraint is
  **co-viability** (see the design rules) — replay only pays off if no route dominates.

## Design rules (non-negotiable — these make replay work)

1. **No dead routes + real choices (balance relaxed for the demo — owner ruling 2026-07-11).**
   Routes need **not** be evenly balanced: the slice is *replay-oriented* (players sampling the
   game's feel), so players "optimizing out" a choice is **not** a concern here. The only bar:
   **no route may feel not-worth-taking**, and the fork must stay a **genuine either/or**
   (mutually exclusive rewards) or it isn't a choice at all. The former "decoupling" rules are
   now **levers, not hard parity** — attach/move the finale-weakening consequence and place the
   prestige arms to keep every route *appealing* and the choice *real*, not to force symmetry.
   The **finale's two win-conditions** (frontal vs infiltration) stay, because *distinct
   fantasies* are what make each route worth replaying.
2. **Consequences must be *felt*, not scouted.** A route's downstream payoff (e.g. "the wagon
   fell, the garrison is thin") is **shown at the moment of payoff** (empty posts, freed
   prisoners at the gate, a rumor line) — never delivered only through a tier-3 intel read the
   player may never buy.
3. **Stay in the tactical idiom.** The finale — frontal *or* infiltration — is played in the
   game's CT-clock tactics, not a bespoke stealth minigame. Infiltration changes the *board
   state you deploy into*, not the verb set.
4. **Reuse before invent.** Freed prisoners are **player-controlled captives** (`captives`
   seam, the L1 Pip shape) — **not** an AI-ally control mode (cut: redundant + a tuning sink).
   Cross-node consequence is a **flag-keyed rumor**, not a new intel-disclosure category.
5. **Represent honestly.** The slice must not *lie about the game* — especially progression
   pacing (see the prestige-floor question) and the game's shape (procedural, guild-framed,
   broad-roster). Open question: how much guild/economy to bookend so the outer scales show.

## The arc, node by node (proposed)

- **L4 — the fork (breadth vs depth).**
  - **4B "The Prison Wagon" (hard combat):** rescue **Sela the Medic** on the board (BREADTH —
    a new party member; the captive set-piece is welcome). Tense, winnable raw.
  - **4A "the training clearing" (rest + a D80 arrival event) — the DEPTH road (Q1 = B):** a
    **mentor** runs a **dual-purpose training event** that (1) **telegraphs prestige** — tells
    the player *something big is coming* and **surfaces the Assassin path + its level-5 gate**
    (the requirement is made visible, not hidden); (2) **arms** the prestige (`assassin-mentor`);
    and (3) grants Vale a **level bump toward L5**, so the transformation lands **within the
    run** when she earns the rest through combat — fired via **D69's appear-when-eligible**
    offer. "Both event and clearing": you **recover** *and* set your scout on the Assassin arc.
    Honest about pacing (floor stays 5; she still earns it), and a distinct replay fantasy.
  - The **Medic catch-up (`securedWagon`) is deleted** — skipping the Medic is a real,
    run-shaping consequence (lean on Cook + consumables). *(Revisit under design-rule 5: does
    deleting the healer under-represent the combat pillar? — open question.)*
- **The prestige arms (route identity — the fork must stay a real either/or).** The **Assassin**
  arc is *armed* at 4A (above); the **Thief** (infiltration/lockpick) is offered on a
  **different, non-reconverging arm** — a Scout prestiges **once**, so a route must not be able
  to grab *both* prestiges (nor a prestige *and* everything else for free — the choice has to
  cost something, or it isn't a choice).
- **The finale — assault the prison facility** (retires the stub). **Objective: liberate the
  prison.** Ends on a **dual OR-victory** (the multi-objective showcase, Q3 — PROVISIONAL,
  pending adversarial):
  - **`eliminate-all`** (the usual condition — defeat / drive off the garrison), **OR**
  - **`free-captives`** (all held prisoners freed) — a **new objective kind** that reuses the
    `captives`/`freeCaptive` freed-state; meeting *either* ends the node as a win.
  - The two routes fall out of this naturally, **not route-locked** (either party can trip
    either condition; freed prisoners are **player-controlled** captives, the L1 Pip shape):
    - **Frontal assault (default / any party):** deploy at the gate against a **fortified**
      garrison (reuse the `fortified` type); fight through — typically wins by `eliminate-all`.
      The honest, representative-of-core-combat climax.
    - **Infiltration (thief/lockpick party):** during **deployment**, breach a section and
      **deploy *inside*** past the gate, garrison unalerted (reuse concealment + the deploy
      danger gradient); reach the cells and free the captives under an **alarm/detection
      clock** — typically wins by `free-captives`. Botched (detected) → converts to a fight,
      now inside and outnumbered (so *harder* than frontal, not easier). **Stays in the
      tactical idiom** (rule 3) — the alarm is a status/meter, not a new verb set.
  - **Co-viability (rule 1):** frontal = reliable/brute, guaranteed-available, benefits from
    the garrison-weakening consequence; infiltration = high-skill/high-variance, demands the
    thief investment paid upstream, punished by detection. Neither dominates. **Tuning note
    (for the balance pass):** `free-captives` must not be a trivial instant-win — detection
    pressure + cell placement/escort are the knobs that keep infiltration skillful.
  - **Consequence seam:** crushing the Prison Wagon thins the garrison — surfaced **visibly**
    (empty posts / a rumor), per rule 2. Placement is now a **lever** (rule 1 relaxed): the
    Medic is anchored at **4B**, so where the consequence sits is tuned to keep **4A worth
    taking** (hinges on Q1 — the prestige payoff).

## Waves (the campaign → the future umbrella issue + children)

Each wave ships independently; the arc **degrades gracefully** if a later piece slips.
Tags: **reuse** · **net-new** · **D69** (queued-roadmap) · **design/test**.

| # | Work item | Wave | Tag |
|---|---|---|---|
| 0 | **Arc design doc** — this doc, closed out: node map, co-viability proof, the finale's two win-conditions | 0 | design |
| 1a | **Objectives: alternate/OR-victory + `free-captives` kind** — generalizes the D50 model; reusable substrate (feeds the finale) | 1 | net-new |
| 1 | Author the **L7 prison-facility finale** (retire the stub) — dual OR-victory, fortified garrison, prisoners as captives | 1 | net-new (needs 1a) |
| 2 | Freed prisoners as **player-controlled captives** on the finale board | 1 | reuse |
| 3 | **Consequence made visible** — the thinned garrison shows + a flag-keyed rumor line | 1 | reuse |
| 4 | **Deployment infiltration** — structure sections + deploy-*inside* for eligible parties; frontal default | 2 | net-new |
| 5 | **Lockpick / door field-entity** — the Thief's `lockpick` opens the breach | 2 | D69 |
| 6 | **Prestige route-seeding** — the 4A mentor training-event (arm + level-bump + surface the L5 gate) + the Thief teacher; prestige fires via D69 appear-when-eligible once the level is earned | 3 | D69 |
| 7 | **Co-viability balance pass** — the three decouplings + topology rework (`securedWagon`, relic placement) | 3 | balance |
| 8 | **Sim route coverage** — force the hard arm + each finale win-condition; pin win-rates | 4 | test |
| 9 | *(optional)* **Guild / economy bookend** — dispatch/return + one economy decision, so the meta scales show | 4 | representativeness |

## Cut / deferred (with reasons)
- **AI-controlled ally prisoners** — cut. Redundant with the player-controlled `captives`
  seam, and a research-grade tuning sink (rule 4).
- **Cross-node "consequence-as-intel" as a new disclosure category** — cut. A flag-keyed
  rumor delivers the feel for near-zero machinery (rule 2/4).
- **Flag-*scaling* the finale** — deferred until the finale exists and is proven fun (build
  it once, first).
- **Full D69 job-capability card surfacing** — orthogonal; its own effort.

## Open design questions (must close before the waves are issued)
- **Q3 — the finale's win-conditions — PROVISIONAL (2026-07-11), pending adversarial.**
  Objective = *liberate the prison*; dual **OR-victory** (`eliminate-all` OR a new
  `free-captives` kind); frontal vs infiltration fall out of it, not route-locked. Adds work
  item **1a** (the objectives-model extension). See §The arc. *Batched into the next red-team
  with Q2.*
- **Q1 — prestige timing — PROVISIONAL (2026-07-11), pending adversarial (= Option B, refined).**
  The 4A mentor **arms** the Assassin prestige, **bumps Vale toward L5**, and **telegraphs the
  path + its L5 gate**; the prestige **fires later in the run** when she earns L5 (D69
  appear-when-eligible). Honest pacing, in-run payoff, distinct fantasy. **Risk to stress:** does
  she actually reach L5 by ~the finale on the 4A route's available fights (XP tuning)? — else the
  payoff never lands and 4A is a **dead route**. Batched with Q2/Q3.
- **Q2 — the reward map — PROVISIONAL (2026-07-11), pending adversarial.** The **Medic stays
  recruitable at 4B (Prison Wagon)** — a usable, impactful mid-expedition recruit (owner
  ruling). Balance relaxed (rule 1): 4B may be the *richer* route so long as **4A (the prestige
  road) still feels worth taking**. Two sub-parts, both **tied to Q1**: (2a) consequence
  placement (keep on the wagon for the narrative, or move onto 4A's road to bolster it); (2b)
  whether 4A's prestige delivers enough to be worth taking. *4A viability is the thing to
  protect.* Batched into the next red-team **with Q1 and Q3**.
- **Q3 — the two finale win-conditions**, concretely: what makes frontal and infiltration
  *different puzzles*, each with a distinct victory check (rule 1/3).
- **Q4 — how much guild/economy to bookend** so the slice doesn't hide the outer scales
  (rule 5) — vs. keeping scope tight.
- **Q5 — the Medic-deletion representativeness check** — does removing the healer on one arm
  under-show the combat pillar? Is there a non-healer sustain read that keeps it honest?

## Guards every PR must keep green
`tsc` · `vitest run` · `npm run build` · e2e · `npm run sim` (digest re-pinned where routing /
rewards / the forced-route policy move) · `core/` free of Phaser/DOM and `Math.random`.
