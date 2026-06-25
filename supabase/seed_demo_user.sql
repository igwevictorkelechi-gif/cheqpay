-- Seed the Cheqpay demo account (real backend).
--
-- Prerequisite: create the auth user first in the Supabase dashboard
--   Authentication → Users → Add user
--     Email:    demo@cheqpay.app
--     Password: (your choice, e.g. Cheqpay123!)
--     ✅ Auto Confirm User
-- Then run this whole script in the SQL Editor.

-- 1) Profile row (links to the auth user by email)
insert into public.users (id, phone, email, full_name, kyc_status, referral_code, is_active)
select id, '+2348100000000', 'demo@cheqpay.app', 'Victor Igwe', 'approved', 'CHEQ-DEMO', true
from auth.users where email = 'demo@cheqpay.app'
on conflict (id) do update
  set full_name = excluded.full_name,
      kyc_status = excluded.kyc_status;

-- 2) Wallet
insert into public.wallets (user_id, balance, ledger_balance)
select id, 152340.50, 152340.50 from auth.users where email = 'demo@cheqpay.app'
on conflict (user_id) do update
  set balance = excluded.balance,
      ledger_balance = excluded.ledger_balance;

-- 3) Static virtual account
insert into public.virtual_accounts (user_id, provider, account_number, bank_name, bank_code, reference, is_active)
select id, 'flutterwave', '7002349836', 'Wema Bank', '035', 'cheqpay-demo-va', true
from auth.users where email = 'demo@cheqpay.app'
on conflict (user_id) do nothing;

-- 4) Sample transactions
insert into public.transactions (user_id, type, amount, reference, narration, status)
select u.id, t.type, t.amount, t.reference, t.narration, t.status
from auth.users u
cross join (values
  ('debit'::varchar,      60521.30::numeric, 'TRF-2026-0455', 'Transfer to Victor Igwe', 'completed'::varchar),
  ('credit',              200000,            'DEP-2026-0454', 'Bank transfer deposit',   'completed'),
  ('airtime',             1000,              'AIR-2026-0453', 'MTN airtime top-up',      'completed'),
  ('withdrawal',          25000,             'WTH-2026-0452', 'Withdrawal to GTBank',    'pending')
) as t(type, amount, reference, narration, status)
where u.email = 'demo@cheqpay.app'
on conflict (reference) do nothing;

-- 5) Row Level Security: let a signed-in user read their own rows
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='users' and policyname='own_user_select') then
    create policy own_user_select on public.users for select using (auth.uid() = id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='wallets' and policyname='own_wallet_select') then
    create policy own_wallet_select on public.wallets for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='virtual_accounts' and policyname='own_va_select') then
    create policy own_va_select on public.virtual_accounts for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='transactions' and policyname='own_tx_select') then
    create policy own_tx_select on public.transactions for select using (auth.uid() = user_id);
  end if;
end $$;
