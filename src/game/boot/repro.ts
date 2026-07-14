import Phaser from "phaser";
import { COLOR, FONT, INK } from "../theme";
import { REPRO_LS_KEY, restoreAndBoot } from "../repro-capture";

/**
 * A boot scene for `#repro` — re-enter the **last captured** run state on this browser
 * (written to `localStorage` by {@link "../repro-capture".captureRepro} on every scene
 * transition). Same-browser convenience: reload with `#repro` after a freeze to land back on
 * the exact pre-Begin prep camp. For a *cross-machine* repro (a tester's dump sent to a dev),
 * paste the JSON into the `#debug` menu's Restore box instead — both funnel through
 * {@link restoreAndBoot}.
 *
 * Renders a short message when there's nothing stored (rather than a blank canvas), so the
 * failure mode is legible.
 */
export class ReproBootScene extends Phaser.Scene {
  constructor() {
    super("ReproBootScene");
  }

  create(): void {
    const stored = (() => {
      try {
        return window.localStorage?.getItem(REPRO_LS_KEY) ?? null;
      } catch {
        return null;
      }
    })();

    if (!stored) {
      const { width, height } = this.scale;
      this.add.rectangle(0, 0, width, height, COLOR.bg, 1).setOrigin(0, 0);
      this.add
        .text(width / 2, height / 2 - 12, "Repro — nothing captured", { color: INK.bright, fontFamily: FONT.family, fontSize: FONT.title })
        .setOrigin(0.5);
      this.add
        .text(width / 2, height / 2 + 20, "Play a step on #demo first (a capture is taken each transition), then reload #repro.", {
          color: INK.secondary,
          fontFamily: FONT.family,
          fontSize: FONT.label,
        })
        .setOrigin(0.5);
      return;
    }

    try {
      restoreAndBoot(this.game, stored);
    } catch (e) {
      const { width, height } = this.scale;
      this.add.rectangle(0, 0, width, height, COLOR.bg, 1).setOrigin(0, 0);
      this.add
        .text(width / 2, height / 2, `Repro restore failed: ${(e as Error).message}`, { color: INK.ember, fontFamily: FONT.family, fontSize: FONT.body, wordWrap: { width: width - 80 } })
        .setOrigin(0.5);
    }
  }
}
