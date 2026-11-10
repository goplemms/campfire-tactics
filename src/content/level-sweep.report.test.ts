import { describe, it, expect } from "vitest";
import { THE_HOLLOW_MILL, playEncounterStart, sweepPartyLevel, type EncounterStartReport } from "../core";
import { injectContentNodes } from "./authored-nodes";

/**
 * **The finale level sweep** (`npm run sweep`) — The Rescue played by the Hollow Mill party that
 * arrives on each arc route, re-levelled 1…10, plus the party exactly as it arrives. Pre-finale
 * levels are provisional until the expedition's length is designed *back from* the level the finale
 * expects; this table is where that number comes from.
 *
 * Lives in `content/` because The Rescue's body is injected from JSON (core can't import content).
 * Like the feasibility report it writes straight to stdout; the assertions only pin what must hold
 * for the table to mean anything (deterministic, and the level lever actually moves the outcome).
 */
injectContentNodes();

declare const process: { stdout: { write(s: string): void } };

const ROUTES: Record<string, string[]> = {
  infiltration: ["start", "e1", "camp2", "snares", "market", "guildContact", "den", "outerYard", "guildRite", "cuffedCell", "finale"],
  sustain: ["start", "e1", "camp2", "snares", "market", "wagon", "restCamp", "finale"],
};
const LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

function row(label: string, r: EncounterStartReport): string {
  const lv = Object.entries(r.levels).map(([id, n]) => `${id} ${n}`).join(", ");
  const fallen = r.fallen.length ? r.fallen.join(", ") : "none";
  return `  ${label.padEnd(9)} ${r.result.padEnd(17)} turns ${String(r.playerTurns).padStart(3)}  hp left ${String(r.hpLeftPct).padStart(3)}%  fallen: ${fallen}   [${lv}]`;
}

describe("finale level sweep (The Rescue)", () => {
  for (const [name, route] of Object.entries(ROUTES)) {
    it(`${name} route: one deterministic report per level`, () => {
      const asArrived = playEncounterStart(THE_HOLLOW_MILL, route);
      const sweep = sweepPartyLevel(THE_HOLLOW_MILL, route, LEVELS);
      // Deterministic: the same route + setup ⇒ the same report.
      expect(sweepPartyLevel(THE_HOLLOW_MILL, route, [LEVELS[0]])[0]).toEqual(sweep[0]);
      expect(sweep).toHaveLength(LEVELS.length);
      for (const [i, r] of sweep.entries()) {
        expect(Object.values(r.levels).every((n) => n === LEVELS[i])).toBe(true);
      }
      // The lever has to move the result, or the table measures nothing.
      expect(new Set(sweep.map((r) => `${r.result}/${r.hpLeftPct}`)).size).toBeGreaterThan(1);

      const lines = [`\n=== Finale level sweep: The Rescue via the ${name} route ===`, `  ${route.join(" → ")}`];
      lines.push(row("arrived", asArrived));
      for (const [i, r] of sweep.entries()) lines.push(row(`level ${LEVELS[i]}`, r));
      process.stdout.write(lines.join("\n") + "\n");
    });
  }
});
