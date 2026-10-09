// What a creator application is made of. Mirrors the API's rules
// (apps/api/src/lib/creatorApplications.ts) so the form can say what's wrong
// before sending; the API checks everything again.

export const PLATFORMS = {
  instagram: { name: "Instagram", hosts: ["instagram.com"], profile: (h: string) => `https://www.instagram.com/${h}` },
  tiktok: { name: "TikTok", hosts: ["tiktok.com"], profile: (h: string) => `https://www.tiktok.com/@${h}` },
  x: { name: "X", hosts: ["x.com", "twitter.com"], profile: (h: string) => `https://x.com/${h}` },
  youtube: { name: "YouTube", hosts: ["youtube.com", "youtu.be"], profile: (h: string) => `https://www.youtube.com/@${h}` },
  facebook: { name: "Facebook", hosts: ["facebook.com", "fb.com", "fb.watch"], profile: (h: string) => `https://www.facebook.com/${h}` },
  snapchat: { name: "Snapchat", hosts: ["snapchat.com"], profile: (h: string) => `https://www.snapchat.com/add/${h}` },
  threads: { name: "Threads", hosts: ["threads.net", "threads.com"], profile: (h: string) => `https://www.threads.net/@${h}` },
  linkedin: { name: "LinkedIn", hosts: ["linkedin.com"], profile: (h: string) => `https://www.linkedin.com/in/${h}` },
  other: { name: "Other", hosts: [] as string[], profile: null },
} as const;
export type PlatformKey = keyof typeof PLATFORMS;
export const PLATFORM_KEYS = Object.keys(PLATFORMS) as PlatformKey[];

export const FOLLOWER_BANDS = ["<1k", "1k-10k", "10k-50k", "50k-100k", "100k-500k", "500k-1m", "1m+"] as const;
export const VIEW_BANDS = ["<1k", "1k-5k", "5k-20k", "20k-100k", "100k+"] as const;
export const NICHES = [
  "Finance", "Tech", "Crypto", "Lifestyle", "Comedy", "Fashion", "Beauty", "Music", "Sports", "Gaming",
  "Education", "Travel", "Food", "Business", "Faith", "Family", "Health", "News",
] as const;

export const AUDIENCE_LOCATIONS = [
  "Across Nigeria", "Lagos", "Abuja (FCT)", "Rivers", "Oyo", "Kano", "Kaduna", "Enugu", "Anambra", "Delta", "Edo", "Ogun",
  "Akwa Ibom", "Imo", "Abia", "Cross River", "Kwara", "Ondo", "Osun", "Ekiti", "Plateau", "Benue", "Kogi", "Niger",
  "Nasarawa", "Bauchi", "Borno", "Adamawa", "Gombe", "Taraba", "Yobe", "Jigawa", "Katsina", "Kebbi", "Sokoto", "Zamfara",
  "Bayelsa", "Ebonyi", "Mostly outside Nigeria",
] as const;

/** "10k-50k" → "10K–50K" */
export const band = (b: string) => b.replace("-", "–").replace(/k/g, "K").replace(/m/g, "M");

export const normalizeHandle = (raw: string) => raw.trim().replace(/^@+/, "").replace(/\/+$/, "");

export function httpsUrl(raw: string): URL | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return null;
    if (!u.hostname.includes(".") || /^[\d.]+$/.test(u.hostname)) return null;
    return u;
  } catch {
    return null;
  }
}

const onDomain = (host: string, d: string) => host === d || host.endsWith(`.${d}`);

export interface DraftSocial { platform: PlatformKey; handle: string; followers: string; url: string }

/** Why this platform entry isn't ready, or null. */
export function socialProblem(s: DraftSocial): string | null {
  const p = PLATFORMS[s.platform];
  const h = normalizeHandle(s.handle);
  if (!h) return `Add your ${p.name} ${s.platform === "other" ? "name" : "handle"}.`;
  if (s.platform !== "other" && !/^[A-Za-z0-9._-]{1,60}$/.test(h)) return `${p.name} handles use letters, numbers, dots and underscores.`;
  if (!s.followers) return "Pick roughly how many followers.";
  if (s.url.trim()) {
    const u = httpsUrl(s.url);
    if (!u || (p.hosts.length && !p.hosts.some((d) => onDomain(u.hostname, d)))) return `Use your ${p.name} profile link (https://…).`;
  } else if (!p.profile) return "Add a link to your page.";
  return null;
}

/** The profile link we'll show the team. */
export function profileUrl(s: DraftSocial): string | null {
  if (s.url.trim()) return httpsUrl(s.url)?.toString() ?? null;
  const p = PLATFORMS[s.platform];
  const h = normalizeHandle(s.handle);
  return p.profile && h ? p.profile(h) : null;
}

/** Why this post link won't be accepted, or null. */
export function postProblem(link: string, socials: DraftSocial[]): string | null {
  const u = httpsUrl(link);
  if (!u) return "Use a full link starting with https://";
  const own = socials.filter((s) => s.platform === "other").map((s) => httpsUrl(s.url)?.hostname ?? "").filter(Boolean);
  const hosts = [...PLATFORM_KEYS.flatMap((k) => PLATFORMS[k].hosts), ...own];
  return hosts.some((d) => onDomain(u.hostname, d)) ? null : "Link to a post on one of your platforms.";
}

/** Applications sent with the old one-page form stored platform names and follower counts. */
export function fromStored(s: { platform: string; handle: string; followers: string | number; url?: string | null }): DraftSocial {
  const key = s.platform.toLowerCase().startsWith("x") ? "x" : (s.platform.toLowerCase() as PlatformKey);
  const platform = PLATFORM_KEYS.includes(key) ? key : "other";
  let followers = typeof s.followers === "string" ? s.followers : "";
  if (typeof s.followers === "number") {
    const n = s.followers;
    followers = n < 1e3 ? "<1k" : n < 1e4 ? "1k-10k" : n < 5e4 ? "10k-50k" : n < 1e5 ? "50k-100k" : n < 5e5 ? "100k-500k" : n < 1e6 ? "500k-1m" : "1m+";
  }
  const built = PLATFORMS[platform].profile?.(normalizeHandle(s.handle));
  return { platform, handle: s.handle, followers, url: s.url && s.url !== built ? s.url : "" };
}
