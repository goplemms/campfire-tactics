# 02 · Overworld

One caravan's run: a **seeded, layered DAG** of nodes you branch through, from a single
**start** to a single **final**. It doesn't change combat — it only chooses *which encounter to
play next*. Everything is derived from the run seed, so replaying a seed reproduces the same
layout, kinds, and edges.

```mermaid
%%{init: {'theme':'base','themeVariables':{'fontSize':'17px','fontFamily':'ui-sans-serif, system-ui, sans-serif'},'flowchart':{'nodeSpacing':38,'rankSpacing':70,'padding':14}}}%%
flowchart LR
  START(["◆ start · L0"]):::startNode

  A1["◉ you are here<br/>(a Battle)"]:::here
  A2["Clearing"]:::rest

  B1["Battle"]:::reach
  B2["Event"]:::reach

  C1["Battle"]:::fog
  C2["Clearing"]:::fog
  C3["? "]:::fog

  FINAL(["★ final"]):::fog

  START --> A1 & A2
  A1 --> B1 & B2
  A2 --> B2
  B1 --> C1 & C2
  B2 --> C2 & C3
  C1 --> FINAL
  C2 --> FINAL
  C3 --> FINAL

  classDef startNode fill:#ffffff,color:#0f172a,stroke:#334155,stroke-width:2px
  classDef here fill:#1D4ED8,color:#ffffff,stroke:#1E3A8A,stroke-width:4px
  classDef combat fill:#ffffff,color:#7F1D1D,stroke:#DC2626,stroke-width:2px
  classDef rest fill:#ffffff,color:#065F46,stroke:#059669,stroke-width:2px
  classDef reach fill:#DBEAFE,color:#1E3A8A,stroke:#1D4ED8,stroke-width:3px
  classDef event fill:#ffffff,color:#7C2D12,stroke:#C2410C,stroke-width:2px
  classDef fog fill:#E5E7EB,color:#9CA3AF,stroke:#9CA3AF,stroke-width:1px,stroke-dasharray:4 3
```

**Legend** — 🔵 solid = **you are here** · light-blue = **reachable** now (the frontier, always
visible) · ⬜ dashed grey = **fogged** (beyond intel reach, hidden until intel/travel reaches it) ·
left → right = **layer = difficulty** (deeper is harder).

## Reading it

- **Forward-only, never stuck.** Edges only go to the next layer; the generator guarantees every
  non-final node has an outgoing edge (no dead ends) and every non-start node an incoming one (no
  orphans) — so you can always reach the final layer. Extra fan-out adds real branch *choices*
  (and re-merges).
- **Layer 0 is a single start; the final layer is a single node.** Clearing the final node is
  **run-complete**; losing all combat-capable units is a **wipe** (run over — the end screen shows
  the seed to replay).
- **A branch is only a choice if it's informed.** Each reachable node shows a banded
  [intel](../systems/intel.md) preview: **Tier 1** enemy *types* → **Tier 2** the *count* → **Tier
  3** *positions*, plus a reward hint. Rest nodes preview a recovery hint.
- **Reach vs. depth are two intel axes.** *Depth* (above) is how much a previewed node reveals;
  *reach* is how many steps forward you can see at all (`baseReach + tier × step`, ~half the map by
  default). The immediately-reachable nodes are always visible.

> Maps to: [systems/overworld.md](../systems/overworld.md). Node contents are unpacked in
> [`03 · Node kinds`](03-node-kinds.md); what you *do* at each stop is [`05 · Node lifecycle`](05-node-lifecycle.md).
