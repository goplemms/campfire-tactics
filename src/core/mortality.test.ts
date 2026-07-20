import { describe, it, expect } from "vitest";
import { createUnit, type Unit } from "./units";
import {
  DIFFICULTIES,
  getDifficulty,
  resolveDowned,
  resolveCaptured,
  isDying,
  advanceDyingClocksOneNight,
  DYING_COUNTER,
} from "./mortality";

function downed(id = "u"): Unit {
  const u = createUnit({
    id,
    side: "player",
    pos: { col: 0, row: 0 },
    speed: 10,
    maxHp: 24,
    attack: 6,
    defense: 2,
    moveRange: 4,
    sightRadius: 5,
  });
  u.hp = 0;
  u.alive = false;
  return u;
}

describe("mortality — downed resolution per difficulty (D9)", () => {
  it("Easy fully heals a downed unit on rest", () => {
    const u = downed();
    const out = resolveDowned(DIFFICULTIES.easy, u);
    expect(out.resolution).toBe("full-heal");
    expect(u.alive).toBe(true);
    expect(u.hp).toBe(u.maxHp);
    expect(out.permadeath).toBe(false);
  });

  it("Normal redeploys a downed unit at ½ HP (no permadeath)", () => {
    const u = downed();
    const out = resolveDowned(DIFFICULTIES.normal, u);
    expect(out.resolution).toBe("half-redeploy");
    expect(u.alive).toBe(true);
    expect(u.hp).toBe(Math.floor(u.maxHp / 2));
    expect(out.permadeath).toBe(false);
  });

  it("Hard starts a dying timer (cleric clock), not permadeath", () => {
    const u = downed();
    const out = resolveDowned(DIFFICULTIES.hard, u);
    expect(out.resolution).toBe("dying-timer");
    expect(u.alive).toBe(false);
    expect(u.counters[DYING_COUNTER]).toBe(DIFFICULTIES.hard.dyingNights);
    expect(isDying(u)).toBe(true);
    expect(out.permadeath).toBe(false);
  });

  it("Hardest is flat permadeath at 0", () => {
    const u = downed();
    const out = resolveDowned(DIFFICULTIES.hardest, u);
    expect(out.resolution).toBe("permadeath");
    expect(out.permadeath).toBe(true);
    expect(out.survived).toBe(false);
  });
});

describe("mortality — dying clock", () => {
  it("ticks down over nights and reports permadeath when it runs out", () => {
    const u = downed();
    resolveDowned(DIFFICULTIES.hard, u); // 3 nights
    expect(advanceDyingClocksOneNight([u])).toEqual([]); // 2 left
    expect(advanceDyingClocksOneNight([u])).toEqual([]); // 1 left
    const lost = advanceDyingClocksOneNight([u]); // 0 → lost
    expect(lost).toContain(u);
  });
});

describe("mortality — captured resolves into a rescue follow-up (D9)", () => {
  it("produces a rescue quest with the policy's window + deployment penalty", () => {
    const u = downed("captive");
    u.alive = true;
    u.captured = true;
    const quest = resolveCaptured(DIFFICULTIES.hard, u);
    expect(quest.unitId).toBe("captive");
    expect(quest.resolution).toBe("rescue-narrow");
    expect(quest.nights).toBe(DIFFICULTIES.hard.rescueNights);
    expect(quest.deploymentPenalty).toBe(DIFFICULTIES.hard.rescueDeploymentPenalty);
  });
});

describe("mortality — policy lookup", () => {
  it("difficulty scales rpPerChunk across the gradient (D9 single dial)", () => {
    expect(DIFFICULTIES.easy.rpPerChunk).toBeLessThan(DIFFICULTIES.hardest.rpPerChunk);
  });
  it("unknown id falls back to Normal", () => {
    expect(getDifficulty("bogus").id).toBe("normal");
    expect(getDifficulty(undefined).id).toBe("normal");
  });
});
