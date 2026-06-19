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
- **Superseded by:** —

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
- **Superseded by:** —

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
  - **Tier 2 — Companions:** *authored*, **named, distinct, fixed class/identity**, gained
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
- **Superseded by:** —

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
- **Superseded by:** —

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
  `endPlayerTurn`, `afterActionContinue`, `playerMoveStep`, `playerAttack`, `playerRescue`,
  `onPointerMove`, `noteAct`).
- **Superseded by:** —
