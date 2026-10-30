import { describe, expect, it } from "vitest";
import { parseRss } from "./rss";

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Crypto</title>
  <item>
    <title><![CDATA[Bitcoin tops $70k & holds]]></title>
    <link>https://example.com/a?x=1&y=2</link>
    <pubDate>Tue, 28 Oct 2026 10:00:00 GMT</pubDate>
    <description><![CDATA[<p>BTC rallied on <b>volume</b>.</p>]]></description>
  </item>
  <item>
    <title>Ether update</title>
    <link>https://example.com/b</link>
  </item>
  <item>
    <title>Missing link is skipped</title>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Atom headline</title>
    <link href="https://example.com/atom" rel="alternate"/>
    <published>2026-10-27T09:00:00Z</published>
    <summary>Short summary.</summary>
  </entry>
</feed>`;

describe("parseRss", () => {
  it("parses RSS items with CDATA, entities and HTML-stripped summaries", () => {
    const items = parseRss(RSS);
    expect(items).toHaveLength(2); // the link-less item is skipped
    expect(items[0]).toEqual({
      title: "Bitcoin tops $70k & holds",
      url: "https://example.com/a?x=1&y=2",
      publishedAt: new Date("Tue, 28 Oct 2026 10:00:00 GMT"),
      summary: "BTC rallied on volume.",
    });
    expect(items[1]).toEqual({
      title: "Ether update",
      url: "https://example.com/b",
      publishedAt: null,
      summary: null,
    });
  });

  it("parses Atom entries with href links", () => {
    const items = parseRss(ATOM);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Atom headline");
    expect(items[0].url).toBe("https://example.com/atom");
    expect(items[0].summary).toBe("Short summary.");
  });

  it("returns nothing for junk", () => {
    expect(parseRss("not xml at all")).toEqual([]);
  });
});
