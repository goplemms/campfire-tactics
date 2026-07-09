# System — Jobs, growth & prestige (the character build axis)

> Referenced by: [Design Overview](../README.md), [The guild & caravans](guild.md)
> (leveling), [Stats](stats.md).
> Decisions: **D32** (the leveling seam), **D38** (the FFT job model), **D39** (hybrid
> leveling), **D40** (the 2-active+1-passive roster + passive identity), **D33**
> (recruitment — the authored/rolled split refined here), **D65** (this framework).

## Why this layer exists

The job system is the game's headline **build-decision point** — the place a unit stops
being a stat block and becomes *a character the player made*. The **substrate** is already
partly deep (D38–D40): every unit carries a **primary job** plus **held jobs** and
**loadout slots** (`units.ts`), each job tracks its **own level** with permanent stat gains
and `unlockLevel`-gated abilities, secondary-XP routing works, and every combat job's
**passive is its identity anchor**. The one piece **not yet built** is the ability-borrowing
**projection** — actually surfacing a held job's abilities into loadout slots is explicitly
"a later pass" (`leveling.ts` header; the FFT secondary-class slotting/use-leveling/slot UI).

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

**The non-combat medium (D70).** The *1–2 active + 1 passive* shape was authored for **combat** —
battle skills in the `skills` array plus a `PASSIVE` identity anchor. A **non-combat** job (the
economy triad) has neither, so the shape transfers in *spirit*, not letter: its anchor is a
**presence effect** (a benefit that holds *by being fielded* — the Merchant's market-tier lift, the
Noble's Influence accrual), and its actives are **overworld verbs** routed through the D61 limiter. So
the non-combat house style is **1 presence-anchor + 1–2 verbs** — the honest analogue of 2+1, with the
**Merchant** (D70) the first worked case.

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
| `holdsItem(x)` | the **Master-Seal** pattern (consumed) | a **recipe book** grants Cook |
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

The combat / non-combat split is **descriptive, not prescriptive** — it *arises* from a job's
kit, it is not stamped on it. The old `noncombat: boolean` (`jobs.ts`) conflated **two different
questions** — a **descriptor** (*is this a battle kit?*) and a **permission** (*may this unit take
the map at all?*) — which is why it was set on the pure-meta economy classes but **not** on the
**Survivalist**, whose kit is non-combat yet is **fielded in Deployment** to place traps. Both are
now resolved and the flag has been **removed** (a future need can return as a **keyword tag**, not
a one-size bucket):

- **Descriptor → derived.** A job with **no `combat` skills** *is* non-combat — read off each
  skill's **`usableContext`** surface via `skillContexts` (the D67/#123 axis that **replaced** the
  retired `phase` tag). It's a **center-of-gravity** read — *which surface does this job's value
  concentrate in?* — so the Survivalist (deployment/`pre-combat`), the Cook (overworld), and the
  Banker (overworld) place on a spectrum instead of being forced into a bucket.
- **Permission → fully emergent (D38).** Any class can take the field; `combatRoster` is simply
  `activeRoster` (a Banker *can* deploy — it just has nothing to do but Defend / move / attack,
  the universal verbs every unit has, `jobs.ts:DEFEND`). The consumer audit the change required is
  **done**: nothing read the flag — the camp / Rest-Point / Upkeep economy keys off `restPoints` /
  `upkeep` / the job lookup, never `noncombat` — so the removal is behaviour-neutral.

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

## Worked example — the Soldier (per-class pass 1)

The first per-class pass under this framework — and the D40 retrofit (the legacy Soldier
predates the 2-active + 1-passive house style, with 3 actives and no passive). Decision: **D66**.

**Identity — the formation anchor.** The Soldier is better **in a line**: every piece of the
kit is a **team multiplier**, which makes it the clean **inverse of the Scout** (isolate +
solo-flank) and a complement to the **Heavy Knight** (who controls *enemy* spacing). The Scout
is the lone playmaker; the Soldier is the **anchor of the group**.

**Kit (2 active + 1 passive):**

- **Brother-in-arms** *(passive)* — **+1 attack damage per adjacent ally, max 3**. Formation
  *offense*. A new passive read in `resolveAttack`, mirroring the Hunter's Deadeye.
- **Turtle Formation** *(Act)* — every **adjacent ally** gains **Guarded** (≈+2 def) **until its
  next turn**: an "AoE Defend for the line." Formation *defense*. A **one-turn aura** (below);
  the cost is implicit — turtling is not attacking.
- **Debilitating Strike** *(Act)* — **+3 damage** and applies **Exposed** (clears on the
  target's next turn). Formation *target-priority*: crack the guard so the clustered line grinds
  them down. **Reuses the Scout's Exposed** as intentional shared synergy (the Soldier is the
  heavy applier, the Scout the fast one).

It **replaces** the legacy Power Strike / Hamstring / Second Wind; dropping the self-heal makes
the Soldier **lean on the squad** for sustain — on theme.

**The channeled-aura model.** Turtle introduced a reusable mechanic: auras maintained on a
**commitment ladder** of *what you give up to project them*.

- **One-turn aura** (Turtle): cast → each **adjacent ally** gains **Guarded** until its next
  turn (an "AoE Defend") → the value lands **outside** your turn (foes act in the CT gap before
  you come up again). Re-cast to maintain; the cost is the Act — **brace the line *or* strike,
  each turn**. Built as a per-ally Guarded at cast (the proven Defend mechanic, spread to the
  line); the aura-that-follows-the-formation is reserved with the persistent stance.
- **Persistent stance** (reserved for prestige): cast-once, **hold-until-broken**, at a cost —
  **free** (= Mark Prey) / **rooted** (no move) / **locked** (no other action). The dial scales
  cost to strength; **displacement breaks it** (the Heavy Knight's Shove is the counter). The
  natural **Sentinel** payoff — Turtle goes one-turn → **persistent rooted**, freeing your Act
  to attack.

Among the auras you already have: **tarpit** is the always-on passive end, **Mark Prey** the
free channel, **Turtle** the one-turn rung.

**Next:** the Soldier's prestige fork — **Sentinel** (deepen the defense) vs **Banner** (deepen
the offense) — designed in a following pass, with the persistent-stance primitive landing
alongside it.

## Worked example — the Scout (per-class pass 2: the first fork)

The second per-class pass, and the **first class to actually fork.** The Soldier (pass 1) only
*reserved* its prestige; the Scout builds the real thing — a `JobDef.prestige` and authored
transition events on top of the D65 machinery. Decision: **D68**.

**Identity — the lone playmaker.** The Scout is the **infiltrator / flank engine**: it
manufactures isolation, slips the net, and strikes from where the enemy isn't looking — the clean
inverse of the Soldier's formation anchor, and distinct from the Hunter's range. Unlike the legacy
Soldier, the Scout was already near the 2-active + 1-passive shape, so the base pass is a **tidy**,
not a retrofit.

**Base kit (2 active + 1 passive):**

- **Quiet Footsteps** *(passive)* — **merged** the two legacy flank passives into one anchor: the
  Scout flanks **solo** (no second body) **and** moves unseen, **halving its capture chance** in
  deployment (compounding again while **Swift**). One passive, two reads — *quiet* means unseen by
  both the net and the target.
- **Set Trap** *(Act, L1, Deployment)* — plant a trap: **8 damage** + **Exposes** the first enemy
  onto it (reuses Exposed; sets up the Hunter's Deadeye). **Moved to L1 (D74)** — the fun starter,
  so the Scout fields its full combat kit from the start (gated only on carrying a trap-kit).
- **Recon** *(Act, L2, combat / deployment)* — the Scout's **dart**: **+3 tiles** (the old
  **Dash** — reach a flank, or infiltrate deep where Quiet Footsteps' evasion compounds,
  dual-context by shape, D67). **Combat/deployment only** now (`RECON`, `jobs-data/scout-line.ts`).
- **Survey** *(L2, overworld)* — the Scout's overworld field-craft, **split back out** as a
  **standalone** skill (`SURVEY`) — *not* a second face of Recon. It scouts a reachable node on
  the road ahead, raising its banded intel preview a tier (the D24/D48 recon), priced on the
  overworld cost menu (`overworldCost: { cooldown: 1, fatigue: 4 }`). There is **no**
  `SkillDef.overworldEffect` field; "one ability per surface reads cleaner than a two-faced verb"
  (**D74 revisited**). *(overworld.md's D80 sections describe this same split — the two docs now
  agree.)* The Scout's **L2 growth is Recon + Survey** — on-theme for the recon specialist, keeping
  the *2 active + 1 passive* combat count (Set Trap + Recon) while Survey rides the overworld surface.

**The fork — rogue → {Assassin · Thief}.** At a job-level floor **and** a met trigger, the Scout
prestiges **in place** down one of two branches (replace-the-kit, keep the grind). Both share one
spine:

- **Hidden Passage** *(shared spine)* — an Act granting **Stealth** until your next turn: the enemy
  can't see or target you unless it stands **adjacent**. Authored once as a single skill both
  branches reference. **Combat-only** — the closing net doesn't "see", so Stealth means nothing
  pre-combat. (Stealth stays *lightweight*: a status + one `canSeeUnit` read the AI already uses —
  no full fog-of-war.)
- **Assassin** *(lethal branch)* — **Subtle Blade** (passive) replaces Quiet Footsteps: **+8 power
  on a full-HP target** — an **opening-strike alpha** (an alpha, not a crit), built to pay off
  *vanish → open*. **Surgical Precision** (L2) replaces Set Trap: a **+3** strike leaving the foe
  **Exposed *and* Immobilized** (the first multi-rider `onHit`). The frame shifts to a glass dagger.
- **Thief** *(utility branch — emergent non-combat)* — its value is **verbs, not a battle kit**
  (spine = Hidden Passage only; `passives: {}` deliberately clears Quiet Footsteps — the anchor is
  economic). **Deft Hands**: skim **25 gold at ≈50%** at a busy node (never a rest). **Expert
  Lockpick**: the **disarm** capability — read as a *capability*, not a jobId, so the Thief disarms
  where the Assassin can't and the Scout still can via Set Trap.

**The transition (how the fork is *earned*, not auto-granted).** Prestige is a **choice at an
event**, never a threshold auto-flip. The Scout-fork ships two authored offers, kept out of the
random pool so they surface only when drawn / eligible:

- **Thieves' guild → Thief** — a one-step join offer to a floor-met Scout.
- **The travelling companion → Assassin** — a **two-step chain**: walk the road with a stranger
  first (a remembered flag), and *only then* does the reveal — the traveler was an assassin all
  along — offer the mentorship. Linked memory gates the second event on the first.

**Next:** the **D69 follow-ons** — surfacing these offers in live runs + the camp-accept UI, the
Expert Lockpick chest/door content, the combat "convince a neutral assassin" path, and the
Scout-line numbers pass.

## Worked example — the Merchant (per-class pass 3: the first non-combat verb-kit)

The third per-class pass — and the **first non-combat class** to get one, which forced the question
the combat passes never had to ask: **does the 2-active + 1-passive house style even apply** to a job
with no battle phase, no CT, and an empty `skills` array? The Merchant's identity already lived
entirely in **verbs gated outside `skills`** (D61): a market-access lift plus the buy/sell trade
verbs. Decision: **D70**.

**The answer — 2+1 transfers in *spirit*, not letter.** A non-combat job's anchor is a **presence
effect** (a benefit that holds by being fielded — the passive analogue), and its actives are
**overworld verbs** (routed through the D61 limiter). So the non-combat house style is **1
presence-anchor + 1–2 verbs**, and the Merchant is authored as a clean 2+1 in that medium — the frame
the later Banker / Noble passes inherit.

**Identity — the trade-broker.** The Merchant *makes and works markets*: it conjures trade where
there is none, and squeezes every real market for more. Its value is the **economy**, not the field —
the clean non-combat counterpart to the combat kits.

**Base kit (1 passive + 2 actives — in the verb medium):**

- **Appraisal** *(passive — the presence anchor)* — while a Merchant rides along, any node that
  **already has a market** reads **one tier better** (`poor → basic → premium`, capped). A Merchant
  makes every real market *better* — the always-on identity. (New behavior: D61's `merchantFloor`
  did **not** upgrade existing markets.)
- **Find Trade** *(active)* — open an **impromptu market on a `none` node**: the caravan can trade
  anywhere a Merchant can drum one up. This is D61's ACCESS lift **reframed from an always-on passive
  into a paid action** — access at a barren node now **costs a turn** (the D61 limiter), not a
  freebie-by-presence. The conjured market is **`poor`** and is **not** Appraised (else a `basic`
  market anywhere for one action — which would undercut the scarcity of real trade hubs).
- **Savvy Barter** *(active)* — the Merchant's **next deal goes their way**: a **buy at 0.5× price**
  *or* a **sale at 1.25×** (whichever they do next). Paced through the limiter (a timed treat, not a
  standing aura), with **deliberately asymmetric** magnitudes — a big cut on the *sink* (buy), a
  modest premium on the *faucet* (sell) — so it sharpens trade without minting unbounded gold (D61's
  scarcity discipline; a 1.25× sale at an appraised premium market beats face value, so the pacing is
  what keeps it honest).

**Buy / Sell stay universal.** Raw buying and selling remain **market-gated, not Merchant-gated**
(anyone trades at a market that exists; the event-shop already does). The Merchant *layer* — Appraisal
/ Find Trade / Savvy Barter — is the job-exclusive kit on top, and the Merchant still **levels from
brokering** (a sale grants it use-XP). This keeps the three economy classes consistent: the Merchant's
exclusivity lives in its three signature abilities, the way the Banker's and Noble's live in theirs.

**Next:** the Merchant's **prestige fork** — the **first non-combat (verb) prestige**, where
replace-in-place deepens the *verbs/presence* rather than a battle kit — designed in a following pass
(reserved here, as the Soldier's fork was in pass 1).

## Worked example — the Cook (per-class pass 4: food → recovery)

Pass 4 — the **camp-support** non-combat class (the legacy **Chef**, renamed **Cook**). It was a 1+0
(one verb, no anchor); this gives it the D70 shape and wires its active into the **Rest-Point** economy
(D9). Decision: **D71**.

**Identity — the field cook.** Keeps the party fed, rested, and in good spirits; its value is
**recovery**, the support mirror of the economy classes. Three food-themed levers: provisioning
(passive), rest (Stew), morale (Feast).

**Base kit (1 passive + 2 actives):**

- **Field Kitchen** *(passive — presence anchor)* — a Cook lowers the party's **Food upkeep** (the
  existing per-unit food discount): double duty — cheaper food *and* a cheaper Cook Stew.
- **Cook Stew** *(active)* — **spend the day's Food value → bank Rest Points** (≈ one chunk's worth)
  **and satisfy the Food upkeep line.** It turns the mandatory food spend into recovery: net gold is
  the same as just paying food, but you get RP for it. The **"free food that day" is the anti-exploit**
  — it blocks cooking for RP *and then* skipping the Food line (D45) to pocket the gold. Once per node.
  Replaces the legacy battle-start `pendingHeal` (RP supersedes it) and its `+1 morale` rider (→ Feast).
- **Feast** *(active)* — a special meal: a **larger morale lift** to rally before a hard fight,
  costed/paced heavier than Stew. The morale verb.

**Recovery is now *active*.** Cook Stew feeds the **shared RP pool**, cashed at the next rest beat — so
the Cook's recovery is *chosen* (cook → bank → rest), not a passive trickle. The big passive
`restPoints` shrinks to a small floor; the Cook earns its RP by cooking, tying the class to the food
economy it already discounts.

**Next:** the Cook's **prestige fork** — a non-combat verb-prestige like the Merchant's (reserved).

## Worked example — the Noble (per-class pass 5: the standing economy)

Pass 5 — the **Influence** economy class (D62), and the lightest pass: the Noble was *already* nearly a
2+1, so this mainly **formalizes** the shape (no new code). Decision: **D71**.

**Identity — the standing-bearer.** Works the *political* economy, not the field: presence builds
rapport, gold courts patrons, standing sways enemies. Its currency is **Influence** — walled-off,
per-expedition (D62).

**Base kit (1 passive + 2 actives — across two surfaces):**

- **Renown** *(passive — presence anchor)* — a Noble **accrues Influence per node-step** as the caravan
  travels (the existing presence faucet). The always-on standing identity.
- **Patronize** *(active — camp)* — spend **gold → Influence** (court patrons): the active faucet,
  paced (once per node + gold).
- **Bribe** *(active — combat)* — spend **Influence → sway an enemy** mid-battle (temp turncoat /
  permanent recruit, D33).

**The cross-surface generalization.** The Noble's two verbs sit on **different surfaces** — Patronize
in camp, Bribe in battle — so it **generalizes the house style** to *"1 presence + 1–2 verbs, where a
verb may be a camp **or** a combat action"* (the archetype-5 carve-out the substrate anticipates). A
clean loop: **accrue → Patronize → Bribe.**

**Next:** the Noble's **prestige fork** — a non-combat verb-prestige (reserved).

## Open questions / future scope

- **The per-class design pass (one at a time)** — passes 1–5 are **done & built**: Soldier (D66),
  Scout (D68), Merchant (D70), Cook & Noble (D71), on the **action-registration substrate** (D72 —
  one home on `JobDef.skills`, `availableSkills` the projection, the effect registry, computed costs,
  the flag bag, presence/faucet, capability gates; fixtures only). **Still ahead:** the **triad kits**
  that consume the substrate (the content pass), the **Banker's** own 2+1 pass (+ its missing presence
  anchor), the **prestige forks** (combat — the Soldier's; non-combat — Merchant / Cook / Noble), and
  the remaining combat classes' kits.
- **Chain pacing** — job levels between hops so a tier-3 capstone feels earned.
- **The acquisition agency model** — automatic (authored beats) vs. choice/item (generics).
- **The per-unit-memory data shape** — contents + persistence scope (node / run / guild).
- **Acquired-job starting level** — assumed **job-level 1** (you just started); confirm.
- **Glossary** — add a **Prestige** keyword (one word per concept).
