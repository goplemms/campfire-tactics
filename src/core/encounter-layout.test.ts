/**
 * Battle setup as one pipeline — both level sources normalize to one {@link EncounterLayout}, and
 * {@link stageEncounter} builds every battle from it. Pure (no Phaser).
 */
import { describe, it, expect } from "vitest";
import { streamFor } from "./rng";
import { Labels } from "./rng-labels";
import { generateEncounter, layoutFromGenerated } from "./generation";
import { layoutFromAuthored, type AuthoredEncounter } from "./authored";
import { encounterLayout, stageEncounter } from "./staging";
import { placeStartingParty } from "./party-placement";
import { TileGrid } from "./grid";
import { createUnit, type Unit } from "./units";

const REWARD = { gold: 0, materials: [] };

function hero(id: string): Unit {
  return createUnit({ id, side: "player", pos: { col: 0, row: 0 }, speed: 10, maxHp: 20, attack: 5, defense: 1, moveRange: 4, sightRadius: 5 });
}

/** A small authored level with one of everything the layout carries. */
function authored(extra: Partial<AuthoredEncounter> = {}): AuthoredEncounter {
  return {
    id: "layout-probe",
    name: "Layout probe",
    cols: 6,
    rows: 4,
    blocked: [{ col: 3, row: 3 }],
    playerSpawns: [{ col: 0, row: 1 }, { col: 0, row: 2 }],
    enemies: [
      { templateId: "bandit-thug", pos: { col: 5, row: 0 }, role: "captain", overrides: { maxHp: 40 } },
      { templateId: "bandit-bowman", pos: { col: 5, row: 2 }, hidden: true },
    ],
    captives: [{ spec: { id: "cook", side: "player", pos: { col: 0, row: 0 }, speed: 8, maxHp: 14, attack: 3, defense: 1, moveRange: 3, sightRadius: 4 }, pos: { col: 4, row: 1 } }],
    gates: [{ id: "cell", pos: { col: 4, row: 0 }, openBy: [{ kind: "lockpick" }] }],
    levers: [{ id: "pull", pos: { col: 2, row: 0 }, targets: ["cell"] }],
    traps: [{ pos: { col: 2, row: 2 }, concealment: 2 }],
    reward: REWARD,
    ...extra,
  };
}

describe("the encounter layout — one shape for every level", () => {
  it("an authored level normalizes its placements into stat blocks off their templates", () => {
    const layout = layoutFromAuthored(authored());
    const [thug, bowman] = layout.enemies;
    expect(thug.spec).toMatchObject({ id: "bandit-thug@5,0", side: "enemy", role: "captain", maxHp: 40 });
    expect(thug.hidden).toBe(false);
    expect(bowman.hidden).toBe(true);
    expect(layout.objectives.some((o) => o.kind === "eliminate-all")).toBe(true); // the default goal
  });

  it("a generated encounter normalizes to the same shape, with no fixed spawns", () => {
    const def = generateEncounter(streamFor("layout", Labels.enc(1)), 1);
    const layout = layoutFromGenerated(def);
    expect(layout.enemies.map((e) => e.spec)).toEqual(def.enemies);
    expect(layout.playerSpawns).toBeUndefined();
    expect(layout.captives).toEqual([]);
    expect(encounterLayout(def)).toEqual(layout);
  });

  it("stageEncounter builds everything the layout carries onto one battle", () => {
    const staged = stageEncounter(authored(), [hero("a"), hero("b")], { revealHidden: true, markTrapsUpTo: 3 });
    const { battle } = staged;
    expect(battle.grid.isWalkable({ col: 3, row: 3 })).toBe(false);
    expect(battle.units.filter((u) => u.side === "enemy").every((u) => !u.hidden)).toBe(true); // ambush blown
    expect(battle.units.find((u) => u.id === "cook")?.captured).toBe(true);
    expect(battle.gates.map((g) => g.id)).toEqual(["cell"]);
    expect(battle.levers.map((l) => l.id)).toEqual(["pull"]);
    expect(battle.entities.all().length).toBe(1); // the pre-placed trap
    expect(staged.objectives.length).toBeGreaterThan(0);
  });
});

describe("placeStartingParty — the opening placement policy", () => {
  const zoned = authored({
    spawnZones: [
      { id: "front", label: "Front", tiles: [{ col: 1, row: 3 }], cap: 4, primary: true },
      { id: "side", label: "Side", tiles: [{ col: 2, row: 1 }], cap: 1, requiresFlag: "side-intel" },
    ],
  });

  it("an explicit override beats every other policy", () => {
    const party = [hero("a")];
    const layout = layoutFromAuthored(zoned);
    placeStartingParty(party, layout, TileGrid.fromLayout(layout), { playerSpawns: [{ col: 2, row: 2 }] });
    expect(party[0].pos).toEqual({ col: 2, row: 2 });
  });

  it("a zoned level starts everyone in its primary zone", () => {
    const party = [hero("a"), hero("b")];
    const layout = layoutFromAuthored(zoned, { "side-intel": true });
    placeStartingParty(party, layout, TileGrid.fromLayout(layout));
    expect(party.map((u) => u.pos)).toEqual([{ col: 1, row: 3 }, { col: 1, row: 3 }]);
  });

  it("an unzoned authored level uses its fixed spawns", () => {
    const party = [hero("a"), hero("b")];
    const layout = layoutFromAuthored(authored());
    placeStartingParty(party, layout, TileGrid.fromLayout(layout));
    expect(party.map((u) => u.pos)).toEqual([{ col: 0, row: 1 }, { col: 0, row: 2 }]);
  });

  it("a generated level fills the home edge", () => {
    const party = [hero("a"), hero("b")];
    const layout = layoutFromGenerated(generateEncounter(streamFor("edge", Labels.enc(0)), 0));
    placeStartingParty(party, layout, TileGrid.fromLayout(layout));
    for (const u of party) expect(u.pos.col).toBeLessThan(2);
  });
});
