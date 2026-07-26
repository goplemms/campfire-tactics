# Finale crux C2 — extraction viability (design note)

**Track:** finale design checklist, crux **C2**. Status: **design drafted 2026-07-26** (no code — the v4
finale isn't populated yet; this defines the contract + the guard that populating must satisfy).
Read with `finale-design-checklist.md`, `decisions.md` **D97/D99** (dual-OR / rescue / deferred flank),
**D117** (the now-built garrison door-drive doctrine this leans on), and the v4 layout in
`finale-storage-and-layout-handoff.md`.

---

## The problem

Extraction (escort every freed captive to an exit span) is the finale's **thematic heart** but a **dead
win-path**: the sim never takes it, because the full-board escort of a fragile group past a standing
garrison is too slow and too exposed — you always just eliminate-all instead. D99 designated **the flank**
as the fix. C2 is: *make extraction a real, chosen win — and prove it.*

## Reframe 1 — the flank does NOT shorten the escort

It's tempting to assume "deploy near the cells ⇒ shorter escort." **False**, and deliberately so: canon
keeps the cells **deepest, far from *both* mouths** (D97/D99 — moving cells near an exit re-arms the
challenge-F walkover). The infiltration spawn is the **east mouth → control-room hub**, which skips the
*garrison approach*; it does not put you next to the exit.

So the flank's real value is that it lets you run the **seal-and-run**: infiltrate the hub → reach the
cells → free them → **slam the barracks seals** (locking the garrison in the barracks, rows 9–15) →
escort the group across the *upper* region (rows 0–7) to the near mouth while the garrison batters
through. **Extraction viability therefore rests entirely on one inequality:**

> **seal-delay-budget ≥ escort-time**

## Reframe 2 — viability (can you) ≠ incentive (why would you)

Even a *viable* extraction stays unused if eliminate-all is simply the safer play — and note **both**
win-paths already "save" the captives (eliminate-all's label is literally *"the captives are safe"*). So
extraction needs a **strategic niche**: it must be the win available when clearing the garrison is *too
costly*. That means the garrison must be tuned **genuinely threatening to eliminate** — outnumbering /
attrition-heavy — so "sneak them out behind a sealed door" is the *smart* play, not a stylistic flourish.
**Viability is necessary; a costly-enough garrison is what makes it chosen.** Both must be tuned together.

---

## The viability inequality (the design contract)

Define, for the shipped v4 finale:

- **escort-time (turns)** ≈ `corridorLen / slowestEscortMove` + `freeCellsTurns`.
  Slowest escortee dominates: today's captives are `moveRange` **3–4** (Bram the heavy-knight = **3**,
  `speed` 9). Freed captives are `side:"player"`, uncaptured ⇒ **player-controlled** (escort pace is the
  player's, not AI RNG). A cells→near-mouth corridor of ~15 tiles at move 3 ≈ **5 turns**, +1–2 to free
  and marshal ⇒ **~6–7 turns** to budget for.
- **seal-delay-budget (turns)** ≈ `Σ sealHp / garrisonBatterThroughput`, where throughput ≈
  `(guards in batter range) × (per-hit damage)`. Garrison units hit for **8–12** (thug 8, cutthroat/brute
  9, captain 12). Multiple seals **in series** add turns only if the garrison can't split across them.

### Worked example — why the seals must be ~10× the micro-fixture HP

Every destructible seal shipped so far is a **2-hit micro-puzzle**: `hp: 15–20` (`scenarios/micro.ts`).
Against a garrison of ~3 guards at ~9 damage = **~27/turn**, a 20-hp seal is gone in **one turn** — zero
delay. For a seal to hold a ~6-turn escort against that throughput you need:

```
sealHp ≥ escortTurns × guards × perHit  ≈  6 × 3 × 9  ≈  ~160 hp
```

That's **an order of magnitude above** the existing doors — the concrete shape of D105's parked
"untuned HP-vs-garrison." Levers that trade against raw HP: **fewer guards reach the seal** (chokepoint
geometry), **two seals in series** (halve the required HP each *if* the garrison can't spread), or a
**slower/weaker batter** (but garrison strength is pinned by Reframe 2 — don't weaken it here).

---

## The load-bearing geometry invariant (or the delay is fake)

The D117 door-drive doctrine only produces a delay if the seal **genuinely walls the garrison off** from
the escort route. A `garrison && !in-combat` unit drives to *and batters* a seal **only when it's walled
off from every seen foe / the seal is the route**. If **any** unsealed path exists from the barracks to
the escort corridor, the garrison **paths around and never batters** — the seal-delay evaporates and the
escort is caught. So:

> **Invariant:** while the barracks seals are shut, there must be **no** terrain path from a garrison
> unit to any escortee except *through* a destructible seal.

This is now **checkable** (the doctrine ships): a headless test can assert that, with the seals shut, the
garrison's reachable set excludes the escort corridor. It's also why the escort must commit to **one**
sealed corridor (e.g. the east mouth), not wander — a second open mouth is a second hole to seal.

---

## The proof / guard design (what "C2 done" means)

The sim **cannot** prove this — the naive bot skips the deploy phase and every interactive screen, so it
never chooses the flank spawn nor drives an escort. C2 needs three guards, modelled on the patterns D117
just shipped (`scenarios/doctrine-harness.ts`, the free-casualty-ceiling headless test):

1. **Scripted extraction scenario** (headless, deterministic) — flank-deploy the party, free the cells,
   slam the seals, escort to the mouth; **assert win-by-extraction** with the garrison still alive
   (proves the *distinct* win, not eliminate-all in disguise) **within the escort-turn budget**.
2. **Pacing assertion** — encode the inequality directly: `escortTurns(corridorLen, slowestMove) ≤
   sealDelayTurns(Σ sealHp, garrisonThroughput)`. Make it **mutation-robust** (à la the ceiling test:
   halving a seal's HP must flip it red), so a later tuning change that breaks viability fails loudly.
3. **Geometry-invariant test** — with the seals shut, the garrison's terrain-reachable set **excludes**
   every escortee tile (no path around). Guards the invariant above.

A **visual e2e** rides on the finale's flank-deploy surface (checklist A5) — the seal-and-run is a new
player-facing surface, so per the freeze-catcher doctrine it needs a render walk; the *numeric* viability
stays in the headless pacing test (reserve the browser for what only a render catches).

---

## Open owner decisions (before populating)

1. **One seal or two in series?** Two halves the per-seal HP but needs geometry where the garrison can't
   split across them. One big seal is simpler to reason about.
2. **Which mouth is the extraction target on the flank run** — the east mouth (back out the way you
   infiltrated, shortest sealed corridor) is the natural read. Confirm the frontal path's extraction is
   *allowed but not the intended* extraction route (it's the eliminate-all texture).
3. **Garrison strength target** (Reframe 2) — how costly should eliminate-all be, so extraction earns its
   niche? This is the number that makes the whole win-path *chosen*, not merely *possible*.
4. **Escort pace** — accept the current `moveRange` 3 heavy-knight as the escort floor, or give captives a
   freed-and-fleeing move bump? (A bump shortens escort-time, easing the seal-HP requirement.)

---

## One-line status for the checklist

C2 **design drafted**: viability = `seal-delay ≥ escort-time` over a fully-sealed corridor, with a
costly-enough garrison to make extraction *chosen*; guarded by a scripted scenario + a mutation-robust
pacing assertion + a geometry-invariant test. Seal HP must land ~150+ (not the 15–20 micro default).
Numbers pin when the v4 finale is populated (checklist B).
