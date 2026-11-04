// ═══════════════════════════════════════
// Who may set a temporary password, for whom, and what it looks like. Kept free
// of Deno and Supabase so tests/worker-password.test.js can run it under plain
// Node (CI runs Node 20, which cannot load TypeScript).
// ═══════════════════════════════════════

const WORKER_ROLES = ['worker', 'teamLeader'];
const isActive = (status) => (status ?? 'active') === 'active';

/** The main owner: owner role, no owner above them, active. allowed_modules plays no part (pm_main_owner_id, 0098). */
export function isMainOwner(p) {
  return !!p && p.role === 'owner' && p.owner_id == null && isActive(p.status);
}

/**
 * @param {{caller: {id: string, role: string|null, owner_id: string|null, status: string|null}|null,
 *          target: {id: string, role: string|null, owner_id: string|null, status: string|null}|null}} p
 * @returns {{ok: true} | {ok: false, status: number, code: string}}
 */
export function decideReset({ caller, target }) {
  if (!isMainOwner(caller)) return { ok: false, status: 403, code: 'OWNER_ONLY' };
  // Crew of this company only: never an owner, staff, client or partner account.
  if (!target || !WORKER_ROLES.includes(target.role ?? '') || target.owner_id !== caller.id) {
    return { ok: false, status: 404, code: 'NOT_A_WORKER' };
  }
  if (!isActive(target.status)) return { ok: false, status: 409, code: 'ACCOUNT_INACTIVE' };
  return { ok: true };
}

// No 0/O, 1/l/I: it is read out to a person on site.
const UPPER = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const LOWER = 'abcdefghjkmnpqrstuvwxyz';
const DIGIT = '23456789';

// One character with no bias: bytes past the last whole multiple are thrown away.
function pick(alphabet, nextByte) {
  const limit = 256 - (256 % alphabet.length);
  for (;;) {
    const b = nextByte();
    if (b < limit) return alphabet[b % alphabet.length];
  }
}

/**
 * "Kp7m-Tq4z-Hn3w": three groups of an upper case letter, a digit and two lower
 * case letters. WorkMate's rule is 8 characters or more.
 * @param {(n: number) => Uint8Array} randomBytes a source of secure random bytes
 */
export function makeTemporaryPassword(randomBytes) {
  let buffer = randomBytes(64);
  let at = 0;
  const nextByte = () => {
    if (at >= buffer.length) { buffer = randomBytes(64); at = 0; }
    return buffer[at++];
  };
  const group = () => pick(UPPER, nextByte) + pick(LOWER, nextByte) + pick(DIGIT, nextByte) + pick(LOWER, nextByte);
  return [group(), group(), group()].join('-');
}
