# Decisions: foundations

OPT-IN ledger for contested or multi-track work. Skip this file for simple,
single-track features. Before editing an entry, CLASSIFY the change and confirm
with the user: is this a **pivot** (supersede + re-open) or an **adjustment**
(new milestone)?

Statuses: `Open` · `Decided` · `Superseded` · `Deferred` · `Blocked`

Superseded entries are NEVER deleted — they keep a "Superseded by" link so the
trail of reasoning stays intact.

---

## D1 — Engine & platform strategy

- **Status:** Decided
- **Context:** First-time game developer, most comfortable on the web, but wants
  to keep the door open to ship on Steam and as a mobile app later.
- **Options considered:** Godot 4 / Unity / Web (TypeScript + Phaser 3) / Bevy (Rust)
- **Decision:** **Web-first — TypeScript + Phaser 3 + Vite.** Steam/desktop later
  via a Tauri or Electron wrapper; mobile later via Capacitor. These are additive
  wrappers around the same web build, not a port, so "web now" does not forfeit
  Steam/mobile.
- **Superseded by:** —

## D2 — Core/render separation (the rule that makes D1 safe)

- **Status:** Decided
- **Context:** A web game can bleed engine/DOM assumptions into game logic, which
  is exactly what makes later platform moves a rewrite.
- **Options considered:** (a) Phaser-coupled game objects throughout /
  (b) pure-logic `core` package + thin `game` render layer + future platform shells
- **Decision:** **(b).** `core/` is plain TypeScript with no Phaser and no DOM —
  stats, grid, pathfinding, jobs, skills, turn rules, run state. `game/` renders
  it with Phaser. Benefits: the core is headlessly unit-testable (which is what
  the kit's "tests green" milestone gates check), and it travels unchanged into
  any platform shell.
- **Superseded by:** —

## D3 — Phase pipeline: Meta → Deployment → Battle → Resolution

- **Status:** Decided
- **Context:** The signature non-combat jobs do NOT all act in the same place:
  Chef acts between battles (camp), Survivalist acts before a battle starts
  (deployment), Merchant acts in the economy/meta layer. Bolting these onto a
  single battle loop later would fight the architecture.
- **Options considered:** (a) one monolithic battle state / (b) explicit ordered
  phases with jobs/skills hooking specific phases
- **Decision:** **(b).** Model the game as ordered phases and treat jobs/skills as
  data that register effects into a phase. This makes the unique hook cheap to
  extend and is set up in M4, exercised in M5–M6.
- **Superseded by:** —

## D4 — Field entities + a battle trigger/event bus

- **Status:** Decided
- **Context:** Traps (Survivalist), defensive nests (Builder), and ritual runes
  (Mage) look like three features but share one shape: a non-unit thing placed
  during Deployment that reacts to events during Battle. Modeling them separately
  would make each a bolt-on.
- **Options considered:** (a) hard-code each placeable as its own special case in
  the battle loop / (b) one **field-entity** abstraction (position, owner, state,
  trigger policy, effect) whose instances are **listeners on a battle
  trigger/event bus** (`onUnitEnterTile`, `onTurnStart`, `onUnitDamaged`, …).
- **Decision:** **(b).** Trap = one-shot listener; nest = passive aura/terrain
  modifier; rune = pre-paid charge (auto or manual trigger). Crucially, **M3
  builds the trigger bus + field-entity registry before any entity exists**, so
  later placeables are data + a listener, not new systems. Full spec:
  [`docs/design/systems/field-entities.md`](../../docs/design/systems/field-entities.md).
- **Superseded by:** —

## D5 — Combat action economy: FFT-style CT clock + charged abilities

- **Status:** Decided
- **Context:** The signature prep mechanics (especially auto/manual-triggered
  runes) want a notion of effects committed in advance and resolving later. The
  action economy must accommodate that.
- **Options considered:** (a) Fire-Emblem-style one move + one action per discrete
  round / (b) FFT-style **continuous Charge-Time (CT) clock** (per-unit CT rises by
  Speed each tick; turn at CT≥100; Move + Act) **with charged abilities** that
  schedule on the timeline and resolve later.
- **Decision:** **(b).** Speed governs turn frequency *and* charge-landing speed.
  Ritual runes are modeled as **pre-paid charged abilities** placed in Deployment.
  Each side starts Battle with a **CT seed** from its deployed, non-captured units'
  Speed. **Accepted cost:** AI on a continuous clock is meaningfully harder than
  round-based — opted in with eyes open. Spec:
  [`docs/design/systems/action-economy.md`](../../docs/design/systems/action-economy.md).
- **Superseded by:** —

## D6 — Two-tier prep; logistics as a first-class pillar

- **Status:** Decided
- **Context:** Prep splits cleanly into off-map resource management (buy gear, load
  ammo/materials, cook) and on-map placement. The player wants logistics to be a
  *headline pillar* aimed at crunch players, not garnish.
- **Options considered:** (a) a single lumped "setup" step / (b) **two tiers**:
  **Meta/Pre-deployment** (off-map resource logistics) feeds **Deployment** (on-map
  spatial logistics), linked by a **provisioning constraint** (you can only place
  what you carried; you can only carry what storage allows).
- **Decision:** **(b), with logistics elevated to a pillar.** Storage (Merchant) is
  the master cap; materials/ammo/rations are consumed in Battle and recovered in
  Resolution. This warrants a dedicated logistics milestone (an *adjustment*, not a
  pivot — north star unchanged). Spec:
  [`docs/design/systems/logistics.md`](../../docs/design/systems/logistics.md).
- **Superseded by:** —

## D7 — Deployment as a per-unit push-your-luck time gamble

- **Status:** Decided
- **Context:** On-map setup should carry risk, not be pure upside, and the risk
  should reward fast/perceptive characters while punishing greed.
- **Options considered:** (a) a hard deployment-point budget / (b) a **soft**
  budget with a **transparent exposure model**: a safe allowance, then an
  **overdraw zone** with *shown, escalating* capture risk. **Awareness** governs
  safety (bigger safe allowance, less exposure per overdraw); **Speed** governs
  throughput. Overreach → the unit is **captured**: it starts Battle bound on the
  map (effective −1, removed from the initiative seed) but is a **rescuable**
  sub-objective; only a unit still captured at battle's end is lost (permadeath).
- **Decision:** **(b).** Transparent meter (no hidden roll), rescuable capture,
  Awareness=safety / Speed=throughput. Units may instead **hold position** (no
  prep, no risk, ready). Spec:
  [`docs/design/02-deployment.md`](../../docs/design/02-deployment.md).
- **Superseded by:** —

## D8 — Morale: passive, tiered, asymmetric modifier bundle

- **Status:** Decided
- **Context:** The Chef produces morale and Resolution nudges it, but morale had
  no mechanical meaning. The player wants it to *avoid* being another active meter
  to manage, and to never "kick a player while they're down."
- **Options considered:** (a) per-unit combat stat with routing/fleeing at low
  morale / (b) **passive, tiered party-wide bundle of minor modifiers** / (c) a
  spendable resource pool.
- **Decision:** **(b).** Morale is **passive** (always-on, nothing to spend) and
  applies a **bundle of small modifiers by tier**. Deliberately **asymmetric**:
  Neutral is baseline, High tiers *add* modest bonuses, the Low tier applies only
  *marginal* penalties (mostly the absence of bonuses) — so the floor is shallow.
  The specific effect list is an **open menu** (deployment safe allowance,
  initiative seed, capture exposure, crit, slight HP, accuracy/evasion, loot/gold
  find), biased toward effects that reinforce existing systems. **Speed is a
  caution** — it compounds in the CT clock, so any morale→speed effect must be the
  smallest of the bundle or omitted. Spec:
  [`docs/design/systems/morale.md`](../../docs/design/systems/morale.md).
- **Superseded by:** —

## D9 — Mortality, recovery & difficulty consequence policy

- **Status:** Decided
- **Context:** A roguelike needs stakes, but the player's philosophy is **punish
  choices, not execution**. Units leave the run via two vectors — falling in combat
  (HP→0) and being captured-and-unrescued — and how harsh each is should be a
  *difficulty* dial, not a fixed rule.
- **Decision:** A **data-driven consequence policy, one per difficulty**, the core
  consults when resolving a downed or captured unit (swappable, headlessly
  testable). The universal time unit is **a night**.
  - **Combat down (HP→0):** Easy = full heal on rest; Normal = redeploy at ½ HP, no
    permadeath; Hard = "dying," pay a **local cleric** (gold, an economy sink)
    within N nights or permadeath; Hardest = permadeath at 0, flat.
  - **Captured & unrescued:** resolves into a **rescue follow-up quest**, not flat
    death. Easy = guaranteed, no timer; Normal = must be earned, no timer; Hard =
    narrow night-window + **reduced Deployment** (enemy is ready — an "ambush-in-
    reverse" scenario modifier); Hardest = tight window + heavily reduced
    Deployment. Abandoning the quest past its window loses the unit (option **b**
    from the discussion: a grace window to grind resources, then real loss).
  - **Recovery (between nights):** a **Rest-Point (RP)** meter. Support roles
    (Chef/Medic/Bard/…) add RP per night (data-driven). RP converts to healing at
    **`RP_PER_CHUNK` → one chunk of `CHUNK_FRACTION` of max HP** (default `1/8`,
    every constant configurable). **Difficulty scales `RP_PER_CHUNK` only** (one
    dial for the whole gradient). RP is spent by **triage** — allocated to chosen
    units each night — which gives the Hard-mode dying clock real teeth.
- **Open sub-points (tuning):** exact tier/threshold numbers; whether difficulty
  scales anything *beyond* mortality (scoped **out** for this pass). Spec:
  [`docs/design/systems/mortality-recovery.md`](../../docs/design/systems/mortality-recovery.md).
- **Superseded by:** —

## D10 — Intel system, the Intelligence stat, and banding as a convention

- **Status:** Decided
- **Context:** Provisioning is deliberately "blind-ish"; *intel* lifts that fog. Two
  questions were open: is intel a passive of a stat or a purchased action, and does
  it share the Awareness stat (which already governs Deployment safety)?
- **Decision:**
  - **Intel is per-encounter, party-wide, and banded** into tiers separated by
    **breakpoints**: **types → numbers → positions**.
  - **Three lanes** to climb the tiers (C+D from the discussion, plus a specialist):
    (1) **passive** via a new **Intelligence** stat (a free floor); (2) **scouting**
    — gold/ration, or **send a unit** who then starts the battle out of position
    (risk, à la D7); (3) **divination** via the **Seer** — spend a reagent to jump a
    breakpoint, or at master rank read free with a chance to jump *multiple*.
  - **Awareness and Intelligence are distinct personal stats.** Awareness = how
    *safely* a unit preps (Deployment exposure); Intelligence = how much the party
    *sees* (intel floor). Different archetypes: Survivalist high-Awareness, Diplomat/
    Noble high-Intelligence. The **Seer** raises the shared **Intel level**, not the
    Awareness stat. ("Intelligence" name is **provisional** — may collide with a
    future magic stat.)
  - **Banding is adopted as a general convention** (intel, morale, Awareness
    allowance, …): discrete, player-legible, individually tunable knobs.
- **Spec:** [`docs/design/systems/intel.md`](../../docs/design/systems/intel.md),
  [`docs/design/systems/stats.md`](../../docs/design/systems/stats.md).
- **Superseded by:** —

## D11 — Deployment exposure: safe period + retreat-gamble (refined)

- **Status:** Decided (details the D7 gamble) · **refined 2026-06-05** per play-trace
- **Context:** D7 set the *experience* (visible safe allowance → escalating risk) but
  not the curve. Player added a spatial dimension, then refined *how* it resolves.
- **Options considered:** (a) smooth accelerating % / (b) **banded risk tiers** /
  (c) deterministic threshold. Resolution: immediate-per-placement *vs.* a positional
  **retreat** at the buzzer.
- **Decision:** **(b), banded + spatial, resolved as a retreat race.**
  - **Stage 1 — safe period:** units range out and place **freely, zero-risk** (its
    length banded by Awareness).
  - **Stage 2 — retreat:** at the buzzer every exposed unit **auto-retreats** to its
    nearest **safe zone**; a **capture roll fires at the end of each step**, odds a
    tug-of-war of **proximity↓** (distance band Safe→Exposed→Hunted→Cornered shrinks
    toward home) and **time↑** ("the enemy is upon you"). Deep units face more steps
    *and* a rising clock → compounding odds; near-home units snap to ~0. The board
    shows each unit's **projected total retreat risk** (transparent; can't un-roll).
    A failed roll → captured, **repositioned into the enemy's safe zone**.
  - **Stats:** **Awareness** = longer safe period + gentler retreat odds; **Speed** =
    range (venture *and get home*) + throughput.
  - Cross-tie: a **Tier-3 intel** read reveals where the gradient bites hardest.
- **Refinement note:** the original "immediate per-placement roll" clause is
  **superseded** by the per-step **auto-retreat** model above (never built; refined
  at design stage from the session play-trace). The banded/transparent/spatial
  *spirit* is unchanged.
- **Spec:** [`docs/design/02-deployment.md`](../../docs/design/02-deployment.md).
- **Superseded by:** **D63** — the retreat-race above was **never built**; the
  implemented Deployment is D63's **closing-net** model (a CT-clock board phase with
  an advancing enemy danger source). The banded/transparent/spatial *spirit*, the
  Awareness/Speed/morale/intel roles, and the capture/rescue payoff all carry over.

## D12 — Enemy-prep symmetry + unified in-combat capture

- **Status:** Decided
- **Context:** Deployment prep was player-only. Should the enemy play the same game,
  and how do you deal with *their* hazards?
- **Options considered:** A1 asymmetric (player-only) / A2 fully symmetric / A3
  **fortified-encounter type** (only some encounters are prepped).
- **Decision:** **A3.** Enemy hazards appear in **fortified encounters** (enemy
  camps, defended chokepoints, *every rescue mission* — reusing the
  reduced-Deployment scenario), not in open scraps/ambushes — so symmetry is a
  *flavor*, not a tax, and the workload scales to encounters that want it.
  - **Detection** of enemy entities is gated by **Intel/Awareness** (Tier-3 or high
    Awareness reveals; else hidden until sprung). **Disarm** costs an **Act** (the
    Survivalist's defensive mirror); or **route around**.
  - **The Snare** is the exemplar enemy entity: **Immobilized X turns + a banded
    capture countdown** (abstracting enemy reinforcements reaching the spot — option
    **a**, timer-alone; adjacency-accelerator is a noted future upgrade). Expire
    while held → **captured**. This makes **capture one mechanic with two entry
    points** — pre-battle overreach (D11) and in-combat helplessness — both feeding
    the D9 captured state/rescue/policy.
  - Implementation: the M3 trigger bus must carry **status effects** (Immobilized)
    and tick a **per-unit capture meter** on `onTurnStart`.
- **Spec:** [`docs/design/systems/field-entities.md`](../../docs/design/systems/field-entities.md),
  [`docs/design/02-deployment.md`](../../docs/design/02-deployment.md),
  [`docs/design/03-combat.md`](../../docs/design/03-combat.md).
- **Superseded by:** —

## D13 — Material recovery + entity durability

- **Status:** Decided
- **Context:** What happens to placed-but-unused field entities after a battle —
  all-or-nothing, per-tile partial, or per-entity?
- **Decision:** **Outcome-gated, whole-field.** A **win** = control of the entire
  battlefield = recover **every** unsprung, intact entity left standing, **including
  the enemy's** (salvage into storage); **flee/lose → nothing.** (Mechanically the
  clean binary, framed as "control"; the earlier per-tile partial idea is dropped.)
  - Each entity carries **durability**: multi-use **charges** (a rope snare fires a
    few times before breaking) and whether its **material survives** use
    (recoverable) or is **consumed** (rune dust "wiped away," gone even on a win). So
    "recoverable on a win" = unsprung **and** intact **and** surviving-material.
- **Deferred (own follow-up):** **Ammo** handling — spent ammo should matter without
  making empty ranged units feel useless (per-unit vs. shared pool + the balance);
  and a **conditional Survivalist salvage perk** (higher % return) *if* we adopt
  spent-ammo/quantity pickups.
- **Spec:** [`docs/design/04-resolution.md`](../../docs/design/04-resolution.md),
  [`docs/design/systems/logistics.md`](../../docs/design/systems/logistics.md).
- **Superseded by:** —

## D14 — Inventory: party-wide slotted stacks; "wide logistics, micro at the unit"

- **Status:** Decided
- **Context:** How storage is measured shapes every provisioning decision; and where
  the game asks for player micro-management needed articulating.
- **Options considered:** (a) uniform slots / (b) **slotted stacks** / (c)
  weight/volume.
- **Decision:** **(b) slotted stacks, party-wide.** Storage is **one shared stash**
  of discrete **slots**, sized by the Merchant in bands (`+2 slots`). Each material
  has a `stackSize` (ammo stacks) and a `slotCost` (most 1; bulky items 2+). Honors
  both crunch (packing decisions, bulky items) and the banding convention (legible,
  Merchant-tunable). Per-unit carry is **not** used.
- **Principle adopted:** **wide logistics, micro at the unit** — logistics is
  party/macro (shared pools, provisioning); micro-management is unit-level
  (positioning, action economy, placement, triage). This is *why* storage is shared,
  and it pre-answers many "shared vs. per-unit" forks (e.g. it leans the parked ammo
  question toward a shared pool).
- **Spec:** [`docs/design/systems/logistics.md`](../../docs/design/systems/logistics.md),
  [`docs/design/README.md`](../../docs/design/README.md) (Conventions).
- **Superseded by:** —

## D15 — Upkeep: gold as the common denominator for maintenance

- **Status:** Decided (also resolves the Q8 "material spoilage" question)
- **Context:** Risk of *too many parallel meters*. Need a way to keep the logistics
  fantasy without burying the player in upkeep systems.
- **Decision:** **Collapse maintenance into a single gold Upkeep figure.** Dividing
  test: **interesting in-the-moment choice → its own system; necessary chore → a gold
  cost.** Bespoke (kept): CT clock, Deployment gamble, intel tiers, capture/rescue,
  RP triage, entity durability. Collapsed to gold: feeding, repairs, restock,
  emergency revive (the cleric, already gold).
  - **Upkeep = Σ per-job budget lines**, shown as one camp-menu number; adding a
    maintenance job adds a *line*, not a meter. Pay the total (chore) or **underfund a
    line** when broke (the *choice*).
  - **Categories (banded):** **Food** (Chef-owned, 1-night grace, **high** morale hit
    on breach) and **Repairs** (Blacksmith-owned, ~3-night grace, **moderate** morale
    hit + **gear condition** drop: −defense, −crit). Extensible.
  - **Gear condition replaces per-item equipment durability** — one funded/unfunded
    state + grace, then blanket penalties (no per-weapon meter).
  - **Debt = morale (option A):** unpaid Upkeep hits morale (D8); sustained **Low**
    morale night-over-night risks **desertion**. No new meter.
  - **Q8 resolved:** per-item **spoilage is dropped**; food is Upkeep gold (off the
    storage slots), so hoarding pressure is the steady gold drain instead of item rot.
- **Spec:** [`docs/design/systems/logistics.md`](../../docs/design/systems/logistics.md)
  (Upkeep), [`docs/design/systems/morale.md`](../../docs/design/systems/morale.md),
  [`docs/design/01-pre-deployment.md`](../../docs/design/01-pre-deployment.md).
- **Superseded by:** —

## D16 — Entity combos: chaining via the bus + CT-scheduled reactions

- **Status:** Decided (**provisional** — lowest-confidence call; revisit at M3/M4)
- **Context:** Should placed entities combine (rune-in-a-nest, trap-into-snare)?
- **Options considered:** (a) no stacking / (b) **chaining via the trigger bus** /
  (c) true fusion into compound entities.
- **Decision:** **(b).** Entities don't merge — on firing, an entity inspects its
  **own tile + 4-adjacent neighbors** for entities to set off and **schedules the
  reaction onto the CT clock with a `speed`** (`instant` → fires now; lower → a
  disruptable timer). This reuses the D5 charged-ability machinery wholesale, so
  combos get timing texture and counterplay with **zero new systems**. Rejected (c)
  as an authoring/balance burden that fights D15's restraint.
- **Spec:** [`docs/design/systems/field-entities.md`](../../docs/design/systems/field-entities.md)
  (Chaining), [`docs/design/systems/action-economy.md`](../../docs/design/systems/action-economy.md).
- **Superseded by:** —

## D17 — Magic is Vancian; the consumables family

- **Status:** Decided
- **Context:** The play-trace declared "all magic is Vancian." Need a model that fits
  the logistics identity without a heavy spell-management minigame, and that never
  leaves a mage feeling useless.
- **Decision:** **All magic is Vancian** (limited, expended — not at-will), in three
  forms:
  - **Default spell** — every mage has one **free, unlimited, weak** at-will spell so
    a depleted mage always contributes (Fire-Emblem-style floor).
  - **Scribed spells** — each mage scribes **X castings/day**; the player **allocates**
    those X across known spells (re-allocatable up to pre-deployment, then locked),
    refreshed on a **night's rest**. One number per mage — low friction.
  - **Scrolls** — consumable one-shot castings carried as **storage items**.
  - **Runes** are Vancian castings placed in Deployment, paid in **reagent cost** +
    the **deployment peril** (D11); freely placeable within those limits.
  - **Orthogonal to D5:** Vancian = how *many* casts; charge-time = *when* a cast
    resolves.
  - **Consumables family:** scrolls, reagents, and **ammo** share one rule set —
    storage-slotted, expended on use, **partially recovered on a win** (D13). The
    default-spell idea is the template for ammo's empty-feels-bad balance (its own
    discussion).
- **Spec:** [`docs/design/systems/magic.md`](../../docs/design/systems/magic.md).
- **Superseded by:** —

## D18 — Vision & fog of war (the in-battle twin of Intel)

- **Status:** Decided
- **Context:** The play-trace promoted in-combat vision from "future" to load-bearing
  (Rogue hides in fog; Archer fires only at what it "has visual of").
- **Decision:** **Symmetric fog of war** on a **banded information ladder**:
  - **Hidden** (nothing, or a **last-seen ghost**) → **Pinged** (presence/location,
    *no identity*) → **Seen** (full info).
  - **Two senses:** **Sight** = per-unit **radius + line-of-sight** (terrain/elevation
    block) → Seen. **Awareness ping** = a radius that **ignores LoS** → Pinged; this is
    Awareness's **in-combat** role (was deployment-only).
  - **Hides** enemy units + undetected enemy entities; terrain shape always known.
  - **Concealment payoff:** breaking from Hidden = **ambush bonus**; being **Pinged
    partially defuses** it, **Seen** removes it (Awareness = ambush defense).
  - **Targeting:** direct attack/cast needs **Seen**; **AoE** can hit any perceived
    (incl. Pinged) tile.
  - **Intel tie-in:** a **Tier-3** read grants **starting vision** of enemy deployment.
  - **Stat:** adds **sight radius** to the combat block (M3).
  - **Deferred:** stealth as a stat/trait (player to mull).
- **Spec:** [`docs/design/systems/vision.md`](../../docs/design/systems/vision.md).
- **Superseded by:** —

## D19 — Forced movement (push / pull)

- **Status:** Decided
- **Context:** The play-trace's Whirlwind shoved enemies into net traps — forced
  movement exists and shines when combined with placed entities.
- **Decision:** Effects can **push** (away) or **pull** (toward) a banded number of
  tiles.
  - **Involuntary:** costs the target no CT, doesn't consume their turn.
  - **Target-agnostic:** usable on enemies (shove into hazards) *and* allies (pull to
    safety — a support tool).
  - **Combo:** a forced move **onto a field-entity tile fires that entity** (push into
    trap/net/snare) via the bus's `onUnitEnterTile` — the unit-driven sibling of D16
    chaining.
  - **Collisions:** stop at a wall/blocker/unit, with **optional collision damage**
    (tuning).
  - **Vision (D18):** AoE push can catch a **Pinged** tile; single-target push needs
    **Seen**.
- **Spec:** [`docs/design/03-combat.md`](../../docs/design/03-combat.md) (Forced
  movement), [`docs/design/systems/field-entities.md`](../../docs/design/systems/field-entities.md).
- **Superseded by:** —

## D20 — Ammo: infinite basics + special-arrow consumables; recovery keywords

- **Status:** Decided (resolves the parked Ammo question; refines D13/D17 recovery)
- **Context:** Ammo risks being trivial at either extreme (perpetually starved or
  permanent surplus). Need scarcity that *matters* without ever making an archer feel
  useless.
- **Decision:** Split ammo into two layers, mirroring [magic](../../docs/design/systems/magic.md):
  - **Basic arrows are infinite** — the at-will floor, the archer-side twin of the
    mage's **default spell**. A ranged unit is **never useless**. (Fallback when out
    of specials = basic shot + the option to close to melee, i.e. C.)
  - **Special arrows are limited consumables** (fire, net/grounding, …) — the scarce
    tactical layer, working like scrolls/traps; storage-slotted, party-wide (D14).
  - Archers and mages thus share **one kit shape**: a free basic + a limited pool of
    specials.
  - **Recovery keyword (generalizes the consumables family):** every consumable
    (special arrows, scrolls, reagents) carries its **own `recovery` keyword** — an
    **N% chance to recover on a win** (net arrow ~50%, fire arrow 0%). This **refines**
    D13/D17's flat "partially recovered" into a per-item roll; the **Survivalist
    perk** boosts it.
- **Spec:** [`docs/design/systems/logistics.md`](../../docs/design/systems/logistics.md)
  (Consumables), [`docs/design/systems/magic.md`](../../docs/design/systems/magic.md).
- **Superseded by:** —

## D21 — Victory auto-rescues captured allies (refines D7/D9)

- **Status:** Decided (M5b implementation refinement)
- **Context:** D7/D9 said an ally **still captured at battle's end** becomes a
  **rescue follow-up quest** rather than dying. In play that felt punishing when you
  had *already won the battle* — you control the field, so why is your bound ally
  still gone?
- **Decision:** **A win auto-rescues every still-captured ally.** Victory = control
  of the field (the same principle as D13 whole-field **material** recovery), so
  captured allies are **freed and returned to the roster** in Resolution at no extra
  cost. The **rescue follow-up quest** (D9) now applies only to **non-win** outcomes
  (flee/lose with a captured unit) or **abandoning** the rescue mid-battle — capture
  is still dramatic (lost tempo, a −1 during the fight, the risk of *not* winning),
  but winning brings your people home.
- **Also (M5b):** **Deployment plays on the board** — units are selected and **walk
  the grid (A*)** like combat, placing entities where they stand; exposure is now
  **spatial** (a banded safe **depth** from your edge; placing deeper raises the
  meter), a closer fit to D11 than an abstract placement counter. The full D11
  auto-retreat-with-per-step-roll remains a later tuning pass over this seam.
- **Spec:** [`docs/design/02-deployment.md`](../../docs/design/02-deployment.md),
  [`docs/design/04-resolution.md`](../../docs/design/04-resolution.md).
- **Superseded by:** —

## D22 — Overworld shape: a seeded, layered node DAG

- **Status:** Decided (M7 design pass)
- **Context:** Through M6 a run is a **linear** chain — `run.ts` holds one
  `encounterIndex` and each fight is `streamFor(seed, "enc:N")`. M7 replaces the
  straight line with a navigable **map** the player branches through (the "run
  frame" the notes queued), while keeping determinism, permadeath, and the
  core/render split intact.
- **Options considered:** (a) a **layered node DAG** (Slay-the-Spire-style columns
  of nodes with forward-only edges) / (b) a free-roam node graph (arbitrary
  adjacency, pathfound) / (c) a branching tree (no path re-merges).
- **Decision:** **(a) — a layered node DAG.** It is deterministic, legible,
  trivially seedable and testable, and delivers "branching mission select" without
  a pathfinding overworld. The map is **seed-derived** (`streamFor(seed, "map")`),
  so replaying a seed reproduces the **same layout, node kinds, and edges**.
  - **Shape:** `MAP_GEN.layers` columns (default **7**). **Layer 0** is a single
    **start** node (the camp you begin at, never fought); the **final layer** is a
    single node (the run's last mission); interior layers are **`minWidth..width`**
    nodes wide (default **2..3**). Edges run **forward only** (layer `L → L+1`).
  - **Connectivity invariants (the generator guarantees):** every non-final node
    has **≥1 outgoing** edge and every non-start node has **≥1 incoming** edge, so
    **every node is reachable from the start** (no dead start) and the start can
    always reach the final layer (no dead end). A small extra fan-out
    (`maxFanout`) adds branch choices on top of the spanning edges.
  - **Difficulty ramps with map depth:** a combat node's encounter is
    `generateEncounter(streamFor(seed, "node:<id>"), node.layer)` — the **layer is
    the index**, so deeper missions are harder, reusing `generation.ts` unchanged.
- **Spec:** [`docs/design/systems/overworld.md`](../../docs/design/systems/overworld.md).
- **Superseded by:** —

## D23 — Node types & the camp relationship (minimal for M7)

- **Status:** Decided (M7 design pass)
- **Context:** A map needs node *kinds*. The full menagerie (shops, recruiters,
  events) is a later batch; M7 only needs enough to prove the frame.
- **Decision:** **Two kinds, both data-driven (D3/D4 ethos), no hard-coded
  branches in the loop:**
  - **`combat`** — a fight. Reuses `generation.ts` and the existing
    **Camp → Deployment → Battle → Resolution** flow unchanged.
  - **`rest`** — a **non-combat** between-battle camp recovery with **no fight**:
    a night of Upkeep plus a recovery bonus (extra Rest Points + auto-triage of the
    wounded + a small morale uptick, D8/D9). The **start** node (layer 0) is a rest
    node thematically (your starting camp), but is the entry position and is never
    *played*.
  - **Camp stays the Meta phase (D3)** that runs *before* a chosen **combat** node
    (upkeep, RP, dying clocks, provisioning, intel). The **overworld is the screen
    you return to between nodes** to choose the next one. A rest node is its own
    lightweight recovery beat, distinct from the pre-combat camp.
  - **Run terminals:** a **wipe** (no combat-capable roster unit) ends the run as
    before (`isRunOver`); clearing a **final-layer** node flags **run-complete** —
    a new terminal the overworld surfaces.
  - **Out of scope (next batch):** shops/merchants-as-nodes, recruitment, event
    nodes, narrative. Kept deliberately minimal.
- **Spec:** [`docs/design/systems/overworld.md`](../../docs/design/systems/overworld.md).
- **Superseded by:** —

## D24 — Intel pre-selection: a banded node preview (extends D10)

- **Status:** Decided (M7 design pass)
- **Context:** Branching is only a *choice* if it's **informed**. D10 made intel a
  per-encounter, party-wide, banded read; M7 needs to surface a slice of it on the
  **map**, before you commit to a node, so the player picks with intent.
- **Decision:** **`previewNode(run, nodeId)` returns a banded preview** for a
  candidate (reachable) node, wired to `intel.ts`/`readEncounter` and the party's
  `intelFloor` (D10):
  - **Node `kind` is always shown** (combat vs rest), and for a combat node its
    **encounter type** (open-field/fortified) is always shown — you always know
    *what shape* of node you're walking into.
  - **The party's intel floor reveals more** about a combat node's contents, banded
    exactly as D10: **Tier 1** enemy **types** → **Tier 2** the **count** → **Tier
    3** positions/starting vision. A **reward hint** is likewise banded (Tier 0
    hidden → a coarse gold **band** → an approximate figure → exact), so higher
    intel makes the branch choice sharper.
  - **Rest nodes** preview a recovery hint (no enemies to read).
  - **Stable for a seed:** previews derive only from the seed-built map + the
    deterministic per-node encounter + the party's floor, so the **same seed shows
    the same reachable previews** (no live RNG draw).
- **Spec:** [`docs/design/systems/overworld.md`](../../docs/design/systems/overworld.md),
  [`docs/design/systems/intel.md`](../../docs/design/systems/intel.md).
- **Superseded by:** —

## D25 — The guild/caravan layer: a three-tier strategic stack

- **Status:** Decided (overworld/guild design pass, 2026-06-06)
- **Context:** M7's overworld borrowed Slay-the-Spire's *shape* without its
  *engine* — in STS the map means something because every fight feeds the deck and
  **HP is the currency you spend to route**. Campfire has no deck; its equivalent of
  "the deck getting stronger" is **roster + stores + gear** = **logistics**. The
  run-frame also needs a persistent home so "between adventures" and "between fights"
  stop both fighting for the word *camp*.
- **Decision:** A **three-tier stack** sitting above the phase pipeline (D3):
  - **Guild hall** (NEW, persistent) — home *between* adventures: the roster pool,
    the armory, caravan assembly, several expeditions in flight.
  - **Overworld** — **one caravan's** adventure: the layered DAG of D22, now scoped
    to a single caravan (UI: drawn as a small mobile camp).
  - **Camp / Mission** — one node: Camp → Deployment → Battle → Resolution (D3),
    unchanged.
  - **A caravan is a persistent, typed, upgradeable vessel** bundling **party slots +
    storage (the D14 cap) + loaded supplies + locked equipment**. You own a **stable**
    of them on a size/speed/cost/capacity axis (*scout cart* ↔ *supply train*); pick
    the right vessel per quest. The Merchant raising storage (D14) becomes "upgrade a
    caravan's capacity." The caravan doubles as the **overworld camp** visual.
  - **Slots are UNIFORM** — any character fits any slot — so bringing a baker genuinely
    costs a warrior; caravan *size* is the only dial. (Role-segmented slots rejected:
    they make support picks "free" and kill the tension.)
  - **Three on-theme scarcities** this layer creates: **slots** (baker-vs-warrior),
    **the vessel** (which wagon's capacity), **locked equipment** (gear committed to one
    caravan is unavailable to others — can't field one good sword twice).
- **Spec:** [`docs/design/systems/guild.md`](../../docs/design/systems/guild.md),
  [`docs/design/systems/overworld.md`](../../docs/design/systems/overworld.md).
- **Superseded by:** —

## D26 — Run model & parallel adventures: one shared guild, two feeds, serial play

- **Status:** Decided (design pass, 2026-06-06)
- **Context:** How do **campaign** and **endless** relate, and how do "multiple
  adventures at once" work atop a synchronous node loop (`run.ts` holds exactly one
  map + position)?
- **Options considered (time model):** A **global guild clock** (interleaved) / B
  **focus-one, background the rest** (auto-resolve) / C **sequential with shared
  standing state**.
- **Decision:**
  - **ONE shared persistent guild** (one roster, one armory, one progression).
    Campaign and Endless are two **content feeds**, not separate saves. Accepted
    tradeoff: story-earned and sandbox-earned progress share a save (revisit cosmetic
    separation only if it feels muddy).
  - **A quest board** makes the two feeds concrete: **main quest** (campaign spine +
    ending) → **authored sidequests** (finite hand-made pool) → **repeating generated
    sidequests** (the infinite "endless" tail). The board is never empty, so idle
    caravans always have somewhere to go. Parallelism is **asymmetric** — one main
    thrust + a renewable side stream (Darkest Dungeon / Three Houses shape), not
    symmetric juggling.
  - **Model C — commitment parallel, play serial.** Commit people + gear across
    several caravans at once (the lock = the portfolio cost), but **play one caravan
    through at a time**; the guild clock advances between dispatches. Every fight stays
    hand-played. **Auto-resolve is rejected** — it dilutes the hand-played tactical
    core (the crown jewel). Clear path to graduate toward an interleaved global clock
    (model A) later.
  - **Dispatched-but-unplayed caravans WAIT** (paused at their node) — they don't tick
    a clock or auto-resolve.
  - **Code shape:** a **`Guild` owns N run states**; today's single map + position
    becomes one of many.
- **Spec:** [`docs/design/systems/guild.md`](../../docs/design/systems/guild.md),
  [`docs/design/systems/overworld.md`](../../docs/design/systems/overworld.md).
- **Superseded by:** —

## D27 — Stakes via permanent loss: unkillable guild + Fire-Emblem lords

- **Status:** Decided (design pass, 2026-06-06) · resolves the M7-deferred
  terminal-*meaning* design
- **Context:** What does failure mean now there's a persistent guild? The M7 endings
  ship functional, but their *meaning/rewards* were deferred.
- **Decision:**
  - **The guild never hard-fails** — there's always a cheap repeating sidequest to
    rebuild, so stakes come from permanent **losses**, not a fail screen. Two loss
    tiers already exist: **mission loss** per node (D13/D21) and **caravan wipe** =
    lose that caravan's people (permadeath) + its locked gear; the **guild survives**
    (Darkest Dungeon / Battle Brothers stakes).
  - **EXCEPT 2–3 named campaign "lords"** (Fire-Emblem-style): a lord dying *during the
    campaign* is **game-over → reload last save** ⇒ implies a **save system** for the
    campaign. An optional **hardcore/ironman** mode makes even that permanent (no
    reload). A lord in a caravan that wipes = game-over, so risking a lord on a deep
    node is a real gamble.
  - **Endings:** campaign-complete = clear the **main quest** (epilogue + unlocks that
    seed Endless); campaign-defeat = a **lord falls**; **Endless = depth/score, no
    terminal**, no lords.
- **Spec:** [`docs/design/systems/guild.md`](../../docs/design/systems/guild.md),
  [`docs/design/systems/overworld.md`](../../docs/design/systems/overworld.md) (Run
  terminals).
- **Superseded by:** —

## D28 — Overworld currency is gold; no physical rations (confirms D15)

- **Status:** Decided (design pass, 2026-06-06) · also resolves the parked
  "rations-as-routing-currency" idea
- **Context:** Does travel/rest spend a **physical ration item** or **gold**? The
  parking-lot notes floated rations as the routing currency; this resolves it the
  other way, preserving D15's restraint.
- **Decision:** **Travel and rest are paid in GOLD; D15 stands — no carried larder,
  no spoilage.** Food stays a gold **Upkeep** line. ⇒ **gold is the universal
  solvent**: travel, rest, provisioning, gear, bribes, debt all draw one pool, so the
  overworld is an **economic routing problem** ("can I afford this route + a rest?").
  Caravan **storage still gates gear/ammo/consumables** (D14/D20) — just not food.
  **Consequence:** the faucet/sink balance (D30) matters *more* — a slack economy
  trivializes the map. (Supersedes the note's "rations as routing currency" in favour
  of gold.)
- **Spec:** [`docs/design/systems/logistics.md`](../../docs/design/systems/logistics.md)
  (Upkeep), [`docs/design/systems/overworld.md`](../../docs/design/systems/overworld.md).
- **Superseded by:** —

## D29 — The overworld is a data-driven hook surface; abilities declare their limiter

- **Status:** Decided (design pass, 2026-06-06) · **provisional** on the limiter menu
- **Context:** Classes want to *act* on the overworld (Merchant hikes to town, mage
  scries for intel). The combat tier is already a hook surface (D3/D4); the overworld
  should be its twin rather than a difficulty menu.
- **Decision:** **The overworld is a second hook surface with its own action economy**
  (denominated in **node-steps / cooldowns**), alongside the combat CT clock (D5). An
  overworld ability is **data declaring a phase + a cost**, drawn from a deliberately
  **short limiter menu** (D15 restraint):
  - **Fatigue / exhaustion (NEW per-character meter)** — a single **shared** stamina
    meter overworld actions spend and **rest restores** (gives rest a second job; fits
    the caravan-as-people fantasy). E.g. the Merchant *can* hike to town, but not night
    after night. Keep it **one meter, not per-ability**.
  - **Vancian charges** — spells with overworld effects (scry for intel, forage) spend
    castings from the D17 pool. Magic unified across tiers.
  - **Node-refresh / gold cost / step-cooldown** — for whatever else fits.
- **Spec:** [`docs/design/systems/stats.md`](../../docs/design/systems/stats.md)
  (Fatigue), [`docs/design/systems/overworld.md`](../../docs/design/systems/overworld.md),
  [`docs/design/systems/magic.md`](../../docs/design/systems/magic.md).
- **Superseded by:** —

## D30 — The gold economy: one verb per economy class + an active theft vector

- **Status:** Decided (design pass, 2026-06-06)
- **Context:** With gold as the master currency (D28), the economy classes risk being
  three flavours of "gives gold," and faucets without sinks make **Upkeep (D15)**
  toothless.
- **Decision:** **One distinct verb per economy class, balanced by an active sink.**
  - **Merchant = ACCESS** — markets in the field (basic anywhere via the fatigue-gated
    town-trip, premium at town nodes, better prices everywhere). In-field buys use
    **run gold** (a flow), distinct from the **guild armory** (locked stock).
  - **Banker = TIME-SHIFT + SECURE** — buy-on-debt (auto-repaid from future gold),
    passive **financial** interest, and **theft protection**.
  - **Noble = INFLUENCE** — bribe enemies to turncoat / sway-avoid fights (leans on the
    D24 intel preview) **+ *political* income** (patronage, town levies, stipend,
    reputation) — deliberately distinct from the Banker's *financial* interest so the
    two aren't redundant faucets.
  - **Active theft vector (the sink-side partner):** pilfering is a real risk —
    **thief/bandit event nodes** skim gold on the overworld **and** a
    **gold/item-stealing enemy archetype** mid-battle — which is what gives the Banker's
    protect/debt/interest kit teeth (a live faucet↔risk loop). Cost = a thief enemy +
    theft events (fits the next event-node batch, D23).
- **Spec:** [`docs/design/systems/logistics.md`](../../docs/design/systems/logistics.md)
  (Economy), [`docs/design/systems/overworld.md`](../../docs/design/systems/overworld.md).
- **Superseded by:** **D61** (in part) — the Merchant's gold-minting `Trade`/`Market` is
  retired (Merchant = ACCESS + **sell**, not a gold faucet; access is a scarce **node**
  resource), and Noble political income moves from a clickable verb to **passive accrual**.
  The one-verb-per-class principle and the active-theft sink stand.

## D31 — Support units on the battle map + the defendable supply wagon

- **Status:** Decided (design pass, 2026-06-06)
- **Context:** Non-combat classes should be physically present as a "resource to
  protect," but classic escort gameplay is famously tedious (the Fire-Emblem "keep the
  green unit alive" groan).
- **Options considered:** opt-in fielding / always on the field / abstracted off-map.
- **Decision:** **Support classes are ALWAYS on the combat map, guarding a defendable
  supply wagon.**
  - The caravan's **supplies are an on-map asset** — a wagon/camp object modeled as a
    **D4 field entity** (position + state) that can be attacked and defended, and it is
    the **in-combat target of the D30 thief archetype**. "Protect your investment"
    becomes a concrete *defend-the-wagon* objective, not a vague escort.
  - **Support units deploy far back near the wagon and are low enemy-targeting priority
    by default** → not a constant babysit; the escort tension only spikes on a real
    threat. **Positional abilities:** strong in their home zone, weak if dragged out
    (e.g. **Chef by the campfire = bonus damage / hot-pan attack**) — the campfire
    literally on the battle map is a title callback and ties to the overworld-camp
    visual.
  - **Rule to pin:** enemy AI **deprioritizes** non-combat units + the wagon **except
    the thief archetype**, which actively seeks the supplies — that exception *is* the
    bodyguard gameplay.
- **Spec:** [`docs/design/systems/field-entities.md`](../../docs/design/systems/field-entities.md)
  (supply wagon), [`docs/design/02-deployment.md`](../../docs/design/02-deployment.md),
  [`docs/design/03-combat.md`](../../docs/design/03-combat.md).
- **Superseded by:** —

## D32 — Secondary classes (FFT-style) & non-combat leveling

- **Status:** Decided (design pass, 2026-06-06)
- **Context:** Characters should gain versatility via a second class, and non-combat
  classes need a way to level without fighting.
- **Options considered:** simultaneous dual-class (both active, growth split) /
  FFT-style primary + slotted secondary subset.
- **Decision:**
  - **FFT job model:** one active **primary** (defines stats/growth) + a **slotted
    subset** of a secondary class's abilities, re-arranged at the guild. More
    balance-controllable than simultaneous dual-class (a weaker slot-saver, accepted) —
    and it ties the secondary into the same slot economy (versatility per slot).
  - **Leveling:** **secondary** abilities level through **use** (slower — the primary is
    mostly active). **Non-combat jobs** level via a **passive trickle WHILE DEPLOYED +
    a bump per successful ability use** (benched = no growth, so the guild isn't free
    training); **combat jobs** level via combat XP as before. ("Level the secondary by
    using it" and "non-combat use-bonus" are one mechanism.)
- **Spec:** [`docs/design/systems/stats.md`](../../docs/design/systems/stats.md)
  (leveling), [`docs/design/systems/guild.md`](../../docs/design/systems/guild.md).
- **Superseded by:** **D38** (job model) + **D39** (hybrid leveling) — the deferred seam,
  now decided (D38/D39 refine the slot model and replace "primary defines stats" with
  permanent cumulative per-job stat gains).

## D33 — Recruitment: a three-tier roster (the BG3 split)

- **Status:** Decided (overworld/guild design pass round 2, 2026-06-06)
- **Context:** Where do party members come from? A flat "hire from a pool" answer would
  make every roster member interchangeable and waste the permadeath/lord stakes (D27).
- **Decision:** Members come from **two sources** feeding **three tiers** — the
  generic-mercenaries + authored-companions split (à la Baldur's Gate 3):
  - **Tier 1 — Mercenaries:** *randomized* (rolled stats/class), **gold-hired** from a
    **refreshing pool** (guild hall + future recruiter nodes, D23). Fully **expendable** —
    the literal **rebuild-after-wipe valve** that keeps the guild unkillable (D27).
  - **Tier 2 — Companions:** *authored*, **named, distinct, fixed *identity*** — an **authored
    (not rolled) starting class, flexible thereafter** (refined by D65) — gained
    **not with gold** but through **guild conversation, special quests, and mid-combat**.
    They still **level like anyone** (D32). Permadeath stakes, but **earned, not bought**.
  - **Tier 3 — Lords:** the **apex of the authored tier** — the **2–3** whose death is
    game-over (D27). "Authored cast" is thus a **spectrum**: lords → other named companions
    → mercenaries.
  - **Mid-combat recruitment reuses existing machinery** (zero new systems): a **bribed**
    (Noble INFLUENCE, D30) or **freed** (rescue, D21) **authored** character **joins the
    roster permanently** after the battle; a bribed **generic** enemy only **fights for the
    rest of the fight** (temporary, no roster bloat). The temp(generic)↔permanent(authored)
    flag is the whole new rule — the Noble's bribe verb and the rescue system **double as
    recruitment vectors**.
  - **"Guild conversation" = the guild-hall form of the interactable-camp idea** — you
    recruit some companions by talking to them at the hall (keep it visually distinct from
    the overworld camp, D35).
- **Deferred (per discussion):** the **authored-cast data shape** — how a companion
  declares its fixed identity + recruit hooks (conversation / quest-reward / combat-
  defector) — **depends deeply on mechanics not yet pinned**, so it is intentionally left
  for later rather than forced now.
- **Spec:** [`docs/design/systems/guild.md`](../../docs/design/systems/guild.md)
  (Recruitment).
- **Superseded by:** —

## D34 — The gold economy: two pools, a purse stake, purpose-bound currencies

- **Status:** Decided (design pass round 2, 2026-06-06) · refines D30
- **Context:** With gold the universal solvent (D28), the economy classes risked being
  three flavours of "gives gold," and faucets without sinks make Upkeep (D15) toothless.
  D30 gestured at "run gold (a flow)" vs. the guild armory but never settled the **gold
  pool structure** itself.
- **Decision:**
  - **TWO pools.** A persistent **guild treasury** (a **stock**: funds Upkeep, the armory,
    caravan upgrades between runs) and a per-caravan **run purse** (a **flow**: the tight,
    local **routing currency** spent in the field). Run = tight local pressure; guild =
    persistent wealth.
  - **Where each flow lands:** **loot → purse**; **quest payouts → treasury**; **travel /
    rest / field-buys / bribes → drawn from the purse**; **Upkeep → drawn from the
    treasury** between runs.
  - **Player-chosen purse, LOST ON WIPE.** At dispatch the player **allocates how much
    treasury gold to load** into the caravan's purse — a real risk dial; a **wipe loses it**
    like the people and locked gear (D27); **surviving purse returns** to the treasury on
    completion. The purse becomes a **FOURTH committed scarcity** (slots / vessel / locked
    gear / **purse**, extending D25). Theft now bites twice: skimmed purse gold can be lost
    entirely on a later wipe.
  - **Purpose-bound currencies keep passive faucets from trivializing Upkeep:**
    - **Noble political income → a separate INFLUENCE / reputation resource**, spent **only**
      on the Noble's verbs (bribes, sway-avoid, access). It **cannot pay Upkeep**, so it can
      never slacken the central pressure. (**Sharpens D30:** Influence *is* the Noble's whole
      economy; "political income" is no longer gold.)
    - **Banker is an OVERWORLD/PURSE actor.** Its whole kit fires **only in the overworld**,
      scoped to the **purse**: interest accrues on the carried purse, buy-on-debt repays from
      incoming run gold, theft protection guards the purse. Interest is **flat/diminishing +
      self-cancels** against its debt sink. The Banker **does not touch the treasury**.
    - **The guild treasury is a pure vault** (fluff: a guild **"treasurer"** holds it). With
      the Banker off it and the Noble's income now Influence, **no passive gold faucet feeds
      the treasury — its only inflow is earned quest payouts.**
  - **Headline principle — the field is the faucet, the guild is the buffer:** the only real
    path to wealth is loot + quest payouts, gated by the hand-played tactical core (the crown
    jewel). Passive income *smooths*, it never *replaces* winning fights.
  - **The explicit faucet↔sink loops:** **Banker** (purse interest ↔ debt + theft) ·
    **Noble** (political income → Influence ↔ bribes/sway/access) · **thief** (event-node +
    enemy archetype skim the purse ↔ Banker protection + recover-on-win: kill the thief → it
    drops the loot, a thief that escapes off-map keeps it, per the D13/D21 control principle)
    · **field-as-engine** (loot → purse, payouts → treasury).
  - **Discipline note:** Influence is one new currency (brushes D15's low-meter restraint) —
    accepted because it *retires* a gold faucet rather than adding one.
- **Spec:** [`docs/design/systems/logistics.md`](../../docs/design/systems/logistics.md)
  (Economy), [`docs/design/systems/guild.md`](../../docs/design/systems/guild.md) (treasury/
  purse), [`docs/design/systems/overworld.md`](../../docs/design/systems/overworld.md).
- **Superseded by:** —

## D35 — The overworld action economy: camp at every node; cooldown spine + loose fatigue

- **Status:** Decided (design pass round 2, 2026-06-06) · details D29
- **Context:** D29 pinned that the overworld is a second hook surface denominated in
  node-steps/cooldowns with a limiter menu (fatigue / vancian / cooldown / gold), but not
  *where* actions happen or *what paces* them — and three "camp"-ish surfaces (guild hall,
  overworld map screen, pre-combat Meta phase) were fighting for meaning.
- **Decision:**
  - **Camp at EVERY node — one unified between-nodes surface.** Arriving at any node opens
    an **overworld camp** (the "interactable camp" / title callback): take overworld actions,
    then choose the next edge. **The node-step is the tick** (the caravan advances node→node
    together). This **collapses three surfaces into one** — the old map screen (D23/D24), the
    interactable-camp idea, and the pre-combat **Meta phase** (D3/D23) are now the *same*
    surface — resolving the muddle to **two clean tiers: the guild hall** (between
    *adventures*) and **the overworld camp** (between *nodes*). The Meta phase becomes "the
    camp actions you take at a **combat** node before committing to the fight"; a **rest**
    node is simply the node themed on recovery (D23).
  - **Cooldowns are the spine.** Each overworld ability carries its own **node-step
    cooldown** (market, scout, scry, …) → every ability is **non-trivial to time even with
    the specialist** (a Merchant can't market every node). **Design principle:** *cooldowns
    encourage engagement* (use-it-or-waste-it → the decision is timing), whereas *tight
    hoardable pools punish use* (players hoard, the choice curdles into agony).
  - **Fatigue is a LOOSE over-extension guardrail, not a tight pool.** Kept, but in this
    codebase's **shallow asymmetric-floor** shape (D7/D11 deployment overdraw, D8 morale): a
    **generous per-character allowance, invisible in normal play, that bites only when you
    greedily skip rest and over-extend**. Keeps the over-extension stake **and** rest's
    second job (D29) without the per-camp agony. **Restored at rest nodes; overworld-only**
    (no bleed into combat readiness — D29's two-economies separation).
  - **Vancian charges + purse gold** remain (from the D29 menu) as **per-ability costs** on
    specific abilities, layered on the cooldown spine — not the global pace.
  - **Reusable principle recorded:** prefer **cooldowns** (decision = timing) to tight
    hoardable pools; when a depleting meter *is* wanted, give it the **shallow asymmetric-
    floor** shape — now applied three times (D7/D11, D8, fatigue).
- **Spec:** [`docs/design/systems/overworld.md`](../../docs/design/systems/overworld.md)
  (hook surface), [`docs/design/systems/stats.md`](../../docs/design/systems/stats.md)
  (Fatigue).
- **Superseded by:** **D61** (refines, not replaces) — the cooldown spine becomes the
  **pacing** half of a two-axis (pacing × price) limiter that *all* camp/overworld actions
  (incl. the previously-ungated job meta-skills) share, with the invariant that no action is
  both unpaced **and** unpriced. Camp-at-every-node, the loose-fatigue guardrail, and the
  cooldowns-over-hoardable-pools principle stand.

## D36 — Positional damage: support/pincer flanking (gap B, first half)

- **Status:** Decided (design pass, 2026-06-07)
- **Context:** `computeDamage` is flat `max(1, atk−def)` — an "isometric tactics" game
  where position barely matters. We want positional payoff without a facing/direction
  system (none exists, and adding one is heavy).
- **Decision:** A **melee** attacker gets a flat **+attack bonus** (≈+4, tunable) vs a
  target **T** when **≥2 of the attacker's side are adjacent to T AND no unit on T's side
  is adjacent to T** — *gang an isolated target; stay in formation and you're safe.*
  **Melee-only** (ranged already has a DPS/safety edge), **symmetric**, **binary**.
  Immobilized units count as a body (pincer/shelter); captured/downed don't. **Height/
  elevation deferred** (no tile elevation data yet). The AI must learn both halves
  (exploit + avoid) — folded into D42.
- **Spec:** [`M12-kickoff.md`](M12-kickoff.md) → Flanking.
- **Superseded by:** —

## D37 — Combat ability economy is *time* (extends D5)

- **Status:** Decided (design pass, 2026-06-07)
- **Context:** Combat skills only cost the Act → best-button spam (infinite Medic heal,
  a power strike always beating a basic). D5's charged abilities sit built-but-unused.
- **Decision:** The combat economy is **time**, paid on the CT clock — **no MP / no
  hoardable pools** (D35). Three layers: the **Act-vs-Move spend-down** (built), **charge-
  time** the offensive spine (commit now → resolve N ticks later via the `ScheduledEffect`
  gauge; arbitrary-N duration, displayed as "~turns"), and a **sparing cooldown** only on
  instant utility. **Basic attack = the instant floor.** Abilities differ in **kind** and
  scale by level/resource — never a "small vs big" duplicate. **Channels** = the dual of
  charged, two flavors: **maintained-stance** (caster keeps acting — built: the Hunter's
  Mark Prey) and **locked-emanation** (deferred to casters). **Fizzle** is a data-driven,
  extensible condition set (ship caster-death-cancels first).
- **Spec:** [`M12-kickoff.md`](M12-kickoff.md) → Combat ability economy.
- **Superseded by:** —

## D38 — The job model: any job can be primary; multi-job; flexible loadout slots

- **Status:** Decided (design pass, 2026-06-07). **Settles D32's job-model half.**
- **Context:** D32 left a thin "FFT secondary-class" seam; the combat/non-combat split
  (a `noncombat` flag gating the field) is too rigid.
- **Decision:** The **split dissolves** — *any* job (Knight, Chef, …) can be a unit's
  **primary**. "Primary" only sets the **XP-gain rate** and **class-gated content** (events/
  recruits that check the party's classes). Units **hold multiple jobs** and draw skills
  from all, bounded by **flexible loadout slots** (primary's full kit + `loadoutSlots`
  secondary abilities; **default 1**, a general slot system whose cap is a tunable
  character-boon). `isCombatant` stops reading `noncombat`.
- **Spec:** [`M12-kickoff.md`](M12-kickoff.md) → Job model.
- **Superseded by:** —

## D39 — Hybrid leveling & growth (fixes #2; settles D32's leveling half)

- **Status:** Decided (design pass, 2026-06-07, rev.). **Settles D32's leveling half.**
- **Context:** `unit.level`/`xp` is read by nothing — leveling has no payoff (#2).
- **Decision:** **Two axes.** **Character level** (the existing `level`/`xp`) = breadth/
  meta: the XP backbone + universal HP + a **boon hook at thresholds** (loadout-slot
  growth, future job evolutions/gating). **Job levels** (per job) = depth/specialty:
  **ability scaling** (each ability scales with its own job's level), a **skill-unlock
  breakpoint** (2nd active), and **permanent, cumulative stat gains** — **+1 to all main
  stats (universal floor) + a job-weighted bonus** (a **growth table keyed by stat**, so a
  future Seer/magic slots in). Primary sets the **baseline frame**; stats are kept
  forever (no "weak body" on switching). Emergent **generalist↔specialist** build axis.
  XP: character + primary full rate, secondaries trickle.
- **Spec:** [`M12-kickoff.md`](M12-kickoff.md) → Leveling & growth.
- **Superseded by:** —

## D40 — The combat-depth class roster (4 classes; 2-active+1-passive; synergy-first)

- **Status:** Decided (design pass, 2026-06-07)
- **Context:** Only one combat kit (Soldier) exists; the genre's fun is role interplay.
- **Decision:** Four interlocking martial classes, each **2 active + 1 passive** (passive =
  the identity anchor) + the universal basic attack & Defend: **Heavy Knight** (control —
  Hold-the-Line tarpit passive · Shove (D19 forced move) · directional Cleave), **Hunter**
  (ranged prey — Deadeye passive · Mark Prey channel · Reposition; ranged via an
  `attackRange` stat), **Scout** (playmaker — Flanker passive · Dash · Expose), **Medic**
  (sustain — Triage passive · herb-fuelled Heal · charged Mend). **Synergy-first** (combat
  rewards composition → logistics matters); the **combat↔logistics bridge** (abilities may
  consume provisioned consumables, e.g. the Medic's herbs — salve/stimulant/antidote).
  Charged *offense* + AoE + magic deferred to future heavy/caster classes.
- **Spec:** [`M12-kickoff.md`](M12-kickoff.md) → Class kits.
- **Superseded by:** —

## D41 — Statuses with teeth + the universal Defend action (gap F)

- **Status:** Decided (design pass, 2026-06-07)
- **Context:** Only Immobilized is honored; Taunt/Slow/Expose/etc. are cosmetic.
- **Decision:** A tight set — **Slowed, Exposed, Immobilized** (debuffs) + **Hastened,
  Guarded** (buffs) — each with **exactly one read-hook** (clock / `computeDamage` / AI).
  Cross-cutting consumers (the Medic's cleanse, the Hunter's Deadeye, the tracker tint)
  key off a **`kind: "debuff" | "buff"` classifier**, not id lists — so a new status (e.g.
  Poison) is one record + one hook. **Visual trackers required** (icon/badge + tint +
  tooltip via a status→visual registry). A **universal Defend action** (instant Act →
  self-Guarded until next turn) **re-homes Guarded** and gives the Chef a field verb;
  **standing orders** (auto-Defend until manual control) designed, built later. Authoring
  pattern graduates to `docs/guides/adding-statuses.md`.
- **Spec:** [`M12-kickoff.md`](M12-kickoff.md) → Status set; Defend & standing orders.
- **Superseded by:** —

## D42 — The scoring combat AI + fog-respecting combat (gap D)

- **Status:** Decided (design pass, 2026-06-07)
- **Context:** `ai.ts` is "A* to nearest, basic melee" — no range, no abilities, no
  flanking, never consults `canSee`. The new kits break it.
- **Decision:** Rewrite `planTurn` into a **light scoring AI** (enumerate reachable
  `(destination, action)` plans, score, pick). Must-haves: **ranged attacks, flank
  exploit+avoid, tarpit respect, target priority** (not nearest). In-scope optional:
  **enemy ability use** (≥1 debuffer), **charge/channel-interrupt** awareness, and
  **fog-respecting AI** (acts on `canSee` — elevating vision/**D18** from cosmetic to
  load-bearing; needs an unseen-enemy fallback). Difficulty-scaled competence deferred.
- **Spec:** [`M12-kickoff.md`](M12-kickoff.md) → Enemy AI.
- **Superseded by:** —

## D43 — Graded failure: objective failure ≠ party wipe

- **Status:** Decided (design pass, 2026-06-07)
- **Context:** Combat resolution is binary win/lose and a lost battle ends the run — a
  lost *objective* shouldn't equal a dead party.
- **Decision:** Failure is **graded**. A **quest/objective failure** (a timer lost, a boss
  escapes, an objective unmet) is **survivable**: it costs the **reward ± downed casualties
  (resolved per D9, not auto-permadeath)** and the **party retreats alive**. Only losing
  every combat-capable unit is a true **wipe**. Fits the **guild return-vs-wipe** model (a
  failed quest → the caravan *returns* without the prize; a wipe → the caravan is *lost*).
  General case = an `objective-failure` resolution distinct from win/wipe.
- **Spec:** [`M12-kickoff.md`](M12-kickoff.md) → Encounter 3; graded-failure principle.
- **Superseded by:** —

## D44 — The demo quest ("The Hollow Mill") + the authored-content substrate

- **Status:** Decided (design pass, 2026-06-07)
- **Context:** All content is procedural (`generation.ts` off a seed) — no way to author a
  tuned, hand-crafted slice (gap #4). The M12 decisions need a **proof harness**.
- **Decision:** A **short authored quest** — *The Hollow Mill*, a 5-beat arc (Provision →
  Skirmish → Rest/Level-up → Ambush at the chokepoint → Captain's Holdout) tuned so every
  M12 decision has a visible moment (teach → combine → test). Played in a **standalone demo
  mode** (bypasses the guild/overworld; reuses the combat pipeline). Requires an
  **authoring substrate** (`AuthoredEncounter` / `AuthoredQuest` + a demo runner) — the
  first hand-crafted-content shape (fills gap #4). It is the **proof before finalizing**.
- **Spec:** [`M12-kickoff.md`](M12-kickoff.md) → Demo quest.
- **Superseded by:** —

## D45 — The overworld economic ledger (the readout the routing pillar implied)

- **Status:** Decided (design pass, 2026-06-15) · extends **D28** (gold = routing currency),
  **D34** (two pools), **D35** (camp at every node)
- **Context:** The overworld is specced as an **economic routing problem** — *"can I afford
  this route **and** a rest at the end of it?"* (D28) — but no UI answers it. The player gets
  a one-line camp strip (`refreshCampText`: purse · morale · storage · kits · RP · debt ·
  Influence) and is left to infer the budget. Gold is the universal solvent (D28) and kept
  **scarce** by the faucet/sink discipline (D30/D34), so the budget *is* the decision — yet
  it's invisible and un-projected. The trap: any **"must-clear every night" panel** becomes
  the *agonized spreadsheet* D35/D16 explicitly designed against.
- **Decision:**
  - **A purse-scoped ledger surfaced on the overworld camp (D35), not the guild hall.**
    It reports the **run purse** flow only — loot in, upkeep/field-buys/bribes/theft out,
    Banker interest/debt/protection — consistent with the two-pool wall (D34). The
    **treasury** is the hall's concern; **Influence** is *shown but never summed into gold*
    (it can't pay Upkeep — D34). The ledger is **a pure projection of existing state** (the
    `previewNode`/camp-readout pattern): `computeUpkeep()` already yields `{lines, total}`,
    loot credits return `{credited, debtRepaid}`, Banker state lives on `run.overworld`.
  - **Progressive disclosure — broad categories, expand for crunch.** Default view = a
    handful of category totals (Upkeep, Loot, Field spend, Banker, balance); expand a
    category to its line items (e.g. `UpkeepBill.lines` → Food/Repairs). The crunch is
    opt-in, so the default stays a glance.
  - **Receipt *and* forecast — the forecast is the point.** A backward receipt is table
    stakes; the load-bearing feature is the **forward projection** — *"take this route +
    rest at the end → here's your purse at the bottom,"* reading the reachable nodes' rest/
    upkeep costs. This is what turns the ledger from bookkeeping into the **D28 routing
    decision surface**. (Receipt ships first; forecast is the reason to build it.)
  - **Jump-to-market when available.** A button into the Merchant/shop verbs *when they're
    actually usable* (town/rest node · Merchant present · off cooldown), reusing the
    existing `available`-gated event-choice + `merchantBuy` paths — so the player can size a
    buy against the budget before committing.
  - **"End the Night" = the node-advance, and the ledger gate rides it — softly (fork 1).**
    A new framing for leaving the current camp toward the next node. The ledger is **always
    one glance away** (a button on the camp), and the advance shows the bottom-line delta
    inline. It **hard-gates with a forced look only when something warrants it** — a
    projected shortfall, can't-afford-the-rest-at-route's-end, outstanding **debt**, or an
    **underfunded upkeep line**. In the happy path you advance with one click. This keeps
    the "no sleepwalking into a broke caravan" safety **without** the per-night chore D35/D16
    rejected — the forced choice surfaces only when you're actually pushing your luck (the
    same asymmetric-floor instinct as fatigue/morale/overdraw).
  - **Combat-node wrinkle — resolved (fork 2).** "The night ends" cleanly describes a
    **rest/event/travel** advance, but a **combat** commit *begins a fight* — the night
    doesn't end, it erupts. So: at a combat node the ledger is a **pre-commit glance**
    ("Commit — Begin Mission" stays), and the formal night-end **reconciliation** (the
    ledger's closing balance + the gate) fires at the **`recordNight` seam** — the existing
    "a night passed" boundary where `tickCooldowns`/`accruePurseInterest` already run — i.e.
    on returning to choose the next edge. One seam, no new clock.
  - **Voluntary underfunding — the ledger is an *input*, not just a readout (extends D15).**
    The player may **untick a budget line they could afford** (skip Food / Repairs) to free
    its gold for a riskier play — e.g. skip Food (−morale) to buy a powerful morale buff that
    nets the day **positive** morale. This promotes D15's parenthetical *"underfund a line
    (the choice)"* — today a broke-only fallback in `payUpkeep` — into a deliberate toggle on
    the ledger. The skip's existing consequences stand: Food = morale hit (immediate,
    recoverable); **Repairs = worn gear** (a *compounding combat-condition debt* paid later
    on the field — surfaced distinctly, "you'll fight at a penalty," not an undifferentiated
    untick). **Two riders:**
    - **The forecast carries its weight here:** the net (`−food morale + buff morale`) must be
      legible *before* committing — this is the D45 forecast doing double duty, so the gamble
      is informed, not blind.
    - **The soft gate keys off *intent*, not the funded bit:** a **voluntarily** unticked line
      is an intentional shortfall — the gate must **not** nag about it (you meant it), while
      still nagging about a line you genuinely **can't** afford. (`payUpkeep` gains a way to
      pass voluntarily-skipped line ids, vs. deriving `underfunded` purely from affordability.)
    - **Tuning watch (keep it a gamble, not arbitrage):** if a skipped line's only cost is a
      flat morale hit a buff easily beats, skip-Food becomes a no-brainer and **Upkeep (the
      central D15 sink) stops biting.** Give the skip real teeth — e.g. it bites the D8
      asymmetric morale **floor**, or repeated skips compound — so the margin you're spending
      is genuinely a risk.
- **Rejected:** a mandatory full-screen modal every night (the agony version — D35/D16); a
  treasury-inclusive ledger on the overworld (breaks the D34 pool wall); receipt-only with
  no forecast (leaves the D28 routing question still unanswered); a voluntary untick with **no
  morale/gear teeth** (free gold — guts the D15 upkeep sink).
- **Spec:** to write up in
  [`docs/design/systems/overworld.md`](../../docs/design/systems/overworld.md) (the ledger
  as the routing readout) on the next doc pass.
- **Superseded by:** —

## D46 — The node lifecycle / phase contract (the seam D35/D45/D47 all attach to)

- **Status:** Decided (design pass, 2026-06-15) · extends **D3** (phase pipeline), **D23**
  (node kinds), **D35** (camp at every node), **D45** (ledger)
- **Context:** D35 unified the camp, D45 added the ledger — but the **per-node sequence** was
  never pinned as one contract: *when* the night passes, *where* intel/economy actions sit
  relative to the event, where the ledger's two roles land, and **how rest fits** (a
  recurring source of confusion — see D47). Without a contract we risked parallel vocabulary
  and a per-node agony of surfaces (the D35/D16 anti-pattern).
- **Decision:**
  - **One node = one node-step.** The whole visit (prep → event → plan → depart) is a
    **single tick** of the overworld clock (D35) — not two.
  - **The kind-agnostic sequence:**
    1. **Arrive / Make Camp** — *pre-event* prep: provision for the day's event (heal, gear,
       buffs, pay upkeep). Ledger role here = **reconcile** (what tonight cost; can I still
       afford the event).
    2. **End the Night** — the gate; the night passes and the node's **event** fires *by
       kind*: **combat** = Deployment→Battle→Resolution (D3); **rest** = the premium recovery
       payload (D47); **event** = the choice resolves (D4/M11). Rest is the *event*, parallel
       to combat — **not** a pre-gate action.
    3. **Survey** (*post-event* beat, **new**) — now-informed: fund the scout for intel on
       the reachable nodes, last economy moves, **in-place rest** (D47), and read the ledger
       **forecast**. Deliberately **light / mostly optional** — soft-gated like D45, never a
       mandatory second panel.
    4. **Break Camp / depart** — choose the next edge and travel. **The node-step tick
       (`recordNight` → cooldown decrement + interest accrual) fires HERE, at departure** —
       so a single night's action allowance is *timed across the whole visit*, not duplicated
       mid-node. (Implementation consequence: move the tick off the payload to departure.)
  - **Terminology:** **"End the Night"** = the prep→event gate; **"Break Camp"** =
    depart→next-node (the word fits the *departure*). **Never** reuse "rest" for either gate —
    rest is a node kind + a recovery payload (D23/D47).
  - **Where rest fits (the clarification, so future-us doesn't lose it):** the "rest or push
    on" choice lives on the **map (routing)** — you rest by *routing to a rest node* — **not**
    as a camp toggle. Moving it into camp would dissolve the rest node's identity and revive
    the *dodge-every-fight, rest-is-free* failure mode the supply economy exists to kill. The
    one in-camp recovery action is D47's **in-place rest** (a costed lever in the Survey
    beat), distinct from the rest **node** (the premium tier).
  - **Two ledger touchpoints (D45):** **reconcile** at Make Camp, **forecast** at
    Survey/selection — the post-event numbers are the real ones, so the routing forecast
    belongs *after* the fight.
- **Rejected:** straight-to-map after Resolution (no informed post-combat intel beat — the
  D45 forecast would run on stale numbers); mandatory full panels at *both* ends (agony,
  D35/D16); "rest" as a gate name (collides with the node kind, D23); ticking the node-step
  at the payload (would split one night's allowance across the event seam).
- **Spec:** [`docs/design/systems/overworld.md`](../../docs/design/systems/overworld.md)
  (the node lifecycle) on the next doc pass.
- **Superseded by:** —

## D47 — The two-tier recovery economy (in-place rest vs. the rest node)

- **Status:** Decided (design pass, 2026-06-15) · adjusts **D9** (RP recovery), extends
  **D15** (rations gate), reshapes **D23** (rest node) / **D35** (fatigue restore)
- **Context:** D23 made rest a node *kind* and D35 made the rest node "the only [fatigue]
  restore," but recovery was otherwise all-or-nothing and purely **geographic**. We want a
  **costed, player-driven** recovery lever (the parked *"rest-in-place costing rations"*
  idea) **without** dissolving the rest node's identity or the D28 routing tension.
- **Decision:** **Two tiers, both built on existing machinery** (`payUpkeep` + `rpPerNight` +
  `triageHeal` — almost no new core):
  - **In-place rest — a repeatable camp action** (any *finished* node, the D46 **Survey**
    beat). Pay **a night's rations** (upkeep) → bank RP, **boosted by support classes** via
    `rpPerNight` (*that is* the class-boost — already in code) → heal a **small** amount
    (`triageHeal`). **Repeatable** until the purse can't afford another night.
  - **Each rest is a full node-step — and that's a feature.** It **ticks cooldowns and
    accrues interest** (D35): a deliberate lever — *spend a night's rations to buy HP **and**
    cooldown progress.* The player's call, a fun trade, **not** a leak.
  - **Two caps by design:** **gold** (can you afford another rations night?) **and** the
    **per-night RP rate** (one night banks only so much, so healing is **rate-limited
    regardless of wealth**) — the RP cap is what stops "rich = instant full heal" and keeps
    the rest node faster/better.
  - **Rest node = the premium tier:** a **large/full heal** in one stop, **plus** what
    in-place rest does *not* do — **full fatigue restore** (D35's guardrail stays
    rest-node-only) **and clearing accumulated debts in one swipe** (hunger /
    under-maintenance / worn gear from voluntary underfunding, D45) rather than needing a
    high-quality purchase. The payoff for **routing** there (D28).
  - **Heal floors at 1 (anti-confusion):** a paid in-place rest on a **wounded** party always
    restores **≥1 HP**, so the player never reads "paid rations, healed 0" as a gold-draining
    bug. If the party is **already full**, the action is **unavailable** (refuses without
    spending) — no empty drain.
  - **Balance stance:** this is a new **HP sink on gold**; it stays honest **only if gold is
    kept scarce** (D30/D34) — accepted as a deliberate balance burden worth the tuning time.
- **Rejected:** in-place rest that fully clears fatigue (guts D35's over-extension stake); a
  gold→HP pump with **no RP-rate cap** (rich = free full heal → rest nodes pointless);
  healing 0 when affordable-but-rate-capped (reads as a bug); rest as a camp toggle instead
  of node-routing (D46 — dissolves the rest node).
- **Spec:** [`docs/design/systems/overworld.md`](../../docs/design/systems/overworld.md) +
  [`docs/design/systems/logistics.md`](../../docs/design/systems/logistics.md) on the next
  doc pass.
- **Superseded by:** —

## D48 — The route forecast (intel-banded runway: fog · burn · fogged loot · floor-warning)

- **Status:** Decided (design pass, 2026-06-15) · is the load-bearing half of **D45** (the
  ledger forecast); extends **D10/D24** (intel), **D28** (gold = routing currency), **D46**
  (the Survey beat)
- **Context:** D45 named a *"forecast"* — *"this route + a rest at the end → purse at the
  bottom"* — but left **what it computes** fuzzy. Grounding it in the data exposed the
  governing fact: **cost is knowable, income is fogged.** Upkeep (`computeUpkeep`) is exact;
  loot (`def.reward.gold`) is only ever seen **banded by intel tier** (`rewardHint`). So a
  forecast can't be a precise number without leaking what the intel system hides — which
  *defines* its shape rather than limiting it.
- **Decision — four pillars:**
  - **Reach = overworld fog, scaled by intel (the new system).** Intel governs not just a
    node's *contents* but **whether you can see the route at all.** Visibility is
    `baseReach + tier × bandStep` steps forward; **base ≈ half the map** (fog is a
    *deep-planning* tool, not an early wall), each band extends it, and the numbers tune to
    **effectively infinite** (the safe fallback = full visibility). Two guardrails: the
    **immediately-reachable nodes are ALWAYS visible** (never stuck — the map-invariant
    spirit), and it's a **pure projection** (the map is known internally; fog is a visibility
    mask = a BFS cut at the reach limit; determinism intact, headless-testable). **Consequence
    (intended):** the nearest-rest / runway is now **intel-gated too** — seeing the *third*
    rest ahead is what intel buys. This is a small new system: a `visibleNodes(run)` reach
    projection + a fog pass in `OverworldScene.drawMap` (which today draws everything); the
    forecast operates over the **visible** set. This is the "depth vs. reach" split: the
    existing tier ladder is **depth** (types→count→positions, D10); this adds **reach**
    (distance) as the second axis.
  - **Burn = upkeep + visible node fees (the deterministic backbone).** The per-step cost is
    **upkeep** — *that is* the travel cost (no separate universal travel line; D28's lore
    satisfied without a new mechanic). On top, *special* nodes carry a **visible, known fee**
    (toll / town tax / gate fee), modelled as an **event-node kind reusing M11** — a
    "thief that tells you the price up front and doesn't sneak." Fees are **known in advance**
    (within reach) and **avoidable by routing** (pay only if you path through), giving the map
    its cheaper-longer vs. fee-gated-shortcut texture. So the forecast's cost side =
    `upkeep × steps + visible fees on the path` — fully deterministic within reach.
  - **Loot = fogged range, tightened by intel.** Income is shown as the **intel-banded
    range** (tier 0 = unknown, 1 = band, 2 = ~approx, 3 = exact), never beyond the player's
    tier (no fog-leak). Rest nodes earn nothing (cost-only → exact); events skim/cost.
  - **Warning = against the floor; display the range; intel clears warnings.** The D45 soft
    gate evaluates on the **pessimistic** (low-band) loot — so it **never reassures on gold
    you might not get** (false confidence is the one failure mode); the panel still shows the
    **full range** (the upside is visible). Fits the codebase's **asymmetric-floor / "never
    kick a player when down"** ethos (D8/D11/D35): cautious warning, reality usually better.
    **Intel pays off twice** — a tighter band **raises the known floor**, so **scouting a node
    can clear its warning** (a risky-looking route becomes safe once you learn the reward is
    high). Intel doesn't just reveal; it *relaxes* warnings.
  - **Horizon:** one committed step (banded loot) + the **runway to the nearest *visible*
    rest** (BFS over visible kinds). Not a whole-map projection — deep nodes are fog, branches
    combinatorial, and the decision served is "which edge next."
- **Shape (the seam to build):** a pure `core` projection — `projectForecast(run) →
  { visibleNodes, runway: { burnPerStep, nearestRestSteps, purseAtRest }, perEdge:
  [{ nodeId, costKnown, lootBand, purseAfter: {floor, ceiling}, warn }] }` — reusing
  `computeUpkeep` + `rewardHint` + the visibility BFS. The `previewNode` pattern, one tier up.
- **Rejected:** a precise-number forecast (leaks fogged loot); a whole-map projection (fog +
  branch noise); a fully fog-free map (the kinds-always-visible model — overridden here by the
  reach fog, deliberately, to make intel load-bearing for *planning*); warning on the
  mid/optimistic band (false confidence — the failure mode).
- **Open / deferred:** the **reach numbers** (base, bandStep) — tuning; whether **Scout
  extends reach** or only depth (lean: reach from the passive Intelligence floor + Seer; Scout
  deepens a node); the **fee event-kind data shape** (cost / pay-or-fight choice — folds into
  the deferred event batch, D23/D30).
- **Spec:** [`docs/design/systems/overworld.md`](../../docs/design/systems/overworld.md)
  (forecast + overworld fog) + [`docs/design/systems/intel.md`](../../docs/design/systems/intel.md)
  (the reach axis) on the next doc pass.
- **Superseded by:** —

## D49 — Authored set-pieces on the expedition frame (the node→authored seam)

- **Status:** Decided (design pass, 2026-06-16) · realizes **D44** (authored substrate) on
  the **D22/D23** overworld frame; the M14 framing decision
- **Context:** Two combat stacks run in parallel. Authored fights (the Hollow Mill, D44) play
  in their own renderer (`DemoScene`) over a linear `AuthoredQuest` beat list; the expedition
  (D22/D23) wraps the routing economy (D45–D48) around *procedural* fights in `BattleScene`.
  An authored encounter cannot sit in the real economy, and the demo is a patch beside the
  game rather than content inside it. D44 promised an authoring **substrate**, not a side mode.
- **Decision:** An authored encounter **binds to a map node** via an optional **`authoredId`
  on `MapNode`**, and encounter resolution becomes **run-scoped**: `currentEncounter`,
  `forecast.nodeLoot`, intel and `previewNode` all funnel through **one resolver**
  (`runEncounter(run, node)`) that returns the run catalog's `AuthoredEncounter` when
  `node.authoredId` hits, else falls back to `generateEncounter` (the single `nodeEncounter`
  funnel is preserved — no second path leaks into the loop). Authored vs procedural is **data
  resolved by a shared interpreter** (D4), not a branch in the loop or the renderer. Scope is
  a **framework milestone**: the general substrate + a general objective seam now, with
  objective *kinds* growing from content later. **Deferred:** cross-node narrative state (run
  flags / mini-events) and the D26 campaign-content build.
- **Spec:** [`path2-M14-build-prompt.md`](path2-M14-build-prompt.md) — Goal + Phase 1.1.
- **Superseded by:** —

## D50 — Encounter staging seam + multi-objective graded resolution

- **Status:** Decided (design pass, 2026-06-16) · extends **D43** (graded failure), builds on
  **D49**; the one-renderer-written-once convergence
- **Context:** Authored and procedural encounters are different shapes
  (`AuthoredEncounter` vs `EncounterDef`) staged by different code (`DemoRunner.stageEncounter`
  vs `RunLoop.startEncounter`), and the timed objective (D43's bridge-cut) is a single hard-
  coded archetype with a single `ObjectiveSpec`. The renderer would have to special-case the
  source and the objective — exactly the data-not-branches violation (D4) M14 forbids.
- **Decision:**
  - **One staging seam.** `nodeEncounter`/`runEncounter` return the union
    `EncounterDef | AuthoredEncounter` (the two producers stay separate); one core
    **`stageEncounter(source, roster, opts) → { battle, objectives }`** is what the renderer
    and the loop consume **uniformly** — the enemy-representation difference (specs vs
    placements) is hidden behind staging. Player-placement is a policy switch: authored honors
    explicit `playerSpawns`; procedural keeps the auto-edge `placePlayers`.
  - **Objectives are a list.** `objectives: ObjectiveSpec[]`, each **`required | optional`**,
    each resolving **`met | failed | pending`**, **tag-bound** (driver/span addressed by role
    or coordinate) so a generator can emit them later.
  - **One outcome function.** `encounterOutcome(staged) → win | objective-failure | wipe`:
    **wipe** if no combat-capable player remains; else **objective-failure** if any *required*
    objective failed; else **win** when all *required* objectives are met.
  - **M14 ships two kinds.** `eliminate-all` — a required **goal**, **met** when
    `Battle.outcome().winner === "player"` (a thin delegate over the unchanged primitive),
    **default-injected** when an encounter lists no explicit goal. `closing-gate` — a required
    **constraint** generalizing the bridge-cut: a timed gauge sweeping a coordinate span,
    **failed** when the gauge completes, **fizzling** when its tagged driver is killed or
    immobilized.
  - **Deferred:** optional-objective bonuses; explicit win-conditions that *override*
    elimination (end the fight while enemies stand); generated objectives/templates.
- **Spec:** [`path2-M14-build-prompt.md`](path2-M14-build-prompt.md) — Phase 1.2–1.4, Phase 2.
- **Superseded by:** —

## D51 — Graded failure on the overworld (extends D43)

- **Status:** Decided (design pass, 2026-06-16) · extends **D43**, consumes **D50**'s
  `encounterOutcome`, applies the **D9** mortality policy
- **Context:** D43 settled that an objective failure ≠ a wipe in principle, but the run loop
  (`RunLoop.resolve`) is still binary: a non-win battle ends the run and `recordNight` flags
  `complete` on any final-node survival. The graded third state has nowhere to land in the
  real economy.
- **Decision:** `resolve()` branches on `encounterOutcome` (D50). **Objective-failure** is
  survivable: the party **retreats alive**, downed units resolve per the **D9 mortality
  policy** (the *same* path a win runs — not auto-permadeath), the **reward (including XP) is
  forfeited**, and still-captured allies become **rescue quests** (the non-win path). On an
  **interior** node the run **continues** — the node counts as played, route forward as if
  cleared. On the **final** node there are three end-states: **win = complete (the prize)**,
  **objective-failure = the caravan returns alive without the prize** (distinct from complete
  *and* from wipe), **wipe = lost**. Fix: `recordNight`'s `complete` flag requires **all
  *required* objectives met** — not merely "survived the final fight". The end-screen grade
  reads the final node's history record. A test pins all three terminals.
- **Spec:** [`path2-M14-build-prompt.md`](path2-M14-build-prompt.md) — Phase 1.5, Phase 2.
- **Superseded by:** —

## D52 — The `AuthoredExpedition` substrate

- **Status:** Decided (design pass, 2026-06-16) · realizes **D44**'s substrate promise on the
  **D22** map + the **D25/D26** caravan-bundle entry; **retires** the `AuthoredQuest`/beat
  machinery
- **Context:** D44 shipped the authored substrate as a **linear quest** (`AuthoredQuest` +
  `ProvisionBeat`/`RestBeat`/`EncounterBeat` walked by `DemoRunner`) — a frame parallel to the
  overworld, not on it. With D49 binding authored encounters to nodes, the authoring unit
  should be a **whole expedition on the real map**, configured the way a future campaign quest
  would be (D26).
- **Decision:** A first-class core type **`AuthoredExpedition`** —
  `{ id, name, seed, map (a hand-built OverworldMap with authoredId on its combat nodes),
  encounters: Record<id, AuthoredEncounter>, bundle: { party, purse, supplies, storageCap,
  morale, difficultyId } }` — booted via **`createRunFromExpedition(expedition)`** into the
  **normal overworld path** (the same `RunState` a procedural run produces). Authored
  expeditions live in a **catalog keyed by id**; the run carries the catalog ref so a
  **snapshot rebuilds the authored map from `expeditionId`** (a seed alone can't — the map is
  hand-built, not generated). A small **validator reuses `reachableFrom`** to enforce the
  D22 connectivity invariants (no orphans, no dead ends, start reaches the final layer) on
  hand-built maps. Maps inherit the authored↔template↔procedural spectrum; **skeleton-fill is
  deferred**. Authored fights are **fixed/hand-tuned** (no `node.layer` difficulty scaling) but
  still respect the global **`difficultyId`** (the D9 mortality policy) — content fixed, stakes
  scale. The Hollow Mill is rebuilt as the framework's **first** `AuthoredExpedition`.
- **Spec:** [`path2-M14-build-prompt.md`](path2-M14-build-prompt.md) — Phase 1.1, Phase 3.
- **Superseded by:** —

## D53 — Leveling wired into the run loop (realizes the D32/D39 split)

- **Status:** Decided (design pass, 2026-06-16) · realizes **D32/D39** (the leveling split);
  the leveling helpers exist but **none were wired into the run loop**
- **Context:** `leveling.ts` has `routeCombatXp`, `accrueDeployedXp`, `grantAbilityUseXp`,
  `unlockedSkills` — the whole D32/D39 split — but the only caller was the retired
  `DemoRunner` (a flat per-beat award). M13 procedural runs never level; the Hollow Mill's
  L1→L2 unlock was a beat-machine artifact, not a run-loop mechanic.
- **Decision:** **Combat units earn combat XP from combat events.** A core accumulator
  subscribes to `battle.bus`: a **defeat** (`unitDefeated`) credits the kill to its `source`;
  **surviving a hit** (`unitDamaged` with the struck defender at `hp > 0`) is a smaller bump to
  that defender. XP is **tallied during the battle and committed at `resolve()`** via
  `routeCombatXp` **to units that survive resolution** — no mid-battle level-ups — **plus** the
  objective **`reward.xp`** on a **win** (`xp` folds into `EncounterReward`). Non-combat units
  keep their path: **`accrueDeployedXp`** at the node-step (the `breakCamp`/`recordNight` area)
  and **`grantAbilityUseXp`** on support/overworld ability use. Combat-event XP is
  **universal** — M13 procedural runs now level too. Ship **conservative defaults**; hand-tune
  only the **Hollow Mill** curve so its L1→L2 unlock still lands after E1. **No XP on
  objective-failure or wipe** (XP is part of the forfeited reward, D51). A **procedural
  leveling-balance pass is deferred** (it rides the parked gold-scarcity tuning).
- **Spec:** [`path2-M14-build-prompt.md`](path2-M14-build-prompt.md) — Phase 1.6, Phase 3.
- **Superseded by:** —

## D54 — The enemy trap-field + the trapper↔Hunter synergy (Survivalist subsumed into the Scout)

- **Status:** Decided (2026-06-17) · extends **D6/D7** (logistics/traps) and the **D40** class
  kits; **supersedes** the M12-kickoff note that the Survivalist stays a first-class job "not
  absorbed into a combat class"
- **Context:** The Survivalist's Set Trap was dormant — only the `survivalist` job held it and
  no demo party fielded one, so the trap lever never appeared. Separately, the Hunter's
  **Deadeye** passive (+damage vs *debuffed* foes) had no in-party enabler, and the audit found
  the trap mechanic had no felt "why do this."
- **Decision:** Three moves, one loop.
  - **Enemy trap-field (D12):** an authored encounter pre-places **concealed enemy traps**
    (`makeConcealedTrap`, owner=enemy, `recoverable:false`) — spring on player entry, spotted via
    an **Awareness roll** (passive each turn + an active **Search**), and harvested **only** by a
    trap-trained unit who **disarms** a spotted one (never auto-salvaged). The Hollow Mill gains a
    main-path node, *The Sapper's Snares*.
  - **Subsume the Survivalist into the Scout:** the fast playmaker now plants **and** disarms
    snares (`set-snare`, Deployment). No dedicated trapper character — Vale the Scout carries it.
    Disarm is gated on *holding a trap skill* (`canDisarm`), not a hard-coded jobId.
  - **Trapper↔Hunter synergy:** a snare deals damage **and Immobilizes** (a `debuff`), which is
    exactly what the Hunter's **Deadeye** punishes. The Scout *sets up* the Hunter's enhanced
    damage: snare the prey → Rook's Deadeye cashes it in.
- **Spec:** `src/core/traps.ts`, `entities.makeConcealedTrap`/`makeTrap` (status), `jobs` (Scout
  `set-snare`), `hollow-mill` (*The Sapper's Snares*).
- **Superseded by:** **D82** (the "never auto-salvaged" clause only — a win now sweeps
  unsprung snares while a trap-trained survivor stands; disarm remains the mid-fight harvest).

## D55 — Playtest QoL: move-through-allies, no-action auto-pass, keyboard + legend

- **Status:** Decided (2026-06-18) · pre-playtest quality-of-life pass; touches the
  **D42** movement/AI seam (`reachableTiles`/`occupiedGrid`) and the `BattleScene`
  interaction layer
- **Context:** A first hands-on pass surfaced a hard stall: a player unit ringed by
  bodies had **zero reachable tiles**, and the battle had **no way to pass a turn**, so
  the clock deadlocked (`onAdvance` early-returns while a unit is "waiting"). Bodies
  hard-blocked movement, there was a single keyboard shortcut (`T`), and nothing
  explained the board's vocabulary to a new tester.
- **Decision:** Four moves, all aimed at letting a playtest feel the *game* and not the
  friction.
  - **Move through your own ranks:** `reachableTiles` and the `occupiedGrid`-backed
    `planMove`/`planAttack` (plus deploy/rescue) now route **through living, un-captured
    allies** — a unit can cross a friendly body but never *stop* on an occupied tile
    (callers trim a budget-clamped path back to the last free tile). **Enemy and captured
    bodies still block the lane** (zone-of-control preserved). Symmetric: the AI and the
    danger-zone read it too.
  - **No-action auto-pass + Wait:** every player turn offers an explicit **Wait (W)**
    verb, and a unit with *no* legal action (no reachable tile, no strikeable foe, no
    skill/Search/Disarm/Bribe/rescue) **auto-passes** — the universal backstop so the
    clock can never stall.
  - **Keyboard:** one `keydown` router — **Space/Enter** = Advance/confirm, **W** = Wait,
    **1–9** = the active unit's skills, **Esc** = cancel a targeted skill/bribe *or* Undo
    Move, **T** = danger zone, **F** = animation speed, **L** = legend, **Tab** = next
    unit (deploy).
  - **Legend (L):** a toggleable Tokens / Tiles / Turn-order / Keys reference panel.
- **Follow-up (same pass):** three more feel fixes.
  - **Two-step turn + Undo:** clicking a tile is now a **tentative move** that does *not*
    end the turn — the unit walks, then the player attacks / uses a skill / Waits, with
    **Undo Move** (Esc) to snap back to the start tile. Clicking a foe still
    closes-and-strikes in one go (the express lane). CT is unaffected by `moved` (only
    `acted` costs more), so deferring the commit needs no special accounting; a move that
    springs a trap **locks** (no take-back on damage taken). Post-move the preview drops
    the move-range/flank washes and telegraphs only the in-place strike.
  - **Skill-key chips:** each active button is numbered (`1 …`) to advertise its 1–9 key.
  - **Animation-speed toggle (F):** cycles move-tween speed 1×/2×/4× for snappier pacing.
- **Spec:** `src/core/ai.ts` (`reachableTiles`, `occupiedGrid` `passAllyOf`),
  `src/core/planning.ts` (`stoppablePrefix`), `src/game/combat-view.ts`
  (`drawPreview` `moved` + `inPlaceForecast`), `src/game/scenes/BattleScene.ts`
  (`onKey`, `cycleSpeed`, `tentativeMove`, `undoMove`, `waitUnit`, `noActionsAvailable`,
  `toggleLegend`).
- **Superseded by:** **D60** refines the *Two-step turn + Undo* follow-up into the
  free-move turn (incremental budget, no auto-path, explicit End Turn). The move-through-
  allies / auto-pass / keyboard / legend moves stand.

## D56 — The headless run simulator (balance + robustness rig)

- **Status:** Decided (2026-06-18) · playtesters delayed, so generate our own signal;
  builds on the already-first-class headless seams (`RunLoop.autoTraverse`/`autoBattle`,
  the **D-logistics** `PlaytestLog`/`summarizePlaytest`)
- **Context:** With human testing on hold we still need two signals: **robustness** (does
  the loop hold under thousands of seeds — the class of bug D55 just fixed) and a
  **difficulty floor** ("if a random run always wins, something's wrong"). The engine was
  already built for this — the only gap was a batch runner + aggregator.
- **Decision:** A thin **`src/core/sim.ts`** layer that drives **only** the public
  `RunLoop` seams + the `PlaytestLog`, never a parallel copy of any rule — so every future
  encounter/job/node/objective is covered the day it lands.
  - `simulateRun(makeRun)` mints a run, attaches a log, `autoTraverse`s to a terminal
    (capturing throws as data), and returns a graded `RunResult` (complete/over/stall/
    crash + end-layer + the lever summary). `batchSimulate` + `aggregate` roll N runs into
    a `SimDigest`; `formatDigest` renders it.
  - **`src/core/sim.test.ts`** is the **first-class guard** (runs under `npm test`/CI): a
    fixed representative party over 80 procedural seeds + the Hollow Mill must **terminate**
    (no soft-lock), **never throw**, and **replay deterministically**. It also prints the
    digest (`npm run sim`, via `process.stdout.write`) and a **report-only** difficulty
    tripwire (no CI fail yet — balance is moving).
  - **Naive bot = the floor (honest caveat):** it plays tactically dumb and the headless
    path skips deployment, the meta-economy and the full kit — so its completion rate is a
    *lower bound* (high ⇒ too easy; low is inconclusive), and the **end-layer histogram** is
    the real wall-finder. First read: ~5% procedural completion, wall at layer 6; the choice
    levers (skip-food / capture-risk / in-place-rest) read 0% — the concrete case for the
    next layer.
  - **Next layer:** a pluggable **battle policy** so we can swap variants and **A/B** over
    identical seeds — shipped as **D57**.
- **Spec:** `src/core/sim.ts`, `src/core/sim.test.ts`, `npm run sim`.
- **Superseded by:** —

## D57 — Pluggable battle policy + the pilot policy (the enemy-AI A/B seam)

- **Status:** Decided (2026-06-18) · realizes the D56 "next layer"; wraps the **D42**
  scoring planner without changing it
- **Context:** D56 wanted to A/B AI variants, and the planner (`planEnemyTurn`) was called
  by name in three places (`Battle.runEnemyTurn`, `RunLoop.autoBattle`, telegraphing).
  Hard-coding the planner blocked both AI experimentation and the sim's A/B.
- **Decision:** A one-method **`BattlePolicy`** seam (`{ name, plan(unit, units, grid, opts)
  }`) and a single **`PILOT_POLICY`** that wraps the existing scoring planner verbatim — our
  baseline, the default on both sides, so play is **unchanged**.
  - `Battle.runEnemyTurn(unit, policy = PILOT_POLICY)` plans through the policy; `autoBattle`
    was de-duplicated to drive `runEnemyTurn` per acting side (it had inlined a copy of the
    same plan→execute→endTurn).
  - `RunLoop.policy = { player, enemy }` (mirrors `log`) is the side-by-side A/B knob; the
    sim threads it via `SimOptions.policy`. A do-nothing policy is proven load-bearing both
    at the `Battle` level and **through the sim** (a passive enemy lifts completion vs pilot).
  - The interactive game is untouched (enemies default to pilot); telegraphing still reads
    the pilot planner directly (it forecasts the actual enemy behaviour).
  - **Not built:** smarter policies and a **meta-policy** for the choice levers (node pick /
    camp spend) the naive bot reads 0% on — the scoreboard (D56) is ready to grade them.
- **Spec:** `src/core/ai.ts` (`BattlePolicy`, `PILOT_POLICY`), `src/core/turn.ts`
  (`runEnemyTurn(unit, policy)`), `src/core/runloop.ts` (`policy` field + `autoBattle`),
  `src/core/sim.ts` (`SimOptions.policy`).
- **Superseded by:** —

## D58 — Decluttering the overworld camp (tier + collapse)

- **Status:** Decided (2026-06-18) · UX/legibility pass on the **D35** unified camp; pure
  presentation — the loop, actions and rules are untouched
- **Context:** First-look feedback: the Make Camp screen is dense and opaque to a newcomer.
  It stacked **~13–15 buttons** in three equal-weight sections (Overworld Actions / Camp /
  Economy), had **two trap-kit buys**, surfaced **Scout on both camp and Survey**, leaked
  class-verb jargon into labels ("Engage Purse Interest", "Buy-on-Debt", "Collect Political
  Income"), and crammed **9 stats** onto the always-on HUD line.
- **Decision:** Tier the screen by what a player actually decides, hiding depth (not cutting
  it). Pure `OverworldScene` presentation.
  - **Primary, always visible:** the signature job meta-skills (Chef/Merchant — *the hook*),
    a single **Buy Trap Kit** (Merchant-priced if one rides along, else flat — kills the
    duplicate), **Triage Heal**, the **Ledger**, and the prominent **End the Night** CTA.
  - **Advanced ▸ (collapsed by default):** the optional gold economy — Market, Banker
    (invest / borrow / guard), Noble (gather influence) — behind one toggle, with the
    Banker's purse-state (interest/debt/protection) + Influence shown *there*, in context.
  - **De-jargoned labels:** plain verbs ("Invest the purse", "Borrow 40g", "Guard the
    purse", "Gather influence", "Shop the market"); the class + mechanic live in the hover.
  - **Trimmed HUD line** to the four decision-relevant groups: **Purse · Morale · Storage
    (Kits) · RP · Upkeep/night**.
  - **Scout** removed from the pre-mission camp (you've already chosen the node) — it stays
    on the **Survey** beat where planning-ahead belongs.
  - **Map hint slimmed + a corner legend.** The always-on hint dumped a 7-glyph legend; it's
    now action-only, with a small muted key pinned to the map's bottom-left (rendered in the
    **default font**, like the node glyphs, so the key matches the board). Hover still
    previews each node.
  - **Review Route Map.** Camp/Survey hide the map; a "Review Route Map" button opens it
    **read-only** (`drawMap(false)` — hover-previews, no commit) with a **← Back**, so you can
    re-read your route/fog mid-camp without leaving.
- **Spec:** `src/game/scenes/OverworldScene.ts` (`renderCamp` tiering + `campAdvanced`
  toggle, `trapKitPrice`/`buyTrapKit`, `refreshCampText`, `drawMapLegend`, `drawMap(interactive)`
  + `drawNode(interactive)`, `reviewMap`).
- **Superseded by:** —

## D59 — Icon registry: one source of truth for symbols, glyphs verified, atlas-ready

- **Status:** Decided (2026-06-18) · the foundation of the information-communication pass;
  extends the **theme.ts** token discipline (FONT/COLOR/INK/ROLE) to symbols
- **Context:** Icons were the one visual atomic with **no source of truth** — scattered
  inline string literals. That's how the map legend drifted from the board (D58) and how
  **emoji-range glyphs** (⚔ ⚖ ⛩ ⚠ ⏳ ☠ 💥 ❄ ✚) slipped in; those degrade to boxes/× wherever
  an emoji font is missing, and `?` ambiguously meant **both** story-event and fogged.
- **Decision:** Settle the **seam now, art later**. A new `src/game/icons.ts` `ICON` registry
  is the single source of truth — each concept → `{ glyph, label, color?, frame? }`.
  - **v1 renders glyphs**, from a palette **verified (by render test) to render in Courier
    Prime**, the bundled UI font — so symbols are identical on web/Steam/mobile with no
    reliance on a platform emoji font. Node kinds remapped to safe glyphs: fight `‡`, rest
    `≈`, goal `★`, thief `$`, shop `¤`, recruit `✚`, story `?`, toll `╫`, **fogged `◌`**
    (disambiguated from story).
  - **`legendLine(keys)`** generates the legend straight from the registry — it can never
    drift from the board again.
  - **`placeIcon()`** is the **atlas swap point**: v1 returns a Text glyph; give an entry a
    `frame` and teach `placeIcon` to prefer an atlas Image and call sites (board markers)
    don't change. The overworld node markers already route through it.
  - **Migrated — overworld:** node glyphs, event icons, legend, fogged marker, visited tick,
    the camp Advanced ▸/▾ toggle.
  - **Migrated — combat:** flank pip (`⚔`→`‡`), lethal (`☠`→`†`), charging (`⏳`→`◷`), the
    trap markers (player `✸`, armed `▲`, sprung `✕`), the trap-sprang hint (`💥` dropped), the
    objective-progress mark (`⚠`→`!`), and the L-legend block. The whole render layer now reads
    one registry. **Core status glyphs stay in `core/status.ts`** (plain ASCII `I/S/X/H/G/F/M`)
    — the core/render split means the game-side registry can't reach them, and they're safe.
- **Spec:** `src/game/icons.ts` (`ICON`, `IconKey`, `legendLine`, `placeIcon`),
  `src/game/scenes/OverworldScene.ts`, `src/game/combat-view.ts`,
  `src/game/scenes/BattleScene.ts`.
- **Superseded by:** —

## D60 — Free-move combat turn (Fire-Emblem-style movement rework)

- **Status:** Decided (2026-06-19) · playtest feel pass; reworks the `BattleScene`
  interaction layer and the `CombatView` turn preview, refines **D55**'s two-step turn
- **Context:** A hands-on playtest read the battle interaction as **slippery** and
  opaque: clicking a foe **auto-pathed the unit clear across the board** and struck in
  one motion (`planAttack`), a tile-click spent the **whole** move budget at once, ranged
  units **shuffled erratically** toward foes to get in range, and a turn **ended the
  instant you acted** with no visible "your turn is over" beat — the D55 two-step softened
  this but kept the express-lane auto-path and the single all-or-nothing move.
- **Decision:** A unit spends a **movement budget tile-by-tile across as many clicks as it
  likes**, and its **one Act** (attack / skill / Search / Disarm / Bribe / rescue) can fall
  anywhere in that sequence — *move 2, strike, move 2 more*. The turn ends **only on an
  explicit End Turn** (the prominent primary button, now relabelled per turn, plus Space /
  W), or **auto-ends once both halves are spent** (Act used *and* no movement left) — never
  as a silent side effect of acting.
  - **Incremental move, no auto-path:** clicking a **lit** (in-budget) tile walks just that
    leg and subtracts its cost from `moveBudget`; the blue reach wash shrinks as the unit
    steps. Clicking a foe **only strikes if it's already in range** — out of range just
    prompts "move closer". This kills the slide and makes **ranged units predictable** (they
    never auto-advance). Movement reads off the same `reachableTiles` flood as the preview, so
    they can't disagree (tarpit-ring cost included).
  - **Fire-Emblem read:** hovering a reachable tile **lights the exact route** to it
    (`hoverPath`, destination ringed); foes the unit can hit **from where it now stands** get
    a red strike outline + damage forecast (suppressed once the Act is spent).
  - **Act ≠ end of turn:** the core `Battle.useSkill`/`useHeal` gained a **`commitTurn`**
    option (default `true` — the AI and headless sim are unchanged); the render layer passes
    `commitTurn: false` so a skill resolves (effect + cooldown/charge) but leaves the unit on
    the clock to spend leftover movement. The scene then ends the turn itself, spending CT
    from what the unit actually did (`moved`/`acted`; a `spend: "move"` skill stays cheap).
  - **Undo** snaps **all** of the turn's movement back to the start tile and restores the
    full budget — allowed until the Act is taken or a sprung trap locks the move (HP lost).
  - **Wait → End Turn:** the universal pass verb is now **End Turn** (still W); the auto-pass
    backstop for a unit with no legal action (D55) routes through the same exit.
- **Spec:** `src/core/turn.ts` (`useSkill`/`useHeal` `commitTurn`), `src/game/combat-view.ts`
  (`drawPreview` opts: `moveBudget`/`acted`/`hoverPath`), `src/game/scenes/BattleScene.ts`
  (`beginPlayerTurn`, `recomputeReach`, `turnHint`, `canMoveFurther`, `turnExhausted`,
  `endPlayerTurn`, `afterActionContinue`, `moveStep` (was `playerMoveStep`; now the one
  weighted step for deploy + battle), `playerAttack`, `playerRescue`, `onPointerMove`, `noteAct`).
- **Superseded by:** —

## D61 — The overworld action-economy limiter model + the market-access axis (Merchant rework)

- **Status:** **Decided + Built** (2026-06-19) · the limiter model + market-access axis shipped
  (see the **build-progress** notes below); any remaining sub-items flagged **Open**/**Deferred**
  inline. Reworks parts of **D30** (the gold economy / Merchant role) and **D35** (the overworld
  action-economy spine), and opens a new **map axis** on **D22**'s `MapNode`.
- **Context:** Playtesting flagged that **camp actions could be used an unlimited number of
  times**. The investigation found this was not one rogue action but a **limiter patchwork**:
  the signature job meta-skills (Chef **Cook Stew**, Merchant **Trade**) flowed through
  `useCampJobSkill` with **no cooldown, fatigue, or cost** — the `spend: "act"` they declare
  is a *combat-CT* limiter that is meaningless on the overworld surface — so each click minted
  gold / morale / banked heal **and** ability-use XP without bound. Two deeper problems
  surfaced underneath:
  - **The Merchant's `Trade` is a money-printer** (`+50g` from nothing), which **contradicts
    its D30 role** — *"Merchant = ACCESS, the one economy class whose verb is **not** 'gives
    gold'."* The `+50g` Trade is an M5-era placeholder that predates the D30/D34 economy pass.
    Worse, the **Market** overworld ability (D30 ACCESS, cooldown 3) **reuses that very same
    minting effect**, so the costless `Trade` button silently undermined Market's cooldown —
    two buttons, identical effect, different rules.
  - **`Gather Influence` (Noble) is the same unlimited-faucet bug**: each click mints
    Influence with no gate, and Influence buys bribes that turn/recruit enemies. Its sibling
    faucet, the **Banker's interest**, *accrues passively per node-step* — revealing that
    political income was meant to be a **passive faucet**, not a spammable button.
- **Interim stopgap (shipped, branch `claude/unlimited-camp-actions-w1w8d3`):** a
  per-node use cap (`SkillDef.usesPerNode`, default 1 on Cook Stew / Trade) tracked in
  `OverworldEconomy.campUses`, reset on the node-step (`tickCooldowns`), enforced by
  `useCampSkillAtNode`. It stops the bleed; the model below **subsumes** it.
- **Build progress (2026-06-19, branch `claude/unlimited-camp-actions-w1w8d3`):** the
  **additive market core is built + green** (501 tests) in four slices —
  (1) the **market-access node axis** (`MarketTier`, `MapNode.market`, per-node-stream
  seeding, `merchantFloor`/`effectiveMarketTier`); (2) the **valuables/loot item class** +
  `saleValue` on functional materials; (3) the **`merchantSell`** verb + `sellPrice` rate
  by tier; (4) **split loot** (found gold + valuables drops — sim storage-pressure rose
  13% → 56%, the haul-vs-gear decision now live). **Phase C still to do (the breaking
  change):** buy reads `effectiveMarketTier` (+ refuse at `none`); **retire the `+50g`
  Trade/Market gold-mint** (wide test blast radius); the **camp UI** rework (Trade/Market
  buttons → Buy/Sell, market readout per node — needs a runtime smoke-test); and the
  **glossary** (promote Sell, add Valuables, retire Trade).
- **Build progress update (2026-06-19, cont.):** Phase C landed too — (5) **retired the
  `+50g` Trade/Market gold-mint** (removed the `economy` effect kind, the `MARKET` ability,
  and the Merchant's meta camp skill; Merchant is now ACCESS + SELL) and added a camp
  **"Sell Valuables"** button (the loot faucet's surface); (6) the **glossary** (Buy / Sell /
  Valuables / Market-tier keywords; Trade retired). The Phaser camp UI was then
  **runtime-smoke-tested** headlessly (`npm run shots` boots the real `OverworldScene` in
  Chrome and fails on any page error — all camp frames captured clean).
- **Build progress update (2026-06-19, final):** the last functional items landed too —
  **(7) buy reads `effectiveMarketTier`** (`merchantBuy`/`merchantPrice` now price by market
  **tier**, refuse at `none`; the camp Buy button is market-gated; the event-shop is a fixed
  `basic` market, resolving the reconciliation) and **(8) Merchant XP-on-sell** (`merchantSell`
  grants the brokering Merchant use-XP — replacing the retired Trade's XP, so the class still
  grows from its signature work). All green (**502 tests**), production build + headless
  smoke-test pass.
- **Build progress update (2026-06-19, the two-axis fold — item 1, now built):** the
  headline limiter model landed (branch `claude/ecstatic-edison-ap8407`). One two-axis
  `OverworldCost` — pacing (`cooldown` / `usesPerNode`) × price (`fatigue` / `gold` /
  `influence` / `rp`), plus a `selfLimited` escape for inventory-bound verbs — and **one
  gate** (`checkOverworldCost`/`commitOverworldCost`) that Scout, the camp jobs, **and** the
  economy verbs (Patronize) all route through. The **invariant** (`validateOverworldCost`,
  asserted over the registry at load) makes "unpaced **and** unpriced" unrepresentable; the
  `usesPerNode` interim is now just the general pacing knob. This **closes the bug class**,
  and — paired with D62 — the last live faucet (`Gather Influence`) is **deleted**, not
  capped. **Only remaining D61 item: the numbers/tuning pass** (buy prices, sale rates,
  valuables drop rates) — deliberately left for a balance/playtest sweep.
- **Decision:** Converge the whole camp/overworld action surface onto **one limiter model**,
  and reframe the Merchant's economy around **access scarcity** rather than a gold faucet.
  1. **Two-axis limiter model (pacing × price).** Every camp/overworld action becomes one
     data shape with **two independent knobs** — the D29 limiter menu made explicit:
     - **Pacing (axis A):** `cooldown` (node-steps, the D35 spine) **or** `usesPerNode` (a
       per-node cap) **or** none.
     - **Price (axis B), per cast:** `fatigue` / `gold` / Vancian `charges` / `rp` /
       `influence` — what each individual use costs.
     One registry, one resolver (the `takeOverworldAction` shape, extended). The **invariant
     that kills the bug class: no action may have both empty pacing *and* empty price** —
     "free and unlimited" becomes unrepresentable, enforced once. This natively supports
     **multi-cast-per-node gated by resources** (e.g. a Seer casting as often as it can pay
     charges): `pacing: none` + `price: { charges: 1 }`.
  2. **Market access is a node axis, tiered, Merchant raises the floor.** Access itself is
     the scarce resource — *the caravan cannot find a market at every node*. Add a
     **`MarketTier`** (`none < poor < basic < premium`, an **ordered** band per the
     banding convention) to `MapNode`, seeded at generation. The buy/sell resolver reads it:
     **refused at `none`**, price/quality-scaled otherwise. A **Merchant in the party raises
     the floor** (`none → poor` — the *impromptu market anywhere*, at worse rates — and bumps
     quality generally), reusing the **intel-floor idiom** (`effectiveMarketTier(node, party)
     = clampUp(node.market, merchantFloor(party))`, exactly as the Noble's Intelligence raises
     the intel floor). **Market and terrain are orthogonal axes** (a mountain town and a
     desert town can both be `basic`), so `MarketTier` is its **own** node field with its
     **own** seeder — today `f(kind, seed)`, later `f(kind, terrain, seed)` with **zero
     consumer changes**. This is the **extensibility seam** that makes *market-first* safe.
     **Terrain/biome as a first-class node axis is Deferred** — the seam is left open.
  3. **Merchant = ACCESS + SELL, not a gold faucet.** Retire the `+50g` `Trade`
     money-printer. The Merchant's gold income comes from **favorable *sell* rates**
     (goods → gold **conversion**) — honest because you cannot sell what you do not carry,
     nor at a `none` market, so gold stays scarce and Upkeep keeps biting (D15). The Merchant's
     **use-leveling** (D32/D53 "grows from trading") re-attaches to the access/sell verb.
  4. **Dedup Trade/Market** into the single node-tier **access** verb (buy *and* sell),
     priced by `effectiveMarketTier`. The duplicate effect and the D30 contradiction both
     dissolve.
  5. **Influence is carved out to its own subsystem (D62).** Influence is a **walled-off
     currency** (D34) with its own identity — patronage / reputation / politics — that *touches*
     economic behaviour but isn't part of the gold economy, so its redesign is **not** decided
     here. D61's only commitment: the **two-axis invariant** (item 1) bounds the spammable
     `Gather Influence` faucet for free once economy verbs fold into the one resolver (it can no
     longer be both unpaced and unpriced). **What Influence *is* — income source, passive vs.
     active, the Noble's role, its sinks — is deferred to D62.** ⚠️ Note the shipped interim
     stopgap did **not** cover Gather Influence (different code path: `nobleIncome →
     collectPoliticalIncome`), so the faucet is **still live-exploitable** until either the
     two-axis fold or D62 lands.
  6. **The economy trichotomy (keeps the three classes competitive).** Each is a faucet of a
     **different input**, so they are not three flavours of "gives gold": **Merchant** =
     *goods → gold* (sell; needs inventory + a market), **Banker** = *time → gold* (passive
     interest), **Noble** = *presence/rep → Influence* (passive, walled-off currency).
     Numbers need a tuning pass to keep them balanced.
- **Sell needs a value model — and a sellable-goods *class* (Decided this pass: BOTH).**
  Investigation (2026-06-19) found the gap is bigger than a missing price field: `MaterialDef`
  carries **no gold value**, buying is priced flat by **node tier** (not per item), there is
  **no sell function**, and — crucially — **no category of sellable goods** (the catalog is
  five *functional* items; encounter rewards drop **gold directly** + functional materials).
  So "Merchant converts goods → gold" had no goods to convert. Note the vision docs already
  *imagined* this as flavor — `01-pre-deployment.md` lists "buy/**sell** equipment" and its
  worked example "sells **salvaged scrap** (+60g)" — but it was never mechanised. **Decision:**
  - **(a) A new `valuables`/salvage item class** — zero function, **pure gold value**, drops
    from encounters as loot. It's the primary sell faucet *and* a real decision, because
    carrying it burns scarce **storage slots** (D6): haul loot to the next good market vs.
    spend slots on gear. (This is the docs' "salvaged scrap," finally given a mechanic.)
  - **(b) Sale values on the existing functional materials** too, so **surplus gear can be
    liquidated** — selling then competes with using/recovering it (a genuine trade-off).
  - Both read **`effectiveMarketTier`** for the rate (better at `premium`, impossible at
    `none`), so the sell faucet inherits the market-access scarcity from item 2.
  - **Encounter loot splits into two streams (refinement, 2026-06-19).** A win pays
    **found gold** — coin, banked **immediately** to the purse — *and* **sellable loot** —
    `valuables` drops into storage that are **illiquid until Sold**, and Sell needs a market
    (`effectiveMarketTier > none`: a market node *or* a Merchant raising the floor, at worse
    impromptu rates). This makes **market access a gate on *realising your reward***, not just
    on buying — the keystone that makes routing-to-markets and the Merchant matter. Data-wise
    it reuses `EncounterReward` (`gold` = found coin; valuables = a `MaterialDrop` of the new
    class); the "split" is the reward generator allocating value between the two.
  - **Tuning guardrail:** **found gold must cover baseline Upkeep** on its own — sellable loot
    is the *upside* you route/liquidate to realise, never the *baseline* you need to survive
    (else a win you can't yet sell becomes a rations death-spiral, worst early).
  - **Glossary reconciliation required:** the glossary currently lists **"Sell" as a *banned
    synonym* for the retired `Trade` skill** — D61 promotes **Sell** to a first-class verb
    (and adds a `Valuables`/`Salvage` keyword), so that entry must be re-authored when built.
- **Still open / deferred / not built:**
  - **Influence subsystem** (item 5) — carved out to **D62**; now **Decided + built** there
    (per-expedition standing, passive accrual + Patronize, bribe-by-standing, event quality).
  - **Terrain/biome node axis** (item 2) — Deferred; seam left open.
  - **Tuning pass** across the three economy classes + market tier yields (incl. sale-rate
    curves and valuables drop rates) — later.
- **Spec (to build):** `src/core/overworld.ts` (`MarketTier`, `MapNode.market`, seeding +
  `effectiveMarketTier`/`merchantFloor`), `src/core/inventory.ts` (a `valuables`/salvage
  material class + a per-item **sale value** on `MaterialDef`), `src/core/generation.ts` /
  resolution (split `EncounterReward` value into **found gold** + **valuables** drops), `src/core/overworld-actions.ts` (the
  two-axis `cost` shape + the unpaced-and-unpriced invariant; fold camp jobs + economy verbs
  into the one resolver), `src/core/economy-actions.ts` (Merchant **sell** verb reading
  `effectiveMarketTier`; bring `Gather Influence` under the two-axis invariant so it can't be
  unpaced+unpriced — the full Influence redesign is **D62**), `src/core/jobs.ts`
  (retire the `+50g` Trade effect; re-home the Merchant verb), the routing/forecast layer
  (surface market availability per edge), and `docs/design/glossary.md` (promote **Sell** to a
  keyword; add **Valuables**/**Salvage**; retire **Trade**). Updates the `usesPerNode` interim
  into the general `pacing` knob.
- **Superseded by:** —

## D62 — Influence as its own subsystem (politics / patronage / reputation)

- **Status:** **Decided + Built** (2026-06-19, branch `claude/ecstatic-edison-ap8407`) ·
  carved out of **D61** item 5; builds on **D34** (Influence is a walled-off currency), the
  Noble's **D30** verbs, and the **D61** two-axis limiter. Spec: [`influence.md`](../../docs/design/systems/influence.md).
  Tuning is the only deferred piece.
- **Context:** While reworking the gold economy (D61) we kept hitting Influence and kept
  having to *not* decide it — because it isn't really part of the gold economy. It's a
  **separate currency with its own identity** (patronage / reputation / politics) that
  *touches* economic behaviour (it pays the Noble's bribes, can't pay Upkeep) but has its own
  overall fantasy. The old implementation was thin and broken: political income was a
  **spammable `Gather Influence` button** (`collectPoliticalIncome`, no gate → unlimited
  Influence → unlimited bribes), which the D61 interim cap did **not** cover.
- **Decision:** **Influence is the Noble's "opportunity" currency** — *presence → options*,
  the third leg of the economy trichotomy (Merchant goods→gold, Banker time→gold, Noble
  presence→Influence). Resolved this pass:
  1. **Per-expedition, banded.** Influence lives on the **run** (`run.overworld.influence`),
     **rebuilt each expedition** like the purse — it does **not** bank to the guild (so a
     passive faucet can't compound forever). The raw value bands into **Standing**
     (`unknown < known < respected < favored < renowned`), the Noble's twin of the
     market/intel tiers; the **current band** gates every sink.
  2. **Faucets — both keyed to a Noble's presence, both gated (no free faucet).** Interim
     Noble proxy = a party member with Intelligence ≥ 3 (the Noble's stat). (a) **Passive
     presence accrual** per node-step (the Noble's twin of Banker interest), fired from
     `breakCamp`. (b) **Patronize** — an active camp verb (gold → Influence) routed through
     the **D61 two-axis gate** (`usesPerNode: 1` × `gold`). The exploit is **designed out**:
     `Gather Influence`/`collectPoliticalIncome` **deleted**, not capped.
  3. **Sinks scale with Standing — the hoard-vs-spend tension.** A high *current* band gates
     good outcomes; *spending* draws it down. (a) **Bribe** now reads Standing for both
     **price** (cheaper) and **odds** (likelier), and is a **roll that can fail** — a failed
     sway still spends the Influence **and** the Act. The roll is **deterministic per
     target+node** (no save-scum). (b) **Event quality**: Standing **biases the event pick**
     (boons likelier, banes rarer) and **unlocks premium events** — the **Patron's Welcome**
     (gated `favored`+) paying morale + a sellable Valuables gift + a touch of Influence.
     **No gold-from-nothing** — gold stays scarce (D15/D30).
- **Build (all green, 519 tests · build + headless smoke pass):** `economy.ts`
  (`InfluenceTier`/`influenceTier`/bands; `addInfluence`/`spendInfluence`/`canAffordInfluence`
  retargeted to `OverworldEconomy`), `overworld-actions.ts` (`influence` on the economy +
  round-trip; the shared gate spends/checks it), `economy-actions.ts` (`hasNoble`,
  `nobleInfluencePerStep`, `accrueNobleInfluence`, `patronize`; `bribeCost`/`bribeChance` by
  band, `bribeEnemy` rolls + `failed`), `run.ts` (accrual in `breakCamp`), `guild.ts` (drop
  the persistent `influence` + `politicsCounter`), `node-events.ts` (`eventWeightAt` +
  `standingBias`/`minInfluence`; the `patron` kind + Patron's Welcome), `intel.ts`/`runloop.ts`
  (thread the band into `eventForNode`), the scenes (Patronize button + readout, bribe
  chance/failure, patron icon + report; Guild Hall drops Influence), `glossary.md`, and the
  new `systems/influence.md`.
- **Still deferred:**
  - **A dedicated Noble job** — replace the Intelligence ≥ 3 presence proxy with the class's
    `jobId` when it's built.
  - **Richer sinks** — sway-to-avoid-a-fight, faction access/unlocks, recruitment gates.
  - **Tuning** — accrual rate, Patronize cost/yield, band thresholds, bribe cost/chance
    curves, event-bias magnitudes (rides the D61 parked balance sweep).
- **Superseded by:** —

## D63 — Deployment as the closing net (retires the retreat-gamble) + the combat convergence

- **Status:** **Decided + Built** (the closing-net deployment model shipped). The convergence
  plan's **phase 1** (truth reconciliation) and **phase 3** (one action log — deploy verbs through
  `Battle.apply`, with undo + replay) are complete and merged. **Phase 2 — the actual
  `DeployClock`→`CTClock` fold — was *not* done:** the plan shipped a shared stepping engine
  (`tickUntilReady` / `byReadiest`) but kept two clocks. The genuine fold (the front as a
  strict-lead tempo source on the one clock), plus a game-wide skill `usableContext` axis, is
  carried by **D67**. Refines **D7/D11** (the deployment gamble) and leans on **D5** (the CT
  clock). Spec: [`docs/design/02-deployment.md`](../../docs/design/02-deployment.md); plan:
  [`deployment-combat-unification-plan.md`](deployment-combat-unification-plan.md) (historical);
  continuation: [`d67-substrate-unification-build.md`](d67-substrate-unification-build.md).
- **Context:** Two pressures converged. (1) The D11 *"safe period → auto-retreat at
  the buzzer → per-step capture roll"* model was specced but **never built**; when
  Deployment was actually implemented it became something cleaner and more legible.
  (2) That implementation made Deployment a **turn-based, CT-clock, move-and-act board
  phase** — i.e. it started *being* the combat substrate, but written as a parallel
  system (`DeployClock` beside `CTClock`, mutations outside `Battle.apply`). We had to
  decide what Deployment actually is, and how much of combat's spine it should share.
- **Options considered (the model):** (a) build D11's retreat-race as specced /
  (b) a **closing-net** model — two radial influence sources on the board, the enemy's
  growing to eat your safe ground, capture rolled on the net's turn / (c) a static
  point-budget setup.
- **Decision (the model): (b), the closing net.** Deployment plays on the board as a
  short stealth phase:
  - **Two radial sources, in orthogonal steps.** The party's **campfire** (home-edge
    anchor) projects a **safe radius** sized by party **presence** (atk+def+hp/10);
    the enemy's **danger source** starts at radius 0 and **grows one step on each of
    its turns**. The danger **overrides** the campfire, so your safe ground shrinks
    turn by turn.
  - **Capture is rolled only on the net's turn**, for every unit inside the danger
    radius (deepest first); per-tile odds scale with depth (`frontCaptureChance`),
    capped so it's never a sure loss, and the party's **last un-captured fighter is
    never netted**. A unit can **Dig In** to take a fraction of the chance at the cost
    of its turn. The **first** catch raises the alarm → Battle begins; if the net
    overruns the last safe tile first, Battle begins anyway.
  - **Stats keep their D11 roles:** Awareness/morale/intel widen the safe radius
    (`deployMods`); Speed buys *more positioning turns between net-closings* (capture
    is on the net's clock, not per player turn — a fast party isn't punished with more
    dice). Capture/rescue is unchanged (D7/D9/D12): a netted unit is bound on the map,
    dropped from the initiative seed, a rescuable sub-objective.
- **Decision (the architecture): Deployment is a *phase of* `Battle`, converged in
  phases.** It already shares the `Unit` model, the roster, board movement, the
  **entity registry** (player traps register on `battle.entities` and combat springs
  them through the one trigger bus, D4), the capture/rescue state, and the CT
  constants. The remaining parallelism (`DeployClock`'s duplicated loop; deploy
  verbs bypassing the `Battle.apply` action log → no undo/replay; a separate RNG
  draw) is retired in the ordered phases of the unification plan:
  1. **Truth reconciliation** (this record + the `02-deployment.md`/D11 rewrite).
  2. **One clock** — fold `DeployClock` into `CTClock` (the front as a first-class
     actor).
  3. **One action log** — lower deploy verbs through `Battle.apply` for replay +
     undo parity (the substrate-audit `#7` graph→replay item; landed last, per-verb).
- **Build (deployment, all green):** `core/deployment.ts` (the D63 closing-net block —
  `campfireRadius`/`createFront`/`frontCaptureChance`/`resolveFrontTurn`/`DeployClock`,
  plus the retained D7 capture/rescue + the legacy M5b/D11 exposure helpers kept for
  reference), `scenes/BattleScene.ts` (the `phase:"deployment"` driver), and
  `deployment.test.ts` (74 cases). The convergence phases 2–3 are tracked in the plan.
- **Superseded by:** —

## D64 — Telegraph & action forecast (preview-before-commit)

- **Status:** **Decided · render layer built** (the forecast/telegraph render landed — see the
  *Build (render layer landed)* note below; ~632 tests at the time. The pure-core forecast
  extraction + HUD follow-ups remain.)
- **Context:** A start-to-end "resource & action" audit of one job (the **Heavy
  Knight**, traced across every screen) surfaced a general gap, not a class-specific
  one: the game **resolves actions without showing the player what they will do
  first.** The board already telegraphs *some* of this — a lit path to the hovered
  tile, an in-place strike badge, enemy-intent links (`combat-view.ts:drawPreview`/
  `drawIntents`) — but the moment a skill is **armed** the preview collapses to "these
  tiles are legal targets" and shows nothing about the effect: Cleave's arc, Shove's
  push direction + "into a trap" payoff, and the tarpit aura are all invisible. The
  unit's identity (geometry/proximity) is exactly the category the UI doesn't surface.
- **Options considered:** (a) **fix the Heavy Knight's previews** as a one-off in the
  scene / (b) a **telegraph *system*** — a pure footprint + a forecast registry
  parallel to the resolver, read by the render layer / (c) defer (keep discovering
  effects empirically in battle).
- **Decision: (b), a telegraph system.** Two pure-`core` halves the render layer
  reads: a **footprint** (the tiles/units an armed action affects given the current
  aim — arc, push destination, single target, aura) and a **forecast** (the
  non-mutating predicted outcome). The keystone is a **`FORECAST_HANDLERS` registry
  that mirrors the resolver** — a compile-time-exhaustive mapped type over the effect
  kinds (the *full* `SkillEffect` union; see the hardening note below), so adding an
  ability effect *forces* a telegraph or the build breaks. This makes coverage structural (the same guarantee the job-roster↔
  palette type gives), so the telegraph can't fall out of sync with the ability roster
  — and it lights up every class at once (Cleave/Shove/Mark/Heal/snare/morale/enemy
  intent), not just the Heavy Knight. Spec: `docs/design/systems/telegraph.md`.
- **Why not (a):** the audit showed the gap is the resolver/preview *seam*, not one
  class; a per-class fix re-pays the cost for every future ability and drifts.
- **Spec hardened by a 5-job trace (HK + Hunter, Medic, Survivalist, Chef).** Tracing
  four more jobs before writing code corrected/extended the design:
  - **Registry scope (a real bug in the first draft):** the forecast registry must key
    on the **whole `SkillEffect` union** (Battle/Field/Camp/Deployment partitions), not
    just `BATTLE_EFFECT_HANDLERS` — 3 of 5 jobs act through a non-battle partition
    (`placeTrap`, `morale`, `cleave`/`forced-move`).
  - **A forecast is a tagged outcome, not a number:** immediate / computed / conditional
    / deferred / banked / tiered / branching (Deadeye conditional, Mark deferred, Triage
    computed, trap conditional+deferred, Chef banked+tiered, Medic herb branching).
  - **Read-only + single source of truth:** the forecast reuses the resolver's *pure*
    predict-core (extracted where the resolver fuses compute+mutate, e.g. a pure
    `medHealAmount`); it never mutates and never re-implements the math.
  - **Footprint variety** beyond static board sets: tile/placement, mutable reach (Swift),
    dual move-vs-strike (ranged), persistent hazard (placed trap), none (party/meta).
  - **Availability is part of the telegraph:** charge/cooldown/`usesPerNode`/inventory
    shown in-preview, read from the same gate the action uses.
  - **Non-goal sharpened:** *label* deferred/conditional outcomes; do **not** simulate
    them (no AI-path or downstream-morale projection).
- **Build:** core (pure forecast) not yet started; **the render layer has since landed** (see the
  *Build (render layer landed)* note below). (Originally: design only — this record + the system
  doc, now hardened.)
  Planned as three layers behind a user-testable gate: **core** (`abilityFootprint` +
  a `forecastSkill` registry over the full union, plus extracting pure predict-cores so
  forecast == resolver math; vitest coverage, no Phaser), **render** (extend
  `drawPreview`'s armed branch: arc/push/placement footprints, mutable+dual reach,
  persistent-hazard + aura draws), **HUD** (an armed-ability forecast `MiniCard` covering
  the tagged outcome kinds + availability state).
- **Reuses / consistent with:** D48 route Forecast (cost/outcome knowable before
  commit), D18 Vision (telegraphs gated by perception), D19 forced-move + entities
  (push-into-trap read), D60 strike-badge vocabulary, D2 core/render split.
- **Follow-ups (filed, not yet done):**
  1. **Cleave's `reach` is dead data.** The `cleave` effect declares `reach: 3` but
     `turn.ts:execCleave` ignores it and always sweeps a fixed 3-tile 90° arc. The
     core forecast made the footprint match the *resolver* (so forecast==resolution
     holds), which leaves `reach` doing nothing. Decide: have `execCleave` honor
     `reach` (deepen the arc) — footprint follows for free — or strip `reach` as
     misleading. A pre-existing latent bug the telegraph work surfaced.
  2. **Push "into-trap" flag stubbed `false`.** `abilityFootprint`'s `push` result
     carries `ontoEntity`, but it's hard-coded `false` — the core layer didn't thread
     the entity registry in. `EntityRegistry` *is* core (`Battle.entities`), so this
     can be a real core read by passing an entity predicate into `abilityFootprint`
     (mirroring its existing `isWalkable`/`occupied` predicates), keeping the D19
     push-into-trap payoff in core rather than re-derived in render.
  3. **No deploy-phase "aim a trap" arming flow.** The `placement` footprint is built
     and tested, but Deployment's "Place Trap Here" drops on the actor's own tile —
     there's no hovered-aim arming step, so the Survivalist/Scout placement telegraph
     isn't reachable in real play yet (the other footprints are live). Needs a
     deploy-phase aim-and-confirm flow to surface it.
  4. **Timing readout not in the forecast box.** charge/cooldown/`usesPerNode` state
     (`clock.scheduledProgress` / `onSkillCooldown`, which `showSkillButtons` already
     reads) isn't yet surfaced as "charging ~Nt / cooling ~Nt / 1 use left" beside the
     outcome — the natural next addition to `forecastRows`.
- **Build (render layer landed):** `combat-view.ts` (`drawFootprint` over the footprint
  kinds + push arrow + `drawAuras` tarpit ring; additive `drawPreview` opts `armedAim`/
  `intoTrap`), `BattleScene.ts` (aim threading, `ForecastCtx` build, the forecast
  `MiniCard` switching on the tagged outcomes, aura in both phases, range-gated dim via
  `aimInRange`), `scripts/shots-telegraph.mjs` (headless capture). Tarpit aura recoloured
  to the bone capture-net tone so it overlays the deploy zone washes legibly. Green:
  632 tests, build clean. Follow-ups 1–4 above remain.
- **Superseded by:** —

## D65 — The job-growth framework (breadth × depth, one grant seam, emergent non-combat)

- **Status:** Decided (job-system design pass, 2026-06-23) · builds on D32/D38/D39/D40, refines D33
- **Context:** The job system is the game's headline **build-decision point**, and the
  substrate is already deep — every unit has a **primary + held jobs** with borrowed loadout
  slots (D38), **per-job levels** with permanent stat gains and `unlockLevel` gating (D39), and
  a **2-active + 1-passive** roster where the passive is the identity anchor (D40). What was
  never settled is the **growth *shape*** on top: how a unit comes to **hold more jobs**, how a
  job **grows into a successor** (the Fire-Emblem prestige fantasy), and what "combat vs.
  non-combat" actually *is*. The seam was explicitly reserved —
  `leveling.ts:applyCharacterBoons` notes *"future job evolutions / advanced-job gating hang
  here too."* This decision cashes that seam **at the framework level only**; per-class content
  is a deliberate later pass (see Deferred).
- **Decision — two orthogonal axes.** Character growth runs on two axes that must not blur:
  - **Breadth** (the character axis, D38): character level → **loadout slots** → *how many*
    jobs' abilities you mix. Gaining a job **adds** kit parts. The generalist direction.
  - **Depth** (the job axis, D39): job level → ability scaling + unlock gates → **prestige** as
    the capstone. Prestige **replaces in place**. The specialist direction.

  Keeping them orthogonal is the legibility guarantee: **prestige never widens breadth, and
  gaining a job never deepens a kit in place.**
- **Decision — prestige = replace-in-place, a *diff* on the base kit.** A prestige job occupies
  the **same slot** its base did (it does **not** become a second held job — confirmed: replace,
  not stack) and is authored as a **diff**: replace **≥1 kit element** (an active or the
  passive), keep the rest. So `rogue → assassin` and `rogue → thief` are **sibling diffs** that
  share a spine but swap the edge — and the kit **count stays flat**, so the D40 *1–2 active + 1
  passive* guideline survives prestige automatically. **Chains are supported**: a prestige job is
  itself a job with its own optional branch, so tier-1 → tier-2 → tier-3 is recursion on the same
  seam (pacing is per-class tuning). **Non-combat prestige deepens *verbs*** (the economy-actions
  gated by `hasBanker`/`hasNoble`), not a battle kit — same replace-in-place spirit, different
  plumbing.
- **Decision — one grant seam (`predicate → effect`).** Both **base-job acquisition** and
  **prestige triggering** are the *same* machinery: an **eligibility predicate** guarding an
  **effect** ∈ { **add a held job**, **prestige `from → into`** }. The predicate kinds compose,
  default-open:
  - `jobLevel ≥ N` — the **default** prestige trigger.
  - `charLevel ≥ N` — authored coming-of-age (the nomad who joins the hunt at L5).
  - `holdsItem(x)` — the Master-Seal pattern (a **recipe book** grants Chef; consumed on use).
  - `atNode(x)` / **event-choice** — a special node or interaction (the thieves'-guild invite).
  - `unitId(x)` / **story-flag** — **"special prestige for select characters"**: a predicate keyed
    on **identity** or a **story flag**. This is the *whole* mechanism for one-off / story-gated
    jobs — **zero new machinery.**
- **Decision — symmetric system; power attaches to *story*, not *tier*.** The **entire** growth
  tree (jobs, prestige, chains, stat ceilings, flexibility) is **available to mercenaries and the
  authored cast alike** — consistent with **uniform slots** (`guild.md`: any character fits any
  slot). Authored distinctiveness is **narrative** (a fixed identity + story quests), **never
  mechanical superiority**: a rolled merc the player bonds with is a **first-class win**, not a
  consolation prize. The `unitId` / story predicate is **power-neutral plumbing**; it may host a
  *genuinely powerful* one-off **only when a story earns it** — that is the guardrail that keeps
  the exclusivity hook from sliding back into "authored are simply stronger."
- **Decision — acquisition is diegetic (and *is* the attachment engine).** Jobs arrive **through
  play**, not a menu: find the book, help the beggar then get invited to the guild, come of age.
  A unit's job sheet thus becomes a **history of what it did** — and history is exactly what the
  D33 re-authoring (below) makes the source of "special." So the acquisition model **manufactures
  the attachment** the symmetric philosophy depends on; it compounds with **permadeath (D27)**,
  which only bites when you're invested.
- **Decision — non-combat is *emergent*, not an authored flag.** The current `noncombat: boolean`
  (`jobs.ts`) conflates two things — a **descriptor** (this kit isn't a battle kit) and a
  **permission** (this unit can't take the map) — which is why it's set on the pure-meta economy
  classes but **not** on the **Survivalist**, whose kit is non-combat yet is *fielded in
  Deployment*. Split them: **derive the descriptor** — a job with no `battle`-phase skills *is*
  non-combat (every skill carries a `phase`), a **center-of-gravity** read consistent with
  uniform slots and the **universal Defend/move/attack** (`jobs.ts:DEFEND`) — and treat the
  **permission** as a separate **open call (parked):** keep the current **hard fielding ban**, or
  go **fully emergent** (anyone can be placed; a Banker simply has nothing useful to do). The
  latter is more consistent with uniform slots but needs an **audit of every flag consumer**
  (upkeep / Rest-Point / morale, deploy filtering).
- **One new substrate:** **per-unit persistent memory** — a cross-node **flag bag on the unit** so
  a later event can read what an earlier one wrote (help-the-beggar → invited-to-the-guild).
  Everything else reuses existing seams; this is the only genuinely new data the framework needs.
- **Refines D33 — unweld *identity* from *class*.** The "Tier-2 companions have **fixed
  class/identity**" wording over-claimed. The D33 axis is **authored vs. rolled** (a merc's class
  is *rolled*, a companion's is *hand-picked*), **not** mutable vs. frozen — and D33 already says
  companions *"level like anyone."* So: **identity** (name, portrait, story role) is **fixed
  forever**; **class** is **authored at the start** (not rolled) but **flexible thereafter**,
  growing like anyone's. `decisions.md` (D33) and `guild.md` re-authored accordingly.
- **Spec:** [`docs/design/systems/jobs.md`](../../docs/design/systems/jobs.md).
- **Deferred (per discussion) — the later one-at-a-time per-class pass:**
  - each class's **actual prestige branches**, and the **Soldier** 3-active/0-passive → 2+1
    **retrofit**;
  - **non-combat prestige shapes** (Banker / Merchant / Noble verb deepening), thought through
    individually;
  - **chain pacing** (job levels between hops so a tier-3 capstone feels earned);
  - the **agency model** for acquisition — authored beats may **auto-fire** on a threshold, but
    generic acquisition should usually **cost a choice or an item** so the *ownership* (and the
    attachment) accrues;
  - the **per-unit-memory data shape** + its persistence across nodes / runs;
  - whether an **acquired job arrives at job-level 1** (assumed yes — you just started);
  - the **fielding-permission call** above + the flag-consumer audit;
  - a **Prestige** glossary keyword (one word per concept).
- **Reuses / consistent with:** D32 (the leveling seam this realizes), D38 (the FFT job model —
  primary + heldJobs + loadout slots), D39 (hybrid leveling — per-job stat gains, `unlockLevel`,
  ability scaling, loadout boons), D40 (2-active+1-passive roster + passive identity), D33
  (recruitment tiers — refined here), D25 (uniform slots), D27 (permadeath → the attachment
  stakes), the reserved `leveling.ts:applyCharacterBoons` hook.
- **Build:** the **shared prestige & transition substrate is built** (2026-06-24) — see the
  **Addendum (D65-A)** below. **Per-class content** (the actual prestige branches, the Soldier
  retrofit, the authored events) remains the deferred per-class pass (D66 Soldier, D68 Scout).
- **Superseded by:** —

### Addendum D65-A (2026-06-24) — the prestige & transition substrate, built

The **shared machinery** D65 designed is now built — the generic substrate the Soldier's Elite
Soldier and the Scout's Assassin/Thief both consume, built **once**. This addendum records the
**resolved deferred questions** and the load-bearing decisions the build settled.

- **Per-unit memory = run-scoped `Record<string, …>` on `Unit`.** A flag bag (`unit.memory`) with
  pure `remember` / `recalls` / `recall` / `forget` helpers (`units.ts`). It threads the run for
  free (the `run.party` units are the same objects across nodes) and **dies with the run**;
  cross-run / guild persistence is a deferred follow-on. The `remembers(flag)` predicate reads it.
- **Prestige = replace-in-place, carrying the job level.** `prestige(unit, from, into)`
  (`grants.ts`): the evolved job takes the **same `heldJobs` slot**, `jobLevels[from] → [into]`
  (the level/xp carries — it *is* the job evolved), passives re-stamp off the evolved primary, and
  `into` may itself carry `.prestige` (chains). Guarded — a no-op if the unit doesn't hold `from`
  or already holds `into`. If `from` was the effective primary, `into` takes the primary seat.
- **The `jobId` → `primaryJob` read-standardization (the silent-no-op landmine).** `unit.jobId` is
  the **frozen original class** (the identity / authoring anchor; never changes on prestige); any
  read of a unit's **current effective class** now goes through `primaryJobOf(unit)`. The seven
  mechanic-driving readers were standardized — `stampPassives`, `unitSkills`, `hasChef`,
  `rpPerNight`, `merchantFloor`, the `merchantSell` broker, `describeUnit`. Verified
  **byte-identical** (no content authors `primaryJob ≠ jobId`), so the sim is unchanged; telemetry /
  render reads of `jobId` (the authored class) correctly stay as-is.
- **The grant seam.** `grant := { when: Predicate, then: GrantEffect }`, effect ∈ { `addHeldJob`,
  `prestige` }, one **exhaustive mapped-type** interpreter (`GRANT_EFFECT_HANDLERS`, mirroring the
  D3/D4 effects-as-data ethos). Composable, default-open predicates
  (`jobLevel`/`charLevel`/`holdsItem`/`atNode`/`atNodeKind`/`unitId`/`remembers` + `all`/`any`).
  `JobDef.prestige` carries the branch data; `eligiblePrestiges` evaluates it. A fixture-injectable
  job lookup keeps throwaway test jobs out of the `JOBS` registry.
- **Agency = the accept is a choice.** Node events offer a prestige via the extended **story** data
  pattern (a unit-targeted, predicate-gated choice that writes a memory flag or applies a grant; the
  `choiceId` encodes the unit). A generic prestige **never auto-applies on a threshold** —
  `autoResolve` targets no unit, so it applies neither the memory nor the grant; only the explicit
  per-unit accept does.
- **Scope held:** the substrate ships with **fixtures only** — no real Assassin / Thief /
  Elite-Soldier `JobDef`s, no `SCOUT_JOB.prestige`, no authored events. Those remain the per-class
  passes (D66 Soldier, D68 Scout). Fixtures are never registered in the live `JOBS` / `STORIES` /
  event pool (which would shift deterministic selection and break the byte-identical sim).
- **Cites:** D65 (this framework), D38/D39 (the job model + hybrid leveling), D33 (acquisition — the
  recruit path already exists via the `recruiter` event; the mentor path is a *prestige trigger*, no
  recruitment work), D3/D4 (effects-as-data, one interpreter).

## D66 — The Soldier: first per-class pass (formation anchor) + the channeled-aura model

- **Status:** Decided (job-system per-class pass 1, 2026-06-23) · realizes D65, retrofits D40
- **Context:** D65 deferred per-class content to one-at-a-time passes. The **Soldier** is pass 1 —
  and the **D40 retrofit** (the legacy Soldier is 3 actives / 0 passives, predating the
  2-active+1-passive house style). Designing it surfaced a reusable combat mechanic — the
  **channeled aura** — worth recording beyond the one class.
- **Decision — the Soldier as a "formation anchor."** Identity: the Soldier is better **in a
  line** — every piece is a **team multiplier**, making it the clean **inverse of the Scout**
  (isolate + solo-flank) and a complement to the **Heavy Knight** (controls *enemy* spacing).
  Kit (the D40 2-active+1-passive shape):
  - **Brother-in-arms** (passive) — **+1 attack damage per adjacent ally, max 3**. A new
    `PASSIVE` key read in `resolveAttack`, mirroring Deadeye (the flank code already counts
    adjacent bodies). Formation *offense*.
  - **Turtle Formation** (Act) — every **adjacent ally** gains **Guarded** (≈+2 def) **until its
    next turn**: an **"AoE Defend" for the line.** A **one-turn aura** (below); cost is implicit
    (turtling ≠ attacking). Formation *defense*.
  - **Debilitating Strike** (Act) — **+3 damage and Exposed** (clears on the **target's** next
    turn) — the Expose pattern (`damage` + `onHit` status), **reusing the Scout's Exposed
    keyword** as intentional shared synergy (Soldier = the heavy applier, Scout = the fast one).
    Formation *target-priority*.
  - **Baseline/growth:** a sturdy mid-armor melee **anchor** (HP/attack-weighted, range 1) — a
    numbers pass.
  - **Replaces** the legacy Power Strike / Hamstring / Second Wind; dropping the self-heal makes
    the Soldier **lean on the squad/Medic** for sustain — on theme.
- **Decision — the channeled-aura model (the reusable mechanic).** Auras maintained on a
  **commitment ladder** of *what the unit gives up to project them*:
  - **One-turn aura** (Turtle): cast (Act) → each **adjacent ally** gains **Guarded** until its
    next turn (an **"AoE Defend"**) — the value pays off **outside** the caster's turn (foes act
    in the CT gap). Re-cast to maintain; the only cost is the Act (**offense xor defense**, each
    turn). **Built** as a per-ally Guarded at cast — the proven Defend mechanic spread to the
    line, chosen over a caster-anchored aura to avoid a same-id clash with a unit's own Defend.
    The **aura-that-follows-the-formation** is reserved with the persistent stance. **No new
    primitive.**
  - **Persistent stance** (reserved — built with the prestige): cast-once, **hold-until-broken**,
    at a commitment cost — **free** (= Mark Prey today) / **rooted** (no move) / **locked** (no
    other action). The dial **scales cost to aura strength**; **displacement breaks it** (the
    Heavy Knight's Shove is the anti-formation counter); death / explicit drop end it. The
    natural **Sentinel-prestige** payoff (Turtle: one-turn re-cast → **persistent rooted**,
    freeing the Act to attack) — replace-in-place that changes the *model*, not the numbers.
  - **Unifies the existing auras:** **tarpit** = the always-on passive end, **Mark** = the free
    channel, **Turtle** = the one-turn rung.
- **Spec:** [`docs/design/systems/jobs.md`](../../docs/design/systems/jobs.md) (Worked example — the Soldier).
- **Open / next:** the Soldier's **prestige fork** — **Sentinel** (defensive; Turtle → persistent
  stance) vs **Banner** (offensive; Brother-in-arms scales the party) — to be designed; the
  persistent-stance primitive lands with it. The **numbers pass** (baseline/growth, magnitudes).
  The card already surfaces the kit (Brother-in-arms needs a `PASSIVE_INFO` entry; actives carry
  their own text).
- **Reuses / consistent with:** D65 (per-class pass), D40 (2+1 + passive identity; the tarpit
  aura), D36 (flanking — kept the Scout's lane), D41 (statuses — Guarded/Exposed reuse), D37
  (channel / Mark Prey), D5 (CT action economy).
- **Build:** not yet started — **design only**.
- **Superseded by:** —

---

## D67 — Deployment as combat-substrate + capture-wave layer + a game-wide skill `usableContext` axis (finishes D63)

- **Status:** Decided + **fully built** (skill-surfacing 2026-06-23; the deferred clock/RNG/
  controller fold + a sharing-policy evolution **completed 2026-06-26**). The skill-surfacing
  unification (sub-decisions A–C and E's *cast path*) shipped across increments 0–8 + 6c; the
  clock/RNG/controller fold (sub-decision D and E's *RNG/controller*) was initially deferred
  (2026-06-23) and then **built in full** in the W-series — see *Build outcome — extended* below,
  which also records how W6/W7 **superseded the "engagement is combat-only" sharing policy**
  (engagement is now board state). Full build brief (the 0–12 plan, the audit, the completeness
  checklist): [`d67-substrate-unification-build.md`](d67-substrate-unification-build.md).
- **Context:** D63 made on-map Deployment a CT-clock, move-and-act board phase — i.e. it
  already *is* combat's substrate — but implemented twice. Phases 1 (truth reconciliation)
  and 3 (one action log: deploy verbs through `Battle.apply`, with undo + replay) shipped;
  **phase 2 (the actual `DeployClock`→`CTClock` fold) was deferred** — the plan shipped a
  shared stepping engine (`tickUntilReady`/`byReadiest`) but kept two clocks. A 2026-06-23
  code review confirmed the remaining forks: deployment reads raw `moveRange` (ignoring Swift)
  while its clock already honors `effectiveSpeed`; skill availability is single-valued
  (`SkillDef.phase`) with surfacing forked across overworld/deploy/combat (and combat's row
  isn't even pure data — `DEFEND` is a hardcoded append); two scene-owned RNG streams
  (`deployRng` + `spotRng`) draw outside `Battle.roll`; two scene turn-loop controllers; and
  **no replay-safe deploy skill-cast verb** (a dual-context ability cast pre-combat via the
  plain `skill` verb would corrupt replay's pre-seed drain).
- **Decision (the scope rule):** Pre-combat and combat share **all** functionality minus
  explicitly phase-specific layers; skills declare **where they can be used** as data; **one**
  `availableSkills(unit, context)` projects every surface. Five sub-decisions:
  - **A. `usableContext` axis.** `type UsableContext = "overworld" | "guild" | "pre-combat" |
    "combat"` + an optional `usableContext?: UsableContext[]` on `SkillDef`, defaulted by a
    pure `skillContexts(skill)` keyed on `effect.kind` + `target` + `spend`. A finer axis than
    `phase` (`meta` splits into overworld + guild); `phase` stays the D3 pipeline/interpreter tier.
  - **B. One move budget.** Deployment reads `effectiveMove` (Swift applies pre-combat too),
    via a shared `moveBudget(u)` helper.
  - **C. One surfacing projection.** Every context row = `availableSkills(unit, ctx)` + a thin
    per-context non-skill extras set; the universals (`DEFEND`, a new `DIG_IN`) fold *into*
    `availableSkills` (killing the hardcoded `DEFEND` append and the `canTrap` special case).
  - **D. One clock.** Fold `DeployClock` into `CTClock` with the front as a registered
    **strict-lead-tie tempo source** — preserving deployment's deliberate tie rule (players win
    ties; the front acts only on a strict CT lead) as a clock-policy flag. The capture-wave
    layer still owns *what* the front's turn does.
  - **E. One cast path + RNG + controller.** A drained `deploySkill` verb (the twin of
    `deployMove`, in `DEPLOY_KINDS`) makes a dual-context ability *castable* pre-combat without
    breaking replay; **both** scene RNG streams route through `Battle.roll`; the deploy/combat
    per-turn loops merge into one context-parameterized path.
- **Sharing policy:** **permissive — "share all but engagement."** Movement, support
  (heals/cleanse/guard-allies), and self/ally buffs are usable in **both** board contexts;
  engagement (attacks / offensive status / foe-aimed) is **combat-only** (the stealth/alarm
  invariant); traps are pre-combat; camp/morale is overworld. (Owner decision; the blast
  radius — Hunter `reposition`, Scout `dash`, `DEFEND`, all heals — becomes pre-combat-usable
  and is test-pinned.) **→ W7 superseded the engagement clause** (2026-06-26): engagement is no
  longer combat-only — it's **board state** (a *concealed* foe is no valid target), so attacks
  *are* board skills that simply find no one to hit pre-combat. See *Build outcome — extended*.
- **Phase-specific layers (kept, not dissolved):** capture-wave (campfire safe-radius, the
  danger-front + growth, the capture roll, Dig In, the deploy risk forecast, alarm→battle);
  engagement; win/lose (`battleOutcome`); the AI (combat-only — the only deployment "AI" is the
  front advancing). The guild context is wired as a forward-looking placeholder (it surfaces no
  per-unit skills today).
- **Build:** the 0–12 increment plan in the brief — golden-trace-gated, suite-green
  (`test`/`build`/`test:e2e`/`sim`) at every increment.
- **Build outcome (2026-06-23):** increments **0–8 + 6c shipped.** Skills declare context as
  data (`usableContext` + the pure `skillContexts`); **one** `availableSkills(unit, ctx)`
  projects the overworld / pre-combat / combat rows (the hardcoded `DEFEND` append *and* the
  `canTrap` special-case are gone); deployment honors `effectiveMove` (Swift applies
  pre-combat); and a **drained `deploySkill` verb** makes dual-context abilities castable
  pre-combat without corrupting replay. Fix **6c** keeps the two **combat-bound** ability
  families out of the pre-combat surface: **charged** skills (they resolve later on the CT
  clock, which deployment lacks) and the **herb-stash `med-heal`** (its stash pick + inventory
  spend have no drained deploy resolver — `resolveSkill` would throw). **Sub-decision D and
  E's RNG/controller fold were NOT built**, on evidence gathered during the build: (1)
  `CTClock` and `DeployClock` already share the entire stepping engine (`tickUntilReady` +
  `byReadiest` + `effectiveSpeed`), so `DeployClock` is a ~60-line adapter whose only real
  difference is the front (a non-unit, strict-lead tempo source) — folding it into `CTClock`
  would *add* a front + unused charge machinery to the combat clock, net-negative; (2)
  `deployRng`/`spotRng` are already deterministic (seeded via `streamFor`) and replay rebuilds
  the front's effect from the logged `capture` outcome — routing them through `Battle.roll`'s
  shared `drawCount` would actually *break* replay (the deploy draws aren't reproduced on
  replay); (3) the deploy telegraph (increment 9) has no aimed pre-combat surface today
  (self-casts / traps / Dig In don't hover-aim). The arm→click targeting substrate is wired
  and ready for future plain ally-target pre-combat content. **D63's phase-2 clock fold thus
  remains deferred — by evidence, not omission.**
- **Build outcome — extended (2026-06-26): the deferred fold, completed (the W-series).** A
  follow-on push revisited the deferral and built sub-decisions **D** and **E** in full — the
  2026-06-23 evidence held where it was right and was *designed around* where it wasn't:
  - **D (one clock) — built.** `CTClock` gained an optional **tempo source** + a settable
    **participant predicate**; deployment now runs on the **Battle's own `CTClock`** — no
    `DeployClock`, not even a second instance — narrowing participation to active players and
    attaching the front as the tempo source, shed again at `beginBattle` (`resetForCombat`). The
    original "net-negative — it'd add a front + charge machinery to the combat clock" worry is
    **void because the fold is byte-identical**: the tempo + predicate are dormant in a combat
    clock (it never stages), so combat steps exactly as before — golden-trace-pinned. The front's
    net turn became a **`frontTurn` bus event** with the capture-wave as its listener (the front
    rides the clock; the wave is its action — the "front as an event" the owner asked for).
  - **E (RNG / controller / cast) — built, respecting the replay evidence.** RNG: the Battle owns
    the encounter seed and deployment draws via a **label-keyed `Battle.stream()`** — a *second*
    seam beside `Battle.roll`'s `drawCount`, precisely so the deploy draws are **not** routed
    through the replay-ordered counter (the original concern was correct; `stream` is the
    replay-safe answer, behaviour-identical since `rngSeed == run.seed`). Cast: `battle.phase` + a
    **logged `beginBattle` boundary** retired the `deploySkill`/`deployMove` verbs entirely —
    pre-combat repositioning and skill-casting go through the **same** `moveUnit`/`useSkill` as
    combat, the interpreter reading the phase to skip only the combat turn-commit. The
    controller + act-economy spines folded into shared helpers (one `commitFieldAct`).
  - **Sharing policy — superseded (the engagement clause).** "Engagement is combat-only (a
    per-skill ban)" is **replaced by engagement as _board state_** (W6/W7): a per-unit
    **`concealed`** flag marks the pre-positioned enemy roster un-engageable, so
    `isValidSkillTarget` returns no foe and an attack cast in staging finds no one to hit — the
    stealth invariant *without* a phase ban. `skillContexts` no longer classifies attacks as
    combat-only; the flag is the seam for **targetable pre-combat foes** (a keep-assault stages
    defenders `concealed: false` and the same verbs just work) and for future intel-reveal / ghost
    tokens. Deploy casts also now **cost their cooldown** + play the support impact pop (an
    ability used in staging is genuinely used). **6c superseded:** `med-heal` is **both-phase**
    now (a wired deploy herb-menu — the demo Medic pre-heals); the one remaining combat-only
    default is **charged** (a CT-clock mechanic, genuinely phase-native). Every W-step landed
    **byte-identical** for current content (golden trace / suite / e2e / sim green) — the
    behaviour changes (cooldown cost, board engagement, deploy med-heal) are *new capability*,
    not perturbations of the demo. **Known follow-on:** `med-heal` resolves outside the action
    log (`useHeal`→`resolveMedHeal`), so it's not undoable/replayable in *either* phase — a
    pre-existing gap, closable by making it a logged action.
- **Reuses / consistent with:** **D63** (**completes** its convergence — both the skill-surfacing
  half *and* the phase-2 clock fold, see *Build outcome — extended*), **D3** (phase tier kept;
  `usableContext` layers over it), **D5** (the one CT clock), **D2** (core/render), **D7/D11**
  (the capture-wave layer), **D60** (the free-move budget deployment now matches), **D64**
  (telegraph extended to pre-combat), **D35** (the overworld action economy whose
  `usesPerNode`/cooldown gating the context filter preserves), **D41** (the universal Defend
  that Dig In mirrors).
- **Superseded by:** —

---

## D68 — The Scout: per-class pass 2 (the infiltrator) + the first prestige **fork** (rogue → {Assassin · Thief})

- **Status:** Decided + **built** (2026-06-24). Five increments shipped on
  `claude/practical-brahmagupta-vqoxbp`; **758 tests green**, `tsc`/`build`/`sim` clean. The
  first concrete realization of **D65** (a real `JobDef.prestige` + authored transition events)
  and the first class to **fork** — pass 1 (D66 Soldier) only *reserved* its fork.
- **Context:** D65 built the prestige machinery with fixtures only; D66 did pass 1 (Soldier) but
  left its fork for later; D67 unified the deployment/combat skill surface (`usableContext`). The
  Scout is **pass 2** — and unlike the legacy Soldier it was already close to the D40
  2-active+1-passive house style, so this is mostly a **tidy + the fork**, not a retrofit. The
  Scout's identity (per D66's framing) is the **lone playmaker** — isolate, solo-flank, slip the
  net — the clean inverse of the Soldier's formation anchor and distinct from the Hunter's range.
- **Decision — the base kit tidy (the infiltrator).** Conform to 2-active + 1-passive without
  losing the flank character:
  - **Quiet Footsteps** (passive) — **merged** the two legacy flank passives (`flankSolo` +
    `flankBonus`) into one identity anchor: the Scout flanks **solo** (no second body needed,
    `isFlanked`/`computeFlankBonus` read it) **and** moves unseen — it **halves the capture
    chance** in deployment (`captureEvasionFactor`, compounding ×0.5 again while **Swift**). One
    passive, two reads, on theme (*quiet* = both unseen-by-the-net and unseen-by-the-target).
  - **Dash** (Act, **L1**) — dart **+3 tiles** this turn (`swift(1,3)`). **Dual-context by shape**
    (D67): `move`+`self` ⇒ usable **pre-combat & combat**. In battle it reaches a flank; in
    deployment it infiltrates deep, where Quiet Footsteps' evasion compounds. Kept its
    capture-reduction character per the owner's call: *"ultimately a pre-combat ability, but the
    extra movement means it isn't dead in the combat phase."* The core mobility — available from L1.
  - **Set Trap** (Act, **L2**, Deployment) — plant a trap: **8 damage** and **Exposes** the first
    enemy onto it (reuses the Scout's Exposed; sets up the Hunter's Deadeye). The rest-beat payoff
    atop L1 Dash (mirrors the Hunter's Reposition→Mark unlock cadence).
- **Decision — the fork (the spine).** The Scout is the **rogue**; at a job-level floor
  (`SCOUT_PRESTIGE_FLOOR = 5`) **and** a met trigger it prestiges in place into **one** of two
  branches — the owner's original *rogue → assassin* **or** *rogue → thief* vision:
  - **Hidden Passage** *(shared spine)* — both branches **vanish to operate unseen**: an Act that
    grants **Stealth** until the unit's next turn. A single `SkillDef` constant referenced by both
    `JobDef`s — the fork's common root, authored once. **Combat-only** (`usableContext:["combat"]`):
    the closing net doesn't "see", so Stealth has no pre-combat meaning.
  - **Assassin** *(the lethal branch)* — **Subtle Blade** (passive) replaces Quiet Footsteps:
    **+8 power against a full-HP target** — an **opening-strike alpha** (the owner's call: alpha,
    *not* a crit), synergizing with Hidden Passage (vanish → open). No per-target bookkeeping — it
    reads `defender.hp >= defender.maxHp` at resolve. **Surgical Precision** (Act, L2) replaces Set
    Trap: a precise **+3** strike that leaves the foe **Exposed *and* Immobilized** — the first
    **multi-rider `onHit`**. Stat frame shifts to a glass dagger (spd 15 / atk 12 / def 1 / hp 22).
  - **Thief** *(the utility branch — emergent non-combat, D65)* — its value is **verbs, not a
    battle kit** (spine = Hidden Passage only). `passives: {}` is intentional: it **clears** the
    Scout's Quiet Footsteps on prestige (the Thief's anchor is **economic**, not combat).
    - **Deft Hands** — a per-node-step seeded **purse faucet**: at a *busy* node (combat/event,
      never a rest node) a Thief skims **25 gold at ≈50%** (`deftHandsSkim`, hooked in
      `run.breakCamp` beside the Banker's interest and the Noble's influence; new `"deft-hands"`
      `PurseSource`).
    - **Expert Lockpick** — gains the **disarm** capability (the owner's "give the Thief the
      dropped disarm aspect"): `canDisarm` reads it as a **capability** (`JobDef.lockpick`), not a
      jobId (D54) — so the Thief disarms spotted traps where the Assassin can't, and the Scout
      still can via Set Trap. The chest/door **lock-gated** content is reserved (D69).
- **Decision — Stealth, kept lightweight.** No full D18 fog. Stealth is a **status** + **one read**
  the enemy AI already funnels through: `vision.canSeeUnit(units, side, target)` — visible unless
  Stealthed, and a Stealthed unit is seen **only** by an orthogonally-adjacent foe. The AI's target
  scan switched from `canSee(...pos)` to `canSeeUnit(...unit)`; nothing else changed. The heavy
  per-tile-vision system stays deferred until a feature actually needs it.
- **Decision — the transition (town & combat node events).** Authored as **`PRESTIGE_OFFERS`** —
  a dedicated `StorySpec[]` kept **out of** the random `STORIES` pool (so the deterministic sim
  stays byte-identical; they surface only when explicitly drawn / eligibility-gated):
  - **Thieves' guild → Thief** (`thieves-guild`): a single-step join offer, gated on a floor-met
    Scout; accepting writes the `thieves-guild-invite` memory and prestiges in place.
  - **The travelling companion → Assassin** (`travelling-companion` → `the-reveal`): a **two-step
    chain** — first walk the road with a stranger (`remember "traveled-with-stranger"`); only then
    does the reveal ("the traveler was an assassin all along") offer the mentorship that prestiges.
    Linked memory gates the second event on the first — the multi-trigger model from D65.
  - Both use the D65 `StoryChoiceSpec.target:"unit"` + `.when` + `StoryOutcomeSpec.remember`/`.grant`
    path; `applyStoryChoice` returns `EventOutcome.prestiged`.
- **New seams / keywords introduced:** **Stealth** status (`status.ts` + `STATUS_VISUALS`);
  `vision.canSeeUnit`; **Subtle Blade** `PASSIVE` key + `computeDamage` read; **multi-rider
  `onHit`** (`DamageEffect.onHit: RiderStatus | RiderStatus[]`, normalized in the resolver);
  `JobDef.lockpick` capability flag; the `"deft-hands"` `PurseSource`. The `flankSolo`/`flankBonus`
  passives **merged** into `quietFootsteps` (one fewer key).
- **Build (5 increments, each suite-green):** `5e2ddb2` base kit (Quiet Footsteps merge +
  capture-evasion) · `031a1ab` Stealth (the Hidden Passage spine) · `4a64451` the Assassin ·
  `b2ff0df` the Thief (Deft Hands + Expert Lockpick) · `0184a7f` the transition offers. New tests:
  `scout` / `stealth` / `assassin` / `thief` / `scout-transitions`; updated `flanking` / `kits` /
  `combat` / `dossier` / `prestige-branches`.
- **Spec:** [`docs/design/systems/jobs.md`](../../docs/design/systems/jobs.md) (Worked example — the Scout).
- **Deferred (the D69 follow-ons):** surface `PRESTIGE_OFFERS` in *live* runs (a guild node /
  an appear-when-eligible event) + the camp-accept UI (`eligiblePrestiges`); the Expert Lockpick
  **chest/door** entity + lock-gated events; the **combat** convince-a-neutral-assassin path; the
  job-capability **card** surfacing (Subtle Blade / lockpick / Deft Hands need readout text); the
  **numbers pass** (baselines/growth/magnitudes); a later **Assassin tier** is the reserved home
  for the dropped **Weakened** status (cut here per the owner's call).
- **Reuses / consistent with:** **D65** (first real `prestige` + authored transitions — the
  machinery, fixtures-only until now), **D66** (per-class pass; the Scout-identity framing; Exposed
  shared synergy), **D67** (Dash is dual-context via `usableContext`/`skillContexts`; capture-evasion
  threads the deploy forecast), **D54** (capability-not-jobId — `canDisarm` reads `lockpick`), **D40**
  (2-active+1-passive), **D36** (flank — Quiet Footsteps keeps the solo-flank lane), **D41**
  (statuses — Exposed/Immobilized/Swift reuse, Stealth the one new keyword), **D34** (purse — Deft
  Hands is a journaled faucet).
- **Superseded by:** —

---

## D70 — The Merchant: per-class pass 3 (the trade-broker) + the first non-combat (verb) kit shape

- **Status:** Decided (job-system per-class pass 3, 2026-06-24) · realizes D65, builds on D61 (the
  market-access axis). **Decided + built** (2026-06-24) — on the D72 substrate (see Build below).
- **Context:** D66 (Soldier) and D68 (Scout) ran the per-class pass on **combat** classes, both on the
  D40 **2-active + 1-passive** house style. The Merchant is **pass 3** — and the **first non-combat
  class** to get a dedicated pass, which forced the question: *does 2+1 even apply to a job with no
  battle phase, no CT, no `PASSIVE` key, and an empty `skills` array?* The Merchant's identity already
  lived entirely in **verbs gated outside `skills`** (D61: the `merchantFloor` ACCESS lift + the
  `merchantBuy`/`merchantSell` trade verbs), so the pass is **not a battle-kit tidy** but a **verb-kit
  articulation**.
- **Decision — the non-combat house style (the reusable frame).** 2+1 transfers in *spirit*, not
  letter. A non-combat job's anchor is a **presence effect** (a benefit that holds *by being fielded*
  — the passive analogue) and its actives are **overworld verbs** (routed through the D61 limiter). So
  the non-combat shape is **1 presence-anchor + 1–2 verbs** — and the Merchant is authored as a clean
  2+1 in that medium. This is the frame the later **Banker / Noble** passes inherit.
- **Decision — the Merchant base kit (1 passive + 2 actives, the trade-broker).**
  - **Appraisal** *(passive — the presence anchor)* — while a Merchant is in the party, every node
    that **already has a market** reads **one tier better** (`poor → basic → premium`, capped). The
    always-on identity: a Merchant makes every real market *better*. (**New** — D61's `merchantFloor`
    did **not** upgrade existing markets.)
  - **Find Trade** *(active)* — open an **impromptu market on a `none` node** (the caravan trades
    anywhere a Merchant can drum one up). This is **D61's `merchantFloor` ACCESS reframed from an
    always-on passive into a paid action**: access at a barren node now **costs a turn** (the D61
    limiter), not a freebie-by-presence. The conjured market is **`poor`** and is **not** subject to
    Appraisal (else a `basic` market anywhere for one action — undercuts real trade hubs).
  - **Savvy Barter** *(active)* — the Merchant's **next single transaction goes their way**: a **buy
    at 0.5× price** *or* a **sale at 1.25×** (whichever they do next). Paced through the limiter (a
    timed treat, not a standing aura that would gut the buy *sink* / mint unbounded gold). The
    **asymmetric magnitudes are deliberate faucet discipline** (D61): a big discount on the *sink*
    (buy) but a modest premium on the *faucet* (sell) — where a 1.25× sale at an (appraised) premium
    market beats face value, so the **pacing** is what keeps that honest.
  - **Buy / Sell stay universal.** Raw `merchantBuy`/`merchantSell` remain **market-gated, not
    job-gated** (anyone trades at a market that exists; the event-shop already does). The Merchant
    *layer* — Appraisal / Find Trade / Savvy Barter — is the job-exclusive kit on top, and the Merchant
    still **levels from brokering** (sell → use-XP, D61). This **resolves the triad's gating wrinkle**
    (Banker/Noble verbs hard-refuse without the class; the Merchant's exclusivity now lives in its
    three signature abilities, so basic trading needn't be locked).
- **Spec:** [`docs/design/systems/jobs.md`](../../docs/design/systems/jobs.md) (Worked example — the Merchant).
- **Open / next:** the **Merchant's prestige fork** — the **first non-combat (verb) prestige**, where
  "replace-in-place" applies to the **verbs/presence** (deepen Appraisal / Find Trade / Savvy Barter),
  not a battle kit — direction TBD (reserved, as D66 reserved the Soldier's). The **numbers pass**
  (Appraisal cap, the Find Trade limiter cost, the 0.5× / 1.25× knobs, Savvy Barter pacing). The
  **card** surfacing (Appraisal needs a passive-info entry; the verbs carry their own text).
- **Reuses / consistent with:** **D65** (per-class pass; prestige reserved), **D61** (the
  market-access axis — `MarketTier`/`effectiveMarketTier`/`merchantFloor` it decomposes; the two-axis
  limiter; gold scarcity / faucet-sink discipline), **D40** (2+1 — generalized to the non-combat
  medium), **D66/D68** (the per-class-pass cadence), **D34** (purse — the trade verbs are
  purse-scoped, never the treasury).
- **Build:** **built** (2026-06-24) on the D72 substrate — Appraisal (`JobDef.presence`), Find Trade
  (`openMarket`) + Savvy Barter (`primeDeal`, consumed by `merchantBuy`/`merchantSell`); retired the
  passive `merchantFloor` (access is now the paid Find Trade). Tests: `merchant.test.ts` (+ migrated
  `overworld`/`prestige`/`economy-actions`). Commit `8a58986`.
- **Superseded by:** —

---

## D71 — Cook & Noble: per-class passes 4 & 5 (the non-combat triad, formalized)

- **Status:** Decided (job-system per-class passes 4 & 5, 2026-06-24) · applies the **D70** non-combat
  house style; realizes D65. **Decided + built** (2026-06-24, on the D72 substrate). Co-designed with **D70** (Merchant) as the
  non-combat triad; the **action-registration substrate** all three need is assessed next (a sibling
  decision to D61's limiter / D65's grant seam — see *Open / next*).
- **Context:** D70 articulated the non-combat house style (**1 presence-anchor + 1–2 verbs**) on the
  Merchant. Passes 4 & 5 apply it to the other two designed non-combat classes so the full requirement
  set is concrete **before** the substrate is built: the **Cook** (camp-support, renamed from Chef) and
  the **Noble** (the Influence economy, D62). Both are mostly *formalization + light additions* — the
  Noble needs no new code; the Cook adds one new mechanism (Cook Stew's food→RP conversion).
- **Decision — the Cook (pass 4; rename `chef` → `cook`).**
  - **Field Kitchen** *(passive anchor)* — a Cook lowers the party's **Food upkeep** (existing
    `chefFoodPerUnit` discount); double duty: cheaper food **+** a cheaper Cook Stew.
  - **Cook Stew** *(active)* — **spend the day's Food value → bank Rest Points (≈ one `rpPerChunk`) +
    zero the Food upkeep line.** Converts the mandatory food spend into recovery (net gold unchanged vs
    paying food; the benefit *is* the RP). The **"free food that day" is the anti-exploit** — it prevents
    cooking for RP *and then* voluntarily skipping the Food line (D45) to pocket the gold. Once per node.
    **Replaces** the legacy battle-start `pendingHeal` (RP supersedes it) and the `+1 morale` rider (→ Feast).
  - **Feast** *(active)* — a heavier-costed/paced meal: a **larger morale lift** to rally before a fight
    (the dedicated morale lever, freeing Stew to be pure recovery).
  - **RP shifts active.** The big passive `restPoints: 3` shrinks to a **small floor (≈1)** — recovery now
    comes from *cooking* (Cook Stew → the RP pool), so it's chosen, not a passive trickle, and it ties the
    class to the food economy it discounts.
- **Decision — the Noble (pass 5).** Already near a 2+1; this **formalizes** it (no new code):
  - **Renown** *(passive anchor)* — accrues **Influence per node-step** by presence (`nobleInfluencePerStep`).
  - **Patronize** *(active — camp)* — **gold → Influence** (existing; paced + gold-priced).
  - **Bribe** *(active — combat)* — **Influence → sway an enemy** mid-battle (existing, D30/D33/D62).
  - **Generalizes the house style:** the Noble's two verbs span **camp and combat** surfaces, so the
    non-combat shape becomes *"1 presence + 1–2 verbs, a verb being a camp **or** combat action"* — the
    archetype-5 carve-out the substrate already anticipates.
- **The non-combat triad, now designed:** Merchant (D70) · Cook (D71) · Noble (D71), each a
  presence-anchor + verbs. **Banker remains** (its verbs exist; its 2+1 pass is still ahead) — and it
  notably **lacks a presence anchor** today (a gap a pass would address).
- **Spec:** [`docs/design/systems/jobs.md`](../../docs/design/systems/jobs.md) (Worked examples — the Cook, the Noble).
- **Open / next (the gap before build):** the **action-registration substrate** — the 3+ patterns that
  author a non-combat action (registry `OverworldAbility` / meta-`SkillDef` / economy-fn) want unifying,
  plus the **new mechanisms** these kits need: Cook Stew's **Upkeep-coupling** (zero the Food line) +
  **RP-banking** + a **computed cost** (= the night's food value, not a static number); Find Trade's
  **per-node market state** & Savvy Barter's **one-shot primed flag**; an **`availableAbilities`**
  projection (so the camp UI stops hardcoding `getAbility("survey")`); and a **presence/faucet
  registry** (Appraisal / Renown / the per-step accruals). Each class's **prestige fork** is reserved
  (non-combat verb-prestige). The **numbers pass** (Cook Stew RP, Feast magnitudes/cost, the `restPoints` floor).
- **Reuses / consistent with:** **D70** (the non-combat house style it applies), **D65** (per-class
  pass), **D9** (Rest-Point recovery — Cook Stew's new sink), **D15** (Upkeep — the Food line Cook Stew
  satisfies), **D45** (voluntary-skip — the exploit the free-food closes), **D62** (Influence — the
  Noble's economy), **D8** (morale — Feast), **D40** (2+1, generalized to the non-combat medium).
- **Build:** **built** (2026-06-24) on the D72 substrate — Noble's **Renown** (`JobDef.faucet`, retiring
  `accrueNobleInfluence`); Cook's **Cook Stew** (`provisionMeal`, computed Food-value cost + RP bank),
  **Feast** (morale), Field Kitchen kept, `restPoints` 3→1, and the **chef→cook rename**. Tests:
  `cook.test.ts` + `presence-faucet`. Commits `9a971fa` (Noble) · `32a7e93` (Cook).
- **Superseded by:** —

---

## D72 — The non-combat action substrate (unify overworld-action registration)

- **Status:** Decided **+ built** (the substrate machinery, **fixtures only** — no real class
  kit), 2026-06-24. Sibling to **D61** (the two-axis limiter) and **D65** (the grant seam): the
  shared machinery the non-combat triad (D70/D71) needs *before* its kits can be built. Resolves
  the open architectural calls D70/D71 deferred.
- **Context:** authoring "a thing a class does between nodes" followed **3+ inconsistent
  patterns** — a registry `OverworldAbility` (`OVERWORLD_ABILITIES`, job-gated, declarative
  effect), a meta `SkillDef` on `JobDef.skills` (Cook Stew, surfaced via D67's `availableSkills`),
  and bespoke economy fns (`merchantBuy` / `patronize` / …, ad-hoc gates). The triad's new verbs
  (Find Trade, Savvy Barter, Cook Stew, Feast) had no clean home and needed primitives that
  didn't exist (a computed cost, per-node / one-shot state, an Upkeep coupling). Building the kits
  onto that fragmentation would deepen it — so the substrate came first.
- **Decision 1 (the keystone) — one home: `JobDef.skills` (A2); `availableSkills` the one
  projection.** A job's overworld actions are **`SkillDef`s** carrying an `overworldCost` (the
  two-axis menu) + an `OverworldActionEffect`, surfaced through the **D67 `availableSkills`** path
  like combat/deploy skills — so the render no longer hardcodes `getAbility("survey")`. **Survey
  migrated** onto the Scout job; the parallel `OVERWORLD_ABILITIES` / `getAbility` /
  `takeOverworldAction` / `OverworldAbility` registry was **retired**. (A1 — generalize the
  registry — was rejected: it entrenches a second home. **A3** — migrate the economy verbs onto
  JobDefs too — is the **north star**, deferred; the verbs stay as functions the resolvers call,
  an incremental migration.) *Owner-confirmed A2.*
- **Decision 2 — computed (provider) costs.** A price knob may be a provider
  `gold?: number | (run) => number`, resolved at the gate (`resolveKnob`), so Cook Stew prices
  itself at *the night's Food value* rather than a static number. A provider counts as priced, so
  the two-axis no-free-and-unlimited invariant still holds at load. Generic + minimal — no typed
  cost-kind per dynamic price.
- **Decision 3 — per-node / one-shot ability state.** A general **flag bag** on
  `OverworldEconomy`: `nodeFlags` (per-node, reset by `tickCooldowns` — the Find-Trade "market
  opened here" flag, folded into `effectiveMarketTier`) and `primedFlags` (one-shot, consumed on
  read — the Savvy-Barter "next deal primed" flag). A bag, not ad-hoc fields — more verbs will want it.
- **Decision 4 — presence / faucet as data.** `JobDef.presence` (Appraisal's `marketTierBonus`,
  read by `effectiveMarketTier`) + `JobDef.faucet` (Renown's `influencePerStep`, accrued by
  `breakCamp`'s `accrueDeclaredFaucets`), plus a `jobPresenceSummary` card hook. **Built now**
  (additive + injectable-lookup; dormant until a class declares one, so the sim is byte-identical).
- **Decision 5 — the gate taxonomy as data.** Beyond the implicit **Class** gate (living on a
  job), an action declares a **Capability** gate (`SkillDef.requires`, e.g. `"healer"` /
  `"lockpick"`), resolved by the exhaustive `CAPABILITY_PREDICATES` registry (`unitHasCapability`)
  — the Triage/lockpick shape, auto-extending to any future class that earns it. Both
  `availableSkills` and the interpreter honor it. (Access = the market-tier read; Stat / Universal
  unchanged; `docs/design/systems/actions.md` is the taxonomy.)
- **The interpreter + the effect registry.** One interpreter — **`useOverworldSkill`** — gates
  (capability + the shared two-axis cost), applies the effect via the **exhaustive
  `OVERWORLD_EFFECT_HANDLERS`** mapped-type registry (mirroring `BATTLE_EFFECT_HANDLERS` /
  `FORECAST_HANDLERS` / `GRANT_EFFECT_HANDLERS`: a new kind fails the build until handled), then
  commits + grants use-XP. The **Upkeep coupling** is a primitive: a `provisionMeal` effect
  satisfies an Upkeep line (`camp.satisfiedUpkeep`), which `payUpkeep` reads **before** billing
  (no double-charge, no morale/gear consequence), ordered by the camp flow (cook → End the Night).
- **The three kits are the next content pass.** Merchant (Appraisal · Find Trade · Savvy Barter) ·
  Cook (Field Kitchen · Cook Stew · Feast) · Noble (Renown · Patronize · Bribe) **consume** this
  substrate — exactly as the Scout/Soldier passes consumed the D65 prestige substrate. Proven here
  with **throwaway fixtures only** (never in `JOBS`), so the deterministic sim stays byte-identical.
  The numbers pass (Cook Stew RP, Feast magnitudes, the `restPoints` floor, the limiter knobs) and
  the `chef → cook` rename belong to that pass.
- **Spec:** the build brief
  [`non-combat-action-substrate-build.md`](non-combat-action-substrate-build.md); the worked kit
  examples in [`docs/design/systems/jobs.md`](../../docs/design/systems/jobs.md) (D70/D71).
- **Reuses / consistent with:** **D61** (the two-axis limiter / single gate — extended with
  computed costs), **D65** (the grant seam's fixture-injection + exhaustive-registry ethos), **D67**
  (the one `availableSkills` projection — now the overworld home too), **D29/D35** (the cooldown
  spine), **D70/D71** (the consumers it serves), **D15/D45** (Upkeep — the line a meal satisfies),
  **D9** (Rest Points — the meal's bank), **D62** (Influence — Renown's faucet).
- **Build:** **built** — machinery + fixtures, one PR, one commit per increment, each green +
  reversible. No real kit content; no fixture in a live registry; `test` / `build` / `test:e2e` /
  `sim` green at every increment, sim byte-identical.
- **Superseded by:** —

---

## D73 — Fatigue redesign: banded consequences + the clearing currency

- **Status:** Decided **+ built** (the model + recovery wiring + combat hook + Forage, in 4 green
  increments; numbers are first-pass and tunable). A
  re-evaluation of **D29/D35** in light of the cost machinery built since (D61 two-axis limiter,
  D72 substrate): with cooldowns, per-node caps, gold/influence/rp knobs and capability gates now
  carrying pacing, price and access, fatigue's original job as "the single overworld limiter" is
  gone. This record re-scopes it to the niche nothing else fills and gives its bands real teeth.
- **Context:** fatigue (D29) predates almost the whole cost menu and was demoted by D35 ("not the
  spine — cooldowns are"). The result was a mechanism with no live job: only **Survey** (cost 1,
  also cooldown-paced) and **Triage** (cost 2) spend it, so in a ~7-layer demo it **never crosses
  the floor** — invisible because nothing *costs* enough, not because the floor is mis-set. Meanwhile
  the bands (Worn/Weary/Exhausted) carried only a soft surcharge + a near-vestigial lock (one user,
  Triage). The fix is content + consequences, not retuning the constants.
- **Decision 1 — fatigue is the *clearing currency* (re-scope).** It is the only **per-character**
  cost (every other knob is per-ability pacing or a shared run pool), so it is reserved for the
  **clearing-verb family**: slow, repeatable, **gold-free**, personal-effort verbs done *at* a node —
  **Forage, Train, Triage**. Cheap recon (Survey) is paced by its cooldown and should shed fatigue
  (or keep a vestigial 1). Legible rule: *if a verb costs fatigue, it's a clearing verb.*
- **Decision 2 — banded consequences (replace surcharge+lock).** **Worn** (0…`floor`) = safe, **wiped
  by any night**. **Weary** (`floor`…`exhausted`) = this unit's nightly **rest-heal costs more RP**
  (shared pool, floored ≥1) **and** it **carries `level − floor` fatigue into the next day** (only an
  improved rest clears the carryover). **Exhausted** (≥`exhausted`) = heaviest heal cost + full
  carryover + a **combat tempo debuff** (fields **Slowed**). **No hard action-lock** —
  consequence-based, not prohibition-based ("recoverable and outplayable"); the `ceiling` clamp stops
  runaway. Constants (`floor 6` / `exhausted 12` / `ceiling 18`) survive; the change is semantic +
  cost-side (give clearing verbs real cost: Train ≈ `floor+2`, Forage 2, Triage 2).
- **Decision 3 — fatigue reaches combat, at Exhausted only (revises D29).** The hard rule "fatigue
  never touches combat" is **dropped** — a consequence that never reaches the main loop is weak. Only
  **Exhausted** bleeds in, and only as a **tempo status (the existing `slowed`)**, never a flat power
  debuff (preserves "punish choices, not execution"). Universal across playstyles: a Slowed combatant
  loses tempo/output, a Slowed engine unit (which fields too — D38) is harder to protect. Sharpens the
  **eggs-in-one-basket** pressure (a unit exercising two clearing roles tires faster).
- **Decision 4 — the two-tier recovery is the wipe topology (D47).** An **ordinary night** (combat
  camp / in-place rest) wipes Worn and carries Weary; the **improved rest at a clearing/rest node**
  clears *all* fatigue + lifts the heal-penalty — so a heavy verb (Train) is free at a clearing but a
  gamble on the march. Fatigue is the rest node's **exclusive customer** (in-place rest can't clear
  Weary), giving the premium tier its reason to exist.
- **Worked verb (Forage):** `overworldCost { usesPerNode: 2, fatigue: 2 }` (within-clearing pace ×
  across-clearing stake); a new `forage` effect with a **guaranteed floor + job-level-scaled rolls**
  drawn via `streamFor(seed, "forage:<nodeId>:<night>:<useIndex>")` (the night + use-index are
  **required** for replay determinism — the prompt's `"forage:"+nodeId` alone would repeat rolls).
- **Open / tuning:** RP heal-cost multipliers; the Slowed magnitude + duration (start gentle,
  whole-encounter, CT-only; consider gating L2 charged moves later); whether Weary also bleeds a
  milder combat effect (start Exhausted-only); fully dropping the demanding-action lock (leaning yes);
  clearing/rest-node **frequency** as a balance lever (sparse clearings make Exhausted punishing).
- **Reuses / consistent with:** **D29/D35** (revised — the bands + shallow floor kept, the
  "overworld-only" rule and the surcharge/lock dropped), **D47** (the wipe topology), **D9** (RP — the
  heal-cost lever), **D61/D72** (the cost menu fatigue now sits *beside*, not atop), **D38** (engine
  units field, so the combat consequence reaches them).
- **Superseded by:** —

---

## D74 — Scout kit reorder + Recon, the dual-surface verb (Set Trap L1 · Recon L2)

- **Status:** Decided + built. A revision of **D68** (the Scout pass) made while building **Node 2**
  (the L2 clearing) so the demo can teach **leveling → a new overworld action** there, and a small
  reusable skill-framework extension (`overworldEffect`).
- **Context:** D68 had **Dash** at L1, **Set Trap** at L2, and **Survey** as a *separate* overworld
  skill (ungated, L1). Two demo problems: (1) the L1 Scout's only usable active was Dash (a +3 move)
  — thin; Set Trap (lay a snare) is the more engaging starter. (2) Survey at L1 meant the
  overworld-action layer was already live from the first node, so Node 2 couldn't *introduce* it.
  And conceptually the player wanted **one verb** that reads on both surfaces.
- **Decision 1 — Set Trap → L1.** The Scout fields its full combat kit (Set Trap + the base move)
  from L1. Still resource-gated on a **trap-kit** item, so "fun initially" needs the party to carry
  one (Decision 4).
- **Decision 2 — fold Dash + Survey into one verb, *Recon*, at L2.** Recon is **dual-surface**: in
  **battle/deployment** it darts +3 tiles (the old Dash — Swift); on the **overworld** it scouts a
  node ahead (the retired Survey — `survey` tier-bump). The Scout's **L2 growth is the overworld**,
  not a 2nd battle active — on-theme for the recon specialist, and it keeps the 2-active count
  (Set Trap + Recon), so the Scout *re-joins* the D40 "2nd active at L2" cadence rather than being an
  exception. Because L1's reward levels every survivor to L2, **Recon's overworld face first becomes
  usable exactly at Node 2** — the demo's intro to overworld actions, tied to a felt level-up.
- **Decision 3 — the skill-framework seam (`overworldEffect`).** A skill can declare a combat
  `effect` **and** an `overworldEffect` (its between-nodes face). `useOverworldSkill` resolves
  `overworldEffect ?? effect`; the render surfaces a node-aimed one (a `survey` overworldEffect) on
  the Survey beat; `usableContext: [pre-combat, combat, overworld]` spans the three surfaces; the
  dossier tag shows both (`Battle · Move / Camp`). Reusable for any future dual-surface verb. (The
  name **Recon** is a placeholder — renameable later.)
- **Decision 4 — demo bundle: `trap-kit×2`, storage cap 8 → 10.** So Set Trap is usable in the Node 1
  deployment ("let the player try it"). The +2 cap offsets the +2 starting load so run loot headroom
  is unchanged — else `addItem` drops rewards at cap, dropping the **Den relic** (caught by the 4B
  clear test). General-game Scouts are unaffected (no starting kit); demo tuning only.
- **Reuses / consistent with:** **D68** (revised — kit reorder only; the Assassin/Thief fork
  untouched), **D40** (the 2-active + 1-passive count holds), **D72** (Recon is the unified overworld
  SkillDef the gate rides), **D24/D48** (the survey face = the banded intel preview / route forecast),
  **D67** (Dash's dual-context-by-shape carries into Recon's combat face), **D14/D20** (the
  storage-cap scarcity the bundle tunes).
- **Superseded by:** —

---

## D75 — The inventory overflow substrate (grants land, then discard)

- **Status:** Decided + built. A general logistics-feel change: the reusable "over-stuff then trim"
  model and its discard screen. (The Node 2 *storage beat* that will teach this limit on the demo
  route is a separate design decision, tracked elsewhere; this record covers only the general system.)
- **Context:** Storage was a **hard invariant** — `addItem` refused any add over the cap and returned
  `false`, so a reward/relic/Forage find that didn't fit was **silently dropped** (a known sharp edge:
  the **Den relic** could vanish if the stash was full; D74 padded the cap to dodge it). A silent drop
  is a bad teacher: the player never sees the limit bite, and the loot they earned just disappears.
- **Decision 1 — the over-stuff-then-discard model.** A **grant** (a reward, the relic, a Forage find,
  recovered/harvested gear, a gift) now **always lands — even over the cap** — via a new unconditional
  **`grantItem`**. The resulting over-capacity (`slotsOver`) is cleared by a **deliberate discard**:
  the interactive **discard menu** (the player picks what to drop) or **`autoTrim`** (the headless
  default — sheds **lowest sale-value first**, ties by id, so high-value loot like the **relic
  survives**). One honest rule across the whole game: *items don't disappear; you choose what to let
  go.* A player **buy** stays **cap-enforced** (`addItem` kept — you can't buy what won't fit), and an
  **equip/unequip** move (D76) stays cap-enforced too (it can't overflow by construction).
- **Decision 2 — route every grant site onto `grantItem`.** Rewards + relic (`runloop`), the event
  reward + patron gift (`node-events`), Forage finds (`overworld-actions`), win-recovery
  (`resolution`), trap harvest (`traps`). `breakCamp` runs `autoTrim` as the headless safety net (a
  no-op once within cap), keeping the sim bounded + deterministic; the interactive camp trims first via
  the menu. The discard menu shows each row's **slot footprint**, so the slot-per-unit cuts are obvious
  and a half-stack (goods that share a slot) reads as a stacking lesson.
- **D76 reconciliation:** the gear system's `equip`/`unequip` move items stash↔slot via
  `addItem`/`canAdd`/`removeItem` — that stays correct (you can't overflow by equipping), so the
  substrate **adds** `grantItem` without re-routing any equip path. D76 added no new grant site.
- **Reuses / consistent with:** **D14/D20** (the slotted-stack storage cap this makes felt), **D6**
  (the provisioning constraint — now a *discard*, not a silent refusal), **D61** (sale-value orders
  the headless trim; loot/relic survive), **D46** (the discard gates at **Break Camp**, before the
  node-step tick), **D52** (the Den relic the trim now protects), **D76** (equip/unequip stay
  cap-enforced alongside the new grant path).
- **Open / deferred:** the **Node 2 storage beat** (the authored event + bundle tuning that will make
  this limit *felt* on the demo route) is its own decision; a future *expand-storage* faucet is
  unspecified; the run-wide storage **cap** value remains demo-tuning.
- **Superseded by:** —

---

## D76 — The gear / item system: blanket Condition × per-unit Arms

- **Status:** Decided + built (the substrate + the aggregate stamp, in green increments;
  per-unit item *content* — the relic effect, a weapon market — is deferred, see below). A
  design pass over the half-built gear models (the D52 blanket gear-condition, the
  iron-weapons holdover, the unbuilt relic), realizing the per-unit **locked equipment**
  scarcity **D25** named but never built.
- **Context:** Three gear models were partly in conflict: (1) the **blanket gear-condition**
  (D52) — one party-wide axis, durability = the D15 Repairs upkeep, **no per-weapon meter**;
  (2) the **iron-weapons holdover** — a single boolean that shifts the blanket axis and decays;
  (3) the **relic** (`relic-hollow-blade`) — a build-defining unique weapon with no equip slot
  and no effect. The crux: does a unique weapon get a real per-unit slot (seeming to overturn
  "no per-weapon meter"), and does it carry its own condition? *(Housekeeping: the build prompt
  cited a "just-landed D75" pulling iron-weapons out of Node 2 — **no D75 exists in this repo**
  at authoring time and the Node-2 `provision-choice` still offers `take:iron-weapons`. D76
  captures the gear substrate D75 gestured at and **leaves the Node-2 beat where it is**; if a
  real D75 surfaces, reconcile then.)*
- **Decision — two orthogonal axes, one stamp.** The conflict dissolves once *durability* and
  *equip-location* are separated:
  - **Condition** (blanket, the maintenance chore, D15): the party-wide `gearWear` axis paid
    down by Repairs. It stays the **only** durability axis — **no per-weapon meter** is
    preserved (logistics L86–88). It **degrades** equipment rather than carrying a private
    meter.
  - **Arms** (the discrete gear you acquire & equip): **grants** stat deltas (+ optional
    keyworded passives). Two scopes share the model — the **party set** (iron-weapons, still
    computed by `gearDelta(run)` unchanged) and **per-unit slots**.
  - **Per-unit equip slots:** a fixed three — `weapon`, `armor`, `accessory` — on
    `Unit.equipment` (D25 "can't field one good sword twice"; the home for build-defining
    uniques). **Equipped gear is caravan-locked to the unit**, so it lives on the unit, *not*
    in the D14 shared stash.
  - **Condition × Arms coupling:** the shared `gearWear` dulls a *maintained* item's positive
    attack/defense (eroded to 0, never flipped negative); a `maintained: false` item (a relic)
    shrugs off wear ("legendary doesn't rust"). The degradation **reads the shared axis**,
    never a per-item number — so the rejected meter does not return.
  - **One revertible stamp:** `applyGearCondition` folds the blanket delta **+** each unit's
    `equipDelta` into a single signed `StatDelta` (+ granted passives), stamped at staging and
    reverted between battles. An un-equipped, un-worn, no-iron run is the **identity** — so it
    stays **byte-identical** (verified: the 853 prior tests are untouched; +23 new).
  - **Acquisition & storage:** an equippable-from-stash item is **dual** — a `MaterialDef`
    (D14 storage accounting) **and** an `EquipmentDef` (effect) sharing one id. The relic
    already has the `MaterialDef`; `equip()`/`unequip()` move an item stash↔slot (a
    Camp/Pre-deployment verb). Faucets: authored grants (the relic, via `grants.item`) and a
    future weapon **market** (the def carries `saleValue`). A **smith-that-upgrades is
    explicitly out of scope** (it muddies D15's "Repairs = chore" line; belongs to a future
    Blacksmith per-class pass).
- **Deferred (own follow-ups):**
  - **The relic's effect** — `relic-hollow-blade` stays an **inert stash material**; the
    `EquipmentDef` (its `mods`/`passive`, `unique: true`, `maintained: false`) is added when
    its effect is designed with the user.
  - ~~**`steel-armor` / a second party set**~~ — **generalized in D78.** The `PARTY_GEAR`
    shape now exists: party-set gear is a **carried material** with a `partyGear` marker, and
    iron-weapons is the first such item (off its run flag). A second set is just another
    material; `steel-armor` is content, no longer a substrate gap.
  - **Full loadout / armory UI / guild-level locking** — only the three core slots + pure
    equip verbs ship; the render and the guild armory are later.
- **Reuses / consistent with:** **D14** (the stash is unchanged; equipment is the per-unit
  counterpart to "wide logistics"), **D15/D52** (Condition stays the one blanket durability
  axis, no per-weapon meter), **D25** (realizes the "locked equipment" scarcity), **D40**
  (equipment passives reuse the `passives` bag combat already reads), **D2** (pure core, no
  RNG; revertible like `gearStamp`).
- **Spec:** `src/core/equipment.ts` (registries + `equipDelta`/`equip`/`unequip` + stat
  apply/revert), `src/core/gear-condition.ts` (the aggregate stamp), `src/core/units.ts`
  (`equipment`, `EquipSlot`, `StatDelta`, the generalized `gearStamp`),
  [`docs/design/systems/logistics.md`](../../docs/design/systems/logistics.md) (Equipment).
- **Superseded by:** —

---

## D77 — The equip surface: the render half of the gear system + the first equippable

- **Status:** Decided + built (the reusable equip UI + the first real equippable, in green
  increments). D76 shipped the equip **core** (`equip`/`unequip`/`equipDelta`/`equippedIds`,
  the per-unit slots, all the rules) but left it **unreachable in play** — `grep equip
  src/game/` returned nothing, and `EQUIPMENT` was empty (the relic still an inert
  `MATERIALS`-only stub). D77 is the missing render half.
- **Context:** Three gaps blocked the gear system from being playable: (1) **no equip UI** —
  the core was code-only; (2) **no real equippable** — `EQUIPMENT` had no content, so even a
  UI had nothing to show; (3) the surface's **natural home** (the Captain's Tent party
  dossier) is a deliberately **pure, read-only projection** ("data in, `onClose` out, never
  reaches into a scene"), so adding a *mutating* equip verb risked breaking that decoupling.
- **Scope call (agreed with the user):** this PR ships the **reusable equip surface** + the
  **first equippable** only. The Node-2 traveler weapon-**gift** special event (the
  gift→overflow→discard→equip teaching arc the build brief framed) is **deferred to its own
  session**, because (a) it depends on **D75** (the discard substrate: `grantItem`/`slotsOver`/
  `autoTrim`), which is **built on its branch but unmerged** at authoring time, and (b) the
  user wants the Node-2 beat (and the iron-weapons reconciliation it implies) handled
  dedicated. So Node-2 `provision-choice` and the `iron-weapons` pick are **untouched**.
- **Decision — the surface is the dossier's Arms panel; the core owns every rule.**
  - **Where it lives:** the per-member detail card in the **party dossier** (Captain's Tent
    → Party tab) grows an **Arms** section — the three slots (weapon/armor/accessory) + worn
    gear and its mods. Click a slot → a **picker** of the carried equippables that fit (plus
    **Unequip** when worn) → the chosen verb fires.
  - **Decoupling preserved:** the view stays "data in / intent out". It gained two optional
    intents — `onEquip(unitId, itemId)` / `onUnequip(unitId, slot)` — and reads everything it
    draws from the **projection**, never the unit/inventory. The **host** (`OverworldScene`)
    owns the rules: the intents call the pure `equip`/`unequip` and re-`renderTent()`. No rule
    lives in the scene; the view touches neither inventory nor unit.
  - **Projection extension:** `DossierProjection` gains per-member `slots: EquipSlotView[]`
    (worn id/name + a compact `+2 Atk` mods summary) and a run-level `equippables:
    EquippableLine[]` (carried stash ids that are also `EquipmentDef`s — the picker
    candidates). Both are **empty for an un-equipped run**.
  - **The first equippable — the Wayfarer's Blade (`wayfarer-blade`):** a modest, **dual-
    registered** weapon (a `MaterialDef` for storage + an `EquipmentDef` for effect, one id —
    the relic's intended pattern). A `maintained: true`, `+2 attack`, **non-unique** weapon,
    `saleValue: 30` — the **worked teaching example**: the D76 condition axis (`gearWear`)
    dulls its bonus (2 → 1 → 0, floored, never negative), so a player *sees* gear degrade.
- **Byte-identical guard (the D76 identity holds).** Registering an equippable in `MATERIALS`
  would otherwise leak into two seeded/rendered reads, so both **exclude equipment**:
  - `shopStock` (node-events) — equippables are **not** generic roadside shuffle stock (they
    come from authored grants / a future weapon market), so they're filtered out of the pool;
    the seeded shop selection is unchanged.
  - `projectManifest` (the Stores catalog, which pads every known material) — a **zero-count**
    equippable is omitted (it belongs to the Arms surface, not the consumables catalog); a
    *carried* one is itemized. Storage slot accounting (`slotsUsed`) is unaffected either way.
  Both filters are **no-ops while no equipment is carried** → an un-equipped run is identical
  (verified: the 876 prior tests are untouched; +8 new).
- **Combat is free (D76).** Equipping changes nothing in combat code: `applyGearCondition`
  already folds each unit's `equipDelta` into the staging `gearStamp`, so the next battle
  reads the new gear (degraded by the shared `gearWear`) with no new wiring.
- **Deferred (own follow-ups):**
  - **The Node-2 weapon-gift special event** — the gift→overflow→discard→equip arc, **once
    D75 merges**: the traveler `grantItem`s the blade (lands over-cap), it overflows a
    near-full bundle into the D75 discard menu at Break Camp, then the player equips it at this
    surface. Carries the **iron-weapons reconciliation** (4th option / supersede / move) the
    build brief flagged. Its dedicated session.
  - **The relic's effect / a weapon market / a fuller armory** — unchanged from D76's deferrals.
- **Reuses / consistent with:** **D76** (calls the pure core verbs unchanged; the identity
  stamp does the combat work), **D58** (the Captain's Tent is the deep-info hub; Arms joins
  the Party tab rather than adding a fifth tab), **D2** (pure core, deterministic projection;
  the render only calls + redraws), **D14** (the stash is unchanged; equip moves stash↔slot).
- **Spec:** `src/core/equipment.ts` (the `EQUIPMENT` first entry) + `src/core/inventory.ts`
  (its dual `MaterialDef`), `src/core/dossier.ts` (the equip projection), `src/core/index.ts`
  (the barrel now exports `equipment`), `src/core/node-events.ts` + `src/core/manifest.ts`
  (the byte-identical filters), `src/game/party-dossier-view.ts` (the Arms panel + picker +
  equip intents), `src/game/scenes/OverworldScene.ts` (the host wiring),
  `src/core/equip-surface.test.ts` (+8), `scripts/shots-dossier.mjs` (the surface capture),
  [`docs/design/systems/logistics.md`](../../docs/design/systems/logistics.md) (Equipment).
- **Superseded by:** —

---

## D78 — Party-gear: possession-driven party-wide gear as a stash material

- **Status:** Decided + built (the party-gear shape + iron-weapons migrated to it, in green
  increments). Realizes the `PARTY_GEAR` generalization **D76 named and deferred** (its
  "second party set" follow-up), and pulls the last gear model off a run flag.
- **Context:** After D76/D77 the gear system had two clean shapes — the blanket **Condition**
  axis and **per-unit Arms** (equipment, caravan-locked to a unit) — but the **party set**
  (iron-weapons) was still a one-off: a `run.flags["iron-weapons"]` boolean that `gearDelta`
  special-cased into a blanket +attack. That left three loose ends: the party-set effect
  wasn't a *thing you carry* (so it cost no storage and couldn't be a discard decision), the
  flag was bespoke state outside the inventory, and D76 had explicitly deferred a real
  `PARTY_GEAR` registry to "the second set."
- **Decision — party-gear is a material that confers a party-wide effect by being carried.**
  A new **third gear shape**, distinct from per-unit equipment in two ways: it is **never
  equipped to a unit** and it **never leaves the shared stash** — owning it permanently spends
  a slot.
  - **The marker:** `MaterialDef.partyGear?: { mods?: StatDelta; passive?; maintained? }`. A
    material carrying it **is** party-gear — it sits in `MATERIALS`, in the shared stash, and
    counts against the storage cap like any material. That persistent footprint is the point:
    it competes for storage, so a near-full discard becomes a real "keep the buff or the
    utility?" choice.
  - **Possession-driven effect:** while **≥1 is carried**, the party gets the effect.
    Possession is **boolean** by default — copies don't stack (carrying three confers it once);
    a tuning choice, easy to revisit.
  - **One degradation rule, shared:** the shared `gearWear` **dulls** a `maintained` party-gear
    item's positive bonus toward 0 (never flipping negative) — the *same* rule per-unit
    equipment uses, factored into `equipment.ts`'s exported `degradedMods({mods, maintained},
    wear)` so both gear scopes share one code path. **No per-weapon meter** (D15/L86–88):
    durability stays the single shared `gearWear` axis; party-gear adds no private meter.
  - **The split is preserved.** Only the **+attack/bonus side** is possession-driven. The
    worn-gear **−defense penalty stays blanket** — driven by `gearWear` alone, so it still bites
    an **un-geared** party. `gearDelta(run)` now returns `{ stats, passives, defensePenalty }`:
    `stats`/`passives` are the summed carried-party-gear contributions (degraded), `defensePenalty`
    the unchanged blanket worn-gear bite.
  - **Combat is free (D76 path).** `applyGearCondition` already folds the party-wide delta +
    per-unit `equipDelta` into the one revertible `gearStamp`; the new party-gear `stats`/
    `passives` route through that same fold, so combat reads it for nothing and it reverts cleanly.
  - **iron-weapons migrated:** registered in `MATERIALS` (`stackSize 1, slotCost 1, recoverable
    false, saleValue 30, partyGear: { mods: { attack: 3 }, maintained: true }`) — its felt power
    (the old `GEAR_CONDITION.ironAttack` +3 and the per-wear decay) carries over unchanged. The
    Node-2 `take:iron-weapons` provision pick now `grantItem`s the material instead of setting the
    flag; the `IRON_WEAPONS_FLAG`/`ironAttack`/`ironDecayPerWear` constants are gone.
- **Byte-identical guard.** A new material in `MATERIALS` would otherwise leak into two seeded/
  rendered reads, so both now **also exclude party-gear** (as they already excluded equipment,
  D77): `shopStock` (party-gear isn't generic roadside stock) and `projectManifest` (a zero-count
  party-gear doesn't pad the Stores catalog). With nothing carried, `gearDelta` is the identity —
  so an un-upgraded run is unchanged; the procedural sim (default `take:trap-kit`, never iron) is
  stable (the 896-test suite is green: this was a flag→possession move, not a numbers change).
- **Reuses / consistent with:** **D76** (the third shape slots beside Condition × Arms; the
  identity stamp does the combat work; `degradedMods` is the shared rule), **D75** (the grant lands
  unconditionally and the persistent slot makes the discard menu bite), **D14** (lives in the one
  shared stash; storage accounting unchanged), **D15/L86–88** (no per-weapon meter; one durability
  axis), **D2** (pure core, deterministic, revertible).
- **Deferred (own follow-up):** ~~the **Node-2 traveler-event rework**~~ — **done: D79.** (The
  shape this record built is now consumed by the Node-2 beat.) `steel-armor` / further party-gear
  is now just content.
- **Spec:** `src/core/inventory.ts` (the `partyGear` marker + the iron-weapons material),
  `src/core/equipment.ts` (the shared `degradedMods` + exported `addDelta`), `src/core/gear-condition.ts`
  (possession-driven `gearDelta` + the generalized `GearDelta`; flag dropped), `src/core/node-events.ts`
  (the provision pick grants the item; `shopStock` filter), `src/core/manifest.ts` (the catalog filter),
  `src/core/run.ts` (the flag-comment sync), `src/core/equipment.test.ts` (+7) /
  `src/core/hollow-mill.test.ts` (the pick test),
  [`docs/design/systems/logistics.md`](../../docs/design/systems/logistics.md) (Equipment).
- **Superseded by:** —

---

## D79 — Node 2's storage lesson: the traveler-gift that overflows (the beat, on D75/D78)

- **Status:** Decided + built. The **content/assembly** beat that consumes the systems landed
  in D75 (overflow→discard) and D78 (party-gear iron-weapons) — no new mechanic, pure wiring +
  tuning of the authored Hollow Mill Node 2. (Closes D78's deferred "Node-2 traveler-event rework.")
- **Context:** Node 2 ("the first clearing", D74) was meant to teach **storage scarcity**, but
  the beat never bit: it was a **pick-one** ("Camp on the Road" — trap-kit / iron-weapons /
  cook-stew) on a **slack** bundle (5 of 10 slots), so nothing ever overflowed and the player
  never faced a discard. Meanwhile the dependencies had all shipped (grant→overflow→discard D75,
  iron-weapons as a slot-consuming party-gear material D78), so the beat was now pure assembly.
- **Decision 1 — the gift is unconditional, not a pick-one.** A roadside traveler **presses
  gifts on the party** — **2 trap kits + 1 iron-weapons** — granted on *any* path via
  `grantItem` (they always land, over the cap, D75). The event is no longer a choice *between*
  finds; the real decision is **which to discard afterward**. The Cook-Stew payoff is **kept**,
  riding *alongside* the gift (a second choice that takes the gifts **and** banks +2 RP when a
  Cook is aboard — and in the demo Pip is, recruited at Node 1).
- **Decision 2 — a deliberately full bundle (cap 10 → 5).** The 5 starting supplies (salve×2,
  stimulant×1, antidote×2 each pack to 1 slot; trap-kit×2 = 2) fill the cap **exactly**, so
  storage is felt from step one and the gift is guaranteed to overflow. Tuned tight on purpose;
  the run-wide squeeze is the storage through-line, not a Node-2-only stunt.
- **Decision 3 — robust across trap usage.** D74 lets the player spend trap-kits at Node 1, so
  arrivals vary (2/1/0 traps left). Spending traps only **frees** slots, but the **3-slot gift**
  (trap-kit×2 + iron-weapons×1) overflows every case — a forced discard of **3 / 2 / 1** for
  kept-both / used-one / used-both. "Either way, something must go" holds for all play.
- **Why it teaches.** Iron-weapons being a **carried** party-gear item (D78) makes the discard a
  real trade: **keep the +attack buff, keep the snares for L3, or shed the pre-Medic medical
  dead-weight?** The honest rule the whole game now shares — *grants don't vanish; you choose
  what to let go* — lands here for the first time the player feels it.
- **No render change.** The event still dispatches through `showProvisionScreen` →
  `renderEventChoicePanel`, and the **discard menu already gates Break Camp** (D75) — so the
  overflow surfaces with zero new UI. Headless stays bounded via `autoTrim` in `breakCamp`.
- **Reuses / consistent with:** **D75** (the grant lands; the discard menu/`autoTrim` clears the
  overflow), **D78** (iron-weapons is the slot-consuming party-gear that makes the discard a
  trade), **D74** (the clearing frame + the Node-1 trap-spend that the tuning is robust to),
  **D52** (the authored Node-2 event + bundle), **D14** (the one shared slotted stash).
- **Open / tuning:** cap **5** is a demo-wide value (revisit if the mid/late economy feels too
  tight — autoTrim protects high-value loot like the relic, and the L5 market lets the player
  sell to free slots); the gift is fixed `trap-kit×2 + iron-weapons×1`.
- **Spec:** `src/core/hollow-mill.ts` (cap 10→5; topology comment), `src/core/node-events.ts`
  (the unconditional-gift provision event + `applyProvisionChoice` + `TRAVELER_GIFT`),
  `src/core/node-events.test.ts` (the overflow tests),
  [`docs/design/expedition-hollow-mill.md`](../../docs/design/expedition-hollow-mill.md) (L2
  section, bundle, topology, route-change log).
- **Superseded by:** —

---

## D80 — The overworld node pass: the night/day loop, one effort meter, and the on-node intel surface

> **Backfilled 2026-07-08.** This decision was designed, built, and shipped (PRs #91–#104,
> with the on-node intel surface #105–#108 and in-place rest #109 riding the same label),
> and it is cited throughout the codebase and by D83/D85/D86 — but its log entry was never
> written; the headings jumped D79 → D81. Reconstructed from the kickoff brief
> ([`docs/design/implementation/d80-node.md`](../../docs/design/implementation/d80-node.md)),
> the canon it updated (`docs/design/systems/overworld.md` — the "(D46, revised D80)" /
> "(D47, revised D80)" / "Early events (D80)" sections; `docs/design/glossary.md` Lifecycle),
> and the shipped PR history. **Ratified as backfilled — edit freely; the docs above remain
> the source of truth for the details.**

- **Status:** Decided + built (design PRs #91/#93/#95/#96, 2026-06-30 → build #97–#104 + #109,
  2026-07-04) · revises **D46** (node lifecycle) and **D47** (recovery) · supersedes **D73**'s
  fatigue-carryover rule · entry backfilled 2026-07-08
- **Context:** Three seams had accumulated on the overworld node: the lifecycle had **one**
  camp and a single fused "Rest & Set Out" verb (#94), so planning-the-road and resting-on-
  arrival were the same beat; recovery split across D73's `level − floor` fatigue carryover
  and the rest chip in `recordNight` (post-encounter — the wrong end of the road); and a
  node's intel lived only in a hover preview, with no persistent read, no sense of scouting
  *progress*, and no arrival texture between nodes.
- **Decision (three strands, one pass):**
  1. **The night/day loop (revises D46).** A node runs `[encounter] → REACT camp (scout
     ahead / bank loot / pick the next node = Set Out) → the road (early events; travel
     wounded) → PREP camp on arrival (the night's rest + gear up = Begin) → [encounter]`.
     The fused verb split into **Set Out** + **Begin**; the free nightly chip heal **retimed
     to arrival** (the prep camp), leaving `recordNight` bookkeeping-only; a Clearing's
     "encounter" *is* its arrival Deep Rest (no separate Begin beat).
  2. **One effort meter (revises D47, supersedes D73's carryover).** `OverworldCost.fatigue`
     generalized to **effort** — every overworld verb spends the same meter. **Narrowing
     fatigue tier floors** (Rested/Worn/Weary/Exhausted); an ordinary night **steps down one
     tier** to the floor of the tier below (replacing D73's `level − floor` carryover); a
     Clearing's **Deep Rest** wipes fatigue fully, with the **big heal gated on
     Tier-0-at-rest-time**; **in-place rest** = the free chip floor + an RP accelerator
     (#109). Fatigue surfaced at the point of decision: the dossier tier + a projected delta
     on ability hover.
  3. **The on-node intel surface + the arrival layer.** Readout tiles + the pinned,
     structured intel card with the **`???` reveal idiom** (#107); the segmented
     **intel-meter ring** that fills as you scout (#108); survey/forecast targets labeled by
     kind + depth, not raw node id (#106); cost-component action cards (#105). **Survey**
     reworked (effort 4 · cooldown 1 · the react camp's Intel drawer; effects: sharpen the
     target's bands / the fog-reach lever / reveal the node's early event). **Early events —
     the arrival layer:** a random pool (thief/patron/merchant reuse) + tailored node-bound
     events + the gated, loot-forgoing **bypass**.
- **Parked at the time (still open):** the Train progression sub-system; paid in-place rest
  beyond the free floor; the route-forecast fatigue projection ("Tier 0 when it reaches the
  Clearing?").
- **Reuses / consistent with:** **D35** (fatigue as the loose guardrail — now the one effort
  meter), **D29** (the two-economies separation holds; effort never touches the CT clock),
  **D24** (the preview the card structures), **D74** (the Recon/Survey split the rework
  consumes), **D46/D47** (revised in place).
- **Consumed by:** **D83** (the hazard + info lanes land on this card), **D85** (the
  "no new intel to find" terminal + the meter), **D86** (per-node depth = the meter's arc
  count), **D82–D84** (the Node-3 pass plays inside this loop).
- **Spec:** `src/core/fatigue.ts` (narrowing bands + nightly step-down), `src/core/runloop.ts`
  (`restNode` Deep Rest + Tier-0 gate, `inPlaceRest`), `src/core/run.ts` (`recordNight`/
  `breakCamp` retiming), `src/core/node-events.ts` (the early-event/bypass layer),
  `src/core/intel.ts` (the card projections), `src/core/jobs.ts` (`SURVEY`),
  `OverworldScene` (React/Prep camps, `renderIntelCard`, `drawIntelMeter`),
  [`docs/design/systems/overworld.md`](../../docs/design/systems/overworld.md) +
  [`docs/design/glossary.md`](../../docs/design/glossary.md) (the canon, updated with the build).
- **Superseded by:** —

---

## D81 — Standing orders widen to enemy behaviors: the leashed "hold" guard

- **Status:** Decided (2026-07-05) · widens **D41** (standing orders) onto the **D42**
  planner · the Node-3 pass, step 2 (follows the trap-engagement instrumentation)
- **Context:** Every enemy charges — `planEnemyTurn` always advances toward the nearest
  foe — so the L3 *Sapper's Snares* could be **waited out**: the lone straggler abandoned
  his own trap-field (crossing it safely, owner-side immune) and died at the party's
  deploy line, leaving the node's teaching beat ("you win or lose in the pre-combat
  read") optional scenery. Step 1's telemetry pinned the miss.
- **Decision:** `standingOrder` widens from "a player unit's reserved auto-action" (D41)
  to **"the unit's standing behavior when not player-driven"** — for an enemy that is
  *always*, so the auto-execution loop D41 deferred **is** the enemy planner, and the two
  cases (Pip's `"defend"`, an enemy's `"hold"`) share one field. First enemy behavior:
  **`"hold"` — the leashed guard.**
  - A unit ordered at creation gains a **`post`** (its authored tile). The planner
    (`planEnemyTurn`) lets a holder **act only from tiles within `AI.holdLeash` (2) of
    the post**, never approach-scores toward foes (it closes on the *post* instead —
    standing home, or walking back when displaced by a shove), and never takes the
    stall-recovery charge fallback (standing at the post IS the plan).
  - **`threatenedTiles` honors the leash** — the danger-zone read must not overstate a
    holder's reach — and the hover preview card gains a muted "Stance: holds its ground"
    row so the stillness reads as intent, not a bug.
  - Applied to the **lone straggler only** (node-by-node discipline). The L6A "alert,
    dug-in" captors are the obvious next takers when that node's pass comes.
- **Planned before Node 3 closes (per the user):** the fuller behavior set —
  **flee-after-first-melee** (the straggler breaks away once bloodied in melee) and
  **trigger-based aggro** (hold until a foe crosses a threshold, then charge). Both are
  *state-transition* behaviors — an event swaps the unit's standing order — so the
  target shape is: order id → a plan constraint + transition rules, a data registry the
  planner dispatches on. Keep new behaviors new records, not new planner branches.
  **→ Delivered: D84** (the `STANDING_ORDERS` registry, the flee/escape posture, and both
  transitions).
- **Spec:** `src/core/units.ts` (`standingOrder` docs + `Unit.post`), `src/core/ai.ts`
  (`holdPost`, `AI.holdLeash`, the plan/threat dispatch), `src/core/hollow-mill.ts` (the
  straggler's `overrides`), `BattleScene.attackPreviewRows` (the stance row).
- **Superseded by:** —

---

## D82 — The snare sweep: a win salvages enemy snares, gated on a standing trap-trained survivor

- **Status:** Decided (2026-07-06) · resolves the **D13 ↔ D54** salvage contradiction · the
  Node-3 pass, step 3 (follows the D81 hold guard)
- **Context:** Two canonical sources disagreed. **D13**: a win controls the whole field →
  every unsprung recoverable entity salvages, *including the enemy's* (the resolution docs'
  worked examples say so). **D54**: concealed enemy traps are `recoverable: false` —
  "harvested only via a deliberate disarm, never auto-recovered" — to motivate the disarm
  verb. The code shipped D54; the docs still told D13's story. The D81 hold guard made the
  tension acute: with the straggler holding still, disarm-only salvage makes "leave the last
  enemy alive and sweep the field at leisure" the optimal line (tedium rewarded), and a
  reveal-gated middle option would invite rooting around a decided map for hidden traps.
- **Decision (the user's ruling):** **win-salvage of all unsprung enemy snares — hidden or
  spotted alike — gated on the party having a member "awake and able to disarm traps."**
  On a win, if any **active** (alive, uncaptured) party member passes
  `canDisarm` at the moment of victory, every unsprung concealed enemy trap sweeps to
  storage (the trap-trained survivor walks the won field off-screen). No sweeper standing →
  the snares stay in the dirt. Sprung is always spent. Kill-him-last dies (you get the kits
  anyway); root-around-the-map never exists (hidden sweeps too); the **disarm verb keeps its
  mid-fight identity** (pocket the kit *now* for Set Trap + permanently clear the crossing).
  - "Awake" is literal (ratified by the user): **0 HP — or any status indicating 0-HP-style
    incapacitation — at the end of the encounter disqualifies the sweeper.** The gate reads
    state **before** D9 mortality resolution, so a downed-then-recovered sweeper does NOT
    sweep (she was unconscious when the field was won), and a still-bound captive doesn't
    either (auto-rescue lands after rewards). Today downed + captured are the only
    incapacitation forms; a future petrify/KO-class status must join the gate's predicate.
    Protecting the sweeper is the incentive. The canonical sim run proves the teeth: bot
    Vale dies in the snares fight → salvaged 0 (pinned in `sim.test.ts`).
  - Deterministic full recovery — no durability roll; the roll arrives with the future
    Survivalist salvage perk if ever.
  - Telemetry: `TrapEngagement.salvaged` (per-encounter → playtest summary → sim digest).
    Salvage does **not** set `engaged.feltTraps` — the sweep is automatic, not play.
- **Reuses / consistent with:** **D13** (win-controls-the-field fiction; the sweep rides
  `recoverMaterials`), **D54** (`recoverable: false` still keeps snares out of the *generic*
  recovery; supersedes only its never-auto-salvaged clause), **D75** (swept kits land over
  cap; the discard resolves), **D9/D21** (the active-at-victory reading).
- **Spec:** `src/core/resolution.ts` (`recoverMaterials` gains `party` + `swept`),
  `src/core/runloop.ts` (`applyRewards` passes survivors; `TrapEngagement.salvaged`),
  `entities.makeConcealedTrap` doc, `resolution.test.ts` (the sweep pins),
  `docs/design/04-resolution.md` + `systems/logistics.md` +
  [`expedition-hollow-mill.md`](../../docs/design/expedition-hollow-mill.md) (reconciled).
- **Superseded by:** —

---

## D83 — Intel's hazard + info lanes: the trap banding, the careless mark, and tiered rumors

- **Status:** Decided (2026-07-06) · extends **D10** (banded intel) / **D24** (node preview)
  onto the **D12/D54** trap-field · the Node-3 pass, step 4
- **Context:** The intel read covered **enemies only** (types → count → positions), so a
  trap-field read "1 Bandit Thug" — worse than nothing, it made the node *look* easy — and
  the designed L2→L3 pair ("Recon sharpens the snares fight's read") didn't deliver. Two
  user rulings shaped the fix: **(1) no tier ever reveals the whole field** — full reveal
  would make Vale's Awareness redundant (intel *informs*, Awareness *resolves*); **(2) the
  lanes are honestly gated** — a party fielding no intel-oriented unit reads tier 0 and
  walks in blind (no free hazard warnings; D10's "provision blind-ish" holds).
- **Decision:** Two new lanes on the same tier ladder, banded as data (`TRAP_INTEL` —
  provisional banding, the no-full-reveal ceiling fixed).
  - **The trap lane:** tier 1 **presence** ("the ground is worked" — reported for EVERY
    encounter once earned, an honest "none sensed" on trapless fields so the lane's mere
    appearance never leaks what tier 0 hides) → tier 2 **count** → tier 3 the **careless
    mark**: traps with `concealment ≤ TRAP_INTEL.markConcealmentMax` (4) stage
    **pre-revealed** (`stageEncounter({ markTrapsUpTo })`, threaded from `startEncounter`
    beside `revealHidden`). The per-trap `concealment` stat is thereby the authored knob
    for what intel can see: L3 (4,5,5,5,6) marks exactly **one** careless snare; L6A (5–6)
    marks **zero** — "the dug-in captors resist the scout's read" falls out of existing
    numbers for free.
  - **The info lane (the user's ask):** `AuthoredEncounter.rumors?: string[]` — free-form
    flavor mirroring the structured lanes; `rumors[i]` unlocks at tier `i+1`, locked lines
    render as `???` (`IntelReport.notes` + `notesTotal`). The Hollow Mill authors three
    per trap-field ("Folk around here say a deserter…" → sharper hearsay).
  - **Surfaces:** the pinned overworld intel card gains a **Hazards** field + the
    **RUMORS** box (variable-height, lifts to stay on-canvas); the deploy-phase Intel tab
    gains the Hazards row where it informs placement.
- **Reuses / consistent with:** **D10/D44** (`revealHidden` — the mark is its trap
  twin), **D82** (a marked snare the player avoids is still swept on the win — scouting
  pays out in kits, the named faucet, priced by Survey/Recon's cooldown + fatigue),
  **D80** (the `???` reveal idiom + intel meter).
- **Open / tuning:** the banding tiers + `markConcealmentMax` are a numbers pass;
  procedural trap-fields (none exist yet) will need generator-authored rumors or none.
- **Spec:** `src/core/intel.ts` (`TRAP_INTEL`, `TrapIntel`, `IntelReport.notes`),
  `src/core/staging.ts` (`markTrapsUpTo`), `src/core/runloop.ts` (the tier-3 thread),
  `src/core/authored.ts` (`rumors`), `src/core/hollow-mill.ts` (authored rumors),
  `OverworldScene.renderIntelCard`/`hazardField`, `BattleScene.renderIntelCard`,
  `intel.test.ts` + `runloop.test.ts` pins, `scripts/shots-hollow-mill.mjs`
  (`08b-snares-intel`).
- **Superseded by:** —

---

## D84 — Standing-order behaviors: the registry, flee-to-escape, and the transitions

- **Status:** Decided (2026-07-06) · delivers **D81**'s queued behavior set · the Node-3
  pass, step 5
- **Context:** D81 shipped one behavior (`"hold"`) as planner logic keyed on a string
  compare and queued the fuller set the user wanted encoded before Node 3 closes:
  flee-after-first-melee and trigger-based aggro. Separately, "escape" existed only as
  fiction — a thief "escapes" by *surviving to resolution* (`tallyEscapedThieves` reads
  `alive`); no unit ever actually left the board.
- **Decision:** Two layers.
  - **The registry (`standing-orders.ts`):** an order is a record — a **posture**
    (`hold` | `flee` | `charge`) the planner dispatches on, plus **transition rules**
    that rewrite `unit.standingOrder` one-way: `onMeleeStruck` (fires inside the attack
    resolution when the striker was adjacent — in the apply path, so replay + undo
    reproduce it; the undo checkpoint gained `standingOrder`/`escaped`) and
    `onFoeWithin` (fires at the unit's turn-open against its **post**, **sticky** — no
    bait-and-retreat reset; shapes only future plans, which log as concrete actions, so
    replay needs no record). Records: `hold` · `hold-skittish` (→ flee on the first
    melee blow) · `hold-wary` (→ charge when pressed; encoded + tested, **unauthored** —
    the L6A captors are the natural takers) · `flee` · `charge`. Stance strings feed the
    hover telegraph ("holds its ground" / "bolting for the map edge!") — the intent,
    never the trigger.
  - **Real board escape (the user's ruling):** the flee posture heads for the nearest
    map edge (never fights; `threatenedTiles` reads it as zero threat), and a fleeing
    unit that ends its move on an edge tile commits a **logged `escape` action** —
    `unit.escaped = true`, folded into `isActive`, so the unit is *gone, not dead*: off
    the clock, untargetable, undrawn, **no defeat event / no kill credit** — and a lone
    survivor's exit **ends the encounter as a player win** through the existing
    outcome check, exactly as the user intended. The escape slots before `endTurn` so
    replay's per-turn window holds.
  - **The straggler is `hold-skittish`:** his post is the east edge, so the first
    melee blow sends the deserter off-map next turn — the win without the kill; the
    abandoned field still sweeps (D82, Vale standing).
- **Notes / adjacent:** thieves still "escape" by surviving to resolution — giving them
  the real flee/escape posture (and reconciling `tallyEscapedThieves`, which would
  misread an escaped-but-alive thief) is a natural later pass, out of scope here.
  Melee-struck reads the **basic attack** only for now (adjacency at resolution); melee
  *skills* joining the trigger is a tuning call for when one exists on the demo path.
- **Spec:** `src/core/standing-orders.ts` (+ barrel), `units.ts` (`escaped`,
  `isActive`), `combat-actions.ts` + `turn.ts` (the `escape` action, both transitions,
  checkpoint fields), `ai.ts` (`planFlee`, `edgeDistance`, registry dispatch, threat
  read), `hollow-mill.ts` (the straggler), `combat-view.ts` + `BattleScene`
  (vanish/rail/stance/log), `standing-orders.test.ts` + the runloop real-node pin.
- **Superseded by:** —

---

## D85 — Intel's "no new intel to find" terminal + dropping the phantom Type lane

- **Status:** Decided (2026-07-06) · refines **D83** (the intel lanes) / **D24/D80** (the
  node preview card) · a Node-3 visual-pass follow-on
- **Context:** The intel card gave the player no **terminal** signal — no way to know a
  node was scouted as deep as it goes, so a careful player could waste Survey cooldowns /
  fatigue scouting a node with nothing left to reveal. Separately, **authored** combat
  nodes have no procedural *shape*, so the card's **Type** lane read a permanent `???` —
  phantom intel that never resolves, and directly contradicting a "nothing more to find"
  terminal sitting beside it.
- **Decision (the user's ask):** a terminal **"✓ No new intel to find"** line on the
  intel card, shown once the node is read to the deepest tier the system models
  (`NodePreview.intelComplete = tier >= MAX_TIER` — tier 3, where positions, exact
  reward, hazard marks, and the last rumor all land). It's the stop-spending signal that
  complements the D80 intel-meter ring (full ring = done) with words. Combat-only (rest/
  event nodes have no scouting progression). To keep the terminal **honest**, the phantom
  `Type ???` is removed: `NodePreview.authored` flags an authored node and the card omits
  its Type lane — no `???` dangles when the terminal says "nothing more."
- **Note — per-node intel *depth*:** every combat node bottomed out at tier 3 (enemy
  *positions* + exact reward guarantee tier-3 content), so the terminal always landed at
  tier 3. **→ Delivered: D86** (`AuthoredEncounter.intelDepth` caps the read; the terminal
  and the meter's arc count follow it; the Thieves' Den is the first shallow node).
- **Reuses / consistent with:** **D83** (the info/rumors lane — the terminal reads as its
  natural tail; authors align the deepest rumor with the tier-3 secret, as the snares node
  does), **D80** (the intel-meter ring), **D24** (the preview card).
- **Spec:** `src/core/intel.ts` (`NodePreview.authored`/`intelComplete`, set in
  `previewNode`), `OverworldScene.intelFields` (drop the authored Type lane) /
  `renderIntelCard` (the terminal line), `intel.test.ts` (the flag pins),
  `scripts/shots-hollow-mill.mjs` (`02c-snares-scouted`).
- **Superseded by:** —

---

## D86 — Per-node intel depth: nodes vary in how much they can tell

- **Status:** Decided (2026-07-06) · delivers **D85**'s deferred per-node depth · extends
  **D10/D24** (banded intel) and **D80/D83/D85** (the meter / lanes / terminal)
- **Context:** Every combat node bottomed out at tier 3 — enemy *positions* and exact
  reward always gave tier-3 content — so the read depth was uniform and the D85 terminal
  always landed at tier 3. The user wants to **vary the info a node offers**: some places
  are simply less scoutable from afar.
- **Decision:** `AuthoredEncounter.intelDepth?: IntelTier` (default {@link MAX_TIER}) — the
  deepest tier a node can be read to. The read is **capped**: one seam,
  `effectiveIntelTier(floor + scouting, def) = clampTier(min(raw, intelDepthOf(def)))`,
  which **every** read site now routes through (the preview card, the intel-meter ring,
  the staging reveal/mark tier, and the deploy-edge bonus) so they agree on how much the
  node tells. A shallow node genuinely knows less: a depth-2 node never reveals
  **positions** (no tier-3 starting vision / careless mark / blown ambush), its reward
  stays **approximate**, its intel-meter ring draws **2 arcs**, and its "✓ No new intel to
  find" terminal (D85) lands at tier 2 — reached the moment the party's floor hits it.
  - **First authored use — the Thieves' Den (`intelDepth: 2`).** A hidden hideout resists a
    distant read: you learn *what* lurks and *how many*, never *where* they spring from —
    you deploy half-blind, sharpening the chase-the-thief tension. At the demo party's
    tier-2 floor (Vale, Int 7) the den is fully known from the start (terminal shows, ring
    full), so it's never worth a Survey — exactly the "don't spend resources" signal.
  - **Authoring rule:** content must fit the depth — keep `rumors.length ≤ intelDepth`
    (deeper lines would be unreachable). All other nodes stay full-depth (unchanged).
- **Reuses / consistent with:** **D85** (the terminal + authored-Type omission now key off
  depth, not a hardcoded MAX_TIER), **D80** (the meter draws `depth` arcs), **D10** (the
  deploy edge is capped too — no tier-3 bonus on a shallow node).
- **Spec:** `src/core/authored.ts` (`intelDepth`), `src/core/intel.ts` (`intelDepthOf` /
  `effectiveIntelTier`; `previewNode` sets `intelDepth`/`intelComplete`), `runloop.ts`
  (`intel()` + `startEncounter` capped), `BattleScene.intelTier` (deploy edge capped),
  `OverworldScene.drawIntelMeter` (depth arcs), `hollow-mill.ts` (the Den),
  `intel.test.ts`, `scripts/shots-hollow-mill.mjs` (`02d-den-shallow`).
- **Superseded by:** —

---

## D87 — The combat log is total and serializable; the determinism surface is registered (refactor R1)

- **Status:** Decided + built (2026-07-08) · milestone **R1** of the refactor campaign
  ([`refactor-campaign-plan.md`](refactor-campaign-plan.md), from the 2026-07-08 audit — issues
  #111/#115/#116/#122/#124/#136, index #152) · completes the **D63/D67** action-log substrate
- **Context:** `replay(initial, log) === state` was the combat tier's declared reconciliation
  invariant — and it was **false**: `Battle.rescue` and the Medic's `useHeal` mutated outside the
  log (D67's own record had flagged the heal as "a pre-existing gap"), so a battle using either
  could not be rebuilt from its log and undo could not cross it. The log also carried live
  `SkillDef` object references (unserializable — no wire format for D27's save), snapshot/clone
  field lists were hand-maintained (a new `Unit` field silently half-restores undo), and the
  `streamFor` label namespace was ad-hoc strings across nine modules (collision/typo/rename
  hazards; D73's forage near-miss lived only in a doc comment).
- **Decision (five commitments):**
  1. **The log is total.** Every in-battle mutation flows through `Battle.apply` — `rescue` and
     `useHeal` are logged `CombatAction`s (semantics untouched: D9/D21 rules, Act costs, bus
     events; only the dispatch path moved). A golden rescue+heal battle replays
     **byte-identically**, pinned in `r1-log-totality.test.ts` alongside the sim digest.
  2. **Skills log by id.** A global `SKILLS` registry (derived at load from `JOBS` +
     `UNIVERSAL_SKILLS`, collision-checked) resolves ids at apply time, with an **injectable
     lookup** for fixture skills (the D65 pattern). The log **JSON round-trips** — it is the
     future save/desync **wire format** (the D27 seam; the save-model session builds on this).
  3. **The RNG label namespace is registered.** `rng-labels.ts` is the one home for every
     stream label (23 constructors, exact-value pins, a grep guard in the no-`Math.random`
     idiom). Label renames are **save/replay-breaking changes by contract**; the file is the
     enumeration of every random decision in the game.
  4. **Snapshot field lists are tripwired.** `snapshot-drift.test.ts` classifies every `Unit`
     key as snapshotted-or-deliberately-not (with per-key reasons) and round-trips
     `snapshotUnit`/`cloneOverworldEconomy`/`EntityRegistry.snapshot` — a new mutable field
     added unlisted now **fails by name** instead of silently corrupting undo.
  5. **The retired deployment models are deleted.** The M5b exposure meter and the D11
     stealth-alert layer (zero production callers; a header falsely claiming to be live) are
     gone — `deployment.ts` describes only the D63/D67 closing net. This retires D11's last
     code remnant. Rider: the `ActionResult` name collision resolved
     (`BattleActionResult`/`OverworldActionResult`) and the barrel completed
     (`combat-actions`/`purse-journal`/`grants`; `tuning` stays the one documented exclusion).
- **Blast radius (named, intended):** none in gameplay — the sim digest is byte-identical
  end-to-end; the one visible change is render-only: `CombatView.setActiveUnit` is wired again
  (active-unit nameplate, rail highlight, handoff pop — dead since the demo-driver removal).
- **Reuses / consistent with:** **D63/D67** (completes the log substrate), **D65** (injectable
  lookup), **D27** (the save seam this feeds), **D73** (the label lesson generalized),
  **D9/D21** (rescue semantics preserved), **D2** (pure core; the one render change flagged).
- **Spec:** `src/core/combat-actions.ts` (`rescue`/`useHeal` kinds, skill-by-id,
  `BattleActionResult`), `src/core/turn.ts` (dispatch, exported snapshot machinery),
  `src/core/jobs.ts` (`SKILLS`/`getSkill`), `src/core/rng-labels.ts` (+ the migrated call
  sites), `src/core/deployment.ts` (net-only), `src/core/index.ts` (completed barrel),
  `src/core/r1-log-totality.test.ts` / `snapshot-drift.test.ts` / `rng-labels.test.ts`,
  `BattleScene` (the `setActiveUnit` wire-up).
- **Superseded by:** —

---

## D88 — The D61 invariant is total: every overworld verb is paced or priced, by construction (refactor R2)

- **Status:** Decided + built (2026-07-09) · milestone **R2** of the refactor campaign
  ([`refactor-campaign-plan.md`](refactor-campaign-plan.md); issues #112 step 1, #125, #126) ·
  extends **D61** (the no-unpaced-unpriced-action invariant) to its whole surface
- **Context:** D61's load-time validator walked only `JOBS[*].skills`; standalone economy verbs
  relied on an opt-in hoisted-cost convention that three never opted into — `merchantSell` (informal
  "self-limiting" justification), and `bankerBorrow`/`bankerEngageInterest` (**no pacing, no price**;
  Borrow an unbounded gold advance). The check→commit sandwich was hand-assembled at six sites with
  a documented re-resolution trap (commit re-priced gold knobs *after* the effect). And the "party
  fields a live X" predicate was copy-pasted per class — with the Cook's copy missing `!captured`.
- **Decision (five commitments):**
  1. **One gate, closure-shaped.** `checkOverworldCost` returns `{ ok, prices, commit() }` with
     every price captured **at check time**; `commit()` spends exactly those figures. The
     standalone `commitOverworldCost` is gone; the re-resolution trap is dead (pinned by a witness
     whose effect captures a member between check and commit).
  2. **The three stragglers are gated.** `merchantSell` declares `{ selfLimited: true }` (the
     informal justification becomes data); `bankerBorrow` and `bankerEngageInterest` get
     `{ usesPerNode: 1 }` — **illustrative, structure-proving defaults** (a debt-ceiling knob is
     the plausible future price axis if Borrow needs real teeth; a numbers pass, not this record).
  3. **The invariant is enforced at both homes.** A `VERB_COSTS` registry (verb id →
     `OverworldCost`) is validated at module load exactly like the JOBS walk, and a guard test
     classifies **every exported function** of the economy modules (registry row /
     gated-elsewhere-with-where / non-verb) — a new exported verb without a registered cost
     **fails by name**. `bribeEnemy` stays on `spendInfluence` as the explicitly-noted R4
     migration target (the `OverworldCost.influence` knob is reserved for it).
  4. **One spelling for the fielded-job predicate.** `fieldedUnits`/`fieldsJob` in `units.ts`;
     every per-class copy migrated. Tier ladders ride the shared primitives (`bandFor`,
     `rankOf`/`clampUp` — the string-keyed ordinal tables in `arrivals.ts` die).
  5. **Scalars get chokepoints.** `accrueRp`/`spendRp` (upkeep.ts) and `nudgeMorale` (camp.ts)
     are the only spellings of RP/morale mutation — the provenance seam for future balance
     reporting, without building journals (per the substrate audit's verdict).
- **Blast radius (named, intended):** (a) **a captured Cook no longer offers to cook the stew**
  (the missing `!captured` was a bug; no sim seed reaches it — digest byte-identical); (b) the
  Banker verbs now **refuse on re-use within a node** (`usesPerNode: 1`) — the invariant working,
  numbers tunable; (c) `bankerEngageInterest` returns a standard `ActionOutcome` shape so refusals
  carry reasons — an **empty-purse engage now refuses without burning the node's use** (was: a
  silent zero-rate engage). Everything else byte-identical (sim digest pinned end-to-end).
- **Reuses / consistent with:** **D61** (extended, not reshaped), **D72** (the one-home direction;
  R4/A3 moves these verbs onto `JobDef.skills` next), **D87** (the guards this build leaned on),
  **D34/D30** (Banker semantics untouched beyond pacing).
- **Spec:** `src/core/overworld-actions.ts` (the closure gate, validator), `src/core/economy-actions.ts`
  (`VERB_COSTS`, the gated verbs, `BankerInterestResult`), `src/core/units.ts` (`fieldedUnits`/
  `fieldsJob`), `src/core/camp.ts` (`moraleTierIndex`/`nudgeMorale`), `src/core/upkeep.ts`
  (`accrueRp`/`spendRp`), `src/core/num.ts` (`rankOf`/`clampUp`), `src/core/arrivals.ts`,
  `src/core/intel.ts` (`min` key), `src/core/r2-verb-gate.test.ts` (witnesses + the export guard),
  `OverworldScene.bankerInterest` (the one render touch, mechanical).
- **Superseded by:** —

---

## D89 — The Verb Cell named: one grammar, one projection (refactor R4)

- **Status:** Decided + built (2026-07-09) · milestone **R4** of the refactor campaign
  ([`refactor-campaign-plan.md`](refactor-campaign-plan.md); issues #112 steps 2–4, #113, #114, #123,
  #149) · realizes **D72**'s A3 north star, extends **D61/D88** (the paced-or-priced invariant) to
  one home, and rides **D87**'s determinism + log guards. Shipped as **three batch PRs**
  (grammar → migration → projection + riders).
- **Context:** After D72 unified the *home* onto `JobDef.skills` and D88 closed the paced-or-priced
  invariant, the economy verbs were still **standalone functions** with a parallel `VERB_COSTS`
  registry, the camp UI **hand-wired** a button per verb, costs came in **three grammars** (combat
  `charge`/`cooldown`, overworld `OverworldCost`, a separate `usesPerNode` bridge, materials
  special-cased in undo), and `SkillDef.phase` was a vestigial second placement axis beside
  `usableContext`. Queued content (Banker, the triad kits, prestige forks) would have landed as
  plumbing, not records.
- **Decision — the cell is one shape, applied at two tiers.** A **verb** is a `SkillDef` (a record on
  a `JobDef` or a universal home) resolved by one **interpreter** through an exhaustive **effect
  registry**, gated by a **cost grammar** read as a **projection**, its RNG **labeled**, its spends
  **provenance-logged**. Concretely, across the three batches:
  1. **One `Cost` grammar (#113, batch 1).** A single cost type carries a clock-domain tag — combat
     pacing in CT (`charge`/`cooldown`), overworld pacing in node-steps (`cooldown`/`usesPerNode`) —
     and a price map that **includes materials** (`{ id?, count }`). `usesPerNode` folded into
     `overworldCost` (the bridge deleted); the Medic herb + trap-kit prices declare on their skills
     and consume in the **commit half**, so the undo `stash` special case died (D87's checkpoint
     already covers the refund). Vancian charges are a future price resource, not a fourth grammar.
  2. **`SkillDef.phase` retired (#123, batch 1).** `usableContext` (derived from effect shape, or
     explicit) is the one placement axis. Test-first: the `battle-flow.noActionsAvailable` ⇄
     `availableSkills(actor,"combat")` agreement test pinned the latent disagreement before `phase`
     was deleted.
  3. **Economy verbs are `SkillDef`s (#112/A, batch 2).** New `OverworldActionEffect` kinds
     (`sell`/`borrow`/`engageInterest`/`guardPurse`/`patronize`/`buy`/`triage`) each wire onto their
     owning job (Merchant/Banker/Noble/Medic) or the **universal home**; the compile-time
     `OVERWORLD_EFFECT_HANDLERS` mapped type forces a handler per kind. `merchantBuy` is a
     **universal** overworld skill (M8's ruling — anyone shops where there's a market), the precedent
     for universal verbs. `VERB_COSTS` dissolved onto `overworldCost`; the D88 guard **inverted** to
     prove the *absence* of any standalone gated verb. Each verb's post-gate mutation is an
     **effect core** (`applyXEffect`) shared by the interpreter and the legacy thin-wrapper, pinned
     equal by parity tests (the migration's proof — the wrappers are kept as those anchors).
  4. **`availableActions(run) → ActionView[]` (#112/B, batch 3).** The run-tier twin of
     `availableSkills`: every overworld verb usable at the current node per fielded unit's skill set +
     the universal home, each with a gate **verdict** (the `checkOverworldCost` closure, *uncommitted*)
     and a resolved **cost readout**. `OverworldScene`'s camp verb surfaces (Recovery + Economy drawers,
     the Triage row) are now a **render of this projection** — the hand-wired per-verb blocks and the
     `isMigratingEconomyVerb` seam are gone, every click dispatches through the one interpreter
     (`useOverworldSkill`). This is also the sim meta-policy's legal-move enumeration (the D56/D57
     unlock).
  5. **`JobFaucet` generalizes (#114, batch 3).** From the Noble-only Influence trickle to the
     per-step accrual record (`influencePerStep?`, `goldSkim?`). The Thief's Deft Hands skim migrated
     off a hardcoded `breakCamp` step onto a declared `goldSkim` faucet resolved by the one
     `accrueDeclaredFaucets` walk — the seeded label (`Labels.deft`) moved across **unchanged**, the
     byte-identity proof. Banker interest stays eco-state.
  6. **Charged-ability `targetMode` (#149, owner-ruled, batch 3).** `targetMode: "tile" | "unit"` on
     charged skills; the reserved `clock.ts` seam (`ScheduledEffect`) gained tile capture + a
     **target-moved fizzle** (default when `target`+`targetTile` are set, beside caster-death). Hostile
     ground charges whiff when the target leaves the tile; friendly homing charges (Mend) follow the
     unit. **Structure-only:** zero shipped hostile charges exist (Mend, the sole shipped charge, is
     friendly/homing), so shipped skills default to today's homing and nothing felt changes — the
     mechanism is pinned by a fixture hostile charge.
- **Named behavior changes (each pinned):**
  - **Triage fallback (ratified ruling #1) — SHIPPED.** A Medic-less party can now triage at camp via
    the universal `TRIAGE_FALLBACK` (RP-funded at **2× `rpPerChunk`** — half efficiency, a tunable
    dial beside D9's `rpPerChunk`). It surfaces as a real (often greyed) camp row now that the camp UI
    renders the projection — the increment-11 screenshot diff. Medic-less parties heal slower.
  - **Interpreter regularization.** Routing the economy/triage verbs through `useOverworldSkill` means
    they now grant use-XP like every other overworld verb (they didn't as standalone functions). The
    bot reads camp levers at 0% (D56/D57), so the sim digest is byte-identical.
  - **Batch-1/2 deltas** (from D88's line): captured-Cook, the Banker `usesPerNode` re-use refusal,
    the empty-purse engage refusal — carried forward, all sim-byte-identical.
  - **Thief flee rider (#153) — NOT shipped (skipped).** The `steal-then-flee` standing order was
    droppable and **skipped**: the thief steal/skim/recover/escape/tally lifecycle lives entirely in
    `BattleScene` (game layer), and the pure combat layer (`turn.ts`) is deliberately purse-agnostic,
    so the headless sim never fires the skim that triggers the flee transition. Making the sim reflect
    bolting thieves would require breaching the combat/run purity boundary — far beyond "a
    `STANDING_ORDERS` record" — so per the build brief's "if the transition machinery fights you, skip
    entirely, do not force," nothing was committed for it. A scene-only flee (interactive-only,
    sim-byte-identical) remains a clean future option; `tallyEscapedThieves` already reads
    alive-at-resolution as escaped (survived ⇒ kept the gold), the reading to keep.
- **Sim:** byte-identical end-to-end across all shipped increments (median nights 6 · gold 215 · win
  195 · wipe 77) — the meta-policy doesn't engage camp levers, so the projection rewiring, the faucet
  migration, and the structure-only targetMode change nothing the bot observes.
- **Reuses / consistent with:** **D72** (the one home, realized), **D61/D88** (the invariant, now
  total over one grammar), **D87** (determinism + checkpoint the material-consumption move leaned on),
  **D56/D57** (the projection is the legal-move enumeration), **D9** (the fallback's RP dial),
  **D5/D37** (the charge clock the targetMode fizzle extends).
- **Spec:** `src/core/cost.ts` (the one grammar), `src/core/overworld-actions.ts`
  (`availableActions`/`readActionCost`/the interpreter/the effect registry), `src/core/economy-actions.ts`
  (the effect cores + the generalized faucet + `deftHandsSkim`), `src/core/jobs.ts` (`JobFaucet`),
  `src/core/jobs-data/{support,combat,scout-line}.ts` (the verb + faucet declarations),
  `src/core/skills.ts` (`targetMode`, `phase` gone), `src/core/clock.ts` (the target-moved fizzle),
  `src/core/turn.ts` (the tile-capturing charge commit), `src/game/scenes/OverworldScene.ts` (the
  projection render), [`docs/design/systems/verb-substrate.md`](../../docs/design/systems/verb-substrate.md)
  (the cell named), and the batch guards (`overworld-actions.test.ts`, `barrel-surface.test.ts`).
- **Superseded by:** —

---

## D90 — The lean infiltration taste: lockpick-frees-a-captive on shipped rails (the Thief's first deploy payoff)

- **Status:** Decided + **build started** (2026-07-12). PR-1 shipped — the rescue-gate substrate.
  Realizes the back-half arc plan's **taste-first reframe**; consumes D52/D54/D67/D68.
- **Context (why this first):** the arc's signature is a **deeper deployment phase** via the Thief's
  **infiltration**. But `THIEF_JOB` clears the Scout's Quiet Footsteps (**C6**) — so the Thief is a
  *live deploy downgrade* until a payoff exists. The taste is therefore the **critical path**: the
  leanest visible, carried-into-combat Thief payoff, on **already-shipped** deploy substrate — the
  full extraction / interior-deploy / alarm rework stays a **parked** deep-dive.
- **Decision — "Pick the Cell".** A Thief spends a deploy act to **lockpick a *cuffed* captive free**;
  it stands up as a controllable body deep in enemy ground, fights the battle, and is recruited on the
  win. Built on the shipped **captives seam** (`buildAuthoredCaptives` / `freeCaptive` / recruit-on-win,
  D52) + **one** new pure-core gate:
  - **`ReleaseRequirement`** (`units.ts`) — an extensible union `{ kind:"reach" } | { kind:"lockpick" }`.
    `reach` is the default (absent ⇒ the L1 Cook, **byte-identical**); `lockpick` demands the rescuer
    hold the **Expert Lockpick capability** (`unitHasCapability`, capability-not-jobId, D54/D72). A
    `key`-carrying variant is **reserved** for its first content (JIT — not built).
  - **`canRelease(captive, by)`** (`deployment.ts`) — the pure gate. The logged `rescue` action
    (`turn.ts`) refuses a locked captive as an **unlogged no-op** (mirrors a refused `useHeal`), so
    replay/undo never see a rejected free. `release` is construction-set + battle-constant (classified
    un-snapshotted in the drift tripwire).
- **Captured stays a boolean — deliberately decoupled from the status track (see Roadmap).** The
  adversarial pass ruled the taste needs *none* of the status-model work; captured-as-status is at most
  an optional epilogue there, never a dependency of this.
- **Parked (do not build — the tripwires):** escort-to-exit **extraction** (C1), OR-victory / **any-of**
  (C2), **interior-deploy** (C5), alarm. Win stays `eliminate-all`; the freed captive is a **bonus body**,
  not a win condition. The moment any of those is wanted, it belongs in the deployment deep-dive.
- **Build:** **PR-1 (this)** — the `release` field (`units`/`authored`) + `canRelease` + the `turn.ts`
  gate + `captive-release.test.ts`; guards green (tsc · **1106** unit · build · sim · e2e **73**). **Next:**
  **PR-2** a standalone taste-encounter fixture (Thief frees at deploy → carried in → recruited; a
  non-Thief party runs the frontal fight, **C4**), **PR-3** render (lock glyph · a "Pick Lock" deploy
  verb · the stand-up FX, reusing the `02-captive-bound`/`03-captive-freed` shot pattern).
- **Reuses:** **D52** (captives seam), **D54/D72** (capability gate), **D67** (deploy casts commit+carry),
  **D68** (Thief `lockpick`). **Superseded by:** —

---

## D91 — The visual scenario harness: boot an arbitrary encounter run-less (tooling)

- **Status:** Decided + **built & shipped** (2026-07-12), issue #170 — three PRs on the design
  branch. The tooling the D90 taste needed; consumes D50 (`stageEncounter`), D52
  (`AuthoredExpedition`), D67 (the `{ run, loop }` BattleScene contract).
- **Context (why):** to screenshot a board feature (the D90 cuffed captive) we hijacked the live E1
  node and mutated it via `bsEval`. Every future board feature — a status, objective, ability, and the
  whole status-model track — wants an **isolated scene from a config**, not a live-run hijack.
- **Decision — a "synthetic one-node run" (reuse, not a scene refactor).** `BattleScene` consumes a
  `{ run, loop }` and drives it through `RunLoop.startEncounter`, so rather than teach the scene a
  run-less path we **synthesize the run** it already eats: a single-node `OverworldMap` (start == final
  == a `combat` node, `authoredId:"scene"`) + a **lazily-registered** throwaway `AuthoredExpedition` →
  `createRunFromExpedition` → `new RunLoop`. **The scene is unchanged.** Config is the single shared
  truth — `{ id, name, encounter, parties: Record<name, UnitSpec[]>, defaultParty, seed?/gold?/… }`, a
  **party matrix** so the headless test and the visual harness pick from one list ("one config drives
  both").
- **Red-team (survived).** Verified against code: no-guild `{ run, loop }` boots already ship via
  `buildArrivalJump`; `new RunLoop(run)` alone boots the scene; `camp()` is safe on a fresh 0-gold run;
  the shots/e2e harness boots an arbitrary hash via `withGame({ hash })`; the one-node map passes
  `validateExpedition`. Four revisions are canon: **(R1)** `buildScenarioRun` `validateExpedition`s +
  throws on an unknown party (fail-loud); **(R2)** default `gold ≥ party upkeep` (else every boot stages
  an "underfunded → morale hit"); **(R3)** the `scenarios/` registry is **pure data** — only
  `buildScenarioRun` registers (lazily), the guarantee the expedition catalog + `sim` digest stay clean;
  **(R4)** the harness **stages/renders**, not resolves (play-to-win is the parked "in isolation" ask).
- **Shipped (3 PRs):** **PR-1** core `buildScenarioRun` + `ScenarioConfig` + the pure-data `scenarios/`
  registry (first entry `pick-the-cell`, promoted out of `taste-infiltration.test.ts` so one config
  drives both) + `scenario.test.ts` (pins wiring + R1/R3) + barrel pin (+7, sim digest byte-unchanged).
  **PR-2** `buildScenarioBattle(id, party?)` → `RunHandoff` + `ScenarioBootScene`
  (`#scene=<id>[?party=<name>]` boots straight in; bare `#scene` is a clickable scenario × party-arm
  picker) + the `#scene` route + `e2e-scenario.mjs` (the residual-risk proof: a synthetic run renders a
  real deploy board, no page errors). **PR-3** retired the E1 hijack — the D90 taste now proves itself on
  the genuinely-cuffed `#scene=pick-the-cell` (Thief picks / scout refused), the live-node mutation
  deleted from `e2e-deploy-battle`. Guide: `docs/guides/adding-a-scenario.md`.
- **Guards:** tsc · vitest (1117) · build · e2e (deploy 73 + scenario 17) · `sim` (digest unchanged).
- **Reuses:** **D50** (`stageEncounter`), **D52** (`AuthoredExpedition`/captives), **D67** (the
  `{ run, loop }` contract + deploy casts). **Superseded by:** —

---

## D92 — Wave-0 topology: the back-half map that makes the infiltration taste playable

- **Status:** Decided + **built & green** (2026-07-12), issue **#168** (epic **#172**) — three PRs on the
  design branch; design agreed after an adversarial red-team. Realizes the arc plan's **C3/C4/C6/C7/C8**;
  consumes **D52/D68/D90**. Graduated from the Roadmap candidate.
- **Context (why now):** the lean infiltration taste (**D90**, "Pick the Cell") shipped but had **no live
  home** — it lived only in the `#scene` harness, and the Thief prestige had no in-run path. Wave-0 is the
  map that makes the routes real: a genuine **sustain-vs-infiltration** either/or with a live cuffed cell.
- **Decision — two topology-exclusive arms past `snares`, reconverging only at the terminal finale.**
  Exclusivity is **enforced by topology, not asserted** (C8): forward-only `chooseNode` (`run.ts:312`,
  `overworld.ts:317`) + disjoint node sets ⇒ committing to one arm makes the other unreachable;
  `validateExpedition` permits the disjoint arms + a skip-edge (it checks targets + reachability, not strict
  `layer+1`). A **reachability test** pins the disjointness.
  - **Pre-fork Market** (moved from L5 → L4): a route-neutral introduction of the universal market mechanic;
    both arms shop once, Mira the Merchant recruits here.
  - **Sustain arm:** `wagon` (frees **Sela the Medic**) → `restCamp` → finale. **No Medic catch-up** on the
    other arm — `SECURED_WAGON`/`medic-freed`-gating **deleted** (skipping Sela is a real consequence, C8).
  - **Infiltration arm:** `guildContact` (**C7 beat-1** — low gate `scout≥1`, writes the invite + a modest
    scout job-XP top-up via the new `StoryOutcomeSpec.jobXp`, **no** prestige) → `den` (relic) → `outerYard`
    (the **C3 fights** — `den`+`outerYard` `reward.xp` tuned so *guaranteed* objective-XP alone clears a
    fielded Scout to **L5** by the rite; the kill/hit tally is only margin — a **pacing-guard test** pins it)
    → `guildRite` (**C7 beat-2** — gate `scout≥5 + invite` → fires Scout→**Thief**) → `cuffedCell` (**D90's
    first live home** — a `release:{kind:"lockpick"}` captive the fresh Thief picks; a non-Thief runs it
    frontally, **C4**, and still recruits the prisoner on the win — recruit-on-win is **capability-blind**,
    so the Thief's edge is the **mid-fight tempo** of freeing a body deep in enemy ground, *not* an exclusive
    recruit).
- **The mentor two-beat mirrors the shipped Assassin pattern** (`travelling-companion`/`the-reveal`) — the
  Thief was the lone single-beat offer (arm+L5-gate+prestige coupled). Surfaced by **pinned bespoke
  `EventDef`s** via the existing `eventId` pin path (`node-events.ts` `eventForNode`) — **no** general
  appear-when-eligible mechanism (stays parked). The offer content lives in `PRESTIGE_OFFERS`.
- **Red-team outcomes folded in:** (1) the **XP gate is structural** — the sinker was a silent dead-end if a
  Scout reached the rite under-floor (the join option is *omitted*, not failed); fixed by tuning + the
  pacing-guard + a gracious under-floor decline. (2) **Cuffed-cell framing corrected** — capability-blind
  recruit-on-win means the Thief's payoff is mid-fight tempo, tuned for it. (3) The fork lists **infiltration
  first** so the naive-bot sim walks + **completes** the headline arm.
- **Forces no parked system** (any-of/**C2**, extraction/**C1**, interior-deploy/**C5**, alarm) — the signal
  it's correctly scoped; the dual-OR finale is **#169**. Honest tripwire: if the Thief payoff reads thin in
  playtest (**C6** — Quiet Footsteps is cleared on prestige), that's the **parked deployment deep-dive**
  signalling, not a Wave-0 fix.
- **Build (3 PRs):** **PR-1** substrate — the two-beat split + `StoryOutcomeSpec.jobXp` (unit-targeted,
  routed via `grantJobXp`) + the pinned surfacing `EventDef`s (digest unchanged). **PR-2** the topology
  rewrite + the C8 exclusivity test + the C3 pacing-guard + `OUTER_YARD`/`CUFFED_CELL` (the Den relocated,
  `SECURED_WAGON` deleted) + re-pinned routing/reward tests (hollow-mill, expedition-sim, arrivals,
  feasibility, intel, sim, barrel). **PR-3** the scripted arc integration (`wave0-arc.test.ts`) — the Thief
  path the sim can't reach: arm → grind to L5 → rite fires the prestige → the in-run Thief picks the cell,
  plus the C4 control. **A characterization note:** the re-tuned fights are decisively winnable, so combat is
  now deterministic across salts — the arrivals sampler's variation is **route**-driven, not salt-driven.
- **Guards:** tsc · vitest (**1122**) · build · e2e (deploy 73 + scenario 17) · `sim` (trap baseline
  re-pinned: staged 8 = snares 5 + Outer Yard 3). `core/` free of Phaser/DOM/`Math.random`.
- **Reuses:** **D52** (captives seam / recruit-on-win), **D68** (the Scout→Thief fork + `PRESTIGE_OFFERS`),
  **D90** (the lockpick cell). **Superseded by:** —

---

## D93 — The road trickle feeds character (breadth); a job levels passively only if it opts in

- **Status:** Decided + **built & green** (2026-07-13), on the `atlas-updates` branch. Owner design call
  during an atlas freshness pass; refines the D32 leveling seam.
- **Context (why now):** the atlas's 04g diagram routed the non-combat deployed trickle to the **job**
  axis (mirroring `guild.md`'s stated intent), but the **code** has always fed the deployed/road trickle
  to the **character** axis (`accrueDeployedXp → grantXp`, the D32 placeholder; the D92 `stories.ts:332`
  comment states it outright) — a live intent-vs-code drift the freshness pass surfaced. Owner ruling:
  **ratify character-routing as the real design** (travel = breadth), and give the job axis a *deliberate*,
  per-job passive route rather than a blanket one.
- **Decision — the deployed road trickle (a passive bump per node-step WHILE DEPLOYED) feeds:**
  - **character** level for **every** fielded unit (breadth from travel — universal; **benched = no
    growth**), as the code already did; **and**
  - the bearer's **primary job**, but **only if that job sets `JobDef.passiveXp`** — the non-combat trades
    (Survivalist · Cook · Merchant · Noble · Banker). A **combatant earns its job level by fighting, not by
    walking.** Mirrors how combat XP already feeds both axes at once for the primary.
- **Shape:** a new `JobDef.passiveXp?: boolean` capability flag (data, like `lockpick` — the D54 idiom),
  read by `accrueDeployedXp` (`leveling.ts`); it grants the same node-step amount to the primary job via
  `grantJobXp` when the flag is set. Scoped to the **primary** job and the **road trickle** only — the
  per-successful-use bump stays the shared character-side use-leveling hook (unchanged). Routing *active
  use* into the job (a Cook levels by cooking) is a **noted follow-up**, not built here.
- **Guards:** tsc · build · vitest (**1123**, +1 leveling test: a `passiveXp` job levels on the road, a
  combatant's job-level does not) · `sim` (digest unchanged) · e2e (deploy 73 + scenario 17 + arc 4).
  Headless routing only — **no player-facing surface**, so no new visual guard. `core/` free of
  Phaser/DOM/`Math.random`.
- **Docs:** atlas `jobs/07-leveling.md` (diagram + Reading-it + Maps-to) and source `systems/guild.md`
  synced to match.
- **Reuses:** **D32** (the deployed-trickle seam), **D72** (`JobDef` data-driven capability idiom).
  **Superseded by:** —

---

## D94 — Prestige diff-rules are rules of thumb, not hard stops

- **Status:** Decided (2026-07-13), **docs-only**, on the `atlas-updates` branch. Owner framing call.
- **Context:** the prestige "diff on the base kit" rules ("replace ≥1 element, keep the rest"; "the
  element count stays flat") were written as firm constraints in both the atlas (04d) and
  `systems/jobs.md` — they read as hard gates on authoring.
- **Decision:** they are the **default discipline**, not hard constraints. The rules keep sibling forks
  **coherent** (related-but-distinct) and the **slot budget honest** — so a fork departs from them only
  with a *reason* (a capstone that genuinely earns an **add** over a swap, or a shifted count), not by
  accident. The guideline serves the *feel*; it does **not gate** the authoring. Deliberate breaks are
  allowed and noted where they happen.
- **Scope:** framing only — no mechanic or seam change (the grant/predicate seam is untouched). Softened
  the language in `atlas/jobs/04-prestige.md` + `systems/jobs.md`.
- **Reuses:** **D65** (the prestige-branch seam). **Superseded by:** —

---

## D95 — Repro Dump: capture the live state directly, restore without replay (debug tooling)

- **Status:** Decided + built (2026-07-13), green. Prompted by a player-reported `#demo` **freeze at
  Begin** on the Night-3 `snares` prep camp that no headless/loop reproduction could hit.
- **Context:** the freeze was interactive-state-dependent, and we had **no way to capture the exact
  state** a player was in. `snapshotRun` (D-save seam) is **insufficient for this**: it stores only
  `seed + route + econ` and rebuilds the rest by **replaying the route from the seed** — but replay
  takes the *auto/naive* path (auto-resolved events, auto-battled combats), so it can't reproduce a
  player's **interactive** choices (which recovery verbs, how a gift discard resolved, deploy
  positions). A freeze usually lives in exactly that state, so replay-based repro is blind to it.
- **Decision:** a **Repro Dump** captures the **full live mutable state directly** and restores it with
  **no replay**. Pure core (`repro.ts`, headless-tested): `dumpRun` serializes the whole `RunState` as
  plain data — the only non-plain fields handled (`rng` → its `RngState`; the map carried verbatim,
  authored resolution still keys off `expeditionId`) — through an **Infinity-safe** JSON
  replacer/reviver (a `StatusInstance.duration` of `Infinity` would otherwise round-trip to `null`).
  `restoreRun` rehydrates it exactly. A **schema version** (`REPRO_DUMP_VERSION`) rejects a stale paste
  loudly.
- **Freeze-survival is the load-bearing property:** capture is **passive** — snapshotted into
  `window.campfire` (+ `localStorage`) on **every scene transition** (prep-camp render, Begin/commit,
  battle staging), *before* the click that freezes. An uncaught render exception leaves the canvas dead
  but not the page, so the last-good capture is still readable. The dump affordance is a **raw-`window`
  Shift+D** hotkey (+ `window.campfire.dump()`), not Phaser input a wedged scene can't service —
  copies JSON to clipboard + logs it.
- **Restore closes the loop:** `window.campfire.restore(json)` (cross-machine: a tester's dump → a dev's
  console) and `#repro` (same-browser reload from `localStorage`) both rehydrate and land the
  OverworldScene on the captured node's **prep camp** (the pre-Begin screen), via a small
  `reproCampNode` handoff hook — so a reported freeze reproduces on the first click.
- **The uncaught error is captured too (the decisive bit):** `installReproDump` hooks `window`
  `error` + `unhandledrejection`, recording the freeze's **message + stack** into `campfire.lastError`.
  Every export folds a `_repro` diagnostics block — `{ context, trail (recent transitions), lastError }`
  — onto the dump JSON (additive; `parseDump` ignores it, so the string still restores). A dump alone
  can miss a freeze that depends on a specific in-scene interaction (the reported `snares` case restored
  and played cleanly); the captured stack turns "it froze" into a one-line diagnosis.
- **On-screen surface:** an in-game **Save / Load** panel (a `💾` toggle parked bottom-right above the
  Session-log button — a DOM overlay, so it survives scene transitions) exposes the same loop without
  the console: **Export** the current run to a textarea + clipboard (or a `.json` file), **paste + Load**
  a save to jump into it. The clickable twin of the hotkey/console API; available on every build (gate
  behind a hash later if it should be dev-only).
- **Scope / seams:** **RunState-fidelity** only. Mid-fight `Battle` state (live clock/bus) is **not**
  serialized — a restore re-stages the node's encounter *deterministically* from the restored
  RunState (enough for overworld/prep/Begin freezes, the reported class). A battle-internal
  step-recorder is a possible later track.
- **Guards:** `repro.test.ts` (round-trip fidelity incl. the Infinity hazard, decoupling, RNG
  continuity, identical staging) + a **visual e2e** (`e2e-repro.mjs`, CI-wired): real-browser
  capture → dump → restore lands on the prep camp with an interactively-set purse/HP intact, then
  Begin still hands off. The barrel surface (`barrel-surface.test.ts`) absorbs the 5 new exports.
- **Reuses:** `Rng.state()`/`fromState` (D-rng), the expedition catalog (D52), the jump tool's
  "collapse the running stack, hand off through a live scene" boot sequence (D-debug). **Superseded
  by:** —

---

## D96 — The second-battle freeze: a GameObject cached across BattleScene re-entry goes stale

- **Status:** Decided + fixed (2026-07-13), green. First bug **found via the D95 Repro Dump** — the
  captured stack (`campfire.lastError`) pinpointed it after a RunState dump alone couldn't.
- **Symptom:** the game froze entering the **second** combat of a run (the reported case: E1 → snares)
  with `TypeError: … "drawImage", this.data is null` deep in Phaser's text render, up the stack
  `layoutRailChevron → drawRail → refreshDeployStatus → … → enterDeploy → BattleScene.create`.
- **Root cause:** `BattleScene` is a **reused singleton** — `scene.start` re-runs `init`+`create` on the
  same instance, and Phaser **destroys the scene's GameObjects on shutdown while instance fields keep
  their (now-dead) references**. The CT-rail chevron is created *lazily* (`if (!this.railChevron)`) and
  cached in a field; on the second `create()` the guard saw the stale handle as truthy, skipped
  re-creation, and called `setText` on a destroyed Text (null texture) → freeze. `rebuildBoard()`
  already reset the sibling lazily-created fields (the zone graphics) to `undefined` for exactly this
  reason — **`railChevron` was simply missed** from that reset. (`logChevron` is recreated
  *unconditionally* in `create()`, so it was immune.)
- **Fix:** reset `railChevron` (destroy + `undefined`) in `rebuildBoard()` alongside the zone graphics,
  so each battle re-creates it fresh. One-line class fix, no behavior change.
- **Why it hid:** every headless/visual guard played **one** battle per scene, so the stale-reuse path
  never ran. The **`test:e2e:second-battle`** guard now plays two battles back-to-back (E1 → snares) and
  asserts `assertNoProblems` on the second deploy — verified to fail without the fix, pass with it. The
  general lesson: any GameObject cached in a `BattleScene` field with an `if (!this.x)` create-guard must
  be reset in `rebuildBoard()`, or it goes stale on scene re-entry.
- **Reuses:** the `rebuildBoard()` reset pattern (the zone graphics). **Superseded by:** —

---

## D97 — The dual-OR finale: goals are OR'd, the Prison Assault liberates by frontal OR extraction

- **Status:** Decided + **built & green** (2026-07-16), issue **#169**. Realizes the arc plan's
  **C2** (OR-victory) at its use site — the finale both Wave-0 arms (D92) converge on. Consumes
  **D50** (the objective model), **D52** (captives / recruit-on-win), **D90** (the lockpick cell).
- **Context (why now):** Wave-0 (D92) shipped two topology-exclusive arms — **sustain** (frees the
  Medic) and **infiltration** (earns the Thief + the D90 lockpick taste) — that reconverged on a
  **stub finale**. So the arms' divergent investment never actually *cashed out*: both dead-ended
  into the same holdout fight. The finale is where the choice was designed to pay off differently,
  and it needs the one mechanic the arc plan deferred "until its consumer exists": **C2**, an
  OR-victory. `encounterOutcome` was **AND-only** (`required.every(met)`), so it supported exactly
  one win-path.
- **Decision — split required objectives into *goals* (OR'd) and *constraints* (AND'd).** The
  objective model already separated a **goal** (`eliminate-all` — *met* = a win) from a
  **constraint** (`closing-gate` — *failed* = a loss); only the classifier was single-path. C2 is
  the small, reusable generalization: `encounterOutcome` now = `wipe → any required constraint
  failed → (every required constraint met AND **any** required goal met) = win`. **Goals OR, constraints
  AND.** A goal **never fails** (an unmet goal is just pending), so an abandoned rescue can't *lose*
  the fight — the frontal path stays open. Single-goal encounters are byte-unchanged (the OR over one
  goal is the old AND). `isGoalKind`/`GOAL_KINDS` name the split; `withDefaultGoal` now injects the
  default elimination goal only when **no** goal kind is present (an extraction-only encounter is legal).
- **The new goal kind — `extraction`** (D97). Met when **every** tagged escortee (a freed prisoner,
  `escort: ObjectiveTag`) is **alive, uncaptured, and standing on an `exit` span**. It reuses the
  exact primitives `closing-gate` already had — an `ObjectiveTag` (who) + a `span` of tiles (where) +
  the `onSpan` reader — so no new movement machinery. `progress()` reports the freed-and-at-exit
  fraction for the HUD. This is the honest **escort-to-exit** extraction the arc plan's **C1** demands
  (not a cell-open flag-flip); the *full* extraction/interior-deploy/alarm rework stays the **parked
  deployment deep-dive** — the finale uses the lean version on shipped rails (home-edge deploy, the
  D52 captive + D90 lockpick + normal movement).
- **The finale — The Prison Assault** (`hollow-mill.ts`, replaces `STUB_FINALE`). A fortified garrison
  (the real brawler — the softened Wagon/Outer-Yard captains were warm-ups) **plus two cell prisoners**
  (`role: "prisoner"`, `release: lockpick`) and an **exit span** (the home edge — the way in is the way
  out). Two OR'd goals: **`eliminate-all`** (frontal, any party) and **`extraction`** (free the cells +
  walk the prisoners to the exit — Thief-only, since only a Thief picks the locks, **C4**). Either wins;
  a non-Thief party simply can't open the cells so extraction stays pending and it wins frontally. The
  prisoners **recruit on the win either way** (recruit-on-win is capability-blind, D52) — the Thief's
  edge is the *quieter route to the same liberation* (a win with the garrison left standing), not an
  exclusive recruit. The eliminate-all goal is listed **explicitly** — with `extraction` now a goal,
  the default is no longer injected, and a frontal party must have its win-path named.
- **Render (`BattleScene`):** the objective check-list already rendered generically, so the extraction
  row (label + freed/at-exit %) shows for free. The one new surface is the **exit-span tint** — a gold
  "escape route" overlay (`drawExitZone`, painted in deploy and **kept through battle** since the escort
  is mid-fight; the deploy safe/danger zones retire on `battleBegan`, this does not). `exitZoneGfx` is a
  lazily-created cached field, so per **D96** it is **reset in `rebuildBoard()`** (destroy + `undefined`)
  — the freeze-on-re-entry discipline, honored up front.
- **Red-team outcomes folded in:** (1) a *failed goal* can no longer trigger objective-failure — that
  path is constraint-only now; the staging truth-table test was corrected to the new semantics (a goal
  never fails). (2) The **all-prisoners-must-survive-and-exit** reading was chosen over "extract whoever
  you saved" — it avoids the degenerate where downing every prisoner makes extraction *vacuously* met,
  and gives the escort real "keep them alive" tension; a lost prisoner leaves it *pending* (fall back to
  frontal), never *failed*. (3) The finale is a **new player-facing surface** (the D92/#168 cautionary
  tale) — so a **`#scene=prison-assault` scenario** (a pure-data mirror, D91, NOT an import of the live
  finale, keeping the registry side-effect-free) + an **extended `e2e-scenario`** step both arms through
  the real headless scene (exit-zone paints · both goal rows render · the Thief extracts to a garrison-
  standing win · the frontal arm's cells hold, C4).
- **Build (one pass, on `claude/verify-memento-plugin-a7u52w`):** core `objectives.ts` (the `extraction`
  kind + `isGoalKind`/`GOAL_KINDS` + `withDefaultGoal`) & `staging.ts` (the OR/AND classifier);
  `hollow-mill.ts` (`PRISON_ASSAULT` replaces the stub); `scenarios/prison-assault.ts` + registry;
  `BattleScene.drawExitZone`. Tests: `objectives.test` (extraction arms/reads/pending/never-fails),
  `staging.test` (the OR-victory truth table), `hollow-mill.test` + `wave0-arc.test` (both finale
  win-paths, end-to-end extraction with a real prestiged Thief), `scenario.test`, barrel surface.
- **Guards:** tsc · vitest (**1153**) · build · `sim` (digest unchanged — the naive bot still completes
  the finale frontally, obj-fail 0) · e2e (deploy 73 + **scenario 33** + second-battle 6 + arc 9, no
  page errors) · audit:visual (0/14) · audit:challenge (7/7). `core/` free of Phaser/DOM/`Math.random`.
- **Challenged (survived, 2026-07-16).** Ran the break-cases, not the happy path — all guarded now:
  (1) **freed prisoners are walkable** — the scariest assumption (the tests *teleport* prisoners to
  the exit): verified `standingOrder:"defend"` is inert (no registry posture; the scene auto-runs
  **only** enemy turns), so a freed prisoner is player-controlled — the extraction path is real, not
  just resolvable. (2) **No vacuous extraction** — downing every prisoner leaves it *pending*, never a
  win (dead escortees stay in the tag set, so `every(alive)` fails). (3) **Wipe stays coherent** — a
  bound cell doesn't keep the side alive (party-dead + cuffed = wipe), but a *freed* prisoner is a full
  party member (staves off the wipe, can win by extraction alone — freed = recruited). (4) **The one
  non-structural risk (F):** extraction is polled from battle-start, so a prisoner authored *on* the
  exit could instant-win with zero combat — the shipped finale is safe only by **geometry** (cells at
  col 8, exit at col 0). Pinned with a guard (`no prisoner starts on/near the exit`) so a re-placement
  can't silently make it a walkover. (5) **Pre-existing footgun (not a D97 regression):** an
  all-*optional* objective list instant-wins at turn 0 — `withDefaultGoal` suppresses the default when
  any goal kind (even optional) is present; left as-is (the shipped goals are required) and noted.
- **Forces no parked system** (full extraction/C1 · interior-deploy/C5 · alarm · any-of beyond the two
  goals) — the signal it's correctly scoped. **Reuses:** **D50** (objectives), **D52** (captives /
  recruit-on-win), **D90** (the lockpick cell), **D91** (the scenario harness), **D96** (the
  `rebuildBoard` reset discipline). **Superseded by:** —

---

## D98 — The visual level editor + the JSON content pipeline

- **Status:** Decided + **building in milestones** (2026-07-16). Owner-driven tooling call after the
  D97 finale — authoring `AuthoredEncounter`s as TS objects means hand-computing every col/row. Two
  parts: a **visual editor** (author faster) and a **file-based content pipeline** (a home for its
  output). MVP-first (curious-builder): the smallest working slice, then grow.
- **Context (why):** the finale was hand-authored coordinate-by-coordinate. A visual editor removes
  that pain; but an editor is only useful if its output has somewhere to *go*. The pipeline is the
  load-bearing enabler — build it first so every future editor brush just adds fields that flow through.
- **Decision — Part 1: the content pipeline (the chosen "location the game pulls from").** Levels are
  `.json` files (a **serialized `AuthoredEncounter`** — it's already pure data, no new format) under
  `src/content/levels/`, **glob-loaded at build time** (`import.meta.glob`, eager) into a registry keyed
  by `id`, **validated fail-loud** (`validateLevel`: shape + enemy-template resolution + objective kinds).
  A dropped-in file is auto-discovered — **no registry edit**. Playable standalone via a new **`#level=<id>`**
  route that wraps the level in a throwaway single-arm scenario and **reuses the D91 one-node-run boot**
  (`buildScenarioRun`) — so it renders through the same `BattleScene` path as `#scene`; bare `#level` is a
  picker. **No runtime fetch, no backend** — build-time + deterministic, which the `core/`-purity ethos
  wants. The hard constraint that shaped this: a **browser editor can't write repo files**, so the loop is
  always *editor exports `.json` → drop in `content/levels/` → commit → glob picks it up* (a dev-server
  write-back could later remove the manual drop, in dev only). **Layering:** `content/` is Vite-aware
  (uses `import.meta.glob`), so it sits **between** `core/` (pure) and `game/` — not in core.
- **Decision — Part 2: the visual editor.** An **`#editor`** Phaser scene that **reuses `CombatView`**
  (render) + **`worldToTile`** (click-pick) to paint a draft `AuthoredEncounter` by clicking tiles, with a
  live DOM export panel (the D95 panel idiom). Built in milestones: **M1 (done)** — grid render, click a
  tile to toggle a **blocked wall**, live JSON export + Copy. **M2 (done)** — the brush palette (wall ·
  spawn · enemy by template · captive reach/lockpick · exit · trap · erase) + adjustable grid + live
  validation + a **Download `.json`** button emitting a folder-ready file. The draft→encounter
  serialization is a **pure, unit-tested** module (`editor-draft.ts`) proving the editor emits
  pipeline-valid, playable levels (incl. the D97 extraction shape when exit tiles + prisoners are placed).
  **M3** — a pasteable-literal export + **import** to edit existing levels + richer objective authoring.
  **M4** — docs + guard sweep. The full loop now runs: paint in `#editor` → Download `.json` → drop in
  `content/levels/` → play at `#level=<id>`.
- **Scoped (JIT):** **single standalone encounters** only — **not** the expedition **map/DAG** (slotting a
  level into the Hollow Mill arc stays a deliberate wiring step / a future *map editor*, so the curated
  finale can't be silently replaced by whatever JSON appears); DOM palette + Phaser board; JSON = raw
  serialized `AuthoredEncounter`.
- **No silent drift from the model (D98 hardening).** The editor must track the game's grid/encounter
  model, not hand-copy it. Audited: the enemy roster (`ENEMY_IDS`) derives from the core templates, the
  export is typed `AuthoredEncounter` (tsc breaks on any model change), the grid reuses `TileGrid` +
  `CombatView`. Two hand-copies were removed: (1) the objective-kind list — `ObjectiveKind` is now
  **derived from a canonical `OBJECTIVE_KINDS`** array in core, which `validateLevel` imports (a kind
  added to the game is authorable immediately; a `levels.test` case pins it); (2) the board-centering
  formula — extracted to **`CombatView.centerOrigin`**, shared by the battle and the editor, so a
  grid/tile-metric change reaches both (byte-identical origin — deploy-battle e2e unchanged).
- **Guards:** `content/levels.test` (glob loads/validates/plays + kind-list tracks core), `editor-draft.test`
  (draft → valid/playable), **`test:e2e:editor`** (palette paints + export validates), **`test:e2e:level`**
  (a glob level renders + the picker). tsc · build · vitest (**1164**). `core/` change is the single-source
  `OBJECTIVE_KINDS` only; all editor code is `content/`/`game/`.
- **Reuses:** **D91** (the scenario one-node-run boot + `#scene` harness), **D50/D52** (the
  `AuthoredEncounter` shape + captives), **D95** (the DOM overlay-panel idiom), **D96** (the
  cached-GameObject reset discipline, for the editor scene). **Superseded by:** —

---

## D99 — The finale is a RESCUE: keep extraction, defer the deploy-side flank (refines D97)

- **Status:** Decided (design) + **building standalone** (2026-07-17). Owner reframe; survived a
  `decision-adversary` red-team. Refines the D97 finale; the flank half is deferred to its own session.
  Handoff: [`finale-authoring-handoff.md`](finale-authoring-handoff.md).
- **Context (why):** D97 shipped the finale as a "storm **vs.** extract" dual-OR. The owner reframed the
  *intent*: the mission is a **prison rescue** — free a **group of captives** (some are **named
  characters**, seeds for later campaigns). Separately, the owner wanted the infiltration arm's payoff to
  become a **deployment advantage** (come in from a different side with Intel), realizing the arc plan's
  parked **C5 (deploy-inside)** — the game's signature phase.
- **Decision — Part 1: the finale is a rescue, one intent / two means.** Keep the D97 **dual-OR** (C2),
  but reframe both goals as the *same rescue*: **extraction** (escort the captive group out) is the
  thematic **heart**; **eliminate-all** (clear the garrison) *also* completes the rescue (the captives are
  safe). Extraction binds `escort: {role:"prisoner"}` to the **whole group** (all must be out). Prisoners
  are D52 captives (recruit-on-win), named as placeholders to graduate into campaign characters later.
- **Decision — Part 2: the infiltration payoff is a DEPLOY-SIDE that SERVES extraction — and it is
  DEFERRED.** A red-team killed the tempting version ("*replace* extraction with a better deploy spot"):
  that trades a **distinct victory** (win with the garrison standing) for a **cheaper identical victory**,
  and strands C2's only live consumer. The **kept** design: extraction stays the distinct win, and the
  Intel-gated flank *insert near the cells* is what finally makes escorting the group **viable** (fixing
  the real flaw — the sim never takes extraction because the full-board escort is too slow). The flank is
  built **on top**, in its own session, **not now**.
  - **Load-bearing red-team caveat (F1) for that session:** the deploy net has a **single** home-edge
    campfire, so a *meaningful* flank (deep in enemy ground) can't be a *safe* insert without a **second
    protection source = the full parked C5**. The **lean** version is therefore a **binary-unlock alternate
    spawn set** (Intel ⇒ you *may* deploy from the flank; its risk is natural net-exposure — **no** "safe
    informed vs. risky blind" claim, which is the part that forces the deep-dive). Reuses the existing
    `opts.playerSpawns` staging override + a runloop flag-check + a deploy-time choice + a new visual e2e.
  - **Do NOT** make extraction easy by placing cells near the exit — that re-arms D97's challenge-F
    walkover footgun. The flank (a *start* position), not the *cell* position, is the sanctioned fix.
- **Built so far (standalone, arc untouched):** `content/levels/the-rescue.json` (`#level=the-rescue`) —
  the group rescue, authored via the D98 pipeline by the `level-author` agent. Iterated standalone; the
  live arc finale stays D97's `PRISON_ASSAULT` until **promotion** (an owner-directed step) once the flank
  + the map-creation expansion (roadmap) settle.
- **Guards:** `levels.test` proves both rescue win-paths (incl. *all three* captives must be extracted, not
  two); `test:e2e:level` boots `#level=the-rescue`. tsc · vitest (**1166**) · build green. `core/` untouched.
- **Reuses:** **D97** (the dual-OR extraction classifier + `extraction` kind), **D98** (the editor +
  pipeline + `level-author` agent), **D52** (captives / recruit-on-win). **Parks:** the arc plan's **C5**
  deployment deep-dive (now the deferred flank session). **Superseded by:** —

---

## D100 — Board camera: grab-and-drag pan + wheel zoom (a bigger board than the viewport)

- **Status:** Decided + built (2026-07-18). Owner-driven, first step of the D98 map-creation expansion:
  authoring a **20×20** level in `#editor` overran the fixed 800×600 canvas — the far tiles were simply
  unreachable and the whole board never fit on screen. Owner proposed drag-to-move, noting it "would be
  naturally useful for the actual game as well."
- **Context (why):** the isometric board is drawn through `CombatView` at a fixed origin + `boardScale`
  on a `Scale.NONE` 800×600 canvas. A 20×20 diamond spans ~1580×790px — far past the ~480px-wide area
  left of the editor panel — so most tiles fell off-canvas with no way to pan to them.
- **Decision — pan/zoom the scene CAMERA, not the draw origin.** A reusable `game/board-camera.ts`
  (`BoardCamera`) drives `cameras.main` scroll (grab-and-drag) + zoom (wheel, anchored on the cursor),
  with a **click-vs-drag** discriminator: a press that moves past a threshold pans and **suppresses the
  tap**, so a drag never also paints; a genuine tap dispatches through an `onTap` callback. Chosen over
  moving `CombatView.originX/originY` because `pointer.worldX/worldY` already fold in camera scroll+zoom
  — so `worldToTile` picking stays correct for **free**, with **no per-frame board redraw** (a 20×20 is
  400 diamonds). A **Recenter** control resets to the default framing so you can never get lost.
- **Editor integration:** the scene's only on-canvas chrome (the title line) **moved to the DOM panel
  header**, so the whole Phaser scene is now board content and pans/zooms cleanly (no HUD drift). The
  brush loop moved from a direct `POINTER_DOWN` bind to `BoardCamera`'s `onTap`.
- **Reusable for the game (the owner's stated second motive):** `BoardCamera` is scene-agnostic — the
  battle board can adopt the same control for a large field. **Caveat for that adopter (recorded now):**
  camera scroll/zoom moves **everything** the camera renders, so a scene with on-canvas HUD (BattleScene
  has lots) needs that HUD on a **second, fixed camera** first. The editor sidesteps it by keeping all
  chrome in the DOM — the game wiring is a deliberate follow-up, not done here.
- **Guards:** `test:e2e:editor` extended — a real press-move-release **drag scrolls the camera**, a drag
  **does not paint** (click-vs-drag), **Recenter** resets scroll+zoom, and a tap **after** recenter still
  paints (discrimination intact). Added a `harness.drag(x1,y1,x2,y2)` primitive (real pointer, stepped
  move). tsc · build · vitest (**1184**) green; the 14-surface visual audit + other e2e are unaffected
  (the change is `game/`-only and touches no core logic, routing, or game surface).
- **Reuses:** **D98** (the `#editor` scene + `CombatView`/`worldToTile` click-pick + the DOM panel idiom).
  **Superseded by:** —

---

## D101 — Editor shape tools: two-click line/rect walls + a coordinate readout (structural authoring)

- **Status:** Decided + built (2026-07-18). Owner was authoring a **prison** finale map and wanted the
  layout to read *structurally* (perimeter, corridors, cells). Continues the D100 map-creation expansion.
- **Context (why):** in `the-rescue.json` the prison is entirely `blocked` tiles — vertical wall runs
  with one-tile **door gaps** and cell rings around the captives — and **all ~19 were placed one click
  at a time**. A wall-heavy structural map makes the per-tile grind the dominant cost; it only gets worse
  at 20×20. The natural fix (drag to paint a run) is now **taken by D100's drag-to-pan**.
- **Decision — two-click shape tools, not drag-paint.** Two new **wall** brushes: **line** (a straight
  run, snapped to the dominant axis so a rescue-style perimeter/corridor lands rectilinear) and **rect**
  (an **outline** ring = a cell/room; a **filled** mode = solid mass). Interaction is **anchor-click →
  far-click** (with a live accent-wash preview between), deliberately **not a drag** — so it never
  collides with the pan gesture, and it's *more precise* for structural work than a freehand drag. Shapes
  **add** walls (set, not toggle — a shape lays structure, it doesn't punch holes in what it crosses); a
  door is still a **gap you erase** afterward (no door entity, per D98). The geometry (`lineTiles`/
  `rectTiles`) is pure. A pending anchor is cancelled on brush-switch / resize / import.
- **Decision — live coordinate readout.** The panel header shows `tile (col,row)` under the cursor (and
  the pending anchor while a shape is aimed). Structural authoring is alignment-bound — cells and doorways
  have to line up — and counting diamonds by eye doesn't scale; the readout is the cheap precision aid.
- **Scoped (JIT):** line/rect target **walls only** (the structural need); no fill-flood, no
  mirror/symmetry, no cell-stamp macro (rect-outline + erase-a-gap already yields a cell) — offered and
  **deferred** by the owner. The readout is a DOM line (robust under camera zoom), not a near-cursor label.
- **Guards:** `test:e2e:editor` extended — the coordinate readout tracks the hovered tile, the line tool
  lays a 4-tile run in two clicks, rect-outline lays a 6-tile ring, and the level still validates (via a
  new `harness.hover` primitive). Brush palette is now **10**. tsc · build · vitest (**1184**) green;
  `game/`-only, no core/routing/surface touched.
- **Reuses:** **D98** (the editor brush loop + `CombatView.fillTile` for the preview wash + the DOM panel),
  **D100** (the pan gesture the two-click model is designed around). **Superseded by:** —

---

## D102 — Editor M-C: objectives editor + reward controls graduate from passthrough

- **Status:** Decided + built (2026-07-18). Closes the largest editor↔JSON gap for finale authoring —
  the owner asked what the visual editor *couldn't* reach that hand-authoring can, and objectives + reward
  were the biggest (both were **passthrough-only**: round-tripped on import, but no UI to create/edit).
- **Context (why):** the finale *is* objectives — `eliminate-all` OR `extraction` (D97), and `closing-gate`
  is the "escape before the alarm" tension a prison break wants. The editor only **auto-derived** the
  standard rescue pair (fixed generic labels, `required: true`) and couldn't author or tune any of it; the
  reward was a fixed `{gold:50,xp:40}`. `editor-draft.ts` already earmarked these as **M-C**.
- **Decision — graduate `objectives` + `reward` to first-class draft fields.** They leave the
  {@link DraftPassthrough} bag (which now holds only rumors/intelDepth/grants → M-E) and become real
  `EditorDraft` fields with controls:
  - **Objectives editor** (Events drawer): add/remove rows; per row a **kind** picker
    (eliminate-all · closing-gate · extraction), a **label** text field, a **required** checkbox (the
    win/lose-gating vs. optional-bonus switch), and kind-specific fields — closing-gate **speed** +
    **driver** role; extraction **escort** role. A **"Derive from board"** button drops the standard pair
    in so labels/required become tunable. A kind change rebuilds a **clean** objective (no stale fields).
  - **Reward control** (Scenario drawer): **gold** + **xp** (materials round-trip verbatim — no picker yet).
- **Decision — the exit brush stays the one source for an extraction span.** An extraction row's `span`
  is **(re)bound to the painted exit tiles on export**, not authored per-objective — so there's a single
  place to place the span and it can't drift from the board. `standardObjectives()` is the **one** derive
  helper shared by the export path (empty list ⇒ derive) and the "Derive" button, so they can't diverge.
  Empty `objectives` still auto-derives (a plain painted rescue "just works"); a non-empty list is verbatim.
- **Scoped (JIT):** closing-gate's **swept-tiles span** isn't paintable yet (a new brush) → an
  editor-made gate is a **pure timer** (`span ?? []` tolerates it); reward **materials** have no picker
  (round-trip only); **grants / rumors / intelDepth** stay passthrough (→ M-E). Objective **ids** are
  auto-generated (`obj-N`), not hand-edited.
- **Guards:** `editor-draft.test` (authored objectives beat the derive — tuned label + optional `required`
  + extraction span rebound to exit; graduation asserted); the M-A **round-trip** + the-rescue lossless
  tests still deep-equal with the fields graduated. `test:e2e:editor` extended (imported finale shows its 2
  objectives as rows; edit label + toggle required → export; ＋add; reward gold → export; still validates).
  tsc · build · vitest (**1185**) · editor/level e2e green. `game/` + one `game/`-test only; **no core,
  routing, or game-surface change** — the serialized shape is unchanged, so `staging`/`levels` are untouched.
- **Reuses:** **D98** (editor + the passthrough-graduation plan it named), **D97/D50** (the objective model
  + `OBJECTIVE_KINDS`), **D99** (the walkover guard still validates the authored span). **Superseded by:** —

---

## D103 — Interactable gates: the lock is the tile, opening it is data (prison-break substrate)

- **Status:** Deciding + **building in phases** (2026-07-18). Owner-driven, from a concrete finale
  narrative (below). **Phase 1 (core) + Phase 2a (wiring) + Phase 2b render + the Phase 3 destructible
  door + the enemy AI battering it + the control-room lever + the editor gate/lever brushes built** — the
  full seal loop plays *and* the prison is paintable. Remaining: **promote** the seal into the Hollow Mill
  finale (an owner-directed step). Candidate for a `decision-adversary` red-team before that promotion.
- **Owner's finale flow (the design source):** an **infiltrator** reaches a **control room**, which
  **locks a door sealing the guards** on the far side; that buys the **assault team several turns** to
  **lockpick the cells** open — and the *easiest* open is to **defeat the Captain**, who holds the keys.
- **Decision — the gate IS the lock (spatial), not a flag on the unit.** A **gate** occupies a tile and,
  while `locked`, is **impassable** — it physically **encloses** a cell's prisoner (can't leave till it
  opens) and **shuts out** the control room's guards. This replaces the old "the captive carries a
  lockpick flag" model: the enclosure is real board geometry (pathing/reach read `TileGrid.isWalkable`),
  wired via a new runtime `TileGrid.setWalkable` — a locked gate blocks its tile; opening clears it.
- **Decision — how you open it is DATA (`openBy`), so freeing prisoners is extensible.** Each gate carries
  an OR'd list of {@link GateLock} conditions interpreted in one place — **new ways to free a cell are new
  records, not new branches** (the D4 field-entity ethos, same as skills/objectives/events). This is the
  whole point the owner asked for: "additional mechanics besides lockpicking." Two conditions ship first
  (deliberately *different shapes*, to prove the interpreter is genuinely extensible, not aspirational):
  - **lockpick** — an *adjacent* Expert-Lockpick unit (the Thief) spends an Act. Reuses the exact
    capability gate the captive rescue used (`unitHasCapability(by,"lockpick")`, never a jobId, D54/D72).
  - **keyholder** — opens **automatically** when a unit matching a `tag` (role/id) is **defeated** — the
    Captain drops the keys. Event-driven + tag-bound (reuses `matchesTag`, promoted from module-private).
- **Phase 1 — pure core (built): `gates.ts`.** `Gate` (`locked` + `openBy`), `makeGate`/`openGate`;
  the interpreters `canLockpickGate` (locked + has-lockpick-cond + adjacent + capable), `lockpickableGates`,
  `gatesOpenedByDeath`; the grid interplay `applyGatesToGrid` (block locked tiles at assembly) +
  `openGateOnGrid` (open + unblock). No Phaser/DOM/`Math.random`. Guards: `gates.test` (locked blocks &
  open clears the tile; only an adjacent Thief picks; keyholder death opens every matching locked cell by
  role *or* id, and never a lockpick-only cell or an already-open one); barrel-surface +8 (documented).
- **Phase 2a — battle wiring (built, headless):** `AuthoredEncounter.gates` (+ `AuthoredGate` +
  `buildAuthoredGates`) armed in **staging**; `Battle` gained `gates` — it `applyGatesToGrid` on
  construction (locked tiles block) and wires a `unitDefeated` hook that `openGateOnGrid`s keyholder cells
  (the Captain drops the keys); a logged **`openGate` action** + `Battle.openGate(gate, by)` (the interact
  Act — the rescue Act generalized: adjacent + capable → open, refused = a no-op); a `gateOpened` event;
  and **undo/replay correctness** — the checkpoint snapshots each gate's `locked` and re-blocks its tile on
  restore (so undoing a lockpick, or a kill that popped a cell, re-locks it). Guards: `gates-battle.test`
  (locked blocks; Thief opens the adjacent cell + `gateOpened` fires; a non-lockpick unit is refused;
  defeating the Captain pops every keyholder cell; **undo re-locks**). tsc · build · vitest (**1196**) · sim
  digest byte-identical (additive; no content uses gates yet). Gates ride the editor **passthrough** bag so
  a level with gates round-trips losslessly until the brush lands.
- **Phase 2b render — built (in-battle, visual-e2e proven):** `BattleScene` draws each locked gate with
  the `▦` `ICON.gate` (over the obstacle block its non-walkable tile already raises — reads as a *cell*,
  not a wall); the Thief's **Pick Cell** verb surfaces adjacent to a lockpickable gate in **both**
  deployment + combat (mirrors the D90 Pick-Lock verb via `canLockpickGate` + `commitFieldAct`); a
  `gateOpened` bus listener redraws the grid (the opened tile clears — `drawGrid` made self-destroying so
  it's re-callable), drops the marker, and logs (a Thief's pick or the keyholder's keys). Guarded by the
  new **micro-interaction harness (D104)**: two minimal `#scene` fixtures (`micro-gate-lockpick`,
  `micro-gate-keyholder`) driven by **`test:e2e:micro`** — the MANDATORY new-surface guard (the D92 freeze
  tale), wired into CI. tsc · build · vitest (**1196**) · sim byte-identical.
- **Phase 3 destructible door — built (core + render + micro-guard):** the `GateLock` gains
  `{ kind: "destructible", hp }`; `makeGate` seeds `Gate.hp`/`maxHp`; the interpreters `isBreakable` /
  `canAttackGate` (any unit in attack range — a door isn't lockpick-gated) / `breakableGates` / `damageGate`
  (chip, break at 0). `Battle.attackGate` + a logged `attackGate` action chip the door by the striker's
  attack, emit `gateDamaged` while it holds and `gateOpened` (cause `destroyed`) when it breaks; the
  checkpoint now snapshots `{locked, hp}` so undoing a hit restores durability + the block. Render: a
  **Break Gate** verb (any unit, both phases), an HP readout under the `▦`, a `gateDamaged` flash/log, the
  "smashed open" line. This is the owner's *timer* (D103 footer): the "several turns" = the door's HP under
  attack, no `closing-gate` countdown. Guard: micro entry #3 `micro-gate-destructible` (`test:e2e:micro`:
  holds one hit → breaks the next, no freeze) + `gates.test`/`gates-battle.test` (chip/break/range + undo
  restores hp). barrel +5. tsc · build · vitest (**1199**) · sim byte-identical.
- **Enemy AI targeting a door — built (Phase 3):** the guards *choose* to batter a destructible seal.
  `planEnemyTurn` gains a **door-break tier** in its enumerate-score-pick: `AIPlan.gateTarget` +
  `AIOptions.gates` (threaded from `Battle.runPolicyTurn`) + `AI.doorBreak` (500 — below any foe attack
  `actionBase` 1000+, above pure advance). The user's *"the condition won't always be true"* is the crux:
  door-break is offered **only when the unit is terrain-walled-off from *every* seen foe** (`findPath`
  returns null — the locked door is the wall); if a route around exists the guard advances/fights and
  never wastes a turn on a door. Priority is **foe > door > advance**; `planActions` lowers `gateTarget`
  to the logged `attackGate`; the scene renders it via the same `gateDamaged`/`gateOpened` bus listeners
  (no scene change). Guard: micro entry #4 `micro-gate-enemy-batter` (a walled-off guard batters a 20-hp
  door down over turns) + `ai.test` (batters when walled off · does NOT break a door it can walk around ·
  prefers a reachable foe). barrel +1. tsc · build · vitest (**1202**) · **sim digest byte-identical**
  (gateless content ⇒ no door-break path). This is the finale's "several turns" made real.
- **Control-room lever — built (Phase 3, completes the seal loop):** a `Lever` (`{id, pos, targets[]}`) —
  a pull-switch that **toggles** its target gates from a distance (the remote-trigger `GateLock` shape).
  `Battle.pullLever` + a logged `pullLever` action toggle each target: an open door **slams shut**
  (`lockGateOnGrid` — re-block + restore durability, so a freshly-shut door is whole), a locked one
  reopens; a gate whose tile a **living unit occupies is never sealed** (no trapping a body in a wall).
  `AuthoredEncounter.levers` (+ `AuthoredLever` + `buildAuthoredLevers`) armed in staging; a `gateLocked`
  event + the `lever` `gateOpened` cause drive the render (`⎇` `ICON.lever` marker, a **Pull Lever** verb,
  the "slams shut" redraw). Undo crosses the toggle via the existing gate checkpoint (no new state). **The
  full loop now plays:** the infiltrator pulls the lever → the destructible door seals → the AI guards
  batter it down over turns. Guard: micro entry #5 `micro-lever-seal` + `gates.test`/`gates-battle.test`
  (toggle, the occupancy guard, undo). barrel +6. tsc · build · vitest (**1205**) · e2e:micro (19 across 5)
  · deploy-battle e2e · sim byte-identical. **The seal is the timer** (owner, 2026-07-18): "the delay would
  just be a result of enemy action to bust down the door" — emergent from the door's HP under attack, **no**
  `closing-gate` countdown.
- **Editor gate/lever brushes — built (Phase 2b, closes the editor↔JSON gap; owner-flagged categorization).**
  The owner's insight: *"wall and placeable elements don't really seem the same"* — a painted **substrate**
  vs. a **placed object** with its own properties. So a new **Objects** tab (gate · lever · trap — trap moved
  here) sits beside **Terrain** (now walls/floor only), with **Select + Erase** promoted to persistent
  cross-cutting tools. Gates + levers **graduated** to first-class `EditorDraft` fields (out of the M-A
  passthrough bag). A gate lands as a default **lockpick cell**; the **persistent inspector** (moved out of
  the Units drawer so it edits *any* selected object anywhere) sets a gate's `openBy` (lockpick / keyholder
  + role / destructible + hp) + `locked`, and a lever's **target gates** (a checklist of placed gate ids).
  Board markers: `▦`+`L/K/D` tag per gate, `⎇` per lever, gold ring on the selected object. Guard:
  `test:e2e:editor` extended (place a gate → default lockpick; inspector adds destructible; place + wire a
  lever → targets in the export; still validates) + `editor-draft.test` round-trip. Palette 12 brushes / 5
  tabs. tsc · build · vitest (**1205**) · e2e:editor (46) · level e2e · sim byte-identical. **The prison is
  now fully paintable** — walls, cells (lockpick/keyholder/destructible), the control-room lever, all in
  `#editor` → Download JSON → play. **Then:** promote the seal into the finale.
- **Scoped (JIT):** first cut = **lockpick + keyholder** only. Seam-ready, not built: **lever** (a remote
  switch tile), **key** (a carried item), **destructible** (bash it down — needs units to target a non-unit,
  the one bigger lift). Each is a new `GateLock` member + a case, nothing structural.
- **Reuses:** **D4** (the field-entity/data-callback ethos), **D52/D69** (the captive rescue + the exact
  lockpick capability gate), **D50/D97** (`ObjectiveTag`/`matchesTag` for the keyholder), the `TileGrid`
  (extended with `setWalkable`). **Supersedes (in time):** the captive `lockpick`-release flag as the
  *cell* model — a cuffed captive becomes "a plain captive behind a lockpick gate." **Superseded by:** —

---

## D104 — The micro-interaction harness: a rendered microcosm per mechanic

- **Status:** Decided + built (2026-07-18). Owner idea, standing up alongside the D103 gate render — "a
  smaller microcosm version of our individual encounter visual tests," one per micro-interaction
  (defeat→keys, a unit destroying a door, …).
- **Context (the gap):** a mechanic had two coverage rungs with nothing between — **vitest microtests**
  (fast, isolated, one behavior, but **never render** → can't catch a Phaser **freeze**/bad marker) and a
  **full-encounter e2e** (renders, catches freezes, but heavyweight — boots Chrome + stages a whole
  encounter to check one beat). The middle rung was missing: a *rendered* proof of one micro-behavior.
- **Decision — a "mechanic storybook" on the existing `#scene` rail, not a new framework.** Three thin
  pieces: **(1)** minimal single-mechanic **fixtures** — each a tiny `ScenarioConfig` (`scenarios/micro.ts`):
  one actor + the one entity under test + a lone body so the deploy net has a danger source, ~15 lines.
  **(2)** one **walker** (`scripts/e2e-micro.mjs`) that boots each fixture **in a single Chrome session**
  via `g.boot` (the harness's cheap re-boot, not a browser per case), drives the one interaction via
  `bsEval`, and asserts the **visible** effect (marker present/gone, verb surfaces, tile clears) + no page
  error (the freeze catch). **(3)** the fixtures double as a **clickable gallery** — bare `#scene` already
  lists them, so each interaction is walkable by hand in isolation. Adding a mechanic's render guard = one
  fixture + a ~10-line walker block.
- **Boundaries (what it is NOT):** it **complements**, not replaces — vitest keeps the **logic** depth, the
  full-encounter e2es (`test:e2e`, `:scenario`) keep the **integrated flow**. A render freeze only surfaces
  in real Phaser, so Chrome stays unavoidable; the single-session walker is the efficiency lever. Kept
  lean deliberately so it earns its keep (the owner's "make sure it's a microcosm" intent).
- **Built:** `MICRO_GATE_LOCKPICK` + `MICRO_GATE_KEYHOLDER` (the first two entries — the D103 gate render's
  guard) via `test:e2e:micro` (6 assertions, 2 interactions, one browser session), wired into CI. The
  transient `#scene=jailbreak` showcase + `test:e2e:gates` (added earlier this session only to host the
  gate guard) were **retired** into this — no redundant scenario. barrel: −`JAILBREAK`/`JAILBREAK_ENCOUNTER`
  +`MICRO_GATE_LOCKPICK`/`MICRO_GATE_KEYHOLDER`/`MICRO_SCENARIOS`.
- **Next customers:** the D103 **destructible door** (Phase 3) lands as micro entry #3 (a unit attacking a
  gate → it breaks); then `key`/`lever` gate opens, and existing beats (rescue, trap-spring, sway) can
  migrate in as cheap entries over time.
- **Reuses:** the **#170** `#scene` scenario harness (boot-any-encounter + the picker) + `harness.mjs`'s
  `g.boot`/`bsEval`/`assertNoProblems`. **Superseded by:** —

---

## D105 — Red-team pass on the D100–D104 work: three confirmed correctness fixes (C1/C2/C3)

- **Status:** Decided + built (2026-07-18). Owner ask ("let's red team everything we work on in this
  session") → two `decision-adversary` passes (gate mechanics + finale; editor + AI + harness) plus a
  throwaway probe test that asserted *correct* behavior so a failure = a confirmed bug. Three fired.
- **C1 — a gate opening on a wall tile dissolved the terrain.** `TileGrid` held a single `blocked`
  layer, so `openGateOnGrid`'s `setWalkable(pos,true)` couldn't tell a permanent wall from a gate
  block — opening a gate placed on (or reinforced by) a wall tile punched a permanent hole. **Fix:**
  split the grid into an **immutable `wall` layer** (authored terrain) + a **runtime `blocked`
  overlay** (the gate seam). `isWalkable` requires *both* clear, so `setWalkable(wallTile,true)` is
  inert — the wall always wins. `setWalkable` only ever touches the overlay. (`grid.ts`; regression in
  `grid.test.ts`.)
- **C2 — an all-optional objective set was a turn-one trivial win.** `withDefaultGoal` skipped the
  injected default whenever the list named *any* goal-kind — **even an optional one** — leaving zero
  required objectives, which `encounterOutcome` scores as a vacuous win (a live enemy, instant
  victory). **Fix:** inject the default unless the list names a **required** goal
  (`isGoalKind(s.kind) && s.required`). An optional goal no longer suppresses it. Consistent with the
  finale (both its OR'd goals are `required:true`). (`objectives.ts`; regressions in
  `objectives.test.ts` + an end-to-end `stageEncounter` case in `staging.test.ts`.)
- **C3 — the enemy AI battered an irrelevant destructible door.** The door-break relevance gate
  proved "walled off from *every* seen foe" but never "breaking *this* door helps" — so a guard sealed
  by **permanent terrain** with an unrelated/decorative door in range smashed it for turns. **Fix:**
  filter `breakableDoors` to those whose *opening actually reveals a route* — probe each by momentarily
  opening its overlay tile and re-pathing to a seen foe, restoring it either way. The finale's genuine
  seal (the door *is* the sole wall) still batters; the decorative door is skipped. Conservative on
  doors-in-series (never batters without provable progress). (`ai.ts`; regressions in `ai.test.ts` — a
  bad case *and* a kept-good case.)
- **Deferred (surfaced, not yet fixed — owner to prioritize):** the finale-promotion blockers (the
  "several turns" seal isn't a robust timer — infinite reseal, x-ray-sight-gated batter, untuned HP,
  hold-order silently disables it; the lever is an unconditional skeleton key bypassing `openBy`;
  silent-unrescuable-prisoner via empty `openBy` / an escaping keyholder) and the editor authoring
  footguns (`objectSeq` id collision on import, dangling lever targets after erase, empty-span
  extraction, no gate/lever `validateLevel` coverage). These gate the **finale promotion**, not these
  three correctness bugs. **Superseded by:** D106 (the seal's infinite-reseal, F2a, is now closed).

---

## D106 — A smashed door is a permanent breach: the destroyed gate leaves a passable remnant

- **Status:** Decided + built (2026-07-18). Owner design — "make [the door] a unit-style element entity:
  when it is destroyed it leaves a remnant on the board you can move over, more just a marker. Only the
  lever can toggle it, whereas destroying it will be permanently disabled." Directly closes the D105 F2a
  **infinite-reseal** exploit as a *design* fix, not a tuning band-aid.
- **The problem it solves (F2a):** `lockGateOnGrid` restored a destructible door to full HP on every
  re-seal, so one unit posted at the lever could re-seal the door at full durability each time the guards
  battered it to 0 — the "several turns" pressure the finale is built on evaporated into a permanent
  free wall. The seal needed a *one-way* state: once broken, it stays broken.
- **Decision — a third gate state, `broken`, distinct from intact-open.** A `destructible` gate now has a
  lifecycle: **locked** (shut, blocks) → **open** (intact, `locked:false`, lever can re-seal) → **broken**
  (smashed to 0 hp, `locked:false` + `broken:true`, a *passable remnant*, **never** re-sealable). The
  break-loop calls the new `destroyGateOnGrid` (sets `broken`, unlocks, zeroes hp, unblocks the tile)
  instead of `openGateOnGrid`; `lockGateOnGrid` and the `pullLever` toggle both **no-op on a broken gate**;
  `isBreakable` excludes broken (can't re-batter rubble). So the guards' battering is a permanent breach
  and the reseal is gone — while an *intact* door (opened by lockpick/keyholder/lever) stays fully
  toggleable. The distinction is exactly the owner's "only the lever can toggle it [while intact]; destroying
  it is permanent."
- **Render (D92 rule — a new player-facing surface).** A broken gate draws a muted, low, **passable ▨
  remnant** marker (`ICON.gateRemnant`) instead of the ▦ lock + HP readout — proven **in the real scene**
  via a new `MICRO_GATE_REMNANT` fixture + `test:e2e:micro` block (smash it → ▨ remnant + walkable → pull
  the lever → it stays a remnant, no re-seal, no freeze). The existing destructible + enemy-batter micro
  assertions updated from "markers gone" to "▨ remnant present."
- **Undo/replay:** the gate checkpoint now snapshots `broken` alongside `locked`/`hp`, so undoing the
  killing blow restores the whole, sealing, un-broken door (covered in `gates-battle.test`).
- **Scope kept lean (NOT a literal Unit):** the door stays a `Gate` record — it already behaves
  entity-like (HP, attackable in range). "Unit-style" is the *feel* (it's destroyed and leaves a remnant),
  captured by the `broken` state; no unit-list/targeting refactor. barrel: +`destroyGateOnGrid` +
  `MICRO_GATE_REMNANT`.
- **Remaining (not this change):** the *double-pull top-up* (opening then re-sealing a still-standing
  damaged door restores its HP) is a lesser, **risky/costly** vector — **now closed by D107**; the other
  D105 finale-timer items (x-ray-sight-gated batter, untuned HP-vs-garrison, the hold-order that disables
  the loop, the lever-as-skeleton-key) are still open. **Superseded by:** D107 (the reseal HP-restore is gone).

---

## D107 — A lever re-seal no longer mends the door: battering persists across seals

- **Status:** Decided + built (2026-07-18). Owner ruling — "I do not believe flipping the lever should
  restore the health of the door." Closes the *double-pull top-up* vector D106 left open.
- **The problem it solves:** `lockGateOnGrid` restored a destructible door to full HP on re-seal (a
  hold-over from the D103 "a freshly-shut door is whole" framing). Combined with the lever's toggle, a
  player could open→re-seal a still-standing damaged door to top its durability back up — a softer sibling
  of the F2a exploit D106 killed. It also just modeled the wrong thing: slamming a battered door shut
  doesn't repair the cracks.
- **Decision — re-sealing keeps the accumulated damage.** `lockGateOnGrid` now only re-locks + re-blocks
  the tile; it no longer touches `hp`. So the guards' battering **persists across re-seals**, and each
  fresh seal buys strictly *less* time than the last — the pressure ratchets instead of resetting. (The
  only place a destructible door's hp resets to `maxHp` was this line; nothing else restores it.)
- **Interaction with D106:** a door still has its three states (locked → open → broken); D106 made
  *destruction* permanent (the remnant), D107 makes *damage* sticky (no top-up on the intact door). Together
  the "several turns" seal is now a genuine, monotonic timer — resealing delays the breach but never
  rewinds it, and once it breaks it's gone.
- **Tests:** the `lockGateOnGrid` unit test flipped from "restores durability" to "KEEPS its accumulated
  damage" (and its old form was found to have passed for the wrong reason — it damaged an *open*,
  non-breakable door, so the restore line masked a no-op); plus a battle-level `D107` case (batter → lever
  open → lever re-seal keeps the damage → one more hit finishes it). Render guard (D92 rule): a new
  `MICRO_GATE_RESEAL` fixture + `test:e2e:micro` block proves the **HP readout persists** in the real scene
  across the open→re-seal toggle (stays `11/20`, never a restored `20/20`). barrel: +`MICRO_GATE_RESEAL`.
- **Remaining:** the other D105 finale-timer items (x-ray-sight-gated batter, untuned HP-vs-garrison, the
  hold-order that disables the loop, the lever-as-skeleton-key) — reframed into a doctrine in D108.
  **Superseded by:** —

---

## D108 — The prison-break guard doctrine + `in-combat` as the first tag-status (design, scope agreed)

- **Status:** Designed, scope agreed (2026-07-18) — owner-directed design conversation. **Not yet built.**
  One crux still owed before build: **what sets and clears `in-combat`** (see the open question). Recorded
  now so the direction is durable (it lived only in the session transcript).
- **Why:** the D105 red-team surfaced four *loose* finale-timer behaviors — door-break gated on x-ray sight,
  untuned door-HP-vs-garrison, a `hold` order silently disabling battering, and a lever that skeleton-keys
  any wired gate. The owner's insight: three of the four are **accidents of the enemy AI's targeting model**
  (door-break was bolted onto the "see a foe → attack it" loop, so it inherited that loop's preconditions).
  The fix isn't four patches — it's replacing the accident with an intentional **guard doctrine**.
- **The doctrine — a sealed door is an alarm.** When the route to the control room is sealed, every guard on
  the far side wants **through** it (something's clearly gone wrong), and *how* they open it depends on what
  they carry:
  - The **Warden** (see below) holds the key → walks to the door and **unlocks it** — a fast adjacent Act,
    no HP grind. Re-opening the seal lets his guards back in (undoes the player's lever).
  - **Keyless guards** → **batter it down** (the D106/D107 destructible-HP model, now a genuine timer).
  - All of it is **suppressed while `in-combat`** — a unit trading blows doesn't peel off to answer the door.
  This is a **spatial/objective drive** (walled off from the goal → converge on the door), **decoupled from
  vision** (retires red-team #1) with `in-combat` as the single off-switch (retires #3, the hold footgun).
  The lever stays a **general tool** — works from an infiltrator start *or* an assault start.
- **The Warden = the route's major boss = the keyholder — one unit, the whole tension.** *Alive*, he walks
  to the sealed door and re-opens it with his key (buys the garrison back in). *Dead*, his cells pop open
  (the existing keyholder-death mechanic — the assault team's shortcut). Kill-him-fast vs he-undoes-your-seal.
- **Keyholder becomes an *active, living* behavior (new).** Today `keyholder` is **only a death trigger**
  (`gatesOpenedByDeath`). D108 adds a *living* keyholder who **reaches a gate and opens it as an action** —
  a new AI drive, reusing the existing gate-interact Act shape. Deliberately **no item object**: "using the
  key" == the keyholder-tagged unit reaches the door and opens it. (Same character keeps both behaviors.)
- **`in-combat` = the first real tag-status — this is the concrete use-site that graduates Epic #171.** The
  parked status-model track was left *design-only, use-site-gated*; this finale is the pull. Scope discipline:
  introduce the status **vocabulary** with `in-combat` (self-contained), and **do NOT** migrate `captured`
  in the same step — folding `captured`→status is the ~30-site migration rev-4 already flagged; it stays a
  deliberate later step, not a prerequisite. (Owner's instinct "a tag-status is a better way to fold in
  captured units" matches the track — validated, just sequenced apart.)
- **Lever skeleton-key (#4) — separate, clean fix.** Add `{kind:"lever"}` to the gate `openBy` union (the
  seam is already stubbed in `gates.ts`) so a lever only controls gates *authored to accept it* — lever
  control becomes a gate property, not an unconstrained wire. Independent of the doctrine above.
- **Scope principle — three behaviors, not three frameworks** (concrete-first / YAGNI, matching the status
  track's use-site-pulled laddering):
  1. **Guard door-doctrine** — the AI drive (converge → key-open or batter → gated by `in-combat`).
  2. **`in-combat` as the first tag-status** — minimal status vocabulary + its set/clear rules.
  3. **Keyholder-opens-door as a behavior** — reuse the gate-interact Act; **no** item object.
- **Explicitly deferred (NOT built now):** a **transferable in-encounter item system** (a guard drops a key,
  another picks it up and uses it) — confirmed we have **no board item-pickup today**; the nearest patterns
  are the captive-rescue + gate-interact Acts (step adjacent → logged Act), which is the shape it'll take
  **when a use-site pulls it**. Also still open: the untuned-HP tuning (#2) — candidate shape is
  *breach-points-as-turns* (each batterer chips a fixed 1/turn, so break-time = HP ÷ batterers, "several
  turns" authored directly); to be settled during the doctrine build.
- **Open question (the crux to define before build):** the **set/clear rules for `in-combat`** — what marks
  a unit in combat (attacked this turn? adjacent to a live foe? took damage recently?) and what clears it
  (no adjacent foe for N turns?). This determines whether the doctrine feels *fair* — too sticky and guards
  never answer the door; too loose and they abandon fights to babysit it. **Superseded by:** —

---

## D109 — Editor placement: the slab tray below the canvas (Scale.FIT on the editor route)

- **Status:** Slices 1 + 2 landed (2026-07-19, branch `claude/level-editor-placement-ni924o`).
  Owner-directed, TaleSpire slab-tray direction, worked interactively (mock → `memento:challenge` →
  build → real-scene screenshot per step). **Slice 1** = geometry/relocation; **slice 2** = the
  thumbnail gallery, live display options, and the bar/side-drawer split. Editor e2e now **59** green.
- **Why:** the D98 editor's chrome was a fixed **right-hand column** eating ~40% of the canvas width —
  wrong for the owner's stated next direction (bigger 20×20 boards, richer maps). Owner ask: run the
  editor along the **bottom, edge-to-edge, below the map**, reclaiming the unused space — **without
  bleeding onto game space**. A `memento:challenge` pass surfaced that on a fixed, unscaled 800×600
  canvas "below the canvas + no bleed + reclaim the unused band" are **mutually exclusive**; chosen
  resolution **(A)**: chrome is a DOM sibling **below** `#app` + an **editor-route-only `Scale.FIT`**
  so the board never clips, **top-aligned** so the reclaimed slack pools by the tray.
- **What landed (slice 1 — geometry + relocation):**
  - **`config.ts`** — an `editorScale` (`Scale.FIT` + `CENTER_HORIZONTALLY`, 800×600) applied **only on
    the `#editor` route**; every other scene keeps the fixed 1:1 Scale.NONE canvas.
  - **`index.html`** — `body.editor-mode`: hide the guild run-bar, `#app` → `display:block` so Phaser
    owns sizing and the canvas top-aligns.
  - **`EditorScene`** — the DOM panel moved from the `position:fixed` right column into an **in-flow
    slab dock below the canvas** with a **drag-resize grip** (`[data-role="dock-grip"]`); the board now
    centres in the **full** canvas width. Two refit gotchas fixed: Phaser sizes the FIT canvas against
    the full-height `#app` **at boot before the dock exists** → a deferred `scale.refresh()` after
    mount; and a same-tick refresh during a drag measures a **stale (unflushed) `#app`** → the grip
    coalesces refits into a `requestAnimationFrame` (kills an 820×615 overflow + a white repaint strip).
  - **`harness.mjs`** — `clickScene`/`hover`/`drag` are now **scale-aware** (map logical scene coords
    through `box.width / gameSize.width`); the ratio is exactly 1 for every Scale.NONE scene, so it only
    engages under the editor's FIT. Required because the harness had **hard-assumed** a 1:1 canvas.
  - **`e2e-editor.mjs`** — early pixel-hardcoded board clicks → **tile-based** (`view.tileToWorld`,
    recenter-safe, since the board moved to the full-width centre) + a new **no-bleed / short-viewport
    no-clip guard** (asserts the FIT board never overflows into the dock, including at 900×600).
- **Guards:** tsc · build · vitest **1215** · sim · e2e (editor **49**, deploy-battle, level, scenario,
  arc, second-battle, micro, repro) · visual-audit (14) · challenge — all green. Stepped through in the
  real scene (default + grip-grown screenshots): board full-width, top-aligned, scales down gracefully
  on resize, never bleeds onto the dock.
- **What landed (slice 2 — the gallery + options + the split):**
  - **Thumbnail gallery** — the per-tab text brush palette became horizontally-scrolling **placeable
    cards** (inline-SVG thumbnails mirroring the board markers); the **enemy roster is unrolled** from
    the old `<select>` into one card each (HP/ATK on the face). Cards keep the `data-brush` hook (enemy
    cards add `data-template`); `fillPalette()` (re)builds the strips from the current prefs.
  - **Live display options** (a persisted `EditorPrefs` row) — the three card tweaks made **choosable**:
    **size** (S/M/L) · enemy **tint** (uniform danger-red ring vs an archetype **role** ring, applied to
    **both** cards and board tokens so red=enemy holds — `mark()` gained an optional ring colour) ·
    **captive** variants (1 / 2). Persist to `localStorage`, apply in place (no remount).
  - **Bar / side-drawer split** — the dock is now a short **painting bar** (tabs · gallery · tools ·
    coord · validation · options · grip); a **non-modal side drawer** (fixed right, `[data-role="side-drawer"]`)
    is the **edit-a-placed-object** surface (unit list + inspector). Board stays **full-size** behind it
    (the owner's chosen trade — the drawer overlays the right rather than shrinking the board); a
    **Details** toggle opens/closes it and a board/list **Select auto-opens** it. **Scenario** stays a
    tab but its body is the **level as a whole** — id/name · reward · the level-wide **Objectives**
    (moved here from Events) · JSON import/export — the future home for **cross-expedition tools & checks**.
- **Reuses:** **D98** (editor + content pipeline). **Deferred / next:** the bar/side-drawer overlaps the
  board's right while open (inherent to the side-drawer choice — close to paint); the Scenario tab's
  cross-expedition tooling (arc-linking · cross-level checks · playtest); a proper editor test rung was
  weighed (`memento:challenge`) and **declined for now** — screenshots-as-bandaid, formal editor tests
  later. **Superseded by:** —

---

## D110 — Editor input QoL: keyboard-modified board gestures (Shift-pan · Ctrl-select)

- **Status:** Decided + built (2026-07-19, branch `claude/editor-drag-key-modifier-hjs0qa`).
- **Why:** the D109 editor makes the **whole scene** a click target (chrome is DOM), so painting is a
  drag-heavy gesture — but `BoardCamera` treated **any** drag as a pan, so a sweep across the board
  moved the camera instead of the brush. The owner asked to put panning **behind a key** (Shift) so the
  drag stops fighting the paint, then for a matching **Ctrl-click quick-select** so any brush can pick an
  object without a trip to the Select tool.
- **What — Shift-pan:** `BoardCamera` gained a **`panModifier`** option (`"shift" | "alt" | "ctrl"`) + an
  **`idleCursor`**. When set, the drag→pan transition only fires while the modifier is held (read
  authoritatively off `pointer.event.shiftKey/altKey/ctrlKey` at the threshold crossing); a plain drag
  falls through to the existing **tap** at release, so the brush still paints. Cursor affordance: the
  resting cursor is `idleCursor` and flips to the **grab hand** while the key is held (driven by
  `keydown/keyup-SHIFT` listeners, cursor-only — the pan gate never trusts them). Pan-start now
  **re-anchors** to the current point so it begins smoothly (no threshold jump, no lurch if Shift is
  pressed mid-gesture). Default (no `panModifier`) is byte-for-byte the old behavior — the shared
  battle-board adopter path is untouched. The **`EditorScene`** passes `{ panModifier: "shift",
  idleCursor: "crosshair" }`.
- **What — Ctrl-select:** the Select brush's pick logic was extracted to `EditorScene.selectAt(t)`;
  `onTap` now routes to it when the tap's `pointer.event.ctrlKey` (or `metaKey`, ⌘ on macOS) is set —
  from **any** brush, without switching tools — and skips the active brush's paint. An unoccupied tile
  clears the selection, same as the Select brush. The hint reads
  **"shift-drag to pan · ctrl-click to select · scroll to zoom · Recenter resets"**.
- **Render (D92 rule — a player-facing interaction change).** Stepped through the real `#editor` scene;
  `e2e-editor.mjs` now proves both in headless Chrome (puppeteer holds the modifier so it rides the mouse
  events): a plain drag does **not** pan while a **Shift-drag** pans without painting (Recenter resets, a
  post-recenter tap still paints); and a **Ctrl-click** over a placed gate selects it + opens the drawer
  **without** painting the active Wall brush, while a Ctrl-click on an empty tile clears the selection.
- **Guards:** tsc · build · vitest **1215** · e2e (editor **65**). **Reuses:** **D98/D109** (the editor +
  `BoardCamera`). **Deferred / next:** true **drag-to-paint** (a plain sweep painting every tile it
  crosses, not just the release tile) is a larger brush-loop change — not in scope here. **Superseded by:** —

---

## D111 — Editor input QoL, part 2: drag-to-paint · right-click erase · alt eyedropper · hotkeys · undo/redo

- **Status:** Decided + built (2026-07-19, branch `claude/editor-drag-key-modifier-hjs0qa`).
- **Why:** with panning moved behind Shift (D110) the plain drag gesture was freed up; the owner asked
  for a batch of ergonomics improvements "in theme" with the modifier work. Five landed together because
  they all funnel through the same press/tap/keyboard path.
- **What:**
  - **Drag-to-paint.** A press on a toggle-terrain brush (wall/spawn/exit/trap) or a right-click opens a
    **stroke**: the first tile's state fixes the op (empty→**add**, occupied→**remove**; right-click / the
    Erase brush →**erase all**), and every tile the cursor sweeps applies it once — gap-filled with
    `lineTiles` so a fast drag lays a continuous run. The board redraws per-tile; the heavy DOM/export
    refresh waits for release. Entity/shape/select brushes stay click-driven. `BoardCamera.onDown` now
    ignores non-left buttons so a right-drag never pans or fires a stray tap.
  - **Right-click / right-drag erase** from any brush (context menu suppressed via `input.mouse.disableContextMenu()`).
  - **Alt-click eyedropper** — adopt the brush that would recreate the object under the cursor (enemy →
    its archetype, captive → its release, gate/lever/trap/terrain) and jump to its home tab. Rounds out the
    modifier set: **Shift** pan · **Ctrl** select · **Alt** pick · **right-button** erase.
  - **Brush hotkeys** (`W/L/R G/V/T N/C P/X S/E`) + **Esc** (cancel a pending shape + deselect), on a
    `window` keydown listener **paired with mountPanel/unmountPanel** (so it survives the import remount)
    and **ignored while a form field is focused** (typing an id never switches brush). A hotkey jumps to
    the brush's home tab so the picked card is visible.
  - **Undo / redo** (`Ctrl/⌘+Z` · `Ctrl/⌘+Shift+Z` / `Ctrl+Y` · **↶/↷ buttons**) over whole-draft JSON
    snapshots — one entry per committed edit (a whole stroke = one undo). Covers board/placement/shape
    edits; inspector/objective/reward form fields are direct-manipulation and off the stack.
- **Render (D92 rule — player-facing interactions).** `e2e-editor.mjs` grew to **88** assertions, all
  driven in real headless Chrome: drag-paint a run + re-drag to erase; alt-click eyedrop; right-click +
  right-drag erase; the hotkeys (incl. the home-tab jump and the input-focus suppression); Esc clearing a
  shape anchor + a selection; and undo/redo via both the keyboard and the buttons. The shared harness'
  `clickScene`/`drag` gained an optional mouse-button arg (right-click). The `cautionary tale` footgun
  (an import that remounts the panel silently dropping a listener) bit once here and is now covered.
- **Challenge pass (`memento:challenge`, 2026-07-19).** Traced the paths the happy-path e2e never hit;
  three real defects found + fixed (each now has a regression test):
  - **(A, correctness) dangling stroke painted on a bare hover.** `onHover` advanced the stroke gated only
    on `this.stroke` being set — never on the button still being down. A *missed* pointer-up (focus loss /
    pointercancel — the `POINTER_UP`/`_OUTSIDE` handlers don't cover it) left the stroke live, and then
    merely moving the mouse painted every tile it crossed. **Confirmed** by injecting the dangling state
    and hovering (walls climbed). Fix: `onHover` terminates the stroke when `!pointer.isDown`.
  - **(B, data-loss) a board shrink was silent, irreversible data loss.** `resize` dropped off-board
    entities without a history snapshot → not undoable. Fix: `pushHistory()` in `resize` (the size inputs
    are `onchange`, so one snapshot per resize).
  - **(C, gap) an import wasn't undoable.** `importJson` replaced the whole draft with no snapshot. Fix:
    `pushHistory()` before the swap — the undo stack survives the panel remount the import triggers.
  - Also: `pushHistory` now refreshes the ↶/↷ button enabled-state, and the size inputs got
    `data-role="cols"/"rows"` (test-targetable). Findings judged **not worth fixing** and left as noted
    quirks: a stroke that leaves the board and re-enters draws a connecting line (Photoshop-like, expected);
    the cursor's grab-hand can stick if Shift is released off-window (cosmetic — the pan gate reads the
    pointer event, not the tracked key, so panning stays correct).
- **Undo-gap closure (the challenge's deferred item, 2026-07-19).** Inspector / objective / reward **form
  edits** are now undoable too. All such edits funnel through the shared controls (`field`/`numInput`/
  `selectRow`/`checkboxRow`, and `statGrid` → `numInput`), whose own handlers run in the **target phase** —
  so a **capture-phase** `input`/`change` listener on `window` (`onPanelEdit`) snapshots the **pre-edit**
  draft *before* the control mutates it. **Coalesced per control** (`lastEditTarget`): a field's keystrokes
  + its input/change pair collapse to one undo entry; a blur (`focusout`) or a move to another control opens
  the next. The size inputs (own snapshot via `resize`) and the import box (not a draft edit) are excluded
  by `data-role`; the button-driven objective add/remove/derive get an explicit `pushHistory` (they aren't
  form controls). `pushHistory` split into `snapshotDraft` (raw) + the board-edit variant (also clears the
  coalescing latch). Regression test: edit an enemy's maxHp → Ctrl+Z reverts it (proving the snapshot is
  pre-mutation — a post-mutation snapshot would revert to nothing).
- **Guards:** tsc · build · vitest **1215** · e2e (editor **97**, deploy-battle **73**) · visual-audit (14)
  · challenge (7). **Reuses:** **D109/D110** (the editor · `BoardCamera` · the shift/ctrl modifier path).
  **Deferred / next:** drag-to-place for *entity* brushes (a row of enemies) if it's ever wanted.
  **Superseded by:** —

---

## D112 — Editor **soft play**: playtest the draft in the real BattleScene, return with it intact

- **Status:** Decided + built (2026-07-19, branch `claude/level-editor-soft-play-7yuirj`). Owner ask —
  a way to **functionally** test an encounter from the editor: "is the gate too far from the lever, do
  enemy behaviours work like I expect, is this design too crowded to field a squad".
- **Why:** the D98 pipeline could only test a level via the full **export → drop in `content/levels/` →
  commit → reload → `#level=<id>`** loop — too heavy for the tight iterate-while-authoring feedback the
  owner wanted. Data-only checks (vitest/sim) can't answer *spatial/behavioural* questions; only the
  rendered, playable scene can. Soft play closes that loop **in-scene**.
- **Decision — boot the draft into the real `BattleScene`, no round-trip.** A **▶ Playtest** control in
  the editor's Scenario tab serializes the live draft (`draftToEncounter`), gates it on the same
  `validateLevel` the export shows (fail-loud in the status line, never a mid-boot crash), and hands
  `buildScenarioRun` a `{ run, loop }` straight to the `BattleScene` — the **exact path `#level` already
  uses**, so deploy/AI/spacing are the genuine article, not a preview. Reuses the D91 one-node scenario
  boot; **zero** new combat surface.
- **Decision — a generic `returnTo` handoff, not editor coupling.** `RunHandoff` gains an optional
  `returnTo?: string` (a **scene key**). When set, `BattleScene.returnToOverworld` short-circuits to
  `scene.start(returnTo)` instead of the stub one-node "overworld", and a persistent **"✎ Exit Playtest"**
  button (top-centre, depth above every overlay) lets the author bail at *any* phase — the whole point of
  a functional test is to iterate, not to fight the level to a finish. `BattleScene` never imports the
  editor; the seam is reusable by any host.
- **Decision — the draft rides the scene instance (no persistence layer).** Phaser keeps the `EditorScene`
  instance across `scene.start`, so `this.draft` (and the undo history) survive the round-trip untouched;
  `unmountPanel` (on `SHUTDOWN`) already resets every panel array and `BoardCamera` self-tears-down, so
  re-entering `create()` is clean — proven by the e2e's second-playtest + validate-after-return checks.
  The editor route's scene list grew from `[EditorScene]` to `[EditorScene, GuildScene, OverworldScene,
  BattleScene]` (EditorScene still boots first); the battle renders under the editor's `Scale.FIT` fine.
- **Decision — flexible party selection (owner ask), default a small trio.** Some levels are tailored to
  a class/squad, so *which* party you field matters. A small **squad registry** (`game/playtest.ts`
  `PLAYTEST_PARTIES`: Standard-3 · Vanguard-5 · Skirmishers-4 · Infiltration-3 · Solo-1) surfaced as a
  Scenario-tab **picker**, mapped straight onto the scenario **party matrix** (`ScenarioConfig.parties`) —
  adding a squad is one registry entry, no plumbing. Default = the small standard trio (the `#level`
  cast). The picker is the seam an author uses to field the right cast for a class-specific board.
- **Scoped (JIT):** standalone **soft play** only — not saved/wired into the arc (that stays the deliberate
  promotion step, D99); the party registry is a handful of presets, not a full roster/loadout builder
  (the seam is there when wanted). No change to combat, the pipeline, or the JSON shape.
- **Challenge pass (`memento:challenge`, 2026-07-19, before PR).** Enumerated failure modes and *ran* the
  dangerous ones in real headless Chrome rather than re-walking the happy path. **Settled by inspection:**
  `registerExpedition` overwrites (a second playtest of the same id can't throw); the `window` keydown/
  form-edit listeners are added with the **same bound instance refs**, so `addEventListener` dedups them —
  a round-trip can't double them (confirmed live: one Ctrl+Z undoes exactly one paint post-return); only
  `returnToOverworld` starts the overworld, and it's the branch we guard. **Ran (all survived):** a
  **zero-enemy** draft (validates, boots, resolves — no freeze); an **over-crowded 3×3 board + the 5-body
  Vanguard** (the "too crowded?" case — deployment surfaces the crush, drives forward, no freeze); the Exit
  button clickable **over the resolution dimmer**. **One real defect found + fixed:** the Exit button
  (y=18) **overdrew the deploy state line** ("· reach N · M kits") — moved to y=44 (below the title, clear
  of the left objectives + right situation card in every phase). The two freeze-prone edge levels were
  **promoted into the committed guard** so the failure class can't return.
- **Guards:** tsc · build · vitest **1215** · sim · **`test:e2e:editor:playtest`** (new — **19 assertions**:
  paint → Playtest → BattleScene deploy with the chosen 5-body squad → Exit → editor active with the draft
  intact + re-validated → a second playtest still boots → a zero-enemy board and an over-crowded 3×3+5 board
  each boot + Exit without freezing; **no page errors** = the freeze catch, D92) · editor (97) ·
  deploy-battle (73) · level (11) · scenario (34) · visual-audit (14) · challenge (7), all green. New code is
  `game/playtest.ts` + editor/BattleScene wiring; `core/` untouched. **Reuses:** **D98** (editor +
  pipeline), **D91** (scenario one-node boot + `#level`/`#scene` path), **D109** (the Scenario drawer).
  **Superseded by:** —

---

## D113 — Editor **local persistence**: autosave the working map + a named library across sessions

- **Status:** Decided + built (2026-07-20, branch `claude/level-editor-soft-play-7yuirj`). Owner ask —
  "persist maps across editor sessions … having previous attempts to test the new editor on helps a bit".
- **Why:** the editor's draft lived only in memory (a reload → `blankDraft`), so testing the editor meant
  re-painting from scratch each session and previous attempts were gone. A browser editor **can't write
  repo files** (D98), so the persistence layer is browser-local `localStorage` — beside, not replacing,
  Download `.json` (which stays the path to commit a keeper into `content/levels/`).
- **Decision — two stores, both browser-local, both fail-safe on load.** (1) **Working autosave**
  (`campfire-editor-working`): the current draft is written on **every edit** — `updateExport()` is the one
  chokepoint every board + form mutation already funnels through — and **restored on the FIRST boot only**
  (an instance `restored` flag, so returning from a playtest keeps the in-memory draft rather than reloading
  it). (2) **Named library** (`campfire-editor-maps`): `Save` (keyed by the draft's `id`, overwrite =
  update), a `Load`/`Delete` row per saved map (newest-first, "saved …" hint), and a `New` blank escape
  hatch — so several attempts survive to pick from. Both stored as the **raw `EditorDraft`** (lossless — it
  *is* the editor's state, incl. in-progress/invalid drafts), Load/New are **undoable** (same swap-then-
  remount as import). Chosen over storing the serialized `AuthoredEncounter` so an *incomplete* draft (no
  spawns yet) round-trips too — the whole point of autosave is not to lose in-progress work.
- **No store can wedge the editor.** `sanitizeDraft` coerces any parsed blob to a known-good draft (clamp
  dims to 1..20, bounds-filter every coord, drop entities missing a template-id/in-bounds-pos, default
  every field) or drops it — a tampered / truncated / version-drifted blob boots blank, never crashes (the
  D109 "sanitize persisted prefs" discipline, generalized). All reads/writes are wrapped, so a
  denied/absent/**full** `localStorage` degrades to "no persistence" — and a quota-refused **Save** now
  reports "couldn't save — storage full/blocked" instead of a false ✓ (a challenge fix).
- **Challenge pass (before commit).** Ran the reload round-trip + corruption in real Chrome (all survived):
  autosave restores across a genuine page reload; the library survives a reload (Save→reload→Load→Delete);
  Load is undo/redo-able; a corrupt `working`/`maps` blob boots to a blank editor. Two gaps found + fixed:
  the **quota-refused-Save lie** (now truthful), and confirmed the **playtest-return doesn't re-restore**
  (the `restored` flag). **Known/accepted:** Save is keyed by `id`, so distinct attempts want distinct ids
  (a shared default `id` overwrites — rename via the id field; prompt-to-name is a future nicety).
- **Guards:** tsc · build · vitest **1221** (+6 — `editor-storage.test` pins `sanitizeDraft`) ·
  **`test:e2e:editor:persist`** (new — 13 assertions across a real reload) · editor (97) · playtest (19),
  all green + wired into CI. New code is `game/editor-storage.ts` + editor wiring; `core/` untouched.
  **Reuses:** **D98/D109** (editor + the prefs-sanitize discipline), **D111** (the undo/import swap-remount).
  **Superseded by:** —

---

## Roadmap — queued (not yet authored decisions)

> Forward pointer so a fresh session knows what comes next. These are **not** decided
> records yet — each is authored as a full `## D##` entry when its build starts.

- **Status-model generalization (parked parallel track — design-drafted + red-teamed 2026-07-12).**
  Make statuses a robust, cross-phase system: a `StatusInstance` gains a **cadence** (turn/night/node/
  never) + two shapes — `timed` (today's countdown) and `scaled` (a **magnitude** banded into named
  tiers via the existing `bandFor`, accruing on apply, decaying per tick; effects key off the tier).
  Motivation: statuses usable in **deployment + overworld**, and banded-accumulating conditions
  (tiered poison, exhaustion). The **four red-team revisions** are canon for this track: **(1)** it does
  **not** gate the taste (D90 ships on the boolean; captured→status is an optional epilogue). **(2)**
  **Concrete-first** — build poison hand-rolled via `bandFor`; extract the general `scaled` shape only
  when a *second* scaled consumer appears (YAGNI). **(3)** **Fatigue: coexist, likely don't migrate** —
  its "decay" is bespoke (tier-floor-step-per-night · Deep-Rest-wipe · resolve-time gate · raw story
  deltas across ~10 systems); forcing it into the model fakes generality. **(4)** **Sequence by replay
  cost** — combat/deploy-cadence decay is replay-safe *for free* (reconstructed in the `tickStatuses`
  turn-open path, like `duration`, + golden re-pins); **overworld/night cadence needs new
  `snapshotRun` serialization** (it doesn't persist `statuses` today); captured→status is replay-safe
  but a ~30-site `u.captured`→`hasStatus` migration + snapshot-shape edit.
  **Kickoff graduated (2026-07-12) → design-only, use-site-gated** (owner ruling; no gameplay code
  until a concrete use-site pulls a phase). Brief: [`status-model-kickoff.md`](status-model-kickoff.md);
  Epic **#171**. The candidate is now a **risk-ordered, use-site-pulled ladder** (a menu, not a
  schedule — the use-site triggers a phase; replay-cost is the risk label + tiebreaker):
  **P1** tiered poison — `scaled`, combat, hand-rolled via `bandFor`, **replay-free**;
  **P2** first deploy-cadence status — replay-safe but **not free** (a *sharpening* of rev 4:
  `tickStatuses` runs **only** at the combat turn-open `turn.ts:560`; deploy **reads** statuses
  (`deployment.ts:260`) but never ticks them, so P2 needs a **new deploy-side tick hook + goldens**);
  **P3** first overworld/night-cadence status — the first that needs `snapshotRun` to serialize
  `statuses`, **folded into the #117 save-model session** (RunSnapshot is already partial).
  The **generalization is a lazy extraction** (no upfront framework): the `cadence` enum / general
  `scaled` shape are factored out of the hand-rolled concretes **only when a second consumer of an
  axis appears** (rev 2, on both the shape and cadence axes). **Off the ladder (owner-ruled):**
  `captured`→status is a **capability-neutral** representational refactor whose real value is
  **information surfacing** (Captured shown in the status tracker) — revisit on an **indicator pass**,
  not a freeing one; its end-condition is **event-driven** (not a cadence), the fatigue tell (rev 3).
  **New freeing mechanisms** (key/lockpick/…) are a **`ReleaseRequirement`** concern (`units.ts:179`,
  `canRelease` `deployment.ts:53`) — a two-edit union extension, **no status work, off this track**.
  Children mint **as phases activate** (Epic #171 policy); authored as a full `## D##` when a build starts.

- **D69 — Scout-fork follow-ons** (surface `PRESTIGE_OFFERS` in live runs + camp-accept UI;
  the Expert Lockpick chest/door entity + lock-gated events; the combat convince-an-assassin
  path; job-capability card surfacing; the Scout-line numbers pass). Built *on* D68's fork.
- ~~**The non-combat action substrate**~~ — **done: D72.** The home unified onto `JobDef.skills`
  (A2) with `availableSkills` the one projection (Survey migrated, the registry retired); computed
  costs; the per-node / one-shot flag bag; presence/faucet as data; capability gates; the exhaustive
  `OVERWORLD_EFFECT_HANDLERS` registry + the Upkeep coupling — **fixtures only**. The **three kits**
  (D70/D71) are the next content pass that consumes it.
- **The non-combat triad kits** (consume D72) — Merchant (Appraisal · Find Trade · Savvy Barter) ·
  Cook (Field Kitchen · Cook Stew · Feast; the `chef → cook` rename) · Noble (Renown · Patronize ·
  Bribe), + the numbers pass. The content pass that wires the real verbs onto the classes.
- **Soldier prestige fork** — **Sentinel** (Turtle → persistent stance) vs **Banner**
  (Brother-in-arms scales the party); lands the persistent-stance primitive reserved in D66.
- **Non-combat prestige forks** — Merchant (D70) · Cook / Noble (D71): the first **verb-prestiges**
  (replace-in-place on the verbs/presence, not a battle kit); directions TBD.
- **Banker — per-class pass** — the last economy class's 2+1 (its verbs exist; it **lacks a presence
  anchor** — a pass would add one).
- **Next per-class pass** — one at a time (D66 = pass 1 Soldier · D68 = pass 2 Scout · D70 = pass 3
  Merchant · D71 = passes 4–5 Cook & Noble).
