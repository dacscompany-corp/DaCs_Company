// ============================================================================
// BOQ REPAIR — PRADO RESIDENCE
//
// Restores the rate annotations that were erased from the imported BOQ.
//
// WHAT HAPPENED
//   The rate-type dropdown in the row editor only offered "Enter value",
//   "By owner" and "N/A". A row carrying any other wording ('by MadHouse',
//   'included in Carpentry Works', 'retained', 'not included', 'included in
//   WF01') matched no option, so the browser fell back to "Enter value" and
//   saving the row wrote materialOverride = null with a 0 rate. Editing a row's
//   % complete was enough to lose the wording — the report then showed a bare
//   dash with no explanation of why the line is ₱0.
//   Audited against the exported PDF on 2026-07-30: 11 rows affected, plus one
//   factual change (Water Closet material read "by owner"; both source PDFs say
//   "by MadHouse").
//
//   js/boq-module.js has since been fixed (rateTypeOptions() now offers the
//   row's own wording as a selected option, so an edit round-trips it). This
//   script repairs the data that was already damaged. Reload admin.html first so
//   the fixed module is loaded, or editing a repaired row can lose it again.
//
// WHAT IT DOES NOT TOUCH
//   · No peso rate is ever changed except Water Closet MATERIAL (0 → the
//     'by MadHouse' label, which is also ₱0). The script aborts if the grand
//     total moves off ₱1,673,153.09.
//   · % complete is left exactly as encoded — your 70% stays 70% — unless you
//     explicitly pass zeroPercentOnFreeLines (see below).
//
// HOW TO RUN
//   1. Reload admin.html (owner account), open DevTools → Console.
//   2. Paste this whole file and press Enter — it prints a DRY RUN of every
//      change it would make.
//   3. If the list looks right:  __pradoBoqRepair({ dryRun: false })
//   4. Reload, then Export PDF again to check.
//
// TWO OPTIONAL TIDY-UPS (both are cosmetic and cannot change a peso figure)
//   zeroPercentOnFreeLines: true
//       Sets % complete to 0 on every line worth ₱0. Right now the report claims
//       "70% complete" on scope that isn't yours (CARI, the refundable bond,
//       temporary utilities/facilities, as-built plans, D04, sprinkler
//       relocation) while the same kind of line elsewhere sits at 0%.
//   normalizeQty: true
//       Re-prints quantities with two decimals ("1" → "1.00", "1.8" → "1.80"),
//       so edited rows match the untouched ones and the source PDFs. Values are
//       unchanged — only how they read.
//
//   Everything at once:
//       __pradoBoqRepair({ dryRun: false, zeroPercentOnFreeLines: true, normalizeQty: true })
// ============================================================================

(function () {
  'use strict';

  const round2 = (n) => Math.round(n * 100) / 100;
  const peso   = (n) => '₱ ' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Matching ignores case, punctuation spacing and double spaces, so a row whose
  // description was lightly re-typed still matches.
  const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();

  // description (as stored)                                  → [material, labour]
  // null on a side means "leave that side exactly as it is".
  const FIXES = [
    ['CARI (Construction All Risk Insurance)',                 'by MadHouse', 'by MadHouse'],
    ['Post Construction Cleaning (Deep Cleaning)',             'by MadHouse', 'by MadHouse'],
    ['As-Built Plans',                                         'not included', 'not included'],
    ['Retain Ceiling Finish',                                  'retained', 'retained'],
    ['White Granite Backsplash',                               'included in Carpentry Works', 'included in Carpentry Works'],
    ['20MM THK Mouldings in Stucco Finish',                    'included in WF01', 'included in WF01'],
    ['Accent Mirror 01 - Living Area (B03)',                   'included in Carpentry Works', 'included in Carpentry Works'],
    ['Accent Mirrors 02 - Living Area (B04)',                  'included in Carpentry Works', 'included in Carpentry Works'],
    ['LED Vanity Mirror - Bathroom (B06)',                     'included in Carpentry Works', 'included in Carpentry Works'],
    ['Interior Styling Service (valued P50,000)',              'by MadHouse', 'by MadHouse'],
    ['Appliance Shopping Assistance - Double Burner Cooktop/Range, Microwave, Refrigerator, Television, Aircon, Wash Tower', 'by MadHouse', 'by MadHouse'],
    // Factual fix: the smart toilet is supplied by MadHouse, not by the unit
    // owner. Labour keeps its real ₱4,000 rate — hence null on that side.
    ['Water Closet (Smart Toilet)',                            'by MadHouse', null],
  ];

  const GRAND_EXPECTED = 1673153.09;

  // Mirrors the module's own math (js/boq-module.js calcLITotal / calcLIAcc).
  const liTotal = (li) => {
    const q = parseFloat(li.qty) || 0;
    const m = li.materialOverride ? 0 : (parseFloat(li.materialRate) || 0);
    const l = li.laborOverride    ? 0 : (parseFloat(li.laborRate)    || 0);
    return q * (m + l);
  };
  const grandTotal = (items) => round2(items.reduce((s, ci) =>
    s + ci.subItems.reduce((t, si) =>
      t + si.lineItems.reduce((u, li) => u + (li.type ? 0 : liTotal(li)), 0), 0), 0));

  // Re-derive the two stored money fields, UNROUNDED — the module's calcLITotal
  // and calcLIAcc round nothing, and every subtotal is recomputed from the rates,
  // so a rounded cache would sit a centavo off the live figure and shift as soon
  // as the row was opened. A line worth nothing stores '' rather than 0 so it
  // prints blank, the way the source quotation does.
  function restamp(li) {
    const total = liTotal(li);
    li.totalAmount          = total || '';
    li.accomplishmentAmount = (total * ((parseFloat(li.percentCompletion) || 0) / 100)) || '';
  }

  window.__pradoBoqRepair = async function ({
    dryRun = true,
    folderName = 'prado',
    zeroPercentOnFreeLines = false,
    normalizeQty = false,
  } = {}) {
    const uid = window.currentDataUserId || (window.currentUser && window.currentUser.uid);
    if (!uid) { console.error('Not signed in — no user id available.'); return; }

    const foldersSnap = await db.collection('folders').where('userId', '==', uid).get();
    const folders = foldersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const matches = folders.filter((f) => (f.name || '').toLowerCase().includes(folderName.toLowerCase()));
    if (matches.length !== 1) {
      console.error(matches.length ? `"${folderName}" matched ${matches.length} folders:` : `No folder matching "${folderName}".`,
        (matches.length ? matches : folders).map((f) => f.name));
      return;
    }
    const folder = matches[0];

    const snap = await db.collection('boqDocuments')
      .where('userId', '==', uid).where('folderId', '==', folder.id).get();
    if (snap.empty) {
      console.error(`No BOQ document on "${folder.name}". Run the import first (prado-residence.js).`);
      return;
    }
    // Same "best doc" rule the module uses: most line items wins.
    const doc = snap.docs.slice().sort((a, b) =>
      (b.data().costItems || []).length - (a.data().costItems || []).length)[0];
    const items = JSON.parse(JSON.stringify(doc.data().costItems || []));
    console.log(`Folder "${folder.name}" · BOQ ${doc.id} · ${items.length} sections`);

    const before = grandTotal(items);

    // ── 1. restore the annotations ──────────────────────────────────────────
    const changed = [], already = [], notFound = [];
    FIXES.forEach(([desc, mat, lab]) => {
      let hit = null;
      items.forEach((ci) => ci.subItems.forEach((si) => si.lineItems.forEach((li) => {
        if (li.type || hit) return;                       // skip group headers
        if (norm(li.description) === norm(desc) || norm(li.description).indexOf(norm(desc)) === 0) hit = li;
      })));
      if (!hit) { notFound.push(desc); return; }

      const wasM = hit.materialOverride, wasL = hit.laborOverride;
      const needM = mat !== null && wasM !== mat;
      const needL = lab !== null && wasL !== lab;
      if (!needM && !needL) { already.push(desc); return; }

      if (needM) { hit.materialOverride = mat; hit.materialRate = 0; }
      if (needL) { hit.laborOverride    = lab; hit.laborRate    = 0; }
      restamp(hit);
      changed.push({
        item: hit.itemNo || '', description: desc,
        material: needM ? `${wasM || '—'} → ${mat}` : '(unchanged)',
        labour:   needL ? `${wasL || '—'} → ${lab}` : '(unchanged)',
        total: hit.totalAmount === '' ? '(blank)' : peso(hit.totalAmount),
        'pct kept': (hit.percentCompletion || 0) + '%',
      });
    });

    // ── 2. optional: 0% on lines worth nothing ──────────────────────────────
    const zeroed = [];
    if (zeroPercentOnFreeLines) {
      items.forEach((ci) => ci.subItems.forEach((si) => si.lineItems.forEach((li) => {
        if (li.type) return;
        if (round2(liTotal(li)) === 0 && (parseFloat(li.percentCompletion) || 0) !== 0) {
          zeroed.push(`${li.itemNo ? li.itemNo + ' ' : ''}${li.description} (was ${li.percentCompletion}%)`);
          li.percentCompletion = 0;
          restamp(li);
        }
      })));
    }

    // ── 3. optional: two-decimal quantities ─────────────────────────────────
    const requoted = [];
    if (normalizeQty) {
      items.forEach((ci) => ci.subItems.forEach((si) => si.lineItems.forEach((li) => {
        if (li.type) return;
        const n = parseFloat(li.qty);
        if (isNaN(n)) return;
        const pretty = n.toFixed(2);
        if (String(li.qty) !== pretty) { requoted.push(`${li.qty} → ${pretty}`); li.qty = pretty; }
      })));
    }

    // ── Report ──────────────────────────────────────────────────────────────
    const after = grandTotal(items);
    if (changed.length) { console.log('%cAnnotations restored:', 'font-weight:bold'); console.table(changed); }
    if (already.length)  console.log('Already correct (skipped):', already);
    if (notFound.length) console.warn('NOT FOUND — check these by hand:', notFound);
    if (zeroed.length)   console.log(`% complete set to 0 on ${zeroed.length} ₱0 lines:`, zeroed);
    if (requoted.length) console.log(`${requoted.length} quantities re-printed with 2 decimals.`);

    console.log(`Grand total before: ${peso(before)}   after: ${peso(after)}`);
    if (Math.abs(after - GRAND_EXPECTED) > 0.005) {
      console.error(`Grand total moved off ${peso(GRAND_EXPECTED)}. Aborting — nothing written.`);
      return;
    }
    if (!changed.length && !zeroed.length && !requoted.length) {
      console.log('%cNothing to change.', 'color:#16a34a;font-weight:bold');
      return;
    }

    if (dryRun) {
      console.log('%cDRY RUN — nothing written.', 'color:#d97706;font-weight:bold');
      console.log('To write for real:  __pradoBoqRepair({ dryRun: false })');
      return { boqId: doc.id, costItems: items };
    }

    await db.collection('boqDocuments').doc(doc.id).update({
      costItems: items,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`%cRepaired BOQ ${doc.id}.`, 'color:#16a34a;font-weight:bold');
    console.log('Reload the page, reopen Accomplishment Reports → ' + folder.name + ', then Export PDF to check.');
  };

  console.log('Loaded. Run  __pradoBoqRepair()  for a dry run, then  __pradoBoqRepair({ dryRun: false })  to write.');
  console.log('With both tidy-ups:  __pradoBoqRepair({ dryRun: false, zeroPercentOnFreeLines: true, normalizeQty: true })');
})();
