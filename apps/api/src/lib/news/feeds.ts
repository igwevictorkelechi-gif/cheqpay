import { getEnv } from "@/lib/env";

export interface NewsFeed {
  source: string;
  url: string;
}

/**
 * Public crypto-news RSS feeds pulled by the crypto-news cron. Free, no API key.
 * Override with the NEWS_FEEDS env var: a comma-separated list of either
 * `Source|https://url` pairs or bare URLs (the host becomes the source name).
 */
const DEFAULT_FEEDS: NewsFeed[] = [
  { source: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { source: "Cointelegraph", url: "https://cointelegraph.com/rss" },
];

function hostOf(url: string): string {
  const m = url.match(/^https?:\/\/([^/]+)/);
  return m ? m[1].replace(/^www\./, "") : "News";
}

export function newsFeeds(): NewsFeed[] {
  const raw = (getEnv().NEWS_FEEDS ?? "").trim();
  if (!raw) return DEFAULT_FEEDS;
  return raw
    .split(",")
    .map((part) => {
      const [a, b] = part.split("|").map((s) => s.trim());
      return b ? { source: a, url: b } : { source: hostOf(a), url: a };
    })
    .filter((f) => /^https?:\/\//.test(f.url));
}
