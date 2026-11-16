// ═══════════════════════════════════════
// Edge Function: admin-set-worker-password (WorkMate Stage 3b-a, Q3)
//
// The main owner sets a temporary password for ONE active worker or team leader
// of their company, who then changes it at their next WorkMate sign-in. It uses
// the service_role key, which never reaches a browser. The password is generated
// here, returned once to the main owner, and never stored or logged:
// wk_password_events (0111) records only who reset whom, and when.
//
// A password change through the admin API logs the user out of EVERY session
// (GoTrue UpdatePassword with no session id). Their phones must sign in again.
// Unsent attendance stays on the phone and sends after that, so the rollout
// checks the old app's "Not sent yet" BEFORE any reset.
//
// POST body: { worker_id }
// → 200 { temporary_password, worker_no, name, marked }
//       marked false: the password is set, but "must change" was not recorded.
// → 4xx/5xx { error: CODE }  AUTH_REQUIRED | OWNER_ONLY | BAD_REQUEST |
//                            NOT_A_WORKER | ACCOUNT_INACTIVE | RESET_FAILED | SERVER_ERROR
//
// Deploy: supabase functions deploy admin-set-worker-password
//         (both files: index.ts and password-core.mjs)
// ═══════════════════════════════════════
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decideReset, makeTemporaryPassword } from "./password-core.mjs";

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
  new Response(JSON.stringify(b), {
    status,
    headers: { ...c, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PROFILE = "id, role, owner_id, status, display_name, worker_no";

Deno.serve(async (req) => {
  const c = cors(req.headers.get("Origin") || "");
  if (req.method === "OPTIONS") return new Response("ok", { headers: c });
  if (req.method !== "POST") return json({ error: "BAD_REQUEST" }, 405, c);

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // 1) Who is asking, from their own session.
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "AUTH_REQUIRED" }, 401, c);
    const { data: who, error: whoErr } = await admin.auth.getUser(jwt);
    if (whoErr || !who?.user) return json({ error: "AUTH_REQUIRED" }, 401, c);
    const { data: caller } = await admin.from("profiles").select(PROFILE).eq("id", who.user.id).maybeSingle();

    // 2) For whom.
    let body: { worker_id?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ error: "BAD_REQUEST" }, 400, c);
    }
    const workerId = typeof body.worker_id === "string" ? body.worker_id : "";
    if (!/^[0-9a-f-]{36}$/i.test(workerId)) return json({ error: "BAD_REQUEST" }, 400, c);
    const { data: target } = await admin.from("profiles").select(PROFILE).eq("id", workerId).maybeSingle();

    const decision = decideReset({ caller, target });
    if (!decision.ok) return json({ error: decision.code }, decision.status, c);

    // 3) Recorded BEFORE the password changes: no reset without a trace.
    const event = (kind: string) =>
      admin.from("wk_password_events").insert({ owner_id: caller.id, worker_id: workerId, kind, actor_id: caller.id });
    const asked = await event("requested");
    if (asked.error) return json({ error: "SERVER_ERROR" }, 500, c);

    // 4) The change itself.
    const password = makeTemporaryPassword((n: number) => crypto.getRandomValues(new Uint8Array(n)));
    const { error: setErr } = await admin.auth.admin.updateUserById(workerId, { password });
    if (setErr) {
      await event("failed");
      return json({ error: "RESET_FAILED" }, 502, c);
    }

    // 5) From here the worker must change it at their next WorkMate sign-in.
    const marked = await event("temporary_set");
    return json({
      temporary_password: password,
      worker_no: target.worker_no,
      name: target.display_name,
      marked: !marked.error,
    }, 200, c);
  } catch {
    // Never the error's text: nothing about a password may reach a log or a reply.
    return json({ error: "SERVER_ERROR" }, 500, c);
  }
});
