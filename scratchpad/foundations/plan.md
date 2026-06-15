# Plan: foundations

> **Design vision** for the systems these milestones build lives in
> [`docs/design/`](../../docs/design/) (game flow + per-phase/subsystem docs).
> Architectural calls are logged in [`decisions.md`](decisions.md) (D1–D46).

## Goal (north star)

A web-playable isometric roguelike tactics game whose identity is the
**expedition** — *preparation under uncertainty*: you commit scarce resources
(material, spatial, informational) against an unknown fight, then live with it, and
combat is the **test** of that preparation. The signature **non-combat jobs** (chef,
survivalist, merchant, …) are one vivid expression of that identity. Built on a
pure-logic core that can later wrap to Steam and mobile without a rewrite.

> **Framing note (D45):** the identity language was refined from "non-combat jobs"
> → "logistics" → "the expedition." This is a framing refinement only — it
> supersedes no decision and the milestones below are unchanged.

## Non-scope

- **No Steam/mobile builds in this phase.** The architecture keeps them possible
  (Tauri/Electron for desktop, Capacitor for mobile); the wrappers are a later
  phase, not this one.
- **No multiplayer.**
- **No final art or audio.** Placeholder / CC0 isometric tiles only; no music or
  sound system yet.
- **Not a content-complete job roster.** Three signature jobs prove the pattern;
  a full roster comes later.
- **No meta-narrative / story mode.** Systems first.

## Milestones

Each milestone is ordered, independently shippable, and carries an inline
USER-TESTABLE GATE. A milestone stays "in progress" until tests are green AND
the gate is met. This is a web game, so every gate is a page or button you can
exercise in the browser.

### M1 — Walking skeleton (Vite + Phaser + TypeScript, core/render split)

- Stand up the project: Vite + TypeScript + Phaser 3, plus Vitest for the core.
- Establish the load-bearing separation: a pure-logic `core/` (no Phaser, no DOM)
  and a `game/` render layer that draws it. This is what keeps Steam/mobile open
  and makes the core headlessly testable.
- **User-testable gate:** `npm run dev` serves a page showing a blank isometric
  scene (a few tiles render); `npm test` runs and a trivial `core` test passes.

### M2 — Isometric grid + a unit that moves

- core: tile-grid model, iso/grid coordinate math, A* pathfinding (pure,
  unit-tested). render: draw the iso grid, place one unit, click-to-move.
- **User-testable gate:** open the page, click a tile, and the unit walks to it
  along a valid path; pathfinding tests are green.

### M3 — Turn-based battle loop (two sides, basic attack) — *done (in-browser gate confirmed 2026-06-05)*

- core: the **FFT-style CT clock** action economy (per-unit CT rises by Speed,
  turn at CT≥100, Move + Act; charged-ability scaffolding) per **D5**; a
  **trigger/event bus + field-entity registry** built *before any entity exists*
  per **D4**; attack/damage; win/lose detection. render: an End Turn / advance-clock
  control; a basic enemy AI takes its turn.
- **User-testable gate:** play a tiny skirmish to victory or defeat in the
  browser; CT-order, damage, and trigger-bus tests are green.
- See [`docs/design/03-combat.md`](../../docs/design/03-combat.md),
  [`action-economy.md`](../../docs/design/systems/action-economy.md),
  [`field-entities.md`](../../docs/design/systems/field-entities.md).

### M4 — Data-driven jobs & skills + the phase pipeline — *done (in-browser gate confirmed 2026-06-05)*

- core: define jobs and skills as **data** (not hard-coded classes); introduce
  the phase pipeline **Meta → Deployment → Battle → Resolution**. Ship one combat
  job (e.g. Soldier) with a skill that hooks the Battle phase.
- **User-testable gate:** a unit's job/skill is defined purely in a data file and
  visibly affects battle (a skill button appears and works); job-loading tests
  are green.

### M5 — The signature non-combat jobs (the hook) — *done (in-browser gate confirmed 2026-06-05)*

- Implement the three jobs that make this game itself, each deliberately hooking
  a *different* phase to prove the architecture:
  - **Chef** → Meta/camp phase: party morale + between-battle healing buff.
  - **Survivalist** → Deployment phase: place a trap on the map before battle.
  - **Merchant** → Meta/economy: increase storage size and generate gold.
- **User-testable gate:** in the browser, run a mini-loop — Merchant adds
  gold/storage in camp, the Chef buff is applied to the party, and a
  Survivalist-placed trap triggers during the following battle. Each job's effect
  has a green test.

### M5b — Logistics pillar & the Deployment gamble (adjustment, per D6/D7) — *done: gate confirmed in-browser 2026-06-05 (inventory/exposure-capture/seed/recovery + on-board deploy + auto-rescue D21); D9-RP & D10-intel deferred to M6*

- *Adjustment (not a pivot): the north star is unchanged; this deepens the prep
  loop the signature jobs act on, making logistics a headline pillar.*
- core: a first-class **inventory/materials model** (storage cap, ammo, materials,
  rations) per **D6**; the **provisioning constraint** linking Meta → Deployment
  (place only what was carried; carry only what storage allows); **Deployment as a
  per-unit push-your-luck gamble** per **D7** (transparent exposure meter, safe
  allowance → overdraw, capture as a rescuable on-map sub-objective, initiative
  seeding from deployed non-captured units); material **recovery in Resolution**.
  render: a Meta loadout/world-menu screen and an on-map Deployment screen with the
  exposure meter.
- **User-testable gate:** in the browser, provision a loadout under a storage cap,
  enter Deployment and over-prep a unit into the overdraw zone until it's captured,
  then in the following battle rescue it and recover an unsprung material in
  Resolution. Inventory, exposure/capture, initiative-seed, and recovery tests are
  green.
- Also lands the camp consequence systems (D8/D9): **morale** (passive tiered
  modifiers) and **between-night recovery** (Rest-Point triage healing + cleric
  revive as an economy sink); and the **intel system** (D10): banded tiers and the
  three lanes (Intelligence stat floor / scouting / the Seer's divination), feeding
  the provisioning decision.
- See [`docs/design/systems/logistics.md`](../../docs/design/systems/logistics.md),
  [`01-pre-deployment.md`](../../docs/design/01-pre-deployment.md),
  [`02-deployment.md`](../../docs/design/02-deployment.md),
  [`04-resolution.md`](../../docs/design/04-resolution.md),
  [`systems/morale.md`](../../docs/design/systems/morale.md),
  [`systems/mortality-recovery.md`](../../docs/design/systems/mortality-recovery.md).

### M6 — Roguelike run loop (seeded procedural encounters, permadeath, meta) — *done (in-browser gate confirmed 2026-06-05)*

- core: seeded RNG, procedural encounter/map generation, run state, permadeath,
  a between-battle camp where the non-combat jobs act, and the **difficulty
  consequence policy** (D9) governing downed/captured units (dying timer, ½-HP
  redeploy, rescue follow-up quests as reduced-Deployment battles). render: drive a
  full run Camp → Deployment → Battle → Resolution → next, until death.
- **User-testable gate:** start a seeded run, play several encounters using the
  jobs, die, and see the run end; replaying the same seed reproduces the run;
  generation and run-state tests are green.

### M7 — The overworld (seeded branching run map) — *done (gate confirmed 2026-06-05; terminal-ending **design** deferred — endings ship functional, their meaning/rewards revisited next)*

- *Adjustment (not a pivot): the north star is unchanged; this replaces the linear
  encounter chain with a navigable **run frame** the existing loop plays through.*
- core: `overworld.ts` — pure, **seed-driven** map generation (`streamFor(seed,
  "map")`): a layered node **DAG** of `MapNode`s (`id`, `layer`, `kind:
  "combat" | "rest"`, forward `edges`), per **D22**; reachability/edge helpers; and
  `nodeEncounter` deriving a combat node's encounter via `streamFor(seed,
  "node:<id>")` so `generation.ts` is reused unchanged (layer = difficulty index).
  `run.ts` swaps the linear `encounterIndex` for **map position** (`mapNodeId` +
  the chosen `path`), adds `reachableNodes`/`chooseNode`, keeps permadeath/RNG/camp,
  and adds a **run-complete** terminal for clearing the final layer. `runloop.ts`
  gains an overworld step (present map → choose → play a **combat** node through
  Camp→…→Resolution, **or** a **rest** node recovery with no battle, D23) plus an
  `autoTraverse` headless helper. `intel.ts` adds `previewNode` — a **banded node
  preview** (kind + intel-gated type/count/reward hint) for the selection screen
  (**D24**).
- render: an **overworld map screen** (draw the layered graph + forward edges,
  highlight reachable nodes, show each candidate's intel preview, commit a choice);
  hand a combat node to the existing BattleScene flow; show a **rest** recovery
  screen; return to the map between nodes; add a **run-complete** screen alongside
  the M6 run-end/seed screen.
- **User-testable gate:** `npm run dev` → start a seeded run, see the overworld
  map, choose among reachable nodes (intel preview visible), play a node to
  resolution, return to the map, take a **rest** node to recover, continue, and
  either reach a final node (**run complete**) or die (**run end**). Replaying the
  same seed reproduces the **same map** (layout, node kinds, each node's
  encounter/rewards) and the same reachable choices. Overworld-generation
  determinism, map-structure (reachability/edges), node-select/advance,
  permadeath-through-the-map, and same-seed-replay tests are green.
- See [`docs/design/systems/overworld.md`](../../docs/design/systems/overworld.md)
  (D22–D24), referenced from [`docs/design/README.md`](../../docs/design/README.md).

### M8 — The overworld action economy (camp at every node + cooldown spine + loose fatigue) — *done (prototype; numbers/behavior to tune later)*

- *Adjustment (not a pivot): the north star is unchanged; this builds out the overworld
  M7 shipped as a **frame** into a true **second hook surface** (the twin of the combat
  tier), per the post-M7 design batch.* It is the first of three milestones that build
  decisions **D25–D35** (M9 = the guild & caravan tier; M10 = the gold economy &
  recruitment).
- core: an **overworld-ability** model — data declaring a **cost** (a node-step
  `cooldown`, a `fatigue` spend, optional gold) — plus a registry + a resolver that
  gates an action on cooldown **and** fatigue, applies its effect, then arms the
  cooldown (**D29/D35**). **Cooldowns are the spine**: per-ability, measured in
  **node-steps** (the tick), ticked down as the caravan advances. A new **`fatigue.ts`**:
  a **per-character, loose over-extension guardrail** in the codebase's shallow
  asymmetric-floor shape (generous allowance, invisible in normal play, bites only when
  you greedily skip rest), **restored at rest nodes**, **overworld-only** (never touches
  the CT clock / combat). `RunLoop` reshapes so arriving at **any** node opens **one
  unified overworld camp** (the old **Meta phase folds in**): take overworld actions,
  then **commit** — a combat node → Deployment+Battle, a rest node → recovery + fatigue
  restore. Prove the spine with ≥2 real abilities reusing existing systems (e.g. **Scout**
  → raises a reachable node's `previewNode` tier via [intel](../../src/core/intel.ts);
  **Market** → the Merchant's gold/provision access, reframed as an overworld action).
- render: `OverworldScene` gains the **camp panel** at every node (action buttons showing
  cooldown + fatigue readouts), a **per-character fatigue meter**, and the **commit** flow
  into Battle/rest. The separate Meta-phase screen is **removed** (folded into the camp).
- **User-testable gate:** `npm run dev` → on a seeded run, arriving at any node opens the
  unified camp; fire an overworld action and watch it **grey out for N node-steps**
  (cooldown) and **spend fatigue**; push deep skipping rest until **fatigue bites**; take
  a **rest** node and watch fatigue **restore**; **commit** at a combat node into the
  existing Deployment→Battle→Resolution and return to the map. Replaying the seed
  reproduces the same map + the same action/cooldown/fatigue outcomes for the same
  choices. Cooldown-tick, fatigue-curve (loose floor + restore), and unified-camp
  orchestration tests are green; `core/` stays free of Phaser/DOM **and** `Math.random`.
- See [`docs/design/systems/overworld.md`](../../docs/design/systems/overworld.md)
  (D29/D35, "The overworld action economy"),
  [`docs/design/systems/stats.md`](../../docs/design/systems/stats.md) (Fatigue), and the
  kickoff brief [`M8-kickoff.md`](M8-kickoff.md).

### M9 — The guild & caravan tier (run.ts → a Guild of N runs) — *testable (code complete 2026-06-06; awaiting in-browser gate)*

- *Adjustment (not a pivot): the north star is unchanged; this reshapes the **container**
  around the run. Through M8 the run is the top tier (`run.ts` holds exactly one map +
  position); M9 lifts it into a persistent **guild** (D25–D27) — the run becomes **one
  caravan's adventure** and the guild owns several.* It is the second of three milestones
  building the post-M7 batch (M8 = the overworld action economy; **M9 = this**; M10 = the
  gold economy & recruitment).
- core: `caravan.ts` — a **`VesselType`** (data: capacity/storage/speed/cost) + a
  **`Caravan`** bundling the four committed scarcities (**uniform** party slots, per-caravan
  storage, loaded supplies, **locked gear**, a **purse**) with the cross-caravan **lock**
  (a person/gear can't ride two caravans, **D25/D26**). `guild.ts` — a **`Guild` owning N
  `RunState`s** (**D26**): a shared roster pool, an armory, a **pure treasury** (**D34**), a
  stable of caravans, and a **never-empty quest board** (main quest + a repeating generated
  sidequest stream). `dispatch` builds a deterministic run from a caravan targeting the
  quest's seed and **locks** it out of the pool; `resolveReturn` reads the run terminal — a
  **return** flows survivors/gear/purse home, a **wipe** costs that caravan's people
  (permadeath) + gear + purse while the **guild survives** (**D27**); `hireMercenary` is the
  "never hard-fails" rebuild valve. `run.ts` gains `createRunFromCaravan` (the options
  overload kept for tests). `leveling.ts` — the **D32 thin seam** (per-character level/XP;
  "deployed grows, benched doesn't"). **Model C** (**D26**): commitment parallel, **play
  serial** — no background clock, no auto-resolve.
- render: a new **`GuildScene`** (the app's new entry point): roster pool, armory, treasury,
  quest board, a **caravan-assembly panel** (pick a vessel, fill uniform slots, lock gear,
  set the purse via a treasury→purse stepper) → **Dispatch**, and a **stable** with each
  caravan's status + a **Play** on in-flight ones. `OverworldScene` becomes **one caravan's
  run** (dispatched in from the guild; on a terminal it returns to the hall, which resolves
  the return/wipe and surfaces the result). Kept visually distinct from the hall (D25/D35).
- **User-testable gate:** `npm run dev` → the **guild hall** opens (shared roster + armory +
  treasury + a never-empty board). Assemble **≥2 caravans** for different quests (uniform
  slots: the Chef costs a fighter; committing people + gear + a purse **locks** them out of
  a second caravan). Dispatch both; **play one** through its overworld to a terminal (the
  M7/M8 flow runs unchanged) while the other **waits** (no tick, no auto-resolve). A **wipe**
  removes that caravan's people (permadeath) + loses its gear, the guild persists (rebuild
  via a cheap merc hire); a **return** rejoins survivors, unlocks gear, flows the surviving
  purse to the treasury. Replaying the **guild seed** + same dispatch choices reproduces
  every caravan's run. `npm test` green (caravan, guild dispatch/serial-play/wipe-return,
  determinism, leveling); `npm run build` clean; `core/` free of Phaser/DOM **and**
  `Math.random`.
- See [`docs/design/systems/guild.md`](../../docs/design/systems/guild.md) (D25–D27, D32,
  D34) and the kickoff brief [`M9-kickoff.md`](M9-kickoff.md).

### M10 — The gold economy & recruitment (the two-pool economy gets verbs + a refreshing roster) — *testable (code complete 2026-06-07; awaiting in-browser gate)*

- *Adjustment (not a pivot): the north star is unchanged; this fills M9's structural
  treasury↔purse plumbing with **faucets and sinks**, and fills the roster pool with
  **sources**.* It is the last of the post-M7 batch (M8 = the overworld action economy;
  M9 = the guild tier; **M10 = this**), building **D28/D30/D33/D34**.
- **Scope call (kept as one milestone, not split into M10/M10b):** the economy verbs +
  theft *and* recruitment landed together — the recruitment loop leans on the Noble's
  bribe verb (D33's mid-combat vector), so splitting would have cut a seam mid-feature.
- core: **`economy.ts`** — the two-pool routing + faucet/sink ledger: `gainRunGold`
  (loot → **purse**, auto-repaying Banker debt first), `routePayoutToTreasury` (quest
  payout → **treasury**, the vault's only earned faucet), `payTreasuryUpkeep` (Upkeep =
  the treasury-side sink), and **Influence** — a purpose-bound currency on the guild
  (`addInfluence`/`spendInfluence`) that can **never** pay Upkeep or buy gear (D34).
  **`economy-actions.ts`** — the three verbs as data + resolvers: **Merchant ACCESS**
  (purse-funded field buys, node-tier-gated price — town/rest cheaper than the wild),
  **Banker TIME-SHIFT + SECURE** (purse interest accruing on the node-step tick,
  buy-on-debt auto-repaid from incoming gold, theft protection) — **purse-only, never
  the treasury** — and **Noble INFLUENCE** (political income → Influence; a bribe that
  reads the D24 preview for its price). **`theft.ts`** — the active sink: a thief
  **enemy archetype** (`generation.ts` `ENEMY_TEMPLATES`) that skims the purse and can
  flee off-map (kill-to-recover / escaped-keeps-it, D13/D21), a thief **event node** (new
  `NodeKind "event"` in `overworld.ts`), both **blunted by Banker protection**.
  **`recruitment.ts`** — a refreshing, seeded **mercenary pool** at the hall
  (`refreshMercPool`/`hireFromPool`, treasury-debited) beyond the single rebuild valve,
  plus the mid-combat bribe/rescue → roster vector: the **temp(generic)↔permanent
  (authored)** flag (the whole new rule, D33; the authored-cast *data shape* stays a
  deferred typed seam). Loot now routes through `gainRunGold` in `runloop.resolve`;
  purse interest accrues in `run.recordNight`; quest **payouts** flow to the treasury in
  `guild.resolveReturn`.
- render: `GuildScene` surfaces **Treasury vs. Influence** in the header, a **refreshing
  merc pool** (hire several) + a treasury-funded **armory buy**, and the **payout** on a
  return. `OverworldScene`'s camp gains the **economy verbs** (Merchant buy, Banker
  interest/debt/protect, Noble income) with live purse/debt/protection/Influence
  readouts, and the **thief event node** ($-glyph, purple) surfaced like rest. `BattleScene`
  gets the **thief that skims the purse** (kill-to-recover / flees-off-map, surfaced in
  Resolution) and a **mid-combat Bribe** (guild Influence) that flips an enemy
  (temp generic / permanent authored → joins the roster).
- **User-testable gate:** `npm run dev` → quest **payouts grow the treasury** (the only
  faucet that does), **loot fills the purse**; the **Merchant/Banker/Noble** each have
  their one verb (Influence never pays Upkeep, the Banker never touches the treasury); a
  **thief steals the purse** and can be **killed-to-recover** or **flee with it**, blunted
  by **Banker protection**; the hall offers a **refreshing merc pool** and the
  **bribe/rescue → roster** vector works (temp generic / permanent authored); replaying a
  guild seed + the same choices reproduces every number. `npm test` green (economy
  faucets/sinks + two-pool routing, Banker interest/debt/protect, Noble influence/bribe,
  theft steal/recover, recruitment pool + temp↔perm); `npm run build` clean; `core/` free
  of Phaser/DOM **and** `Math.random`.
- See [`docs/design/systems/logistics.md`](../../docs/design/systems/logistics.md)
  (D28/D30/D34, the economy) and
  [`docs/design/systems/guild.md`](../../docs/design/systems/guild.md) (D33 recruitment,
  D34 two pools + Influence).

### M11 — The event-node batch (shops · recruiters · story events) — *done (in-browser gate confirmed 2026-06-07; merged PR #12)*

- *Adjustment (not a pivot): the north star is unchanged; this turns the overworld's third
  node tier (`event`, M10) from a single hard-coded thief into a **data-driven event
  registry**.* It is D23's named "next batch" (shops/merchants-as-nodes, recruitment, event
  nodes, narrative), built additively on M10's machinery — no new economy, no change to the
  tactical core or the guild tier.
- core: **`node-events.ts`** — the registry + one resolver (D4). An `EventKind`
  (`thief | shop | recruiter | story`) + an `EventDef` (`id`, `kind`, `name`, `teaser`,
  `weight`, an `autoResolve(run, node)` for the headless path) + an `EVENTS` registry +
  `getEvent`. **`eventForNode(seed, node)`** is a **deterministic weighted pick** from
  `streamFor(seed, "event:<nodeId>")` so each event node has a **stable** event for a seed
  (D22). One interpreter — `resolveEvent` (headless auto), `eventChoices`/`chooseEventOption`
  (interactive) — drives them, returning a structured `EventOutcome`. Four events, each
  **reusing M10**: **thief** folds the M10 skim into a record
  ([`theft.thiefEventSkim`](../../src/core/theft.ts)); **shop** offers a seeded stock bought
  from the **purse** into storage via the Merchant verb
  ([`merchantBuy`/`merchantPrice`](../../src/core/economy-actions.ts)), node-tier priced,
  under the storage cap (D6), never the treasury (D34); **recruiter** rolls a body
  ([`rollMercenary`](../../src/core/guild.ts)) hired for purse gold who joins `run.party`
  (honoring the temp↔permanent flag, D33); **story** is an authored-as-data 2-option choice
  with deterministic seeded outcomes (gold/morale/fatigue/material). `runloop.eventNode()`
  becomes a **dispatcher** over `eventForNode` (auto-resolving for the headless path) +
  `eventChoices()`/`chooseEvent()`/`recordEventNight()` for the render; `intel.previewNode`'s
  event branch shows the picked event's **banded teaser** (D24); exported via `core/index.ts`.
- render: `OverworldScene` opens an **event screen dispatched by kind** — shop (buy buttons
  spending the purse + a Leave), recruiter (the offered body + Hire/Decline), story (the
  prompt + choice buttons → outcome), thief (the existing skim/recover result). Distinct
  glyphs/tints per event kind on the map ($ thief · ⚖ shop · ✚ recruiter · ? story) + the
  banded teaser on the preview.
- **User-testable gate:** `npm run dev` → a seeded run's event nodes present a **shop**
  (spend purse for supplies), a **recruiter** (hire a body for purse), a **story choice**
  (pick → deterministic outcome), and the **thief** (skim / kill-to-recover / flee, blunted
  by Banker protection); replaying the seed + same choices reproduces which event fires and
  every number. `npm test` green (event-pick determinism, shop/recruiter/story resolvers,
  thief regression, the registry is data); `npm run build` clean; `core/` free of Phaser/DOM
  **and** `Math.random`.
- See [`docs/design/systems/overworld.md`](../../docs/design/systems/overworld.md) (D22–D24
  node types / preview) and [`decisions.md`](decisions.md) (D23 the named "next batch", D4
  data + resolver, D30/D33/D34 reuse).

### M12 — Combat depth, the class slice & the demo-quest proof — *done (in-browser gate confirmed 2026-06-08; D36–D44; 325 tests green)*

- *Adjustment (not a pivot): the north star is unchanged; M1–M11 built the systems wide
  but content-thin. M12 is the first slice aimed squarely at **fun** — a small class roster
  that forces the surrounding combat depth into existence, proven by a hand-crafted demo
  quest.* Full design: [`M12-kickoff.md`](M12-kickoff.md); decisions **D36–D44**; build
  kickoff [`M12-build-prompt.md`](M12-build-prompt.md).
- **Combat slice (core, all pure/headless):** **flanking** (support/pincer positional
  damage, D36); the **time-based ability economy** (charge-time spine + channels + sparing
  cooldowns + the Act tax, D37, extending the unused D5 `ScheduledEffect`); the **status
  set with teeth** (Slowed/Exposed/Immobilized/Hastened/Guarded, classifier-driven, D41) +
  a **universal Defend**; **four classes** (Heavy Knight / Hunter / Scout / Medic — 2
  active + 1 passive, synergy-first, the combat↔logistics bridge, D40); the **dissolved job
  model** (D38) + **hybrid leveling** (character + per-job axes, permanent cumulative stat
  gains, ability scaling, unlock breakpoints, D39 — fixes the inert `level`); and the
  **scoring AI** (ranged / flank / tarpit / target-priority + enemy abilities +
  charge-interrupt + fog-respecting, D42). **Graded failure** (objective-fail ≠ wipe, D43).
- **Demo quest (the proof, D44):** an **authoring substrate** (`AuthoredEncounter` /
  `AuthoredQuest` + a demo runner — fills gap #4) and **"The Hollow Mill"**, a 5-beat
  standalone authored quest (Provision → Skirmish → Rest/Level-up → Ambush at the
  chokepoint → Captain's Holdout) tuned so every M12 decision has a visible moment.
- render: the four kits as data-driven buttons (charge/channel/cooldown readouts), **status
  visual trackers** (icon/tint/tooltip), the level-up/unlock surfacing, the demo-mode entry
  + beat runner, and the bridge-cut timer in Encounter 3.
- **User-testable gate:** `npm run dev` → enter **demo mode**, play *The Hollow Mill* end
  to end: provision herbs under the cap; in E1 isolate-and-flank a straggler and weather a
  kiting archer; at the rest beat **see stat gains + a 2nd-active unlock** and make the
  deserter choice; in E2 tarpit the chokepoint, **cleanse a snare with an antidote**, land
  the Dash→Expose→Mark-Prey→Deadeye combo, and have scouting matter; in E3 **race the
  bridge-cut timer** and beat the Captain — or **fail the objective and retreat alive**
  (not a wipe). Replaying reproduces the authored beats. `npm test` green (flanking,
  ability economy, statuses, leveling, scoring AI, authored encounters); `npm run build`
  clean; `core/` free of Phaser/DOM **and** `Math.random`.
- See [`M12-kickoff.md`](M12-kickoff.md) and [`decisions.md`](decisions.md) (D36–D44).

## Notes

- Pivot = revise Goal + supersede affected decisions (see decisions.md).
- Adjustment = add a new milestone, leave Goal untouched.
- The Steam/mobile wrappers (Tauri/Electron, Capacitor) are deliberately a
  *post-M6* adjustment: once the core proves portable, wrapping it is additive.
