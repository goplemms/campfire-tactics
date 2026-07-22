# Finale layout (v4) + authored-node storage — session handoff (2026-07-22)

A **design session** (no production code changed). Two threads:
1. **Polished the finale level layout** into an enclosed, concentric "prison compound" (v4).
2. **Designed the long-term storage architecture for authored nodes** — the finale as the concrete basis point.

Read this **plus** `decisions.md` **D97–D99** (finale = rescue, dual-OR, flank deferred), **D103–D108**
(gates/levers/destructible-seal substrate + the guard doctrine), and **D98** (editor + JSON pipeline +
the anti-silent-overwrite discipline). New decision: **D116** (this session's storage call).

---

## Part A — The finale layout, v4

Reframe of `the-rescue.json` into a **concentric prison**: one intent (free the captives), two spatial
textures. Skeleton saved at [`finale-v4-skeleton.json`](finale-v4-skeleton.json) (importable into `#editor`;
**structural only** — no enemies/captives/objectives yet; do **not** drop into `content/levels/`, it won't validate).

```
    01234567890123456789      # = wall (full perimeter shell + interior)
r 0 ####################      l = lockpick gate    d = destructible seal
r 1 #··#··#··#····######      L = lever            E = exit mouth
r 2 #··#··#··#····######      1 = infiltration spawn (18,5)
r 3 #l##l##l##····#····#      2 = frontal spawn (9,18)
r 4 #········#L···#····E
r 5 #········l····l···1E   <- east mouth (rows 4-6) · gate-5 (14,5) · cell-side gate (9,5)
r 6 #········#····#····E
r 7 #········#··L·#····#
r 8 #############d######   <- row-8 seal · gate-4 (13,8) DESTRUCTIBLE
r 9 #··················#
r10 #·#·#·#·········#··#      GARRISON BARRACKS (rows 9-15, furnished:
r11 #·#·#·#····###··#··#       bunk alcoves left, mess table, weapon rack)
r12 #··················#
r13 #··················#
r14 #·##···············#
r15 #··················#
r16 #########d##########   <- row-16 seal · gate-6 (9,16) DESTRUCTIBLE
r17 #··················#
r18 #········2·········#      bottom staging
r19 ########EEE#########   <- bottom mouth (cols 8-10)
```

### The design (what makes it work)
- **Concentric, not linear.** Outer staging → garrison barracks → control room (hub, 2 levers) →
  antechamber → cells (deepest, top-left, lining the back wall).
- **Two mouths = two missions on one board:**
  - **Frontal** (spawn 2, bottom mouth) routes *through* the barracks both ways — the eliminate-all texture.
  - **Infiltration** (spawn 1, east mouth) drops straight into the control-room hub via gate-5, **skipping the
    garrison** — the stealth-extraction texture. This is the D99 flank, realized as geometry.
- **The seal-delay** (D103–D107): the two destructible doors (gate-4 barracks↔hub, gate-6 barracks↔staging)
  are lever-toggled. Slam one during the escort → the garrison must batter through → buys the fragile escort
  time. Pairs with the infiltration route (seal the garrison in, slip the captives out the east).
- **Levers wired** (per owner intent): lever-1 (10,4) → cell-side gate (9,5) ("control-room consistency" fluff);
  lever-2 (12,7) → the gate-4 seal (13,8).

### Canon it keeps (do NOT relitigate — D97/D99)
- **Cells stay deepest** — top-left corner, far from **both** exits. No walkover, whichever mouth you use.
- **Same-edge in/out** — exits are off-map at the two mouths (extraction spans TBD = the mouth tiles).
- **Both wins stay live**; **extraction stays the distinct/aspirational win**; the flank *serves* it, never replaces it.

### State + what's LEFT to author (this is a skeleton)
Walls/gates/levers/spawns only. Still to populate before it's playable:
- **Enemies** — the garrison mass in the barracks; **the Warden = keyholder** (D108: alive re-opens your seal,
  dead pops the cells); a few control-room guards.
- **Captives** — 3, in the cells; name them (roadmap: real campaign characters).
- **Objectives** — `eliminate-all` + `extraction` with exit spans on **both** mouths.
- **Gate types** — confirm cell doors = lockpick/keyholder, the two chokepoints = destructible seals.
- Still **standalone**; the live arc finale remains D97 `PRISON_ASSAULT`. Promotion is a later owner step.

### Load-bearing dependency (designed, not built)
The seal-delay only feels fair with **D108's guard doctrine** ("a sealed door is an alarm → converge → Warden
keys it / keyless guards batter it, suppressed while `in-combat`"), which is **not built** and still owes one
crux: **what sets/clears `in-combat`**. Today the AI only batters when "walled off from every seen foe."

---

## Part B — Authored-node storage architecture (the main thread)

**Problem:** authored nodes are double-homed today — standalone levels as **JSON in `content/levels/`**
(glob-loaded, D98), arc encounters as **hand-written TS consts in `core/hollow-mill.ts`** (because of core's
purity/layering discipline). "Promotion" is a manual hand-translation. It doesn't scale and risks drift.

**Correction made this session:** "core can't glob" is **not** a hard technical wall — the sim/tests run under
**vitest (Vite-powered)** and core's own tests already use `import.meta.glob`. The real reason arc content is
TS-in-core is the **layering/purity discipline**: `core/` is the pure base `content/`+`game/` build on; core
importing `content/` inverts that and ties core to Vite-isms. So the choice was framed honestly as:
**does core *import* its content, or get it *injected*?**

### Decisions (see D116)
1. **Injection over codegen.** Node bodies stay **JSON, one file per node**, in `content/`. A resolved
   **catalog is handed into core's run machinery at boot** (dependency flows content→core; no Vite-ism in core,
   no generated files). Codegen was considered and rejected as heavier than needed for this case.
2. **The existing seam carries it.** `MapNode.authoredId` already indirects node→encounter through a catalog
   (today inline per-expedition: `{ [PRISON_ASSAULT.id]: PRISON_ASSAULT, … }`). Injection just swaps that inline
   catalog for the shared injected one. Minimal change.
3. **The expedition load pipeline** (run at **boot** AND reused as a **build-time guard** so a broken expedition
   never ships):
   1. **Resolve** every referenced `authoredId` against the injected catalog — **fail loud** on a miss.
   2. **Assemble** the DAG.
   3. **Satisfy prerequisites** — for any node declaring a need (finale: "infiltration wants side-door intel"),
      **validate** a provider node sits reachable **upstream**. **Validate, do NOT auto-insert** (auto-inserting
      into a curated arc is exactly D98's silent-overwrite risk).
   4. **Validate** connectivity invariants (reachable, no dead ends — `MAP_GEN`).
4. **Prereq = placement + a runtime flag (two halves).** Placement guarantees the *opportunity* (a provider node
   is on some path); the player must **visit/resolve it** to set a run-state flag (`sideDoorIntel`); the finale
   reads it at deploy. In a branching DAG the player can skip it → the finale must **degrade gracefully to
   frontal-only**. The flank is a *reward for scouting*, never a hard gate. (This is D99's parked flank behavior.)
5. **Reconciliation:** "curated" means **explicit + fail-loud-validated**, not "must be TS." A hand-authored,
   validated expedition *file* is still curated whether TS or JSON — so the anti-silent-overwrite guard survives
   the eventual move to JSON expeditions.

### Explicitly INTENT / DEFERRED (do not build yet — owner-flagged)
- **Expeditions as JSON** that define the **graph itself** — a mix of **authored nodes (by id)** + **generated
  nodes (by spec)** + how they **link**. The bridge between the curated arc and the procedural `MAP_GEN`
  overworld. *Intent only.*
- **A general provides/requires vocabulary.** For now it's **one named string flag** (`side-door-intel`),
  matched — not a capability engine (JIT).
- **Auto-insertion of prerequisite nodes** (kept in back pocket; validate-only for now).

### The near-term buildable slice (for the next session)
JSON node bodies + the **injected catalog** + the **load pipeline** (resolve → assemble → **validate prereqs** →
validate connectivity), run at boot and as a build-time guard, with the **finale as the driving case**. Keep
expedition topology curated (TS is fine for now); keep the flank's runtime flag + graceful fallback in the design
but only build what the finale needs.

---

## Key files
- Finale (standalone, live): `src/content/levels/the-rescue.json` · v4 skeleton: `scratchpad/foundations/finale-v4-skeleton.json`
- Live arc finale (D97, still shipped): `src/core/hollow-mill.ts` (`PRISON_ASSAULT`, `hollowMillMap`, `THE_HOLLOW_MILL`)
- Content pipeline: `src/content/levels.ts` (glob + `validateLevel`)
- Node→encounter seam: `src/core/overworld.ts` (`MapNode.authoredId`)
- Gate/lever/seal substrate: `src/core/gates.ts`, `staging.ts`, `BattleScene` (D103–D108)
- Editor: `src/game/scenes/EditorScene.ts`, `src/game/editor-draft.ts` (`#editor`)
- Decisions: `decisions.md` D97–D99, D103–D108, D98, **D116**

---

## Prompt for the next session (build the storage slice, finale as driver)

> **Context.** Design is settled — see `scratchpad/foundations/finale-storage-and-layout-handoff.md` and
> `decisions.md` **D116** (+ D97–D99, D98, D103–D108). Do **not** relitigate the design; build the near-term slice.
>
> **Goal.** Replace the double-homed authored-node storage with **injection**: authored node bodies stay JSON in
> `content/`, one file each; a resolved **catalog is injected into core's run machinery at boot**; the expedition
> resolves `authoredId` against it. Add an **expedition load pipeline** (resolve → assemble → **validate
> prerequisites** → validate connectivity) that runs **at boot and as a build-time/CI guard**, failing loud on a
> dangling id or an unsatisfied prerequisite. Use **the finale (The Rescue) as the concrete driving case**.
>
> **Build now:** the injected catalog + the load pipeline + **validate-only** prereq checking + the finale wired
> through it. Keep expedition *topology* curated (TS is fine). Keep the flank's **runtime flag (`sideDoorIntel`)
> + graceful frontal fallback** in the design; build only what the finale needs.
>
> **Do NOT build (intent/deferred):** JSON-defined expeditions (authored+generated node graph in a file);
> auto-insertion of prerequisite nodes; a general provides/requires capability engine (one named string flag only).
>
> **Honor the canon:** core stays pure (no Vite-ism, no `content/` import — content flows *into* core); the arc
> stays curated + fail-loud-validated (never silently reshaped — D98); the shipped D97 arc finale is untouched
> until an explicit owner-directed promotion; extraction stays the distinct win, cells stay deep, the flank serves
> not replaces (D99).
>
> **Approach.** This touches `core/`'s boot/wiring — plan it first (consider the memento discussion-to-plan /
> orchestrate workflow), **red-team it** (`decision-adversary`), and keep every guard green
> (`npm run build`/`test`/`sim`, and `test:e2e:*` for any player-facing surface). Log the outcome as a follow-up
> to D116. **Separate follow-ons (not this session):** populating the v4 finale (enemies/Warden-keyholder/named
> captives/objectives), the D108 guard doctrine, and promoting The Rescue into the arc.
