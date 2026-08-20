-- ============================================================
-- Special constraints: employee-submitted requests that do NOT count
-- against the per-period MAX_CONSTRAINTS (10) limit, and only take effect
-- in schedule generation once a manager approves them.
-- Apply via: Supabase Dashboard → SQL Editor → Run
-- ============================================================

alter table public.employee_constraints
  add column if not exists is_special boolean not null default false,
  add column if not exists approved   boolean not null default true;

-- Existing rows are plain constraints — already approved, not special. Nothing to backfill.
