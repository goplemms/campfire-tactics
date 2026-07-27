# Finale group A — the spawn condition, wired: session kickoff prompt

**What this is:** the build prompt for **checklist group A** — making the finale's *special spawn condition*
(the intel-gated infiltration flank) actually live. The design is **settled and ratified as D118**; this
session builds it. It also carries **two genuine mechanism decisions** (A3, A3b) that must be designed
before they're built — they are *not* pure wiring.

**Read first (canon — do NOT relitigate):**
- `decisions.md` **D118** — the ratified calls (arm-grain, `cuffedCell`, second-deploy-zone, exfil rules).
- `scratchpad/foundations/finale-design-checklist.md` — group **A** in full + the de-risking map.
- `scratchpad/foundations/finale-extraction-viability.md` — crux **C2**; *why* the flank exists (it enables
  the split-force op; it is **safer, not faster**).
- `decisions.md` **D99** (the flank + the **F1** caveat), **D116** (`provides`/`requires`, injection),
  **D117** (tags/doctrine), **D63/D67** (the deploy zone model), **D22** (determinism).

---

## Settled — build to this, don't re-open it

- **Arm-grain.** Taking the infiltration arm earns `side-door-intel`. Attribution is **`cuffedCell`**
  (unconditional completion; the freed prisoner is the insider). Scout-grain stays deferred.
- **A second deploy zone, not a swap.** The intel opens the side entrance **in addition to** the main one —
  the player *splits* their force. No intel ⇒ main-only ⇒ extraction impractical ⇒ eliminate-all. The
  graceful degradation and the incentive are the same mechanism.
- **No second campfire.** That's the full **C5**, still parked; D99's **F1** forbids claiming a *safe*
  informed insert. The flank's risk is **in-battle isolation**, not a pre-battle dice roll.

---

## ⚠️ Blocker to solve first: nothing can set the flag from a non-combat node

Verified against source, and it changes the shape of A1:

- The **only** shipped path that writes `run.flags` is **`EncounterGrant.flag`** — applied at
  `runloop.ts:619` (`if (isAuthoredEncounter(source) && source.grants) this.applyGrant(...)`) → `:635`
  (`if (grant.flag) this.run.flags[grant.flag] = true`). It fires **only for an authored combat encounter's
  win**.
- The *other* grant system (`grants.ts`, D65 — used by `stories.ts:347`) **cannot** write a flag:
  `GrantEffect` is exactly `{kind:"addHeldJob"} | {kind:"prestige"}`.
- **`MapNode.provides`/`requires` set nothing** — they are **validate-only** (`expedition.ts`), proving a
  provider sits reachable upstream.

**Consequence:** in the **arc**, `cuffedCell` *is* an authored combat node → `grants: { flag }` works
natively. But in the **standalone Rescue expedition** (`the-rescue.ts`), the provider `sideDoor` is a
**`"rest"` node** — so **no shipped path can set the flag there**, and that's where A wants to be iterated
(the arc finale is still `PRISON_ASSAULT` until **F**).

**Options (pick one, record it):**
- **(a) Make `sideDoor` an authored combat node** with a small encounter carrying `grants: { flag: SIDE_DOOR_INTEL }`.
  *Zero new mechanism — uses only shipped paths.* **Recommended for this session.**
- **(b) Add a non-combat flag-write path** (a story/event outcome or node-completion hook). More generally
  useful, but it's new mechanism and wants its own decision record — arguably the *right* long-term answer,
  wrong scope to smuggle in here.
- **(c) Build against the arc directly** — blocked: requires **F** (promotion) first.

---

## The buildable slice

- **A1 — two wirings** (they are different things; neither alone is sufficient):
  1. **`grants: [{ flag: SIDE_DOOR_INTEL }]`** on the provider's authored encounter — *this is what sets it*.
  2. **`provides: "side-door-intel"`** on its **map node** — so `validateExpedition` fail-loud-proves the
     placement upstream of the `requires` finale.
  - Use the exported **`SIDE_DOOR_INTEL`** constant (`the-rescue.ts`), never a string literal — the flag bag
    is an untyped `Record<string, boolean>`, so a spelling slip fails **silently**.
- **A2 — staging reads the flag.** The finale's `AuthoredEncounter` carries the main `playerSpawns` **plus an
  optional second set**; staging **unions** them when `run.flags[SIDE_DOOR_INTEL]` is set. One named flag —
  **no capability engine** (D116 discipline). *Note: A2 needs a finale with a second spawn set authored; that
  does **not** require the full **B** populate — a minimal second spawn set on the existing
  `content/levels/the-rescue.json` is enough to build and guard A.*
- **A3 — split-deploy allocation (MECHANISM DECISION).** ⚠️ `placeParty` (`authored.ts:263`) maps unit
  *index* → spawn and **stacks every extra unit on the last spawn tile**. So authoring "1–2 side tiles"
  **caps nothing** and gives the player **no way to choose** who goes where. Required: a **player-facing zone
  assignment** + an **enforced side-zone cap**. This is load-bearing — if everyone can deploy at the side
  there is **no distraction**, the whole garrison converges on the escort, and the two-pronged tension
  collapses.
- **A3b — deploy-phase treatment at the side zone (MECHANISM DECISION, the F1 question).** ⚠️
  `BattleScene.enterDeploy` runs the campfire/closing-net deploy phase **unconditionally**, and
  `createCampfire` (`deployment.ts:176`) hardcodes its origin to **`col 0`, mid-row** — while the v4 mouths
  are **east (18,5)** and **bottom (9,18)**. As authored, *both* zones sit outside the protected radius and
  the net geometry doesn't match the map. Options: **(i)** skip/short-circuit the deploy phase for this
  authored encounter (units simply *start* at their spawns — the owner's "enter during deployment / setup"
  reading, **recommended**); **(ii)** re-anchor the campfire per encounter. **Do NOT** add a second campfire.
- **A5 — visual e2e** (freeze-catcher, CLAUDE.md): flag **set** ⇒ side tiles are placeable and a unit can be
  positioned there; flag **unset** ⇒ main-only; **no page error either way**. Note `test:e2e:doctrine` proves
  a **6×3 harness** renders — it does **not** de-risk a flag-gated, distant side zone on a 20×20 board.

---

## Guards

Keep the full set green (`CLAUDE.md`): `npm run build` · `npm test` · `npm run sim` · `test:e2e:*` ·
`audit:visual` · `audit:challenge`. Specifically owed here:
- **Determinism (D22):** the flag round-trips `snapshotRun`/repro dumps; same seed + same choices ⇒ same
  spawn options.
- **Fail-loud placement:** `loadExpedition` still rejects a removed/typo'd provider (the D116 guards).
- **The degradation path is tested, not assumed:** flag unset ⇒ the side set is never unioned in.
- **A new player-facing surface ⇒ a visual e2e** (A5). Do not rely on screenshot scripts — they are not gates.

---

## Out of scope (explicitly)

**B** (populate the v4 prison — issue #204) beyond the minimal second spawn set A needs · **G** (exfil
semantics + "Go now", incl. the two resolution changes — needs its own decision record) · the **C2 guards**
(they need the populated map) · **E1** · **F** (arc promotion, incl. moving the `grants` onto `CUFFED_CELL`)
· the scout-grain flag source · the full **C5** deploy deep-dive.

---

## Key files

- Expedition + flag constant: `src/core/the-rescue.ts` (`SIDE_DOOR_INTEL`; the inert-marker note at L28 —
  **update it** once the flag is live).
- Flag write/read: `src/core/runloop.ts` (`:619` grant dispatch, `:635` `applyGrant`), `src/core/run.ts`
  (`flags` L156), `src/core/expedition.ts` (validate-only `provides`/`requires`).
- Staging/spawns: `src/core/staging.ts` (`opts.playerSpawns`), `src/core/authored.ts:263` (`placeParty` —
  the stacking trap).
- Deploy model: `src/core/deployment.ts` (`createCampfire` L176), `src/game/scenes/BattleScene.ts`
  (`enterDeploy`).
- Finale level: `src/content/levels/the-rescue.json` · arc: `src/core/hollow-mill.ts` (`CUFFED_CELL` L275,
  `PRISON_ASSAULT` L372, finale node L457).
- Guards to extend: `src/content/the-rescue-expedition.test.ts`, `src/core/expedition-load.test.ts`,
  `scripts/e2e-rescue.mjs`.

---

## Approach

Plan it first (the two mechanism decisions deserve it), **red-team** the deploy-side choices
(`decision-adversary` — especially A3's cap and A3b's F1 reading, which a previous pass got wrong by
assuming behavior instead of reading `placeParty`/`enterDeploy`). **Verify claims against source before
building on them** — this design track has already been bitten twice by plausible-but-false assumptions
about shipped machinery. Log the outcome as a **D118 follow-up** in `decisions.md`.
