# Hosting the CheqPay web app on WhoGoHost (or any cPanel host)

The web app can be built as a folder of plain files and served by ordinary web
hosting. **No PHP, no Node, no database on the web host.** Every page is
pre-rendered HTML that runs in the browser and calls the CheqPay API over
HTTPS, so the host only ever hands out files.

That means the cheapest shared hosting plan is enough. You do **not** need the
VPS for this — the VPS is for the API, which is a separate thing and still needs
its static IP for Maplerad.

---

## Build

```bash
cd apps/web
STATIC_EXPORT=1 \
NEXT_PUBLIC_API_URL=https://api.cheqpay.com \
NEXT_PUBLIC_SUPABASE_URL=https://xttgnswgeffyybjfjlkp.supabase.co \
NEXT_PUBLIC_SUPABASE_ANON_KEY=<the anon key> \
bun run build:static
```

Output lands in `apps/web/out/` — about 7.5 MB across ~230 files.

**The env vars are baked in at build time.** They are compiled into the
JavaScript, not read at runtime, so a build with the wrong `NEXT_PUBLIC_API_URL`
produces files that call the wrong API and there is no way to fix that on the
server. Rebuild instead.

Only the anon key belongs here. It is designed to be public and is protected by
Supabase row-level security. **Never** put the service-role key in this build —
it would be readable by anyone who opens the browser console.

## Upload

Everything inside `out/` goes into `public_html`. The **contents**, not the
folder itself: `public_html/index.html`, not `public_html/out/index.html`.

Either way works:

- **cPanel → File Manager.** Zip `out/`, upload, extract into `public_html`,
  then move the files up one level if the zip created a folder.
- **FTP / SFTP.** Point the client at `public_html` and upload the contents.

Two things people get wrong:

1. **`.htaccess` is a hidden file.** Most FTP clients and File Manager hide it by
   default and will silently skip it. Turn on "show hidden files" and confirm it
   arrived — without it you lose the HTTPS redirect and the caching rules.
2. **Delete the old files before uploading a new build.** Filenames are content
   hashed, so stale bundles accumulate rather than being overwritten.

## HTTPS

In cPanel, enable **AutoSSL** (Let's Encrypt) for the domain. This is not
optional: the Supabase session token lives in the browser and would be readable
in transit over plain HTTP. `.htaccess` already forces HTTPS, but the redirect
is useless without a certificate to redirect to.

## Point the domain

An `A` record for `cheqpay.com` (and `www`) at the hosting IP, which cPanel shows
on its main page. If the API is on a different box, give it its own subdomain —
`api.cheqpay.com` — rather than trying to share one host.

## Check it worked

1. `https://cheqpay.com` loads. Signed out, it redirects to `/welcome/` — the
   public landing page. Signed in, it goes straight to the wallet.
2. `https://cheqpay.com/welcome/` and `https://cheqpay.com/login/` load
   directly — not a 404. This is what proves the directory structure survived
   the upload.
3. `http://cheqpay.com` redirects to `https://`.
4. Sign in. If the code never arrives, the build has the wrong
   `NEXT_PUBLIC_SUPABASE_URL` or anon key.
5. Open the browser console. `Failed to fetch` against the API means either the
   wrong `NEXT_PUBLIC_API_URL` or the API's `ALLOWED_ORIGINS` does not include
   `https://cheqpay.com`.

That last one catches people out: **the API must allow this origin.** Set
`ALLOWED_ORIGINS=https://cheqpay.com` on the API and redeploy it.

---

## Notes

**Two build modes, one codebase.** Without `STATIC_EXPORT=1` the normal Next
build runs, which is what Vercel deploys. Nothing about the existing deployment
changes; the static export is opt-in, so you can run both while you decide.

**Updating the site** means rebuilding and re-uploading. There is no git push to
deploy here — that convenience is what you trade away for cPanel hosting. If it
becomes tedious, a GitHub Action can FTP the folder on each push to `main`.

**Routes are folders.** The export is built with `trailingSlash`, so `/login`
becomes `/login/index.html`. Apache serves that from a directory URL with no
rewrite rules, which is why the `.htaccess` is short.

**One route changed shape for this.** Transaction detail used to be
`/transaction/<uuid>`; a static build must know every path in advance and
transaction ids are created at runtime, so it is now `/transaction?id=<uuid>`.
Same page, same behaviour.

**Serving from the VPS instead.** If you are already running the API on a
WhoGoHost VPS, Caddy can serve these files too — one box, one bill. Add to the
Caddyfile:

```
cheqpay.com {
	root * /var/www/cheqpay
	file_server
	try_files {path} {path}/ /404.html
	encode gzip zstd
}
```

Then `scp -r out/* deploy@<host>:/var/www/cheqpay/`. Caddy handles the
certificate automatically, and `.htaccess` is ignored (it is Apache-only).
