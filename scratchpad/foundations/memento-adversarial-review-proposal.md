# Workflow improvement — the Adversarial Review gate (phone-home to memento)

> **Reflection artifact (2026-07-12).** Discovered while using memento in `campfire-tactics`: an
> **adversarial red-team of each design decision before it's finalized** repeatedly caught
> concept-level failures pre-commit. This session is the **reference implementation**. Proposing
> it as a durable memento step, to phone home via **Iterate on Asset** (+ an ADR under
> `docs/decisions/`).

## The gap

memento's **Discussion to Plan** (hypothesis → evidence → questioning → **alignment checkpoint**
→ **plan drafting**) has **no review/red-team step**. Decisions graduate to `plan.md` /
`decisions.md` straight from alignment. So a plausible-but-wrong decision reaches the plan
un-stress-tested, and the error is found at build (expensive) instead of at design (cheap).

## The proposed step — "Adversarial Review" (a decision gate)

**Trigger (consistent, this is the ask):** *no design decision is finalized until it clears an
adversarial red-team.* Applied **per decision or per small batch**, as a gate between the
alignment checkpoint and drafting (and reusable at any decision-graduation point in **Orchestrate**).
A lightweight status convention rides along: **PROVISIONAL** (settled, not red-teamed) →
**CLEARED** (survived, safe to graduate).

**The ritual (distilled from this session):**
1. **Settle** a decision, or a small **batch** of them (batch for efficiency — each pass is N agents).
2. **Fan out N (≈3–4) *independent* critics, each a *distinct lens*** — e.g. correctness/feasibility ·
   balance/incentives · architecture/scope · representativeness/fun · whole-batch coherence. Each is
   mandated to **break** the idea and to **ground every claim in the actual code/docs**, not hand-wave.
3. **Synthesize the *surviving* objections** — dedupe; separate concept-threatening from minor; keep
   what's grounded.
4. **Revise or finalize**, and record the status flip (PROVISIONAL → CLEARED) in the doc.

**Scale to stakes:** a few finders for a small call; 4–5 diverse lenses + a synthesis for a large one.

## Why it earns its cost (evidence from this session)

Across ~5 passes it caught, pre-commit, failures a single reviewer rationalizes away — each
grounded in code:
- a **dominated fork** that taught the *inverse* of its lesson;
- the first arc **misrepresenting the game** + being ~8 systems in a "one-node" costume;
- a **hollow buildable core** — the "dual-victory finale" would ship frontal-only, the objectives
  substrate had no consumer, and **`THIEF_JOB` clears Quiet Footsteps** so the marquee prestige was a
  *deployment downgrade* with its payoff parked;
- **"parked the headline"** — about to build the least-novel piece first.

None of these were visible from the decision statements alone; independent, code-grounded lenses
surfaced them.

## Costs / guardrails (so it's not over-applied)

- **Token-expensive** (N subagents/pass) → **batch** decisions; reserve for *substantive* design
  calls, not micro-choices.
- **Independence matters** — distinct lenses + a "try to break it" mandate; a single generic
  "review" pass reproduces the blind spot.
- **Grounding matters** — critics must read the real code/docs; ungrounded critique invents problems.

## How it slots into memento (the phone-home)

- **Iterate on Asset** → amend `skills/discussion-to-plan/SKILL.md`: insert an **Adversarial Review
  gate** between alignment and drafting, with the PROVISIONAL/CLEARED convention. Optionally extract a
  small reusable **`adversarial-review` asset** that Discussion-to-Plan and Orchestrate both call
  (mirrors how the kit composes skills).
- **ADR** under `docs/decisions/` recording the adoption + this session as the reference.
- Propagates to every repo automatically via the symlinked canonical files.

## Phone-home execution (proposed)

`goplemms/memento` isn't in this session's scope and the plugin isn't on disk, so: **add the repo,
then open a PR** (skill edit + ADR) — or, lighter, **file an issue** with this proposal for the
maintainer to land. Recommend the **PR** (it's a small, well-scoped skill edit) with the issue as the
fallback.
