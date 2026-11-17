import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@tokyo/shared"],
  experimental: {
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js"],
    },
  },
  webpack(config) {
    config.optimization.concatenateModules = false;
    return config;
  },
};

export default nextConfig;
