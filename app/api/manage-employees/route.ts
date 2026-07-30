import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPER_MANAGER_EMAIL = process.env.NEXT_PUBLIC_SUPER_MANAGER_EMAIL ?? "";

function adminHeaders(extra?: Record<string, string>) {
  return {
    apikey: SERVICE_KEY!,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    ...extra,
  };
}

function randomEmail(): string {
  const token = Math.random().toString(36).slice(2, 10);
  return `user-${token}@shifts.internal`;
}

async function getAuthUser(id: string): Promise<{ email?: string; user_metadata?: Record<string, unknown> } | null> {
  if (!SERVICE_KEY) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
    headers: adminHeaders(),
    cache: "no-store",
  });
  if (!res.ok) return null;
  return res.json();
}

async function isSuperManager(id: string): Promise<boolean> {
  if (!SUPER_MANAGER_EMAIL || !SERVICE_KEY) return false;
  const authUser = await getAuthUser(id);
  return authUser?.email?.toLowerCase() === SUPER_MANAGER_EMAIL.toLowerCase();
}

// Renames the employee's identity everywhere it's used as a text key: the auth
// session (so future logins/JWTs carry the new name), and the two scheduling
// tables that store the display name as a foreign key (not a UUID).
async function cascadeRename(id: string, oldName: string, newName: string) {
  if (!SERVICE_KEY) return;

  const authUser = await getAuthUser(id);
  if (authUser) {
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
      method: "PUT",
      headers: adminHeaders(),
      body: JSON.stringify({
        user_metadata: {
          ...(authUser.user_metadata ?? {}),
          display_name: newName,
          full_name: newName,
        },
      }),
    });
  }

  await fetch(
    `${SUPABASE_URL}/rest/v1/employee_constraints?employee_id=eq.${encodeURIComponent(oldName)}`,
    { method: "PATCH", headers: adminHeaders(), body: JSON.stringify({ employee_id: newName, employee_name: newName }) }
  );
  await fetch(
    `${SUPABASE_URL}/rest/v1/saved_schedule_entries?employee_id=eq.${encodeURIComponent(oldName)}`,
    { method: "PATCH", headers: adminHeaders(), body: JSON.stringify({ employee_id: newName }) }
  );
  await fetch(
    `${SUPABASE_URL}/rest/v1/further_requests?employee_id=eq.${encodeURIComponent(oldName)}`,
    { method: "PATCH", headers: adminHeaders(), body: JSON.stringify({ employee_id: newName }) }
  );
}

async function requireManager() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) } as const;
  if (user.user_metadata?.role !== "manager") return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) } as const;
  return { user, supabase } as const;
}

export async function GET() {
  const auth = await requireManager();
  if ("error" in auth) return auth.error;

  const { data, error } = await auth.supabase
    .from("users")
    .select("id, name, role, is_active")
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function PATCH(request: Request) {
  const auth = await requireManager();
  if ("error" in auth) return auth.error;
  const { user, supabase } = auth;

  const body = (await request.json()) as {
    id: string; is_active?: boolean; role?: string; name?: string; newPassword?: string;
  };
  const { id, is_active, role, name, newPassword } = body;

  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  if (is_active === undefined && role === undefined && name === undefined && newPassword === undefined) {
    return NextResponse.json({ error: "Must provide is_active, role, name, or newPassword" }, { status: 400 });
  }
  if (name !== undefined && name.trim().length === 0) {
    return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
  }
  if (newPassword !== undefined && newPassword.length < 6) {
    return NextResponse.json({ error: "הסיסמה חייבת להכיל לפחות 6 תווים" }, { status: 400 });
  }

  if (role !== undefined && id === user.id) {
    return NextResponse.json({ error: "Cannot change your own role" }, { status: 403 });
  }

  if (await isSuperManager(id)) {
    return NextResponse.json({ error: "לא ניתן לשנות הרשאות מנהל ראשי" }, { status: 403 });
  }

  let oldName: string | null = null;
  if (name !== undefined) {
    const trimmed = name.trim();
    const { data: existing } = await supabase.from("users").select("id, name").eq("name", trimmed);
    if (existing && existing.some((u) => u.id !== id)) {
      return NextResponse.json({ error: "כבר קיים עובד בשם הזה" }, { status: 409 });
    }
    const { data: current } = await supabase.from("users").select("name").eq("id", id).single();
    oldName = current?.name ?? null;
  }

  const updateFields: Record<string, unknown> = {};
  if (is_active !== undefined) updateFields.is_active = is_active;
  if (role !== undefined) updateFields.role = role;
  if (name !== undefined) updateFields.name = name.trim();

  if (Object.keys(updateFields).length > 0) {
    if (!SERVICE_KEY) return NextResponse.json({ error: "השרת אינו מוגדר לעדכון עובדים" }, { status: 500 });
    // Use the service role key rather than the manager's own RLS-scoped session client:
    // public.users' UPDATE policy may not be present on every deployment, in which case
    // a session-scoped update silently affects 0 rows (PostgREST returns 200, no error).
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/users?id=eq.${id}`,
      { method: "PATCH", headers: adminHeaders({ Prefer: "return=representation" }), body: JSON.stringify(updateFields) }
    );
    const resBody = await res.text();
    if (!res.ok) return NextResponse.json({ error: `Supabase ${res.status}: ${resBody}` }, { status: res.status });
    if (JSON.parse(resBody).length === 0) {
      return NextResponse.json({ error: "העדכון לא בוצע — המשתמש לא נמצא" }, { status: 404 });
    }
  }

  if (name !== undefined && oldName && oldName !== name.trim()) {
    await cascadeRename(id, oldName, name.trim());
  }

  if (newPassword !== undefined) {
    if (!SERVICE_KEY) return NextResponse.json({ error: "השרת אינו מוגדר לאיפוס סיסמה" }, { status: 500 });
    const pwRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
      method: "PUT",
      headers: adminHeaders(),
      body: JSON.stringify({ password: newPassword }),
    });
    if (!pwRes.ok) {
      const errBody = await pwRes.text();
      return NextResponse.json({ error: `שגיאה באיפוס סיסמה: ${errBody}` }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}

// POST /api/manage-employees
// Manager-only. Creates a new premade account (worker or admin) with a synthetic
// internal email and a manager-supplied password — no real email involved.
export async function POST(request: Request) {
  const auth = await requireManager();
  if ("error" in auth) return auth.error;
  const { supabase } = auth;

  if (!SERVICE_KEY) return NextResponse.json({ error: "השרת אינו מוגדר להוספת עובדים" }, { status: 500 });

  const body = (await request.json()) as { displayName?: string; role?: string; password?: string };
  const displayName = body.displayName?.trim();
  const role = body.role === "manager" ? "manager" : "employee";
  const password = body.password;

  if (!displayName) return NextResponse.json({ error: "יש להזין שם" }, { status: 400 });
  if (!password || password.length < 6) {
    return NextResponse.json({ error: "הסיסמה חייבת להכיל לפחות 6 תווים" }, { status: 400 });
  }

  const { data: existing } = await supabase.from("users").select("id").eq("name", displayName);
  if (existing && existing.length > 0) {
    return NextResponse.json({ error: "כבר קיים עובד בשם הזה" }, { status: 409 });
  }

  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      email: randomEmail(),
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName, full_name: displayName, role },
    }),
  });

  const resBody = await res.text();
  if (!res.ok) return NextResponse.json({ error: `שגיאה ביצירת המשתמש: ${resBody}` }, { status: res.status });

  const created = JSON.parse(resBody) as { id: string };
  return NextResponse.json({ ok: true, id: created.id, displayName, role });
}

// DELETE /api/manage-employees?id=xxx
// Manager-only. Permanently removes the account (public.users cascades via FK).
// Historical constraints/schedule entries remain under the old name.
export async function DELETE(request: Request) {
  const auth = await requireManager();
  if ("error" in auth) return auth.error;
  const { user } = auth;

  if (!SERVICE_KEY) return NextResponse.json({ error: "השרת אינו מוגדר למחיקת עובדים" }, { status: 500 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  if (id === user.id) {
    return NextResponse.json({ error: "לא ניתן למחוק את עצמך" }, { status: 403 });
  }
  if (await isSuperManager(id)) {
    return NextResponse.json({ error: "לא ניתן למחוק את המנהל הראשי" }, { status: 403 });
  }

  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
    method: "DELETE",
    headers: adminHeaders(),
  });
  if (!res.ok) {
    const errBody = await res.text();
    return NextResponse.json({ error: `שגיאה במחיקת המשתמש: ${errBody}` }, { status: res.status });
  }

  return NextResponse.json({ ok: true });
}
