import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  webpack(config) {
    // wagmi v3 / @base-org connectors reference an optional "accounts" package
    // that is not installed. Provide an empty stub so the build doesn't fail.
    config.resolve.alias = {
      ...config.resolve.alias,
      accounts: false,
    };
    return config;
  },
};

export default nextConfig;
