import Phaser from "phaser";
import { GuildScene } from "./scenes/GuildScene";
import { OverworldScene } from "./scenes/OverworldScene";
import { BattleScene } from "./scenes/BattleScene";
import { BattleBootScene, OverworldBootScene, ExpeditionBootScene, HollowMillBootScene } from "./debug-battle";
import { COLOR } from "./theme";

// Standalone **Hollow Mill** mode (M14/D44/D52): `#demo` boots the authored
// expedition straight into the real OverworldScene → BattleScene path (no more
// DemoScene). Otherwise the guild hall boots first (M9) → dispatches a caravan to
// the OverworldScene → hands combat nodes to the BattleScene → returns to the hall.
const hash = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
const isDemo = hash === "demo";
// `#battle` (D-debug): boot straight into the real BattleScene via a headless boot
// scene that builds a deterministic run — so the mission combat is visible to the
// screenshot harness (and a dev) without walking the whole guild→overworld flow.
const isBattle = hash === "battle";
// `#overworld` (D-debug, M13): boot straight into the OverworldScene at a run's
// start node — so the M13 economic layer (fog/ledger/forecast/recovery/lifecycle)
// is visible to the screenshot harness (and a dev) without the guild→dispatch walk.
const isOverworld = hash === "overworld";
// `#expedition` (M13 demo): boot the curated Expedition demo straight into the
// OverworldScene — the full expedition loop (fog/ledger/forecast/recovery/lifecycle
// + real combats) on a hand-picked, deterministic showcase map.
const isExpedition = hash === "expedition";

/** Phaser game configuration for the web build. */
export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "app",
  width: 800,
  height: 600,
  backgroundColor: COLOR.bg,
  scene: isExpedition
    ? [ExpeditionBootScene, GuildScene, OverworldScene, BattleScene]
    : isOverworld
      ? [OverworldBootScene, GuildScene, OverworldScene, BattleScene]
      : isBattle
        ? [BattleBootScene, GuildScene, OverworldScene, BattleScene]
        : isDemo
          ? [HollowMillBootScene, GuildScene, OverworldScene, BattleScene]
          : [GuildScene, OverworldScene, BattleScene],
};
