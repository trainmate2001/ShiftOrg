import type { ConstraintType } from "@/lib/scheduling/types";

// Shared between the employee dashboard (self-submission) and the manager
// dashboard (adding a constraint on an employee's behalf).
export const CONSTRAINT_OPTIONS: { value: ConstraintType; label: string }[] = [
  { value: "all-day",         label: "כל היום" },
  { value: "morning-07-19",   label: "בוקר (לא יכול בכלל)" },
  { value: "morning-from-07", label: "בוקר רק מ-07:00" },
  { value: "morning-from-08", label: "בוקר רק מ-08:00" },
  { value: "evening-19-07",   label: "ערב (לא יכול בכלל)" },
  { value: "evening-from-19", label: "ערב רק מ-19:00" },
  { value: "evening-from-20", label: "ערב רק מ-20:00" },
];

export const CONSTRAINT_LABELS: Record<ConstraintType, string> = {
  "all-day":         "כל היום",
  "morning-07-19":   "בוקר (לא יכול בכלל)",
  "morning-08-20":   "בוקר (לא יכול בכלל)",
  "morning-from-07": "בוקר רק מ-07:00",
  "morning-from-08": "בוקר רק מ-08:00",
  "evening-19-07":   "ערב (לא יכול בכלל)",
  "evening-20-08":   "ערב (לא יכול בכלל)",
  "evening-from-19": "ערב רק מ-19:00",
  "evening-from-20": "ערב רק מ-20:00",
};
