# Implement the D80 overworld node redesign

> Kickoff brief for the D80 build. The design is **settled and lives in the docs**
> (the source of truth). This brief points at that canon and sequences the work; it
> is not itself the design. Paste it (or its spirit) into a fresh session to begin.

Your job: investigate the current code against the canon, produce a phased plan, get
it approved, then build it in small, verified PRs. Do **NOT** edit gameplay code
until the plan is agreed. Numbers in the docs are **ILLUSTRATIVE** — implement the
structure, use the example values as tunable defaults; don't hunt for "the right"
number (that's a playtest pass).

## Read first (the canon)
- `docs/design/systems/overworld.md` — sections:
  - "The node lifecycle — the night/day loop (D46, revised D80)" (night-after-arrival, two camps)
  - "The two-tier recovery economy (D47, revised D80)" + "Deep Rest's conditional big heal"
  - "Early events — the arrival layer (D80)"
- `docs/design/glossary.md` — the Lifecycle table (Camp · Set Out · Begin).

## Target, in one breath
A node runs: `[encounter] → REACT camp (scout ahead / bank loot / pick next = Set Out)
→ the road (early events; travel WOUNDED) → PREP camp on arrival (the night's rest +
gear up = Begin) → [encounter]`. Recovery is one meter: **effort → Fatigue** (narrowing
tiers); a normal night steps down one tier; a Clearing's Deep Rest wipes it fully + a
big heal gated on **Tier-0-at-rest-time**. (Fatigue is the established meter in
`fatigue.ts` — tiers Rested/Worn/Weary/Exhausted; do not coin a new name.)

## Already shipped — revise, don't rebuild
- The nightly chip heal (B1) fires in `recordNight` (post-encounter) — **RETIME** it to
  arrival (the prep camp); this lands in the flow phase (Phase 4), which is where the
  arrival beat is established.
- The lifecycle rename (#94) shipped a single `Rest & Set Out` verb — the design now
  **SPLITS** it into `Set Out` (react → travel) + `Begin` (prep → encounter).

## Phase 0 — Investigation (deliver findings, no code)
Map current → canon and the blast radius of each change: `OverworldScene.ts`
(`renderCamp`, `showSurvey`, `commit`, `breakCamp*`, `enterCamp`, `afterNode`), core
(`runloop.ts` `restNode`/`inPlaceRest`, `run.ts` `recordNight`/`breakCamp`, `fatigue.ts`,
`overworld-actions.ts`, `intel.ts`, the M11 event registry, `jobs.ts` `SURVEY`). Report
what maps 1:1, what's net-new, and any surprises. Preserve the repo's architecture: pure
logic in core (tested), the scene is a thin renderer.

## Phases (each = its own PR: `tsc` clean + `npx vitest run` green)
1. **Effort / Fatigue core (pure).** Revise `fatigue.ts` to narrowing fatigue tiers +
   "step down to the floor of the previous tier" nightly decay; treat
   `OverworldCost.fatigue` as generalized "effort." `fatigue.ts` is **NOT greenfield** — it
   already drives the Exhausted combat slow and the rest-heal RP penalty; preserve those,
   and expect to **update** existing fatigue tests, not just add.
2. **Deep Rest / Clearing (core).** Rework `restNode`: every unit Deep Rests (Fatigue
   wiped), big heal gated on **Tier-0-at-rest-time**. Pure; update `restNode` tests.
3. **Surface Fatigue (UI) — at the point of decision.** Per-unit Fatigue tier on the party
   **dossier** + a projected Fatigue delta when you **hover a unit's ability** (the existing
   action-preview system). Land this the moment Fatigue is decision-relevant — it's a
   general recovery readout, **NOT** gated behind the Survey rework.
4. **Flow reshape (scene).** The two-camp night-after-arrival loop: react camp (plan) + prep
   camp (rest+gear); split the verb into `Set Out` + `Begin`; **retime the chip** so the rest
   lands on arrival. Handle the **CLEARING special case**: a Clearing's encounter *is* its
   arrival Deep Rest — no separate "Begin → encounter" beat. Regenerate the `shots:*`
   screenshots per beat.
5. **Survey rework.** effort ≈4, cooldown 1, in the react camp's Intel drawer; implement
   effect **A** (sharpen the target's bands — exists) + **C** (fog-reach lever — new); a
   "scouted" marker on surveyed nodes. (The Fatigue readout already shipped in Phase 3.)
6. **Early events (the arrival layer).** Random pool (reuse thief/patron/merchant) + tailored
   node-bound events; the gated + loot-forgoing bypass. Unlocks Survey's effect **B** (reveal
   the node's early event).

## Surface to the user, don't guess
- **Node-kind naming** in code (keep keys, or rename combat→battle / rest→clearing / add
  town?) — decide before it balloons the diff (affects Phases 2–6).
- Any place a **number** materially changes feel — flag it, ship the doc's example value.

## Parked (separate efforts, not this build)
- The **Train** progression sub-system.
- **Paid in-place rest** (what it buys given a free nightly floor).
- **Route-forecast Fatigue projection** ("Tier 0 when it reaches the Clearing?") — playtest-gated.

## Working rules
- Investigation → approved plan → incremental PRs, one phase at a time.
- Core logic tested; scene stays thin. Branch fresh from `main`.
- Run Phase 0 as its own turn and review findings before approving the plan — the flow
  reshape (Phase 4) is the big one; know the blast radius first.
