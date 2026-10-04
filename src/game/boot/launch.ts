import Phaser from "phaser";
import { buildEncounterStart, parseEncounterStart } from "../encounter-start";
import { COLOR, FONT, INK } from "../theme";

/**
 * `#launch?…` boot — the shareable twin of the editor's Launch tab. The query is an
 * {@link "../encounter-start".EncounterStart} (`target=node:hollow-mill:finale&level=5&tweaks=rook.level=7`),
 * built by the same {@link buildEncounterStart} the tab uses, so a copied link boots exactly the fight
 * the tab would. The tab's **Copy link** writes these.
 *
 * A link that can't be honoured (a typo'd target, an unknown unit in a tweak) renders its reason on
 * screen instead of throwing: an uncaught boot exception reads as a frozen black canvas, and the point
 * of a link is that someone else opens it. The reason is also left on `window.campfireLaunchError`
 * for the e2e.
 */
export class LaunchBootScene extends Phaser.Scene {
  constructor() {
    super("LaunchBootScene");
  }

  create(): void {
    const hash = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
    const query = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
    try {
      const { run, loop } = buildEncounterStart(parseEncounterStart(query));
      this.scene.start("BattleScene", { run, loop });
    } catch (err) {
      this.renderRefusal((err as Error).message);
    }
  }

  private renderRefusal(message: string): void {
    (window as unknown as { campfireLaunchError?: string }).campfireLaunchError = message;
    const { width, height } = this.scale;
    this.add.rectangle(0, 0, width, height, COLOR.bg, 1).setOrigin(0, 0);
    this.add
      .text(width / 2, height / 2 - 40, "This launch link can't start", { color: INK.bright, fontFamily: FONT.family, fontSize: FONT.title })
      .setOrigin(0.5);
    this.add
      .text(width / 2, height / 2, message, {
        color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.body, align: "center", wordWrap: { width: width - 80 },
      })
      .setOrigin(0.5, 0);
  }
}
