/**
 * A tiny, dependency-free RSS/Atom reader — just enough to pull headlines from
 * public crypto feeds (title, link, publish date, short summary). Deliberately
 * no XML library: feeds are simple and a new dependency isn't worth the weight.
 */

export interface ParsedNewsItem {
  title: string;
  url: string;
  publishedAt: Date | null;
  summary: string | null;
}

function stripCdata(s: string): string {
  const m = s.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return m ? m[1] : s;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** First `<name>…</name>` inside a block, CDATA-aware; null if absent/empty. */
function tagText(block: string, name: string): string | null {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i");
  const m = block.match(re);
  if (!m) return null;
  const value = decodeEntities(stripCdata(m[1])).trim();
  return value || null;
}

export function parseRss(xml: string): ParsedNewsItem[] {
  const out: ParsedNewsItem[] = [];
  // RSS <item> or Atom <entry>.
  const blocks = xml.match(/<(item|entry)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi) ?? [];
  for (const block of blocks) {
    const title = tagText(block, "title");
    // RSS text <link>, else Atom <link href="…">.
    let url = tagText(block, "link");
    if (!url) {
      const m = block.match(/<link[^>]*href=["']([^"']+)["']/i);
      url = m ? decodeEntities(m[1]) : null;
    }
    if (!title || !url) continue;

    const pub = tagText(block, "pubDate") ?? tagText(block, "published") ?? tagText(block, "updated") ?? tagText(block, "dc:date");
    const d = pub ? new Date(pub) : null;

    const descRaw = tagText(block, "description") ?? tagText(block, "summary");
    const summary = descRaw ? descRaw.replace(/<[^>]+>/g, "").trim().slice(0, 400) || null : null;

    out.push({ title, url, publishedAt: d && !Number.isNaN(d.getTime()) ? d : null, summary });
  }
  return out;
}
