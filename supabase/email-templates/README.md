# CheqPay branded auth emails

Branded, self-contained HTML templates for Supabase Auth emails. Each file is a
complete email (table layout + inline styles) so it renders consistently across
mail clients (Gmail, Apple Mail, Outlook).

| File | Supabase template | Key variable |
|------|-------------------|--------------|
| `confirm-signup.html` | **Confirm signup** | `{{ .Token }}` (6-digit code) |
| `magic-link.html` | **Magic Link** | `{{ .Token }}` (6-digit code) |
| `reset-password.html` | **Reset Password** | `{{ .ConfirmationURL }}` |
| `change-email.html` | **Change Email Address** | `{{ .Token }}`, `{{ .Email }}` |
| `reauthentication.html` | **Reauthentication** | `{{ .Token }}` |
| `invite.html` | **Invite user** | `{{ .ConfirmationURL }}` |

## How the app uses these

The web + mobile apps sign users in with **email OTP** (`signInWithOtp` /
`verifyOtp`). Supabase sends:

- the **Confirm signup** email for brand-new users (`shouldCreateUser: true`), and
- the **Magic Link** email for returning users.

Both templates show `{{ .Token }}` — the 6-digit code the user types into the
verify screen. (The magic-link URL still works too, but the app is code-based.)

## Install (Supabase Dashboard)

1. Go to **Authentication → Emails → Templates**.
2. For each row above, open the matching template, switch the editor to **HTML**,
   and paste the contents of the file.
3. Set a friendly **Subject**, e.g.
   - Confirm signup: `Verify your CheqPay email`
   - Magic Link: `Your CheqPay sign-in code`
   - Reset Password: `Reset your CheqPay password`
   - Change Email: `Confirm your new CheqPay email`
   - Reauthentication: `Confirm it’s you`
   - Invite: `You’re invited to CheqPay`
4. Save.

## Required auth settings

Under **Authentication → Providers → Email** (and **Sign In / Providers**):

- **Enable Email provider** and **Email OTP** (Confirm email on).
- **Enable email signups** (so `shouldCreateUser: true` can create accounts).
- OTP **expiry**: 3600s (matches the "expires in 60 minutes" copy).
- Set **Site URL** and any **Redirect URLs** to the deployed web app so the
  magic-link fallback resolves correctly.

## Editing

`_base-preview.html` documents the shared design tokens (brand `#6B5B95`, gold
accent `#F5C97B`). It is a reference only — Supabase templates can't share
partials, so apply any styling change to every file to keep them in sync.
