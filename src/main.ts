import Phaser from "phaser";
import { gameConfig } from "./game/config";
import { FONT } from "./game/theme";
import { installReproDump } from "./game/repro-capture";
import "./game/fonts.css";

// The run-bar "Demo" button (M12/D44): set the #demo hash and reload so the game
// boots straight into the standalone Hollow Mill demo.
const demoBtn = document.getElementById("demobtn") as HTMLButtonElement | null;
if (demoBtn) {
  demoBtn.onclick = () => {
    window.location.hash = "demo";
    window.location.reload();
  };
}

// The run-bar "Expedition" button (M13): boot the curated overworld expedition demo.
const expeditionBtn = document.getElementById("expeditionbtn") as HTMLButtonElement | null;
if (expeditionBtn) {
  expeditionBtn.onclick = () => {
    window.location.hash = "expedition";
    window.location.reload();
  };
}

// The run-bar "Debug: Jump" button (dev-only): set the #debug hash and reload so the
// game boots the DebugBootScene, which mounts the "jump to any node" DOM overlay. The
// config reads the hash once at module init, so a reload is required for it to take.
const debugBtn = document.getElementById("debugbtn") as HTMLButtonElement | null;
if (debugBtn) {
  debugBtn.onclick = () => {
    window.location.hash = "debug";
    window.location.reload();
  };
}

/**
 * Boot the Phaser game into #app — the only file that owns a live engine
 * instance; everything testable lives under `core/`.
 *
 * Phaser bakes the resolved font into a canvas texture the moment a `Text` is
 * created, so a web font that loads *after* the first scene draws would render
 * in the fallback and never update. We therefore wait for the UI face to load
 * (with a short timeout so a slow/blocked font never wedges the boot) before
 * constructing the game.
 */
async function boot(): Promise<void> {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (fonts?.load) {
    const family = FONT.family.split(",")[0].replace(/["']/g, "").trim();
    await Promise.race([
      Promise.all([fonts.load(`16px "${family}"`), fonts.load(`bold 16px "${family}"`)]),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]).catch(() => undefined);
  }

  const game = new Phaser.Game(gameConfig);
  // Expose the running game so the screenshot harness (scripts/screenshot.mjs)
  // can poll scene state for an animation-idle sync point. Harmless in
  // production — a single reference on window.
  (window as Window & { game?: Phaser.Game }).game = game;
  // Wire the Repro Dump affordance (Shift+D / window.campfire.dump()) so a freeze on any
  // build can be captured + replayed. Passive capture is hooked inside the scenes.
  installReproDump(game);
}

void boot();
