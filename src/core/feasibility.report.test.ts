import { describe, it, expect } from "vitest";
import { THE_HOLLOW_MILL } from "./hollow-mill";
import { analyzeExpedition, type FeasibilityReport } from "./feasibility";

// The report writes straight to stdout (vitest leaves this uncaptured), mirroring
// `sim.test.ts`'s digest convention — so `npm run validate` always surfaces the
// FeasibilityReport without making the rest of the suite noisy. No @types/node in
// this project, so declare the narrow shape we use.
declare const process: { stdout: { write(s: string): void } };

/** Render a {@link FeasibilityReport} as a readable, single block of text. */
function formatReport(name: string, r: FeasibilityReport): string {
  const lines: string[] = [];
  lines.push(`\n=== Feasibility report: ${name} ===`);
  lines.push(`  feasible (completable): ${r.completable ? "YES" : "NO"}`);
  lines.push(`  structural problems: ${r.structural.length === 0 ? "none (valid)" : ""}`);
  for (const p of r.structural) lines.push(`    - ${p}`);

  lines.push(`  completing routes: ${r.completingRoutes.length} of ${r.terminals.length} attempted`);
  for (const route of r.completingRoutes) lines.push(`    + ${route.join(" → ")}`);

  lines.push(`  terminals:`);
  for (const t of r.terminals) {
    lines.push(`    [${t.terminal}] ${t.route.join(" → ")} (${t.nights} nights${t.reason ? `; ${t.reason}` : ""})`);
  }

  lines.push(`  per-node survival:`);
  for (const [nodeId, s] of Object.entries(r.perNode)) {
    const pct = (s.survivalRate * 100).toFixed(0);
    lines.push(`    ${nodeId.padEnd(14)} ${s.survived}/${s.sampled} survived (${pct}%)`);
  }

  lines.push(`  unreachable payloads: ${r.unreachablePayloads.length === 0 ? "none" : ""}`);
  for (const p of r.unreachablePayloads) lines.push(`    - ${p.payload} @ ${p.nodeId}`);

  const errors = r.violations.filter((v) => v.severity === "error");
  const warnings = r.violations.filter((v) => v.severity === "warning");
  lines.push(`  violations: ${errors.length} error(s), ${warnings.length} warning(s)`);
  for (const v of r.violations) {
    lines.push(`    [${v.severity}] ${v.invariant}${v.nodeId ? ` @ ${v.nodeId}` : ""}: ${v.detail}`);
  }

  lines.push(`  determinismOk: ${r.determinismOk}`);
  lines.push(
    `  sampling: ${r.sampling.nodesAnalyzed} nodes analyzed, ${r.sampling.routesEnumerated} routes enumerated, ` +
      `capped=${r.sampling.capped}, inaccessibleRoutes=${r.sampling.inaccessibleRoutes}`,
  );
  return lines.join("\n") + "\n";
}

describe("npm run validate — Hollow Mill feasibility report", () => {
  it("prints a readable FeasibilityReport", () => {
    const report = analyzeExpedition(THE_HOLLOW_MILL);
    process.stdout.write(formatReport(THE_HOLLOW_MILL.name, report));
    // A smoke assertion so the runner has something to pass on — the print is the point.
    expect(report.completable).toBe(true);
  });
});
