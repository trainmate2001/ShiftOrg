import { NextResponse } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

// POST /api/auth/resolve-username
// Public (pre-auth) — maps a Hebrew display-name login username to the synthetic
// internal email it was created with, so the client can call signInWithPassword.
// Accounts here have no real email at all; this is the only way to look one up.
export async function POST(request: Request) {
  if (!SERVICE_KEY) {
    return NextResponse.json({ error: "השרת אינו מוגדר לבצע התחברות" }, { status: 500 });
  }

  const { username } = (await request.json()) as { username?: string };
  const trimmed = username?.trim();
  if (!trimmed) {
    return NextResponse.json({ error: "יש להזין שם משתמש" }, { status: 400 });
  }

  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=200`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    cache: "no-store",
  });
  if (!res.ok) {
    return NextResponse.json({ error: "שגיאה בבדיקת שם המשתמש" }, { status: 500 });
  }

  const { users } = (await res.json()) as {
    users: { email: string; user_metadata: Record<string, unknown> }[];
  };

  const match = users.find(
    (u) => (u.user_metadata?.display_name as string | undefined)?.trim() === trimmed
  );

  if (!match || !match.email) {
    return NextResponse.json({ error: "משתמש לא נמצא" }, { status: 404 });
  }

  return NextResponse.json({ email: match.email });
}
