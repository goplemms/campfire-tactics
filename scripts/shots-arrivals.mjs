// Capture **representative arrivals** for each Hollow Mill combat mission in a real
// (headless) browser: for each node × {best, average, worst}, boot the jump tool's
// percentile pick (the deploy board the party arrives at) and screenshot it. Reuses
// the Phase-2 boot seam (`#demo?node=<id>&arrival=<best|average|worst>&into=battle`)
// and the shared puppeteer harness. Run with:  node scripts/shots-arrivals.mjs
//
// Reuses the Chrome-fetch contract via the harness: set CHROME_BIN to skip the
// download, or let ensureChrome pin + fetch chrome-for-testing.

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { withGame, ROOT, sleep } from "./harness.mjs";

const OUT_DIR = path.resolve(ROOT, process.env.SHOTS_OUT ?? "screenshots/arrivals");

// The Hollow Mill combat nodes (src/core/hollow-mill.ts) — Wave-0 topology. `wagon` is on
// the sustain arm; `den`/`outerYard`/`cuffedCell` on the (exclusive) infiltration arm, so
// an arrival that can't be reached on its arm is skipped, not fatal.
const NODES = ["e1", "snares", "wagon", "den", "outerYard", "cuffedCell", "finale"];
const ARRIVALS = ["best", "average", "worst"];

// Settle delay after a jump-boot — motion is already stilled via window.__SHOT__, so a
// short fixed wait is enough to let the BattleScene finish staging the deploy board.
const SETTLE_MS = 900;

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const captured = [];
  const skipped = [];

  // One server + browser for the whole matrix; re-boot each hash via s.boot(...).
  // allowProblems: the headless Phaser drawImage/layoutRailChevron rough-edge is a
  // known, pre-existing screenshot-tooling artifact (not a regression) — report it
  // rather than hard-fail, matching the other shots scripts' tolerance.
  const problems = await withGame(async (s) => {
    console.log(`• dev server: ${s.url}`);
    for (const node of NODES) {
      for (const arrival of ARRIVALS) {
        const tag = `${node}-${arrival}`;
        try {
          await s.boot(`#demo?node=${node}&arrival=${arrival}&into=battle`);
          await sleep(SETTLE_MS);
          // Confirm BattleScene staged the expected node before shooting.
          const at = await s.bsEval("return s.run && s.run.mapNodeId");
          if (at !== node) {
            skipped.push({ tag, reason: `BattleScene at "${at}", expected "${node}"` });
            console.log(`  ⊘ skip ${tag} — scene at "${at}", expected "${node}"`);
            continue;
          }
          await s.screenshot(path.join(OUT_DIR, `${tag}.png`));
          captured.push(tag);
          console.log(`  ✓ ${tag}`);
        } catch (e) {
          const reason = String(e?.message ?? e).split("\n")[0].slice(0, 200);
          skipped.push({ tag, reason });
          console.log(`  ⊘ skip ${tag} — ${reason}`);
        }
      }
    }
    return s.problems;
  }, { hash: "#demo", allowProblems: true });

  console.log(`\n— Arrival capture summary —`);
  console.log(`captured ${captured.length}: ${captured.join(", ") || "(none)"}`);
  console.log(`skipped ${skipped.length}:`);
  for (const { tag, reason } of skipped) console.log(`  - ${tag}: ${reason}`);

  if (problems.length) {
    console.warn(`\n⚠ ${problems.length} page problem(s) observed (pre-existing headless Phaser rough-edge — not a regression):`);
    for (const p of problems) console.warn(`  - ${p}`);
  }

  console.log(`\n✓ Arrivals captured to ${OUT_DIR}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
