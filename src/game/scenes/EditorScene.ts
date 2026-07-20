import Phaser from "phaser";
import { CombatView } from "../combat-view";
import { BoardCamera } from "../board-camera";
import { COLOR, FONT } from "../theme";
import { clearLayer } from "../ui";
import { TileGrid, BANDIT_TEMPLATES, ENEMY_TEMPLATES, JOBS, OBJECTIVE_KINDS, type GridCoord, type AuthoredEncounter, type JobId, type ObjectiveSpec, type ObjectiveKind, type EncounterReward, type AuthoredGate, type AuthoredLever, type GateLock } from "../../core";
import { validateLevel } from "../../content/levels";
import { buildPlaytest, playtestPartyNames, DEFAULT_PLAYTEST_PARTY } from "../playtest";
import { loadWorking, saveWorking, loadLibrary, saveToLibrary, deleteFromLibrary, type SavedMap } from "../editor-storage";
import type { RunHandoff } from "./OverworldScene";
import {
  blankDraft, draftToEncounter, encounterToDraft, newCaptiveSpec, standardObjectives,
  effectiveEnemyStat, setEnemyStat, setSpecStat, STAT_FIELDS,
  type Brush, type EditorDraft, type DraftEnemy, type DraftCaptive, type StatField,
} from "../editor-draft";

/** Every registered job id — derived from the core {@link JOBS} registry (no hand-copy, D98). */
const JOB_IDS = Object.keys(JOBS);

/**
 * The panel drawers (D98 editor M-UI). Grouped by **what kind of thing** you author, so a painted
 * *substrate* and a *placed object* never share a palette (the D103 categorization): **Terrain**
 * (the walls/floor substrate you paint — single/line/rect), **Objects** (discrete placeable elements
 * with their own properties — gates · levers · traps), **Units** (attributed entities — enemies ·
 * captives), **Events** (the conditional-logic layer — deploy/extraction markers + objectives),
 * **Scenario** (meta + JSON I/O). The ✓/⚠ status bar sits outside the drawers so the live guards
 * never hide; the inspector is persistent so selecting *any* object edits it wherever you are.
 */
const TAB_NAMES = ["Terrain", "Objects", "Units", "Events", "Scenario"] as const;
type TabName = (typeof TAB_NAMES)[number];

/** Single-key brush shortcuts (lower-cased key → brush). Mnemonic where it can be; ignored while typing. */
const BRUSH_HOTKEYS: Record<string, Brush> = {
  w: "wall", l: "line", r: "rect", // Terrain
  g: "gate", v: "lever", t: "trap", // Objects (v = leVer/valve)
  n: "enemy", c: "captive", // Units (n = eNemy)
  p: "spawn", x: "exit", // Events (p = Player spawn, x = eXit)
  s: "select", e: "erase", // cross-cutting tools
};
/** A brush's home tab — a hotkey jumps to it so the just-picked card is visible. Tools (select/erase) stay put. */
const BRUSH_TAB: Partial<Record<Brush, TabName>> = {
  wall: "Terrain", line: "Terrain", rect: "Terrain",
  gate: "Objects", lever: "Objects", trap: "Objects",
  enemy: "Units", captive: "Units",
  spawn: "Events", exit: "Events",
};
/** Cap the undo history so a long editing session can't grow the snapshot stacks without bound. */
const HISTORY_MAX = 60;

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

/** Every enemy template the palette offers (authored archetypes first, then the procedural pool). */
const ENEMY_IDS = [...Object.keys(BANDIT_TEMPLATES), ...ENEMY_TEMPLATES.map((t) => t.id)];

/** A short board label for a placed enemy token. */
const abbrev = (id: string) => (id.split("-").pop() || id).slice(0, 3);

/** Editor display prefs (D109 slice 2) — chosen live in the dock's options row, persisted per browser. */
interface EditorPrefs {
  cardSize: number; // slab-tray card width in px (62 compact · 78 default · 96 large)
  enemyTint: "red" | "role"; // uniform danger-red ring vs an archetype-role ring (board + cards)
  captiveVariants: 1 | 2; // one lockpick captive card, or lockpick + reach
}
const PREFS_KEY = "campfire-editor-prefs";
const DEFAULT_PREFS: EditorPrefs = { cardSize: 78, enemyTint: "red", captiveVariants: 1 };
function loadEditorPrefs(): EditorPrefs {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(PREFS_KEY) : null;
    const p = raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<EditorPrefs>) } : { ...DEFAULT_PREFS };
    // Sanitize each field back to a known-good value — a manually-tampered store or a future
    // shape change can't wedge the tray with e.g. a "huge" card width or captiveVariants: 9.
    return {
      cardSize: [62, 78, 96].includes(p.cardSize) ? p.cardSize : DEFAULT_PREFS.cardSize,
      enemyTint: p.enemyTint === "role" ? "role" : "red",
      captiveVariants: p.captiveVariants === 2 ? 2 : 1,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}
function saveEditorPrefs(p: EditorPrefs): void {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* ignore quota/denied */ }
}
/** Per-archetype role ring colour for the "role" tint option (the token body stays enemy-red so the
 *  board's red=enemy convention holds — only the ring carries the archetype). */
const ROLE_TINT: Record<string, string> = {
  "bandit-thug": "#e06b6b", "bandit-bowman": "#e0b24a", "bandit-cutthroat": "#c07fd0",
  "snare-trapper": "#4fb0a0", sapper: "#e0843a", "bandit-captain": "#f0c060",
  goblin: "#9bd66f", brute: "#e06b6b", archer: "#e0b24a", warg: "#c07fd0", thief: "#9a6bd0",
};
const enemyRing = (id: string, tint: EditorPrefs["enemyTint"]): string =>
  tint === "role" ? (ROLE_TINT[id] ?? "#6b1c1c") : "#6b1c1c";
/** "#e0b24a" → 0xe0b24a, for a Phaser stroke colour. */
const hexToNum = (hex: string): number => parseInt(hex.replace("#", ""), 16);

/** A template's base combat stats for a card face (looks up either roster map). */
function enemyStat(id: string): { hp: number; atk: number } {
  const t = (BANDIT_TEMPLATES as Record<string, { maxHp: number; attack: number }>)[id] ?? ENEMY_TEMPLATES.find((e) => e.id === id);
  return t ? { hp: t.maxHp, atk: t.attack } : { hp: 0, atk: 0 };
}
/** A display name for an enemy card ("bandit-thug" → "Bandit Thug", "sapper" → "Sapper"). */
function enemyLabel(id: string): string {
  return id.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
/** Slab-tray thumbnails (D109 slice 2) — mirror the board's markers so a card reads as the tile it paints. */
function tokenThumb(glyph: string, fill: string, ring: string, ink: string): string {
  return `<svg width="30" height="30" viewBox="0 0 30 30"><ellipse cx="15" cy="24" rx="10" ry="4" fill="#00000055"/><circle cx="15" cy="14" r="10" fill="${fill}" stroke="${ring}" stroke-width="2.5"/><text x="15" y="18" text-anchor="middle" font-size="10" font-family="monospace" font-weight="700" fill="${ink}">${glyph}</text></svg>`;
}
function glyphThumb(g: string, color: string): string {
  return `<svg width="30" height="30" viewBox="0 0 30 30"><text x="15" y="22" text-anchor="middle" font-size="20" font-weight="700" fill="${color}">${g}</text></svg>`;
}
function blockThumb(): string {
  return `<svg width="34" height="30" viewBox="0 0 34 30"><polygon points="17,3 32,11 17,19 2,11" fill="#7a6450" stroke="#1c130c"/><polygon points="2,11 17,19 17,27 2,19" fill="#382b1e" stroke="#1c130c"/><polygon points="32,11 17,19 17,27 32,19" fill="#52412f" stroke="#1c130c"/></svg>`;
}
function lineThumb(): string {
  return `<svg width="30" height="30" viewBox="0 0 30 30"><line x1="5" y1="24" x2="25" y2="6" stroke="#c8a24a" stroke-width="3" stroke-linecap="round"/></svg>`;
}
function rectThumb(): string {
  return `<svg width="30" height="30" viewBox="0 0 30 30"><rect x="6" y="8" width="18" height="14" fill="none" stroke="#c8a24a" stroke-width="2.5"/></svg>`;
}

/** A coarse "saved N ago" label for the library list (ms since a save → just now / Nm / Nh / Nd). */
function relTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 60_000) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export class EditorScene extends Phaser.Scene {
  private view!: CombatView;
  private boardCam!: BoardCamera;
  private gridGfx!: Phaser.GameObjects.Graphics;
  private overlayGfx!: Phaser.GameObjects.Graphics; // exit-tile tints
  private previewGfx!: Phaser.GameObjects.Graphics; // the pending line/rect shape + its anchor
  private grid!: TileGrid;
  private markers: Phaser.GameObjects.GameObject[] = [];

  private draft: EditorDraft = blankDraft();
  /** One-shot: restore the autosaved working draft on the FIRST boot only, not on a playtest return. */
  private restored = false;
  /** The squad the next soft-play (Playtest) will field — chosen in the Scenario tab's picker. */
  private playtestParty: string = DEFAULT_PLAYTEST_PARTY;
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
  private selection:
    | { kind: "enemy"; ref: DraftEnemy }
    | { kind: "captive"; ref: DraftCaptive }
    | { kind: "gate"; ref: AuthoredGate }
    | { kind: "lever"; ref: AuthoredLever }
    | null = null;
  /** Auto-increment counters for object ids (gate-1, lever-1, …). */
  private objectSeq = 0;

  /**
   * The in-progress paint/erase stroke (drag-to-paint). A press on a paint brush (or a right-click
   * from any brush) opens one; each tile the cursor sweeps applies the same `op` once — so a drag
   * lays a continuous run. `op`: "add"/"remove" set/clear the active terrain brush; "erase" clears
   * everything on the tile. Null when no press is painting (a hover, a pan, a click-only brush).
   */
  private stroke: { op: "add" | "remove" | "erase"; last: GridCoord; painted: Set<string> } | null = null;
  /** Whole-draft undo/redo stacks (a snapshot per committed edit; a whole stroke is one entry). */
  private undoStack: EditorDraft[] = [];
  private redoStack: EditorDraft[] = [];
  private undoBtn?: HTMLButtonElement;
  private redoBtn?: HTMLButtonElement;
  /** The form control whose edits are coalescing into one undo entry (null between edits). See {@link onPanelEdit}. */
  private lastEditTarget: EventTarget | null = null;
  /** Bound so the same reference detaches on teardown. Keyboard + form-edit hooks live on `window`. */
  private readonly hKeyDown = (ev: KeyboardEvent) => this.onKeyDown(ev);
  private readonly hPanelEdit = (ev: Event) => this.onPanelEdit(ev);

  // DOM overlay (the D95 panel idiom). The panel now mounts in-flow inside {@link dock}, a
  // full-width slab tray BELOW the canvas (D98 placement pass), instead of the old fixed
  // top-right column — so the board keeps full canvas width and the chrome never overlaps it.
  private panel?: HTMLDivElement;
  private dock?: HTMLDivElement;
  /** The slide-in side drawer (D109 slice 2) — the "edit a placed object" surface (unit list +
   *  inspector). Board stays full-size while it's open; auto-opens on Select, toggled by "Details". */
  private sideDrawer?: HTMLDivElement;
  private drawerOpen = false;
  private exportPre?: HTMLPreElement;
  private validLine?: HTMLDivElement;
  private coordEl?: HTMLDivElement; // live "tile (col,row)" readout under the cursor
  private inspectorEl?: HTMLDivElement;
  private unitListEl?: HTMLDivElement;
  private objectivesEl?: HTMLDivElement; // the M-C objectives editor list
  private libraryEl?: HTMLDivElement; // the saved-maps list (D-editor local persistence)
  private brushButtons: HTMLButtonElement[] = [];
  /** Slab-tray placeable cards (D109 slice 2) — a thumbnail per brush; enemy templates are unrolled
   *  one card each. `template`/`release` ride the click so a card sets the brush AND its variant. */
  private paletteCards: { el: HTMLButtonElement; brush: Brush; template?: string; release?: "reach" | "lockpick" }[] = [];
  /** Per-tab empty card strips, filled/refilled by {@link fillPalette} whenever a display pref changes. */
  private paletteStrips: Partial<Record<TabName, HTMLDivElement>> = {};
  /** Live display prefs (card size · enemy tint · captive variants), chosen in the options row. */
  private prefs: EditorPrefs = loadEditorPrefs();
  /** Repaint closures for the options-row toggles (refresh the active highlight after a pref change). */
  private optionButtons: (() => void)[] = [];
  private tabButtons: HTMLButtonElement[] = [];
  private drawers: Partial<Record<TabName, HTMLDivElement>> = {};
  private activeTab: TabName = "Terrain";

  constructor() {
    super("EditorScene");
  }

  create(): void {
    // Editor-only page layout (D98): top-align the canvas + hide the guild run-bar + swap #app
    // off grid-centring so Phaser's Scale.FIT owns sizing. Paired with the editorScale in config.ts.
    document.body.classList.add("editor-mode");
    // Autosave restore (D-editor): on the FIRST boot only, pick up the last working draft from
    // localStorage so a reload never loses in-progress work. Guarded by `restored` so returning
    // from a playtest (which re-runs create on the same instance) keeps the in-memory draft.
    if (!this.restored) {
      this.restored = true;
      const working = loadWorking();
      if (working) this.draft = working;
    }
    this.cameras.main.setBackgroundColor(COLOR.bg);
    this.view = new CombatView(this);
    this.view.boardScale = BOARD_SCALE;
    this.gridGfx = this.add.graphics();
    this.overlayGfx = this.add.graphics().setDepth(0.5);
    this.previewGfx = this.add.graphics().setDepth(0.6);

    this.renderBoard();
    // Grab-and-drag panning + wheel zoom so a big board (a 20×20 level) is reachable on the
    // fixed 800×600 canvas; a genuine tap still paints via onTap. Panning is gated behind Shift
    // (a QoL ask) so a plain drag no longer steals the gesture from painting — hold Shift to pan,
    // and the cursor flips from the crosshair to the grab hand to show it. All the editor's chrome
    // lives in the DOM panel, so the whole scene is board content and pans/zooms cleanly.
    this.boardCam = new BoardCamera(this, { onTap: (p) => this.onTap(p), panModifier: "shift", idleCursor: "crosshair" });
    // Hover drives the coordinate readout + the live line/rect preview (the shape tools are two-click,
    // so the pending run/box is shown between the anchor and the tile under the cursor). The same move
    // stream also advances an in-progress paint/erase stroke (drag-to-paint).
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onHover, this);
    // Press-drag painting: a press opens a stroke (paint brushes) or a right-click erases; the release
    // ends it. BoardCamera already owns left-button pan/tap, so these coexist (left-no-modifier drags
    // paint, shift-drags pan, right-drags erase). Right-click needs the browser context menu off.
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onPointerUp, this);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onPointerUp, this);
    this.input.mouse?.disableContextMenu();
    this.mountPanel();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.unmountPanel());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.unmountPanel());
  }

  // --- Board render ---------------------------------------------------------

  private renderBoard(): void {
    this.grid = new TileGrid(this.draft.cols, this.draft.rows, this.draft.blocked);
    // The shared board-centering (CombatView.centerOrigin) — same formula as the battle, so a
    // grid/tile change propagates here for free. The chrome now lives in the slab tray BELOW the
    // canvas (not a right column), so the board centres in the FULL canvas width (D98).
    this.view.centerOrigin(this.draft.rows, this.scale.height, this.scale.width / 2);

    this.gridGfx.clear();
    this.view.drawGrid(this.gridGfx, this.grid);

    this.overlayGfx.clear();
    for (const t of this.draft.exit) this.view.fillTile(this.overlayGfx, t, COLOR.exit, 0.28, COLOR.exit);

    clearLayer(this.markers);
    for (const s of this.draft.playerSpawns) this.mark(s, "P", COLOR.success, "#0d1a12");
    for (const e of this.draft.enemies) {
      // Role tint (D109 slice 2): keep the red body (red = enemy) but ring the token in the archetype's
      // role colour so the board matches the tinted cards. Uniform red → the default dark ring.
      const ring = this.prefs.enemyTint === "role" ? hexToNum(enemyRing(e.templateId, "role")) : undefined;
      this.mark(e.pos, abbrev(e.templateId), COLOR.danger, "#fff", ring);
    }
    for (const c of this.draft.captives) this.mark(c.pos, c.release === "lockpick" ? "⚿" : "○", 0x9a6bc0, "#fff");
    for (const t of this.draft.traps) this.mark(t, "▲", COLOR.accent, "#1a1206");
    // Gates (▦) tagged with a letter per open-condition (L/K/D); a selected object rings gold.
    for (const g of this.draft.gates) this.mark(g.pos, `▦${gateTag(g)}`, this.selection?.ref === g ? COLOR.gold : COLOR.accent, "#1a1206");
    for (const l of this.draft.levers) this.mark(l.pos, "⎇", this.selection?.ref === l ? COLOR.gold : 0x62c6d6, "#08161a");
  }

  /** A small labelled token centred on a tile (the editor's entity marker). */
  private mark(pos: GridCoord, label: string, fill: number, textColor: string, ring?: number): void {
    const { x, y } = this.view.tileToWorld(pos);
    const cy = y - this.view.halfH() * 0.25;
    const circle = this.add.circle(x, cy, 12, fill).setDepth(2);
    if (ring !== undefined) circle.setStrokeStyle(2.5, ring, 1); // role-tinted archetype ring (D109)
    else circle.setStrokeStyle(1, 0x000000, 0.5);
    this.markers.push(
      circle,
      this.add.text(x, cy, label, { color: textColor, fontFamily: FONT.family, fontSize: "12px", fontStyle: "bold" }).setOrigin(0.5).setDepth(3),
    );
  }

  // --- Click → paint --------------------------------------------------------

  /**
   * A genuine tap (or a click-only brush's click) — dispatched by {@link BoardCamera}. A drag-paint /
   * right-click stroke owns its own gesture, so if one is active this release is only its terminator:
   * skip. worldX/worldY fold in camera scroll+zoom. Modifier-clicks override the active brush: Ctrl/⌘ =
   * quick-select, Alt = eyedropper (adopt the brush under the cursor).
   */
  private onTap(pointer: Phaser.Input.Pointer): void {
    if (this.stroke) return;
    const t = this.view.worldToTile(pointer.worldX, pointer.worldY);
    if (!this.grid.inBounds(t)) return;
    const ev = pointer.event as (Event & { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }) | undefined;
    if (ev?.ctrlKey || ev?.metaKey) this.selectAt(t);
    else if (ev?.altKey) this.eyedropAt(t);
    else if (this.brush === "line" || this.brush === "rect") this.shapeTap(t); // snapshots on commit
    else if (this.brush === "select") this.selectAt(t);
    else { this.pushHistory(); this.paint(t); } // entity placement (or a terrain click begun off-board)
    this.afterBoardEdit();
    this.drawShapePreview(); // reflect a just-set anchor before the next mouse move
  }

  /**
   * Hover: keep the coordinate readout live and, when a line/rect anchor is pending, preview the
   * shape that a second click would commit. worldX/worldY fold in the camera transform, so the read
   * stays correct at any pan/zoom. Skipped mid-pan (a drag isn't aiming a shape).
   */
  private onHover(pointer: Phaser.Input.Pointer): void {
    if (this.boardCam?.isDragging) return; // a shift-pan is moving the camera, not aiming a tile
    const t = this.view.worldToTile(pointer.worldX, pointer.worldY);
    this.hoveredTile = this.grid.inBounds(t) ? t : null;
    this.updateCoord();
    this.drawShapePreview();
    // Advance an in-progress stroke: apply its op to every tile between the last painted one and here,
    // so a fast drag lays a continuous run rather than dotting only the sampled points.
    if (this.stroke) {
      // A stroke only advances while the button is still down. If a pointer-up was missed (focus loss,
      // pointercancel), terminate it here — otherwise a bare hover would paint every tile it crosses.
      if (!pointer.isDown) { this.onPointerUp(); return; }
      if (this.hoveredTile) {
        for (const c of lineTiles(this.stroke.last, this.hoveredTile)) {
          const k = `${c.col},${c.row}`;
          if (!this.stroke.painted.has(k)) { this.applyStroke(c); this.stroke.painted.add(k); }
        }
        this.stroke.last = this.hoveredTile;
        this.renderBoard(); // cheap per-tile canvas redraw; the heavy DOM/export refresh waits for pointer-up
      }
    }
  }

  // --- Drag-to-paint (press-drag strokes) -----------------------------------

  /** Open a stroke on a press: a paint brush adds/clears along a left drag; a right-click erases from any brush. */
  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    const right = pointer.button === 2;
    if (pointer.button !== 0 && !right) return; // only left / right open a stroke
    const ev = pointer.event as (Event & { shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean }) | undefined;
    // A modified left press is a pan / select / eyedrop gesture (handled elsewhere) — never a paint stroke.
    if (!right && (ev?.shiftKey || ev?.ctrlKey || ev?.altKey || ev?.metaKey)) return;
    const t = this.view.worldToTile(pointer.worldX, pointer.worldY);
    if (!this.grid.inBounds(t)) return;
    const arr = this.brushArrayFor(this.brush);
    let op: "add" | "remove" | "erase" | null;
    if (right || this.brush === "erase") op = "erase";
    else if (arr) op = arr.some((c) => same(c, t)) ? "remove" : "add"; // first tile's state fixes the whole stroke
    else op = null; // select / line / rect / entity brushes stay click-driven (onTap)
    if (!op) return;
    this.pushHistory();
    this.stroke = { op, last: t, painted: new Set([`${t.col},${t.row}`]) };
    this.applyStroke(t);
    this.renderBoard();
  }

  /** Close the active stroke and flush the one full (DOM-heavy) refresh on release. */
  private onPointerUp(): void {
    if (!this.stroke) return;
    this.stroke = null;
    this.afterBoardEdit();
  }

  /** Apply one tile of the current stroke: set/clear the brush's terrain, or erase everything on it. */
  private applyStroke(t: GridCoord): void {
    if (!this.stroke) return;
    if (this.stroke.op === "erase") return void this.eraseAt(t);
    const arr = this.brushArrayFor(this.brush);
    if (!arr) return;
    if (this.stroke.op === "add") { if (!arr.some((c) => same(c, t))) arr.push({ col: t.col, row: t.row }); }
    else this.removeCoord(arr, t);
  }

  /** The coord array a toggle-terrain brush paints into (null for shape / entity / tool brushes). */
  private brushArrayFor(brush: Brush): GridCoord[] | null {
    const d = this.draft;
    switch (brush) {
      case "wall": return d.blocked;
      case "spawn": return d.playerSpawns;
      case "exit": return d.exit;
      case "trap": return d.traps;
      default: return null;
    }
  }

  /** Clear every placeable off a tile — the Erase brush's action, shared by right-click / right-drag erase. */
  private eraseAt(t: GridCoord): void {
    const d = this.draft;
    this.removeCoord(d.blocked, t); this.removeCoord(d.playerSpawns, t);
    this.removeCoord(d.exit, t); this.removeCoord(d.traps, t);
    d.enemies = d.enemies.filter((e) => !same(e.pos, t));
    d.captives = d.captives.filter((c) => !same(c.pos, t));
    d.gates = d.gates.filter((g) => !same(g.pos, t));
    d.levers = d.levers.filter((l) => !same(l.pos, t));
  }

  /** The full post-edit refresh — rebuild the board + every dependent panel + export + history buttons. */
  private afterBoardEdit(): void {
    this.renderBoard();
    this.renderInspector();
    this.renderUnitList();
    this.renderObjectives(); // keep an extraction row's "span = N exit tiles" note fresh as exit changes
    this.updateExport();
    this.updateCoord();
    this.refreshHistoryButtons();
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
    this.pushHistory(); // the commit (second click) is the undoable edit; dropping the anchor isn't
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

  /**
   * Pick the object under a tile into the inspector — the Select brush's action, also reachable as a
   * Ctrl-click quick-select from any brush. Rings the object gold + opens the drawer; an empty tile clears.
   */
  private selectAt(t: GridCoord): void {
    const d = this.draft;
    const en = d.enemies.find((e) => same(e.pos, t));
    const cap = d.captives.find((c) => same(c.pos, t));
    const gate = d.gates.find((g) => same(g.pos, t));
    const lever = d.levers.find((l) => same(l.pos, t));
    if (en) this.selection = { kind: "enemy", ref: en };
    else if (cap) this.selection = { kind: "captive", ref: this.materializeCaptive(cap) };
    else if (gate) this.selection = { kind: "gate", ref: gate };
    else if (lever) this.selection = { kind: "lever", ref: lever };
    else this.selection = null;
    if (this.selection) this.openDrawer(); // reveal the inspector on the selected object (board stays full-size)
  }

  /**
   * Alt-click eyedropper: adopt the brush that would (re)create the object under the cursor — an enemy →
   * its archetype, a captive → its release, a gate/lever/trap, or a terrain marker — and jump to its tab.
   * An empty tile keeps the current brush.
   */
  private eyedropAt(t: GridCoord): void {
    const d = this.draft;
    const en = d.enemies.find((e) => same(e.pos, t));
    const cap = d.captives.find((c) => same(c.pos, t));
    if (en) { this.enemyTemplate = en.templateId; return void this.pickBrush("enemy"); }
    if (cap) { this.captiveRelease = cap.release; return void this.pickBrush("captive"); }
    if (d.gates.some((g) => same(g.pos, t))) return void this.pickBrush("gate");
    if (d.levers.some((l) => same(l.pos, t))) return void this.pickBrush("lever");
    if (d.traps.some((c) => same(c, t))) return void this.pickBrush("trap");
    if (d.playerSpawns.some((c) => same(c, t))) return void this.pickBrush("spawn");
    if (d.exit.some((c) => same(c, t))) return void this.pickBrush("exit");
    if (d.blocked.some((c) => same(c, t))) return void this.pickBrush("wall");
  }

  /** Set the active brush + drop any pending shape + refresh the palette highlight (the one entry point). */
  private setBrush(b: Brush): void {
    this.brush = b;
    this.cancelShape();
    this.highlightBrush();
  }

  /** Pick a brush AND jump to its home tab so the chosen card is visible (hotkeys + eyedropper). */
  private pickBrush(b: Brush): void {
    const tab = BRUSH_TAB[b];
    if (tab) this.showTab(tab);
    this.setBrush(b);
  }

  /** Drop the current inspector selection (Esc) — clears the gold ring + empties the inspector. */
  private clearSelection(): void {
    if (!this.selection) return;
    this.selection = null;
    this.renderBoard();
    this.renderInspector();
    this.renderUnitList();
  }

  // --- Undo / redo ----------------------------------------------------------

  /** A deep copy of the draft (pure JSON data) — the unit of the undo/redo stacks. */
  private cloneDraft(): EditorDraft {
    return JSON.parse(JSON.stringify(this.draft)) as EditorDraft;
  }

  /** Push a pre-edit snapshot onto the undo stack + drop the redo future. The raw primitive (no coalescing reset). */
  private snapshotDraft(): void {
    this.undoStack.push(this.cloneDraft());
    if (this.undoStack.length > HISTORY_MAX) this.undoStack.shift();
    this.redoStack = [];
    this.refreshHistoryButtons();
  }

  /** Snapshot for a board / destructive edit — also ends any in-progress field-edit coalescing. Call *before* the mutation. */
  private pushHistory(): void {
    this.snapshotDraft();
    this.lastEditTarget = null;
  }

  /**
   * Capture-phase form-edit hook (mounted on window). An inspector / objective / reward edit mutates the
   * draft through the control's *own* (target-phase) handler; this runs first — in the capture phase — so
   * it can snapshot the **pre-edit** draft. Coalesced per control: a field's keystrokes (and its input+
   * change pair) collapse to one undo entry, and a blur or a move to another control opens the next. The
   * size inputs (already snapshot via {@link resize}) and the import box (not a draft edit) are excluded.
   */
  private onPanelEdit(ev: Event): void {
    if (ev.type === "focusout") { this.lastEditTarget = null; return; }
    const el = ev.target as HTMLElement | null;
    if (!el || (el.tagName !== "INPUT" && el.tagName !== "SELECT" && el.tagName !== "TEXTAREA")) return;
    const role = el.dataset.role;
    if (role === "import" || role === "cols" || role === "rows") return; // not a coalesced draft edit
    if (el === this.lastEditTarget) return; // same control → same undo entry
    this.snapshotDraft();
    this.lastEditTarget = el;
  }

  private undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.cloneDraft());
    this.restoreDraft(prev);
  }

  private redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.cloneDraft());
    this.restoreDraft(next);
  }

  /** Swap in a snapshot draft + fully re-render. Selection is dropped (its refs point at the old objects). */
  private restoreDraft(d: EditorDraft): void {
    this.draft = d;
    this.selection = null;
    this.lastEditTarget = null; // a restore is an edit boundary
    this.cancelShape();
    this.afterBoardEdit();
  }

  /** Dim the Undo/Redo buttons when their stack is empty (kept honest after every edit). */
  private refreshHistoryButtons(): void {
    if (this.undoBtn) this.undoBtn.disabled = this.undoStack.length === 0;
    if (this.redoBtn) this.redoBtn.disabled = this.redoStack.length === 0;
  }

  /**
   * Window-level keyboard shortcuts. Ignored while a form field is focused (so typing an id/label never
   * switches brush). Ctrl/⌘+Z = undo · Ctrl/⌘+Shift+Z or Ctrl+Y = redo · Esc cancels a pending shape +
   * deselects · a bare letter picks a brush (see {@link BRUSH_HOTKEYS}).
   */
  private onKeyDown(ev: KeyboardEvent): void {
    const el = document.activeElement as HTMLElement | null;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
    if (ev.ctrlKey || ev.metaKey) {
      const k = ev.key.toLowerCase();
      if (k === "z") { ev.preventDefault(); if (ev.shiftKey) this.redo(); else this.undo(); }
      else if (k === "y") { ev.preventDefault(); this.redo(); }
      return; // leave every other Ctrl/⌘ combo to the browser
    }
    if (ev.altKey) return;
    if (ev.key === "Escape") { this.cancelShape(); this.clearSelection(); return; }
    const b = BRUSH_HOTKEYS[ev.key.toLowerCase()];
    if (b) { ev.preventDefault(); this.pickBrush(b); }
  }

  private paint(t: GridCoord): void {
    const d = this.draft;
    switch (this.brush) {
      case "select": return void this.selectAt(t);
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
      case "gate": {
        // A default lockpick cell (the common prison cell); select + inspector edit its openBy/locked.
        const i = d.gates.findIndex((g) => same(g.pos, t));
        if (i >= 0) d.gates.splice(i, 1);
        else d.gates.push({ id: `gate-${++this.objectSeq}`, pos: { col: t.col, row: t.row }, openBy: [{ kind: "lockpick" }], locked: true });
        return;
      }
      case "lever": {
        const i = d.levers.findIndex((l) => same(l.pos, t));
        if (i >= 0) d.levers.splice(i, 1);
        else d.levers.push({ id: `lever-${++this.objectSeq}`, pos: { col: t.col, row: t.row }, targets: [] });
        return;
      }
      case "erase": return void this.eraseAt(t);
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
    this.pushHistory(); // a shrink drops off-board entities — make that recoverable (it was silent data loss)
    this.draft.cols = Math.max(1, Math.min(20, cols || 1));
    this.draft.rows = Math.max(1, Math.min(20, rows || 1));
    // Drop anything now off the board.
    const ok = (c: GridCoord) => c.col < this.draft.cols && c.row < this.draft.rows;
    const d = this.draft;
    d.blocked = d.blocked.filter(ok); d.playerSpawns = d.playerSpawns.filter(ok);
    d.exit = d.exit.filter(ok); d.traps = d.traps.filter(ok);
    d.enemies = d.enemies.filter((e) => ok(e.pos)); d.captives = d.captives.filter((c) => ok(c.pos));
    d.gates = d.gates.filter((g) => ok(g.pos)); d.levers = d.levers.filter((l) => ok(l.pos));
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

  /**
   * **Soft play** (D-editor): boot the current draft straight into the real {@link BattleScene}
   * with the chosen playtest squad, so the author can *functionally* test it — deploy the squad
   * (is the board too crowded to field one?), walk it around (is the gate too far from the lever?),
   * and watch the AI (do the enemy behaviours read right?) — without the export → drop-in → reload
   * loop. Gated on {@link validateLevel} (the same guard the export shows), so an invalid draft
   * surfaces the reason instead of a mid-boot crash. `returnTo: "EditorScene"` bounces the finished
   * (or exited) fight back here; the draft rides on this scene's instance, so it survives the
   * round-trip untouched (undo history included).
   */
  private playtest(): void {
    const enc = draftToEncounter(this.draft);
    const issues = validateLevel(enc);
    if (issues.length) {
      if (this.validLine) {
        this.validLine.textContent = `⚠ can't playtest — ${issues.join("; ")}`;
        this.validLine.style.color = "#f0a0a0";
      }
      return;
    }
    let handoff: RunHandoff;
    try {
      const { run, loop } = buildPlaytest(enc, this.playtestParty);
      handoff = { run, loop, returnTo: "EditorScene" };
    } catch (err) {
      if (this.validLine) {
        this.validLine.textContent = `⚠ playtest build failed: ${(err as Error).message}`;
        this.validLine.style.color = "#f0a0a0";
      }
      return;
    }
    // The DOM panel is torn down by the SHUTDOWN hook; the draft stays on the instance for the return.
    this.scene.start("BattleScene", handoff);
  }

  // --- DOM palette (position:fixed, the debug-menu.ts idiom) ----------------

  private mountPanel(): void {
    // Keyboard shortcuts (brush hotkeys · Esc · undo/redo) + the capture-phase form-edit hook (undo for
    // inspector/objective/reward edits), on window so they survive an import remount (which unmount+
    // remounts the panel) and work regardless of canvas focus. Paired with unmountPanel's off.
    window.addEventListener("keydown", this.hKeyDown);
    for (const type of ["input", "change", "focusout"]) window.addEventListener(type, this.hPanelEdit, true);
    // The slab tray (D98 placement): a full-width dock in normal flow BELOW the canvas, with a
    // resize grip. Growing the dock shrinks #app and Scale.FIT scales the board down (never
    // clips). NOTE: this pass relocates + resizes the chrome; the thumbnail-gallery restyle of
    // the palette (and the bar/drawer split) is the next slice — the controls below are unchanged.
    const dock = document.createElement("div");
    Object.assign(dock.style, {
      flex: "0 0 auto", height: "210px", display: "flex", flexDirection: "column",
      background: "#16110d", borderTop: "1px solid #5a4630", boxSizing: "border-box",
    } as CSSStyleDeclaration);
    dock.appendChild(this.buildDockGrip());

    const panel = document.createElement("div");
    Object.assign(panel.style, {
      flex: "1 1 auto", minHeight: "0", overflow: "auto", width: "100%", boxSizing: "border-box",
      background: "transparent", color: "#e8e0d0", font: "12px/1.4 ui-monospace, monospace", padding: "8px 12px 12px",
    } as CSSStyleDeclaration);

    // Panel header — the title (moved off the canvas so the scene pans/zooms cleanly) + the
    // camera-control hint. The board is grab-and-drag pannable and wheel-zoomable; Recenter resets.
    const header = document.createElement("div");
    header.style.margin = "0 0 6px";
    const title = document.createElement("div");
    title.textContent = "Level Editor — pick a brush, click tiles";
    Object.assign(title.style, { fontWeight: "700", color: "#c8a24a" } as CSSStyleDeclaration);
    header.appendChild(title);
    header.appendChild(this.hint("drag paints · shift-drag pans · right-click erases · scroll zooms · Recenter resets"));
    header.appendChild(this.hint("ctrl-click select · alt-click pick · esc cancel · ctrl+z undo · keys: W/L/R G/V/T N/C P/X S/E"));
    // Live tile-coordinate readout (M-D) — structural work needs precise alignment of cells/doorways.
    const coord = document.createElement("div");
    coord.dataset.role = "coord";
    Object.assign(coord.style, { margin: "2px 0 0", color: "#9fd0f0", fontVariantNumeric: "tabular-nums" } as CSSStyleDeclaration);
    header.appendChild(coord);
    this.coordEl = coord;
    this.updateCoord();
    // Display-options row (D109 slice 2) — the card tweaks as live, persisted toggles.
    this.optionButtons = [];
    header.appendChild(this.optionsRow());
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
    // Cross-cutting tools, reachable from any drawer: Select picks/edits any placed object, Erase removes.
    tabBar.appendChild(this.brushButton("select"));
    tabBar.appendChild(this.brushButton("erase"));
    const recenter = document.createElement("button");
    recenter.textContent = "Recenter";
    recenter.dataset.role = "recenter";
    Object.assign(recenter.style, { margin: "2px", cursor: "pointer" } as CSSStyleDeclaration);
    recenter.onclick = () => this.boardCam.recenter();
    tabBar.appendChild(recenter);
    // Undo / redo buttons — the clickable twin of Ctrl+Z / Ctrl+Shift+Z (a whole stroke is one step).
    const histBtn = (label: string, role: string, run: () => void): HTMLButtonElement => {
      const b = document.createElement("button");
      b.textContent = label;
      b.dataset.role = role;
      Object.assign(b.style, { margin: "2px", cursor: "pointer" } as CSSStyleDeclaration);
      b.onclick = () => run();
      return b;
    };
    this.undoBtn = histBtn("↶ Undo", "undo", () => this.undo());
    this.redoBtn = histBtn("↷ Redo", "redo", () => this.redo());
    tabBar.append(this.undoBtn, this.redoBtn);
    this.refreshHistoryButtons();
    // "Details" toggle — opens/closes the side drawer (unit list + inspector). Board stays full-size.
    const details = document.createElement("button");
    details.textContent = "⋯ Details";
    details.dataset.role = "details-toggle";
    Object.assign(details.style, { margin: "2px", marginLeft: "8px", cursor: "pointer", color: "#f2b65a" } as CSSStyleDeclaration);
    details.onclick = () => this.toggleDrawer();
    tabBar.appendChild(details);
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
    this.buildObjectsDrawer(this.drawers.Objects!);
    this.buildUnitsDrawer(this.drawers.Units!);
    this.buildEventsDrawer(this.drawers.Events!);
    this.buildScenarioDrawer(this.drawers.Scenario!);

    // Persistent ✓/⚠ status bar in the bar (outside the drawers, so live guards never hide).
    const valid = document.createElement("div");
    valid.style.margin = "8px 0 0";
    panel.appendChild(valid);
    this.validLine = valid;

    dock.appendChild(panel);
    document.body.appendChild(dock);
    this.dock = dock;
    this.panel = panel;
    // The side drawer (the "edit a placed object" surface: unit list + inspector). Fixed to the right,
    // non-modal (the board stays interactive), slides in on Select / the Details toggle.
    this.buildSideDrawer();
    // Phaser sized the FIT canvas against the full-height #app at boot — BEFORE this dock existed.
    // Appending the dock shrinks #app but fires no resize, so re-fit once layout has flushed, else
    // the canvas overflows its box (820×615 into a 470-tall #app). rAF so #app's new height is live.
    requestAnimationFrame(() => this.scale.refresh());
    this.fillPalette(); // build the card strips from the current display prefs
    for (const paint of this.optionButtons) paint(); // light the active size/tint/captive toggles
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
    btn.onclick = () => this.setBrush(b);
    this.brushButtons.push(btn);
    return btn;
  }

  /**
   * A slab-tray placeable **card** (D109 slice 2) — a thumbnail + label wired to select its brush,
   * and (for the unrolled enemy roster / captive variants) the template or release it carries. Keeps
   * the same `data-brush` hook the e2e drives; enemy cards additionally tag `data-template`.
   */
  private paletteCard(opts: { brush: Brush; label: string; thumb: string; template?: string; release?: "reach" | "lockpick"; stat?: string }): HTMLButtonElement {
    const size = this.prefs.cardSize;
    const card = document.createElement("button");
    card.dataset.brush = opts.brush;
    if (opts.template) card.dataset.template = opts.template;
    Object.assign(card.style, {
      flex: "0 0 auto", width: `${size}px`, padding: "5px 4px 4px", cursor: "pointer", textAlign: "center",
      background: "#1a140d", border: "1px solid #4a423a", borderRadius: "5px", boxSizing: "border-box",
      font: "10px/1.25 ui-monospace, monospace", color: "#ddd3c2",
    } as CSSStyleDeclaration);
    const thumb = document.createElement("div");
    const thumbH = size <= 66 ? 32 : size >= 90 ? 46 : 38;
    Object.assign(thumb.style, { height: `${thumbH}px`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "3px" } as CSSStyleDeclaration);
    thumb.innerHTML = opts.thumb;
    const name = document.createElement("div");
    name.textContent = opts.label;
    Object.assign(name.style, { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } as CSSStyleDeclaration);
    card.append(thumb, name);
    if (opts.stat) {
      const s = document.createElement("div");
      s.textContent = opts.stat;
      Object.assign(s.style, { fontSize: "9px", color: "#b2a48b", fontVariantNumeric: "tabular-nums" } as CSSStyleDeclaration);
      card.appendChild(s);
    }
    card.title = opts.label;
    card.onclick = () => {
      if (opts.template) this.enemyTemplate = opts.template;
      if (opts.release) this.captiveRelease = opts.release;
      this.setBrush(opts.brush);
    };
    this.paletteCards.push({ el: card, brush: opts.brush, template: opts.template, release: opts.release });
    return card;
  }

  /** A horizontal, scrollable strip of placeable cards — the slab-tray row for a category. */
  private cardStrip(cards: HTMLElement[]): HTMLDivElement {
    const strip = document.createElement("div");
    Object.assign(strip.style, { display: "flex", gap: "6px", overflowX: "auto", overflowY: "hidden", padding: "2px 2px 6px", margin: "4px 0" } as CSSStyleDeclaration);
    for (const c of cards) strip.appendChild(c);
    return strip;
  }

  /** The enemy-template cards (the roster unrolled from the old dropdown) + a captive card per release. */
  private unitCards(): HTMLElement[] {
    const tint = this.prefs.enemyTint;
    const enemyCards = ENEMY_IDS.map((id) => {
      const t = enemyStat(id);
      return this.paletteCard({ brush: "enemy", template: id, label: enemyLabel(id), thumb: tokenThumb(abbrev(id), "#e06b6b", enemyRing(id, tint), "#2a0d0d"), stat: `HP ${t.hp} · ATK ${t.atk}` });
    });
    const captives = this.prefs.captiveVariants === 2
      ? [
          this.paletteCard({ brush: "captive", release: "lockpick", label: "Captive · pick", thumb: tokenThumb("⚿", "#9a6bd0", "#4a2c6b", "#fff") }),
          this.paletteCard({ brush: "captive", release: "reach", label: "Captive · reach", thumb: tokenThumb("○", "#9a6bd0", "#4a2c6b", "#fff") }),
        ]
      : [this.paletteCard({ brush: "captive", release: "lockpick", label: "Captive", thumb: tokenThumb("⚿", "#9a6bd0", "#4a2c6b", "#fff") })];
    return [...enemyCards, ...captives];
  }

  /** (Re)build every category's card strip from the current display prefs — on mount and on any options
   *  change, so a size/tint/captive-variant edit re-renders the tray in place (no full remount). */
  private fillPalette(): void {
    this.paletteCards = [];
    const put = (tab: TabName, cards: HTMLElement[]): void => {
      const s = this.paletteStrips[tab];
      if (!s) return;
      s.innerHTML = "";
      for (const c of cards) s.appendChild(c);
    };
    put("Terrain", [
      this.paletteCard({ brush: "wall", label: "Wall", thumb: blockThumb() }),
      this.paletteCard({ brush: "line", label: "Line", thumb: lineThumb() }),
      this.paletteCard({ brush: "rect", label: "Rect", thumb: rectThumb() }),
    ]);
    put("Objects", [
      this.paletteCard({ brush: "gate", label: "Gate", thumb: glyphThumb("▦", "#f2b65a") }),
      this.paletteCard({ brush: "lever", label: "Lever", thumb: glyphThumb("⎇", "#62c6d6") }),
      this.paletteCard({ brush: "trap", label: "Trap", thumb: glyphThumb("▲", "#f2b65a") }),
    ]);
    put("Units", this.unitCards());
    put("Events", [
      this.paletteCard({ brush: "spawn", label: "Spawn", thumb: tokenThumb("P", "#ffcf6b", "#57b07a", "#1a1410") }),
      this.paletteCard({ brush: "exit", label: "Exit", thumb: glyphThumb("⚑", "#46a6c8") }),
    ]);
    this.highlightBrush();
  }

  /**
   * The dock's display-options row (D109 slice 2) — the card tweaks made **live, choosable** toggles:
   * card **size** (S/M/L) · enemy **tint** (red / role-ring) · **captive** variants (1 / 2). Persisted
   * per browser; a click re-renders the tray + re-tints the board in place.
   */
  private optionsRow(): HTMLDivElement {
    const wrap = document.createElement("div");
    wrap.dataset.role = "editor-options";
    Object.assign(wrap.style, { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px", margin: "4px 0 2px", fontSize: "11px", color: "#b2a48b" } as CSSStyleDeclaration);
    const group = (label: string, choices: { text: string; on: () => boolean; set: () => void }[]): HTMLSpanElement => {
      const g = document.createElement("span");
      Object.assign(g.style, { display: "inline-flex", alignItems: "center", gap: "3px" } as CSSStyleDeclaration);
      g.append(label + " ");
      for (const c of choices) {
        const b = document.createElement("button");
        b.textContent = c.text;
        b.dataset.opt = `${label}:${c.text}`;
        Object.assign(b.style, { cursor: "pointer", padding: "2px 7px", borderRadius: "3px", border: "1px solid #4a423a", background: "#1a140d", color: "#ddd3c2", font: "11px ui-monospace, monospace" } as CSSStyleDeclaration);
        const paint = (): void => { const on = c.on(); b.style.background = on ? "#c8a24a" : "#1a140d"; b.style.color = on ? "#1a1206" : "#ddd3c2"; b.style.fontWeight = on ? "700" : "400"; };
        b.onclick = () => { c.set(); this.applyPrefs(); };
        this.optionButtons.push(paint);
        g.appendChild(b);
      }
      return g;
    };
    wrap.append(
      group("size", [
        { text: "S", on: () => this.prefs.cardSize === 62, set: () => (this.prefs.cardSize = 62) },
        { text: "M", on: () => this.prefs.cardSize === 78, set: () => (this.prefs.cardSize = 78) },
        { text: "L", on: () => this.prefs.cardSize === 96, set: () => (this.prefs.cardSize = 96) },
      ]),
      group("enemy", [
        { text: "red", on: () => this.prefs.enemyTint === "red", set: () => (this.prefs.enemyTint = "red") },
        { text: "role", on: () => this.prefs.enemyTint === "role", set: () => (this.prefs.enemyTint = "role") },
      ]),
      group("captive", [
        { text: "1", on: () => this.prefs.captiveVariants === 1, set: () => (this.prefs.captiveVariants = 1) },
        { text: "2", on: () => this.prefs.captiveVariants === 2, set: () => (this.prefs.captiveVariants = 2) },
      ]),
    );
    return wrap;
  }

  /** Persist the prefs, then re-render the tray + board + option highlights so the change is immediate. */
  private applyPrefs(): void {
    saveEditorPrefs(this.prefs);
    this.fillPalette();
    this.renderBoard(); // re-tint the board's enemy markers if the tint pref changed
    for (const paint of this.optionButtons) paint();
  }

  /**
   * The side drawer (D109 slice 2) — the "edit a placed object" surface: the unit list (find/select)
   * + the Inspector (tweak the selected unit / gate / lever). Fixed to the right, non-modal so the
   * board stays interactive and full-size while you edit; slides in on Select or the Details toggle.
   */
  private buildSideDrawer(): void {
    const drawer = document.createElement("div");
    drawer.dataset.role = "side-drawer";
    Object.assign(drawer.style, {
      position: "fixed", top: "0", right: "0", height: "100vh", width: "270px", zIndex: "1001",
      background: "rgba(22,17,13,0.97)", color: "#e8e0d0", font: "12px/1.4 ui-monospace, monospace",
      borderLeft: "1px solid #76583a", boxShadow: "-20px 0 50px -30px #000", padding: "12px 13px 20px",
      overflow: "auto", boxSizing: "border-box", transform: "translateX(102%)", transition: "transform .2s ease",
    } as CSSStyleDeclaration);

    const head = document.createElement("div");
    Object.assign(head.style, { display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 0 8px" } as CSSStyleDeclaration);
    const title = document.createElement("div");
    title.textContent = "Details — edit a placed object";
    Object.assign(title.style, { fontWeight: "700", color: "#c8a24a", fontSize: "12px" } as CSSStyleDeclaration);
    const close = document.createElement("button");
    close.textContent = "✕"; close.dataset.role = "drawer-close"; close.style.cursor = "pointer";
    close.onclick = () => this.closeDrawer();
    head.append(title, close);
    drawer.appendChild(head);

    // The unit list — click a row to select (reaches units occluded / off a wide board).
    const list = document.createElement("div");
    list.dataset.role = "unit-list";
    Object.assign(list.style, { margin: "4px 0", maxHeight: "180px", overflow: "auto", border: "1px solid #3a332c", borderRadius: "4px" } as CSSStyleDeclaration);
    drawer.appendChild(list);
    this.unitListEl = list;

    // The inspector — edits whatever object is selected (unit / gate / lever).
    const inspector = document.createElement("div");
    inspector.dataset.role = "inspector";
    Object.assign(inspector.style, { margin: "8px 0 0", padding: "6px", border: "1px solid #4a423a", borderRadius: "4px", minHeight: "18px" } as CSSStyleDeclaration);
    drawer.appendChild(inspector);
    this.inspectorEl = inspector;

    document.body.appendChild(drawer);
    this.sideDrawer = drawer;
  }

  private openDrawer(): void {
    this.drawerOpen = true;
    if (this.sideDrawer) this.sideDrawer.style.transform = "none";
    this.syncDrawerToggle();
  }
  private closeDrawer(): void {
    this.drawerOpen = false;
    if (this.sideDrawer) this.sideDrawer.style.transform = "translateX(102%)";
    this.syncDrawerToggle();
  }
  private toggleDrawer(): void {
    if (this.drawerOpen) this.closeDrawer();
    else this.openDrawer();
  }
  private syncDrawerToggle(): void {
    const t = this.panel?.querySelector('[data-role="details-toggle"]') as HTMLButtonElement | null;
    if (t) t.textContent = this.drawerOpen ? "⋯ Details ✕" : "⋯ Details";
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
    const colsIn = this.numInput(this.draft.cols, (n) => this.resize(n, this.draft.rows));
    colsIn.dataset.role = "cols";
    size.appendChild(colsIn);
    size.append(" × ");
    const rowsIn = this.numInput(this.draft.rows, (n) => this.resize(this.draft.cols, n));
    rowsIn.dataset.role = "rows";
    size.appendChild(rowsIn);
    d.appendChild(size);
    this.paletteStrips.Terrain = this.cardStrip([]);
    d.appendChild(this.paletteStrips.Terrain);

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

    d.appendChild(this.hint("the wall/floor substrate. wall = one tile · line/rect = two clicks → a run/box"));
    d.appendChild(this.hint("rect outline = a cell/room ring (place a gate in the gap for the door)"));
  }

  /**
   * The **Objects** drawer (D103) — discrete placeable elements with their own properties, kept apart
   * from the painted Terrain substrate. A gate lands as a default lockpick cell; a lever lands
   * unwired; the persistent inspector edits either (a gate's `openBy`/`locked`, a lever's targets).
   */
  private buildObjectsDrawer(d: HTMLDivElement): void {
    this.paletteStrips.Objects = this.cardStrip([]);
    d.appendChild(this.paletteStrips.Objects);
    d.appendChild(this.hint("gate = a locked cell/door (default: lockpick) · lever = a pull-switch · trap = a hazard"));
    d.appendChild(this.hint("place one, then Select it → the inspector sets a gate's opens / a lever's target gates"));
  }

  private buildEventsDrawer(d: HTMLDivElement): void {
    this.paletteStrips.Events = this.cardStrip([]);
    d.appendChild(this.paletteStrips.Events);
    d.appendChild(this.hint("deploy spawns · extraction exit tiles (the extraction span)"));
    d.appendChild(this.hint("win/lose objectives live under the Scenario tab (they're level-wide, not a placeable)"));
  }

  /**
   * The **Objectives** editor (M-C) — win/lose conditions as data. Level-wide (not a placeable), so it
   * lives in the Scenario tab body (D109 slice 2, moved out of Events). label + required + kind fields.
   */
  private buildObjectivesEditor(d: HTMLDivElement): void {
    const objHead = document.createElement("div");
    Object.assign(objHead.style, { margin: "8px 0 2px", fontWeight: "700", color: "#c8a24a" } as CSSStyleDeclaration);
    objHead.append("Objectives ");
    const add = document.createElement("button");
    add.textContent = "＋ add"; add.dataset.role = "add-objective"; add.style.cursor = "pointer";
    add.onclick = () => this.addObjective();
    const derive = document.createElement("button");
    derive.textContent = "Derive from board"; derive.dataset.role = "derive-objectives"; derive.style.cursor = "pointer"; derive.style.marginLeft = "4px";
    derive.onclick = () => { this.pushHistory(); this.draft.objectives = standardObjectives(this.draft.exit, this.draft.captives.length > 0); this.afterObjectiveEdit(); };
    objHead.append(add, derive);
    d.appendChild(objHead);

    const list = document.createElement("div");
    list.dataset.role = "objective-list";
    list.style.margin = "2px 0";
    d.appendChild(list);
    this.objectivesEl = list;

    d.appendChild(this.hint("empty ⇒ auto (eliminate-all + extraction when exit+captives) · required off = an optional/bonus objective"));
    this.renderObjectives();
  }

  /** Append a fresh eliminate-all objective and re-render the list. */
  private addObjective(): void {
    this.pushHistory();
    (this.draft.objectives ??= []).push({ id: this.uniqueObjectiveId(), kind: "eliminate-all", required: true, label: "New objective" });
    this.afterObjectiveEdit();
  }

  /** A run-unique objective id (`obj-N`) for a freshly-added row. */
  private uniqueObjectiveId(): string {
    const used = new Set((this.draft.objectives ?? []).map((o) => o.id));
    let n = 1;
    while (used.has(`obj-${n}`)) n++;
    return `obj-${n}`;
  }

  /** After a structural objective change (add/remove/kind/derive): rebuild the list + refresh the export. */
  private afterObjectiveEdit(): void {
    this.renderObjectives();
    this.updateExport();
  }

  /** Render the objectives editor — one editable block per objective (or an auto-derive placeholder). */
  private renderObjectives(): void {
    const host = this.objectivesEl;
    if (!host) return;
    host.innerHTML = "";
    const objs = this.draft.objectives ?? [];
    if (!objs.length) {
      host.textContent = "· auto-derived — paint exit + captives for the rescue pair, or ＋ add / Derive to author explicitly";
      host.style.opacity = "0.55";
      return;
    }
    host.style.opacity = "1";
    objs.forEach((o, i) => host.appendChild(this.objectiveRow(o, i)));
  }

  /** One objective's editable block: kind · required · remove, its label, and the kind-specific fields. */
  private objectiveRow(o: ObjectiveSpec, i: number): HTMLDivElement {
    const box = document.createElement("div");
    box.dataset.role = "objective";
    Object.assign(box.style, { margin: "4px 0", padding: "5px", border: "1px solid #4a423a", borderRadius: "4px" } as CSSStyleDeclaration);

    const head = document.createElement("div");
    Object.assign(head.style, { display: "flex", alignItems: "center", gap: "6px" } as CSSStyleDeclaration);
    const kind = document.createElement("select");
    kind.dataset.field = "kind";
    for (const k of OBJECTIVE_KINDS) { const opt = document.createElement("option"); opt.value = k; opt.textContent = k; kind.appendChild(opt); }
    kind.value = o.kind;
    kind.onchange = () => this.changeObjectiveKind(i, kind.value as ObjectiveKind);
    head.appendChild(kind);
    // Required checkbox — the "gates win/lose vs. optional bonus" switch.
    const reqLabel = document.createElement("label");
    reqLabel.style.cursor = "pointer";
    const req = document.createElement("input");
    req.type = "checkbox"; req.checked = o.required; req.dataset.field = "required";
    req.onchange = () => { o.required = req.checked; this.updateExport(); };
    reqLabel.append(req, "required");
    head.appendChild(reqLabel);
    const rm = document.createElement("button");
    rm.textContent = "✕"; rm.title = "remove objective"; rm.dataset.role = "remove-objective";
    Object.assign(rm.style, { marginLeft: "auto", cursor: "pointer" } as CSSStyleDeclaration);
    rm.onclick = () => {
      this.pushHistory();
      this.draft.objectives!.splice(i, 1);
      if (!this.draft.objectives!.length) delete this.draft.objectives;
      this.afterObjectiveEdit();
    };
    head.appendChild(rm);
    box.appendChild(head);

    box.appendChild(this.field("label", o.label, (v) => { o.label = v; this.updateExport(); }));

    if (o.kind === "closing-gate") {
      // A timed gauge (fails the constraint at 100). driver = the unit whose death/immobilize stops it.
      const cg = document.createElement("div");
      cg.style.margin = "3px 0";
      cg.append("speed ");
      cg.appendChild(this.numInput(o.speed ?? 10, (n) => { if (Number.isFinite(n)) { o.speed = n; this.updateExport(); } }));
      box.appendChild(cg);
      box.appendChild(this.selectRow("driver", ["", "sapper", "captain"], o.driver?.role ?? "", (v) => { if (v) o.driver = { role: v }; else delete o.driver; this.updateExport(); }));
      box.appendChild(this.hint("swept-tiles span isn't paintable yet — a pure timer for now"));
    } else if (o.kind === "extraction") {
      const ex = document.createElement("div");
      ex.style.margin = "3px 0";
      ex.append("escort role ");
      const role = document.createElement("input");
      role.value = o.escort?.role ?? "prisoner"; role.style.width = "90px"; role.dataset.field = "escort";
      role.oninput = () => { o.escort = { role: role.value || "prisoner" }; this.updateExport(); };
      ex.appendChild(role);
      box.appendChild(ex);
      box.appendChild(this.hint(`span = ${this.draft.exit.length} exit tile(s) — paint with the exit brush`));
    }
    return box;
  }

  /** The draft's reward, created at the tidy default the first time it's edited. */
  private ensureReward(): EncounterReward {
    if (!this.draft.reward) this.draft.reward = { gold: 50, materials: [], xp: 40 };
    return this.draft.reward;
  }

  /** Replace an objective with a clean shape for its new kind (preserving id/label/required — no stale fields). */
  private changeObjectiveKind(i: number, kind: ObjectiveKind): void {
    const prev = this.draft.objectives![i];
    const next: ObjectiveSpec = { id: prev.id, kind, required: prev.required, label: prev.label };
    if (kind === "closing-gate") { next.speed = prev.speed ?? 10; if (prev.driver) next.driver = prev.driver; }
    if (kind === "extraction") { next.escort = prev.escort ?? { role: "prisoner" }; next.span = [...this.draft.exit]; }
    this.draft.objectives![i] = next;
    this.afterObjectiveEdit();
  }

  private buildUnitsDrawer(d: HTMLDivElement): void {
    // The enemy roster, unrolled from the old dropdown into one card each (D109 slice 2) + a captive
    // card. Each enemy card sets the brush AND its template; the captive card its release. Filled by
    // fillPalette so a display-pref change (size/tint/captive-variants) re-renders it in place.
    this.paletteStrips.Units = this.cardStrip([]);
    d.appendChild(this.paletteStrips.Units);
    d.appendChild(this.hint("pick an archetype → click the board to place · placed units are edited in the Details drawer"));
  }

  /**
   * The **Scenario** tab body (D109 slice 2) — the level as a whole, not a placeable: identity, reward,
   * the level-wide objectives, and JSON import/export. The natural home for the future cross-expedition
   * tools & checks (arc-linking, cross-level validation, playtest).
   */
  private buildScenarioDrawer(d: HTMLDivElement): void {
    d.appendChild(this.field("id", this.draft.id, (v) => { this.draft.id = v; this.updateExport(); }));
    d.appendChild(this.field("name", this.draft.name, (v) => { this.draft.name = v; this.updateExport(); }));

    // Win reward (M-C) — gold + xp. materials round-trip verbatim (no picker yet).
    const reward = document.createElement("div");
    reward.style.margin = "3px 0";
    reward.append("reward — gold ");
    const gold = this.numInput(this.draft.reward?.gold ?? 50, (n) => { if (Number.isFinite(n)) { this.ensureReward().gold = n; this.updateExport(); } });
    gold.dataset.role = "reward-gold";
    reward.appendChild(gold);
    reward.append(" xp ");
    const xp = this.numInput(this.draft.reward?.xp ?? 40, (n) => { if (Number.isFinite(n)) { this.ensureReward().xp = n; this.updateExport(); } });
    xp.dataset.role = "reward-xp";
    reward.appendChild(xp);
    d.appendChild(reward);

    // Level-wide win/lose objectives (moved here from Events — they're scenario-level, D109 slice 2).
    this.buildObjectivesEditor(d);

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

    // Soft play (D-editor): pick a squad, then ▶ Playtest boots the draft into the real BattleScene
    // and returns here — a functional test (deploy/spacing, gate↔lever reach, enemy behaviour) with
    // no export→drop-in→reload loop. The squad picker maps onto the scenario party matrix, so a
    // level tailored to a class can be fielded with the right cast (owner ask). Default = small trio.
    const play = document.createElement("div");
    play.style.margin = "6px 0";
    play.append("playtest squad ");
    const squad = document.createElement("select");
    squad.dataset.role = "playtest-party";
    squad.style.cursor = "pointer";
    for (const name of playtestPartyNames()) {
      const opt = document.createElement("option");
      opt.value = name; opt.textContent = name; opt.selected = name === this.playtestParty;
      squad.appendChild(opt);
    }
    squad.onchange = () => { this.playtestParty = squad.value; };
    const playBtn = document.createElement("button");
    playBtn.textContent = "▶ Playtest"; playBtn.style.cursor = "pointer"; playBtn.style.marginLeft = "6px";
    playBtn.dataset.role = "playtest";
    playBtn.title = "Boot the draft in the real battle scene to test it, then return here";
    playBtn.onclick = () => this.playtest();
    play.append(squad, playBtn);
    d.appendChild(play);

    // Local maps (D-editor): browser-local persistence. The working draft autosaves + restores on
    // reload; here you Save the current map into a named library and Load/Delete previous attempts —
    // so test maps survive across sessions. All browser-local (Download .json commits a keeper).
    this.buildLibrarySection(d);

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

  // --- Local map library (D-editor persistence) -----------------------------

  /** Build the "local maps" block — a Save/New header over the live saved-maps list. */
  private buildLibrarySection(d: HTMLDivElement): void {
    const wrap = document.createElement("div");
    wrap.style.margin = "6px 0";
    wrap.dataset.role = "library";

    const head = document.createElement("div");
    head.style.marginBottom = "3px";
    head.append("local maps ");
    const saveBtn = document.createElement("button");
    saveBtn.textContent = "＋ Save"; saveBtn.style.cursor = "pointer"; saveBtn.dataset.role = "lib-save";
    saveBtn.title = "Save the current map into the browser library (keyed by its id)";
    saveBtn.onclick = () => this.saveCurrentToLibrary();
    const newBtn = document.createElement("button");
    newBtn.textContent = "New"; newBtn.style.cursor = "pointer"; newBtn.style.marginLeft = "6px"; newBtn.dataset.role = "lib-new";
    newBtn.title = "Start a fresh blank map (undoable)";
    newBtn.onclick = () => this.newBlankMap();
    head.append(saveBtn, newBtn);
    wrap.appendChild(head);

    const list = document.createElement("div");
    list.dataset.role = "lib-list";
    this.libraryEl = list;
    wrap.appendChild(list);
    d.appendChild(wrap);
    this.renderLibrary();
  }

  /** Render the saved-maps list — a Load/Delete row per stored map, newest first. */
  private renderLibrary(): void {
    const host = this.libraryEl;
    if (!host) return;
    host.innerHTML = "";
    const maps = loadLibrary();
    if (!maps.length) {
      host.textContent = "· none saved yet — Save keeps a map here across sessions";
      host.style.opacity = "0.55";
      return;
    }
    host.style.opacity = "1";
    const now = Date.now();
    for (const m of maps) {
      const row = document.createElement("div");
      row.dataset.libRow = m.name;
      Object.assign(row.style, { display: "flex", alignItems: "center", gap: "5px", padding: "2px 4px" } as CSSStyleDeclaration);
      const label = document.createElement("span");
      label.textContent = `${m.name} · ${relTime(now - m.savedAt)}`;
      Object.assign(label.style, { flex: "1", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } as CSSStyleDeclaration);
      const load = document.createElement("button");
      load.textContent = "Load"; load.style.cursor = "pointer"; load.dataset.role = "lib-load";
      load.onclick = () => this.loadMapFromLibrary(m);
      const del = document.createElement("button");
      del.textContent = "✕"; del.style.cursor = "pointer"; del.title = "Delete this saved map"; del.dataset.role = "lib-del";
      del.onclick = () => { deleteFromLibrary(m.name); this.renderLibrary(); };
      row.append(label, load, del);
      host.appendChild(row);
    }
  }

  /** Save the current draft into the browser library (under its id) — overwrites a same-id entry. */
  private saveCurrentToLibrary(): void {
    const saved = saveToLibrary(this.draft.id, this.draft, Date.now());
    this.renderLibrary();
    if (!this.validLine) return;
    if (saved) {
      this.validLine.textContent = `✓ saved "${saved.name}" to the browser library`;
      this.validLine.style.color = "#9ff0bf";
    } else {
      // The write was refused (quota / denied) — don't claim a save that didn't happen.
      this.validLine.textContent = "⚠ couldn't save — browser storage is full or blocked";
      this.validLine.style.color = "#f0a0a0";
    }
  }

  /** Replace the current draft with a saved map (undoable). Mirrors the import swap + remount. */
  private loadMapFromLibrary(m: SavedMap): void {
    this.pushHistory(); // adopting a saved map replaces the whole draft — make it undoable
    this.draft = m.draft; // a fresh object from loadLibrary's parse (not aliased to storage)
    this.selection = null;
    this.cancelShape();
    this.renderBoard();
    this.unmountPanel();
    this.mountPanel();
  }

  /** Start a fresh blank map (undoable) — the escape hatch from an autosaved-restored draft. */
  private newBlankMap(): void {
    this.pushHistory();
    this.draft = blankDraft();
    this.selection = null;
    this.cancelShape();
    this.renderBoard();
    this.unmountPanel();
    this.mountPanel();
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
    this.pushHistory(); // an import replaces the whole draft — make it undoable (the stack survives the remount)
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
      const list: unknown[] =
        sel.kind === "enemy" ? this.draft.enemies
        : sel.kind === "captive" ? this.draft.captives
        : sel.kind === "gate" ? this.draft.gates
        : this.draft.levers;
      if (!list.includes(sel.ref)) this.selection = null;
    }
    host.innerHTML = "";
    if (!this.selection) {
      host.textContent = "· Select an object (a unit, gate, or lever) to edit it";
      host.style.opacity = "0.55";
      return;
    }
    host.style.opacity = "1";
    if (this.selection.kind === "enemy") this.renderEnemyInspector(host, this.selection.ref);
    else if (this.selection.kind === "captive") this.renderCaptiveInspector(host, this.selection.ref);
    else if (this.selection.kind === "gate") this.renderGateInspector(host, this.selection.ref);
    else this.renderLeverInspector(host, this.selection.ref);
  }

  /** Inspector for a gate (M-D2): its `locked` state + the `openBy` conditions (lockpick / keyholder / destructible) with params. */
  private renderGateInspector(host: HTMLDivElement, g: AuthoredGate): void {
    host.appendChild(this.inspectorHeader(`gate · ${g.id} @ (${g.pos.col},${g.pos.row})`));
    host.appendChild(this.checkboxRow("starts locked", g.locked !== false, (on) => { g.locked = on; this.afterInspect(); }));

    const has = (k: GateLock["kind"]) => g.openBy.some((c) => c.kind === k);
    const setCond = (k: GateLock["kind"], on: boolean) => {
      g.openBy = g.openBy.filter((c) => c.kind !== k);
      if (on) g.openBy.push(k === "lockpick" ? { kind: "lockpick" } : k === "keyholder" ? { kind: "keyholder", tag: { role: "captain" } } : { kind: "destructible", hp: 20 });
      this.renderInspector(); // structural (params show/hide) → rebuild; afterInspect refreshes the board/export
      this.afterInspect();
    };
    host.appendChild(this.hint("opens by (any one):"));
    host.appendChild(this.checkboxRow("lockpick (a Thief picks it)", has("lockpick"), (on) => setCond("lockpick", on)));
    host.appendChild(this.checkboxRow("keyholder (a tagged unit's defeat opens it)", has("keyholder"), (on) => setCond("keyholder", on)));
    const key = g.openBy.find((c) => c.kind === "keyholder");
    if (key && key.kind === "keyholder") {
      host.appendChild(this.field("keyholder role", key.tag.role ?? "", (v) => { const t = v.trim(); key.tag = t ? { role: t } : {}; this.afterInspect(); }));
    }
    host.appendChild(this.checkboxRow("destructible (battered down by attacks)", has("destructible"), (on) => setCond("destructible", on)));
    const dest = g.openBy.find((c) => c.kind === "destructible");
    if (dest && dest.kind === "destructible") {
      const row = document.createElement("div");
      row.style.margin = "3px 0";
      row.append("door hp ");
      row.appendChild(this.numInput(dest.hp, (n) => { if (Number.isFinite(n)) { dest.hp = n; this.afterInspect(); } }));
      host.appendChild(row);
    }
  }

  /** Inspector for a lever (M-D2): a checklist of the placed gates it toggles when pulled. */
  private renderLeverInspector(host: HTMLDivElement, l: AuthoredLever): void {
    host.appendChild(this.inspectorHeader(`lever · ${l.id} @ (${l.pos.col},${l.pos.row})`));
    if (!this.draft.gates.length) {
      host.appendChild(this.hint("place a gate first, then check it here to wire this lever to it"));
      return;
    }
    host.appendChild(this.hint("toggles these gates when pulled:"));
    for (const g of this.draft.gates) {
      host.appendChild(this.checkboxRow(`${g.id} (${g.pos.col},${g.pos.row})`, l.targets.includes(g.id), (on) => {
        l.targets = on ? [...new Set([...l.targets, g.id])] : l.targets.filter((id) => id !== g.id);
        this.afterInspect();
      }));
    }
  }

  /** A labelled checkbox row. */
  private checkboxRow(label: string, checked: boolean, onChange: (on: boolean) => void): HTMLElement {
    const wrap = document.createElement("label");
    Object.assign(wrap.style, { display: "block", margin: "3px 0", cursor: "pointer" } as CSSStyleDeclaration);
    const box = document.createElement("input");
    box.type = "checkbox"; box.checked = checked;
    box.onchange = () => onChange(box.checked);
    wrap.append(box, ` ${label}`);
    return wrap;
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
    // Slab-tray cards: active when the brush matches AND (for the unrolled variants) its template /
    // release is the selected one, so exactly one enemy archetype card lights up.
    for (const c of this.paletteCards) {
      const active = c.brush === this.brush
        && (c.template === undefined || c.template === this.enemyTemplate)
        && (c.release === undefined || c.release === this.captiveRelease);
      c.el.style.borderColor = active ? "#f2b65a" : "#4a423a";
      c.el.style.background = active ? "#271e16" : "#1a140d";
      c.el.style.boxShadow = active ? "0 0 0 1px #f2b65a" : "";
    }
  }

  private updateExport(): void {
    // Autosave (D-editor): every draft mutation funnels through here (afterBoardEdit + all form
    // callbacks call it), so this is the one chokepoint to persist the working draft. Raw + lossless;
    // a full/denied localStorage degrades to no-op inside saveWorking.
    saveWorking(this.draft);
    if (this.exportPre) this.exportPre.textContent = this.exportJson();
    if (this.validLine) {
      const issues = validateLevel(draftToEncounter(this.draft));
      this.validLine.textContent = issues.length ? `⚠ ${issues.join("; ")}` : "✓ valid — ready to play";
      this.validLine.style.color = issues.length ? "#f0a0a0" : "#9ff0bf";
    }
  }

  /**
   * The slab tray's resize grip (D98). Dragging it changes the dock height; a taller dock shrinks
   * #app, and `this.scale.refresh()` re-fits the FIT-scaled canvas into the smaller box — so the
   * board scales down smoothly instead of clipping. Clamped so neither the board nor the tray can
   * collapse to nothing.
   */
  private buildDockGrip(): HTMLDivElement {
    const grip = document.createElement("div");
    grip.dataset.role = "dock-grip";
    grip.textContent = "⣿ ⣿ ⣿";
    grip.title = "drag to resize the tray";
    Object.assign(grip.style, {
      flex: "0 0 auto", height: "13px", display: "flex", alignItems: "center", justifyContent: "center",
      cursor: "ns-resize", color: "#80766a", letterSpacing: "3px", fontSize: "10px",
      background: "#241b10", borderBottom: "1px solid #2c2117", userSelect: "none", touchAction: "none",
    } as CSSStyleDeclaration);
    let startY = 0;
    let startH = 0;
    let dragging = false;
    // Re-fit on the NEXT frame, coalesced: setting dock.style.height doesn't flush flexbox
    // synchronously, so a same-tick scale.refresh() would measure a stale (too-tall) #app and
    // leave the canvas overflowing by a sliver (a white repaint strip). rAF defers the refit
    // past layout, and running it in a frame guarantees a render clears the resized backing store.
    let pending = 0;
    const refit = (): void => {
      pending = 0;
      this.scale.refresh();
    };
    const scheduleRefit = (): void => {
      if (!pending) pending = requestAnimationFrame(refit);
    };
    const onMove = (e: PointerEvent): void => {
      if (!dragging) return;
      const h = Math.max(120, Math.min(window.innerHeight - 160, startH + (startY - e.clientY)));
      if (this.dock) this.dock.style.height = `${h}px`;
      scheduleRefit();
    };
    const onUp = (): void => {
      dragging = false;
      scheduleRefit(); // settle-fit against the final, flushed layout
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    grip.addEventListener("pointerdown", (e) => {
      dragging = true;
      startY = e.clientY;
      startH = this.dock?.offsetHeight ?? 210;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      e.preventDefault();
    });
    return grip;
  }

  private unmountPanel(): void {
    window.removeEventListener("keydown", this.hKeyDown);
    for (const type of ["input", "change", "focusout"]) window.removeEventListener(type, this.hPanelEdit, true);
    this.dock?.remove();
    this.dock = undefined;
    this.sideDrawer?.remove();
    this.sideDrawer = undefined;
    this.drawerOpen = false;
    document.body.classList.remove("editor-mode");
    this.panel?.remove();
    this.panel = undefined;
    this.exportPre = undefined;
    this.validLine = undefined;
    this.coordEl = undefined;
    this.inspectorEl = undefined;
    this.unitListEl = undefined;
    this.objectivesEl = undefined;
    this.libraryEl = undefined;
    this.brushButtons = [];
    this.paletteCards = [];
    this.paletteStrips = {};
    this.optionButtons = [];
    this.tabButtons = [];
    this.drawers = {};
  }
}

/** Two grid coords are the same tile. */
function same(a: GridCoord, b: GridCoord): boolean {
  return a.col === b.col && a.row === b.row;
}

/** A compact letter tag for a gate's open conditions (L=lockpick · K=keyholder · D=destructible), for the board marker. */
function gateTag(g: AuthoredGate): string {
  let s = "";
  if (g.openBy.some((c) => c.kind === "lockpick")) s += "L";
  if (g.openBy.some((c) => c.kind === "keyholder")) s += "K";
  if (g.openBy.some((c) => c.kind === "destructible")) s += "D";
  return s;
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
