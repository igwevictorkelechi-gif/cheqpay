import type { NextConfig } from 'next';
import { createRequire } from 'module';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);
// victory-vendor's `exports` map only exposes the `./d3-*` wildcard (blocking
// direct `./es/...` access), so resolve its install dir and point at the ESM
// files by absolute path.
const victoryVendorDir = dirname(require.resolve('victory-vendor/package.json'));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // recharts pulls d3 through victory-vendor's CJS wrappers; transpiling them
  // lets webpack read their named exports (fixes the d3-shape/d3-scale errors).
  transpilePackages: ['recharts', 'victory-vendor'],
  webpack: (config) => {
    // victory-vendor ships no `exports` map, so `victory-vendor/d3-shape`
    // resolves to a CJS wrapper (`module.exports = require(...)`) whose named
    // re-exports webpack can't statically read — recharts then fails to import
    // curve/scale functions at runtime. Point the two subpaths recharts uses at
    // victory-vendor's ESM builds, which re-export d3 with real named exports.
    config.resolve.alias = {
      ...config.resolve.alias,
      'victory-vendor/d3-shape': join(victoryVendorDir, 'es/d3-shape.js'),
      'victory-vendor/d3-scale': join(victoryVendorDir, 'es/d3-scale.js'),
    };
    return config;
  },
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
