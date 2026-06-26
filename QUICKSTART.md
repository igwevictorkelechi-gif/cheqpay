# CheqPay - Quick Setup & Testing Guide

## 🚀 Quick Start (5 Minutes)

### 1. Clone & Install
```bash
git clone <repo-url>
cd cheqpay
npm install
```

### 2. Get Supabase Credentials
- Create project at https://supabase.com
- Copy URL and Anon Key from Settings → API

### 3. Setup Database
- Supabase → SQL Editor → New Query
- Paste `supabase/migrations/001_initial_schema.sql`
- Click Run

### 4. Configure Environment
```bash
# Mobile
cd apps/mobile
cp .env.example .env.local
# Edit with your Supabase credentials

# Admin
cd apps/admin
cp .env.example .env.local
# Edit with your Supabase credentials
```

### 5. Run Applications
```bash
# Terminal 1: Mobile
cd apps/mobile && npm start

# Terminal 2: Admin
cd apps/admin && npm run dev
```

## 🧪 Testing Checklist

### Mobile App Testing
- [ ] Sign up with phone number
- [ ] Receive and verify OTP
- [ ] View wallet balance and virtual account
- [ ] Send money to another user
- [ ] Initiate withdrawal
- [ ] View transaction history
- [ ] Access profile and settings

### Admin Dashboard Testing
- [ ] Log in to admin panel
- [ ] View dashboard statistics
- [ ] Configure Paystack keys
- [ ] Configure Flutterwave keys
- [ ] View and search users
- [ ] View virtual accounts
- [ ] View and export transactions

### Backend Testing
- [ ] Virtual account creation Edge Function
- [ ] Paystack webhook processing
- [ ] Flutterwave webhook processing
- [ ] Payout processing

## 🔗 Key Endpoints

### Edge Functions
```
POST /create-virtual-account
POST /handle-webhook-paystack
POST /handle-webhook-flutterwave
POST /process-payout
```

### API Routes (Mobile)
```
GET /wallet/balance
GET /wallet/transactions
POST /wallet/transfer
POST /wallet/withdraw
GET /virtual-account
POST /auth/send-otp
POST /auth/verify-otp
POST /auth/register
```

## 💳 Payment Gateway Setup Checklist

### Paystack
- [ ] Create Paystack account
- [ ] Get API keys from Dashboard
- [ ] Save keys in CheqPay Admin → Payment Settings
- [ ] Add webhook: `https://your-supabase.supabase.co/functions/v1/handle-webhook-paystack`
- [ ] Test with test transaction

### Flutterwave
- [ ] Create Flutterwave account
- [ ] Get API keys from Dashboard
- [ ] Save keys in CheqPay Admin → Payment Settings
- [ ] Add webhook: `https://your-supabase.supabase.co/functions/v1/handle-webhook-flutterwave`
- [ ] Test with test transaction

## 🔐 Security Setup

### Admin Access
1. Create admin user in Supabase
2. Use admin credentials to log in
3. Configure payment API keys
4. Set up webhook URLs

### Sensitive Data
- Secret keys are encrypted in database
- Only Edge Functions can access secret keys
- Client apps only get public keys
- Enable Row-Level Security in Supabase

## 📊 Test Data

### Create Test User (Mobile)
Phone: 08012345678
OTP: Any 6 digits (in dev mode)
Email: test@example.com
Name: Test User

### Create Test Admin
Email: admin@cheqpay.com
Password: SecurePassword123

## 🐛 Common Issues & Solutions

### "Supabase connection failed"
- Check SUPABASE_URL and SUPABASE_ANON_KEY in .env
- Verify Supabase project is active
- Check internet connection

### "Virtual account creation fails"
- Verify payment keys are saved in admin dashboard
- Check API key permissions in Paystack/Flutterwave
- Review Edge Function logs in Supabase

### "Webhook not processing"
- Verify webhook URL is correct and accessible
- Check Paystack/Flutterwave webhook settings
- Review Edge Function execution logs

### "OTP not sending"
- Verify Supabase auth configuration
- Check phone number format (+234...)
- Review auth logs in Supabase

## 📞 Getting Help

1. Check logs in Supabase → Functions
2. Check browser console for frontend errors
3. Review database queries in Supabase
4. Email support@cheqpay.com

## ✅ Production Checklist

- [ ] All env variables configured
- [ ] Database backups enabled
- [ ] Payment keys rotated and secure
- [ ] SSL/TLS enabled
- [ ] Rate limiting configured
- [ ] Monitoring and alerts set up
- [ ] Error tracking enabled
- [ ] Admin 2FA enabled
- [ ] API rate limits configured
- [ ] Database replica for failover

## 📈 Scaling Considerations

- Use Supabase read replicas for analytics
- Implement caching with Redis
- Use CDN for static assets
- Monitor Edge Function execution time
- Scale database as transaction volume grows
- Set up load balancing for admin dashboard

---

**For detailed documentation, see README.md**
