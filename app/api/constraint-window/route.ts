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

// GET /api/constraint-window?periodStart=YYYY-MM-DD
// Any authenticated user. A period with no row is open (not locked).
export async function GET(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const periodStart = searchParams.get("periodStart");
  if (!periodStart) return NextResponse.json({ error: "Missing periodStart" }, { status: 400 });

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/constraint_windows?period_start=eq.${periodStart}&select=period_start,is_locked,locked_at,locked_by`,
    { headers: anonHeaders(), cache: "no-store" }
  );
  const body = await res.text();
  if (!res.ok) return NextResponse.json({ error: `Supabase ${res.status}: ${body}` }, { status: res.status });
  const rows = JSON.parse(body) as { is_locked: boolean; locked_at: string | null; locked_by: string | null }[];
  return NextResponse.json(rows[0] ?? { is_locked: false, locked_at: null, locked_by: null });
}

// PATCH /api/constraint-window
// Body: { periodStart, isLocked }
// Manager-only. Upserts the lock state for the given period.
export async function PATCH(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (user.user_metadata?.role !== "manager") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { periodStart, isLocked } = (await request.json()) as { periodStart?: string; isLocked?: boolean };
  if (!periodStart || typeof isLocked !== "boolean") {
    return NextResponse.json({ error: "Missing periodStart or isLocked" }, { status: 400 });
  }

  const managerName = (user.user_metadata?.display_name as string | undefined) ?? user.email ?? "";
  const key = SERVICE_KEY ?? SUPABASE_KEY;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/constraint_windows?on_conflict=period_start`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify({
      period_start: periodStart,
      is_locked:    isLocked,
      locked_at:    isLocked ? new Date().toISOString() : null,
      locked_by:    isLocked ? managerName : null,
    }),
  });

  const body = await res.text();
  if (!res.ok) return NextResponse.json({ error: `Supabase ${res.status}: ${body}` }, { status: res.status });
  return NextResponse.json(JSON.parse(body));
}
