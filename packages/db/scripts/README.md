# DB scripts

## NGN ledger backfill

Migrates legacy Supabase NGN balances (`wallets.balance`, decimal naira) into
the unified minor-unit ledger (`balances`, integer kobo) and mirrors `users`
into `app_users`. Makes the new ledger the single source of truth for NGN.

### Run order
```bash
# 0. Point at the DIRECT (non-pooled) connection
export DATABASE_URL="postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres"

# 1. Ensure the new tables/enums exist
cd packages/db && bunx prisma migrate deploy

# 2. SNAPSHOT the database first (Supabase -> Database -> Backups)

# 3. Run the backfill (transactional; aborts if NGN totals don't reconcile)
psql "$DATABASE_URL" -f scripts/backfill_ngn_ledger.sql
```

The script prints `Legacy NGN total` vs `New ledger NGN total` and **aborts the
transaction if they don't match**, so a bad run leaves no partial state.

### Rollback
Only safe immediately after the backfill, before any live ledger writes:
```bash
psql "$DATABASE_URL" -f scripts/rollback_ngn_ledger.sql
```
If real activity has occurred since, restore from the snapshot instead.

### After backfill — cutover (separate, deliberate step)
The legacy `wallets` table is left intact so the current consumer apps keep
working. The remaining cutover is to point the web/mobile apps at the new
balances (via `GET /api/balances`) and then retire the legacy NGN column. Do
this once you've verified the backfill in production.
