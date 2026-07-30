# Build brief — the playtest launcher (an editor tab), and a challenge pass over everything we just built

**Track:** dev tooling, owner-directed 2026-07-28. Serves the whole remaining demo phase, not just the finale.
**Supersedes:** `debug-goto-finale-brief.md` — that brief's party-kit and flag-control work is **absorbed
here**. Do not build from both; this is the one live home. (Delete or banner it as superseded when you land.)
**Canon:** **D112** (editor soft play + `RunHandoff.returnTo`), **D113** (editor local persistence), **D98**
(the `#editor` scene + DOM-panel idiom), **D109–D111** (editor layout + input QoL), **D119/D120** (what
shipped today), **D116** (authored-node injection, `#rescue`), **D114** +
`docs/design/implementation/conventions.md`.

---

## Why this exists (the owner's framing — keep it in view)

> *"What remains in the expedition demo is building and feeling out the entire run, and I suspect we'll
> really want to be able to test these without starting from scratch every time."*

The remaining work on the demo is **judgement work** — playing it, feeling the pacing, tuning numbers. That
is bottlenecked on *getting to the interesting state*, and today getting there means playing from the top.
This tool is on the critical path for that phase, not a detour from it.

**Second-time signal:** node jumping has now come up twice, and per-scenario boots have been built one at a
time. This consolidates the *human* path deliberately instead of adding a tenth one.

## ⚠️ Scope discipline — read before designing

**Launcher only.** In-play levers (heal / kill / give gold / reveal fog / move a unit mid-fight) are
**explicitly deferred** — the owner wants to use the launcher first and let real use reveal which levers are
actually wanted. Do not build them "while you're in there".

**Build the four levers we have PROVEN we need, not the ones we can imagine:**

1. **What to boot** — a draft, a shipped content level, or an expedition node.
2. **Which party** — a named kit (see below).
3. **Which run flags** — the thing that makes today's finale work reachable at all.
4. **Which seed.**

Each of those is a friction point actually hit this session. When a fifth appears, add it then — the same
concrete-first discipline the repo uses elsewhere (**#171** rev 2).

**Do NOT retire or replace the existing hash routes.** Verified: **11 of 13** `scripts/e2e-*.mjs` drive them
(`#scene=` ×15, `#editor` ×9, `#level=` ×7, `#demo` ×4, `#rescue` ×3, …). They are the **machine-facing**
interface — stable and scriptable, exactly what a headless browser wants. The launcher is the **human-facing**
front door that *composes* them. Different users; merging them would mean rewriting the test harness for zero
player-facing gain.

---

## Phase 1 — Challenge what we just built (do this FIRST, and report before building)

**The owner has explicitly asked for this.** You are the first fresh pair of eyes on a day's worth of design
and two merged builds. **Findings here are worth more than a clean implementation.**

This track has been bitten repeatedly by plausible-but-false assumptions about shipped machinery — twice
before today, and today's own sessions each found something the brief had got wrong (a third auto-free path
nobody had named; a "constant" risk figure that was only true early). **Assume this brief contains at least
one such error too.**

Targets, in priority order:

1. **D119/D120 as merged** (PR #214). Read `decisions.md` D119 + D120, then read the code. Does the design
   hold? Specifically worth attacking:
   - The **cohort snapshot at arm time** — is there any path where the set of who-must-get-out is wrong
     (a mid-battle recruit, a captive recruited in-fight, a unit that joins after arming)?
   - **`heldTheField`** — is it really definitionally identical to "eliminate-all met" in every encounter
     shape, or only in the ones we tested? The sim's unmoved digest rests on that claim.
   - The **left-behind record** — does it survive `snapshotRun`/repro round-trip? D120 accepted that it is
     discarded with the run, but *discarded* and *corrupts a dump* are different things.
   - **Authored spawn zones** — the danger override makes `safeGroundRemains` permanently true. Is
     `frontReachedPrimary` reachable in every zoned encounter, or can a phase hang with no way to end?
2. **The two briefs' claims** (`finale-A-deploy-zones-brief.md`, `finale-G-exfil-brief.md`) — spot-check the
   verified-claim lists. Anything wrong is a finding.
3. **This brief.** Everything below is stated from a partial reading. Challenge it.

Use the `memento:challenge` skill (verify what exists in `.claude/agents/` — a previous session found
`decision-adversary` absent under that name). **Trace against break-cases; do not re-walk the happy path.**

**Report your Phase-1 findings before starting Phase 2.** If something is seriously wrong, that changes what
gets built and the owner needs to decide, not you.

---

## Phase 2 — The launcher

### Where it lives

**A new tab in the existing editor** (owner's call). `TAB_NAMES` is
`["Terrain","Objects","Units","Events","Scenario"]` (`EditorScene.ts:29`) — add a sixth. The editor already
carries most of the scaffolding: a DOM panel idiom, a saved-draft library with local persistence (D113), a
party picker, and **soft play into the real `BattleScene` with a return** (D112 — `buildPlaytest(enc, party)`
→ `{ run, loop }` → `handoff = { run, loop, returnTo: "EditorScene" }`, `EditorScene.ts:860–876`).
`returnTo` is a **generic scene key**, so returning into the launcher tab works the same way.

⚠️ **The main design risk: the editor is DRAFT-shaped, the launcher is CONTENT-shaped.** The existing
playtest boots *the draft you are editing*. The launcher must boot **shipped content** and **expedition
nodes** too. **Do not overload the draft model to carry launch targets** — make the launcher a sibling
surface that can *target* the current draft as one option among several. If that turns out to fight the
editor's structure, **say so and propose the alternative rather than forcing it**.

### The four levers

- **Target** — the current draft · any `content/levels/` level · an expedition node (The Rescue's nodes at
  minimum; the Hollow Mill arc if it falls out cheaply — the existing `#debug` jump tool already samples
  Hollow Mill routes and **should not be duplicated**).
- **Party kit** — extend `PLAYTEST_PARTIES` (`src/game/playtest.ts`) so a kit declares more than a job list:
  **job levels** (`UnitSpec.jobLevels` already passes through `createUnit`, `units.ts:348`), **equipment**,
  and **stats** — today every body shares one flat `BASE` (`speed 11 / maxHp 26 / attack 8 / …`) with only
  the job varying, so nothing resembles a party that has crossed ten layers of an arc.
  - **Keep the five existing squads working unchanged** — the editor's soft play and `#level` playtests
    depend on them, and `Standard (3)` is asserted **by name** in `e2e-level`.
  - Preserve the registry's current property: *"add a squad by adding a key; the picker and the scenario
    both pick it up"*.
  - ⚠️ **The finale's own kits are NOT specified yet** — the owner is deciding the reference party
    separately. Build the **mechanism** and ship a sensible placeholder; do not invent canon.
  - ⚠️ **Composition constraint, verified:** only the **Thief** job carries `lockpick: true`
    (`jobs-data/scout-line.ts:176`), read off the unit's *effective primary* job — and the starting roster
    has **no thief** (Thief is a promotion inside the scout line). So any kit meant to exercise the finale's
    sneaking route needs a thief **and** enough bodies to also field a distraction.
- **Run flags** — the seam exists: `StageOptions.flags`, fed from `run.flags`, read by the `requiresFlag`
  zone filter (landed in D119). ⚠️ **The flag bag is untyped `Record<string, boolean>`, so a typo fails
  SILENTLY** — offer known flags as a choice rather than free text, and **fail loud** on an unknown one. A
  dev tool that silently boots the wrong state is worse than one that refuses.
- **Seed.**

### QoL that earns its place

Only what removes repeated friction: **remember the last launch** (the persistence layer already exists —
D113) and make **re-launch** one action, since the loop is *launch → play → tweak → relaunch*. Resist more.

---

## Guards

```
npm run build · npm test · npm run sim · npm run test:e2e
npm run test:e2e:scenario · npm run test:e2e:arc · npm run test:e2e:rescue · npm run test:e2e:level
npm run test:e2e:editor · npm run test:e2e:editor:playtest · npm run test:e2e:editor:persist
npm run audit:visual · npm run audit:challenge
```

**Specifically owed:**

- 🚨 **A visual e2e for the launcher — MANDATORY.** Per `CLAUDE.md`, the core suite and the sim never render
  a scene and the sim's bot skips deploy entirely, so a render crash reads as a **freeze**, not a stack
  trace (the D92/#168 tale). Prove: the tab renders, a launch boots the chosen target with the chosen kit,
  **the finale shows the side door when the intel flag is set and not when it isn't**, and the return lands
  back in the launcher with state intact. No page error on any path.
  ⚠️ **Address units and tiles by lookup, never by pixel** — the board zoom is already
  `min(BOARD_SCALE, fitBoardScale(...))` and `BoardCamera` adoption is queued (D100). The editor e2e had to
  make exactly this move.
- **Fail-loud + tested** on an unknown flag name, an unknown kit name, and an unlaunchable target.
- 🚨 **Regression: every existing route and all three editor e2e suites behave exactly as before.** This is
  the blast-radius guard — the editor has 97 + 19 + 18 assertions riding on its current behaviour.
- `npm run sim` **must stay byte-identical** (dev tooling; no routing, rewards, or RNG). **If it moves, stop
  and report** rather than re-pinning.

## Out of scope

In-play levers · retiring the hash routes · teaching `#debug` about The Rescue (blocked on **#210**) ·
deciding the finale's reference party · whether the sneaking route should require a Thief (a real design
question, flagged, owner's) · balance tuning · **#209**'s guards · arc promotion · the map expansion ·
`BoardCamera` adoption.

## Working agreement

- **Phase 1 before Phase 2**, and **report Phase-1 findings before building.**
- **Plan first.** The seams already exist; read them before designing.
- **Do NOT commit or push.** Report your changes; the main session commits.
- **Report honestly** — the actual output of every guard, anything you could not verify, and any claim in
  this brief you found to be wrong. **Disagree in the report rather than silently conforming**; a brief that
  turns out to be wrong is the most valuable thing you can hand back.
- **Surface scope growth as a decision.** Do not absorb it.
