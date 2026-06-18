import { describe, it, expect } from "vitest";
import { createUnit, type Unit } from "./units";
import {
  createGuild,
  dispatch,
  resolveReturn,
  hireMercenary,
  rollMercenary,
  availableRoster,
  availableGear,
  inFlightCaravans,
  getQuest,
  refillBoard,
  runFor,
  GUILD,
  type Guild,
} from "./guild";
import {
  createCaravan,
  assignMember,
  lockGear,
  loadPurse,
} from "./caravan";
import { RunLoop } from "./runloop";

let nextId = 0;
function fighter(name: string, lord = false): Unit {
  return createUnit({
    id: `${name}-${nextId++}`,
    side: "player",
    pos: { col: -1, row: -1 },
    name,
    jobId: "soldier",
    speed: 11,
    maxHp: 28,
    attack: 9,
    defense: 3,
    moveRange: 4,
    sightRadius: 5,
    awareness: 3,
    intelligence: 3,
    isLord: lord,
  });
}

/** A guild with a roster, an armory, treasury and two empty caravans. */
function guildWith(seed: string, names: string[]): Guild {
  const roster = names.map((n) => fighter(n));
  return createGuild(seed, {
    roster,
    armory: ["enchanted-blade", "iron-shield"],
    treasury: 500,
    caravans: [createCaravan("alpha", "supply-train"), createCaravan("beta", "scout-cart")],
  });
}

describe("guild — the quest board is never empty (D26)", () => {
  it("opens with a main quest + a repeating generated sidequest stream", () => {
    const g = guildWith("board", ["Rook"]);
    expect(g.board.some((q) => q.kind === "main")).toBe(true);
    expect(g.board.filter((q) => q.generated).length).toBeGreaterThanOrEqual(1);
    expect(g.board.length).toBeGreaterThanOrEqual(2);
  });

  it("taking quests still leaves the board non-empty (the stream refills)", () => {
    const g = guildWith("board2", ["Rook"]);
    // Drain every generated quest currently shown, refilling each time.
    for (let i = 0; i < 5; i++) {
      const side = g.board.find((q) => q.generated)!;
      g.board = g.board.filter((q) => q.id !== side.id);
      refillBoard(g);
      expect(g.board.filter((q) => q.generated).length).toBe(GUILD.sidequestPoolSize);
    }
  });
});

describe("guild — dispatch builds a deterministic run from a caravan (D25/D26)", () => {
  it("locks people/gear/purse and builds a run from the caravan bundle", () => {
    const g = guildWith("dispatch", ["Rook", "Vale", "Pip"]);
    const c = g.caravans[0];
    const [rook, vale] = g.roster;
    assignMember(c, rook);
    assignMember(c, vale);
    lockGear(c, "enchanted-blade");
    loadPurse(c, 120);

    const quest = g.board.find((q) => q.generated)!;
    const before = g.treasury;
    const gr = dispatch(g, c, quest);

    // The run mirrors the caravan bundle.
    expect(gr.run.seed).toBe(quest.seed);
    expect(gr.run.party.map((u) => u.id)).toEqual([rook.id, vale.id]);
    expect(gr.run.camp.gold).toBe(120); // the purse
    expect(gr.run.inventory.storageCap).toBe(c.storageCap);

    // Treasury debited by the purse (D34); caravan now locked out of the pool.
    expect(g.treasury).toBe(before - 120);
    expect(c.dispatched).toBe(true);
    expect(availableRoster(g).map((u) => u.id)).not.toContain(rook.id);
    expect(availableGear(g)).not.toContain("enchanted-blade");
    // Quest left the board; the stream stayed topped up.
    expect(getQuest(g, quest.id)).toBeUndefined();
    expect(g.board.filter((q) => q.generated).length).toBe(GUILD.sidequestPoolSize);
  });

  it("the run is built from a COPY of the party (permadeath can't shrink the caravan)", () => {
    const g = guildWith("copy", ["Rook", "Vale"]);
    const c = g.caravans[0];
    assignMember(c, g.roster[0]);
    assignMember(c, g.roster[1]);
    const gr = dispatch(g, c, g.board.find((q) => q.generated)!);
    gr.run.party.pop();
    expect(c.party.length).toBe(2);
  });
});

describe("guild — N caravans in flight, played serially; waiting ones untouched (D26)", () => {
  it("dispatches two caravans; playing one leaves the other paused", () => {
    const g = guildWith("serial", ["A", "B", "C", "D"]);
    const [a, b, c, d] = g.roster;

    const carA = g.caravans[0];
    assignMember(carA, a);
    assignMember(carA, b);
    const carB = g.caravans[1];
    assignMember(carB, c);
    assignMember(carB, d);

    const mainQuest = getQuest(g, "main")!;
    const sideQuest = g.board.find((q) => q.generated)!;
    const grA = dispatch(g, carA, mainQuest);
    const grB = dispatch(g, carB, sideQuest);

    expect(inFlightCaravans(g).length).toBe(2);

    // Snapshot the waiting caravan's run before playing the other.
    const bNightBefore = grB.run.night;
    const bPosBefore = grB.run.mapNodeId;

    // Play caravan A serially to a terminal — B must not tick.
    const loopA = new RunLoop(grA.run);
    loopA.autoTraverse();
    expect(loopA.isTerminal()).toBe(true);

    expect(grB.run.night).toBe(bNightBefore);
    expect(grB.run.mapNodeId).toBe(bPosBefore);
    expect(runFor(g, "beta")).toBeDefined(); // still in flight, waiting
  });
});

describe("guild — return flows survivors/gear/purse home (D27/D34)", () => {
  it("a completed run rejoins survivors, unlocks gear, banks the surviving purse", () => {
    const g = guildWith("return", ["Rook", "Vale"]);
    const c = g.caravans[0];
    assignMember(c, g.roster[0]);
    assignMember(c, g.roster[1]);
    lockGear(c, "enchanted-blade");
    loadPurse(c, 100);
    const gr = dispatch(g, c, g.board.find((q) => q.generated)!);

    // Force a clean completion with a surviving purse.
    gr.run.complete = true;
    gr.run.camp.gold = 140;
    const treasuryBefore = g.treasury;

    const res = resolveReturn(g, c, gr.run);
    expect(res.outcome).toBe("returned");
    expect(res.survivors.sort()).toEqual(g.roster.map((u) => u.id).sort());
    expect(res.gearReturned).toContain("enchanted-blade");
    expect(res.purseReturned).toBe(140);

    // Pool/armory/treasury reconciled; caravan freed. A completed return now also
    // banks the quest payout (M10, D34) on top of the surviving purse.
    expect(res.payout).toBeGreaterThan(0);
    expect(g.treasury).toBe(treasuryBefore + 140 + res.payout);
    expect(availableGear(g)).toContain("enchanted-blade");
    expect(availableRoster(g).length).toBe(2);
    expect(c.dispatched).toBe(false);
    expect(runFor(g, c.id)).toBeUndefined();
  });

  it("mid-run permadeaths don't rejoin the pool on return", () => {
    const g = guildWith("partial", ["Rook", "Vale"]);
    const c = g.caravans[0];
    assignMember(c, g.roster[0]);
    assignMember(c, g.roster[1]);
    const gr = dispatch(g, c, g.board.find((q) => q.generated)!);
    const rookId = c.party[0].id;
    const valeId = c.party[1].id;
    // Vale fell mid-run (spliced from the run's party copy); the run still completed.
    gr.run.party = gr.run.party.filter((u) => u.id !== valeId);
    gr.run.complete = true;

    const res = resolveReturn(g, c, gr.run);
    expect(res.survivors).toEqual([rookId]);
    expect(res.lost).toEqual([valeId]);
    // The fallen leaves the pool; the survivor stays.
    expect(g.roster.map((u) => u.id)).toEqual([rookId]);
  });
});

describe("guild — a wipe costs people + gear + purse; the guild survives (D27)", () => {
  it("removes the caravan's people from the roster and loses its gear/purse", () => {
    const g = guildWith("wipe", ["Rook", "Vale", "Spare"]);
    const c = g.caravans[0];
    const spareId = g.roster[2].id;
    assignMember(c, g.roster[0]); // Rook
    assignMember(c, g.roster[1]); // Vale
    lockGear(c, "enchanted-blade");
    loadPurse(c, 90);
    const gr = dispatch(g, c, g.board.find((q) => q.generated)!);

    // Force a wipe: every combatant down ⇒ isRunOver true.
    for (const u of gr.run.party) u.alive = false;
    const res = resolveReturn(g, c, gr.run);

    expect(res.outcome).toBe("wiped");
    expect(res.lost.length).toBe(2);
    expect(res.gearLost).toContain("enchanted-blade");
    expect(res.purseLost).toBe(90);
    expect(res.purseReturned).toBe(0);

    // The guild survives: roster only lost the two aboard; the spare remains.
    expect(g.roster.map((u) => u.id)).toEqual([spareId]);
    // The lost gear is gone from the armory for good; the rest remains.
    expect(g.armory).not.toContain("enchanted-blade");
    expect(g.armory).toContain("iron-shield");
  });

  it("the guild survives a wipe and can rebuild via a merc hire", () => {
    const g = guildWith("rebuild", ["Rook"]);
    const c = g.caravans[0];
    assignMember(c, g.roster[0]);
    const gr = dispatch(g, c, g.board.find((q) => q.generated)!);
    for (const u of gr.run.party) u.alive = false;
    resolveReturn(g, c, gr.run);

    // Wiped bare — but the guild persists and the valve works.
    expect(g.roster.length).toBe(0);
    const merc = hireMercenary(g);
    expect(merc).not.toBeNull();
    expect(g.roster.length).toBe(1);
    expect(merc!.jobId).toBeDefined(); // a fightable body to rebuild with
  });

  it("a lord aboard a wiped caravan flags lordLost (no game-over built — D27 seam)", () => {
    const g = guildWith("lord", ["Edrin"]);
    g.roster[0] = fighter("Edrin", true);
    g.roster.length = 1;
    const c = g.caravans[0];
    assignMember(c, g.roster[0]);
    const gr = dispatch(g, c, g.board.find((q) => q.generated)!);
    for (const u of gr.run.party) u.alive = false;
    const res = resolveReturn(g, c, gr.run);
    expect(res.lordLost).toBe(true);
  });
});

describe("guild — the rebuild valve is deterministic (D27/D33)", () => {
  it("same seed + index rolls the identical mercenary", () => {
    const m1 = rollMercenary("seed-x", 0);
    const m2 = rollMercenary("seed-x", 0);
    expect({ ...m1, statuses: [], counters: {} }).toEqual({ ...m2, statuses: [], counters: {} });
    const m3 = rollMercenary("seed-x", 1);
    expect(m3.id).not.toBe(m1.id);
  });

  it("hiring fails when the treasury can't afford it", () => {
    const g = guildWith("broke", ["Rook"]);
    g.treasury = GUILD.mercCost - 1;
    expect(hireMercenary(g)).toBeNull();
    expect(g.roster.length).toBe(1);
  });
});
