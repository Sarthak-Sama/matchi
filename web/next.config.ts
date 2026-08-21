import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @tokyo/shared publishes its TypeScript source directly (see
  // shared/package.json `exports`), so Next.js needs to transpile it like
  // first-party app code rather than treating it as pre-built node_modules.
  transpilePackages: ["@tokyo/shared"],
};

export default nextConfig;
