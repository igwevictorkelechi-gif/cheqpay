import type { MetadataRoute } from "next";

// Makes the dashboard installable as an app (Add to Home Screen / Install), so
// admins get alerts like a native app, including on iPhone, where web push
// only works for an installed app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "CheqPay Admin",
    short_name: "CheqPay Admin",
    description: "Run CheqPay: review gift cards, users, withdrawals and more, with alerts.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f9fafb",
    theme_color: "#ffffff",
    icons: [
      { src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
