# 04f · Acquisition & attachment

Jobs arrive **through play, not a menu** — and that's not flavor, it's the **attachment engine**. A
unit's job sheet becomes a *history*, and history is what makes a unit feel *yours*. It compounds
with permadeath (D27): loss only hurts when you're invested.

```mermaid
%%{init: {'theme':'base','themeVariables':{'fontSize':'16px','fontFamily':'ui-sans-serif, system-ui, sans-serif'},'flowchart':{'nodeSpacing':38,'rankSpacing':48,'padding':16}}}%%
flowchart TB
  ACT["a unit does something in play<br/>(a Scout helps a beggar at a city node)"]:::play
  MEM["the unit REMEMBERS it<br/>per-unit memory — a cross-node flag bag (the one new substrate)"]:::mem
  EVENT["nodes later, a LINKED EVENT reads the flag<br/>'the thieves' guild heard there's a friend of the poor…'"]:::event
  OFFER["it OFFERS a job or a prestige<br/>(a grant whose predicate the unit now meets)"]:::offer
  CHOOSE{"the player CHOOSES<br/>at a camp / event beat"}:::choose
  RESULT["job added (breadth) or prestige triggered (depth)<br/>the job sheet gains a line of HISTORY"]:::result
  ATTACH["→ attachment · compounded by permadeath"]:::attach

  ACT --> MEM --> EVENT --> OFFER --> CHOOSE
  CHOOSE -->|"accept"| RESULT --> ATTACH
  CHOOSE -.->|"decline"| MEM

  classDef play fill:#4F46E5,color:#ffffff,stroke:#3730A3,stroke-width:3px
  classDef mem fill:#EDE9FE,color:#4C1D95,stroke:#7C3AED,stroke-width:2px
  classDef event fill:#ffffff,color:#3730A3,stroke:#6366F1,stroke-width:2px
  classDef offer fill:#ffffff,color:#3730A3,stroke:#6366F1,stroke-width:2px
  classDef choose fill:#FCE7F3,color:#9D174D,stroke:#BE185D,stroke-width:2px
  classDef result fill:#ffffff,color:#155E75,stroke:#0891B2,stroke-width:2px
  classDef attach fill:#4F46E5,color:#ffffff,stroke:#3730A3,stroke-width:3px
```

## Three agency levels

Where the *ownership* accrues depends on how the job arrives — and the level should match the
content:

| Level | How it fires | Right for | Example |
|---|---|---|---|
| **Automatic** | on a threshold, no prompt | **authored** story beats (it's a reveal) | coming-of-age at char-level 5 |
| **Item-spent** | consume a held item | generic acquisition | a **recipe book** → Cook |
| **Player-chosen** | pick at an event | generic acquisition | the guild's job offer |

> **Ownership accrues in the choosing** — so generic acquisition should usually **cost a choice or
> an item**, while automatic is reserved for authored reveals.

## Reading it

- **Per-unit memory is the only new substrate.** A cross-node flag bag lets a *later* event read
  what an *earlier* one wrote (the beggar → guild chain). Everything else reuses existing seams (the
  predicate kinds, the job registry, the loadout economy, per-job levels). Its exact shape — what a
  memory entry holds, how long it persists — is deferred.
- **Declining isn't losing.** The remembered flag persists, so an offer can resurface — the choice
  stays yours.
- **The Assassin path is the two-step version:** walk the road with a stranger first (a remembered
  flag), and *only then* the reveal — the traveler was an assassin — offers the mentorship. Linked
  memory gates the second event on the first.

> Maps to: [systems/jobs.md → Acquisition is diegetic / Per-unit memory](../../systems/jobs.md).
