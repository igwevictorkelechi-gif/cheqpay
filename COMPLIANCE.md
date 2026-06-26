# Compliance Notes — CheqPay Custodial Wallet

> **Scope disclaimer:** Operating a custodial NGN ⇄ crypto service in Nigeria
> sits in **VASP / money-services** territory under **CBN** and **SEC Nigeria**
> rules. Obtaining the correct licences/registrations and meeting ongoing
> regulatory obligations is the **client's responsibility and is out of scope
> for the code**. This codebase provides the *technical hooks* to operate
> compliantly; it does not constitute legal advice or a licence.

## What the system enforces in code

### 1. KYC tiers with escalating limits
- `User.kycTier` (0/1/2…) gates transaction limits.
- `KycRecord` stores tier, document references, and review status.
- Tier 1 = minimal (email + phone OTP). Higher tiers require ID/BVN before
  raising deposit/withdrawal ceilings.
- **Status:** model in place (Phase 0). Limit enforcement: Phase 1 + Phase 5.

### 2. AML transaction monitoring (hooks)
- Velocity checks (count/volume per rolling window).
- Large-amount thresholds.
- Flagged-address / sanctioned-address screening on crypto withdrawals.
- Flags are recorded and can block or queue a transaction for review.
- **Status:** planned Phase 6; data model (`Transaction`, `AuditLog`) supports it.

### 3. Record retention & audit
- `AuditLog` is an **append-only** trail of every financial action.
- `WebhookEvent` retains every inbound provider/PSP event (with signature
  validity) for idempotency and forensic review.
- Transactions and KYC records are retained per policy (retention window is a
  client/legal decision).

## Key custody & money principles baked in
- **No private keys ever touch our database or servers** — custody provider
  (Tatum) holds keys in HSM; we store only `custody_ref`.
- **All balances are integers in minor units** (kobo / satoshi / USDT 6dp) —
  no floating-point money.
- **Server quotes, server decides** — clients never set rates or amounts.
- **Every financial endpoint is authenticated and idempotent.**
- **Every webhook signature is verified before any state change.**

## Client action items (non-code)
- Engage Nigerian counsel on VASP/MSB licensing (CBN/SEC).
- Define KYC tier limits and required documents per tier.
- Define record-retention period and data-protection (NDPR) handling.
- Establish AML policy, sanctioned-address lists, and SAR/STR reporting process.
- Appoint a compliance officer / reporting workflow.
