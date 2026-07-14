// E2E: a SECOND battle on the same BattleScene instance renders without freezing.
//
// Regression guard for the deploy freeze a player hit at the snares node (D95 repro): the CT-rail
// chevron is created lazily and cached in an instance field, but the field outlived a scene
// shutdown while its Text was destroyed — so the *second* battle (E1 → snares) called setText on a
// stale handle and crashed the deploy render ("Cannot read properties of null (reading
// 'drawImage')"). The existing deploy e2e only ever plays ONE battle, so it couldn't catch this;
// the whole class of bug is "a GameObject cached across BattleScene re-entry goes stale". This
// plays two battles back-to-back and asserts the second deploy board comes up clean.
//
// The freeze is an uncaught exception in Phaser's async scene boot — it surfaces as a `pageerror`,
// not a throw into our eval — so the load-bearing check is the explicit `assertNoProblems` at the
// end (the deploy render sets phase="deployment" *before* it crashes, so a phase check alone would
// miss it). The assertions below just confirm we actually reached battle #2.
//
// Run:  npm run test:e2e:second-battle   (needs Chrome — see scripts/harness.mjs)
import { withGame, ov, navTo, sleep, assertNoProblems } from "./harness.mjs";

let passed = 0;
function check(name, cond) {
  if (!cond) throw new Error(`✗ ${name}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

/** End any open deploy turns, start the fight, drop every enemy, and advance to resolution. */
async function forceWin(g) {
  for (let i = 0; i < 10; i++) {
    if ((await g.bsEval(`return s.phase`)) !== "deployment") break;
    const b = await g.bsEval(`s.refreshDeployButtons(); return { x: s.primary.x, y: s.primary.y };`);
    await g.clickScene(b.x, b.y);
    await sleep(150);
  }
  await g.bsEval(`s.startBattle();`);
  await sleep(300);
  await g.bsEval(`for (const u of s.battle.units) { if (u.side === "enemy" && u.alive) { u.hp = 0; u.alive = false; } }`);
  for (let i = 0; i < 20; i++) {
    await g.key(" ");
    await sleep(160);
    if ((await g.bsEval(`return s.phase`)) === "resolution") break;
  }
  await g.key(" "); // Space in resolution → returnToOverworld
  await sleep(1200);
}

async function main() {
  await withGame(async (g) => {
    await g.waitForScene("OverworldScene", ["run", "loop"]);

    // --- Battle #1 — E1 in the real BattleScene (this creates the CT-rail chevron) ---
    await g.eval(navTo("e1"));
    await sleep(1500);
    await g.waitForScene("BattleScene", ["battle"]);
    check("battle #1 reaches the deploy board", (await g.bsEval(`return s.phase`)) === "deployment");
    check("battle #1 created the CT-rail chevron", (await g.bsEval(`return !!s.railChevron`)) === true);
    await forceWin(g);
    check("battle #1 resolves back to the overworld", (await g.eval(`(() => { const o = window.game.scene.getScene("OverworldScene"); return !!o && o.scene.isActive(); })()`)) === true);

    // --- Battle #2 — walk to snares and Begin, on the SAME BattleScene instance ---
    // The freeze fired here (deployNextActor → drawRail → layoutRailChevron.setText on a stale
    // chevron). withGame's no-pageerror check is the real assertion; these confirm we got here.
    await g.eval(ov(`
      let guard = 0;
      while (s.run.mapNodeId !== "snares" && guard++ < 20) {
        const r = s.loop.reachable(); if (!r.length) break;
        const n = r.find(x => x.id === "snares") || r[0];
        s.loop.choose(n.id);
        if (n.id !== "snares") s.loop.playCurrentNode();
      }
      s.campNode = s.run.map.nodes["snares"]; s.commit();
    `));
    await sleep(2000);
    check("battle #2 reaches the deploy board (no freeze)", (await g.bsEval(`return s.phase`)) === "deployment");
    // The chevron was re-created fresh for battle #2 and is a live, drawable Text (not the stale one).
    const chevron = await g.bsEval(`return { present: !!s.railChevron, live: !!(s.railChevron && s.railChevron.texture && s.railChevron.text.length >= 0) };`);
    check("battle #2 re-created a live CT-rail chevron", chevron.present && chevron.live);

    // The real guard: no uncaught render exception fired across either battle (the freeze was a
    // pageerror on the second deploy). Must run AFTER the drive so it sees any late crash.
    assertNoProblems(g.problems);
    check("no page errors across both battles", g.problems.length === 0);

    console.log(`\n✓ second-battle E2E: ${passed} assertions passed, no page errors`);
  });
}

main().catch((e) => { console.error(String(e && e.stack || e)); process.exit(1); });
