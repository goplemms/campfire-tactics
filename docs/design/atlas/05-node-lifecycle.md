# 05 · Node / travel lifecycle

The **night/day loop** (D46, revised D80) — the beat-by-beat cycle you repeat at every stop. Its
defining rule is **night-after-arrival**: you make camp on *arrival*, so you **travel wounded**
and reaching the next rest is the relief the whole economy is built on. The camp is **two beats**
bracketing the journey — a post-encounter *plan* beat and an on-arrival *prep* beat.

```mermaid
%%{init: {'theme':'base','themeVariables':{'fontSize':'18px','fontFamily':'ui-sans-serif, system-ui, sans-serif'},'flowchart':{'nodeSpacing':45,'rankSpacing':65,'padding':16}}}%%
flowchart LR
  ENC["Encounter<br/>Battle / Town / Event"]:::enc
  REACT["React Camp — post-encounter<br/>plan: Survey ahead · bank loot · read forecast<br/>NO rest here"]:::camp
  ROAD["The Road — the day<br/>travel WOUNDED · an early event may fire"]:::road
  PREP["Prep Camp — on arrival<br/>the night's REST (chip / Deep Rest) · gear up"]:::camp

  ENC --> REACT
  REACT -. "Set Out — choose next node · commits route · node-step tick" .-> ROAD
  ROAD --> PREP
  PREP -. "Begin" .-> ENC

  classDef enc fill:#ffffff,color:#7F1D1D,stroke:#DC2626,stroke-width:2px
  classDef camp fill:#ffffff,color:#134E4A,stroke:#0D9488,stroke-width:3px
  classDef road fill:#ffffff,color:#1E3A8A,stroke:#1D4ED8,stroke-width:2px

  style ENC fill:#FEE2E2
  style ROAD fill:#DBEAFE
```

## Reading it

- **The two camps do different jobs.** The **React camp** is *direction* — you **Survey** ahead
  (this is why it's its own beat: you scout *before* you commit a route), read the ledger's
  forecast, and bank loot. The **Prep camp** is *readiness* — the night's rest lands here on
  arrival, then you gear up for the encounter you chose (heal, buy at a Town, set traps).
- **Two advance verbs, two exits.** `Set Out` leaves the react camp (choose route → travel; the
  node-step tick fires here). `Begin` leaves the prep camp into the encounter.
- **Rest is night-after-arrival.** The nightly heal + Fatigue step-down happen at the **prep
  camp**, not after the fight — so you journey wounded and recover at the destination. Real
  recovery still means *routing to a Clearing*; the nightly chip is only a floor, so
  dodge-every-fight stays dead.
- **The Clearing is the special case.** A rest node's "encounter" *is* the arrival Deep Rest, so
  its prep camp and encounter **merge** — no separate `Begin` beat.
- **One node = one node-step.** The camp, the [ledger](../systems/overworld.md), and the route
  forecast all attach to this same seam.

> Maps to: [systems/overworld.md → The node lifecycle](../systems/overworld.md) and the
> [glossary lifecycle table](../glossary.md#lifecycle--the-node-spine-d46-revised-d80).
