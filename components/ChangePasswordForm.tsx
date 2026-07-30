"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Self-service password change for the logged-in user — updates their own
// account via an active session, no email/recovery flow involved.
export default function ChangePasswordForm() {
  const [open, setOpen]                 = useState(false);
  const [newPassword, setNewPassword]   = useState("");
  const [confirmPassword, setConfirm]   = useState("");
  const [saving, setSaving]             = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [success, setSuccess]           = useState(false);

  function reset() {
    setNewPassword(""); setConfirm(""); setError(null); setSuccess(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setSuccess(false);
    if (newPassword.length < 6) { setError("הסיסמה חייבת להכיל לפחות 6 תווים"); return; }
    if (newPassword !== confirmPassword) { setError("הסיסמאות אינן תואמות"); return; }
    setSaving(true);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) { setError(updateError.message); return; }
      setSuccess(true);
      setNewPassword(""); setConfirm("");
      setTimeout(() => { setOpen(false); setSuccess(false); }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה בשמירה");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => { setOpen(true); reset(); }}
        className="text-xs text-gray-500 hover:text-blue-600 border border-gray-200 hover:border-blue-300 rounded-lg px-3 py-1.5 transition-colors"
      >
        שנה סיסמה
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-2 bg-white border border-gray-200 rounded-xl p-3 shadow-sm w-56"
    >
      <input
        type="password"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        placeholder="סיסמה חדשה"
        autoFocus
        className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
      />
      <input
        type="password"
        value={confirmPassword}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder="אימות סיסמה"
        className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      {success && <p className="text-xs text-green-600">הסיסמה עודכנה ✓</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="flex-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white text-xs font-medium rounded-lg transition-colors"
        >
          {saving ? "שומר..." : "שמור"}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); reset(); }}
          className="px-3 py-1.5 text-xs bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"
        >
          ביטול
        </button>
      </div>
    </form>
  );
}
