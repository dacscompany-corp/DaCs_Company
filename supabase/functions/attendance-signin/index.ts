// ════════════════════════════════════════════════════════════════════
// Edge Function: attendance-signin
//
// Signs a construction worker into the native Android attendance app —
// and, from DAC'S WorkMate only (x-dacs-app: workmate), an office account
// that may buy (WorkMate Stage 2A-3a, migration 0101).
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
//    The rule lives in eligibility.mjs (tests/signin-eligibility.test.js):
//      old app (no header) — workers and team leaders only, exactly as
//        before 0101;
//      WorkMate — workers and team leaders as "worker", plus any account
//        pur_signin_can_buy (0101) says may buy, as "buyer" (the same
//        answer as the server's pur_buyer()); everyone else
//        NO_WORKMATE_ACCESS.
//    A refusal revokes only the session it just made (an office account
//    that tried the phone stays signed in to Dacs Web), except a
//    deactivated account, which loses every session.
//
// ── NO CORS HEADERS, deliberately. This endpoint is for the native app.
//    Without Access-Control-Allow-Origin a browser cannot read the
//    response, which is exactly right: the web portals have their own
//    login, with the captcha still in front of it.
//
// POST { email, password }
//   → 200 { session: { access_token, refresh_token, expires_in, token_type },
//           worker:  { id, email, display_name, position, worker_no, role, status } }
//         + access: "worker" | "buyer"            (WorkMate only)
//   → 4xx { error: CODE }   INVALID_CREDENTIALS | NOT_A_WORKER (old app) |
//                           NO_WORKMATE_ACCESS (WorkMate) |
//                           ACCOUNT_INACTIVE | TOO_MANY_ATTEMPTS | BAD_REQUEST
//   → 5xx { error: "SERVER_ERROR" }
//
// The app maps those codes to bilingual copy (LoginFailure.forCode).
// Changing or adding one means changing that mapping too.
//
// Deploy: supabase functions deploy attendance-signin
// ════════════════════════════════════════════════════════════════════
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decideAccess, isWorkMate, needsBuyerCheck, revokeScope } from "./eligibility.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

  // 0082: WorkMate says who it is; the old app sends nothing.
  const app = req.headers.get("x-dacs-app");
  const fromWorkMate = isWorkMate(app);

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

    // The CALLER is told one thing and the LOG is told another, on
    // purpose. Every refusal looks identical from outside, because the
    // difference between "no such account" and "wrong password" tells an
    // attacker which emails are real. But the log has to be specific:
    // this function's whole premise is that a service_role caller skips
    // the captcha check, and if that ever stops being true every login
    // would fail as "wrong password" with nothing to point at it. Never
    // logs the password, only the reason GoTrue gave.
    console.error(
      `sign-in refused for ${email}: ${authErr?.code ?? "no-session"} / ${authErr?.message ?? ""}`,
    );

    return fail("INVALID_CREDENTIALS", 401);
  }

  const session = auth.session;

  // Tokens exist from here on. Any refusal below must revoke them.
  const revoke = async (code: string) => {
    const scope = revokeScope(code);
    try {
      await admin.auth.admin.signOut(session.access_token, scope);
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
    await revoke("SERVER_ERROR");
    return fail("SERVER_ERROR", 500);
  }

  const role = profile?.role ?? null;
  // coalesce(status,'active') — matches the RPCs exactly (eligibility.mjs).
  // Older profiles rows carry no status, and locking those workers out would
  // be a bug attendance_time_in does not have.
  const status = profile?.status ?? null;

  // ── 4. May this account buy? (WorkMate, active non-workers only) ──
  let canBuy = false;
  if (profile && needsBuyerCheck({ role, status, app })) {
    const { data: buys, error: buyErr } = await admin.rpc(
      "pur_signin_can_buy", { p_user: auth.user.id },
    );
    if (buyErr) {
      console.error("buyer check failed", buyErr);
      await revoke("SERVER_ERROR");
      return fail("SERVER_ERROR", 500);
    }
    canBuy = buys === true;
  }

  const decision = profile
    ? decideAccess({ role, status, app, canBuy })
    : { ok: false as const, code: fromWorkMate ? "NO_WORKMATE_ACCESS" : "NOT_A_WORKER" };

  await record(true); // the password WAS right; not a brute-force signal
  if (!decision.ok) {
    await revoke(decision.code);
    return fail(decision.code, 403);
  }

  const payload = {
    session: {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
      token_type: session.token_type,
    },
    worker: profile,
  };
  // The old app gets exactly the old shape.
  return json(fromWorkMate ? { ...payload, access: decision.access } : payload, 200);
});
