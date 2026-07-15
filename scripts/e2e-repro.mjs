// E2E: the **Repro Dump** debug loop works in a real browser — passive capture on a scene
// transition, dump-to-JSON, and restore-into-the-exact-state. This is the tool built to make
// freezes reproducible; it must itself boot a real scene (a restore lands on the prep camp),
// so it earns a visual guard like any other player-reachable surface (CLAUDE.md).
//
// The load-bearing property under test: restore rehydrates the *captured* state directly —
// NOT a route-replay — so an interactively-set value (here a sentinel purse + a wounded unit)
// survives the round-trip. That's the whole reason the tool exists.
//
// Run:  npm run test:e2e:repro   (needs Chrome — see scripts/harness.mjs)
import { withGame, ov, sleep } from "./harness.mjs";

let passed = 0;
function check(name, cond) {
  if (!cond) throw new Error(`✗ ${name}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

async function main() {
  await withGame(async (g) => {
    await g.waitForScene("OverworldScene", ["run", "loop"]);

    // Walk (playing rests/events) to a chosen-but-unplayed snares, then render its prep camp —
    // the same surface a Begin freeze happens on. renderCamp() fires the passive capture.
    await g.eval(ov(`
      let guard = 0;
      while (s.run.mapNodeId !== "snares" && guard++ < 40) {
        const r = s.loop.reachable(); if (!r.length) break;
        const n = r.find(x => x.id === "snares") || r[0];
        s.loop.choose(n.id);
        if (n.id !== "snares") s.loop.playCurrentNode();
      }
      // Stamp interactive state a route-replay could never reproduce, then render (→ capture).
      s.run.camp.gold = 4242;                 // a sentinel purse
      s.run.party[0].hp = 1;                   // a wounded lead
      s.campNode = s.run.map.nodes["snares"];
      s.renderCamp();
    `));
    await sleep(200);

    // The passive capture landed on window.campfire with the right context.
    const cap = await g.eval(`(() => {
      const c = window.campfire && window.campfire.last;
      return c ? { scene: c.context.scene, phase: c.context.phase, node: c.context.node, gold: c.dump.camp.gold } : null;
    })()`);
    console.log("• passive capture on the prep camp");
    check("a capture landed on window.campfire", !!cap);
    check("the capture is tagged prep-camp @ snares", cap.scene === "OverworldScene" && cap.phase === "prep-camp" && cap.node === "snares");
    check("the capture holds the interactive purse (4242g), not a replayed value", cap.gold === 4242);

    // Dump to JSON (what a tester copies / sends) — non-empty and parseable.
    const dump = await g.eval(`window.campfire.dump()`);
    check("dump() returns a non-empty JSON string", typeof dump === "string" && dump.length > 100);
    check("the dump JSON parses", (() => { try { JSON.parse(dump); return true; } catch { return false; } })());

    // Perturb the live run, THEN restore — proving restore overwrites live state with the dump
    // (not a no-op, and not a replay from the seed).
    await g.eval(ov(`s.run.camp.gold = 0; s.run.party[0].hp = 99;`));
    await g.eval(`window.campfire.restore(${JSON.stringify(dump)})`);
    await sleep(600);

    console.log("• restore rehydrates the exact captured state");
    const after = await g.eval(ov(`
      return {
        active: s.scene.isActive(),
        node: s.run.mapNodeId,
        gold: s.run.camp.gold,
        leadHp: s.run.party[0].hp,
        campOpen: !!s.campNode && s.campNode.id === "snares",
      };
    `));
    check("the OverworldScene is live after restore", after.active === true);
    check("restore returned to the snares node", after.node === "snares");
    check("restore landed on the snares prep camp (the pre-Begin screen)", after.campOpen === true);
    check("restore rehydrated the sentinel purse (4242g), overwriting the live 0", after.gold === 4242);
    check("restore rehydrated the wounded lead (hp 1), overwriting the live 99", after.leadHp === 1);

    // And Begin still works from the restored state (no wedge introduced by the restore path).
    await g.eval(ov(`s.commit();`));
    await sleep(1200);
    const battle = await g.eval(`(() => { const b = window.game.scene.getScene("BattleScene"); return { active: !!b && b.scene.isActive(), phase: b && b.phase }; })()`);
    check("Begin from the restored camp hands off to a live BattleScene", battle.active === true);

    // --- The on-screen Save / Load panel (the DOM twin of the console API) ------------------
    console.log("• the in-game Save / Load panel");
    const hasToggle = await g.page.$("#repro-save-toggle");
    check("the 💾 Save / Load toggle is mounted", hasToggle !== null);
    // Stamp a fresh sentinel on the live (now BattleScene) run so Export has a known marker.
    await g.bsEval(`s.run.camp.gold = 5555;`);
    // The Save/Load toggle lives in the collapsible dev tray, which is collapsed by default
    // so it never occludes the game HUD — open the tray (its corner chevron) before clicking.
    await g.page.click("#dev-tray-toggle");
    await sleep(60);
    // Open the panel + Export the current run (Export reads the live scene's run).
    await g.page.click("#repro-save-toggle");
    await sleep(100);
    const panelShown = await g.page.$eval("#repro-save-panel", (el) => el.style.display === "flex");
    check("clicking the toggle opens the panel", panelShown === true);
    // Click the Export button (first button in the panel's top row).
    await g.page.$$eval("#repro-save-panel button", (btns) => {
      const b = btns.find((x) => x.textContent.includes("Export"));
      if (b) b.click();
    });
    await sleep(150);
    const exported = await g.page.$eval("#repro-save-panel textarea", (t) => t.value);
    check("Export fills the box with the current save JSON", typeof exported === "string" && exported.length > 100);
    check("the exported save carries the live state (the 5555g purse)", exported.includes("5555"));
    // Import: edit the JSON to a new sentinel, paste it in, click Load, and confirm it took.
    const edited = exported.replace("5555", "7777");
    await g.page.$eval("#repro-save-panel textarea", (t, v) => { t.value = v; }, edited);
    await g.page.$$eval("#repro-save-panel button", (btns) => {
      const b = btns.find((x) => x.textContent.includes("Load"));
      if (b) b.click();
    });
    await sleep(700);
    const loaded = await g.eval(ov(`return { active: s.scene.isActive(), node: s.run.mapNodeId, gold: s.run.camp.gold };`));
    check("Load from the panel restores into the OverworldScene", loaded.active === true && loaded.node === "snares");
    check("Load applied the edited save (7777g), proving the import path", loaded.gold === 7777);

    // --- Error capture: an uncaught error is folded into the export (the freeze's stack) -----
    console.log("• uncaught-error capture");
    await g.page.evaluate(() => {
      window.dispatchEvent(new ErrorEvent("error", { message: "SYNTHETIC_FREEZE", error: new Error("SYNTHETIC_FREEZE") }));
    });
    const withErr = await g.eval(`window.campfire.dump()`);
    const parsed = JSON.parse(withErr);
    check("the export carries a _repro diagnostics block", parsed._repro && typeof parsed._repro === "object");
    check("the _repro block folds in the last uncaught error message", parsed._repro.lastError && parsed._repro.lastError.message === "SYNTHETIC_FREEZE");
    check("the _repro block records the capture-context trail", Array.isArray(parsed._repro.trail) && parsed._repro.trail.length > 0);

    console.log(`\n✓ repro-dump E2E: ${passed} assertions passed, no page errors`);
  });
}

main().catch((e) => { console.error(String(e && e.stack || e)); process.exit(1); });
