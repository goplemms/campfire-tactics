import Phaser from "phaser";
import { GuildScene } from "./scenes/GuildScene";
import { OverworldScene } from "./scenes/OverworldScene";
import { BattleScene } from "./scenes/BattleScene";
import { ExpeditionBootScene, HollowMillBootScene } from "./boot/demos";
import { BattleBootScene, OverworldBootScene, JumpBootScene, DebugBootScene, ScenarioBootScene } from "./boot/debug";
import { ReproBootScene } from "./boot/repro";
import { COLOR } from "./theme";

// Standalone **Hollow Mill** mode (M14/D44/D52): `#demo` boots the authored
// expedition straight into the real OverworldScene → BattleScene path. Otherwise
// the guild hall boots first (M9) → dispatches a caravan to the OverworldScene →
// hands combat nodes to the BattleScene → returns to the hall on a terminal.
const hash = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
// Split the hash into `base?query` (the Phase-2 jump seam): `#demo?node=…` boots
// the JumpBootScene (jump straight to a node in an arrival state); plain `#demo`
// keeps booting the Hollow Mill showcase unchanged. Other hashes ignore the query.
const qIdx = hash.indexOf("?");
const base = qIdx === -1 ? hash : hash.slice(0, qIdx);
const query = qIdx === -1 ? "" : hash.slice(qIdx + 1);
const isDemo = base === "demo";
// `#demo?node=<id>&route=<id,…>&salt=<n>&into=<overworld|battle>` — jump straight
// into any Hollow Mill node in a played arrival state (Phase 2 boot seam).
const isJump = isDemo && new URLSearchParams(query).has("node");
// `#battle` (D-debug): boot straight into the real BattleScene via a headless boot
// scene that builds a deterministic run — so the mission combat is visible to the
// screenshot harness (and a dev) without walking the whole guild→overworld flow.
const isBattle = base === "battle";
// `#overworld` (D-debug, M13): boot straight into the OverworldScene at a run's
// start node — so the M13 economic layer (fog/ledger/forecast/recovery/lifecycle)
// is visible to the screenshot harness (and a dev) without the guild→dispatch walk.
const isOverworld = base === "overworld";
// `#expedition` (M13 demo): boot the curated Expedition demo straight into the
// OverworldScene — the full expedition loop (fog/ledger/forecast/recovery/lifecycle
// + real combats) on a hand-picked, deterministic showcase map.
const isExpedition = base === "expedition";
// `#debug` (dev-only): boot a minimal landing scene that mounts the "jump to node"
// DOM overlay (debug-menu.ts) — the clickable front-end over the jump tooling. The
// menu mounts ONLY here, so it never appears on `#demo`/`#expedition`/the default.
const isDebug = base === "debug";
// `#scene` (dev-only, #170): the scenario harness — boot an ARBITRARY authored
// encounter run-less. `#scene=<id>[?party=<name>]` stages straight into the
// BattleScene (the visual twin of headless stageEncounter); bare `#scene` renders a
// clickable picker of every registered scenario × party arm.
const isScene = base === "scene" || base.startsWith("scene=");
// `#repro` (debug, D-repro): re-enter the last captured run state (localStorage) — the
// same-browser twin of the debug menu's cross-machine Restore box (see repro-capture.ts).
const isRepro = base === "repro";

/** Phaser game configuration for the web build. */
export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "app",
  width: 800,
  height: 600,
  backgroundColor: COLOR.bg,
  scene: isRepro
    ? [ReproBootScene, GuildScene, OverworldScene, BattleScene]
    : isDebug
    ? [DebugBootScene, GuildScene, OverworldScene, BattleScene]
    : isScene
    ? [ScenarioBootScene, GuildScene, OverworldScene, BattleScene]
    : isJump
    ? [JumpBootScene, GuildScene, OverworldScene, BattleScene]
    : isExpedition
      ? [ExpeditionBootScene, GuildScene, OverworldScene, BattleScene]
      : isOverworld
        ? [OverworldBootScene, GuildScene, OverworldScene, BattleScene]
        : isBattle
          ? [BattleBootScene, GuildScene, OverworldScene, BattleScene]
          : isDemo
            ? [HollowMillBootScene, GuildScene, OverworldScene, BattleScene]
            : [GuildScene, OverworldScene, BattleScene],
};
