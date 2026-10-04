import type { NextConfig } from "next";

// Built as plain files (out/) for upload to the influencer.mycheqpay.com
// subdomain on the same kind of host as mycheqpay.com. Security headers and
// the /r/CODE rewrite live in public/.htaccess, since an export can't set them.
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
