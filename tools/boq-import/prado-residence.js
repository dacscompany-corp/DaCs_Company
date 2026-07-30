// ============================================================================
// BOQ IMPORT — PRADO RESIDENCE
//
// Sources (two PDFs that had to be merged):
//   · MH_PradoResidence_Main-Quotation-ForBidding (1).pdf   — Nov 05 2025
//     The UPDATED scope, with the price columns cleared.
//   · DACS_MH_PradoResidence_Work Order Agreement_251118.pdf — Nov 18 2025
//     The signed Work Order. Same scope, and the only copy with real rates.
//
// The two scopes were compared line by line: they are IDENTICAL — same sections,
// same items, same quantities, same units. Nothing was added, removed or
// re-measured between them, so every rate in the Work Order maps 1:1 onto the
// updated quotation and the totals below must reconcile to the Work Order:
//
//     I.   General Requirements                    ₱    95,000.00
//     II.  Site Works                              ₱    93,861.50
//     III. Architectural / Interior Finishing      ₱   744,601.00
//     IV.  Carpentry Works and Furnitures          ₱   491,990.59
//     V.   Electrical Works                        ₱   195,800.00
//     VI.  Plumbing Works                          ₱    51,900.00
//          TOTAL PROJECT COST (VAT EX)             ₱ 1,673,153.09
//          Less Construction Discount              ₱    23,153.09
//          DISCOUNTED TOTAL PROJECT COST           ₱ 1,650,000.00
//
// The script refuses to write if its computed grand total drifts from
// ₱1,673,153.09, so a typo in a rate can't silently reprice the job.
//
// HOW TO RUN
//   1. Open admin.html in the browser, logged in as the account that owns the
//      "Prado Residence" folder (owner, not staff).
//   2. Open DevTools → Console.
//   3. Paste this whole file and press Enter. It runs a DRY RUN first and
//      prints the totals it computed — check them against the table above.
//   4. If the totals look right, run:  __pradoBoqImport({ dryRun: false })
//   5. Reload, then open Accomplishment Reports → Prado Residence.
//
// ACCOMPLISHMENT %  — every line is imported at 0% complete, because a
// quotation records what was AGREED, not what has been built. That keeps
// earned revenue at zero until the site work is actually reported (the
// percentage-of-completion rule in CLAUDE.md). To open the report at a known
// stage of progress instead, pass it — this is also the quick way to restamp a
// whole report without editing ~100 rows by hand:
//      __pradoBoqImport({ dryRun: false, percent: 70 })
//      __pradoBoqImport({ dryRun: false, percent: 100 })
// Lines worth ₱0 (supplied by the owner or by MadHouse, or included elsewhere)
// always stay at 0% — progress on somebody else's scope is not yours to claim.
//
// Rates are entered exactly as the PDFs show them. Rows the documents mark
// "by MadHouse", "by owner", "existing", "retained", "not included",
// "included in Carpentry Works" and "included in WF01" are stored as rate
// OVERRIDES: they render as that text and count as ₱0 in every total.
//
// Lines that carry NO amount in either PDF (blank rate cells) — flagged so
// they are easy to price later:
//     I.G   Temporary Facilities                (Work Order total: 0.00)
//     III.D D04 Existing Sliding Glass Door - Balcony
//     IV.   F01 Dining Table · F02 Dining Chairs · F03 Coffee Table
//           F04 Swivel Chair · F05 Vanity Chair · F06 Side Table
//           F07 Upholstered Bedframe
// ============================================================================

(function () {
  'use strict';

  const gid    = () => '_' + Math.random().toString(36).slice(2, 10);
  const round2 = (n) => Math.round(n * 100) / 100;

  // A rate cell always renders `override || rate || '—'`, so it can never be
  // truly empty from data alone. A single space is a truthy override: it counts
  // as ₱0 and collapses to nothing on screen, in print, and in the PDF.
  const BLANK = ' ';

  // Build a line item. `mat` / `lab` accept:
  //   a number  → a rate
  //   ''        → blank cell (counts as 0)
  //   a string  → an override such as 'by owner' / 'by MadHouse' (counts as 0)
  function LI(itemNo, description, qty, unit, mat, lab, isOptional) {
    if (mat === '') mat = BLANK;
    if (lab === '') lab = BLANK;
    const matOv = typeof mat === 'string' ? mat : null;
    const labOv = typeof lab === 'string' ? lab : null;
    const m = matOv ? 0 : mat;
    const l = labOv ? 0 : lab;
    // NOT rounded — stored exactly as the module itself computes it (calcLITotal
    // and calcLIAcc in js/boq-module.js round nothing, and boqSaveLineItem
    // stores their raw output). totalAmount / accomplishmentAmount are display
    // caches; every subtotal is recomputed from the rates. Rounding them here
    // instead would leave a stored row a centavo away from the live figure —
    // e.g. 34,720.65 × 70% is 24,304.455, which prints .46 rounded but .45 as
    // the module computes it — so the row would shift the moment anyone opened
    // and saved it. Display formatting still shows 2 decimals everywhere.
    const total = parseFloat(qty) * (m + l);
    // Every display path prints the stored totalAmount verbatim, and fmt(0)
    // renders "0.00" while fmt('') renders empty. Rows carrying no priced work
    // must stay blank like the PDF.
    return {
      id: gid(),
      itemNo: itemNo || '',
      description,
      qty,
      unit,
      materialRate: matOv ? 0 : mat,
      laborRate:    labOv ? 0 : lab,
      totalAmount:  total || '',
      percentCompletion: 0,
      accomplishmentAmount: '',
      isOptional: !!isOptional,
      materialOverride: matOv,
      laborOverride:    labOv,
    };
  }

  const G  = (label) => ({ id: gid(), type: 'group', label });          // group header
  const SI = (label, lineItems) => ({ id: gid(), label, lineItems });   // sub-item (A, B, C…)
  const CI = (label, divisionNo, subItems) => ({ id: gid(), label, divisionNo, subItems });

  // ── I. GENERAL REQUIREMENTS ───────────────────────────────────── ₱95,000.00
  const general = CI('GENERAL REQUIREMENTS', 1, [
    SI('Mobilization & Demobilization', [
      LI('', 'Mobilization / Demobilization', '1.00', 'lot', '', 20000),
      LI('', 'Delivery of Materials',         '1.00', 'lot', '', 20000),
    ]),
    SI('Permits and Licenses', [
      LI('', 'Processing of Admin Permits', '1.00', 'lot', '', 10000),
    ]),
    SI('Bonds and Insurances', [
      LI('', 'CARI (Construction All Risk Insurance)', '1.00', 'lot', 'by MadHouse', 'by MadHouse'),
      LI('', 'Refundable Construction Bond (for Admin Requirement Purposes)', '1.00', 'lot', 'by owner', 'by owner'),
    ]),
    SI('Clearing and Hauling', [
      LI('', 'Clearing and Hauling', '1.00', 'lot', '', 15000),
    ]),
    SI('Post Construction Cleaning (Deep Cleaning)', [
      LI('', 'Post Construction Cleaning (Deep Cleaning)', '1.00', 'lot', 'by MadHouse', 'by MadHouse'),
    ]),
    SI('Temporary Utilities (Power and Water Supply)', [
      LI('', 'Temporary Utilities (Power and Water Supply)', '1.00', 'lot', 'by owner', 'by owner'),
    ]),
    // Work Order prints 0.00 for this row — carried at no charge, not unpriced.
    SI('Temporary Facilities', [
      LI('', 'Temporary Facilities', '1.00', 'lot', '', ''),
    ]),
    SI('Site Supervision', [
      LI('', 'Site Supervision', '1.00', 'lot', '', 30000),
    ]),
    // Updated quotation marks this "not included"; the Work Order left it blank.
    SI('As-Built Plans (optional)', [
      LI('', 'As-Built Plans', '1.00', 'lot', 'not included', 'not included', true),
    ]),
  ]);

  // ── II. SITE WORKS ────────────────────────────────────────────── ₱93,861.50
  const siteWorks = CI('SITE WORKS', 2, [
    SI('Demolition Works', [
      LI('', 'Removal of existing kitchen counter and cabinetries', '1.00', 'lot', 2000, 2000),
      LI('', 'Removal of existing toilet fixtures on Toilet & Bath', '1.00', 'lot', 1000, 1000),
      LI('', 'Dismantling of existing wall partition', '1.00', 'lot', 1000, 1000),
      LI('', 'Dismantling of existing floor & wall tiles on Toilet & Bath (Tile over Tile Application on other areas)', '1.00', 'lot', 1000, 5000),
    ]),
    SI('Civil Works', [
      LI('', 'New Drop Ceiling in 9mm THK Standard Core Gypsum Board (with necessary additions of Metal Furring and consumables for adjusted drops and covelighting) including 100x100 shadow gap on Master BR', '27.18', 'sqm', 1350, 600),
      LI('', 'Drywall Partition in 9mm THK Standard Core Gypsum Board (with necessary additions of Metal Furring and consumables) (Laundry Area - including curved accent wall)', '6.71', 'sqm', 1350, 600),
      LI('', 'Cementitious Waterproofing on Toilet & Bath', '8.61', 'sqm', 800, 800),
      LI('', 'Relocation of Existing Sprinkler and Smoke Detector', '1.00', 'lot', 'by owner', 'by owner'),
    ]),
  ]);

  // ── III. ARCHITECTURAL / INTERIOR FINISHING WORKS ────────────── ₱744,601.00
  const architectural = CI('ARCHITECTURAL / INTERIOR FINISHING WORKS', 9, [
    SI('Ceiling Works', [
      LI('RET',  'Retain Ceiling Finish',            '1.00',  'lot',  'retained', 'retained'),
      LI('CF01', 'Limewash Faux Finish',             '30.02', 'sqm',  1200, 600),
      LI('CF02', 'Teak Wood Look Laminated Board',   '1.80',  'sqm',  3500, 800),
      LI('CF03', 'Wood Laminated Finish',            '5.74',  'sqm',  3000, 800),
      LI('CF04', 'Black Painted Finish',             '0.36',  'sqm',  1200, 800),
    ]),
    SI('Wall Works', [
      LI('WF01', 'Limewash Faux Finish',             '57.53', 'sqm',  1200, 600),
      LI('WF02', 'White Granite Backsplash',         '1.00',  'lot',  'included in Carpentry Works', 'included in Carpentry Works'),
      LI('WF03', 'Teak Wood Look Laminated Board',   '5.09',  'sqm',  3500, 800),
      LI('WF04', 'BHE03 Cladding In Natural Oak Color By Bamboohub', '11.03', 'sqm', 3500, 800),
      LI('WF05', 'Custom Wallpaper',                 '5.41',  'sqm',  3500, 800),
      LI('WF06', 'Classical Moulding As Frame Color Matched With Chosen Wood Laminate & Cladding', '14.18', 'lm', 1200, 800),
      LI('WF07', 'Taupe Marble Look Laminate',       '7.25',  'sqm',  3500, 800),
      LI('WF08', '60X60 Beige Marble Look Tiles',    '15.36', 'sqm',  3500, 800),
      LI('WF09', 'Custom Accent Wall Textured Faux Finish', '5.13', 'sqm', 1600, 800),
      LI('WF10', '20MM THK Mouldings in Stucco Finish', '1.00', 'lot', 'included in WF01', 'included in WF01'),
      LI('WF11', 'Vertical Beige Subway Tiles',      '3.10',  'sqm',  3500, 800),
    ]),
    SI('Floor Works', [
      LI('FF01', '60X120Cm Gray Marble Look Ceramic Tile',        '18.75', 'sqm', 3500, 800),
      LI('FF02', '60X60Cm Non-Skid Travertine Look Ceramic Tile', '5.86',  'sqm', 3500, 800),
      LI('FF03', 'SPC Flooring',                                  '16.91', 'sqm', 2400, 800),
    ]),
    SI('Miscellaneous Works', [
      G('SUPPLY AND INSTALLATION OF DOORS INCLUDING HINGE AND ACCESSORIES'),
      LI('D01', 'Solid Wood Door - Main (refurbish existing finish inside)', '1.00', 'set/s', 5000, 3000),
      LI('D02', 'Frosted Swing Glass Door',                                 '2.00', 'set/s', 15000, 3000),
      LI('D03', 'Wooden Flush Door',                                        '2.00', 'set/s', 8500, 4000),
      LI('D04', 'Existing Sliding Glass Door - Balcony',                    '1.00', 'lot',   '', ''),
      G('SUPPLY AND INSTALLATION OF GLASS AND MIRRORS'),
      LI('', 'Bronze Mirror - Kitchen',                        '1.00', 'set/s', 15000, 5000),
      LI('', 'Accent Mirror 01 - Living Area (B03)',           '1.00', 'set/s', 'included in Carpentry Works', 'included in Carpentry Works'),
      LI('', 'Accent Mirrors 02 - Living Area (B04)',          '1.00', 'set/s', 'included in Carpentry Works', 'included in Carpentry Works'),
      LI('', 'LED Vanity Mirror - Bathroom (B06)',             '1.00', 'set/s', 'included in Carpentry Works', 'included in Carpentry Works'),
      LI('', 'Bronze Mirror - Master BR',                      '1.00', 'set/s', 8000, 2000),
      LI('', 'Clear Mirror with Curved Frame - Kids BR',       '1.00', 'set/s', 8000, 2000),
      LI('', 'Shower Enclosure with Swing Glass Door - Bathroom', '1.00', 'set/s', 18000, 8000),
      G('SUPPLY AND INSTALLATION OF ADDITIONAL WOOD WORKS'),
      LI('', 'Sliding Accent Wood - CNC Cut in Teak Wood Look Laminated Board - Master BR', '1.00', 'set/s', 15000, 3000),
    ]),
  ]);

  // ── IV. CARPENTRY WORKS AND FURNITURES ──────────────────────── ₱491,990.59
  const carpentry = CI('CARPENTRY WORKS AND FURNITURES', 12, [
    SI('Supply and Installation of Carpentry Works Including Dividers (Inside), Finishes, Striplights, Hardwares, and Mechanisms (See Carpentry/Cabinetry Details on Plans)', [
      G('KITCHEN'),
      LI('B01', 'Shoe Cabinet', '1.00', 'set/s', 24390.60, 17479.93),
      LI('B02', 'Kitchen Counter with Cupboards (including countertop, backsplash, accessories and organizer)', '1.00', 'set/s', 56515.00, 37677.15),
      LI('B03', 'Display Cabinet (including mirror)', '1.00', 'set/s', 20995.20, 15046.56),
      G('COMMON AREA'),
      LI('B04', 'TV Wall (including mirrors)', '1.00', 'set/s', 37950.00, 27195.50),
      LI('F01', 'Dining Table',  '1.00', 'set/s', '', ''),
      LI('F02', 'Dining Chairs', '4.00', 'set/s', '', ''),
      LI('F03', 'Coffee Table',  '1.00', 'set/s', '', ''),
      G('LAUNDRY AREA'),
      LI('B05', 'Laundry Cabinet', '1.00', 'set/s', 18500.00, 13250.00),
      G('POWDER ROOM'),
      LI('B06', 'Sink Cabinet (including vanity mirror and countertop)', '1.00', 'set/s', 20220.65, 14500.00),
      G("KID'S BEDROOM"),
      LI('B07', 'Closet Cabinet 1', '1.00', 'set/s', 28350.00, 20320.00),
      LI('B08', 'Bed Frame W/ Storage (including headboard)', '1.00', 'set/s', 32300.00, 23100.00),
      LI('B09', 'Study Table',  '1.00', 'set/s', 11000.00, 8300.00),
      LI('F04', 'Swivel Chair', '1.00', 'set/s', '', ''),
      G('MASTER BEDROOM'),
      LI('B10', 'Closet Cabinet 2', '1.00', 'set/s', 29500.00, 20850.00),
      LI('B11', 'Vanity Table',     '1.00', 'set/s', 8730.00, 5820.00),
      LI('F05', 'Vanity Chair',         '1.00', 'set/s', '', ''),
      LI('F06', 'Side Table',           '1.00', 'set/s', '', ''),
      LI('F07', 'Upholstered Bedframe', '1.00', 'set/s', '', ''),
    ]),
    SI('Interior Styling and Premium Service Inclusions', [
      LI('', 'Interior Styling Service (valued P50,000)', '1.00', 'lot', 'by MadHouse', 'by MadHouse'),
      LI('', 'Appliance Shopping Assistance - Double Burner Cooktop/Range, Microwave, Refrigerator, Television, Aircon, Wash Tower', '1.00', 'lot', 'by MadHouse', 'by MadHouse'),
      LI('', 'Interior Styling Items (Carpet, Custom Throw Pillows, Standing Lamps, Beddings) (receipts will be given back)', '1.00', 'lot', 'by MadHouse', 'by MadHouse'),
      LI('', 'Curtains and Blinds for all Windows', '1.00', 'lot', 'by MadHouse', 'by MadHouse'),
    ]),
  ]);

  // ── V. ELECTRICAL WORKS ─────────────────────────────────────── ₱195,800.00
  const electrical = CI('ELECTRICAL WORKS', 16, [
    SI('Roughing-Ins', [
      LI('', 'Supply and Installation of Conduits, Pipes, Boxes and Fittings', '1.00', 'lot', 13500, 10000),
    ]),
    SI('Piping Lines', [
      LI('', 'Supply and Installation of Wires and Cables', '1.00', 'lot', 13500, 10000),
    ]),
    SI('Wiring Devices', [
      G('OUTLETS'),
      LI('', 'Universal Duplex Outlet Set (Verify Brand)', '6.00', 'set/s', 800, 400),
      LI('', 'Duplex Convenience Outlet Set W/ Ground Fault Circuit Interrupter By Royu', '3.00', 'set/s', 800, 400),
      LI('', 'Refrigerator Outlet Set',   '1.00', 'set/s', 800, 400),
      LI('', 'Range Outlet Set',          '1.00', 'set/s', 800, 400),
      LI('', 'Washing Machine Outlet Set','1.00', 'set/s', 800, 400),
      LI('', 'Microwave Outlet Set',      '1.00', 'set/s', 800, 400),
      LI('', 'ACU Outlet Set',            '3.00', 'set/s', 800, 400),
      LI('', 'Table Top Outlet Set',      '1.00', 'set/s', 800, 400),
      G('SWITCHES'),
      LI('Sa',    'One-Gang Switch',              '9.00', 'set/s', 800, 400),
      LI('Sab',   'Two-Gang Switch',              '5.00', 'set/s', 800, 400),
      LI('Sabc',  'Three-Gang Switch',            '1.00', 'set/s', 800, 400),
      LI('3Sabc', 'Three-Way Three-Gang Switch',  '2.00', 'set/s', 800, 400),
    ]),
    SI('Panel Boards and ECBs', [
      LI('', 'Existing Panelboard', '1.00', 'lot', 'existing', 'existing'),
    ]),
    SI('Lighting Fixtures', [
      LI('', '10W Square Recessed Downlight, Dl',        '21.00', 'set/s', 900, 400),
      LI('', '10W Round Surface-Mounted Downlight, Dl',  '4.00',  'set/s', 900, 400),
      LI('', 'Pendant Light (Verify Model)',             '1.00',  'set/s', 2000, 400),
      LI('', 'Accent Droplight (Verify Model)',          '1.00',  'set/s', 12000, 400),
      LI('', 'Wall Light',                               '2.00',  'set/s', 1600, 400),
      LI('', 'Grid Track Light, Ww (Verify Model)',      '4.00',  'set/s', 2000, 400),
      LI('', 'Magnetic Track Bar, Recessed, 2M',         '4.00',  'set/s', 1200, 400),
      LI('', 'Led Striplight W/ Acrylic Diffuser, Ww',   '37.00', 'lm',    700, 400),
    ]),
  ]);

  // ── VI. PLUMBING WORKS ───────────────────────────────────────── ₱51,900.00
  const plumbing = CI('PLUMBING WORKS', 15, [
    SI('Plumbing Fixtures', [
      G('KITCHEN'),
      LI('', 'Kitchen Sink w/ Faucet', '1.00', 'lot', 12500, 4000),
      G('BATHROOM'),
      LI('', 'Lavatory',                '1.00', 'set/s', 7000, 2800),
      LI('', 'Lavatory Faucet',         '1.00', 'set/s', 1200, 600),
      LI('', 'Shower Set',              '1.00', 'set/s', 10000, 4000),
      // Fixture supplied by MadHouse; DACS installs it — labour only.
      LI('', 'Water Closet (Smart Toilet)', '1.00', 'set/s', 'by MadHouse', 4000),
      LI('', 'Towel Holder',            '1.00', 'set/s', 1000, 600),
      LI('', 'Tissue Holder',           '1.00', 'set/s', 1000, 600),
      LI('', 'Bathroom Rack',           '1.00', 'set/s', 2000, 600),
    ]),
  ]);

  const COST_ITEMS = [general, siteWorks, architectural, carpentry, electrical, plumbing];

  // Header from the documents. The two PDFs disagree on the date — the updated
  // quotation says Nov 05 2025, the signed Work Order says Nov 18 2025. The
  // Work Order date is used because that is the priced, agreed document; change
  // this one line if the report should carry the quotation date instead.
  const HEADER = {
    date:        '2025-11-18',
    projectName: 'PRADO RESIDENCE',
    area:        '43',
    ownerName:   'GRACE KAREN PRADO',
    location:    'AVIDA TOWER 2, CLOVERLEAF BALINTAWAK, QUEZON CITY',
    subject:     'Accomplishment Report',
  };

  const GRAND_EXPECTED = 1673153.09;   // TOTAL PROJECT COST (VAT EX)
  const DISCOUNT       = 23153.09;     // → DISCOUNTED TOTAL ₱1,650,000.00

  const TERMS = {
    payments: [
      '50% DOWNPAYMENT',
      '40% PROGRESS BILLING (Staggered Payment)',
      '10% UPON TURNOVER/COC',
    ].join('\n'),
    exclusions: [
      'Fire Protection Works (Sprinkler, Smoke Detectors, etc)',
      'Panel Board and other electrical works not mentioned',
      'Plumbing works not mentioned',
      'Appliances (TV, Refrigerator, Stove, Range Hood, Water Heater, Filters and etc)',
      'A/C Supply and Install',
    ].join('\n'),
    duration: 'Season 4: November - March',
    includePayments:   true,
    includeExclusions: true,
    includeDuration:   true,
  };

  // ── Totals (mirrors the module's own math) ────────────────────────────────
  const liTotal = (li) => {
    const q = parseFloat(li.qty) || 0;
    const m = li.materialOverride ? 0 : (parseFloat(li.materialRate) || 0);
    const l = li.laborOverride    ? 0 : (parseFloat(li.laborRate)    || 0);
    return q * (m + l);
  };
  const ciSubtotal = (ci) =>
    ci.subItems.reduce((s, si) => s + si.lineItems.reduce((t, li) => t + liTotal(li), 0), 0);

  const peso = (n) => '₱ ' + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Per-section figures from the Work Order, for a line-by-line comparison.
  const PDF_SUBTOTALS = [95000, 93861.5, 744601, 491990.59, 195800, 51900];

  function report() {
    const roman = ['I', 'II', 'III', 'IV', 'V', 'VI'];
    console.log('%cPrado Residence BOQ — computed vs Work Order', 'font-weight:bold;font-size:13px');
    COST_ITEMS.forEach((ci, i) => {
      const got = round2(ciSubtotal(ci));
      const exp = PDF_SUBTOTALS[i];
      const ok  = Math.abs(got - exp) < 0.005;
      console.log(`  ${ok ? '✓' : '✗'} ${roman[i]}. ${ci.label}: ${peso(got)}`
        + (ok ? '' : `   ← Work Order says ${peso(exp)}`));
    });
    const grand = round2(COST_ITEMS.reduce((s, ci) => s + ciSubtotal(ci), 0));
    console.log(`  TOTAL PROJECT COST (VAT EX):    ${peso(grand)}   (PDF: ₱ 1,673,153.09)`);
    console.log(`  Less Construction Discount:     ${peso(DISCOUNT)}`);
    console.log(`  DISCOUNTED TOTAL PROJECT COST:  ${peso(grand - DISCOUNT)}   (PDF: ₱ 1,650,000.00)`);

    const lines = COST_ITEMS.reduce((s, ci) => s + ci.subItems.reduce((t, si) =>
      t + si.lineItems.filter((li) => !li.type).length, 0), 0);
    console.log(`  ${lines} line items across ${COST_ITEMS.length} sections.`);
    return grand;
  }

  // ── Import ────────────────────────────────────────────────────────────────
  window.__pradoBoqImport = async function ({ dryRun = true, folderName = 'prado', percent = 0 } = {}) {
    const grand = report();
    if (Math.abs(grand - GRAND_EXPECTED) > 0.5) {
      console.error('Grand total does not match the Work Order. Aborting.');
      return;
    }

    const uid = window.currentDataUserId || (window.currentUser && window.currentUser.uid);
    if (!uid) { console.error('Not signed in — no user id available.'); return; }

    const foldersSnap = await db.collection('folders').where('userId', '==', uid).get();
    const folders = foldersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const matches = folders.filter((f) => (f.name || '').toLowerCase().includes(folderName.toLowerCase()));

    if (!matches.length) {
      console.error(`No folder matching "${folderName}". Folders on this account:`, folders.map((f) => f.name));
      return;
    }
    if (matches.length > 1) {
      console.error(`"${folderName}" matched ${matches.length} folders — narrow it down:`, matches.map((f) => f.name));
      return;
    }
    const folder = matches[0];
    console.log(`Target folder: "${folder.name}" (${folder.id})`);

    const existingSnap = await db.collection('boqDocuments')
      .where('userId', '==', uid).where('folderId', '==', folder.id).get();
    const existing = existingSnap.docs[0];

    // Accomplishment % is a site record, not a quotation figure — it is only
    // stamped when the caller explicitly asks for it. Lines worth ₱0 are left at
    // 0%: they are scope somebody else supplies ("by owner", "by MadHouse",
    // "included in Carpentry Works"), so claiming progress on them says nothing
    // and reads badly to a client.
    const items = JSON.parse(JSON.stringify(COST_ITEMS));
    if (percent) {
      items.forEach((ci) => ci.subItems.forEach((si) => si.lineItems.forEach((li) => {
        if (li.type) return;                       // group header, not a priced row
        const total = liTotal(li);
        if (!total) return;                        // ₱0 line — stays at 0%
        li.percentCompletion = percent;
        li.accomplishmentAmount = (total * (percent / 100)) || '';   // see LI(): not rounded
      })));
    }

    if (dryRun) {
      console.log('%cDRY RUN — nothing written.', 'color:#d97706;font-weight:bold');
      console.log(existing
        ? `An existing BOQ (${existing.id}) would be OVERWRITTEN — including any accomplishment % already encoded on it.`
        : 'A new BOQ document would be created.');
      console.log(`Every line would be imported at ${percent}% complete.`);
      console.log('To write for real:  __pradoBoqImport({ dryRun: false })');
      return { folder, existingId: existing ? existing.id : null, costItems: items };
    }

    if (existing && !confirm(`Overwrite the existing BOQ on "${folder.name}"? This replaces all of its line items and any accomplishment % on them.`)) {
      console.log('Cancelled.');
      return;
    }

    const data = {
      userId:      uid,
      folderId:    folder.id,
      ...HEADER,
      discount:    DISCOUNT,
      costItems:   items,
      clientEmail: (existing && existing.data().clientEmail) || '',
      status:      'draft',
      terms:       TERMS,
      updatedAt:   firebase.firestore.FieldValue.serverTimestamp(),
    };

    if (existing) {
      await db.collection('boqDocuments').doc(existing.id).update(data);
      console.log(`%cUpdated BOQ ${existing.id}.`, 'color:#16a34a;font-weight:bold');
    } else {
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      const ref = await db.collection('boqDocuments').add(data);
      console.log(`%cCreated BOQ ${ref.id}.`, 'color:#16a34a;font-weight:bold');
    }
    console.log('Reload the page, then open Accomplishment Reports → ' + folder.name);
  };

  report();
  console.log('\nLoaded. Run  __pradoBoqImport()  for a dry run, then  __pradoBoqImport({ dryRun: false })  to write.');
})();
