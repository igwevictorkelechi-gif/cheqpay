# 🌐 CheqPay Web App - Complete Guide

**Status**: ✅ Production-Ready  
**Framework**: Next.js 15 (App Router)  
**Type Safety**: Full TypeScript  
**Styling**: Tailwind CSS 3.3 + Responsive Design  
**APIs**: Supabase + Edge Functions  
**Auth**: Phone + OTP Integration  

---

## 📱 Features

### Responsive Design
- ✅ Mobile-first (tested on 375px screens)
- ✅ Tablet optimized (768px breakpoints)
- ✅ Desktop-ready (1920px+ displays)
- ✅ Touch-friendly buttons and spacing
- ✅ Hamburger menu on mobile, full sidebar on desktop

### Authentication System
- ✅ Phone-based OTP login
- ✅ User registration with validation
- ✅ Session persistence
- ✅ Automatic logout on expiry
- ✅ Protected routes with auth guards

### Wallet Features
- ✅ Real-time balance display with toggle
- ✅ Virtual account display (copy-to-clipboard)
- ✅ Quick action cards
- ✅ Recent transactions list
- ✅ Balance visibility toggle (eye icon)

### Core Operations
- ✅ P2P money transfer with validation
- ✅ Withdrawal to any Nigerian bank
- ✅ Transaction history with filters
- ✅ KYC document submission
- ✅ Account settings & preferences

### User Experience
- ✅ Loading states on all async operations
- ✅ Error handling with user-friendly messages
- ✅ Success notifications
- ✅ Form validation (client + server)
- ✅ Toast/notification ready
- ✅ Smooth transitions & animations

---

## 🚀 Quick Start

### Installation

```bash
# Clone and install
cd apps/web
npm install

# or from root
npm install
```

### Environment Setup

```bash
# Copy template
cp .env.example .env.local

# Edit .env.local
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
```

### Development

```bash
# Start dev server (localhost:3000)
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

---

## 📁 Project Structure

```
apps/web/
├── src/
│   ├── app/                           # Next.js App Router
│   │   ├── layout.tsx                 # Root layout
│   │   ├── globals.css                # Global styles
│   │   ├── page.tsx                   # Home (wallet)
│   │   ├── login/page.tsx             # Login screen
│   │   ├── signup/page.tsx            # Registration screen
│   │   ├── verify-otp/page.tsx        # OTP verification
│   │   ├── send/page.tsx              # Send money
│   │   ├── withdraw/page.tsx          # Withdrawal form
│   │   ├── transactions/page.tsx      # Transaction history
│   │   ├── kyc/page.tsx               # KYC verification
│   │   └── settings/page.tsx          # User settings
│   │
│   ├── components/                    # Reusable components
│   │   ├── Sidebar.tsx                # Navigation sidebar
│   │   ├── Header.tsx                 # Top header
│   │   ├── MainLayout.tsx             # Main app layout
│   │   └── AuthLayout.tsx             # Auth pages layout
│   │
│   ├── services/                      # API services
│   │   ├── supabase.ts                # Supabase client
│   │   ├── auth.ts                    # Auth operations
│   │   └── wallet.ts                  # Wallet operations
│   │
│   └── store/                         # Zustand state
│       └── index.ts                   # Auth, Wallet, UI stores
│
├── package.json                       # Dependencies
├── tsconfig.json                      # TypeScript config
├── next.config.ts                     # Next.js config
├── tailwind.config.ts                 # Tailwind theme
├── postcss.config.js                  # PostCSS setup
└── .env.example                       # Environment template
```

---

## 🎨 Design System

### Colors
- **Primary**: `#10B981` (Emerald Green)
- **Dark**: `#059669`
- **Light**: `#D1FAE5`
- **Danger**: `#EF4444`
- **Warning**: `#F59E0B`
- **Success**: `#10B981`

### Typography
- **Font**: System font stack (SF Pro, Segoe UI, etc.)
- **Headings**: Bold weights (600-700)
- **Body**: Regular (400)
- **Numbers**: Monospace font

### Spacing
- **Mobile**: 4px, 8px, 12px, 16px
- **Tablet**: 16px, 24px, 32px
- **Desktop**: 24px, 32px, 48px

### Components
- **Cards**: Rounded-lg with shadow
- **Buttons**: Full-width on mobile, auto on desktop
- **Inputs**: Full-width with focus ring
- **Tables**: Responsive (hidden columns on small screens)

---

## 🔐 Security Features

### Authentication
- Phone-based OTP (no passwords)
- Session stored in localStorage
- Auto-refresh tokens
- Automatic session validation

### Data Protection
- All API calls over HTTPS
- Environment variables for secrets
- Supabase Row-Level Security (RLS)
- Protected routes with auth guards

### Form Security
- Zod runtime validation
- Client-side validation
- Server-side validation ready
- CSRF protection ready

---

## 📱 Page Details

### Login (`/login`)
- Phone number input with validation
- Send OTP button with loading state
- Link to signup page
- Error handling

### Signup (`/signup`)
- Full name, email, phone inputs
- Field validation (name ≥2 chars, valid email, 10+ digit phone)
- OTP send on form submission
- Link to login page

### Verify OTP (`/verify-otp`)
- 6-digit OTP input (auto-format)
- 60-second resend timer
- Handles both signup and login flows
- Error messages for expired/invalid codes

### Wallet Homepage (`/`)
- Balance card with toggle visibility
- Virtual account display
  - Account number (copy button)
  - Bank name
  - Provider badge
- Quick action cards (4 buttons)
- Recent transactions section

### Send Money (`/send`)
- Recipient phone validation
- Amount input with min/max limits
- Optional narration
- Balance display
- Confirmation screen

### Withdraw (`/withdraw`)
- Bank selection dropdown (NIGERIAN_BANKS)
- Account number input (10 digits)
- Amount validation (₦100-₦5M)
- Optional narration
- Balance check

### Transactions (`/transactions`)
- Paginated transaction list
- Transaction type icons
- Status badges (completed/pending/failed)
- Responsive table (columns hide on small screens)
- Empty state illustration

### KYC (`/kyc`)
- Document type selector (BVN/NIN)
- Document number input (11 digits)
- File upload area (drag & drop ready)
- Current verification status

### Settings (`/settings`)
- User profile information display
- Toggle preferences:
  - Push notifications
  - Biometric authentication
  - Dark mode
- Help & support links
- Save button

---

## 🎯 Responsive Breakpoints

```
Mobile:    < 640px  (sm breakpoint)
Tablet:    640px+   (md breakpoint)
Desktop:   1024px+  (lg breakpoint)
Wide:      1280px+  (xl breakpoint)
```

### Mobile-First Approach
- Sidebar collapses to hamburger menu
- Tables stack on small screens
- Buttons are full-width
- Padding reduces on mobile
- Font sizes scale appropriately

---

## 🔌 API Integration

### Supabase Client
```typescript
import { supabase } from "@/services/supabase";

// Query data
const { data } = await supabase
  .from("wallets")
  .select("*")
  .eq("user_id", userId)
  .single();
```

### Auth Service
```typescript
import { authService } from "@/services/auth";

await authService.sendOTP(phone);
await authService.verifyOTP(phone, otpCode);
await authService.register(phone, email, fullName, otpCode);
const user = await authService.getCurrentUser();
await authService.logout();
```

### Wallet Service
```typescript
import { walletService } from "@/services/wallet";

const wallet = await walletService.getWallet(userId);
const va = await walletService.getVirtualAccount(userId);
const txns = await walletService.getTransactions(userId);

await walletService.sendMoney(userId, payload);
await walletService.initiateWithdrawal(userId, payload);

// Real-time subscriptions
walletService.subscribeToWallet(userId, (wallet) => {
  console.log("Balance updated:", wallet.balance);
});
```

---

## 🗂️ State Management (Zustand)

### Auth Store
```typescript
import { useAuthStore } from "@/store";

const { 
  user,              // Current user object
  isAuthenticated,   // Boolean flag
  loading,          // Loading state
  setUser,
  setLoading,
  logout
} = useAuthStore();
```

### Wallet Store
```typescript
import { useWalletStore } from "@/store";

const {
  wallet,           // Wallet object with balance
  virtualAccount,   // Virtual account details
  transactions,     // Transaction list
  loading,
  setWallet,
  updateBalance,
  addTransaction
} = useWalletStore();
```

### UI Store
```typescript
import { useUIStore } from "@/store";

const {
  showBalance,      // Toggle balance visibility
  darkMode,         // Dark mode flag
  sidebarOpen,      // Mobile sidebar state
  toggleBalance,
  setDarkMode,
  setSidebarOpen
} = useUIStore();
```

---

## 🧪 Testing

### Manual Testing Checklist

#### Auth Flow
- [ ] Navigate to /login
- [ ] Enter valid phone number
- [ ] Receive OTP
- [ ] Navigate to /verify-otp
- [ ] Enter OTP code
- [ ] Login successful
- [ ] Redirect to home
- [ ] Can access all protected pages
- [ ] Logout redirects to /login

#### Wallet Operations
- [ ] Balance displays correctly
- [ ] VA account number visible
- [ ] Copy to clipboard works
- [ ] Send money form validates
- [ ] Withdraw form validates
- [ ] Transaction history loads
- [ ] Settings save preferences

#### Responsive Design
- [ ] Test on 375px (mobile)
- [ ] Test on 768px (tablet)
- [ ] Test on 1920px (desktop)
- [ ] Sidebar collapses on mobile
- [ ] Table columns hide appropriately
- [ ] Touch targets are 44px+ on mobile
- [ ] No horizontal scrolling

---

## 🚢 Deployment

### Vercel (Recommended)
```bash
# Deploy automatically from GitHub
# 1. Push code to GitHub
# 2. Import in Vercel
# 3. Add environment variables
# 4. Deploy

# Or use CLI
vercel deploy
```

### Self-Hosted
```bash
# Build
npm run build

# Start server
npm start

# Use process manager (PM2)
pm2 start "npm start" --name cheqpay-web
```

### Environment Variables
```
NEXT_PUBLIC_SUPABASE_URL=https://project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiI...
```

---

## 🛠️ Performance Optimization

### Code Splitting
- Every page is code-split automatically
- Components use dynamic imports where needed

### Image Optimization
- Next.js Image component configured
- Supabase remote images supported
- Auto WebP format

### CSS Optimization
- Tailwind CSS purges unused styles
- PostCSS minifies CSS
- Production bundle is optimized

### JavaScript
- TypeScript for type safety
- Tree-shaking removes dead code
- Minification in production

---

## 📊 Browser Support

- Chrome/Chromium (latest 2 versions)
- Firefox (latest 2 versions)
- Safari (latest 2 versions)
- Edge (latest 2 versions)
- Mobile browsers (iOS 12+, Android 8+)

---

## 🐛 Troubleshooting

### OTP Not Sending
- Check Supabase Edge Functions are deployed
- Verify phone number format
- Check auth service is configured

### Build Fails
- Clear `.next` folder: `rm -rf .next`
- Reinstall dependencies: `rm -rf node_modules && npm install`
- Check Node version: `node -v` (should be 18+)

### Wallet Balance Not Updating
- Check Supabase connection
- Verify user session is active
- Check real-time subscriptions are enabled

### Component Not Rendering
- Check environment variables are set
- Verify Supabase client initialization
- Check browser console for errors

---

## 📦 Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| next | ^15.0.0 | React framework |
| react | ^18.2.0 | UI library |
| react-dom | ^18.2.0 | DOM rendering |
| typescript | ^5.3.2 | Type language |
| tailwindcss | ^3.3.0 | CSS framework |
| zustand | ^4.4.0 | State management |
| @supabase/supabase-js | ^2.38.0 | Backend client |
| zod | ^3.22.0 | Validation |
| lucide-react | ^0.263.1 | Icons |
| recharts | ^2.10.0 | Charts |
| date-fns | ^2.30.0 | Date utilities |

---

## 📚 Documentation

- **README.md** - Project overview
- **QUICKSTART.md** - Setup guide
- **docs/** - Additional documentation (create folder as needed)

---

## 🎓 Learning Resources

### Next.js
- [Next.js Documentation](https://nextjs.org/docs)
- [App Router Guide](https://nextjs.org/docs/app)

### TypeScript
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)

### Tailwind CSS
- [Tailwind Documentation](https://tailwindcss.com/docs)

### Supabase
- [Supabase Docs](https://supabase.com/docs)

### React Patterns
- [React Documentation](https://react.dev)

---

**Version**: 1.0.0  
**Last Updated**: 2024-01-25  
**Status**: ✅ Production Ready

