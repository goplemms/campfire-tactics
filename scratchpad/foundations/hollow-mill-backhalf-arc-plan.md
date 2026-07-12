# Hollow Mill — the back-half arc: campaign plan (LOCKED CHECKPOINT 2026-07-11)

> **Status: DESIGN DRAFT — locked checkpoint, no build.** North-star for redesigning the
> Hollow Mill's back half into a **prison-assault arc** whose signature payoff is a **deeper
> deployment phase** (infiltration via the **Thief**). Supersedes
> [`node-4-fork-plan.md`](node-4-fork-plan.md). This is a **clean stopping point** after three
> adversarial passes; the next work is design discussions (§Next), not build.
>
> **Working philosophy — just-in-time design (owner ruling 2026-07-11).** A lot of this will be
> **built out as we go**, when we find the concrete use-case a piece slots into. **Yet-undefined
> parts are fine** — they're discussed *closer to the use site*, not forced up front. So
> "undesigned" is a normal state here, not a blocker; this plan fixes the *major beats* and lets
> detail land at implementation.
>
> **Scope reset.** Everything past node 3 is **open design** — the shipped `node 4+` content is
> obsolete (keep or replace freely). The demo is expected to be **longer**, giving room for
> natural leveling.
>
> **Review cadence.** No decision graduates until it clears an **adversarial red-team pass**.
> **PROVISIONAL** = tentatively settled, not red-teamed; **CLEARED (pending X)** = survived the
> red-team, still depends on X being designed at its use site.

## North star

The back half becomes one coherent **prison-assault arc** ending in a **prison facility the
party assaults**. A **vertical slice that represents the whole game** — fun, honest — **not a
tutorial**. Two pillars:

1. **Meaningful, replayable routing** — routes diverge (**sustain vs. infiltration**); missable
   content is the *replay engine*. Routes need not be balanced, only *worth taking*.
2. **A deeper deployment phase — the game's signature mechanic** — the **Thief** unlocks
   **infiltration** (act on the structure before the fight). The demo exists to *headline this*.

## The reframe that survived Pass 3 (the critical-path correction)

Pass 3 found the earlier plan **parked the headline**: it made the *frontal* finale the
"buildable spine" and deferred all infiltration — leaving a shippable slice that is a generic
fortified fight **plus an inert (indeed downgrading) Thief prestige**. Correction:

> **Build the differentiator first. Bring a *lean infiltration taste* forward as the critical
> path** — one **lockpick-in-deployment act with a visible carried-in consequence** (open a door
> → the existing `captives` seam as a mini-extraction, or shift deploy edges / pre-reveal a
> garrison slice), on **already-shipped deploy substrate** — *without* the full extraction /
> interior-deploy / alarm rework (which stays a parked deep-dive). The frontal finale is **not**
> the thing to build first.

## Design rules

1. **No dead routes + real choices (balance relaxed).** Only bar: **no route feels
   not-worth-taking**; the fork stays a **genuine either/or**. Not parity.
2. **Consequences felt, not scouted** — shown at the payoff, never only behind an intel read.
3. **Stay in the tactical idiom** — CT-clock tactics, not a bespoke stealth minigame.
4. **Reuse before invent** — player-controlled captives (the L1 seam), not AI allies.
5. **Represent honestly** — don't lie about progression pacing or the game's shape. (The Thief
   spotlight is an *honest* headline of the signature mechanic.)

## Constraints & findings (from three passes — guardrails, resolved at the use site)

- **C1 — `free-captives` must be *extraction*** (escort to an exit), not a cell-open flag-flip.
  *(Full mechanics = the parked deployment deep-dive; the lean taste can use a minimal version.)*
- **C2 — OR-victory needs an "any-of" objective group + a `withDefaultGoal` fix.** `encounterOutcome`
  is AND-only today. Build it **with the consumer that needs it**, not before.
- **C3 — Training grants scout *job-XP*** (not a conjured level; needs a `StoryOutcomeSpec` XP
  field). Pacing is **feasible** — L2→L5 = 300 job-XP, ~75 uncontested per fight to every
  survivor's primary job, so ~2–3 post-fork fights + the grant clears it — **but the fights must
  sit on the infiltration arm** (the road/rest trickle is *character*-XP, not the job-XP the gate
  reads). "Longer demo → natural leveling" only helps if the map places those combats.
- **C4 — Infiltration is gated on the Thief (deliberate).** A non-Thief party runs the frontal
  finale (a fine default). "Not route-locked" is *not* a goal.
- **C5 — "Deploy-inside" is a net-new sub-mode** (deploy danger runs home-edge-outward). The lean
  taste should reuse the **existing net-as-alarm on a pre-breached board**, not build interior deploy.
- **C6 — The Thief is a deploy *downgrade* without a payoff.** `THIEF_JOB` clears the Scout's
  **Quiet Footsteps** (the deploy-phase net-evasion) — so seeding the Thief road **requires** the
  lean infiltration payoff to exist, or the prestige is worse-than-nothing. **This is why the
  taste is the critical path**, not a nicety.
- **C7 — The training event is a genuine two-beat.** The shipped `thieves-guild` story couples
  arm+prestige+L5-gate into one beat offered *only at* L5. "Arm early, fire later" therefore needs
  (a) an early low-gate beat that writes the invite + grants job-XP, and (b) a later transition when
  jobLevel≥5 via **D69 appear-when-eligible** (currently unbuilt). Split them; build (b) at its use site.
- **C8 — Fork exclusivity must be *enforced by topology*, not asserted.** Nothing mechanically
  stops a route visiting both the Wagon (Medic) and the training node (Thief); only the Wave-0 map
  can forbid it (no reconvergence that reaches the training node after the Wagon; no Medic catch-up).
- **C9 — The cross-node consequence must be an *always-shown* line**, not the tier-gated `rumors[]`
  intel lane (that would be *scouted*, violating rule 2). New wiring, small.

## The arc, node by node (major beats — detail deferred to use site)

- **The fork — sustain vs. infiltration (a real either/or, enforced by topology per C8).**
  - **The Prison Wagon (combat):** rescue **Sela the Medic** (breadth / sustain; usable recruit).
    No Medic catch-up downstream — skipping her is a real consequence.
  - **The training road (combat-bearing):** a **mentor two-beat** (C7) that surfaces the L5 gate,
    writes the Thief invite, and grants job-XP; the Thief prestige fires later (appear-when-eligible)
    once L5 is earned on this arm's fights (C3). Payoff: the **infiltration** approach to the finale
    (needs the lean taste, C6).
- **The finale — assault the prison facility** (retires the stub). **Objective: liberate the prison.**
  - **Frontal (any party):** fortified garrison, `eliminate-all`. Buildable from existing parts.
  - **Infiltration (Thief party):** the lean lockpick-in-deployment taste → a minimal extraction
    win. The full extraction/interior/alarm version is the parked deep-dive.
  - **Prestige = Thief only** (Assassin dropped — doesn't serve the deployment headline).

## Parked deep-dives (own discussions, not now)
- **The deployment-phase expansion** — full extraction (C1), interior-deploy vs pre-breached (C5),
  the alarm/detection model. The signature system; its own in-depth discussion. *(The lean taste is
  a deliberate down-payment on shipped rails; the full rework waits.)*
- **Guild / economy bookend** — how much of the outer scales to show.

## Decision status
- **Q1 — depth road → Thief prestige — CLEARED (pending the Wave-0 map + the lean taste + C7's
  appear-when-eligible beat).** Thief, not Assassin; job-XP arming; fires in-run.
- **Q2 — reward map — CLEARED (pending topology enforcing exclusivity, C8).** Medic on the Wagon road.
- **Q3 — the finale — CLEARED-in-principle (pending the lean taste + C2 built at its use site).**
  Dual OR-victory; frontal buildable; infiltration via the lean taste; full mechanics parked.

## Next (design discussions, not build)
- **Work-backwards / finale-first — REVIEWED: needs-reframing (2026-07-11).** Adversarial verdict:
  the finale's *shape* is already given (Q3) — sketch it as the *target* only; but the first thing to
  **prove** is the **lean infiltration taste** (the riskiest unknown, C6), not the finale, and the
  run's beats derive from **C3/C7/C8**, not from working backwards. Designing a full finale first
  would build on parked mechanics (a JIT violation) + create lock-in.
- **Next session → [`backhalf-taste-kickoff.md`](backhalf-taste-kickoff.md):** design the **lean
  infiltration taste** on already-shipped deploy substrate (the critical path). Then the Wave-0
  topology (C3/C8), then the finale at its use site (C2). **Issue-minting only once something is
  genuinely buildable.**

## Guards every PR must keep green
`tsc` · `vitest run` · `npm run build` · e2e · `npm run sim` (digest re-pinned where routing/rewards
move) · `core/` free of Phaser/DOM and `Math.random`.
