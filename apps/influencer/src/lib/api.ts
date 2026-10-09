import { supabase } from "./supabase";

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "https://cheqpay-admin453.vercel.app";
export const APP_URL = "https://mycheqpay.com";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public path?: (string | number)[]) {
    super(message);
  }
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...((init.headers as Record<string, string>) ?? {}),
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      await supabase.auth.signOut().catch(() => undefined);
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    // Validation errors carry the field and a sentence we wrote for people.
    const issue = body?.issues?.[0] as { message?: string; path?: (string | number)[] } | undefined;
    const message = issue?.message && !/^(Required|Invalid|Expected)/.test(issue.message) ? issue.message : body?.error || res.statusText;
    throw new ApiError(res.status, message, body?.code, issue?.path);
  }
  return body as T;
}

export interface Social { platform: string; handle: string; followers: string | number; url?: string | null }
export type ApplicationStatus = "PENDING" | "NEEDS_INFO" | "APPROVED" | "REJECTED";
export interface Application {
  id: string; fullName: string; phone: string; socials: Social[]; niches: string[]; audienceLocation: string; avgViews: string | null;
  sampleLinks: string[]; bio: string; priorBrands: string; why: string; preferredCode: string | null; status: ApplicationStatus;
  reason: string | null; requestNote: string | null; reapplyAfter: string | null; submissions: number; reviewedAt: string | null;
  createdAt: string; updatedAt: string;
}
export interface ApplicationState {
  isInfluencer: boolean;
  me: { email: string; kycTier: number; verified: boolean; legalName: string | null; hasPhone: boolean; code: string | null };
  canSubmit: boolean;
  application: Application | null;
}
export interface ApplyInput {
  phone?: string;
  socials: { platform: string; handle: string; followers: string; url?: string }[];
  niches: string[]; audienceLocation: string; avgViews: string; sampleLinks: string[];
  bio: string; priorBrands: string; why: string; preferredCode?: string; agreeTerms: true;
}
export interface Totals { heldFormatted: string; paidFormatted: string; lifetimeFormatted: string; thisMonthFormatted: string }
export interface Dashboard {
  code: string; link: string; active: boolean; commissionPercent: number; windowDays: number | null; clicks: number;
  counts: { signedUp: number; qualified: number }; volumeFormatted: string; totals: Totals;
  series: { day: string; clicks: number; signups: number; earnedMinor: string }[];
}
export interface Earning {
  id: string; kind: "COMMISSION" | "BASIC_BONUS" | "WELCOME_BONUS" | "TASK"; amountFormatted: string; status: "HELD" | "PAID" | "VOID";
  note: string | null; releaseAt: string; paidAt: string | null; voidReason: string | null; createdAt: string;
}
export interface Task {
  id: string; title: string; description: string; kind: "AUTO" | "PROOF"; metricLabel: string | null; target: string | null;
  targetFormatted: string | null; rewardFormatted: string; endsAt: string | null; progress: string | null; progressFormatted: string | null;
  submission: { status: string; reason: string | null; proof_url: string | null } | null; rewarded: string | null; expired: boolean;
  /** Set when an advertiser bought this task with their campaign: their ad, link and how many paid posts are left. */
  brand: { businessName: string; headline: string; image: string; linkUrl: string | null; postsLeft: number } | null;
}

export const api = {
  application: () => apiFetch<ApplicationState>("/api/influencer/application"),
  apply: (input: ApplyInput) => apiFetch<ApplicationState>("/api/influencer/application", { method: "POST", body: JSON.stringify(input) }),
  codeAvailable: (code: string) =>
    apiFetch<{ code: string | null; available: boolean; reason?: string }>(`/api/influencer/code-available?code=${encodeURIComponent(code)}`),
  dashboard: () => apiFetch<Dashboard>("/api/influencer/dashboard"),
  earnings: () => apiFetch<{ earnings: Earning[] }>("/api/influencer/earnings"),
  tasks: () => apiFetch<{ tasks: Task[] }>("/api/influencer/tasks"),
  submitProof: (id: string, proofUrl: string, note: string) =>
    apiFetch<{ ok: true }>(`/api/influencer/tasks/${id}/submit`, { method: "POST", body: JSON.stringify({ proofUrl, note }) }),
};
