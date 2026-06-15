# Overworld — captured ideas (parking lot)

> **Status: GRADUATED (2026-06-06).** The "Resolved" Q1–Q10 below have been promoted
> to formal decisions **D25–D32** in [`decisions.md`](decisions.md) and written up in
> the specs (new [`guild.md`](../../docs/design/systems/guild.md); extended
> [`overworld.md`](../../docs/design/systems/overworld.md),
> [`logistics.md`](../../docs/design/systems/logistics.md),
> [`stats.md`](../../docs/design/systems/stats.md),
> [`field-entities.md`](../../docs/design/systems/field-entities.md)). This file is
> kept as the **reasoning trail / parking lot** for the not-yet-decided remainder
> (the round-2 threads at the bottom). Capture here; the decisions are the record.
>
> Context: M7 shipped the overworld as a seeded Slay-the-Spire-style layered DAG
> (D22–D24) with `combat`/`rest` nodes. The discussion below is about what the
> run-frame should *become*.

---

## Resolved (design session, 2026-06-06)

> Working through the open questions one-by-one (same style as the D8–D16 pass).
> These are **agreed in discussion**; they graduate to `decisions.md` (D25+) +
> `docs/design/` when we do a write-up pass.

- **Q1 — Mode × guild: ONE SHARED persistent guild.** Campaign and Endless are two
  *content feeds* into a single guild (one roster, one armory, one progression).
  Max reuse; accepted tradeoff = story-earned and sandbox-earned progress share a
  save (revisit cosmetic separation only if it feels muddy).
- **Q2 — Parallel adventures: model C (sequential play, shared standing state)** +
  a renewable quest board + dispatched caravans **wait**.
  - **Commitment is parallel, play is serial:** commit people + gear across several
    caravans at once (the lock = the portfolio cost), but play one caravan through at
    a time; the guild clock advances between dispatches. Every fight stays
    hand-played. Clear path to graduate toward an interleaved clock (model A) later.
  - **Quest board (the "one shared guild, two feeds" made concrete):** **main quest**
    (campaign spine, arc + ending) → **authored sidequests** (finite hand-made pool)
    → **repeating generated sidequests** (the infinite tail = "endless," integrated).
    The board is never empty, so idle caravans always have somewhere to go.
  - **Parallelism is asymmetric:** one main thrust + a renewable side-content stream
    (Darkest Dungeon / Three Houses shape), not symmetric juggling.
  - **Dispatched-but-unplayed caravans WAIT** (paused at their node) rather than
    ticking a clock or auto-resolving (auto-resolve is rejected — it dilutes the
    hand-played tactical core, the crown jewel).
- **Q3 — A caravan = persistent, typed, upgradeable vessel + uniform slots.**
  - You **own/acquire a stable of caravans** (need ≥2 for multiple-at-once), each a
    persistent upgradeable asset on a tradeoff axis: *small/fast/cheap/low-capacity*
    (scout cart, short sidequests) ↔ *large/slow/costly/high-capacity* (supply train,
    deep main-quest hauls). Pick the right vessel per quest. The Merchant raising
    storage (D14) becomes "upgrade a caravan's capacity."
  - A caravan bundles: **party slots + storage (D14 cap) + loaded supplies + locked
    equipment** (unavailable to other caravans until it returns). Thematically it
    doubles as the **overworld camp** (the mobile campfire the overworld is drawn as).
  - **Slots are UNIFORM** (any character fits any slot) so bringing a baker genuinely
    costs a warrior — caravan *size* is the only dial. (Role-segmented slots rejected:
    they'd make support picks "free" and kill the tension.)
- **Q4 — Unkillable guild + Fire-Emblem "lords."**
  - The guild **never hard-fails**: there's always a cheap repeating sidequest to
    rebuild, so stakes come from permanent **losses**, not a fail screen. (Two loss
    tiers already exist: *mission loss* per node (D13/D21) and *caravan wipe* =
    lose that caravan's people (permadeath) + its locked gear, guild survives.)
  - **EXCEPT 2–3 named campaign "lords"** (à la Fire Emblem): if a lord dies during
    the campaign it's **game-over → reload last save**. An optional **hardcore/ironman**
    mode makes even that permanent. ⇒ implies a **save system** for the campaign
    (ironman = no reload).
  - **Tension this buys:** a lord in a caravan that wipes = game-over, so risking a
    lord on a deep node is a real gamble.
  - **Endings (answers the M7-deferred terminal-design):** campaign-complete = clear
    the **main quest** (epilogue + unlocks that seed Endless); campaign-defeat = a
    **lord falls**; **Endless = depth/score, no terminal**, no lords.
- **Q5 — Travel/rest paid in GOLD; D15 stands (no physical rations).** Food stays a
  gold Upkeep line; no carried larder, no spoilage. ⇒ **gold = universal solvent**:
  travel, rest, provisioning, gear, bribes, debt all draw one pool, so the map is an
  **economic** routing problem ("can I afford this route + a rest?"). Caravan storage
  still gates **gear/ammo/consumables** (D14/D20), just not food. **Consequence:** the
  faucet/sink balance (Q7) matters *more* — a slack economy trivializes the map.
- **Q6 — Overworld is a data-driven hook surface (extends D3); abilities declare
  their own limiter from a small menu.** "Ability" is general — different overworld
  abilities use different costs:
  - **Fatigue / exhaustion (NEW, per-character)** — e.g. the Merchant *can* hike to
    town but not night-over-night; a single **shared per-character** stamina meter that
    overworld actions spend and **rest restores** (gives rest a 2nd job; fits the
    caravan-as-people fantasy). Keep it one meter, not per-ability.
  - **Vancian charges** — **spells with overworld effects** (scry for intel, travel/
    forage) spend castings from the D17 pool. Magic unified across tiers.
  - **Node-refresh / gold cost / step-cooldown** — for whatever fits.
  - Principle: ability = data declaring **phase + cost** (D3/D4). Keep the limiter
    menu short (D15 "low meter count" restraint).
- **Q7 — Active theft vector (the sink-side partner to the gold faucets).** Pilfering
  is a real risk: **thief/bandit event nodes** skim gold on the overworld AND a
  **gold/item-stealing enemy archetype** mid-battle. Makes the **Banker** a real pick
  (protect/debt/interest in a live faucet↔risk loop). Cost = thief enemy + theft
  events to build (fits the planned event-node batch).
- **Q8 — One distinct verb per economy class; Noble income = POLITICAL.**
  - **Merchant = ACCESS** (markets in the field: basic anywhere via the fatigue-gated
    town-trip, premium at town nodes, better prices everywhere).
  - **Banker = TIME-SHIFT + SECURE** (buy-on-debt auto-repaid from future gold,
    passive *financial* interest, theft protection).
  - **Noble = INFLUENCE** (bribe enemies to turncoat / sway-avoid fights, leaning on
    the intel preview) **+ *political* income** (patronage, town levies, stipend,
    reputation) — deliberately distinct from Banker's *financial* interest so the two
    aren't redundant faucets.
- **Q9 — Support classes: ALWAYS on the combat map + a defendable supply wagon.**
  - The caravan's **supplies are an on-map asset** (wagon/camp object = a **D4 field
    entity** with position/state) that can be attacked and defended — and it's the
    **in-combat target of the Q7 thief archetype** ("protect your investment" becomes
    a concrete *defend-the-wagon* objective, not a vague escort).
  - **Support units deploy far back near the wagon, low enemy-targeting priority by
    default** → not a constant babysit; the escort tension only spikes on a real
    threat. **Positional abilities:** strong in their home zone, weak if dragged out
    (e.g. **Chef by the campfire = bonus damage / hot-pan attack**). Campfire literally
    on the battle map = title callback + ties to the overworld-camp visual.
  - **Rule to pin:** enemy AI **deprioritizes** non-combat units + the wagon **except
    the thief archetype**, which actively seeks the supplies — that exception *is* the
    bodyguard gameplay.
- **Q10 — Secondary classes = FFT-style; non-combat levels passively+on-use.**
  - **FFT job model:** one active **primary** (defines stats/growth) + a **slotted
    subset** of a secondary class's abilities, re-arranged at the guild. More
    balance-controllable than simultaneous dual-class (a weaker slot-saver, accepted).
  - **Leveling:** secondary abilities level through **use** (slower — primary is mostly
    active). **Non-combat jobs** level via a **passive trickle WHILE DEPLOYED + a bump
    per successful ability use** (benched = no growth); combat jobs via combat XP.
    ("Level the secondary by using it" and "non-combat use-bonus" are one mechanism.)

## North-star framing (emerging)

- **Run model:** a **designed campaign** *and* an **endless mode**. Both ride the
  same `OverworldMap` data model — endless = `generateOverworld(seed)` (what
  exists); campaign = the **same node/edge model, hand-authored**. The machinery
  underneath (combat/rest nodes, the phase loop) doesn't care which way the map
  was born. Open: what each mode's progression + endings *mean*.

- **The core gap M7 left:** the map borrowed STS's *shape* without STS's *engine*.
  In STS the map means something because every fight feeds the deck and **HP is the
  currency you spend to route**. Campfire has no deck — its equivalent of "deck
  getting stronger" is **roster + stores + gear condition** = **logistics**. So the
  overworld's routing currency should be **supply** (rations/gold/upkeep), making
  the map a campaign-scale logistics-planning problem instead of a difficulty menu.
  This is the headline pillar promoted from per-night provisioning to strategy.

- **Symptom the engine fixes:** today rest is near-pure upside and difficulty ramps
  with depth, so the optimal play is "dodge every fight." Giving rest/travel a
  **supply cost** restores the pull of fights and makes branching a real choice.

---

## The three-tier stack (proposed)

A new **guild-hall** tier on top resolves the old camp/rest/start-node muddle by
giving "home" one clear owner.

```
GUILD HALL    ← persistent home, BETWEEN adventures. Roster pool, armory,
   │            caravan assembly, multiple expeditions in flight.  (NEW)
   ▼
OVERWORLD     ← ONE caravan's adventure: route the layered DAG (what M7 built,
   │            now scoped to a caravan). UI idea: render it as a small camp.
   ▼
CAMP / MISSION ← one node: Camp -> Deployment -> Battle -> Resolution (D3).
```

---

## Guild hall + caravans (the strategic logistics engine)

- **Guild hall**: persistent home base; where the player assembles expeditions.
- **Caravan** = the expedition unit: **party slots + supply/storage vessel + locked
  equipment + supplies**. A natural home for the D14 storage cap (small fast caravan
  carries less; big supply train carries more, slower/costlier).
- **Multiple adventures at once**: spread a *finite* roster + armory across parallel
  risks — a risk-portfolio game ("don't put all your best people/gear in one
  caravan").
- **Three scarcities, all on-theme:**
  - **Slots** — the baker-vs-warrior tension; gives every non-combat job a real
    opportunity cost (today you'd always bring the Chef).
  - **The caravan vessel** — carries the storage cap; "which wagon did I bring."
  - **Locked equipment** — gear lives at the guild, is committed to a caravan, and is
    unavailable until it returns. Can't put your one good sword in two parties.
- **Reframes terminals (answers the deferred "what does a wipe mean"):** a wipe =
  lose *that caravan* (its people + locked gear), **not** game-over. The guild
  persists (Darkest Dungeon / Battle Brothers stakes). Game-over becomes a
  guild-level state (broke / no people).

### Biggest open fork — time model for parallel adventures
The M7 overworld is a **synchronous** node-by-node loop; "multiple at once" forces a
time model. (`run.ts` currently holds exactly one map+position; parallel needs a
`Guild` owning N run states.)
1. **Global guild clock (interleaved)** — advance the guild a "week"; each active
   caravan takes one step; bounce between them. Most strategic, most state/UI work.
2. **Focus one, background the rest** — play one run through; others auto-resolve /
   progress abstractly. Lighter, leans idle/management-sim.
3. **Sequential w/ shared standing state** — "at once" = committed simultaneously
   (people/gear locked across all), but played one at a time before time advances.
   Simplest on top of what exists.

---

## The overworld-economy tier of the class system

**Throughline:** each class earns its caravan slot by acting on a *different tier*.
D3 already does this by mission *phase* (Chef=camp, Survivalist=deployment, ...). The
new frontier is the **overworld tier**, and these class ideas all operate on one
currency — **gold/economy**. So: combat = where tactical class abilities live; the
overworld = where economic class abilities live. Both are hook surfaces.

**New architectural concept to eventually pin as a decision:** the **overworld is a
hook surface with its own action economy, denominated in node-steps (cooldowns).**
This is a *second* action economy alongside the combat CT clock.

### One distinct verb per class (cut redundant gold-givers)
- **Merchant = access** — buy gear in the field; basic anywhere on a cooldown,
  premium/special in towns; better prices in any town. (In-field buys use *run
  gold* — a flow — distinct from the *guild armory* — the locked stock. Keep
  separate.)
- **Banker = leverage** — passive interest, **buy-on-debt** (auto-paid from next
  gold), and **theft protection** (vs. pilfer events/enemies).
- **Noble = influence** — **bribe enemies to turncoat** (a gold *sink* + tactical
  lever; leans on the intel preview to know whom to bribe). NOTE: the proposed
  passive "gold in town" overlaps Merchant/Banker as yet-another-faucet — candidate
  to **cut/shrink** so bribe/diplomacy is the Noble's whole identity.

### Economy discipline — pair every faucet with a sink (else gold goes slack)
Three ideas above are gold **faucets** (Noble income, Banker interest, Merchant
discounts). Too many faucets and gold stops being scarce → **Upkeep (D15), the
central pressure, stops mattering.** Pair them:
- Banker interest (faucet) <-> buy-on-debt interest (sink) + **a thief/pilfer threat
  vector** the Banker defends against. **TO ADD:** that pilfer threat — without it,
  "protects your gold" guards against nothing.
- Noble income (faucet) <-> bribe-to-turncoat (sink).

### Support classes as units on the combat map
Field non-combat jobs as **fragile bodies** — possible backup, but more likely **a
resource to protect**. Makes the baker-vs-warrior choice bite twice (a caravan slot
**and** a liability on the field) and creates protect-your-investment play.
- **Trap to dodge:** escort gameplay is famously tedious (the FE "keep the green unit
  alive" groan).
- **Mitigation:** support units deploy at the **back edge, low-risk unless the line
  breaks**; fielding them is **opt-in** (bring them for the ability + accept the
  burden, or leave them safe in the caravan and forgo it). Their death = losing the
  guild-level investment (person + locked gear) = the intended stakes.

---

## Brain-dump items (2026-06-06) — captured, not yet sorted

- **Secondary classes** — a character can take a 2nd class; **levels slower** (split
  XP) as the cost of versatility. Plugs into the slot economy: a 2-class character is
  more flexible per slot.
- **Non-combat classes level passively**, with boosts for *successful* ability uses.
  Answers "how does a baker level without fighting." *Watch:* gate growth to being
  **on an adventure**, not sitting in the guild, so benching isn't free training.
- **Rest-in-place for longer recovery, costing rations.** The **opportunity cost of
  rest** — likely **load-bearing**, not a nice-to-have: makes recovery a *spend* (no
  full heal between every fight) and confirms **rations/supply as the routing
  currency**.
- **Overworld rendered as a small interactable camp** (talk to party members). Hits
  the literal title — *Campfire* Tactics; the campfire between battles *is* the
  overworld. *Watch:* keep it visually distinct from the **guild hall** (two camps,
  two meanings).
- **Overworld ability bars** to take overworld skill actions. The concrete UI for the
  overworld-as-hook-surface + step-cooldown model above.

**Convergence note:** the dump keeps reinforcing the same two pillars — **supply/
rations as the strategic currency** and **the overworld as its own action tier** —
rather than scattering.

---

## Round 2 — resolved (design session, 2026-06-06)

> **Status: GRADUATED (2026-06-06).** Q11–Q16 below are promoted to formal decisions
> **D33** (recruitment / three-tier roster), **D34** (two pools + purse + Influence),
> **D35** (the overworld action economy) in [`decisions.md`](decisions.md) and written
> into the specs ([`guild.md`](../../docs/design/systems/guild.md),
> [`logistics.md`](../../docs/design/systems/logistics.md),
> [`overworld.md`](../../docs/design/systems/overworld.md),
> [`stats.md`](../../docs/design/systems/stats.md)). Kept below as the reasoning trail.
> **Deferred:** the authored-cast *data shape* (D33) — mechanics-dependent.

- **Q11 — Recruitment: a THREE-TIER roster (the BG3 split).** "Where do party members
  come from?" resolves into two sources feeding three tiers, not one flat pool.
  - **Q11a — Both sources.** Members come from *both* a paid pool **and** narrative/
    other means — not either/or.
  - **Q11b — A mix of randomized mercenaries + an authored cast.**
    - **Tier 1 — Mercenaries:** *randomized*, **gold-hired** from a **refreshing pool**
      (guild hall + future recruiter nodes, D23 next batch). Fully **expendable** — the
      literal **rebuild-after-wipe valve** that keeps the guild unkillable (D27).
    - **Tier 2 — Companions:** *authored*, **named, distinct identities**, gained **not
      with gold** but through **guild conversation, special quests, and mid-combat**
      (Q11c). Permadeath stakes, but **earned rather than bought**.
    - **Tier 3 — Lords:** the **top of the authored tier** — the **2–3** whose death is
      game-over (D27). So "authored cast" is a **spectrum**: lords (game-over) → other
      named companions (permadeath, not game-over) → mercenaries (expendable, rolled).
  - **Settled corollaries (stated, not separately asked):**
    - **Authored = fixed class/identity** (that's what makes them authored); they still
      **level like anyone** (D32). **Mercenaries are the rolled ones** (randomized
      stats/class). One clean split: rolled filler vs. hand-made identity.
    - **"Guild conversation" = the guild-hall version of the interactable-camp idea**
      (the brain-dump "render overworld as a small interactable camp"): you recruit some
      companions by **talking to them at the hall**, giving that screen a real second job
      beyond menus. *Watch:* keep the two camps visually distinct (guild hall vs. the
      overworld caravan-camp).
  - **Q11c — Mid-combat recruitment REUSES the turncoat/rescue machinery; authored =
    permanent join, generic = temporary.** The most interesting piece because it adds a
    recruitment vector with **zero new systems**:
    - A **bribed** (Noble INFLUENCE, D30) or **freed** (rescue, D21) **named/authored**
      character **joins the roster permanently** after the battle.
    - A bribed **generic** enemy just **fights for the rest of the fight** (temporary) and
      is gone at battle's end — **no roster bloat**.
    - So the Noble's bribe verb (D30) and the rescue system (D21) **double as recruitment
      vectors** for the authored cast — exactly the system-reuse this project favours. The
      **temp(generic) ↔ permanent(authored)** flag is the whole new rule.
  - **Integrations this locks in:** the authored cast threads through the bribe-to-turncoat
    sink (D30), the rescue/capture machinery (D9/D21 — free a captive who then joins), the
    lords (D27, the apex of the authored tier), the leveling model (D32, authored level too),
    and the interactable-camp idea (recruit-by-conversation at the hall). Recruitment isn't a
    new subsystem so much as a **new flag on existing ones**.
  - **Cost / what to build:** a roster **tier/origin tag** (mercenary vs. authored vs. lord);
    a **refreshing mercenary pool** (rolled, gold-priced) at the guild; an **authored-cast
    data set** with recruit hooks (conversation / quest-reward / combat-defector); a
    **"joins permanently" flag** on the turncoat + rescue paths; recruit-by-talk at the hall.

- **Q12–Q14 — The gold economy as explicit loops (the highest-risk round-1 thread).**
  With gold as the universal solvent (D28), the economy classes risked being three
  flavours of "gives gold," and faucets without sinks make Upkeep (D15) toothless.
  Resolved into a **two-pool structure + a purse stake + purpose-bound currencies**.
  - **Q12 — TWO pools: a run purse + a guild treasury.** (Settles what D30 only
    gestured at.)
    - **Guild treasury** = persistent **stock**; the bank that funds Upkeep (D15)
      between runs, the armory, and caravan upgrades.
    - **Run purse** = a **flow** committed to one caravan; the tight, local **routing
      currency** spent in the field. ⇒ run = tight local pressure; guild = persistent
      wealth. Matches D30's "run gold is a flow" and the portfolio fantasy (D25/D26).
    - **Where each flow lands (mostly mechanical):** **loot → purse** (won in the
      field); **quest payouts → treasury** (paid at the guild); **travel / rest /
      field-buys / bribes → drawn from the purse**; **Upkeep → drawn from the treasury**
      between runs. (See the **Q14 clarification** below: no *passive* gold faucet feeds
      the treasury — quest payouts are its only inflow.)
    - (Rejected: one shared pool — a rich guild trivializes any single run, and you lose
      the "provision the caravan with money" commitment. Also rejected: one pool with
      field access gated by class verbs — clever but more complex to reason about.)
  - **Q13 — Player-chosen purse, LOST ON WIPE.** At dispatch the player **allocates how
    much treasury gold to load** into the caravan's purse — a real risk dial (more for
    deep hauls / field-buys, but a **wipe loses it** like the people and locked gear,
    D27). **Surviving purse returns to the treasury** on completion. ⇒ the purse becomes
    a **FOURTH committed scarcity** (slots / vessel / locked gear / **purse**), extending
    D25's three. Gives theft real teeth: gold skimmed off the purse is gold you might
    then lose entirely on a wipe — the thief vector bites twice.
    (Rejected: auto-provisioned purse — less commitment texture. Purse-as-view, no
    wipe-loss — weakest stakes, kills the war-chest gamble.)
  - **Q14 — Purpose-bound currencies keep passive faucets from trivializing Upkeep.**
    The make-or-break discipline (D28/D30 flagged it):
    - **Noble political income → a separate INFLUENCE / reputation resource**, spent
      **only** on the Noble's verbs (bribes, sway-avoid, access). It **literally cannot
      pay Upkeep**, so it can never slacken the central pressure. **Sharpens D30:**
      "political income" is no longer gold-flavoured — Influence *is* the Noble's whole
      economy (the patronage/reputation line of D30, made a currency).
    - **Banker financial interest stays gold** but is **flat / diminishing AND offset by
      its paired debt-interest sink** — self-balancing. **(Clarified below: it accrues on
      the PURSE during a run, not the treasury.)**
    - **Net principle — the field is the faucet, the guild is the buffer:** the only real
      path to wealth is **loot + quest payouts**, gated by the hand-played tactical core
      (the crown jewel). Passive income *smooths*, it can't *replace* winning fights — so
      progress stays tied to the part of the game that matters.
    - (Rejected: percentage faucets + scaling sinks — "running to stand still." Flat
      capped gold faucets — risk feeling vestigial late.)
    - **Discipline watch:** Influence is **one new currency**, which brushes D15's
      low-meter-count restraint — accepted because it *retires* a gold faucet rather than
      adding one, and it gives the Noble a distinct identity. (Influence = the
      "reputation" already named in D30 — one thing, not two.)
  - **Q14 clarification (2026-06-06) — the Banker is an OVERWORLD actor; the treasury is
    a vault.** The Banker's kit **fires only in the overworld**, all scoped to the
    **purse**: interest accrues on the carried purse, buy-on-debt repays from incoming
    **run** gold, theft protection guards the purse (the thief vector also hits the
    purse). Faucet *and* sink both live on the purse, in the field — fully self-contained,
    and exactly the D29 hook-surface pattern (the Banker acts on the overworld, like the
    Merchant's field markets). The **guild treasury is a pure vault** — fluff: it has its
    own **"treasurer"** who simply holds the money between runs; the Banker doesn't touch
    it. **Consequence (the model tightens):** with the Banker off the treasury and the
    Noble's income now **Influence** (not gold), **NO passive gold faucet feeds the
    treasury** — its **only** inflow is **earned quest payouts**. This is the strongest
    form of *"the field is the faucet, the guild is the buffer"*: the treasury literally
    cannot grow except by completing field work. Does **not** overturn Q14 — it sharpens
    it.
  - **The explicit loops this yields (each faucet paired to a sink):**
    1. **Banker loop (PURSE-scoped, overworld):** interest on the carried purse
       (faucet, flat/diminishing) ↔ buy-on-debt interest + theft protection (sinks/risk).
       Self-balancing, entirely within a run.
    2. **Noble loop:** political income → **Influence** (faucet) ↔ bribes / sway-avoid /
       access (Influence sinks). Walled off from gold entirely.
    3. **Thief loop (the sink-side risk):** thief event-nodes skim the **purse** + a
       thief enemy steals mid-battle ↔ Banker protection + **recover-on-win**. Derived
       corollary (consistent with D13/D21 "win = control of field = recover"): **kill the
       thief → it drops what it stole; a thief that escapes off the map keeps it** — a
       "chase the thief" tension, not a flat loss.
    4. **Field-as-engine:** loot → purse, quest payouts → treasury — the tactical core is
       the genuine faucet.
  - **Cost / what to build:** a **treasury↔purse** split in run/guild state; a
    **dispatch-time purse allocation** UI + wipe/return reconciliation; an **Influence**
    currency + the Noble's Influence-spending verbs; the **thief event-node + enemy
    archetype** with steal + recover-on-win/escape-keeps-it (the D30/D23 event batch).

- **Q15–Q16 — The overworld action economy (the structural twin of the combat CT
  clock; the last load-bearing overworld system).** D29 pinned that the overworld is a
  second hook surface denominated in node-steps/cooldowns, with a limiter menu (fatigue
  / vancian / cooldown / gold) — but not *where* actions happen or *what paces* them.
  - **Q15 — Camp at EVERY node: one unified between-nodes surface.** Arriving at any
    node opens a between-nodes **overworld camp** (the "interactable camp" / title
    callback): take overworld actions there, then choose the next edge. **The node-step
    is the tick** (the caravan advances node→node together). This **collapses three
    surfaces into one** — the old overworld map screen (D23/D24), the interactable-camp
    brain-dump, and the pre-combat **Meta phase** (D3/D23) are now the *same* surface.
    - **Resolves the three-camp muddle** down to **two clean tiers:** the **guild hall**
      (between *adventures*, D25) and the **overworld camp** (between *nodes*). Every node
      is a campfire.
    - **The Meta phase stops being a separate screen** — it becomes "the camp actions you
      take at a **combat** node before you commit to the fight"; committing triggers
      Deployment+Battle. A **rest** node is simply the node themed on recovery (D23).
    - (Rejected: keeping D23's travel-screen/camp-phase split — more surfaces to build.
      Rejected: a per-node Action-Point budget — heavier rules layer; see Q16.)
  - **Q16 — Cooldowns are the spine; Fatigue is a loose over-extension guardrail.**
    Resolved in two beats with a design principle in the middle:
    - **The principle (why this split):** **cooldowns encourage engagement, depleting
      pools punish it.** A node-step **cooldown** is use-it-or-waste-it — if it's up you
      fire it, so the only decision is **timing** ("burn market access here, or hold it
      for the cheaper town two nodes deeper?"). A tight hoardable **stamina pool** does
      the opposite: players hoard, under-use the fun abilities, and the "interesting
      choice" curdles into an **agonized spreadsheet** (the classic stamina-meter
      failure). The player flagged exactly this risk.
    - **Cooldowns = the spine (a definite yes).** Each overworld ability carries its own
      **node-step cooldown** (market, scout, scry, …) → makes every ability *non-trivial
      to time* **even when you have the specialist** (a Merchant doesn't get to market
      every node). Timing is the core texture, and it *encourages* use.
    - **Fatigue = a LOOSE guardrail, not a tight pool.** Kept, but in this codebase's
      existing **shallow asymmetric-floor** shape (D7/D11 deployment overdraw; D8 morale's
      "never kick a player when down"): a **generous per-character allowance that's
      invisible in normal play and only bites when you greedily skip rest and
      over-extend** night after night. Keeps the over-extension *stake* **and** rest's
      second job (D29) **without** the per-camp agony. The interesting choice surfaces
      only when you're genuinely pushing your luck — which is exactly when you want one.
    - **Restored at rest nodes** (rest's D29 job). **Overworld-only** — fatigue does
      **not** bleed into combat readiness (D29 two-economies separation; a tired character
      isn't combat-penalized).
    - **Vancian charges + gold (purse)** remain from the D29 menu as **per-ability costs**
      on specific abilities (a scry spends a casting; a town-buy spends purse gold), layered
      on top of the cooldown spine — not the global pace.
    - (Rejected: cooldowns-only/no-fatigue — loses the over-extension tension + a rest job.
      Rejected: cooldowns + a tight rationed fatigue pool — the agony version the player
      explicitly warned against.)
  - **The overworld tier, assembled:** **tick** = node-step; **surface** = one unified
    overworld camp at every node (guild hall stays separate); **spine** = per-ability
    node-step cooldowns (timing is the texture); **guardrail** = a loose, asymmetric-floor
    fatigue meter against greed, restored by rest; **per-ability costs** = vancian/gold
    where they fit. A genuine twin to the combat CT clock (D5), one tier up.
  - **Reusable principle to record:** *cooldowns to encourage engagement (decision =
    timing); avoid tight hoardable pools that punish use — when a depleting meter is
    wanted, give it the shallow asymmetric-floor shape (generous allowance, bites only on
    greed)* — now applied three times (D7/D11, D8, fatigue).
  - **Cost / what to build:** node-step **cooldown** tracking per overworld ability; the
    unified **overworld-camp surface** (folding the Meta phase in); a per-character
    **fatigue** meter with an asymmetric-floor curve + rest restoration; wiring vancian/
    gold as per-ability costs.

## Round 3 — resolved (design session, 2026-06-15)

> **Status: GRADUATED (2026-06-15).** Q17–Q20 below are promoted to formal decisions
> **D45** (the overworld economic ledger), **D46** (the node lifecycle / phase contract),
> **D47** (the two-tier recovery economy) and **D48** (the route forecast + overworld fog) in
> [`decisions.md`](decisions.md). Kept here as the reasoning trail. **Deferred:** the spec
> write-ups in [`overworld.md`](../../docs/design/systems/overworld.md) (next doc pass), the
> reach-fog numbers, and the fee event-kind data shape.

- **Q17 — An overworld economic ledger: the readout the routing pillar (D28) always
  implied.** The map is an *economic* routing problem ("can I afford this route + a rest?",
  D28) with gold kept scarce on purpose (D30/D34) — but the budget that *is* the decision
  was invisible. Resolved into a **projection, progressively disclosed, with a soft
  night-end gate**.
  - **Q17a — Scope: purse, not treasury.** A ledger on the **overworld camp** (D35) reports
    the **run purse** flow only — loot in; upkeep / field-buys / bribes / theft out; the
    Banker's interest/debt/protection. The **treasury** stays the guild hall's concern
    (the D34 pool wall), and **Influence is shown but never summed into gold** (it can't pay
    Upkeep — D34). It's a **pure projection of existing state** — the `previewNode` / camp-
    readout pattern, no new model: `computeUpkeep()` already returns `{lines, total}`, loot
    credits return `{credited, debtRepaid}`, Banker state is on `run.overworld`, and
    `refreshCampText` already renders the one-line version this promotes to a panel.
  - **Q17b — Broad categories, expand for crunch.** Default = a few category totals
    (Upkeep / Loot / Field spend / Banker / balance); expand to the line items
    (`UpkeepBill.lines`, individual loot/spend events). Crunch is opt-in so the default
    stays a glance — the "show me just the broad strokes, let me dig if I want" ask.
  - **Q17c — Receipt *and* forecast; the forecast is the point.** A backward receipt is
    table stakes; the load-bearing feature is the **forward projection** — *"this route +
    a rest at the end → here's your purse at the bottom"* — reading the reachable nodes'
    rest/upkeep costs. That's what makes the ledger the **D28 routing decision surface**
    rather than a receipt. (Receipt ships first; forecast is the reason to build it.)
  - **Q17d — Jump-to-market when available.** A button straight into the Merchant/shop
    verbs **when usable** (town/rest node · Merchant present · off cooldown), reusing the
    `available`-gated event-choice + `merchantBuy` paths — so the player can size a buy
    against the budget *before* committing (the "get a sense of my budget before we buy"
    ask).
  - **Q17e — Two forks, resolved (the careful bit):**
    - **Fork 1 — how hard to force it?** A mandatory full-screen modal every single night
      is exactly the **agonized spreadsheet** D35/D16 designed against — by layer 5 it's a
      click-through chore. **Resolved:** the ledger is **always one glance away**, the
      advance shows the bottom-line delta inline, and it **hard-gates a forced look only
      when warranted** — projected shortfall, can't-afford-the-rest-at-route's-end,
      outstanding debt, or an underfunded upkeep line. Happy path = one click. Same
      **asymmetric-floor** instinct as fatigue/morale/overdraw (D7/D8/D11/D35): the forced
      choice surfaces only when you're genuinely pushing your luck.
    - **Fork 2 — "End the Night" vs the existing Commit.** "The night ends" describes a
      **rest/event/travel** advance cleanly, but a **combat** commit *begins a fight* (the
      night erupts, it doesn't end). **Resolved:** at a combat node the ledger is a
      **pre-commit glance** ("Commit — Begin Mission" stays); the formal night-end
      **reconciliation** (closing balance + the gate) rides the existing **`recordNight`
      seam** — the "a night passed" boundary where `tickCooldowns` / `accruePurseInterest`
      already fire — i.e. on returning to choose the next edge. One seam, no new clock.
  - **Q17f — Voluntary underfunding: the ledger as an *input* (extends D15).** Let the
    player **untick a line they could afford** to free its gold for a riskier play — the
    headline case: **skip Food (−morale) to buy a powerful morale buff** that nets the day
    *positive* morale. This is just **D15's "(the choice)" made literal** — `payUpkeep`
    already underfunds lines + applies the morale hit / worn-gear, but only as a *broke-only
    fallback*; this exposes it as a deliberate toggle. Riders: (1) **the forecast must show
    the net** so the gamble is informed (the D45 forecast doing double duty); (2) **the soft
    gate keys off intent** — don't nag a *voluntary* skip (you meant it), only a can't-afford
    one; (3) **food vs repairs are different risks** — Food = immediate recoverable morale,
    **Repairs = compounding gear-condition debt** paid on the field (surface distinctly); (4)
    **tuning watch** — give the skip real teeth (bite the D8 morale floor / compound on
    repeats) or skip-Food is free arbitrage and the D15 upkeep sink stops biting. *Promoted
    to D45 as an extension; classified an **adjustment**, not a pivot (it sharpens D15/D45,
    supersedes nothing).*
  - **Cost / what to build:** a ledger **projection** over `run` (categorize purse
    in/out + a forecast over `reachableFrom`); a camp **panel** with collapse/expand and the
    always-available button; the **soft night-end gate** on the advance (the conditional
    hard-stop, intent-aware per Q17f); **voluntary-skip** plumbing in `payUpkeep` (pass
    skipped line ids vs. deriving from affordability); the **jump-to-market** shortcut reusing
    existing verbs. Mostly UI + aggregation — the one model touch is the voluntary-skip seam.

- **Q18 — The node lifecycle / phase contract (→ D46).** The per-node sequence was never
  pinned, and "rest" kept colliding with itself. Resolved to **one node = one node-step**
  with a kind-agnostic shape: **Make Camp** (pre-event prep; ledger *reconcile*) → **End the
  Night** (gate; the node's event fires by kind — combat = Deploy→Battle→Resolve, rest =
  recovery payload, event = choice) → **Survey** (new *post-event* beat: now-informed intel /
  in-place rest / ledger *forecast*; light & mostly optional) → **Break Camp** (depart; the
  **`recordNight` tick fires here, at departure**, so one night's allowance is timed across
  the visit). Terminology: *End the Night* = prep→event, *Break Camp* = depart→next (the word
  fits departure); never "rest" for a gate. **Where rest fits:** the "rest or push on" choice
  lives on the **map (routing to a rest node)**, not a camp toggle — the only in-camp recovery
  is Q19's in-place rest. *The forecast wants post-event numbers → it belongs in Survey, after
  the fight.*

- **Q19 — The two-tier recovery economy (→ D47).** Promotes the parked *"rest-in-place costing
  rations"* idea without dissolving rest nodes. **In-place rest** (repeatable camp action, the
  Survey beat): pay a night's rations → bank RP (support classes boost it via `rpPerNight` —
  the class-boost is already in code) → small `triageHeal`; repeatable until the purse taps
  out. **Each rest is a full node-step → it ticks cooldowns + accrues interest** — the player
  *chose* to buy HP **and** cooldown progress with a night's rations (a fun lever, not a leak).
  **Two caps:** gold (afford another night?) + the per-night **RP rate** (rate-limits healing
  regardless of wealth → keeps the rest node faster). **Rest node = premium:** large/full heal
  **+ full fatigue restore (stays rest-node-only, D35) + clears accumulated debts in one
  swipe** (hunger / under-maintenance / worn gear from D45 underfunding) instead of buying
  something high-quality. **Heal floors at ≥1** on a wounded party (never "paid, healed 0" =
  looks like a bug); **refuses when already full** (no empty drain). Lives or dies on **gold
  scarcity** (D30/D34) — a known balance burden, accepted. Big reuse story: built on
  `payUpkeep` + `rpPerNight` + `triageHeal` — almost no new core.

- **Q20 — The route forecast (→ D48).** D45 named a forecast but left *what it computes*
  fuzzy; grounding it in the data settled the shape. Governing fact: **cost is knowable,
  income is fogged** (upkeep exact; loot only ever banded by intel tier). Worked through
  call-by-call into four pillars:
  - **Reach = overworld fog scaled by intel (new).** Intel governs whether you see the route
    at all: `baseReach + tier × bandStep`, **base ≈ half the map** (deep-planning tool, not an
    early wall), tunable to effectively infinite (the fallback). Immediate choices **always
    visible**; pure visibility mask (BFS cut), determinism intact. Adds the **reach** axis
    alongside the existing **depth** axis (D10 tiers). *Consequence (intended): the
    nearest-rest/runway becomes intel-gated too — seeing the third rest ahead is what intel
    buys.* (Earlier the runway was called "fog-free" via always-visible kinds; the reach fog
    deliberately overrides that to make intel load-bearing for planning.)
  - **Burn = upkeep + visible node fees.** Upkeep **is** the travel cost (no separate line —
    D28 satisfied). Special nodes carry a **visible, known fee** (toll / town tax / gate fee)
    — a "thief that tells you the price up front," reusing the M11 event system —
    **avoidable by routing**. The deterministic cost backbone = `upkeep × steps + visible
    fees`.
  - **Loot = fogged range, tightened by intel** (never beyond the player's tier — no
    fog-leak).
  - **Warning = against the floor; show the range; intel clears warnings.** The gate evaluates
    on the **pessimistic** band (never false-reassures), the panel shows the full range; a
    tighter intel band **raises the known floor**, so **scouting can clear a warning** — intel
    *relaxes* warnings, not just reveals. Fits the asymmetric-floor ethos (D8/D11/D35).
  - **Horizon:** one banded step + runway to the nearest *visible* rest (not whole-map).
  - **Seam:** a pure `projectForecast(run)` over the visible set, reusing `computeUpkeep` +
    `rewardHint` + the visibility BFS — the `previewNode` pattern one tier up.
  - **Open:** reach numbers (base/bandStep); does **Scout** extend reach or only depth (lean:
    reach from passive Int + Seer, Scout deepens); the **fee event-kind** data shape
    (cost / pay-or-fight — folds into the deferred event batch).

## Suggested next threads to harden (when ready)
1. **Time model for parallel adventures** (the fork that reshapes existing code).
2. **The gold faucet/sink economy** as explicit loops (so Banker/Noble/thief get
   teeth) — incl. adding the pilfer threat vector.
3. **The overworld hook + step-cooldown action economy** (the spine the ability bars
   plug into).
4. **Supply/rations as routing currency** (rest cost, travel cost) — the engine that
   makes branching a real choice.
