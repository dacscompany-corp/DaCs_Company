// Runs the REAL js/pm-sharing.js + js/pm-admin.js in a Node vm context with
// a stub DOM, so tests can call the live screen functions and read what
// they render. Unknown DOM ids get a recording stub element.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

function makeEl(id) {
  return { id, textContent: '', innerHTML: '', value: '', disabled: false, checked: false, style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    querySelector() { return null; }, querySelectorAll() { return []; }, addEventListener() {},
    appendChild() {}, removeChild() {}, remove() { this.removed = true; }, setAttribute() {}, closest() { return null; },
    focus() {}, click() {} };
}

function loadPmAdmin(opts = {}) {
  const els = new Map();
  const printed = [];
  const toasts = [];
  const el = (id) => { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); };
  const document = {
    getElementById: el,
    querySelector: (sel) => el('qs:' + sel),
    querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
    createElement: (t) => makeEl('new:' + t),
    body: makeEl('body'),
  };
  const ctx = { console, document, setTimeout, clearTimeout, Intl, Date, Math, JSON, Promise, Number, String,
                Array, Object, isNaN, parseFloat, parseInt, encodeURIComponent, Blob: function () {},
                URL: { createObjectURL: () => 'blob:', revokeObjectURL() {} },
                navigator: { userAgent: 'node' }, location: { origin: 'http://test' },
                alert() {}, confirm() { return true; } };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  ctx.open = () => ({ document: { write(h) { printed.push(h); }, close() {} }, focus() {}, print() {} });
  ctx.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'TS' } } };
  ctx.currentUserRole = opts.role || 'owner';
  vm.createContext(ctx);
  const exp = read('js/expenses-module.js');
  const fStart = exp.indexOf('function formatNum(n) {');
  const fEnd = exp.indexOf('function formatDate(d) {', fStart);
  if (fStart === -1 || fEnd === -1) throw new Error('SLICE NOT FOUND: formatNum in expenses-module.js');
  vm.runInContext(exp.slice(fStart, fEnd)
    + '\nfunction setText(id, v) { const e = document.getElementById(id); if (e) e.textContent = v; }\n', ctx);
  vm.runInContext(read('js/pm-sharing.js'), ctx, { filename: 'pm-sharing.js' });
  vm.runInContext(read('js/pm-admin.js'), ctx, { filename: 'pm-admin.js' });
  ctx._pmToast = (msg, isErr) => { toasts.push([msg, !!isErr]); };
  const run = (code) => vm.runInContext(code, ctx);
  return { ctx, els, printed, toasts, run };
}
module.exports = { loadPmAdmin, makeEl };
