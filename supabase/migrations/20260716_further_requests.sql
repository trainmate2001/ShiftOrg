-- ============================================================
-- "Further requests" free-text field per employee per scheduling period
-- Apply via: Supabase Dashboard → SQL Editor → Run
-- ============================================================

create table public.further_requests (
  id           uuid primary key default gen_random_uuid(),
  employee_id  text not null,          -- same value as employee_constraints.employee_id (display name)
  period_start date not null,          -- the 21st that starts the scheduling period
  note         text not null default '',
  updated_at   timestamptz not null default now(),

  constraint uq_further_request unique (employee_id, period_start)
);

create index idx_further_requests_period on public.further_requests (period_start);

alter table public.further_requests enable row level security;

-- Mirrors the permissive policy style already relied on for employee_constraints /
-- saved_schedule_entries — this app enforces authorization at the API route level,
-- not via RLS, and those tables are queried with the anon key from server routes.
drop policy if exists "anon_all_further_requests" on public.further_requests;
create policy "anon_all_further_requests"
  on public.further_requests
  for all
  to anon, authenticated
  using (true)
  with check (true);
