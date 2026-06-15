import Phaser from "phaser";
import { COLOR, FONT, INK } from "../theme";
import {
  gridToScreen,
  screenToGrid,
  findPath,
  TileGrid,
  TILE_WIDTH,
  TILE_HEIGHT,
  type GridCoord,
} from "../../core";

/**
 * M2 scene: an isometric grid with one unit you move by clicking. The scene owns
 * *no* movement logic — it builds a `core` {@link TileGrid}, asks `core`'s A* for
 * a path on each click, and only animates the result. All world geometry comes
 * from `core`'s iso projection; the scene just adds a screen-space origin offset
 * so the diamond sits centred in the canvas.
 */
export class IsoScene extends Phaser.Scene {
  private static readonly COLS = 8;
  private static readonly ROWS = 8;
  /** Tiles that block movement — a couple of walls to prove A* routes around. */
  private static readonly BLOCKED: readonly GridCoord[] = [
    { col: 3, row: 1 },
    { col: 3, row: 2 },
    { col: 3, row: 3 },
    { col: 3, row: 4 },
    { col: 5, row: 4 },
    { col: 5, row: 5 },
    { col: 5, row: 6 },
  ];

  private grid!: TileGrid;
  private originX = 0;
  private originY = 0;

  /** The unit's current logical tile. */
  private unitCoord: GridCoord = { col: 0, row: 0 };
  private unit!: Phaser.GameObjects.Container;
  /** True while a walk animation is playing — clicks are ignored until done. */
  private moving = false;

  constructor() {
    super("IsoScene");
  }

  create(): void {
    this.grid = new TileGrid(IsoScene.COLS, IsoScene.ROWS, IsoScene.BLOCKED);
    this.originX = this.scale.width / 2;
    this.originY = this.scale.height / 2 - (IsoScene.ROWS * TILE_HEIGHT) / 2;

    this.drawGrid();
    this.spawnUnit();

    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);

    this.add
      .text(
        this.scale.width / 2,
        this.scale.height - 24,
        "Click a tile — the unit walks there, routing around walls.",
        { color: INK.muted, fontFamily: FONT.family, fontSize: FONT.body },
      )
      .setOrigin(0.5);
  }

  /** Project a logical tile to its centre point in canvas/world space. */
  private tileToWorld(coord: GridCoord): { x: number; y: number } {
    const { x, y } = gridToScreen(coord);
    return { x: this.originX + x, y: this.originY + y };
  }

  /** Recover the tile a world point falls on (rounded to the nearest tile). */
  private worldToTile(px: number, py: number): GridCoord {
    const frac = screenToGrid({ x: px - this.originX, y: py - this.originY });
    return { col: Math.round(frac.col), row: Math.round(frac.row) };
  }

  private drawGrid(): void {
    const g = this.add.graphics();
    for (let row = 0; row < IsoScene.ROWS; row++) {
      for (let col = 0; col < IsoScene.COLS; col++) {
        const { x, y } = this.tileToWorld({ col, row });
        const walkable = this.grid.isWalkable({ col, row });
        // Blocked tiles read as raised stone; walkable tiles use a subtle
        // checker so the diamonds are legible as a grid.
        const fill = !walkable
          ? COLOR.tileBlocked
          : (col + row) % 2 === 0
            ? COLOR.tileLight
            : COLOR.tileDark;
        this.drawTile(g, x, y, fill);
      }
    }
  }

  /** Draw a single iso diamond centered on (cx, cy). */
  private drawTile(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    fill: number,
  ): void {
    const halfW = TILE_WIDTH / 2;
    const halfH = TILE_HEIGHT / 2;
    g.fillStyle(fill, 1);
    g.lineStyle(1, COLOR.border, 1);
    g.beginPath();
    g.moveTo(cx, cy - halfH);
    g.lineTo(cx + halfW, cy);
    g.lineTo(cx, cy + halfH);
    g.lineTo(cx - halfW, cy);
    g.closePath();
    g.fillPath();
    g.strokePath();
  }

  /** Create the unit marker and park it on its starting tile. */
  private spawnUnit(): void {
    // A small token that sits a little above the tile centre so it reads as
    // standing on the diamond rather than embedded in it.
    const body = this.add.circle(0, -TILE_HEIGHT / 2, 10, COLOR.ally);
    body.setStrokeStyle(2, COLOR.allyEdge);
    this.unit = this.add.container(0, 0, [body]);
    this.unit.setDepth(1);
    this.placeUnit(this.unitCoord);
  }

  /** Snap the unit container to a tile (no animation). */
  private placeUnit(coord: GridCoord): void {
    const { x, y } = this.tileToWorld(coord);
    this.unit.setPosition(x, y);
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.moving) return;
    const target = this.worldToTile(pointer.worldX, pointer.worldY);
    const path = findPath(this.grid, this.unitCoord, target);
    // null = unreachable / off-grid / blocked; a length-1 path = clicked the
    // tile we're already on. Nothing to animate in either case.
    if (!path || path.length < 2) return;
    this.walkPath(path);
  }

  /** Animate the unit tile-by-tile along a path, then update its logical coord. */
  private walkPath(path: GridCoord[]): void {
    this.moving = true;
    // One tween per step so the unit traces the diamond grid rather than
    // sliding in a straight line through walls.
    const targets = path.slice(1).map((coord) => this.tileToWorld(coord));
    this.tweens.chain({
      targets: this.unit,
      tweens: targets.map((p) => ({
        x: p.x,
        y: p.y,
        duration: 180,
        ease: "Linear",
      })),
      onComplete: () => {
        this.unitCoord = path[path.length - 1];
        this.moving = false;
      },
    });
  }
}
