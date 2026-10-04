import { supabase } from "./supabase";

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "https://cheqpay-admin453.vercel.app";
export const APP_URL = "https://mycheqpay.com";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
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
    throw new ApiError(res.status, body?.error || res.statusText, body?.code);
  }
  return body as T;
}

export interface Social { platform: string; handle: string; followers: number }
export interface Application {
  id: string; fullName: string; phone: string; socials: Social[]; niche: string; location: string; why: string;
  preferredCode: string | null; status: "PENDING" | "APPROVED" | "REJECTED"; reason: string | null; createdAt: string;
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
}

export const api = {
  application: () => apiFetch<{ isInfluencer: boolean; application: Application | null }>("/api/influencer/application"),
  apply: (input: { fullName: string; phone: string; socials: Social[]; niche: string; location: string; why: string; preferredCode?: string }) =>
    apiFetch<{ isInfluencer: boolean; application: Application | null }>("/api/influencer/application", { method: "POST", body: JSON.stringify(input) }),
  dashboard: () => apiFetch<Dashboard>("/api/influencer/dashboard"),
  earnings: () => apiFetch<{ earnings: Earning[] }>("/api/influencer/earnings"),
  tasks: () => apiFetch<{ tasks: Task[] }>("/api/influencer/tasks"),
  submitProof: (id: string, proofUrl: string, note: string) =>
    apiFetch<{ ok: true }>(`/api/influencer/tasks/${id}/submit`, { method: "POST", body: JSON.stringify({ proofUrl, note }) }),
};
