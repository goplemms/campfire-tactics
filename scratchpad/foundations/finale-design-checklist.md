# Finale design checklist — "The Rescue" to *finished*

**Owner-directed design track.** Living checklist for taking the finale (The Rescue, v4 concentric prison —
D97/D99/D116) from its current standalone state to shipped-in-the-arc. Updated **2026-07-26** after merging
`main` (D117 tag system + guard doctrine, M1–M5) and a `/code-review` pass that verified every code claim
below against the source.

**Canon:** this session's calls are logged as **D118** in `decisions.md` — read it for the ratified
decisions; this file is the working checklist.

Read alongside `finale-extraction-viability.md` (crux C2 in full), `decisions.md` **D97** (dual-OR
extraction), **D99** (rescue reframe + deferred flank), **D116** (authored-node injection +
`provides`/`requires`), **D108/D117** (guard door-drive doctrine + tag system), and the handoffs
`finale-authoring-handoff.md` / `finale-storage-and-layout-handoff.md`.

---

## Temperature read (what just changed)

The **tag system + garrison door-drive doctrine shipped complete (D117, M1–M5)** — that closes what was our
most load-bearing open crux. Built and guarded, not design:

- **The tag system** — `tags.ts` (`TAGS`/`hasTag`/`getTag`), `Unit.tags`, the `non-combatant` + `garrison`
  intrinsic tags, the `in-combat` derived tag. (A `conferred` provenance is a documented seam, unbuilt.)
- **`in-combat`** — ratified (R1–R3 + clause 5) *and implemented*, window `(U's last turnEnd, now]`.
  **Crux C1 closed.**
- **The garrison door-drive doctrine** — `garrison && !in-combat` drives to a seal it can open, **primary**
  over attacking an un-engaged foe; pin a guard by *hitting* it. Plus control-room target-priority (M3b), a
  free-casualty ceiling (M4), and a rendered freeze-guarded loop (`#scene=doctrine-harness`).
- **The droppable key** — the keyholder lock's opt-in `dropOnDeath`, replay/undo-safe.

**All of it was built against `DOCTRINE_HARNESS`, not the real finale** — per D117's own scope note, the
finale is this separate track and the doctrine *drops in* when it's populated. The remaining finale work is
largely **content + wiring**, not substrate invention.

---

## The settled spawn-condition design (arm-grain)

**Decided:** the special spawn condition = the **infiltration flank deploy**, gated **arm-grain** — taking
the Hollow Mill's infiltration arm earns it.

**Attribution — settled: `cuffedCell`.** The freed prisoner *is* the insider who knows the side door — the
strongest hand-off, immediately before the finale. Preferred over `guildRite` because `cuffedCell`'s
completion is **unconditional** (win the fight) while `guildRite`'s meaningful outcome is **conditional**
(an under-floor Scout gets D92's "gracious decline"), which would fire the flag for something that
narratively didn't happen. One-line reversible if playtest disagrees.

**⚠️ The flag path is two separate wirings** (verified — an earlier draft conflated them):
- **`MapNode.provides`/`requires` are validate-only** (`expedition.ts`) — they prove a provider sits
  reachable upstream and **set nothing**.
- **The flag setter is `applyGrant`** (`runloop.ts:635`), which reads **`AuthoredEncounter.grants[].flag`**.
  `CUFFED_CELL` (`hollow-mill.ts:275`) currently has **no `grants`** — so both halves must be authored.
- Flag id is the kebab string **`side-door-intel`** (matching the shipped `SIDE_DOOR_INTEL` in
  `the-rescue.ts`). The flag bag is untyped `Record<string, boolean>`, so a spelling slip fails **silently**
   — use the exported constant, never a literal.

**Deploy shape:** the side entrance is a **small** authored zone (1–2 tiles — a side door fits a couple of
people), so the bulk lands at the main entrance. ⚠️ **This is not yet a cap** — see **A3**.

**Deferred (unchanged):** the finer **scout-grain** (an optional/missable scout beat also sets the flag) —
layerable later without rework.

---

## The checklist: A–G

Legend: ✅ done · 🔨 de-risked (mechanism ships; finale work remains) · ⬜ open · 💬 owner call

### A — The special spawn condition / flank — **design complete**
- ⬜ **A1** — **Two wirings** (see above): add `grants: [{ flag: SIDE_DOOR_INTEL }]` to **`CUFFED_CELL`**
  (this is what actually sets `run.flags`), *and* `provides: "side-door-intel"` on its **map node** (so
  `validateExpedition` fail-loud-proves the placement). Neither alone is sufficient.
- ⬜ **A2** — Staging reads the flag: the finale's `AuthoredEncounter` carries the main `playerSpawns`
  **plus an optional second set** (side entrance); staging **unions** them when
  `run.flags[SIDE_DOOR_INTEL]`. One named flag, **no capability engine** (D116 discipline).
- ⬜ **A3** — **Split-deploy allocation — needs a real mechanism.** ⚠️ Authoring 1–2 side tiles does **not**
  cap anything: `placeParty` (`authored.ts:263`) maps unit *index* → spawn and **stacks every extra unit on
  the last spawn tile**, so it neither limits the side zone nor lets the player choose the split. Required:
  a **player-facing zone assignment** (which units start side vs. main) **plus an enforced side-zone cap**.
  This is load-bearing, not polish — if the player can field everyone at the side there is **no
  distraction**, the whole garrison converges on the escort, and the two-pronged tension collapses.
- ⬜ **A3b** — **Deploy-phase treatment at the side zone (F1) — a real decision, not free.** ⚠️ Verified:
  `BattleScene.enterDeploy` runs the campfire/closing-net deploy phase **unconditionally**, and
  `createCampfire` (`deployment.ts:176`) hardcodes its origin to **`col 0`, mid-row** — while the v4 mouths
  are **east (18,5)** and **bottom (9,18)**. So *both* zones sit outside the protected radius as authored;
  a side infiltrator would take capture rolls, and the net geometry doesn't match the map at all. Options:
  (i) **skip/short-circuit the deploy phase** for this authored encounter (units simply start at their
  spawns — the owner's "enter during deployment / setup" reading); (ii) **re-anchor the campfire** per
  encounter. **Do NOT** add a second campfire — that's the full **C5**, which stays parked, and D99's **F1**
  forbids claiming a *safe* informed insert. Intent: the flank's risk is **in-battle isolation**, not a
  pre-battle dice roll.
- ✅ **A4** — Graceful main-entrance-only fallback — *by construction* (flag absent ⇒ side set never unioned).
- ⬜ **A5** — Visual e2e for the flag-gated deploy surface (freeze-catcher): flag **set** ⇒ side tiles
  placeable; **unset** ⇒ main-only; no page error either way. *(Note: `test:e2e:doctrine` proves a **6×3
  harness** renders — it does **not** de-risk a flag-gated, distant side zone on a 20×20 board.)*
- ✅ **A6** — Attribution settled: **`cuffedCell`**.

### B — Populate the v4 concentric-prison layout (today a structural skeleton)
- 🔨 **B1** — Garrison mass + control-room guards, **tagged `garrison`**.
- 🔨 **B2** — The **Warden = keyholder** (D108); decide `dropOnDeath` (ships, proven on `MICRO_KEY_DROP`)
  vs. auto-open.
- 🔨 **B3** — Author the **control-room `Region`** (M3b) so a lever/objective camper is targetable.
- ⬜ **B4** — 3 captives placed deep + objectives: `eliminate-all` **OR** `extraction` (all captives, not a
  subset — the `levels.test` invariant).
- ⬜ **B5** — Gate types: cell doors lockpick/keyholder; the chokepoint seals destructible; **seals placed
  between garrison and objective** (D117 F2 authoring contract).
- ⬜ **B6** — **Split-force geometry (C2):** a **lever reachable by the infiltrator on turn 1** from the
  side spawn; the seal **fully walls** the garrison off the infiltration route while shut; and the
  **competitive escort routes** (cells → *any* mouth) carry **chokepoints** for the rearguard.
- ⬜ **B7** — **Tag the captives `non-combatant`.** Load-bearing for the pursuit model (D117 **R3**: they
  never confer `in-combat`, so they can't self-screen) — and **not tagged in `the-rescue.json` today**.
- ⬜ **B8** — **No garrison-openable gate except the intended seal.** ⚠️ `driveSealFor` (`ai.ts`) picks the
  **nearest** gate the unit can open, sorted by manhattan, with **no route-relevance check** — so a Warden
  who is keyholder of the **cell doors** will drive over and **open the cells for you**. Cell locks must not
  be openable by any `garrison` unit.
- ⬜ **B9** — Extraction `span` = the **union of all mouth tiles** (today `the-rescue.json` has one
  left-edge span).

### C — Fairness cruxes
- ✅ **C1** — What sets/clears `in-combat`. **DONE** — ratified + built in D117.
- 🔨 **C2 — Extraction viability. Design drafted → `finale-extraction-viability.md`.** Split-force op:
  front distraction pins the garrison, infiltrator slams a lever-seal for a **head start**, escort
  **outruns the thinned pursuit through a chokepointed corridor**. Viability = **head-start ≥
  pursuit-close-time**, *not* a seal-hold — seals ~**60–70 hp** (not 150, not the 15–20 micro default).
  Guards: scripted split-force scenario + **everyone-out** mutation-robust pacing bar + three
  geometry-invariant tests. **Open owner calls:** one seal vs. series · lever reachable turn 1 · corridor
  chokepoints · garrison-strength target.

### G — Exfil semantics + the "Go now" call *(owner-directed 2026-07-26)*
> A unit **survives only if it's on an exfil site** when extraction resolves — captives *and* party.
> Losing someone is allowed; an appropriately-levelled party should have leeway to get everyone out.
- ⬜ **G1** — **Broaden the extraction met-condition** to captives **+ surviving party** (today
  `objectives.ts` auto-completes on captives-alone → would silently strand a party still crossing).
- ⬜ **G2** — **The "Go now" call** — resolve on demand; on-exfil units escape, off-exfil are left behind.
  Outcome from what's true: captives out ⇒ **extraction win**; else ⇒ **survivable retreat**
  (`objective-failure`), unifying "Go now" with the existing retreat concept.
- ⬜ **G3** — **Left-behind consequence — two changes, both new work.** ⚠️ Verified: `resolveRescues`
  (`runloop.ts:642–658`) starts `if (!u.captured) continue`, so an off-exfil **survivor is untouched and
  just comes home**. So (a) extraction resolution must **mark off-exfil survivors as captured** (doesn't
  exist today), and (b) the same function's `won` branch `freeCaptive`s every captured unit (D21 field
  control) — an extraction win is a **flight, not a field hold**, so that auto-free must be **gated on
  field control**, routing left-behind through `resolveCaptured` instead. Without **both**, "Go now" is
  toothless. Touches shipped resolution semantics ⇒ own guard + decision record when built.
- ⬜ **G4** — Visual e2e for the **"Go now" control + left-behind result screen** (new player-facing
  surface).
- ✅ **G5** — **Every mouth is an exfil site** (all exits represent "away"). The distraction party falls
  back out the **main entrance**; no walkover risk since cells stay deep and far from *every* mouth.

### D — Narrative / cast
- ⬜ **D1** — Name the 3 captives into campaign characters. *(Largely done in the standalone: **Wren /
  Cass / Bram** are named in `the-rescue.json`; the older handoff's "Bound Captive I/II/III" is stale.)*

### E — Known residuals
- 💬 **E1** — The **keyed-seal ↔ lever re-lock oscillation** ships un-fully-defused: M3b's control-room
  targeting is a *weight* (makes the camper attackable), not a full defuse; the free-casualty ceiling is
  the farming tripwire. Decide whether the finale's lever/seal geometry needs more.

### F — Promotion into the arc
- ⬜ **F1** — Replace `PRISON_ASSAULT` (`hollow-mill.ts:372`) with The Rescue; wire the finale node
  (`hollow-mill.ts:457`) via the D116 injection path or an inline TS body.
- ⬜ **F2** — Place the `provides` node on the infiltration arm; `validateExpedition` confirms it sits
  reachable upstream of the `requires` finale (fail-loud).
- ⬜ **F3** — Re-run arc guards (`wave0-arc`, `hollow-mill`) + **re-pin `npm run sim`** + `test:e2e:arc`.

---

## What's available to build against (de-risking map)

| Need | Ships as | Where |
|------|----------|-------|
| Guard converge/batter behavior | garrison door-drive (primary, gated `!in-combat`) | `ai.ts` (`planSealDrive`) |
| "Is this guard pinned?" | `in-combat` derived tag | `tags.ts`, `combat-log.ts` |
| Deprioritize captives as targets | `non-combatant` intrinsic tag *(must still be authored — B7)* | `tags.ts`, `Unit.tags` |
| Keyholder drops a key on death | `dropOnDeath` on the gate lock | `gates.ts`, `key-drop.test.ts` |
| Camper gets attacked | control-room `Region` + weight | `iso.ts` (`inRegion`), `ai.ts` |
| Set a run flag | `AuthoredEncounter.grants[].flag` → `applyGrant` | `runloop.ts:635`, `run.ts:156` |
| Validate flag *placement* | `MapNode.provides`/`requires` (**validate-only**) | `expedition.ts` |
| Alternate deploy spawns | `opts.playerSpawns` (⚠️ index-mapped, stacks — A3) | `staging.ts`, `authored.ts:263` |

---

## Key files & decisions

- Finale (standalone, live): `src/content/levels/the-rescue.json` · v4 skeleton:
  `scratchpad/foundations/finale-v4-skeleton.json` · expedition wiring: `src/core/the-rescue.ts`
  (spawn flag still **inert** — line 28).
- Live arc finale (D97, still shipped): `src/core/hollow-mill.ts` (`PRISON_ASSAULT` L372, finale node L457,
  `CUFFED_CELL` L275).
- Doctrine/tag substrate: `src/core/tags.ts`, `combat-log.ts`, `ai.ts`, `gates.ts`; harness
  `src/core/scenarios/doctrine-harness.ts`.
- Run flags / resolution: `src/core/run.ts` (`flags` L156), `runloop.ts` (`applyGrant` L635,
  `resolveRescues` L642–658), `mortality.ts`, `objectives.ts`, `deployment.ts` (`createCampfire` L176).
- Decisions: **D97/D99/D116** (finale), **D108/D117** (doctrine + tags), **D52** (run flags / captives),
  **D103–D107** (gates/levers/seals), **D63/D67** (deploy zone model), **D114**, **D22**.

---

## Suggested next step

**B is populated (#211).** Verified against `the-rescue.json` on 2026-07-28: 10 garrison-tagged bodies + the
Warden (keyholder on `seal-outer`, `dropOnDeath`), 3 captives named + **`non-combatant`-tagged**, cells
lockpick-only, two destructible seals at **64 hp**, four levers, both goals authored, and the extraction
`span` already the **union of both mouths**. B1/B2/B4/B5/B7/B9 are done; **B6/B8 remain unproven** (they are
geometry claims, and the tests that would prove them are the C2 guards, #209).

**Next: the A group** (split deploy). A3 and A3b each carry a real mechanism decision.

### Sequencing call — owner, 2026-07-28: **build first, tune later**

The winnability proof (**#209**'s incentive/pacing bar) does **not** gate the A-group build. Rationale:
beatability is a **numbers** problem, and the numbers — garrison count/archetypes, seal hp, cell locks — are
all editable natively in the **map editor** (verified: the enemy palette places any template, the gate
inspector edits `openBy`/`locked`, and the party picker already offers an **"Infiltration (3)"** squad with a
thief). So the fight gets tuned by feel in the editor once it is playable, and #209 **pins** the result
afterwards rather than gating it.

⚠️ **One honest caveat, recorded not litigated:** the editor's playtest bodies all share **one flat stat
block** (`speed 11 / hp 26 / atk 8`, `playtest.ts` `BASE`) with only the *job* varying — they are not the
levelled campaign party that actually arrives at the finale. So editor tuning calibrates the fight against a
**proxy** party. That is fine for feel; it means the "is it winnable by the real party" question is answered
at **arc-promotion time (F)**, not before.
