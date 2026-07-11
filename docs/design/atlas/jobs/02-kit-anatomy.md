# 04b · A job's kit anatomy

Every job is authored to one of **two house styles** — a *combat* shape and a *non-combat* shape.
They're the same idea (**one identity anchor + one or two things you do**) in two mediums. The shape
is a **guideline, not a hard rule**: the roster already bends it (the Scout carries a deployment
snare on top of two battle actives), and that flex is *wanted*.

```mermaid
%%{init: {'theme':'base','themeVariables':{'fontSize':'16px','fontFamily':'ui-sans-serif, system-ui, sans-serif'},'flowchart':{'nodeSpacing':30,'rankSpacing':45,'padding':16}}}%%
flowchart TB
  subgraph COMBAT["⚔️ COMBAT JOB — 2 active + 1 passive (D40)"]
    direction TB
    CP["PASSIVE — the identity anchor<br/>e.g. Soldier · Brother-in-arms (+1 dmg per adjacent ally)"]:::anchor
    CA1["ACTIVE — a battle skill<br/>e.g. Turtle Formation (Guard the line)"]:::verb
    CA2["ACTIVE — a battle skill<br/>e.g. Debilitating Strike (+dmg, Exposed)"]:::verb
    CP --- CA1 --- CA2
  end

  subgraph NONCOMBAT["🧭 NON-COMBAT JOB — 1 presence + 1–2 verbs (D70)"]
    direction TB
    NP["PRESENCE — the anchor (holds by being fielded)<br/>e.g. Merchant · Appraisal (every market reads one tier better)"]:::anchor
    NV1["VERB — an overworld/camp/combat action<br/>e.g. Find Trade (impromptu market)"]:::verb
    NV2["VERB<br/>e.g. Savvy Barter (next deal goes your way)"]:::verb
    NP --- NV1 --- NV2
  end

  classDef anchor fill:#4F46E5,color:#ffffff,stroke:#3730A3,stroke-width:2px
  classDef verb fill:#ffffff,color:#1E293B,stroke:#64748B,stroke-width:2px

  style COMBAT fill:#FEE2E2,color:#7F1D1D,stroke:#DC2626,stroke-width:3px
  style NONCOMBAT fill:#D1FAE5,color:#065F46,stroke:#059669,stroke-width:3px
```

## Reading it

- **The anchor carries the identity.** For a **combat** job it's the **passive** (a rule that's
  always on — Brother-in-arms, Deadeye, Quiet Footsteps). For a **non-combat** job the passive has
  no battle to live in, so the anchor is a **presence effect** — a benefit that holds *while the
  unit is fielded* (Appraisal's market lift, the Noble's Renown Influence trickle). Same role, two
  mediums.
- **The actives are what you *do*.** Combat actives are entries in the `skills` array (they cost CT
  on the clock). Non-combat "actives" are **verbs** gated outside `skills` and paced by the
  overworld limiter (cooldown / per-node cap / a price in fatigue · gold · Influence · RP).
- **A verb can live on any surface.** The Noble generalizes the shape: **Patronize** is a *camp*
  verb, **Bribe** a *combat* verb — "1 presence + 1–2 verbs, where a verb may be camp **or**
  battle."
- **Prestige keeps the count flat** by swapping elements, not adding them (see
  [`d · Prestige`](04-prestige.md)); held jobs add elements only through **loadout slots**.

> Maps to: [systems/jobs.md → A job's kit](../../systems/jobs.md). Worked cases: Soldier (D66),
> Merchant (D70), Cook & Noble (D71).
