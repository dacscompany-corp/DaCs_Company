// ════════════════════════════════════════════════════════════════════
// DAC's — Supabase config + Firestore-compatibility shim
// Replaces js/firebase-config.js. Exposes the SAME globals the app uses:
//   db    — Firestore-like (collection/doc/where/orderBy/onSnapshot/batch…)
//   auth  — Firebase-Auth-like (onAuthStateChanged/signIn/signOut/currentUser…)
//   firebase.firestore.FieldValue.serverTimestamp() / firebase.firestore.Timestamp
//   storage — minimal Supabase Storage wrapper
// so existing modules keep working with only the nested-write sites hand-edited.
//
// Requires the supabase-js v2 UMD bundle loaded BEFORE this file.
// ════════════════════════════════════════════════════════════════════

/* eslint-disable no-var */

// ── 1. Client ────────────────────────────────────────────────────────
const SUPABASE_URL      = 'https://hqbgduyonlbbsvjuapre.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhxYmdkdXlvbmxiYnN2anVhcHJlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2Mjc3NDEsImV4cCI6MjA5NjIwMzc0MX0.sDKSroNIm-1Lip6ueq2lN1VTsvO1g4mT7Rf_WZ5AxWo';
const ADMIN_CREATE_USER_FN = SUPABASE_URL + '/functions/v1/admin-create-user';

// persistSession:true → the session is kept in localStorage and survives browser
// restarts (users stay logged in by design). The legacy auth.setPersistence(SESSION)
// calls in the login handlers are intentionally no-ops and have been removed.
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});
window.sbClient = sb;
window.ADMIN_CREATE_USER_FN = ADMIN_CREATE_USER_FN;

// ── 2. camel ↔ snake helpers ─────────────────────────────────────────
const camelToSnake = (s) => s.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
const snakeToCamel = (s) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

// ── 3. Timestamp + FieldValue sentinels ──────────────────────────────
const SERVER_TS = Symbol('serverTimestamp');
class TS {
  constructor(ms) { this._ms = ms; this.seconds = Math.floor(ms / 1000);
                    this.nanoseconds = (ms % 1000) * 1e6; }
  toDate()   { return new Date(this._ms); }
  toMillis() { return this._ms; }
  valueOf()  { return this._ms; }
  static now()        { return new TS(Date.now()); }
  static fromDate(d)  { return new TS(d.getTime()); }
  static fromMillis(m){ return new TS(m); }
}
function wrapTs(v) {
  if (v == null) return v;
  if (v instanceof TS) return v;
  const d = (v instanceof Date) ? v : new Date(v);
  return isNaN(d.getTime()) ? v : new TS(d.getTime());
}
function tsToISO(v) {
  if (v === SERVER_TS) return new Date().toISOString();
  if (v instanceof TS)   return v.toDate().toISOString();
  if (v instanceof Date) return v.toISOString();
  return v;
}

// ── 4. Collection registry ───────────────────────────────────────────
// table     : Postgres table
// rename    : { camelField: snake_column }  (overrides for divergent names)
// ts        : camel fields that are timestamps (wrapped on read, ISO on write)
// json      : camel fields stored as jsonb (passed through as-is)
// kind      : fixed `kind` filter/inject (profiles split)
// idField   : PK column when the doc id is NOT `id` (e.g. folder_budgets.folder_id)
// kv        : key/value table — doc data lives in `value` jsonb, doc id = `key`
// children  : { camelArr: { table, fk, orderBy?, rename?, idCol? } }
const OWNER = { userId: 'owner_id' };
const REG = {
  users:                    { table: 'profiles', kind: 'admin',               rename: { ownerUid: 'owner_id' }, ts: ['createdAt', 'updatedAt', 'agreementAcceptedAt'] },
  clientUsers:              { table: 'profiles', kind: 'client',              rename: { ownerUid: 'owner_id' }, ts: ['createdAt', 'updatedAt', 'agreementAcceptedAt'] },
  constructionClientUsers:  { table: 'profiles', kind: 'construction_client', rename: { ownerUid: 'owner_id' }, ts: ['createdAt', 'updatedAt', 'agreementAcceptedAt', 'partnerAgreementAcceptedAt'] },

  folders:        { table: 'folders',        rename: OWNER, ts: ['createdAt', 'updatedAt'] },
  folderBudgets:  { table: 'folder_budgets', rename: OWNER, idField: 'folder_id' },
  projects:       { table: 'projects',       rename: OWNER, ts: ['createdAt', 'updatedAt'] },
  projectBudgets: { table: 'project_budgets',rename: OWNER, idField: 'project_id' },
  expenses:       { table: 'expenses',       rename: OWNER, ts: ['createdAt', 'updatedAt'] },
  payroll:        { table: 'payroll',        rename: OWNER, ts: ['createdAt', 'updatedAt'], json: ['receiptImages'] },
  laborContracts: { table: 'labor_contracts', rename: OWNER, ts: ['createdAt', 'updatedAt', 'agreementSignedAt'], json: ['capHistory'] },
  pushSubscriptions:{ table: 'push_subscriptions', rename: OWNER, ts: ['createdAt'] },
  categories:     { table: 'categories',     rename: OWNER, ts: ['createdAt'] },
  overheadExpenses:{ table: 'overhead_expenses', rename: OWNER, ts: ['createdAt'] },
  // Client Reimbursement Tracker (0041) — owner-advanced project expenses and
  // whether the client paid them back. Documentation only: no money math, no
  // invoice/payment side effects. Owner-only by RLS.
  reimbursements: { table: 'reimbursements', rename: OWNER, ts: ['createdAt', 'updatedAt'], json: ['history'] },
  // Warranty Retention register + fund (0043) — the retention figure frozen
  // when a construction project is closed out as COMPLETED, and the draws
  // made against the accumulated pool. Documentation only, exactly like
  // reimbursements above: no money math, no invoice/payment side effects.
  // Owner-only by RLS. `releaseDue` is a plain date column, not a timestamp,
  // so it stays out of `ts` (wrapping it would shift it a day in UTC+8).
  warrantyRetentions:   { table: 'warranty_retentions', rename: OWNER,
                          ts: ['createdAt', 'updatedAt', 'completedAt', 'releasedAt'], json: ['history'] },
  warrantyFundExpenses: { table: 'warranty_fund_expenses', rename: OWNER,
                          ts: ['createdAt', 'updatedAt'], json: ['history'] },

  boqDocuments:   { table: 'boq_documents', rename: OWNER, ts: ['createdAt', 'updatedAt'], json: ['costItems', 'terms'] },
  boqTemplates:   { table: 'boq_templates', rename: OWNER, ts: ['createdAt'], json: ['costItems'] },
  quotations:         { table: 'quotations',          rename: OWNER, ts: ['createdAt','updatedAt'], json: ['sections','terms','history'] },
  quotationRevisions: { table: 'quotation_revisions', rename: OWNER, ts: ['createdAt','sentAt'],    json: ['snapshot'] },
  quotationPresets:   { table: 'quotation_presets',   rename: OWNER, ts: ['createdAt','updatedAt'], json: ['data'] },
  additionalWorks:{ table: 'additional_works', rename: OWNER, ts: ['createdAt', 'updatedAt'], json: ['categories'] },

  invoices:       { table: 'invoices', rename: OWNER, ts: ['createdAt', 'updatedAt'], json: ['paymentDetails'],
                    children: { items: { table: 'invoice_items', fk: 'invoice_id', orderBy: 'position', rename: { unitPrice: 'unit_price' } } } },
  laborInvoices:  { table: 'labor_invoices', rename: OWNER, ts: ['createdAt', 'updatedAt'], json: ['paymentDetails'],
                    children: { items: { table: 'labor_invoice_items', fk: 'labor_invoice_id', orderBy: 'position', rename: { unitPrice: 'unit_price' } } } },

  paymentRequests:{ table: 'payment_requests', rename: { ownerUid: 'owner_id' },
                    ts: ['createdAt', 'updatedAt', 'submittedAt', 'verifiedAt', 'rejectedAt',
                         'partialRequestedAt', 'partialApprovedAt', 'dueDate'],
                    json: ['invoiceSnapshot'] },

  constructionProjects: { table: 'construction_projects', ts: ['createdAt', 'updatedAt'] },

  requests:       { table: 'requests', rename: { requestedBy: 'requested_by', batchId: 'batch_id', isUrgent: 'is_urgent', isEditable: 'is_editable' },
                    ts: ['createdAt', 'updatedAt'],
                    children: { items: { table: 'request_items', fk: 'request_id', orderBy: 'position', idCol: 'legacy_item_id',
                                         rename: { purchasedDate: 'purchased_date', deliveredDate: 'delivered_date' } } } },
  batches:        { table: 'batches', rename: { deliveryDate: 'delivery_date', cutoffDate: 'cutoff_date', createdBy: 'created_by', totalItems: 'total_items', closedAt: 'closed_at', closedBy: 'closed_by' },
                    ts: ['deliveryDate', 'cutoffDate', 'createdAt', 'closedAt', 'updatedAt'] },
  inventory:      { table: 'inventory', rename: { itemName: 'item_name', currentStock: 'current_stock', minStock: 'min_stock', lastUpdated: 'last_updated', lastAdjustedBy: 'last_adjusted_by' },
                    ts: ['lastUpdated', 'createdAt'] },

  sowaRequests:        { table: 'sowa_requests', ts: ['requestedAt'] },
  terminationRequests: { table: 'termination_requests', ts: ['requestedAt'] },
  agreementEvents:     { table: 'agreement_events', ts: ['acceptedAt'] },   // append-only e-sign audit log (0021)

  clientErrors:   { table: 'client_errors', ts: ['at'] },   // telemetry (0028); owner read/delete only

  expenseInbox:   { table: 'expense_inbox', ts: ['createdAt', 'updatedAt', 'encodedAt'] },   // admin→staff receipt handoff queue (0031); no amounts

  notifications:  { table: 'notifications', ts: ['createdAt'] },  // only via /items subpath
  appointments:   { table: 'appointments', ts: ['createdAt', 'updatedAt'] },
  testimonials:   { table: 'testimonials', ts: ['createdAt'] },
  settings:       { table: 'settings', kv: true },
  stats:          { table: 'stats', kv: true },
};
// Subcollections keyed by `${parent}/${sub}` → table + parent FK column
const SUBREG = {
  'constructionProjects/weeklyBills':       { table: 'weekly_bills',      parentField: 'project_id', ts: ['createdAt', 'updatedAt'] },
  'constructionProjects/procurementList':   { table: 'procurement_items', parentField: 'project_id', ts: ['createdAt', 'updatedAt'] },
  'constructionProjects/revolvingFund':     { table: 'revolving_funds',   parentField: 'project_id', singleton: true },
  'constructionProjects/revolvingFundExpenses':      { table: 'revolving_fund_expenses',       parentField: 'project_id', ts: ['createdAt'] },
  'constructionProjects/revolvingFundReplenishments':{ table: 'revolving_fund_replenishments', parentField: 'project_id', ts: ['createdAt'] },
  'constructionProjects/revolvingFundRequests':      { table: 'revolving_fund_requests',        parentField: 'project_id', ts: ['receivedAt', 'createdAt', 'updatedAt'] },
  'constructionProjects/laborContracts':             { table: 'pm_labor_contracts',             parentField: 'project_id', ts: ['createdAt', 'updatedAt', 'agreementSignedAt'], json: ['capHistory'] },
  'constructionProjects/dailyLogs':            { table: 'daily_logs',            parentField: 'project_id', ts: ['createdAt', 'updatedAt'], jsonbData: true },
  'constructionProjects/milestones':           { table: 'milestones',            parentField: 'project_id', ts: ['createdAt', 'updatedAt'], jsonbData: true },
  'constructionProjects/accomplishmentReports':{ table: 'accomplishment_reports',parentField: 'project_id', ts: ['createdAt', 'updatedAt'], jsonbData: true },
  'constructionProjects/walkthroughs':         { table: 'walkthroughs',          parentField: 'project_id', ts: ['createdAt', 'updatedAt'], jsonbData: true },
  'constructionProjects/partnerAgreements':    { table: 'partner_agreements',    parentField: 'project_id', ts: ['createdAt', 'updatedAt'], jsonbData: true },
  'notifications/items':                        { table: 'notifications',         parentField: 'user_id',    ts: ['createdAt'] },
};

// ── 5. Row <-> doc conversion ────────────────────────────────────────
function fieldToCol(cfg, field) { return (cfg.rename && cfg.rename[field]) || camelToSnake(field); }
function buildReverse(cfg) {
  const rev = {};
  if (cfg.rename) for (const k in cfg.rename) rev[cfg.rename[k]] = k;
  return rev;
}
// doc data (camel) → row (snake), converting ts/json/sentinels
function toRow(cfg, data) {
  if (cfg.kv) return null; // handled specially by caller
  const tsSet = new Set(cfg.ts || []);
  // jsonb-blob tables (milestones, accomplishment_reports): all non-system
  // fields live in a single `data` jsonb column; only ts fields are real columns.
  if (cfg.jsonbData) {
    const row = {};
    const blob = {};
    for (const k in data) {
      if (k === 'id') continue;
      let v = data[k];
      if (tsSet.has(k)) { row[camelToSnake(k)] = tsToISO(v); continue; }
      if (v === SERVER_TS) v = new Date().toISOString();
      blob[k] = v;
    }
    row.data = blob;
    return row;
  }
  const row = {};
  for (const k in data) {
    if (cfg.children && cfg.children[k]) continue;           // children handled separately
    const col = fieldToCol(cfg, k);
    let v = data[k];
    if (tsSet.has(k)) v = tsToISO(v);
    else if (v === SERVER_TS) v = new Date().toISOString();
    row[col] = v;
  }
  if (cfg.kind) row.kind = cfg.kind;
  return row;
}
// row (snake) → doc data (camel), wrapping ts + mapping children
function fromRow(cfg, row) {
  // jsonb-blob tables: spread `data`, then wrap timestamp columns.
  if (cfg.jsonbData) {
    const out = { ...(row.data || {}) };
    for (const f of (cfg.ts || [])) {
      const col = camelToSnake(f);
      if (col in row) out[f] = wrapTs(row[col]);
    }
    return out;
  }
  const rev = buildReverse(cfg);
  const tsCols = new Set((cfg.ts || []).map((f) => fieldToCol(cfg, f)));
  const out = {};
  for (const col in row) {
    if (col === 'legacy_id' || col === 'kind') continue;
    if (cfg.children && Object.values(cfg.children).some((c) => col === c.table)) continue;
    const camel = rev[col] || snakeToCamel(col);
    out[camel] = tsCols.has(col) ? wrapTs(row[col]) : row[col];
  }
  // children → arrays
  if (cfg.children) {
    for (const arrName in cfg.children) {
      const c = cfg.children[arrName];
      const rows = row[c.table] || [];
      const crev = {}; if (c.rename) for (const k in c.rename) crev[c.rename[k]] = k;
      out[arrName] = rows
        .slice()
        .sort((a, b) => (a.position || 0) - (b.position || 0))
        .map((r) => {
          const o = {};
          for (const col in r) {
            if (col === c.fk || col === 'position') continue;
            if (col === 'id') { o.id = (c.idCol && r[c.idCol]) ? r[c.idCol] : r.id; continue; }
            if (col === c.idCol) continue;
            o[crev[col] || snakeToCamel(col)] = r[col];
          }
          if (!('id' in o)) o.id = r.id;
          return o;
        });
    }
  }
  return out;
}

// ── 6. Snapshot wrappers ─────────────────────────────────────────────
function docSnap(cfg, id, row) {
  return { id, exists: !!row, data: () => (row ? fromRow(cfg, row) : undefined), ref: null };
}
function querySnap(cfg, rows) {
  const docs = rows.map((r) => ({ id: r.id ?? r[cfg.idField], data: () => fromRow(cfg, r), exists: true, ref: null }));
  return { docs, empty: docs.length === 0, size: docs.length, forEach: (fn) => docs.forEach(fn) };
}

// ── 7. Query / Collection / Doc refs ─────────────────────────────────
const OPMAP = { '==': 'eq', '!=': 'neq', '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte' };

// Client-side where/order for jsonb-blob tables (filtering/sorting on jsonb
// paths in PostgREST is brittle; these collections are small per-project, so
// we fetch by parent and filter/sort in JS).
function _jbUnwrap(v) { return (v && typeof v.toMillis === 'function') ? v.toMillis() : v; }
function _jbCmp(a, op, b) {
  a = _jbUnwrap(a); b = _jbUnwrap(b);
  switch (op) {
    case '==': return b === null ? (a === null || a === undefined) : a === b;
    case '!=': return a !== b;
    case '>':  return a > b;
    case '>=': return a >= b;
    case '<':  return a < b;
    case '<=': return a <= b;
    case 'in': return Array.isArray(b) && b.includes(a);
    default:   return a === b;
  }
}
function _jbOrd(a, b) {
  a = _jbUnwrap(a); b = _jbUnwrap(b);
  const na = Number(a), nb = Number(b);
  if (a != null && b != null && !isNaN(na) && !isNaN(nb)) return na - nb;
  return String(a == null ? '' : a).localeCompare(String(b == null ? '' : b));
}

class Query {
  constructor(cfg, ctx) { this.cfg = cfg; this.ctx = ctx; this._w = []; this._o = []; this._lim = null; }
  _clone() { const q = new Query(this.cfg, this.ctx); q._w = [...this._w]; q._o = [...this._o]; q._lim = this._lim; return q; }
  where(f, op, v) { const q = this._clone(); q._w.push([f, op, v]); return q; }
  orderBy(f, dir) { const q = this._clone(); q._o.push([f, dir || 'asc']); return q; }
  limit(n) { const q = this._clone(); q._lim = n; return q; }

  _select() {
    const c = this.cfg;
    let sel = '*';
    if (c.children) sel = '*, ' + Object.values(c.children).map((x) => `${x.table}(*)`).join(', ');
    let qb = sb.from(c.table).select(sel);
    if (c.kind) qb = qb.eq('kind', c.kind);
    if (this.ctx) qb = qb.eq(this.ctx.col, this.ctx.val);     // subcollection parent filter
    for (const [f, op, v] of this._w) {
      const col = fieldToCol(c, f);
      if (op === 'in') qb = qb.in(col, v);
      else if (op === '==' && v === null) qb = qb.is(col, null);
      else qb = qb[OPMAP[op] || 'eq'](col, v);
    }
    for (const [f, dir] of this._o) qb = qb.order(fieldToCol(c, f), { ascending: dir !== 'desc' });
    if (this._lim != null) qb = qb.limit(this._lim);
    return qb;
  }
  async get() {
    const c = this.cfg;
    if (c.jsonbData) {
      let qb = sb.from(c.table).select('*');
      if (c.kind) qb = qb.eq('kind', c.kind);
      if (this.ctx) qb = qb.eq(this.ctx.col, this.ctx.val);
      const { data, error } = await qb;
      if (error) throw error;
      let items = (data || []).map((r) => ({ id: r.id ?? r[c.idField], _d: fromRow(c, r) }));
      for (const [f, op, v] of this._w) items = items.filter((it) => _jbCmp(it._d[f], op, v));
      for (let i = this._o.length - 1; i >= 0; i--) {
        const [f, dir] = this._o[i];
        const mul = dir === 'desc' ? -1 : 1;
        items.sort((a, b) => _jbOrd(a._d[f], b._d[f]) * mul);
      }
      if (this._lim != null) items = items.slice(0, this._lim);
      const docs = items.map((it) => ({ id: it.id, data: () => it._d, exists: true, ref: null }));
      return { docs, empty: docs.length === 0, size: docs.length, forEach: (fn) => docs.forEach(fn) };
    }
    const { data, error } = await this._select();
    if (error) throw error;
    return querySnap(this.cfg, data || []);
  }
  onSnapshot(onNext, onErr) {
    let cancelled = false;
    const run = () => this.get().then((s) => { if (!cancelled) onNext(s); }).catch((e) => onErr && onErr(e));
    run();
    const chan = sb.channel('rt_' + this.cfg.table + '_' + Math.random().toString(36).slice(2))
      .on('postgres_changes', { event: '*', schema: 'public', table: this.cfg.table }, run)
      .subscribe();
    return () => { cancelled = true; sb.removeChannel(chan); };
  }
}

class CollectionRef extends Query {
  constructor(cfg, ctx) { super(cfg, ctx); }
  doc(id) { return new DocRef(this.cfg, id ?? null, this.ctx); }
  async add(data) {
    const c = this.cfg;
    const row = toRow(c, data);
    if (this.ctx) row[this.ctx.col] = this.ctx.val;
    const { data: ins, error } = await sb.from(c.table).insert(row).select().single();
    if (error) throw error;
    if (c.children) await writeChildren(c, ins.id, data);
    return new DocRef(c, ins.id, this.ctx, ins);
  }
}

class DocRef {
  constructor(cfg, id, ctx, preload) { this.cfg = cfg; this.id = id; this.ctx = ctx; this._pre = preload; }
  collection(sub) {
    const key = invName(this.cfg.table) + '/' + sub;
    const scfg = SUBREG[key];
    if (!scfg) throw new Error('Unknown subcollection: ' + key);
    return new CollectionRef(scfg, { col: scfg.parentField, val: this.id });
  }
  // Key column/value for row lookups. Singleton subcollections (revolvingFund/summary)
  // are keyed by their parent FK, not an `id` column; the doc id ('summary') is ignored.
  _keyCol() { return this.cfg.singleton ? this.cfg.parentField : (this.cfg.idField || 'id'); }
  _keyVal() { return this.cfg.singleton ? this.ctx.val : this.id; }
  _applyCtx(qb) { return (this.ctx && !this.cfg.singleton) ? qb.eq(this.ctx.col, this.ctx.val) : qb; }

  async get() {
    const c = this.cfg;
    if (c.kv) {
      const { data, error } = await sb.from(c.table).select('value').eq('key', this.id).maybeSingle();
      if (error) throw error;
      return { id: this.id, exists: !!data, data: () => (data ? data.value : undefined) };
    }
    let sel = '*';
    if (c.children) sel = '*, ' + Object.values(c.children).map((x) => `${x.table}(*)`).join(', ');
    let qb = sb.from(c.table).select(sel).eq(this._keyCol(), this._keyVal());
    qb = this._applyCtx(qb);
    const { data, error } = await qb.maybeSingle();
    if (error) throw error;
    return docSnap(c, this.id, data || null);
  }

  async set(data, opts) {
    const c = this.cfg;
    if (c.kv) {
      const { error } = await sb.from(c.table).upsert({ key: this.id, value: data, updated_at: new Date().toISOString() }, { onConflict: 'key' });
      if (error) throw error; return;
    }
    const row = toRow(c, data);
    row[this._keyCol()] = this._keyVal();
    if (this.ctx && !c.singleton) row[this.ctx.col] = this.ctx.val;
    const { error } = await sb.from(c.table).upsert(row, { onConflict: this._keyCol() });
    if (error) throw error;
    if (c.children) await writeChildren(c, this._keyVal(), data, true);
  }

  async update(data) {
    const c = this.cfg;
    if (c.jsonbData) {
      // Read-modify-write: merge incoming fields into the existing `data` blob
      // so a partial update (e.g. {status}) doesn't clobber the rest.
      let selq = sb.from(c.table).select('data').eq(this._keyCol(), this._keyVal());
      selq = this._applyCtx(selq);
      const { data: cur, error: selErr } = await selq.maybeSingle();
      if (selErr) throw selErr;
      const tsSet = new Set(c.ts || []);
      const merged = { ...((cur && cur.data) || {}) };
      const row = {};
      for (const k in data) {
        if (k === 'id') continue;
        let v = data[k];
        if (tsSet.has(k)) { row[camelToSnake(k)] = tsToISO(v); continue; }
        if (v === SERVER_TS) v = new Date().toISOString();
        merged[k] = v;
      }
      row.data = merged;
      let upq = sb.from(c.table).update(row).eq(this._keyCol(), this._keyVal());
      upq = this._applyCtx(upq);
      const { error } = await upq;
      if (error) throw error;
      return;
    }
    const row = toRow(c, data);
    let qb = sb.from(c.table).update(row).eq(this._keyCol(), this._keyVal());
    qb = this._applyCtx(qb);
    const { error } = await qb;
    if (error) throw error;
    if (c.children) await writeChildren(c, this._keyVal(), data, true);
  }

  async delete() {
    let qb = sb.from(this.cfg.table).delete().eq(this._keyCol(), this._keyVal());
    qb = this._applyCtx(qb);
    const { error } = await qb;
    if (error) throw error;
  }

  onSnapshot(onNext, onErr) {
    let cancelled = false;
    const run = () => this.get().then((s) => { if (!cancelled) onNext(s); }).catch((e) => onErr && onErr(e));
    run();
    const chan = sb.channel('rtd_' + this.cfg.table + '_' + Math.random().toString(36).slice(2))
      .on('postgres_changes', { event: '*', schema: 'public', table: this.cfg.table, filter: `${this._pk()}=eq.${this.id}` }, run)
      .subscribe();
    return () => { cancelled = true; sb.removeChannel(chan); };
  }
}

// child-table write helper (insert parent already done; here we (re)write children)
async function writeChildren(cfg, parentId, data, replace) {
  for (const arrName in cfg.children) {
    if (!(arrName in data)) continue;
    const c = cfg.children[arrName];
    if (replace) await sb.from(c.table).delete().eq(c.fk, parentId);
    const arr = data[arrName] || [];
    if (!arr.length) continue;
    const rows = arr.map((it, i) => {
      const r = { [c.fk]: parentId, position: i };
      for (const k in it) {
        if (k === 'id') { if (c.idCol) r[c.idCol] = it.id; continue; }
        r[(c.rename && c.rename[k]) || camelToSnake(k)] = it[k];
      }
      return r;
    });
    const { error } = await sb.from(c.table).insert(rows);
    if (error) throw error;
  }
}

// reverse table→collectionName (for subcollection path key)
function invName(table) {
  for (const n in REG) if (REG[n].table === table) return n;
  return table;
}

// ── 8. db facade + batch ─────────────────────────────────────────────
const db = {
  collection(name) {
    const cfg = REG[name];
    if (!cfg) throw new Error('Unknown collection: ' + name);
    return new CollectionRef(cfg, null);
  },
  batch() {
    const ops = [];
    return {
      set(ref, data, opts) { ops.push(['set', ref, data, opts]); return this; },
      update(ref, data)    { ops.push(['update', ref, data]);    return this; },
      delete(ref)          { ops.push(['delete', ref]);          return this; },
      async commit() {
        for (const [op, ref, data, opts] of ops) {
          if (op === 'set') {
            if (ref.id == null) { await new CollectionRef(ref.cfg, ref.ctx).add(data); }
            else await ref.set(data, opts);
          } else if (op === 'update') await ref.update(data);
          else await ref.delete();
        }
      },
    };
  },
};

// ── 9. auth facade ───────────────────────────────────────────────────

// ── Cloudflare Turnstile captcha (verified server-side by Supabase) ──
// FLIP THIS TO true ONLY AFTER you have:
//   1. Created a Turnstile widget in Cloudflare and put its SITE key in the
//      data-sitekey of the .cf-turnstile div on each login page.
//   2. Enabled Captcha (Turnstile) in Supabase → Auth → Bot & Abuse Protection
//      and pasted the matching SECRET key there.
// While false, login works exactly as before (no token is sent).
const CAPTCHA_ENABLED = true;

// Read the token from a Turnstile widget on the page (optionally a specific one).
function _captchaToken(widgetId) {
  try {
    if (window.turnstile && typeof turnstile.getResponse === 'function') {
      return turnstile.getResponse(widgetId) || undefined;
    }
  } catch (e) {}
  return undefined;
}
// Reset a widget so the next attempt gets a fresh, single-use token.
function _captchaReset(widgetId) {
  try { if (window.turnstile && typeof turnstile.reset === 'function') turnstile.reset(widgetId); } catch (e) {}
}
// Options object Supabase expects — only when captcha is on and a token exists.
function _captchaOpts(token) {
  if (!CAPTCHA_ENABLED) return undefined;
  const t = token || _captchaToken();
  return t ? { captchaToken: t } : undefined;
}

function mapUser(u) {
  if (!u) return null;
  return {
    uid: u.id,
    email: u.email,
    displayName: u.user_metadata?.display_name || u.user_metadata?.full_name || null,
    emailVerified: !!u.email_confirmed_at,
    async getIdToken() { const { data } = await sb.auth.getSession(); return data.session?.access_token || null; },
    // change-password flow: verify current password by re-signing in
    async reauthenticateWithCredential(cred) {
      const { error } = await sb.auth.signInWithPassword({ email: cred.email || u.email, password: cred.password, options: _captchaOpts(cred.captchaToken) });
      _captchaReset();
      if (error) { error.code = (error.message || '').toLowerCase().includes('captcha') ? 'auth/captcha-failed' : 'auth/wrong-password'; throw error; }
    },
    async updatePassword(newPassword) {
      const { error } = await sb.auth.updateUser({ password: newPassword });
      if (error) { error.code = mapAuthCode(error); throw error; }
    },
  };
}
const auth = {
  currentUser: null,
  onAuthStateChanged(cb) {
    // Supabase fires auth events on EVERY token refresh / tab-focus re-validation
    // (autoRefreshToken). Firing the app callback each time re-runs the whole
    // login/render flow → the page "refreshes" on alt-tab. Dedupe so the app is
    // only notified when the signed-in user actually changes (first load / login /
    // logout), not on token refreshes.
    let _firedOnce = false;
    let _lastUid;
    const emit = (u) => {
      const uid = u ? u.uid : null;
      if (_firedOnce && uid === _lastUid) return; // same user → ignore (token refresh, focus)
      _firedOnce = true; _lastUid = uid;
      cb(u);
    };
    sb.auth.getSession().then(({ data }) => { auth.currentUser = mapUser(data.session?.user); emit(auth.currentUser); });
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => {
      auth.currentUser = mapUser(session?.user); emit(auth.currentUser);
    });
    return () => sub.subscription.unsubscribe();
  },
  async signInWithEmailAndPassword(email, password, captchaToken) {
    const { data, error } = await sb.auth.signInWithPassword({ email, password, options: _captchaOpts(captchaToken) });
    _captchaReset();
    if (error) { error.code = mapAuthCode(error); throw error; }
    auth.currentUser = mapUser(data.user);
    return { user: auth.currentUser };
  },
  async createUserWithEmailAndPassword(email, password, captchaToken) {
    const { data, error } = await sb.auth.signUp({ email, password, options: _captchaOpts(captchaToken) });
    _captchaReset();
    if (error) { error.code = mapAuthCode(error); throw error; }
    auth.currentUser = mapUser(data.user);
    return { user: auth.currentUser };
  },
  async signOut() { await sb.auth.signOut(); auth.currentUser = null; },
  // Supabase manages session persistence via the client config — accept & ignore.
  async setPersistence(_p) { return; },
  async sendPasswordResetEmail(email, captchaToken) { const { error } = await sb.auth.resetPasswordForEmail(email, _captchaOpts(captchaToken)); _captchaReset(); if (error) throw error; },
};
function mapAuthCode(error) {
  const m = (error.message || '').toLowerCase();
  if (m.includes('captcha'))            return 'auth/captcha-failed';
  if (m.includes('already registered')) return 'auth/email-already-in-use';
  if (m.includes('invalid login'))      return 'auth/wrong-password';
  if (m.includes('password'))           return 'auth/weak-password';
  return 'auth/error';
}

// Admin-creates-user (replaces the secondary-app pattern) — calls the Edge Function.
async function adminCreateUser(payload) {
  const { data: { session } } = await sb.auth.getSession();
  const res = await fetch(ADMIN_CREATE_USER_FN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (session?.access_token || '') },
    body: JSON.stringify(payload),
  });
  const out = await res.json();
  if (!res.ok) throw new Error(out.error || 'create user failed');
  return out; // { uid, reused }
}
window.adminCreateUser = adminCreateUser;

// ── 10. firebase.* compatibility surface ─────────────────────────────
const firebase = {
  firestore: Object.assign(() => db, {
    FieldValue: { serverTimestamp: () => SERVER_TS, delete: () => null },
    Timestamp: TS,
  }),
  auth: Object.assign(() => auth, {
    EmailAuthProvider: { credential: (email, password) => ({ email, password }) },
    Auth: { Persistence: { LOCAL: 'local', SESSION: 'session', NONE: 'none' } },
  }),
  apps: [{ options: { url: SUPABASE_URL } }],
  initializeApp: () => ({ auth: () => auth, firestore: () => db, delete: async () => {} }),
};

// ── 11. minimal Storage wrapper (most images are base64; this covers refs) ──
const storage = {
  ref(path) {
    return {
      _path: path || ('uploads/' + Date.now()),
      async put(file) {
        const { error } = await sb.storage.from('uploads').upload(this._path, file, { upsert: true });
        if (error) throw error;
        return { ref: this };
      },
      async getDownloadURL() {
        // Still returns the public-FORMAT URL even though the bucket is private
        // (migration 0027): it's the stable identifier persisted in the DB.
        // Section 11b below resolves it into a signed URL at the moment of use.
        const { data } = sb.storage.from('uploads').getPublicUrl(this._path);
        return data.publicUrl;
      },
      child(p) { return storage.ref((this._path + '/' + p).replace(/\/+/g, '/')); },
    };
  },
};

// ── 11b. PRIVATE storage — transparent signed-URL resolution ─────────
// Migration 0027 flips the `uploads` bucket private: receipts, contract files,
// signatures and agreement PDFs stop being readable by anyone with the link.
// The DB keeps storing the public-format URL (…/object/public/uploads/<path>)
// as a stable identifier, and THIS block converts it to a short-lived signed
// URL at the moment of use — globally, so no template has to know:
//   • clicks on <a href="…public/uploads/…">   → intercepted, signed, opened
//   • <img>/<iframe> src set by any innerHTML   → rewritten via MutationObserver
//   • fetch(url)                                → wrapped (PDF stamping/merge/sha)
//   • window.open(url)                          → wrapped (receipt viewers)
// Every legitimate viewer is logged in (RLS: authenticated may SELECT on the
// bucket), so signing succeeds; anonymous links now get 404 — which is the point.
// DEPLOY ORDER: this file must be live BEFORE migration 0027 runs, or existing
// links 404 with nothing to resolve them.
const DACS_PUB_UPLOADS_RE = /\/storage\/v1\/object\/public\/uploads\/([^?#]+)/;
const _dacsSignCache = new Map(); // path → { url, exp }
window.dacsSignedUrl = async function (urlOrPath, expiresIn = 3600) {
  let path = String(urlOrPath || '');
  const m = path.match(DACS_PUB_UPLOADS_RE);
  if (m) path = decodeURIComponent(m[1]);
  const hit = _dacsSignCache.get(path);
  if (hit && hit.exp > Date.now()) return hit.url;
  const { data, error } = await sb.storage.from('uploads').createSignedUrl(path, expiresIn);
  if (error) throw error;
  _dacsSignCache.set(path, { url: data.signedUrl, exp: Date.now() + Math.max(expiresIn - 600, 60) * 1000 });
  return data.signedUrl;
};
const _dacsIsPubUpload = (u) => typeof u === 'string' && DACS_PUB_UPLOADS_RE.test(u);
// Sign only when the URL is one of ours; anything else passes through untouched.
window.dacsMaybeSignUrl = async function (u) {
  if (!_dacsIsPubUpload(u)) return u;
  try { return await window.dacsSignedUrl(u); } catch (e) { console.warn('sign failed:', e.message || e); return u; }
};

// window.open(url) — receipt viewers call it with the stored URL directly.
// Open the window synchronously (preserves the click gesture), navigate after signing.
const _dacsOrigOpen = window.open.bind(window);
window.open = function (url, target, feats) {
  if (_dacsIsPubUpload(url)) {
    const w = _dacsOrigOpen('', target || '_blank', feats);
    window.dacsSignedUrl(url)
      .then((s) => { if (w) w.location.href = s; })
      .catch((e) => { console.warn('sign failed:', e.message || e); if (w) { try { w.close(); } catch (_) {} } });
    return w;
  }
  return _dacsOrigOpen(url, target, feats);
};

// <a href> — capture-phase interceptor covers every anchor in every module.
document.addEventListener('click', function (ev) {
  const a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
  if (!a || !_dacsIsPubUpload(a.href)) return;
  ev.preventDefault();
  ev.stopPropagation();
  window.open(a.href, '_blank'); // routes through the signing wrapper above
}, true);

// Save a stored upload to the user's device instead of opening it in a tab.
// A plain <a download> can't do this: the file lives on the Supabase origin, and
// the download attribute is ignored cross-origin (the browser just navigates) —
// which is also why the anchor interceptor above exists. So fetch it (the fetch
// wrapper below signs it), hand the browser a same-origin blob: URL, and let the
// download attribute do its job. Falls back to opening the file if the fetch
// fails, so the button is never a dead end.
window.dacsDownloadUpload = async function (urlOrPath, filename) {
  const nameFrom = (u) => {
    try { return decodeURIComponent(String(u).split('?')[0].split('/').pop() || ''); }
    catch (_) { return ''; }
  };
  const fname = String(filename || nameFrom(urlOrPath) || 'receipt')
    .replace(/[\\/:*?"<>|]+/g, '').trim() || 'receipt';
  try {
    const res = await fetch(urlOrPath);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    return true;
  } catch (e) {
    console.warn('download failed — opening instead:', e.message || e);
    window.open(urlOrPath, '_blank');
    return false;
  }
};

// <img>/<iframe> src — rewrite as elements appear or change. No loop risk:
// the signed URL (…/object/sign/…) no longer matches the public pattern.
function _dacsSignSrcEl(el) {
  const u = el.getAttribute && el.getAttribute('src');
  if (!_dacsIsPubUpload(u)) return;
  window.dacsSignedUrl(u).then((s) => { el.src = s; }).catch((e) => console.warn('sign failed:', e.message || e));
}
function _dacsSignScan(root) {
  if (root.nodeType !== 1) return;
  if (root.matches && root.matches('img[src],iframe[src]')) _dacsSignSrcEl(root);
  if (root.querySelectorAll) root.querySelectorAll('img[src*="/object/public/uploads/"],iframe[src*="/object/public/uploads/"]').forEach(_dacsSignSrcEl);
}
new MutationObserver((muts) => {
  for (const m of muts) {
    if (m.type === 'attributes') { _dacsSignSrcEl(m.target); continue; }
    m.addedNodes.forEach(_dacsSignScan);
  }
}).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => _dacsSignScan(document.documentElement));
else _dacsSignScan(document.documentElement);

// fetch — PDF stamping, agreement merging and dacsSnapshotPdf all fetch the
// stored URL. Only OUR public-uploads URLs are rewritten; everything else
// (supabase-js internals, workers, CDNs) passes through untouched.
const _dacsOrigFetch = window.fetch.bind(window);
window.fetch = async function (input, init) {
  try {
    const u = typeof input === 'string' ? input : (input && input.url);
    if (_dacsIsPubUpload(u)) {
      const s = await window.dacsSignedUrl(u);
      input = typeof input === 'string' ? s : new Request(s, input);
    }
  } catch (e) { console.warn('signed fetch fallback:', e.message || e); }
  return _dacsOrigFetch(input, init);
};

// ── 12. e-sign evidence helpers (shared by ALL portals) ──────────────
// Every acceptance gate calls these to build a dispute-proof trail:
//  • dacsSnapshotPdf — freeze a copy of the EXACT PDF the signer saw into
//    signed-terms/{uid}/… (the shared settings/project URL can be replaced
//    later; the snapshot cannot) and fingerprint it (SHA-256).
//  • dacsLogAgreementEvent — one immutable row in agreement_events (0021).
// Both are best-effort: they log a warning and return null/false rather than
// ever blocking an acceptance (offline, CORS, or migration not yet applied).
async function _dacsSha256Hex(buf) {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('');
}
window.dacsSha256Text = async function (text) {
  try { return await _dacsSha256Hex(new TextEncoder().encode(String(text || ''))); }
  catch (_) { return ''; }
};
window.dacsSnapshotPdf = async function (pdfUrl, uid, label) {
  try {
    if (!pdfUrl || !uid) return null;
    const res = await fetch(pdfUrl);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    const sha256 = await _dacsSha256Hex(await blob.arrayBuffer());
    const safe = String(label || 'terms').replace(/\.pdf$/i, '').replace(/[^\w.-]+/g, '_').slice(0, 60) || 'terms';
    const path = `signed-terms/${uid}/${Date.now()}_${safe}.pdf`;
    const ref = storage.ref(path);
    await ref.put(blob);
    const url = await ref.getDownloadURL();
    return { url, name: safe + '.pdf', sha256 };
  } catch (e) {
    console.warn('PDF snapshot failed (acceptance continues):', e.message || e);
    return null;
  }
};
window.dacsLogAgreementEvent = async function (ev) {
  try {
    const u = (auth && auth.currentUser) || null;
    await db.collection('agreementEvents').add({
      userId: (ev && ev.userId) || (u && u.uid) || null,
      email: (ev && ev.email) || (u && u.email) || '',
      userAgent: (navigator && navigator.userAgent) || '',
      acceptedAt: SERVER_TS,
      ...ev,
    });
    return true;
  } catch (e) {
    console.warn('Agreement event log failed (acceptance continues):', e.message || e);
    return false;
  }
};

// ── 13. client error telemetry → client_errors table (0028) ─────────
// Uncaught errors and unhandled rejections are reported so production breakage
// is visible without waiting for a client to call. Deduped per session, capped
// at 15 rows, fields truncated (RLS enforces the caps server-side too).
// Deliberately fire-and-forget: the reporter itself must never throw or await.
const _dacsErrSeen = new Set();
let _dacsErrBudget = 15;
function _dacsReportError(kind, message, source, line, col, stack) {
  try {
    if (_dacsErrBudget <= 0) return;
    const msg = String(message || '').slice(0, 500);
    // 'Script error.' is the browser's opaque cross-origin placeholder — pure noise.
    if (!msg || msg === 'Script error.') return;
    const key = kind + '|' + msg + '|' + (source || '') + '|' + (line || 0);
    if (_dacsErrSeen.has(key)) return;
    _dacsErrSeen.add(key);
    _dacsErrBudget--;
    let uid = null;
    try { uid = (auth.currentUser && auth.currentUser.uid) || null; } catch (_) {}
    sb.from('client_errors').insert({
      kind,
      message: msg,
      source: String(source || '').slice(0, 300),
      line: line | 0,
      col: col | 0,
      stack: String(stack || '').slice(0, 4000),
      page: String(location.pathname || '').slice(0, 300),
      ua: String(navigator.userAgent || '').slice(0, 300),
      uid,
    }).then(() => {}, () => {});
  } catch (_) {}
}
window.addEventListener('error', (e) =>
  _dacsReportError('error', e.message, e.filename, e.lineno, e.colno, e.error && e.error.stack));
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  _dacsReportError('unhandledrejection', (r && r.message) || String(r), '', 0, 0, r && r.stack);
});

// ── 14. expose globals (mirror old firebase-config.js) ───────────────
window.db = db; window.auth = auth; window.storage = storage; window.firebase = firebase;
console.log('✅ Supabase initialized (Firestore-compat shim active)');
console.log('📁 Project URL:', SUPABASE_URL);
