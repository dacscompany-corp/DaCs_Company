// ════════════════════════════════════════════════════════════════════
// Edge Function: admin-create-user
// Replaces the old "secondary Firebase app" trick. An owner/staff member
// creates an auth user (admin / client / construction_client) WITHOUT
// disturbing their own session. Uses the service_role key (never shipped
// to the browser) and gates the caller to owner/staff.
//
// POST body: { email, password, kind, role?, ownerUid?, firstName?, lastName?,
//              displayName?, agreementAccepted? }
// → 200 { uid }   |   409 { error } when the email already has an auth user
//                 |   4xx { error }
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

  // 3) Create the auth user. A duplicate email REFUSES the whole request.
  //
  // This used to reuse the existing uid and carry on. It could not set the
  // password while doing so -- createUser had already failed -- so the
  // caller was told the account was created with the password they typed
  // while auth.users quietly kept the old one. The person was then handed
  // credentials that could never work, and nothing in the admin UI showed
  // it: the profile row looked perfect because step 4 had written it.
  //
  // Setting the password on the reuse path would be worse, not better. It
  // would turn this form into account takeover: type a colleague's email,
  // choose a password, and their account is yours. The upsert below is the
  // same weapon by another route -- it rewrites role, status and owner_id,
  // so "Add Employee" on an owner's address demotes them to 'worker'.
  //
  // Both stop here, before a single row is written.
  const created = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (created.error) {
    const duplicate = /already.*registered|exists/i.test(created.error.message);
    return json({ error: created.error.message }, duplicate ? 409 : 400, c);
  }
  const uid = created.data.user!.id;

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

  return json({ uid }, 200, c);
});
