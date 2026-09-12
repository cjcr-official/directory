import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import path from "node:path";

/**
 * What a running copy of the app compares itself against to notice it is out
 * of date. The commit is the honest answer: CI builds one commit, deploys it,
 * and every browser holding an older one should come forward.
 *
 * The cost is that a commit touching only the README still asks everyone to
 * reload. A reload is a second, and the alternative - hashing the built
 * assets - cannot be baked into those same assets without rewriting them
 * after the fact.
 */
function buildVersion(): string {
  const fromCi = process.env.GITHUB_SHA ?? process.env.CF_PAGES_COMMIT_SHA;
  if (fromCi) return fromCi.slice(0, 12);
  try {
    return execSync("git rev-parse --short=12 HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    // No git, no CI: a build stamp still changes on every build, which is the
    // safe direction to be wrong in.
    return `t${Date.now().toString(36)}`;
  }
}

const VERSION = buildVersion();

/**
 * Publishes the version twice: baked into the bundle as __APP_VERSION__, and
 * standing alone at /version.json for the running app to poll. The two are
 * the same string from the same build, so a difference between them means
 * exactly one thing - the browser is holding an older build.
 */
function versionStamp(): Plugin {
  const body = JSON.stringify({ version: VERSION, builtAt: new Date().toISOString() });
  return {
    name: "church-directory:version-stamp",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: body });
    },
    // Emitted assets do not exist on the dev server, and a 404 there would
    // fall through to index.html and read as a corrupt response.
    configureServer(server) {
      server.middlewares.use("/version.json", (_request, response) => {
        response.setHeader("Content-Type", "application/json");
        response.setHeader("Cache-Control", "no-store");
        response.end(body);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), versionStamp()],
  define: {
    __APP_VERSION__: JSON.stringify(VERSION),
  },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  build: {
    outDir: "dist",
    /**
     * Off for the build that goes out, on when somebody asks for it.
     *
     * A source map carries `sourcesContent` - the original TypeScript, comments
     * and all - and Vite writes a `sourceMappingURL` into each chunk, so any
     * browser that opens devtools fetches it. Deployed, that published 4.4 MB
     * of this app's own source from /assets, behind a year-long immutable
     * cache, for a directory whose whole purpose is keeping a congregation's
     * addresses and phone numbers off the open web. The bundle is public by
     * necessity; its source is not, and shipping the map is the same thing as
     * shipping unminified code.
     *
     * Nothing is lost day to day: `npm run dev` has maps, and a production
     * build worth stepping through is one command away -
     * `VITE_SOURCEMAP=1 npm run build` - which keeps them local rather than
     * putting them on the site.
     */
    sourcemap: process.env.VITE_SOURCEMAP === "1",
    rollupOptions: {
      output: {
        // pdf-lib is only needed on the preview and print screens, so it gets
        // its own chunk and stays out of the initial load.
        manualChunks(id) {
          if (id.includes("node_modules/pdf-lib")) return "pdf";
          if (id.includes("node_modules/@supabase")) return "supabase";
          return undefined;
        },
      },
    },
  },
});
