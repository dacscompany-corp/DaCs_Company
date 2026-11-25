// Weekly report print tests - run with:  node tests/weekly-report-print.test.js
// Zero dependencies. Requires js/weekly-report-print.js directly.
'use strict';
process.env.TZ = 'America/Los_Angeles';
const P = require('../js/weekly-report-print.js');

let failed = 0;
const pending = [];
function test(name, fn) {
  pending.push(Promise.resolve().then(fn).then(
    () => console.log('ok   ' + name),
    (e) => { failed++; console.log('FAIL ' + name + '\n     ' + (e && e.message)); }));
}
function ok(c, msg) { if (!c) throw new Error(msg || 'not ok'); }
function count(s, sub) { return s.split(sub).length - 1; }

const ctx = { weekStart: '2026-11-16', weekEnd: '2026-11-22', generatedAt: '2026-11-23T02:30:00Z', live: true,
  coverageNote: 'Roster history starts on Mon 16 Nov.', origin: 'https://example.test' };

function photo(i, o) { return Object.assign({ path: 'p' + i + '.jpg', label: 'Work photo ' + i + ' of 3', legacy: false }, o || {}); }
function entry(o) {
  return Object.assign({ recordId: 'abcdef123456', workerId: 'w1', workerName: 'Ana Cruz', workerNo: 7,
    date: '2026-11-16', project: { key: 'pc:f1', system: 'pc', id: 'f1', name: 'Site A' }, timeInProject: null,
    projectsDiffer: false, note: 'Poured slab', photos: [photo(1), photo(2), photo(3)], legacy: false,
    timeOutAt: '2026-11-16T09:00:00Z', timeoutEventId: 'fedcba987654' }, o || {});
}
function emp(entries) {
  const days = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'].map((d, i) => ({
    date: d, label: 'Day ' + i, status: i === 0 ? 'complete' : 'none', statusLabel: i === 0 ? 'Finished the day' : 'No attendance recorded',
    record: i === 0 ? { timein_at: '2026-11-16T00:00:00Z', timeout_at: '2026-11-16T09:00:00Z', timein_project_name: 'Site A', timeout_project_name: 'Site A', total_minutes: 480 } : null }));
  return { workerId: 'w1', workerNo: 7, name: 'Ana Cruz', position: 'Mason', days, entries, recordedDays: 1, incompleteDays: 0,
    hoursText: '8h 0m', duties: { text: 'Keep tools tidy', updatedAt: '2026-11-01' } };
}
function urlsFor(entries, nullPath) {
  const m = new Map();
  entries.forEach(e => e.photos.forEach(p => { if (p.path) m.set(p.path, p.path === nullPath ? null : 'https://signed.test/' + p.path + '?t=1'); }));
  return m;
}

test('live employee print says Not final', () => {
  const es = [entry()]; const h = P.wrPrintEmployeeHtml(emp(es), ctx, urlsFor(es));
  ok(/^<!doctype html>/i.test(h), 'doctype');
  ok(h.includes('Not final'), 'Not final'); ok(h.includes('DACS-LETTERHEAD.png'), 'letterhead'); ok(h.includes('counter(pages)'), 'pages');
  ok(h.includes('General duties (standing responsibilities, not a record of work done)'), 'duties heading');
});
test('every signed photo appears exactly once', () => {
  const es = [entry()]; const h = P.wrPrintEmployeeHtml(emp(es), ctx, urlsFor(es));
  ok(count(h, '<img src="') >= 3, 'imgs');
  ['p1', 'p2', 'p3'].forEach(p => ok(count(h, 'https://signed.test/' + p + '.jpg?t=1') === 1, p + ' once'));
});
test('a null url prints Photo unavailable in its place', () => {
  const es = [entry()]; const h = P.wrPrintEmployeeHtml(emp(es), ctx, urlsFor(es, 'p2.jpg'));
  ok(count(h, 'Photo unavailable') === 1, 'one unavailable'); ok(h.includes('Work photo 2 of 3'), 'caption kept');
});
test('legacy photo keeps its label', () => {
  const es = [entry({ photos: [photo(1, { label: 'Legacy Time Out photo - purpose not recorded', legacy: true })] })];
  const h = P.wrPrintEmployeeHtml(emp(es), ctx, urlsFor(es));
  ok(h.includes('<figcaption>Legacy Time Out photo - purpose not recorded</figcaption>'), 'caption');
});
test('note is escaped and keeps its line breaks', () => {
  const es = [entry({ note: 'a\n<script>x</script> & "q" ñ' })]; const h = P.wrPrintEmployeeHtml(emp(es), ctx, urlsFor(es));
  ok(h.includes('a\n&lt;script&gt;x&lt;/script&gt; &amp; &quot;q&quot; ñ'), 'escaped');
  ok(/class="wr-note"[^>]*>a\n&lt;script/.test(h), 'inside wr-note');
});
test('no peso sign and no money words in either document', () => {
  const es = [entry()]; const re = /₱|\bamount\b|payroll|bonus/i;
  ok(!re.test(P.wrPrintEmployeeHtml(emp(es), ctx, urlsFor(es))), 'employee');
  const proj = { key: 'pc:f1', system: 'pc', name: 'Site A', submissions: 1, contributors: 1, days: [{ date: '2026-11-16', label: 'Mon 16 Nov', entries: es }] };
  ok(!re.test(P.wrPrintProjectHtml(proj, ctx, urlsFor(es), null)), 'project');
});
test('each entry carries its source line', () => {
  const es = [entry()]; const h = P.wrPrintEmployeeHtml(emp(es), ctx, urlsFor(es));
  ok(h.includes('Source: attendance record abcdef12'), 'record'); ok(h.includes('Time Out event fedcba98'), 'event');
});
test('project print filtered to one day shows only that day', () => {
  const a = entry({ note: 'Monday work' }), b = entry({ date: '2026-11-17', note: 'Tuesday work', recordId: 'zzzzzzzz1' });
  const proj = { key: 'pc:f1', system: 'pc', name: 'Site A', submissions: 2, contributors: 1,
    days: [{ date: '2026-11-16', label: 'Mon 16 Nov', entries: [a] }, { date: '2026-11-17', label: 'Tue 17 Nov', entries: [b] }] };
  const u = urlsFor([a, b]);
  const one = P.wrPrintProjectHtml(proj, ctx, u, '2026-11-17');
  ok(one.includes('Tuesday work') && !one.includes('Monday work'), 'one day');
  const all = P.wrPrintProjectHtml(proj, ctx, u, null);
  ok(all.includes('Tuesday work') && all.includes('Monday work'), 'all days');
  ok(all.includes('Ana Cruz') && all.includes('W-0007'), 'worker shown');
});

// ── Project print, Nov 20 layout ──
function ph(path, i, o) { return Object.assign({ path: path, label: 'Work photo ' + i + ' of 3', legacy: false }, o || {}); }
function sampleProject(name) {
  const site = { key: 'pc:f1', system: 'pc', id: 'f1', name: name || 'De Leon Residence' };
  const e1 = entry({ recordId: 'r1aaaaaa', workerId: 'w1', workerName: 'Ana Cruz', workerNo: 1, date: '2026-11-19', project: site, note: 'Assembled cabinets', photos: [ph('a1', 1), ph('a2', 2), ph('a3', 3)] });
  const e2 = entry({ recordId: 'r2bbbbbb', workerId: 'w1', workerName: 'Ana Cruz', workerNo: 1, date: '2026-11-20', project: site, note: 'Installed doors', photos: [ph('b1', 1), ph('b2', 2), ph('b3', 3)] });
  const e3 = entry({ recordId: 'r3cccccc', workerId: 'w2', workerName: 'Ben Dela Cruz', workerNo: 2, date: '2026-11-20', project: site, note: 'Lighting fixtures', photos: [ph('c1', 1), ph('c2', 2), ph('c3', 3)] });
  return { key: 'pc:f1', system: 'pc', id: 'f1', name: site.name, submissions: 3, contributors: 2, photoCount: 9,
    days: [{ date: '2026-11-19', label: 'Thu 19 Nov', entries: [e1] }, { date: '2026-11-20', label: 'Fri 20 Nov', entries: [e2, e3] }] };
}
function allEntries(p) { return p.days.reduce((a, d) => a.concat(d.entries), []); }

test('weekly vs daily title', () => {
  const p = sampleProject(), u = urlsFor(allEntries(p));
  const w = P.wrPrintProjectHtml(p, ctx, u, null), d = P.wrPrintProjectHtml(p, ctx, u, '2026-11-20');
  ok(/Weekly Progress <span[^>]*>Report<\/span>/.test(w), 'weekly'); ok(!w.includes('Daily Progress'), 'no daily in weekly');
  ok(/Daily Progress <span[^>]*>Report<\/span>/.test(d), 'daily'); ok(w.includes('#c9a227') && w.includes('#1f2a44'), 'colours');
  ok(w.includes('DE LEON RESIDENCE') && w.includes('OFFICE REPORT'), 'kicker'); ok(w.includes('Project Control'), 'system');
  ok(!w.includes('Not final') && !d.includes('Not final'), 'no Not final banner on the project report (owner, 23 Nov 2026)');
  ok(w.includes('Assembled '), 'assembled stamp in the band'); ok(w.includes('Roster history starts'), 'coverage');
});
test('tiles show 3 submissions, 2 workers, 9 photos, 2 days', () => {
  const p = sampleProject(), h = P.wrPrintProjectHtml(p, ctx, urlsFor(allEntries(p)), null);
  [['3', 'Submissions'], ['2', 'Workers'], ['9', 'Photos'], ['2', 'Days with work']].forEach(t =>
    ok(h.includes('<div class="wr-tile-n">' + t[0] + '</div><div class="wr-tile-l">' + t[1] + '</div>'), t[1]));
  ok(h.includes('wr-tile dark'), 'first tile dark');
});
test('work rows carry their photo ranges', () => {
  const p = sampleProject(), h = P.wrPrintProjectHtml(p, ctx, urlsFor(allEntries(p)), null);
  ['Photos #1–#3', 'Photos #4–#6', 'Photos #7–#9'].forEach(t => ok(h.includes(t), t));
  ok(h.includes('Ana Cruz') && h.includes('W-0002') && h.includes('Source: attendance record'), 'worker + source');
  ok(h.includes('Thu 19 Nov') && h.includes('Fri 20 Nov'), 'day headings');
});
test('single photo shows #a alone, none shows No photos, differing site shown', () => {
  const site = { key: 'pc:f1', system: 'pc', id: 'f1', name: 'S' };
  const a = entry({ recordId: 'a', workerName: 'A', photos: [ph('x1', 1)], project: site, timeInProject: { name: 'Other Site' }, projectsDiffer: true });
  const b = entry({ recordId: 'b', workerName: 'B', photos: [], note: null, project: site });
  const p = { key: 'pc:f1', system: 'pc', name: 'S', submissions: 2, contributors: 2, days: [{ date: '2026-11-16', label: 'Mon 16 Nov', entries: [a, b] }] };
  const h = P.wrPrintProjectHtml(p, ctx, urlsFor([a]), null);
  ok(h.includes('Photos #1<') , 'single'); ok(h.includes('No photos'), 'none'); ok(h.includes('No note written'), 'no note');
  ok(h.includes('Time In at Other Site'), 'time in site');
});
test('the grid is three across and each signed URL appears once', () => {
  const p = sampleProject(), h = P.wrPrintProjectHtml(p, ctx, urlsFor(allEntries(p)), null);
  ok(h.includes('grid-template-columns: repeat(3, 1fr)'), 'grid'); ok(h.includes('object-fit: cover'), 'cover');
  ['a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'c1', 'c2', 'c3'].forEach(x => ok(count(h, 'https://signed.test/' + x + '.jpg') === 0 && count(h, 'https://signed.test/' + x + '?t=1') === 1, x));
  ok(count(h, '<figure') === 9, 'nine figures'); ok(h.includes('#9</'), 'badge'); ok(h.includes('Fri 20 Nov · Ben Dela Cruz'), 'caption');
});
test('a null url keeps its #n with Photo unavailable', () => {
  const p = sampleProject(), h = P.wrPrintProjectHtml(p, ctx, urlsFor(allEntries(p), 'b2'), null);
  ok(count(h, 'Photo unavailable') === 1, 'one'); ok(/<span class="wr-badge">#5<\/span><div class="wr-missing">Photo unavailable/.test(h), '#5 kept');
});
test('legacy caption', () => {
  const p = sampleProject(); const e = p.days[0].entries[0];
  e.photos = [ph('a1', 1, { label: 'Legacy Time Out photo - purpose not recorded', legacy: true })];
  const h = P.wrPrintProjectHtml(p, ctx, urlsFor(allEntries(p)), null);
  ok(h.includes('Thu 19 Nov · Ana Cruz · Legacy Time Out photo - purpose not recorded'), 'legacy');
});
test('the project name is escaped in HTML and in the @page string', () => {
  const nm = 'Bob\'s "Shop" <A&B> \\ 2', p = sampleProject(nm), h = P.wrPrintProjectHtml(p, ctx, urlsFor(allEntries(p)), null);
  ok(h.includes('Bob&#39;s &quot;Shop&quot; &lt;A&amp;B&gt; \\ 2'), 'html'); ok(!h.includes('<A&B>'), 'raw');
  ok(h.includes('content: "Bob\'s \\"Shop\\" \\3C A&B> \\\\ 2 · '), 'css string');
  ok(!P.wrPrintProjectHtml(sampleProject('</style><b>'), ctx, new Map(), null).includes('</style><b>'), 'no style breakout');
  const z = P.wrPrintProjectHtml(sampleProject('x\ny"}'), ctx, new Map(), null);
  ok(z.includes('content: "x\\A y\\"}'), 'newline escaped');
});
test('the day print restarts at #1 and shows only that day', () => {
  const p = sampleProject(), h = P.wrPrintProjectHtml(p, ctx, urlsFor(allEntries(p)), '2026-11-20');
  ok(!h.includes('Assembled cabinets') && h.includes('Installed doors'), 'day only'); ok(h.includes('Photos #1–#3') && h.includes('Photos #4–#6') && !h.includes('Photos #7'), 'restart');
  ok(count(h, '<figure') === 6, 'six'); ok(h.includes('<div class="wr-tile-n">1</div><div class="wr-tile-l">Days with work'), 'one day');
  ok(h.includes('<div class="wr-tile-n">6</div><div class="wr-tile-l">Photos'), 'six photos');
});
test('project print has no money words', () => {
  const p = sampleProject(), h = P.wrPrintProjectHtml(p, ctx, urlsFor(allEntries(p)), null);
  ok(!/₱|\bamount\b|payroll|bonus|reward/i.test(h), 'money');
});
test('an empty project prints "No work submitted for this period."', () => {
  const p = { key: 'pc:f1', system: 'pc', name: 'Empty', submissions: 0, contributors: 0, days: [] };
  const h = P.wrPrintProjectHtml(p, ctx, new Map(), null);
  ok(h.includes('No work submitted for this period.'), 'line'); ok(count(h, '<figure') === 0, 'no figures');
});

function fakeWin(log, opened) {
  const w = { document: { write: s => log.push(['write', s]), open() {}, close() {} }, close() {} };
  return { open: () => { log.push(['open']); return opened === null ? null : w; } };
}
test('wrOpenPrint: a failed signature becomes Photo unavailable and the page is written', async () => {
  const log = []; const win = fakeWin(log);
  const es = [entry()];
  const r = await P.wrOpenPrint(u => P.wrPrintEmployeeHtml(emp(es), ctx, u), ['p1.jpg', 'p2.jpg', 'p2.jpg', 'p3.jpg', null],
    p => p === 'p2.jpg' ? Promise.reject(new Error('x')) : Promise.resolve('https://signed.test/' + p), win);
  ok(r === 'printed', 'result ' + r);
  const writes = log.filter(l => l[0] === 'write').map(l => l[1]); const last = writes[writes.length - 1];
  ok(last.includes('Photo unavailable'), 'unavailable'); ok(!last.includes('Preparing report'), 'no preparing');
  ok(writes[0].includes('Preparing report'), 'first write preparing');
});
test('wrOpenPrint: a blocked popup signs nothing', async () => {
  let signed = 0; const log = [];
  const r = await P.wrOpenPrint(() => '', ['a'], () => { signed++; return Promise.resolve('u'); }, fakeWin(log, null));
  ok(r === 'blocked', 'blocked'); ok(signed === 0, 'no sign');
});
test('wrOpenPrint: open happens before the first await', async () => {
  const log = [];
  const p = P.wrOpenPrint(() => '<html></html>', ['a'], x => { log.push(['sign']); return Promise.resolve('u'); }, fakeWin(log));
  ok(log.length >= 1 && log[0][0] === 'open', 'open synchronous');
  await p;
  ok(log.findIndex(l => l[0] === 'open') < log.findIndex(l => l[0] === 'sign'), 'order');
});
test('wrOpenPrint: at most 4 signatures at once', async () => {
  let cur = 0, max = 0; const paths = []; for (let i = 0; i < 12; i++) paths.push('p' + i);
  await P.wrOpenPrint(() => '', paths, () => { cur++; max = Math.max(max, cur); return new Promise(r => setTimeout(() => { cur--; r('u'); }, 5)); }, fakeWin([]));
  ok(max <= 4 && max > 1, 'max ' + max);
});

test('wrOpenPrint: a throwing buildHtml leaves an error page, not Preparing', async () => {
  const log = [];
  const r = await P.wrOpenPrint(() => { throw new Error('boom'); }, ['a'], () => Promise.resolve('u'), fakeWin(log));
  ok(r === 'error', 'result ' + r);
  const writes = log.filter(l => l[0] === 'write').map(l => l[1]); const last = writes[writes.length - 1];
  ok(last.includes('could not be prepared') && !last.includes('Preparing report'), 'error page');
});
test("wrOpenPrint: a window whose document.write throws resolves 'error'", async () => {
  const w = { document: { write() { throw new Error('closed'); }, open() {}, close() {} } };
  const r = await P.wrOpenPrint(() => '<html></html>', ['a'], () => Promise.resolve('u'), { open: () => w });
  ok(r === 'error', 'result ' + r);
});

test('footer margin boxes carry a sans-serif font; a nameless project prints no null', () => {
  const p = sampleProject(), h = P.wrPrintProjectHtml(p, ctx, urlsFor(allEntries(p)), null);
  const tail = h.slice(h.lastIndexOf('@page')); const m = /@bottom-left \{[^}]*\}/.exec(tail); ok(m && /font-family:\s*Arial/.test(m[0]), 'bottom-left font');
  const r = /@bottom-right \{[^}]*\}/.exec(tail); ok(r && /font-family:\s*Arial/.test(r[0]), 'bottom-right font');
  const n = sampleProject(); n.name = null;
  const hn = P.wrPrintProjectHtml(n, ctx, urlsFor(allEntries(n)), null);
  ok(!/null|undefined/.test(hn.replace(/<style[\s\S]*?<\/style>/g, '').replace('this.onerror=null;', '')) && hn.includes('— ·'), 'no null');
  ok(!/null|undefined/.test(/<title>[^<]*<\/title>/.exec(hn)[0]), 'title no null');
});
test('daily period carries the year and titles differ by scope', () => {
  const p = sampleProject(), u = urlsFor(allEntries(p));
  const w = P.wrPrintProjectHtml(p, ctx, u, null), d = P.wrPrintProjectHtml(p, ctx, u, '2026-11-20');
  ok(d.includes('Fri 20 Nov 2026'), 'day year');
  const tw = /<title>([^<]*)<\/title>/.exec(w)[1], td = /<title>([^<]*)<\/title>/.exec(d)[1];
  ok(tw !== td && tw.startsWith('Weekly Progress Report - De Leon Residence - ') && td.endsWith('Fri 20 Nov 2026') && td.startsWith('Daily'), tw + ' | ' + td);
});

Promise.all(pending).then(() => { console.log(failed ? failed + ' FAILED' : 'all ok'); process.exit(failed ? 1 : 0); });
