-- ============================================================
-- Single "open" scheduling period — what employees currently see/submit to.
-- Singleton table (id pinned to 1). No row yet = not opened; the API falls
-- back to today's natural 21->20 period in that case.
-- Apply via: Supabase Dashboard → SQL Editor → Run
-- ============================================================

create table public.active_period (
  id           smallint primary key default 1 check (id = 1),
  period_start date not null,
  opened_at    timestamptz not null default now(),
  opened_by    text
);

alter table public.active_period enable row level security;

drop policy if exists "anon_all_active_period" on public.active_period;
create policy "anon_all_active_period"
  on public.active_period
  for all
  to anon, authenticated
  using (true)
  with check (true);
