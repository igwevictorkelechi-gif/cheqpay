# Ajo savings

Two products, both in naira, with no interest paid.

## Personal Ajo (a savings plan)

- The user picks a name, an amount (at least ₦100, at most their per-transaction limit), how often (daily, weekly or monthly) and how many contributions (2 up to 366 / 104 / 60).
- The first contribution is taken when they create the plan, which needs their transaction PIN. The rest are auto-debited at 9:00am Lagos time (08:00 UTC) on each due date.
- If the wallet is short on a due date, that contribution is missed. It is not retried, and the plan carries on.
- When the last contribution is due, everything saved goes back to the wallet. A plan that runs to the end is **free**.
- Breaking a plan early (PIN) returns what was saved minus the **break fee**. The fee is a setting, `ajo_break_fee_bps` (default 100 = 1%).
- Needs KYC Tier 1. The money never leaves the user. The ledger records AJO_SAVE for money into the plan and AJO_RELEASE for money back out.

## Group Ajo (a rotating savings circle)

- **Forming.** An organiser (KYC Tier 2) creates a group with an amount, a frequency, a size of 2–30, and a collecting order: join order or random. The pot per round is capped at ₦20,000,000.
  - Members join with the 6-character invite code, their PIN and the ticked terms.
  - Before the start, any member except the organiser can leave, and the organiser can cancel.
- **Active.** The organiser starts the group:
  - Collecting positions are fixed. A random order uses a cryptographic shuffle, so nobody, including the organiser, can choose the early spots.
  - Round 1 is due at the next 9am Lagos time that is at least 12 hours away.
- **Each round:**
  - Every member except the collector is auto-debited (AJO_CONTRIBUTION). The collector's own share simply stays in their wallet.
  - The collector receives what was collected at once (AJO_PAYOUT).
  - A member whose wallet is short is recorded as **missed** for that round. CheqPay never pays a missed share itself.
- **Completed** after the last round. Arrears still owed keep being collected.

### The lien on arrears

While a member owes anything (`lib/ajo/lien.ts`):

1. **New money goes to the group first.** Any naira in their wallet is swept to the collectors they owe, oldest round first. Part payments are allowed.
   - The sweep runs on every scheduler pass and whenever the user opens Ajo.
   - Both sides get a ledger row: AJO_CONTRIBUTION for the debtor and AJO_PAYOUT for the collector.
2. **Money-out is refused** with HTTP 423, code `ajo_arrears`. This covers:
   - NGN and crypto withdrawals, and auto cash-out payouts. Auto cash-out still sells the coin, then leaves the naira in the wallet for the sweep.
   - Transfers to other users.
   - Swaps *out of* naira. Selling crypto *for* naira stays open, because that is how a member catches up.
   - Bills, gadget and event purchases, ad campaigns, and moving naira into a developer wallet.
3. They can't create or join groups, start new personal plans, or have personal-plan contributions taken.

Members agree to this when they join (the ticked terms).

## Running it

- **Scheduler:** `/api/cron/ajo` (CRON_SECRET or DB_CRON_SECRET). Each pass sweeps arrears, then runs due group rounds, then takes due plan contributions.
  - Vercel Cron calls it daily at 08:04 UTC.
  - Adding the Supabase pg_cron minute job, like `auto-cashout`, makes arrears clear within a minute of a top-up.
- **Feature flag:** `ajo` (off by default). Switching it off closes the user routes. The scheduler keeps running, so money already committed still moves.
- **Tables** (raw SQL, created by `ensureAjoSchema` at boot): `ajo_plans`, `ajo_groups`, `ajo_members`, `ajo_contributions`, `ajo_payouts`.
- **Exactly once:**
  - Every money move is one database transaction with a balance guard and a fixed idempotency key: `ajo:p:*`, `ajo:g:*`, `ajo:gp:*`, `ajo:gl:*` and `ajo:glp:*`.
  - Due plans and rounds are claimed with `FOR UPDATE SKIP LOCKED`, so overlapping scheduler runs never process the same one twice.

## API

| Method | Path | What |
| --- | --- | --- |
| GET | `/api/ajo` | Plans, groups, arrears and rules (also settles arrears) |
| POST | `/api/ajo/plans` | Start a plan (PIN) |
| DELETE | `/api/ajo/plans/:id` | Break a plan early (PIN) |
| POST | `/api/ajo/groups` | Create a group (PIN + `acceptTerms`) |
| POST | `/api/ajo/groups/join` | Join with `code` (PIN + `acceptTerms`) |
| GET | `/api/ajo/groups/:id` | Members, order, who's behind, payouts |
| POST | `/api/ajo/groups/:id` | `{ action: "start" \| "leave" \| "cancel" }` |
