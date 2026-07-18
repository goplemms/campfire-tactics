import Phaser from "phaser";
import { CombatView } from "../combat-view";
import { COLOR, FONT, INK } from "../theme";
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
  private gridGfx!: Phaser.GameObjects.Graphics;
  private overlayGfx!: Phaser.GameObjects.Graphics; // exit-tile tints
  private grid!: TileGrid;
  private markers: Phaser.GameObjects.GameObject[] = [];

  private draft: EditorDraft = blankDraft();
  private brush: Brush = "wall";
  private enemyTemplate = ENEMY_IDS[0];
  private captiveRelease: "reach" | "lockpick" = "lockpick";

  /** The entity under edit in the inspector (M-B). Stored by reference so it survives array reorders. */
  private selection: { kind: "enemy"; ref: DraftEnemy } | { kind: "captive"; ref: DraftCaptive } | null = null;

  // DOM overlay (the D95 panel idiom).
  private panel?: HTMLDivElement;
  private exportPre?: HTMLPreElement;
  private validLine?: HTMLDivElement;
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

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    const t = this.view.worldToTile(pointer.worldX, pointer.worldY);
    if (!this.grid.inBounds(t)) return;
    this.paint(t);
    this.renderBoard();
    this.renderInspector();
    this.renderUnitList();
    this.updateExport();
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

    // Tab bar + the persistent cross-cutting Erase tool.
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
    btn.onclick = () => { this.brush = b; this.highlightBrush(); };
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
    row.append(this.brushButton("wall"), this.brushButton("trap"));
    d.appendChild(row);
    d.appendChild(this.hint("walls block movement · traps are hazards (params in a later pass)"));
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
