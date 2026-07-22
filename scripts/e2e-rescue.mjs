// E2E: The Rescue expedition (D116) boots and plays its **injected** finale in a real browser.
//
// The finale body lives as content JSON (`content/levels/the-rescue.json`), injected into
// core's catalog at boot; the expedition topology is curated TS and resolves the finale's
// `authoredId` against that catalog. The pure suite + sim never render a scene and the naive
// bot skips deploy — so a broken injection (dangling id / un-injected catalog) would be green
// on vitest yet FREEZE the real `#rescue` scene, or silently stage a procedural fight. This
// walks the side-door arm to the finale and asserts the *injected* content actually staged —
// the named Warden + the three named captives — which a procedural fallback could never
// produce. (The D92/#168 cautionary tale: guard every new player-facing surface in the scene.)
//
// Run:  npm run test:e2e:rescue   (needs Chrome — see scripts/harness.mjs)
import { withGame, ov, jumpTo, sleep } from "./harness.mjs";

let passed = 0;
function check(name, cond) {
  if (!cond) throw new Error(`✗ ${name}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

async function main() {
  await withGame(async (g) => {
    // Boot straight into #rescue: RescueBootScene injects the content bodies, runs the D116
    // load pipeline fail-loud, then hands the run to the OverworldScene. withGame throws on any
    // page error / console.error, so a fail-loud boot crash (or any render throw) fails here.
    await g.waitForScene("OverworldScene", ["run", "loop"]);
    await sleep(400);

    // The curated topology + the D116 prerequisite markers are what the scene actually booted.
    const topo = await g.eval(ov(`
      const n = s.run.map.nodes;
      return {
        expeditionId: s.run.expeditionId,
        ids: Object.keys(n).sort(),
        finaleAuthored: n.finale.authoredId,
        finaleRequires: n.finale.requires,
        sideDoorProvides: n.sideDoor.provides,
        hasThief: s.run.party.some(u => u.jobId === "thief"),
      };
    `));
    check("booted The Rescue expedition", topo.expeditionId === "the-rescue-expedition");
    check("the curated DAG is present (start/sideDoor/frontal/finale)",
      ["finale", "frontal", "sideDoor", "start"].every((id) => topo.ids.includes(id)));
    check("the finale binds the injected authoredId 'the-rescue'", topo.finaleAuthored === "the-rescue");
    check("the finale declares the flank prerequisite (requires side-door-intel)", topo.finaleRequires === "side-door-intel");
    check("the side-door node provides side-door-intel (the validated upstream opportunity)", topo.sideDoorProvides === "side-door-intel");
    check("the party fields a Thief (the flank enabler; frontal win needs none)", topo.hasThief === true);

    // Walk the side-door arm (start → sideDoor rest → finale) and hand off to the real
    // BattleScene, which stages the current node's encounter — resolving the finale's
    // authoredId against the injected catalog.
    await g.eval(jumpTo({ target: "finale", route: ["start", "sideDoor", "finale"], into: "battle" }));
    await g.waitForScene("BattleScene", ["battle"]);
    await sleep(600);

    const staged = await g.bsEval(`
      const u = s.battle.units;
      const ids = u.map(x => x.id);
      return {
        phase: s.phase,
        warden: ids.includes("the-warden"),
        captives: ["wren", "cass", "bram"].filter(id => {
          const c = u.find(x => x.id === id);
          return c && c.side === "player" && c.captured;
        }),
        enemyCount: u.filter(x => x.side === "enemy").length,
      };
    `);
    // These names come straight from the-rescue.json — a procedural fallback (the silent hole
    // the fail-loud closes) would have generic bandits and no captives at all.
    check("the injected finale staged (deployment phase reached, no freeze)", staged.phase === "deployment");
    check("the named Warden from the JSON body is on the field", staged.warden === true);
    check("all three named captives from the JSON body are staged (bound, player-side)", staged.captives.length === 3);
    check("the garrison staged at full strength", staged.enemyCount >= 4);
  }, { hash: "#rescue" });

  console.log(`\n✓ rescue E2E: ${passed} assertions passed, no page errors`);
}

main().catch((e) => { console.error(String(e && e.stack || e)); process.exit(1); });
