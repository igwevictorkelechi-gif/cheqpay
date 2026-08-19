/**
 * Invoke a /api/cron/* endpoint over HTTP.
 *
 * On Vercel the scheduler called these routes directly (see the `crons` block
 * in vercel.json). Render's scheduler runs a *command* in a container instead,
 * so this script is that command: it calls the running web service the same way
 * Vercel Cron did, including the `Authorization: Bearer <CRON_SECRET>` header
 * the route checks.
 *
 * Deliberately an HTTP call rather than importing the handler: the cron
 * container is a throwaway instance with no warm Prisma pool, and going through
 * the live service keeps exactly one code path for the job.
 *
 * Usage: bun scripts/trigger-cron.ts /api/cron/price-alerts
 */

async function main(): Promise<number> {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: bun scripts/trigger-cron.ts <path>");
    return 2;
  }

  const base = process.env.API_PUBLIC_URL?.replace(/\/+$/, "");
  if (!base) {
    console.error("API_PUBLIC_URL is not set; cannot reach the API.");
    return 2;
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // The route only enforces auth when CRON_SECRET is set on the API. Refusing
    // here surfaces the misconfiguration instead of silently running unauthed.
    console.error("CRON_SECRET is not set; refusing to call the cron endpoint.");
    return 2;
  }

  const url = `${base}${path}`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${secret}` },
    // Price alerts fan out push notifications; give it room before giving up.
    signal: AbortSignal.timeout(120_000),
  });

  console.log(`${res.status} ${url}\n${await res.text()}`);

  // A non-2xx must fail the run so Render reports it instead of showing green.
  return res.ok ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
