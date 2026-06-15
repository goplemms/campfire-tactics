import Phaser from "phaser";

/**
 * A warm **firelight vignette** — the campfire glow the game is named for.
 *
 * Phaser has no radial-gradient primitive on `Graphics`, so we bake one into a
 * canvas texture once (keyed, shared across scenes) and stretch it over the
 * board: a faint warm bloom at the centre fading to a soft ember-dark at the
 * edges. It sits above the world but below the HUD, so tiles and tokens pick up
 * the glow while readouts stay crisp. Purely cosmetic and static — it carries no
 * motion, so screenshots capture it deterministically.
 */
const TEXTURE_KEY = "fire-vignette";

/** Build the gradient texture once (idempotent — reused by every scene). */
function ensureTexture(scene: Phaser.Scene, w: number, h: number): void {
  const key = `${TEXTURE_KEY}-${w}x${h}`;
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w, h);
  const ctx = tex?.getContext();
  if (!tex || !ctx) return;
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.hypot(cx, cy); // reach the corners
  const grad = ctx.createRadialGradient(cx, cy, radius * 0.12, cx, cy, radius);
  // A faint warm bloom at the hearth, transparent through the play area, then a
  // soft ember-dark closing in at the rim.
  grad.addColorStop(0, "rgba(255, 178, 92, 0.06)");
  grad.addColorStop(0.42, "rgba(0, 0, 0, 0)");
  grad.addColorStop(1, "rgba(18, 9, 4, 0.55)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  tex.refresh();
}

/**
 * Add the firelight vignette to `scene`, covering the canvas. Returns the image
 * so a scene can re-depth or remove it; pinned to the camera (no scroll/shake)
 * and non-interactive so it never eats input.
 */
export function addVignette(scene: Phaser.Scene, depth = 0.9): Phaser.GameObjects.Image {
  const w = scene.scale.width;
  const h = scene.scale.height;
  ensureTexture(scene, w, h);
  return scene.add
    .image(w / 2, h / 2, `${TEXTURE_KEY}-${w}x${h}`)
    .setScrollFactor(0)
    .setDepth(depth)
    .setName(TEXTURE_KEY);
}
