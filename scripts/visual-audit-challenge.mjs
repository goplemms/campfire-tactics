// Adversarial specificity guard for the visual-audit COVERAGE predicates (the `expect`
// gates). A coverage gate is only worth anything if it's SPECIFIC: true on its own screen
// and FALSE on every other. A loose text regex (e.g. an early traveler-gift `/road/`, which
// also matched the map's "what waits on the road") passes on the wrong screen — a silent
// hole that lets a wrong-screen capture read as "covered".
//
// This targets the TEXT-based gates (those whose `expect` scans rendered text — `seesText`).
// State-based gates (`s.phase`, `!!s.campNode`) are validated by being checked immediately
// after their driver; text gates read current render, so specificity is THEIR safety net.
// It reaches all surfaces (reusing the real SURFACES + reachSurface, so the exact audit
// drivers run) and evaluates each text gate against EVERY surface. A gate that passes on any
// screen other than its own is a false-pass and fails this guard.
//
// Run:  node scripts/visual-audit-challenge.mjs     (needs Chrome — see harness.mjs)

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { withGame } from "./harness.mjs";
import { SURFACES, reachSurface } from "./visual-audit.mjs";

// Local Chrome discovery (visual-audit's is private) so this runs standalone.
if (!process.env.CHROME_BIN) {
  const pw = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";
  const cands = [];
  try { for (const d of readdirSync(pw)) if (d.startsWith("chromium-")) cands.push(path.join(pw, d, "chrome-linux", "chrome")); } catch { /* none */ }
  cands.push("/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser");
  const found = cands.find((p) => existsSync(p));
  if (found) process.env.CHROME_BIN = found;
}

// Text-based gates: their `expect` scans rendered text (the seesText signature `rx.test`).
const isTextGate = (s) => s.expect && /rx\.test/.test(s.expect.eval);
const gates = SURFACES.filter(isTextGate);

async function main() {
  // matrix[surfaceName-of-gate][surfaceName-reached] = true | false | "ERR"
  const matrix = {};
  for (const g of gates) matrix[g.name] = {};

  await withGame(async (session) => {
    await session.waitForScene("OverworldScene", ["run", "loop"]);
    for (const s of SURFACES) {
      try { await reachSurface(session, s); }
      catch (e) { console.error(`  ! could not reach ${s.name}: ${String(e).slice(0, 120)}`); }
      for (const g of gates) {
        matrix[g.name][s.name] = await session.eval(g.expect.eval).then((v) => v === true, () => "ERR");
      }
      process.stdout.write(`  reached ${s.name}\n`);
    }
  });

  console.log(`\n${"=".repeat(78)}\nCOVERAGE-GATE SPECIFICITY — each text gate must be TRUE on its own screen, FALSE elsewhere\n${"=".repeat(78)}`);
  let ok = true;
  const names = SURFACES.map((s) => s.name);
  for (const g of gates) {
    const hits = names.filter((n) => matrix[g.name][n] === true);
    const own = matrix[g.name][g.name] === true;
    const falsePass = hits.filter((n) => n !== g.name);
    const status = !own ? "✗ MISSES ITS OWN SCREEN" : falsePass.length ? `✗ false-pass: ${falsePass.join(", ")}` : "✓ specific";
    console.log(`  ${status.startsWith("✓") ? "✓" : "✗"} ${g.name.padEnd(18)} ${g.expect.eval.match(/rx = (\/[^;]+\/[a-z]*)/)?.[1] ?? ""}  →  ${status}`);
    if (!own || falsePass.length) ok = false;
  }
  console.log("=".repeat(78));
  console.log(ok ? `✓ All ${gates.length} text gates are specific (own screen only).` : "✗ At least one text gate is not specific — see above.");
  if (!ok) process.exit(1);
}

main().catch((e) => { console.error(`\n${e.stack || e}`); process.exit(1); });
