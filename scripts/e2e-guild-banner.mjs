// E2E: the guild hall's caravan-return banner (audit 2026-07-20 / D114). The banner was the
// seventh hand-rolled modal — the one site never migrated to overlay-card's showModal, and it
// was missing the input-swallowing backdrop (the D75 bug class: clicks bled through to the
// quest board / pool / stable behind it). This guard boots the REAL GuildScene, surfaces a
// banner, and proves three things:
//   1. both banner variants (returned / wiped) render without a freeze;
//   2. the backdrop actually blocks the hall behind the modal (a real click on a quest row
//      changes nothing while the banner is up);
//   3. Dismiss tears the modal down and the hall is interactive again.
//
// The resolution object is a synthetic literal (the render surface only reads plain data) —
// the resolveReturn/wipe *mechanics* are covered headlessly in guild.test.ts; this file owns
// the render half, which no headless guard can see.
//
// Run:  npm run test:e2e:guild-banner   (needs Chrome — see scripts/harness.mjs)

import path from "node:path";
import { withGame, sleep, assertNoProblems, ROOT } from "./harness.mjs";

const OUT = path.join(ROOT, "screenshots", "e2e-guild-banner");

let passed = 0;
function check(name, cond) {
  if (!cond) throw new Error(`✗ ${name}`);
  passed += 1;
  console.log(`    ✓ ${name}`);
}

const GS = `window.game.scene.getScene("GuildScene")`;
const gs = (body) => `(()=>{const s=${GS};${body}})()`;

/** Scene-graph lookups (Buttons are containers exposing `.label`; texts carry `.text`). */
const findButton = (label) =>
  gs(`const b = s.children.list.find(o => o.label && o.label.text === ${JSON.stringify(label)});
      return b ? { x: b.x, y: b.y } : null;`);
const hasText = (t) =>
  gs(`return s.children.list.some(o => typeof o.text === "string" && o.text === ${JSON.stringify(t)});`);

const RETURNED = {
  caravanId: "e2e", questId: "main", outcome: "returned",
  survivors: ["Rook", "Vale"], lost: ["Moss"], gearReturned: ["trap-kit"],
  gearLost: [], purseReturned: 40, purseLost: 0, payout: 60, lordLost: false,
};
const WIPED = {
  caravanId: "e2e", questId: "main", outcome: "wiped",
  survivors: [], lost: ["Rook", "Vale"], gearReturned: [],
  gearLost: ["trap-kit"], purseReturned: 0, purseLost: 25, payout: 0, lordLost: true,
};

async function main() {
  await withGame(async (g) => {
  console.log("  guild-banner: boot the hall");
  await g.waitForScene("GuildScene", ["guild"]);

  // --- Variant 1: a RETURNED caravan -----------------------------------------
  await g.eval(gs(`s.banner = ${JSON.stringify(RETURNED)}; s.render();`));
  await sleep(150);
  check("the returned banner renders (Caravan Home)", await g.eval(hasText("Caravan Home")));
  await g.screenshot(path.join(OUT, "01-returned.png"));

  // The backdrop blocks the hall: a real click on a quest row under the modal
  // must NOT change the selection (pre-migration, it did — the D75 bleed-through).
  const before = await g.eval(gs(`return s.selectedQuestId;`));
  const row = await g.eval(gs(`
    const b = s.children.list.find(o => o.label && o.label.text && o.label.text.length
      && s.guild.board.some(q => o.label.text.includes(q.label) && q.id !== s.selectedQuestId));
    return b ? { x: b.x, y: b.y } : null;`));
  check("an unselected quest row exists to poke at", !!row);
  await g.clickScene(row.x, row.y);
  await sleep(150);
  const after = await g.eval(gs(`return s.selectedQuestId;`));
  check("the backdrop swallowed the click (selection unchanged)", after === before);
  check("…and the banner is still up", await g.eval(hasText("Caravan Home")));

  // Dismiss tears it down.
  const dismiss = await g.eval(findButton("Dismiss"));
  check("the Dismiss button renders above the backdrop", !!dismiss);
  await g.clickScene(dismiss.x, dismiss.y);
  await sleep(150);
  check("Dismiss clears the banner", !(await g.eval(hasText("Caravan Home"))));
  check("the scene's banner state cleared", await g.eval(gs(`return s.banner === undefined;`)));

  // The hall is interactive again: the same quest-row click now changes the selection.
  await g.clickScene(row.x, row.y);
  await sleep(150);
  const reAfter = await g.eval(gs(`return s.selectedQuestId;`));
  check("the hall is clickable again after dismiss", reAfter !== before);

  // --- Variant 2: a WIPED caravan (the danger tone + lord-lost line) ----------
  await g.eval(gs(`s.banner = ${JSON.stringify(WIPED)}; s.render();`));
  await sleep(150);
  check("the wiped banner renders (Caravan Lost)", await g.eval(hasText("Caravan Lost")));
  await g.screenshot(path.join(OUT, "02-wiped.png"));
  const dismiss2 = await g.eval(findButton("Dismiss"));
  await g.clickScene(dismiss2.x, dismiss2.y);
  await sleep(150);
  check("the wiped banner dismisses cleanly", !(await g.eval(hasText("Caravan Lost"))));

  assertNoProblems(g.problems);
  }, { hash: "" });
  console.log(`\n✓ guild-banner E2E: ${passed} checks, no page errors`);
}

main().catch((e) => { console.error(`\n${e.message ?? e}`); process.exit(1); });
