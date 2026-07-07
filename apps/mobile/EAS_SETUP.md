# Testing CheqPay on a phone with EAS

The repo is wired for **EAS Update** (over-the-air JS) and **EAS Build**
(standalone installable app). The only thing that needs your Expo account is
the one-time `eas init`, which stamps the real project ID into `app.json`.

## One-time setup (needs your free Expo account)

```bash
cd apps/mobile
npx eas-cli login          # sign in / create a free account at expo.dev
npx eas-cli init           # links this app, fills extra.eas.projectId
npx eas-cli update:configure   # fills the updates.url for OTA
```

`init` replaces the `your-eas-project-id` placeholder in `app.json`
(`extra.eas.projectId` and `updates.url`). Commit that change.

## Option 1 — Durable, shareable QR via a preview APK (recommended, Android)

Builds a real installable app on Expo's servers. When it finishes, expo.dev
shows a **QR / install link** anyone can open on an Android phone — no computer,
no Expo Go, and it keeps working.

```bash
npx eas-cli build --platform android --profile preview
```

- iOS equivalent (`--platform ios`) needs an Apple Developer account and either
  registered device UDIDs (ad-hoc) or TestFlight.
- The build already bundles your `.env` (Supabase + live API URL).

## Option 2 — Instant OTA testing in Expo Go / a dev build

Publishes just the JS bundle and prints a QR that opens in Expo Go:

```bash
npx eas-cli update --branch preview --message "test build"
```

Fastest loop for UI changes. Note Expo Go has limits on some native modules
(e.g. push notifications on Android); a preview build (Option 1) is the true
production-like test.

## Channels

`eas.json` maps build profiles to update channels
(`development` / `preview` / `production`), so an `eas update --branch preview`
reaches any `preview` build you've distributed.

## Automatic OTA on every push (CI)

`.github/workflows/eas-update.yml` publishes an `eas update` to the `preview`
channel automatically whenever `apps/mobile/**` changes on `main` or the
feature branch — so testers always get the latest JS without anyone running a
command. To enable it (one time):

1. `cd apps/mobile && npx eas-cli login && npx eas-cli init` (sets the project id).
2. Create an Expo access token: https://expo.dev/settings/access-tokens
3. GitHub repo → Settings → Secrets and variables → Actions → new secret
   `EXPO_TOKEN` = the token.

Until `EXPO_TOKEN` exists the workflow self-skips (no failed runs). It only
pushes the JS bundle — a new native binary (Option 1 build) is still needed
when you change native config or dependencies.
