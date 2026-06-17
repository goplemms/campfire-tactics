# Path 2 Kickoff (DISCUSSION DRAFT) — Authored set-pieces on the expedition frame

> **Status: DISCUSSION — design NOT finalized.** This is a prompt to hash out the
> *authored-fights-inside-the-expedition* work (the "Path 2" teed up after M13). No
> `decisions.md` entries, no `plan.md` row, no build yet. The **Open discussion
> queue** below is the work of this phase; once the leans are confirmed/adjusted we
> **graduate** to a build prompt + decision log (this likely becomes **M14**, or a
> tightly-scoped M13 follow-on — that scoping is **Q0**).
>
> Continue design on `claude/jolly-volta-euogwo` (or a fresh branch). Repo is at the
> end of M13 (D1–D48; M1–M13 shipped & green; **403 tests**; the overworld economic
> layer + the curated **Expedition demo** are merged to `main`).

## Why this work

M12 built **combat depth** proven by a hand-authored quest (*The Hollow Mill*). M13
built the **expedition** — the economic routing layer (fog, ledger, forecast,
recovery, the node lifecycle) — proven by a curated procedural demo. They are **two
separate stacks** that never meet:

- the **Hollow Mill** fights are hand-tuned set-pieces (objectives, a bridge-cut
  timer, graded failure) but live on a **linear beat list** with no map/economy;
- the **Expedition** wraps real routing/economy around combats, but those combats
  are **procedural** (`generateEncounter`), not the authored set-pieces.

Path 2 unites them: let an **authored encounter sit on an overworld node**, so an
expedition can wrap hand-crafted combat in the routing economy — a *comprehensive*
expedition demo now, and the substrate for **authored campaign content** (the D26
main quest) later.

## Current state — the gap, grounded in code

- **Procedural combat path:** `RunLoop.startEncounter()` → `currentEncounter(run)` →
  `nodeEncounter(seed, node)` → `generateEncounter(...)` → an **`EncounterDef`**
  (`generation.ts`), staged + rendered by **`BattleScene`** (full overworld HUD:
  camp, intel, theft, recruitment, the M13 Survey return).
- **Authored combat path:** **`AuthoredEncounter`** (`authored.ts`) — authored grid
  / enemy placements / **objectives** (graded failure, D43) — played by
  **`DemoScene`** (its *own* renderer over the shared `CombatView`), strung in a
  linear **`AuthoredQuest`** of beats (`provision` / `encounter` / `rest`).
- **No seam** connects a `MapNode` to an `AuthoredEncounter`, and the two renderers
  have **diverged**: only `DemoScene` knows objectives/timers; only `BattleScene`
  knows the overworld economy + the M13 lifecycle.

So Path 2 is fundamentally about **(a)** a data seam (node → authored encounter) and
**(b)** **converging the two combat renderers** so authored objectives play inside
the real `BattleScene`.

## Read-first

- `src/core/authored.ts` (AuthoredEncounter / ObjectiveSpec / AuthoredQuest / EncounterResult)
- `src/core/demo-quest.ts` (The Hollow Mill — the authored content + objectives/timer)
- `src/core/generation.ts` (`EncounterDef`, `reward`) + `src/core/runloop.ts`
  (`startEncounter` / `resolve` / `currentEncounter`)
- `src/core/overworld.ts` + `src/core/run.ts` (the node + `nodeEncounter` seam)
- `src/core/forecast.ts` (`nodeLoot` reads `def.reward.gold` — authored nodes must
  expose a bandable reward) + `src/core/ledger.ts`
- `src/game/scenes/BattleScene.ts` vs `src/game/scenes/DemoScene.ts` (the two
  renderers) + `src/game/combat-view.ts` (the shared board seam)
- `decisions.md`: **D43** (graded failure), **D44** (authoring substrate), **D23/D26**
  (node kinds + the main quest), **D22** (determinism)

## Architectural rules (non-negotiable, carried from M12/M13)

- **Core/render split (D2):** logic in `src/core/` (headless, no Phaser/DOM); Phaser
  only in `src/game/`. New core modules export via `core/index.ts`.
- **Determinism (D22):** no live RNG in core; authored content is deterministic by
  construction; the grep test (`core/` free of `Math.random`) stays green.
- **Data, not branches (D4):** an authored encounter on a node is **data** (a record
  + a registry), resolved by the existing interpreters — not a special-case in the loop.
- **One renderer, written once (the M12 CombatView ethos):** converge the combat
  presentation rather than maintaining two; a board/objective feature should show up
  in both the demo and a real mission because it lives in one place.
- **Test-first:** every core seam ships a `*.test.ts`; a phase lands `npm test` +
  `npm run build` green.

## Open discussion queue (one at a time; each has options + a lean)

**Q0 — Scope & framing: a milestone, or an M13 follow-on?**
Is Path 2 (a) a *demo-only* unification (the Hollow Mill inside one expedition demo),
or (b) a *general capability* (authored set-pieces on the campaign frame, feeding the
D26 main quest)? (a) is a few days; (b) is a milestone with an authoring substrate.
*Lean:* build the **general seam** but **scope the deliverable to the demo** first —
i.e., do (b)'s minimal core seam, prove it with (a)'s demo, defer the campaign content.
Likely **M14**.

**Q1 — The node→authored seam. How does a node carry an authored fight?**
- A. A side table on the run/map: `Record<nodeId, authoredEncounterId>`, read by
  `RunLoop.startEncounter` (present ⇒ authored; absent ⇒ procedural). Composes with a
  procedural map; zero generation changes.
- B. An optional `authoredId` field on `MapNode`, baked at map-build time.
- C. A fully **authored map** type (hand-built nodes/edges), no procedural generation.
*Lean:* **A** (a node→authored table), with **C**'s hand-built map for the *demo* —
the table works on both procedural and authored maps.

**Q2 — `EncounterDef` vs `AuthoredEncounter`: adapter, union, or unify?**
`BattleScene`/`RunLoop` consume `EncounterDef`; authored fights are `AuthoredEncounter`
(+ objectives). Do we (a) adapt authored→EncounterDef (loses objectives), (b) make the
loop/BattleScene accept **either** (a union the stager branches on), or (c) merge the
two types?
*Lean:* **(b)** — `startEncounter` returns a staged battle from *either* source;
**objectives are preserved** (they're the whole point of authoring). Avoid flattening.

**Q3 — Renderer convergence: teach `BattleScene` objectives, or route to `DemoScene`?**
The expedition uses `BattleScene`; authored fights need objectives + the bridge-cut
**timer** + graded-failure UI, which only `DemoScene` has today.
- A. Port objective/timer/graded-failure handling **into `BattleScene`** (one
  renderer; `DemoScene` can later retire). The bulk of the work.
- B. Hand authored nodes to `DemoScene` as a sub-flow (two renderers forever; messy
  hand-off of the overworld HUD).
*Lean:* **A** — converge on `BattleScene`. This is the real cost of Path 2 and the
biggest design risk; worth scoping carefully (which objective kinds ship first?).

**Q4 — Rewards & the forecast.** The ledger/forecast band loot from
`nodeEncounter(...).reward.gold`. Authored nodes must expose a **bandable reward** so
the economy still projects, and objectives may modify it (a bonus for the optional
objective).
*Lean:* `AuthoredEncounter` carries a `reward` (gold + materials) like `EncounterDef`;
objective-complete can add a bonus. The forecast reads it uniformly (no fog-leak rules
change).

**Q5 — Graded failure on the overworld (D43).** An objective **failure** at a node:
does the run **continue** (you move on, having lost the side objective + its bonus), or
is it a softer terminal? How does it interact with the M13 terminals (wipe / complete)?
*Lean:* objective-failure ≠ wipe — the **run continues**, the node still counts as
"played" (you just forfeit the bonus / take a story consequence). A **wipe** is still
the wipe. Needs an explicit rule + a test.

**Q6 — Authoring substrate.** M12 has `AuthoredQuest` (linear beats). Path 2 wants an
authored **expedition**: a hand-built `OverworldMap` + the node→authored table + a
starting bundle (party/purse/supplies) + visible fees.
- A. A new `AuthoredExpedition` core type (reuses `AuthoredEncounter` + `OverworldMap`).
- B. Extend `AuthoredQuest` to optionally carry a map.
*Lean:* **A** — a clean `AuthoredExpedition`; the demo builds one, and a future
campaign is "more of these."

**Q7 — What happens to the standalone Hollow Mill demo / `DemoScene`?** If `BattleScene`
absorbs objectives (Q3-A), do we **retire** `DemoScene` (fold the Hollow Mill into an
authored expedition) or keep it as a focused combat showcase?
*Lean:* **keep it short-term** (don't block Path 2 on a migration); plan to converge
once `BattleScene` has full objective parity. Track as debt.

**Q8 — Difficulty/scaling of authored fights vs procedural.** Procedural encounters
scale with map depth (`layer` = difficulty index). Authored fights are fixed. On a mixed
map, do authored set-pieces ignore depth scaling (hand-tuned), and is that legible to
the player/forecast? *Lean:* authored = fixed (hand-tuned), clearly the intent; the
forecast bands their authored reward like any node.

## Scope tiers (to choose in Q0)

1. **Minimal (demo-only, ~small):** the Q1-A table + Q2-b stager + the *subset* of
   objective UI the Hollow Mill needs ported into `BattleScene`, + an `AuthoredExpedition`
   for the demo. Deliverable: one expedition demo whose combat nodes are Hollow Mill
   fights. Defers campaign content + full DemoScene retirement.
2. **General (milestone):** the above + the full objective/graded-failure parity in
   `BattleScene`, a documented authoring substrate, and a first slice of **authored main-
   quest** content on the campaign frame (D26). Retire/converge `DemoScene`.

*Recommended:* tier 1 as the build, tier 2's *seam* designed so it's a content
exercise afterward (not a reshape).

## Deferred / explicitly out of scope (for now)

- The **global gold-scarcity numbers pass** (still parked from M13) — orthogonal, but
  authored fights make tuning easier to author, so they may want to ride together.
- A full **map-authoring tool/format** beyond a TS record.
- **DemoScene retirement** (tracked as debt under Q7).

## Definition of "discussion complete"

Q0–Q8 each have a confirmed call (lean accepted or revised); the renderer-convergence
scope (Q3) has a named first set of objective kinds; then graduate: write the build
prompt, log the new decisions (the node→authored seam, the encounter union, graded-
failure-on-overworld, the `AuthoredExpedition` substrate), add the `plan.md` row, build
in phases (core seam → renderer convergence → the authored demo → gate).
