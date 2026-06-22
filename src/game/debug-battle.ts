import Phaser from "phaser";
import {
  createGuild,
  createCaravan,
  createUnit,
  assignMember,
  caravanCapacity,
  dispatch,
  runFor,
  RunLoop,
  createRunFromExpedition,
  createPlaytestLog,
  THE_HOLLOW_MILL,
  type Unit,
  type MapNode,
} from "../core";
import type { RunHandoff } from "./scenes/OverworldScene";
import { installPlaytestLogUI } from "./playtest-log-ui";

/** The shared demo/debug starting party (the authored cast the Guild hall seeds). */
function demoRoster(): Unit[] {
  return [
    createUnit({ id: "Edrin", side: "player", pos: { col: -1, row: -1 }, name: "Edrin", jobId: "soldier", isLord: true, awareness: 5, intelligence: 4, speed: 12, maxHp: 34, attack: 11, defense: 4, moveRange: 4, sightRadius: 5 }),
    createUnit({ id: "Rook", side: "player", pos: { col: -1, row: -1 }, name: "Rook", jobId: "soldier", awareness: 4, intelligence: 4, speed: 12, maxHp: 30, attack: 9, defense: 3, moveRange: 4, sightRadius: 5 }),
    createUnit({ id: "Vale", side: "player", pos: { col: -1, row: -1 }, name: "Vale", jobId: "survivalist", awareness: 2, intelligence: 2, speed: 10, maxHp: 24, attack: 11, defense: 2, moveRange: 4, sightRadius: 5 }),
    createUnit({ id: "Pip", side: "player", pos: { col: -1, row: -1 }, name: "Pip", jobId: "chef", speed: 8, maxHp: 18, attack: 3, defense: 1, moveRange: 3, sightRadius: 4 }),
    createUnit({ id: "Coin", side: "player", pos: { col: -1, row: -1 }, name: "Coin", jobId: "merchant", speed: 8, maxHp: 16, attack: 2, defense: 1, moveRange: 3, sightRadius: 4 }),
    createUnit({ id: "Liora", side: "player", pos: { col: -1, row: -1 }, name: "Liora", jobId: "noble", awareness: 2, intelligence: 5, speed: 8, maxHp: 18, attack: 2, defense: 1, moveRange: 3, sightRadius: 4 }),
  ];
}

/**
 * A deterministic **debug entry into the real mission scene** (`#battle`).
 *
 * The {@link "./scenes/BattleScene"} only ever runs as one node of a guild run —
 * reached by assembling a caravan, dispatching it, and picking a combat node on
 * the overworld. That made it the *one* combat scene the screenshot harness (and
 * a developer) couldn't see at a glance, which is exactly why its presentation
 * drifted behind the demo's. This rebuilds that chain headlessly and parks a
 * {@link RunLoop} on its first combat node, so the harness can boot straight into
 * a genuine deployment board. The seed is fixed, so the encounter is reproducible.
 */
export function buildDebugBattle(): RunHandoff {
  const guild = createGuild("debug-battle", {
    roster: demoRoster(),
    armory: ["enchanted-blade", "iron-shield"],
    treasury: 300,
    caravans: [createCaravan("alpha", "supply-train")],
    mainQuestLabel: "The Sunken Keep",
  });

  // Assemble + dispatch the caravan, then realise its in-flight run.
  const caravan = guild.caravans[0];
  for (const unit of guild.roster.slice(0, caravanCapacity(caravan))) assignMember(caravan, unit, guild.caravans);
  dispatch(guild, caravan, guild.board[0]);
  const gr = runFor(guild, caravan.id);
  if (!gr) throw new Error("debug-battle: dispatch produced no run");
  const loop = new RunLoop(gr.run);

  // Park the loop on its first combat node so BattleScene has an encounter to stage.
  loop.choose(firstCombatNode(loop).id);
  return { run: gr.run, loop, guild, caravanId: caravan.id };
}

/** Walk the reachable frontier to the first combat node (advancing past any rest/event). */
function firstCombatNode(loop: RunLoop): MapNode {
  for (let guard = 0; guard < 20; guard++) {
    const reachable = loop.reachable();
    const combat = reachable.find((n) => n.kind === "combat");
    if (combat) return combat;
    if (reachable.length === 0) break;
    loop.choose(reachable[0].id);
  }
  throw new Error("debug-battle: no combat node reachable from the run start");
}

/**
 * A headless boot scene for `#battle`: builds the debug run and immediately hands
 * off to the real {@link "./scenes/BattleScene"}. It renders nothing itself.
 */
export class BattleBootScene extends Phaser.Scene {
  constructor() {
    super("BattleBootScene");
  }

  create(): void {
    this.scene.start("BattleScene", buildDebugBattle());
  }
}

/**
 * A debug run parked at the **overworld start** (`#overworld`) — the same assembled
 * caravan as {@link buildDebugBattle}, but handed to the {@link
 * "./scenes/OverworldScene"} at its start node (not parked on a combat). Lets the
 * screenshot harness (and a developer) see the M13 overworld economic layer — the
 * fog (D48), Make Camp / Survey lifecycle (D46), the ledger (D45) and in-place rest
 * (D47) — without walking the whole guild→dispatch flow. A purse is loaded so the
 * ledger/forecast have numbers to show.
 */
export function buildDebugOverworld(): RunHandoff {
  const handoff = buildDebugBattle();
  // Reset to the start node (buildDebugBattle parks on a combat node) and stock the
  // purse so the ledger/forecast read meaningfully.
  const run = handoff.run;
  run.mapNodeId = run.map.startId;
  run.path = [run.map.startId];
  run.camp.gold = 180;
  return handoff;
}

/** A headless boot scene for `#overworld`: hands a fresh run to the OverworldScene. */
export class OverworldBootScene extends Phaser.Scene {
  constructor() {
    super("OverworldBootScene");
  }

  create(): void {
    this.scene.start("OverworldScene", buildDebugOverworld());
  }
}

/**
 * The **Expedition demo** seed (M13) — a hand-picked, deterministic map that puts
 * every overworld element on the route: the opening layer offers a **combat, a
 * rest and an event**; layer 2 forces the **thief-vs-toll** choice (the D48 lesson —
 * *income is fogged, cost is known*); deeper layers carry a **recruiter**, a **shop**
 * (jump-to-market), more rests for the premium recovery route, and the final
 * mission — which sits in the **fog** at the party's intel tier. (Guarded by
 * `expedition-demo.test.ts` so a generation change can't quietly gut the showcase.)
 */
export const EXPEDITION_SEED = "expedition-350";

/**
 * Build the **Expedition demo** (M13, Path 1) — a curated run booted straight into
 * the real {@link "./scenes/OverworldScene"}, so the player sees a *complete*
 * expedition: the fog, the Make Camp → End the Night → Survey → Break Camp lifecycle
 * (D46), banded node previews + scouting (D24/D48), the economic ledger + forecast
 * (D45/D48), two-tier **recovery** (D47), real combats via the BattleScene, the
 * theft/toll/shop/recruiter events (D30/D33/D48), and the win/wipe terminals. It
 * reuses the guild→dispatch plumbing but **pins the map seed** to the curated
 * showcase and tunes the starting purse so the routing/budget decisions bite.
 */
export function buildExpeditionDemo(): RunHandoff {
  const guild = createGuild("expedition-demo", {
    roster: demoRoster(),
    armory: ["enchanted-blade", "iron-shield"],
    treasury: 300,
    caravans: [createCaravan("alpha", "supply-train")],
    mainQuestLabel: "The Long Road Home",
  });
  const caravan = guild.caravans[0];
  for (const unit of guild.roster.slice(0, caravanCapacity(caravan))) assignMember(caravan, unit, guild.caravans);
  // Pin the curated showcase map (deterministic), then dispatch onto it.
  guild.board[0].seed = EXPEDITION_SEED;
  dispatch(guild, caravan, guild.board[0]);
  const gr = runFor(guild, caravan.id);
  if (!gr) throw new Error("expedition-demo: dispatch produced no run");
  // Demo-scoped purse: modest so routing/budget decisions actually bite. (A global
  // gold-scarcity numbers pass is still deferred — D30/D34.)
  gr.run.camp.gold = 110;
  const loop = new RunLoop(gr.run);
  // Instrument the showcase for playtesting (same lever telemetry as the Hollow Mill).
  loop.log = createPlaytestLog(gr.run, EXPEDITION_SEED);
  installPlaytestLogUI(loop.log);
  return { run: gr.run, loop, guild, caravanId: caravan.id, demoIntro: true };
}

/** A headless boot scene for `#expedition`: hands the curated demo run to the OverworldScene. */
export class ExpeditionBootScene extends Phaser.Scene {
  constructor() {
    super("ExpeditionBootScene");
  }

  create(): void {
    this.scene.start("OverworldScene", buildExpeditionDemo());
  }
}

/**
 * Build **The Hollow Mill** (M14) — the authored set-piece quest, now a first-class
 * {@link "../core".AuthoredExpedition} booted straight into the real
 * {@link "./scenes/OverworldScene"}. `createRunFromExpedition` inflates the bundle
 * (party, purse, supplies) onto the hand-built map, and the run plays the M12 demo
 * arc *inside* the M13 routing economy — provision at the start camp, E1, a rest,
 * E2's hidden-until-scouted ambush, and E3's closing-gate holdout — with no guild
 * (a standalone showcase, so a terminal shows the end screen in place).
 */
export function buildHollowMill(): RunHandoff {
  const run = createRunFromExpedition(THE_HOLLOW_MILL);
  const loop = new RunLoop(run);
  // Instrument the showcase run for playtesting: the loop snapshots every
  // logistics lever, and the export button hands the timeline back (D-playtest).
  loop.log = createPlaytestLog(run, THE_HOLLOW_MILL.id);
  installPlaytestLogUI(loop.log);
  return { run, loop, demoIntro: true };
}

/** A headless boot scene for `#demo`: hands the Hollow Mill expedition to the OverworldScene. */
export class HollowMillBootScene extends Phaser.Scene {
  constructor() {
    super("HollowMillBootScene");
  }

  create(): void {
    this.scene.start("OverworldScene", buildHollowMill());
  }
}
