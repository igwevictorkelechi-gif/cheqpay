import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // recharts pulls d3 through victory-vendor's CJS wrappers; transpiling them
  // lets webpack read their named exports (fixes the d3-shape/d3-scale errors).
  transpilePackages: ['recharts', 'victory-vendor'],
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
    ],
  },
};

export default nextConfig;
