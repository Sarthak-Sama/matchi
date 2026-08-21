import { defineConfig } from "vitest/config";

// Single root Vitest config with one project per workspace package that
// carries tests. `web` is intentionally excluded — the frontend has no test
// suite by design (see docs/plans/tokyo-optimizer-mvp.md).
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    projects: [
      {
        test: {
          name: "shared",
          root: "./shared",
          environment: "node",
          globals: false,
          include: ["src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "api",
          root: "./api",
          environment: "node",
          globals: false,
          include: ["src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "scripts",
          root: "./scripts",
          environment: "node",
          globals: false,
          include: ["src/**/*.test.ts"],
        },
      },
    ],
  },
});
