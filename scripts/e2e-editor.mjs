// E2E: the visual level editor (D98). Boots `#editor`, drives the brush palette + real
// tile clicks, and asserts the paint → render → export loop produces a valid level with no
// page errors. The guard CLAUDE.md requires when a new scene surface is added.
//
// Run:  npm run test:e2e:editor   (needs Chrome — see scripts/harness.mjs)

import path from "node:path";
import fs from "node:fs";
import { withGame, sleep, assertNoProblems, ROOT } from "./harness.mjs";

// The real shipped finale — imported through the editor's paste box to prove a load→edit→save
// round-trip renders without a freeze (M-A). Read from disk, injected into the page.
const RESCUE_JSON = fs.readFileSync(path.join(ROOT, "src", "content", "levels", "the-rescue.json"), "utf8");

const OUT = path.join(ROOT, "screenshots", "e2e-editor");

let passed = 0;
function check(name, cond) {
  if (!cond) throw new Error(`✗ ${name}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// Read the editor's draft counts + the live-export/validation state.
const STATE = `(() => {
  const sc = window.game.scene.getScene("EditorScene");
  const d = sc?.draft ?? {};
  const pre = document.querySelector("pre");
  const exp = (() => { try { return JSON.parse(pre.textContent); } catch { return null; } })();
  const validText = [...document.querySelectorAll("div")].map(n => n.textContent).find(t => /valid|⚠/.test(t)) || "";
  return {
    active: !!(sc && sc.scene.isActive("EditorScene")),
    brushButtons: document.querySelectorAll("button[data-brush]").length,
    enemyCards: document.querySelectorAll('button[data-brush="enemy"]').length,
    essentialBrushes: ["wall","line","rect","gate","lever","trap","spawn","exit","enemy","captive","select","erase"].every((b) => !!document.querySelector('button[data-brush="' + b + '"]')),
    tabs: document.querySelectorAll("button[data-tab]").length,
    unitRows: document.querySelectorAll("[data-unit-row]").length,
    walls: d.blocked?.length ?? null,
    spawns: d.playerSpawns?.length ?? null,
    enemies: d.enemies?.length ?? null,
    exit: d.exit?.length ?? null,
    captives: d.captives?.length ?? null,
    wardenRole: (d.enemies ?? []).find((e) => e.id === "the-warden")?.role ?? null,
    expCaptiveIds: (exp?.captives ?? []).map((c) => c.spec?.id).join(","),
    expExtractLabel: (exp?.objectives ?? []).find((o) => o.kind === "extraction")?.label ?? null,
    expReward: exp?.reward?.gold ?? null,
    importBox: !!document.querySelector('textarea[data-role="import"]'),
    wardenEditedHp: (exp?.enemies ?? []).find((e) => e.id === "the-warden-2")?.overrides?.maxHp ?? null,
    expSpawns: exp?.playerSpawns?.length ?? null,
    expEnemies: exp?.enemies?.length ?? null,
    valid: /✓ valid/.test(validText),
  };
})()`;

// The board camera's live scroll/zoom — proves drag-pans / wheel-zooms / Recenter reset.
const CAM = `(() => {
  const c = window.game.scene.getScene("EditorScene").cameras.main;
  return { sx: Math.round(c.scrollX), sy: Math.round(c.scrollY), zoom: +c.zoom.toFixed(3) };
})()`;

const clickTab = (t) => `document.querySelector('button[data-tab="${t}"]').click()`;

// Select the warden by clicking its UNIT-LIST row (the occlusion fix — no board pixel-hunt), then
// edit its id + maxHp through the inspector (M-B/M-UI — the new panel surfaces).
const EDIT = `(() => {
  const rows = [...document.querySelectorAll("[data-unit-row]")];
  const wardenRow = rows.find((r) => (r.textContent || "").includes("the-warden"));
  wardenRow.click();
  const insp = document.querySelector('[data-role="inspector"]');
  const idInput = insp.querySelector("input");
  idInput.value = "the-warden-2";
  idInput.dispatchEvent(new Event("input"));
  const hp = document.querySelector('input[data-stat="maxHp"]');
  hp.value = "99";
  hp.dispatchEvent(new Event("change"));
  return { statInputs: document.querySelectorAll("input[data-stat]").length, clickedRow: !!wardenRow };
})()`;

// Paste the-rescue's JSON into the import box and click Import.
const IMPORT = `(() => {
  const ta = document.querySelector('textarea[data-role="import"]');
  ta.value = ${JSON.stringify(RESCUE_JSON)};
  document.querySelector('button[data-role="import-btn"]').click();
  return true;
})()`;
const setBrush = (b) => `document.querySelector('button[data-brush="${b}"]').click()`;

async function main() {
  await withGame(
    async (g) => {
      try {
        await sleep(900);
        // A tile's on-screen point from its live board-world coord (recenter- + FIT-safe): the
        // board now centres in the FULL canvas width (D98), so pixel-hardcoded clicks would miss.
        // Valid only at the default camera (scroll 0, zoom 1) — true at boot and after Recenter.
        const tileScreen = (col, row) =>
          g.eval(`(() => { const p = window.game.scene.getScene("EditorScene").view.tileToWorld({col:${col},row:${row}}); return { x: Math.round(p.x), y: Math.round(p.y) }; })()`);
        const clickTile = async (col, row) => { const p = await tileScreen(col, row); await g.clickScene(p.x, p.y); await sleep(80); };
        let st = await g.eval(STATE);
        console.log("• #editor boots with the brush palette");
        check("the editor scene is active", st.active === true);
        check("the placeable gallery has every essential brush (incl. gate + lever)", st.essentialBrushes === true);
        check("the enemy roster is unrolled into cards (not a dropdown)", st.enemyCards >= 6);
        check("the drawer tab bar is present (5 tabs incl. Objects)", st.tabs === 5);

        // D109 slice 2 — the card tweaks are live, persisted display options (size / tint / captive).
        console.log("• display options: size · enemy tint · captive variants");
        check("the display-options row is present", (await g.eval(`!!document.querySelector('[data-role="editor-options"]')`)) === true);
        const wallW = () => g.eval(`document.querySelector('button[data-brush="wall"]').offsetWidth`);
        await g.eval(`document.querySelector('button[data-opt="size:M"]').click()`); await sleep(80);
        const wM = await wallW();
        await g.eval(`document.querySelector('button[data-opt="size:L"]').click()`); await sleep(120);
        const wL = await wallW();
        check("choosing the Large size option widens the cards", wL > wM);
        await g.eval(`document.querySelector('button[data-opt="size:M"]').click()`); await sleep(80);
        await g.eval(`document.querySelector('button[data-opt="enemy:role"]').click()`); await sleep(100);
        const roleOn = await g.eval(`document.querySelector('button[data-opt="enemy:role"]').style.fontWeight === "700"`);
        check("choosing the role tint option activates it (no freeze)", roleOn === true);
        const captive2 = await g.eval(`(() => { document.querySelector('button[data-opt="captive:2"]').click(); return document.querySelectorAll('button[data-brush="captive"]').length; })()`);
        await sleep(100);
        check("choosing 2 captive variants adds the reach card", captive2 === 2);
        // restore defaults so persisted prefs don't leak into later assertions / runs
        await g.eval(`document.querySelector('button[data-opt="enemy:red"]').click(); document.querySelector('button[data-opt="captive:1"]').click();`); await sleep(80);
        check("the draft starts empty", st.walls === 0 && st.spawns === 0 && st.enemies === 0);
        await g.screenshot(path.join(OUT, "01-empty.png"));

        // D98 placement geometry: the slab dock sits BELOW the canvas, and the FIT-scaled board must
        // never overflow into it — not even on a short viewport (the challenge's clip failure mode).
        console.log("• the slab dock sits below the canvas (no bleed / no clip)");
        const fits = () => g.eval(`(() => {
          const c = document.querySelector("canvas").getBoundingClientRect();
          const dockTop = document.querySelector('[data-role="dock-grip"]').parentElement.getBoundingClientRect().top;
          const app = document.getElementById("app").getBoundingClientRect();
          return { overflow: Math.round(c.bottom - dockTop), inApp: c.bottom <= app.bottom + 1, dockPresent: !!document.querySelector('[data-role="dock-grip"]') };
        })()`);
        let fit = await fits();
        check("the resize grip / dock is present below the board", fit.dockPresent === true);
        check("the board sits above the dock at the default viewport (no bleed)", fit.overflow <= 1 && fit.inApp);
        await g.page.setViewport({ width: 900, height: 600 }); await sleep(300);
        fit = await fits();
        check("the board still fits above the dock on a short viewport (no clip)", fit.overflow <= 1 && fit.inApp);
        await g.page.setViewport({ width: 820, height: 680 }); await sleep(300);

        // Wall brush (default): real clicks place walls. (Blank draft is 9×6 — cols 0-8, rows 0-5.)
        for (const [c, r] of [[2, 2], [3, 2]]) await clickTile(c, r);
        st = await g.eval(STATE);
        check("wall brush + clicks place walls (click-pick works)", st.walls === 2);

        // Spawn brush.
        await g.eval(setBrush("spawn"));
        for (const [c, r] of [[0, 4], [1, 4]]) await clickTile(c, r);
        // Enemy brush.
        await g.eval(setBrush("enemy"));
        for (const [c, r] of [[5, 2], [6, 2]]) await clickTile(c, r);
        // Exit brush.
        await g.eval(setBrush("exit"));
        for (const [c, r] of [[8, 0], [8, 1]]) await clickTile(c, r);

        st = await g.eval(STATE);
        console.log("• the palette paints spawns / enemies / exit tiles");
        check("spawns were placed", st.spawns === 2);
        check("enemies were placed", st.enemies === 2);
        check("exit tiles were placed", st.exit === 2);
        check("the live export reflects spawns + enemies", st.expSpawns === 2 && st.expEnemies === 2);
        check("the draft validates as a playable level", st.valid === true);
        await g.screenshot(path.join(OUT, "02-painted.png"));

        // Erase brush removes an entity at a clicked tile (one of the enemies placed above, (5,2)).
        await g.eval(setBrush("erase"));
        await clickTile(5, 2);
        const st2 = await g.eval(STATE);
        console.log("• erase brush removes a placed entity");
        check("erasing an enemy tile decrements the enemies", st2.enemies === 1);
        check("the import box is present", st2.importBox === true);

        // Import the shipped finale through the paste box — the M-A round-trip inverse, in the real scene.
        await g.eval(IMPORT);
        await sleep(200);
        const st3 = await g.eval(STATE);
        console.log("• importing the-rescue.json loads it into the draft (no freeze)");
        check("import loaded the-rescue's 8 enemies", st3.enemies === 8);
        check("import loaded the-rescue's 3 captives", st3.captives === 3);
        check("import loaded the 7-tile exit span", st3.exit === 7);
        check("import carried the named captive ids (not clobbered)", st3.expCaptiveIds === "wren,cass,bram");
        check("import carried the custom extraction label", st3.expExtractLabel === "Free the captives and escort them to the exit");
        check("import carried the authored reward (260g, not the 50g default)", st3.expReward === 260);
        check("import carried the warden's role tag", st3.wardenRole === "captain");
        check("the imported finale validates", st3.valid === true);
        await g.screenshot(path.join(OUT, "03-imported.png"));

        // Switch to the Units drawer — the list reaches every placed unit (occlusion fix).
        await g.eval(clickTab("Units"));
        await sleep(120);
        const stU = await g.eval(STATE);
        console.log("• the Units drawer lists every placed unit");
        check("the unit list shows all 11 units (8 enemies + 3 captives)", stU.unitRows === 11);

        // Inspector: select the warden via its list row, rename it + bump its maxHp (freeze-catch).
        const ed = await g.eval(EDIT);
        await sleep(150);
        const st4 = await g.eval(STATE);
        console.log("• unit-list select → inspector edits an entity's identity + stats (no freeze)");
        check("selection came from clicking the warden's list row", ed.clickedRow === true);
        check("the inspector rendered the 7-field stat grid", ed.statInputs === 7);
        check("the id rename + maxHp override flow to the export", st4.wardenEditedHp === 99);
        check("the level still validates after the edit", st4.valid === true);
        await g.screenshot(path.join(OUT, "04-inspected.png"));

        // Camera controls (large-map fix): drag pans the board, a drag does NOT paint, and
        // Recenter restores the default framing — so a 20×20 level is reachable on the fixed canvas.
        console.log("• grab-and-drag pans the board (large-map reachability)");
        const camBefore = await g.eval(CAM);
        check("camera starts at the default framing", camBefore.sx === 0 && camBefore.sy === 0 && camBefore.zoom === 1);
        const wallsBeforeDrag = (await g.eval(STATE)).walls;
        await g.eval(setBrush("wall"));
        await g.drag(430, 300, 250, 300); // drag left over the board
        await sleep(120);
        const camAfter = await g.eval(CAM);
        const stDrag = await g.eval(STATE);
        check("dragging scrolled the camera", Math.abs(camAfter.sx) > 30);
        check("a drag did not paint a tile (click vs drag)", stDrag.walls === wallsBeforeDrag);
        await g.screenshot(path.join(OUT, "05-panned.png"));

        // Recenter resets scroll+zoom; after it a genuine tap still paints (discrimination intact).
        await g.eval(`document.querySelector('button[data-role="recenter"]').click()`);
        await sleep(80);
        const camReset = await g.eval(CAM);
        check("Recenter restored the default framing", camReset.sx === 0 && camReset.sy === 0 && camReset.zoom === 1);
        { const p = await tileScreen(5, 0); await g.clickScene(p.x, p.y); } // a plain tap on the empty tile (5,0)
        await sleep(100);
        const stTap = await g.eval(STATE);
        check("a tap after recenter still paints (walls incremented)", stTap.walls === wallsBeforeDrag + 1);

        // Structural wall tools (M-D): two-click line + rectangle, plus the live coordinate readout.
        // Camera is recentered (scroll 0, zoom 1), so a tile's board-world point equals its screen point.
        console.log("• line / rectangle wall tools + coordinate readout (structural authoring)");
        const coordText = () => g.eval(`document.querySelector('[data-role="coord"]').textContent`);
        const blocked = async () => (await g.eval(STATE)).walls;

        // The coordinate readout tracks the hovered tile.
        const hb = await tileScreen(2, 0);
        await g.hover(hb.x, hb.y);
        await sleep(60);
        check("the coordinate readout shows the hovered tile", (await coordText()).includes("(2,0)"));
        check("the rect outline/fill mode toggle is present", (await g.eval(`!!document.querySelector('button[data-role="rect-mode"]')`)) === true);

        // Line tool: anchor (2,0) → far (2,3) lays a 4-tile vertical wall run in two clicks.
        const b0 = await blocked();
        await g.eval(setBrush("line"));
        let p = await tileScreen(2, 0); await g.clickScene(p.x, p.y); await sleep(60);
        p = await tileScreen(2, 3); await g.clickScene(p.x, p.y); await sleep(60);
        check("line tool laid a 4-tile wall run (two clicks)", (await blocked()) === b0 + 4);

        // Rectangle outline: corners (4,5)–(6,6) → a 6-tile wall ring (a cell/room outline).
        const b1 = await blocked();
        await g.eval(setBrush("rect"));
        p = await tileScreen(4, 5); await g.clickScene(p.x, p.y); await sleep(60);
        p = await tileScreen(6, 6); await g.clickScene(p.x, p.y); await sleep(60);
        check("rect outline laid a 6-tile wall ring", (await blocked()) === b1 + 6);
        check("the level still validates after the shape tools", (await g.eval(STATE)).valid === true);
        await g.screenshot(path.join(OUT, "06-shapes.png"));

        // Objectives editor + reward (M-C): the-rescue imported with 2 objectives — tune label/required,
        // add one, set the reward — the gaps the visual editor couldn't reach before.
        console.log("• objectives editor + reward controls (M-C)");
        await g.eval(clickTab("Events"));
        await sleep(80);
        const objCount = () => g.eval(`document.querySelectorAll('[data-role="objective"]').length`);
        const expObj = () => g.eval(`JSON.parse(document.querySelector("pre").textContent).objectives`);
        check("the imported finale shows its 2 objectives as editable rows", (await objCount()) === 2);

        // Edit the first objective's label + toggle its required flag off (the two fields we explained).
        await g.eval(`(() => {
          const row = document.querySelector('[data-role="objective"]');
          const label = row.querySelector('input:not([type=checkbox])');
          label.value = "Storm the Iron Gaol"; label.dispatchEvent(new Event("input"));
          const req = row.querySelector('input[type=checkbox]');
          req.checked = false; req.dispatchEvent(new Event("change"));
        })()`);
        await sleep(80);
        const o0 = (await expObj())[0];
        check("editing an objective label flows to the export", o0.label === "Storm the Iron Gaol");
        check("toggling required off flows to the export (an optional objective)", o0.required === false);

        // Add an objective → 3 rows, 3 in the export.
        await g.eval(`document.querySelector('button[data-role="add-objective"]').click()`);
        await sleep(80);
        check("＋ add appends an objective row", (await objCount()) === 3);
        check("the added objective reaches the export", (await expObj()).length === 3);

        // Reward control (Scenario drawer).
        await g.eval(clickTab("Scenario"));
        await sleep(60);
        await g.eval(`(() => { const el = document.querySelector('input[data-role="reward-gold"]'); el.value = "500"; el.dispatchEvent(new Event("change")); })()`);
        await sleep(60);
        check("editing the reward gold flows to the export", (await g.eval(`JSON.parse(document.querySelector("pre").textContent).reward.gold`)) === 500);
        check("the level still validates after objective + reward edits", (await g.eval(STATE)).valid === true);
        await g.screenshot(path.join(OUT, "07-objectives.png"));

        // Objects (M-D2): gates + levers as placeable objects in the new Objects tab, edited via the
        // persistent inspector — the last editor↔JSON gap, so the prison is fully paintable.
        console.log("• objects: gate + lever authoring (M-D2)");
        await g.eval(clickTab("Objects"));
        await sleep(60);
        const objExp = () => g.eval(`(() => {
          const e = JSON.parse(document.querySelector("pre").textContent);
          return { gates: (e.gates || []).length, levers: (e.levers || []).length,
                   openBy: e.gates && e.gates[0] ? e.gates[0].openBy.map((c) => c.kind).sort() : [],
                   targets: e.levers && e.levers[0] ? e.levers[0].targets : [] };
        })()`);
        // Place a gate (default lockpick cell) + a lever on empty tiles.
        await g.eval(setBrush("gate"));
        let gp = await tileScreen(1, 3); await g.clickScene(gp.x, gp.y); await sleep(60);
        await g.eval(setBrush("lever"));
        const lp = await tileScreen(1, 5); await g.clickScene(lp.x, lp.y); await sleep(60);
        let oe = await objExp();
        check("a gate lands as a default lockpick cell + a lever lands unwired", oe.gates === 1 && oe.levers === 1 && oe.openBy.join() === "lockpick" && oe.targets.length === 0);

        // Select the gate → inspector; add a destructible condition (a batter-able door).
        await g.eval(setBrush("select"));
        gp = await tileScreen(1, 3); await g.clickScene(gp.x, gp.y); await sleep(120);
        await g.eval(`(() => {
          const insp = document.querySelector('[data-role="inspector"]');
          const box = [...insp.querySelectorAll('input[type=checkbox]')].find((b) => (b.parentElement.textContent || "").includes("destructible"));
          box.checked = true; box.dispatchEvent(new Event("change"));
        })()`);
        await sleep(120);
        oe = await objExp();
        check("the gate inspector adds a destructible condition (lockpick + destructible)", oe.openBy.join() === "destructible,lockpick");

        // Select the lever → inspector; wire it to the gate.
        await g.eval(setBrush("select"));
        await g.clickScene(lp.x, lp.y); await sleep(120);
        await g.eval(`(() => {
          const insp = document.querySelector('[data-role="inspector"]');
          insp.querySelector('input[type=checkbox]').click(); // the first gate in the target checklist
        })()`);
        await sleep(120);
        oe = await objExp();
        check("wiring the lever targets the gate in the export", oe.targets.length === 1);
        check("the level still validates with gates + a lever placed", (await g.eval(STATE)).valid === true);
        await g.screenshot(path.join(OUT, "08-objects.png"));

        assertNoProblems(g.problems);
      } catch (err) {
        await g.screenshot(path.join(OUT, "zz-failure.png")).catch(() => {});
        throw err;
      }
    },
    { hash: "#editor" },
  );
  console.log(`\n✓ editor E2E: ${passed} assertions passed, no page errors`);
}

main().catch((e) => { console.error(`\n${e.message ?? e}`); process.exit(1); });
