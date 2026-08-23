import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @tokyo/shared publishes its TypeScript source directly (see
  // shared/package.json `exports`), so Next.js needs to transpile it like
  // first-party app code rather than treating it as pre-built node_modules.
  transpilePackages: ["@tokyo/shared"],
  experimental: {
    // shared/tsconfig.json uses NodeNext module resolution, so its own
    // source imports itself with explicit ".js" specifiers that actually
    // point at ".ts" files (e.g. `./config/scoring.js` resolving to
    // `./config/scoring.ts`) — the standard NodeNext-ESM pattern. webpack's
    // default resolver doesn't know that trick, so once transpilePackages
    // hands shared's source to webpack, resolution fails with "Module not
    // found" for every such import. This mirrors webpack's own
    // `resolve.extensionAlias` option to teach it the same aliasing
    // TypeScript already understands.
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js"],
    },
  },
  webpack(config) {
    // With extensionAlias resolving @tokyo/shared's chained `export *`
    // barrels (index.ts -> config/scoring.ts, contracts/index.ts,
    // domain/rent.ts) through to their real .ts files, webpack's
    // ModuleConcatenationPlugin ("scope hoisting") mis-resolves those
    // re-exports in a PRODUCTION build only: every named export (LAYOUT_IDS,
    // RENT_LABEL, OVERALL_WEIGHTS, ...) silently becomes `undefined` at
    // runtime, even though `next build`'s compile step reports success (it
    // does emit a slew of "X is not exported from @tokyo/shared" warnings,
    // easy to miss among normal build output). Confirmed by bisecting
    // `config.optimization`: turning off `concatenateModules` alone (module
    // minification and tree-shaking both stay on) makes every export
    // resolve correctly again. This is a narrow, targeted opt-out of one
    // webpack micro-optimization, not a general "disable optimization"
    // escape hatch — revisit if a future webpack/Next upgrade fixes the
    // concatenation bug upstream.
    config.optimization.concatenateModules = false;
    return config;
  },
};

export default nextConfig;
