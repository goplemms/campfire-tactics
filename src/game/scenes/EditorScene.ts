import Phaser from "phaser";
import { CombatView } from "../combat-view";
import { COLOR, FONT, INK } from "../theme";
import { clearLayer } from "../ui";
import { TileGrid, TILE_HEIGHT, BANDIT_TEMPLATES, ENEMY_TEMPLATES, type GridCoord } from "../../core";
import { validateLevel } from "../../content/levels";
import { blankDraft, draftToEncounter, type Brush, type EditorDraft } from "../editor-draft";

/**
 * The **visual level editor** (D98) — `#editor`.
 *
 * A dev-only authoring surface that renders a draft {@link EditorDraft} with the same
 * {@link CombatView} the battle uses, painted by clicking tiles — killing the col/row bookkeeping
 * that hand-authoring an encounter otherwise needs. Board render + click-picking are pure reuse
 * (`CombatView.drawGrid` / `worldToTile`); the scene adds the draft, a brush-dispatched click loop,
 * and a live export that {@link draftToEncounter} turns into a pipeline-ready `AuthoredEncounter`.
 *
 * **M2:** the brush palette — Wall · Spawn · Enemy (template picker) · Captive (reach/lockpick) ·
 * Exit · Trap · Erase — plus adjustable grid size, live validation, and a **Download .json** that
 * drops straight into `content/levels/` to play via `#level=<id>`.
 */

const BOARD_SCALE = 1.3;
const PANEL_W = 320;

/** Every enemy template the palette offers (authored archetypes first, then the procedural pool). */
const ENEMY_IDS = [...Object.keys(BANDIT_TEMPLATES), ...ENEMY_TEMPLATES.map((t) => t.id)];

/** A short board label for a placed enemy token. */
const abbrev = (id: string) => (id.split("-").pop() || id).slice(0, 3);

export class EditorScene extends Phaser.Scene {
  private view!: CombatView;
  private gridGfx!: Phaser.GameObjects.Graphics;
  private overlayGfx!: Phaser.GameObjects.Graphics; // exit-tile tints
  private grid!: TileGrid;
  private markers: Phaser.GameObjects.GameObject[] = [];

  private draft: EditorDraft = blankDraft();
  private brush: Brush = "wall";
  private enemyTemplate = ENEMY_IDS[0];
  private captiveRelease: "reach" | "lockpick" = "lockpick";

  // DOM overlay (the D95 panel idiom).
  private panel?: HTMLDivElement;
  private exportPre?: HTMLPreElement;
  private validLine?: HTMLDivElement;
  private brushButtons: HTMLButtonElement[] = [];

  constructor() {
    super("EditorScene");
  }

  create(): void {
    this.cameras.main.setBackgroundColor(COLOR.bg);
    this.view = new CombatView(this);
    this.view.boardScale = BOARD_SCALE;
    this.gridGfx = this.add.graphics();
    this.overlayGfx = this.add.graphics().setDepth(0.5);

    this.add
      .text(12, 14, "Level Editor — pick a brush, click tiles", { color: INK.primary, fontFamily: FONT.family, fontSize: FONT.body })
      .setOrigin(0, 0.5)
      .setDepth(10);

    this.renderBoard();
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.mountPanel();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.unmountPanel());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.unmountPanel());
  }

  // --- Board render ---------------------------------------------------------

  private renderBoard(): void {
    this.grid = new TileGrid(this.draft.cols, this.draft.rows, this.draft.blocked);
    // Centre the board in the area left of the panel.
    const originX = (this.scale.width - PANEL_W) / 2;
    const originY = this.scale.height / 2 - (this.draft.rows * TILE_HEIGHT * BOARD_SCALE) / 2 + 4;
    this.view.setOrigin(originX, originY);

    this.gridGfx.clear();
    this.view.drawGrid(this.gridGfx, this.grid);

    this.overlayGfx.clear();
    for (const t of this.draft.exit) this.view.fillTile(this.overlayGfx, t, COLOR.exit, 0.28, COLOR.exit);

    clearLayer(this.markers);
    for (const s of this.draft.playerSpawns) this.mark(s, "P", COLOR.success, "#0d1a12");
    for (const e of this.draft.enemies) this.mark(e.pos, abbrev(e.templateId), COLOR.danger, "#fff");
    for (const c of this.draft.captives) this.mark(c.pos, c.release === "lockpick" ? "⚿" : "○", 0x9a6bc0, "#fff");
    for (const t of this.draft.traps) this.mark(t, "▲", COLOR.accent, "#1a1206");
  }

  /** A small labelled token centred on a tile (the editor's entity marker). */
  private mark(pos: GridCoord, label: string, fill: number, textColor: string): void {
    const { x, y } = this.view.tileToWorld(pos);
    const cy = y - this.view.halfH() * 0.25;
    this.markers.push(
      this.add.circle(x, cy, 12, fill).setStrokeStyle(1, 0x000000, 0.5).setDepth(2),
      this.add.text(x, cy, label, { color: textColor, fontFamily: FONT.family, fontSize: "12px", fontStyle: "bold" }).setOrigin(0.5).setDepth(3),
    );
  }

  // --- Click → paint --------------------------------------------------------

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    const t = this.view.worldToTile(pointer.worldX, pointer.worldY);
    if (!this.grid.inBounds(t)) return;
    this.paint(t);
    this.renderBoard();
    this.updateExport();
  }

  private paint(t: GridCoord): void {
    const d = this.draft;
    switch (this.brush) {
      case "wall": return void this.toggleCoord(d.blocked, t);
      case "spawn": return void this.toggleCoord(d.playerSpawns, t);
      case "exit": return void this.toggleCoord(d.exit, t);
      case "trap": return void this.toggleCoord(d.traps, t);
      case "enemy": {
        const i = d.enemies.findIndex((e) => same(e.pos, t));
        if (i >= 0) d.enemies.splice(i, 1);
        else d.enemies.push({ templateId: this.enemyTemplate, pos: t });
        return;
      }
      case "captive": {
        const i = d.captives.findIndex((c) => same(c.pos, t));
        if (i >= 0) d.captives.splice(i, 1);
        else d.captives.push({ pos: t, release: this.captiveRelease });
        return;
      }
      case "erase": {
        this.removeCoord(d.blocked, t); this.removeCoord(d.playerSpawns, t);
        this.removeCoord(d.exit, t); this.removeCoord(d.traps, t);
        d.enemies = d.enemies.filter((e) => !same(e.pos, t));
        d.captives = d.captives.filter((c) => !same(c.pos, t));
        return;
      }
    }
  }

  private toggleCoord(arr: GridCoord[], t: GridCoord): void {
    const i = arr.findIndex((c) => same(c, t));
    if (i >= 0) arr.splice(i, 1);
    else arr.push({ col: t.col, row: t.row });
  }
  private removeCoord(arr: GridCoord[], t: GridCoord): void {
    const i = arr.findIndex((c) => same(c, t));
    if (i >= 0) arr.splice(i, 1);
  }

  private resize(cols: number, rows: number): void {
    this.draft.cols = Math.max(1, Math.min(20, cols || 1));
    this.draft.rows = Math.max(1, Math.min(20, rows || 1));
    // Drop anything now off the board.
    const ok = (c: GridCoord) => c.col < this.draft.cols && c.row < this.draft.rows;
    const d = this.draft;
    d.blocked = d.blocked.filter(ok); d.playerSpawns = d.playerSpawns.filter(ok);
    d.exit = d.exit.filter(ok); d.traps = d.traps.filter(ok);
    d.enemies = d.enemies.filter((e) => ok(e.pos)); d.captives = d.captives.filter((c) => ok(c.pos));
    this.renderBoard();
    this.updateExport();
  }

  // --- Export ---------------------------------------------------------------

  private exportJson(): string {
    return JSON.stringify(draftToEncounter(this.draft), null, 2);
  }

  private download(): void {
    const blob = new Blob([this.exportJson()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${this.draft.id || "level"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // --- DOM palette (position:fixed, the debug-menu.ts idiom) ----------------

  private mountPanel(): void {
    const panel = document.createElement("div");
    Object.assign(panel.style, {
      position: "fixed", top: "8px", right: "8px", width: `${PANEL_W - 24}px`, maxHeight: "94vh", overflow: "auto",
      background: "rgba(20,18,16,0.95)", color: "#e8e0d0", font: "12px/1.4 ui-monospace, monospace",
      border: "1px solid #4a423a", borderRadius: "6px", padding: "10px", zIndex: "1000",
    } as CSSStyleDeclaration);

    panel.appendChild(this.field("id", this.draft.id, (v) => { this.draft.id = v; this.updateExport(); }));
    panel.appendChild(this.field("name", this.draft.name, (v) => { this.draft.name = v; this.updateExport(); }));

    // Grid size.
    const size = document.createElement("div");
    size.style.margin = "6px 0";
    size.append("size ");
    size.appendChild(this.numInput(this.draft.cols, (n) => this.resize(n, this.draft.rows)));
    size.append(" × ");
    size.appendChild(this.numInput(this.draft.rows, (n) => this.resize(this.draft.cols, n)));
    panel.appendChild(size);

    // Brush buttons.
    const brushes: Brush[] = ["wall", "spawn", "enemy", "captive", "exit", "trap", "erase"];
    const brushRow = document.createElement("div");
    brushRow.style.margin = "4px 0";
    for (const b of brushes) {
      const btn = document.createElement("button");
      btn.textContent = b;
      btn.dataset.brush = b;
      Object.assign(btn.style, { margin: "2px", cursor: "pointer", textTransform: "capitalize" } as CSSStyleDeclaration);
      btn.onclick = () => { this.brush = b; this.highlightBrush(); };
      this.brushButtons.push(btn);
      brushRow.appendChild(btn);
    }
    panel.appendChild(brushRow);

    // Contextual: enemy template + captive release.
    const tmplWrap = document.createElement("div");
    tmplWrap.style.margin = "4px 0";
    tmplWrap.append("enemy ");
    const tmpl = document.createElement("select");
    for (const id of ENEMY_IDS) { const o = document.createElement("option"); o.value = id; o.textContent = id; tmpl.appendChild(o); }
    tmpl.value = this.enemyTemplate;
    tmpl.onchange = () => (this.enemyTemplate = tmpl.value);
    tmplWrap.appendChild(tmpl);
    tmplWrap.append("  captive ");
    const rel = document.createElement("select");
    for (const r of ["lockpick", "reach"]) { const o = document.createElement("option"); o.value = r; o.textContent = r; rel.appendChild(o); }
    rel.value = this.captiveRelease;
    rel.onchange = () => (this.captiveRelease = rel.value as "reach" | "lockpick");
    tmplWrap.appendChild(rel);
    panel.appendChild(tmplWrap);

    const valid = document.createElement("div");
    valid.style.margin = "6px 0";
    panel.appendChild(valid);
    this.validLine = valid;

    const btns = document.createElement("div");
    const copy = document.createElement("button"); copy.textContent = "Copy"; copy.style.cursor = "pointer";
    copy.onclick = () => navigator.clipboard?.writeText(this.exportJson());
    const dl = document.createElement("button"); dl.textContent = "Download .json"; dl.style.cursor = "pointer"; dl.style.marginLeft = "6px";
    dl.onclick = () => this.download();
    btns.append(copy, dl);
    panel.appendChild(btns);

    const pre = document.createElement("pre");
    Object.assign(pre.style, { margin: "6px 0 0", whiteSpace: "pre-wrap", wordBreak: "break-word" } as CSSStyleDeclaration);
    panel.appendChild(pre);
    this.exportPre = pre;

    document.body.appendChild(panel);
    this.panel = panel;
    this.highlightBrush();
    this.updateExport();
  }

  private field(label: string, value: string, onChange: (v: string) => void): HTMLDivElement {
    const wrap = document.createElement("div");
    wrap.style.margin = "3px 0";
    wrap.append(`${label} `);
    const input = document.createElement("input");
    input.value = value;
    input.style.width = "180px";
    input.oninput = () => onChange(input.value);
    wrap.appendChild(input);
    return wrap;
  }
  private numInput(value: number, onChange: (n: number) => void): HTMLInputElement {
    const input = document.createElement("input");
    input.type = "number"; input.value = String(value); input.style.width = "48px";
    input.onchange = () => onChange(parseInt(input.value, 10));
    return input;
  }
  private highlightBrush(): void {
    for (const b of this.brushButtons) {
      const active = b.dataset.brush === this.brush;
      b.style.background = active ? "#c8a24a" : "";
      b.style.color = active ? "#1a1206" : "";
      b.style.fontWeight = active ? "700" : "";
    }
  }

  private updateExport(): void {
    if (this.exportPre) this.exportPre.textContent = this.exportJson();
    if (this.validLine) {
      const issues = validateLevel(draftToEncounter(this.draft));
      this.validLine.textContent = issues.length ? `⚠ ${issues.join("; ")}` : "✓ valid — ready to play";
      this.validLine.style.color = issues.length ? "#f0a0a0" : "#9ff0bf";
    }
  }

  private unmountPanel(): void {
    this.panel?.remove();
    this.panel = undefined;
    this.exportPre = undefined;
    this.validLine = undefined;
    this.brushButtons = [];
  }
}

/** Two grid coords are the same tile. */
function same(a: GridCoord, b: GridCoord): boolean {
  return a.col === b.col && a.row === b.row;
}
