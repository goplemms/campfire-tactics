# Finale crux C2 — extraction viability (design note)

**Track:** finale design checklist, crux **C2**. Status: **design drafted 2026-07-26** (split-force model;
corrected after a `/code-review` pass verified every claim against the code). No production code changed —
the v4 finale isn't populated yet; this defines the contract + the guards populating must satisfy.
Read with `finale-design-checklist.md`, `decisions.md` **D97/D99** (dual-OR / rescue / deferred flank),
**D117** (the shipped garrison door-drive doctrine this leans on), **D103–D107** (levers/seals), and the
v4 layout in `finale-storage-and-layout-handoff.md`.

---

## The problem

Extraction (escort every freed captive out) is the finale's **thematic heart** but a **dead win-path**: the
sim never takes it, because escorting a fragile group past a standing garrison is too slow and exposed —
you always just eliminate-all. D99 designated **the flank** as the fix. C2 is: *make extraction a real,
chosen win — and prove it.*

## The intended play (the canonical solution the finale is authored around)

Extraction is a **two-party, split-force operation** — the owner's design intent:

1. **Split deployment.** The **bulk** deploys at the **main entrance**; the **infiltrator** enters through
   the **side entrance** (the deploy zone unlocked by the side-door intel — checklist A).
2. **Slam the seal.** On the infiltrator's first turn they **rush a lever** toggling a destructible
   **seal**, walling the garrison off the infiltration route.
3. **The garrison drives at the seal to batter it** (the shipped D117 doctrine — a `garrison && !in-combat`
   unit drives to a seal it can open).
4. **Distract.** The front party engages the **Warden + some guards**, pinning a slice of the garrison
   (`in-combat` ⇒ they stop driving and fight).
5. **The seal buys the head start** — the infiltrator reaches the cells and **frees the prisoners**.
6. **Run.** The garrison **breaks through — expected, not a failure** — and pursues; the freed prisoners
   make for an exit while the escort fights a **running rearguard ("pot shots")** to stay ahead.
7. **Win** when every captive is on an **exfil site** (any mouth — see below).

## Two reframes

**Reframe 1 — the flank is *safer, not faster*, and it's a SECOND deploy zone, not a swap.** Cells stay
canon-far from every mouth (D97/D99 — no walkover), so infiltration does **not** shorten the escort. Its
value is (a) reaching the cells **without fighting through the garrison**, and (b) enabling the
**split-force** op. *No intel ⇒ no side deploy ⇒ no two-pronged play ⇒ extraction impractical ⇒ you take
eliminate-all.* That is the graceful degradation **and** the incentive, in one.

**Reframe 2 — a head-start foot-race with a rearguard, NOT a seal-hold timer.** The seal needn't hold the
whole escort; it buys a **head start**, then the escort **outruns the thinned pursuit**. The door breaking
mid-escape is **designed in**. (This corrects an earlier draft that sized seals to hold the full escort.)

---

## The corrected viability model

> **Extraction succeeds when** `head-start` (seal-delay + turns the garrison spends oriented on the
> distraction) is large enough that the escort, fighting a **running rearguard through a chokepointed
> corridor**, reaches an exfil site before the **thinned** pursuit closes.

- **Head start** = `sealDelayTurns + distractionTurns`. `sealDelayTurns ≈ sealHp / batterThroughput`
  (throughput ≈ guards-in-range × per-hit **8–12**: thug 8, cutthroat/brute 9, captain 12). Needs only
  ~**2–3 turns**, so `sealHp ≈ 2.5 × ~27 ≈ **60–70 hp**` — **3–4×** the 15–20 micro-fixture default
  (`scenarios/micro.ts`), not 10×.
- **Thinned pursuit.** Every guard the front party pins (`in-combat`) or the rearguard blocks is one fewer
  chasing captives. **Pinning costs bodies** — the D117 tension.
- **Corridor + rearguard, not open field.** Captives (`moveRange` **3–4**; Bram = 3) are **slower** than
  fast pursuers (cutthroat 5/spd 13, warg 5/spd 14): in the open a head start evaporates. The escort route
  must be **chokepointed** so one rearguard fighter holds the pursuit line. That geometry — not a captive
  speed bump — makes "outrun while taking pot shots" hold. (A **freed-and-fleeing move bump** stays the
  **reserve lever** if playtests run tight.)

⚠️ **`non-combatant` on captives is load-bearing and NOT yet authored.** The pursuit model assumes captives
carry the intrinsic `non-combatant` tag (D117): by **R3** they never confer `in-combat`, so they can't
self-screen — only real combatants pin. `the-rescue.json` does **not** tag them today. Tagging is checklist
**B7**; without it the model's target-priority and pinning behaviour differ from what's specified here.

---

## The two geometry invariants (or the play collapses)

**1. Head-start phase — the seal must be the garrison's *only* route, and the ONLY thing it can open.**
Two distinct hazards, both verified in `ai.ts`:
- *Path-around:* if any open path exists from the barracks to the infiltration route, the garrison walks
  around and never batters ⇒ no head start.
- *Wrong-seal drive (the sharper one):* `driveSealFor` selects the **nearest** gate the unit can open
  (`keyholderOf(g, unit) || isBreakable(g)`, filtered only for a terrain-reachable opening tile, **sorted
  by manhattan distance**) — there is **no route-relevance check**. This is D117's **F2** authoring
  contract stated as a live hazard: **a Warden who is keyholder of the *cell doors* will drive over and
  open the cells for you.** Authoring rule: in a garrison encounter the *only* garrison-openable gates are
  the intended seals — the cell locks must **not** be openable by any `garrison` unit (use lockpick, or a
  keyholder tag no garrison unit carries).

**2. Outrun phase — the escort route is chokepointed.** Since **all mouths are exfil**, the escort picks
among routes; the chokepoint requirement applies to **the routes actually competitive from the cells**, not
one authored corridor. An unchokepointed but plainly shorter alternate would quietly become *the* route and
void the invariant.

---

## Exfil semantics + the "Go now" call (owner-directed, 2026-07-26)

**Intent:** *everyone* comes home — captives **and** party. A unit **survives only if it is on an exfil
site** when extraction resolves. Losing someone is an **allowed consequence**, not a design failure; an
appropriately-levelled party should have leeway to get everyone out. The player needs a **"Go now"** call
for when they judge someone won't make it and accept the sacrifice.

### Exfil sites — every mouth counts
All exits simply represent **"away"**: a unit is safe on **any** mouth.
- **Authoring:** the extraction `span` is the **union of every mouth's tiles** (east rows 4–6, bottom
  cols 8–10, …) — not the single left-edge span `the-rescue.json` carries today.
- **The distraction party falls back out the main entrance** — no board-crossing, which is what makes
  "an appropriately-levelled party gets everyone out" realistic.
- **No walkover risk** (D97 challenge-F): cells stay deep and far from *every* mouth.

### The rule
- **Auto-resolve** when *everyone* — all captives **and** all surviving party units — is on an exfil site.
- **"Go now"** resolves early on demand: whoever is on an exfil site escapes; **whoever is not is left
  behind**.
- **Outcome computed from what's true at the call:** all captives on exfil ⇒ **extraction win**; otherwise
  ⇒ a **survivable retreat** (`objective-failure` — the party retreats alive, `runloop.ts:485`). One rule
  covers both "we did it, leave Bram" and "this went wrong, get out."

### Three required changes (all verified against the code)

1. **Extraction must stop auto-completing on captives-alone.** `objectives.ts` marks it **met** the moment
   every tagged escortee stands on the span — which would resolve the mission out from under a party still
   crossing, silently stranding them. Broaden the met-condition to **captives + surviving party**, with
   "Go now" as the deliberate early exit.
2. **Nothing marks left-behind units as lost — that machinery must be written.** *(Corrects an earlier
   draft that claimed they'd be "auto-rescued".)* `resolveRescues` (`runloop.ts:642–658`) opens with
   `if (!u.captured) continue` — a survivor merely standing off-exfil is **untouched** and simply comes
   home, because a win means the party retreats alive. So the extraction resolution must **mark off-exfil
   survivors as captured** (the left-behind consequence) — that step does not exist today.
3. **…and once marked, the win branch would immediately free them.** In the same function, `won` ⇒
   `freeCaptive(u)` for every captured unit — D21's "control the field ⇒ your people come home". An
   **extraction win is a flight, not a field hold**, so it must **not** take that branch: gate the
   auto-free on **field control** (eliminate-all), routing an extraction win's left-behind through
   `resolveCaptured` (rescue follow-up quest / roster removal per D9) instead. Without both (2) and (3),
   **"Go now" is toothless**.

### What "left behind" costs
The **captured** path (D9/D12) — a rescue follow-up quest or roster removal (`mortality.resolveCaptured`,
`run.ts:141/380` "abandoned-captured units leave the roster"). Thematically exact: **you left someone in a
prison, so they become a prisoner** — and the consequence machinery already exists; only the *marking*
(change 2) and the *gate* (change 3) are new.

### Why this is good design
The two OR'd wins gain different **shapes**, not flavours:
- **eliminate-all** — higher *risk* (fight everyone), but you hold the field: nobody is left behind.
- **extraction** — lower risk, but carries a **cost decision**: the closing pursuit versus your slowest
  body. **"Go now" is where that cost gets paid**, by the player's own hand.

---

## The proof / guard design (what "C2 done" means)

The sim **cannot** prove this — the naive bot skips deploy and every interactive screen, so it never splits
the deploy, slams the lever, nor drives an escort. Modelled on D117's shipped patterns
(`scenarios/doctrine-harness.ts`, the free-casualty-ceiling test):

1. **Scripted split-force scenario** (headless, deterministic) — deploy front + side, infiltrator slams the
   lever, front party pins the Warden + guards, escort runs the corridor; **assert win-by-extraction with
   the garrison still alive** (the *distinct* win, not eliminate-all in disguise), every captive on a mouth.
2. **The leeway bar (pacing assertion)** — the bar is **everyone out, not just the captives**: a *reference
   appropriately-levelled party* gets **all captives AND all party units** onto exfil sites with **zero left
   behind**. The owner's "enough leeway" target, as a test. **Mutation-robust — these must flip it red:**
   halving `sealHp`; removing the distraction pin; widening the corridor past its chokepoint. If any one
   doesn't break it, the guard is vacuous.
3. **Geometry-invariant tests** — (a) seal shut ⇒ garrison can't reach the infiltrator/cells; (b) **no
   garrison unit can open any gate except the intended seal** (the `driveSealFor` hazard above); (c) the
   competitive escort routes carry the chokepoint(s).
4. **Exfil-semantics tests** — extraction does **not** auto-resolve while a party unit is off-exfil;
   auto-resolves when everyone is on; **"Go now"** resolves early and leaves off-exfil units behind; a
   left-behind unit ends up **captured and NOT auto-freed**; and a "Go now" without captives out yields a
   **survivable retreat**, not a win.

A **visual e2e** rides the split-deploy + escape surface (checklist A5 — a new player-facing surface,
freeze-catcher doctrine); the numeric race stays headless.

---

## Open owner decisions (before populating — checklist B)

1. ~~Does the distraction party also need to exit?~~ **ANSWERED:** yes — everyone must reach an exfil site,
   and **every mouth counts** (see above).
2. **One seal (the lever-slam) or seals in series?** One is simpler; series stacks the head start but needs
   geometry where the garrison can't spread across them.
3. **Lever placement** — reachable by the infiltrator on **turn 1** from the side spawn (the play's tempo
   keys off this).
4. **Escort-route chokepoint geometry** — the choke tiles for the outrun phase.
5. **Garrison strength** — costly enough to clear that the sneak-out is the *smart* play, while still
   beatable frontally (eliminate-all stays a real win).

---

## One-line status for the checklist

C2 **design drafted (split-force model)**: front distraction pins the garrison, the infiltrator (a second,
intel-unlocked deploy zone) slams a lever-seal for a **head start**, then the escort **outruns the thinned
pursuit through a chokepointed corridor**. Viability = head-start ≥ pursuit-close-time, *not* a seal-hold;
seals ~**60–70 hp**. **Exfil rule:** a unit survives only if on *any* mouth when extraction resolves —
auto-resolve when all are out, **"Go now"** to resolve early and leave stragglers (marking them captured
**and** gating D21's auto-free on field control — both are new work). Guarded by a scripted split-force
scenario + an **everyone-out** mutation-robust pacing bar + three geometry-invariant tests + the
exfil-semantics tests. Numbers pin when B populates.
