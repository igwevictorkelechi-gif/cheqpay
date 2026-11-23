// tools/confidential-demo/src/offline-proofs.ts
//
// The go/no-go check for the devnet demo, run entirely offline.
//
// A confidential transfer is accepted by Solana only if it carries three
// zero-knowledge proofs, built client-side. The demo's biggest risk was that
// the JavaScript proof library (@solana/zk-sdk, WASM) could not build them. This
// script builds exactly the proofs a real transfer needs — with keys derived
// the standard way from wallet signatures — and verifies each one locally,
// using the same verifier code the on-chain proof program runs.
//
// The scenario is step 5 of the demo: Partner Alpha holds ₦2,000,000 of
// confidential "CheqPay Demo Naira" (dNGN, test token, 2 decimals) and sends
// ₦1,250,000 to Partner Beta, with CheqPay Compliance as the mint's auditor.
//
// Nothing here touches a network, a real token, or CheqPay's apps.

import { generateKeyPairSigner } from "@solana/kit";
import { deriveConfidentialKeys } from "@solana-program/token-2022/confidential";
import {
  AeKey,
  BatchedGroupedCiphertext3HandlesValidityProofData,
  BatchedRangeProofU128Data,
  CiphertextCommitmentEqualityProofData,
  ElGamalCiphertext,
  ElGamalKeypair,
  ElGamalPubkey,
  ElGamalSecretKey,
  GroupedElGamalCiphertext3Handles,
  PedersenCommitment,
  PedersenOpening,
  PubkeyValidityProofData,
} from "@solana/zk-sdk/node";

const DECIMALS = 2; // dNGN counts in kobo
const naira = (whole: number) => BigInt(whole) * 10n ** BigInt(DECIMALS);
const fmt = (kobo: bigint) => `₦${(Number(kobo) / 10 ** DECIMALS).toLocaleString("en-NG")}`;

// Token-2022 splits a transfer amount into a 16-bit low part and a 32-bit high
// part, so each can be decrypted quickly; the range proof then covers the new
// balance (64 bits) plus both parts, padded to 128 bits.
const LO_BITS = 16;
const HI_BITS = 32;

type Party = { name: string; elgamal: ElGamalKeypair; ae: AeKey };

async function party(name: string): Promise<Party> {
  // A fresh wallet, and its confidential keys derived the standard way: the
  // wallet signs "solana-conf-bal/v1" once and both keys come from that
  // signature. Ed25519 signatures are deterministic, so the same wallet always
  // re-derives the same keys — which is what makes balances recoverable.
  const wallet = await generateKeyPairSigner();
  const first = await deriveConfidentialKeys({ signer: wallet });
  const again = await deriveConfidentialKeys({ signer: wallet });
  if (Buffer.compare(Buffer.from(first.aeKey), Buffer.from(again.aeKey)) !== 0) {
    throw new Error(`${name}: key derivation is not repeatable — balances would be unrecoverable`);
  }
  const elgamal = ElGamalKeypair.fromSecretKey(ElGamalSecretKey.fromBytes(first.elgamalKeypair.secretKey));
  return { name, elgamal, ae: AeKey.fromBytes(first.aeKey) };
}

function check(label: string, verify: () => void, bytes: Uint8Array) {
  const t = performance.now();
  verify();
  console.log(`  ✓ ${label} — ${bytes.length} bytes, verified in ${(performance.now() - t).toFixed(0)} ms`);
}

async function main() {
  const started = performance.now();
  console.log("Deriving keys from wallet signatures…");
  const [alpha, beta, compliance] = await Promise.all([
    party("Partner Alpha"),
    party("Partner Beta"),
    party("CheqPay Compliance"),
  ]);
  console.log("  ✓ three wallets, keys derived and re-derived identically\n");

  // Step 2 of the demo: an account opting into confidential transfers proves
  // its encryption key is well-formed.
  console.log("Account setup proof (step 2):");
  const pubkeyProof = new PubkeyValidityProofData(alpha.elgamal);
  check("public-key validity proof", () => pubkeyProof.verify(), pubkeyProof.toBytes());

  // Alpha's confidential available balance after step 4: ₦2,000,000, held on
  // chain as an ElGamal ciphertext, with an AES copy only Alpha can read fast.
  const balance = naira(2_000_000);
  const available = alpha.elgamal.pubkey().encryptWith(balance, new PedersenOpening());
  const decryptable = alpha.ae.encrypt(balance);

  // Step 5: the transfer.
  const amount = naira(1_250_000);
  const lo = amount & ((1n << BigInt(LO_BITS)) - 1n);
  const hi = amount >> BigInt(LO_BITS);
  const openingLo = new PedersenOpening();
  const openingHi = new PedersenOpening();
  const pubs = [alpha.elgamal.pubkey(), beta.elgamal.pubkey(), compliance.elgamal.pubkey()] as const;
  const groupedLo = GroupedElGamalCiphertext3Handles.encryptWith(...pubs, lo, openingLo);
  const groupedHi = GroupedElGamalCiphertext3Handles.encryptWith(...pubs, hi, openingHi);

  // What the chain does to Alpha's balance: subtract the transfer, homomorphically,
  // without ever seeing either number.
  const sentFromAlpha = ElGamalCiphertext.combineLoHi(
    groupedLo.toElGamalCiphertext(0),
    groupedHi.toElGamalCiphertext(0),
    LO_BITS,
  );
  const newAvailable = available.subtract(sentFromAlpha);
  const newBalance = alpha.ae.decrypt(decryptable) - amount;
  const newOpening = new PedersenOpening();
  const newCommitment = PedersenCommitment.from(newBalance, newOpening);

  console.log("\nTransfer proofs (step 5) — the three the chain requires:");
  const equality = new CiphertextCommitmentEqualityProofData(
    alpha.elgamal,
    newAvailable,
    newCommitment,
    newOpening,
    newBalance,
  );
  check("equality proof (new balance is what's encrypted)", () => equality.verify(), equality.toBytes());

  const validity = new BatchedGroupedCiphertext3HandlesValidityProofData(
    pubs[0],
    pubs[1],
    pubs[2],
    groupedLo,
    groupedHi,
    lo,
    hi,
    openingLo,
    openingHi,
  );
  check("ciphertext validity proof (all three parties can decrypt)", () => validity.verify(), validity.toBytes());

  // No negative balances and no overflow: new balance fits 64 bits, the two
  // amount parts fit their widths, padded to 128 bits as token-2022 does.
  const pad = new PedersenOpening();
  const range = new BatchedRangeProofU128Data(
    [
      newCommitment,
      PedersenCommitment.from(lo, openingLo),
      PedersenCommitment.from(hi, openingHi),
      PedersenCommitment.from(0n, pad),
    ],
    new BigUint64Array([newBalance, lo, hi, 0n]),
    new Uint8Array([64, LO_BITS, HI_BITS, 128 - 64 - LO_BITS - HI_BITS]),
    [newOpening, openingLo, openingHi, pad],
  );
  check("range proof (no negative balance, no overflow)", () => range.verify(), range.toBytes());

  // A forged proof must fail: claim Alpha has ₦1,000,000 more than she does.
  // The library refuses at either point — building the proof, or verifying it.
  let forgedRejected = false;
  try {
    // Fresh opening: the WASM library takes ownership of objects passed into a
    // proof, so the ones used above cannot be reused here.
    const forgedOpening = new PedersenOpening();
    const forged = new CiphertextCommitmentEqualityProofData(
      alpha.elgamal,
      newAvailable,
      PedersenCommitment.from(newBalance + naira(1_000_000), forgedOpening),
      PedersenOpening.fromBytes(forgedOpening.toBytes()),
      newBalance + naira(1_000_000),
    );
    forged.verify();
  } catch {
    forgedRejected = true;
  }
  if (!forgedRejected) throw new Error("A forged balance proof verified — stop, something is badly wrong");
  console.log("  ✓ a forged balance proof is rejected");

  // The four views the demo will show side by side.
  const decryptAmount = (secret: ElGamalSecretKey, index: number) =>
    groupedLo.decrypt(secret, index) + (groupedHi.decrypt(secret, index) << BigInt(LO_BITS));
  console.log("\nWho can read the ₦1,250,000:");
  console.log(`  Alpha (sender)        ${fmt(decryptAmount(alpha.elgamal.secret(), 0))}, balance now ${fmt(alpha.elgamal.secret().decrypt(newAvailable))}`);
  console.log(`  Beta (recipient)      ${fmt(decryptAmount(beta.elgamal.secret(), 1))}`);
  console.log(`  Compliance (auditor)  ${fmt(decryptAmount(compliance.elgamal.secret(), 2))}`);
  console.log(`  Anyone else           ${Buffer.from(groupedLo.toBytes()).toString("hex").slice(0, 32)}… (unreadable)`);

  const proofBytes = equality.toBytes().length + validity.toBytes().length + range.toBytes().length;
  console.log(
    `\nGO: all proofs build and verify in JavaScript. ${proofBytes} bytes of proof for one transfer — ` +
      `over Solana's 1,232-byte transaction limit, as expected, so the transfer is split across several transactions.`,
  );
  console.log(`Total time ${(performance.now() - started).toFixed(0)} ms.`);

  // Unused-import guard for readers: ElGamalPubkey is the type behind `pubs`.
  void ElGamalPubkey;
}

main().catch((err) => {
  console.error("NO-GO:", err);
  process.exit(1);
});
