"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(
    searchParams.get("error") ? "שגיאה בכניסה — נסה שוב" : null
  );

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password) { setError("יש למלא שם משתמש וסיסמה"); return; }
    setLoading(true);
    try {
      const resolveRes = await fetch("/api/auth/resolve-username", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim() }),
      });
      if (!resolveRes.ok) { setError("שם משתמש או סיסמה שגויים"); return; }
      const { email } = (await resolveRes.json()) as { email: string };

      const supabase = createClient();
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) { setError("שם משתמש או סיסמה שגויים"); return; }

      const role = data.user?.user_metadata?.role as string | undefined;
      router.replace(role === "manager" ? "/manager/dashboard" : "/employee/dashboard");
    } catch {
      setError("שגיאה בהתחברות — נסה שוב");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div dir="rtl" className="min-h-screen bg-gradient-to-br from-blue-50 to-gray-100 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">

        {/* Logo / title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-600 mb-4">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-800">מערכת סידור עבודה</h1>
          <p className="text-gray-500 text-sm mt-1">כניסה למערכת</p>
        </div>

        <div className="bg-white rounded-2xl shadow-md p-8 space-y-5">

          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <Field label="שם משתמש">
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="שם פרטי בעברית"
                autoComplete="username"
                autoFocus
                className={INPUT}
              />
            </Field>

            <Field label="סיסמה">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                className={INPUT}
              />
            </Field>

            <button type="submit" disabled={loading} className={BTN_PRIMARY}>
              {loading ? "מתחבר..." : "כניסה"}
            </button>

            <p className="text-xs text-gray-400 text-center mt-1">
              שכחת סיסמה? פנה למנהל לאיפוס
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}

// ─── Small helpers ────────────────────────────────────────────────────────────

const INPUT = "w-full border border-gray-300 rounded-xl px-3 py-2 text-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400";
const BTN_PRIMARY = "w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold rounded-xl py-2.5 text-sm transition-colors";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-gray-700">{label}</label>
      {children}
    </div>
  );
}
