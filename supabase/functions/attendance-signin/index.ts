// ════════════════════════════════════════════════════════════════════
// Edge Function: attendance-signin
//
// Signs a construction worker into the native Android attendance app.
//
// ── WHY THE APP DOES NOT CALL /auth/v1/token DIRECTLY. This project
//    enforces Cloudflare Turnstile on auth (Auth → Bot & Abuse
//    Protection). Turnstile has no native Android SDK — the only
//    client-side way to solve it is a WebView loading a web page, and
//    the worker app is a native APK that should not depend on a page on
//    our website to log in. Requests made with the service_role key skip
//    the captcha check, so the sign-in happens here instead and the app
//    makes one ordinary HTTPS call.
//
// ── WHAT REPLACES THE CAPTCHA. 0052's throttle. Note that GoTrue's own
//    per-IP auth rate limit is useless for this path: it would see THIS
//    function's IP for every worker. The throttle keys on the email and
//    on the caller's forwarded IP instead.
//
// ── ELIGIBILITY IS DECIDED HERE, not in the app. A deactivated account
//    or a non-worker account never receives tokens at all, and the ones
//    that were minted along the way are revoked before we answer. The
//    app therefore cannot end up holding a session it should not have.
//
// ── NO CORS HEADERS, deliberately. This endpoint is for the native app.
//    Without Access-Control-Allow-Origin a browser cannot read the
//    response, which is exactly right: the web portals have their own
//    login, with the captcha still in front of it.
//
// POST { email, password }
//   → 200 { session: { access_token, refresh_token, expires_in, token_type },
//           worker:  { id, email, display_name, position, worker_no, role, status } }
//   → 4xx { error: CODE }   INVALID_CREDENTIALS | NOT_A_WORKER |
//                           ACCOUNT_INACTIVE | TOO_MANY_ATTEMPTS | BAD_REQUEST
//   → 5xx { error: "SERVER_ERROR" }
//
// The app maps those codes to bilingual copy (LoginFailure.forCode).
// Changing or adding one means changing that mapping too.
//
// Deploy: supabase functions deploy attendance-signin
// ════════════════════════════════════════════════════════════════════
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Same rule as attendance_time_in (0050 §8): teamLeader records
// attendance exactly like a worker does.
const WORKER_ROLES = ["worker", "teamLeader"];

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const fail = (code: string, status: number) => json({ error: code }, status);

Deno.serve(async (req) => {
  if (req.method !== "POST") return fail("BAD_REQUEST", 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("BAD_REQUEST", 400);
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!email || !password) return fail("BAD_REQUEST", 400);

  // First hop only: the rest of x-forwarded-for is caller-supplied and
  // trivially spoofed, so throttling on it would be throttling on a
  // string the attacker picks.
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── 1. Throttle ───────────────────────────────────────────────────
  const { data: throttled, error: throttleErr } = await admin.rpc(
    "attendance_signin_is_throttled",
    { p_email: email, p_ip: ip },
  );
  if (throttleErr) {
    console.error("throttle check failed", throttleErr);
    return fail("SERVER_ERROR", 500);
  }
  if (throttled === true) return fail("TOO_MANY_ATTEMPTS", 429);

  const record = (succeeded: boolean) =>
    admin.rpc("attendance_signin_record", {
      p_email: email,
      p_ip: ip,
      p_succeeded: succeeded,
    });

  // ── 2. The actual sign-in ─────────────────────────────────────────
  // This client carries the service_role key, which is what lets the
  // password grant through without a captcha token.
  const { data: auth, error: authErr } = await admin.auth.signInWithPassword({
    email,
    password,
  });

  if (authErr || !auth?.session || !auth.user) {
    await record(false);
    // Never distinguish "no such account" from "wrong password": that
    // difference tells an attacker which emails are real.
    return fail("INVALID_CREDENTIALS", 401);
  }

  const session = auth.session;

  // Tokens exist from here on. Any refusal below must revoke them.
  const revoke = async () => {
    try {
      await admin.auth.admin.signOut(session.access_token, "global");
    } catch (e) {
      console.error("could not revoke session for refused sign-in", e);
    }
  };

  // ── 3. Eligibility, from the profile row ──────────────────────────
  const { data: profile, error: profErr } = await admin
    .from("profiles")
    .select("id,email,display_name,position,worker_no,role,status")
    .eq("id", auth.user.id)
    .maybeSingle();

  if (profErr) {
    console.error("profile read failed", profErr);
    await revoke();
    return fail("SERVER_ERROR", 500);
  }

  if (!profile || !WORKER_ROLES.includes(profile.role ?? "")) {
    await record(true); // the password WAS right; not a brute-force signal
    await revoke();
    return fail("NOT_A_WORKER", 403);
  }

  // coalesce(status,'active') — matches the RPCs exactly. Older profiles
  // rows carry no status, and locking those workers out would be a bug
  // attendance_time_in does not have.
  if ((profile.status ?? "active") !== "active") {
    await record(true);
    await revoke();
    return fail("ACCOUNT_INACTIVE", 403);
  }

  await record(true);

  return json({
    session: {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
      token_type: session.token_type,
    },
    worker: profile,
  }, 200);
});
