import Phaser from "phaser";
import {
  createStarterGuild,
  createCaravan,
  assignMember,
  caravanCapacity,
  dispatch,
  runFor,
  RunLoop,
  createRunFromExpedition,
  createPlaytestLog,
  THE_HOLLOW_MILL,
} from "../../core";
import type { RunHandoff } from "../scenes/OverworldScene";
import { installPlaytestLogUI } from "../playtest-log-ui";

/**
 * The **production demo builders** — the two showcase quests reachable from the shipping
 * index.html buttons ("▶ Demo: The Hollow Mill" → `#demo`, "▶ Demo: Expedition" →
 * `#expedition`). Split out of the old `debug-battle.ts` (#138) so the shipping demos no
 * longer live beside the dev jump tooling (see {@link "./debug"}). Each builds a real
 * {@link RunHandoff} and boots straight into the live OverworldScene → BattleScene path.
 */

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
 * the real {@link "../scenes/OverworldScene"}, so the player sees a *complete*
 * expedition: the fog, the Make Camp → End the Night → Survey → Break Camp lifecycle
 * (D46), banded node previews + scouting (D24/D48), the economic ledger + forecast
 * (D45/D48), two-tier **recovery** (D47), real combats via the BattleScene, the
 * theft/toll/shop/recruiter events (D30/D33/D48), and the win/wipe terminals. It
 * reuses the guild→dispatch plumbing but **pins the map seed** to the curated
 * showcase and tunes the starting purse so the routing/budget decisions bite.
 */
export function buildExpeditionDemo(): RunHandoff {
  const guild = createStarterGuild("expedition-demo", {
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
 * {@link "../../core".AuthoredExpedition} booted straight into the real
 * {@link "../scenes/OverworldScene"}. `createRunFromExpedition` inflates the bundle
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
