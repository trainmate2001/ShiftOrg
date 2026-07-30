#!/usr/bin/env node
// Seed the premade closed-group roster (workers + admins) as Supabase Auth users.
// No real email is used — each account gets a random synthetic internal email and
// logs in via its Hebrew display name (see app/api/auth/resolve-username).
// Safe to re-run: existing display names are skipped.
//
// Usage: node scripts/seed-users.mjs   (or: npm run seed:users)

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env.local");

function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnv(envPath);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const WORKERS = ["זיו", "עידו", "סתו", "אייל רוכסר", "אייל סיוון", "אריאל", "עופר", "מיכאל"];
const ADMINS  = ["איתי", "עופר ב", "עידו ב"];

function randomPassword() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6-digit PIN
}

function randomEmail() {
  const token = Math.random().toString(36).slice(2, 10);
  return `user-${token}@shifts.internal`;
}

function adminHeaders(extra) {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    ...extra,
  };
}

async function listExistingDisplayNames() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=200`, {
    headers: adminHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to list users: ${res.status} ${await res.text()}`);
  const { users } = await res.json();
  return new Set(
    users
      .map((u) => u.user_metadata?.display_name)
      .filter((n) => typeof n === "string")
  );
}

async function createUser(displayName, role) {
  const password = randomPassword();
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
  if (!res.ok) {
    throw new Error(`Failed to create ${displayName}: ${res.status} ${await res.text()}`);
  }
  return password;
}

async function main() {
  const existing = await listExistingDisplayNames();
  const results = [];

  for (const name of WORKERS) {
    if (existing.has(name)) { results.push([name, "עובד", "— כבר קיים —"]); continue; }
    const password = await createUser(name, "employee");
    results.push([name, "עובד", password]);
  }
  for (const name of ADMINS) {
    if (existing.has(name)) { results.push([name, "מנהל", "— כבר קיים —"]); continue; }
    const password = await createUser(name, "manager");
    results.push([name, "מנהל", password]);
  }

  console.log("\n=== משתמשים ===");
  console.log("שם משתמש".padEnd(16) + "תפקיד".padEnd(10) + "סיסמה");
  console.log("-".repeat(40));
  for (const [name, role, password] of results) {
    console.log(name.padEnd(16) + role.padEnd(10) + password);
  }
  console.log("\nמסור את הסיסמאות הללו לעובדים/מנהלים. מנהל יכול לאפס סיסמה בכל עת דרך \"ניהול עובדים\".\n");
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
