// ════════════════════════════════════════════════════════════════════
// The visible wording of a screen file — every button label, heading,
// help line, warning and empty message — for the keep-everything fence of
// the office v5 redesign (tests/office-v5-keep.test.js, spec D1).
//
//   node tests/tools/office-v5-strings.js --write   (re)build the fixture
//                                                   from git HEAD
//
// Rough by design: text between tags in HTML/template strings and quoted
// literals that read like words (a letter and a space, 4–200 characters).
// Code-looking pieces are dropped. The fence only asks that each string
// is still found in its group's files after the redesign.
// ════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const GROUPS = {
  wp: ['js/workplan-admin-core.js', 'js/workplan-admin-board.js', 'js/workplan-admin-task.js',
       'js/workplan-admin-meetings.js', 'js/workplan-admin-form.js'],
  pur: ['js/purchasing-admin-core.js', 'js/purchasing-admin-list.js', 'js/purchasing-admin-purchases.js',
        'js/purchasing-admin-cash.js', 'js/purchasing-admin-record.js', 'js/purchasing-admin-pay.js',
        'js/reconciliation-admin.js'],
  stock: ['js/stock-admin.js', 'js/stock-cost-admin.js'],
  tools: ['js/tools-admin.js'],
  setup: ['js/requests-admin-setup.js', 'js/requests-admin-history.js', 'js/requests-admin-gallery.js'],
  att: ['js/attendance-admin.js', 'js/app-updates-admin.js'],
};

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/[^\n]*$/gm, '')
    .replace(/([;{}),])[ \t]*\/\/[^\n]*$/gm, '$1');
}

function visibleStrings(src) {
  const out = new Set();
  const code = stripComments(src);
  const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  let m;
  while ((m = re.exec(code))) {
    let s = m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3];
    if (m[3] !== undefined) s = s.replace(/\$\{[^}]*\}/g, '\u0000');
    s = s.replace(/<[^>]*>/g, '\u0000').replace(/\\n/g, ' ');
    for (let part of s.split('\u0000')) {
      part = part.replace(/\\(['"`\\])/g, '$1').replace(/\s+/g, ' ').trim();
      if (part.length < 4 || part.length > 200) continue;
      if (!/[A-Za-z]/.test(part) || !/ /.test(part)) continue;
      if (/=>|;|\{|\}|&&|\|\||===|\.join\(|\bfunction\b|\breturn\b/.test(part)) continue;
      if (/[<>]|="|class=|data-[a-z]|^["'`]|["'`]$/.test(part)) continue;   // markup, quote fragments
      if (/^[a-z0-9_-]+( [a-z0-9_-]+)*$/.test(part)) continue;          // class lists, ids
      if (/^[\w.\-]+(\s*[:,]\s*[\w.\-#%()]+)+;?$/.test(part)) continue;   // css-ish
      out.add(part);
    }
  }
  return [...out].sort();
}

// What the fence searches: the files, whitespace collapsed, also with
// escaped quotes undone (a string may move between quote styles).
function haystack(texts) {
  const all = texts.join('\n');
  const flat = s => s.replace(/\s+/g, ' ');
  return flat(all) + '\n' + flat(all.replace(/\\n/g, ' ').replace(/\\(['"`\\])/g, '$1'));
}

function atHead(file) {
  return execFileSync('git', ['show', 'HEAD:' + file], { cwd: path.join(__dirname, '..', '..'), encoding: 'utf8', maxBuffer: 1 << 26 });
}

module.exports = { GROUPS, visibleStrings, haystack };

if (require.main === module && process.argv.includes('--write')) {
  const groups = {};
  for (const [g, files] of Object.entries(GROUPS)) {
    const set = new Set();
    files.forEach(f => visibleStrings(atHead(f)).forEach(s => set.add(s)));
    groups[g] = [...set].sort();
  }
  const out = path.join(__dirname, '..', 'fixtures', 'office-v5-keep.json');
  const prev = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : {};
  fs.writeFileSync(out, JSON.stringify({
    note: 'Visible wording of every remaining office screen at the commit before the v5 conversion (spec D1). ' +
          'Built by tests/tools/office-v5-strings.js --write. A string may only leave through "gone", with a reason.',
    groups,
    gone: prev.gone || {},
  }, null, 1) + '\n');
  console.log('wrote ' + out + ': ' + Object.entries(groups).map(([g, l]) => g + ' ' + l.length).join(', '));
}
