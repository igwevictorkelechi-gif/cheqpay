// "Continue with CheqPay" handoff codes against a real Postgres. The Supabase
// admin call is replaced; everything else is real.
//
//   DEVAPI_DB_TESTS=1 DATABASE_URL=postgresql://… npx vitest run src/lib/sso.int.test.ts

import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { UserStatus, prisma } from "@cheqpay/db";
import { createHandoff, redeemHandoff, s256, SSO_CLIENTS } from "./sso";

const RUN = process.env.DEVAPI_DB_TESTS === "1";
const verifier = () => randomBytes(48).toString("base64url");

describe.skipIf(!RUN)("sign in with CheqPay: handoff codes", () => {
  let userId = "";
  let email = "";
  const mint = vi.fn(async (e: string) => `hash-for-${e}`);

  beforeAll(async () => {
    email = `sso-${randomBytes(4).toString("hex")}@x.test`;
    userId = (await prisma.user.create({ data: { email } })).id;
  });

  async function start(v = verifier()) {
    const h = await createHandoff({ userId, email, client: "creators", challenge: s256(v) });
    return { v, ...h };
  }

  it("hands back a one-time token for the right user, to the fixed callback only", async () => {
    const { v, code, returnUrl } = await start();
    expect(returnUrl).toBe(SSO_CLIENTS.creators.returnUrl);
    const out = await redeemHandoff({ client: "creators", code, verifier: v, mint });
    expect(out).toEqual({ userId, tokenHash: `hash-for-${email}` });
    const stored = await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM sso_handoffs WHERE code_hash = $1`, code);
    expect(stored[0].n).toBe(0); // only the hash is kept
  });

  it("is single use", async () => {
    const { v, code } = await start();
    await redeemHandoff({ client: "creators", code, verifier: v, mint });
    await expect(redeemHandoff({ client: "creators", code, verifier: v, mint })).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it("needs the verifier from the tab that started it, and burns the code on a wrong one", async () => {
    const { v, code } = await start();
    await expect(redeemHandoff({ client: "creators", code, verifier: verifier(), mint })).rejects.toMatchObject({ code: "invalid_grant" });
    await expect(redeemHandoff({ client: "creators", code, verifier: v, mint })).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it("expires", async () => {
    const { v, code } = await start();
    await prisma.$executeRawUnsafe(`UPDATE sso_handoffs SET expires_at = now() - interval '1 second' WHERE code_hash = $1`, s256(code));
    await expect(redeemHandoff({ client: "creators", code, verifier: v, mint })).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it("only knows the sites it was built for, and refuses broken challenges", async () => {
    await expect(createHandoff({ userId, email, client: "evil", challenge: s256(verifier()) })).rejects.toMatchObject({ code: "invalid_client" });
    await expect(createHandoff({ userId, email, client: "creators", challenge: "short" })).rejects.toMatchObject({ code: "invalid_request" });
    const { v, code } = await start();
    await expect(redeemHandoff({ client: "admin", code, verifier: v, mint })).rejects.toMatchObject({ code: "invalid_client" });
  });

  it("refuses a blocked account even with a valid code", async () => {
    const { v, code } = await start();
    await prisma.user.update({ where: { id: userId }, data: { status: UserStatus.BLOCKED } });
    await expect(redeemHandoff({ client: "creators", code, verifier: v, mint })).rejects.toMatchObject({ code: "account_blocked" });
    await prisma.user.update({ where: { id: userId }, data: { status: UserStatus.ACTIVE } });
  });

  it("lets only one of many simultaneous redemptions through", async () => {
    const { v, code } = await start();
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => redeemHandoff({ client: "creators", code, verifier: v, mint })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});
