import Phaser from "phaser";
import { FONT, INK } from "./theme";
import { ICON } from "./icons";
import type { CombatView } from "./combat-view";
import { type GridCoord, type EntityRegistry, isConcealedTrap } from "../core";

/**
 * The board **trap-marker layer** (#131): owns the two marker maps — the concealed
 * **enemy** traps (drawn once revealed / sprung) and the **player**-placed traps — plus
 * the `ptrap-N` id counter. It only manages the glyph GameObjects; the scene owns the
 * rules (reveal rolls, springs, disarm) and the turn triggers, and pushes markers onto its
 * `boardObjects` teardown list so a board rebuild tears them down with everything else.
 */
export class TrapMarkerLayer {
  /** Revealed concealed **enemy** traps, keyed by entity id (redrawn from the field). */
  private readonly enemy = new Map<string, Phaser.GameObjects.Text>();
  /** **Player**-placed trap markers, keyed by the `ptrap-N` id assigned at placement. */
  private readonly player = new Map<string, Phaser.GameObjects.Text>();
  private seq = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly view: CombatView,
    /** The scene's board-teardown list — markers ride it so a rebuild destroys them. */
    private readonly boardObjects: Phaser.GameObjects.GameObject[],
  ) {}

  /** Count of tracked enemy trap markers — folds into the "traps afield" turn reads. */
  get enemyCount(): number {
    return this.enemy.size;
  }

  /** The board marker for a player-placed trap (for the spring animation). */
  playerMarker(id: string): Phaser.GameObjects.Text | undefined {
    return this.player.get(id);
  }

  /** Fresh entity id for the next player trap (`ptrap-N`). */
  nextTrapId(): string {
    return `ptrap-${this.seq++}`;
  }

  /** Reset all markers + the id counter — a fresh encounter's board rebuild. */
  reset(): void {
    this.enemy.clear();
    this.player.clear();
    this.seq = 0;
  }

  /** Reset just the player markers + the id counter (a fresh deploy stage). */
  resetPlayer(): void {
    this.player.clear();
    this.seq = 0;
  }

  /** Register + draw the board marker for a just-placed player trap. */
  addPlayerTrap(id: string, pos: GridCoord): void {
    const { x, y } = this.view.tileToWorld(pos);
    const marker = this.scene.add.text(x, y - this.view.halfH(), ICON.trapMine.glyph, { color: INK.ember, fontFamily: FONT.family, fontSize: FONT.display }).setOrigin(0.5).setDepth(0.8);
    this.boardObjects.push(marker);
    this.player.set(id, marker);
  }

  /**
   * Sync the board markers to the concealed traps: a {@link ICON.trapArmed} on each
   * revealed armed trap, a faded {@link ICON.trapSprung} once sprung, and nothing for
   * disarmed (removed) ones.
   */
  redraw(entities: EntityRegistry): void {
    const traps = entities.all().filter(isConcealedTrap);
    for (const t of traps) {
      if (!t.revealed) continue;
      let m = this.enemy.get(t.id);
      if (!m) {
        const { x, y } = this.view.tileToWorld(t.pos);
        // Glyphs come from the icon registry (D59) — all verified to render in the UI font.
        m = this.scene.add.text(x, y - this.view.halfH(), ICON.trapArmed.glyph, { color: ICON.trapArmed.color, fontFamily: FONT.family, fontSize: FONT.display }).setOrigin(0.5).setDepth(0.85);
        this.boardObjects.push(m);
        this.enemy.set(t.id, m);
      }
      m.setText(t.sprung ? ICON.trapSprung.glyph : ICON.trapArmed.glyph).setColor(t.sprung ? INK.disabled : ICON.trapArmed.color);
    }
    // Drop markers for disarmed traps (no longer registered).
    for (const [id, m] of this.enemy) {
      if (!traps.some((t) => t.id === id)) {
        m.destroy();
        this.enemy.delete(id);
      }
    }
  }

  /** Destroy board markers for player traps no longer registered (after an undo). */
  syncPlayer(entities: EntityRegistry): void {
    for (const [id, m] of this.player) {
      if (!entities.all().some((e) => e.id === id)) {
        m.destroy();
        this.player.delete(id);
      }
    }
  }
}
