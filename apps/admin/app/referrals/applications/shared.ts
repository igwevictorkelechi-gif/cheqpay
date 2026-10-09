export interface Social { platform: string; handle: string; followers: string | number; url?: string | null }

export interface ApplicationSummary {
  id: string;
  userId: string;
  email: string;
  kycTier: number;
  fullName: string;
  phone: string;
  socials: Social[];
  niches: string[];
  audienceLocation: string;
  avgViews: string | null;
  sampleLinks: string[];
  bio: string;
  priorBrands: string;
  why: string;
  preferredCode: string | null;
  status: 'PENDING' | 'NEEDS_INFO' | 'APPROVED' | 'REJECTED';
  reason: string | null;
  requestNote: string | null;
  reapplyAfter: string | null;
  submissions: number;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const STATUS_STYLE: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  NEEDS_INFO: 'bg-blue-100 text-blue-800',
  APPROVED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-700',
};

const PLATFORM: Record<string, string> = {
  instagram: 'Instagram', tiktok: 'TikTok', x: 'X', youtube: 'YouTube', facebook: 'Facebook',
  snapchat: 'Snapchat', threads: 'Threads', linkedin: 'LinkedIn', other: 'Other',
};

export const platformName = (p: string) => PLATFORM[p] ?? p;

/** Old applications stored a follower count; new ones a band like "10k-50k". */
export function followers(f: string | number): string {
  if (typeof f === 'string') return f.replace('-', '–');
  return f >= 1e6 ? `${(f / 1e6).toFixed(1)}M` : f >= 1e3 ? `${(f / 1e3).toFixed(1)}K` : String(f);
}

export const socialLine = (s: Social) => `${platformName(s.platform)} @${s.handle} (${followers(s.followers)})`;
