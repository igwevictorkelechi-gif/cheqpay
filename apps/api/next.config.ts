import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Don't advertise the framework in every response.
  poweredByHeader: false,
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: false,
  },
  // Compile the workspace TS packages directly (no prebuild step).
  transpilePackages: ["@cheqpay/db", "@cheqpay/shared"],
};

export default nextConfig;
