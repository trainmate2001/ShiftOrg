import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentPeriod } from "@/lib/scheduling/period";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

const LOCKED_MESSAGE = "המנהל נעל את הגשת האילוצים לתקופה זו";

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

async function isPeriodLocked(dateISO: string): Promise<boolean> {
  const periodStart = getCurrentPeriod(dateISO).start;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/constraint_windows?period_start=eq.${periodStart}&select=is_locked`,
    { headers: anonHeaders(), cache: "no-store" }
  );
  if (!res.ok) return false; // table not migrated yet / transient error — fail open, same as before this feature existed
  const rows = (await res.json()) as { is_locked: boolean }[];
  return rows[0]?.is_locked ?? false;
}

// GET /api/employee-constraints
//
// Manager (?from=YYYY-MM-DD&to=YYYY-MM-DD):
//   Returns ALL employees' constraints in the date range using service role key
//   so it bypasses RLS and always returns the full dataset.
//
// Employee (no params):
//   Returns the logged-in employee's own constraints.
export async function GET(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to   = searchParams.get("to");
  const role = user.user_metadata?.role as string | undefined;

  if (role === "manager" && from && to) {
    // Use service role key to bypass RLS — managers can see all constraints
    const key = SERVICE_KEY ?? SUPABASE_KEY;
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/employee_constraints` +
        `?date_iso=gte.${from}&date_iso=lte.${to}` +
        `&select=id,employee_id,date_iso,constraint_type,note,is_special,approved` +
        `&order=date_iso.asc`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Accept: "application/json",
        },
        cache: "no-store",
      }
    );
    const body = await res.text();
    if (!res.ok) return NextResponse.json({ error: `Supabase ${res.status}: ${body}` }, { status: res.status });
    return NextResponse.json(JSON.parse(body));
  }

  // Employee: only their own constraints via anon key (table allows anon reads)
  const employeeId = user.user_metadata?.display_name as string | undefined;
  if (!employeeId) {
    return NextResponse.json({ error: "Profile has no display_name" }, { status: 400 });
  }

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/employee_constraints` +
      `?employee_id=eq.${encodeURIComponent(employeeId)}` +
      `&select=id,date_iso,constraint_type,note,is_special,approved` +
      `&order=date_iso.asc`,
    { headers: anonHeaders(), cache: "no-store" }
  );
  const body = await res.text();
  if (!res.ok) return NextResponse.json({ error: `Supabase ${res.status}: ${body}` }, { status: res.status });
  return NextResponse.json(JSON.parse(body));
}

// POST /api/employee-constraints
// Body: { dateISO, constraintType, note, employeeId? }
// employeeId is normally derived from the session. A manager may pass it
// explicitly to add a constraint on another employee's behalf — the only case
// where that's accepted. Employees are blocked once the period is locked;
// managers always bypass the lock.
export async function POST(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const role = user.user_metadata?.role as string | undefined;
  const { dateISO, constraintType, note, isSpecial, employeeId: bodyEmployeeId } = await request.json();

  let employeeId: string | undefined;
  if (bodyEmployeeId !== undefined && bodyEmployeeId !== null) {
    if (role !== "manager") {
      return NextResponse.json({ error: "Forbidden — only a manager can set employeeId" }, { status: 403 });
    }
    employeeId = bodyEmployeeId;
  } else {
    employeeId = user.user_metadata?.display_name as string | undefined;
  }
  if (!employeeId) {
    return NextResponse.json({ error: "Profile has no display_name" }, { status: 400 });
  }

  if (role !== "manager" && (await isPeriodLocked(dateISO))) {
    return NextResponse.json({ error: LOCKED_MESSAGE }, { status: 403 });
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/employee_constraints`, {
    method: "POST",
    headers: anonHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({
      employee_id:     employeeId,
      employee_name:   employeeId,
      date_iso:        dateISO,
      constraint_type: constraintType,
      note:            note ?? "",
      is_special:      !!isSpecial,
      // Managers add constraints already-approved; employee-submitted specials wait for approval.
      approved:        isSpecial ? role === "manager" : true,
    }),
  });

  const body = await res.text();
  if (!res.ok) return NextResponse.json({ error: `Supabase ${res.status}: ${body}` }, { status: res.status });
  return NextResponse.json(JSON.parse(body));
}

// DELETE /api/employee-constraints?id=xxx
// A manager may delete any employee's constraint, any time. An employee may
// only delete their own, and only while the period isn't locked.
export async function DELETE(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const role = user.user_metadata?.role as string | undefined;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const checkRes = await fetch(
    `${SUPABASE_URL}/rest/v1/employee_constraints?id=eq.${encodeURIComponent(id)}&select=employee_id,date_iso`,
    { headers: anonHeaders(), cache: "no-store" }
  );
  if (!checkRes.ok) return NextResponse.json({ error: "Failed to verify ownership" }, { status: 500 });
  const rows = (await checkRes.json()) as { employee_id: string; date_iso: string }[];
  if (rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const row = rows[0];

  if (role !== "manager") {
    const employeeId = user.user_metadata?.display_name as string | undefined;
    if (!employeeId) return NextResponse.json({ error: "Profile has no display_name" }, { status: 400 });
    if (row.employee_id !== employeeId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (await isPeriodLocked(row.date_iso)) {
      return NextResponse.json({ error: LOCKED_MESSAGE }, { status: 403 });
    }
  }

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/employee_constraints?id=eq.${encodeURIComponent(id)}`,
    { method: "DELETE", headers: anonHeaders() }
  );

  if (!res.ok) {
    const body = await res.text();
    return NextResponse.json({ error: `Supabase ${res.status}: ${body}` }, { status: res.status });
  }
  return new NextResponse(null, { status: 204 });
}

// PATCH /api/employee-constraints
// Body: { id, approved }
// Manager-only — approves (or revokes approval of) a special constraint so it
// takes effect in schedule generation.
export async function PATCH(request: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (user.user_metadata?.role !== "manager") {
    return NextResponse.json({ error: "Forbidden — only a manager can approve constraints" }, { status: 403 });
  }

  const { id, approved } = await request.json();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/employee_constraints?id=eq.${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: anonHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify({ approved: !!approved }),
    }
  );

  const body = await res.text();
  if (!res.ok) return NextResponse.json({ error: `Supabase ${res.status}: ${body}` }, { status: res.status });
  return NextResponse.json(JSON.parse(body));
}
