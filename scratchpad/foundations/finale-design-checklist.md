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
- The finale's deploy phase reads the flag: **set** → the **side entrance opens as a *second* deploy
  zone** (the player splits their force — bulk at the main entrance, infiltrator(s) at the side);
  **unset** → main-entrance-only. The absence path *is* the graceful degradation — free.
- **Not a swap — a split.** Per the owner's split-force intent (see `finale-extraction-viability.md`), the
  intel unlocks the side zone *in addition to* the main one; the flank is the infiltration half of a
  two-pronged op, not an all-in alternate spawn. This is what makes the extraction win *possible*, so it
  finally makes D97's two arms **pay off differently at the finale** (they used to dead-end into the same
  holdout fight).

**Attribution — settled: `cuffedCell`.** The freed prisoner *is* the insider who knows the side door — the
strongest hand-off, immediately before the finale. Preferred over `guildRite` because `cuffedCell`'s
completion is **unconditional** (win the fight), while `guildRite`'s meaningful outcome is **conditional**
(an under-floor Scout gets D92's "gracious decline"), which would fire the flag for something that
narratively didn't happen. One-line reversible if playtest disagrees.

**Deploy shape — settled:** the side entrance authors only **1–2 spawn tiles**, so the bulk lands at the
main entrance *by construction* (a side door fits a couple of people) — this is what makes the distraction
structurally guaranteed rather than optional. Units are **placed** at their authored spawns (no pre-battle
capture gauntlet at the side, and **no second campfire** — the full C5 stays parked, honoring D99's **F1**:
never claim a *safe* informed insert). The flank's risk is **in-battle isolation**, not a dice roll.

**Deferred (unchanged):** the finer **scout-grain** (an optional/missable scout beat sets the flag even
within an arm) — layerable later as a second source without rework.

---

## The checklist: A–F

Legend: ✅ done · 🔨 de-risked (mechanism ships; finale-specific work remains) · ⬜ open · 💬 owner call

### A — The special spawn condition / flank (the runtime flag) — **design complete**
- ⬜ **A1 — Provider = `cuffedCell`** (working call; one-line reversible). Attach
  `provides: "side-door-intel"`; completing it sets `run.flags["side-door-intel"]` via the grant→flag path
  (`runloop.ts:635`). **Why `cuffedCell` over `guildRite`:** (a) its completion is **unconditional** — you
  win the fight — whereas `guildRite`'s meaningful outcome is **conditional** (an under-floor Scout gets
  D92's "gracious decline", so the flag would fire for something that narratively didn't happen);
  (b) **the freed prisoner *is* the insider** who knows the side door — the strongest hand-off, and it sits
  immediately before the finale.
- ⬜ **A2** — Staging reads the flag: the finale's `AuthoredEncounter` carries the main `playerSpawns`
  **plus an optional second set** (side entrance); staging **unions** them when
  `run.flags["side-door-intel"]` is set. Minimal addition — one named flag, **no capability engine** (D116
  discipline). *(De-risked: flags round-trip for D22; `opts.playerSpawns` override exists; the M4 harness
  proves a two-mouth board renders.)*
- ⬜ **A3 — Split-deploy, with the side zone deliberately SMALL.** The side entrance authors only **1–2
  spawn tiles** (a side door fits a couple of people); the bulk therefore lands at the main entrance **by
  construction**. This is load-bearing, not flavour: if the player could field *everyone* at the side there
  would be **no distraction**, the whole garrison would converge on the escort, and the two-pronged tension
  collapses. Capping the slots makes the intended play discoverable and unbreakable.
- ⬜ **A3b — No deploy-capture gauntlet at the side zone (F1 ruling).** The D63/D67 deploy model anchors
  **one campfire at the home-edge centre** (`createCampfire`), so a side zone necessarily sits outside its
  protected radius — precisely D99's **F1** caveat. Ruling: the finale uses **authored placement** (units
  *start* at their spawn tiles, per the owner's "enter during deployment / setup"), so we **neither** add a
  second campfire (**the full C5 stays parked**) **nor** subject the infiltrator to pre-battle capture
  rolls. The flank's risk is **in-battle isolation** — alone, deep, with the garrison waking — not a dice
  roll before the fight. Honors F1's real point (**never claim a "safe informed insert"**) and the G
  leeway intent.
- ✅ **A4** — Graceful main-entrance-only fallback — *by construction* (flag absent ⇒ the side set is never
  unioned in).
- ⬜ **A5** — Visual e2e for the flag-gated deploy surface (freeze-catcher): flag **set** ⇒ side tiles are
  placeable and a unit can be positioned there; flag **unset** ⇒ main-entrance-only; no page error either
  way. *(The two-mouth render itself is already `test:e2e:doctrine`-proven.)*
- ✅ **A6** — Narrative attribution **settled: `cuffedCell`** (see A1).

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
- ⬜ **B6** — **Split-force geometry (from C2):** a **lever reachable by the infiltrator on turn 1** from
  the side spawn that slams the garrison seal; the seal **fully walls** the garrison off the infiltration
  route while shut; and the **escort corridor** (cells → side spawn) is **chokepointed** so a rearguard can
  hold the pursuit. These are the two C2 geometry invariants made concrete in the layout.

### C — Fairness cruxes
- ✅ **C1** — What sets/clears `in-combat` (D108). **DONE** — ratified + built in D117 (R1–R3 + clause 5).
- 🔨 **C2 — Extraction viability. Design drafted (split-force model) → `finale-extraction-viability.md`.**
  A two-party op: front **distraction** pins garrison (`in-combat`), infiltrator (the intel-unlocked
  **second** deploy zone) **slams a lever-seal** for a **head start**, then the escort **outruns the
  thinned pursuit through a chokepointed corridor** taking pot shots. Viability = **head-start ≥
  pursuit-close-time**, *not* a seal-hold (the door breaking mid-escape is designed in) — so seals need
  **~60–70 hp**, not 150. Two geometry invariants: seal fully walls the garrison while shut; escort
  corridor is chokepointed. Guard = scripted split-force scenario + mutation-robust pacing assertion
  (halve seal HP / drop the distraction / widen the corridor all flip it red) + geometry-invariant tests.
  **Open owner calls:** does the distraction party also exit (sacrificial rearguard vs. front exit) · one
  seal vs. series · lever reachable turn 1 · corridor chokepoints · garrison-strength target.

### G — Exfil semantics + the "Go now" call *(new, owner-directed 2026-07-26)*
> A unit **survives only if it's on an exfil site** when extraction resolves — captives *and* party.
> Losing someone is an allowed consequence; an appropriately-levelled party should have leeway to get
> everyone out. Detail + rationale in `finale-extraction-viability.md`.
- ⬜ **G1** — **Broaden the extraction met-condition** to captives **+ surviving party** (today it
  auto-completes on captives-alone → would silently strand a party still crossing). `objectives.ts`.
- ⬜ **G2** — **The "Go now" call** — resolve extraction on demand; on-exfil units escape, off-exfil are
  left behind. Outcome computed from what's true: captives out ⇒ **extraction win**; else ⇒ **survivable
  retreat** (`objective-failure`) — unifying "Go now" with the existing retreat concept.
- ⬜ **G3** — **Re-gate D21's win-auto-rescue on *field control*, not on `win`.** An extraction win is a
  *flight*, not a field hold; if left-behind units are auto-rescued (today's `win` behavior,
  `mortality.ts:193`) the **sacrifice is free and "Go now" is toothless**. Left-behind ⇒ the **captured**
  path (rescue follow-up / roster removal per D9). ⚠️ Touches shipped resolution semantics — needs its own
  guard + a decision record when built.
- ⬜ **G4** — Visual e2e for the **"Go now" control + the left-behind result screen** (new player-facing
  surface — freeze-catcher doctrine).
- ✅ **G5** — **ANSWERED: every mouth is an exfil site.** All exits just represent "away" — a unit is safe
  on **any** of them. So the distraction party falls back out the **main entrance** (no board-crossing) and
  the escort takes whichever mouth suits. Matches the leeway intent; no walkover risk since the cells stay
  deep and far from *every* mouth (D97 challenge-F still respected).
- ⬜ **G6** — *(from G5)* Author the extraction `span` as the **union of all mouth tiles** (east rows 4–6 ·
  bottom cols 8–10 · any other mouth), not a single edge — today `the-rescue.json` has one left-edge span.

### D — Narrative / cast
- ⬜ **D1** — Name the 3 captives into real campaign characters (currently "Bound Captive I/II/III").
  *(Partly done in the standalone: Wren / Cass / Bram already named in `the-rescue.json`.)*

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
