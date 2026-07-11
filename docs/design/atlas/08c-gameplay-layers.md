# 08c · Combat gameplay layers

The *gameplay* systems inside a fight and how they stack — from the player-facing preview at the
top down to the engine at the bottom. Unlike a strict dependency stack, combat has a **spine**: the
**trigger bus** is the hub everything talks through, and the **CT clock** is the timeline everything
schedules on. Read the arrows, not just the layers.

```mermaid
%%{init: {'theme':'base','themeVariables':{'fontSize':'17px','fontFamily':'ui-sans-serif, system-ui, sans-serif'},'flowchart':{'nodeSpacing':45,'rankSpacing':52,'padding':16}}}%%
flowchart TB
  TELE["① TELEGRAPH &amp; FORECAST — preview before commit<br/>an armed ability's footprint (arc / push / aura) + its forecasted outcome"]:::soft
  ACT["② ACTIONS — a unit's turn = Move + Act<br/>Instant (resolves now) · Charged (schedules for later)"]:::soft
  BUS["③ TRIGGER BUS — event-bus.ts · THE SPINE<br/>announces moments: unitEnterTile · turnStart · unitDamaged ·<br/>chargeResolved · unitRescued · trapSprung · …"]:::spine
  REACT["④ REACTORS — listeners &amp; state the bus drives<br/>Field entities (traps · nests · runes) · Statuses · Vision ladder (Hidden→Pinged→Seen)"]:::soft
  CLK["⑤ CT CLOCK — the timeline everything schedules on<br/>Speed → CT · charged effects &amp; entity chains resolve here"]:::engine

  TELE --> ACT
  ACT -->|"emit events"| BUS
  BUS -->|"notify listeners"| REACT
  ACT -.->|"charged casts &amp; entity chains schedule on"| CLK
  CLK -.->|"a scheduled effect resolving re-fires events"| BUS
  TELE -.->|"mirrors the resolver (preview = outcome)"| REACT

  classDef soft fill:#ffffff,color:#7F1D1D,stroke:#DC2626,stroke-width:2px
  classDef spine fill:#DC2626,color:#ffffff,stroke:#7F1D1D,stroke-width:4px
  classDef engine fill:#7F1D1D,color:#ffffff,stroke:#450A0A,stroke-width:4px
```

## Reading it

- **The trigger bus (③) is the architectural hook (D4).** The combat loop announces moments; field
  entities, Cook buffs, and future placeables are just **listeners**. Adding a new placeable is
  adding *data*, not a new system. The bus is wired and load-bearing today.
- **The CT clock (⑤) is where time-shifted things land.** [Charged abilities](07-turn-order.md),
  runes (pre-paid charges), and entity chains all **schedule onto the clock with a `speed`** —
  instant fires now, a lower speed becomes a disruptable timer. When one resolves, it re-fires bus
  events, which can drive more reactors: the bus↔clock loop is the engine of combat.
- **Reactors (④) are the game state prep touches.** Traps/nests/runes are entities placed in
  Deployment; **Statuses** (Immobilized, Guarded, Exposed, …) are applied effects; the **Vision
  ladder** gates who can see and target whom (a Direct attack needs *Seen*; an AoE can catch a
  *Pinged* tile).
- **Telegraph (①) mirrors the resolver.** The preview you see before committing is generated from
  the *same* logic that resolves the ability — so what you're shown is what you'll get (D64).

> Maps to: [field-entities](../systems/field-entities.md) · [action-economy](../systems/action-economy.md)
> · [telegraph](../systems/telegraph.md) · [vision](../systems/vision.md). Some reactors (nests,
> runes, the full vision ladder) are *designed, not built* — see each system doc.
