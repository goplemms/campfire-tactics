// E2E: the Wave-0 arc's authored **overworld event** screens render in a real browser.
// Regression guard for the freeze where a pinned "story"-kind event (the Scout→Thief
// mentor beats, guild-contact / guild-rite) crashed the OverworldScene — `showStoryScreen`
// called `storyForNode` (the random pool) and read the already-cleared `campNode`. The
// pure-core suite can't reach this (it's render-layer dispatch), the sim skips events'
// interactive screens, and the deploy e2e never opens an overworld event. This does.
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
async function openEvent(node) {
  return withGame(async (g) => {
    await g.eval(jumpTo({ target: node, into: "overworld" }));
    await sleep(700);
    return g.eval(ov(`
      const n = s.run.map.nodes[${JSON.stringify(node)}];
      s.campNode = n;
      s.commit();
      return { name: s.loop.eventDef().name, choices: s.loop.eventChoices().map(c => c.label.toLowerCase()) };
    `));
  });
}

async function main() {
  const contact = await openEvent("guildContact");
  check(`guild-contact: the authored event opened (no crash) — "${contact.name}"`, !!contact.name);
  check(`guild-contact: surfaces the guild token invite`, contact.choices.some((l) => l.includes("token")));

  const rite = await openEvent("guildRite");
  check(`guild-rite: the authored event opened (no crash) — "${rite.name}"`, !!rite.name);
  check(`guild-rite: surfaces its choices`, rite.choices.length > 0);

  console.log(`\n✓ arc-events E2E: ${passed} assertions passed, no page errors`);
}

main().catch((e) => { console.error(String(e && e.stack || e)); process.exit(1); });
