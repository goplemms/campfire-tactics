# Finale design checklist — "The Rescue" to *finished*

**Owner-directed design track.** Living checklist for taking the finale (The Rescue, v4 concentric
prison — D97/D99/D116) from its current standalone state to shipped-in-the-arc. Updated **2026-07-26**
after merging `main` (D117 tag system + guard doctrine, M1–M5 complete).

Read alongside `decisions.md` **D97** (dual-OR extraction), **D99** (rescue reframe + deferred flank),
**D116** (authored-node injection + `provides`/`requires`), **D108/D117** (the guard door-drive doctrine
+ tag system), and the handoffs `finale-authoring-handoff.md` / `finale-storage-and-layout-handoff.md`.

---

## Temperature read (what just changed)

The **tag system + garrison door-drive doctrine shipped complete (D117, M1–M5).** That collapses what
was our single most load-bearing open crux. Concretely, these are now **built and guarded**, not design:

- **The tag system** — `tags.ts` (`TAGS`/`hasTag`/`getTag`), `Unit.tags`, the `non-combatant` + `garrison`
  intrinsic tags and the `in-combat` derived tag. The status-vs-tag line held (a `conferred` provenance is
  a documented seam, deliberately unbuilt until a consumer needs it — YAGNI).
- **`in-combat`** — spec ratified (R1–R3 + clause 5) *and implemented*, window realized as
  `(U's last turnEnd, now]` (the only replay-safe boundary). **Crux C1 is closed.**
- **The garrison door-drive doctrine** — a `garrison && !in-combat` unit drives to the nearest openable
  authored seal (Warden keys, guards batter), **primary** over attacking an un-engaged foe; pin a guard by
  *hitting* it. Plus **control-room target-priority** (M3b), a **free-casualty ceiling** guard (M4), and a
  **rendered, freeze-guarded** two-mouth distraction loop (`#scene=doctrine-harness`, `test:e2e:doctrine`).
- **The droppable key** — the keyholder lock's opt-in `dropOnDeath` (default = today's byte-identical
  auto-open); drop → pickup → Turn Key chain, replay/undo-safe, first player-facing `keyGate` surface.

**But all of that was built against `DOCTRINE_HARNESS`, not the real finale.** Per D117's own scope note,
the real finale is this separate owner-directed track; the doctrine *drops in* when the finale is
populated. So the mechanisms exist and are proven — the finale work is now largely **content + wiring**,
not substrate invention.

Also newly in our favor: **`run.flags: Record<string, boolean>`** (D52) is a live, general run-flag bag —
grants **set** flags (`runloop.ts:635`), grant predicates **read** them (`grants.ts:82/106`), and they
**round-trip** in repro dumps (`repro.ts`). The `sideDoorIntel` spawn condition rides this; it is no
longer new substrate.

---

## The settled spawn-condition design (arm-grain)

**Decided:** the special spawn condition = the **infiltration flank deploy**, gated **arm-grain** — taking
the Hollow Mill's infiltration arm earns it. Mechanism:

- `provides: "side-door-intel"` (already the `MapNode` seam, D116) rides **one infiltration-arm node**;
  completing it sets `run.flags["side-door-intel"] = true` via the existing grant→flag path.
- The finale's deploy phase reads the flag: **set** → offer the east-mouth infiltration `playerSpawns`
  (staging already supports the override) as a deploy-time choice; **unset** → frontal-only. The absence
  path *is* the graceful degradation — free.
- This finally makes D97's two topology-exclusive arms **pay off differently at the finale** (the original
  unfulfilled promise: both arms used to dead-end into the same holdout fight).

**One open sub-choice (owner):** narrative attribution — which beat "hands you" the side door:
- **`cuffedCell`** (the freed insider, last beat before the finale — my lean; strongest hand-off), or
- **`guildRite`** (initiation into the guild = insider knowledge; ties intel to the prestige moment).
Mechanically identical on a linear arm; purely a fantasy call.

**Deferred (unchanged):** the finer **scout-grain** (an optional/missable scout beat sets the flag even
within an arm) — layerable later as a second source without rework.

---

## The checklist: A–F

Legend: ✅ done · 🔨 de-risked (mechanism ships; finale-specific work remains) · ⬜ open · 💬 owner call

### A — The special spawn condition / flank (the runtime flag)
- ⬜ **A1** — Attach `provides: "side-door-intel"` to the chosen infiltration-arm node; set
  `run.flags["side-door-intel"]` on its completion (reuse the grant→flag path, `runloop.ts:635`).
- 🔨 **A2** — Read the flag at finale deploy → offer the infiltration `playerSpawns` set. *(De-risked: the
  flag bag round-trips for D22; `opts.playerSpawns` staging override exists; the M4 harness already proves
  a **two-mouth board renders** cleanly.)*
- ⬜ **A3** — Deploy-time **choice** UI (frontal vs. flank) when the flag is set; frontal-only when unset.
- ✅ **A4** — Graceful frontal fallback — *by construction* (flag absent ⇒ no alternate spawns offered).
- ⬜ **A5** — Visual e2e for the flag-gated deploy surface (the freeze-catcher; extend `e2e-scenario`/a new
  finale walk). *(The two-mouth render itself is already `test:e2e:doctrine`-proven.)*
- 💬 **A6** — Narrative attribution: `cuffedCell` vs. `guildRite` (see above).

### B — Populate the v4 concentric-prison layout (today a structural skeleton)
- 🔨 **B1** — Garrison mass + control-room guards, **tagged `garrison`** (drives the door-doctrine).
- 🔨 **B2** — The **Warden = keyholder** (D108); decide whether he carries **`dropOnDeath`** (capability
  ships, proven on `MICRO_KEY_DROP`) or stays auto-open.
- 🔨 **B3** — Author the **control-room `Region`** (M3b) so a lever/objective camper is targetable.
- ⬜ **B4** — 3 captives placed deep + objectives: `eliminate-all` **OR** `extraction` with exit spans on
  **both** mouths (all captives must extract, not a subset — the `levels.test` invariant).
- ⬜ **B5** — Confirm gate types: cell doors lockpick/keyholder; the two chokepoints destructible seals;
  **place seals between garrison and objective** (the doctrine's authoring contract, D117 F2 — no
  *decorative* openable seals in a garrison encounter).

### C — Fairness cruxes
- ✅ **C1** — What sets/clears `in-combat` (D108). **DONE** — ratified + built in D117 (R1–R3 + clause 5).
- ⬜ **C2 — Extraction viability.** The sim bot skips deploy + interactive screens, so viability **cannot**
  be a sim re-pin. Prove it with a **scripted scenario** (flank deploy → escort the group → assert
  win-by-extraction inside the seal-delay budget) **+ a geometry/pacing assertion** (flank-cells→exit
  escort length vs. garrison converge-through-seal time). *(Templates now exist: the doctrine-harness
  scenario + the free-casualty-ceiling headless test are the pattern to copy.)*

### D — Narrative / cast
- ⬜ **D1** — Name the 3 captives into real campaign characters (currently "Bound Captive I/II/III").

### E — Known residuals to decide on (from D117)
- 💬 **E1** — The **keyed-seal ↔ lever re-lock oscillation** ships *un-fully-defused*: Decision G's
  control-room targeting is a *weight* (makes the camper attackable), not a full defuse; the **free-casualty
  ceiling** is the farming tripwire. Decide if the finale's lever/seal geometry needs more, or if the weight
  + ceiling suffice for the shipped map.

### F — Promotion into the arc
- ⬜ **F1** — Replace `PRISON_ASSAULT` (`hollow-mill.ts:372`) with The Rescue; wire the finale node
  (`hollow-mill.ts:457` `authoredId`) — via the D116 injection path or an inline TS body.
- ⬜ **F2** — Place the `provides` node on the Hollow Mill infiltration arm; `validateExpedition` confirms
  it sits reachable upstream of the `requires` finale (fail-loud).
- ⬜ **F3** — Re-run arc guards (`wave0-arc`, `hollow-mill`) + **re-pin `npm run sim`** (routing/rewards
  move) + the arc e2e (`test:e2e:arc`).

---

## What's now available to build against (de-risking map)

| Need | Ships as | Where |
|------|----------|-------|
| Guard converge/batter behavior | garrison door-drive (primary, gated `!in-combat`) | `ai.ts` (`planSealDrive`) |
| "Is this guard pinned?" | `in-combat` derived tag | `tags.ts`, `combat-log.ts` |
| Deprioritize captives as targets | `non-combatant` intrinsic tag | `tags.ts`, `Unit.tags` |
| Keyholder drops a key on death | `dropOnDeath` on the gate lock | `gates.ts`, `key-drop.test.ts` |
| Camper (lever/objective) gets attacked | control-room `Region` + weight | `iso.ts` (`inRegion`), `ai.ts` |
| Run-scoped flag (set → carry → read) | `run.flags` + grant flag set/read | `run.ts:156`, `runloop.ts:635`, `grants.ts` |
| Alternate deploy spawns | `opts.playerSpawns` staging override | `staging.ts` |
| Two-mouth board renders (no freeze) | `#scene=doctrine-harness` | `scripts/e2e-doctrine.mjs` |

---

## Key files & decisions

- Finale (standalone, live): `src/content/levels/the-rescue.json` · v4 skeleton:
  `scratchpad/foundations/finale-v4-skeleton.json` · expedition wiring: `src/core/the-rescue.ts`
  (spawn flag still **inert** — line 28).
- Live arc finale (D97, still shipped): `src/core/hollow-mill.ts` (`PRISON_ASSAULT` L372, finale node L457).
- Doctrine/tag substrate: `src/core/tags.ts`, `combat-log.ts`, `ai.ts`, `gates.ts`; harness
  `src/core/scenarios/doctrine-harness.ts`.
- Run flags: `src/core/run.ts` (`flags` L156), `runloop.ts` (L635), `grants.ts`.
- Decisions: **D97/D99/D116** (finale), **D108/D117** (doctrine + tags), **D52** (run flags / captives),
  **D103–D107** (gates/levers/seals), **D114** (registry/guard discipline), **D22** (determinism).

---

## Suggested next step

**Crux C2 (extraction viability)** is the highest-leverage open design item — everything else in B/F is
authoring against shipped mechanisms, but if extraction isn't actually viable with the flank, the finale's
thematic heart stays aspirational. Nail the viability proof shape, then B (populate) + A (wire the flag)
can proceed against a known-good target.
