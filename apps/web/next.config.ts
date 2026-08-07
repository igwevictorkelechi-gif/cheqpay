import type { NextConfig } from "next";

/**
 * Two build modes from one codebase.
 *
 * Default: the normal Next build, which is what Vercel deploys today.
 *
 * STATIC_EXPORT=1: emits a folder of plain HTML/CSS/JS into `out/`, which any
 * web server can hand out — including cPanel shared hosting, where you upload
 * it to public_html and nothing else is required. No Node, no PHP, no database
 * on the web host: every page is client-rendered and talks to the CheqPay API
 * over HTTPS, so the host only ever serves files.
 *
 * Gated behind the env var rather than switched on permanently so the existing
 * Vercel deployment keeps behaving exactly as it does now while the static
 * build is being tried out. See apps/web/STATIC-HOSTING.md.
 */
const isStaticExport = process.env.STATIC_EXPORT === "1";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  ...(isStaticExport
    ? {
        output: "export" as const,
        // Emit /login/index.html rather than /login.html, so Apache and nginx
        // serve the right file from a directory URL with no rewrite rules.
        trailingSlash: true,
      }
    : {}),

  images: {
    // Next's image optimizer is a server feature; a static host has nothing to
    // run it. Images are served as authored instead.
    unoptimized: isStaticExport,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
      },
    ],
  },
};

export default nextConfig;
