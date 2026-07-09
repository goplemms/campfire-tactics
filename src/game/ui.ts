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

/**
 * Keep a **label→value row** from overprinting itself. The pattern — a left-anchored
 * label and a right-anchored value sharing one baseline — recurs in the docked info
 * cards (the battle focus card) and the party dossier's ability list; when *both* sides
 * are long (e.g. "Capture risk" + "safe in camp", or "Debilitating Strike" + its tag)
 * they collide in the middle and render as a smear. Both call sites route their rows
 * through here so neither can, and the two stay consistent.
 *
 * `label` is already placed left-anchored (origin x 0) at its left edge; `value` is
 * already placed right-anchored (origin x 1) at `rightX`; both start on the same line.
 * If their inner edges would cross (minus {@link minGap}), the value drops to its own
 * line just below — word-wrapped to the row width so an over-long value wraps inside the
 * card instead of running off an edge. On the wrapped line the value either stays
 * right-aligned at `rightX` (`wrapAlign: "right"`, the default — reads as a value column)
 * or re-anchors left under the label (`wrapAlign: "left"` + {@link wrapIndent}), so a
 * category-style tag clearly belongs to the label above it rather than floating.
 *
 * Returns the **total height** the row occupies (the caller advances its cursor by
 * this instead of a fixed line height): `line` when it fits, more when the value wrapped.
 *
 * @param leftX      the row's left edge (the label's anchor x)
 * @param rightX     the row's right edge (the value's right-anchor x)
 * @param line       the one-line row height the caller would otherwise use
 * @param minGap     the least gap to keep between label and value (default 6px)
 * @param wrapAlign  where a wrapped value sits — "right" (default) or "left" under the label
 * @param wrapIndent left-wrap indent from `leftX` (default 0), to clear a leading glyph
 */
export function fitRow(
  label: Phaser.GameObjects.Text,
  value: Phaser.GameObjects.Text,
  {
    leftX,
    rightX,
    line,
    minGap = 6,
    wrapAlign = "right",
    wrapIndent = 0,
  }: { leftX: number; rightX: number; line: number; minGap?: number; wrapAlign?: "left" | "right"; wrapIndent?: number },
): number {
  if (value.text === "") return line; // label-only row — nothing to collide with
  const labelRight = label.x + label.width;
  const valueLeft = rightX - value.width;
  if (labelRight + minGap <= valueLeft) return line; // fits on one line
  // Collide → drop the value onto its own line under the label. Cap its width to the
  // row so a very long value wraps within the card rather than overflowing an edge.
  value.setWordWrapWidth(rightX - leftX, true);
  if (wrapAlign === "left") value.setOrigin(0, value.originY).setX(leftX + wrapIndent);
  value.y += line;
  return line + value.height;
}

/**
 * Destroy every object in a scene layer array and empty it **in place** — the
 * teardown every scene repeats before re-drawing an overlay/panel/board. Emptied in
 * place (not reassigned) so the field keeps its identity and later `.push`es land on
 * the same array.
 */
export function clearLayer(objs: Phaser.GameObjects.GameObject[]): void {
  for (const o of objs) o.destroy();
  objs.length = 0;
}

/** True under the Vite dev server / tests, false in the production build. */
function isDev(): boolean {
  // `import.meta.env` is Vite-injected; guard so this is safe if ever run outside it.
  return typeof import.meta !== "undefined" && Boolean(import.meta.env?.DEV);
}

/**
 * True when the screenshot harness is driving headless captures — it sets
 * `window.__SHOT__` before boot so motion/animation can be stilled for stable
 * shots. The one place that flag is read, so the cast lives here, not in scenes.
 */
export function isScreenshotMode(): boolean {
  return typeof window !== "undefined" && Boolean((window as Window & { __SHOT__?: boolean }).__SHOT__);
}
