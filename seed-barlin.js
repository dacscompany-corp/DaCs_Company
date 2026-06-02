/**
 * BARLIN RESIDENCE — Seed Script (Fixed)
 * Paste into browser console while logged in as admin.
 * Uses existing folder: 98ImRXJEWfcBB91gJv4z
 * Deletes any existing boqDocument for this folder first, then re-creates.
 */
(async function () {
    const uid = auth.currentUser?.uid;
    if (!uid) { console.error('❌ Not logged in.'); return; }

    const gid = () => '_' + Math.random().toString(36).slice(2, 10);
    const ts  = firebase.firestore.FieldValue.serverTimestamp();
    const FOLDER_ID = 'XhQlZSk3dIq0zuPjd62g';

    // Delete existing boqDocuments for this folder
    const existing = await db.collection('boqDocuments').where('folderId', '==', FOLDER_ID).get();
    for (const d of existing.docs) { await d.ref.delete(); }
    console.log(`🗑️ Deleted ${existing.size} old document(s).`);

    // Helper: build a line item
    // mat / lab = rate per unit. totalAmount = qty * (mat + lab) unless overridden.
    const li = (itemNo, description, qty, unit, mat, lab, total, opts = {}) => ({
        id: gid(), itemNo, description, qty, unit,
        materialRate:     opts.matOverride ? 0    : mat,
        laborRate:        opts.labOverride ? 0    : lab,
        materialOverride: opts.matOverride || '',
        laborOverride:    opts.labOverride || '',
        totalAmount:      total,
        percentCompletion:    90,
        accomplishmentAmount: Math.round(total * 0.9 * 100) / 100,
        isOptional: opts.optional || false
    });

    const costItems = [

        // ══════════════════════════════════════════════════════════════
        // I. GENERAL REQUIREMENTS  →  Subtotal: 140,000.00
        // ══════════════════════════════════════════════════════════════
        { id: gid(), label: 'GENERAL REQUIREMENTS', subItems: [

            { id: gid(), label: 'Mobilization & Demobilization', lineItems: [
                // mat: -   lab: 30,000   total: 1×30,000 = 30,000
                li('', 'Mobilization / Demobilization', 1, 'lot', 0, 30000, 30000, { matOverride: '-' }),
                // mat: -   lab: 30,000   total: 1×30,000 = 30,000
                li('', 'Delivery of Materials',          1, 'lot', 0, 30000, 30000, { matOverride: '-' }),
            ]},

            { id: gid(), label: 'Permits and Licenses', lineItems: [
                // mat: -   lab: 15,000   total: 1×15,000 = 15,000
                li('', 'Processing of Admin Permits', 1, 'lot', 0, 15000, 15000, { matOverride: '-' }),
            ]},

            { id: gid(), label: 'Bonds and Insurances', lineItems: [
                // mat: -   lab: -   total: 0
                li('', 'CARI (Construction All Risk Insurance)',                        1, 'lot', 0, 0, 0, { matOverride: '-', labOverride: '-' }),
                // by owner → total: 0
                li('', 'Refundable Construction Bond (for Admin Requirement Purposes)', 1, 'lot', 0, 0, 0, { labOverride: 'by owner' }),
            ]},

            // D–H as line items under blank sub-item (no duplicate label rows)
            { id: gid(), label: '', lineItems: [
                // D. lab: 35,000   total: 1×35,000 = 35,000
                li('D.', 'Clearing and Hauling',                         1, 'lot', 0, 35000, 35000),
                // E. by owner → total: 0
                li('E.', 'Temporary Utilities (Power and Water Supply)', 1, 'lot', 0, 0,     0,     { labOverride: 'by owner' }),
                // F. mat: -   lab: -   total: -
                li('F.', 'Protective Covering (For Retained Flooring)',  1, 'lot', 0, 0,     0,     { matOverride: '-', labOverride: '-' }),
                // G. mat: -   lab: 30,000   total: 30,000
                li('G.', 'Site Supervision',                             1, 'lot', 0, 30000, 30000, { matOverride: '-' }),
                // H. optional   mat: -   lab: -   total: -
                li('H.', 'As-Built Plans (optional)',                    1, 'lot', 0, 0,     0,     { matOverride: '-', labOverride: '-', optional: true }),
            ]},
        ]},

        // ══════════════════════════════════════════════════════════════
        // II. SITE WORKS  →  Subtotal: 96,300.00
        // ══════════════════════════════════════════════════════════════
        { id: gid(), label: 'SITE WORKS', subItems: [
            { id: gid(), label: 'Civil Works', lineItems: [
                // 45 sqm × (1,100 + 800) = 45 × 1,900 = 85,500
                li('', 'Drop Cove Ceiling in 12mm THK Gypsum Board MR in Metal Furring', 45, 'sqm', 1100, 800,   85500),
                // 1 lot × 10,800 = 10,800
                li('', 'Demolition of Partition Wall',                                    1,  'lot', 0,    10800, 10800, { matOverride: '-' }),
            ]},
        ]},

        // ══════════════════════════════════════════════════════════════
        // III. ARCHITECTURAL / INTERIOR FINISHING WORKS  →  393,265.00
        // ══════════════════════════════════════════════════════════════
        { id: gid(), label: 'ARCHITECTURAL / INTERIOR FINISHING WORKS', subItems: [

            { id: gid(), label: 'Ceiling Works', lineItems: [
                // CF01  45 × (900+450) = 45×1,350 = 60,750
                li('CF01', 'SEMI-GLOSS PAINT IN WHITE', 45, 'sqm', 900, 450, 60750),
            ]},

            { id: gid(), label: 'Wall Works', lineItems: [
                // WF01  60.77 × (1,200+600) = 60.77×1,800 = 109,386
                li('WF01', 'STUCCO WALL FINISH IN WHITE',                          60.77, 'sqm', 1200, 600,  109386),
                // WF02  16.83 × (1,100+500) = 16.83×1,600 = 26,928
                li('WF02', '60X60CM WHITE FLOOR TILE',                              16.83, 'sqm', 1100, 500,   26928),
                // WF03  2.09 × (2,200+1,100) = 2.09×3,300 = 6,897
                li('WF03', '3/4" MARINE PLYWOOD IN NATURAL OAK WOODGRAIN FINISH',   2.09,  'sqm', 2200, 1100,   6897),
                // WF04  7.36 × 3,300 = 24,288
                li('WF04', 'VERTICAL FLUTED PANEL IN WHITE',                         7.36,  'sqm', 2200, 1100,  24288),
                // WF05  4.88 × 3,300 = 16,104
                li('WF05', 'ACCENT WALL',                                             4.88,  'sqm', 2200, 1100,  16104),
            ]},

            { id: gid(), label: 'Floor Works', lineItems: [
                // RET  retained — no cost
                li('RET',  'Retain Flooring',             4.18,  'sqm', 0,    0,   0,     { matOverride: '-', labOverride: '-' }),
                // FF01  40.82 × (1,100+500) = 40.82×1,600 = 65,312
                li('FF01', '60x60CM LIGHT GREY FLOOR TILE', 40.82, 'sqm', 1100, 500, 65312),
            ]},

            { id: gid(), label: 'Doors and Windows, Glass and Glazing', lineItems: [
                // Supply and install doors — header note
                li('', 'Supply and Installation of Doors including hinge and accessories', 0, '', 0, 0, 0, { matOverride: '-', labOverride: '-' }),
                // Bedroom 1&2  2 × (22,000+8,800) = 2×30,800 = 61,600
                li('', 'Bedroom 1 & 2',                                                    2, 'set/s', 22000, 8800, 61600),
                // Refinish  2 × 5,000 = 10,000
                li('', 'Main Door (Back side) & CR Door (Both side) - Refinish',           2, 'set/s', 0,     5000, 10000, { matOverride: '-' }),
                // Glass & mirrors header
                li('', 'Supply and Installation of Glass and Mirrors including accessories', 0, '', 0, 0, 0, { matOverride: '-', labOverride: '-' }),
                // Vanity Mirror  1 × (10,000+2,000) = 12,000
                li('', 'Custom Vanity Mirror at Toilet & Bath',                             1, 'set/s', 10000, 2000, 12000),
            ]},
        ]},

        // ══════════════════════════════════════════════════════════════
        // IV. CARPENTRY WORKS AND FURNITURES  →  Subtotal: 794,610.00
        // All items under one sub-item "A." with room headers as label rows
        // ══════════════════════════════════════════════════════════════
        { id: gid(), label: 'CARPENTRY WORKS AND FURNITURES', subItems: [
            { id: gid(), label: 'Supply and Installation of Carpentry Works Including Finishes, Striplights, Hardwares, and Mechanisms (See Carpentry/Cabinetry Details on Plans)', lineItems: [
                // ── ENTRY/FOYER ──
                li('',     'ENTRY/FOYER',                    0, '', 0, 0, 0, { matOverride: '-', labOverride: '-' }),
                li('B-01', 'SHOE RACK',                      1, 'set/s', 24948,    16632,    41580),
                li('B-02', 'CABINET STORAGE',                1, 'set/s', 27459,    18306,    45765),
                li('B-03', 'KITCHEN CABINET WITH POCKET DOOR', 1, 'set/s', 31849.20, 21232.80, 53082),
                li('B-04', 'CABINET',                        1, 'set/s', 22453.20, 14968.80, 37422),
                li('B-05', 'TV CONSOLE & DISPLAY CAB/SHELF', 1, 'set/s', 27621,    18414,    46035),
                li('B-06', 'CABINET WITH SHELF',             1, 'set/s', 22477.50, 14985,    37462.50),
                // ── BEDROOM 1 & 2 ──
                li('',     'BEDROOM 1 & 2',                  0, '', 0, 0, 0, { matOverride: '-', labOverride: '-' }),
                li('B-07', 'STUDY TABLE WITH CABINET',        1, 'set/s', 29678.40, 19785.60, 49464),
                li('B-08', 'WARDROBE',                        1, 'set/s', 29014.20, 19342.80, 48357),
                li('B-09', 'BED WITH STORAGE',                1, 'set/s', 44469,    29646,    74115),
                li('B-10', 'OPEN SHELF',                      1, 'set/s', 24624,    16416,    41040),
                li('B-11', 'STUDY TABLE',                     1, 'set/s', 24570,    16380,    40950),
                li('B-12', 'RAISED FRAMED BED WITH STORAGE',  1, 'set/s', 55930.50, 37287,    93217.50),
                li('B-13', 'WARDROBE 1',                      1, 'set/s', 26730,    17820,    44550),
                li('B-14', 'UPHOLSTERED SITTING',             1, 'set/s', 33696,    22464,    56160),
                li('F-05', 'BED SIDE TABLE',                  1, 'set/s', 14000,    4800,     18800),
                // ── TOILET & BATH ──
                li('',     'TOILET & BATH',                   0, '', 0, 0, 0, { matOverride: '-', labOverride: '-' }),
                li('B-15', 'SHELF WITH MIRROR',               1, 'set/s', 32886,    21924,    54810),
                li('B-16', 'LAVATORY CABINET RELAMINATION',   1, 'set/s', 7000,     4800,     11800),
            ]},
        ]},

        // ══════════════════════════════════════════════════════════════
        // V. ELECTRICAL WORKS  →  Subtotal: 176,660.00
        // ══════════════════════════════════════════════════════════════
        { id: gid(), label: 'ELECTRICAL WORKS', subItems: [

            { id: gid(), label: 'Roughing-Ins', lineItems: [
                // 1 lot × (20,500+13,950) = 34,450
                li('', 'Supply and Installation of Conduits, Pipes, Boxes and Fittings', 1, 'lot', 20500, 13950, 34450),
            ]},

            { id: gid(), label: 'Piping Lines A', lineItems: [
                // 1 lot × (32,650+21,360) = 54,010
                li('', 'Supply and Installation of Wires and Cables', 1, 'lot', 32650, 21360, 54010),
            ]},

            { id: gid(), label: 'Wiring Devices', lineItems: [
                li('', 'Outlets', 0, '', 0, 0, 0, { matOverride: '-', labOverride: '-' }),
                // 6 × (600+240) = 6×840 = 5,040
                li('',    'UNIVERSAL DUPLEX OUTLET SET (verify brand)',                                                    6, 'pcs', 600, 240, 5040),
                // 1 × (800+320) = 1,120
                li('',    'DUPLEX CONVENIENCE OUTLET SET W/ GROUND FAULT CIRCUIT INTERRUPTER BY ROYU (or similar)',        1, 'pcs', 800, 320, 1120),
                // 1 × (900+360) = 1,260
                li('',    'REFRIGERATOR OUTLET SET',  1, 'pc',  900, 360, 1260),
                // 1 × (900+360) = 1,260
                li('',    'MICROWAVE OVEN OUTLET SET', 1, 'pc',  900, 360, 1260),
                li('', 'Switches', 0, '', 0, 0, 0, { matOverride: '-', labOverride: '-' }),
                // 3 × (450+180) = 3×630 = 1,890
                li('Sa',  'MD511 ONE GANG SWITCH SET WHITE BY ROYU (as similar)',   3, 'pcs', 450, 180, 1890),
                // 4 × 630 = 2,520
                li('Sab', 'MD513 TWO GANG SWITCH SET WHITE BY ROYU (as similar)',   4, 'pcs', 450, 180, 2520),
                // 1 × (650+260) = 910
                li('Sabc','MD515 THREE GANG SWITCH SET WHITE BY ROYU (as similar)', 1, 'pcs', 650, 260,  910),
            ]},

            { id: gid(), label: 'Panel Boards and ECBs', lineItems: [
                li('', 'Existing Panelboard', 1, 'lot', 0, 0, 0, { labOverride: 'existing' }),
            ]},

            { id: gid(), label: 'Lighting Fixtures', lineItems: [
                // 18 × (1,000+400) = 18×1,400 = 25,200
                li('LLR-1OWCW', '1OW LED RECESSED CIRCULAR (100mm) DOWNLIGHT BY OMNI (as similar)',                                             18, 'pcs', 1000, 400, 25200),
                // 30 × 1,400 = 42,000
                li('',          '2835 IP20 14.4W INDOOR LED STRIP LIGHT WW IN WW-AP28-100 RECESSED ALUMINUM PROFILE BY LANDLITE or similar',   30, 'lm',  1000, 400, 42000),
                // 1 × (2,000+800) = 2,800
                li('',          'DROP LIGHT 1 (Verify designer)',  1, 'set', 2000, 800,  2800),
                // 1 × (3,000+1,200) = 4,200
                li('',          'WALL LIGHT (Verify designer)',    1, 'set', 3000, 1200, 4200),
            ]},
        ]},

        // ══════════════════════════════════════════════════════════════
        // VI. PLUMBING WORKS  →  Subtotal: 1,400.00
        // ══════════════════════════════════════════════════════════════
        { id: gid(), label: 'PLUMBING WORKS', subItems: [
            { id: gid(), label: 'Plumbing Fixtures', lineItems: [
                // 1 × (1,000+400) = 1,400
                li('', 'Towel Holder',    1, 'set/s', 1000, 400, 1400),
            ]},
        ]},

    ]; // end costItems

    // Verify grand total
    const grandTotal = costItems.reduce((s, ci) =>
        s + ci.subItems.reduce((s2, si) =>
            s2 + si.lineItems.reduce((s3, li) => s3 + li.totalAmount, 0), 0), 0);
    console.log('📊 Computed Grand Total:', grandTotal.toLocaleString(), '(expected 1,602,235)');

    // Create BOQ Document
    const docRef = await db.collection('boqDocuments').add({
        folderId:    FOLDER_ID,
        userId:      uid,
        date:        '2026-04-07',
        projectName: 'Barlin Residence',
        area:        '45',
        ownerName:   'GERALYN BARLIN',
        location:    'Mandaluyong City',
        subject:     'Accomplishment Report',
        discount:    7235,
        clientEmail: '',
        status:      'draft',
        costItems,
        terms: {
            payments:   '50% DOWNPAYMENT\n40% PROGRESS BILLING (Staggered Payment)\n10% UPON TURNOVER/COC',
            exclusions: 'Fire Protection Works (Sprinkler, Smoke Detectors, etc)\nMattress, Beddings and Pillows\nPanel Board and other electrical works not mentioned\nPlumbing works not mentioned\nAppliances (TV, Refrigerator, Stove, Range Hood, Water Heater, Filters and etc)\nA/C Supply and Install\nDecors and Accessories (Wall Paintings, Vases, Displays and etc) (Interior Styling fee P50,000 + decors actual cost)\nWindow Treatments (Curtains and Blinds)',
            duration:   '45 - 60 Days'
        },
        createdAt: ts,
        updatedAt: ts
    });

    console.log('✅ Barlin Residence BOQ created! Doc ID:', docRef.id);
    console.log('Done! Refresh the page to see it.');
})();
