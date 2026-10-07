import type { Metadata } from "next";

// The venue screen player is for TVs at partner venues, not for search engines.
export const metadata: Metadata = {
  title: "CheqPay Ads screen",
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
