// Single source of truth for the backend API origin the dashboard proxies to.
//
// Every route under app/api/* is a server-side proxy: it forwards to the
// custodial backend with the admin secret attached, so the secret never
// reaches the browser. They all need the same origin, and when the backend
// moves host (Vercel -> Render, for the Maplerad static-IP requirement) there
// must be exactly one place to change.
//
// Set CHEQPAY_API_URL on the admin Vercel project. The fallback is the old
// Vercel API deployment: it keeps preview builds working without extra config,
// but it is NOT the production source of truth — production must set the env
// var explicitly. See apps/api/RENDER.md.
export const API_URL = (
  process.env.CHEQPAY_API_URL ?? "https://cheqpay-admin453.vercel.app"
).replace(/\/+$/, ""); // tolerate a trailing slash in the env var
