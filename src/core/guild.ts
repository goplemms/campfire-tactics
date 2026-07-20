/**
 * The Guild (M9, D25–D27) — the persistent home that owns **N runs**.
 *
 * M7/M8 operate on the single run that `run.ts` holds. The design (D25–D27) puts a
 * persistent **guild tier** on top: a run becomes **one caravan's adventure**, and
 * the guild owns several. This module is that tier, pure:
 *
 * - **The roster pool** — every character the guild owns. Committing one to a
 *   caravan locks it out of the pool (D26); a wipe removes it (permadeath, D27); a
 *   return rejoins its survivors.
 * - **The armory** — shared gear stock; gear locked to a caravan is unavailable to
 *   others until it returns (D25).
 * - **The treasury** — a **pure gold vault** (D34): no passive faucet, only quest
 *   payouts and returning purses flow in.
 * - **The stable** — the {@link "./caravan".Caravan}s the guild can field.
 * - **The quest board** — **never empty** (D26): a **main quest** plus a repeating
 *   **generated sidequest** stream; the source of every caravan's seed.
 * - **N run states** — one per dispatched caravan ({@link "./run".RunState}).
 *
 * **Model C (D26): commitment parallel, play serial.** {@link dispatch} commits a
 * caravan (locking its people + gear + purse) and builds a deterministic run; the
 * render plays one run at a time while the others **wait** — the guild ticks no
 * background clock and never auto-resolves. {@link resolveReturn} reads a run's
 * terminal: a **return** (complete) flows survivors/gear/purse home; a **wipe**
 * (over) loses that caravan's people + gear + purse while the **guild survives**.
 * {@link hireMercenary} is the D27 "never hard-fails" valve.
 *
 * **Determinism (D22):** quest seeds and merc rolls derive from the guild seed via
 * {@link "./rng".streamFor}; same guild seed + same dispatch choices reproduce
 * every caravan's run. No live RNG, no `Math.random`.
 *
 * Pure logic: no Phaser, no DOM.
 */

import { Rng, streamFor, saltSeed } from "./rng";
import { Labels } from "./rng-labels";
import { createUnit, type Unit } from "./units";
import type { JobId } from "./jobs";
import {
  type Caravan,
  committedMemberIds,
  committedGearIds,
  resetCaravan,
} from "./caravan";
import {
  createRunFromCaravan,
  isRunOver,
  type RunState,
} from "./run";

/** A quest on the board (D26). Pure data; its `seed` drives the caravan's run. */
export interface Quest {
  id: string;
  label: string;
  /** The campaign spine (`main`) or a sidequest (`side`). */
  kind: "main" | "side";
  /** True for the repeating **generated** sidequest stream (the endless tail). */
  generated: boolean;
  /** The run seed this quest dispatches with — deterministic from the guild seed. */
  seed: string;
  /**
   * The gold **payout** (M10, D34) — earned on completion and routed to the
   * **TREASURY** (not the purse). The treasury's **only** faucet is these payouts
   * (plus a returning purse); there is no passive growth (D34). Deterministic from
   * the guild seed.
   */
  payout: number;
}

/** A dispatched caravan's in-flight run (D26): the guild owns N of these. */
export interface GuildRun {
  caravanId: string;
  questId: string;
  run: RunState;
  /** The quest's gold payout (M10, D34) — banked to the treasury on completion. */
  payout: number;
}

/** The persistent guild — the home that owns N runs (D25–D27). */
export interface Guild {
  seed: string | number;
  /** The roster pool — every character the guild owns. */
  roster: Unit[];
  /** Shared gear stock (gear ids). */
  armory: string[];
  /** The pure gold vault (D34) — fed only by quest payouts + returning purses. */
  treasury: number;
  /**
   * The refreshing **mercenary pool** (M10, D33) at the hall — several rolled,
   * gold-hired recruits beyond the single rebuild valve ({@link "./recruitment"}).
   */
  mercPool: Unit[];
  /** The stable of caravans. */
  caravans: Caravan[];
  /** The quest board — never empty (D26). */
  board: Quest[];
  /** Dispatched caravans' runs, keyed by caravan id. */
  runs: Record<string, GuildRun>;
  difficultyId: string;
  /** Monotonic counter for deterministic generated-sidequest ids/seeds. */
  questCounter: number;
  /** Monotonic counter for deterministic mercenary rolls (the rebuild valve). */
  mercCounter: number;
}

/** Guild tuning — data, a numbers pass later (D27/D34). */
export const GUILD = {
  /** Generated sidequests kept on the board at all times (never empty, D26). */
  sidequestPoolSize: 2,
  /** Treasury cost to hire one mercenary (the rebuild valve, D27). */
  mercCost: 30,
  /** Treasury cost to mint one gear into the armory (D34). */
  armoryCost: 60,
  /** Main-quest gold payout → treasury on completion (M10, D34). */
  mainPayout: 300,
  /** Generated-sidequest payout band → treasury on completion (M10, D34). */
  sidePayoutMin: 60,
  sidePayoutMax: 140,
} as const;

/** Options for {@link createGuild}. */
export interface CreateGuildOptions {
  roster?: Unit[];
  armory?: string[];
  treasury?: number;
  caravans?: Caravan[];
  difficultyId?: string;
  /** Label for the main quest (data; the campaign spine, D26). */
  mainQuestLabel?: string;
}

/**
 * The **authored starting roster** (D25) — the eight-strong cast a fresh guild seeds
 * with: two soldiers (one the Lord), a scout, and the non-combat specialists (cook,
 * merchant, noble, banker, medic). One owner of these stat tables — the GuildScene's
 * fresh guild and the debug/demo boots all inflate the same eight from here rather than
 * re-typing them (they had drifted as two verbatim copies). Fresh units each call
 * (createUnit builds new objects), so callers can mutate without aliasing.
 */
export function STARTING_ROSTER(): Unit[] {
  return [
    createUnit({ id: "Edrin", side: "player", pos: { col: -1, row: -1 }, name: "Edrin", jobId: "soldier", isLord: true, awareness: 5, intelligence: 4, speed: 12, maxHp: 34, attack: 11, defense: 4, moveRange: 4, sightRadius: 5 }),
    createUnit({ id: "Rook", side: "player", pos: { col: -1, row: -1 }, name: "Rook", jobId: "soldier", awareness: 4, intelligence: 4, speed: 12, maxHp: 30, attack: 9, defense: 3, moveRange: 4, sightRadius: 5 }),
    createUnit({ id: "Vale", side: "player", pos: { col: -1, row: -1 }, name: "Vale", jobId: "scout", awareness: 2, intelligence: 2, speed: 10, maxHp: 24, attack: 11, defense: 2, moveRange: 4, sightRadius: 5 }),
    createUnit({ id: "Pip", side: "player", pos: { col: -1, row: -1 }, name: "Pip", jobId: "cook", speed: 8, maxHp: 18, attack: 3, defense: 1, moveRange: 3, sightRadius: 4 }),
    createUnit({ id: "Coin", side: "player", pos: { col: -1, row: -1 }, name: "Coin", jobId: "merchant", speed: 8, maxHp: 16, attack: 2, defense: 1, moveRange: 3, sightRadius: 4 }),
    createUnit({ id: "Liora", side: "player", pos: { col: -1, row: -1 }, name: "Liora", jobId: "noble", awareness: 2, intelligence: 5, speed: 8, maxHp: 18, attack: 2, defense: 1, moveRange: 3, sightRadius: 4 }),
    createUnit({ id: "Sterling", side: "player", pos: { col: -1, row: -1 }, name: "Sterling", jobId: "banker", awareness: 2, intelligence: 3, speed: 8, maxHp: 16, attack: 2, defense: 1, moveRange: 3, sightRadius: 4 }),
    createUnit({ id: "Sela", side: "player", pos: { col: -1, row: -1 }, name: "Sela", jobId: "medic", awareness: 3, intelligence: 3, speed: 9, maxHp: 20, attack: 4, defense: 2, moveRange: 3, sightRadius: 4 }),
  ];
}

/** The gear a fresh guild's armory ships with (D25) — one owner of the pair. */
export const STARTER_ARMORY: readonly string[] = ["enchanted-blade", "iron-shield"];
/** A fresh guild's opening treasury (D34). */
export const STARTER_TREASURY = 300;

/** Options for {@link createStarterGuild} — the per-boot bits that legitimately vary. */
export interface StarterGuildOptions {
  mainQuestLabel?: string;
  caravans?: Caravan[];
  difficultyId?: string;
}

/**
 * A fresh **starter guild** (D25): the {@link STARTING_ROSTER}, {@link STARTER_ARMORY}
 * and {@link STARTER_TREASURY} on a never-empty board — the identical opening state the
 * GuildScene's new game and the debug/demo boots all shared as duplicated literals. The
 * caller supplies only what legitimately differs per boot: the main-quest label and the
 * caravans it opens with.
 */
export function createStarterGuild(seed: string | number, opts: StarterGuildOptions = {}): Guild {
  return createGuild(seed, {
    roster: STARTING_ROSTER(),
    armory: [...STARTER_ARMORY],
    treasury: STARTER_TREASURY,
    caravans: opts.caravans,
    mainQuestLabel: opts.mainQuestLabel,
    difficultyId: opts.difficultyId,
  });
}

/** Create a persistent guild with a never-empty board (a main quest + the stream). */
export function createGuild(seed: string | number, opts: CreateGuildOptions = {}): Guild {
  const guild: Guild = {
    seed,
    roster: opts.roster ?? [],
    armory: opts.armory ?? [],
    treasury: opts.treasury ?? 0,
    mercPool: [],
    caravans: opts.caravans ?? [],
    board: [],
    runs: {},
    difficultyId: opts.difficultyId ?? "normal",
    questCounter: 0,
    mercCounter: 0,
  };
  // The main quest (campaign spine) — a fixed, seed-derived record (D26).
  guild.board.push({
    id: "main",
    label: opts.mainQuestLabel ?? "The Main Quest",
    kind: "main",
    generated: false,
    seed: saltSeed(seed, Labels.questMain()),
    payout: GUILD.mainPayout,
  });
  refillBoard(guild);
  return guild;
}

// --- The quest board (never empty, D26) -------------------------------------

/** Roll the next generated sidequest deterministically from the guild seed. */
function generateSidequest(guild: Guild): Quest {
  const n = guild.questCounter++;
  const rng = streamFor(guild.seed, Labels.quest(n));
  const flavours = ["Bandit Camp", "Lost Caravan", "Wolf Den", "Ruined Watchtower", "Salt Road Patrol"];
  const label = rng.pick(flavours);
  return {
    id: `side-${n}`,
    label,
    kind: "side",
    generated: true,
    seed: saltSeed(guild.seed, Labels.quest(n)),
    payout: rng.range(GUILD.sidePayoutMin, GUILD.sidePayoutMax),
  };
}

/**
 * Top the board back up so it always holds {@link GUILD.sidequestPoolSize}
 * generated sidequests (the never-empty guarantee, D26). Called at creation and
 * after a quest is taken.
 */
export function refillBoard(guild: Guild): void {
  let have = guild.board.filter((q) => q.generated).length;
  while (have < GUILD.sidequestPoolSize) {
    guild.board.push(generateSidequest(guild));
    have++;
  }
}

/** Look up a quest on the board by id. */
export function getQuest(guild: Guild, questId: string): Quest | undefined {
  return guild.board.find((q) => q.id === questId);
}

// --- The pool (availability under the lock, D25/D26) ------------------------

/** Roster characters **not** committed to any caravan (the available pool, D26). */
export function availableRoster(guild: Guild): Unit[] {
  const committed = committedMemberIds(guild.caravans);
  return guild.roster.filter((u) => !committed.has(u.id));
}

/** Armory gear **not** locked to any caravan (the available stock, D25). */
export function availableGear(guild: Guild): string[] {
  const committed = committedGearIds(guild.caravans);
  return guild.armory.filter((g) => !committed.has(g));
}

// --- Dispatch (commitment parallel, D26) ------------------------------------

/** Why a caravan can't be dispatched to a quest right now, or `null` if it can. */
export function dispatchRefusal(guild: Guild, caravan: Caravan, quest: Quest): string | null {
  if (caravan.dispatched) return "Caravan already dispatched.";
  if (caravan.party.length === 0) return "Caravan has no party.";
  if (!getQuest(guild, quest.id)) return "Quest is no longer on the board.";
  if (guild.treasury < caravan.purse) return "Treasury can't cover the purse.";
  return null;
}

/**
 * Dispatch a caravan to a quest (D26): debit the purse from the treasury, build a
 * deterministic {@link RunState} from the caravan targeting the quest's seed,
 * **lock** the caravan (its people + gear + purse are now committed out of the
 * pool), take the quest off the board (and refill the generated stream so it stays
 * non-empty), and register the run. Returns the in-flight {@link GuildRun}. The
 * caravan now **waits** until the render plays it — no clock, no auto-resolve.
 */
export function dispatch(guild: Guild, caravan: Caravan, quest: Quest): GuildRun {
  const refusal = dispatchRefusal(guild, caravan, quest);
  if (refusal) throw new Error(`guild: ${refusal}`);

  // Load the purse from the treasury (D34).
  guild.treasury -= caravan.purse;

  const run = createRunFromCaravan(quest.seed, caravan, { difficultyId: guild.difficultyId });
  caravan.dispatched = true;

  // Take the quest off the board; keep the generated stream topped up (D26).
  guild.board = guild.board.filter((q) => q.id !== quest.id);
  refillBoard(guild);

  const gr: GuildRun = { caravanId: caravan.id, questId: quest.id, run, payout: quest.payout };
  guild.runs[caravan.id] = gr;
  return gr;
}

/** The in-flight run for a caravan, if it's dispatched. */
export function runFor(guild: Guild, caravanId: string): GuildRun | undefined {
  return guild.runs[caravanId];
}

/** Dispatched caravans still in flight (their runs not yet resolved). */
export function inFlightCaravans(guild: Guild): Caravan[] {
  return guild.caravans.filter((c) => c.dispatched && guild.runs[c.id]);
}

// --- Resolution: return vs. wipe (D27) --------------------------------------

/** What a resolved caravan produced, surfaced at the hall (D27). */
export interface CaravanResolution {
  caravanId: string;
  questId: string;
  outcome: "returned" | "wiped";
  /** Unit ids that rejoined the pool (a return; empty on a wipe). */
  survivors: string[];
  /** Unit ids lost to permadeath (mid-run on a return; all aboard on a wipe). */
  lost: string[];
  /** Gear ids unlocked back to the armory (a return; none on a wipe). */
  gearReturned: string[];
  /** Gear ids lost for good (a wipe). */
  gearLost: string[];
  /** Purse gold flowed back to the treasury (a return). */
  purseReturned: number;
  /** Purse gold lost (a wipe). */
  purseLost: number;
  /**
   * Quest **payout** banked to the treasury (M10, D34) — only on a completed
   * **return**; a wipe earns nothing. The treasury's only faucet (with the
   * returning purse) — there is no passive growth.
   */
  payout: number;
  /** D27 stakes seam: a named lord was aboard a wiped caravan (no game-over built). */
  lordLost: boolean;
}

/**
 * Resolve a dispatched caravan from its run's **terminal** (D27):
 *
 * - **Return** (the run completed, not over): mid-run permadeaths leave the roster;
 *   survivors stay in the pool; locked gear unlocks back to the armory; the
 *   **surviving purse** (`run.camp.gold`) flows home to the treasury.
 * - **Wipe** ({@link isRunOver}): the caravan's **people leave the roster**
 *   (permadeath), its **locked gear is lost**, and the **purse is lost** — but the
 *   **guild survives** (rebuild via {@link hireMercenary}). A named **lord** aboard
 *   flags `lordLost` (the game-over/reload path is a later pass — D27 seam only).
 *
 * Either way the caravan is reset to empty/assembling and its run is cleared.
 */
export function resolveReturn(guild: Guild, caravan: Caravan, run: RunState): CaravanResolution {
  const wiped = isRunOver(run);
  const questId = guild.runs[caravan.id]?.questId ?? "";
  const questPayout = guild.runs[caravan.id]?.payout ?? 0;
  const survivorIds = new Set(run.party.map((u) => u.id));

  const survivors: string[] = [];
  const lost: string[] = [];
  let lordLost = false;

  if (wiped) {
    // Everyone aboard is lost (D27). Remove them from the roster.
    for (const u of caravan.party) {
      lost.push(u.id);
      if (u.isLord) lordLost = true;
      removeFromGuildRoster(guild, u.id);
    }
  } else {
    // A return: only mid-run permadeaths are gone; survivors rejoin the pool.
    for (const u of caravan.party) {
      if (survivorIds.has(u.id)) survivors.push(u.id);
      else {
        lost.push(u.id);
        removeFromGuildRoster(guild, u.id);
      }
    }
  }

  // Gear: a return unlocks it back to the armory; a wipe loses it.
  const gearReturned: string[] = [];
  const gearLost: string[] = [];
  for (const g of caravan.gear) {
    if (wiped) {
      gearLost.push(g);
      const i = guild.armory.indexOf(g);
      if (i >= 0) guild.armory.splice(i, 1);
    } else {
      gearReturned.push(g);
    }
  }

  // Purse: a return flows the surviving purse home; a wipe loses it (D34).
  let purseReturned = 0;
  let purseLost = 0;
  if (wiped) {
    purseLost = caravan.purse;
  } else {
    purseReturned = Math.max(0, run.camp.gold);
    guild.treasury += purseReturned;
  }

  // Payout (M10, D34): a **completed** quest banks its payout to the treasury —
  // the treasury's only earned faucet. A wipe (or an incomplete return) earns none.
  const payout = !wiped && run.complete ? questPayout : 0;
  guild.treasury += payout;

  resetCaravan(caravan);
  delete guild.runs[caravan.id];

  return {
    caravanId: caravan.id,
    questId,
    outcome: wiped ? "wiped" : "returned",
    survivors,
    lost,
    gearReturned,
    gearLost,
    purseReturned,
    purseLost,
    payout,
    lordLost,
  };
}

/** Remove a unit id from the roster pool (permadeath). */
function removeFromGuildRoster(guild: Guild, unitId: string): void {
  const i = guild.roster.findIndex((u) => u.id === unitId);
  if (i >= 0) guild.roster.splice(i, 1);
}

// --- The rebuild valve: hire a mercenary (D27) ------------------------------

/**
 * Hire a mercenary into the roster (the "guild never hard-fails" valve, D27):
 * spend {@link GUILD.mercCost} from the treasury and roll a fresh fighter
 * **deterministically** from the guild seed (a randomized, expendable merc — D33).
 * Returns the new unit, or `null` if the treasury can't afford it. A wiped-bare
 * guild can always rebuild here.
 */
export function hireMercenary(guild: Guild): Unit | null {
  if (guild.treasury < GUILD.mercCost) return null;
  guild.treasury -= GUILD.mercCost;
  const merc = rollMercenary(guild.seed, guild.mercCounter++);
  guild.roster.push(merc);
  return merc;
}

/**
 * **Buy one gear into the armory** (D34): the vault funds the armory. Mints a fresh
 * `blade-<n>` id (n = current armory size, so ids don't collide), spends
 * {@link GUILD.armoryCost} from the treasury, and appends it to the armory. Returns the
 * new gear id, or `null` if the treasury can't afford it. The economy rule the GuildScene
 * used to inline (price constant, id minting, treasury mutation all render-side).
 */
export function buyArmoryGear(guild: Guild): string | null {
  if (guild.treasury < GUILD.armoryCost) return null;
  const gearId = `blade-${guild.armory.length}`;
  guild.treasury -= GUILD.armoryCost;
  guild.armory.push(gearId);
  return gearId;
}

/** Roll a randomized mercenary from a seed + index (deterministic, D33). */
export function rollMercenary(seed: string | number, index: number): Unit {
  const rng: Rng = streamFor(seed, Labels.merc(index));
  const recruitable: JobId[] = ["soldier", "survivalist"];
  const jobId = rng.pick(recruitable);
  const names = ["Ash", "Bran", "Cael", "Dax", "Esk", "Fen", "Garr", "Hale"];
  const name = rng.pick(names);
  return createUnit({
    id: `merc-${index}`,
    side: "player",
    pos: { col: -1, row: -1 },
    name,
    jobId,
    speed: rng.range(9, 12),
    maxHp: rng.range(20, 30),
    attack: rng.range(7, 11),
    defense: rng.range(1, 3),
    moveRange: 4,
    sightRadius: 5,
    awareness: rng.range(1, 4),
    intelligence: rng.range(1, 4),
  });
}
