-- ============================================================
-- Fills a gap from the original project: employee_constraints and
-- saved_schedule_entries are tables the app actually queries, but they were
-- only ever created ad-hoc in the old Supabase project, never captured in a
-- migration. Needed on any fresh project.
-- Apply via: Supabase Dashboard → SQL Editor → Run
-- ============================================================

-- ── employee_constraints ────────────────────────────────────────────────────
-- Employee availability constraints. employee_id/employee_name are the
-- display-name string (not a UUID) — see app/api/employee-constraints/route.ts.
create table public.employee_constraints (
  id              uuid primary key default gen_random_uuid(),
  employee_id     text not null,
  employee_name   text not null,
  date_iso        date not null,
  constraint_type text not null,
  note            text not null default '',
  created_at      timestamptz not null default now()
);

create index idx_employee_constraints_date     on public.employee_constraints (date_iso);
create index idx_employee_constraints_employee on public.employee_constraints (employee_id);

alter table public.employee_constraints enable row level security;

drop policy if exists "anon_all_employee_constraints" on public.employee_constraints;
create policy "anon_all_employee_constraints"
  on public.employee_constraints
  for all
  to anon, authenticated
  using (true)
  with check (true);

-- ── saved_schedule_entries ──────────────────────────────────────────────────
-- Manager-built schedule assignments, saved per date/period.
create table public.saved_schedule_entries (
  id                 uuid primary key default gen_random_uuid(),
  date               date not null,
  period             text not null check (period in ('morning', 'evening')),
  employee_id        text not null,
  shift_template_id  text not null,
  week_start         date not null,
  created_at         timestamptz not null default now()
);

create index idx_saved_schedule_entries_date       on public.saved_schedule_entries (date);
create index idx_saved_schedule_entries_week_start on public.saved_schedule_entries (week_start);

alter table public.saved_schedule_entries enable row level security;

drop policy if exists "anon_all_saved_schedule_entries" on public.saved_schedule_entries;
create policy "anon_all_saved_schedule_entries"
  on public.saved_schedule_entries
  for all
  to anon, authenticated
  using (true)
  with check (true);
