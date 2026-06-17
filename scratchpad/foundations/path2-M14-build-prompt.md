# M14 Build Prompt — Authored set-pieces on the expedition frame

> **Graduated from** [`path2-authored-expedition-kickoff.md`](path2-authored-expedition-kickoff.md)
> (Q0–Q9 resolved, 2026-06-16). This is the **build** prompt: implement M14 in phases,
> test-first, on branch `claude/jolly-volta-euogwo`. The repo is at the end of M13
> (D1–D48; 403 tests; overworld economy + the curated Expedition demo on `main`).

## Goal (one paragraph)

Converge the two combat stacks. Today the **Hollow Mill** authored fights play in their own
renderer (`DemoScene`) over a linear beat list, while the **expedition** wraps the M13
routing economy around *procedural* fights in `BattleScene`. M14 makes an **authored
encounter sit on an overworld node** so an expedition can wrap hand-crafted combat in the
real economy — and it does so by building the **general authoring framework** (an
`AuthoredExpedition`: a hand-built map + node→fight bindings + a starting bundle), not a
demo patch. The Hollow Mill is rebuilt as the framework's **first** `AuthoredExpedition`,
configured exactly like a future campaign quest would be.

## Definition of done (the milestone gate)

**The milestone is finished when all demo-specific code is removed** — `DemoScene`,
`DemoRunner`, the `AuthoredQuest`/`QuestBeat`/`ProvisionBeat`/`RestBeat`/`EncounterBeat`/
`StoryOutcome` beat machinery, and the old `#demo` boot — and the Hollow Mill plays end to
end as an `AuthoredExpedition` through the **real** `OverworldScene → BattleScene` path.
`npm test` + `npm run build` green; `src/core/` free of Phaser/DOM **and** `Math.random`.

## Architecture rules (non-negotiable, carried from M12/M13)

- **Core/render split (D2):** logic in `src/core/` (headless); Phaser only in `src/game/`.
  New core modules export via `core/index.ts`.
- **Determinism (D22):** no live RNG in core; authored content deterministic by construction;
  the grep test stays green.
- **Data, not branches (D4):** authored vs procedural is *data*, resolved by shared
  interpreters — not special-cases in the loop or the renderer.
- **One renderer, written once:** converge presentation; a board/objective feature lives in
  one place and shows up in every fight that has it.
- **Test-first:** every core seam ships a `*.test.ts`; each phase lands `npm test` +
  `npm run build` green.

## Read-first

- `src/core/authored.ts` — `AuthoredEncounter`/`EnemyPlacement`/`ObjectiveSpec`/`armObjective`/
  `EncounterResult` (the framework survivors); `AuthoredQuest`+beats (the retirees).
- `src/core/demo-quest.ts` — `DemoRunner`, `THE_HOLLOW_MILL`, `DEMO_PARTY`, `E1/E2/E3`,
  `stageEncounter`, `autoResolveEncounter` (the reference behavior to port + retire).
- `src/core/generation.ts` — `EncounterDef`, `EncounterReward`, `generateEncounter`,
  `BANDIT_TEMPLATES`, `getEnemyTemplate`.
- `src/core/runloop.ts` — `startEncounter` (line 404), `resolve` (469), `beginBattle`,
  `placePlayers`, `playCurrentNode`.
- `src/core/run.ts` — `createRun`/`createRunFromCaravan`, `currentEncounter` (218),
  `recordNight` (270 — the `complete` flag), `breakCamp` (192), `RunSnapshot` (281).
- `src/core/overworld.ts` — `MapNode`, `OverworldMap`, `generateOverworld`, `nodeEncounter`
  (196), `reachableFrom`, the connectivity invariants.
- `src/core/forecast.ts` — `nodeLoot` (118, reads `def.reward.gold`), `projectForecast`.
- `src/core/leveling.ts` — `routeCombatXp` (177), `grantCombatXp`, `accrueDeployedXp` (124),
  `grantAbilityUseXp` (138), `jobLevelOf`, `unlockedSkills`. **None wired into the run loop.**
- `src/game/scenes/BattleScene.ts` vs `DemoScene.ts` + `src/game/combat-view.ts` (shared seam).
- `src/game/scenes/OverworldScene.ts` — line 631 (`node.kind === "combat"` → `BattleScene`).
- `decisions.md`: D2, D4, D9, D22, D23, D26, D32, D39, D43, D44, D45–D48.

---

## Phase 0 — Log decisions + plan row

Write the decision entries below into `scratchpad/foundations/decisions.md` (repo format:
Status / Context / Options / Decision / Spec / Superseded-by — see D43/D44 as templates).
Verify the next free id (kickoff says D1–D48 exist → start at **D49**). Add the M14 row to
`plan.md`. *Drafts to expand:*

- **D49 — Authored set-pieces on the expedition frame (the M14 framing + node→authored seam).**
  An authored encounter binds to a map node via an optional **`authoredId` on `MapNode`**;
  resolution is **run-scoped** — `currentEncounter`/forecast/intel/preview call one resolver
  that returns the authored `AuthoredEncounter` when `node.authoredId` hits the run's catalog,
  else falls back to `generateEncounter` (the single `nodeEncounter` funnel preserved). Scope
  is a **framework milestone**: general substrate + general objective seam now; objective
  *kinds* grow from content; cross-node narrative state and D26 campaign content deferred.
- **D50 — Encounter staging seam + multi-objective graded resolution.** `nodeEncounter`
  returns `EncounterDef | AuthoredEncounter`; one core **`stageEncounter(source, roster, opts)`
  → `{ battle, objectives }`** is the seam the renderer consumes uniformly (definition types
  stay separate producers; enemy-rep difference hidden behind staging). Objectives are a
  **list** `ObjectiveSpec[]`, each **`required | optional`**, resolving **`met | failed |
  pending`**, **tag-bound** (driver/span by role/coordinate, designed so a generator can emit
  them later). One core **`encounterOutcome(staged) → win | objective-failure | wipe`**:
  wipe if no combat-capable player remains; else objective-failure if any *required* objective
  failed; else win when all *required* are met. **M14 ships two kinds:** `eliminate-all` (a
  required *goal*, **met** when `Battle.outcome().winner === "player"` — a thin delegate over
  the unchanged primitive; **default-injected** when an encounter lists no explicit goal) and
  `closing-gate` (a required *constraint*, the bridge-cut generalized: timed gauge → span
  sweep, **failed** when the gauge completes, fizzles when its tagged driver is
  killed/immobilized). **Deferred:** optional-objective bonuses; explicit win-conditions that
  *override* elimination (end the fight while enemies remain); generated objectives/templates.
- **D51 — Graded failure on the overworld (extends D43).** Objective-failure ≠ wipe: the party
  **retreats alive**, downed units resolve per the **D9 mortality policy** (same path a win
  runs — *not* auto-permadeath); the **reward (incl. XP) is forfeited**; still-captured allies
  become **rescue quests** (the non-win path). **Interior** node: the run **continues**, the
  node counts as played, route forward as if cleared. **Final** node: three end-states —
  **win = complete (prize)**, **objective-failure = caravan returns alive without the prize**
  (distinct from complete and from wipe), **wipe = lost**. Fix: `recordNight`'s `complete`
  flag requires all *required* objectives **met** (not merely "survived the final fight"). The
  end-screen grade reads the final node's history record. An explicit test pins all three.
- **D52 — `AuthoredExpedition` substrate.** A first-class core type `{ id, name, seed, map
  (hand-built `OverworldMap`, `authoredId` on combat nodes), encounters: Record<id,
  AuthoredEncounter>, bundle: { party, purse, supplies, storageCap, morale, difficultyId } }`.
  Booted via **`createRunFromExpedition(expedition)`** into the normal overworld path.
  Authored expeditions live in a **catalog keyed by id**; the run carries the catalog ref so
  **snapshots rebuild the authored map from `expeditionId`** (a seed alone can't — the map
  isn't generated). A small validator reuses `reachableFrom` to enforce the connectivity
  invariants on hand-built maps. Maps inherit the authored↔template↔procedural spectrum;
  skeleton-fill deferred. Authored fights are **fixed/hand-tuned** (no `node.layer` scaling)
  but still respect the global `difficultyId` (mortality policy) — content fixed, stakes scale.
  `AuthoredQuest` + beat machinery retire.
- **D53 — Leveling wired into the run loop (realizes the D32/D39 split).** Combat units earn
  **combat XP from combat events** — defeat = kill credit to the attacker, surviving a hit =
  a smaller bump to the struck defender — **tallied on `battle.bus` by a core accumulator and
  committed at `resolve()` via `routeCombatXp`** to units that survive resolution (no
  mid-battle level-ups), **plus** objective **`reward.xp`** on a win (`xp` folds into
  `EncounterReward`). Non-combat units keep their path: **`accrueDeployedXp`** at the node-step
  + **`grantAbilityUseXp`** on support/overworld ability use. Combat-event XP is **universal**
  (M13 procedural runs now level) — ship conservative defaults, hand-tune the Hollow Mill
  curve; a **procedural leveling-balance pass is deferred** (rides the parked gold-scarcity
  tuning). No XP on objective-failure/wipe (XP is part of the forfeited reward).

**`plan.md` M14 row (draft):**

```
## M14 — Authored set-pieces on the expedition frame (D49–D53)
- Converge the authored (DemoScene) and procedural (BattleScene) combat stacks: an authored
  encounter binds to an overworld node (`authoredId` + run-scoped catalog), staged through one
  core `stageEncounter`, resolved through one `encounterOutcome` (multi-objective, required/
  optional). Build the `AuthoredExpedition` framework; rebuild the Hollow Mill as its first
  instance; wire the D32/D39 leveling split into the run loop; retire DemoScene.
- User-testable gate: launch the Hollow Mill expedition → it plays through the real overworld/
  BattleScene (provision at the start camp, E1, a rest, E2 with a hidden-until-scouted ambush,
  E3 with the closing-gate gauge + 3-way graded terminal), units level from combat + the
  objective, the forecast bands the authored rewards. No DemoScene anywhere. `npm test` green
  (staging/outcome/graded-failure/expedition-boot/leveling); `npm run build` clean; `core/`
  free of Phaser/DOM and `Math.random`.
- See decisions.md (D49–D53) and the M14 build prompt.
```

---

## Phase 1 — Core seams (headless, test-first)

Land each with its `*.test.ts`; `npm test` green before moving on.

1. **Node→authored binding + expedition boot (D49/D52).** Add `authoredId?: string` to
   `MapNode`. Add `AuthoredExpedition` + a catalog-by-id + `createRunFromExpedition`. Replace
   direct `nodeEncounter(run.seed, node)` calls with a **run-scoped resolver**
   (`runEncounter(run, node)`) used by `currentEncounter`, `forecast.nodeLoot`, intel, and
   `previewNode`: authored id ⇒ the catalog's `AuthoredEncounter`, else `generateEncounter`.
   Add the connectivity validator. *Test:* an authored node resolves to its fixed encounter;
   forecast bands its `reward.gold`; a non-authored node still generates; the validator catches
   an orphan/dead-end.
2. **Staging seam + union (D50).** `nodeEncounter`/`runEncounter` return the union. Write
   `stageEncounter(source, roster, opts) → { battle, objectives }` — authored ⇒
   `buildAuthoredGrid`/`buildAuthoredEnemies`/`placeParty(spawns)`/arm objectives; procedural ⇒
   `buildGrid`/`buildEnemies`/auto-edge placement/objectives (default eliminate-all only).
   Player-placement policy switch (explicit `playerSpawns` vs `placePlayers` auto-edge).
   `RunLoop.startEncounter` consumes it. *Test:* both sources stage to one shape; authored
   spawns honored; procedural auto-edge unchanged.
3. **Objectives model + archetypes (D50).** Generalize `ObjectiveSpec` → `objectives:
   ObjectiveSpec[]` with `required` + state `met|failed|pending`. Generalize `armObjective`
   into a **`closing-gate`** archetype (driver by tag, span by coordinate, label authored).
   Add an **`eliminate-all`** kind delegating to `Battle.outcome()`; default-inject it when no
   explicit goal is listed. *Test:* closing-gate fizzles on driver disable, fails on gauge
   complete; eliminate-all reads the primitive.
4. **`encounterOutcome` (D50).** One function: wipe → any required failed → all required met =
   win. *Test:* the truth table incl. an optional failure **not** downgrading a win.
5. **Graded failure in the loop (D51).** Rework `resolve()` to branch on `encounterOutcome`:
   win (reward incl. XP, D9 mortality, recordNight), objective-failure (no reward, D9 mortality,
   captives→rescue, run continues, recordNight as played), wipe (over). Fix `recordNight` so
   `complete` requires required-objectives-met. Add `xp?` to `EncounterReward`. *Test:* interior
   objective-failure continues + forfeits + records; final objective-failure ends alive-not-
   complete; wipe ends.
6. **Leveling wiring (D53).** A core combat-XP accumulator subscribing to `battle.bus`
   (kill-credit on the lethal `source`; survived-hit on `unitDamaged` with `hp > 0`); commit at
   `resolve()` via `routeCombatXp` to survivors + objective `reward.xp` on a win. Wire
   `accrueDeployedXp` into the node-step (`breakCamp`/`recordNight` area) and `grantAbilityUseXp`
   into support/overworld ability use. Conservative default amounts. *Test:* a combat unit
   levels from a kill + survived hit + objective XP; a deployed support unit trickles; benched
   never grows; no XP on objective-failure.

## Phase 2 — Renderer convergence (`BattleScene`)

Generic over objectives (never name `closing-gate` in the scene).

- **Objective gauge** in `refreshHud`: for each active objective, draw its label + progress
  (`clock.scheduledProgress`). Port the readout shape from `DemoScene.refreshHud:774`.
- **Failure poll** woven into `onAdvance`/`afterTurn` (the existing checkpoints) via
  `encounterOutcome`.
- **3-way terminal**: `finishBattle` branches win / objective-failure / wipe (distinct
  overlays) off `encounterOutcome`, routing through `loop.resolve()`.
- **Hidden/scouting reveal**: port `DemoScene.revealScouted`/`actor.hidden` handling.
- **Medic herb/med-heal flow**: port `DemoScene.onKitButton`→`useHeal` (herb pick from
  inventory) — `BattleScene.commitSkill` only calls `useSkill` today. Makes the medic work in
  every fight, not just the demo.
- **Level-up feedback** in the resolution overlay (a "reached job L2 — new active: …" line),
  replacing the demo's Level-Up screen.
- **Authored spawns × deployment**: staged authored `playerSpawns` set the deploy *starting*
  layout; the deploy/reposition phase then runs identically.

## Phase 3 — The Hollow Mill as an `AuthoredExpedition`

- Hand-build the map: `start (camp = provisioning)` → `E1 (combat)` → `rest (level-up)` →
  `E2 (combat)` → `E3 (final, closing-gate)`, with `authoredId` on the combat nodes. Re-home
  the `E1/E2/E3` `AuthoredEncounter` records (from `demo-quest.ts`) into the expedition's
  `encounters`. Set the `bundle` (the `DEMO_PARTY`, purse, supplies, storageCap).
- E2's ambush = plain **hidden-until-scouted** (the deserter cross-node gate is deferred).
- Tune authored `reward` + `reward.xp` so the L1→L2 unlock lands after E1 (authoring, not a
  mechanics change).
- Boot: a launcher (`#demo`/a guild entry) → `createRunFromExpedition(THE_HOLLOW_MILL)` →
  `OverworldScene`. *Test:* a headless auto-traverse of the expedition reaches the three
  graded terminals (clear / objective-failure on E3 / wipe) deterministically.

## Phase 4 — Retirement + gate

- Delete `DemoScene`, `DemoRunner`, the `AuthoredQuest`/beat types, the old `#demo` boot.
- Confirm no demo-specific code remains (the done-gate). `npm test` + `npm run build` green;
  `core/` free of Phaser/DOM + `Math.random`.

---

## Deferred / explicitly out of scope (logged, do NOT build)

- **Cross-node mini-events + run flags** — in-node authored events that set state read
  elsewhere on the map; restores the deserter spare/press → ambush reveal.
- **Generated objectives + encounter/map templates + skeleton-fill maps + explicit
  win-conditions** (override-style goals) + **depth-banded archetype pools** — the
  procedural-enrichment milestone, built atop M14's archetypes.
- **Optional-objective bonuses** (reward on optional met) — data-supported, no content yet.
- **Global gold-scarcity tuning + the procedural leveling-balance pass** — parked numbers
  exercise; only the Hollow Mill's own numbers are hand-tuned in M14.
