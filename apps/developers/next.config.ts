import type { NextConfig } from "next";

// Built as plain files (out/) for upload to developers.mycheqpay.com, like the
// creator portal. Security headers live in public/.htaccess, since an export
// can't set them. The API contract (scopes, events, errors, the OpenAPI
// document) comes straight from @cheqpay/devapi, so the docs can't drift from
// what the API actually does.
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@cheqpay/devapi"],
};

export default nextConfig;
