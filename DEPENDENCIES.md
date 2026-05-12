# Cheqpay - Complete Dependencies & Versions Guide

## Overall Project Structure

This is a **Turborepo-based monorepo** with three main packages:

```
Root (Turborepo Workspace)
├── apps/mobile (React Native + Expo)
├── apps/admin (Next.js 15)
└── packages/shared (Shared types & schemas)
```

## Root Package.json Dependencies

### Production Dependencies
```json
- turbo: ^1.12.0           // Monorepo task orchestration
- prettier: ^3.1.0         // Code formatter
```

### Dev Dependencies
```json
- @typescript-eslint/eslint-plugin: ^6.13.0
- @typescript-eslint/parser: ^6.13.0
- eslint: ^8.54.0
- typescript: ^5.3.2
```

## Mobile App (React Native + Expo)

### Core Framework
```json
- react: ^18.2.0
- react-native: ^0.73.0
- expo: ^50.0.0
- expo-router: ^2.0.0
```

### UI & Styling
```json
- nativewind: ^2.0.11       // Tailwind CSS for React Native
- tailwindcss: ^3.3.0
```

### State Management
```json
- zustand: ^4.4.0           // Lightweight state management
- @tanstack/react-query: ^5.22.0  // Data fetching & caching
```

### Backend & Authentication
```json
- @supabase/supabase-js: ^2.38.0  // Supabase client
```

### Utilities
```json
- axios: ^1.6.0             // HTTP client
- date-fns: ^2.30.0         // Date manipulation
- zod: ^3.22.0              // Schema validation
- lodash: ^4.17.21          // Utility functions
```

### Native Modules
```json
- react-native-safe-area-context: ^4.7.0
- react-native-screens: ^3.27.0
- react-native-gesture-handler: ^2.14.0
- react-native-reanimated: ^3.6.0
- expo-device: ^5.4.0
- expo-notifications: ^0.27.0
- expo-status-bar: ^1.11.0
```

### Dev Tools
```json
- typescript: ^5.3.2
- @types/react: ^18.2.0
- @types/react-native: ^0.73.0
- jest: ^29.7.0
- @testing-library/react-native: ^12.3.0
- expo-cli: ^6.3.0
- eas-cli: ^5.9.0
```

## Admin Dashboard (Next.js)

### Core Framework
```json
- next: ^15.0.0
- react: ^18.2.0
- react-dom: ^18.2.0
```

### Styling & UI
```json
- tailwindcss: ^3.3.0
- autoprefixer: ^10.4.16
- postcss: ^8.4.31
- shadcn-ui: ^0.7.0        // Pre-built React components
- lucide-react: ^0.294.0    // Modern icon set
```

### Data & Tables
```json
- @tanstack/react-query: ^5.22.0  // Data fetching
- @tanstack/react-table: ^8.13.0  // Headless table
- recharts: ^2.10.0         // Built-in charts
```

### State & Forms
```json
- zustand: ^4.4.0
- zod: ^3.22.0
```

### Backend Integration
```json
- @supabase/supabase-js: ^2.38.0
- next-auth: ^4.24.0        // Authentication (optional)
```

### Utilities
```json
- axios: ^1.6.0
- date-fns: ^2.30.0
- js-cookie: ^3.0.5         // Cookie management
- papaparse: ^5.4.1         // CSV parsing
```

### UI Components (Radix UI)
```json
- @radix-ui/react-alert-dialog: ^1.0.5
- @radix-ui/react-dropdown-menu: ^2.0.5
- @radix-ui/react-label: ^2.0.2
- @radix-ui/react-popover: ^1.0.7
- @radix-ui/react-select: ^2.0.0
- @radix-ui/react-separator: ^1.0.3
- @radix-ui/react-dialog: ^1.1.1
- @radix-ui/react-tabs: ^1.0.4
- @radix-ui/react-toast: ^1.1.5
```

## Shared Package

### Dependencies
```json
- zod: ^3.22.0              // Validation schemas used by all
```

### Dev Dependencies
```json
- typescript: ^5.3.2
- @types/node: ^20.10.0
```

## Backend (Supabase)

### Database
- **PostgreSQL** 15+ (managed by Supabase)

### Edge Functions Runtime
- **Deno** (TypeScript runtime)

### Edge Function Dependencies
```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.0';
import { createHmac } from 'https://esm.sh/crypto';
```

Note: Deno uses ES modules from esm.sh or npm

## System Requirements

### Development
- **Node.js**: 18.0.0 or higher
- **npm**: 9.0.0 or higher (or yarn/pnpm)
- **Expo CLI**: 6.3.0+
- **EAS CLI**: 5.9.0+

### Runtime
- **iOS**: iOS 13+ (via Expo)
- **Android**: Android 5.0+ (API 21+)
- **Web**: Modern browsers (Chrome, Firefox, Safari, Edge)

## TypeScript Configuration

All packages use strict TypeScript:
```json
{
  "compilerOptions": {
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true
  }
}
```

## Important Versions to Note

| Package | Version | Why |
|---------|---------|-----|
| **Next.js** | 15.0.0 | Latest App Router features |
| **React** | 18.2.0 | Latest hooks & concurrent features |
| **Supabase JS** | 2.38.0 | Latest client library |
| **TypeScript** | 5.3.2 | Latest type features |
| **Expo** | 50.0.0 | Latest EAS compatibility |
| **Tailwind** | 3.3.0 | Latest utility classes |
| **Zustand** | 4.4.0 | Lightweight state management |

## Installation Commands

```bash
# Install all dependencies (from root)
npm install

# Install a specific package in mobile app
cd apps/mobile && npm install <package-name>

# Install a specific package in admin dashboard
cd apps/admin && npm install <package-name>

# Install shared package dependency
cd packages/shared && npm install <package-name>

# Install workspace-wide dev dependency
npm install --save-dev <package-name> --workspace-root
```

## Peer Dependencies to Be Aware Of

```json
// React Native setup typically requires:
- react-native: ^0.73.0
- react: ^18.2.0
- expo: ^50.0.0

// These are auto-linked with Expo
- react-native-gesture-handler
- react-native-reanimated
- react-native-screens
```

## Optional But Recommended

```json
// For enhanced development experience
- react-devtools: For debugging
- supabase-cli: For local Supabase development
- @testing-library/jest-native: For React Native testing

// For Next.js
- next-seo: For SEO optimization
- next-image-export-optimizer: For image optimization
```

## Dependency Security

All dependencies are:
- ✅ Well-maintained (active development)
- ✅ Widely used (3000+ GitHub stars minimum)
- ✅ Secure (regular security audits)
- ✅ Type-safe (TypeScript support)

## Future Upgrade Path

These packages are planned to be upgraeable:
- ✅ Next.js 16+ (when released)
- ✅ React 19+ (when stable)
- ✅ Expo 51+ (new versions)
- ✅ TypeScript 5.4+ (upcoming)

## Lock Files

The project includes:
- `package-lock.json` - Generated by npm (recommended to commit)

Use consistent versioning:
```bash
# Install exact versions from lock file
npm ci --legacy-peer-deps
```

## Git Ignore for Node

The `.gitignore` excludes:
- `node_modules/`
- `.expo/`
- `.next/`
- `dist/`

## Environment Setup Notes

### Node Version Management
```bash
# Using nvm (Node Version Manager)
nvm use 18    # Use Node 18 for this project

# Using nodenv
nodenv local 18.17.0
```

### Package Manager Choice
```bash
# NPM (recommended for this project)
npm install

# Yarn (also works)
yarn install

# PNPM (also works)
pnpm install
```

## Troubleshooting Dependencies

### If installation fails
1. Clear cache: `npm cache clean --force`
2. Delete `node_modules` and lock file
3. Reinstall: `npm install`
4. For Expo issues: `expo doctor`

### Check vulnerabilities
```bash
npm audit                  # Check vulnerabilities
npm audit fix              # Auto-fix if possible
npm audit fix --force      # Force fix (may break things)
```

### Check outdated packages
```bash
npm outdated               # Show outdated packages
npm update                 # Update to compatible versions
```

---

**Note**: All dependencies are production-ready and battle-tested in similar fintech applications.

**Last Updated**: 2024-01-25
**Recommended Node.js**: 18.17.0 or 20.10.0
