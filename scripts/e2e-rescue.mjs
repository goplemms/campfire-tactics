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

    // ---------------------------------------------------------------------------
    // Arm C — the "Go now" call and the LEFT-BEHIND result screen (D120).
    //
    // Two brand-new player-facing surfaces: a turn-control that has never been rendered, and
    // an after-action report carrying a "left behind" line. `vitest` proves the *rule* and the
    // sim's bot never opens either — an uncaught throw in the control's spec-builder or in the
    // report assembly reads as a FREEZE, not a stack trace (the D92/#168 tale). So both are
    // driven here, and the button is hit with a REAL mouse click on its rendered position.
    //
    // The board is posed by TILE (never by pixel — D100's BoardCamera adoption will move
    // pixels again): two prisoners walked to a mouth, one still cuffed in its cell, and a party
    // member deliberately stranded deep inside. That is the emotional case the feature exists
    // for — "go now, and Bram doesn't come home".
    // ---------------------------------------------------------------------------
    const posed = await g.bsEval(`
      const ext = s.loop.staged.objectives.find(o => o.spec.kind === "extraction").spec;
      const mouth = ext.span[0];
      const u = s.battle.units;
      const put = (id, t) => { const x = u.find(v => v.id === id); x.pos = { col: t.col, row: t.row }; };
      // Wren + Cass are picked out of their cells and walked to the mouth; Bram stays cuffed.
      for (const id of ["wren", "cass"]) { const c = u.find(v => v.id === id); c.captured = false; c.ct = 0; }
      put("wren", mouth); put("cass", mouth);
      // The party falls back to the mouth — except Thane, the rearguard, still deep inside.
      for (const id of ["cinder", "lark", "nyx"]) put(id, mouth);
      put("thane", { col: 12, row: 10 });
      for (const v of u) s.placeView(v);
      // Hand the turn to a unit so the combat action row (and its control box) renders —
      // mirroring what beginPlayerTurn does, primary included (it is End Turn during a turn).
      s.waitingFor = u.find(v => v.id === "cinder");
      s.acted = false;
      s.setPrimary("End Turn");
      s.showSkillButtons(s.waitingFor);
      const btn = s.actionButtons.find(b => b.label && /Go Now/.test(b.label.text));
      return {
        phase: s.phase,
        mouth,
        bram: u.find(v => v.id === "bram").captured,
        row: ${ROW},
        hasBtn: !!btn,
        label: btn && btn.label.text,
        x: btn && btn.x, y: btn && btn.y,
      };
    `);
    console.log("• the 'Go now' turn-control renders once someone has reached a mouth");
    check("the scene is still mid-battle (posing the board didn't freeze it)", posed.phase === "battle");
    check("Bram is still cuffed in his cell", posed.bram === true);
    check("a 'Go Now' control is rendered in the turn-control box", posed.hasBtn === true);
    // 4 of 5 (Wren, Cass, Cinder, Lark, Nyx out — Thane in): the count is the price, up front.
    check("…and its label counts who is out vs. who is not", /Go Now \(5\/6\)/.test(posed.label || ""));
    check("the unit's own verbs are untouched beside it", posed.row.includes("Defend (D)"));

    // A REAL mouse click on the rendered control — not a direct handler call.
    await g.clickScene(posed.x, posed.y);
    await sleep(600);

    const left = await g.bsEval(`
      const u = s.battle.units;
      // The report's rows live inside a Container on the overlay layer — walk it, so this
      // asserts what is actually PAINTED, not just what the result object holds.
      const harvest = (objs, out) => {
        for (const o of objs || []) {
          if (o && typeof o.text === "string" && o.text) out.push(o.text);
          if (o && o.list) harvest(o.list, out);
        }
        return out;
      };
      const overlayText = harvest(s.overlay, []);
      return {
        phase: s.phase,
        thaneCaptured: u.find(v => v.id === "thane").captured,
        nyxCaptured: u.find(v => v.id === "nyx").captured,
        quests: s.loop.run.rescueQuests.map(q => q.unitName || q.unitId).sort(),
        party: s.loop.run.party.map(v => v.id).sort(),
        overlayText,
        primary: s.primary.label.text,
      };
    `);
    console.log("• the call resolves into the after-action report, with the cost named on it");
    check("the click resolved the encounter (the result screen is up, no freeze)", left.phase === "resolution");
    check("the stranded rearguard is captured", left.thaneCaptured === true);
    check("…and a unit that was AT the mouth is not", left.nyxCaptured === false);
    // Both populations, on one list: a party member (Thane) and a prisoner (Bram).
    check("the run records BOTH left-behind populations by name",
      JSON.stringify(left.quests) === JSON.stringify(["Bram", "Thane"]));
    check("the prisoner left in his cell did NOT join the party", !left.party.includes("bram"));
    check("…while the two who were walked out DID", left.party.includes("wren") && left.party.includes("cass"));
    // The report is the surface the player actually reads — assert the rendered text, since a
    // silently-empty report would otherwise pass every state check above.
    const reportText = (left.overlayText || []).join(" | ");
    check("the report names who was left behind, on screen",
      /Left behind — needs rescue:/.test(reportText) && /Bram/.test(reportText) && /Thane/.test(reportText));
    check("it reads as the survivable retreat, not a victory and not a defeat",
      /Objective Failed — Retreat/.test(reportText));
    check("the party member left behind is NOT reported as freed",
      !/Freed by winning the field[^|]*Thane/.test(reportText));
    check("the resolution offers a way onward (the run ends at the finale)", !!left.primary);

    // ---------------------------------------------------------------------------
    // Arm D — a "Go now" WIN with someone left behind.
    //
    // Arm C is a retreat, so it never exercises the scene's post-WIN sweep — and that sweep
    // ("winning frees the field's captives", D52) walks the same unit objects as the run
    // roster. Ungated, it would un-capture the very people resolve() had just recorded as left
    // behind, handing them back a line after taking them away. That defect lives only in the
    // scene: every headless guard would stay green while the feature quietly did nothing. So
    // it gets a rendered win of its own.
    // ---------------------------------------------------------------------------
    await g.eval(ov(`s.scene.start("OverworldScene", { run: s.run, loop: s.loop });`));
    await g.waitForScene("OverworldScene", ["run", "loop"]);
    await g.eval(ov(`
      const r = s.run;
      r.over = false; r.complete = false; r.rescueQuests.length = 0;
      r.mapNodeId = "start"; r.path = ["start"];
      // Re-form the original party: release Thane, and drop the prisoners recruited in Arm C
      // so the finale stages them in their cells again.
      for (const u of r.party) { u.captured = false; u.alive = true; u.hp = u.maxHp; }
      r.party = r.party.filter(u => !["wren", "cass", "bram"].includes(u.id));
    `));
    await g.eval(toFinale(true));
    await g.waitForScene("BattleScene", ["battle"]);
    await sleep(700);

    const won = await g.bsEval(`
      s.startBattle();
      const ext = s.loop.staged.objectives.find(o => o.spec.kind === "extraction").spec;
      const mouth = ext.span[0];
      const u = s.battle.units;
      const put = (id, t) => { const x = u.find(v => v.id === id); x.pos = { col: t.col, row: t.row }; };
      // ALL THREE prisoners picked and walked out ⇒ the extraction goal can be met…
      for (const id of ["wren", "cass", "bram"]) { const c = u.find(v => v.id === id); c.captured = false; c.ct = 0; put(id, mouth); }
      for (const id of ["cinder", "lark", "nyx"]) put(id, mouth);
      put("thane", { col: 12, row: 10 }); // …but Thane is still deep inside.
      for (const v of u) s.placeView(v);
      s.waitingFor = u.find(v => v.id === "cinder");
      s.acted = false;
      s.setPrimary("End Turn");
      s.showSkillButtons(s.waitingFor);
      const btn = s.actionButtons.find(b => b.label && /Go Now/.test(b.label.text));
      return { garrisonAlive: u.some(v => v.side === "enemy" && v.alive), hasBtn: !!btn, x: btn && btn.x, y: btn && btn.y };
    `);
    console.log("• Go Now with every prisoner out is a WIN — and it still costs the rearguard");
    check("the garrison is still standing (this is a flight, not a field hold)", won.garrisonAlive === true);
    check("the Go Now control is up again in the second battle", won.hasBtn === true);

    await g.clickScene(won.x, won.y);
    await sleep(600);

    const after = await g.bsEval(`
      const harvest = (objs, out) => {
        for (const o of objs || []) {
          if (o && typeof o.text === "string" && o.text) out.push(o.text);
          if (o && o.list) harvest(o.list, out);
        }
        return out;
      };
      const thane = s.battle.units.find(v => v.id === "thane");
      return {
        phase: s.phase,
        thaneCaptured: thane.captured,
        rosterThaneCaptured: s.loop.run.party.find(v => v.id === "thane").captured,
        quests: s.loop.run.rescueQuests.map(q => q.unitName || q.unitId),
        party: s.loop.run.party.map(v => v.id),
        text: harvest(s.overlay, []).join(" | "),
      };
    `);
    check("it graded as a victory with the garrison alive", /Victory!/.test(after.text));
    check("all three prisoners came home", ["wren", "cass", "bram"].every(id => after.party.includes(id)));
    // The load-bearing assertion: the post-win sweep must NOT free the man left inside.
    check("the WIN did not auto-free the party member left behind (the board token stays bound)",
      after.thaneCaptured === true);
    check("…nor un-capture him on the run roster (he does not walk home)",
      after.rosterThaneCaptured === true);
    check("…and he is recorded by name on the victory screen too",
      after.quests.includes("Thane") && /Left behind — needs rescue:[^|]*Thane/.test(after.text));
  }, { hash: "#rescue" });

  console.log(`\n✓ rescue E2E: ${passed} assertions passed, no page errors`);
}

main().catch((e) => { console.error(String(e && e.stack || e)); process.exit(1); });
