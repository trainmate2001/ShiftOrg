import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

function anonHeaders(extra?: Record<string, string>) {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    ...extra,
  };
}

async function getUser() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

async function isPeriodLocked(periodStart: string): Promise<boolean> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/constraint_windows?period_start=eq.${periodStart}&select=is_locked`,
    { headers: anonHeaders(), cache: "no-store" }
  );
  if (!res.ok) return false; // table not migrated yet / transient error — fail open
  const rows = (await res.json()) as { is_locked: boolean }[];
  return rows[0]?.is_locked ?? false;
}

// GET /api/further-requests
//
// Manager (?from=YYYY-MM-DD&to=YYYY-MM-DD):
//   Returns ALL employees' further-request notes whose period_start falls in range.
// Employee (no params):
//   Returns the logged-in employee's own note for ?periodStart=YYYY-MM-DD.
export async function GET(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to   = searchParams.get("to");
  const role = user.user_metadata?.role as string | undefined;

  if (role === "manager" && from && to) {
    const key = SERVICE_KEY ?? SUPABASE_KEY;
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/further_requests` +
        `?period_start=gte.${from}&period_start=lte.${to}` +
        `&select=id,employee_id,period_start,note,updated_at` +
        `&order=employee_id.asc`,
      { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" }, cache: "no-store" }
    );
    const body = await res.text();
    if (!res.ok) return NextResponse.json({ error: `Supabase ${res.status}: ${body}` }, { status: res.status });
    return NextResponse.json(JSON.parse(body));
  }

  const employeeId = user.user_metadata?.display_name as string | undefined;
  if (!employeeId) {
    return NextResponse.json({ error: "Profile has no display_name" }, { status: 400 });
  }

  const periodStart = searchParams.get("periodStart");
  if (!periodStart) return NextResponse.json({ error: "Missing periodStart" }, { status: 400 });

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/further_requests` +
      `?employee_id=eq.${encodeURIComponent(employeeId)}&period_start=eq.${periodStart}` +
      `&select=id,note,updated_at`,
    { headers: anonHeaders(), cache: "no-store" }
  );
  const body = await res.text();
  if (!res.ok) return NextResponse.json({ error: `Supabase ${res.status}: ${body}` }, { status: res.status });
  const rows = JSON.parse(body) as { id: string; note: string; updated_at: string }[];
  return NextResponse.json(rows[0] ?? { note: "" });
}

// POST /api/further-requests
// Body: { periodStart, note }
// Upserts the logged-in employee's note for that period. employeeId is derived
// from the session — never accepted from the body.
export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const employeeId = user.user_metadata?.display_name as string | undefined;
  if (!employeeId) {
    return NextResponse.json({ error: "Profile has no display_name" }, { status: 400 });
  }

  const { periodStart, note } = (await request.json()) as { periodStart?: string; note?: string };
  if (!periodStart) return NextResponse.json({ error: "Missing periodStart" }, { status: 400 });

  const role = user.user_metadata?.role as string | undefined;
  if (role !== "manager" && (await isPeriodLocked(periodStart))) {
    return NextResponse.json({ error: "המנהל נעל את הגשת האילוצים לתקופה זו" }, { status: 403 });
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/further_requests?on_conflict=employee_id,period_start`, {
    method: "POST",
    headers: anonHeaders({ Prefer: "resolution=merge-duplicates,return=representation" }),
    body: JSON.stringify({
      employee_id:  employeeId,
      period_start: periodStart,
      note:         note ?? "",
      updated_at:   new Date().toISOString(),
    }),
  });

  const body = await res.text();
  if (!res.ok) return NextResponse.json({ error: `Supabase ${res.status}: ${body}` }, { status: res.status });
  return NextResponse.json(JSON.parse(body));
}
