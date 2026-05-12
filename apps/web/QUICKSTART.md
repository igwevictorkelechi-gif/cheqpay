# 🌐 Web App - Setup & Quick Start

## What's New

You now have a **fully responsive web version** of Cheqpay that works on:
- Mobile (375px - great for testing on mobile browsers)
- Tablet (768px and up)
- Desktop (1920px+ with full sidebar)

All features from the mobile app are available:
- ✅ Wallet balance & virtual account
- ✅ Send money (P2P transfers)
- ✅ Withdraw to bank
- ✅ Transaction history
- ✅ KYC verification
- ✅ Settings & preferences

---

## 5-Minute Setup

### 1. Install Dependencies
```bash
cd apps/web
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env.local
```

Edit `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url_here
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_new_regenerated_key
```

### 3. Start Development Server
```bash
npm run dev
```

Visit http://localhost:3000

### 4. Test Login Flow
1. Go to `/login`
2. Enter phone: `+234 8012345678` (or any valid Nigerian number)
3. Receive OTP
4. Go to `/verify-otp`
5. Enter 6-digit code
6. Access wallet dashboard

---

## Mobile/Web Comparison

| Feature | Mobile (React Native) | Web (Next.js) |
|---------|----------------------|---------------|
| Platform | iOS/Android | Browser |
| Framework | React Native + Expo | Next.js 15 |
| Navigation | Bottom tabs | Sidebar menu |
| Performance | Native speed | High (Next.js optimized) |
| Offline | Can work offline | Browser dependent |
| Push Notifications | Built-in | Browser notifications ready |
| Size | ~30MB app | ~2MB initial load |
| Users | On phone app store | Any browser |

### When to Use Web Version
- ✅ Desktop users
- ✅ Testing without building app
- ✅ Web-only features (admin dashboard already web)
- ✅ Faster development iteration
- ✅ Running on company computers
- ✅ Tablet browsers

---

## Project Structure

```
apps/web/                           # Next.js 15 web app
├── src/
│   ├── app/                         # App Router pages
│   │   ├── page.tsx                 # Home (wallet)
│   │   ├── login/                   # Auth screens
│   │   ├── send/                    # Transactions
│   │   ├── withdraw/
│   │   ├── kyc/
│   │   └── settings/
│   │
│   ├── components/                  # Reusable UI
│   │   ├── Sidebar.tsx              # Navigation
│   │   ├── Header.tsx               # Top bar
│   │   ├── MainLayout.tsx           # App wrapper
│   │   └── AuthLayout.tsx           # Auth wrapper
│   │
│   ├── services/                    # API layer
│   │   ├── auth.ts                  # Auth API
│   │   ├── wallet.ts                # Wallet API
│   │   └── supabase.ts              # Client
│   │
│   └── store/                       # State (Zustand)
│       └── index.ts
│
├── package.json                     # 30+ dependencies
├── tailwind.config.ts               # Green theme
├── next.config.ts                   # Image optimization
└── .env.example                     # Templates
```

---

## Key Files Explained

### Authentication Pages (3 files)
1. **`/login`** - Phone number entry
   - Input: Phone number
   - Output: Redirect to verify-otp screen
   - Validation: Nigerian number format

2. **`/signup`** - New user registration
   - Inputs: Name, email, phone
   - Validation: All three required
   - Creates account on OTP verification

3. **`/verify-otp`** - Confirm code
   - Input: 6-digit OTP
   - Features: 60-second resend timer
   - Handles signup/login flows

### Main Features (5 pages)
1. **Home (`/`)** - Wallet dashboard
   - Balance card with toggle
   - Virtual account display
   - Quick action cards

2. **Send (`/send`)** - P2P transfers
   - Recipient phone validation
   - Amount with min/max
   - Balance check

3. **Withdraw (`/withdraw`)** - Bank transfers
   - Bank dropdown (all Nigerian banks)
   - Account number (10 digits)
   - Amount validation

4. **Transactions (`/transactions`)** - History
   - All user transactions
   - Status badges
   - Responsive table (hides columns on small screens)

5. **KYC (`/kyc`)** - Verification
   - BVN/NIN input
   - Document upload
   - Submit for verification

6. **Settings (`/settings`)** - Preferences
   - User profile info
   - Notification toggle
   - Dark mode toggle
   - Support links

### Layout Components (4 files)
1. **Sidebar** - Mobile: hamburger, Desktop: fixed sidebar
2. **Header** - Search + notifications + user profile
3. **MainLayout** - Wraps all app pages
4. **AuthLayout** - Wraps auth pages with gradient background

### Services (3 files)
1. **supabase.ts** - Supabase client initialization
2. **auth.ts** - Login, signup, OTP, logout
3. **wallet.ts** - Balance, transactions, send, withdraw

---

## Responsive Features

### Mobile (< 640px)
```
┌─────────────────┐
│☰ Cheqpay   🔔⚙️│  ← Header (fixed)
├─────────────────┤
│                 │
│   Wallet Card   │  ← Full width content
│                 │
│ Quick Actions   │
│                 │
└─────────────────┘

Sidebar: Off-canvas menu
Tables: Stack vertically  
Buttons: Full width
```

### Tablet (640px - 1024px)
```
┌─────────────────────────────────┐
│    Cheqpay    Search   🔔⚙️👤   │
├──────────────┬──────────────────┤
│              │                  │
│   Sidebar    │                  │
│              │   Page Content   │
│   (fixed)    │                  │
│              │                  │
└──────────────┴──────────────────┘

Sidebar: Visible
Navigation: Menu items visible
Tables: Horizontal scroll possible
```

### Desktop (1024px+)
```
┌──────────────────────────────────────────┐
│           Cheqpay   Search   🔔⚙️👤      │
├─────────────────┬──────────────────────┤
│                 │                      │
│  Sidebar        │  Page Content        │
│  (64 width)     │  (Full responsive)   │
│                 │                      │
│  • Wallet       │  Dashboard           │
│  • Send         │  Cards               │
│  • Transactions │  Tables              │
│  • Settings     │                      │
└─────────────────┴──────────────────────┘

Everything visible
Full space utilization
Optimized for large screens
```

---

## Environment Variables

### Required
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

### Optional
```
NEXT_PUBLIC_API_ENDPOINT     # Custom API endpoint
NEXT_PUBLIC_APP_NAME         # App title (default: Cheqpay)
NEXT_PUBLIC_APP_VERSION      # Version string
```

---

## Development Workflow

### Daily Development
```bash
# Terminal 1: Web app
cd apps/web
npm run dev        # http://localhost:3000

# Terminal 2: Mobile
cd apps/mobile
npm start          # Expo CLI

# Terminal 3: Admin
cd apps/admin
npm run dev        # http://localhost:3001
```

### Type Checking
```bash
npm run type-check  # Check TypeScript errors
npm run lint        # Check ESLint issues
npm run build       # Full production build
```

### Building for Production
```bash
npm run build       # Creates .next folder
npm start           # Runs production build
```

---

## API Endpoints

### Authentication
- `POST /api/auth/send-otp` - Send OTP code
- `POST /api/auth/verify-otp` - Verify OTP
- `POST /api/auth/register` - Register new user

### Wallet Operations  
- `POST /api/wallet/send-money` - Send P2P transfer
- `POST /api/wallet/withdraw` - Initiate withdrawal
- `GET /api/wallet/balance` - Get wallet balance (ready to add)
- `GET /api/wallet/transactions` - Get history (ready to add)

All endpoints use Supabase Edge Functions as backend.

---

## Testing Checklist

### Authentication ✅
- [ ] Login with phone number
- [ ] Receive OTP
- [ ] View OTP resend timer
- [ ] Verify code
- [ ] Logged in successfully
- [ ] Can access dashboard
- [ ] Logout works
- [ ] Redirected to login

### Core Features ✅
- [ ] Balance displays
- [ ] VA account number shows
- [ ] Copy account number works
- [ ] Send money form validates
- [ ] Withdraw form validates
- [ ] Transaction list loads
- [ ] KYC form submits
- [ ] Settings save

### Responsive ✅
- [ ] Works on mobile (375px)
- [ ] Works on tablet (768px)
- [ ] Works on desktop (1920px)
- [ ] Sidebar collapses on mobile
- [ ] No horizontal scrolling
- [ ] Touch targets are big enough
- [ ] Text is readable
- [ ] Images scale properly

### Performance ✅
- [ ] Page loads in < 2s
- [ ] No console errors
- [ ] Smooth animations
- [ ] No layout shifts
- [ ] Forms are responsive
- [ ] Images load properly

---

## Common Issues & Fixes

### Port 3000 Already in Use
```bash
# Kill process on port 3000
# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# macOS/Linux
lsof -i :3000
kill -9 <PID>
```

### Environment Variables Not Loading
```bash
# Make sure .env.local is in apps/web folder
ls -la apps/web/.env.local

# Restart dev server after changing env
npm run dev
```

### Build Errors
```bash
# Clear cache and rebuild
rm -rf .next node_modules
npm install
npm run build
```

### Supabase Connection Issues
```bash
# Check URL and key in browser console
console.log(process.env.NEXT_PUBLIC_SUPABASE_URL)

# Verify they're correct in .env.local
cat .env.local
```

---

## Deployment Options

### Vercel (Easiest)
```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
cd apps/web
vercel

# Or connect GitHub and deploy automatically
```

### Docker
```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY . .

RUN npm install
RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]
```

### Netlify
1. Connect GitHub repo
2. Build command: `npm run build`
3. Publish directory: `.next`
4. Add environment variables
5. Deploy

---

## Performance Metrics

### Lighthouse Scores (Target)
- Performance: 90+
- Accessibility: 95+
- Best Practices: 95+
- SEO: 100

### Bundle Size
- Initial load: ~2MB
- JavaScript: ~500KB
- CSS: ~50KB
- Images: Progressive loading

---

## Next Steps

1. ✅ Setup environment variables
2. ✅ Test login/signup flow
3. ✅ Try send money and withdraw
4. ✅ Review transaction history
5. Complete KYC
6. Enable notifications
7. Deploy to Vercel
8. Share with team

---

## Support & Help

### Documentation
- See `README.md` in this folder for full docs
- See root `README.md` for project overview
- See `ARCHITECTURE.md` for system design

### Troubleshooting
- Check browser console (F12) for errors
- Check terminal output for server errors
- Verify Supabase connection
- Check environment variables are set

### Need Help?
- Check [Next.js docs](https://nextjs.org/docs)
- Check [Supabase docs](https://supabase.com/docs)
- Check [Tailwind docs](https://tailwindcss.com/docs)

---

**Ready to go!** 🚀

Start with `npm run dev` in the web folder and visit http://localhost:3000

