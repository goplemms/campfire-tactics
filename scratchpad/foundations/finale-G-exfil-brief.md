# Build brief — exfil semantics, the "Go now" call, and the left-behind consequence

**Track:** the finale (The Rescue). Implements checklist group **G** — issue **#208**.
**Canon you must read before starting:** `decisions.md` **D120** (this brief's design, in full — it carries
the verified findings and the traps), **D118** (the finale design; it required D120 to exist), **D97**
(dual-OR + `extraction`), **D9/D12** (capture, rescue quests), **D21** (field-control auto-rescue — the
clause you are narrowing), **D51** (the retreat path), **D52** (run flags, authored captives), **D119** +
`scratchpad/foundations/finale-A-deploy-zones-brief.md` (the split-deploy work that just landed), **D114** +
`docs/design/implementation/conventions.md`.
**Working checklist:** `finale-design-checklist.md` group **G**.

> ⚠️ **This is the riskiest change on the finale track.** It alters **shipped resolution semantics for
> every encounter**, not just this one. Read the blast-radius section before you touch anything.
> Every code claim below was verified against source on 2026-07-28 — **re-verify anything you build on,
> and if a claim here is wrong, say so rather than routing around it.**

---

## Why this exists (the player-facing problem)

The finale can be won by sneaking three prisoners out. The player should be able to call **"go now"** —
leave early and deliberately, accepting that whoever isn't out doesn't come home. That choice is the
emotional core of the mission.

**Today it has no teeth, in three separate ways.** The mission declares victory the instant the prisoners
reach an exit, even with half your party still crossing the corridor. Someone left behind simply walks home
afterwards. And a prisoner still locked in a cell **joins your party anyway** when you win.

---

## What to build

### G1 — Broaden the extraction met-condition

Verified: `objectives.ts` `extraction` is met when every unit matching `spec.escort` (the prisoners) is
`alive && !captured && onExit`. **The surviving party is not considered**, so the mission resolves out from
under a party still crossing.

Broaden to **captives + surviving party**.

### G2 — The "Go now" call

A player-invoked control that **resolves extraction on demand**. On-exfil units escape; off-exfil units are
left behind. The outcome is computed from what is true at the call:

- captives out ⇒ **extraction win**
- else ⇒ **survivable retreat** (`objective-failure`, `EncounterResult` in `authored.ts:351`) — this
  unifies "Go now" with the existing retreat concept rather than inventing a fourth outcome.

Surface it as a **turn-control**, the way `startBattle` sits in the deploy phase's control box — not among
a unit's verbs. It is a phase-level commitment, not an action.

### G3 — The left-behind consequence — **TWO populations, TWO code paths**

**This is where the tracking was wrong, and where a half-fix is the likely failure mode. Read D120.**

**(a) Party units.** `resolveRescues` (`runloop.ts:646`) opens `if (!u.captured) continue` over
`this.combatants`, so an off-exfil **survivor** is untouched and comes home. Extraction resolution must
**mark off-exfil survivors as captured** — that does not exist today.

**(b) The same function's `won` branch `freeCaptive`s every captured unit** (D21, control-the-field). **An
extraction win is a flight, not a field hold**, so that auto-free must be **gated on field control**,
routing left-behind through `resolveCaptured` instead.

**(c) Captives — NOT covered by (a) or (b), and currently worse than untouched.** Captives are staged in
the battle but **never in `combatants`/the roster**, so `resolveRescues` cannot see them. Their one seam is
`resolveCaptiveRecruits` (`runloop.ts:686`), which:

1. **recruits every declared captive unconditionally** — it never reads position, `alive`, or `captured`
   ("regardless of whether it was freed mid-fight or even downed after"). So an extraction win currently
   brings home a prisoner **still locked in a cell**;
2. is **win-gated** (`if (!won || …) return`), so on the survivable retreat G2 produces, **no captive is
   recruited and no rescue quest is mounted** — they vanish from the run.

Both need fixing: captive recruitment must be **computed from board position**, and a left-behind captive
must route to a **rescue-quest record on both a win and a survivable retreat**.

> **Point 2 was predicted in-repo.** `resolveCaptiveRecruits`' own *"Seam limitation (reuse note)"* says the
> win-gating is sound only for **win-or-wipe** encounters, that a captive in an **objective-failure-capable**
> node "would currently vanish on a survivable loss", and *"Extend this (a captive → rescue-quest fallback)
> before standing a captive up in such a node."* **G2 makes The Rescue exactly that node.** Delete or update
> that note when you close it.

### G3b — The record: extend what exists, invent nothing

**Do NOT add a new flag namespace.** `RescueQuest` (`mortality.ts:181`) is already
`{ unitId, resolution, nights, deploymentPenalty }`, produced by `resolveCaptured`, accumulated on
**`run.rescueQuests`** (`run.ts:144`) — a record whose stated purpose is that an abandonment is never
silently lost. **It already names the unit.** Extend it to cover captives.

- **Leave it inert.** Nothing generates a retrieval node from it. A branching "go back for them" encounter
  is the eventual design and is **explicitly out of scope** (owner).
- **Run-level only** (owner). `run.rescueQuests` is run-scoped. **Shape the record so promoting it to the
  guild tier later is a move, not a rewrite** — but do not build guild-tier persistence, and do not touch
  the unsettled save model (#117).

### G4 — Visual e2e (mandatory)

A new player-facing surface: the **"Go now" control** and the **left-behind result screen**.

### G6 — Extraction `span` = union of all mouth tiles

✅ **Already done** — verified in `the-rescue.json`: the span is 6 tiles covering both the east and bottom
mouths. Confirm, don't rebuild.

---

## ⚠️ Blast radius — the regression guard is not optional

Gating the auto-free on field control changes how wins resolve for **every** encounter that can leave
captured units. **An eliminate-all win must still auto-rescue exactly as it does today.**

Write that regression guard **first**, before you change the resolution path, and make sure it is red for
the right reason if you break it. E1's Cook (the captive-recruit path) is the canonical existing consumer —
an encounter with **no** exfil objective must be **byte-identical** in behaviour after this change.

---

## Guards — all green, plus what this owes

```
npm run build · npm test · npm run sim · npm run test:e2e
npm run test:e2e:scenario · npm run test:e2e:arc · npm run test:e2e:rescue
npm run audit:visual · npm run audit:challenge
```

**Specifically owed:**

- 🚨 **Visual e2e — MANDATORY.** Per `CLAUDE.md`, the core suite and the sim never render a scene and the
  sim's bot skips every interactive screen, so a render crash reads as a **freeze**, not a stack trace
  (the D92/#168 cautionary tale). Cover the **"Go now" control** and the **left-behind result screen**.
  Extend `scripts/e2e-rescue.mjs`. **Address units by tile lookup, never by pixel** (`BoardCamera` adoption
  is queued and will move pixels again — D100).
- Extraction does **not** auto-resolve while a party unit is off-exfil; **does** when everyone is on.
- "Go now" leaves off-exfil units behind — **party and captives alike**.
- A left-behind **party** unit ends up captured and **NOT** auto-freed.
- A left-behind **captive** is **not recruited**, on a **win** *and* on a survivable retreat, and produces
  a rescue-quest record naming them in both cases.
- "Go now" **without** captives out yields a **survivable retreat**, not a win.
- 🚨 **Regression: eliminate-all wins still auto-rescue as before**, and an encounter with no exfil
  objective is unchanged.
- `npm run sim` — the digest **may** move here (resolution semantics change). **If it moves, review the
  diff deliberately and report what changed and why before re-pinning.** Do not accept it blind.

---

## Out of scope — do not absorb

- **The retrieval node** — a branching encounter to go back for a captured unit. Owner: explicitly later.
- **Guild-tier persistence** and the save model (**#117**).
- **The C2 guards** (#209) — the split-force scenario, the pacing bar, the geometry invariants.
- **F / arc promotion** (#210), the map expansion, battle-side `BoardCamera` adoption, balance tuning.
- **Re-anchoring the deploy net** (deferred, D119).

---

## Working agreement

- **Plan first**, then **red-team** the resolution-semantics change before building
  (`memento:decision-adversary`, or the `memento:challenge` skill — verify which exists in
  `.claude/agents/` rather than assuming).
- **Do NOT commit or push.** Report your changes; the main session commits (subagent commits are unsigned).
- **Report honestly**: what you built, the **actual** output of every guard, anything you could not verify,
  and anything that turned out differently from this brief. **A brief claim you found to be wrong is worth
  more than a clean report.**
- **Do not expand scope.** If the work needs more than agreed, **surface it as a decision** rather than
  absorbing it.
