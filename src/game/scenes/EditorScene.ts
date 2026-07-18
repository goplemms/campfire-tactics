import Phaser from "phaser";
import { CombatView } from "../combat-view";
import { BoardCamera } from "../board-camera";
import { COLOR, FONT } from "../theme";
import { clearLayer } from "../ui";
import { TileGrid, BANDIT_TEMPLATES, ENEMY_TEMPLATES, JOBS, type GridCoord, type AuthoredEncounter, type JobId } from "../../core";
import { validateLevel } from "../../content/levels";
import {
  blankDraft, draftToEncounter, encounterToDraft, newCaptiveSpec,
  effectiveEnemyStat, setEnemyStat, setSpecStat, STAT_FIELDS,
  type Brush, type EditorDraft, type DraftEnemy, type DraftCaptive, type StatField,
} from "../editor-draft";

/** Every registered job id — derived from the core {@link JOBS} registry (no hand-copy, D98). */
const JOB_IDS = Object.keys(JOBS);

/**
 * The panel drawers (D98 editor M-UI). Grouped by what you author, in genre-conventional terms:
 * **Terrain** (tiles/walls), **Units** (attributed entities), **Events** (the conditional-logic
 * layer — deploy/extraction markers now, objectives + future triggers later), **Scenario**
 * (meta + JSON I/O). The ✓/⚠ status bar sits outside the drawers so the live guards never hide.
 */
const TAB_NAMES = ["Terrain", "Units", "Events", "Scenario"] as const;
type TabName = (typeof TAB_NAMES)[number];

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
  private boardCam!: BoardCamera;
  private gridGfx!: Phaser.GameObjects.Graphics;
  private overlayGfx!: Phaser.GameObjects.Graphics; // exit-tile tints
  private previewGfx!: Phaser.GameObjects.Graphics; // the pending line/rect shape + its anchor
  private grid!: TileGrid;
  private markers: Phaser.GameObjects.GameObject[] = [];

  private draft: EditorDraft = blankDraft();
  private brush: Brush = "wall";
  private enemyTemplate = ENEMY_IDS[0];
  private captiveRelease: "reach" | "lockpick" = "lockpick";

  /** First tile of a two-click line/rect (M-D); the second click commits the shape. Null = no shape pending. */
  private shapeAnchor: GridCoord | null = null;
  /** Rectangle tool mode: an outline (a room/cell ring) vs a solid fill. */
  private rectFill = false;
  /** The tile under the cursor, for the coordinate readout + the live shape preview. */
  private hoveredTile: GridCoord | null = null;

  /** The entity under edit in the inspector (M-B). Stored by reference so it survives array reorders. */
  private selection: { kind: "enemy"; ref: DraftEnemy } | { kind: "captive"; ref: DraftCaptive } | null = null;

  // DOM overlay (the D95 panel idiom).
  private panel?: HTMLDivElement;
  private exportPre?: HTMLPreElement;
  private validLine?: HTMLDivElement;
  private coordEl?: HTMLDivElement; // live "tile (col,row)" readout under the cursor
  private inspectorEl?: HTMLDivElement;
  private unitListEl?: HTMLDivElement;
  private brushButtons: HTMLButtonElement[] = [];
  private tabButtons: HTMLButtonElement[] = [];
  private drawers: Partial<Record<TabName, HTMLDivElement>> = {};
  private activeTab: TabName = "Terrain";

  constructor() {
    super("EditorScene");
  }

  create(): void {
    this.cameras.main.setBackgroundColor(COLOR.bg);
    this.view = new CombatView(this);
    this.view.boardScale = BOARD_SCALE;
    this.gridGfx = this.add.graphics();
    this.overlayGfx = this.add.graphics().setDepth(0.5);
    this.previewGfx = this.add.graphics().setDepth(0.6);

    this.renderBoard();
    // Grab-and-drag panning + wheel zoom so a big board (a 20×20 level) is reachable on the
    // fixed 800×600 canvas; a genuine tap still paints via onTap (a drag only moves the camera).
    // All the editor's chrome lives in the DOM panel, so the whole scene is board content and
    // pans/zooms cleanly — the title line moved to the panel header.
    this.boardCam = new BoardCamera(this, { onTap: (p) => this.onTap(p) });
    // Hover drives the coordinate readout + the live line/rect preview (the shape tools are two-click,
    // so the pending run/box is shown between the anchor and the tile under the cursor).
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onHover, this);
    this.mountPanel();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.unmountPanel());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.unmountPanel());
  }

  // --- Board render ---------------------------------------------------------

  private renderBoard(): void {
    this.grid = new TileGrid(this.draft.cols, this.draft.rows, this.draft.blocked);
    // The shared board-centering (CombatView.centerOrigin) — same formula as the battle, so a
    // grid/tile change propagates here for free. Centre in the area left of the panel.
    this.view.centerOrigin(this.draft.rows, this.scale.height, (this.scale.width - PANEL_W) / 2);

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

  /** A genuine tap (not a camera drag) — dispatched by {@link BoardCamera}. worldX/worldY fold in camera scroll+zoom. */
  private onTap(pointer: Phaser.Input.Pointer): void {
    const t = this.view.worldToTile(pointer.worldX, pointer.worldY);
    if (!this.grid.inBounds(t)) return;
    if (this.brush === "line" || this.brush === "rect") this.shapeTap(t);
    else this.paint(t);
    this.renderBoard();
    this.renderInspector();
    this.renderUnitList();
    this.updateExport();
    this.drawShapePreview(); // reflect a just-set anchor before the next mouse move
    this.updateCoord();
  }

  /**
   * Hover: keep the coordinate readout live and, when a line/rect anchor is pending, preview the
   * shape that a second click would commit. worldX/worldY fold in the camera transform, so the read
   * stays correct at any pan/zoom. Skipped mid-pan (a drag isn't aiming a shape).
   */
  private onHover(pointer: Phaser.Input.Pointer): void {
    if (this.boardCam?.isDragging) return;
    const t = this.view.worldToTile(pointer.worldX, pointer.worldY);
    this.hoveredTile = this.grid.inBounds(t) ? t : null;
    this.updateCoord();
    this.drawShapePreview();
  }

  /**
   * A tap while the line/rect tool is active. The first tap drops the {@link shapeAnchor}; the second
   * commits every tile of the run (line) or box (rect) as a **wall** (set, not toggle — a shape adds
   * structure, it doesn't punch holes in what it overlaps), then clears the anchor.
   */
  private shapeTap(t: GridCoord): void {
    if (!this.shapeAnchor) {
      this.shapeAnchor = t;
      return;
    }
    const tiles = this.brush === "line" ? lineTiles(this.shapeAnchor, t) : rectTiles(this.shapeAnchor, t, this.rectFill);
    for (const c of tiles) if (!this.draft.blocked.some((b) => same(b, c))) this.draft.blocked.push(c);
    this.shapeAnchor = null;
    this.previewGfx.clear();
  }

  /** Wash the pending line/rect (anchor → hovered tile) so the shape reads before the second click. */
  private drawShapePreview(): void {
    this.previewGfx.clear();
    if (!this.shapeAnchor || (this.brush !== "line" && this.brush !== "rect")) return;
    const to = this.hoveredTile ?? this.shapeAnchor;
    const tiles = this.brush === "line" ? lineTiles(this.shapeAnchor, to) : rectTiles(this.shapeAnchor, to, this.rectFill);
    for (const c of tiles) this.view.fillTile(this.previewGfx, c, COLOR.accent, 0.3, COLOR.accent);
  }

  /** Drop any pending line/rect anchor + its preview (on a brush switch, resize, or import). */
  private cancelShape(): void {
    this.shapeAnchor = null;
    this.previewGfx?.clear();
    this.updateCoord();
  }

  /** Update the DOM coordinate readout with the tile under the cursor (or a dash when off-board). */
  private updateCoord(): void {
    if (!this.coordEl) return;
    const t = this.hoveredTile;
    const anchor = this.shapeAnchor ? ` · from (${this.shapeAnchor.col},${this.shapeAnchor.row})` : "";
    this.coordEl.textContent = `tile ${t ? `(${t.col},${t.row})` : "—"}${anchor}`;
  }

  private paint(t: GridCoord): void {
    const d = this.draft;
    switch (this.brush) {
      case "select": {
        const en = d.enemies.find((e) => same(e.pos, t));
        const cap = d.captives.find((c) => same(c.pos, t));
        if (en) this.selection = { kind: "enemy", ref: en };
        else if (cap) this.selection = { kind: "captive", ref: this.materializeCaptive(cap) };
        else this.selection = null;
        return;
      }
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
    this.cancelShape();
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

    // Panel header — the title (moved off the canvas so the scene pans/zooms cleanly) + the
    // camera-control hint. The board is grab-and-drag pannable and wheel-zoomable; Recenter resets.
    const header = document.createElement("div");
    header.style.margin = "0 0 6px";
    const title = document.createElement("div");
    title.textContent = "Level Editor — pick a brush, click tiles";
    Object.assign(title.style, { fontWeight: "700", color: "#c8a24a" } as CSSStyleDeclaration);
    header.appendChild(title);
    header.appendChild(this.hint("drag to pan · scroll to zoom · Recenter resets the view"));
    // Live tile-coordinate readout (M-D) — structural work needs precise alignment of cells/doorways.
    const coord = document.createElement("div");
    coord.dataset.role = "coord";
    Object.assign(coord.style, { margin: "2px 0 0", color: "#9fd0f0", fontVariantNumeric: "tabular-nums" } as CSSStyleDeclaration);
    header.appendChild(coord);
    this.coordEl = coord;
    this.updateCoord();
    panel.appendChild(header);

    // Tab bar + the persistent cross-cutting Erase tool and the view-reset control.
    const tabBar = document.createElement("div");
    tabBar.style.margin = "0 0 6px";
    this.tabButtons = [];
    for (const name of TAB_NAMES) {
      const t = document.createElement("button");
      t.textContent = name;
      t.dataset.tab = name;
      Object.assign(t.style, { margin: "1px", cursor: "pointer" } as CSSStyleDeclaration);
      t.onclick = () => this.showTab(name);
      this.tabButtons.push(t);
      tabBar.appendChild(t);
    }
    tabBar.append(" ");
    tabBar.appendChild(this.brushButton("erase")); // always reachable, whatever drawer is open
    const recenter = document.createElement("button");
    recenter.textContent = "Recenter";
    recenter.dataset.role = "recenter";
    Object.assign(recenter.style, { margin: "2px", cursor: "pointer" } as CSSStyleDeclaration);
    recenter.onclick = () => this.boardCam.recenter();
    tabBar.appendChild(recenter);
    panel.appendChild(tabBar);

    // Drawers — one per tab, shown/hidden by showTab.
    this.drawers = {};
    for (const name of TAB_NAMES) {
      const d = document.createElement("div");
      d.dataset.drawer = name;
      this.drawers[name] = d;
      panel.appendChild(d);
    }
    this.buildTerrainDrawer(this.drawers.Terrain!);
    this.buildUnitsDrawer(this.drawers.Units!);
    this.buildEventsDrawer(this.drawers.Events!);
    this.buildScenarioDrawer(this.drawers.Scenario!);

    // Persistent ✓/⚠ status bar (outside the drawers, so live guards never hide).
    const valid = document.createElement("div");
    valid.style.margin = "8px 0 0";
    panel.appendChild(valid);
    this.validLine = valid;

    document.body.appendChild(panel);
    this.panel = panel;
    this.showTab(this.activeTab);
    this.highlightBrush();
    this.renderUnitList();
    this.renderInspector();
    this.updateExport();
  }

  /** A brush toggle button (registered for highlight). */
  private brushButton(b: Brush): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.textContent = b;
    btn.dataset.brush = b;
    Object.assign(btn.style, { margin: "2px", cursor: "pointer", textTransform: "capitalize" } as CSSStyleDeclaration);
    btn.onclick = () => { this.brush = b; this.cancelShape(); this.highlightBrush(); };
    this.brushButtons.push(btn);
    return btn;
  }

  /** Show one drawer, hide the rest, highlight the active tab. */
  private showTab(name: TabName): void {
    this.activeTab = name;
    for (const key of TAB_NAMES) { const d = this.drawers[key]; if (d) d.style.display = key === name ? "" : "none"; }
    for (const b of this.tabButtons) {
      const active = b.dataset.tab === name;
      b.style.background = active ? "#c8a24a" : "";
      b.style.color = active ? "#1a1206" : "";
      b.style.fontWeight = active ? "700" : "";
    }
  }

  private hint(text: string): HTMLDivElement {
    const h = document.createElement("div");
    h.textContent = text;
    Object.assign(h.style, { opacity: "0.55", margin: "2px 0 4px" } as CSSStyleDeclaration);
    return h;
  }

  private buildTerrainDrawer(d: HTMLDivElement): void {
    const size = document.createElement("div");
    size.style.margin = "4px 0";
    size.append("size ");
    size.appendChild(this.numInput(this.draft.cols, (n) => this.resize(n, this.draft.rows)));
    size.append(" × ");
    size.appendChild(this.numInput(this.draft.rows, (n) => this.resize(this.draft.cols, n)));
    d.appendChild(size);
    const row = document.createElement("div");
    row.style.margin = "4px 0";
    row.append(this.brushButton("wall"), this.brushButton("line"), this.brushButton("rect"), this.brushButton("trap"));
    d.appendChild(row);

    // Rectangle mode: an outline (a room/cell ring) vs a solid fill. Toggled live.
    const rectMode = document.createElement("div");
    rectMode.style.margin = "4px 0";
    const modeBtn = document.createElement("button");
    modeBtn.dataset.role = "rect-mode";
    modeBtn.style.cursor = "pointer";
    const paintMode = () => (modeBtn.textContent = this.rectFill ? "rect: filled" : "rect: outline");
    paintMode();
    modeBtn.onclick = () => { this.rectFill = !this.rectFill; paintMode(); this.drawShapePreview(); };
    rectMode.appendChild(modeBtn);
    d.appendChild(rectMode);

    d.appendChild(this.hint("wall = one tile · line/rect = two clicks (anchor, then far tile) → a wall run/box"));
    d.appendChild(this.hint("rect outline = a cell/room ring (erase one tile for the door) · traps are hazards"));
  }

  private buildEventsDrawer(d: HTMLDivElement): void {
    const row = document.createElement("div");
    row.style.margin = "4px 0";
    row.append(this.brushButton("spawn"), this.brushButton("exit"));
    d.appendChild(row);
    d.appendChild(this.hint("deploy spawns · extraction exit · objectives + triggers coming next"));
  }

  private buildUnitsDrawer(d: HTMLDivElement): void {
    const row = document.createElement("div");
    row.style.margin = "4px 0";
    row.append(this.brushButton("select"), this.brushButton("enemy"), this.brushButton("captive"));
    d.appendChild(row);

    // Place-time defaults for the enemy/captive brushes.
    const ctx = document.createElement("div");
    ctx.style.margin = "4px 0";
    ctx.append("enemy ");
    const tmpl = document.createElement("select");
    for (const id of ENEMY_IDS) { const o = document.createElement("option"); o.value = id; o.textContent = id; tmpl.appendChild(o); }
    tmpl.value = this.enemyTemplate;
    tmpl.onchange = () => (this.enemyTemplate = tmpl.value);
    ctx.appendChild(tmpl);
    ctx.append("  captive ");
    const rel = document.createElement("select");
    for (const r of ["lockpick", "reach"]) { const o = document.createElement("option"); o.value = r; o.textContent = r; rel.appendChild(o); }
    rel.value = this.captiveRelease;
    rel.onchange = () => (this.captiveRelease = rel.value as "reach" | "lockpick");
    ctx.appendChild(rel);
    d.appendChild(ctx);

    // The unit list — click a row to select (reaches units occluded by the panel / off a wide board).
    const list = document.createElement("div");
    list.dataset.role = "unit-list";
    Object.assign(list.style, { margin: "4px 0", maxHeight: "112px", overflow: "auto", border: "1px solid #3a332c", borderRadius: "4px" } as CSSStyleDeclaration);
    d.appendChild(list);
    this.unitListEl = list;

    // The inspector (M-B).
    const inspector = document.createElement("div");
    inspector.dataset.role = "inspector";
    Object.assign(inspector.style, { margin: "6px 0 0", padding: "6px", border: "1px solid #4a423a", borderRadius: "4px", minHeight: "18px" } as CSSStyleDeclaration);
    d.appendChild(inspector);
    this.inspectorEl = inspector;
  }

  private buildScenarioDrawer(d: HTMLDivElement): void {
    d.appendChild(this.field("id", this.draft.id, (v) => { this.draft.id = v; this.updateExport(); }));
    d.appendChild(this.field("name", this.draft.name, (v) => { this.draft.name = v; this.updateExport(); }));

    // Import (the M-A round-trip inverse).
    const imp = document.createElement("div");
    imp.style.margin = "6px 0";
    const impArea = document.createElement("textarea");
    Object.assign(impArea.style, { width: "100%", height: "46px", font: "11px/1.3 ui-monospace, monospace", boxSizing: "border-box" } as CSSStyleDeclaration);
    impArea.placeholder = "paste level JSON to import…";
    impArea.dataset.role = "import";
    const impBtn = document.createElement("button");
    impBtn.textContent = "Import JSON"; impBtn.style.cursor = "pointer"; impBtn.dataset.role = "import-btn";
    impBtn.onclick = () => this.importJson(impArea.value);
    imp.append(impArea, impBtn);
    d.appendChild(imp);

    const btns = document.createElement("div");
    const copy = document.createElement("button"); copy.textContent = "Copy"; copy.style.cursor = "pointer";
    copy.onclick = () => navigator.clipboard?.writeText(this.exportJson());
    const dl = document.createElement("button"); dl.textContent = "Download .json"; dl.style.cursor = "pointer"; dl.style.marginLeft = "6px";
    dl.onclick = () => this.download();
    btns.append(copy, dl);
    d.appendChild(btns);

    const pre = document.createElement("pre");
    Object.assign(pre.style, { margin: "6px 0 0", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: "220px", overflow: "auto" } as CSSStyleDeclaration);
    d.appendChild(pre);
    this.exportPre = pre;
  }

  /** Render the Units-drawer list — a clickable row per placed enemy/captive (the occlusion fix). */
  private renderUnitList(): void {
    const host = this.unitListEl;
    if (!host) return;
    host.innerHTML = "";
    const rows: { ref: DraftEnemy | DraftCaptive; kind: "enemy" | "captive"; label: string }[] = [
      ...this.draft.enemies.map((e) => ({ ref: e, kind: "enemy" as const, label: `${e.templateId}${e.id ? ` · ${e.id}` : ""} (${e.pos.col},${e.pos.row})` })),
      ...this.draft.captives.map((c) => ({ ref: c, kind: "captive" as const, label: `${c.spec?.name ?? c.spec?.id ?? "captive"} (${c.pos.col},${c.pos.row})` })),
    ];
    if (!rows.length) { host.textContent = "· no units placed — use the enemy/captive brush"; host.style.opacity = "0.55"; return; }
    host.style.opacity = "1";
    for (const { ref, kind, label } of rows) {
      const r = document.createElement("div");
      r.textContent = label;
      r.dataset.unitRow = kind;
      const selected = this.selection?.ref === ref;
      // Tint by kind to match the board tokens (enemies red, captives purple), since the mono font
      // has no reliable glyph for ⚔/⚿.
      Object.assign(r.style, { padding: "2px 5px", cursor: "pointer", color: kind === "enemy" ? "#e6a5a5" : "#c3a6e0", background: selected ? "#4a3f2a" : "" } as CSSStyleDeclaration);
      r.onclick = () => {
        this.selection = kind === "enemy" ? { kind, ref: ref as DraftEnemy } : { kind, ref: this.materializeCaptive(ref as DraftCaptive) };
        this.renderInspector();
        this.renderUnitList();
      };
      host.appendChild(r);
    }
  }

  /**
   * Import a pasted level JSON into the draft (M-A) — **fail-loud**: a parse/shape/walkover error
   * shows in the validation line and the draft is left untouched. On success the panel is remounted
   * so every field reflects the imported level.
   */
  private importJson(text: string): void {
    let next: EditorDraft;
    try {
      const raw: unknown = JSON.parse(text);
      const issues = validateLevel(raw);
      if (issues.length) throw new Error(issues.join("; "));
      next = encounterToDraft(raw as AuthoredEncounter);
    } catch (err) {
      if (this.validLine) {
        this.validLine.textContent = `⚠ import failed: ${(err as Error).message}`;
        this.validLine.style.color = "#f0a0a0";
      }
      return;
    }
    this.draft = next;
    this.selection = null;
    this.cancelShape();
    this.renderBoard();
    this.unmountPanel();
    this.mountPanel();
  }

  // --- Inspector (M-B: edit a selected entity's identity + stats) ------------

  /** Re-render the inspector for the current selection (or a placeholder). Clears a stale selection. */
  private renderInspector(): void {
    const host = this.inspectorEl;
    if (!host) return;
    const sel = this.selection;
    if (sel) {
      const list: unknown[] = sel.kind === "enemy" ? this.draft.enemies : this.draft.captives;
      if (!list.includes(sel.ref)) this.selection = null;
    }
    host.innerHTML = "";
    if (!this.selection) {
      host.textContent = "· select-brush an entity to edit its identity + stats";
      host.style.opacity = "0.55";
      return;
    }
    host.style.opacity = "1";
    if (this.selection.kind === "enemy") this.renderEnemyInspector(host, this.selection.ref);
    else this.renderCaptiveInspector(host, this.selection.ref);
  }

  private renderEnemyInspector(host: HTMLDivElement, e: DraftEnemy): void {
    host.appendChild(this.inspectorHeader(`enemy · ${e.templateId} @ (${e.pos.col},${e.pos.row})`));
    host.appendChild(this.field("id", e.id ?? "", (v) => { const t = v.trim(); if (t) e.id = t; else delete e.id; this.afterInspect(); }));
    host.appendChild(this.selectRow("role", ["", "captain", "sapper"], e.role ?? "", (v) => { if (v) e.role = v as "captain" | "sapper"; else delete e.role; this.afterInspect(); }));
    host.appendChild(this.statGrid((f) => effectiveEnemyStat(e, f), (f, n) => { setEnemyStat(e, f, n); this.afterInspect(); }));
  }

  /** Give a painted (spec-less) captive an editable spec — at selection time, not during render. */
  private materializeCaptive(c: DraftCaptive): DraftCaptive {
    if (!c.spec) c.spec = newCaptiveSpec(c.pos);
    return c;
  }

  private renderCaptiveInspector(host: HTMLDivElement, c: DraftCaptive): void {
    const spec = c.spec;
    if (!spec) return; // materialized at selection; a spec-less captive never reaches here

    host.appendChild(this.inspectorHeader(`captive @ (${c.pos.col},${c.pos.row})`));
    host.appendChild(this.field("id", spec.id, (v) => { const t = v.trim(); if (t) spec.id = t; this.afterInspect(); }));
    host.appendChild(this.field("name", spec.name ?? "", (v) => { const t = v.trim(); if (t) spec.name = t; else delete spec.name; this.afterInspect(); }));
    host.appendChild(this.selectRow("role", ["prisoner", "", "captain", "sapper"], spec.role ?? "", (v) => { if (v) spec.role = v; else delete spec.role; this.afterInspect(); }));
    host.appendChild(this.selectRow("job", JOB_IDS, spec.jobId ?? "soldier", (v) => { spec.jobId = v as JobId; spec.primaryJob = v as JobId; this.afterInspect(); }));
    host.appendChild(this.selectRow("release", ["lockpick", "reach"], c.release, (v) => { c.release = v as "reach" | "lockpick"; this.afterInspect(); }));
    host.appendChild(this.statGrid((f) => (typeof spec[f] === "number" ? (spec[f] as number) : f === "attackRange" ? 1 : 0), (f, n) => { setSpecStat(spec, f, n); this.afterInspect(); }));
  }

  private inspectorHeader(text: string): HTMLDivElement {
    const h = document.createElement("div");
    h.textContent = text;
    Object.assign(h.style, { margin: "2px 0 4px", fontWeight: "700", color: "#c8a24a" } as CSSStyleDeclaration);
    return h;
  }

  /** A labelled `<select>` row. */
  private selectRow(label: string, options: string[], value: string, onChange: (v: string) => void): HTMLDivElement {
    const wrap = document.createElement("div");
    wrap.style.margin = "3px 0";
    wrap.append(`${label} `);
    const sel = document.createElement("select");
    sel.dataset.field = label;
    for (const o of options) { const opt = document.createElement("option"); opt.value = o; opt.textContent = o === "" ? "(none)" : o; sel.appendChild(opt); }
    sel.value = value;
    sel.onchange = () => onChange(sel.value);
    wrap.appendChild(sel);
    return wrap;
  }

  /** The 7-field combat stat grid (M-B), driven by the core-typed {@link STAT_FIELDS}. */
  private statGrid(get: (f: StatField) => number, set: (f: StatField, v: number) => void): HTMLDivElement {
    const wrap = document.createElement("div");
    wrap.style.margin = "4px 0";
    for (const f of STAT_FIELDS) {
      const cell = document.createElement("span");
      Object.assign(cell.style, { display: "inline-block", marginRight: "6px" } as CSSStyleDeclaration);
      cell.append(`${f} `);
      const inp = this.numInput(get(f), (n) => { if (Number.isFinite(n)) set(f, n); }); // ignore an emptied field (NaN)
      inp.style.width = "44px";
      inp.dataset.stat = f;
      cell.appendChild(inp);
      wrap.appendChild(cell);
    }
    return wrap;
  }

  /** After an inspector edit: refresh the board markers, the unit-list labels + the live export/validation (no re-render of the open form, to keep input focus). */
  private afterInspect(): void {
    this.renderBoard();
    this.renderUnitList();
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
    this.coordEl = undefined;
    this.inspectorEl = undefined;
    this.unitListEl = undefined;
    this.brushButtons = [];
    this.tabButtons = [];
    this.drawers = {};
  }
}

/** Two grid coords are the same tile. */
function same(a: GridCoord, b: GridCoord): boolean {
  return a.col === b.col && a.row === b.row;
}

/**
 * A straight **wall run** from `a` to `b`, snapped to the dominant axis (a prison's walls are
 * rectilinear, so a diagonal drag still yields a clean horizontal *or* vertical line rather than a
 * staircase). Inclusive of both endpoints.
 */
function lineTiles(a: GridCoord, b: GridCoord): GridCoord[] {
  const dCol = b.col - a.col;
  const dRow = b.row - a.row;
  const horizontal = Math.abs(dCol) >= Math.abs(dRow);
  const out: GridCoord[] = [];
  const n = horizontal ? Math.abs(dCol) : Math.abs(dRow);
  const stepCol = horizontal ? Math.sign(dCol) : 0;
  const stepRow = horizontal ? 0 : Math.sign(dRow);
  for (let i = 0; i <= n; i++) out.push({ col: a.col + stepCol * i, row: a.row + stepRow * i });
  return out;
}

/**
 * The tiles of the axis-aligned box spanned by `a` and `b`. `filled` fills the interior (a solid
 * block); otherwise only the **perimeter** ring is returned (a room/cell outline — the door is a
 * gap you erase afterward).
 */
function rectTiles(a: GridCoord, b: GridCoord, filled: boolean): GridCoord[] {
  const c0 = Math.min(a.col, b.col), c1 = Math.max(a.col, b.col);
  const r0 = Math.min(a.row, b.row), r1 = Math.max(a.row, b.row);
  const out: GridCoord[] = [];
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      if (filled || col === c0 || col === c1 || row === r0 || row === r1) out.push({ col, row });
    }
  }
  return out;
}
