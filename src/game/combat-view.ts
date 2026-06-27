import Phaser from "phaser";
import {
  gridToScreen,
  screenToGrid,
  statusVisual,
  isValidSkillTarget,
  isImmobilized,
  isFlanked,
  reachableTiles,
  forecastEnemyAction,
  threatenedTiles,
  manhattan,
  computeDamage,
  computeFlankBonus,
  abilityFootprint,
  PASSIVE,
  isActive,
  orthoNeighbors,
  TILE_WIDTH,
  TILE_HEIGHT,
  type TileGrid,
  type GridCoord,
  type Unit,
  type SkillDef,
} from "../core";
import { COLOR, FONT, INK, WEIGHT } from "./theme";
import { roleColor } from "./roles";
import { ICON } from "./icons";
import { hpColor, statusPips, type Pip } from "./unit-readout";

/** The flank pseudo-status — computed from board position, shown in the status vocabulary. */
const FLANK_PIP = { glyph: ICON.flank.glyph, color: INK.danger, label: "Flanked" } as const;

/** A status badge — the shared {@link Pip} (glyph + colour) the board lays out. */
type StatusPip = Pip;

/** Build a unit's status pips: each real status (glyph + turns left), then the flank pip. */
function statusPipsFor(unit: Unit, units: readonly Unit[]): StatusPip[] {
  const pips: StatusPip[] = statusPips(unit);
  if (unit.alive && !unit.captured && isFlanked(unit, units)) pips.push({ text: FLANK_PIP.glyph, color: FLANK_PIP.color });
  return pips;
}

/** Truncate a unit name to fit a rail chip — ellipsised past ~13 chars. */
function shortName(name: string): string {
  return name.length > 13 ? name.slice(0, 12) + "…" : name;
}

/** Short token glyph for a unit: initials of a two-word name, else the first two letters. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (name[0]?.toUpperCase() ?? "") + (name[1]?.toLowerCase() ?? "");
}

/** One row of the initiative rail — the pooled objects making up a unit's chip. */
interface CtChip {
  bg: Phaser.GameObjects.Rectangle;
  dot: Phaser.GameObjects.Arc;
  name: Phaser.GameObjects.Text;
  ct: Phaser.GameObjects.Text;
  hpBg: Phaser.GameObjects.Rectangle;
  hpFill: Phaser.GameObjects.Rectangle;
  /** A compact status summary (glyphs + flank), tinted by severity. */
  status: Phaser.GameObjects.Text;
}

/** Up to this many status pips are drawn under a token (real statuses + the flank pip). */
const MAX_STATUS_PIPS = 5;

/** The on-board presentation of one unit: a token container and its sub-parts. */
export interface UnitView {
  /** The live core unit (mutated in place, so reads stay current). */
  unit: Unit;
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Arc;
  /** Floating "Name" / "hp/max" plate — shown only for the active or hovered unit. */
  label: Phaser.GameObjects.Text;
  hp: Phaser.GameObjects.Text;
  /** Per-status badge pool under the token: glyph + turns-left, tinted per status. */
  statusPips: Phaser.GameObjects.Text[];
  hpBarFill: Phaser.GameObjects.Rectangle;
  hpBarW: number;
}

/**
 * The shared **combat presentation** layer — the board geometry, the isometric
 * grid, the tile overlays, *and* the unit tokens — that
 * {@link "./scenes/BattleScene"} (the one mission loop, authored + procedural)
 * renders through.
 *
 * The board + token drawing lives here (not in the scene) so a board tweak — or a
 * future feel/telegraphing pass — is written once. This is the seam: a scene owns
 * its `Battle`,
 * orchestration and HUD, and delegates the board + token pixels here, so a board
 * tweak — or a future feel/telegraphing pass — is written once and shows up in
 * both. It owns the unit token objects (and sweeps them on {@link clearUnits});
 * the scene keeps its own non-unit board FX and teardown.
 */
export class CombatView {
  /** Board origin in screen space — the world offset added to every tile. */
  originX = 0;
  originY = 0;
  /**
   * Uniform board zoom (default 1). Scales tile spacing, the diamonds, and the unit
   * tokens (each token is a container) together, so a scene can enlarge the whole
   * combat field — tiles *and* the details that ride on them (HP bars, nameplates,
   * status pips) — for legibility, with no effect on game logic or the shared `iso`
   * constants. Set it before {@link setOrigin}/{@link drawGrid}/{@link spawnUnit}.
   */
  boardScale = 1;

  /** Every spawned unit's token, keyed by unit id. */
  readonly views = new Map<string, UnitView>();
  /** Live floating-combat-text objects, swept on teardown. */
  readonly floaters = new Set<Phaser.GameObjects.Text>();
  /** Attack-forecast labels drawn over foes in the move/attack preview. */
  private readonly forecastLabels = new Set<Phaser.GameObjects.Text>();
  /** Pooled initiative-rail chips (one per unit row), reused across HUD refreshes. */
  private readonly ctChips: CtChip[] = [];
  /** The combat log's rolling message buffer (oldest first) + its pooled text lines. */
  private readonly logBuffer: { text: string; color: string }[] = [];
  private readonly logLines: Phaser.GameObjects.Text[] = [];
  /**
   * A turn header held back until that turn actually logs something (D-UX): quiet
   * move/defend turns never flush it, so the feed carries *events* (who hit whom, who
   * fell), not a column of empty "— Name —" lines. Flushed by the first event of the
   * turn; replaced (unshown) by the next turn's header.
   */
  private pendingHeader: { text: string; color: string } | null = null;
  /** The unit taking its turn / under the cursor — both reveal a nameplate. */
  activeUnitId: string | null = null;
  hoveredUnitId: string | null = null;
  /** Skip perpetual/juice motion (set by the screenshot harness) for stable frames. */
  reduceMotion = false;
  /**
   * Conceal enemy tokens entirely (D12). Set during deployment: the foe is
   * pre-positioned on the board but unseen — the party reads the closing net and
   * the campfire's safe radius, not the enemy's exact placement. Cleared when the
   * battle opens, so the foe resolves into view. (A future intel/scout ability can
   * surface a faint "ghost" of the formation instead of this hard veil.)
   */
  concealEnemies = false;

  /** Units we've already played the death pop for (reset each encounter). */
  private readonly deadSeen = new Set<string>();
  /**
   * The most recent damage dealt to a unit, fed from the scene's `unitDamaged`
   * bus and consumed by {@link flashHit} so a heavy blow shakes harder than a
   * chip — without threading the amount through every attack call site.
   */
  private readonly lastHit = new Map<string, number>();

  constructor(private readonly scene: Phaser.Scene) {}

  // --- Board geometry -------------------------------------------------------

  /** Re-anchor the board (call whenever the scene recomputes its layout). */
  setOrigin(x: number, y: number): void {
    this.originX = x;
    this.originY = y;
  }

  /** Half a tile's width/height at the current board zoom (for scene-side geometry). */
  halfW(): number {
    return (TILE_WIDTH / 2) * this.boardScale;
  }
  halfH(): number {
    return (TILE_HEIGHT / 2) * this.boardScale;
  }

  /** Tile coordinate → board-world pixel (the diamond's centre). */
  tileToWorld(coord: GridCoord): { x: number; y: number } {
    const { x, y } = gridToScreen(coord);
    return { x: this.originX + x * this.boardScale, y: this.originY + y * this.boardScale };
  }

  /** Board-world pixel → nearest tile coordinate. */
  worldToTile(px: number, py: number): GridCoord {
    const frac = screenToGrid({ x: (px - this.originX) / this.boardScale, y: (py - this.originY) / this.boardScale });
    return { col: Math.round(frac.col), row: Math.round(frac.row) };
  }

  /**
   * Paint the whole grid onto `g`: a checkered floor diamond per tile, then **raised 3D
   * blocks** on the impassable tiles so an obstacle reads as a solid standing in the world,
   * not a flat tile-marker (which is what the capture-zone washes are). Two passes: the flat
   * floor first, then the blocks back-to-front (by screen depth, `col + row` ascending) so a
   * nearer block correctly occludes the one behind it.
   */
  drawGrid(g: Phaser.GameObjects.Graphics, grid: TileGrid): void {
    const blocked: GridCoord[] = [];
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) {
        const { x, y } = this.tileToWorld({ col, row });
        // The floor under a block is hidden by it, but drawn so nothing peeks at small scales.
        const fill = grid.isWalkable({ col, row }) ? ((col + row) % 2 === 0 ? COLOR.tileLight : COLOR.tileDark) : COLOR.tileDark;
        this.drawDiamond(g, x, y, fill);
        if (!grid.isWalkable({ col, row })) blocked.push({ col, row });
      }
    }
    blocked.sort((a, b) => a.col + a.row - (b.col + b.row));
    for (const c of blocked) {
      const { x, y } = this.tileToWorld(c);
      this.drawObstacle(g, x, y);
    }
  }

  /**
   * Draw a raised isometric **obstacle block** centred on a tile at world `(cx, cy)`: a lit
   * top face floating a block-height above the tile, plus the two visible (down-left /
   * down-right) side faces shaded darker, outlined for a crisp silhouette. The three faces
   * tile the block's hexagonal silhouette exactly, so it's an opaque solid.
   */
  private drawObstacle(g: Phaser.GameObjects.Graphics, cx: number, cy: number): void {
    const hw = this.halfW();
    const hh = this.halfH();
    const H = hh * 1.3; // block elevation (in px, scaled with the board) — a chunky, readable rise
    // Ground diamond + the same diamond raised by H (the top face).
    const gB = { x: cx, y: cy + hh }, gL = { x: cx - hw, y: cy }, gR = { x: cx + hw, y: cy };
    const tT = { x: cx, y: cy - hh - H }, tR = { x: cx + hw, y: cy - H }, tB = { x: cx, y: cy + hh - H }, tL = { x: cx - hw, y: cy - H };
    const face = (color: number, pts: { x: number; y: number }[]) => {
      g.fillStyle(color, 1);
      g.beginPath();
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
      g.closePath();
      g.fillPath();
    };
    face(COLOR.obstacleLeft, [tL, tB, gB, gL]); // down-left side
    face(COLOR.obstacleRight, [tB, tR, gR, gB]); // down-right side
    face(COLOR.obstacleTop, [tT, tR, tB, tL]); // lit top
    // Crisp edges: the top-face outline + the three vertical corners.
    g.lineStyle(1, COLOR.obstacleEdge, 1);
    g.beginPath();
    g.moveTo(tT.x, tT.y); g.lineTo(tR.x, tR.y); g.lineTo(tB.x, tB.y); g.lineTo(tL.x, tL.y); g.closePath();
    g.moveTo(tL.x, tL.y); g.lineTo(gL.x, gL.y);
    g.moveTo(tB.x, tB.y); g.lineTo(gB.x, gB.y);
    g.moveTo(tR.x, tR.y); g.lineTo(gR.x, gR.y);
    g.strokePath();
  }

  /** A translucent wash over one tile (reach / threat / safe-zone), with an optional outline. */
  fillTile(g: Phaser.GameObjects.Graphics, coord: GridCoord, fill: number, alpha: number, line?: number): void {
    const { x, y } = this.tileToWorld(coord);
    this.diamondPath(g, x, y);
    g.fillStyle(fill, alpha);
    g.fillPath();
    if (line !== undefined) {
      g.lineStyle(2, line, 0.9);
      g.strokePath();
    }
  }

  /** A tile outline only — e.g. an enemy's attack-range marker. */
  outlineTile(g: Phaser.GameObjects.Graphics, coord: GridCoord, color: number): void {
    const { x, y } = this.tileToWorld(coord);
    this.diamondPath(g, x, y);
    g.lineStyle(2.5, color, 0.95);
    g.strokePath();
  }

  /** Outline a single tile (the cursor / selected tile) onto `g`, or clear it on null. */
  highlightTile(g: Phaser.GameObjects.Graphics, coord: GridCoord | null): void {
    g.clear();
    if (!coord) return;
    const { x, y } = this.tileToWorld(coord);
    this.diamondPath(g, x, y);
    g.lineStyle(3, COLOR.accent, 1);
    g.strokePath();
  }

  /**
   * Paint a player unit's turn preview onto `g` (the D60 Fire-Emblem-style read):
   * when a skill is `armed`, its valid targets (green allies / red foes); otherwise
   *
   * - a **blue reach wash** over every tile still in the unit's *remaining* move
   *   budget this turn (it shrinks tile-by-tile as the unit steps),
   * - a **lit hover path** (`hoverPath`) — the exact squares the unit would walk to
   *   the tile under the cursor, with a bright outline on the destination,
   * - a **red strike outline + damage badge** on every foe the unit can hit from
   *   **where it now stands** (the attack it can take this instant) — unless it has
   *   already `acted`, since the Act is once per turn.
   *
   * Clears `g` first, so the caller just re-invokes it whenever the turn state
   * (budget, hover, acted) changes.
   */
  drawPreview(
    g: Phaser.GameObjects.Graphics,
    actor: Unit,
    units: readonly Unit[],
    grid: TileGrid,
    opts: {
      armed?: SkillDef;
      /** The hovered/aimed tile when a skill is armed — drives the footprint overlay (D64). */
      armedAim?: GridCoord;
      /** "Does a trap stand on this tile?" — the scene's entity read, for the push-into-trap badge (D64 follow-up #2). */
      intoTrap?: (c: GridCoord) => boolean;
      moveBudget: number;
      acted: boolean;
      hoverPath?: readonly GridCoord[];
      /**
       * Which board phase is asking. `"deploy"` paints only the *movement* read — the
       * reach wash + lit hover path — and suppresses the **strike telegraph** and **enemy
       * intents**: engagement is combat-only (the stealth/alarm invariant), so the deploy
       * preview must never offer a strike. Defaults to `"battle"` (the full read).
       */
      mode?: "battle" | "deploy";
    },
  ): void {
    g.clear();
    this.clearForecast();
    const { armed, armedAim, intoTrap, moveBudget, acted, hoverPath, mode = "battle" } = opts;
    if (armed) {
      // The *legal target set*, kept faintly so the player still sees where the skill can
      // land while the footprint highlights the current aim (D64: keep the valid-target read).
      for (const u of units) {
        if (!u.alive || u.hidden || !isValidSkillTarget(armed, actor, u)) continue;
        const ally = u.side === actor.side;
        this.fillTile(g, u.pos, ally ? COLOR.success : COLOR.danger, 0.12);
      }
      // The footprint overlay (D64): paint what the armed ability affects, given the aim.
      if (armedAim) this.drawFootprint(g, armed, actor, armedAim, grid, units, intoTrap);
      return;
    }
    // Reach wash for the movement still in the budget this turn — the set of tiles a
    // click would walk to (the start tile is implicit and left unwashed).
    if (moveBudget > 0 && !isImmobilized(actor)) {
      for (const r of reachableTiles(actor, units, grid, moveBudget)) {
        if (r.tile.col === actor.pos.col && r.tile.row === actor.pos.row) continue;
        this.fillTile(g, r.tile, COLOR.reach, 0.16);
      }
    }
    // The hovered route, lit square-by-square (FFT/FE path read), destination ringed.
    if (hoverPath && hoverPath.length > 0) {
      for (const tile of hoverPath) this.fillTile(g, tile, COLOR.reach, 0.42, COLOR.accent);
      this.outlineTile(g, hoverPath[hoverPath.length - 1], COLOR.accent);
    }
    // Strike telegraph: the foes the actor could hit **in place** right now — outline
    // each and float a forecast badge (best-case damage, flank tag, lethal skull).
    // Suppressed once the Act is spent (no second attack this turn), and entirely in
    // Deployment — engagement (and so any strike read) is combat-only (stealth/alarm).
    if (mode === "battle" && !acted) {
      for (const foe of units) {
        if (!foe.alive || foe.hidden || foe.side === actor.side) continue;
        const f = this.inPlaceForecast(actor, foe, units);
        if (!f) continue;
        this.outlineTile(g, foe.pos, f.lethal ? COLOR.danger : COLOR.threat);
        this.drawForecast(foe, f);
      }
    }
    // Enemy intent: for every foe that would act on one of the actor's side next
    // turn, draw a threat link to its mark and the incoming damage — read the
    // counter-attack before you commit. Combat-only: in Deployment the foe is veiled
    // and not yet engaging, so it telegraphs nothing.
    if (mode === "battle") this.drawIntents(g, actor, units, grid);
  }

  /**
   * Paint the **footprint** of an armed ability given the current aim (D64) — the
   * geometry half of the telegraph. Reads the pure {@link abilityFootprint} and
   * switches on its `kind`:
   *
   * - `single` — outline the aimed tile (the legal set still shows faintly).
   * - `arc` — wash the Cleave arc + outline each foe caught.
   * - `push` — an arrow from target → landing, flagged on a blocker / a trap at the
   *   landing (`intoTrap`, the scene's entity read for the D19 push-into-trap combo).
   * - `placement` — outline the claimed tile (Set Trap, Deployment).
   * - `self` — highlight the caster's tile.
   * - `none` — nothing on the board (the forecast box still shows).
   */
  private drawFootprint(
    g: Phaser.GameObjects.Graphics,
    skill: SkillDef,
    caster: Unit,
    aim: GridCoord,
    grid: TileGrid,
    units: readonly Unit[],
    intoTrap?: (c: GridCoord) => boolean,
  ): void {
    const fp = abilityFootprint(skill, caster, aim, grid, units);
    switch (fp.kind) {
      case "single":
        this.fillTile(g, fp.tile, COLOR.danger, 0.26, COLOR.accent);
        break;
      case "arc": {
        for (const t of fp.tiles) this.fillTile(g, t, COLOR.threat, 0.24);
        for (const foe of fp.units) this.outlineTile(g, foe.pos, COLOR.danger);
        break;
      }
      case "push": {
        // Arrow from the target tile toward where it lands (the displacement).
        const from = this.tileToWorld(fp.target);
        const to = this.tileToWorld(fp.landing);
        const onTrap = intoTrap ? intoTrap(fp.landing) : false;
        const col = onTrap ? COLOR.danger : fp.blocked ? COLOR.threat : COLOR.accent;
        this.drawArrow(g, from.x, from.y - TILE_HEIGHT / 2, to.x, to.y - TILE_HEIGHT / 2, col);
        // Flag the landing: a danger ring + a tag for "blocked short" or "into trap".
        this.fillTile(g, fp.landing, onTrap ? COLOR.danger : COLOR.reach, 0.22, col);
        if (onTrap || fp.blocked) {
          const tag = onTrap ? `${ICON.trapArmed.glyph} trap` : "blocked";
          this.floatTag(fp.landing, tag, onTrap ? "#ff7a3a" : INK.danger);
        }
        break;
      }
      case "placement":
        // The claimed Set Trap tile (Deployment) — outline + a trap glyph badge.
        this.fillTile(g, fp.tile, COLOR.gold, 0.2, COLOR.gold);
        this.floatTag(fp.tile, ICON.trapMine.glyph, INK.ember);
        break;
      case "self":
        this.fillTile(g, fp.tile, COLOR.success, 0.24, COLOR.accent);
        break;
      case "none":
        break; // a party/camp meta skill — no board anchor; the forecast box carries it.
    }
  }

  /** A short floating tag centred over a tile (footprint annotations — "trap", "blocked"). */
  private floatTag(tile: GridCoord, text: string, color: string): void {
    const { x, y } = this.tileToWorld(tile);
    const label = this.scene.add
      .text(x, y - TILE_HEIGHT / 2 - 14, text, { color, fontFamily: FONT.family, fontSize: FONT.caption, fontStyle: WEIGHT.bold })
      .setOrigin(0.5)
      .setDepth(6)
      .setStroke("#1a0d05", 3);
    this.forecastLabels.add(label);
  }

  /** A straight push arrow with a chevron head, drawn onto `g` (the forced-move telegraph). */
  private drawArrow(g: Phaser.GameObjects.Graphics, x1: number, y1: number, x2: number, y2: number, color: number): void {
    g.lineStyle(3, color, 0.95);
    g.lineBetween(x1, y1, x2, y2);
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const head = 9;
    for (const da of [Math.PI * 0.82, -Math.PI * 0.82]) {
      g.lineBetween(x2, y2, x2 - head * Math.cos(ang + da), y2 - head * Math.sin(ang + da));
    }
  }

  /**
   * Draw the **tarpit aura** (D40) onto `g`: a persistent ring on the tiles
   * orthogonally adjacent to every active unit whose job carries
   * {@link PASSIVE.tarpit} (the Heavy Knight). Shown in **both** Deployment and
   * Battle so the player can position around the speed-1 tax (the original audit
   * gap). Drawn **outline-only** in the pale capture-net bone (`COLOR.net`) — a
   * restraint hue that reads as a tax ring and, crucially, overlays *on top of* the
   * Deployment safe/warning/danger zone washes without competing with their fills
   * (the gold wash it replaced collided with the amber warning zone). Clears `g`
   * first so the scene just re-invokes it.
   */
  drawAuras(g: Phaser.GameObjects.Graphics, units: readonly Unit[], grid: TileGrid): void {
    g.clear();
    const seen = new Set<string>();
    for (const u of units) {
      if (!isActive(u) || u.hidden || !u.passives[PASSIVE.tarpit]) continue;
      for (const t of orthoNeighbors(u.pos)) {
        if (!grid.inBounds(t)) continue;
        const key = `${t.col},${t.row}`;
        if (seen.has(key)) continue;
        seen.add(key);
        this.outlineTile(g, t, COLOR.net);
      }
    }
  }

  /** Threat links from each enemy to the ally it intends to hit next turn (+ incoming damage). */
  private drawIntents(g: Phaser.GameObjects.Graphics, actor: Unit, units: readonly Unit[], grid: TileGrid): void {
    for (const foe of units) {
      if (!foe.alive || foe.hidden || foe.side === actor.side) continue;
      const intent = forecastEnemyAction(foe, units, grid);
      if (!intent || intent.target.side !== actor.side) continue;
      const from = this.tileToWorld(foe.pos);
      const to = this.tileToWorld(intent.target.pos);
      // A thin, semi-transparent threat line tipped with a chevron at the mark.
      g.lineStyle(1.5, COLOR.threat, 0.5);
      g.lineBetween(from.x, from.y - TILE_HEIGHT / 2, to.x, to.y - TILE_HEIGHT / 2);
      // Incoming-damage tag over the threatened ally: "→N" (lethal mark if it would drop them).
      const tag = intent.ability && intent.damage === 0 ? "snare" : `→${intent.damage}${intent.lethal ? ICON.lethal.glyph : ""}`;
      const label = this.scene.add
        .text(to.x, to.y - TILE_HEIGHT / 2 - 18, tag, { color: intent.lethal ? "#ff7a3a" : INK.danger, fontFamily: FONT.family, fontSize: FONT.nameplate, fontStyle: WEIGHT.bold })
        .setOrigin(0.5)
        .setDepth(6)
        .setStroke("#1a0d05", 3);
      this.forecastLabels.add(label);
    }
  }

  /** The in-place strike forecast for a unit that has already moved (no further movement). */
  private inPlaceForecast(actor: Unit, foe: Unit, units: readonly Unit[]): { damage: number; lethal: boolean; flank: boolean } | null {
    if (manhattan(actor.pos, foe.pos) > actor.attackRange) return null;
    const damage = computeDamage(actor, foe, actor.attack, units);
    return { damage, lethal: damage >= foe.hp, flank: computeFlankBonus(actor, foe, units) > 0 };
  }

  /** Float an attack-forecast badge above a foe (best-case damage / flank / lethal). */
  private drawForecast(foe: Unit, f: { damage: number; lethal: boolean; flank: boolean }): void {
    const { x, y } = this.tileToWorld(foe.pos);
    const text = `${f.flank ? ICON.flank.glyph : ""}${f.damage}${f.lethal ? ICON.lethal.glyph : ""}`;
    const color = f.lethal ? "#ff7a3a" : f.flank ? INK.gold : INK.ember;
    const label = this.scene.add
      .text(x, y - TILE_HEIGHT / 2 - 30, text, { color, fontFamily: FONT.family, fontSize: FONT.caption, fontStyle: WEIGHT.bold })
      .setOrigin(0.5)
      .setDepth(6)
      .setStroke("#1a0d05", 3);
    this.forecastLabels.add(label);
  }

  /** Drop every attack-forecast badge (called on redraw and when the preview clears). */
  private clearForecast(): void {
    for (const l of this.forecastLabels) l.destroy();
    this.forecastLabels.clear();
  }

  /** Wipe the preview graphics *and* its forecast badges — scenes call this to clear the preview. */
  clearPreview(g: Phaser.GameObjects.Graphics): void {
    g.clear();
    this.clearForecast();
  }

  /**
   * Wash the **danger zone** onto `g` — every tile a `victimSide` unit could be
   * attacked on this turn (the union of all enemies' reach + attack range) — in
   * threat-red. The "is it safe to stand here?" overlay; clears `g` first so the
   * scene just toggles it on/off by calling this or {@link Phaser.GameObjects.Graphics.clear}.
   */
  drawThreatZone(g: Phaser.GameObjects.Graphics, units: readonly Unit[], grid: TileGrid, victimSide: Unit["side"]): void {
    g.clear();
    for (const t of threatenedTiles(units, grid, victimSide)) this.fillTile(g, t, COLOR.danger, 0.16);
  }

  // --- Initiative rail ------------------------------------------------------

  /** Chip geometry — width, height, and the vertical pitch between rows. */
  private static readonly CHIP_W = 150;
  private static readonly CHIP_H = 22;
  private static readonly CHIP_STEP = 25;

  /**
   * Draw the **initiative rail** anchored at `(x, y)`: one chip per unit, sorted by
   * charge time (who acts soonest on top), then fallen units trailing dimmed. Each
   * chip carries the side-tinted, role-ringed dot, the (truncated) name, a compact
   * HP bar and the CT readout (⏳ while charging) — the active unit's chip lights
   * up. Pooled across refreshes so the HUD doesn't churn objects. Replaces the old
   * monospace "CT order" text list, shared so both scenes read identically.
   */
  /**
   * Draw the initiative rail at `(x, y)`, chips sorted by charge time (soonest
   * first), then the fallen. Pass `limit` to render only the first N rows (the
   * collapsed rail) — the scene layers a chevron to expand. Returns the layout so
   * the caller can place that chevron: total rows, how many were shown, and the y
   * just below the last chip.
   */
  drawInitiative(
    units: readonly Unit[],
    x: number,
    y: number,
    isCharging: (u: Unit) => boolean,
    limit?: number,
  ): { total: number; shown: number; bottomY: number } {
    const live = units.filter((u) => u.alive && !u.captured && !u.hidden).sort((a, b) => b.ct - a.ct);
    const fallen = units.filter((u) => !u.alive && !u.captured && !u.hidden);
    const rows = [...live.map((u) => ({ u, dead: false })), ...fallen.map((u) => ({ u, dead: true }))];
    const shown = limit === undefined ? rows.length : Math.min(rows.length, Math.max(0, limit));
    rows.slice(0, shown).forEach((r, i) => {
      const chip = this.ctChips[i] ?? this.makeCtChip();
      this.ctChips[i] = chip;
      const top = y + i * CombatView.CHIP_STEP;
      const mid = top + CombatView.CHIP_H / 2;
      const active = !r.dead && r.u.id === this.activeUnitId;
      const sideFill = r.u.side === "player" ? COLOR.ally : COLOR.foe;
      const sideEdge = r.u.side === "player" ? COLOR.allyEdge : COLOR.foeEdge;
      chip.bg.setPosition(x, top).setFillStyle(active ? COLOR.surfaceAlt : COLOR.surface, active ? 0.95 : 0.55).setStrokeStyle(active ? 1.5 : 1, active ? COLOR.accent : COLOR.border).setAlpha(r.dead ? 0.4 : 1).setVisible(true);
      chip.dot.setPosition(x + 13, mid).setFillStyle(sideFill).setStrokeStyle(2, roleColor(r.u, sideEdge)).setVisible(true);
      chip.name.setPosition(x + 24, mid - 4).setText(shortName(r.u.name)).setColor(r.dead ? INK.disabled : active ? INK.primary : INK.secondary).setVisible(true);
      chip.ct.setPosition(x + CombatView.CHIP_W - 7, mid - 4).setText(r.dead ? "✕" : `${Math.round(r.u.ct)}${isCharging(r.u) ? ICON.charging.glyph : ""}`).setColor(r.dead ? INK.disabled : active ? INK.ember : INK.muted).setVisible(true);
      const frac = r.u.maxHp > 0 ? Math.max(0, r.u.hp) / r.u.maxHp : 0;
      const hpW = 88;
      chip.hpBg.setPosition(x + 24, mid + 6).setSize(hpW, 3).setVisible(!r.dead);
      chip.hpFill.setPosition(x + 24, mid + 6).setSize(Math.max(0, hpW * frac), 3).setFillStyle(hpColor(frac)).setVisible(!r.dead);
      // Compact status mirror: the glyphs (+flank), tinted by severity, so you can
      // scan the rail for who's debuffed without hunting the board for the pips.
      const flanked = !r.dead && isFlanked(r.u, units);
      const glyphs = r.u.statuses.map((st) => statusVisual(st.id).glyph).join("") + (flanked ? FLANK_PIP.glyph : "");
      const harmful = flanked || r.u.statuses.some((st) => st.kind === "debuff");
      const helpful = r.u.statuses.some((st) => st.kind === "buff");
      chip.status.setPosition(x + CombatView.CHIP_W - 7, mid + 6).setText(r.dead ? "" : glyphs).setColor(harmful ? INK.danger : helpful ? INK.success : INK.muted).setVisible(!r.dead && glyphs.length > 0);
    });
    for (let i = shown; i < this.ctChips.length; i++) this.hideCtChip(this.ctChips[i]);
    return { total: rows.length, shown, bottomY: y + shown * CombatView.CHIP_STEP };
  }

  /** Hide the whole initiative rail (between encounters / on non-battle beats). */
  hideInitiative(): void {
    for (const c of this.ctChips) this.hideCtChip(c);
  }

  /** Build one pooled chip's objects (depth above the board, below overlays). */
  private makeCtChip(): CtChip {
    const s = this.scene;
    const bg = s.add.rectangle(0, 0, CombatView.CHIP_W, CombatView.CHIP_H, COLOR.surface, 0.55).setOrigin(0, 0).setStrokeStyle(1, COLOR.border).setDepth(9);
    const dot = s.add.circle(0, 0, 5, COLOR.ally).setDepth(10);
    const name = s.add.text(0, 0, "", { color: INK.secondary, fontFamily: FONT.family, fontSize: FONT.caption }).setOrigin(0, 0.5).setDepth(10);
    const ct = s.add.text(0, 0, "", { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.caption }).setOrigin(1, 0.5).setDepth(10);
    const hpBg = s.add.rectangle(0, 0, 88, 3, COLOR.bg).setOrigin(0, 0.5).setDepth(10);
    const hpFill = s.add.rectangle(0, 0, 88, 3, COLOR.success).setOrigin(0, 0.5).setDepth(10);
    const status = s.add.text(0, 0, "", { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.micro, fontStyle: WEIGHT.bold }).setOrigin(1, 0.5).setDepth(10);
    return { bg, dot, name, ct, hpBg, hpFill, status };
  }

  private hideCtChip(c: CtChip): void {
    c.bg.setVisible(false);
    c.dot.setVisible(false);
    c.name.setVisible(false);
    c.ct.setVisible(false);
    c.hpBg.setVisible(false);
    c.hpFill.setVisible(false);
    c.status.setVisible(false);
  }

  // --- Combat log -----------------------------------------------------------

  /** How many recent log lines to keep on screen. */
  private static readonly LOG_LINES = 6;

  /**
   * Append a line to the **combat log** — the rolling bottom-left feed that
   * narrates the exchange (who hit whom, who fell) so fast enemy turns don't blur
   * past. Keeps the last {@link LOG_LINES}, newest at the bottom. A {@link pendingHeader}
   * (the turn boundary) is flushed *first*, so a header only appears once its turn
   * has something to say. The typed helpers ({@link logDamage}/{@link logHeal}/
   * {@link logDefeat}) format the common bus events; this is the raw entry point.
   */
  logEvent(text: string, color: string = INK.secondary): void {
    if (this.pendingHeader) {
      this.pushLine(this.pendingHeader);
      this.pendingHeader = null;
    }
    this.pushLine({ text, color });
    this.renderLog();
  }

  /** Buffer one line, evicting the oldest past {@link LOG_LINES}. (Caller renders.) */
  private pushLine(entry: { text: string; color: string }): void {
    this.logBuffer.push(entry);
    if (this.logBuffer.length > CombatView.LOG_LINES) this.logBuffer.shift();
  }

  /** Log "Attacker hits Target −N" (or "Target takes N" for a sourceless trap/rune). */
  logDamage(unit: Unit, amount: number, source?: Unit): void {
    if (amount <= 0) return;
    this.logEvent(source ? `${shortName(source.name)} hits ${shortName(unit.name)} −${amount}` : `${shortName(unit.name)} takes ${amount}`, INK.danger);
  }

  /** Log "Healer mends Target +N" (or "Target +N" when sourceless). */
  logHeal(unit: Unit, amount: number, source?: Unit): void {
    if (amount <= 0) return;
    this.logEvent(source ? `${shortName(source.name)} mends ${shortName(unit.name)} +${amount}` : `${shortName(unit.name)} +${amount}`, INK.success);
  }

  /** Log "Target is defeated". */
  logDefeat(unit: Unit): void {
    this.logEvent(`${shortName(unit.name)} is defeated`, INK.ember);
  }

  /** Log "Rescuer frees Target" (or "Target is freed" when sourceless) — the rescue Act (D52). */
  logRescue(unit: Unit, by?: Unit): void {
    this.logEvent(by ? `${shortName(by.name)} frees ${shortName(unit.name)}` : `${shortName(unit.name)} is freed`, INK.success);
  }

  /**
   * Note a turn-boundary header — "— Name —" — so the feed reads grouped by whose turn
   * it is. Held back ({@link pendingHeader}), not shown, until the turn logs an event:
   * a unit that only repositions or defends adds nothing, keeping the feed to what
   * actually happened. The next turn's header supersedes an un-flushed one.
   */
  logTurn(unit: Unit): void {
    this.pendingHeader = { text: `— ${shortName(unit.name)} —`, color: unit.side === "player" ? INK.gold : INK.muted };
  }

  /** Clear the log (between encounters). */
  clearLog(): void {
    this.logBuffer.length = 0;
    this.pendingHeader = null;
    for (const l of this.logLines) l.setVisible(false);
  }

  /** Re-lay the pooled log lines bottom-anchored in the bottom-right, newest last. */
  private renderLog(): void {
    const step = 14;
    // Bottom-right column (left-aligned text), sitting above the vertical board key so
    // the two right-side readouts stack instead of overprinting — the bottom-left is
    // now the command box (D-UX zone separation).
    const x = this.scene.scale.width - 244;
    const bottomY = this.scene.scale.height - 108;
    const n = this.logBuffer.length;
    this.logBuffer.forEach((entry, i) => {
      const line = this.logLines[i] ?? this.scene.add.text(0, 0, "", { fontFamily: FONT.family, fontSize: FONT.caption }).setDepth(10);
      this.logLines[i] = line;
      // Older lines fade toward the top — the eye lands on the freshest.
      const age = n - 1 - i;
      line.setPosition(x, bottomY - age * step).setText(entry.text).setColor(entry.color).setAlpha(1 - age * 0.13).setVisible(true);
    });
    for (let i = n; i < this.logLines.length; i++) this.logLines[i].setVisible(false);
  }

  /** A solid, bordered tile diamond centred at world `(cx, cy)`. */
  private drawDiamond(g: Phaser.GameObjects.Graphics, cx: number, cy: number, fill: number): void {
    g.fillStyle(fill, 1);
    g.lineStyle(1, COLOR.border, 1);
    this.diamondPath(g, cx, cy);
    g.fillPath();
    g.strokePath();
  }

  /** Trace a tile-sized diamond path centred at `(cx, cy)` (caller fills/strokes it). */
  private diamondPath(g: Phaser.GameObjects.Graphics, cx: number, cy: number): void {
    const hw = (TILE_WIDTH / 2) * this.boardScale;
    const hh = (TILE_HEIGHT / 2) * this.boardScale;
    g.beginPath();
    g.moveTo(cx, cy - hh);
    g.lineTo(cx + hw, cy);
    g.lineTo(cx, cy + hh);
    g.lineTo(cx - hw, cy);
    g.closePath();
  }

  // --- Unit tokens ----------------------------------------------------------

  /**
   * Spawn a unit's token: a side-coloured body with a role-coloured ring, its
   * initials inside, a contact shadow, an HP bar, status badges, and a nameplate
   * that's hidden until the unit is active or hovered (so spawn clusters don't
   * collapse into a pile of overlapping text). Returns the created view.
   */
  spawnUnit(unit: Unit): UnitView {
    const s = this.scene;
    const color = unit.side === "player" ? COLOR.ally : COLOR.foe;
    const stroke = unit.side === "player" ? COLOR.allyEdge : COLOR.foeEdge;
    const cy = -TILE_HEIGHT / 2;
    const body = s.add.circle(0, cy, 12, color).setStrokeStyle(3, roleColor(unit, stroke));
    const initials = s.add.text(0, cy, initialsOf(unit.name), { color: INK.onLight, fontFamily: FONT.family, fontSize: FONT.micro, fontStyle: WEIGHT.bold }).setOrigin(0.5);
    const label = s.add.text(0, cy - 36, unit.name, { color: INK.primary, fontFamily: FONT.family, fontSize: FONT.nameplate }).setOrigin(0.5).setVisible(false);
    const hp = s.add.text(0, cy - 24, "", { color: INK.success, fontFamily: FONT.family, fontSize: FONT.nameplate }).setOrigin(0.5).setVisible(false);
    // A fixed pool of status pips laid out under the token; each shows one status
    // (glyph + turns left) in its own colour, or the computed flank pip (D36).
    const statusPips = Array.from({ length: MAX_STATUS_PIPS }, () =>
      s.add.text(0, cy + 10, "", { color: INK.gold, fontFamily: FONT.family, fontSize: FONT.nameplate, fontStyle: WEIGHT.bold }).setOrigin(0.5).setVisible(false),
    );
    const hpBarW = 26;
    const hpBarH = 6;
    const hpBarY = cy - 14;
    const hpBarBg = s.add.rectangle(0, hpBarY, hpBarW, hpBarH, COLOR.bg).setStrokeStyle(1, COLOR.black, 0.6);
    const hpBarFill = s.add.rectangle(-hpBarW / 2, hpBarY, hpBarW, hpBarH, COLOR.success).setOrigin(0, 0.5);
    const shadow = s.add.ellipse(0, -2, 24, 9, COLOR.black, 0.28);
    const container = s.add.container(0, 0, [shadow, hpBarBg, hpBarFill, body, initials, label, hp, ...statusPips]).setDepth(1).setScale(this.boardScale);
    const view: UnitView = { unit, container, body, label, hp, statusPips, hpBarFill, hpBarW };
    this.views.set(unit.id, view);
    // Hovering a token reveals its nameplate (the other half of "active/hover only").
    body.setInteractive({ useHandCursor: false });
    body.on("pointerover", () => { this.hoveredUnitId = unit.id; this.refreshNameplate(unit.id); });
    body.on("pointerout", () => { if (this.hoveredUnitId === unit.id) this.hoveredUnitId = null; this.refreshNameplate(unit.id); });
    this.placeView(unit);
    return view;
  }

  /** Snap a unit's token to its current tile. */
  placeView(unit: Unit): void {
    const view = this.views.get(unit.id);
    if (!view) return;
    const { x, y } = this.tileToWorld(unit.pos);
    view.container.setPosition(x, y);
  }

  /** Show a unit's floating nameplate iff it's the active or hovered (and visible) unit. */
  refreshNameplate(unitId: string): void {
    const view = this.views.get(unitId);
    if (!view) return;
    const show = view.unit.alive && !view.unit.hidden && (unitId === this.activeUnitId || unitId === this.hoveredUnitId);
    view.label.setVisible(show);
    view.hp.setVisible(show);
  }

  /** Mark the unit taking its turn; its nameplate stays up until the turn ends. */
  setActiveUnit(unit: Unit | null): void {
    const prev = this.activeUnitId;
    this.activeUnitId = unit?.id ?? null;
    if (prev && prev !== this.activeUnitId) this.refreshNameplate(prev);
    if (this.activeUnitId) this.refreshNameplate(this.activeUnitId);
    // A quick scale-pop when a unit takes the turn — a clearer hand-off than the
    // chevron alone. End state is unchanged (yoyo), so captures are unaffected.
    if (unit && prev !== this.activeUnitId && !this.reduceMotion) {
      const view = this.views.get(unit.id);
      if (view) this.scene.tweens.add({ targets: view.container, scaleX: this.boardScale * 1.18, scaleY: this.boardScale * 1.18, duration: 130, yoyo: true, ease: "Quad.Out" });
    }
  }

  /** Refresh every token's HP bar, status pips, fade state, and death pop. */
  refreshUnits(): void {
    const units = [...this.views.values()].map((v) => v.unit);
    for (const view of this.views.values()) {
      const unit = view.unit;
      view.hp.setText(`${Math.max(0, unit.hp)}/${unit.maxHp}`);
      // HP bar: width by fraction, tint green→amber→red as it drops.
      const frac = unit.maxHp > 0 ? Math.max(0, unit.hp) / unit.maxHp : 0;
      view.hpBarFill.width = Math.max(0, view.hpBarW * frac);
      view.hpBarFill.setFillStyle(hpColor(frac));
      view.hpBarFill.setVisible(unit.alive);
      // Status pips (D41 + flank, D36): one badge per status — glyph + turns left,
      // tinted per status — laid out centred under the token; the flank pip trails.
      this.layoutStatusPips(view, statusPipsFor(unit, units));
      // Deployment veil (D12): a living, uncaptured foe is fully hidden — token,
      // nameplate, and (since Phaser skips input on invisible objects) its hover.
      const concealed = this.concealEnemies && unit.side === "enemy" && unit.alive && !unit.captured;
      view.container.setVisible(!concealed);
      view.container.setAlpha(!unit.alive ? 0.2 : unit.captured ? 0.4 : unit.hidden ? 0.35 : 1);
      // Death pop: the first time a unit reads as dead, collapse its token so the
      // kill registers (it then rests as the faded "downed" marker).
      if (!unit.alive && !this.deadSeen.has(unit.id)) {
        this.deadSeen.add(unit.id);
        view.hpBarFill.setVisible(false);
        if (!this.reduceMotion) this.scene.tweens.add({ targets: view.container, scaleX: this.boardScale * 0.72, scaleY: this.boardScale * 0.72, duration: 260, ease: "Quad.Out" });
      }
    }
  }

  /** Lay a token's pooled status pips out in a centred row under it; hide the rest. */
  private layoutStatusPips(view: UnitView, pips: StatusPip[]): void {
    const cy = -TILE_HEIGHT / 2;
    const shown = pips.slice(0, MAX_STATUS_PIPS);
    shown.forEach((pip, i) => {
      view.statusPips[i].setText(pip.text).setColor(pip.color).setPosition((i - (shown.length - 1) / 2) * 15, cy + 10).setVisible(true);
    });
    for (let i = shown.length; i < view.statusPips.length; i++) view.statusPips[i].setVisible(false);
  }

  /** A short-lived combat-text pop-up that drifts up off a unit and fades. */
  floatText(unit: Unit, text: string, color: string, dy = 0): void {
    if (!this.views.has(unit.id)) return;
    const { x, y } = this.tileToWorld(unit.pos);
    this.emitFloat(x, y - TILE_HEIGHT / 2 - 18 + dy, text, color, 13);
  }

  /**
   * A **damage number** with magnitude-scaled emphasis: a chip floats small in
   * muted red, a heavy blow floats big and hot with a punchy scale-pop and a
   * longer, taller rise — so the size of the hit *reads* before you parse the
   * digits. Intensity is the damage as a fraction of the target's max HP (a hit
   * for ~40%+ of the bar maxes out); there's no separate crit flag in the rules,
   * so magnitude stands in for "crit". Routes through the shared float emitter.
   */
  floatDamage(unit: Unit, amount: number): void {
    if (amount <= 0 || !this.views.has(unit.id)) return;
    const intensity = Math.min(1, amount / Math.max(1, unit.maxHp) / 0.4);
    const sizePx = Math.round(13 + intensity * 11); // 13 (chip) → 24 (heavy)
    // Muted red for a chip, ember-orange mid, white-hot for a crusher.
    const color = intensity < 0.34 ? INK.danger : intensity < 0.67 ? "#ff9a4a" : "#ff6a2a";
    const { x, y } = this.tileToWorld(unit.pos);
    this.emitFloat(x, y - TILE_HEIGHT / 2 - 18, `-${amount}`, color, sizePx, intensity);
  }

  /** Record the damage a unit just took (from the scene's `unitDamaged` bus). */
  noteDamage(unitId: string, amount: number): void {
    if (amount > 0) this.lastHit.set(unitId, amount);
  }

  /** Spawn one floating text and tween it up as it fades; `pop` adds a scale punch. */
  private emitFloat(x: number, y: number, text: string, color: string, sizePx: number, pop = 0): void {
    const t = this.scene.add
      .text(x, y, text, { color, fontFamily: FONT.family, fontSize: `${sizePx}px`, fontStyle: WEIGHT.bold })
      .setOrigin(0.5)
      .setDepth(30);
    if (pop > 0) t.setScale(1 + pop * 0.6).setStroke("#3a0f04", 3);
    this.floaters.add(t);
    this.scene.tweens.add({
      targets: t,
      y: y - (26 + pop * 14),
      alpha: 0,
      scale: 1,
      duration: 760 + pop * 220,
      ease: "Cubic.Out",
      onComplete: () => {
        this.floaters.delete(t);
        t.destroy();
      },
    });
  }

  /** Slide a unit's token along a path, calling `done` when it lands. */
  animateMove(unit: Unit, path: readonly GridCoord[], done: () => void, stepMs = 130): void {
    const view = this.views.get(unit.id);
    if (!view || path.length === 0) {
      this.placeView(unit);
      return done();
    }
    const targets = path.map((c) => this.tileToWorld(c));
    this.scene.tweens.chain({ targets: view.container, tweens: targets.map((p) => ({ x: p.x, y: p.y, duration: stepMs, ease: "Linear" })), onComplete: done });
  }

  /**
   * The attack-impact FX: the attacker lunges a third of the way at the target, the
   * struck token flashes white and blinks, and the camera gives a short shake. The
   * body colour is captured and restored, so a recoloured token (a captured unit)
   * keeps its hue. Shake is skipped under reduceMotion for stable captures.
   */
  flashHit(attacker: Unit, target: Unit): void {
    const av = this.views.get(attacker.id);
    const tv = this.views.get(target.id);
    // How hard this landed: the damage just dealt (noted off the bus) as a
    // fraction of the target's bar — a hit for ~40%+ of max HP maxes the impact.
    const dmg = this.lastHit.get(target.id);
    this.lastHit.delete(target.id);
    const intensity = dmg ? Math.min(1, dmg / Math.max(1, target.maxHp) / 0.4) : 0;
    // A bigger blow lunges farther into the target (chip ~0.28 → crusher ~0.42).
    if (av && attacker !== target) {
      const home = this.tileToWorld(attacker.pos);
      const toward = this.tileToWorld(target.pos);
      const reach = 0.28 + intensity * 0.14;
      this.scene.tweens.add({ targets: av.container, x: home.x + (toward.x - home.x) * reach, y: home.y + (toward.y - home.y) * reach, duration: 90, yoyo: true, ease: "Quad.easeOut" });
    }
    if (tv) {
      const prevFill = tv.body.fillColor;
      tv.body.setFillStyle(COLOR.white);
      this.scene.tweens.add({ targets: tv.container, alpha: 0.4, duration: 70, yoyo: true, onComplete: () => this.refreshUnits() });
      this.scene.time.delayedCall(95, () => tv.body.setFillStyle(prevFill));
      // Impact scales with the blow: a chip barely nudges the camera, a crusher
      // shakes hard and freezes longer. A kill always lands near the top of the
      // range so finishing a foe feels decisive, big overkill harder still.
      // (The death pop itself is played by refreshUnits when the token reads dead.)
      const fatal = !target.alive;
      const power = fatal ? Math.max(0.8, intensity) : intensity;
      if (!this.reduceMotion) {
        this.scene.cameras.main.shake(55 + power * 95, 0.003 + power * 0.006);
        this.hitStop(Math.round(35 + power * 70));
      }
    }
  }

  /**
   * A brief **hit-stop**: freeze every tween for `ms` so an impact *lands* — the
   * pause reads as force. The scene clock keeps running (so this self-restores),
   * and it's skipped under reduceMotion to keep captures deterministic.
   */
  private hitStop(ms: number): void {
    if (this.reduceMotion) return;
    const tw = this.scene.tweens;
    if (tw.timeScale === 0) return; // already frozen by a prior hit this frame
    tw.timeScale = 0;
    this.scene.time.delayedCall(ms, () => {
      tw.timeScale = 1;
    });
  }

  /** A heal/buff cue: a quick scale-pop on the unit's token. */
  flashHeal(unit: Unit): void {
    const view = this.views.get(unit.id);
    if (!view) return;
    this.scene.tweens.add({ targets: view.container, scale: 1.25, duration: 130, yoyo: true, ease: "Quad.easeOut" });
  }

  /** Tear down all unit tokens and floaters (call when rebuilding the board). */
  clearUnits(): void {
    for (const f of this.floaters) f.destroy();
    this.floaters.clear();
    this.clearForecast();
    for (const view of this.views.values()) view.container.destroy();
    this.views.clear();
    for (const c of this.ctChips) { c.bg.destroy(); c.dot.destroy(); c.name.destroy(); c.ct.destroy(); c.hpBg.destroy(); c.hpFill.destroy(); c.status.destroy(); }
    this.ctChips.length = 0;
    for (const l of this.logLines) l.destroy();
    this.logLines.length = 0;
    this.logBuffer.length = 0;
    this.pendingHeader = null;
    this.deadSeen.clear();
    this.lastHit.clear();
    this.activeUnitId = null;
    this.hoveredUnitId = null;
  }
}
