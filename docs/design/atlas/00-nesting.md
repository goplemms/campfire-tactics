# 00 · The nesting

The master "you-are-here" map. Everything in the game lives at one of five **scales**,
each nested inside the one above it. Read it outside-in: the **Guild** is your permanent
home; each run sends one caravan into the **Overworld**; each stop is a **Node**; a combat
node runs the four-phase **Mission pipeline**; and the third phase *is* **Combat**.

The labelled arrows are the **transition verbs** — the exact buttons that move you between
scales (`Dispatch`, `Begin`, `Set Out`).

```mermaid
%%{init: {'theme':'base','themeVariables':{'fontSize':'18px','fontFamily':'ui-sans-serif, system-ui, sans-serif'},'flowchart':{'nodeSpacing':45,'rankSpacing':60,'padding':16}}}%%
flowchart TB
  subgraph GUILD["🏰 GUILD — persistent home · survives every run"]
    HOME["Roster · Treasury · Armory · Quest Board · Stable of Caravans"]

    subgraph RUN["🗺️ RUN / OVERWORLD — one caravan · start → final · Purse lost on a wipe"]
      MAP["Layered node DAG<br/>Intel reveals · Fog hides"]

      subgraph NODE["⛺ NODE — one night · Camp bookends the encounter"]

        subgraph MISSION["MISSION PIPELINE — a combat node"]
          direction LR
          META["Meta<br/>provision · assign jobs · cook"]
          DEPLOY["Deployment<br/>place traps · push your luck"]
          RES["Resolution<br/>recover · tally · reward"]

          subgraph COMBAT["⚔️ COMBAT — the iso grid"]
            CT["CT clock<br/>Move + Act · Instant / Charged<br/>field entities · statuses · vision"]
          end

          META --> DEPLOY --> COMBAT --> RES
        end
      end
    end
  end

  HOME -. "Dispatch →" .-> MAP
  MAP -. "arrive · Prep Camp → Begin →" .-> META
  RES -. "React Camp · Set Out ↺" .-> MAP

  %% ── shared scale palette (see atlas README): solid frames, white content boxes ──
  classDef guildLeaf fill:#ffffff,color:#3B0764,stroke:#6D28D9,stroke-width:2px
  classDef runLeaf fill:#ffffff,color:#1E3A8A,stroke:#1D4ED8,stroke-width:2px
  classDef missionLeaf fill:#ffffff,color:#7C2D12,stroke:#C2410C,stroke-width:2px
  classDef combatLeaf fill:#ffffff,color:#7F1D1D,stroke:#DC2626,stroke-width:2px

  class HOME guildLeaf
  class MAP runLeaf
  class META,DEPLOY,RES missionLeaf
  class CT combatLeaf

  style GUILD fill:#7C3AED,color:#ffffff,stroke:#4C1D95,stroke-width:4px
  style RUN fill:#2563EB,color:#ffffff,stroke:#1E3A8A,stroke-width:4px
  style NODE fill:#0D9488,color:#ffffff,stroke:#134E4A,stroke-width:4px
  style MISSION fill:#EA580C,color:#ffffff,stroke:#9A3412,stroke-width:4px
  style COMBAT fill:#DC2626,color:#ffffff,stroke:#7F1D1D,stroke-width:4px
```

## What this shows (and what it defers)

- **Nesting, not detail.** Each scale is drawn just deep enough to place it; the detail
  lives in its own atlas page (`01`–`08`). A **rest** or **event** node skips the Mission
  pipeline entirely — that branch belongs on [`03 · Node kinds`](README.md).
- **The verbs are load-bearing.** `Dispatch` (leave the guild), `Begin` (leave the prep
  camp into the encounter), and `Set Out` (leave the react camp onto the road) are the
  canonical advance verbs from the [glossary](../glossary.md). The two Camp beats live on
  the arrows here; [`05 · Node lifecycle`](README.md) unfolds them.
- **The loop.** `Resolution` feeds back to the map, and the map feeds the next node — the
  run is that loop repeated until the final node (win) or a wipe (run over).

> Maps to: [Design Overview → The loop](../README.md#the-loop).
