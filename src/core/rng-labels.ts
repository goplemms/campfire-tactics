/**
 * The RNG **label registry** (R1 #116) — the enumeration of every random
 * decision in the game.
 *
 * Every deterministic stream is derived as `streamFor(seed, label)` ({@link
 * "./rng".streamFor}); the label is the stream's **identity**. Until now those
 * labels were ad-hoc template strings scattered across nine modules, which
 * carried three silent hazards:
 *  - **collision** — two sites reusing one label correlate their streams
 *    (invisible in tests: both still "look random");
 *  - **typo-forks** — a mistyped label silently derives a *different* stream;
 *  - **unmarked renames** — a label's string value is part of the future
 *    save/replay wire format (D27), so renaming one breaks replay of any run
 *    recorded under the old value, with nothing flagging the change.
 *
 * This module is the single home: **one typed constructor per draw site**. A
 * grep tripwire (`rng-labels.test.ts`) keeps `streamFor` call sites outside
 * this module on the registry, and value pins there make every label's exact
 * string an explicit contract — **renaming a label value is a save/replay-
 * breaking change** and must fail a test before it ships.
 *
 * The D73 forage lesson, generalized: a label must carry **every coordinate
 * that distinguishes one draw from another** (`forage:<node>` alone would have
 * repeated identical rolls each use — the night and the use-index are
 * load-bearing). When adding a constructor, ask "which two draws must differ?"
 * and put each answer in the label.
 *
 * Pure data: no Phaser, no DOM, no state.
 */

/** Every registered stream-label constructor, one per `streamFor` draw site (#116). */
export const Labels = {
  // --- World generation (seed-stable for the whole run, D22) ----------------
  /** The overworld map layout/kinds/edges — one stream per run seed. */
  map: (): string => "map",
  /** A node's market tier — per-node so it never perturbs the main map stream (D61). */
  market: (nodeId: string): string => `market:${nodeId}`,
  /** A combat node's derived encounter — per-node, replay-identical regardless of other draws. */
  node: (nodeId: string): string => `node:${nodeId}`,
  /** A linear-run / harness encounter by index (the pre-map shape; tests still derive it). */
  enc: (index: number): string => `enc:${index}`,

  // --- Node events (M11/D22 — stable per node, so no save-scum) -------------
  /** Which event an event-node hosts — the weighted pick from the pool. */
  event: (nodeId: string): string => `event:${nodeId}`,
  /** The toll event's rolled fee — fixed per node for the run. */
  eventToll: (nodeId: string): string => `event:${nodeId}:toll`,
  /** The wayside shop's rolled stock — fixed per node for the run. */
  eventShop: (nodeId: string): string => `event:${nodeId}:shop`,
  /** Which story an event node tells — fixed per node for the run. */
  eventStory: (nodeId: string): string => `event:${nodeId}:story`,
  /** A story choice's gold roll — per choice, so options roll independently. */
  eventStoryChoice: (nodeId: string, choiceId: string): string => `event:${nodeId}:story:${choiceId}`,
  /** The headless auto-resolver's story pick — distinct from any player choice's roll. */
  eventStoryAuto: (nodeId: string): string => `event:${nodeId}:story:auto`,
  /** Whether an early (on-the-road) event fires at a node — fixed per node. */
  early: (nodeId: string): string => `early:${nodeId}`,
  /** Whether a tailored, node-bound early event fires (D80) — distinct from the random pool. */
  tailored: (nodeId: string): string => `tailored:${nodeId}`,

  // --- Overworld verbs (per-use coordinates — the D73 lesson) ---------------
  /**
   * One Forage use's loot rolls. Night + use-index are **load-bearing** (D73):
   * `forage:<node>` alone would repeat identical rolls every use.
   */
  forage: (nodeId: string, night: number, useIndex: number): string => `forage:${nodeId}:${night}:${useIndex}`,
  /** The Thief's Deft Hands skim roll — per node *and* night, so each stay re-rolls. */
  deft: (nodeId: string, night: number): string => `deft:${nodeId}:${night}`,
  /** The Noble's bribe sway roll — fixed per target+node (no save-scum, D62). */
  bribe: (nodeId: string, enemyId: string): string => `bribe:${nodeId}:${enemyId}`,

  // --- Guild (guild-seed streams, D31/D33) -----------------------------------
  /** A generated sidequest — keyed by the guild's monotonic quest counter. */
  quest: (n: number): string => `quest:${n}`,
  /** The main quest's dispatch seed (a seed salt via `saltSeed`, not a live stream). */
  questMain: (): string => "quest:main",
  /** A recruiter node's rolled body — node-scoped so two recruiters never collide. */
  recruit: (nodeId: string): string => `recruit:${nodeId}`,
  /** A rolled mercenary — keyed by hiring-board slot index. */
  merc: (index: number): string => `merc:${index}`,

  // --- Theft (D30 — labels fed to the `rollSkim`/`thiefSteal` label seam) ----
  /** A node-event theft's skim roll — fixed per node. */
  theft: (nodeId: string): string => `theft:${nodeId}`,
  /** A mid-battle thief's skim roll — keyed by the thief unit. */
  thief: (unitId: string): string => `thief:${unitId}`,

  // --- In-battle draws (the Battle's seed, D67) ------------------------------
  /**
   * One {@link "./turn".Battle.roll} draw: the caller's label plus the battle's
   * monotonic draw counter — the temporal coordinate that lets a replay re-derive
   * every roll in order without a stateful RNG cursor.
   */
  battleDraw: (label: string, draw: number): string => `${label}#${draw}`,
  /** A damage-variance roll's inner label — per attacker→defender pairing. */
  dmg: (attackerId: string, defenderId: string): string => `dmg:${attackerId}->${defenderId}`,
  /** The deployment phase's scene stream ({@link "./turn".Battle.stream} — logged/render-only draws). */
  deploy: (): string => "deploy",
  /** The deployment trap-spotting stream (render-only reveals; a replay never re-rolls them). */
  trapSpot: (): string => "trap-spot",
  /**
   * One staged battle's **encounter seed salt** (`saltSeed(run.seed, …)`): node + night
   * are load-bearing (the D73 lesson at the battle tier) — an unsalted `run.seed` made
   * every encounter's `deploy`/`trap-spot` streams byte-identical across the whole run.
   */
  battle: (nodeId: string, night: number): string => `battle:${nodeId}:${night}`,
  /**
   * An expedition-sim sample run's seed salt — the **bare** sample index, kept
   * byte-identical to the historical `` `${seed}#${salt}` `` join so the
   * feasibility digests don't shift. (New salts should carry a domain prefix.)
   */
  expeditionSalt: (salt: number): string => `${salt}`,
} as const;
