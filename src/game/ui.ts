import type Phaser from "phaser";

/**
 * Fit a canvas text label to the button it sits on. The scenes draw buttons as a
 * fixed-size {@link Phaser.GameObjects.Rectangle} with a centered/left-anchored
 * {@link Phaser.GameObjects.Text} on top — Phaser draws text to a canvas with no
 * CSS, so nothing clips or reflows it. Every button in every scene routes its
 * label through here, which makes this the one place to enforce a shared policy:
 *
 *   • **Fits** (`natural ≤ maxWidth`) — left at scale 1.
 *   • **Snug** (a little over, within the {@link minScale} band) — scaled down
 *     uniformly to fit, keeping it crisp and on whatever origin it already uses
 *     (centered buttons stay centered, left-aligned stay left). The floor stops
 *     a borderline label from collapsing into an illegible smear.
 *   • **Over budget** (so long it would need to shrink past the floor) — this is
 *     a *call-site bug*, not something a button should silently absorb: you can't
 *     format a sentence into a button. We treat it as invalid usage — `console.error`
 *     in dev (surfaced by `npm run shots`, so it acts as a lint gate) — and render
 *     the label full-size with a trailing `…` so it reads as *obviously wrong*
 *     rather than a shrunk blur. The long form belongs in the hint bar / description
 *     channel the scenes already pass alongside the label.
 *
 * Resets scale/text first, so it's safe to call again whenever the label changes
 * (e.g. the primary button). Callers that want a guaranteed clean fit should size
 * their container to the content (the action-row layout) so the snug and
 * over-budget paths rarely trigger at all.
 *
 * @param label    the text object drawn on the button
 * @param maxWidth the inner pixel width to fit within (pass the rectangle width
 *                 minus a little padding)
 * @param minScale the smallest scale we'll shrink to before a label counts as
 *                 over budget (default 0.8 — below this text stops being
 *                 comfortably readable, so it's the natural snug/too-much line)
 */
export function fitText(label: Phaser.GameObjects.Text, maxWidth: number, minScale = 0.8): void {
  label.setScale(1);
  if (maxWidth <= 0) return;
  const natural = label.width;
  if (natural <= maxWidth) return; // fits as-is
  // The widest label the floor can still absorb by shrinking. Past this, the only
  // way to "fit" would be an unreadable smear — so we don't; we flag it instead.
  const budget = maxWidth / minScale;
  if (natural <= budget) {
    label.setScale(maxWidth / natural);
    return;
  }
  if (isDev())
    console.error(
      `fitText: button label is over budget (${Math.round(natural)}px into ${Math.round(maxWidth)}px) — ` +
        `keep labels terse and move detail to the hint/description: ${JSON.stringify(label.text)}`,
    );
  ellipsize(label, maxWidth);
}

/**
 * Trim a label from the end, full-size, until it plus a trailing `…` fits
 * `maxWidth`. Used only on the over-budget path so a too-long label degrades to a
 * bounded, readable, visibly-truncated string instead of overflowing or shrinking.
 */
function ellipsize(label: Phaser.GameObjects.Text, maxWidth: number): void {
  const full = label.text;
  let s = full;
  while (s.length > 1) {
    label.setText(s.trimEnd() + "…");
    if (label.width <= maxWidth) return;
    s = s.slice(0, -1);
  }
}

/** True under the Vite dev server / tests, false in the production build. */
function isDev(): boolean {
  // `import.meta.env` is Vite-injected; guard so this is safe if ever run outside it.
  return typeof import.meta !== "undefined" && Boolean(import.meta.env?.DEV);
}
