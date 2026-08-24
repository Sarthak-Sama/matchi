import { defineConfig } from "vitest/config";

// Single root Vitest config with one project per workspace package that
// carries tests. `web` carries exactly one file (`lib/api.test.ts`, Task
// 15) by design — the frontend's test budget is deliberately limited to the
// handwritten fetch wrapper; no component tests, no Playwright.
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    // The `scripts` project's integration suites (migrate.test.ts,
    // seed.test.ts, derive.test.ts) are DB integration tests that share one
    // live PostGIS database via DATABASE_URL. seed.test.ts and
    // derive.test.ts both operate on DATABASE_URL's real `public` schema
    // directly (seed.ts doesn't support migrate.test.ts's scratch-schema
    // trick — see seed.test.ts's doc comment), so running those files in
    // parallel worker processes races: one file's TRUNCATE CASCADE (or
    // concurrent writes on the same rows) can wipe or deadlock against
    // another file's in-progress run. Serializing file execution avoids
    // that; test *files* still isolate their own state via TRUNCATE / a
    // fresh derive run, they just can't do so concurrently against the
    // same schema.
    fileParallelism: false,
    projects: [
      {
        test: {
          name: "shared",
          root: "./shared",
          environment: "node",
          globals: false,
          // Runs before every file in this project — see the setup
          // file for why this is global rather than per-suite.
          setupFiles: ["../vitest.setup.database-guard.ts"],
          include: ["src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "api",
          root: "./api",
          environment: "node",
          globals: false,
          // Runs before every file in this project — see the setup
          // file for why this is global rather than per-suite.
          setupFiles: ["../vitest.setup.database-guard.ts"],
          include: ["src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "scripts",
          root: "./scripts",
          environment: "node",
          globals: false,
          // Runs before every file in this project — see the setup
          // file for why this is global rather than per-suite.
          setupFiles: ["../vitest.setup.database-guard.ts"],
          include: ["src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "web",
          root: "./web",
          environment: "node",
          globals: false,
          // Runs before every file in this project — see the setup
          // file for why this is global rather than per-suite.
          setupFiles: ["../vitest.setup.database-guard.ts"],
          include: ["lib/**/*.test.ts"],
        },
      },
    ],
  },
});
