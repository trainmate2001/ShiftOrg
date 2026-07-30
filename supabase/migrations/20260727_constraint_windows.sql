-- ============================================================
-- Manager-controlled open/lock switch for constraint submission,
-- keyed per scheduling period (21st of one month -> 20th of next).
-- Apply via: Supabase Dashboard → SQL Editor → Run
-- ============================================================

create table public.constraint_windows (
  period_start date primary key,
  is_locked    boolean not null default false,
  locked_at    timestamptz,
  locked_by    text
);

alter table public.constraint_windows enable row level security;

-- Mirrors the permissive policy style already used for employee_constraints /
-- further_requests — this app enforces authorization at the API route level,
-- not via RLS.
drop policy if exists "anon_all_constraint_windows" on public.constraint_windows;
create policy "anon_all_constraint_windows"
  on public.constraint_windows
  for all
  to anon, authenticated
  using (true)
  with check (true);
