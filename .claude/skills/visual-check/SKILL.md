---
name: visual-check
description: Run the browser visual audit on this game and report the visual bugs a data-only test can't catch — overlapping text, cramped margins, text spilling a panel, off-canvas/clipped labels, functionally-invisible elements, and wrong-screen captures. Use after changing any scene, HUD, card, overlay, or player-facing screen, or before a release, or when asked to "check the visuals / UI / layout".
---

# Visual Check

## Purpose

The core suite (`vitest`) and the sim never render a Phaser scene, and the `shots-*.mjs`
walkthroughs capture images without asserting on them. So a layout can be 100% green and
still read wrong to a player. This skill drives the real game in a headless browser and
reports what the player actually *sees*.

## Process

1. **Geometric + coverage sweep** — run:
   ```
   npm run audit:visual
   ```
   It walks the 14 player-facing surfaces, screenshots each into
   `screenshots/visual-audit/`, and runs an in-page linter (text overlap, off-canvas,
   invisible text, dead controls) plus a per-surface coverage gate (did the *intended*
   screen render). It exits non-zero on any error-severity finding. Read
   `screenshots/visual-audit/report.json` for the structured results.

2. **Coverage-gate specificity** — if you added or changed a text-based `expect` gate in
   `scripts/visual-audit.mjs`, run:
   ```
   npm run audit:challenge
   ```
   It proves each text gate fires on exactly its own screen (fails loudly on a false-pass).

3. **Vision pass** — the linter is blind to the fuzzy stuff. Open every screenshot in
   `screenshots/visual-audit/` and inspect for what a bounds check can't decide: low
   contrast / near-invisible elements, text crowding or spilling its panel, awkward or
   missing margins, misalignment, unwanted truncation. For a thorough pass, delegate this
   to the **`game-visual-auditor`** subagent (it runs the sweep, reads the report, opens
   each PNG, cross-checks the geometric findings, and reports the vision-only issues).

4. **Report** — group findings by surface. For each: severity, confirmed vs suspected, the
   element and where it is, and the screenshot as evidence. Separate real bugs from
   intended design (the dim modal backdrop, fogged `◌` nodes, the locked `???` intel line,
   greyed-disabled controls).

## When to use

After adding or changing anything a player clicks through — a scene, HUD, card, overlay,
deploy/battle interaction, or a new surface — and before a release. This is the visual
half of the "step it through in the real scene" rule in `CLAUDE.md`.

## Extending

New player-facing surface? Add it to the `SURFACES` array in `scripts/visual-audit.mjs`
(a `boot` hash and/or `drive`, plus a screen-UNIQUE `expect`), then run `npm run
audit:challenge` to prove the new gate is specific. See `.claude/agents/game-visual-auditor.md`.

## Notes

- Needs Chrome; the script auto-discovers Chromium (or set `CHROME_BIN`).
- The screenshots and `report.json` are gitignored — they're evidence for the run, not
  committed artifacts.
- Before trusting a new coverage gate, challenge it (see the memento `challenge` skill /
  the project's challenge agent): a green gate that would also pass on the wrong screen is
  a silent hole.
