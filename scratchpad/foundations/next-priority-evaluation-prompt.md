# Next-priority evaluation — session prompt

**Purpose:** decide **what to work on next, with evidence** — not by issue number, not by momentum. Produce a
reasoned recommendation the owner can act on. **This session evaluates; it does not build.**

Written 2026-07-28, after the D118 finale design track and #204 (the v4 prison) merged.

---

## Where things actually stand

**Just shipped (all on `main`):**
- **D117** — tag system + garrison door-drive doctrine, complete M1–M5 (`in-combat`, `non-combatant`,
  `garrison`, control-room targeting, droppable key). Built against `DOCTRINE_HARNESS`.
- **D118** — the finale's spawn condition + extraction design, ratified (#203, #205).
- **#204 / PR #211** — the **v4 concentric prison is populated and playable**: 20×20, garrison of 10, Warden
  keyholder with `dropOnDeath`, 3 named `non-combatant` captives deep in cells, two 64-hp destructible seals,
  four levers, dual-OR objectives with the exit span unioning **both** mouths. Guard-proven winnable **both**
  ways (incl. eliminate-all without a Thief). Also carried a battle-board **shrink-to-fit** (no pan camera in
  `BattleScene`) and two **editor round-trip** fixes.

**The central tension to weigh:** the finale is *mechanically* winnable and guarded — but the **intended play
is not player-reachable**. The split-force operation (bulk at the main entrance, infiltrator through the side
door) depends on group **A**, which is unbuilt: `placeParty` maps `party[i] → spawns[i]`, so `party[0]` is the
infiltrator **by index accident** (currently a Soldier, not the Thief), with no zone assignment and no cap.
And **A3b is visibly wrong on this map** — `createCampfire` hardcodes `col 0`, which here is a *wall*, so the
deploy "safe core" paints over the **cellblock**, nowhere near either spawn
(`screenshots/e2e-level/04-the-rescue.png`).

---

## The candidates (do not assume this list is complete or correctly ordered)

**Finale track (open issues):**
1. **#207 — A: wire the spawn condition.** Two wirings + **two genuine mechanism decisions** (A3
   split-deploy allocation; A3b deploy-phase treatment). ⚠️ Carries a **blocker**: the only shipped path that
   writes `run.flags` is `EncounterGrant.flag` on an *authored combat encounter* win, and The Rescue's
   provider `sideDoor` is a **rest** node — so **A0** (pick the approach) must be resolved first.
2. **#208 — G: exfil semantics + "Go now".** ⚠️ Changes **shipped resolution semantics** for every encounter
   that could leave captured units (mark off-exfil survivors captured; re-gate D21's auto-free on field
   control). Wants its own decision record.
3. **#209 — C2 guards.** Depends on #207. Will **pin** the tuning numbers.
4. **#210 — F: promotion into the arc.** Depends on all of the above.

**Not yet issues — evaluate whether any of these outrank the above:**
5. **Playtest / tune the finale numbers.** `SEAL_HP = 64` and garrison size **10** were reasoned, not played.
   Cheap, one line each — and **#209 will bake them into a pacing bar**, so doing it *after* #209 means
   re-pinning a guard. Consider the ordering cost.
6. **E1 — the keyed-seal ↔ lever re-lock residual.** D117 M3b shipped a *weight*, not a full defuse; the
   free-casualty ceiling is the only tripwire. Now that the finale's lever/seal geometry is **real and
   concrete**, this is finally answerable — is it a genuine problem on *this* board, or theoretical?
7. **`PROGRESS.md` is badly stale** — frozen at **M12** while canon is at **D118**. `CLAUDE.md` names it the
   resume/survival file ("if context is lost, this page alone should let work resume"), and it currently
   cannot do that job. Cheap to fix; the cost of leaving it is silent and compounding.
8. **Older parked threads** — do **not** tunnel-vision on the finale. Check `decisions.md` and
   `plan.md`/roadmap for threads that may outrank it: the **save system + lord game-over (D27)**, the
   **terminal-ending design** (deferred since M7), the **map-creation expansion**, the
   `captured`/`thief`/`lord`/`authored` → tag **migration** (D117 deferred), and anything else parked.

---

## Evaluation criteria (weigh explicitly; add your own if they're better)

- **Player-visible gap.** Does it close the distance between "guards are green" and "a person can actually
  play the thing as designed"? (The finale currently fails this.)
- **Unblocks the most downstream work.** What does finishing it release?
- **Rework risk from ordering.** Does doing X before Y force re-pinning a guard or re-authoring content?
  (Tuning vs. #209 is the live example.)
- **Blast radius / reversibility.** #208 touches shipped resolution semantics for *all* encounters — higher
  risk, wants a decision record and its own guards.
- **Cost vs. value.** Cheap-and-high-value beats expensive-and-important for a *next* step.
- **Decay risk.** What silently rots if deferred (stale resume docs, drifting design/code, unverified
  assumptions)?
- **Owner intent.** The finale has been the active track — but say so if the evidence points elsewhere.

---

## Questions to answer **with evidence** (read the code; don't infer)

1. **Can a player actually play the finale end-to-end right now?** Boot it (`#rescue`, `#level=the-rescue`),
   look at the deploy step. Does the lone side-door unit have a viable turn? Does the intended play read at
   all, or does it look broken/confusing to a player? Screenshot it.
2. **Is the merged finale a net improvement in *playability*, or only in *content*?** Be honest — the prior
   `the-rescue.json` was a small level that was decisively winnable frontally.
3. **Is A3b actively harmful or merely ugly?** Does the misplaced campfire/net just look wrong, or does it
   *capture units* / mislead placement in a way that breaks the encounter?
4. **What does #209 actually pin**, and would tuning first save real work?
5. **Is E1 a real problem on the shipped geometry?** Use the live `planEnemyTurn` the way #204's tests did.
6. **Is anything outside the finale track more valuable right now?** Name it with a reason, or state plainly
   that the finale track dominates.

---

## Output

A short written recommendation (not a build):

1. **The pick** — one recommended next body of work, with the reasoning that decided it.
2. **The runner-up**, and what would flip the choice.
3. **Ordering consequences** — anything that becomes cheaper/more expensive by going this way.
4. **Anything you found that isn't tracked** — new issues worth opening, or corrections to the existing
   issues' assumptions (post them as issue comments only if genuinely useful; be frugal).
5. **Confidence + what you're unsure about.** Flag anything you couldn't verify rather than asserting it.

---

## Constraints

- **Evaluate, don't build.** No production code changes. Reading, booting, screenshotting, and running
  existing guards is expected and encouraged.
- **Verify claims against source.** This track has been bitten twice by plausible-but-false assumptions about
  shipped machinery (the flag path; the "capped" spawn zone). Read `placeParty`, `enterDeploy`,
  `createCampfire`, `driveSealFor`, `resolveRescues` yourself before reasoning about them.
- **Canon to read:** `decisions.md` **D118**, **D117**, D97/D99/D116 · `finale-design-checklist.md` ·
  `finale-extraction-viability.md` · `finale-A-spawn-wiring-kickoff.md` · issues **#207–#210** · `CLAUDE.md`.
- e2e/browser work needs `CHROME_BIN=/opt/pw-browsers/chromium`.
