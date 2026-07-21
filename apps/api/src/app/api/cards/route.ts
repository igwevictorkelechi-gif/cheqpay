import { prisma } from "@cheqpay/db";
import { requireUser } from "@/lib/auth";
import { ApiError, jsonOk, toErrorResponse } from "@/lib/http";
import { assertFeatureEnabled } from "@/lib/features";
import { ensureCardsTable } from "@/lib/ensureCards";
import {
  ensureMapleradCustomer,
  isCardsConfigured,
  issueMapleradCard,
} from "@/lib/mapleradCards";

export const dynamic = "force-dynamic";

/** List the user's virtual cards. Always reports whether issuing is available. */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req);
    await ensureCardsTable();
    const cards = await prisma.card.findMany({
      where: { userId: auth.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        currency: true,
        brand: true,
        maskedPan: true,
        status: true,
        createdAt: true,
      },
    });
    return jsonOk({ cards, available: isCardsConfigured() });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Issue a new USD virtual card for the user (Maplerad). */
export async function POST(req: Request) {
  try {
    const auth = await requireUser(req);
    await assertFeatureEnabled("virtual_cards");
    await ensureCardsTable();

    const fullName = (auth.fullName ?? "").trim();
    if (!fullName) {
      throw new ApiError(
        403,
        "Complete your profile name before creating a card",
        "name_required"
      );
    }
    if (!auth.email) {
      throw new ApiError(403, "An email is required to create a card", "email_required");
    }

    const parts = fullName.split(/\s+/);
    const firstName = parts[0];
    const lastName = parts.slice(1).join(" ") || parts[0];

    const customerId = await ensureMapleradCustomer({ firstName, lastName, email: auth.email });
    const issued = await issueMapleradCard({ customerId, currency: "USD" });

    const card = await prisma.card.create({
      data: {
        userId: auth.id,
        provider: "maplerad",
        providerCardId: issued.id,
        currency: issued.currency,
        brand: issued.brand ?? null,
        maskedPan: issued.maskedPan ?? null,
        status: issued.status ?? "active",
      },
      select: {
        id: true,
        currency: true,
        brand: true,
        maskedPan: true,
        status: true,
        createdAt: true,
      },
    });
    return jsonOk({ card }, 201);
  } catch (err) {
    return toErrorResponse(err);
  }
}
