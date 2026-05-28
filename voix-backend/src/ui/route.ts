/**
 * Static UI serving for `voix-backend/ui/dist/`.
 *
 * Built UI lives at `<repo>/voix-backend/ui/dist/` after
 * `bun run build` in the ui directory. In the HA Add-on Docker image
 * the Dockerfile runs that build at image-build time; in dev mode the
 * run.sh poller also runs `bun install && bun run build` in ui/ when
 * commits land. So by the time we hit this route the dist/ directory
 * is on disk.
 *
 * Route shape:
 *   GET /            → ui/dist/index.html  (SPA root)
 *   GET /assets/...  → ui/dist/assets/...  (bundled JS/CSS)
 *   GET /<anything-without-an-extension>  → ui/dist/index.html
 *                                           (SPA client-side routing
 *                                            fallback)
 *
 * Routes registered EARLIER in the Elysia chain (/ws, /healthz, /api/*,
 * /recordings/*) keep priority — Elysia matches in order.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { Elysia } from "elysia";
import { log } from "../log.ts";

// The daemon may be run from /app (production add-on), from
// /data/voix-dev/voix-backend (dev mode), or directly via bun on a
// dev machine. Resolve the dist/ at runtime relative to this file.
function uiDistDir(): string {
  // import.meta.url is `file:///.../src/ui/route.ts`. Step up to
  // `voix-backend/` then into ui/dist/.
  const here = new URL(".", import.meta.url).pathname;
  return join(here, "..", "..", "ui", "dist");
}

const DIST = uiDistDir();
const INDEX = join(DIST, "index.html");

export function uiRoute() {
  if (!existsSync(INDEX)) {
    log.warn(
      `ui: no built bundle at ${DIST}. Run 'bun run build' in voix-backend/ui ` +
        `to populate it. UI routes will return 404 until then.`,
    );
  }

  return (
    new Elysia({ name: "voix.ui" })
      .get("/", () => Bun.file(INDEX))
      .get("/index.html", () => Bun.file(INDEX))
      .get("/assets/*", ({ params, set }) => {
        // `*` in Elysia params is a single string with the rest of the path.
        const wildcardKey = "*" as const;
        const rest = (params as Record<string, string>)[wildcardKey] ?? "";
        const full = join(DIST, "assets", rest);
        // Belt-and-braces against any "../" sneaking past the URL parser.
        if (!full.startsWith(join(DIST, "assets"))) {
          set.status = 400;
          return "bad path";
        }
        const file = Bun.file(full);
        return file;
      })
      // SPA fallback: anything else without a file extension is a
      // client-routed path inside the app — return index.html.
      .get("/*", ({ params, set }) => {
        const wildcardKey = "*" as const;
        const rest = (params as Record<string, string>)[wildcardKey] ?? "";
        if (rest.includes(".")) {
          // A request for a static file we don't have — let the client see 404.
          set.status = 404;
          return "not found";
        }
        return Bun.file(INDEX);
      })
  );
}
