/**
 * The **camp panel chrome** (D35/D58/D80) — the shared beat furniture the prep + react camps
 * both dress themselves in: the caravan-state **readout tiles** + hover **effect-preview** area,
 * the collapsible **category drawers**, the **action cards / cost chips**, the greyable
 * **camp buttons**, and the hand-rolled **nav tabs**. The two beats stay thin configurations in
 * {@link "./scenes/OverworldScene".OverworldScene} — they gather the run's action data and call
 * these primitives; the panel owns none of the beat flow, only how a tile/row/tab is drawn.
 *
 * **Data in / intent out**: the run + shared object layers come in through the context (via live
 * getters, since the scene reassigns `campDrawers`); the panel never mutates the run — an action
 * row/button just fires the host's `onClick`. It owns the readout comparison state (baseline / last
 * / pulse tweens / preview geometry); the scene's `clearCamp` calls {@link CampPanel.clearReadouts}
 * at the same lifecycle point, and still clears the shared `campObjects`/`previewObjects` itself
 * (those are the scene's layer discipline, and the screenshot harness reads them off the scene).
 */

import Phaser from "phaser";
import { COLOR, FONT, INK } from "./theme";
import { fitText, clearLayer, isScreenshotMode } from "./ui";
import { Button, type HintSink } from "./button";
import { ICON } from "./icons";
import { campReadout, type CampReadout, type PreviewChange, type PreviewStat, type RunState } from "../core";

/** The hover-preview projection (a list of {@link PreviewChange}) — the panel only lays it out. */
export type ActionPreview = PreviewChange[];
/** A readout tile's stat key (aliases the core preview-stat name). */
export type ReadoutStat = PreviewStat;

/**
 * A structured action cost (the standardized **component** model) — each present field renders as a
 * fixed-slot icon+number chip (gold / fatigue / material / cooldown), so costs read the same way and
 * line up across every action row. Absent fields show nothing; an all-absent cost reads "free".
 */
export interface ActionCost {
  /** Purse gold spent. */
  gold?: number;
  /** Overworld effort accrued on the actor. */
  fatigue?: number;
  /** A consumed material (id → count), when an action spends stock. */
  material?: { id: string; n: number };
  /** Nights until it's ready again (a cooldown already ticking). */
  cooldown?: number;
}

/** One action row inside a collapsible camp category drawer (Recovery/Intel/Economy). */
export interface CampAction {
  /** The button label — already tagged with the acting member (` · Name`). */
  label: string;
  /** False greys the row (e.g. a market verb with no market, an unaffordable cost). */
  enabled: boolean;
  onClick: () => void;
  /** The hover hint explaining what it does (and why it's greyed, when it is). */
  tip: string;
  /** The projected effect shown on hover (arrows on the readout tiles + off-panel area). */
  preview?: ActionPreview;
  // --- Structured fields (the card-row prototype) — a verb split into readout-tile slots ---
  /** The verb, on its own (e.g. "Cook Stew"). When set, the row renders as a cost-bearing card. */
  name?: string;
  /** Who performs it (e.g. "Pip"), shown as a muted second slot. */
  actor?: string;
  /** Structured cost, rendered as fixed-order icon+number **component chips** (D&D-style). */
  costs?: ActionCost;
}

/** One caravan-state readout tile — a labelled, semantically-coloured figure with day-move data. */
interface ReadoutTile {
  stat: ReadoutStat;
  label: string;
  value: string;
  ink: string;
  cur: number;
  base: number;
  last: number;
  betterHigher?: boolean;
}

/** The cost **components** in fixed render order — the standardized slots every action reads through. */
const COST_COMPONENTS: readonly { key: keyof ActionCost; glyph: string; ink: string; name: string }[] = [
  { key: "gold", glyph: "¤", ink: INK.gold, name: "gold" },
  { key: "fatigue", glyph: "✦", ink: INK.ember, name: "fatigue" },
  { key: "material", glyph: "◆", ink: INK.cyan, name: "material" },
  { key: "cooldown", glyph: "◷", ink: INK.muted, name: "cooldown (nights)" },
];

/** Width of one fixed cost-component column (prototype) — sized to hold an "icon NN" chip. */
const COST_SLOT_W = 40;
/** The fixed **verb** column width, so the actor lane starts at the same x down every row. */
const NAME_COL_W = 116;
/** The fixed **actor** column width (its lane, before the cost components). */
const ACTOR_COL_W = 44;

/** Host wiring: run data + the shared object layers (live getters) + the hint sink. */
export interface CampPanelContext {
  scene: Phaser.Scene;
  /** The live run. */
  run: () => RunState;
  /** The camp beat's object layer (the scene owns + clears it; the panel pushes onto it). */
  campObjects: () => Phaser.GameObjects.GameObject[];
  /** The transient hover-preview layer (the scene owns + clears it). */
  previewObjects: () => Phaser.GameObjects.GameObject[];
  /** The per-category drawer open-state (read live — the scene reassigns it wholesale). */
  drawers: () => Record<string, boolean>;
  /** The resting-hint sink (the scene's HintPanel). */
  hint: HintSink;
}

export class CampPanel {
  private s: Phaser.Scene;
  private ctx: CampPanelContext;

  // The right-side state readouts (D58): the day's opening figures (to colour each value by its net
  // move *this day*, keyed by the node we're camped at), the previous render's figures (to pulse a
  // tile the instant a value changes), and the live pulse tweens (torn down with the camp so a tween
  // never ticks a destroyed tile).
  private readoutBaseline?: CampReadout;
  private readoutBaselineKey?: string;
  private readoutLast?: CampReadout;
  private readoutTweens: Phaser.Tweens.Tween[] = [];
  // The hover-preview layer geometry: where each readout tile sits (to arrow its gutter) + the
  // off-panel area geometry.
  private readoutGeom?: { x: number; cardW: number; tileCy: Partial<Record<ReadoutStat, number>>; areaX: number; areaW: number; areaTop: number };

  constructor(ctx: CampPanelContext) {
    this.ctx = ctx;
    this.s = ctx.scene;
  }

  // --- Readout tiles + effect preview ---------------------------------------

  /**
   * Build the caravan-state readout tiles (shared by the camp stack and the map row). Anchors the
   * "this day" comparison to the node we're camped at — a value's colour tracks its **net move since
   * we made camp here** — re-baselining (and suppressing the change-pulse) on a fresh node/scene.
   */
  private buildReadoutTiles(): { tiles: ReadoutTile[]; fresh: boolean } {
    const run = this.ctx.run();
    const r = campReadout(run);
    const nodeKey = run.mapNodeId;
    const fresh = this.readoutBaselineKey !== nodeKey;
    if (fresh) {
      this.readoutBaseline = r;
      this.readoutBaselineKey = nodeKey;
      this.readoutLast = r;
    }
    const base = this.readoutBaseline!;
    const last = this.readoutLast!;
    const moraleInk = r.moraleTier === "Low" ? INK.ember : r.moraleTier === "Neutral" ? INK.secondary : INK.success;
    // `betterHigher` gives each value a *sense* — a rising purse reads good (green), a rising Upkeep
    // bad (red). Storage carries no valence (loot vs. headroom), so it keeps its semantic ink.
    const tiles: ReadoutTile[] = [
      { stat: "purse", label: "Purse", value: `${r.purse}g`, ink: INK.gold, cur: r.purse, base: base.purse, last: last.purse, betterHigher: true },
      { stat: "morale", label: "Morale", value: `${r.moraleTier} (${r.morale >= 0 ? "+" : ""}${r.morale})`, ink: moraleInk, cur: r.morale, base: base.morale, last: last.morale, betterHigher: true },
      { stat: "storage", label: "Storage", value: `${r.storageUsed}/${r.storageCap}`, ink: r.storageUsed >= r.storageCap ? INK.ember : INK.secondary, cur: r.storageUsed, base: base.storageUsed, last: last.storageUsed },
      { stat: "kits", label: "Trap Kits", value: `${r.kits}`, ink: r.kits > 0 ? INK.secondary : INK.disabled, cur: r.kits, base: base.kits, last: last.kits, betterHigher: true },
      { stat: "rp", label: "Rest Pts", value: `${r.rp}`, ink: INK.secondary, cur: r.rp, base: base.rp, last: last.rp, betterHigher: true },
      { stat: "upkeep", label: "Upkeep", value: `${r.upkeep}g/night`, ink: INK.ember, cur: r.upkeep, base: base.upkeep, last: last.upkeep, betterHigher: false },
    ];
    this.readoutLast = r;
    return { tiles, fresh };
  }

  /** A tile's **day-move colour**: green if it moved the good way since we made camp, red if bad. */
  private tileInk(t: ReadoutTile): string {
    if (t.betterHigher !== undefined && t.cur !== t.base) {
      return (t.cur > t.base) === t.betterHigher ? INK.success : INK.danger;
    }
    return t.ink;
  }

  /**
   * The caravan's live **state readouts** (D58) — a vertical stack of value tiles drawn to the right
   * of the action column, plus the off-panel EFFECT PREVIEW area below them. Returns the `y` past the
   * tile stack.
   */
  renderReadouts(x: number, top: number, cardW: number): number {
    const objects = this.ctx.campObjects();
    const { tiles, fresh } = this.buildReadoutTiles();
    const cardH = 34;
    const pitch = 42;
    const tileCy: Partial<Record<ReadoutStat, number>> = {};
    tiles.forEach((t, i) => {
      const cy = top + i * pitch;
      tileCy[t.stat] = cy;
      const ink = this.tileInk(t);
      const rect = this.s.add.rectangle(x, cy, cardW, cardH, COLOR.surfaceRaised).setStrokeStyle(1, COLOR.borderSoft).setOrigin(0, 0.5).setDepth(10);
      const label = this.s.add.text(x + 12, cy, t.label.toUpperCase(), { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.body }).setOrigin(0, 0.5).setDepth(11);
      // 14px (one above the 13px body label) — the value stays the figure without towering
      // over its label the way the old 16px heading did. Deliberately between body/heading.
      const value = this.s.add.text(x + cardW - 12, cy, t.value, { color: ink, fontFamily: FONT.family, fontSize: FONT.figure }).setOrigin(1, 0.5).setDepth(11);
      objects.push(rect, label, value);
      // Pulse a tile the instant its figure changes from the previous paint (an action's
      // effect landing) — but not on the first paint of a camp (`fresh`), which isn't a move.
      if (!fresh && t.cur !== t.last && !isScreenshotMode()) this.pulseTile(x, cy, cardW, cardH, value);
    });

    // The off-panel preview area, below the tiles: a header + a rule, then the transient
    // body ({@link showActionPreview}) — arrows land in the gutter beside the tiles above,
    // off-panel effects (HP/Fatigue/Influence/…) list here. Reserve it so hover has a home.
    const tilesBottom = top + (tiles.length - 1) * pitch + cardH / 2;
    const areaTop = tilesBottom + 14;
    objects.push(this.s.add.text(x, areaTop, "EFFECT PREVIEW", { color: INK.gold, fontFamily: FONT.family, fontSize: FONT.caption }).setOrigin(0, 0.5).setDepth(11));
    const rule = this.s.add.graphics().setDepth(11);
    rule.lineStyle(1, COLOR.borderSoft, 0.7);
    rule.lineBetween(x, areaTop + 12, x + cardW, areaTop + 12);
    objects.push(rule);
    this.readoutGeom = { x, cardW, tileCy, areaX: x, areaW: cardW, areaTop: areaTop + 12 };
    this.showActionPreview(null);

    return tilesBottom;
  }

  /**
   * The caravan-state readouts as a **horizontal tile row** across the map's top (D80 consistency):
   * the same label+value cards the camp/survey beats stack on the right, laid out in a row since the
   * map has no side panel. Values day-colour like the camp tiles. Drawn onto the map view's board
   * `layer` so it clears with the map. Replaces the old inline "Purse … · Upkeep …" HUD line.
   */
  renderMapReadouts(top: number, layer: Phaser.GameObjects.GameObject[]): void {
    const { tiles } = this.buildReadoutTiles();
    const marginX = 80;
    const usableW = this.s.scale.width - 2 * marginX;
    const gap = 8;
    const tileW = (usableW - gap * (tiles.length - 1)) / tiles.length;
    const cardH = 40;
    tiles.forEach((t, i) => {
      const x = marginX + i * (tileW + gap);
      const cx = x + tileW / 2;
      const rect = this.s.add.rectangle(x, top, tileW, cardH, COLOR.surfaceRaised).setStrokeStyle(1, COLOR.borderSoft).setOrigin(0, 0).setDepth(6);
      const label = this.s.add.text(cx, top + 12, t.label.toUpperCase(), { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.caption }).setOrigin(0.5).setDepth(7);
      const value = this.s.add.text(cx, top + 28, t.value, { color: this.tileInk(t), fontFamily: FONT.family, fontSize: FONT.figure }).setOrigin(0.5).setDepth(7);
      fitText(label, tileW - 10);
      fitText(value, tileW - 10);
      layer.push(rect, label, value);
    });
  }

  /**
   * Paint the hover preview for one action (or clear it, `preview === null`, to the resting
   * "hover an action" prompt). Panel changes draw a signed arrow in the gutter *left of*
   * their readout tile; off-panel changes (HP, Fatigue, Influence, Debt, …) list in the
   * preview area below the tiles. Lives on its own {@link previewObjects} layer so a
   * hover-out redraws just this, never the whole camp. Colour follows each change's `good`.
   */
  showActionPreview(preview: ActionPreview | null): void {
    const previewObjects = this.ctx.previewObjects();
    clearLayer(previewObjects);
    const g = this.readoutGeom;
    if (!g) return;
    if (!preview || preview.length === 0) {
      previewObjects.push(this.s.add.text(g.areaX, g.areaTop + 14, "Hover an action to preview its effect.", { color: INK.disabled, fontFamily: FONT.family, fontSize: FONT.caption, lineSpacing: 3, wordWrap: { width: g.areaW } }).setOrigin(0, 0).setDepth(13));
      return;
    }
    const disp = (c: PreviewChange): { text: string; ink: string } => {
      const good = c.good ?? (c.amount ?? 0) >= 0;
      const arrow = c.amount === undefined ? "" : c.amount >= 0 ? "▲" : "▼";
      const text = c.text ?? `${c.amount! >= 0 ? "+" : ""}${c.amount}`;
      return { text: `${arrow}${arrow ? " " : ""}${text}`, ink: good ? INK.success : INK.danger };
    };
    // Panel changes → an arrow in the gutter beside the matching tile.
    for (const c of preview) {
      if (!c.stat) continue;
      const cy = g.tileCy[c.stat];
      if (cy === undefined) continue;
      const d = disp(c);
      previewObjects.push(this.s.add.text(g.x - 12, cy, d.text, { color: d.ink, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(1, 0.5).setDepth(13));
    }
    // Off-panel changes → the reserved area below the tiles.
    const off = preview.filter((c) => !c.stat);
    if (off.length === 0) {
      previewObjects.push(this.s.add.text(g.areaX, g.areaTop + 14, "No off-panel effects.", { color: INK.disabled, fontFamily: FONT.family, fontSize: FONT.caption }).setOrigin(0, 0).setDepth(13));
      return;
    }
    let ay = g.areaTop + 20;
    for (const c of off) {
      const d = disp(c);
      previewObjects.push(
        this.s.add.text(g.areaX, ay, c.label, { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(13),
        this.s.add.text(g.areaX + g.areaW, ay, d.text, { color: d.ink, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(1, 0.5).setDepth(13),
      );
      ay += 20;
    }
  }

  /** A one-shot attention pulse on a just-changed readout tile: a quick value bump + a
   *  fading firelight glow. Tweens are tracked so {@link clearReadouts} can tear them down. */
  private pulseTile(x: number, cy: number, cardW: number, cardH: number, value: Phaser.GameObjects.Text): void {
    value.setScale(1.4);
    this.readoutTweens.push(this.s.tweens.add({ targets: value, scale: 1, duration: 360, ease: "Back.out" }));
    // A translucent glow over the tile (no numeric colour-tween — that would lerp to muddy
    // in-between hues), faded to nothing so the eye catches the change then settles.
    const glow = this.s.add.rectangle(x, cy, cardW, cardH, COLOR.accent, 0.3).setOrigin(0, 0.5).setDepth(12);
    this.ctx.campObjects().push(glow);
    this.readoutTweens.push(this.s.tweens.add({ targets: glow, alpha: 0, duration: 460, ease: "Cubic.out" }));
  }

  /** Tear down the readout pulse tweens + preview geometry (the scene clears the shared layers). */
  clearReadouts(): void {
    this.readoutTweens.forEach((t) => t.remove());
    this.readoutTweens = [];
    this.readoutGeom = undefined;
  }

  // --- Drawers --------------------------------------------------------------

  /**
   * A collapsible **category drawer** header: a ▾/▸ chevron, the category name, and a
   * count of the actions inside. Returns the `y` past the header; the caller renders the
   * child rows only when the drawer is open. `rerender` redraws the owning beat (camp or
   * survey) when the drawer is toggled.
   */
  drawerHeader(x: number, y: number, w: number, id: string, label: string, count: number, rerender: () => void): number {
    const open = this.ctx.drawers()[id] ?? true;
    const glyph = open ? ICON.collapse.glyph : ICON.expand.glyph;
    this.campButton(x, y, w, 24, `${glyph}  ${label}  (${count})`, true, () => { this.ctx.drawers()[id] = !open; rerender(); }, `${label}: ${count} action${count === 1 ? "" : "s"} here — click to ${open ? "collapse" : "expand"}.`);
    return y + 30;
  }

  /**
   * Render a collapsible category drawer of simple action rows (the shared path for
   * Recovery and Intel). Draws **nothing** when the category is empty — an action the
   * party can't field is no drawer at all. Returns the `y` past it.
   */
  renderDrawer(id: string, label: string, colX: number, y: number, rowH: number, actions: CampAction[], rerender: () => void): number {
    if (actions.length === 0) return y;
    y = this.drawerHeader(colX, y, 360, id, label, actions.length, rerender);
    if (this.ctx.drawers()[id] ?? true) {
      for (const a of actions) {
        // The card-row prototype: a structured action (with a `name`) renders as a cost-bearing
        // card; the rest stay simple buttons until the new grammar is proven and rolled out.
        if (a.name) this.renderActionCard(colX + 14, y, 346, 26, a);
        else this.campButton(colX + 14, y, 346, 24, a.label, a.enabled, a.onClick, a.tip, a.preview);
        y += rowH;
      }
    }
    return y;
  }

  // --- Action cards / cost chips / camp buttons -----------------------------

  /** A camp button that greys out (non-interactive) when disabled, with a reason on hover.
   *  A thin {@link Button} (left-anchored row): left edge at x, label inset 8 (pad/2). */
  campButton(x: number, y: number, w: number, h: number, text: string, enabled: boolean, onClick: () => void, description: string, preview?: ActionPreview): void {
    const btn = new Button(this.s, x + w / 2, y, {
      text,
      w,
      h,
      fill: enabled ? COLOR.surfaceAlt : COLOR.surfaceRaised,
      stroke: enabled ? COLOR.borderSoft : COLOR.surfaceAlt,
      strokeWidth: 1,
      color: enabled ? INK.bright : INK.disabled,
      fontSize: FONT.label,
      pad: 16,
      align: "left",
      hover: false, // camp rows carry their state fill; they never brighten-highlighted on hover
      enabled,
      onClick,
      // The hint + (even when greyed) effect preview drive off the shared hover hooks;
      // seeing *what it would do* explains the grey, snapping back to the resting prompt out.
      onHover: () => {
        this.ctx.hint.setText(description);
        if (preview) this.showActionPreview(preview);
      },
      onOut: preview ? () => this.showActionPreview(null) : undefined,
    });
    this.s.add.existing(btn).setDepth(11);
    this.ctx.campObjects().push(btn);
  }

  /**
   * A **cost-bearing action card** (the readout-tile grammar applied to a verb, prototype): the
   * action **name** (bright) + **actor** (muted) on the left, its compact **cost** right-aligned
   * and coloured by kind — so a row answers "what does this cost and who does it" at a glance, the
   * way the state tiles answer "what is this figure". Hover still drives the richer EFFECT PREVIEW.
   */
  renderActionCard(x: number, y: number, w: number, h: number, a: CampAction): void {
    const objects = this.ctx.campObjects();
    const enabled = a.enabled;
    const bg = this.s.add.rectangle(x, y, w, h, COLOR.surfaceRaised, enabled ? 1 : 0.5).setStrokeStyle(1, enabled ? COLOR.borderSoft : COLOR.border).setOrigin(0, 0.5).setDepth(10);
    // Three aligned lanes: the verb (fixed name column), the actor (its own fixed column), then
    // the cost components on the right — so name / unit / costs line up down every row.
    const nameColW = NAME_COL_W;
    const name = this.s.add.text(x + 12, y, a.name ?? a.label, { color: enabled ? INK.bright : INK.disabled, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(11);
    fitText(name, nameColW);
    objects.push(bg, name);
    if (a.actor) {
      const actor = this.s.add.text(x + 12 + nameColW + 10, y, a.actor, { color: enabled ? INK.muted : INK.disabled, fontFamily: FONT.family, fontSize: FONT.caption }).setOrigin(0, 0.5).setDepth(11);
      fitText(actor, ACTOR_COL_W);
      objects.push(actor);
    }
    this.renderCostChips(x + w - 12, y, a.costs, enabled);
    if (enabled) {
      bg.setInteractive({ useHandCursor: true });
      bg.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, a.onClick);
    }
    bg.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => this.ctx.hint.setText(a.tip));
    if (a.preview) {
      bg.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => this.showActionPreview(a.preview!));
      bg.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, () => this.showActionPreview(null));
    }
  }

  /**
   * The **cost components** of an action row (prototype) — **strict, left-aligned columns**: each
   * component owns a fixed slot in {@link COST_COMPONENTS} order (gold first … cooldown last), and
   * every chip **left-aligns** at its slot's x — so all the ¤ icons line up down the rows, all the ✦
   * icons line up, and so on (the number, not the icon, varies). Scan a column to see which actions
   * cost that resource. Absent components leave their slot blank; an all-blank cost reads "free".
   */
  private renderCostChips(rightX: number, y: number, costs: ActionCost | undefined, enabled: boolean): void {
    const objects = this.ctx.campObjects();
    const present = COST_COMPONENTS.filter((c) => costs?.[c.key] != null);
    const chipText = (c: (typeof COST_COMPONENTS)[number]) => {
      const v = costs![c.key]!;
      const n = c.key === "material" ? (v as { n: number }).n : (v as number);
      return `${c.glyph} ${n}`;
    };
    const slotW = COST_SLOT_W;
    const areaLeft = rightX - COST_COMPONENTS.length * slotW;
    if (present.length === 0) {
      // "free" sits where the first (gold) column would start, so it reads in line with the icons.
      objects.push(this.s.add.text(areaLeft, y, "free", { color: enabled ? INK.muted : INK.disabled, fontFamily: FONT.family, fontSize: FONT.caption }).setOrigin(0, 0.5).setDepth(11));
      return;
    }
    COST_COMPONENTS.forEach((c, i) => {
      if (costs?.[c.key] == null) return;
      // Left-align each chip at its fixed slot x, so the *icons* line up down every row.
      objects.push(this.s.add.text(areaLeft + i * slotW, y, chipText(c), { color: enabled ? c.ink : INK.disabled, fontFamily: FONT.family, fontSize: FONT.caption }).setOrigin(0, 0.5).setDepth(11));
    });
  }

  // --- Nav tabs -------------------------------------------------------------

  /** One areas-nav button — a left-anchored tab with an active (gold) highlight, a hover
   *  hint, drawn onto the given `layer` so the nav can live on the camp or the page. */
  navButton(x: number, y: number, w: number, h: number, text: string, active: boolean, onClick: () => void, description: string, layer: Phaser.GameObjects.GameObject[]): void {
    // Deliberately NOT a Button (#134): a nav tab draws its rect at depth 25 and its label
    // at depth 26 — straddling overlapping ledger-transition content (depth 25) that bleeds
    // through under the tab but behind the label. A Button is a single-depth Container, so it
    // can't put the rect below and the label above the same sibling; kept hand-rolled to hold
    // that exact layering (the survey nav persists under the night-end ledger sheet).
    const bg = this.s.add.rectangle(x, y, w, h, active ? COLOR.btnFill : COLOR.surfaceAlt).setStrokeStyle(1, active ? COLOR.gold : COLOR.borderSoft).setOrigin(0, 0.5).setDepth(25).setInteractive({ useHandCursor: true });
    const label = this.s.add.text(x + 10, y, text, { color: active ? INK.gold : INK.bright, fontFamily: FONT.family, fontSize: FONT.label }).setOrigin(0, 0.5).setDepth(26);
    fitText(label, w - 16);
    bg.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, onClick);
    bg.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OVER, () => this.ctx.hint.setText(description));
    layer.push(bg, label);
  }
}
