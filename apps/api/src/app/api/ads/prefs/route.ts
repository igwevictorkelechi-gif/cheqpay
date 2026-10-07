import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { AD_CATEGORIES, getAdPrefs, setAdPrefs } from "@/lib/ads";
import { jsonOk, toErrorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

/** "Personalised ads" and muted ad categories, from Settings → Privacy. */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    return jsonOk({
      prefs: await getAdPrefs(auth.id),
      categories: Object.entries(AD_CATEGORIES).map(([key, label]) => ({ key, label })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    const b = z.object({ personalised: z.boolean(), mutedCategories: z.array(z.string().max(30)).max(20).default([]) }).parse(await req.json());
    return jsonOk({ prefs: await setAdPrefs(auth.id, b) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
