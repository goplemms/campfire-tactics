import { describe, it, expect } from "vitest";
import { frontTurnStage, deployActions, type DeployActionContext } from "./deploy-flow";
import { createFront, createCampfire, advanceFront, type FrontTurnOutcome } from "./deployment";
import { TileGrid } from "./grid";
import { createUnit, type Unit } from "./units";

const player = (id: string): Unit =>
  createUnit({ id, side: "player", pos: { col: 0, row: 0 }, awareness: 2, speed: 10, maxHp: 20, attack: 5, defense: 1, moveRange: 3, sightRadius: 4 });

const outcome = (captured: Unit | null, breached = false): FrontTurnOutcome => ({
  advancedTo: 1,
  captured,
  rolled: [],
  alarm: captured !== null,
  breached,
});

describe("frontTurnStage — what the deploy phase does after the net's turn", () => {
  const grid = () => new TileGrid(8, 5);

  it("a catch → capture stage (alarm, battle begins)", () => {
    const g = grid();
    const camp = createCampfire(g, [player("a")]);
    const front = createFront(g, [player("e")]);
    expect(frontTurnStage(outcome(player("c")), g, camp, front).kind).toBe("capture");
  });

  it("no catch but safe ground remains → continue", () => {
    const g = grid();
    const camp = createCampfire(g, [player("a")]);
    const front = createFront(g, [player("e")]); // radius 0, nowhere near the camp
    expect(frontTurnStage(outcome(null), g, camp, front).kind).toBe("continue");
  });

  it("no catch and the net has overrun the camp → overrun (battle begins anyway)", () => {
    const g = grid();
    const camp = createCampfire(g, [player("a")]);
    const front = createFront(g, [player("e")]);
    for (let i = 0; i < 30; i++) advanceFront(front); // swallow the whole board
    expect(frontTurnStage(outcome(null), g, camp, front).kind).toBe("overrun");
  });

  it("no catch but the net reached the protected core → overrun (a breach, nobody taken)", () => {
    const g = grid();
    const camp = createCampfire(g, [player("a")]);
    const front = createFront(g, [player("e")]); // radius 0 — safe ground still remains
    // The breach flag alone starts the battle, even with safe ground left on the board.
    expect(frontTurnStage(outcome(null, true), g, camp, front).kind).toBe("overrun");
  });
});

describe("deployActions — the meta-control decision (D67)", () => {
  const base: DeployActionContext = { hasActor: true, captured: false, canUndo: false };

  it("a fresh turn offers just Start Battle (nothing to undo)", () => {
    expect(deployActions(base)).toEqual(["startBattle"]);
  });

  it("Undo leads once there's something to take back", () => {
    expect(deployActions({ ...base, canUndo: true })).toEqual(["undo", "startBattle"]);
  });

  it("between turns (no actor) only Start Battle shows", () => {
    expect(deployActions({ ...base, hasActor: false, canUndo: true })).toEqual(["startBattle"]);
  });

  it("a captured active unit can only Start Battle", () => {
    expect(deployActions({ ...base, captured: true, canUndo: true })).toEqual(["startBattle"]);
  });
});
