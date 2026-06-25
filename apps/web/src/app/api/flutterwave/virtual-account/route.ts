import { NextResponse } from "next/server";

/**
 * Creates (or returns) a STATIC Flutterwave virtual account number for the
 * user so they can fund their wallet via bank transfer.
 *
 * Uses the Flutterwave "virtual-account-numbers" API with is_permanent=true
 * when FLUTTERWAVE_SECRET_KEY is configured. When it is not (e.g. preview
 * deploys), it falls back to a deterministic mock account so the deposit
 * flow remains fully demonstrable.
 */

export const runtime = "nodejs";

const DEPOSIT_FEE = 150; // flat NGN fee, matches the deposit UI

function deterministicAccount(seed: string): string {
  // Stable 10-digit "account number" derived from the seed (email/id).
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const base = (h % 1_000_000_000).toString().padStart(9, "0");
  return `7${base}`;
}

export async function POST(request: Request) {
  let body: { email?: string; name?: string; amount?: number } = {};
  try {
    body = await request.json();
  } catch {
    // ignore — fall back to defaults below
  }

  const email = body.email || "customer@cheqpay.app";
  const name = (body.name || "Cheqpay User").trim();
  const [firstname, ...rest] = name.split(" ");
  const lastname = rest.join(" ") || firstname;

  const secret = process.env.FLUTTERWAVE_SECRET_KEY;

  // No credentials configured → deterministic mock account.
  if (!secret) {
    return NextResponse.json({
      account_number: deterministicAccount(email),
      bank_name: "Wema Bank",
      account_name: name.toUpperCase(),
      fee: DEPOSIT_FEE,
      mock: true,
    });
  }

  try {
    const res = await fetch(
      "https://api.flutterwave.com/v3/virtual-account-numbers",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          is_permanent: true,
          tx_ref: `cheqpay-${Date.now()}`,
          firstname,
          lastname,
          narration: name,
        }),
      }
    );
    const data = await res.json();

    if (data?.status === "success" && data?.data?.account_number) {
      return NextResponse.json({
        account_number: data.data.account_number,
        bank_name: data.data.bank_name || "Wema Bank",
        account_name: name.toUpperCase(),
        fee: DEPOSIT_FEE,
        reference: data.data.flw_ref || data.data.order_ref,
      });
    }

    // Flutterwave responded but without an account — fall back gracefully.
    return NextResponse.json({
      account_number: deterministicAccount(email),
      bank_name: "Wema Bank",
      account_name: name.toUpperCase(),
      fee: DEPOSIT_FEE,
      mock: true,
    });
  } catch (error) {
    console.error("Flutterwave virtual account error:", error);
    return NextResponse.json({
      account_number: deterministicAccount(email),
      bank_name: "Wema Bank",
      account_name: name.toUpperCase(),
      fee: DEPOSIT_FEE,
      mock: true,
    });
  }
}
