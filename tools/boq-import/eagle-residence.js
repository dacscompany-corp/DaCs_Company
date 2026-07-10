// ============================================================================
// BOQ IMPORT — EAGLE RESIDENCE
// Source: 04_MH_EAGLE_RESIDENCE_BOQ_for_COSTING_-_REV02.pdf (July 16 2025)
//
// HOW TO RUN
//   1. Open admin.html in the browser, logged in as the account that owns the
//      "Eagle Residence" folder.
//   2. Open DevTools → Console.
//   3. Paste this whole file and press Enter. It runs a DRY RUN first and
//      prints the totals it computed — check them against the PDF.
//   4. If the totals look right, run:  __eagleBoqImport({ dryRun: false })
//   5. Reload, then open Accomplishment Reports → Eagle Residence.
//
// Rates are entered as the PDF shows them. Rows the PDF marks "by owner",
// "excluded", "by others", "existing", "OSM" and "not included" are stored as
// rate overrides, which render as that text and count as ₱0 in the totals.
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
  //   a string  → an override such as 'by owner' / 'excluded' (counts as 0)
  function LI(itemNo, description, qty, unit, mat, lab, isOptional) {
    if (mat === '') mat = BLANK;
    if (lab === '') lab = BLANK;
    const matOv = typeof mat === 'string' ? mat : null;
    const labOv = typeof lab === 'string' ? lab : null;
    const m = matOv ? 0 : mat;
    const l = labOv ? 0 : lab;
    const total = round2(parseFloat(qty) * (m + l));
    // Every display path prints the stored totalAmount verbatim, and fmt(0)
    // renders "0.00" while fmt('') renders empty. Rows carrying no priced work
    // ("by owner", "excluded", OSM, blank rates) must stay blank like the PDF.
    return {
      id: gid(),
      itemNo: itemNo || '',
      description,
      qty,
      unit,
      materialRate: matOv ? 0 : mat,
      laborRate:    labOv ? 0 : lab,
      totalAmount:  total || '',
      percentCompletion: 100,
      accomplishmentAmount: total || '',
      isOptional: !!isOptional,
      materialOverride: matOv,
      laborOverride:    labOv,
    };
  }

  const G  = (label) => ({ id: gid(), type: 'group', label });          // group header
  const SI = (label, lineItems) => ({ id: gid(), label, lineItems });   // sub-item (A, B, C…)
  const CI = (label, divisionNo, subItems) => ({ id: gid(), label, divisionNo, subItems });

  // ── I. GENERAL REQUIREMENTS ───────────────────────────────────────────────
  const general = CI('GENERAL REQUIREMENTS', 1, [
    SI('Mobilization & Demobilization', [
      LI('', 'Mobilization / Demobilization', '1.00', 'lot', '', 35000),
      LI('', 'Delivery of Materials',         '1.00', 'lot', '', 35000),
    ]),
    SI('Permits and Licenses', [
      LI('', 'Processing of Admin Permits', '1.00', 'lot', 'by owner', 'by owner'),
    ]),
    SI('Bonds and Insurances', [
      LI('', 'CARI (Construction All Risk Insurance)', '1.00', 'lot', 'by MadHouse', 'by MadHouse'),
      LI('', 'Refundable Construction Bond (for Admin Requirement Purposes)', '1.00', 'lot', 'by owner', 'by owner'),
    ]),
    SI('Clearing and Hauling', [
      LI('', 'Clearing and Hauling', '1.00', 'lot', '', 15000),
    ]),
    SI('Temporary Utilities (Power and Water Supply)', [
      LI('', 'Temporary Utilities (Power and Water Supply)', '1.00', 'lot', 'by owner', 'by owner'),
    ]),
    SI('Protective Covering (For Retained Flooring)', [
      LI('', 'Protective Covering (For Retained Flooring)', '1.00', 'lot', '', 5000),
    ]),
    SI('Site Supervision', [
      LI('', 'Site Supervision', '1.00', 'lot', '', 35000),
    ]),
    SI('As-Built Plans (optional)', [
      LI('', 'As-Built Plans', '1.00', 'lot', '', '', true),
    ]),
  ]);

  // ── II. SITE WORKS ────────────────────────────────────────────────────────
  const siteWorks = CI('SITE WORKS', 2, [
    SI('Demolition Works', [
      LI('', 'Chipping of Existing Wall Tiles on Bathroom', '1.00', 'lot', '', 4000),
      LI('', 'Dismantling of Both Existing Kitchen Counters and Cabinets', '1.00', 'lot', 'excluded', 'excluded'),
      LI('', 'Dismantling of Existing Door on Kitchen Area', '1.00', 'lot', '', 4000),
      LI('', 'Dismantling of Existing Wall Finishes on Common Area', '1.00', 'lot', 'excluded', 'excluded'),
    ]),
    SI('Civil Works', [
      LI('', '100mm Depth Drop Ceiling in 9mm THK Gypsum Board in Metal Furring with 200mm Depth Border for General Ceiling on the Common Area', '16.10', 'sqm', 1250, 1250),
      LI('', '200mm Depth Drop Ceiling in 9mm THK Gypsum Board in Metal Furring with 100mm Depth Cove on the Bedroom Area', '9.00', 'sqm', 1250, 1250),
      LI('', '100mm Depth Drop Ceiling in 9mm THK Gypsum Board in Metal Furring for the Foyer, Kitchen and T&B', '11.70', 'sqm', 1250, 1250),
      LI('', 'Cementitious Waterproofing Works on Bathroom', '1.00', 'lot', 6000, 3000),
      LI('', 'Extension of Existing Partition on Bathroom', '1.00', 'lot', 10000, 4800),
      LI('', 'Construction of False Wall Partition with 100mm Thickness Between Dining Area and Foyer', '1.00', 'lot', '', ''),
      LI('', 'Clearing of Existing Flooring', '1.00', 'lot', 2500, 4800),
      LI('', 'Relocation of Fire Sprinkler and Smoke Detector', '0.00', 'lot', 'by others', 'by others'),
    ]),
  ]);

  // ── III. ARCHITECTURAL / INTERIOR FINISHING WORKS ─────────────────────────
  const architectural = CI('ARCHITECTURAL / INTERIOR FINISHING WORKS', 9, [
    SI('Ceiling Works', [
      LI('CF01',  '0004 CHILD OF HEAVEN SEMI-GLOSS PAINT FINISH BY BOYSEN (or similar)', '37.94', 'sqm', 800, 400),
      LI('CF02',  'SF 4721 WOODGRAIN SERIES LAMINATE BY RUSHIL (or similar)', '2.06', 'l.m.', 3500, 1800),
      LI('CF02a', '30mmx20mm Cove Ceiling Border in SF 4721 WOODGRAIN SERIES LAMINATE BY RUSHIL (or similar)', '5.46', 'l.m.', 3500, 1800),
    ]),
    SI('Wall Works', [
      LI('WF00', 'WALL PREPARATION IN PRIMER PAINT FINISH', '22.12', 'sqm', 500, 300),
      LI('WF01', '0004 CHILD OF HEAVEN SEMI-GLOSS PAINT FINISH BY BOYSEN (or similar)', '51.08', 'sqm', 800, 400),
      LI('WF02', 'BH02 BRITISH TAN WPC FLUTED PANEL BY BAMBOOHUB POLIWOOD (or similar)', '2.17', 'sqm', 3500, 1800),
      LI('WF03', 'QUARTZ KITCHEN BACKSPLASH (verify specs)', '1.84', 'sqm', 11000, 5500),
      LI('WF04', '7206 GRAY LAVA HIGH PRESSURE LAMINATE BY UNICA', '6.90', 'sqm', 3500, 1800),
      LI('WF05', 'SF 4721 WOODGRAIN SERIES LAMINATE BY RUSHIL (or similar) WITH BRONZE ALUMINUM TRIMMING', '16.94', 'sqm', 3800, 1800),
      LI('WF06', '60cm x 60cm TERRAZZO LOOK FINISH TILE (or similar)', '4.52', 'sqm', 1200, 1200),
      LI('WF07', '6088 60cm x 60cm GLAZED CERAMIC TILE POLISHED FINISH BY FLOOR CENTER (or similar)', '10.85', 'sqm', 1200, 1200),
      LI('',     '50mm WIDTH OUTLINED OPENING LAMINATED IN SF 4721 WOODGRAIN SERIES LAMINATES BY RUSHIL', '5.00', 'l.m.', 1800, 800),
    ]),
    SI('Floor Works', [
      LI('RET',  'RETAINED FLOORING', '26.35', 'sqm', '', ''),
      LI('FF01', 'SPC01 1220x183x5mm STONE PLASTIC COMPOSITE PANEL IN TEAK FLOORING BY BAMBOOHUB (or similar)', '10.23', 'sqm', 2500, 800),
      LI('FF02', '60cm x 60cm TERRAZZO LOOK FINISH TILE (or similar)', '4.08', 'sqm', 1200, 800),
    ]),
    SI('Doors and Windows, Glass and Glazing', [
      G('SUPPLY AND INSTALLATION OF DOORS INCLUDING HINGE AND ACCESSORIES'),
      LI('D01', 'FLUSH CONCEALED DOOR INCORPORATED ON THE ACCENT WALL WITH BH02 BRITISH TAN WPC FLUTED PANEL BY BAMBOOHUB POLIWOOD (or similar)', '1.00', 'set/s', 12000, 6000),
      LI('D02', 'PVC FLUSH DOOR WITH LOUVER (or similar)', '1.00', 'set/s', 7500, 2500),
      LI('D03', '6mm THK. CLEAR TEMPERED GLASS SWING DOOR SHOWER ENCLOSURE', '1.00', 'set/s', 11000, 11000),
      G('SUPPLY AND INSTALLATION OF GLASS AND MIRRORS INCLUDING ACCESSORIES'),
      LI('', '6mm THK x 2447mm x 700mm CLEAR MIRROR ON FOYER AREA',   '1.00', 'set/s', 12000, 6000),
      LI('', '6mm THK x 2447mm x 875mm CLEAR MIRROR ON BEDROOM AREA', '1.00', 'set/s', 12000, 6000),
      LI('', '6mm THK x 750mm x 750mm CLEAR MIRROR ON BEDROOM AREA',  '1.00', 'set/s', 'excluded', 'excluded'),
    ]),
  ]);

  // ── IV. CARPENTRY WORKS AND FURNITURES ────────────────────────────────────
  const carpentry = CI('CARPENTRY WORKS AND FURNITURES', 12, [
    SI('Supply and Installation of Carpentry Works Including Finishes, Striplights, Hardwares, and Mechanisms (See Carpentry/Cabinetry Details on Plans)', [
      G('BUILT-IN FURNITURES'),
      LI('B01', 'SHOE CABINET', '1.00', 'set/s', 9600, 6400),
      LI('B02', 'FULL LENGTH CABINET', '1.00', 'set/s', 'excluded', 'excluded'),
      LI('B03', 'KITCHEN COUNTER AND CABINETS 1 (Relamination, Additional Cabinet, and Change in Countertop Only) Note: Retain Kitchen Sink and Faucet', '1.00', 'set/s', 40000, 15000),
      LI('B04', 'KITCHEN COUNTER AND CABINETS 2 (Relamination, Additional Cabinet, and Change in Countertop Only) Note: Retain Kitchen Sink and Faucet', '1.00', 'set/s', 35000, 15000),
      LI('B05', 'SHELVES AND CABINET', '1.00', 'set/s', 39357.50, 29357.50),
      LI('B06', 'ENTERTAINMENT CABINET', '1.00', 'set/s', 34205, 24205),
      LI('B07', 'BED WITH VANITY TABLE (Including Headboards)', '1.00', 'set/s', 'excluded', 'excluded'),
      LI('B08', 'CLOSET', '1.00', 'set/s', 35000, 20000),
      LI('B09', 'LAVATORY CABINET (Including Countertop and Mirror) Note: New Lavatory and Faucet is included on Plumbing Fixtures Section', '1.00', 'set/s', 36456, 24304),
      LI('B10', 'LAUNDRY NOOK', '1.00', 'set/s', 15456, 10304),
      G('LOOSE FURNITURES'),
      LI('F01', 'DINING CHAIR',        '6.00', 'set/s', 'OSM', 'OSM'),
      LI('F02', 'DINING TABLE',        '1.00', 'set/s', 'OSM', 'OSM'),
      LI('F03', 'SIDE TABLE',          '1.00', 'set/s', 'OSM', 'OSM'),
      LI('F04', 'L-SHAPED SOFA',       '2.00', 'set/s', 'OSM', 'OSM'),
      LI('F05', 'COFFEE TABLE',        '2.00', 'set/s', 'OSM', 'OSM'),
      LI('F06', 'ROUND STOOL',         '1.00', 'set/s', 'OSM', 'OSM'),
      LI('F07', 'QUEEN SIZE MATTRESS', '1.00', 'set/s', 'OSM', 'OSM'),
      G('INTERIOR STYLING'),
      LI('', 'Interior Styling Service', '1.00', 'set/s', 'not included', 'not included'),
      LI('', 'Decorations (Displays, Rugs, Painting, etc…)', '1.00', 'set/s', 'not included', 'not included'),
    ]),
  ]);

  // ── V. ELECTRICAL WORKS ───────────────────────────────────────────────────
  const electrical = CI('ELECTRICAL WORKS', 16, [
    SI('Roughing-Ins', [
      LI('', 'Supply and Installation of Conduits, Pipes, Boxes and Fittings', '1.00', 'lot', 30000, 15000),
    ]),
    SI('Piping Lines', [
      LI('', 'Supply and Installation of Wires and Cables', '1.00', 'lot', 20000, 10000),
    ]),
    SI('Wiring Devices', [
      G('OUTLETS'),
      LI('', 'MD901 - 1 GANG OUTLET SET W/ GROUND BY ROYU (or similar)', '1.00', 'set/s', 600, 300),
      LI('', 'RW08 WEATHER-PROOF DUPLEX UNIVERSAL OUTLET WITH GROUND & SHUTTER BY ROYU (or similar)', '2.00', 'set/s', 600, 300),
      LI('', 'MDS113 PLANO 2-GANG OUTLET SET - WHITE BY ROYU (or similar)', '15.00', 'set/s', 600, 300),
      LI('', 'MD913 PLANO DUPLEX UNIVERSAL OUTLET WITH GROUND AND SHUTTER SET - WHITE BY ROYU (or similar)', '1.00', 'set/s', 600, 300),
      LI('', 'WD901 1-GANG AIRCON OUTLET SET BY ROYU (or similar)', '2.00', 'set/s', 600, 300),
      LI('', 'RWX2 - 1 GANG CABLE TV MODULAR JACK BY ROYU (or similar)', '1.00', 'set/s', 600, 300),
      LI('', 'TELEPHONE OUTLET BY ROYU (or similar)', '1.00', 'set/s', 600, 300),
      G('SWITCHES'),
      LI('Sab',  '2-GANG 1-WAY SWITCH SET IN IVORY (DESIGNER SERIES) BY OMNI', '3.00', 'set/s', 700, 300),
      LI('Sabc', '3-GANG 1-WAY SWITCH SET IN IVORY (DESIGNER SERIES) BY OMNI', '9.00', 'set/s', 800, 300),
    ]),
    SI('Panel Boards and ECBs', [
      LI('', 'Existing Panelboard', '1.00', 'lot', BLANK, BLANK),
    ]),
    SI('Lighting Fixtures', [
      LI('', '9W (0170mm x 30mm) 3500K DAYLIGHT DLH50-170-AR111 WHITE LED RECESSED ROUND DOWNLIGHT BY LANDLITE (or similar)', '19.00', 'set/s', 600, 300),
      LI('', '2835 IP20 6W 3500K DAYLIGHT INDOOR FLEXIBLE LED STRIP LIGHT WITH 28mmx11mmx1000mm WITH WW-AP2811-100 ALUMINUM PROFILE SURFACE MOUNTED BY LANDLITE (verify designer)', '50.00', 'l.m.', 300, 150),
      LI('', 'WALL LIGHT',            '1.00', 'set/s', 800, 800),
      LI('', 'DOUBLE LED DOWNLIGHTS', '1.00', 'set/s', 800, 800),
      LI('', 'CHANDELIER',            '1.00', 'set/s', 5000, 1000),
      LI('', 'PENDANT LIGHT',         '2.00', 'set/s', 3000, 1500),
    ]),
  ]);

  // ── VI. PLUMBING WORKS ────────────────────────────────────────────────────
  const plumbing = CI('PLUMBING WORKS', 15, [
    SI('Plumbing Fixtures', [
      G('KITCHEN'),
      LI('', 'Kitchen Sink', '1.00', 'lot', '', ''),
      LI('', 'Faucet',       '1.00', 'lot', '', ''),
      G('BATHROOM'),
      LI('', 'Lavatory',        '1.00', 'lot', 5000,  2500),
      LI('', 'Lavatory Faucet', '1.00', 'lot', 2500,  1250),
      LI('', 'Towel Holder',    '1.00', 'lot', 1600,  800),
      LI('', 'Tissue Holder',   '1.00', 'lot', 1000,  500),
      LI('', 'Shower Set',      '1.00', 'lot', 10000, 5000),
      LI('', 'Water Closet',    '1.00', 'lot', 10000, 5000),
      LI('', 'Bidet',           '1.00', 'lot', 1200,  600),
    ]),
  ]);

  const COST_ITEMS = [general, siteWorks, architectural, carpentry, electrical, plumbing];

  const HEADER = {
    date:        '2025-07-16',
    projectName: 'EAGLE RESIDENCE',
    area:        '49',
    ownerName:   'RACHEL ROQUE EAGLE',
    location:    'THE COLUMNS, MAKATI CITY',
    subject:     'Accomplishment Report',
  };

  const DISCOUNT = 44573;

  const TERMS = {
    payments: [
      '50% DOWNPAYMENT',
      '40% PROGRESS BILLING (Every Other Week)',
      '  20% Progress Billing No. 1',
      '  20% Progress Billing No. 2',
      '10% UPON TURNOVER/COC',
    ].join('\n'),
    exclusions: [
      'Fire Protection Works (Sprinkler, Smoke Detectors, etc)',
      'Mattress, Beddings and Pillows',
      'Panel Board and other electrical works not mentioned',
      'Plumbing works not mentioned',
      'Appliances (TV, Refrigerator, Stove, Range Hood, Water Heater, Filters and etc)',
      'A/C Supply and Install',
      'Decors and Accessories (Wall Paintings, Vases, Displays and etc) (Interior Styling fee P50,000 + decors actual cost)',
      'Window Treatments (Curtains and Blinds)',
      'Loose Furnitures',
    ].join('\n'),
    duration: '45 - 60 Days\nSeason 3: Year-End Holiday Season (August-November)',
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

  function report() {
    const roman = ['I', 'II', 'III', 'IV', 'V', 'VI'];
    console.log('%cEagle Residence BOQ — computed totals', 'font-weight:bold;font-size:13px');
    COST_ITEMS.forEach((ci, i) => console.log(`  ${roman[i]}. ${ci.label}: ${peso(ciSubtotal(ci))}`));
    const grand = COST_ITEMS.reduce((s, ci) => s + ciSubtotal(ci), 0);
    console.log(`  TOTAL PROJECT COST (VAT EX):    ${peso(grand)}   (PDF: ₱ 1,374,573.00)`);
    console.log(`  DISCOUNT:                       ${peso(DISCOUNT)}`);
    console.log(`  DISCOUNTED TOTAL PROJECT COST:  ${peso(grand - DISCOUNT)}   (PDF: ₱ 1,330,000.00)`);

    const acc = COST_ITEMS.reduce((s, ci) => s + ci.subItems.reduce((t, si) =>
      t + si.lineItems.reduce((u, li) => u + liTotal(li) * ((li.percentCompletion || 0) / 100), 0), 0), 0);
    console.log(`  TOTAL ACCOMPLISHMENT (all 100%): ${peso(acc)}`);
    return grand;
  }

  // ── Import ────────────────────────────────────────────────────────────────
  window.__eagleBoqImport = async function ({ dryRun = true, folderName = 'eagle' } = {}) {
    const grand = report();
    if (Math.abs(grand - 1374573) > 0.5) {
      console.error('Grand total does not match the PDF. Aborting.');
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

    if (dryRun) {
      console.log('%cDRY RUN — nothing written.', 'color:#d97706;font-weight:bold');
      console.log(existing
        ? `An existing BOQ (${existing.id}) would be OVERWRITTEN.`
        : 'A new BOQ document would be created.');
      console.log('To write for real:  __eagleBoqImport({ dryRun: false })');
      return { folder, existingId: existing ? existing.id : null, costItems: COST_ITEMS };
    }

    if (existing && !confirm(`Overwrite the existing BOQ on "${folder.name}"? This replaces all of its line items.`)) {
      console.log('Cancelled.');
      return;
    }

    const data = {
      userId:      uid,
      folderId:    folder.id,
      ...HEADER,
      discount:    DISCOUNT,
      costItems:   COST_ITEMS,
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
  console.log('\nLoaded. Run  __eagleBoqImport()  for a dry run, then  __eagleBoqImport({ dryRun: false })  to write.');
})();
