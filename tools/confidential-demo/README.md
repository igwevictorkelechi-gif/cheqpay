# Confidential transfers demo (Solana devnet)

A standalone, test-network-only reproduction of a confidential stablecoin
transfer, CheqPay-branded, with a regulator's view. It is deliberately outside
`apps/`: nothing here touches CheqPay's API, database or customer money, and
there is no mainnet option.

## The cast

- **CheqPay Treasury** issues *CheqPay Demo Naira* (dNGN), a test token with
  2 decimals and confidential transfers switched on.
- **Partner Alpha** and **Partner Beta** stand in for two banks.
- **CheqPay Compliance** holds the mint's auditor key, so it can read every
  confidential amount without anyone's cooperation.

## Run it

```bash
npm install
npm run proofs        # offline: builds and verifies a transfer's three proofs
npm run spike         # the full flow in LiteSVM (real Solana runtime, no network)
npm run spike devnet  # the same flow on Solana devnet
```

`npm run spike` runs steps 1–6 of the plan and checks every balance at the end:

| Step | Transactions |
|---|---|
| 1. Create dNGN with a Compliance auditor | 1 |
| 2. Open Alpha's and Beta's confidential accounts | 2 |
| 3. Treasury sends Alpha ₦5,000,000, publicly | 1 |
| 4. Alpha makes ₦2,000,000 confidential (deposit + apply) | 2 |
| 5. Alpha sends Beta ₦1,250,000 confidentially | 5 |
| 6. Beta accepts it, then makes ₦1,000,000 public | 5 |

End state: Alpha ₦3,000,000 public / ₦750,000 confidential; Beta ₦1,000,000
public / ₦250,000 confidential; Compliance reads ₦1,250,000 from the transfer.

## Why five transactions for one transfer

Solana caps a transaction at 1,232 bytes. A confidential transfer carries about
1.9 KB of zero-knowledge proof (equality, ciphertext validity, range), so the
proofs are verified into short-lived context accounts first and the transfer
then points at them. `getConfidentialTransferInstructionPlan` from
`@solana-program/token-2022/confidential` builds that plan.

## Keys

Each wallet's encryption keys are derived the standard way: the wallet signs
the constant message `solana-conf-bal/v1` once, and both the ElGamal and AES
keys come from that signature. The same wallet always re-derives the same
keys, which is what keeps confidential balances recoverable.

## Devnet

Needs `api.devnet.solana.com` reachable. The public faucet is rate-limited; if
an airdrop does not arrive, top the wallet up at faucet.solana.com.
