import Phaser from "phaser";
import {
  createStarterGuild,
  createCaravan,
  assignMember,
  caravanCapacity,
  dispatch,
  runFor,
  RunLoop,
  createPlaytestLog,
  THE_HOLLOW_MILL,
  enumeratePaths,
  traverseRoute,
  samplePopulation,
  pickRepresentatives,
  DEFAULT_POLICIES,
  getNode,
  type MapNode,
  type PopulationOpts,
  type SampleDescriptor,
  type BattlePolicy,
} from "../../core";
import type { RunHandoff } from "../scenes/OverworldScene";
import { installPlaytestLogUI } from "../playtest-log-ui";
import { installDebugMenu } from "../debug-menu";
import { COLOR, INK, FONT } from "../theme";

/**
 * The **dev boot + jump tooling** — the developer/screenshot-harness entry points, split out
 * of the old `debug-battle.ts` (#138) so they no longer live beside the shipping demo builders
 * (see {@link "./demos"}). Covers the `#battle`/`#overworld` debug boots into the real scenes
 * and the `#demo?node=…` / `#debug` jump seam (jump straight into any node in a played arrival
 * state).
 */

/**
 * A deterministic **debug entry into the real mission scene** (`#battle`).
 *
 * The {@link "../scenes/BattleScene"} only ever runs as one node of a guild run —
 * reached by assembling a caravan, dispatching it, and picking a combat node on
 * the overworld. That made it the *one* combat scene the screenshot harness (and
 * a developer) couldn't see at a glance, which is exactly why its presentation
 * drifted behind the demo's. This rebuilds that chain headlessly and parks a
 * {@link RunLoop} on its first combat node, so the harness can boot straight into
 * a genuine deployment board. The seed is fixed, so the encounter is reproducible.
 */
export function buildDebugBattle(): RunHandoff {
  const guild = createStarterGuild("debug-battle", {
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
 * off to the real {@link "../scenes/BattleScene"}. It renders nothing itself.
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
 * "../scenes/OverworldScene"} at its start node (not parked on a combat). Lets the
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
 * {@link "./demos".buildHollowMill}.
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
  const key = into === "battle" ? "BattleScene" : "OverworldScene";
  // Drive the transition through a *running scene's* plugin (`scene.start`), the same
  // path the normal game flow uses: it stops the calling scene, then starts the target
  // — a properly-sequenced handoff. The global `game.scene.start` (the obvious call
  // from the menu, which has no scene of its own) stops nothing, so jumps would layer
  // the new scene on top of the boot scene + every prior arrival — stacking entities and
  // crashing a stale scene mid-deploy. So: collapse any prior stack to one running scene,
  // then let that one hand off to the target. The DOM debug overlay is a canvas sibling,
  // not a scene, so it survives the transition untouched.
  const running = game.scene.getScenes(true);
  for (let i = 1; i < running.length; i++) game.scene.stop(running[i].scene.key);
  const driver = running[0];
  if (driver) driver.scene.start(key, handoff);
  else game.scene.start(key, handoff);
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
 * plausible state" front-end). Mirrors {@link "./demos".HollowMillBootScene} in being a
 * thin boot scene, but unlike the jump boot scenes it **renders** (a backdrop + heading)
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
