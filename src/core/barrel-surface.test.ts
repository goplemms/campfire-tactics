/**
 * R3 (#119/#120/#121/#127/#128/#129/#130) — the barrel-surface characterization pin.
 *
 * R3 is **pure code motion**: symbols move between modules but the public surface
 * of the core barrel (`src/core/index.ts`) must not silently change. A split may
 * only **ADD** names (a new free function like `deepRest`, a new helper like
 * `registerEvent`); an alias deletion **REMOVES** a named symbol; a rename is an
 * add + a remove. Each such delta must be **intentional and reviewed** — this test
 * freezes the sorted runtime export-name list so any unplanned change to the
 * surface fails loudly, by name.
 *
 * When this test fails: confirm the delta is exactly what the current increment
 * intends (the commit body names it), then update `EXPECTED_BARREL_SURFACE`
 * in the same commit.
 *
 * Note: this pins the **runtime** exports (values, functions, classes, consts) via
 * `Object.keys` — type-only re-exports do not appear here (a type rename is
 * compiler-enforced elsewhere). Pure logic: no Phaser, no DOM.
 *
 * Recorded at increment 0 (2026-07-09): 615 names, sim digest byte-identical to
 * the reference in `r2-verb-gate.test.ts`'s header (1050 tests / 98 files green).
 *
 * Deltas:
 *   - increment 1 (#128 part A): −5 dead aliases removed — `grantCombatXp`,
 *     `scout`, `seerDivine`, `useCampJobSkill`, `useCampSkillAtNode` (→ 610).
 *   - increment 2 (#119, node-events split): +3 — `emptyOutcome` and
 *     `INFLUENCE_ORDER` exported from node-events for the new sibling modules
 *     (`stories.ts`, `early-events.ts`, `hollow-mill-events.ts`), and
 *     `HOLLOW_MILL_EVENTS` (the authored-record array registered via
 *     `registerEvent`). The moved story/early-event symbols keep the same barrel
 *     names, just new module homes (→ 613).
 *   - increment 3 (#120, recovery extraction): +2 — `deepRest` and `inPlaceRest`
 *     free functions in the new `recovery.ts` (the recovery economy lifted out of
 *     `RunLoop`); `REST` moved from runloop.ts to recovery.ts, same barrel name (→ 615).
 *   - increment 4 (#129, overworld-actions split): net 0 — the state API moved to
 *     `overworld-state.ts`, the cost grammar + gate + validator to `overworld-cost.ts`,
 *     and `triage`/`TRIAGE`/`TRIAGE_COST`/`isHealer` to `economy-actions.ts` beside the
 *     other economy verbs; every symbol keeps its barrel name at its new home (615).
 *   - increment 5 (#130, jobs split): net 0 — the combat roster moved to
 *     `jobs-data/combat.ts`, the Scout prestige line to `jobs-data/scout-line.ts`,
 *     and the support/economy classes + universal skills to `jobs-data/support.ts`;
 *     `jobs.ts` keeps the engine (`JOBS`/`SKILLS`/capabilities). Every symbol keeps
 *     its barrel name at its new home (615).
 *   - increment 6 (#121, turn split): net 0 — the undo substrate moved to
 *     `battle-undo.ts` (`snapshotUnit`/`restoreUnit` + the checkpoint machinery),
 *     the replay driver + `planActions` to `battle-replay.ts`, and the roster-aware
 *     resolvers to `field-effects.ts`. `Battle` stays in `turn.ts`, which re-exports
 *     `snapshotUnit`/`restoreUnit`/`replay` so the public surface is unchanged; the
 *     new modules' internal helpers (`captureCheckpoint`, `planActions`,
 *     `resolveShove`, …) are not surfaced (615).
 *   - increment 7 (#127, predicate-on-node seam): +1 — `evalPredicateRun`, the
 *     unit-less `grants.ts` evaluator `run.ts`'s `nodeAccessible` reads the new
 *     `MapNode.blockedWhen` access data through. The `securedWagon × medic-freed`
 *     rule is now authored data in `hollow-mill.ts`; the `flagSet` Predicate leaf +
 *     `blockedWhen` field are type-only (not runtime surface) (→ 616).
 *   - increment 8 (#128 part B, renames): net 0 — the ten bare job constants
 *     unify on the `*_JOB` convention: `SOLDIER`→`SOLDIER_JOB`,
 *     `HEAVY_KNIGHT`→`HEAVY_KNIGHT_JOB`, `HUNTER`→`HUNTER_JOB`,
 *     `MEDIC`→`MEDIC_JOB`, `SNARE_TRAPPER`→`SNARE_TRAPPER_JOB`,
 *     `COOK`→`COOK_JOB`, `MERCHANT`→`MERCHANT_JOB`, `NOBLE`→`NOBLE_JOB`,
 *     `BANKER`→`BANKER_JOB`, `SURVIVALIST`→`SURVIVALIST_JOB` (−10 +10). The other
 *     renames are not runtime-surface: `events.ts`→`event-bus.ts` (module file;
 *     `EventBus` etc. keep their names), `EncounterRecord`→`NightRecord` and
 *     `OverworldEconomy`→`OverworldState` (types), `Battle.runEnemyTurn`→
 *     `runPolicyTurn` (a method). Still 616.
 *   - increment 9 (#128 part C, stranded helpers): net 0 — `describeUnit` (was in
 *     `node-events.ts`) and `jobPresenceSummary` (was in `jobs.ts`) move to
 *     `dossier.ts` beside the other read-only projections; both keep their barrel
 *     names at the new home (616).
 *
 * R4 batch-1 deltas (#113 — the cost grammar):
 *   - increment 3 (material prices): +1 — `canAffordMaterial` (inventory.ts), the core
 *     availability projection deriving a "0 herbs / 0 kits" greyed state from a skill's
 *     declared material price (→ 617). The `cost.ts` grammar (`Cost`/`CostPrice`/
 *     `ClockDomain`/`MaterialCost`) and the `SkillCost`/`OverworldCost` views are all
 *     type-only (not runtime surface).
 *   - increment 4 (#123 — SkillDef.phase retires): −1 — `unlockedSkills` deleted (its callers
 *     migrated to `availableSkills`, the one authoritative surfacing projection); `unitSkills`
 *     keeps its name (signature dropped the `phase` param). The `Phase` type is deleted too
 *
 * R4 batch-2 deltas (#112 — the economy-verb migration):
 *   - increment 5 (effect kinds + handlers): +10 — the post-gate effect **cores** each economy
 *     verb shares with the new `OVERWORLD_EFFECT_HANDLERS` entries (`applyBuyEffect`,
 *     `applySellEffect`, `applyBorrowEffect`, `applyEngageInterestEffect`, `applyGuardPurseEffect`,
 *     `applyPatronizeEffect`, `applyTriageEffect`, `applyTriageFallbackEffect`), the Triage target
 *     selector `mostWoundedFielded`, and the `buyPriceFor` Savvy-Barter price helper. The new
 *     `OverworldActionEffect` variants (sell/borrow/…/buy/triage) are type-only (not runtime).
 *   - increment 6 (Merchant sell + Banker verbs → SkillDefs): net 0 — +4 SkillDefs
 *     (`MERCHANT_SELL`, `BANKER_INTEREST`, `BANKER_BORROW`, `BANKER_GUARD` on their jobs),
 *     −4 dissolved cost consts (`MERCHANT_SELL_COST`, `BANKER_INTEREST_COST`,
 *     `BANKER_BORROW_COST`, `BANKER_PROTECT_COST` — their rows folded into the SkillDefs).
 *   - increment 7 (Noble patronize → SkillDef + bribe onto the Influence knob): net 0 —
 *     +1 `NOBLE_PATRONIZE` (on the Noble), −1 `PATRONIZE_COST` (row folded in). `bribeEnemy`
 *     keeps its name (its Influence spend now rides the shared gate's `influence` knob).
 *   - increment 8 (triage + universal buy): +6 −2 (net +4) — +`MEDIC_TRIAGE` (full-strength
 *     Triage on the Medic), +`UNIVERSAL_BUY` / +`TRIAGE_FALLBACK` / +`UNIVERSAL_OVERWORLD_SKILLS`
 *     (the universal overworld home), + the cost-provider bodies `merchantBuyGold` /
 *     `triageFallbackRp`; −`MERCHANT_BUY_COST` (→ `merchantBuyGold` fn) and −`TRIAGE_COST`
 *     (folded into `MEDIC_TRIAGE`). `VERB_COSTS` is now empty (retires in increment 9).
 *   - increment 9 (VERB_COSTS retires): −1 — the emptied `VERB_COSTS` registry is deleted along
 *     with its module-load walk; the D88 guard inverts to prove the absence of standalone verbs.
 *     (type-only, not runtime surface) (→ 616).
 *
 * Structural-audit delta (D114 — 2026-07-20): +1 — `saltSeed` (`rng.ts`), the one home for
 *   the `seed#label` child-seed join (battle salt, quest/recruit seeds); the four hand-rolled
 *   joins migrated onto it byte-identically. Sim digest unchanged.
 *
 * Scenario-harness deltas (#170 — the visual scenario harness):
 *   - increment 1 (buildScenarioRun + the registry): +7 — `buildScenarioRun` and
 *     `DEFAULT_SCENARIO_GOLD` (`scenario.ts`, the synthetic-one-node-run builder), the
 *     registry `SCENARIOS` / `getScenario` / `listScenarios` (`scenarios/index.ts`), and the
 *     first entry's data `PICK_THE_CELL` / `PICK_THE_CELL_ENCOUNTER` (`scenarios/pick-the-cell.ts`,
 *     the taste fixture promoted out of `taste-infiltration.test.ts`). `ScenarioConfig` is
 *     type-only (not runtime surface). No registration at import (R3), so the sim digest is
 *     unchanged.
 *
 * Wave-0 topology deltas (#168 — the back-half map):
 *   - PR-1 (the Thief mentor two-beat, C7): +2 — `THIEVES_GUILD_CONTACT` / `THIEVES_GUILD_RITE`
 *     (`stories.ts`): the shipped single `thieves-guild` offer (an inline `PRESTIGE_OFFERS`
 *     member, never a named export) splits into the arm-early contact + fire-later rite, now
 *     named so the pinned `guild-contact` / `guild-rite` surfacing events can bind them. The
 *     new `StoryOutcomeSpec.jobXp` field + `pinnedStoryEvent` helper are type-only / module-
 *     private (not runtime surface). No registration change to the seeded pool → sim digest
 *     unchanged.
 *   - PR-2 (the topology rewrite): +1 net — +`OUTER_YARD` / +`CUFFED_CELL` (the two new
 *     infiltration-arm encounters in `hollow-mill.ts`), −`SECURED_WAGON` (the Medic catch-up,
 *     deleted — no catch-up on the Thief arm, C8). `CAPTIVE_PRISONER` is module-private.
 *
 * Interactable gates deltas (D103 — the prison-break substrate):
 *   - gate core (Phase 1): +8 — `makeGate` / `openGate` / `openGateOnGrid` / `applyGatesToGrid` /
 *     `canLockpickGate` / `lockpickableGates` / `gatesOpenedByDeath` (`gates.ts`, the locked-tile
 *     enclosure + the lockpick/keyholder open interpreters), and `matchesTag` (promoted from
 *     module-private in `objectives.ts` so the keyholder lock reuses the one tag matcher). `Gate` /
 *     `GateLock` are type-only. `TileGrid.setWalkable` is a method, not a barrel export. No
 *     registration at import → sim digest unchanged.
 *   - gate wiring (Phase 2a): +1 — `buildAuthoredGates` (`authored.ts`, inflate the authored
 *     `gates` field into live `Gate`s at staging). `AuthoredGate` + the `openGate` action + the
 *     `gateOpened` event + `Battle.gates`/`openGate` are type-only / methods (not runtime surface).
 *   - gate render (Phase 2b): +3 — `MICRO_GATE_LOCKPICK` / `MICRO_GATE_KEYHOLDER` / `MICRO_SCENARIOS`
*     (`scenarios/micro.ts`, the micro-interaction gallery registered in `SCENARIOS` — D104). The
 *     `ICON.gate` glyph + the scene's Pick-Cell verb / markGates render are `game/` (not core surface).
 *     (The transient `JAILBREAK` / `JAILBREAK_ENCOUNTER` showcase this replaced was never merged.)
 *   - gate destructible (Phase 3): +5 — `isBreakable` / `canAttackGate` / `breakableGates` / `damageGate`
 *     (`gates.ts`, the door-durability interpreters) + `MICRO_GATE_DESTRUCTIBLE` (`scenarios/micro.ts`, the
 *     batter-a-door fixture). The `attackGate` action + the `gateDamaged` event + `Gate.hp`/`maxHp` +
 *     `Battle.attackGate` + the scene's Break-Gate verb are type-only / methods (not runtime surface).
 *   - gate AI target (Phase 3): +1 — `MICRO_GATE_ENEMY_BATTER` (`scenarios/micro.ts`, the walled-off-guard
 *     fixture). The `AIPlan.gateTarget` / `AIOptions.gates` / `AI.doorBreak` door-targeting seam is
 *     type-only / a weight (not runtime surface).
 *   - gate lever (Phase 3): +6 — `makeLever` / `lockGateOnGrid` / `canPullLever` / `pullableLevers`
 *     (`gates.ts`, the pull-switch seal) + `buildAuthoredLevers` (`authored.ts`) + `MICRO_LEVER_SEAL`
 *     (`scenarios/micro.ts`, the slam-a-door-shut fixture). `Lever` / `AuthoredLever` / the `pullLever`
 *     action / the `gateLocked` event / `Battle.pullLever` / the scene's Pull-Lever verb are type-only /
 *     methods (not runtime surface).
 *   - gate destroyed / remnant (D106): +2 — `destroyGateOnGrid` (`gates.ts`, the smash-to-a-permanent-
 *     passable-remnant terminal state — the lever can never re-seal it) + `MICRO_GATE_REMNANT`
 *     (`scenarios/micro.ts`, the destroy-then-fail-to-reseal fixture). `Gate.broken` + the
 *     `ICON.gateRemnant` glyph + the scene's remnant render are type-only / `game/` (not core surface).
 *   - gate re-seal keeps damage (D107): +1 — `MICRO_GATE_RESEAL` (`scenarios/micro.ts`, the batter →
 *     lever-open → lever-reseal render guard proving the HP readout persists, no top-up). The
 *     `lockGateOnGrid` durability change is a method-body edit (not a surface delta).
 *
 * Tag system deltas (D117 — the `hasTag` classification surface, M1):
 *   - M1 (tags.ts): +6 — `TAGS` / `getTag` / `hasTag` + the three tag-id constants `IN_COMBAT` /
 *     `NON_COMBATANT` / `GARRISON`. `TagDef` / `TagProvenance` / `TagContext` are type-only; the
 *     `deriveInCombat` / `canDamage` predicates are module-private. `Unit.tags` is a type-only
 *     field add (no runtime surface). No registration at import → sim digest unchanged.
 *   - M2a (combat-log.ts): +1 — `exchangedDamageSince` (the `in-combat` clause-1 window query).
 *     `CombatLogEntry` is type-only; `Battle.eventLog`/`tagContext` are methods; `BattleCheckpoint.
 *     eventLogLen` is a type-only field. The event log is derived/passive → sim digest unchanged.
 *   - M2b (gates.ts): +3 — `canKeyGate` / `keyableGates` / `gateActFor` (the living-keyholder Act's
 *     validation + the key-vs-batter selector). `GateAct` + the `keyGate` `CombatAction` are type-only;
 *     `Battle.keyGate` is a method. No new registration/RNG → sim digest unchanged.
 *   - M2c (gates.ts): +1 — `keyholderOf` (position-independent keyholder match; the AI key-drive filter).
 *     `AIPlan.gateAct` is a type-only field; the planner reorder is behavior. No new registration/RNG.
 *
 * Authored spawn-zone deltas (D119 — the split-force deploy, finale group A):
 *   - +10 — the deploy-zone substrate in `deployment.ts` (`isZoneGround` — the hand-written
 *     `SafeGround` discriminant, since TS's `Array.isArray` guard does not subtract a
 *     `readonly T[]` union member; `zoneAt` / `primaryZone` / `zoneOccupants` / `zoneHasRoom` /
 *     `freeTileIn` — zone lookup + the authored capacity cap; `frontReachedPrimary` — the
 *     *geometric* deploy force-start that replaces `safeGroundRemains` for a zoned encounter),
 *     the authored half in `authored.ts` (`buildSpawnZones` — flag-gated inflation;
 *     `placeInZone` — everyone at the primary zone, replacing the roster-order index-map at the
 *     finale), and `SIDE_DOOR_ID` (`the-rescue.ts`, the provider node's authored body).
 *     `SpawnZone` / `SafeGround` / `AuthoredSpawnZone` are type-only. No new RNG label, no new
 *     registration, no routing/reward change → sim digest unchanged (→ 731).
 *
 * Encounters-as-JSON deltas (D122 — arc bodies migrate to `content/levels/*.json`):
 *   - conversion 1 (`thieves-den`): net 0 — −`THIEVES_DEN` (the body const is deleted; the
 *     encounter now lives at `content/levels/thieves-den.json` and reaches core through the
 *     injected authored-node catalog), +`THIEVES_DEN_ID` (the `"thieves-den"` binding the map
 *     node and the content-layer guards share, mirroring `RESCUE_FINALE_ID` / `SIDE_DOOR_ID`
 *     on The Rescue). The body is byte-identical JSON, so routing and rewards are untouched →
 *     sim digest unchanged (731).
 *     **Expect one such −BODY/+BODY_ID pair per remaining conversion** (`E1_SKIRMISH`,
 *     `PRISON_WAGON`, `CUFFED_CELL`, then `TRAP_FIELD`, `OUTER_YARD`).
 *   - conversion 2 (`e1-skirmish`): net 0 — −`E1_SKIRMISH` / +`E1_SKIRMISH_ID`, the same pair for
 *     the same reason (body → `content/levels/e1-skirmish.json`, id stays the map node's binding).
 *     `PIP_COOK` stays exported: the **cast** remains TS (D123), it is simply serialized into the
 *     body's `captives[0].spec`. Byte-identical JSON → sim digest unchanged (736 — conversions 2+
 *     land after the standing-order delta below, and each is net 0, so the total does not move).
 *   - conversion 3 (`prison-wagon`): net 0 — −`PRISON_WAGON` / +`PRISON_WAGON_ID`. `SELA_MEDIC`
 *     stays exported (the **cast** is TS, D123); the body simply carries a serialized copy of her
 *     spec in `grants.recruit`, exactly as the editor's exporter would. → 736.
 *   - conversion 4 (`cuffed-cell`): net 0 — −`CUFFED_CELL` / +`CUFFED_CELL_ID`. The body's
 *     module-private `CAPTIVE_PRISONER` spec is deleted with it (it was never barrel surface —
 *     see increment PR-2 above — and `noUnusedLocals` strands it), serialized instead into
 *     `captives[0].spec`. → 736.
 *   - conversion 5 (`snares-trapfield`): net 0 — −`TRAP_FIELD` / +`TRAP_FIELD_ID`. This is the
 *     body D122 called "the one whose design IS its numbers": the trap `damage`/`concealment`
 *     and `overrides.standingOrder: "hold-skittish"` leave `tsc`'s reach entirely, which is why
 *     validator M4 (trap numerics) and M6 (the standing-order vocabulary) had to land first. → 736.
 *   - conversion 6 (`outer-yard`): net 0 — −`OUTER_YARD` / +`OUTER_YARD_ID`. The last body the
 *     Hollow Mill's map binds to a TS const, apart from `PRISON_ASSAULT` (which checklist F1
 *     **deletes** rather than converts, so it stays the sole inline `encounters` entry). → 736.
 *
 * Standing-order vocabulary delta (D122 — the last silent typo class in `validateLevel`):
 *   - +5 — `standing-orders.ts` grows the `run-flags.ts` registry spelling so an authored
 *     `standingOrder` can be **refused** instead of silently falling back to the charging
 *     planner: `registerStandingOrders` (the null-prototype, fail-loud-on-duplicate builder
 *     `STANDING_ORDERS` is now built through — same values, so `orderOf` is unchanged),
 *     `getStandingOrder` (the D114 getter `orderOf` reads through), `PLAYER_AUTO_ORDERS` (the
 *     reserved player-side `defend`, D41 — authored on five shipped specs, dispatched by
 *     nothing), and the vocabulary queries `standingOrderIds` / `isKnownStandingOrder` that
 *     `validateLevel` refuses against. `PlayerAutoOrderDef` is type-only. No planner change, no
 *     new registration at import, no RNG → sim digest unchanged (→ 736).
 */
import { describe, it, expect } from "vitest";
import * as barrel from "./index";

// The sorted runtime export-name list of the core barrel. Update ONLY with an
// intentional, commit-documented delta (see the header). Increment-0 baseline.
const EXPECTED_BARREL_SURFACE: readonly string[] = [
  "ACT_COST",
  "AI",
  "ASSASSIN_JOB",
  "BANDIT_TEMPLATES",
  "BANKER_BORROW",
  "BANKER_GUARD",
  "BANKER_INTEREST",
  "BANKER_JOB",
  "BLOCKADE",
  "BROTHER",
  "BYPASS",
  "Battle",
  "CAPABILITY_PREDICATES",
  "CHANNEL_TUNING",
  "CHARGE_THRESHOLD",
  "CHUNK_FRACTION",
  "CLERIC_COST",
  "CLOCK_GUARD_MAX",
  "CLOCK_URGENT_NIGHTS",
  "COOK_JOB",
  "COOK_KIT",
  "COOK_STEW",
  "CORE_INVARIANTS",
  "CRITICAL_HP_FRACTION",
  "CTClock",
  "CUFFED_CELL_ID",
  "DASH_CAPTURE_FACTOR",
  "DEAL_PRIMED_FLAG",
  "DEFAULT_GOAL",
  "DEFAULT_MAX_NODES",
  "DEFAULT_MAX_ROUTES",
  "DEFAULT_MAX_SAMPLES",
  "DEFAULT_POLICIES",
  "DEFAULT_SCENARIO_GOLD",
  "DEFAULT_SCORE_WEIGHTS",
  "DEFAULT_SEED_SALTS",
  "DEFEND",
  "DEFT_HANDS",
  "DIFFICULTIES",
  "DIG_IN",
  "DIG_IN_CAPTURE_FACTOR",
  "DOCTRINE_HARNESS",
  "DOCTRINE_HARNESS_SCENARIO",
  "DYING_COUNTER",
  "E1_SKIRMISH_ID",
  "EARLY_EVENT",
  "ECONOMY",
  "ENEMY_TEMPLATES",
  "EQUIPMENT",
  "EQUIP_DECAY_PER_WEAR",
  "EVENTS",
  "EXPOSED",
  "EntityRegistry",
  "EventBus",
  "FATIGUE",
  "FATIGUE_TIER_FLOORS",
  "FEAST",
  "FIND_TRADE",
  "FLANK",
  "FORAGE",
  "FORAGE_KIT",
  "FRONT_ADVANCE_PER_TURN",
  "FRONT_DANGER",
  "FRONT_SPEED_LEAN",
  "GARRISON",
  "GEAR_CONDITION",
  "GEAR_WEAR_WARN",
  "GEN",
  "GOAL_KINDS",
  "GUARDED",
  "GUILD",
  "HASTENED",
  "HEAVY_KNIGHT_JOB",
  "HOLLOW_MILL_EVENTS",
  "HOLLOW_MILL_PARTY",
  "HUNTER_JOB",
  "IMMOBILIZED",
  "INFLUENCE_BANDS",
  "INFLUENCE_ORDER",
  "INTEL_BREAKPOINTS",
  "IN_COMBAT",
  "JOBS",
  "KIT",
  "LEVELING",
  "Labels",
  "MAIN_STATS",
  "MAP_GEN",
  "MARKED",
  "MARKET_TIERS",
  "MATERIALS",
  "MAX_TIER",
  "MEDIC_JOB",
  "MEDIC_TRIAGE",
  "MED_HEAL",
  "MERCHANT_JOB",
  "MERCHANT_KIT",
  "MERCHANT_SELL",
  "MICRO_GATE_DESTRUCTIBLE",
  "MICRO_GATE_ENEMY_BATTER",
  "MICRO_GATE_KEYHOLDER",
  "MICRO_GATE_LOCKPICK",
  "MICRO_GATE_REMNANT",
  "MICRO_GATE_RESEAL",
  "MICRO_KEY_DROP",
  "MICRO_LEVER_SEAL",
  "MICRO_SCENARIOS",
  "MIRA_MERCHANT",
  "MORALE_TIERS",
  "MORTALITY",
  "MOVE_COST",
  "NEUTRAL_DANGER",
  "NOBLE_JOB",
  "NOBLE_PATRONIZE",
  "NODE_EVENTS",
  "NON_COMBATANT",
  "OBJECTIVE_KINDS",
  "ORTHO_OFFSETS",
  "OUTER_YARD_ID",
  "PASSIVE",
  "PASSIVE_INFO",
  "PICK_THE_CELL",
  "PICK_THE_CELL_ENCOUNTER",
  "PILOT_POLICY",
  "PIP_COOK",
  "PLAYER_AUTO_ORDERS",
  "PRESTIGE_OFFERS",
  "PRISON_ASSAULT",
  "PRISON_ASSAULT_SCENARIO",
  "PRISON_ASSAULT_SCENARIO_ENCOUNTER",
  "PRISON_WAGON_ID",
  "PROTECT_MAP_DIVISOR",
  "QUIET_FOOTSTEPS_CAPTURE_FACTOR",
  "REACH",
  "RECON",
  "RECOVERY",
  "RECRUIT",
  "REPRO_DUMP_VERSION",
  "RESCUE_FINALE_ID",
  "RESCUE_PARTY",
  "REST",
  "REWARD_BANDS",
  "REWARD_TABLE",
  "RUN_FLAGS",
  "Rng",
  "RunLoop",
  "SAFE_BASE_RADIUS",
  "SAFE_POWER_PER_STEP",
  "SAVVY_BARTER",
  "SCENARIOS",
  "SCOUT_JOB",
  "SCOUT_PRESTIGE_FLOOR",
  "SELA_MEDIC",
  "SIDE_DOOR_ID",
  "SIDE_DOOR_INTEL",
  "SKILLS",
  "SLOWED",
  "SNARE_TRAPPER_JOB",
  "SOLDIER_JOB",
  "SPOT",
  "STANDING_ORDERS",
  "STARTER_ARMORY",
  "STARTER_TREASURY",
  "STARTING_ROSTER",
  "STATUS_TUNING",
  "STATUS_VISUALS",
  "STAT_KEYS",
  "STEALTH",
  "STEP_SPOT",
  "STOCK_ITEMS",
  "STORIES",
  "SUBTLE_BLADE_BONUS",
  "SURVEY",
  "SURVIVALIST_JOB",
  "SWIFT",
  "TAGS",
  "THEFT",
  "THE_HOLLOW_MILL",
  "THE_RESCUE",
  "THIEF_JOB",
  "THIEVES_DEN_ID",
  "THIEVES_GUILD_CONTACT",
  "THIEVES_GUILD_RITE",
  "TILE_HEIGHT",
  "TILE_WIDTH",
  "TRAP_FIELD_ID",
  "TRAP_INTEL",
  "TRIAGE",
  "TRIAGE_FALLBACK",
  "TURN_THRESHOLD",
  "TileGrid",
  "UNIVERSAL_BUY",
  "UNIVERSAL_OVERWORLD_SKILLS",
  "UNIVERSAL_SKILLS",
  "UPKEEP",
  "VESSELS",
  "abilityFootprint",
  "abilityScaleBonus",
  "accrueDeclaredFaucets",
  "accrueDeployedXp",
  "accruePurseInterest",
  "accrueRp",
  "activeParty",
  "activeUnits",
  "addDelta",
  "addInfluence",
  "addItem",
  "adjacentBodies",
  "adjacentRevealedTrap",
  "advanceDyingClocksOneNight",
  "advanceFront",
  "advanceOutcome",
  "aggregate",
  "aimInRange",
  "analyzeExpedition",
  "applyBorrowEffect",
  "applyBuyEffect",
  "applyCampSkill",
  "applyCampToParty",
  "applyCharacterBoons",
  "applyDamage",
  "applyEngageInterestEffect",
  "applyGatesToGrid",
  "applyGearCondition",
  "applyGrant",
  "applyGrantEffect",
  "applyGuardPurseEffect",
  "applyHeal",
  "applyJobLevelGains",
  "applyOverworldEffect",
  "applyPatronizeEffect",
  "applyProvisionChoice",
  "applySellEffect",
  "applyStatDelta",
  "applyStatus",
  "applyStoryChoice",
  "applyTownVisit",
  "applyTriageEffect",
  "applyTriageFallbackEffect",
  "armObjectives",
  "armSkillCooldown",
  "arrivalDigest",
  "assertKnownRunFlags",
  "assertNever",
  "assignMember",
  "attentionCount",
  "autoTrim",
  "availableActions",
  "availableGear",
  "availableRoster",
  "availableSkills",
  "bandFor",
  "bankerBorrow",
  "bankerBorrowPreview",
  "bankerEngageInterest",
  "bankerInterestPreview",
  "bankerProtect",
  "bankerProtectPreview",
  "batchSimulate",
  "battleOutcome",
  "breakCamp",
  "breakableGates",
  "bribeChance",
  "bribeEnemy",
  "bribePrice",
  "buildAuthoredCaptives",
  "buildAuthoredEnemies",
  "buildAuthoredGates",
  "buildAuthoredGrid",
  "buildAuthoredLevers",
  "buildEnemies",
  "buildGrid",
  "buildLedger",
  "buildScenarioRun",
  "buildSpawnZones",
  "bumpCounter",
  "buyArmoryGear",
  "buyPriceFor",
  "byReadiest",
  "bypassFee",
  "bypassXp",
  "callExfil",
  "campChipLine",
  "campReadout",
  "campReadoutLine",
  "campSkillUses",
  "campSkillUsesLeft",
  "campfireRadius",
  "canAdd",
  "canAffordInfluence",
  "canAffordMaterial",
  "canAttackGate",
  "canCallExfil",
  "canDisarm",
  "canKeyGate",
  "canLockpickGate",
  "canPlacePlayerTrap",
  "canPullLever",
  "canRelease",
  "canSee",
  "canSeeUnit",
  "captainsJournal",
  "captureChanceAt",
  "captureEvasionFactor",
  "captureUnit",
  "caravanCapacity",
  "chebyshev",
  "checkOverworldCost",
  "chooseEventOption",
  "chooseNode",
  "chunkHp",
  "clamp",
  "clamp01",
  "clampTier",
  "clampUp",
  "clampUpMarket",
  "cleanseOne",
  "clearInjectedNodes",
  "cleaveArc",
  "clericRevive",
  "cloneOverworldEconomy",
  "combatParty",
  "commitCombatXp",
  "commitsTurn",
  "committedGearIds",
  "committedMemberIds",
  "computeDamage",
  "computeFlankBonus",
  "computeUpkeep",
  "computeVisibleTiles",
  "configureDeployClock",
  "consumeFlag",
  "cooldownRemaining",
  "countOf",
  "createCamp",
  "createCampfire",
  "createCaravan",
  "createDeployClock",
  "createFront",
  "createGuild",
  "createInventory",
  "createOverworldEconomy",
  "createPlaytestLog",
  "createRun",
  "createRunFromCaravan",
  "createRunFromExpedition",
  "createStarterGuild",
  "createUnit",
  "currentEncounter",
  "currentNode",
  "damageGate",
  "debuffs",
  "decayCounters",
  "declaredFaucetInfluence",
  "deepRest",
  "deftHandsSkim",
  "degradedMods",
  "deployActions",
  "deployForecast",
  "deployModifiers",
  "describeUnit",
  "destroyGateOnGrid",
  "disarmTrap",
  "dispatch",
  "dispatchRefusal",
  "dropsKeyOnDeath",
  "dumpRun",
  "earlyEventForNode",
  "earn",
  "edgeDistance",
  "effectiveIntelTier",
  "effectiveMarketTier",
  "effectiveMove",
  "effectiveSpeed",
  "eligibleGrants",
  "eligiblePrestiges",
  "emptyOutcome",
  "encounterOutcome",
  "enemyCount",
  "enumerateCompletions",
  "enumeratePaths",
  "equip",
  "equipDelta",
  "equipModsSummary",
  "equippedIds",
  "evalPredicate",
  "evalPredicateRun",
  "eventChoices",
  "eventForNode",
  "eventWeightAt",
  "exchangedDamageSince",
  "exfilObjective",
  "exfilStandings",
  "exhaustionSlowSpeed",
  "exposed",
  "fatigueRisk",
  "fatigueTier",
  "fatigueTierIndex",
  "fieldedUnits",
  "fieldsJob",
  "findPath",
  "flankTiles",
  "foodFirst",
  "forecastAttack",
  "forecastEnemyAction",
  "forecastSkill",
  "forget",
  "formatDigest",
  "freeCaptive",
  "freeTileIn",
  "frontCaptureChance",
  "frontReachedPrimary",
  "frontSpeed",
  "frontTurnStage",
  "gainRunGold",
  "gateActFor",
  "gatesOpenedByDeath",
  "gearDelta",
  "gearRefusal",
  "generateEncounter",
  "generateOverworld",
  "getAuthoredNode",
  "getCounter",
  "getDifficulty",
  "getEnemyTemplate",
  "getEquipment",
  "getExpedition",
  "getJob",
  "getMaterial",
  "getNode",
  "getQuest",
  "getRunFlag",
  "getScenario",
  "getSkill",
  "getStandingOrder",
  "getStory",
  "getTag",
  "grantAbilityUseXp",
  "grantItem",
  "grantJobXp",
  "grantXp",
  "gridToScreen",
  "guarded",
  "hasActive",
  "hasBanker",
  "hasConcerns",
  "hasGear",
  "hasMember",
  "hasNoble",
  "hasNodeFlag",
  "hasPacing",
  "hasPrice",
  "hasStatus",
  "hasTag",
  "hasThief",
  "hashSeed",
  "hastened",
  "healAmount",
  "healUnit",
  "heldTheField",
  "hiddenTraps",
  "hireFromPool",
  "hireMercenary",
  "hireRecruit",
  "hireRefusal",
  "immobilized",
  "inAttackRange",
  "inDangerZone",
  "inFlightCaravans",
  "inPlaceRest",
  "inPlaceRestPreview",
  "inRegion",
  "inSafeZone",
  "incrementCounter",
  "influenceTier",
  "injectAuthoredNodes",
  "injectedNodeIds",
  "intelDeployBonus",
  "intelDepthOf",
  "intelFloor",
  "isActive",
  "isAdjacent",
  "isAuthoredEncounter",
  "isBreakable",
  "isCaptured",
  "isConcealedTrap",
  "isDebuffed",
  "isDroppedKey",
  "isDying",
  "isExhausted",
  "isFatigueTier0",
  "isFinalNode",
  "isFinalRunNode",
  "isFlanked",
  "isGoalKind",
  "isHealer",
  "isImmobilized",
  "isKnownRunFlag",
  "isKnownStandingOrder",
  "isNodeVisible",
  "isOverworldActionEffect",
  "isPrimed",
  "isProtected",
  "isRecoverable",
  "isRunComplete",
  "isRunOver",
  "isStealthed",
  "isValidSkillTarget",
  "isZoneGround",
  "itemEffect",
  "jeopardyOf",
  "jobLevelOf",
  "jobPresenceSummary",
  "keyableGates",
  "keyholderOf",
  "knobDeclared",
  "listScenarios",
  "loadExpedition",
  "loadPurse",
  "loadSupply",
  "lockGateOnGrid",
  "lockGear",
  "lockpickableGates",
  "lootBandFor",
  "makeConcealedTrap",
  "makeDroppedKey",
  "makeGate",
  "makeLever",
  "makeTrap",
  "manhattan",
  "markBonus",
  "markOf",
  "markPrey",
  "marketOpenedFlag",
  "marketRank",
  "marketReadyAt",
  "marketStock",
  "marketTierBonus",
  "matchesTag",
  "medHealAmount",
  "medicalHerbs",
  "memberRefusal",
  "mercPool",
  "merchantBuy",
  "merchantBuyGold",
  "merchantPrice",
  "merchantSell",
  "moraleModifiers",
  "moraleTier",
  "moraleTierIndex",
  "mostWoundedFielded",
  "moveBudget",
  "mustGetEvent",
  "mustGetVessel",
  "nightEndGate",
  "nightlyFatigue",
  "noActionsAvailable",
  "nodeAccessible",
  "nodeEncounter",
  "nodeFee",
  "nonNegInt",
  "nudgeMorale",
  "occupiedGrid",
  "onExfilSite",
  "onSkillCooldown",
  "openGate",
  "openGateOnGrid",
  "openingPurseLog",
  "opposite",
  "orderOf",
  "orthoNeighbors",
  "overworldCostOf",
  "parseDump",
  "partyPresence",
  "patronize",
  "patronizePreview",
  "payTreasuryUpkeep",
  "payUpkeep",
  "pct",
  "pickRepresentatives",
  "placeInZone",
  "placeParty",
  "placePlayerTrap",
  "placePlayersAutoEdge",
  "planAttack",
  "planEnemyTurn",
  "planMove",
  "playToTerminal",
  "prerequisiteProblems",
  "prestige",
  "prestigeOptions",
  "previewNode",
  "primaryJobOf",
  "primaryZone",
  "primeFlag",
  "projectDossier",
  "projectForecast",
  "projectManifest",
  "protectRadiusOn",
  "pullableLevers",
  "purseFromLog",
  "purseTotalBySource",
  "rampMark",
  "rankOf",
  "reachLimit",
  "reachableFrom",
  "reachableNodes",
  "reachableTiles",
  "readActionCost",
  "readEncounter",
  "recall",
  "recalls",
  "recordCamp",
  "recordEncounter",
  "recordEventNode",
  "recordInPlaceRest",
  "recordNight",
  "recordRestNode",
  "recoverMaterials",
  "recoverStolen",
  "recruitClassify",
  "recruitToRoster",
  "recruiterOffer",
  "refillBoard",
  "refreshAuras",
  "refreshMercPool",
  "registerExpedition",
  "registerRunFlags",
  "registerStandingOrders",
  "remember",
  "removeFromRoster",
  "removeItem",
  "removeStatus",
  "replay",
  "resetCaravan",
  "resolveAttack",
  "resolveAuthored",
  "resolveCaptured",
  "resolveDowned",
  "resolveEarlyEvent",
  "resolveEvent",
  "resolveFrontTurn",
  "resolveKnob",
  "resolveMedHeal",
  "resolveReturn",
  "resolveSkill",
  "restCostMultiplier",
  "restHeal",
  "restoreFatigue",
  "restoreRun",
  "restoreUnit",
  "retaliationDamage",
  "revealTrapsNear",
  "revertGearStamp",
  "revertStatDelta",
  "rewardBand",
  "rewardHint",
  "rollMercenary",
  "rollSkim",
  "routeCombatXp",
  "routePayoutToTreasury",
  "rpPerNight",
  "runDifficulty",
  "runEncounter",
  "runFlagBag",
  "runFlagIds",
  "runFor",
  "safeGroundRemains",
  "saleValueOf",
  "saltSeed",
  "samplePopulation",
  "satisfyUpkeepLine",
  "scoreArrival",
  "scoutedTier",
  "screenToGrid",
  "sellPrice",
  "serializeDump",
  "setCounter",
  "setNodeFlag",
  "shopBuy",
  "shopStock",
  "shoveLanding",
  "sideSeed",
  "simulateRun",
  "skillContexts",
  "skillEffectPreview",
  "skillsUnlockedBetween",
  "slotsFor",
  "slotsFree",
  "slotsOver",
  "slotsRemaining",
  "slotsUsed",
  "slowed",
  "snapshot",
  "snapshotRun",
  "snapshotUnit",
  "spend",
  "spendFatigue",
  "spendInfluence",
  "spendRp",
  "spotChance",
  "spotRadius",
  "spotWhileMoving",
  "stageEncounter",
  "stampPassives",
  "standingOrderIds",
  "statusAmount",
  "statusVisual",
  "stealth",
  "stepDistance",
  "storyChoicePrice",
  "storyChoices",
  "storyForNode",
  "streamFor",
  "summarizePlaytest",
  "swift",
  "tailoredEarlyEventFor",
  "thiefEscapes",
  "thiefEventSkim",
  "thiefSteal",
  "threatenedTiles",
  "tickCooldowns",
  "tickSkillCooldowns",
  "tickStatuses",
  "tickUntilReady",
  "tileKey",
  "toggleUpkeepSkip",
  "tollFee",
  "trackCombatXp",
  "traverseRoute",
  "triage",
  "triageActionPreview",
  "triageFallbackRp",
  "triageHealAmount",
  "unassignMember",
  "unequip",
  "unitAbilityRows",
  "unitHasCapability",
  "unitPresence",
  "unitSkills",
  "unlockGear",
  "useOverworldSkill",
  "validateExpedition",
  "validateOverworldCost",
  "visibleNodes",
  "withDefaultGoal",
  "woundedBySeverity",
  "zoneAt",
  "zoneHasRoom",
  "zoneOccupants",
];

describe("R3 barrel surface — the core public export names are frozen (pure motion)", () => {
  it("exposes exactly the expected sorted runtime export names", () => {
    const actual = Object.keys(barrel).sort();
    expect(actual).toEqual([...EXPECTED_BARREL_SURFACE]);
  });

  it("has no duplicate export names", () => {
    const names = Object.keys(barrel);
    expect(names.length).toBe(new Set(names).size);
  });
});
