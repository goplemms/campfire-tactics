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
  enumeratePaths,
  traverseRoute,
  samplePopulation,
  pickRepresentatives,
  DEFAULT_POLICIES,
  getNode,
  type Unit,
  type MapNode,
  type PopulationOpts,
  type SampleDescriptor,
  type BattlePolicy,
} from "../core";
import type { RunHandoff } from "./scenes/OverworldScene";
import { installPlaytestLogUI } from "./playtest-log-ui";
import { installDebugMenu } from "./debug-menu";
import { COLOR, INK, FONT } from "./theme";

/** The shared demo/debug starting party (the authored cast the Guild hall seeds). */
function demoRoster(): Unit[] {
  return [
    createUnit({ id: "Edrin", side: "player", pos: { col: -1, row: -1 }, name: "Edrin", jobId: "soldier", isLord: true, awareness: 5, intelligence: 4, speed: 12, maxHp: 34, attack: 11, defense: 4, moveRange: 4, sightRadius: 5 }),
    createUnit({ id: "Rook", side: "player", pos: { col: -1, row: -1 }, name: "Rook", jobId: "soldier", awareness: 4, intelligence: 4, speed: 12, maxHp: 30, attack: 9, defense: 3, moveRange: 4, sightRadius: 5 }),
    createUnit({ id: "Vale", side: "player", pos: { col: -1, row: -1 }, name: "Vale", jobId: "scout", awareness: 2, intelligence: 2, speed: 10, maxHp: 24, attack: 11, defense: 2, moveRange: 4, sightRadius: 5 }),
    createUnit({ id: "Pip", side: "player", pos: { col: -1, row: -1 }, name: "Pip", jobId: "cook", speed: 8, maxHp: 18, attack: 3, defense: 1, moveRange: 3, sightRadius: 4 }),
    createUnit({ id: "Coin", side: "player", pos: { col: -1, row: -1 }, name: "Coin", jobId: "merchant", speed: 8, maxHp: 16, attack: 2, defense: 1, moveRange: 3, sightRadius: 4 }),
    createUnit({ id: "Liora", side: "player", pos: { col: -1, row: -1 }, name: "Liora", jobId: "noble", awareness: 2, intelligence: 5, speed: 8, maxHp: 18, attack: 2, defense: 1, moveRange: 3, sightRadius: 4 }),
    createUnit({ id: "Sterling", side: "player", pos: { col: -1, row: -1 }, name: "Sterling", jobId: "banker", awareness: 2, intelligence: 3, speed: 8, maxHp: 16, attack: 2, defense: 1, moveRange: 3, sightRadius: 4 }),
    createUnit({ id: "Sela", side: "player", pos: { col: -1, row: -1 }, name: "Sela", jobId: "medic", awareness: 3, intelligence: 3, speed: 9, maxHp: 20, attack: 4, defense: 2, moveRange: 3, sightRadius: 4 }),
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

/**
 * The **boot seam** for the jump tool (Phase 2) — turn a `node`/`route`/`salt`
 * request into a ready-to-hand {@link RunHandoff} positioned *at* a Hollow Mill
 * node, pre-resolution. Reuses the Phase-1 expedition-sim substrate
 * ({@link enumeratePaths} + {@link traverseRoute}) so the jump replays the real
 * overworld pipeline headlessly instead of re-walking the run by hand.
 *
 * **Route resolution order:**
 * 1. `opts.route` given → that exact, hand-picked route (existing behavior; `arrival` is
 *    ignored — an explicit scenario wins).
 * 2. else `opts.arrival` given (`"best" | "average" | "worst"`) → sample a population at the
 *    node ({@link samplePopulation}, threading {@link PopulationOpts}), pick representatives
 *    ({@link pickRepresentatives}), and take the chosen pick's {@link SampleDescriptor}.
 *    If that pick is absent (no survivors at the node) this is a **surfaced error**.
 * 3. else (neither) → the **first enumerated** simple path to the node (existing default).
 *
 * A chosen *descriptor* is then re-materialized into the real arrival via
 * {@link traverseRoute} with the descriptor's salt and its named policy (resolved by name
 * from the sampling policy set — see {@link resolvePolicy}), so the booted run is byte-for-byte
 * the same one the population scored. An unreachable node (no route from the start) is a
 * surfaced error, not a silent empty boot. The playtest log is installed for parity with
 * {@link buildHollowMill}.
 *
 * `opts.populationOpts` is the **first-class-able variety seam** (the vision's "config not
 * rework" decision): it threads straight into {@link samplePopulation}. The boot seam passes
 * defaults today, but promoting variety (more salts, A/B policies) later is config, not a
 * code change here.
 */
export function buildArrivalJump(opts: {
  node: string;
  route?: string[];
  salt?: number;
  arrival?: "best" | "average" | "worst";
  populationOpts?: PopulationOpts;
}): RunHandoff {
  let route: string[] | undefined;
  let seedSalt: number | undefined = opts.salt;
  let policy: { player: BattlePolicy; enemy: BattlePolicy } | undefined;

  if (opts.route) {
    // (1) Explicit, hand-picked route wins — existing behavior; ignore `arrival`.
    route = opts.route;
  } else if (opts.arrival) {
    // (2) Percentile pick: sample → pick → re-materialize the chosen descriptor.
    const population = samplePopulation(THE_HOLLOW_MILL, opts.node, opts.populationOpts);
    const picks = pickRepresentatives(population);
    const pick = picks[opts.arrival];
    if (!pick) {
      throw new Error(
        `buildArrivalJump: no "${opts.arrival}" arrival at "${opts.node}" — ` +
          `0 of ${picks.stats.sampled} sampled runs survived to it (all wiped on the way)`,
      );
    }
    const descriptor: SampleDescriptor = pick.descriptor;
    route = descriptor.route;
    seedSalt = descriptor.seedSalt;
    policy = resolvePolicy(descriptor.policyName, opts.populationOpts);
  } else {
    // (3) Default — the first enumerated simple path to the node.
    route = enumeratePaths(THE_HOLLOW_MILL.map, opts.node)[0];
  }

  if (!route) {
    throw new Error(`buildArrivalJump: "${opts.node}" is unreachable from the start (no route)`);
  }
  const arrival = traverseRoute(THE_HOLLOW_MILL, route, { seedSalt, policy });
  // Instrument for parity with buildHollowMill (the showcase playtest telemetry).
  arrival.loop.log = createPlaytestLog(arrival.run, THE_HOLLOW_MILL.id);
  installPlaytestLogUI(arrival.loop.log);
  return { run: arrival.run, loop: arrival.loop, demoIntro: false };
}

/**
 * Resolve a {@link SampleDescriptor}'s `policyName` back to its battle-policy pair, from the
 * **same policy set the population was sampled under** (`populationOpts.policies`, defaulting
 * to {@link DEFAULT_POLICIES}). Falls back to the first default policy when the name isn't
 * found (defensive — with today's single "pilot" policy this is trivial, but it's written so
 * multiple named policies re-materialize correctly).
 */
function resolvePolicy(
  policyName: string,
  populationOpts?: PopulationOpts,
): { player: BattlePolicy; enemy: BattlePolicy } {
  const policies = populationOpts?.policies ?? DEFAULT_POLICIES;
  const named = policies.find((p) => p.name === policyName);
  return (named ?? DEFAULT_POLICIES[0]).policy;
}

/**
 * **Jump a live game into an arrival** — the shared boot seam behind both the
 * `#demo?node=…` URL jump ({@link JumpBootScene}) and the in-game debug menu
 * ({@link installDebugMenu}). Builds the {@link RunHandoff} from `params`
 * ({@link buildArrivalJump}) and starts the destination scene with it.
 *
 * The destination follows the same rule {@link JumpBootScene} used to inline: an
 * explicit `params.into` wins (`battle` → BattleScene, `overworld` → OverworldScene);
 * otherwise it's chosen by the **target node's kind** — a `combat` node hands off to
 * the BattleScene (which stages the encounter in its `create()`), anything else parks
 * on the OverworldScene. Centralizing it here keeps the scene-decision logic in one
 * place (the menu and the boot scene can't drift apart).
 */
export function jumpToArrival(game: Phaser.Game, params: JumpParams): void {
  const handoff = buildArrivalJump(params);
  const into =
    params.into ??
    (getNode(THE_HOLLOW_MILL.map, params.node).kind === "combat" ? "battle" : "overworld");
  game.scene.start(into === "battle" ? "BattleScene" : "OverworldScene", handoff);
}

/** Parsed `#demo?node=…` jump params (see {@link JumpBootScene}). */
export interface JumpParams {
  node: string;
  route?: string[];
  salt?: number;
  /**
   * The **percentile pick** (the magic button): boot the best / average / worst-survivor
   * arrival at the node. Only those three values are accepted; anything else (or absent) is
   * treated as unset. Ignored when an explicit `route` is given.
   */
  arrival?: "best" | "average" | "worst";
  into?: "overworld" | "battle";
}

/** Parse the hash query into {@link JumpParams} (URLSearchParams; `route` comma-split). */
export function parseJumpParams(query: string): JumpParams | null {
  const params = new URLSearchParams(query);
  const node = params.get("node");
  if (!node) return null;
  const routeRaw = params.get("route");
  const saltRaw = params.get("salt");
  const arrivalRaw = params.get("arrival");
  const intoRaw = params.get("into");
  return {
    node,
    route: routeRaw ? routeRaw.split(",").filter((s) => s.length > 0) : undefined,
    salt: saltRaw != null && saltRaw !== "" ? Number(saltRaw) : undefined,
    arrival:
      arrivalRaw === "best" || arrivalRaw === "average" || arrivalRaw === "worst"
        ? arrivalRaw
        : undefined,
    into: intoRaw === "overworld" || intoRaw === "battle" ? intoRaw : undefined,
  };
}

/**
 * A headless boot scene for the jump tool:
 * `#demo?node=<id>&route=<id,id,…>&salt=<n>&arrival=<best|average|worst>&into=<overworld|battle>`.
 *
 * `arrival=best|average|worst` is the **magic button**: it samples a population at the node
 * and boots the best / average / worst-*survivor* arrival (see {@link buildArrivalJump}).
 * An explicit `route` overrides it.
 *
 * Re-reads `window.location.hash` (config already matched it; reading it here keeps
 * the scene self-contained and the seam in one place). Builds the arrival, then
 * decides the destination scene: `into=battle` → BattleScene, `into=overworld` →
 * OverworldScene. With `into` absent, the **default** follows the target node's
 * kind — a `combat` node hands off to the BattleScene (which stages it in
 * `create()`), anything else parks on the OverworldScene.
 */
export class JumpBootScene extends Phaser.Scene {
  constructor() {
    super("JumpBootScene");
  }

  create(): void {
    const hash = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
    const query = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
    const parsed = parseJumpParams(query);
    if (!parsed) {
      // No node param reached us (config should have routed elsewhere) — fail loud.
      throw new Error("JumpBootScene: no `node` param in the hash");
    }
    // The scene-decision lives in jumpToArrival (shared with the debug menu).
    jumpToArrival(this.game, parsed);
  }
}

/**
 * A dev-only **landing scene** for `#debug` — a minimal backdrop + title that mounts
 * the {@link installDebugMenu} DOM overlay (the clickable "jump to any node in a
 * plausible state" front-end). Mirrors {@link HollowMillBootScene} in being a thin
 * boot scene, but unlike the jump boot scenes it **renders** (a backdrop + heading)
 * rather than immediately handing off — the developer then drives the jump from the
 * overlay, which persists across the `scene.start` calls it triggers.
 */
export class DebugBootScene extends Phaser.Scene {
  constructor() {
    super("DebugBootScene");
  }

  create(): void {
    const { width, height } = this.scale;
    this.add.rectangle(0, 0, width, height, COLOR.bg, 1).setOrigin(0, 0);
    this.add
      .text(width / 2, height / 2 - 16, "Debug — Jump to Node", {
        color: INK.bright,
        fontFamily: FONT.family,
        fontSize: FONT.title,
      })
      .setOrigin(0.5);
    this.add
      .text(width / 2, height / 2 + 18, "Use the ≡ Debug Jump panel (top-left) to boot a node in a plausible arrival state.", {
        color: INK.secondary,
        fontFamily: FONT.family,
        fontSize: FONT.body,
        align: "center",
        wordWrap: { width: width - 80 },
      })
      .setOrigin(0.5);
    installDebugMenu(this.game);
  }
}
