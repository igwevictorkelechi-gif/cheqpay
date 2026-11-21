// tools/confidential-demo/src/chain.ts
//
// One small interface over "a Solana cluster", so the demo flow is written once
// and runs in two places:
//
//   local  — LiteSVM: Solana's real runtime and the real Token-2022 and proof
//            programs, in-process. No network, nothing of value, deterministic.
//   devnet — Solana's public test network, through its RPC. Transactions are
//            real and visible on the explorer, but devnet tokens are worthless.
//
// Mainnet is deliberately not an option here.

import {
  type Address,
  type Instruction,
  type InstructionPlan,
  type KeyPairSigner,
  type Lamports,
  type Signature,
  type TransactionMessage,
  type TransactionMessageWithFeePayer,
  appendTransactionMessageInstructions,
  createSolanaRpc,
  createTransactionMessage,
  createTransactionPlanExecutor,
  createTransactionPlanner,
  flattenTransactionPlanResult,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  lamports,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  singleInstructionPlan,
  sequentialInstructionPlan,
} from "@solana/kit";
import { FailedTransactionMetadata, LiteSVM } from "litesvm";

/** What the token library's helpers need to read from a cluster. */
export interface ChainRpc {
  getMinimumBalanceForRentExemption(size: bigint | number): { send(): Promise<Lamports> };
  getAccountInfo(address: Address, config?: unknown): { send(): Promise<unknown> };
}

export interface Chain {
  name: "local" | "devnet";
  rpc: ChainRpc;
  /** The shape `getCreateMintInstructionPlan` asks for. */
  client: { getMinimumBalance(space: number, config?: { withoutHeader?: boolean }): Promise<Lamports> };
  fund(address: Address, sol: number): Promise<void>;
  /** Plan, sign and send an instruction plan; one signature per transaction it took. */
  run(plan: InstructionPlan | Instruction[], payer: KeyPairSigner): Promise<Signature[]>;
  explorerUrl(signature: Signature): string | null;
}

const LAMPORTS_PER_SOL = 1_000_000_000n;

function asPlan(plan: InstructionPlan | Instruction[]): InstructionPlan {
  return Array.isArray(plan) ? sequentialInstructionPlan(plan.map((ix) => singleInstructionPlan(ix))) : plan;
}

async function execute(
  plan: InstructionPlan,
  payer: KeyPairSigner,
  latestBlockhash: () => Promise<{ blockhash: string; lastValidBlockHeight: bigint }>,
  send: (wire: Parameters<typeof getSignatureFromTransaction>[0]) => Promise<void>,
): Promise<Signature[]> {
  const planner = createTransactionPlanner({
    createTransactionMessage: () =>
      pipe(createTransactionMessage({ version: 0 }), (m) => setTransactionMessageFeePayerSigner(payer, m)),
  });
  const executor = createTransactionPlanExecutor({
    executeTransactionMessage: async (_ctx, message: TransactionMessage & TransactionMessageWithFeePayer) => {
      const lifetime = await latestBlockhash();
      const withLifetime = setTransactionMessageLifetimeUsingBlockhash(
        lifetime as Parameters<typeof setTransactionMessageLifetimeUsingBlockhash>[0],
        message,
      );
      const signed = await signTransactionMessageWithSigners(withLifetime);
      await send(signed);
      return { signature: getSignatureFromTransaction(signed) };
    },
  });
  const transactionPlan = await planner(plan);
  const result = await executor(transactionPlan);
  return flattenTransactionPlanResult(result).map((r) => (r.context as { signature: Signature }).signature);
}

export function localChain(): Chain {
  const svm = new LiteSVM();
  const rent = (space: bigint | number) => lamports(svm.minimumBalanceForRentExemption(BigInt(space)));
  const rpc: ChainRpc = {
    getMinimumBalanceForRentExemption: (size) => ({ send: async () => rent(size) }),
    getAccountInfo: (address) => ({
      send: async () => {
        const account = svm.getAccount(address);
        if (!account.exists) return { context: { slot: 0n }, value: null };
        return {
          context: { slot: 0n },
          value: {
            data: [Buffer.from(account.data).toString("base64"), "base64"],
            executable: account.executable,
            lamports: account.lamports,
            owner: account.programAddress,
            space: BigInt(account.data.length),
            rentEpoch: 0n,
          },
        };
      },
    }),
  };
  return {
    name: "local",
    rpc,
    client: { getMinimumBalance: async (space) => rent(space) },
    fund: async (address, sol) => {
      const res = svm.airdrop(address, lamports(BigInt(sol) * LAMPORTS_PER_SOL));
      if (!res || res instanceof FailedTransactionMetadata) throw new Error(`airdrop to ${address} failed`);
    },
    run: (plan, payer) =>
      execute(
        asPlan(plan),
        payer,
        async () => ({ blockhash: svm.latestBlockhash(), lastValidBlockHeight: 1_000_000n }),
        async (tx) => {
          const res = svm.sendTransaction(tx as Parameters<typeof svm.sendTransaction>[0]);
          if (res instanceof FailedTransactionMetadata) {
            const logs = res.meta().logs().slice(-12).join("\n    ");
            throw new Error(`transaction failed: ${res.err()}\n    ${logs}`);
          }
          // Deliberately no blockhash expiry here: the transfer plan sends
          // several transactions in parallel, signed against the same
          // blockhash, and expiring it after the first one invalidates the
          // rest (Solana error 7, BlockhashNotFound).
        },
      ),
    explorerUrl: () => null,
  };
}

export function devnetChain(url = "https://api.devnet.solana.com"): Chain {
  const rpc = createSolanaRpc(url);
  return {
    name: "devnet",
    rpc: rpc as unknown as ChainRpc,
    client: {
      getMinimumBalance: async (space, config) =>
        rpc.getMinimumBalanceForRentExemption(BigInt(config?.withoutHeader ? space : space)).send(),
    },
    fund: async (address, sol) => {
      // The public faucet is rate-limited; topping up at faucet.solana.com by
      // hand is the fallback.
      await rpc.requestAirdrop(address, lamports(BigInt(sol) * LAMPORTS_PER_SOL)).send();
      for (let i = 0; i < 30; i++) {
        const { value } = await rpc.getBalance(address, { commitment: "confirmed" }).send();
        if (value > 0n) return;
        await new Promise((r) => setTimeout(r, 1000));
      }
      throw new Error(`devnet airdrop to ${address} did not arrive; top it up at https://faucet.solana.com`);
    },
    run: (plan, payer) =>
      execute(
        asPlan(plan),
        payer,
        async () => (await rpc.getLatestBlockhash({ commitment: "confirmed" }).send()).value,
        async (tx) => {
          const signature = getSignatureFromTransaction(tx);
          await rpc
            .sendTransaction(getBase64EncodedWireTransaction(tx), { encoding: "base64", preflightCommitment: "confirmed" })
            .send();
          for (let i = 0; i < 60; i++) {
            const { value } = await rpc.getSignatureStatuses([signature]).send();
            const status = value[0];
            if (status?.err) throw new Error(`transaction ${signature} failed: ${JSON.stringify(status.err)}`);
            if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return;
            await new Promise((r) => setTimeout(r, 1000));
          }
          throw new Error(`transaction ${signature} was not confirmed in time`);
        },
      ),
    explorerUrl: (signature) => `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
  };
}

// Re-exported so the flow can build plain instruction lists without importing kit twice.
export { appendTransactionMessageInstructions };
