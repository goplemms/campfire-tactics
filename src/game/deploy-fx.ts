import Phaser from "phaser";
import { COLOR } from "./theme";

/**
 * A capture-net dropping onto a unit's tile — a crosshatched cage centred on the
 * board-world point `(x, y)` that falls in and fades out. Shared by the deployment
 * stealth-retreat in both the demo and the mission scene (D11).
 *
 * Returns the {@link Phaser.GameObjects.Graphics} so the caller can track it for
 * teardown (push it onto the scene's board-objects list). Under `reduceMotion`
 * (the screenshot harness) it skips the tween and self-destroys shortly, so frames
 * stay deterministic.
 */
export function dropNet(scene: Phaser.Scene, x: number, y: number, reduceMotion = false): Phaser.GameObjects.Graphics {
  const r = 15;
  const g = scene.add.graphics().setDepth(28);
  g.lineStyle(2, COLOR.net, 0.95);
  g.strokeRect(x - r, y - r, r * 2, r * 2);
  g.lineBetween(x - r, y - r, x + r, y + r);
  g.lineBetween(x + r, y - r, x - r, y + r);
  g.lineBetween(x, y - r, x, y + r);
  g.lineBetween(x - r, y, x + r, y);
  if (reduceMotion) {
    scene.time.delayedCall(450, () => g.destroy());
    return g;
  }
  g.setY(-44).setAlpha(0.3);
  scene.tweens.add({
    targets: g,
    y: 0,
    alpha: 1,
    duration: 170,
    ease: "Quad.In",
    onComplete: () => scene.tweens.add({ targets: g, alpha: 0, duration: 480, delay: 320, onComplete: () => g.destroy() }),
  });
  return g;
}
