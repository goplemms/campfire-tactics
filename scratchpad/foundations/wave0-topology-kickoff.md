# Kickoff — Hollow Mill back-half: Wave-0 topology (the map that makes the taste playable)

> Paste into a fresh session on a new branch to begin the Wave-0 arc step. The arc is settled at the
> *beat* level in the canon; this brief scopes turning those beats into a real map. **Do NOT edit
> gameplay code until a plan is agreed.**

## Read first (canon)
- [`hollow-mill-backhalf-arc-plan.md`](hollow-mill-backhalf-arc-plan.md) — the LOCKED arc plan. Focus:
  **§The arc, node by node**, and constraints **C3** (L5-fights must sit on the infiltration arm),
  **C7** (the mentor two-beat: arm early / fire later via D69 appear-when-eligible), **C8** (fork
  exclusivity enforced by *topology*, not asserted).
- `decisions.md`: **D90** (the lean infiltration taste — SHIPPED; the cuffed-captive "Pick the Cell"
  now exists and needs a live home), **D80** (node lifecycle / the night-day loop), **D68/D69** (the
  Scout→Thief fork + the queued appear-when-eligible prestige offer + the lockpick door).
- Code: `src/core/hollow-mill.ts` (the current shipped topology + authored encounters — everything
  past node 3 is **open design**, obsolete, replace freely), `src/core/expedition.ts`
  (`validateExpedition` — the layer-DAG rules), `src/core/authored.ts` (`AuthoredEncounter` +
  `captives` with `release: { kind: "lockpick" }` — the cuffed cell).

## The first move (deliver a design + plan — no gameplay code)
Design **Wave-0**: the back-half map from the L4 fork to the finale that makes the routes real.
- **The fork (a genuine either/or, exclusivity by topology — C8):** the **Prison Wagon** road (frees
  Sela the Medic — sustain) vs. the **training road** (the Thief prestige — infiltration). No
  reconvergence that reaches the training node after the Wagon; no Medic catch-up on the Thief arm.
- **Place the C3 L5-fights on the infiltration arm** so a Scout can grind job-XP to the prestige
  floor (5) on that road — the road/rest trickle is character-XP, not the job-XP the gate reads.
- **The mentor two-beat (C7):** an early low-gate beat that writes the Thief invite + grants job-XP,
  and a later transition that fires when jobLevel≥5 (D69 appear-when-eligible — currently unbuilt;
  design at its use site).
- **A cuffed-captive encounter on the arm** — the taste's (D90) first *live* home: a `lockpick`
  captive so the Thief's Pick-the-Cell pays off in a real run. (Prototype it in the scenario harness
  if that track has shipped — see `scenario-harness-kickoff.md`.)

**Deliverable:** (1) the Wave-0 topology (nodes, edges, layer-DAG, the exclusivity proof); (2) the
authored encounters/nodes it needs (incl. the cuffed cell); (3) a build plan (PRs · tests · guards);
(4) flag anything that forces a *parked* system (extraction/interior-deploy/alarm/any-of) — that's a
finale concern, not Wave-0.

## Then (later sessions)
- **The finale** — designed at its use site (the taste + C2's any-of objective group). The frontal
  arm (`eliminate-all`) is buildable now; the infiltration arm is the minimal-extraction OR-win.

## Working rules
- Investigation → **agreed plan** → incremental PRs. Pure logic in `src/core` (headless, tested); the
  scene stays a thin renderer. Determinism: no `Math.random` in `core/`.
- Guards green every PR: `tsc` · `vitest run` · `build` · e2e · `sim` (re-pin the digest where routing
  or rewards move).
- Review cadence: settle a decision (or batch) → adversarial red-team → finalize/revise.
