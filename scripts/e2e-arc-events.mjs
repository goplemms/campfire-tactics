// E2E: the Wave-0 arc's authored **overworld event** screens render in a real browser.
// Regression guard for the freeze where a pinned "story"-kind event (the Scout→Thief
// mentor beats, guild-contact / guild-rite) crashed the OverworldScene — `showStoryScreen`
// called `storyForNode` (the random pool) and read the already-cleared `campNode`. The
// pure-core suite can't reach this (it's render-layer dispatch), the sim skips events'
// interactive screens, and the deploy e2e never opens an overworld event. This does.
//
// It also opens the arc's **finale** in the real BattleScene (#210): The Rescue, staged from content
// JSON with the party each arm actually arrives with. The rescue e2e drives the same board from a
// ready-made harness party; only this walk proves the arc's own node stages it — the Cuffed Cell's
// intel unions the side door in on one arm, the other arm deploys at the front gate alone, and
// neither freezes the scene.
//
// Run:  npm run test:e2e:arc   (needs Chrome — see scripts/harness.mjs)
import { withGame, ov, jumpTo, sleep } from "./harness.mjs";

let passed = 0;
function check(name, cond) {
  if (!cond) throw new Error(`✗ ${name}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// Park on the overworld at a mentor-beat node and open its event (the prep-camp "Begin" →
// playEvent → showStoryScreen). A fresh boot per node keeps the run's forward-only walk valid.
// withGame throws on any page error / console.error, so a scene crash here fails the guard.
// Returns the event name, its lowercased choice labels, and the text actually **rendered**
// on the overlay panel (so we assert what the player sees, not just what the loop computed).
async function openEvent(node) {
  return withGame(async (g) => {
    // Wait out the `#demo` boot handoff before navigating — the OverworldScene sets
    // run/loop in init(), and jumpTo reads `s.run.mapNodeId` (CI flaked here otherwise).
    await g.waitForScene("OverworldScene", ["run", "loop"]);
    await g.eval(jumpTo({ target: node, into: "overworld" }));
    await sleep(700);
    return g.eval(ov(`
      const n = s.run.map.nodes[${JSON.stringify(node)}];
      s.campNode = n;
      s.commit();
      const rendered = s.overlay.filter(o => o && o.type === "Text").map(o => o.text.toLowerCase());
      return {
        name: s.loop.eventDef().name,
        choices: s.loop.eventChoices().map(c => c.label.toLowerCase()),
        rendered,
      };
    `));
  });
}

const INFIL = ["start", "e1", "camp2", "snares", "market", "guildContact", "den", "outerYard", "guildRite", "cuffedCell", "finale"];
const SUSTAIN = ["start", "e1", "camp2", "snares", "market", "wagon", "restCamp", "finale"];

// Jump-boot the arc's finale via the arrival seam (`#demo?node=…&route=…`, the fights before it
// simulated) and snapshot the staged deploy in tile terms.
async function openFinale(route) {
  return withGame(async (g) => {
    await g.waitForScene("BattleScene", ["battle"]);
    await sleep(700);
    return g.bsEval(`
      const u = s.battle.units;
      const key = p => p.col + "," + p.row;
      const zones = s.battle.spawnZones;
      const players = u.filter(v => v.side === "player" && !v.captured);
      const tiles = new Set(zones.flatMap(z => z.tiles.map(key)));
      return {
        phase: s.phase,
        source: s.loop.staged.source.id,
        flag: !!s.run.flags["side-door-intel"],
        zoneIds: zones.map(z => z.id),
        warden: u.some(v => v.id === "the-warden"),
        captives: u.filter(v => v.role === "prisoner" && v.captured).map(v => v.id).sort(),
        players: players.length,
        placed: players.filter(v => tiles.has(key(v.pos))).length,
        distinctTiles: new Set(players.map(v => key(v.pos))).size,
        crates: s.crateMarkers.length,
      };
    `);
  }, { hash: `#demo?node=finale&route=${route.join(",")}&into=battle` });
}

async function main() {
  const infil = await openFinale(INFIL);
  console.log("• the arc's finale (infiltration arm) stages The Rescue with the side door open");
  check("the finale staged into deployment (no freeze)", infil.phase === "deployment");
  check("the arc's finale node stages The Rescue's body", infil.source === "the-rescue");
  check("the named Warden and all three prisoners are on the board",
    infil.warden && JSON.stringify(infil.captives) === JSON.stringify(["bram", "cass", "wren"]));
  check("the Cuffed Cell's win carried the side-door intel into the finale", infil.flag === true);
  check("…so both entrances stage", JSON.stringify(infil.zoneIds) === JSON.stringify(["front-gate", "side-door"]));
  check("every arriving party member starts inside a deploy zone, one per tile",
    infil.placed === infil.players && infil.distinctTiles === infil.players);
  check("the side-door supply crate is on the board", infil.crates === 1);

  const sustain = await openFinale(SUSTAIN);
  console.log("• the arc's finale (sustain arm) degrades to the front gate alone");
  check("the finale staged into deployment (no freeze)", sustain.phase === "deployment");
  check("the sustain arm arrives without the intel", sustain.flag === false);
  check("only the front gate stages", JSON.stringify(sustain.zoneIds) === JSON.stringify(["front-gate"]));
  check("every arriving party member starts inside the front gate, one per tile",
    sustain.placed === sustain.players && sustain.distinctTiles === sustain.players);
  check("the crate is there on this arm too (the level never changes)", sustain.crates === 1);

  const contact = await openEvent("guildContact");
  check(`guild-contact: the authored event opened (no crash) — "${contact.name}"`, !!contact.name);
  check(`guild-contact: surfaces the guild token invite`, contact.choices.some((l) => l.includes("token")));

  // #179 part 1 — the token is a Scout-only offer. The Hollow Mill's start party is Edrin
  // (soldier) · Rook (hunter) · Vale (scout); the combat-skipping walk to guildContact keeps
  // just that party, so exactly one token offer must appear, and it must be Vale's — the old
  // `jobLevel scout >= 1` gate would have offered a token to Edrin and Rook too.
  const tokenOffers = contact.choices.filter((l) => l.includes("token") && !l.includes("leave"));
  check(`guild-contact: exactly one party member is offered the token`, tokenOffers.length === 1);
  check(`guild-contact: the token offer goes to the Scout (Vale)`, tokenOffers[0].includes("vale"));
  check(
    `guild-contact: no non-Scout (Edrin/Rook) is offered the token`,
    !contact.choices.some((l) => l.includes("token") && (l.includes("edrin") || l.includes("rook"))),
  );

  // #179 part 2 — the screen shows the authored StorySpec.prompt, not the short map teaser.
  // The prompt opens "In a back-alley tavern…"; the teaser has no such phrase.
  check(
    `guild-contact: the panel renders the full authored prompt, not the teaser`,
    contact.rendered.some((t) => t.includes("back-alley tavern")),
  );

  const rite = await openEvent("guildRite");
  check(`guild-rite: the authored event opened (no crash) — "${rite.name}"`, !!rite.name);
  check(`guild-rite: surfaces its choices`, rite.choices.length > 0);
  check(
    `guild-rite: the panel renders the full authored prompt`,
    rite.rendered.some((t) => t.includes("the guild makes good on the token")),
  );

  console.log(`\n✓ arc-events E2E: ${passed} assertions passed, no page errors`);
}

main().catch((e) => { console.error(String(e && e.stack || e)); process.exit(1); });
