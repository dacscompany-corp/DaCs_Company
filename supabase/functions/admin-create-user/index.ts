// ════════════════════════════════════════════════════════════════════
// Edge Function: admin-create-user
// Replaces the old "secondary Firebase app" trick. An owner/staff member
// creates an auth user (admin / client / construction_client) WITHOUT
// disturbing their own session. Uses the service_role key (never shipped
// to the browser) and gates the caller to owner/staff.
//
// POST body: { email, password, kind, role?, ownerUid?, firstName?, lastName?,
//              displayName?, agreementAccepted? }
// → 200 { uid, reused }   |   4xx { error }
//
// Deploy: supabase functions deploy admin-create-user
// ════════════════════════════════════════════════════════════════════
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "http://127.0.0.1:5501",
  "http://localhost:5501",
  "https://dacs-company.vercel.app",
];
function cors(origin: string) {
  const ok = ALLOWED_ORIGINS.includes(origin) || /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Vary": "Origin",
  };
}
const json = (b: unknown, status: number, c: Record<string, string>) =>
  new Response(JSON.stringify(b), { status, headers: { ...c, "Content-Type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") || "";
  const c = cors(origin);
  if (req.method === "OPTIONS") return new Response(null, { headers: c });
  if (req.method !== "POST")    return json({ error: "POST only" }, 405, c);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // 1) Identify caller from their JWT and require owner/staff.
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "Missing Authorization" }, 401, c);
  const { data: caller, error: cErr } = await admin.auth.getUser(jwt);
  if (cErr || !caller?.user) return json({ error: "Invalid session" }, 401, c);

  const { data: prof } = await admin
    .from("profiles").select("role").eq("id", caller.user.id).single();
  if (!prof || !["owner", "staff"].includes(prof.role ?? "")) {
    return json({ error: "Forbidden — owner/staff only" }, 403, c);
  }

  // 2) Parse + validate.
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Bad JSON" }, 400, c); }
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const kind = String(body.kind || "");
  if (!email || !password) return json({ error: "email and password required" }, 400, c);
  if (!["admin", "client", "construction_client"].includes(kind))
    return json({ error: "invalid kind" }, 400, c);

  // staff may not mint owners
  const role = body.role != null ? String(body.role) : (kind === "admin" ? "worker" : "client");
  if (prof.role === "staff" && role === "owner")
    return json({ error: "staff cannot create owners" }, 403, c);

  // 3) Create the auth user (reuse uid if the email already exists — mirrors old flow).
  let uid: string;
  let reused = false;
  const created = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (created.error) {
    if (/already.*registered|exists/i.test(created.error.message)) {
      // find existing by email
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const found = list?.users?.find((u) => (u.email || "").toLowerCase() === email);
      if (!found) return json({ error: created.error.message }, 400, c);
      uid = found.id;
      reused = true;
    } else {
      return json({ error: created.error.message }, 400, c);
    }
  } else {
    uid = created.data.user!.id;
  }

  // 4) Upsert the profile row (service role bypasses RLS + the role-escalation guard).
  const profileRow: Record<string, unknown> = {
    id: uid,
    kind,
    role,
    owner_id: body.ownerUid ?? null,
    email,
    first_name: body.firstName ?? null,
    last_name: body.lastName ?? null,
    display_name: body.displayName ??
      ([body.firstName, body.lastName].filter(Boolean).join(" ") || null),
    status: "active",
    agreement_accepted: body.agreementAccepted ?? false,
  };
  const { error: pErr } = await admin.from("profiles").upsert(profileRow, { onConflict: "id" });
  if (pErr) return json({ error: pErr.message }, 400, c);

  return json({ uid, reused }, 200, c);
});
