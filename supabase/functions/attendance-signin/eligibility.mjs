// ════════════════════════════════════════════════════════════════════
// Who the attendance-signin function lets in — the one decision, kept
// free of Deno and Supabase so tests/signin-eligibility.test.js can run it
// under plain Node (CI runs Node 20, which cannot load TypeScript).
//
// The old DACS Attendance app sends no x-dacs-app header: it gets exactly
// the pre-0101 answer for every account. DAC'S WorkMate sends
// `x-dacs-app: workmate` (0082): it also lets in an account that may buy
// (pur_signin_can_buy, 0101 — the server's own pur_buyer() rule), as a
// "buyer". WorkMate Stage 2A-3a: Q1, R1, R3, R9.
// ════════════════════════════════════════════════════════════════════

/** Same rule as attendance_time_in (0050 §8): a team leader records attendance like a worker. */
export const WORKER_ROLES = ['worker', 'teamLeader'];

/** The header test the server uses (0082): trimmed, any case. */
export function isWorkMate(app) {
  return String(app ?? '').trim().toLowerCase() === 'workmate';
}

const isWorkerRole = (role) => WORKER_ROLES.includes(role ?? '');
// coalesce(status, 'active') — matches the RPCs: older profiles carry no status.
const isActive = (status) => (status ?? 'active') === 'active';

/**
 * Whether to ask pur_signin_can_buy at all: only when its answer can change
 * the outcome (an active non-worker signing in from WorkMate).
 * @param {{role: string|null, status: string|null, app: string|null}} p
 */
export function needsBuyerCheck({ role, status, app }) {
  return isWorkMate(app) && !isWorkerRole(role) && isActive(status);
}

/**
 * @param {{role: string|null, status: string|null, app: string|null, canBuy: boolean}} p
 * @returns {{ok: true, access: 'worker'|'buyer'} | {ok: false, code: string}}
 */
export function decideAccess({ role, status, app, canBuy }) {
  if (!isWorkMate(app)) {
    // The old app, byte for byte as before 0101: role first, then status.
    if (!isWorkerRole(role)) return { ok: false, code: 'NOT_A_WORKER' };
    if (!isActive(status)) return { ok: false, code: 'ACCOUNT_INACTIVE' };
    return { ok: true, access: 'worker' };
  }
  if (!isActive(status)) return { ok: false, code: 'ACCOUNT_INACTIVE' };
  if (isWorkerRole(role)) return { ok: true, access: 'worker' };
  if (canBuy === true) return { ok: true, access: 'buyer' };
  return { ok: false, code: 'NO_WORKMATE_ACCESS' };
}

/**
 * What a refusal revokes (R9). A deactivated account loses every session,
 * as before. Any other refusal revokes only the session this sign-in just
 * made: an office account that tried the phone stays signed in to Dacs Web.
 */
export function revokeScope(code) {
  return code === 'ACCOUNT_INACTIVE' ? 'global' : 'local';
}
