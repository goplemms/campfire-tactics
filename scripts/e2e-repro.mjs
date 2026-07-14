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

    console.log(`\n✓ repro-dump E2E: ${passed} assertions passed, no page errors`);
  });
}

main().catch((e) => { console.error(String(e && e.stack || e)); process.exit(1); });
