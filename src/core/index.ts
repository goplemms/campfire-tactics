// Barrel for the pure-logic core. The render layer (`game/`) imports from here;
// it must never reach into Phaser or the DOM. Everything below is plain data +
// functions, headlessly testable.
export * from "./rng";
export * from "./generation";
export * from "./iso";
export * from "./grid";
export * from "./pathfinding";
export * from "./planning";
export * from "./units";
export * from "./status";
export * from "./events";
export * from "./clock";
export * from "./combat";
export * from "./entities";
export * from "./camp";
export * from "./morale";
export * from "./inventory";
export * from "./deployment";
export * from "./resolution";
export * from "./vision";
export * from "./ai";
export * from "./skills";
export * from "./phases";
export * from "./jobs";
export * from "./turn";
export * from "./mortality";
export * from "./upkeep";
export * from "./intel";
export * from "./fatigue";
export * from "./overworld";
export * from "./overworld-actions";
export * from "./fog";
export * from "./forecast";
export * from "./ledger";
export * from "./leveling";
export * from "./run";
export * from "./runloop";
export * from "./caravan";
export * from "./guild";
export * from "./economy";
export * from "./economy-actions";
export * from "./theft";
export * from "./recruitment";
export * from "./node-events";
export * from "./objectives";
export * from "./authored";
export * from "./staging";
export * from "./expedition";
export * from "./hollow-mill";
// Note: `demo-quest` (the retiring DemoRunner path, M14 Phase 4) is intentionally
// NOT re-exported — its E1/E3/THE_HOLLOW_MILL names now belong to `hollow-mill`.
// Its remaining consumer (DemoScene) imports it directly until both are deleted.
