// tools/confidential-demo/src/spike.ts
//
// The demo flow, steps 1–6, against a real Solana runtime.
//
//   npm run spike            # local: LiteSVM, no network
//   npm run spike -- devnet  # Solana devnet (needs api.devnet.solana.com reachable)
//
// Cast: CheqPay Treasury issues "CheqPay Demo Naira" (dNGN, a test token);
// Partner Alpha and Partner Beta stand in for two banks; CheqPay Compliance
// holds the auditor key and can read every confidential amount.

import { type Address, type KeyPairSigner, type Signature, generateKeyPairSigner, some } from "@solana/kit";
import {
  TOKEN_2022_PROGRAM_ADDRESS,
  fetchToken,
  findAssociatedTokenPda,
  getConfidentialDepositInstruction,
  getConfidentialTransferInstructionDataDecoder,
  getCreateMintInstructionPlan,
  getMintToCheckedInstruction,
} from "@solana-program/token-2022";
import {
  deriveConfidentialKeys,
  getApplyConfidentialPendingBalanceInstructionFromToken,
  getConfidentialTransferInstructionPlan,
  getConfidentialWithdrawInstructionPlan,
  getCreateConfidentialTransferAccountInstructionPlan,
  fetchConfidentialTransferBalance,
} from "@solana-program/token-2022/confidential";
import { AeKey, ElGamalCiphertext, ElGamalKeypair, ElGamalSecretKey } from "@solana/zk-sdk/node";
import { type Chain, devnetChain, localChain } from "./chain";

const DECIMALS = 2;
const naira = (whole: number) => BigInt(whole) * 100n;
const fmt = (kobo: bigint) => `₦${(Number(kobo) / 100).toLocaleString("en-NG", { minimumFractionDigits: 0 })}`;

type Party = {
  name: string;
  wallet: KeyPairSigner;
  elgamal: ElGamalKeypair;
  elgamalPubkey: Address;
  ae: AeKey;
  token?: Address;
};

async function party(name: string): Promise<Party> {
  const wallet = await generateKeyPairSigner();
  const keys = await deriveConfidentialKeys({ signer: wallet });
  return {
    name,
    wallet,
    elgamal: ElGamalKeypair.fromSecretKey(ElGamalSecretKey.fromBytes(keys.elgamalKeypair.secretKey)),
    elgamalPubkey: keys.elgamalKeypair.elgamalPubkey,
    ae: AeKey.fromBytes(keys.aeKey),
  };
}

const log: { step: string; signatures: Signature[] }[] = [];

async function step(chain: Chain, label: string, work: () => Promise<Signature[]>) {
  const t = performance.now();
  const signatures = await work();
  log.push({ step: label, signatures });
  const n = signatures.length;
  console.log(`✓ ${label} — ${n} transaction${n === 1 ? "" : "s"}, ${((performance.now() - t) / 1000).toFixed(1)} s`);
  for (const s of signatures) {
    const url = chain.explorerUrl(s);
    if (url) console.log(`    ${url}`);
  }
}

async function main() {
  const chain = process.argv[2] === "devnet" ? devnetChain() : localChain();
  console.log(`Running on ${chain.name === "local" ? "LiteSVM (local Solana runtime, no network)" : "Solana devnet"}\n`);

  const treasury = await party("CheqPay Treasury");
  const alpha = await party("Partner Alpha");
  const beta = await party("Partner Beta");
  const compliance = await party("CheqPay Compliance");
  await chain.fund(treasury.wallet.address, 5);
  await chain.fund(alpha.wallet.address, 2);
  await chain.fund(beta.wallet.address, 2);

  // 1. The token: confidential transfers on, Compliance as auditor.
  const mint = await generateKeyPairSigner();
  await step(chain, "1. Create dNGN with confidential transfers and a Compliance auditor", async () =>
    chain.run(
      await getCreateMintInstructionPlan(chain.client as never, {
        payer: treasury.wallet,
        newMint: mint,
        decimals: DECIMALS,
        mintAuthority: treasury.wallet,
        extensions: [
          {
            __kind: "ConfidentialTransferMint",
            authority: some(treasury.wallet.address),
            autoApproveNewAccounts: true,
            auditorElgamalPubkey: some(compliance.elgamalPubkey),
          },
        ],
      }),
      treasury.wallet,
    ),
  );

  // 2. Alpha's and Beta's accounts, opted into confidential transfers.
  for (const p of [alpha, beta]) {
    const [ata] = await findAssociatedTokenPda({
      owner: p.wallet.address,
      mint: mint.address,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    });
    p.token = ata;
    await step(chain, `2. Open ${p.name}'s confidential account`, async () =>
      chain.run(
        await getCreateConfidentialTransferAccountInstructionPlan({
          payer: p.wallet,
          owner: p.wallet,
          mint: mint.address,
          token: ata,
          rpc: chain.rpc as never,
          elgamalKeypair: p.elgamal,
          aesKey: p.ae,
        }),
        p.wallet,
      ),
    );
  }

  // 3. Treasury issues ₦5,000,000 to Alpha, publicly.
  await step(chain, "3. Treasury sends Alpha ₦5,000,000 (public)", () =>
    chain.run(
      [
        getMintToCheckedInstruction({
          mint: mint.address,
          token: alpha.token!,
          mintAuthority: treasury.wallet,
          amount: naira(5_000_000),
          decimals: DECIMALS,
        }),
      ],
      treasury.wallet,
    ),
  );

  // 4. Alpha makes ₦2,000,000 confidential: deposit, then apply it.
  await step(chain, "4. Alpha makes ₦2,000,000 confidential", async () => {
    const deposit = await chain.run(
      [
        getConfidentialDepositInstruction({
          token: alpha.token!,
          mint: mint.address,
          authority: alpha.wallet,
          amount: naira(2_000_000),
          decimals: DECIMALS,
        }),
      ],
      alpha.wallet,
    );
    return [...deposit, ...(await applyPending(chain, alpha))];
  });

  // 5. The confidential transfer: ₦1,250,000 to Beta. Proofs are built here,
  // client-side, and are too big for one transaction.
  const transferAmount = naira(1_250_000);
  let auditorView = 0n;
  await step(chain, "5. Alpha sends Beta ₦1,250,000 confidentially", async () => {
    const plan = await getConfidentialTransferInstructionPlan({
      sourceToken: alpha.token!,
      mint: mint.address,
      destinationToken: beta.token!,
      sourceTokenAccount: (await fetchToken(chain.rpc as never, alpha.token!)).data,
      destinationTokenAccount: (await fetchToken(chain.rpc as never, beta.token!)).data,
      authority: alpha.wallet,
      amount: transferAmount,
      sourceElgamalKeypair: alpha.elgamal,
      aesKey: alpha.ae,
      payer: alpha.wallet,
      rpc: chain.rpc as never,
    });
    auditorView = readAuditorAmount(plan, compliance.elgamal.secret());
    return chain.run(plan, alpha.wallet);
  });

  // 6. Beta accepts it, then makes ₦1,000,000 public.
  await step(chain, "6a. Beta accepts the incoming transfer", () => applyPending(chain, beta));
  await step(chain, "6b. Beta makes ₦1,000,000 public", async () =>
    chain.run(
      await getConfidentialWithdrawInstructionPlan({
        token: beta.token!,
        mint: mint.address,
        tokenAccount: (await fetchToken(chain.rpc as never, beta.token!)).data,
        authority: beta.wallet,
        amount: naira(1_000_000),
        decimals: DECIMALS,
        elgamalKeypair: beta.elgamal,
        aesKey: beta.ae,
        payer: beta.wallet,
        rpc: chain.rpc as never,
      }),
      beta.wallet,
    ),
  );

  // The four views.
  console.log("\nBalances at the end:");
  for (const p of [alpha, beta]) {
    const account = (await fetchToken(chain.rpc as never, p.token!)).data;
    const secret = await fetchConfidentialTransferBalance({
      token: p.token!,
      rpc: chain.rpc as never,
      elgamalSecretKey: p.elgamal.secret(),
      aesKey: p.ae,
    });
    console.log(`  ${p.name.padEnd(14)} public ${fmt(account.amount).padStart(12)}   confidential ${fmt(secret.availableBalance).padStart(12)} (only they can read this)`);
  }
  console.log(`\nWhat CheqPay Compliance reads from the transfer: ${fmt(auditorView)}`);
  console.log(`What anyone else sees: a transfer between two dNGN accounts, amount encrypted.`);

  const expected = { alphaPublic: naira(3_000_000), alphaSecret: naira(750_000), betaPublic: naira(1_000_000), betaSecret: naira(250_000) };
  const a = (await fetchToken(chain.rpc as never, alpha.token!)).data.amount;
  const b = (await fetchToken(chain.rpc as never, beta.token!)).data.amount;
  const aS = (await fetchConfidentialTransferBalance({ token: alpha.token!, rpc: chain.rpc as never, elgamalSecretKey: alpha.elgamal.secret(), aesKey: alpha.ae })).availableBalance;
  const bS = (await fetchConfidentialTransferBalance({ token: beta.token!, rpc: chain.rpc as never, elgamalSecretKey: beta.elgamal.secret(), aesKey: beta.ae })).availableBalance;
  const ok =
    a === expected.alphaPublic && aS === expected.alphaSecret && b === expected.betaPublic && bS === expected.betaSecret && auditorView === transferAmount;
  const txCount = log.reduce((n, s) => n + s.signatures.length, 0);
  console.log(`\n${ok ? "GO" : "MISMATCH"}: ${txCount} transactions, every balance ${ok ? "matches the plan" : "does NOT match — see above"}.`);
  if (!ok) process.exit(1);
}

async function applyPending(chain: Chain, p: Party): Promise<Signature[]> {
  const tokenAccount = (await fetchToken(chain.rpc as never, p.token!)).data;
  return chain.run(
    [
      getApplyConfidentialPendingBalanceInstructionFromToken({
        token: p.token!,
        tokenAccount,
        authority: p.wallet,
        elgamalSecretKey: p.elgamal.secret(),
        aesKey: p.ae,
      }),
    ],
    p.wallet,
  );
}

/**
 * The auditor's view: the transfer instruction carries the amount encrypted to
 * the auditor key, in a low and a high half. Compliance decrypts both from the
 * instruction itself — it needs nothing from Alpha or Beta.
 */
function readAuditorAmount(plan: unknown, auditorSecret: ElGamalSecretKey): bigint {
  const decoder = getConfidentialTransferInstructionDataDecoder();
  const found: bigint[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const n = node as { kind?: string; instruction?: { data?: Uint8Array; programAddress?: string }; plans?: unknown[] };
    if (n.instruction?.programAddress === TOKEN_2022_PROGRAM_ADDRESS && n.instruction.data) {
      try {
        const data = decoder.decode(n.instruction.data);
        const lo = auditorSecret.decrypt(ElGamalCiphertext.fromBytes(new Uint8Array(data.transferAmountAuditorCiphertextLo as unknown as ArrayLike<number>))!);
        const hi = auditorSecret.decrypt(ElGamalCiphertext.fromBytes(new Uint8Array(data.transferAmountAuditorCiphertextHi as unknown as ArrayLike<number>))!);
        found.push(lo + (hi << 16n));
      } catch {
        /* not the transfer instruction */
      }
    }
    for (const child of n.plans ?? []) walk(child);
  };
  walk(plan);
  if (found.length !== 1) throw new Error(`expected one confidential transfer instruction, found ${found.length}`);
  return found[0];
}

main().catch((err) => {
  console.error("\nFAILED:", err instanceof Error ? err.message : err);
  if (err instanceof Error && err.cause) console.error("cause:", err.cause);
  process.exit(1);
});
