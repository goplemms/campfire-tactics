# 07 · Combat turn order (the CT clock)

Combat has **no rounds** (decision D5). It runs on a continuous **Charge-Time** clock: every unit
fills a hidden CT gauge at its **Speed**, and whoever crosses 100 acts next. Speed isn't "go
first" — it's *how often* you act and *how fast* your charged effects land.

```mermaid
%%{init: {'theme':'base','themeVariables':{'fontSize':'17px','fontFamily':'ui-sans-serif, system-ui, sans-serif'},'flowchart':{'nodeSpacing':40,'rankSpacing':50,'padding':16}}}%%
flowchart TB
  TICK["Clock ticks — every unit: CT += Speed<br/>(this is Advance Clock: time only passes here)"]:::clock
  READY{"a unit at CT ≥ 100?"}:::decision
  TURN["ACTIVE TURN of that unit<br/>Move + Act — either order"]:::turn
  SPEND["End Turn → spend CT down<br/>(Act costs more than Move)"]:::clock

  TICK --> READY
  READY -->|"no — keep ticking"| TICK
  READY -->|"yes"| TURN
  TURN --> SPEND
  SPEND --> TICK

  INSTANT["Instant — resolves NOW, on the turn<br/>(a strike, a step, Defend)"]:::inst
  CHARGED["Charged — only SCHEDULES on the timeline<br/>resolves LATER when its gauge fills · can be played around"]:::charged

  TURN -. "Act" .-> INSTANT
  TURN -. "Act" .-> CHARGED
  CHARGED -. "gauge fills on a later tick →" .-> RESOLVE["effect resolves on the board"]:::charged
  TICK --- RESOLVE

  classDef clock fill:#DC2626,color:#ffffff,stroke:#7F1D1D,stroke-width:3px
  classDef turn fill:#ffffff,color:#7F1D1D,stroke:#DC2626,stroke-width:3px
  classDef decision fill:#FEE2E2,color:#7F1D1D,stroke:#DC2626,stroke-width:2px
  classDef inst fill:#ffffff,color:#166534,stroke:#16A34A,stroke-width:2px
  classDef charged fill:#ffffff,color:#92400E,stroke:#D97706,stroke-width:2px
```

## Reading it

- **Two buttons, two jobs.** **End Turn** closes the *active unit's* turn and spends its CT
  (setting when it next acts). **Advance Clock** runs the clock forward — accruing CT, burning
  cooldowns, ticking statuses and charged abilities, taking enemy turns — until the next unit is
  ready. **Time only passes on Advance Clock**; End Turn just hands the clock back. (There is no
  `Wait` — End Turn covers passing.)
- **Instant vs. Charged is the heart of the system.** An **Instant** resolves on your turn. A
  **Charged** ability doesn't fire when you cast it — it *schedules* on the timeline and resolves a
  few ticks later, so the target can move out of the AoE before it lands (a telegraphed, counter-
  playable commit). A **rune** is a charged ability whose charge was pre-paid in Deployment.
- **Entity chains ride the same rail.** When a [field entity](../systems/field-entities.md) sets off
  an adjacent one, the reaction is scheduled onto this clock with a `speed` — `instant` fires now, a
  lower speed becomes a disruptable timer. Combos are just charged abilities by another name.
- **The initiative seed** (set in Deployment from each side's non-captured Speed) decides who reaches
  100 first at `t=0`.

> Maps to: [systems/action-economy.md](../systems/action-economy.md) and the
> [glossary combat section](../glossary.md#combat-d5--the-ct-clock). Numbers (tick rate, CT
> spend-down, charge times) are illustrative tuning values.
