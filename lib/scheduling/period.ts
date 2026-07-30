// Single shared definition of the monthly scheduling/constraint-submission period,
// used by the employee dashboard, manager dashboard, and the auto-generate route.
// A period always runs from the 21st of one month through the 20th of the next.

export type SchedulingPeriod = { start: string; end: string; label: string };

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function todayISO(): string {
  const t = new Date();
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}

function fmtShort(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d}/${m}`;
}

/** Returns the 21→20 period that contains `referenceISO` (defaults to today). */
export function getCurrentPeriod(referenceISO?: string): SchedulingPeriod {
  const [year, month, day] = (referenceISO ?? todayISO()).split("-").map(Number);
  let start: string, end: string;
  if (day >= 21) {
    const nm = month === 12 ? 1 : month + 1;
    const ny = month === 12 ? year + 1 : year;
    start = `${year}-${pad(month)}-21`;
    end   = `${ny}-${pad(nm)}-20`;
  } else {
    const pm = month === 1 ? 12 : month - 1;
    const py = month === 1 ? year - 1 : year;
    start = `${py}-${pad(pm)}-21`;
    end   = `${year}-${pad(month)}-20`;
  }
  return { start, end, label: `${fmtShort(start)} – ${fmtShort(end)}` };
}

/** Returns the period immediately preceding the one containing `referenceISO`. */
export function getPreviousPeriod(referenceISO?: string): SchedulingPeriod {
  const current = getCurrentPeriod(referenceISO);
  const [cy, cm] = current.start.split("-").map(Number);
  const pm = cm === 1 ? 12 : cm - 1;
  const py = cm === 1 ? cy - 1 : cy;
  return getCurrentPeriod(`${py}-${pad(pm)}-21`);
}

/** Returns the period immediately following the one containing `referenceISO`.
 *  Lets a manager start building/editing next month's schedule ahead of time. */
export function getNextPeriod(referenceISO?: string): SchedulingPeriod {
  const current = getCurrentPeriod(referenceISO);
  const [cy, cm] = current.start.split("-").map(Number);
  const nm = cm === 12 ? 1 : cm + 1;
  const ny = cm === 12 ? cy + 1 : cy;
  return getCurrentPeriod(`${ny}-${pad(nm)}-21`);
}
