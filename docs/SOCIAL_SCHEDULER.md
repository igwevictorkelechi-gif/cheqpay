# Social media scheduler

The admin dashboard's **Social Media** section lets the social team connect the
company's accounts once, then draft, approve and schedule posts to them.

- **Platforms:** Facebook Pages, Instagram (business/creator accounts linked to a
  Page), X, TikTok, LinkedIn company Pages.
- **WhatsApp Status / Channels can't be automated** — WhatsApp has no posting API
  for either. This is about *posting*: messaging users one to one is a different
  product (the WhatsApp Business Cloud API) and is wired up — see
  [WHATSAPP.md](./WHATSAPP.md).
- **Access:** Super Admins, plus sub admins granted **Social media** in Roles &
  Access. A sub admin can't approve their own post; a Super Admin can approve
  anything.
- **Flow:** draft → *Send for approval* → *Approve* → scheduled → published.
  Editing an approved or scheduled post sends it back to draft.

## How it works

| Piece | Where |
|---|---|
| Platform rules (caption limits, media rules) | `apps/api/src/lib/social/rules.ts` |
| One provider per platform (login, refresh, publish) | `apps/api/src/lib/social/providers/` |
| Publisher (claims due work, retries, settles posts) | `apps/api/src/lib/social/publisher.ts` |
| Tables (created at boot, not Prisma models) | `apps/api/src/lib/social/schema.ts` |
| Admin API | `apps/api/src/app/api/admin/social/*` (section `social`) |
| OAuth callback (public) | `apps/api/src/app/api/social/oauth/[provider]/callback` |
| Minute job | `apps/api/src/app/api/cron/social-publish` |
| Dashboard pages | `apps/admin/app/social/*`, `apps/admin/components/social/Composer.tsx` |

- **Tokens** are stored encrypted (`encryptPii`) and never returned to the dashboard.
- **Media** goes into a private Supabase Storage bucket (`SOCIAL_MEDIA_BUCKET`,
  default `social-media`, created on first upload). The browser uploads straight
  to it with a one-time signed URL, so videos never pass through a Vercel function.
  - Images are converted to JPEG (≤4 MB) in the browser, because Instagram only accepts JPEG.
  - Videos: one MP4 per post, ≤50 MB.
- **Publishing** is step by step. Instagram, TikTok, X and LinkedIn process videos
  in the background, so a post can wait between steps. Progress is saved, so a
  retry never uploads twice.
  - Temporary errors are retried after 1, 4, then 15 minutes.
  - An invalid login marks the account **Needs reconnecting**.
  - A post still processing after 2 hours fails.
  - Admins with the Social section get a push notification when a post fails.

## Environment variables (API project)

| Variable | Purpose |
|---|---|
| `API_PUBLIC_URL` | Already set. OAuth callbacks are `${API_PUBLIC_URL}/api/social/oauth/<provider>/callback`. |
| `META_APP_ID`, `META_APP_SECRET` | Facebook + Instagram (one Meta app). |
| `META_GRAPH_VERSION` | Optional, default `v23.0`. |
| `X_CLIENT_ID`, `X_CLIENT_SECRET` | X OAuth 2.0 client (confidential). |
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | TikTok app. |
| `TIKTOK_APP_AUDITED` | `true` once TikTok has audited the app. Until then posts are private ("only me"). |
| `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | LinkedIn app. |
| `LINKEDIN_API_VERSION` | Optional `YYYYMM`; default is three months back. |
| `DB_CRON_SECRET` | ≥32 chars. Lets the database scheduler call the publisher (see below). `SOCIAL_CRON_SECRET` is still accepted. |

A platform only shows a **Connect** button once its keys are set. The Accounts
page shows the exact callback URL to register for each one.

## Platform setup

### Meta (Facebook Pages + Instagram)
1. Create an app at developers.facebook.com (type **Business**) and add **Facebook Login for Business**.
2. Add the redirect URI `${API_PUBLIC_URL}/api/social/oauth/meta/callback`.
3. Request these permissions through App Review:
   - `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`
   - `instagram_basic`, `instagram_content_publish`, `business_management`
4. Complete Business Verification.
5. The Instagram account must be a **business or creator** account linked to the Facebook Page.

### X
1. Create a project and app at developer.x.com, on a plan that allows posting.
2. User authentication settings:
   - OAuth 2.0
   - type **Web App (confidential client)**
   - callback `${API_PUBLIC_URL}/api/social/oauth/x/callback`
3. Scopes used: `tweet.read tweet.write users.read media.write offline.access`.

### TikTok
1. Create an app at developers.tiktok.com.
2. Add **Login Kit** and the **Content Posting API** with **Direct Post**.
3. Redirect URI: `${API_PUBLIC_URL}/api/social/oauth/tiktok/callback`.
4. Scopes: `user.info.basic`, `video.publish`.
5. **Photo posts:** verify the URL prefix `${API_PUBLIC_URL}/api/social/media/` in
   the TikTok portal. TikTok only pulls photos from verified domains, so we serve
   them from our API with signed, expiring links.
6. Submit for **audit**. Until it passes, TikTok accepts private posts only.
   Then set `TIKTOK_APP_AUDITED=true`.

### LinkedIn
1. Create an app at linkedin.com/developers, associated with the CheqPay company Page.
2. Request the **Community Management API**, which provides `r_organization_admin` and `w_organization_social`.
3. Redirect URL: `${API_PUBLIC_URL}/api/social/oauth/linkedin/callback`.
4. Logins last about 60 days. The Accounts page shows when one needs reconnecting.

## The minute scheduler

Vercel Hobby only runs crons once a day, so posts at an exact time are triggered
by the database itself: `pg_cron` calls the publisher every minute through `pg_net`.
The same scheduler also runs auto cash-out retries (see `docs/AUTO_CASHOUT.md`).
The secret lives in Supabase Vault (`db_cron_secret`) and in `DB_CRON_SECRET` on
the API Vercel project. It is never written in the job's text.

**Status:** set up on 5 Nov 2026. The jobs are `social-publish` and `auto-cashout`, each running every minute.

To recreate it (SQL editor):

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- The same value as DB_CRON_SECRET on Vercel.
select vault.create_secret('<the secret>', 'db_cron_secret');

select cron.schedule('social-publish', '* * * * *', $$
  select net.http_post(
    url := 'https://cheqpay-admin453.vercel.app/api/cron/social-publish',
    headers := jsonb_build_object(
      'authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'db_cron_secret'),
      'content-type', 'application/json'),
    timeout_milliseconds := 280000);
$$);
-- auto-cashout: the same, with /api/cron/auto-cashout.
```

- Overlapping runs are safe: each target is claimed with a row lock and a lease, so it's never sent twice.
- Approving a post that's due now also publishes immediately, without waiting for the minute job.
- To stop a job: `select cron.unschedule('social-publish');`
- To see recent runs: `select * from cron.job_run_details order by start_time desc limit 20;`
- To see the HTTP responses: `select id, status_code, left(content::text, 200) from net._http_response order by id desc limit 20;`
