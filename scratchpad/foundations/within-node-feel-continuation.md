# Continue — Hollow Mill "within-node feel" pass

> Paste this to resume the work this thread has been dedicated to: the **moment-to-moment
> feel of a single combat node** in the Hollow Mill demo expedition (overworld select →
> camp → **deployment → battle → resolution**). The focus is how it *feels* to play one
> node, not new systems. **Don't start coding** until we've agreed the next item.

## Read first (grounding)
- `docs/design/expedition-hollow-mill.md` — expedition intent + the **"Route changes & feel
  passes (log)"** section (newest first). This is the running record of within-node changes.
- `docs/design/02-deployment.md`, `03-combat.md`, `04-resolution.md` — the phase models.
- `src/core/hollow-mill.ts` — authored encounters / cast / rewards (the data source of truth).
- `src/game/scenes/BattleScene.ts` — the mission driver (both deployment + battle phases).
- `src/game/scenes/OverworldScene.ts` — node selection + the event-node dispatch.

## Working conventions (owner's — hold to these)
- Develop on the branch the owner names (this session: `claude/fervent-wozniak-uydkan`).
- Validate every change, green at **each** commit: `npx tsc --noEmit` · `npx vitest run` ·
  `npm run build` · `npm run test:e2e` · `npm run sim`.
- Small reviewable commits. PR into `main` → wait for the **`test`** check → **squash-merge**
  (one PR per coherent unit). Resync the branch to main after each merge.
- **"For any ambiguous design call, ask me before building rather than guessing."**
- **"Code wins on divergence — update the design doc as we change things."** Add a feel-pass
  log entry per shipped change.
- Core/render split (D2): logic in `src/core` (no Phaser/DOM/`Math.random`, deterministic);
  render in `src/game`. Determinism: `sim` summary stays stable.
- Commit footer: the `Co-Authored-By` + `Claude-Session` lines; **no model identifier** in any
  artifact. The env SSH-signs commits — `%G?=N` locally is a verify-only artifact; **push the
  branch** to satisfy the stop-hook (it nags on any unpushed/locally-unverifiable commit).

## Done in this thread (context)
- **Movement consolidation (PR #67, merged):** one weighted `moveStep(actor, tile, ctx)` over a
  single `moveBudget` for deployment + battle — fixed the raw-vs-weighted cost drift (the D42
  tarpit ring is now charged identically in both phases). `deployMove`/`playerMoveStep` and the
  twin budgets/reach maps retired.
- **L1 Pip captive-recruit (PR #68, merged):** Pip is an **on-board bound captive** you free
  mid-fight (then control), via a reusable `AuthoredEncounter.captives` seam; a freed captive
  **banks the encounter's completion XP** (joins leveled, not at base); a **`unitRescued`** bus
  event (`Battle.rescue` verb → `wireBattleFx` listener: re-tint + flash + combat-log line).
- Both built on **PR #66** (D67 deployment↔combat substrate unification — one CTClock, one
  move/skill verb, one encounter seed, the per-unit `concealed` flag), which landed concurrently.

## Key seams established (reuse, don't reinvent)
- `AuthoredEncounter.captives` (`CaptivePlacement`) + `resolveCaptiveRecruits` — on-board captive
  recruits. **Win-only**; the objective-failure case is a documented TODO before reusing it in an
  objective-failure-capable node (add a captive → rescue-quest fallback).
- `unitRescued` bus event + `Battle.rescue(captive, by?)` — the in-combat rescue moment (hook for
  intel reveals, ghost tokens, telemetry).
- `moveStep` / `reachByKey` (weighted reach) — all board movement, both phases.
- Capture-wave layer (campfire core, danger front + growth, capture roll, Dig In, alarm→battle,
  concealment veil) — phase-specific; **preserve** it.

## Remaining ranked feel backlog (verify file:lines — code moves)
Ordered by impact. #1 and #2 are concrete bugs with contained fixes — recommended next.

1. **[Bug] L2/L5 event choices never reach the player.** `OverworldScene.playEvent()`
   (`src/game/scenes/OverworldScene.ts`, ~`1182–1192`) switches only
   `shop/recruiter/story/patron/thief`; the authored events are kind `"provision"` (L2) and
   `"town"` (L5), so both fall through to `default → playThiefEvent()`. Core resolves them
   correctly (`eventForNode` pins via `eventId`), but the **scene** renders a thief auto-resolve
   — so the L2 pick-one provision choice (incl. Cook-a-Stew) and Mira's L5 recruitment choice are
   unreachable, even though their `choices()` resolvers exist. **Fix:** add `case "provision"` /
   `case "town"` routing to the existing generic choice panel.
2. **[Payoff invisible] Post-win grants surfaced nowhere at Resolution.** `applyGrant`
   (`src/core/runloop.ts`) mutates party/inventory silently; `ResolveResult` carries no grant
   field, so the resolution report never names a granted recruit/relic. Win L4B → **Sela** just
   appears off-screen; same for the **L6B relic**. (The L1 Cook is now visible via the captive +
   `unitRescued` path — this item covers the *other* grants: Sela, Mira, relic.) **Fix:** add
   `granted?` to `ResolveResult`, populate in `applyGrant`/`applyRewards`, render a
   "Reinforcements" section in `buildResolutionSummary`.
3. **[Teaching/tuning] L3 "read the field" can hinge on RNG.** The far concealment-6 snare
   (`hollow-mill.ts`, col 5) sits ~4 tiles from spawn where `spotChance ≈ 0.05` (`traps.ts`),
   so "win in the pre-combat setup" is partly a coin-flip. **Fix:** a small opening-scan bonus,
   or pull the snare cluster one column into Vale's reliable band.
4. **[Seam ready] "Ghost on high intel" unimplemented.** The deploy veil is all-or-nothing
   (`CombatView.concealEnemies` boolean); intel buys a deploy bonus but doesn't graduate the veil
   into a silhouette. #66's per-unit `concealed` flag is the related seam. **Fix:** gate a dim,
   nameless silhouette on `intelTier()` instead of a hard hide.
5. **[First-impression] L1 deployment had little to do but Start Battle** — now improved by the
   Pip rescue (a reason to range toward the corner). **Re-evaluate in playtest** before doing more.

## How to start
Confirm the next item with the owner (default order: **#1**, then **#2**). Re-verify the
file:line evidence, confirm the design if anything's ambiguous, then implement → validate (the
five checks) → PR → squash-merge, with a feel-pass log entry.
