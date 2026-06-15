import Phaser from "phaser";
import { GuildScene } from "./scenes/GuildScene";
import { OverworldScene } from "./scenes/OverworldScene";
import { BattleScene } from "./scenes/BattleScene";
import { DemoScene } from "./scenes/DemoScene";
import { BattleBootScene } from "./debug-battle";
import { COLOR } from "./theme";

// Standalone **demo mode** (M12/D44): `#demo` (or the run-bar button) boots
// straight into *The Hollow Mill*, bypassing the guild/overworld. Otherwise the
// guild hall boots first (M9) → dispatches a caravan to the OverworldScene →
// hands combat nodes to the BattleScene → returns to the hall on a terminal.
const hash = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
const isDemo = hash === "demo";
// `#battle` (D-debug): boot straight into the real BattleScene via a headless boot
// scene that builds a deterministic run — so the mission combat is visible to the
// screenshot harness (and a dev) without walking the whole guild→overworld flow.
const isBattle = hash === "battle";

/** Phaser game configuration for the web build. */
export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "app",
  width: 800,
  height: 600,
  backgroundColor: COLOR.bg,
  scene: isBattle
    ? [BattleBootScene, GuildScene, OverworldScene, BattleScene, DemoScene]
    : isDemo
      ? [DemoScene, GuildScene, OverworldScene, BattleScene]
      : [GuildScene, OverworldScene, BattleScene, DemoScene],
};
