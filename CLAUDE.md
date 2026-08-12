# Working in this repo

Design canon and status live in the planning workspace — read these first, don't duplicate them:
- **Decisions (source of truth):** `scratchpad/foundations/decisions.md` — read to the latest `## D##`.
- **Resume point / status:** `scratchpad/foundations/PROGRESS.md`.
- **Architecture:** pure logic in `src/core` (headless, deterministic — **no `Math.random`, no Phaser/DOM**);
  the Phaser scenes in `src/game` stay a thin renderer over the core.
- **Code conventions (D114):** `docs/design/implementation/conventions.md` — the one spelling for each
  shared structure (RNG labels, registries, result shapes, modals, diction), each pointing at a
  **living exemplar** to copy and the guard test that enforces it. Read it before adding a registry,
  a random draw, a result type, or a modal. Player-facing wording lives in `docs/design/glossary.md`.

## Guards — keep all green on every change

```
npm run build          # tsc --noEmit && vite build
npm test               # vitest run — the core suite
npm run sim            # the run-simulator digest (re-pin when routing/rewards move)
npm run test:e2e       # deploy → battle click-through (real headless browser)
npm run test:e2e:scenario   # the #scene isolated-encounter harness
npm run test:e2e:arc        # overworld authored-event screens (mentor beats, etc.)
npm run test:e2e:launcher   # the editor's Launch tab: target/kit/flags/seed → scene → back
npm run test:e2e:rescue     # the finale: side-door deploy · "Go now" · the left-behind result screen
npm run test:e2e:doctrine   # the garrison door-drive / pin loop, rendered
npm run audit:visual        # 14-surface visual sweep: geometric linter + per-surface coverage gate
npm run audit:challenge     # proves each text coverage gate is specific (own screen only)
```

CI (`.github/workflows/ci.yml`) runs the same set on every PR.

## The visual step-through is NOT optional

**The core suite and the sim never render a Phaser scene**, and the sim's naive bot **skips the
deploy phase and every interactive event screen**. So a change can be 100% green on `vitest`/`sim`
and still hard-freeze the actual game. When you add or change **anything a player clicks through** —
a new node kind, a new **event kind** (or the first pinned event of an existing kind on a map), a new
overworld/camp screen, a deploy/battle interaction, a new scene surface — you **must step it through
in the real scene** and add or extend a **visual e2e** (`scripts/e2e-*.mjs`, driven by
`scripts/harness.mjs` in headless Chrome). An uncaught exception in a scene render reads as a *freeze*,
not a stack trace.

> **Cautionary tale (D92 / #168):** the Wave-0 mentor beats were the Hollow Mill's first
> `"story"`-kind overworld events. The scene's `showStoryScreen` only handled the *random-pool* story
> node → it crashed on the pinned event, freezing the game mid-run. Every headless guard was green;
> **no gating test opened an overworld event.** `test:e2e:arc` now covers that surface — when you add a
> new player-facing surface, add its guard the same way, and don't rely on the `shots-*` screenshot
> scripts (they capture images, they are not pass/fail gates).
