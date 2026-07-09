import { describe, it, expect } from "vitest";
import {
  STARTING_ROSTER,
  STARTER_ARMORY,
  STARTER_TREASURY,
  createStarterGuild,
  buyArmoryGear,
  createCaravan,
  GUILD,
  toggleUpkeepSkip,
  createCamp,
  type RunState,
} from "./index";

// #135 core-leak 1: the starting roster used to be typed out verbatim in two render
// files (GuildScene.freshGuild + debug-battle.demoRoster). This pins the authored table
// so a stat edit can't silently drift the two copies apart (there is now one).
describe("STARTING_ROSTER (the authored starter cast)", () => {
  it("is the eight-strong authored roster, exact stats (drift guard)", () => {
    const authored = STARTING_ROSTER().map((u) => ({
      id: u.id,
      jobId: u.jobId,
      isLord: u.isLord,
      awareness: u.awareness,
      intelligence: u.intelligence,
      speed: u.speed,
      maxHp: u.maxHp,
      attack: u.attack,
      defense: u.defense,
      moveRange: u.moveRange,
      sightRadius: u.sightRadius,
    }));
    expect(authored).toEqual([
      { id: "Edrin", jobId: "soldier", isLord: true, awareness: 5, intelligence: 4, speed: 12, maxHp: 34, attack: 11, defense: 4, moveRange: 4, sightRadius: 5 },
      { id: "Rook", jobId: "soldier", isLord: false, awareness: 4, intelligence: 4, speed: 12, maxHp: 30, attack: 9, defense: 3, moveRange: 4, sightRadius: 5 },
      { id: "Vale", jobId: "scout", isLord: false, awareness: 2, intelligence: 2, speed: 10, maxHp: 24, attack: 11, defense: 2, moveRange: 4, sightRadius: 5 },
      { id: "Pip", jobId: "cook", isLord: false, awareness: 0, intelligence: 0, speed: 8, maxHp: 18, attack: 3, defense: 1, moveRange: 3, sightRadius: 4 },
      { id: "Coin", jobId: "merchant", isLord: false, awareness: 0, intelligence: 0, speed: 8, maxHp: 16, attack: 2, defense: 1, moveRange: 3, sightRadius: 4 },
      { id: "Liora", jobId: "noble", isLord: false, awareness: 2, intelligence: 5, speed: 8, maxHp: 18, attack: 2, defense: 1, moveRange: 3, sightRadius: 4 },
      { id: "Sterling", jobId: "banker", isLord: false, awareness: 2, intelligence: 3, speed: 8, maxHp: 16, attack: 2, defense: 1, moveRange: 3, sightRadius: 4 },
      { id: "Sela", jobId: "medic", isLord: false, awareness: 3, intelligence: 3, speed: 9, maxHp: 20, attack: 4, defense: 2, moveRange: 3, sightRadius: 4 },
    ]);
  });

  it("returns fresh unit objects each call (no aliasing across boots)", () => {
    const a = STARTING_ROSTER();
    const b = STARTING_ROSTER();
    expect(a[0]).not.toBe(b[0]);
    a[0].hp = 1;
    expect(b[0].hp).toBe(b[0].maxHp);
  });
});

describe("createStarterGuild", () => {
  it("seeds the roster, armory and treasury, threading caravans + quest label", () => {
    const guild = createStarterGuild("seed-1", {
      mainQuestLabel: "The Sunken Keep",
      caravans: [createCaravan("alpha", "supply-train")],
    });
    expect(guild.roster.map((u) => u.id)).toEqual(STARTING_ROSTER().map((u) => u.id));
    expect(guild.armory).toEqual([...STARTER_ARMORY]);
    expect(guild.treasury).toBe(STARTER_TREASURY);
    expect(guild.caravans.map((c) => c.id)).toEqual(["alpha"]);
    expect(guild.board[0].label).toBe("The Sunken Keep");
  });
});

describe("buyArmoryGear (D34 economy rule, was inline in the scene)", () => {
  it("mints blade-<n>, debits the treasury, appends to the armory", () => {
    const guild = createStarterGuild("seed-2");
    const before = guild.armory.length;
    const id = buyArmoryGear(guild);
    expect(id).toBe(`blade-${before}`);
    expect(guild.armory).toContain(id);
    expect(guild.armory.length).toBe(before + 1);
    expect(guild.treasury).toBe(STARTER_TREASURY - GUILD.armoryCost);
  });

  it("refuses (spends nothing) when the treasury can't afford it", () => {
    const guild = createStarterGuild("seed-3");
    guild.treasury = GUILD.armoryCost - 1;
    const before = guild.armory.length;
    expect(buyArmoryGear(guild)).toBeNull();
    expect(guild.armory.length).toBe(before);
    expect(guild.treasury).toBe(GUILD.armoryCost - 1);
  });
});

describe("toggleUpkeepSkip (D45, was a render-side type-assertion write)", () => {
  it("flips a line in and out of camp.skippedUpkeep", () => {
    const run = { camp: createCamp() } as unknown as RunState;
    expect(run.camp.skippedUpkeep).toEqual([]);
    toggleUpkeepSkip(run, "food");
    expect(run.camp.skippedUpkeep).toEqual(["food"]);
    toggleUpkeepSkip(run, "repairs");
    expect(new Set(run.camp.skippedUpkeep)).toEqual(new Set(["food", "repairs"]));
    toggleUpkeepSkip(run, "food");
    expect(run.camp.skippedUpkeep).toEqual(["repairs"]);
  });
});
