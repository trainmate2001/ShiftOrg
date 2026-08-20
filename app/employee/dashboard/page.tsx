"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { ConstraintType } from "@/lib/scheduling/types";
import { SHIFT_TEMPLATE_MAP } from "@/lib/scheduling/shiftTemplates";
import { createClient } from "@/lib/supabase/client";
import { getCurrentPeriod, type SchedulingPeriod } from "@/lib/scheduling/period";
import { CONSTRAINT_OPTIONS, CONSTRAINT_LABELS } from "@/lib/scheduling/constraintOptions";
import ChangePasswordForm from "@/components/ChangePasswordForm";

const MAX_CONSTRAINTS = 10;
const DAYS_HE = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const DAY_LETTERS_HE = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];
const MONTHS_HE = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

type DbConstraint = { id: string; date_iso: string; constraint_type: ConstraintType; note: string; is_special: boolean; approved: boolean };
type Constraint = { id: string; date: string; dateISO: string; constraintType: ConstraintType; note: string; isSpecial: boolean; approved: boolean };
type ScheduleRow = { date: string; period: "morning" | "evening"; employee_id: string; shift_template_id: string };
type ShiftEntry = { date: string; period: "morning" | "evening"; timeRange: string; dayName: string; isFriday: boolean; isSaturday: boolean };
type Profile = { id: string; fullName: string; displayName: string; email: string; role: string };

function dbToConstraint(db: DbConstraint): Constraint {
  const [y, m, d] = db.date_iso.split("-").map(Number);
  return { id: db.id, date: `${d}/${m}/${y}`, dateISO: db.date_iso, constraintType: db.constraint_type, note: db.note ?? "", isSpecial: db.is_special, approved: db.approved };
}

function todayISO(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

function isoPlus(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function countInPeriod(constraints: Constraint[], period: SchedulingPeriod): number {
  return constraints.filter(c => !c.isSpecial && c.dateISO >= period.start && c.dateISO <= period.end).length;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EmployeeDashboardPage() {
  const router = useRouter();

  const [profile, setProfile]               = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const selectedEmployee = profile?.displayName ?? "";

  // Constraints
  const [constraints, setConstraints]   = useState<Constraint[]>([]);
  const [loading, setLoading]           = useState(false);
  const [loadError, setLoadError]       = useState<string | null>(null);
  const [submitting, setSubmitting]     = useState(false);
  const [submitError, setSubmitError]   = useState<string | null>(null);
  const [deleteId, setDeleteId]         = useState<string | null>(null);

  // Shifts
  const [shifts, setShifts]             = useState<ShiftEntry[]>([]);
  const [shiftsLoading, setShiftsLoading] = useState(false);
  const [shiftsError, setShiftsError]   = useState<string | null>(null);

  // The period the manager has opened for employees — this is what the
  // calendar is locked to (defaults to today's natural period until loaded).
  const [openPeriod, setOpenPeriod] = useState<SchedulingPeriod>(() => getCurrentPeriod(todayISO()));

  // Calendar
  const today = todayISO();
  const [calYear, setCalYear]   = useState(() => new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(() => new Date().getMonth()); // 0-indexed
  const [selectedDay, setSelectedDay]           = useState<string | null>(null);
  const [dayConstraintType, setDayConstraintType] = useState<ConstraintType>("all-day");
  const [dayNote, setDayNote]                   = useState("");
  const [dayIsSpecial, setDayIsSpecial]         = useState(false);

  // Published schedule banner
  const [publishedWeek, setPublishedWeek] = useState<string | null>(null);

  // Recurring constraints
  const [recurDays, setRecurDays]         = useState<number[]>([]);
  const [recurType, setRecurType]         = useState<ConstraintType>("all-day");
  const [recurSubmitting, setRecurSubmitting] = useState(false);
  const [recurResult, setRecurResult]     = useState<string | null>(null);

  // Further requests (free text)
  const [furtherRequest, setFurtherRequest]               = useState("");
  const [furtherRequestLoading, setFurtherRequestLoading] = useState(false);
  const [furtherRequestSaving, setFurtherRequestSaving]   = useState(false);
  const [furtherRequestSaved, setFurtherRequestSaved]     = useState(false);
  const [furtherRequestError, setFurtherRequestError]     = useState<string | null>(null);

  // Whether the manager has locked submissions for the current period
  const [isLocked, setIsLocked] = useState(false);

  // ── Auth ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/profile")
      .then(async (res) => {
        if (!res.ok) { router.replace("/login"); return; }
        const json = await res.json() as Profile;
        if (json.role !== "employee") { router.replace("/manager/dashboard"); return; }
        setProfile(json);
      })
      .catch(() => router.replace("/login"))
      .finally(() => setProfileLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
  }

  // ── Constraints ────────────────────────────────────────────────────────────
  const loadConstraints = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try {
      const res = await fetch("/api/employee-constraints");
      const json = await res.json();
      if (!res.ok) { setLoadError(json.error ?? `HTTP ${res.status}`); setConstraints([]); return; }
      setConstraints((json as DbConstraint[]).map(dbToConstraint));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "שגיאה בטעינה");
      setConstraints([]);
    } finally { setLoading(false); }
  }, []);

  // ── Shifts ─────────────────────────────────────────────────────────────────
  const loadShifts = useCallback(async (employeeId: string) => {
    setShiftsLoading(true); setShiftsError(null);
    try {
      const from = today;
      const to   = isoPlus(from, 27);
      const res  = await fetch(`/api/schedule-entries?from=${from}&to=${to}`);
      const json = await res.json();
      if (!res.ok) { setShiftsError(json.error ?? `HTTP ${res.status}`); setShifts([]); return; }
      const mine: ShiftEntry[] = (json as ScheduleRow[])
        .filter(r => r.employee_id === employeeId)
        .sort((a, b) => a.date.localeCompare(b.date) || (a.period === "morning" ? -1 : 1))
        .map(r => {
          const tpl = SHIFT_TEMPLATE_MAP[r.shift_template_id];
          const [y, m, d] = r.date.split("-").map(Number);
          const dow = new Date(y, m - 1, d).getDay();
          return { date: r.date, period: r.period, timeRange: tpl ? `${tpl.startTime}–${tpl.endTime}` : r.shift_template_id, dayName: DAYS_HE[dow], isFriday: dow === 5, isSaturday: dow === 6 };
        });
      setShifts(mine);
    } catch (err) {
      setShiftsError(err instanceof Error ? err.message : "שגיאה בטעינת סידור");
      setShifts([]);
    } finally { setShiftsLoading(false); }
  }, [today]);

  // ── Published banner ───────────────────────────────────────────────────────
  const loadPublished = useCallback(async () => {
    try {
      const d = new Date();
      const dow = d.getDay();
      const days = dow === 0 ? 7 : 7 - dow;
      const sun = new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
      const ws = `${sun.getFullYear()}-${String(sun.getMonth()+1).padStart(2,"0")}-${String(sun.getDate()).padStart(2,"0")}`;
      const res = await fetch(`/api/publish-schedule?week_start=${ws}`);
      if (res.ok) {
        const json = await res.json() as { published: boolean; published_at: string | null };
        if (json.published) setPublishedWeek(ws);
      }
    } catch { /* ignore */ }
  }, []);

  // ── Further requests (free text) ──────────────────────────────────────────
  const loadFurtherRequest = useCallback(async () => {
    setFurtherRequestLoading(true); setFurtherRequestError(null);
    try {
      const res = await fetch(`/api/further-requests?periodStart=${openPeriod.start}`);
      const json = await res.json();
      if (!res.ok) { setFurtherRequestError(json.error ?? `HTTP ${res.status}`); return; }
      setFurtherRequest((json as { note?: string }).note ?? "");
    } catch (err) {
      setFurtherRequestError(err instanceof Error ? err.message : "שגיאה בטעינה");
    } finally { setFurtherRequestLoading(false); }
  }, [openPeriod.start]);

  async function handleSaveFurtherRequest() {
    setFurtherRequestSaving(true); setFurtherRequestError(null); setFurtherRequestSaved(false);
    try {
      const res = await fetch("/api/further-requests", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodStart: openPeriod.start, note: furtherRequest }),
      });
      const json = await res.json();
      if (!res.ok) { setFurtherRequestError(json.error ?? `HTTP ${res.status}`); return; }
      setFurtherRequestSaved(true);
    } catch (err) {
      setFurtherRequestError(err instanceof Error ? err.message : "שגיאה בשמירה");
    } finally { setFurtherRequestSaving(false); }
  }

  // ── Lock state (manager can lock the open period's submission window) ──────
  const loadLockState = useCallback(async () => {
    try {
      const res = await fetch(`/api/constraint-window?periodStart=${openPeriod.start}`);
      if (!res.ok) return;
      const json = await res.json() as { is_locked?: boolean };
      setIsLocked(json.is_locked ?? false);
    } catch { /* fail open — same as before this feature existed */ }
  }, [openPeriod.start]);

  // ── Open period (manager-controlled — what employees see/submit to) ────────
  const loadOpenPeriod = useCallback(async () => {
    try {
      const res = await fetch("/api/active-period");
      if (!res.ok) return;
      const json = await res.json() as { periodStart?: string };
      if (json.periodStart) setOpenPeriod(getCurrentPeriod(json.periodStart));
    } catch { /* keep the today-based default */ }
  }, []);

  // Re-center the calendar on the open period whenever it changes/loads
  useEffect(() => {
    const [y, m] = openPeriod.start.split("-").map(Number);
    setCalYear(y);
    setCalMonth(m - 1);
    setSelectedDay(null);
  }, [openPeriod.start]);

  useEffect(() => {
    if (!selectedEmployee) return;
    loadConstraints();
    loadShifts(selectedEmployee);
    loadPublished();
    loadOpenPeriod();
  }, [selectedEmployee, loadConstraints, loadShifts, loadPublished, loadOpenPeriod]);

  // These depend on openPeriod, which only settles after loadOpenPeriod resolves
  useEffect(() => {
    if (!selectedEmployee) return;
    loadFurtherRequest();
    loadLockState();
  }, [selectedEmployee, openPeriod.start, loadFurtherRequest, loadLockState]);

  // ── Calendar helpers ───────────────────────────────────────────────────────
  function getCalendarDays(): (string | null)[] {
    const firstDow = new Date(calYear, calMonth, 1).getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const days: (string | null)[] = [];
    for (let i = 0; i < firstDow; i++) days.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      days.push(`${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    }
    return days;
  }

  function getDayMark(iso: string): "all-day" | "morning" | "evening" | null {
    const cs = constraints.filter(c => c.dateISO === iso);
    if (cs.some(c => c.constraintType === "all-day")) return "all-day";
    if (cs.some(c => c.constraintType.startsWith("morning"))) return "morning";
    if (cs.some(c => c.constraintType.startsWith("evening"))) return "evening";
    return null;
  }

  // Navigation is locked to the two calendar months the open period spans
  // (e.g. 21/8–20/9 spans August and September) — no browsing beyond that.
  function monthKey(iso: string): number {
    const [y, m] = iso.split("-").map(Number);
    return y * 12 + (m - 1);
  }
  const minMonthKey = monthKey(openPeriod.start);
  const maxMonthKey = monthKey(openPeriod.end);
  const curMonthKey = calYear * 12 + calMonth;
  const atMinMonth = curMonthKey <= minMonthKey;
  const atMaxMonth = curMonthKey >= maxMonthKey;

  function prevMonth() {
    if (atMinMonth) return;
    if (calMonth === 0) { setCalYear(y => y - 1); setCalMonth(11); }
    else setCalMonth(m => m - 1);
    setSelectedDay(null);
  }
  function nextMonth() {
    if (atMaxMonth) return;
    if (calMonth === 11) { setCalYear(y => y + 1); setCalMonth(0); }
    else setCalMonth(m => m + 1);
    setSelectedDay(null);
  }

  // ── Submit single constraint (from calendar day panel) ─────────────────────
  async function handleDaySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedDay || selectedDay < today) return;
    setSubmitting(true); setSubmitError(null);
    try {
      const res = await fetch("/api/employee-constraints", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateISO: selectedDay, constraintType: dayConstraintType, note: dayNote, isSpecial: dayIsSpecial }),
      });
      const json = await res.json();
      if (!res.ok) { setSubmitError(json.error ?? `HTTP ${res.status}`); return; }
      await loadConstraints();
      setDayNote("");
      setDayIsSpecial(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "שגיאה בשמירה");
    } finally { setSubmitting(false); }
  }

  // ── Delete constraint ─────────────────────────────────────────────────────
  async function handleDelete(id: string) {
    setDeleteId(id);
    setConstraints(prev => prev.filter(c => c.id !== id));
    try {
      const res = await fetch(`/api/employee-constraints?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) await loadConstraints();
    } catch { await loadConstraints(); }
    finally { setDeleteId(null); }
  }

  // ── Recurring submit ───────────────────────────────────────────────────────
  // Generates matching weekdays within the open period only — that's the
  // window employees submit to now, not an arbitrary "next 4 weeks."
  async function handleRecurSubmit() {
    if (recurDays.length === 0) return;
    setRecurSubmitting(true); setRecurResult(null);
    const dates: string[] = [];
    const [sy, sm, sd] = openPeriod.start.split("-").map(Number);
    const [ey, em, ed] = openPeriod.end.split("-").map(Number);
    const cursor = new Date(sy, sm - 1, sd);
    const end = new Date(ey, em - 1, ed);
    while (cursor <= end) {
      const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
      if (iso > today && recurDays.includes(cursor.getDay())) dates.push(iso);
      cursor.setDate(cursor.getDate() + 1);
    }
    let added = 0, skipped = 0;
    for (const dateISO of dates) {
      const already = constraints.some(c => c.dateISO === dateISO && c.constraintType === recurType);
      if (already) { skipped++; continue; }
      const res = await fetch("/api/employee-constraints", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateISO, constraintType: recurType, note: "" }),
      });
      if (res.ok) added++; else skipped++;
    }
    await loadConstraints();
    setRecurResult(`נוספו ${added} אילוצים${skipped > 0 ? ` · ${skipped} דולגו` : ""}`);
    setRecurSubmitting(false);
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const currentPeriod   = openPeriod;
  const selectedPeriod  = selectedDay ? getCurrentPeriod(selectedDay) : null;
  const periodCount     = selectedPeriod ? countInPeriod(constraints, selectedPeriod) : 0;
  const atPeriodLimit   = selectedPeriod !== null && periodCount >= MAX_CONSTRAINTS;
  const upcomingConstraints = constraints.filter(c => c.dateISO >= today).sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  const pastConstraints     = constraints.filter(c => c.dateISO < today).sort((a, b) => b.dateISO.localeCompare(a.dateISO));
  const conflictingShifts   = shifts.filter(s => constraints.some(c => {
    if (c.dateISO !== s.date) return false;
    if (!c.approved) return false;
    if (c.constraintType === "all-day") return true;
    return c.constraintType.startsWith(s.period === "morning" ? "morning" : "evening");
  }));

  const calDays = getCalendarDays();
  const selectedDayConstraints = selectedDay ? constraints.filter(c => c.dateISO === selectedDay) : [];
  const selectedDayShifts = selectedDay ? shifts.filter(s => s.date === selectedDay) : [];
  const isPastDay = selectedDay ? selectedDay < today : false;

  function fmtISO(iso: string) {
    const [y,m,d] = iso.split("-").map(Number);
    const dow = new Date(y,m-1,d).getDay();
    return `${DAYS_HE[dow]}, ${d}/${m}/${y}`;
  }

  if (profileLoading) {
    return (
      <div dir="rtl" className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">טוען פרופיל...</p>
      </div>
    );
  }
  if (!profile) return null;

  return (
    <div dir="rtl" className="min-h-screen bg-gray-50">

      {/* Top bar */}
      <div className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-gray-800">אזור עובד</h1>
            <p className="text-xs text-gray-400 mt-0.5">הגשת אילוצים וצפייה בסידור</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-sm font-semibold text-gray-800">{profile.fullName || profile.displayName}</p>
              <p className="text-xs text-gray-400">{profile.email}</p>
            </div>
            <ChangePasswordForm />
            <button onClick={handleLogout} className="text-xs text-gray-500 hover:text-red-600 border border-gray-200 hover:border-red-300 rounded-lg px-3 py-1.5 transition-colors">
              יציאה
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-5">

        {/* Published banner */}
        {publishedWeek && (
          <div className="bg-green-50 border border-green-300 text-green-800 rounded-2xl px-5 py-3 text-sm font-medium">
            ✓ סידור חדש פורסם לשבוע {publishedWeek.split("-").slice(1).map(Number).join("/")} — בדוק את המשמרות שלך למטה
          </div>
        )}

        {/* ── My Shifts ──────────────────────────────────────────────────── */}
        <section className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-800">המשמרות שלי — 4 שבועות קרובים</h2>
            <button onClick={() => loadShifts(selectedEmployee)} disabled={shiftsLoading} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
              {shiftsLoading ? "טוען..." : "רענן"}
            </button>
          </div>
          <div className="px-5 py-4">
            {conflictingShifts.length > 0 && (
              <div className="mb-3 text-sm text-amber-800 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2.5 space-y-1">
                <p className="font-semibold">שים לב — ישנן משמרות שמתנגשות עם האילוצים שלך:</p>
                {conflictingShifts.map((s, i) => {
                  const [y,m,d] = s.date.split("-").map(Number);
                  return <p key={i} className="text-xs">• {s.dayName} {d}/{m}/{y} — {s.period === "morning" ? "בוקר" : "ערב"} ({s.timeRange})</p>;
                })}
                <p className="text-xs text-amber-700 mt-1">המנהל צריך לצור סידור חדש כדי שהאילוצים ייושמו.</p>
              </div>
            )}
            {shiftsLoading ? <p className="text-sm text-gray-400">טוען...</p>
            : shiftsError ? <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">שגיאה: {shiftsError}</p>
            : shifts.length === 0 ? <p className="text-sm text-gray-400">אין משמרות שמורות בארבעת השבועות הקרובים.</p>
            : (
              <div className="space-y-3">
                {/* Next shift highlight */}
                {(() => {
                  const next = shifts.find(s => s.date >= today);
                  if (!next) return null;
                  const [y,m,d] = next.date.split("-").map(Number);
                  const daysAway = Math.ceil((new Date(y,m-1,d).getTime() - new Date().setHours(0,0,0,0)) / 86400000);
                  return (
                    <div className={`rounded-xl px-4 py-3 border-2 ${next.period === "morning" ? "bg-sky-50 border-sky-400" : "bg-indigo-50 border-indigo-400"}`}>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">המשמרת הבאה שלך</p>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-gray-800 text-sm">{next.dayName}, {d}/{m}/{y}</span>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${next.period === "morning" ? "bg-sky-200 text-sky-800" : "bg-indigo-200 text-indigo-800"}`}>
                            {next.period === "morning" ? "בוקר" : "ערב"} · {next.timeRange}
                          </span>
                          <span className="text-xs text-gray-400">
                            {daysAway === 0 ? "היום!" : daysAway === 1 ? "מחר" : `בעוד ${daysAway} ימים`}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })()}
                {/* Summary */}
                <p className="text-xs text-gray-400">סה״כ {shifts.length} משמרות ב-4 שבועות הקרובים</p>
                {/* All shifts */}
                <div className="space-y-1">
                  {shifts.map((s, i) => {
                    const isNext = i === shifts.findIndex(x => x.date >= today);
                    const [y,m,d] = s.date.split("-").map(Number);
                    return (
                      <div key={i} className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 border text-sm transition-colors ${
                        isNext
                          ? s.period === "morning" ? "bg-sky-100 border-sky-300 text-sky-900 font-semibold"
                                                   : "bg-indigo-100 border-indigo-300 text-indigo-900 font-semibold"
                          : s.isSaturday ? "bg-gray-100 border-gray-300 text-gray-600"
                          : s.isFriday  ? "bg-gray-50 border-gray-200 text-gray-700"
                          : s.period === "morning" ? "bg-sky-50 border-sky-200 text-sky-800"
                          : "bg-indigo-50 border-indigo-200 text-indigo-800"
                      }`}>
                        <span className="font-medium">{s.dayName}, {d}/{m}/{y}</span>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.period === "morning" ? "bg-sky-200 text-sky-800" : "bg-indigo-200 text-indigo-800"}`}>
                            {s.period === "morning" ? "בוקר" : "ערב"}
                          </span>
                          <span className="font-mono text-xs">{s.timeRange}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ── Calendar ───────────────────────────────────────────────────── */}
        <section className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 space-y-2">
            <h2 className="font-semibold text-gray-800">הגשת אילוץ</h2>
            {isLocked && (
              <div className="rounded-lg px-3 py-2 text-xs border bg-gray-100 border-gray-300 text-gray-700 font-medium">
                🔒 המנהל נעל את הגשת האילוצים לתקופה זו — לא ניתן להוסיף, לערוך או למחוק
              </div>
            )}
            {/* Period info */}
            {(() => {
              const periodUsed = countInPeriod(constraints, currentPeriod);
              const remaining  = MAX_CONSTRAINTS - periodUsed;
              return (
                <div className="rounded-lg px-3 py-2 text-xs border flex flex-col gap-1 bg-blue-50 border-blue-200 text-blue-800">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="font-semibold">תקופה: {currentPeriod.label}</span>
                    {remaining === 0
                      ? <span className="font-semibold text-red-700">הגעת למגבלה</span>
                      : <span>{periodUsed} מתוך {MAX_CONSTRAINTS} אילוצים · {remaining} נותרו</span>
                    }
                  </div>
                  <div className="w-full bg-white/60 rounded-full h-1.5 mt-0.5 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${periodUsed >= MAX_CONSTRAINTS ? "bg-red-500" : "bg-blue-500"}`}
                      style={{ width: `${Math.min((periodUsed / MAX_CONSTRAINTS) * 100, 100)}%` }}
                    />
                  </div>
                </div>
              );
            })()}
          </div>

          <div className="px-4 py-4">
            {/* Month nav — locked to the two months the open period spans */}
            <div className="flex items-center justify-between mb-3">
              <button
                onClick={prevMonth}
                disabled={atMinMonth}
                className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-600 font-bold text-lg leading-none disabled:opacity-25 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              >
                ‹
              </button>
              <span className="font-semibold text-gray-800 text-sm">{MONTHS_HE[calMonth]} {calYear}</span>
              <button
                onClick={nextMonth}
                disabled={atMaxMonth}
                className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-600 font-bold text-lg leading-none disabled:opacity-25 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              >
                ›
              </button>
            </div>

            {/* Day headers */}
            <div className="grid grid-cols-7 mb-1">
              {DAY_LETTERS_HE.map((d, i) => (
                <div key={i} className="text-center text-xs font-semibold text-gray-400 py-1">
                  {d}
                </div>
              ))}
            </div>

            {/* Calendar grid */}
            <div className="grid grid-cols-7 gap-0.5">
              {calDays.map((iso, idx) => {
                if (!iso) return <div key={`e-${idx}`} />;
                const mark = getDayMark(iso);
                const isPast = iso < today;
                const isOutsideOpenPeriod = iso < openPeriod.start || iso > openPeriod.end;
                const isDisabled = isPast || isOutsideOpenPeriod;
                const isToday = iso === today;
                const isSelected = iso === selectedDay;
                const hasMyShift = shifts.some(s => s.date === iso);
                const [,,d] = iso.split("-").map(Number);

                let bg = "bg-white hover:bg-gray-50";
                if (mark === "all-day")  bg = "bg-red-100 hover:bg-red-200";
                else if (mark === "morning") bg = "bg-amber-100 hover:bg-amber-200";
                else if (mark === "evening") bg = "bg-indigo-100 hover:bg-indigo-200";
                if (isDisabled) bg = "bg-gray-50 opacity-40";

                return (
                  <button
                    key={iso}
                    onClick={() => !isDisabled && setSelectedDay(isSelected ? null : iso)}
                    disabled={isDisabled}
                    title={isOutsideOpenPeriod && !isPast ? "מחוץ לתקופה הפתוחה" : undefined}
                    className={`relative flex flex-col items-center justify-center h-9 rounded-lg text-xs font-medium transition-colors border ${
                      isSelected ? "border-blue-500 ring-2 ring-blue-300" : isToday ? "border-blue-400" : "border-transparent"
                    } ${bg} ${isDisabled ? "cursor-default" : "cursor-pointer"} text-gray-800`}
                  >
                    <span>{d}</span>
                    {hasMyShift && <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-green-500" />}
                  </button>
                );
              })}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-3 mt-3 text-xs text-gray-500">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-100 border border-red-200 inline-block" />כל היום</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-100 border border-amber-200 inline-block" />בוקר</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-indigo-100 border border-indigo-200 inline-block" />ערב</span>
              <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />משמרת</span>
            </div>
          </div>

          {/* Selected day panel */}
          {selectedDay && (
            <div className="border-t border-gray-100 px-5 py-4 space-y-3">
              <p className="font-semibold text-gray-800 text-sm">{fmtISO(selectedDay)}</p>

              {/* Shift on this day */}
              {selectedDayShifts.map((s, i) => (
                <div key={i} className={`text-xs px-3 py-2 rounded-lg ${s.period === "morning" ? "bg-sky-50 text-sky-700 border border-sky-200" : "bg-indigo-50 text-indigo-700 border border-indigo-200"}`}>
                  משמרת {s.period === "morning" ? "בוקר" : "ערב"} — {s.timeRange}
                </div>
              ))}

              {/* Existing constraints for this day */}
              {selectedDayConstraints.length > 0 && (
                <div className="space-y-1.5">
                  {selectedDayConstraints.map(c => (
                    <div key={c.id} className="flex items-center justify-between gap-2 text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                      <span className="flex items-center gap-1.5 flex-wrap text-gray-700">
                        {CONSTRAINT_LABELS[c.constraintType]}{c.note ? ` — ${c.note}` : ""}
                        {c.isSpecial && (
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${c.approved ? "bg-purple-100 text-purple-700" : "bg-amber-100 text-amber-700"}`}>
                            מיוחד · {c.approved ? "אושר" : "ממתין לאישור"}
                          </span>
                        )}
                      </span>
                      {!isLocked && (
                        <button
                          onClick={() => handleDelete(c.id)}
                          disabled={deleteId === c.id}
                          className="text-red-500 hover:text-red-700 font-medium shrink-0"
                        >
                          {deleteId === c.id ? "..." : "מחק"}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {isLocked ? null : isPastDay ? (
                <p className="text-xs text-gray-400">לא ניתן להוסיף אילוץ לתאריך שעבר.</p>
              ) : (atPeriodLimit && !dayIsSpecial) ? (
                <div className="space-y-2">
                  <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">הגעת למגבלת {MAX_CONSTRAINTS} אילוצים לתקופה זו.</p>
                  <label className="flex items-center gap-2 text-xs text-gray-600">
                    <input type="checkbox" checked={dayIsSpecial} onChange={e => setDayIsSpecial(e.target.checked)} />
                    בקשה מיוחדת — לא נספרת במגבלה, טעונה אישור מנהל
                  </label>
                </div>
              ) : (
                <form onSubmit={handleDaySubmit} className="space-y-2">
                  <div className="flex gap-2">
                    <select
                      value={dayConstraintType}
                      onChange={e => setDayConstraintType(e.target.value as ConstraintType)}
                      className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
                    >
                      {CONSTRAINT_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                    </select>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white text-sm font-medium rounded-lg transition-colors shrink-0"
                    >
                      {submitting ? "..." : "הוסף"}
                    </button>
                  </div>
                  <input
                    type="text"
                    value={dayNote}
                    onChange={e => setDayNote(e.target.value)}
                    placeholder="הערה (אופציונלי)"
                    maxLength={120}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                  <label className="flex items-center gap-2 text-xs text-gray-600">
                    <input type="checkbox" checked={dayIsSpecial} onChange={e => setDayIsSpecial(e.target.checked)} />
                    בקשה מיוחדת — לא נספרת במגבלה, טעונה אישור מנהל
                  </label>
                  {submitError && <p className="text-xs text-red-600">{submitError}</p>}
                </form>
              )}
            </div>
          )}
        </section>

        {/* ── Further requests (free text) ────────────────────────────────── */}
        <section className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800">בקשות נוספות</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              הערות או בקשות חופשיות למנהל לתקופה {currentPeriod.label} — לא נספר במגבלת האילוצים
            </p>
          </div>
          <div className="px-5 py-4 space-y-2">
            <textarea
              value={furtherRequest}
              onChange={e => { setFurtherRequest(e.target.value); setFurtherRequestSaved(false); }}
              placeholder="לדוגמה: אשמח לא לעבוד יותר מ-2 משמרות ערב ברצף החודש"
              rows={3}
              disabled={furtherRequestLoading || isLocked}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none disabled:bg-gray-100 disabled:text-gray-400"
            />
            <div className="flex items-center gap-3">
              <button
                onClick={handleSaveFurtherRequest}
                disabled={furtherRequestSaving || furtherRequestLoading || isLocked}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {furtherRequestSaving ? "שומר..." : "שמור"}
              </button>
              {furtherRequestSaved && <span className="text-xs text-green-600">נשמר</span>}
              {furtherRequestError && <span className="text-xs text-red-600">{furtherRequestError}</span>}
              {isLocked && <span className="text-xs text-gray-400">🔒 נעול על ידי המנהל</span>}
            </div>
          </div>
        </section>

        {/* ── Recurring constraints ───────────────────────────────────────── */}
        <section className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800">אילוצים חוזרים</h2>
            <p className="text-xs text-gray-400 mt-0.5">הגש אילוץ לכל הימים הנבחרים בארבעת השבועות הקרובים</p>
          </div>
          <div className="px-5 py-4 space-y-4">
            {/* Day of week checkboxes — Sunday to Thursday only */}
            <div className="flex flex-wrap gap-2">
              {DAYS_HE.map((label, dow) => {
                if (dow === 5 || dow === 6) return null;
                return (
                  <button
                    key={dow}
                    onClick={() => setRecurDays(prev => prev.includes(dow) ? prev.filter(d => d !== dow) : [...prev, dow])}
                    className={`px-3 py-1.5 text-sm rounded-lg border font-medium transition-colors ${
                      recurDays.includes(dow)
                        ? "bg-blue-600 border-blue-600 text-white"
                        : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            <div className="flex gap-2">
              <select
                value={recurType}
                onChange={e => setRecurType(e.target.value as ConstraintType)}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                {CONSTRAINT_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
              <button
                onClick={handleRecurSubmit}
                disabled={recurSubmitting || recurDays.length === 0 || isLocked}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors shrink-0"
              >
                {recurSubmitting ? "שולח..." : "הגש"}
              </button>
            </div>

            {isLocked && (
              <p className="text-xs text-gray-400">🔒 המנהל נעל את הגשת האילוצים לתקופה זו</p>
            )}
            {recurResult && (
              <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                ✓ {recurResult}
              </p>
            )}
          </div>
        </section>

        {/* ── Constraint List ─────────────────────────────────────────────── */}
        {constraints.length > 0 && (
          <section className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-800">האילוצים שלי</h2>
              {loading && <span className="text-xs text-gray-400">טוען...</span>}
            </div>
            <div className="px-5 py-4">
              {loadError ? (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{loadError}</p>
              ) : (
                <div className="space-y-4">
                  {upcomingConstraints.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">עתידיים</p>
                      {upcomingConstraints.map(c => (
                        <ConstraintRow
                          key={c.id}
                          constraint={c}
                          deleting={deleteId === c.id}
                          dayLabel={fmtISO(c.dateISO)}
                          onDelete={handleDelete}
                          locked={isLocked && c.dateISO >= currentPeriod.start && c.dateISO <= currentPeriod.end}
                        />
                      ))}
                    </div>
                  )}
                  {pastConstraints.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">עברו</p>
                      {pastConstraints.map(c => (
                        <ConstraintRow key={c.id} constraint={c} deleting={deleteId === c.id} dayLabel={fmtISO(c.dateISO)} onDelete={handleDelete} past />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

      </div>
    </div>
  );
}

// ─── ConstraintRow ────────────────────────────────────────────────────────────

type ConstraintRowProps = { constraint: Constraint; deleting: boolean; dayLabel: string; past?: boolean; locked?: boolean; onDelete: (id: string) => void };

function ConstraintRow({ constraint: c, deleting, dayLabel, past, locked, onDelete }: ConstraintRowProps) {
  const isPeriodMorning = c.constraintType.startsWith("morning");
  const isPeriodEvening = c.constraintType.startsWith("evening");

  return (
    <div className={`flex items-center gap-2 rounded-lg px-3 py-2.5 border text-sm ${
      past ? "opacity-50 bg-gray-50 border-gray-200"
      : c.constraintType === "all-day" ? "bg-red-50 border-red-200"
      : isPeriodMorning ? "bg-amber-50 border-amber-200"
      : isPeriodEvening ? "bg-indigo-50 border-indigo-200"
      : "bg-gray-50 border-gray-200"
    }`}>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-gray-800 truncate">{dayLabel}</p>
        <p className="text-xs text-gray-500">
          {CONSTRAINT_LABELS[c.constraintType]}
          {c.note && ` — ${c.note}`}
        </p>
        {c.isSpecial && (
          <span className={`inline-block mt-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${c.approved ? "bg-purple-100 text-purple-700" : "bg-amber-100 text-amber-700"}`}>
            מיוחד · {c.approved ? "אושר" : "ממתין לאישור"}
          </span>
        )}
      </div>
      {!past && !locked && (
        <button
          onClick={() => onDelete(c.id)}
          disabled={deleting}
          className="shrink-0 text-xs text-red-500 hover:text-red-700 font-medium disabled:opacity-50"
        >
          {deleting ? "..." : "מחק"}
        </button>
      )}
    </div>
  );
}
