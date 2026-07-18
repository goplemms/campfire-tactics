# The finale + level-authoring — session handoff (2026-07-17)

Resume/handoff for the finale rework and the level-authoring workflow it rides on. Read this
**plus** `decisions.md` **D97 → D99** before making changes.

## What we're building: the finale, as a RESCUE

The Hollow Mill's finale is being reframed from D97's "storm vs. extract" into a **prison rescue**:
the party is here to free a **group of captives**. It stays a **dual-OR** win (D97/C2 kept), but both
paths now read as the *same intent*:
- **extraction** — escort the captives out — the thematic **heart**.
- **eliminate-all** — clear the garrison — *also* completes the rescue (the captives are safe).

Some captives are **named characters** — seeds for later campaign designing; currently placeholders.

### Current state
- Built as a **standalone content level**: `src/content/levels/the-rescue.json`, playable at
  **`#level=the-rescue`**. 11×6; a warden (`bandit-captain`) + 4 guards; **3 lockpick captives** deep
  at col 9 (ids `captive-1/2/3`, names "Bound Captive I/II/III"); exit span on the left edge; both
  OR'd goals with rescue-framed labels. Decisively winnable frontally.
- **NOT in the arc yet.** The live arc finale is still D97's `PRISON_ASSAULT` in
  `src/core/hollow-mill.ts`. The Rescue is being **iterated standalone** and **promoted** into the arc
  once the design settles (see roadmap) — deliberately, to avoid churning the arc twice.
- Guards green: `levels.test` proves both win-paths (incl. "all three must be extracted, not two");
  `test:e2e:level` boots it; tsc/vitest/build clean.

## Design canon a future session MUST NOT relitigate (decisions.md D97–D99)

- **Keep extraction; do NOT replace it with a positional edge.** A `decision-adversary` red-team
  established that retiring the extraction OR-win for "just deploy from a better side" trades a
  *distinct victory* for a *cheaper same victory* and strands the C2 investment. **Extraction stays.**
- **The infiltration reward is the flank that makes extraction VIABLE, not an alternate win** —
  deferred to its own session (roadmap #2).
- **Extraction is intentionally the hard/aspirational path right now** (escort the whole group across
  the board past a standing garrison). Do **not** "fix" that by moving cells near the exit — it
  re-arms D97's challenge-F walkover footgun (a prisoner freed adjacent to the exit trivialises it).
  The *flank* is the sanctioned fix.

## How a future session handles changes (the workflow, D98)

### Homes for a level (hard layering rule)
- **Standalone / playtest** → a JSON file in `src/content/levels/*.json`. Glob-auto-registered (no
  wiring), playable at `#level=<id>`. **Default — author + iterate here.**
- **Arc content** (the Hollow Mill run) → a **TS `AuthoredEncounter` in `src/core/hollow-mill.ts`** +
  a **map node** (`authoredId`). `core/` is pure/headless and **cannot glob or import content JSON**
  (`resolveJsonModule` is off), so arc encounters live as TS. **Promotion** = translate the settled
  level to a TS const + wire the node + re-run the arc guards — an owner-directed step.

### Tools
- **`#editor`** — the visual level editor: paint tiles → Download an `AuthoredEncounter` JSON. Human GUI.
- **`#level=<id>`** — play a content level standalone.
- **`level-author` agent** (`.claude/agents/level-author.md`) — authors encounters through the pipeline
  (author-as-data → `validateLevel`/`stageEncounter` → playtest → guard). Invoke it for authoring; give
  it the spec — it will NOT redesign arc topology or invent canon.

### Discipline (don't reintroduce model drift — D98)
- Derive from core: enemy `templateId`s via `getEnemyTemplate` (BANDIT/ENEMY_TEMPLATES); objective
  kinds via `OBJECTIVE_KINDS` (single source; the type derives from it); board centering via
  `CombatView.centerOrigin`. **Never hand-copy a core enum.**
- A level is a player-facing surface → it needs a **visual e2e** (the freeze-catcher, per CLAUDE.md).
  `test:e2e:level` for content levels.
- Guards: `npx tsc --noEmit`, `npx vitest run`, `npm run build`, `npm run sim` (if routing/rewards
  move). e2e needs `CHROME_BIN=/opt/pw-browsers/chromium` in this environment.
- **Subagent commits are UNSIGNED** — either re-sign in the main session
  (`git commit --amend --no-edit --reset-author` → `git push --force-with-lease`) or have the agent
  report its changes and commit from the main session (preferred).

## Roadmap (deferred / next)

1. **Rename the captives** into the owner's named campaign characters (`captive-1/2/3`).
2. **The flank / repositioning session (C5-lite).** The Intel-gated insert that makes extracting the
   group the slick play. Red-team caveat **F1**: a *meaningful* flank is deep in enemy ground, so
   "safe informed insert vs. risky blind insert" needs a **second deploy protection source = the full
   parked C5**; a *lean* version is a **binary-unlock alternate spawn set** (Intel → you *may* deploy
   from the flank; its risk is natural net-exposure — no "safe vs. blind" claim). Reuses
   `opts.playerSpawns` (staging already supports the override) + a runloop flag-check + a deploy-time
   choice + a new visual e2e. Keep it *serving* extraction (insert near the cells → shorter escort).
3. **Map-creation expansion (owner's stated next direction) — "give this combat the scope a finale
   deserves."** Candidate scope: bigger/richer boards; more of the `AuthoredEncounter` surface in the
   editor (objectives incl. `closing-gate`, per-captive roles/naming, traps, rumors/intel-depth);
   editor **import** (edit an existing level's JSON — the editor's M3); and possibly a **map/topology
   editor** for the arc DAG (currently out of scope — the level editor is *combat-encounter* only).
   Open question for that session: how much of the arc-map wiring the editor should own vs. stay a
   deliberate code step (keep the curated arc from being silently overwritten).
4. **Promote The Rescue into the arc** once (2)/(3) settle.

## Key files
- Finale level: `src/content/levels/the-rescue.json`
- Live arc finale (D97, still shipped): `src/core/hollow-mill.ts` (`PRISON_ASSAULT`) + `hollowMillMap`
- Pipeline: `src/content/levels.ts`, `src/game/boot/level.ts` (`#level` route)
- Editor: `src/game/scenes/EditorScene.ts`, `src/game/editor-draft.ts` (`#editor` route)
- Agent: `.claude/agents/level-author.md`
- Guards: `src/content/levels.test.ts`, `scripts/e2e-level.mjs`, `scripts/e2e-editor.mjs`
- Decisions: `decisions.md` D97 (dual-OR extraction), D98 (editor + pipeline), D99 (rescue reframe + deploy-side deferral)
