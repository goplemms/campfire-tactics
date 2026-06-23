# System — Jobs, growth & prestige (the character build axis)

> Referenced by: [Design Overview](../README.md), [The guild & caravans](guild.md)
> (leveling), [Stats](stats.md).
> Decisions: **D32** (the leveling seam), **D38** (the FFT job model), **D39** (hybrid
> leveling), **D40** (the 2-active+1-passive roster + passive identity), **D33**
> (recruitment — the authored/rolled split refined here), **D65** (this framework).

## Why this layer exists

The job system is the game's headline **build-decision point** — the place a unit stops
being a stat block and becomes *a character the player made*. The **substrate** is already
deep (D38–D40): every unit carries a **primary job** plus **held jobs** it borrows abilities
from into **loadout slots**, each job tracks its **own level** with permanent stat gains and
`unlockLevel`-gated abilities, and every combat job's **passive is its identity anchor**.

What that substrate never settled is the **growth *shape*** sitting on top of it: how a unit
comes to **hold more jobs**, how a job **grows into a stronger successor** (the Fire-Emblem
prestige fantasy — *rogue → assassin*, *rogue → thief*), and what the loose **combat /
non-combat** split actually *is*. The hook was reserved in code —
`leveling.ts:applyCharacterBoons` notes *"future job evolutions / advanced-job gating hang
here too."* **D65 cashes that hook at the framework level.** Per-class *content* (each
class's actual branches) is a deliberate **later, one-at-a-time pass** — this doc is the
frame those passes hang on.

## Two axes: breadth and depth

Character growth runs on **two axes that must not blur**:

| Axis | Rides on | Verb | Fantasy |
|---|---|---|---|
| **Breadth** | character level → **loadout slots** (D38) | a new job **adds** kit parts | the **generalist** — collect & mix |
| **Depth** | **job** level (D39) → prestige | prestige **replaces** kit parts in place | the **specialist** — grow one path deep |

Keeping them orthogonal is the legibility guarantee: **prestige never widens breadth, and
gaining a job never deepens a kit in place.** A unit that prestiges its primary still borrows
the same number of secondary abilities it did before; a unit that picks up a third job has
not made any single job stronger.

## A job's kit (the guideline, not the rule)

A job is **1–2 active abilities + 1 passive** (D40's house style; the passive is the identity
anchor). It is a **guideline, not a hard rule** — the existing roster already bends it (the
Scout carries a deployment snare on top of two battle actives and two flank passives), and
that flex is *wanted*: interesting beats uniform.

The two axes preserve the guideline's *spirit* automatically:

- **Prestige replaces** ≥1 kit element — the count stays flat as a job deepens.
- **Held jobs add** kit elements through **loadout slots** — growth in breadth is **bounded**
  by the slot economy, not unbounded sprawl.

## Prestige — the depth capstone (replace-in-place)

Prestige is **growing a job into a successor**, and it **replaces in place**:

- The prestige job **occupies the same slot** its base did. It is **not** a new held job — it
  *is* the job, evolved. (Stacking was rejected: it would couple the axes and blow the slot
  budget.)
- A branch is authored as a **diff on the base kit**: **replace ≥1 element** (an active or the
  passive), **keep the rest**. So `rogue → assassin` and `rogue → thief` are **sibling diffs**
  — a shared spine, a swapped edge — which is exactly why they read as *related but distinct*.
- Because it's a diff, the **count stays flat**, so the *1–2 active + 1 passive* guideline
  survives prestige with no extra bookkeeping.

**Chains are supported.** A prestige job is *itself* a job, and any job may carry a branch — so
*tier-1 → tier-2 → tier-3* is **recursion on the same seam**, not a special case. How many job
levels a chain wants **between hops** (so a capstone feels earned, not rushed) is **per-class
pacing**, deferred to the class pass.

**Non-combat prestige deepens *verbs*, not a battle kit.** The economy classes' value lives in
**verbs gated outside the `skills` array** (`hasBanker` / `hasNoble` unlocking Invest / Borrow /
Patronize). So their prestige is "replace-in-place" applied to **verbs** — same spirit,
different plumbing — and each shape is thought through individually (deferred).

## One seam: job grants & prestige triggers

Both **acquiring a base job** (breadth) and **triggering a prestige** (depth) are the **same
machinery**: an **eligibility predicate** guarding an **effect**.

```
  grant   := { when: <predicate>, then: <effect> }
  effect  := add a held job  |  prestige <from> → <into>
```

The predicate kinds **compose** and are **default-open** (anyone meeting them qualifies):

| Predicate | Use | Example |
|---|---|---|
| `jobLevel ≥ N` | **the default** prestige trigger | grind the job, earn its capstone |
| `charLevel ≥ N` | authored coming-of-age | the nomad child who joins the hunt at L5 → Hunter |
| `holdsItem(x)` | the **Master-Seal** pattern (consumed) | a **recipe book** grants Chef |
| `atNode(x)` / event-choice | a special node or interaction | the **thieves'-guild** invitation |
| `unitId(x)` / story-flag | **select characters** | a one-off / story-gated path only *they* can take |
| `unitMemory(flag)` | linked events (see below) | *helped the beggar* → later *invited to the guild* |

**"Special prestige for select characters" needs zero new machinery** — it's just a predicate
keyed on **identity** or a **story flag**. The same seam carries the mundane (grind-to-prestige)
and the bespoke (a legendary path authored for one hero).

## Symmetric by default; power attaches to *story*, not *tier*

The **entire** tree — jobs, prestige, chains, stat ceilings, flexibility — is **available to
mercenaries and the authored cast alike**. This is the same principle as **uniform caravan
slots** (any character fits any slot, `guild.md`): the system does not privilege a tier.

So **what makes a character special is the *player*, not the data.** A rolled mercenary the
player grows attached to is a **first-class win**, equal to any named companion. Authored
distinctiveness is **narrative** — a **fixed identity** and **story quests** — *not* a stat
advantage.

The `unitId` / story predicate is **power-neutral plumbing**. It may host a **genuinely
powerful one-off** — but **only when a story earns it.** That is the guardrail: power is the
payoff of a questline you *played*, never a dividend of sitting in the "companion" bucket. The
smell to avoid is reaching for "powerful exclusive" with no story behind it — that is
authored-superiority sneaking back in.

## Acquisition is diegetic — and *is* the attachment engine

Jobs arrive **through play**, not a menu:

> A scout helps a beggar in a city node; the unit **remembers** it. Nodes later, a linked
> event — *the local thieves' guild has heard there's a friend of the poor in town* — offers
> her the **Rogue** job. She takes it as a second held job, grinds it, and at a quiet camp
> chooses to **prestige Rogue → Assassin** (Expose → Backstab; the flank passive → an ambush
> passive; Dash kept). None of this was on a menu; all of it is **what she did.**

A unit's job sheet thus becomes a **history**, and history is exactly what makes a unit feel
*yours*. So this acquisition model doesn't merely *coexist* with "the player makes them
special" — it **manufactures** it, and it compounds with **permadeath (D27)**, which only
hurts when you're invested.

**Agency note (deferred detail):** the examples sit at different agency levels — *automatic*
(coming-of-age on a level), *player-spent* (the recipe book), *player-chosen* (the guild
event). Automatic is right for **authored story beats** (it's a reveal); **generic**
acquisition should usually **cost a choice or an item**, because the ownership — and the
attachment — accrues in the *choosing*.

## Per-unit memory — the one new substrate

The only genuinely new data the framework needs is **persistent per-unit memory**: a
**cross-node flag bag** on the unit so a *later* event can read what an *earlier* one wrote
(the beggar → guild chain). Everything else reuses existing seams (the predicate kinds, the
job registry, the loadout economy, per-job levels). The **exact shape** — what a memory entry
holds, how long it persists (a run? the guild?) — is deferred.

## Emergent combat / non-combat (no authored flag)

The combat / non-combat split is **descriptive, not prescriptive** — it should *arise* from a
job's kit, not be stamped on it. Today's `noncombat: boolean` (`jobs.ts`) actually **conflates
two different questions**:

- a **descriptor** — *is this a battle kit?*
- a **permission** — *may this unit take the map at all?*

…which is why the flag is set on the pure-meta economy classes but **not** on the
**Survivalist**, whose kit is non-combat yet is **fielded in Deployment** to place traps.
Splitting them:

- **Descriptor → derive it.** A job with **no `battle`-phase skills** *is* non-combat (every
  skill already carries a `phase`). It's a **center-of-gravity** read — *which phase does this
  job's value concentrate in?* — so the Survivalist (deployment), the Chef (meta), and the
  Banker (overworld) place naturally on a spectrum instead of being forced into a bucket. No
  authored field required.
- **Permission → an open call (parked).** Keep the current **hard fielding ban** (a Banker
  literally cannot deploy), or go **fully emergent** (anyone can be placed; a Banker simply has
  nothing useful to do but Defend). The emergent answer is more consistent with **uniform
  slots** and the **universal Defend / move / attack** every unit has (`jobs.ts:DEFEND`), but
  it requires **auditing every consumer** of the flag (upkeep / Rest-Point / morale roster
  handling, deploy filtering) before it can change.

## Authored identity, flexible class (refines D33)

D33 described Tier-2 companions as having a **"fixed class/identity."** That welded two things
that should come apart. D33's real axis is **authored vs. rolled** — a mercenary's class is
*rolled by the dice*, a companion's is *hand-picked by the author* — **not** mutable vs.
frozen (D33 already says companions *"level like anyone"*).

So, unwelded:

- **Identity** — name, portrait, story role — is **fixed forever.** This is what makes a
  companion *that* companion.
- **Class** is **authored at the start** (chosen, not rolled) but **flexible thereafter** — it
  grows, gains second jobs, and prestiges **like anyone's.** A companion may even be authored
  to *start* with more than one job, or a head start on a path; that is an **endowment of
  starting material**, not a lock.

## Open questions / future scope

- **The per-class design pass (one at a time)** — each class's **actual prestige branches**, the
  **Soldier** 3-active/0-passive → **2+1 retrofit**, and the **non-combat prestige verb
  shapes** (Banker / Merchant / Noble), each thought through individually.
- **Chain pacing** — job levels between hops so a tier-3 capstone feels earned.
- **The acquisition agency model** — automatic (authored beats) vs. choice/item (generics).
- **The per-unit-memory data shape** — contents + persistence scope (node / run / guild).
- **Acquired-job starting level** — assumed **job-level 1** (you just started); confirm.
- **The fielding-permission call** — keep the hard ban or go fully emergent, plus the
  `noncombat`-consumer audit it implies.
- **Glossary** — add a **Prestige** keyword (one word per concept).
