import Phaser from "phaser";
import { buildScenarioRun } from "../../core";
import { getLevel, listLevels, levelToScenario } from "../../content/levels";
import { COLOR, FONT, INK } from "../theme";
import type { RunHandoff } from "../scenes/OverworldScene";

/**
 * `#level` boot (D98) — play a **JSON content level** standalone. `#level=<id>` wraps the
 * glob-loaded level in a throwaway scenario and reuses the one-node-run boot (the same path
 * `#scene` uses); bare `#level` lists every loaded level. The visual editor's export → a file
 * in `content/levels/` → here is the full "author a level, play it" loop.
 */

/** Turn a level `id` into a ready-to-hand {@link RunHandoff}; fail-loud on an unknown id. */
export function buildLevelBattle(id: string): RunHandoff {
  const level = getLevel(id);
  if (!level) {
    throw new Error(
      `buildLevelBattle: no level "${id}" ` +
        `(loaded: ${listLevels().map((l) => l.id).join(", ") || "none"})`,
    );
  }
  const { run, loop } = buildScenarioRun(levelToScenario(level));
  return { run, loop };
}

export class LevelBootScene extends Phaser.Scene {
  constructor() {
    super("LevelBootScene");
  }

  create(): void {
    const hash = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
    const m = hash.match(/^level=(.+)$/);
    if (m) {
      this.scene.start("BattleScene", buildLevelBattle(decodeURIComponent(m[1])));
      return;
    }
    this.renderMenu();
  }

  /** Bare `#level`: a clickable row per loaded content level. */
  private renderMenu(): void {
    const { width, height } = this.scale;
    this.add.rectangle(0, 0, width, height, COLOR.bg, 1).setOrigin(0, 0);
    this.add
      .text(width / 2, 44, "Content Levels — pick one to play", { color: INK.bright, fontFamily: FONT.family, fontSize: FONT.title })
      .setOrigin(0.5);

    const levels = listLevels();
    if (levels.length === 0) {
      this.add
        .text(width / 2, height / 2, "(no levels in content/levels/)", { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.body })
        .setOrigin(0.5);
      return;
    }
    levels.forEach((lvl, i) => {
      const row = this.add
        .text(width / 2, 110 + i * 30, `${lvl.name}  (#level=${lvl.id})`, { color: INK.primary, fontFamily: FONT.family, fontSize: FONT.body })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      row.on(Phaser.Input.Events.POINTER_OVER, () => row.setColor(INK.bright));
      row.on(Phaser.Input.Events.POINTER_OUT, () => row.setColor(INK.primary));
      row.on(Phaser.Input.Events.POINTER_DOWN, () => this.scene.start("BattleScene", buildLevelBattle(lvl.id)));
    });
  }
}
