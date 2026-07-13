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
// Returns the event name, its lowercased choice labels, and the text actually **rendered**
// on the overlay panel (so we assert what the player sees, not just what the loop computed).
async function openEvent(node) {
  return withGame(async (g) => {
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

async function main() {
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
