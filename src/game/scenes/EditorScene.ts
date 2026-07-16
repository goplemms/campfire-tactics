import Phaser from "phaser";
import { CombatView } from "../combat-view";
import { COLOR, FONT, INK } from "../theme";
import { TileGrid, TILE_HEIGHT, type GridCoord } from "../../core";

/**
 * The **visual level editor** (D98, MVP M1) — `#editor`.
 *
 * A dev-only authoring surface that renders a draft {@link "../../core/authored".AuthoredEncounter}
 * with the same {@link CombatView} the battle uses, and lets you paint it by clicking tiles —
 * killing the hand-computed col/row bookkeeping that authoring an encounter in TS otherwise needs.
 * The board render + click-picking are pure reuse (`CombatView.drawGrid` / `worldToTile`); the
 * scene only adds the draft state, a click→mutate loop, and a live export.
 *
 * **M1 (this slice):** render a grid, click a tile to toggle a **blocked** wall, and a live DOM
 * panel that serializes the draft as you go. The brush palette (enemies / captives / spawns / exit
 * / traps), objectives, import, and the pasteable-literal export land in M2/M3.
 */

/** The mutable editor draft — a growing subset of `AuthoredEncounter` (M1: grid + walls). */
interface EditorDraft {
  id: string;
  name: string;
  cols: number;
  rows: number;
  blocked: GridCoord[];
}

const BOARD_SCALE = 1.4;

export class EditorScene extends Phaser.Scene {
  private view!: CombatView;
  private gridGfx!: Phaser.GameObjects.Graphics;
  private grid!: TileGrid;
  private draft: EditorDraft = { id: "new-level", name: "New Level", cols: 9, rows: 6, blocked: [] };

  // DOM overlay (the D95 panel idiom) — the live export + brush readout.
  private panel?: HTMLDivElement;
  private exportPre?: HTMLPreElement;

  constructor() {
    super("EditorScene");
  }

  create(): void {
    this.cameras.main.setBackgroundColor(COLOR.bg);
    this.view = new CombatView(this);
    this.view.boardScale = BOARD_SCALE;
    this.gridGfx = this.add.graphics();

    this.add
      .text(12, 14, "Level Editor — click a tile to toggle a wall", {
        color: INK.primary,
        fontFamily: FONT.family,
        fontSize: FONT.body,
      })
      .setOrigin(0, 0.5)
      .setDepth(10);

    this.renderBoard();

    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.mountPanel();

    // Tear the DOM panel down when the scene stops (no leak across a reboot).
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.unmountPanel());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.unmountPanel());
  }

  /** Rebuild the grid from the draft and repaint it (blocked tiles render as raised walls). */
  private renderBoard(): void {
    this.grid = new TileGrid(this.draft.cols, this.draft.rows, this.draft.blocked);
    const originX = this.scale.width / 2;
    const originY = this.scale.height / 2 - (this.draft.rows * TILE_HEIGHT * BOARD_SCALE) / 2 + 4;
    this.view.setOrigin(originX, originY);
    this.gridGfx.clear();
    this.view.drawGrid(this.gridGfx, this.grid);
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    const t = this.view.worldToTile(pointer.worldX, pointer.worldY);
    if (!this.grid.inBounds(t)) return;
    // Toggle the wall at the clicked tile.
    const i = this.draft.blocked.findIndex((b) => b.col === t.col && b.row === t.row);
    if (i >= 0) this.draft.blocked.splice(i, 1);
    else this.draft.blocked.push({ col: t.col, row: t.row });
    this.renderBoard();
    this.updateExport();
  }

  /** Serialize the current draft (M1: the grid shape) as an AuthoredEncounter-shaped object. */
  private exportDraft(): string {
    const sorted = [...this.draft.blocked].sort((a, b) => a.row - b.row || a.col - b.col);
    return JSON.stringify(
      { id: this.draft.id, name: this.draft.name, cols: this.draft.cols, rows: this.draft.rows, blocked: sorted },
      null,
      2,
    );
  }

  // --- The DOM overlay panel (position:fixed, the debug-menu.ts idiom) -------

  private mountPanel(): void {
    const panel = document.createElement("div");
    Object.assign(panel.style, {
      position: "fixed",
      top: "8px",
      right: "8px",
      width: "300px",
      maxHeight: "92vh",
      overflow: "auto",
      background: "rgba(20,18,16,0.94)",
      color: "#e8e0d0",
      font: "12px/1.4 ui-monospace, monospace",
      border: "1px solid #4a423a",
      borderRadius: "6px",
      padding: "10px",
      zIndex: "1000",
    } as CSSStyleDeclaration);

    const title = document.createElement("div");
    title.textContent = "Level draft (export)";
    Object.assign(title.style, { fontWeight: "700", marginBottom: "6px" } as CSSStyleDeclaration);

    const copy = document.createElement("button");
    copy.textContent = "Copy";
    Object.assign(copy.style, { float: "right", cursor: "pointer" } as CSSStyleDeclaration);
    copy.onclick = () => navigator.clipboard?.writeText(this.exportDraft());

    const pre = document.createElement("pre");
    Object.assign(pre.style, { margin: "0", whiteSpace: "pre-wrap", wordBreak: "break-word" } as CSSStyleDeclaration);

    title.appendChild(copy);
    panel.appendChild(title);
    panel.appendChild(pre);
    document.body.appendChild(panel);
    this.panel = panel;
    this.exportPre = pre;
    this.updateExport();
  }

  private updateExport(): void {
    if (this.exportPre) this.exportPre.textContent = this.exportDraft();
  }

  private unmountPanel(): void {
    this.panel?.remove();
    this.panel = undefined;
    this.exportPre = undefined;
  }
}
