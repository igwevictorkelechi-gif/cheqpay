# CheqPay Architecture & Wallet Flow Diagrams

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         PUBLIC INTERNET                                 │
└─────────────────────────────────────────────────────────────────────────┘
         ↓                          ↓                          ↓
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────────┐
│   MOBILE APP     │    │  ADMIN DASHBOARD │    │   PAYMENT PROVIDERS  │
│  (React Native)  │    │   (Next.js 15)   │    │  Paystack & FTW      │
│   - Auth         │    │ - Setup API Keys │    │                      │
│   - Wallet       │    │ - Manage Users   │    │  Bank Integration    │
│   - Transfers    │    │ - Monitor VA/TX  │    │  Webhooks            │
└────────┬─────────┘    └────────┬─────────┘    └──────────┬───────────┘
         │                       │                         │
         └───────────────────────┼─────────────────────────┘
                                 │
                    ┌────────────▼─────────────┐
                    │   SUPABASE SERVICE       │
                    │  (Auth + Database)       │
                    └─────────┬────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│  PostgreSQL  │      │  Edge        │      │   Storage    │
│  Database    │      │  Functions   │      │  (Documents) │
│              │      │  (Deno)      │      │              │
│  Users       │      │              │      │ KYC Uploads  │
│  Wallets     │      │ - Create VA  │      │              │
│  VA          │      │ - Process    │      │              │
│  Transact.   │      │   Webhooks   │      │              │
│  Configs     │      │ - Payouts    │      │              │
│  Audit Logs  │      │              │      │              │
└──────────────┘      └──────────────┘      └──────────────┘
```

## Wallet Funding Flow

```
┌──────────────────────────────────────────────────────────────────┐
│ 1. USER SIGNUP & VA CREATION                                     │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  User Phone + OTP Registration                                   │
│           ↓                                                       │
│  ✅ Create User (users table)                                    │
│           ↓                                                       │
│  ✅ Create Empty Wallet (wallets table)                          │
│           ↓                                                       │
│  ✅ Call Edge Function: create-virtual-account                   │
│      └─→ Paystack API: Create Dedicated Account                  │
│      └─→ Flutterwave API: Create Static Account                  │
│           ↓                                                       │
│  ✅ Store VA Details (virtual_accounts table)                    │
│           ↓                                                       │
│  User sees: Account Number + Bank Name (e.g., 1000000001 Wema)   │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘


┌──────────────────────────────────────────────────────────────────┐
│ 2. USER FUNDS WALLET (Bank Transfer)                             │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  User opens Mobile App → Fund Wallet Screen                      │
│           ↓                                                       │
│  Display: Account Number, Bank Name                              │
│           ↓                                                       │
│  User performs bank transfer from their bank app                 │
│           ↓                                                       │
│  Transfer goes to: 1000000001 (User's Virtual Account)           │
│           ↓                                                       │
│  Paystack/Flutterwave receives funds                             │
│           ↓                                                       │
│  Webhook triggered with transfer details                         │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘


┌──────────────────────────────────────────────────────────────────┐
│ 3. WEBHOOK PROCESSING (Edge Function)                            │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Webhook received from Paystack/Flutterwave                      │
│           ↓                                                       │
│  ✅ Verify webhook signature (security)                          │
│           ↓                                                       │
│  ✅ Find user by virtual account reference                       │
│           ↓                                                       │
│  ✅ Update wallet balance:                                       │
│      - wallet.balance += amount                                  │
│      - wallet.ledger_balance += amount                           │
│           ↓                                                       │
│  ✅ Create transaction record:                                   │
│      - type: 'credit'                                            │
│      - status: 'completed'                                       │
│      - reference: webhook reference                              │
│           ↓                                                       │
│  ✅ Log audit entry                                              │
│           ↓                                                       │
│  ✅ [OPTIONAL] Send notification via Realtime                    │
│           ↓                                                       │
│  Mobile App displays updated balance instantly!                  │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘


┌──────────────────────────────────────────────────────────────────┐
│ 4. P2P TRANSFER (User to User)                                   │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Sender opens "Send Money" in mobile app                         │
│           ↓                                                       │
│  Enters: Recipient phone + Amount                                │
│           ↓                                                       │
│  Calls Edge Function: send-money                                 │
│           ↓                                                       │
│  ✅ Verify sender balance >= amount                              │
│           ↓                                                       │
│  ✅ Find recipient by phone number                               │
│           ↓                                                       │
│  ✅ Deduct from sender wallet:                                   │
│      - sender.balance -= amount                                  │
│           ↓                                                       │
│  ✅ Credit to recipient wallet:                                  │
│      - recipient.balance += amount                               │
│           ↓                                                       │
│  ✅ Create 2 transaction records:                                │
│      - Sender: type='transfer', amount=-(amount)                │
│      - Recipient: type='transfer', amount=+(amount)             │
│           ↓                                                       │
│  INSTANT! No external gateway needed 🚀                          │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘


┌──────────────────────────────────────────────────────────────────┐
│ 5. WITHDRAWAL (Wallet → Bank Account)                            │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  User opens "Withdraw" in mobile app                             │
│           ↓                                                       │
│  Enters: Bank + Account Number + Amount                          │
│           ↓                                                       │
│  Calls Edge Function: process-payout                             │
│           ↓                                                       │
│  ✅ Verify balance >= amount                                     │
│           ↓                                                       │
│  ✅ Call Paystack/Flutterwave Transfer API:                      │
│      - Create transfer receipt to bank account                   │
│           ↓                                                       │
│  ✅ If successful: Deduct from wallet                            │
│      - wallet.balance -= amount                                  │
│           ↓                                                       │
│  ✅ Create transaction (status='pending'):                       │
│      - type: 'withdrawal'                                        │
│      - status: 'pending' → 'completed' via webhook               │
│           ↓                                                       │
│  User receives funds in 30 minutes - 1 hour (Nigeria avg)        │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

## Data Flow Diagram

```
                    ┌─────────────────────────┐
                    │   MOBILE APP - USER     │
                    │  ┌─────────────────────┐│
                    │  │ Wallet Store        ││
                    │  │ - Balance: ₦125,000 ││
                    │  │ - VA: 1000000001    ││
                    │  └─────────────────────┘│
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │ SUPABASE REALTIME       │
                    │ Listen to wallet        │
                    │ & transaction changes   │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │  POSTGRESQL DATABASE    │
                    │ ┌────────────────────┐  │
                    │ │ wallets             │  │
                    │ │ ├─ id               │  │
                    │ │ ├─ user_id          │  │
                    │ │ ├─ balance: 125000  │  │
                    │ │ └─ updated_at       │  │
                    │ ├────────────────────┤  │
                    │ │ transactions        │  │
                    │ │ ├─ id               │  │
                    │ │ ├─ user_id          │  │
                    │ │ ├─ type: credit     │  │
                    │ │ ├─ amount: 50000    │  │
                    │ │ └─ status: complete │  │
                    │ └────────────────────┘  │
                    └─────────────────────────┘
```

## Admin Dashboard Data Management

```
ADMIN LOGS IN (Secure Login)
        ↓
┌──────────────────────────────────┐
│ ADMIN DASHBOARD                  │
│ ┌────────────────────────────────┤
│ │ 1. PAYMENT SETTINGS             │
│ │    ┌─────────────────────────┐ │
│ │    │ Paystack Config         │ │
│ │    │ - Public Key (visible)  │ │
│ │    │ - Secret Key (encrypted)│ │
│ │    │ - Active: YES           │ │
│ │    └─────────────────────────┘ │
│ │    ┌─────────────────────────┐ │
│ │    │ Flutterwave Config      │ │
│ │    │ - Public Key (visible)  │ │
│ │    │ - Secret Key (encrypted)│ │
│ │    │ - Active: NO            │ │
│ │    └─────────────────────────┘ │
│ │                                 │
│ │ 2. USERS MANAGEMENT            │
│ │    - Search/Filter users        │
│ │    - View KYC status            │
│ │    - Approve/Reject KYC        │
│ │    - Block users                │
│ │                                 │
│ │ 3. VIRTUAL ACCOUNTS             │
│ │    - View all VAs               │
│ │    - Provider info              │
│ │    - Regenerate account         │
│ │                                 │
│ │ 4. TRANSACTIONS                 │
│ │    - View all transactions      │
│ │    - Filter by type/status      │
│ │    - Export CSV                 │
│ │    - Manual reconciliation      │
│ └────────────────────────────────┘
        ↓
     SAVES
        ↓
  ┌─────────────────────────────────┐
  │ Supabase Database               │
  │ payment_configs table (encrypted)│
  └─────────────────────────────────┘
```

## Security Model

```
┌─────────────────────────────────────────────────────────┐
│                   SECURITY LAYERS                       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. AUTHENTICATION LAYER                              │
│     ├─ Supabase Auth (Phone + OTP)                    │
│     ├─ JWT tokens with 1-hour expiry                 │
│     └─ Admin login with email + password             │
│                                                         │
│  2. AUTHORIZATION LAYER (RLS - Row Level Security)    │
│     ├─ Users can only see their own data             │
│     ├─ Admins have elevated permissions              │
│     └─ Service role for backend operations           │
│                                                         │
│  3. DATA ENCRYPTION                                   │
│     ├─ Secret API keys encrypted at rest             │
│     ├─ HTTPS for all communications                  │
│     └─ Passwords hashed with bcrypt                  │
│                                                         │
│  4. WEBHOOK SECURITY                                  │
│     ├─ Verify webhook signatures                     │
│     ├─ HMAC-SHA512 validation                        │
│     └─ Reject unsigned webhooks                      │
│                                                         │
│  5. API KEY PROTECTION                               │
│     ├─ Secret keys NEVER in client app              │
│     ├─ Only in Edge Functions (server-side)         │
│     ├─ Rotate keys periodically                      │
│     └─ Audit all API access                          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Transaction State Machine

```
CREDIT (Bank Transfer)
┌─────────────────────┐
│      Pending        │─ (Waiting for webhook)
└──────────┬──────────┘
           │
           ▼ (Webhook received & verified)
┌─────────────────────┐
│    Completed        │─ Balance updated ✅
└─────────────────────┘


TRANSFER (P2P)
┌─────────────────────┐
│    Initiated        │─ Check balance
└──────────┬──────────┘
           │
           ▼ (Balance sufficient)
┌─────────────────────┐
│    Processing       │─ Update sender & recipient
└──────────┬──────────┘
           │
           ▼ (Both updated)
┌─────────────────────┐
│    Completed        │─ Instant! Notify both users ✅
└─────────────────────┘


WITHDRAWAL
┌─────────────────────┐
│    Initiated        │─ Validate account
└──────────┬──────────┘
           │
           ▼ (Call payout API)
┌─────────────────────┐
│     Processing      │─ Await provider response
└──────────┬──────────┘
           │
           ▼ (Money sent, waiting confirmation)
┌─────────────────────┐
│      Pending        │─ Waiting for webhook
└──────────┬──────────┘
           │
           ▼ (Webhook received)
┌─────────────────────┐
│    Completed        │─ User received funds ✅
└─────────────────────┘
```

## Virtual Account Lifecycle

```
USER REGISTERS
    ↓
    IMMEDIATE: Create user + empty wallet
    ↓
    ASYNC: Create Virtual Account
    ├─ Call Paystack: Create Dedicated VA
    │  ├─ Preferred Bank: Wema (035)
    │  ├─ Return: Account Number
    │  └─ Store in DB with reference
    │
    └─ OR Call Flutterwave: Create Static VA
       ├─ is_permanent: true
       ├─ Return: Account Number
       └─ Store in DB with reference
    ↓
    VA READY: User can now receive funds
    ├─ Bank: Wema Bank
    ├─ Account: 1000000001
    └─ Reference: PAYSTACK_user-id
    ↓
    USER TRANSFERS MONEY TO VA
    ├─ Paystack/Flutterwave receives
    ├─ Verifies it matches user's VA
    ├─ Triggers webhook
    └─ Edge Function credits wallet


ADMIN NEEDS TO REGENERATE VA
    ↓
    Create new VA in Paystack/Flutterwave
    ↓
    Update virtual_accounts table
    ├─ Create new record (new account number)
    └─ Keep old record active (transition period)
    ↓
    New transfers go to new account
    Old transfers still work (grace period)
```

---

This architecture ensures:
✅ Security (keys never exposed)
✅ Instant transfers (no external calls)
✅ Scalability (Edge Functions auto-scale)
✅ Reliability (multiple payment providers)
✅ User Experience (real-time updates)
