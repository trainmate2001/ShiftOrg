import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentPeriod } from "@/lib/scheduling/period";

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

// GET /api/active-period
// Any authenticated user. Returns the period the manager has explicitly opened
// for employees. If none has ever been opened, falls back to today's natural
// 21->20 period so the system works before a manager sets anything.
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/active_period?id=eq.1&select=period_start`,
    { headers: anonHeaders(), cache: "no-store" }
  );
  if (res.ok) {
    const rows = (await res.json()) as { period_start: string }[];
    if (rows.length > 0) return NextResponse.json({ periodStart: rows[0].period_start });
  }

  return NextResponse.json({ periodStart: getCurrentPeriod().start });
}

// PATCH /api/active-period
// Body: { periodStart }
// Manager-only. Opens the given period for employees (upserts the singleton row).
export async function PATCH(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (user.user_metadata?.role !== "manager") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { periodStart } = (await request.json()) as { periodStart?: string };
  if (!periodStart) return NextResponse.json({ error: "Missing periodStart" }, { status: 400 });

  const managerName = (user.user_metadata?.display_name as string | undefined) ?? user.email ?? "";
  const key = SERVICE_KEY ?? SUPABASE_KEY;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/active_period?on_conflict=id`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify({
      id:           1,
      period_start: periodStart,
      opened_at:    new Date().toISOString(),
      opened_by:    managerName,
    }),
  });

  const body = await res.text();
  if (!res.ok) return NextResponse.json({ error: `Supabase ${res.status}: ${body}` }, { status: res.status });
  return NextResponse.json(JSON.parse(body));
}
