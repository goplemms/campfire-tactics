# Build brief — authored spawn zones + the split-deploy entrance action

**Track:** the finale (The Rescue). Implements checklist group **A** (A1/A2/A3/A3b/A3c/A5) — issue **#207**.
**Canon you must read before starting:** `decisions.md` **D119** (this brief's design, in full), **D118**
(the finale's spawn condition + the extraction win), **D117** (tags + the garrison door-drive doctrine),
**D116** (authored-node injection, `provides`/`requires`), **D99** (**F1** — the flank), **D63/D67** (the
deploy zone model), **D114** + `docs/design/implementation/conventions.md` (the one spelling for registries,
RNG labels, result shapes, modals).
**Working checklist:** `scratchpad/foundations/finale-design-checklist.md` group **A**.

> **This track has been bitten twice by plausible-but-false assumptions about shipped machinery.** Every
> code claim below was verified against source on 2026-07-28. **Verify anything you add to this list the
> same way before building on it.** If a claim here turns out to be wrong, say so — do not route around it
> silently.

---

## Why this exists (the player-facing problem)

The finale can be won two ways: fight the whole garrison, or sneak the prisoners out. **The second way is
currently unplayable.** The game assigns the side door by party order, so the infiltrator is whoever is
first in the roster — a Soldier, who cannot pick a lock. The only unit who *can* open the cells starts at
the front door, on the wrong side of the wall that gets sealed. The prisoners are unreachable.

This brief makes the split-force deploy a real, player-driven choice.

---

## What to build — four pieces

### 1. Authored spawn zones (the substrate)

An authored encounter may declare its **spawn zones**. Each zone has:

- a **shape** at an **authored fixed size** — **not** derived from party presence the way the campfire's
  radius is (`protectRadiusOn`, `deployment.ts`). Authoring the shape is the point: it sidesteps
  re-deriving how presence would split between two anchors, and which anchor the net contracts against.
- a **capacity cap** — **configurable per zone**, not hardcoded to 1.
- **danger override**: a unit standing in an authored zone is **safe regardless of where the net has
  reached**. This is what makes a distant side door viable without a pre-battle dice roll.

When an encounter declares zones, **the hardcoded campfire does not apply to it**.

**Insertion points (verified, and deliberately narrow):**
- `inSafeZone` (`deployment.ts:205`) is the **single** predicate that both the render
  (`game/deploy-zones.ts:32`) and `safeGroundRemains` consult.
- `captureChanceAt` (`deployment.ts:~240`) is the **single** risk computation.
- `isProtected` (`deployment.ts:195`) is read directly at `BattleScene.ts:2782` and
  `forecast-cards.ts:157` — check those call sites too.

**This is a general fix, not a finale patch.** Both `createCampfire` (`deployment.ts:176`, origin
hardcoded `col 0`, mid-row) and `createFront` (`deployment.ts:181`, origin hardcoded enemy-edge centre)
anchor to fixed board edges **with no check that the tile is walkable**. Every authored map inherits that.
On this map `createCampfire` lands at **`(0,9)` — blocked terrain** — and paints its protected radius over
the **cellblock**. Authored zones are the real fix; keep the old behaviour as the default for encounters
that declare no zones.

### 2. The entrance action (the player-facing allocation)

A unit standing in a spawn zone may take an action that **moves** it to another spawn zone, subject to that
zone's cap.

- **A move, not a swap** (D119, owner-settled). **Default placement is everyone at the primary zone with
  the side door EMPTY.** A swap would leave the side door permanently occupied, reproducing the exact
  defect we are fixing. Move-with-cap makes sending someone a deliberate act, and keeps "I scouted but I'm
  still going in the front" a legal play.
- It is a **fourth verb** beside the existing deploy choices (`DeployForecast` = `hold` / `digIn` / `move`,
  `deployment.ts:279`) — **not a new screen**.
- It appears **only when a second zone exists**. No intel ⇒ no side zone ⇒ no verb. That keeps D118's
  graceful degradation intact by construction (checklist **A4**).
- Surface it in the deploy action row (`BattleScene.ts:~895–945`), alongside the existing
  `pushGateVerbs` / `pushTrapVerbs` / `pushRescueVerbs` calls.

⚠️ **`placeParty` (`authored.ts:263`) index-maps `party[i] → spawns[i]` and stacks every extra unit on the
last spawn tile.** It must stop feeding the side zone by roster order. Default all units to the primary
zone.

### 3. The force-start (replacing a rule the override breaks)

The deploy phase currently ends when the net has eaten all safe ground: `frontTurnStage`
(`deploy-flow.ts:43`) returns `overrun` on `out.breached || !safeGroundRemains(...)`.

**With overriding zones, `safeGroundRemains` can never go false.** Do **not** leave both rules active and
hope — the phase would never auto-end.

**Build:** the phase force-starts when the **net reaches the primary zone**.

- ✅ Good news: `breached` (`deployment.ts:375`) **already means exactly this** — it just reads the
  campfire. Point it at the authored primary zone.
- ⚠️ **Spec point:** `breached` today is **unit-dependent** —
  `players.some(u => isProtected(u.pos, camp) && inDangerZone(u.pos, front))`, i.e. somebody must be
  *standing* in the core. The owner specified it **geometrically**: the net **arriving** at the primary
  zone. **Build the geometric reading** — otherwise an empty primary zone never fires it.
- The primary zone still **overrides** danger, so the net arriving **starts the battle but grabs nobody**.

**Expected feel, measured — do not "fix" this:** net origin `(19,9)` → nearest primary spawn tile
`(11,18)` is **17 steps** at `FRONT_ADVANCE_PER_TURN = 1`, so the backstop is on the order of **80+ deploy
actions**. That is **deliberate** (D119): it is a backstop against planning forever, not pacing pressure.
Tightening it means re-anchoring the net, which is explicitly deferred until someone has played the phase.

### 4. The intel gate (what earns the side door)

Two wirings, **neither sufficient alone** (D118 — an earlier draft conflated them):

- `grants: [{ flag: SIDE_DOOR_INTEL }]` on the **provider's authored encounter** — this is what actually
  *sets* the flag (`applyGrant`, `runloop.ts:635`).
- `provides: "side-door-intel"` on its **map node** — `validateExpedition` (`expedition.ts`) then
  **fail-loud**-proves a provider sits reachable upstream of the `requires` finale. **`provides`/`requires`
  are validate-only and set nothing.**

Staging **unions** the side zone into the encounter's zones when `run.flags[SIDE_DOOR_INTEL]` is set. One
named flag — **no capability engine** (D116 discipline).

⚠️ **Resolve the A0 blocker first.** The only shipped write path to `run.flags` is
`AuthoredEncounter.grants[].flag`, which fires **only on an authored combat encounter's win**. On the
standalone Rescue the provider `sideDoor` is a **`"rest"` node** — nothing can set a flag there.
**Recommended: (a)** make `sideDoor` an authored combat node carrying the grant — **zero new mechanism**.
Do **not** invent a non-combat flag-write path in this brief; that is its own decision record.

⚠️ **The flag bag is untyped `Record<string, boolean>` — a spelling slip fails SILENTLY.** Use the exported
`SIDE_DOOR_INTEL` constant (`the-rescue.ts`), never a string literal.

---

## Authoring requirement — non-negotiable

**Author the side zone TIGHT: the door tile only.**

Verified: the deploy phase already offers **Place Trap** (`skills.ts:408` — a trap is `pre-combat` *data*;
surfaces via `availableSkills(actor, "pre-combat")`, `BattleScene.ts:935`) **and Pull Lever** (`pullLever`
carries **no phase gate**, `turn.ts:607`; the deploy row calls `pushGateVerbs(specs, actor, "deployment")`,
`BattleScene.ts:941`, which pushes Pick Cell / Break Gate / Turn Key **and Pull Lever**). The garrison is
**frozen** during deploy (`configureDeployClock`), so an early lever throw draws **no combat response** —
its only price is the capture roll.

`winch-wall` sits at **`(17,6)`, two steps from the side spawn `(18,5)`**. So:

- a zone drawn **over** the lever ⇒ the early seal is **free**, and the design's risk/reward evaporates;
- a zone of **just the doorway** ⇒ reaching the lever means standing on neutral ground at
  **`NEUTRAL_DANGER = 0.4` per net turn**.

That trade — *plenty of time to lay traps on safe ground, or step out and risk detection for the early
seal* — is the **stated design intent** of accepting the loose backstop. Do not quietly widen the zone for
convenience.

**Do NOT "fix" Pull-Lever-during-deploy.** It is intended, and it is D67's ruling that engagement is board
state, not a per-phase verb ban.

---

## Guards — all green, plus what this owes

Run the full set from `CLAUDE.md`:

```
npm run build · npm test · npm run sim · npm run test:e2e
npm run test:e2e:scenario · npm run test:e2e:arc
npm run audit:visual · npm run audit:challenge
```

**Specifically owed by this work:**

- 🚨 **A visual e2e for the split deploy — MANDATORY, not optional.** Per `CLAUDE.md`: the core suite and
  the sim **never render a Phaser scene**, and the sim's bot **skips the deploy phase entirely**. A change
  can be 100% green and still hard-freeze the real game — an uncaught exception in a scene render reads as
  a **freeze**, not a stack trace. See the D92/#168 cautionary tale. Extend `scripts/e2e-rescue.mjs`.
  Prove: flag **set** ⇒ side zone placeable, a unit can be moved there via the entrance action, cap
  enforced; flag **unset** ⇒ primary only; **no page error either way**.
  ⚠️ `test:e2e:doctrine` proves a **6×3** harness — it does **not** de-risk a distant side zone on 20×20.
  ⚠️ **Position units by tile lookup, never by pixel.** The board zoom is today
  `min(BOARD_SCALE, fitBoardScale(...))` (`BattleScene.ts:528`), and **`BoardCamera` adoption is a queued
  follow-up** (D100) that will make pixel coordinates wrong again in a different way. The editor e2e had to
  move to lookup-by-tile for exactly this reason. Write it tile-addressed and it survives both.
- **Determinism** — the flag round-trips `snapshotRun`/repro: same seed + same choices ⇒ same zones.
- **The degradation path is tested, not assumed** — flag unset ⇒ the side zone is never unioned.
- **Fail-loud placement still works** — a typo'd or removed provider is rejected (the D116 guards).
- **Force-start** — a test that the phase ends when the net reaches the primary zone, **with the zone
  empty** (the geometric reading), and that nobody is captured by it.
- **Cap enforcement** — the side zone refuses a unit beyond its configured cap.
- **Regression** — an encounter that declares **no** zones behaves exactly as before (campfire + net
  unchanged). This is the blast-radius guard; do not skip it.
- `npm run sim` is **expected to stay byte-identical** here (no routing/reward change). **If the digest
  moves, stop and report it** rather than re-pinning — it means something changed that shouldn't have.

---

## Out of scope — do not absorb

- **G** — exfil semantics + the "Go now" call + the left-behind consequence (#208). Separate; it touches
  shipped resolution semantics and needs its own decision record.
- **The C2 guards** (#209) — the split-force scenario, the everyone-out pacing bar, the geometry
  invariants. Sequenced after this.
- **F** — promoting The Rescue into the Hollow Mill arc (#210), including moving the grant onto
  `CUFFED_CELL`.
- **The map expansion** — growing the board so the party starts outside the front door. Owner's next
  piece; expect the zone coordinates authored here to **move**. Author them so that is a data edit.
- **Battle-side `BoardCamera` adoption** (pan + zoom on the battle board). Built and shipped for the
  editor as **D100**; the battle wiring is a **recorded, deliberate follow-up** whose prerequisite is
  moving BattleScene's on-canvas HUD to a **second, fixed camera** (else the HUD scrolls with the board).
  Sequenced **before** the map expansion, **after** this. Do not start it here.
- **Balance/tuning** — guard counts, seal hp, party strength. Owner tunes these in the map editor after
  this lands.
- **The full C5** deploy deep-dive, and the scout-grain flag source. Both parked.
- **Re-anchoring the net.** Deferred deliberately (D119).

---

## Working agreement

- **Plan first**, and **red-team the deploy-side choices** before building (`decision-adversary`).
- **Do NOT commit.** Report your changes and let the main session commit — subagent commits are unsigned.
- **Report honestly**: what you built, what you verified, what you could not, and anything that turned out
  differently from this brief. If a verified claim above is wrong, that is a finding worth more than a
  clean report.
