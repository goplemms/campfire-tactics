# 09 · Jobs × Phases

The cross-cutting capstone — the single grid that answers *"which job does what, and **where**?"*
The game's signature architecture is that **most jobs act in a different surface**: combat classes
in the fight, the economy classes in camp, the Scout and Survivalist spanning the pre-battle setup.
Read down a column to see who's active on that surface; read across a row to see a job's reach.

The surfaces map to the [mission pipeline](06-mission-pipeline.md) + the
[overworld camp](05-node-lifecycle.md): **Overworld / Camp** (Meta provisioning + between-node
actions) · **Deployment** (the on-map setup) · **Combat** (the CT-clock fight).

| Job | Overworld / Camp | Deployment | Combat |
|---|---|---|---|
| **Soldier** | — | — | **Turtle Formation · Debilitating Strike · Brother-in-arms** |
| **Heavy Knight** | — | — | **Cleave · Shove · Tarpit** |
| **Hunter** | — | — | **Mark Prey · Reposition · Deadeye** |
| **Medic** | Triage (camp heal) | — | **Heal · Mend** |
| **Snare-Trapper** | — | (enemy prep snares) | **Snare** |
| **Scout** | Survey (scout ahead) | **Set Trap · Quiet Footsteps** | Recon |
| **Survivalist** | Forage | **Set Trap** | — |
| **Cook** | **Cook Stew · Feast · Field Kitchen** | — | — |
| **Merchant** | **Find Trade · Savvy Barter · Appraisal** | — | — |
| **Noble** | Patronize · Renown (trickle) | — | **Bribe** |
| **Banker** | **Invest · Borrow · Guard the Purse** | — | — |
| **Assassin** *(Scout fork)* | — | Hidden Passage setup | **Subtle Blade · Surgical Precision** |
| **Thief** *(Scout fork)* | Deft Hands (skim) | — | **Hidden Passage · Expert Lockpick** |

**Bold** = the job's **center of gravity** (where its value concentrates); plain = a secondary
reach; — = nothing job-specific (universal verbs still apply everywhere).

## Reading it

- **The bands are the design.** Combat classes cluster in the **Combat** column; the economy /
  support classes (Cook · Merchant · Noble · Banker) cluster in **Overworld / Camp**; and a few
  jobs — **Scout, Survivalist, Noble** — deliberately **span** surfaces. That spread is *why* a
  caravan slot is a real cost: a Cook earns its keep off the grid, so bringing it genuinely trades
  away a fighter.
- **Combat / non-combat is *emergent*, not stamped.** There's no `noncombat` flag — a job is
  "non-combat" simply because its skills have **no combat `usableContext`**. This matrix *is* that
  read made visible: the column a job's bold cells land in is its center of gravity. So the
  Survivalist (Deployment) and the Cook (Overworld) sit on a spectrum, not in two buckets.
- **The Scout is the clearest "spanner"** — it Surveys the road (Overworld), sets traps and slips
  the net (Deployment), and darts with Recon (Combat). Its forks then specialize: the **Assassin**
  collapses toward Combat, the **Thief** drifts toward Overworld utility.
- **Growth itself lives one tier up**, at the [guild](01-guild.md): leveling and accepting a
  [prestige](jobs/04-prestige.md) are managed between fights, not on any single surface here.

> Maps to: the [jobs mini-atlas](jobs/README.md) (esp. the [roster](jobs/03-roster.md)) and
> [systems/jobs.md → Emergent combat / non-combat](../systems/jobs.md).
