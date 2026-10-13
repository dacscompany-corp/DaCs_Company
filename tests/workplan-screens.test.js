// ════════════════════════════════════════════════════════════════════
// WORK PLAN SCREEN TESTS:  node tests/workplan-screens.test.js
//
// Runs the REAL js/workplan-admin-meetings.js and js/workplan-admin-task.js
// in Node against a small stand-in page (zero dependencies) and a scripted
// server whose answers the test releases one at a time. Proves:
//   * notes typed after Save finishes but before the AI answers survive
//     an AI success and an AI failure;
//   * opening meeting A, switching to B, then A answering last (or
//     failing last) leaves B on screen; the same for tasks.
// The stand-in page records what is drawn; it does not parse HTML, so
// button wiring after a redraw is checked in the browser (Task 8).
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const core = require('../js/workplan-admin-core.js');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; failures.push(name + ' — ' + e.message); console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }

function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
const flush = async () => { for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r)); };

// One stand-in element per selector; a redraw (host.innerHTML) starts fresh ones.
function fakeEl() {
  const on = {};
  return {
    value: '', disabled: false, hidden: false, checked: false, innerHTML: '', dataset: {},
    addEventListener(type, fn) { (on[type] = on[type] || []).push(fn); },
    fire(type) {
      const ev = { target: this, currentTarget: this, preventDefault() {} };
      return Promise.all((on[type] || []).map(fn => fn(ev)));
    },
    closest() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
  };
}
function fakeHost() {
  let html = '';
  let els = {};
  return {
    get innerHTML() { return html; },
    set innerHTML(v) { html = String(v); els = {}; },
    querySelector(sel) { return els[sel] || (els[sel] = fakeEl()); },
    querySelectorAll() { return []; },
  };
}

function makeWP(rpc) {
  const esc = s => String(s === null || s === undefined ? '' : s)
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return Object.assign({}, core, {
    esc, icons() {}, signImages() {}, modal() {},
    head: (title, sub, actions) => '<h1>' + esc(title) + '</h1>' + (actions || ''),
    fail: (host, e) => { host.innerHTML = 'FAILED: ' + core.errorMessage(e); },
    rpc,
    loadLookups: async () => ({ projects: [], people: [], teams: [] }),
    openTaskForm() {}, openTask() {}, openMeeting() {},
    state: { taskId: null, meetingId: null }, views: {},
  });
}
function loadScreens(WP) {
  const win = { WorkPlanAdmin: WP, addEventListener() {}, alert() {}, switchView() {} };
  for (const f of ['js/workplan-admin-task.js', 'js/workplan-admin-meetings.js']) {
    new Function('window', fs.readFileSync(path.join(ROOT, f), 'utf8'))(win);
  }
  return WP.views;
}
const meetingDoc = (id, title, notes) => ({ id, title, held_on: '2026-10-12', original_notes: notes || '',
                                            current_version: 0, versions: [], tasks: [] });
const taskDoc = (id, title) => ({ id, title, project_name: 'ZZ project', work_name: 'Main Contract', status: 'not_started',
                                  version: 1, acks: [], blockers: [], waiting_for: [], photos: [], history: [], office_flags: [], helpers: [] });

// Type notes, press "Draft tasks with AI", let the save finish, type more
// while the AI is still working, then let the AI answer.
async function typeWhileAiDrafts(outcome) {
  let serverNotes = '';
  const saves = [];
  const WP = makeWP(async (name, args) => {
    if (name === 'wp_office_meeting') return meetingDoc('M', 'Monday meeting', serverNotes);
    if (name === 'wp_office_save_meeting') {
      const d = deferred();
      saves.push(d);
      await d.promise;
      serverNotes = args.p_original_notes;
      return { meeting_id: 'M' };
    }
    throw new Error('unexpected rpc ' + name);
  });
  const ai = deferred();
  WP.aiDraft = () => ai.promise;
  const views = loadScreens(WP);
  const host = fakeHost();
  WP.state.meetingId = 'M';
  await views.wpMeeting(host);
  const notes = host.querySelector('[data-notes]');
  notes.value = 'Wall prep Monday';
  await notes.fire('input');
  host.querySelector('[data-ai-run]').fire('click');
  await flush();
  ok(saves.length === 1, 'Draft tasks with AI saves the notes first');
  saves[0].resolve();
  await flush();
  ok(serverNotes === 'Wall prep Monday', 'the notes were saved before the AI answered');
  notes.value = 'Wall prep Monday. Electrical Tuesday';   // typed after Save finished, before the AI answers
  await notes.fire('input');
  if (outcome === 'success') ai.resolve({ tasks: [], shared_notes: '' });
  else ai.reject(new Error('AI_FAILED'));
  await flush();
  return host;
}

(async () => {
  console.log('\nworkplan screens: edits typed during AI drafting');

  await test('notes typed after Save, before the AI answers, survive an AI success', async () => {
    const host = await typeWhileAiDrafts('success');
    ok(host.innerHTML.includes('Wall prep Monday. Electrical Tuesday'), 'the newer notes are back on screen after the redraw');
    ok(host.innerHTML.includes('The AI found no tasks in these notes.'), 'the AI result is shown');
  });

  await test('notes typed after Save, before the AI answers, survive an AI failure', async () => {
    const host = await typeWhileAiDrafts('failure');
    ok(host.innerHTML.includes('Wall prep Monday. Electrical Tuesday'), 'the newer notes are back on screen after the redraw');
    ok(host.innerHTML.includes(core.ERRORS.AI_FAILED), 'the failure is shown');
  });

  console.log('\nworkplan screens: a late, older load never draws');

  async function switchAtoB(view, rpcName, key, doc, failA) {
    const loads = {};
    const WP = makeWP((name, args) => {
      if (name === rpcName) { const d = deferred(); loads[args[key]] = d; return d.promise; }
      return Promise.reject(new Error('unexpected rpc ' + name));
    });
    const views = loadScreens(WP);
    const host = fakeHost();
    const field = view === 'wpMeeting' ? 'meetingId' : 'taskId';
    WP.state[field] = 'A';
    const pA = views[view](host);
    WP.state[field] = 'B';
    const pB = views[view](host);
    await flush();
    loads.B.resolve(doc('B', 'Screen B'));
    await pB;
    await flush();
    ok(host.innerHTML.includes('Screen B'), 'B is drawn');
    if (failA) loads.A.reject(new Error('NOT_FOUND')); else loads.A.resolve(doc('A', 'Screen A'));
    await pA;
    await flush();
    ok(host.innerHTML.includes('Screen B'), 'B is still on screen');
    ok(!host.innerHTML.includes('Screen A') && !host.innerHTML.includes('FAILED'), 'nothing from A was drawn');
  }

  await test('meetings: open A, switch to B, A answers last → B stays', () =>
    switchAtoB('wpMeeting', 'wp_office_meeting', 'p_meeting', meetingDoc, false));
  await test('meetings: open A, switch to B, A fails last → B stays, no error drawn', () =>
    switchAtoB('wpMeeting', 'wp_office_meeting', 'p_meeting', meetingDoc, true));
  await test('tasks: open A, switch to B, A answers last → B stays', () =>
    switchAtoB('wpTask', 'wp_office_task', 'p_task', taskDoc, false));
  await test('tasks: open A, switch to B, A fails last → B stays, no error drawn', () =>
    switchAtoB('wpTask', 'wp_office_task', 'p_task', taskDoc, true));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log('\nFailures:\n  ' + failures.join('\n  ')); process.exit(1); }
})();
