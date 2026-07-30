> # ⚠️ SUPERSEDED (2026-07-28) — do not build from this file
>
> The owner ruled that per-scenario debug boots should stop being built one at a time. This brief's
> **flag control** and **party kit** work is **absorbed into**
> [`playtest-launcher-brief.md`](playtest-launcher-brief.md) — the launcher, hosted as an editor tab.
> **That is the one live home.** This file is kept only for the verified findings below (the existing-route
> survey, and the Thief/lockpick composition constraint), which the launcher brief cites.

# Build brief — the debug go-to: reach the finale's interesting states directly, with a kitted party

**Track:** dev tooling in service of the finale. No new gameplay rules.
**Canon:** `decisions.md` **D119** (authored spawn zones + the entrance action), **D120** (exfil + "Go now"),
**D116** (authored-node injection; the `#rescue` route), **D112** (editor soft-play + the party picker),
**D114** + `docs/design/implementation/conventions.md` (registry spelling, living exemplars).
**Related:** **#209** (the viability guards — see "Why this doubles as #209's fixture").

> Every code claim below was verified against source on 2026-07-28. **Re-verify anything you build on, and
> if a claim here is wrong, say so rather than routing around it.**

---

## Why this exists

The finale's split deploy and "Go now" call just shipped. **Neither is reachable from any direct jump**, and
the party you *can* boot with cannot exercise the sneaking route at all. So the fastest way to look at the
feature we just built is to play a whole expedition — which is exactly the friction a go-to tool exists to
remove.

## What exists today (verified — build on it, don't replace it)

The debug surface is already substantial. **Extend these seams; do not invent a parallel one.**

| Route | What it does | Gap for the finale |
|---|---|---|
| `#debug` | The jump tool: pick **any Hollow Mill node**, arrive in a plausible sampled state (`node`/`route`/`salt`/`into`) | **Hollow Mill only.** The Rescue is a separate expedition, so the finale is unreachable until arc promotion (#210) |
| `#rescue` | Boots The Rescue expedition from its start | Must play `sideDoor` then the finale — not a go-to |
| `#scene=<id>[?party=<name>]` | Stages an arbitrary authored encounter **run-less** | **Run-less ⇒ `run.flags` is empty ⇒ the side door never unions in** |
| `#level=<id>` | Plays a JSON content level standalone | Same: no flags. `e2e-level` now asserts this ("with no intel flag only the front-gate zone stages") |
| `#editor` → soft play | Playtests a draft in the real BattleScene, with a party picker | Same party limitation as below |

**The party limitation.** `PLAYTEST_PARTIES` (`src/game/playtest.ts`) is five named squads, but **every body
shares one flat stat block** — `BASE = { speed 11, maxHp 26, attack 8, defense 3, moveRange 4, sightRadius 5,
attackRange 1 }` — with only the **job** varying. **No job levels, no character levels, no equipment.** So
you cannot boot a party that resembles one which has actually crossed ten layers of an arc.

## What to build

### 1. Flag control on the run-less boots

Let `#scene=<id>` and `#level=<id>` set `run.flags`, so the finale's **both** states are directly reachable:
intel set ⇒ the side door zone unions in; intel unset ⇒ front gate only.

- The staging seam already exists — **`StageOptions.flags`**, fed from `run.flags` by `RunLoop.startEncounter`
  and read by the `requiresFlag` zone filter (landed with D119). This is a **boot-parameter** job, not new
  mechanism.
- ⚠️ **The flag bag is untyped `Record<string, boolean>`** — a spelling slip fails **silently**. Validate the
  requested flag names against something authoritative and **fail loud** on an unknown one, rather than
  quietly booting a run with a typo'd flag and a mysteriously absent side door. This is the single easiest way
  for the tool to lie to its user.

### 2. Declarable party kits (the substance)

Extend the party registry so a kit can declare more than a job list:

- **composition** (which jobs / named characters),
- **job levels** — `UnitSpec.jobLevels` is `Record<string, JobLevel>` and `createUnit` already passes it
  through (`units.ts:348`), so this is data, not machinery,
- **equipment**,
- **stats**, so a kit isn't forced through the one flat `BASE`.

Wire it into the **existing** picker seam (`playtestPartyNames`, `PLAYTEST_PARTIES`,
`playtestScenario(...).parties`) so `#scene=<id>?party=<name>`, `#level`, and the **editor's soft-play picker**
all pick the new kits up **with no other change** — that is the property the current registry already has
(`playtest.ts`: "Add a squad by adding a key; the picker and the scenario both pick it up"). Keep it.

- Follow **D114** registry conventions: one spelling, a living exemplar, and a guard. `PLAYTEST_PARTIES` is
  the exemplar to extend.
- **Keep the five existing squads working unchanged** — the editor's soft play and `#level` playtests depend
  on them, and `Standard (3)` is asserted by name in `e2e-level`.

### 3. A finale go-to

A single hash that lands in the finale's deploy phase with a chosen kit and chosen flags. Sequence it after
(1) and (2) — it is their composition, not separate work.

**Out of scope:** teaching the `#debug` jump tool about The Rescue. That tool samples **Hollow Mill** routes,
and the finale joins the arc at **#210**; doing it now would be built twice.

---

## ⚠️ The composition constraint — verified, and it decides what a "finale kit" can be

**Only the Thief job can open the cells.** `canLockpickGate` requires `unitHasCapability(by, "lockpick")`;
the predicate reads the unit's **effective primary job** and `lockpick: true` appears on **exactly one job** —
`thief` (`jobs-data/scout-line.ts:176`). The cells and the hall gate are authored `openBy: [{ lockpick }]`.

**The starting roster has no Thief.** `STARTING_ROSTER` (`guild.ts:140`) is eight: Edrin + Rook (soldier),
**Vale (scout)**, Pip (cook), Coin (merchant), Liora (noble), Sterling (banker), Sela (medic). **Thief is a
promotion inside the scout line** (`scout-line.ts:107`, `into: "thief"`).

So **any kit meant to exercise the sneaking route must carry a Thief as its effective primary job**, which in
campaign terms means *Vale, promoted*. The existing `Infiltration (3)` squad has a thief but is only three
bodies — it cannot also field a distraction, which the two-pronged design requires.

> 💬 **A design question this surfaces — flagged, NOT folded into this brief.** The scouting reward (the side
> door) is worthless without a Thief, so the sneaking route is gated **twice**: scout the arm *and* develop
> the scout line. A player who never promotes Vale can never take the route no matter how well they scout.
> That may be exactly the intent (the route rewards investment) or it may mean most players never see the
> finale's best idea. **Owner call, on its own, later.** It does not block this tooling.

---

## Why this doubles as #209's fixture

**#209 needs "a *reference appropriately-levelled party*"** for the everyone-out pacing bar, and that
reference does not exist yet. The kits built here should be **the same declaration** the guard consumes, so
the thing you playtest by hand and the thing CI pins cannot drift apart.

⚠️ Consequence for how the kits are shaped: they must be **plain, deterministic data** — no RNG, no
derive-from-a-playthrough — because a derived party would shift every time routing changes and make the
pacing bar non-deterministic. Declare them; don't sample them.

---

## Guards

```
npm run build · npm test · npm run sim · npm run test:e2e
npm run test:e2e:scenario · npm run test:e2e:arc · npm run test:e2e:rescue
npm run test:e2e:level · npm run test:e2e:editor · npm run test:e2e:editor:playtest
npm run audit:visual · npm run audit:challenge
```

**Specifically owed:**

- **A visual e2e for the new boot path** — this is a **new player-facing surface** even though it is a dev
  route. Per `CLAUDE.md` the sim never renders a scene and its bot skips deploy entirely, so a render crash
  reads as a **freeze**, not a stack trace (the D92/#168 tale). Prove the finale go-to boots, stages the
  chosen kit, and **shows the side door when the flag is set and not when it isn't** — no page error either
  way. **Address units by tile lookup, never by pixel** (`BoardCamera` adoption is queued, D100).
- **Fail-loud on an unknown flag name and an unknown kit name** — with tests. A dev tool that silently boots
  the wrong state is worse than one that refuses.
- **Regression: the five existing squads and every current route behave exactly as before.** `#level`,
  `#scene`, and the editor's soft play are all live consumers.
- `npm run sim` **must stay byte-identical** — this is dev tooling and touches no routing, rewards, or RNG.
  **If the digest moves, stop and report it.**

## Out of scope

- Teaching `#debug`'s Hollow Mill jump tool about The Rescue (blocked on **#210**).
- **Deciding the finale's canonical party** — that is the owner call below; this brief builds the mechanism
  and takes the roster as input.
- Whether the sneaking route should require a Thief at all (flagged above, separate).
- Balance tuning, the C2 guards (#209 itself), arc promotion, the map expansion, `BoardCamera`.

## Working agreement

- **Plan first.** Read the existing routes and the party registry before designing — this brief's whole point
  is that the seams already exist.
- **Do NOT commit or push.** Report your changes; the main session commits.
- **Report honestly**: the actual output of every guard, anything unverifiable, and any claim here you found
  to be wrong. **Surface scope growth as a decision rather than absorbing it.**
