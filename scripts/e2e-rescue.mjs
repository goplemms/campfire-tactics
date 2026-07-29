// E2E: The Rescue expedition (D116) boots and plays its **injected** finale in a real browser,
// and (D119) the **split-force deploy** — authored spawn zones + the entrance action — actually
// works when a player clicks it.
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
// The D119 half is why this file is mandatory rather than nice-to-have. The core suite proves
// the zone *rules*; nothing headless proves the deploy row renders a fourth verb, that clicking
// it moves a token, or that the zone paint/marker layer survives a 20×20 board — an uncaught
// throw in any of those reads as a **freeze**, not a stack trace. Every unit here is addressed
// **by tile lookup, never by pixel**: the board zoom is `min(BOARD_SCALE, fitBoardScale(…))`
// today and battle-side `BoardCamera` adoption (D100) is a queued follow-up that will move
// pixels again.
//
// Run:  npm run test:e2e:rescue   (needs Chrome — see scripts/harness.mjs)
import { withGame, ov, sleep } from "./harness.mjs";

let passed = 0;
function check(name, cond) {
  if (!cond) throw new Error(`✗ ${name}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

/** The rendered deploy-row verb labels (what a player can actually click). */
const ROW = `s.actionButtons.map(b => b.label && b.label.text).filter(Boolean)`;

/**
 * Walk to the finale with the intel flag `intel` and hand off to the real BattleScene.
 * The flag is set directly rather than by playing the provider fight: `sideDoor` is now a
 * combat node, and the grant→flag chain is proven headlessly in
 * `the-rescue-expedition.test.ts`. What only a browser can prove is the *scene* half.
 */
const toFinale = (intel) =>
  ov(
    `s.run.flags[${JSON.stringify("side-door-intel")}] = ${intel ? "true" : "false"};` +
      `while(s.run.mapNodeId!=="finale"){const r=s.loop.reachable();if(!r.length)break;` +
      `const n=r.find(x=>x.id==="finale")||r.find(x=>x.kind!=="combat")||r[0];s.loop.choose(n.id);` +
      `if(n.id!=="finale"&&n.kind!=="combat")s.loop.playCurrentNode();}` +
      `s.scene.start("BattleScene",{run:s.run,loop:s.loop});`,
  );

/** Snapshot the deploy state in tile terms — zones, who stands where, what the row offers. */
const DEPLOY_SNAP = `
  const zones = s.battle.spawnZones;
  const key = p => p.col + "," + p.row;
  const inZone = (z, u) => z.tiles.some(t => key(t) === key(u.pos));
  const players = s.battle.units.filter(u => u.side === "player" && !u.captured);
  return {
    phase: s.phase,
    zoneIds: zones.map(z => z.id),
    caps: zones.map(z => z.cap),
    sideTiles: (zones.find(z => z.id === "side-door") || { tiles: [] }).tiles.map(key),
    atFront: players.filter(u => zones.some(z => z.id === "front-gate" && inZone(z, u))).map(u => u.id),
    atSide: players.filter(u => zones.some(z => z.id === "side-door" && inZone(z, u))).map(u => u.id),
    actorId: s.deployActor && s.deployActor.id,
    row: ${ROW},
    markers: s.deployMarkers.length,
  };
`;

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
        sideDoorKind: n.sideDoor.kind,
        sideDoorAuthored: n.sideDoor.authoredId,
        hasThief: s.run.party.some(u => u.jobId === "thief"),
      };
    `));
    check("booted The Rescue expedition", topo.expeditionId === "the-rescue-expedition");
    check("the curated DAG is present (start/sideDoor/frontal/finale)",
      ["finale", "frontal", "sideDoor", "start"].every((id) => topo.ids.includes(id)));
    check("the finale binds the injected authoredId 'the-rescue'", topo.finaleAuthored === "the-rescue");
    check("the finale declares the flank prerequisite (requires side-door-intel)", topo.finaleRequires === "side-door-intel");
    check("the side-door node provides side-door-intel (the validated upstream opportunity)", topo.sideDoorProvides === "side-door-intel");
    // A rest node cannot set a run flag — `grants.flag` only fires on an authored COMBAT win.
    check("the side-door provider is a combat node with an authored body (the flag's write path)",
      topo.sideDoorKind === "combat" && topo.sideDoorAuthored === "the-side-door");
    check("the party fields a Thief (the flank enabler; frontal win needs none)", topo.hasThief === true);

    // ---------------------------------------------------------------------------
    // Arm A — NO intel. The finale must degrade to the front gate alone.
    // ---------------------------------------------------------------------------
    await g.eval(toFinale(false));
    await g.waitForScene("BattleScene", ["battle"]);
    await sleep(700);

    const bare = await g.bsEval(DEPLOY_SNAP);
    console.log("• no intel → the finale offers the front gate alone");
    check("the finale staged into deployment with no intel (no freeze)", bare.phase === "deployment");
    check("only the primary zone is unioned in", JSON.stringify(bare.zoneIds) === JSON.stringify(["front-gate"]));
    check("nobody stages at the side door", bare.atSide.length === 0);
    check("the whole party stages at the front gate", bare.atFront.length >= 4);
    check("no entrance verb exists without a second zone (D118 degradation, by construction)",
      !bare.row.some((t) => /Side Door|Front Gate/.test(t)));

    // ---------------------------------------------------------------------------
    // Arm B — WITH intel. Both zones stage; the entrance action is clickable.
    // ---------------------------------------------------------------------------
    await g.eval(ov(`s.scene.start("OverworldScene", { run: s.run, loop: s.loop });`));
    await g.waitForScene("OverworldScene", ["run", "loop"]);
    await g.eval(ov(`s.run.mapNodeId = "start"; s.run.path = ["start"];`));
    await g.eval(toFinale(true));
    await g.waitForScene("BattleScene", ["battle"]);
    await sleep(700);

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

    let snap = await g.bsEval(DEPLOY_SNAP);
    console.log("• with intel → both entrances stage, the side door EMPTY");
    check("the intel flag unions the side door in", JSON.stringify(snap.zoneIds) === JSON.stringify(["front-gate", "side-door"]));
    check("the side door is authored TIGHT — the doorway tile only", JSON.stringify(snap.sideTiles) === JSON.stringify(["18,5"]));
    check("its cap is 1 (the split stays split)", snap.caps[1] === 1);
    check("the WHOLE party defaults to the front gate", snap.atFront.length >= 4);
    check("the side door stages EMPTY (a move, not a swap — nobody is stranded there)", snap.atSide.length === 0);
    check("a source marker is drawn for each zone plus the net", snap.markers === 3);

    // The zone paint survives the net lapping over it (the danger override, rendered).
    const painted = await g.bsEval(`
      const before = s.safeZoneGfx.commandBuffer.length;
      s.front.radius = 12; s.drawZones();
      const after = s.safeZoneGfx.commandBuffer.length;
      s.front.radius = 0; s.drawZones();
      return { before, after };
    `);
    console.log("• the authored zones keep painting green under the net (the override, rendered)");
    check("the safe overlay is drawn before the net arrives", painted.before > 0);
    check("…and is still drawn once the net has swallowed the board", painted.after > 0);

    // --- The entrance action, driven as a player drives it ---------------------
    // Hand the turn to the Thief (by id — the whole point of the feature is that the player
    // picks who infiltrates, rather than the roster order picking for them).
    const armed = await g.bsEval(`
      const thief = s.battle.units.find(u => u.jobId === "thief");
      s.deployActor = thief; s.deployMoved = false; s.deployActed = false; s.deployReveal = false;
      s.moveBudget = 4;
      s.refreshDeployButtons();
      const btn = s.actionButtons.find(b => b.label && /Side Door/.test(b.label.text));
      return { thiefId: thief && thief.id, row: ${ROW}, hasBtn: !!btn, x: btn && btn.x, y: btn && btn.y };
    `);
    console.log("• the deploy row offers the entrance verb to a unit standing in a zone");
    check("the Thief has the deploy turn", armed.thiefId === "nyx");
    check("a 'Take Side Door' button is rendered in the deploy row", armed.hasBtn === true);
    check("the row still carries its normal deploy verbs", armed.row.includes("Dig In"));

    // A REAL mouse click on the rendered button — not a direct handler call.
    await g.clickScene(armed.x, armed.y);
    await sleep(250);

    snap = await g.bsEval(DEPLOY_SNAP);
    console.log("• clicking it circles the Thief round to the side door");
    check("the Thief now stands on the side-door tile", snap.atSide.length === 1 && snap.atSide[0] === "nyx");
    check("…and is no longer at the front gate", !snap.atFront.includes("nyx"));
    check("the rest of the party held the front gate", snap.atFront.length >= 3);
    const spent = await g.bsEval(`return { acted: s.deployActed, moved: s.deployMoved, budget: s.moveBudget, phase: s.phase };`);
    check("the circle spent the unit's deploy turn", spent.acted === true && spent.moved === true && spent.budget === 0);
    check("the scene is still in deployment (no freeze, no early battle)", spent.phase === "deployment");

    // --- The cap is enforced on the real board --------------------------------
    const capped = await g.bsEval(`
      const other = s.battle.units.find(u => u.side === "player" && !u.captured && u.jobId !== "thief");
      s.deployActor = other; s.deployMoved = false; s.deployActed = false; s.deployReveal = false;
      s.moveBudget = 4;
      s.refreshDeployButtons();
      return { id: other.id, row: ${ROW} };
    `);
    console.log("• the side door's cap of 1 refuses a second body");
    check("a second unit is offered no route to the full side door", !capped.row.some((t) => /Side Door/.test(t)));
    check("…and its row is otherwise intact (not an empty/broken menu)", capped.row.includes("Dig In"));

    // …while the Thief, standing at the side door, may still come back to the front gate
    // (the move is not one-way — "I changed my mind" stays a legal play).
    const back = await g.bsEval(`
      s.deployActor = s.battle.units.find(u => u.jobId === "thief");
      s.deployMoved = false; s.deployActed = false; s.deployReveal = false; s.moveBudget = 4;
      s.refreshDeployButtons();
      return ${ROW};
    `);
    check("the infiltrator can circle back to the front gate", back.some((t) => /Front Gate/.test(t)));

    // --- The phase still commits: Start Battle from the split formation --------
    await g.bsEval(`s.startBattle();`);
    await sleep(500);
    const fought = await g.bsEval(`
      const thief = s.battle.units.find(u => u.jobId === "thief");
      return { phase: s.phase, thiefPos: thief.pos, zonesCleared: s.safeZoneGfx.commandBuffer.length };
    `);
    console.log("• the split formation commits into the real battle");
    check("Start Battle crosses the boundary from the split deploy", fought.phase === "battle");
    check("the infiltrator carried its side-door position into the fight",
      fought.thiefPos.col === 18 && fought.thiefPos.row === 5);
    check("the deploy overlays are torn down at the boundary", fought.zonesCleared === 0);
  }, { hash: "#rescue" });

  console.log(`\n✓ rescue E2E: ${passed} assertions passed, no page errors`);
}

main().catch((e) => { console.error(String(e && e.stack || e)); process.exit(1); });
