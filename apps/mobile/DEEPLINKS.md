# Pay links & deep links

A CheqPay pay link looks like:

```
https://mycheqpay.com/pay?u=<username>&c=<token>
cheqpay://pay?u=<username>&c=<token>     (the app scheme)
```

Scanning it in CheqPay (Home → scan icon) opens the Send flow with the
recipient pre-filled. Opening it without the app lands on the web pay page
(`apps/web/src/app/pay/page.tsx`), which offers the app and shows the user's
Naira account so anyone can pay from their bank app.

## What already works

- **The `cheqpay://` scheme.** Handled by expo-router — `cheqpay://pay?u=…`
  routes to `app/(app)/pay.tsx`, and the legacy `cheqpay://pay/<username>` to
  `app/(app)/pay/[username].tsx`. Works as soon as the app is installed.
- **In-app scanning.** `app/(app)/scan.tsx` (expo-camera) reads any pay QR.

## What needs real credentials before HTTPS links open the app directly

iOS Universal Links and Android App Links verify ownership of `mycheqpay.com`
against two files the web app serves from `apps/web/public/.well-known/`:

- `apple-app-site-association` — replace `REPLACE_WITH_APPLE_TEAM_ID` with the
  Apple Developer Team ID for `com.cheqpay.app`.
- `assetlinks.json` — replace `REPLACE_WITH_ANDROID_SHA256_CERT_FINGERPRINT`
  with the release signing cert's SHA-256 fingerprint. For an EAS-managed
  keystore: `eas credentials` → Android → the SHA-256 shown there.

`app.json` is already wired (`ios.associatedDomains`, `android.intentFilters`
with `autoVerify`). Until the two files hold the real values, the HTTPS links
open the web pay page in the browser instead of the app — the `cheqpay://`
scheme and in-app scanning are unaffected.

Note: the files must be reachable at `https://mycheqpay.com/.well-known/…`. On
the static-export build they ship as-is from `public/`; on a server that sets
content types strictly, serve `apple-app-site-association` as
`application/json`.
