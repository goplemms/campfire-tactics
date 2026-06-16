# Path 2 — Discussion Kickoff Prompt

> Paste this to **begin** the Path 2 design discussion. It opens a *design* session
> (not a build): we work the open questions to locked calls, then graduate to a build
> prompt. Continue on `claude/jolly-volta-euogwo` (or a fresh design branch).

---

Let's design **Path 2 — authored set-pieces on the expedition frame**: putting
authored encounters (the *Hollow Mill* fights, and authored content generally) onto
**overworld nodes**, so an expedition can wrap hand-crafted combat in the M13 routing
economy — a comprehensive expedition demo now, and the substrate for authored campaign
content (D26) later.

This is a **discussion, not a build.** Do not write feature code or open a PR yet.

**Read first**, then hold the context:
- `scratchpad/foundations/path2-authored-expedition-kickoff.md` — the agenda: the
  goal, the two-stack gap, the architecture rules, and the **Open discussion queue
  (Q0–Q8)** with options + a starting lean for each. This is what we're resolving.
- The code + decisions it lists as *Read-first* (authored.ts, runloop.ts, generation.ts,
  overworld/run.ts, forecast.ts/ledger.ts, BattleScene vs DemoScene, combat-view.ts;
  decisions D43/D44/D23/D26/D22). **Ground every call in what the code actually does** —
  the heart of Path 2 is converging two real combat renderers, so be concrete.

**How to run the discussion:**
1. Work **one question at a time, in order (Q0 → Q8).** Q0 (scope: milestone vs
   M13 follow-on) gates the rest — settle it first.
2. For each question: restate it crisply, give the **trade-offs grounded in the
   code**, **recommend** one option with a one-paragraph rationale, and surface any
   risk or hidden cost (esp. Q3, the renderer convergence — name which objective
   kinds ship first). Then **stop and ask me to confirm or redirect** before moving on.
3. As calls are locked, keep a running **Decisions so far** list (question → the
   call → one-line why), so the thread always shows current state.
4. If a new question surfaces that isn't in the queue (e.g. folding the deferred
   **gold-scarcity tuning** in, or DemoScene retirement timing), add it to the queue
   and flag it — don't silently absorb it.
5. Prefer my leans in the kickoff doc as a **starting point**, not a conclusion —
   argue against them where the code warrants.

**Definition of done (for this discussion):** Q0–Q8 each have a confirmed call; Q3
has a named first set of objective kinds; the scope tier is chosen. Then propose the
**graduation step** — a Path 2 build prompt + the `decisions.md` entries (the
node→authored seam, the encounter union, graded-failure-on-overworld, the
`AuthoredExpedition` substrate) + a `plan.md` row — and wait for my go-ahead before
writing any of it.

**Start now** with **Q0 — scope & framing.** Give me the recommendation and the
trade-off, then wait for my call.
