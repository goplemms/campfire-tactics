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
  type Unit,
  type MapNode,
} from "../core";
import type { RunHandoff } from "./scenes/OverworldScene";

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
  // The same authored starting party the Guild hall seeds a fresh guild with.
  const roster: Unit[] = [
    createUnit({ id: "Edrin", side: "player", pos: { col: -1, row: -1 }, name: "Edrin", jobId: "soldier", isLord: true, awareness: 5, intelligence: 4, speed: 12, maxHp: 34, attack: 11, defense: 4, moveRange: 4, sightRadius: 5 }),
    createUnit({ id: "Rook", side: "player", pos: { col: -1, row: -1 }, name: "Rook", jobId: "soldier", awareness: 4, intelligence: 4, speed: 12, maxHp: 30, attack: 9, defense: 3, moveRange: 4, sightRadius: 5 }),
    createUnit({ id: "Vale", side: "player", pos: { col: -1, row: -1 }, name: "Vale", jobId: "survivalist", awareness: 2, intelligence: 2, speed: 10, maxHp: 24, attack: 11, defense: 2, moveRange: 4, sightRadius: 5 }),
    createUnit({ id: "Pip", side: "player", pos: { col: -1, row: -1 }, name: "Pip", jobId: "chef", speed: 8, maxHp: 18, attack: 3, defense: 1, moveRange: 3, sightRadius: 4 }),
    createUnit({ id: "Coin", side: "player", pos: { col: -1, row: -1 }, name: "Coin", jobId: "merchant", speed: 8, maxHp: 16, attack: 2, defense: 1, moveRange: 3, sightRadius: 4 }),
  ];
  const guild = createGuild("debug-battle", {
    roster,
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
