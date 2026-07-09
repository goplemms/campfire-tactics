import Phaser from "phaser";
import { COLOR, FONT } from "./theme";
import type { CombatView } from "./combat-view";
import { placeIcon } from "./icons";
import { clearLayer } from "./ui";
import {
  type GridCoord,
  type TileGrid,
  type DeploySource,
  type DeployFront,
  inDangerZone,
  inSafeZone,
  stepDistance,
} from "../core";

export type DeployZone = "danger" | "warning" | "safe" | "neutral";

/**
 * The closing-net **zone painter** (#131): free functions over the {@link CombatView}
 * geometry (`halfW`/`halfH`/`tileToWorld`) that paint the deployment influence bands off
 * the campfire + net sources. Board painting only — the scene owns the graphics objects'
 * lifecycle and the per-turn triggers; these just draw.
 */

/**
 * Which deployment band a walkable tile falls in (drives both fill and outline). The
 * green **safe** core is capture-immune; **neutral** open ground is a real (lower)
 * capture risk — there is no free ground — and the **danger** net is near-guaranteed.
 */
export function zoneOf(t: GridCoord, campfire: DeploySource, front: DeployFront): DeployZone {
  if (inDangerZone(t, front)) return "danger";
  if (inSafeZone(t, campfire, front)) return "safe";
  if (stepDistance(t, front.origin) === front.radius + 1) return "warning";
  return "neutral";
}

/** Fill one iso tile diamond with a colour + alpha — shared by the deploy overlays. */
export function fillTileDiamond(view: CombatView, g: Phaser.GameObjects.Graphics, coord: GridCoord, color: number, alpha: number): void {
  const { x, y } = view.tileToWorld(coord);
  const halfW = view.halfW();
  const halfH = view.halfH();
  g.fillStyle(color, alpha);
  g.beginPath();
  g.moveTo(x, y - halfH);
  g.lineTo(x + halfW, y);
  g.lineTo(x, y + halfH);
  g.lineTo(x - halfW, y);
  g.closePath();
  g.fillPath();
}

/** Draw a dashed segment from (x1,y1) to (x2,y2) on `g` using the active line style. */
export function dashedLine(g: Phaser.GameObjects.Graphics, x1: number, y1: number, x2: number, y2: number, dash = 5, gap = 4): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len === 0) return;
  const ux = dx / len;
  const uy = dy / len;
  for (let d = 0; d < len; d += dash + gap) {
    const end = Math.min(d + dash, len);
    g.lineBetween(x1 + ux * d, y1 + uy * d, x1 + ux * end, y1 + uy * end);
  }
}

/**
 * Stroke a dashed line along every tile edge where a `zone` tile meets a tile
 * of another band — the visible boundary of that zone. Iso diamond edges map to
 * the four orthogonal grid neighbours.
 */
export function strokeZoneOutline(
  view: CombatView,
  g: Phaser.GameObjects.Graphics,
  grid: TileGrid,
  campfire: DeploySource,
  front: DeployFront,
  zone: "danger" | "warning" | "safe",
  color: number,
): void {
  const halfW = view.halfW();
  const halfH = view.halfH();
  // Neighbour delta → the two diamond vertices (relative to centre) of the shared edge.
  const edges: Array<{ dc: number; dr: number; a: [number, number]; b: [number, number] }> = [
    { dc: 1, dr: 0, a: [halfW, 0], b: [0, halfH] }, // col+1 → bottom-right edge
    { dc: -1, dr: 0, a: [0, -halfH], b: [-halfW, 0] }, // col-1 → top-left edge
    { dc: 0, dr: 1, a: [0, halfH], b: [-halfW, 0] }, // row+1 → bottom-left edge
    { dc: 0, dr: -1, a: [0, -halfH], b: [halfW, 0] }, // row-1 → top-right edge
  ];
  g.lineStyle(1.5, color, 0.9);
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const t = { col, row };
      if (!grid.isWalkable(t) || zoneOf(t, campfire, front) !== zone) continue;
      const { x, y } = view.tileToWorld(t);
      for (const e of edges) {
        const n = { col: col + e.dc, row: row + e.dr };
        const outside = !grid.isWalkable(n) || zoneOf(n, campfire, front) !== zone;
        if (outside) dashedLine(g, x + e.a[0], y + e.a[1], x + e.b[0], y + e.b[1]);
      }
    }
  }
}

/**
 * Paint the influence zones (D63 / D-feel) into the `safe`/`danger` graphics: green
 * **safe** core (campfire-protected, capture-immune), a faint **neutral** wash on open
 * ground (a real, lower capture risk), red **danger** inside the net, and an amber
 * telegraph on the ring about to fall next turn. Clears both graphics first; a no-op once
 * cleared when the sources aren't set yet. The scene owns the graphics + the tarpit-aura
 * follow-up.
 */
export function paintZones(
  view: CombatView,
  safe: Phaser.GameObjects.Graphics,
  danger: Phaser.GameObjects.Graphics,
  grid: TileGrid,
  campfire: DeploySource | undefined,
  front: DeployFront | undefined,
): void {
  safe.clear();
  danger.clear();
  if (!front || !campfire) return;
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const t = { col, row };
      if (!grid.isWalkable(t)) continue;
      switch (zoneOf(t, campfire, front)) {
        case "danger":
          fillTileDiamond(view, danger, t, COLOR.danger, 0.34);
          break;
        case "warning":
          // The ring about to fall next turn — a warning telegraph in amber.
          fillTileDiamond(view, danger, t, COLOR.accent, 0.22);
          break;
        case "neutral":
          // Open ground — unprotected, so a real (if lower) capture risk: a faint
          // danger wash so it never reads as free, safe space (D-feel).
          fillTileDiamond(view, danger, t, COLOR.danger, 0.1);
          break;
        case "safe":
          fillTileDiamond(view, safe, t, COLOR.successDeep, 0.28);
          break;
      }
    }
  }
  // Trace a dotted outline around each zone's perimeter for at-a-glance clarity.
  strokeZoneOutline(view, safe, grid, campfire, front, "safe", COLOR.success);
  strokeZoneOutline(view, danger, grid, campfire, front, "warning", COLOR.accent);
  strokeZoneOutline(view, danger, grid, campfire, front, "danger", COLOR.danger);
}

/** Mark the two sources on the board: a campfire glyph at the camp, the net's source at the foe. */
export function drawSourceMarkers(
  scene: Phaser.Scene,
  view: CombatView,
  markers: Phaser.GameObjects.GameObject[],
  campfire: DeploySource | undefined,
  front: DeployFront | undefined,
): void {
  clearLayer(markers);
  if (!campfire || !front) return;
  const camp = view.tileToWorld(campfire.origin);
  const foe = view.tileToWorld(front.origin);
  // Sit the source markers in the lower half of their tile: trap glyphs anchor at the tile's
  // top vertex (y − halfH), so a marker at tile-centre collides with a trap placed on the same
  // tile (the campfire core is exactly where the party — and its traps — cluster). The drop
  // tucks the marker under the trap, clear of it.
  const drop = view.halfH() * 0.5;
  markers.push(
    placeIcon(scene, camp.x, camp.y + drop, "campfire", { size: FONT.display }).setDepth(0.9),
    placeIcon(scene, foe.x, foe.y + drop, "netSource", { size: FONT.display }).setDepth(0.9),
  );
}
