// Loads Project Control's LIVE money functions straight from
// js/portal-app.compiled.js (never a copy) and builds a project from rows the
// way PortalApp does. Used by tests/sample-regression.test.js and by the
// read-only live check tools/finance/reconcile-folder.js.
//
// If a slice marker moves, update it here — never copy the functions.
'use strict';
const fs = require('fs');
const path = require('path');

const SOURCE = path.join(__dirname, '..', '..', 'js', 'portal-app.compiled.js');

function slice(src, start, end) {
  const i = src.indexOf(start);
  if (i === -1) throw new Error('SLICE NOT FOUND: "' + start + '" in portal-app.compiled.js — update tests/helpers/portal-money.js');
  const j = src.indexOf(end, i);
  if (j === -1) throw new Error('SLICE NOT FOUND: end "' + end + '" in portal-app.compiled.js');
  return src.slice(i, j);
}

const NAMES = ['peso', 'classifyLabor', 'mapPayrollDoc', 'mapExpenseDoc', 'mapMonthlyProject', 'buildProject',
  '_isOverheadPay', '_folderCompletion', '_projSpent', '_projEarned', '_projMargin', '_recognisedProfit'];

function loadPortalMoney() {
  const src = fs.readFileSync(SOURCE, 'utf8');
  const code = slice(src, 'const peso = (n, opts = {}) =>', 'const _staff =')
    + slice(src, 'const LIABILITY_KEYWORDS', 'const PC_EXPENSE_IMAGE_FIELDS')
    + slice(src, 'function mapExpenseDoc', 'function FoldersGrid')
    + '\nfunction shortRef(p, id) { return p + "-" + id; }\n';
  return new Function('ctx', 'with (ctx) {' + code + '\n; return {' + NAMES.join(',') + '}; }')({ window: undefined });
}

let cached = null;
const money = () => cached || (cached = loadPortalMoney());

// One folder's project, built like PortalApp builds the base project (no
// Additional Works merge: callers merge children themselves).
function projectFromRows({ folder, periods, payroll, expenses, overhead, boqDocs }) {
  const m = money();
  const project = m.buildProject(
    { id: folder.id, name: folder.name, totalBudget: Number(folder.totalBudget) || 0 },
    (periods || []).map(m.mapMonthlyProject),
    (payroll || []).map(m.mapPayrollDoc),
    (expenses || []).map(e => m.mapExpenseDoc({ ...e, docs: {} })),
    overhead || []);
  project.spent = m._projSpent(project);
  project.completion = m._folderCompletion(boqDocs || [], folder.id);
  return project;
}

const projectFromFixture = fx => projectFromRows({ ...fx, boqDocs: [fx.boq] });

module.exports = { loadPortalMoney, projectFromRows, projectFromFixture };
