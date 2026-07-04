# CheqPay - Nigerian NGN ⇄ Crypto Custodial Wallet

An NGN ⇄ crypto (BTC + USDT) custodial wallet with a dedicated backend. Users
fund with Naira via Flutterwave virtual accounts, buy/sell/convert crypto at
live rates, send/receive crypto on-chain, pay bills, and complete KYC — with a
web app, a native mobile app, and an admin dashboard.

## 🏗️ Project Structure

```
cheqpay/
├── apps/
│   ├── mobile/          # React Native Expo app (iOS/Android)
│   ├── web/             # Next.js 15 user app (dark, mobile-first PWA)
│   ├── admin/           # Next.js 15 admin dashboard
│   └── api/             # Next.js 15 custodial backend (money engine)
├── packages/
│   ├── db/              # Prisma schema + migrations (Supabase Postgres)
│   └── shared/          # Shared types and schemas
└── supabase/            # Legacy edge functions / migrations
```

Managed with **bun workspaces + Turborepo**. The user apps talk to `apps/api`
(the custodial backend) over HTTP; auth tokens come from Supabase Auth.

## 🎯 Apps at a Glance

| App | Platform | Purpose | Stack |
|-----|----------|---------|-------|
| **Mobile** | iOS/Android | User wallet, crypto, bills, KYC | React Native + Expo |
| **Web** | Browser | Same, dark mobile-first PWA | Next.js 15 + Tailwind |
| **Admin** | Browser | KYC review, settings, bill logos, users | Next.js 15 |
| **API** | Serverless | Custodial money engine (ledger, swaps, payouts) | Next.js 15 + Prisma |



## 🚀 Tech Stack

### Mobile App
- **React Native** with Expo for iOS/Android
- **Expo Router** for navigation
- **NativeWind/Tailwind** for styling
- **Zustand** for state management
- **TanStack Query** for data fetching
- **TypeScript** for type safety

### Admin Dashboard
- **Next.js 15** (App Router)
- **TypeScript**
- **Tailwind CSS** + **shadcn/ui**
- **Recharts** for analytics
- **TanStack Table** for data tables

### Web App ✨ NEW
- **Next.js 15** (App Router) 
- **TypeScript**
- **Tailwind CSS** (responsive design)
- **Zustand** for state management
- **Fully responsive** (mobile, tablet, desktop)

### Backend (`apps/api`) — custodial money engine
- **Next.js 15** route handlers (serverless on Vercel)
- **Prisma** on **Supabase Postgres** (BigInt minor units — no floats)
- **Supabase Auth** token validation; MFA (AAL2) gating on withdrawals
- **Swappable providers** behind interfaces: custody, payments, price feed, KYC
- Idempotency keys, webhook signature verification, AML screening, rate limits,
  append-only audit log

### Provider integrations (all behind interfaces; `mock` is the safe default)
- **Payments — Flutterwave**: NGN virtual accounts, bank payouts, bill payments
- **Custody — Tatum**: crypto wallets, deposits, on-chain withdrawals (BTC/USDT)
- **Price feed**: Binance / CoinGecko (live) for BTC/USDT spot
- **KYC — Dojah**: BVN lookup + name match for automatic verification

## ✨ Core Features

- **NGN wallet** — fund via a dedicated Flutterwave virtual account (NUBAN);
  withdraw to any Nigerian bank.
- **Crypto (BTC + USDT)** — buy, sell, and **convert** (incl. direct BTC↔USDT)
  at live rates with an admin-controlled spread; **receive** (QR + address) and
  **send** on-chain.
- **Bill payments** — airtime, data, electricity, cable TV, betting via
  Flutterwave, with brand-tiled providers (logos uploadable from admin).
- **Transactions** — one custodial ledger; unified history across home, crypto,
  and the transactions screen.
- **KYC & account tiers** — see below.

## 🪪 KYC & Account Tiers

Tiers gate limits and crypto withdrawals (Tier 0 unverified → Tier 3 premium).

- **Automatic verification** — submitting a valid **BVN + matching name**
  auto-approves to **Tier 2** via the KYC provider (Dojah in prod; a mock
  auto-approves on a well-formed BVN in dev).
- **Manual review** — anything that doesn't auto-verify lands in the admin
  **KYC Review** queue (approve/reject → sets the record status and user tier,
  audited).
- **In-app** — an alert bar prompts unverified users to verify, and the profile
  shows the current account level.

## 📋 Prerequisites

- Node.js 18+
- npm or yarn
- Supabase account (https://supabase.com)
- Paystack account (https://paystack.com)
- Flutterwave account (https://flutterwave.com)
- Expo CLI: `npm install -g expo-cli`
- EAS CLI: `npm install -g eas-cli`

## 🔧 Setup Instructions

### 1. Clone and Install Dependencies

```bash
git clone <repo-url>
cd cheqpay
npm install
```

### 2. Supabase Setup

#### Create a Supabase Project
1. Go to https://supabase.com and create a new project
2. Note your **Project URL** and **Anon Key** (find in Settings → API)
3. Create a **Service Role API Key** (for server-side operations)

#### Run Migrations
1. In Supabase console, go to **SQL Editor**
2. Create a new query
3. Paste the contents of `supabase/migrations/001_initial_schema.sql`
4. Click **Run**

This creates all necessary tables with RLS policies for security.

#### Deploy Edge Functions
```bash
# Install Supabase CLI
npm install -g supabase

# Login
supabase login

# Deploy functions
supabase functions deploy create-virtual-account --project-id YOUR_PROJECT_ID
supabase functions deploy handle-webhook-paystack --project-id YOUR_PROJECT_ID
supabase functions deploy handle-webhook-flutterwave --project-id YOUR_PROJECT_ID
supabase functions deploy process-payout --project-id YOUR_PROJECT_ID
```

### 3. Environment Configuration

#### Mobile App (`.env.local`)
```bash
cd apps/mobile
cp .env.example .env.local
```

Edit `.env.local`:
```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
EXPO_PUBLIC_API_URL=https://your-project.supabase.co/functions/v1
```

#### Admin Dashboard (`.env.local`)
```bash
cd apps/admin
cp .env.example .env.local
```

Edit `.env.local`:
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_PROJECT_ID=your-project-id
```

### 4. Payment Gateway Configuration

#### Paystack Setup
1. Log in to Paystack Dashboard: https://dashboard.paystack.co
2. Go to **Settings** → **Developers** → **API Keys**
3. Copy your **Public Key** and **Secret Key**
4. In CheqPay Admin Dashboard:
   - Go to **Payment Settings**
   - Select **Paystack**
   - Paste your Public and Secret keys
   - Click **Save**
5. In Paystack Dashboard, go to **Settings** → **Webhooks**
   - Add webhook URL: `https://your-supabase-url.supabase.co/functions/v1/handle-webhook-paystack`
   - Events: Select `charge.success` and `transfer.success`

#### Flutterwave Setup
1. Log in to Flutterwave Dashboard: https://dashboard.flutterwave.com
2. Go to **Settings** → **API** → **API Keys**
3. Copy your **Public Key** and **Secret Key**
4. In CheqPay Admin Dashboard:
   - Go to **Payment Settings**
   - Select **Flutterwave**
   - Paste your Public and Secret keys
   - Click **Save**
5. In Flutterwave Dashboard, go to **Settings** → **Webhooks**
   - Add webhook URL: `https://your-supabase-url.supabase.co/functions/v1/handle-webhook-flutterwave`
   - Select all events

### 5. Running the Applications

#### Mobile App (Expo)
```bash
cd apps/mobile
npm start

# Press 'i' for iOS simulator
# Press 'a' for Android emulator
# Or scan QR code with Expo Go app
```

#### Web App (Next.js)
```bash
cd apps/web
npm run dev
```

Open http://localhost:3000 in your browser.

#### Admin Dashboard
```bash
cd apps/admin
npm run dev
```

Open http://localhost:3001 in your browser.

## 🔐 Security Features

### API Keys Protection
- **Secret keys never touch the client** - only used in Supabase Edge Functions
- Keys are encrypted in database
- Communication is HTTPS-only

### Row-Level Security (RLS)
- Users can only view/modify their own data
- Admins have elevated permissions
- Service role for backend operations

### Admin Authentication
- Secure admin login (implement with NextAuth.js)
- Session tokens stored securely
- CSRF protection

## 📱 Mobile App Features

### Authentication
- Phone number + OTP login
- Automatic session persistence
- Biometric optional

### Wallet Management
- Real wallet balance display with eye toggle
- Virtual account details (account number, bank name)
- Copy account number to clipboard

### Transactions
- Send money to other users
- Wallet-to-wallet instant transfers
- Withdraw to any Nigerian bank account

### Virtual Account Funding
- Dedicated/Static virtual account per user
- Automatic balance update on bank transfer
- Real-time webhook processing

### Additional Features
- KYC verification (BVN/NIN)
- Transaction history with filters
- Profile management
- Support for Nigerian banks

## 💻 Admin Dashboard Features

### Dashboard
- Real-time statistics (total wallets, active users, KYC pending, daily volume)
- Recent user activity
- Quick action shortcuts

### Users Management
- Search and filter users
- KYC approval/rejection
- Block/unblock users
- View wallet balances

### Virtual Accounts
- View all assigned virtual accounts
- Regenerate accounts
- Switch between providers
- Account number management

### Payment Settings
- Configure Paystack keys
- Configure Flutterwave keys
- Toggle active provider
- Webhook configuration helper

### Transactions
- View all platform transactions
- Filter by type and status
- Export to CSV
- Search and pagination
- Manual reconciliation

## 🧪 Testing

### Test Virtual Account Creation
```bash
curl -X POST https://your-supabase-url.supabase.co/functions/v1/create-virtual-account \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "user-uuid",
    "provider": "paystack",
    "customer_email": "user@example.com",
    "customer_phone": "08012345678",
    "customer_name": "John Doe"
  }'
```

### Test Webhook (Paystack)
```bash
curl -X POST http://localhost:3000/api/webhooks/paystack \
  -H "Content-Type: application/json" \
  -H "x-paystack-signature: your-signature" \
  -d '{
    "event": "charge.success",
    "data": {
      "reference": "your-reference",
      "amount": 2500000,
      "customer": {"email": "customer@example.com"}
    }
  }'
```

### Test Payout
```bash
curl -X POST https://your-supabase-url.supabase.co/functions/v1/process-payout \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "user-uuid",
    "amount": 10000,
    "bank_account_number": "0123456789",
    "bank_code": "058",
    "narration": "Withdrawal"
  }'
```

## 📊 Database Schema

### Users Table
- `id` (UUID, PK)
- `phone` (VARCHAR, UNIQUE)
- `email` (VARCHAR, UNIQUE)
- `full_name` (VARCHAR)
- `kyc_status` (pending/approved/rejected)
- `referral_code` (VARCHAR, UNIQUE)
- Timestamps

### Wallets Table
- `id` (UUID, PK)
- `user_id` (FK to users)
- `balance` (DECIMAL)
- `ledger_balance` (DECIMAL)

### Virtual Accounts Table
- `id` (UUID, PK)
- `user_id` (FK, UNIQUE)
- `provider` (paystack/flutterwave)
- `account_number` (VARCHAR)
- `bank_name` (VARCHAR)
- `reference` (VARCHAR, UNIQUE)
- `is_active` (BOOLEAN)
- `metadata` (JSONB)

### Transactions Table
- `id` (UUID, PK)
- `user_id` (FK)
- `type` (credit/debit/transfer/withdrawal/airtime/bills)
- `amount` (DECIMAL)
- `reference` (VARCHAR, UNIQUE)
- `status` (pending/completed/failed)
- `metadata` (JSONB)

### Payment Configs Table
- `provider` (paystack/flutterwave, UNIQUE)
- `public_key` (VARCHAR)
- `secret_key_encrypted` (TEXT)
- `is_active` (BOOLEAN)

## 🎨 UI/UX Design

### Mobile App
- **OPay-inspired design** with modern green (#10B981) branding
- Clean card-based layouts
- Fast onboarding (Phone → OTP → Dashboard)
- Real-time balance updates
- Smooth transitions and animations

### Admin Dashboard
- Professional business UI
- Responsive grid layouts
- Data tables with sorting/filtering
- Chart visualizations
- Quick action buttons

## 🚀 Deployment

### Mobile App (EAS)
```bash
cd apps/mobile
eas build --platform ios
eas submit --platform ios
```

### Admin Dashboard (Vercel)
```bash
cd apps/admin
vercel
```

### Edge Functions
```bash
supabase functions deploy --project-id YOUR_PROJECT_ID
```

## 📖 API Documentation

See `API.md` for complete API endpoint documentation.

## 🤝 Contributing

1. Create a feature branch
2. Make your changes
3. Submit a pull request

## 📄 License

MIT License - See LICENSE file

## 📞 Support

For issues and questions:
- Email: support@cheqpay.com
- Documentation: https://docs.cheqpay.com
- Community: https://discord.gg/cheqpay

---

**Built with ❤️ for African fintech**
