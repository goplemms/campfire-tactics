# 03 · Node kinds

What a node on the [overworld DAG](02-overworld.md) can *be*. The menagerie is kept minimal —
**three code kinds** (`combat | rest | event`) — and each kind names its **encounter** by a
player-facing word. On top of that, a light **early event** can ride the arrival of *any* node,
decoupled from its kind.

```mermaid
%%{init: {'theme':'base','themeVariables':{'fontSize':'17px','fontFamily':'ui-sans-serif, system-ui, sans-serif'},'flowchart':{'nodeSpacing':32,'rankSpacing':55,'padding':14}}}%%
flowchart TB
  NODE(["Node — one stop · one night"]):::node

  NODE --> COMBAT["kind: combat"]:::kind
  NODE --> REST["kind: rest"]:::kind
  NODE --> EVENT["kind: event"]:::kind

  COMBAT --> BATTLE["Encounter: Battle<br/>full Deployment → Combat → Resolution<br/>difficulty = the node's layer"]:::combatLeaf
  REST --> CLEARING["Encounter: Clearing (Deep Rest)<br/>no fight · Fatigue wiped · big heal for a unit at Tier 0"]:::restLeaf

  EVENT --> E1["Roadside Market — Buy / Sell"]:::eventLeaf
  EVENT --> E2["Wandering Sellsword — Hire"]:::eventLeaf
  EVENT --> E3["Thief on the Road — skims the Purse"]:::eventLeaf
  EVENT --> E4["Tollgate — a known fee to pass"]:::eventLeaf
  EVENT --> E5["A Choice on the Road — story prompt"]:::eventLeaf
  EVENT -.-> TOWN["(planned) Town — premium Market"]:::planned

  EARLY["⚡ Early events (D80)<br/>a light event on the day IN — decoupled from kind:<br/>ANY node may host one (random pool or authored-to-a-node)"]:::early
  NODE -. "arrival may fire" .-> EARLY

  classDef node fill:#0D9488,color:#ffffff,stroke:#134E4A,stroke-width:3px
  classDef kind fill:#CCFBF1,color:#134E4A,stroke:#0D9488,stroke-width:2px
  classDef combatLeaf fill:#ffffff,color:#7F1D1D,stroke:#DC2626,stroke-width:2px
  classDef restLeaf fill:#ffffff,color:#065F46,stroke:#059669,stroke-width:2px
  classDef eventLeaf fill:#ffffff,color:#7C2D12,stroke:#C2410C,stroke-width:2px
  classDef planned fill:#F3F4F6,color:#6B7280,stroke:#9CA3AF,stroke-width:1px,stroke-dasharray:4 3
  classDef early fill:#FEF3C7,color:#78350F,stroke:#D97706,stroke-width:2px
```

## Reading it

- **Kind vs. encounter name.** The *code* kind is one of three (`combat | rest | event`); the
  *player-facing* encounter is named by kind — **Battle**, **Clearing**, or an **Event** (a
  **Town** is a planned premium-market node). One combat node runs the whole mission pipeline; a
  rest node runs no fight.
- **Rest = the Clearing.** Its "encounter" *is* the arrival Deep Rest — Fatigue wiped, debt
  cleared, plus a **big heal, but only for a unit at Tier 0** when the rest resolves. That gate is
  what makes "rest the hurt, work the healthy" a real puzzle.
- **Events are a registry.** Each sub-type is data in the M11 event registry — the Thief and
  Tollgate auto-resolve (their cost shows in the Forecast); the Market, Sellsword, and Choice
  present buttons.
- **Early events are orthogonal.** They're *occasional, never every node*, and ride the **day in**
  before the main encounter — a satchel of gold, a pickpocket, a merchant's offer, or an authored
  node-specific beat. A tailored one can even **bypass** the encounter (gated by gold/Influence,
  and you forgo the loot).

> Maps to: [systems/overworld.md → Node kinds](../systems/overworld.md) and the event registry in
> `src/core/node-events.ts`. Event verbs (Buy/Sell/Hire) follow the [glossary](../glossary.md).
