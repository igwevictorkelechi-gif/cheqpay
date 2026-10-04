import { z } from "zod";
import { recordAdminAction, requireAdminActor, requireAdminOtp } from "@/lib/adminGuard";
import { jsonOk, toErrorResponse } from "@/lib/http";
import { getReferralSettings, setReferralSettings } from "@/lib/referrals";

export const dynamic = "force-dynamic";

const naira = z.number().min(0).max(10_000_000);
const schema = z.object({
  basicBonus: naira,
  welcomeEnabled: z.boolean(),
  welcomeBonus: naira,
  qualifyMin: naira,
  defaultCommissionPercent: z.number().min(0).max(100),
  defaultWindowDays: z.number().int().min(1).max(3650).nullable(),
  holdHours: z.number().int().min(0).max(24 * 60),
  monthlyCap: naira,
});

function view(s: Awaited<ReturnType<typeof getReferralSettings>>) {
  return {
    basicBonus: s.basicBonusMinor / 100,
    welcomeEnabled: s.welcomeEnabled,
    welcomeBonus: s.welcomeBonusMinor / 100,
    qualifyMin: s.qualifyMinMinor / 100,
    defaultCommissionPercent: s.defaultCommissionBps / 100,
    defaultWindowDays: s.defaultWindowDays,
    holdHours: s.holdHours,
    monthlyCap: s.monthlyCapMinor / 100,
  };
}

export async function GET(req: Request) {
  try {
    await requireAdminActor(req, { superOnly: true });
    return jsonOk({ settings: view(await getReferralSettings()) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Amounts in ₦. Changes what every referral pays, so it needs a fresh code. */
export async function POST(req: Request) {
  try {
    const actor = await requireAdminActor(req, { superOnly: true });
    await requireAdminOtp(req);
    const b = schema.parse(await req.json());
    const k = (n: number) => Math.round(n * 100);
    const saved = await setReferralSettings(
      {
        basicBonusMinor: k(b.basicBonus),
        welcomeEnabled: b.welcomeEnabled,
        welcomeBonusMinor: k(b.welcomeBonus),
        qualifyMinMinor: k(b.qualifyMin),
        defaultCommissionBps: Math.round(b.defaultCommissionPercent * 100),
        defaultWindowDays: b.defaultWindowDays,
        holdHours: b.holdHours,
        monthlyCapMinor: k(b.monthlyCap),
      },
      actor.email,
    );
    await recordAdminAction(req, actor, { action: "admin.referral.settings", summary: "Referral settings updated", resourceType: "ReferralSettings", details: b });
    return jsonOk({ settings: view(saved) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
