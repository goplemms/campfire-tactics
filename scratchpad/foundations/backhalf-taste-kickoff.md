# Kickoff — Hollow Mill back-half: the lean infiltration taste (design + plan)

> Paste into a fresh session to begin the next design phase. The arc is settled at the *beat*
> level and lives in the docs (source of truth). This brief points at that canon, encodes the
> approach three adversarial passes converged on, and scopes the first move. **Do NOT edit
> gameplay code until a plan is agreed.** Numbers in the docs are illustrative tunables.

## Read first (canon)
- [`scratchpad/foundations/hollow-mill-backhalf-arc-plan.md`](hollow-mill-backhalf-arc-plan.md) —
  the **LOCKED arc plan**: north-star, design rules, constraints **C1–C9**, decision status, the
  taste-first reframe, and the **just-in-time** philosophy (yet-undefined parts are fine —
  resolve detail at the use site).
- `decisions.md`: **D68** (Scout→{Assassin, Thief} fork), **D69** (queued: appear-when-eligible
  prestige offer + the lockpick door), **D67** (deploy/combat unification — deploy casts commit +
  carry into combat), **D80** (node lifecycle).
- Code: `src/core/deployment.ts` (the deploy phase — the closing net/danger gradient,
  concealment, dig-in, traps, **Quiet Footsteps** evasion), `src/core/jobs-data/scout-line.ts`
  (`THIEF_JOB`, `lockpick`, `SCOUT_PRESTIGE_FLOOR = 5`, and note THIEF clears Quiet Footsteps),
  `src/core/authored.ts` (the `captives` seam), `src/core/objectives.ts` (`encounterOutcome` is
  AND-only — the any-of gap, C2).

## The approach (reframed by adversarial review — do NOT re-litigate)
- **The finale's shape is GIVEN** (Q3): liberate the prison; frontal = `eliminate-all`;
  infiltration = a *minimal* extraction OR-win. Treat it as the **target** — sketch only. Do NOT
  design its full mechanics (extraction / interior-deploy / alarm are a **parked** deep-dive).
- **The first de-risking artifact is the LEAN INFILTRATION TASTE, not the finale.** The Thief is a
  deploy *downgrade* until this exists (C6), so it is the critical path and the riskiest unknown.
- **The run's beats are already pinned by the constraints** — C3 (L5-fights must sit on the
  infiltration arm), C7 (the two-beat mentor arming + appear-when-eligible), C8 (exclusivity is
  enforced by topology). Derive beats from those, **not** by working backwards from the finale.
- **Just-in-time:** undefined parts are fine — resolve them at the use site, not up front.

## The first move (deliver a design + plan — no gameplay code)
Investigate what a **lockpick-in-deployment act** can do on **already-shipped** deploy substrate,
and design the leanest version that gives the Thief a real, visible payoff.
- **What shipped rails support** (read `deployment.ts` + D67): a deploy-phase act that carries a
  *visible consequence into the fight*. Candidate shapes to evaluate — **open a breach → shift the
  player's deploy edge/zone**; **pre-reveal / pre-disable a slice of the garrison**; the
  **net-as-alarm on a pre-breached board** (C5); a **minimal freed-captive via the existing
  `captives` seam**.
- **Hard limits (parked — do not build):** no interior-deploy sub-mode, no new alarm/detection
  system, no extraction rework. Reuse: deploy casts' commit+carry (D67 W5), the net, concealment,
  the captives seam.
- **The Thief must not be a net downgrade** (C6): the taste's utility/evasion should offset losing
  Quiet Footsteps.

**Deliverable:** (1) 2–3 candidate taste designs on shipped rails, each with the substrate it
needs; (2) a recommendation; (3) a small build plan (PRs · tests · guards); (4) flag anything that
would force a *parked* system — that's the signal it's too big for a taste, and belongs in the
deployment deep-dive instead.

## Then (after the taste proves out — later sessions)
- **Wave-0 topology** — the map enforcing C8 (exclusivity) + placing the C3 L5-fights on the arm.
- **The finale**, designed *at its use site* (the taste + C2's any-of objective group).
- **Issue-minting** — only once something is genuinely buildable; the arc plan's waves become the
  umbrella issue + children then, not before.

## Working rules
- Investigation → **agreed plan** → incremental PRs. Pure logic in `src/core` (headless, tested);
  the scene stays a thin renderer. Determinism: no `Math.random` in `core/`.
- Guards green every PR: `tsc` · `vitest run` · `build` · e2e · `sim`.
- **Review cadence:** settle a decision (or batch) → adversarial red-team → finalize/revise.
