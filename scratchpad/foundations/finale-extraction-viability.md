# Finale crux C2 — extraction viability (design note)

**Track:** finale design checklist, crux **C2**. Status: **design drafted 2026-07-26**, model corrected to
the owner's split-force intent (no code — the v4 finale isn't populated yet; this defines the contract +
the guard that populating must satisfy). Read with `finale-design-checklist.md`, `decisions.md`
**D97/D99** (dual-OR / rescue / deferred flank), **D117** (the now-built garrison door-drive doctrine this
leans on), **D103–D107** (levers/seals), and the v4 layout in `finale-storage-and-layout-handoff.md`.

---

## The problem

Extraction (escort every freed captive to an exit span) is the finale's **thematic heart** but a **dead
win-path**: the sim never takes it, because escorting a fragile group past a standing garrison is too slow
and exposed — you always just eliminate-all. D99 designated **the flank** as the fix. C2 is: *make
extraction a real, chosen win — and prove it.*

## The intended play (the canonical solution the finale is authored around)

Extraction is a **two-party, split-force operation** — this is the owner's design intent:

1. **Split deployment.** The **bulk** of the fighting force deploys at the **main entrance**; the
   **infiltrator** party enters through the **side entrance** (the deploy zone unlocked by the side-door
   intel — checklist A).
2. **Slam the seal.** On the infiltrator's first turn they **rush a lever** that toggles a destructible
   **seal**, walling the garrison off the infiltration route.
3. **The garrison rushes the seal to batter it down** (the shipped D117 door-drive doctrine — a
   `garrison && !in-combat` unit drives to and batters the seal in its way).
4. **Distract.** The front party engages the **Warden + some guards**, pinning a slice of the garrison
   (`in-combat` → they stop driving/pursuing and fight).
5. **The sealed door buys the head start** — while the garrison batters, the infiltrator reaches the cells
   and **frees the prisoners**.
6. **Run.** The garrison **breaks through — this is expected, not a failure** — and pursues; the freed
   prisoners make for the **infiltrator's (side) spawn**, the escort party fighting a **running rearguard
   ("pot shots")** to stay ahead.
7. **Win** when every captive reaches the side-spawn exit span.

## Two reframes (what this note corrects)

**Reframe 1 — the flank is *safer, not faster*, and it's a SECOND deploy zone, not a swap.** Cells stay
canon-far from both mouths (D97/D99 — no walkover), so infiltration does **not** shorten the escort. Its
value is (a) reaching the cells **without fighting through the garrison** (a time/safety advantage → a
head start when pursuit begins) and (b) enabling the **split-force** op. The intel therefore unlocks the
side entrance as an **additional** deploy zone the player splits their force across — **not** an all-in
alternate spawn. *No intel ⇒ no side deploy ⇒ the two-pronged play is impossible ⇒ extraction is
impractical ⇒ you take eliminate-all.* That is the graceful degradation **and** the incentive, in one.

**Reframe 2 — it's a head-start foot-race with a rearguard, NOT a seal-hold timer.** The seal does **not**
need to hold for the whole escort; it needs to buy a **head start**, then the escort **outruns the thinned
pursuit** while taking pot shots. The door breaking mid-escape is **designed in**. (Earlier draft framed
this as `seal-delay ≥ escort-time` with ~150-hp seals — that over-estimated the seal by ~2–3×; see below.)

---

## The corrected viability model

> **Extraction succeeds when:** `head-start` (seal-delay + the turns the garrison spends oriented on the
> distraction) is large enough that the escort, fighting a **running rearguard through a chokepointed
> corridor**, reaches the side spawn before the **thinned, pursuing** garrison closes the gap.

Three levers, all now backed by shipped mechanics:

- **Head start** = `sealDelayTurns` + `distractionTurns`. `sealDelayTurns ≈ sealHp / garrisonBatterThroughput`
  (throughput ≈ guards-in-batter-range × per-hit 8–12). Needs only ~**2–3 turns** (generate a lead), so
  `sealHp ≈ 2.5 × ~27 ≈ ~60–70 hp` — **3–4× the 15–20 micro-fixture default, not 10×.** The distraction
  adds turns by pulling the Warden + guards into `in-combat` at the front (they stop pursuing).
- **Thinned pursuit.** Every garrison unit the front party pins (`in-combat`) or the escort's rearguard
  bodies at a chokepoint is one fewer chasing the captives. **Pinning costs your bodies** — the D117
  tension. Captives are `non-combatant` (R3) → they never pin their own pursuers, so **only real
  combatants screen**; the captives just run.
- **Corridor + rearguard, not open field.** Captives (`moveRange` 3–4, Bram = 3) are **slower** than fast
  pursuers (cutthroat 5/spd 13, warg 5/spd 14): in the open a warg closes ~2 tiles/turn and a head start
  evaporates. So the escort route must be a **corridor with chokepoints** where **one rearguard fighter
  body-blocks/pot-shots** the pursuit line. That geometry — not a captive speed bump — is what makes
  "outrun while taking pot shots" hold. (A **freed-and-fleeing move bump** stays the **reserve lever** if
  playtests run tight.)

## The two geometry invariants (or the play collapses)

1. **Head-start phase — the seal fully walls the garrison off (while shut).** The D117 doctrine only
   *batters* when the seal is genuinely the route; if any open path exists from the barracks to the
   infiltration route, the garrison **paths around and never batters** → no head start. Checkable: with the
   seal shut, the garrison's terrain-reachable set excludes the infiltrator/cell area.
2. **Outrun phase — the escort corridor is chokepointed.** The route cells→side-spawn must have
   choke tiles where a single rearguard holds the pursuit line, so the whole remnant can't fan out and
   swarm the slow captives in the open. This is the concentric prison's corridors-between-rings doing work.

---

## Exfil semantics + the "Go now" call (owner-directed, 2026-07-26)

**Intent:** *everyone* comes home — captives **and** party. A unit **survives only if it is standing on an
exfil site** when the extraction resolves. Losing someone is an **allowed consequence**, not a design
failure; an appropriately-levelled party should have enough leeway to get everyone out. And the player
needs a **"Go now"** call for when they judge someone won't make it and accept the sacrifice.

### The rule
- **Auto-resolve** when *everyone* — all captives **and** all surviving party units — is on an exfil site.
  (No button-press tedium in the clean case; there's nothing left to wait for.)
- **"Go now"** resolves the extraction **early, on demand**. Whoever is on an exfil site escapes; **whoever
  is not is left behind**.
- **The outcome is computed from what's true at the call:** all captives on exfil ⇒ **extraction win**;
  otherwise ⇒ a **survivable retreat** (`objective-failure` — the party retreats alive, `runloop.ts:485`).
  This unifies "Go now" with the existing retreat concept: *you called the exfil; whoever's on the pad
  leaves.* One rule, taught once, applies in both cases.

### Two required changes (both are real, both are load-bearing)

1. **Extraction must stop auto-completing on captives-alone.** Today `objectives.ts` marks it **met** the
   moment every tagged escortee stands on the span — which would resolve the mission out from under a party
   still crossing the corridor, silently stranding them. The met-condition must broaden to **captives +
   surviving party**, with "Go now" as the deliberate early exit.
2. **D21's win-auto-rescue must be gated on *field control*, not on `win`.** Today a **win** auto-rescues
   captured allies ("control the field ⇒ your bound people come home"; capture consequences fire "only on a
   non-win/abandon outcome" — `mortality.ts:193`). But an **extraction win is a flight, not a field
   hold** — you do *not* control the prison. If the extraction win keeps the generic auto-rescue, everyone
   you left behind is handed back for free and **"Go now" becomes toothless**. Fix: the auto-rescue is an
   **eliminate-all (field-control) property**; an extraction resolution routes its left-behind units through
   the normal capture path instead.

### What "left behind" costs
Route it through the **shipped** consequence machinery — a left-behind unit is **captured** (D9/D12), which
per difficulty becomes a **rescue follow-up quest** or roster removal (`mortality.resolveCaptured`,
`run.ts:141/380` — "abandoned-captured units leave the roster"). This is thematically perfect: **you left
someone in a prison, so they become a prisoner** — and it's already built, no new consequence system.

### Why this is good design (the trade it creates)
It gives the two OR'd wins genuinely different shapes rather than different flavours:
- **eliminate-all** — higher *risk* (fight the whole garrison), but you hold the field: no one is left
  behind, captured allies come home.
- **extraction** — lower *risk* (skip the garrison), but carries a *cost decision*: the clock of the
  closing pursuit versus your slowest body. **"Go now" is where that cost gets paid**, deliberately, by the
  player's own hand.

That's the tension the finale wants: not "which button wins" but "what am I willing to spend."

---

## The proof / guard design (what "C2 done" means)

The sim **cannot** prove this — the naive bot skips the deploy phase and every interactive screen, so it
never splits the deploy, slams the lever, nor drives an escort. C2 needs a scripted proof, modelled on
D117's shipped patterns (`scenarios/doctrine-harness.ts`, the free-casualty-ceiling headless test):

1. **Scripted split-force scenario** (headless, deterministic) — deploy front + side, infiltrator slams
   the lever, front party pins the Warden + some guards, escort runs the corridor; **assert
   win-by-extraction with the garrison still alive** (proves the *distinct* win, not eliminate-all in
   disguise), all captives reaching the side span.
2. **The leeway bar (the pacing assertion)** — the bar is **everyone out, not just the captives**: a
   *reference appropriately-levelled party* gets **all captives AND all party units** onto exfil sites and
   wins with **zero left behind**. That is the owner's "enough leeway" target expressed as a test.
   **Mutation-robust — these must flip it red:** halving `sealHp` (kills the head start); *removing the
   distraction pin* (the full garrison chases); *widening the corridor* past the chokepoint (the swarm gets
   through). If any one of those doesn't break it, the guard is vacuous.
3. **Geometry-invariant tests** — (a) seal shut ⇒ garrison can't reach the infiltrator/cells; (b) the
   escort corridor has the chokepoint(s) the rearguard needs.
4. **Exfil-semantics tests** (the new rule, per above) — extraction does **not** auto-resolve while a party
   unit is still off-exfil; auto-resolves when everyone is on; **"Go now"** resolves early and **leaves
   off-exfil units behind**; a left-behind unit lands in the **captured** path (**not** auto-rescued — the
   D21 gate); and a "Go now" with captives *not* out yields a **survivable retreat**, not a win.

A **visual e2e** rides the finale's split-deploy + escape surface (checklist A5 — a new player-facing
surface, freeze-catcher doctrine); the *numeric* race stays in the headless pacing test.

---

## Open owner decisions (before populating — checklist B)

1. ~~Does the front/distraction party also need to exit?~~ **ANSWERED (2026-07-26):** yes — *everyone*
   must reach an exfil site to survive; see "Exfil semantics + the Go now call" above. **Follow-on:** does
   the **front/distraction party** exfil through the **side** mouth too (they must disengage and cross the
   board — hard, and the pursuit is on them), or does the **main entrance double as a second exfil site**
   (they fall back the way they came)? A second exfil site is the more forgiving read and better matches
   "an appropriately-levelled party gets everyone out"; one shared exfil makes the finale much harsher.
2. **One seal (the lever-slam) or seals in series?** One is simpler to reason about; series stacks the head
   start but needs geometry where the garrison can't spread across them.
3. **Lever placement** — reachable by the infiltrator on **turn 1** from the side spawn (the whole play
   keys off this tempo).
4. **Escort-route chokepoint geometry** — the corridor's choke tiles (the outrun-phase invariant).
5. **Garrison strength** — costly enough to clear that the sneak-out is the *smart* play (Reframe 2's
   incentive), while still beatable frontally (eliminate-all stays a real win).

---

## One-line status for the checklist

C2 **design drafted (split-force model)**: extraction is a two-party op — front distraction pins garrison,
infiltrator (a second, intel-unlocked deploy zone) slams a lever-seal for a **head start**, then the escort
**outruns the thinned pursuit through a chokepointed corridor** taking pot shots. Viability = head-start ≥
pursuit-close-time, *not* a seal-hold; seals need ~60–70 hp (not 150). **Exfil rule:** a unit survives only
if it's on an exfil site when extraction resolves — auto-resolve when everyone's out, **"Go now"** to
resolve early and leave stragglers (→ captured, *not* auto-rescued: D21's auto-rescue must be re-gated on
**field control**, else the sacrifice is free). Guarded by a scripted split-force scenario + an
**everyone-out** mutation-robust pacing bar + two geometry-invariant tests + the exfil-semantics tests.
Numbers pin when B populates.
