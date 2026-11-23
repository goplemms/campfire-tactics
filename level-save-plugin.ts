/**
 * The editor's **Save to game** endpoint — dev server only (`npm run dev`, and the e2e harness).
 *
 * The level editor runs in the browser, which can't write repo files. This plugin gives it one narrow
 * route: POST a level, and it is written to `src/content/levels/<id>.json`, where the level loader picks
 * it up on the next page load (no registry edit, D98). Committing the file is still a git step, but it
 * is the only one left.
 *
 * Narrow on purpose: one route, one folder, a file name checked against a strict pattern (no paths), and
 * an existing file is replaced only when the request says `overwrite`. The production build has no
 * server, so the route does not exist there and the editor hides the button.
 *
 * `CAMPFIRE_LEVELS_DIR` points the writes elsewhere — the e2e test uses a temporary folder so a test run
 * never touches the shipped levels.
 */

import type { Plugin } from "vite";
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { SAVE_LEVEL_ROUTE, checkSaveRequest, type SaveLevelResponse } from "./src/content/level-file";

const MAX_BODY = 2_000_000;

export function levelSavePlugin(): Plugin {
  return {
    name: "campfire-level-save",
    apply: "serve",
    configureServer(server) {
      const dir = process.env.CAMPFIRE_LEVELS_DIR ?? path.resolve(server.config.root, "src/content/levels");
      server.middlewares.use(SAVE_LEVEL_ROUTE, (req, res) => {
        const reply = (code: number, body: SaveLevelResponse): void => {
          res.statusCode = code;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(body));
        };
        if (req.method !== "POST") return reply(405, { status: "refused", reason: "use POST" });
        let raw = "";
        let tooBig = false;
        req.setEncoding("utf8");
        req.on("data", (chunk: string) => {
          raw += chunk;
          if (raw.length > MAX_BODY) tooBig = true;
        });
        req.on("end", () => {
          void (async () => {
            if (tooBig) return reply(413, { status: "refused", reason: "the level is too large to save" });
            let body: unknown;
            try { body = JSON.parse(raw); } catch { return reply(400, { status: "refused", reason: "the request isn't valid JSON" }); }
            const check = checkSaveRequest(body);
            if (!check.ok) return reply(400, { status: "refused", reason: check.reason });
            const target = path.join(dir, check.file);
            const exists = await access(target).then(() => true, () => false);
            // 200, not 409: "it exists, confirm the overwrite" is an expected answer, not a failed request.
            if (exists && !check.overwrite) return reply(200, { status: "exists", file: check.file });
            try {
              await mkdir(dir, { recursive: true });
              await writeFile(target, check.text, "utf8");
            } catch (err) {
              return reply(500, { status: "refused", reason: `couldn't write ${check.file}: ${(err as Error).message}` });
            }
            reply(200, { status: "saved", file: check.file, replaced: exists });
          })();
        });
      });
    },
  };
}
