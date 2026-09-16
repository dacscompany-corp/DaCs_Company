/* ════════════════════════════════════════════════════════════════════
   ACCOMPLISHMENT REPORT PRINT — A4 sheet and PDF export.

   The Project Management accomplishment report had no printed output at
   all until now; the builder's "Printed sheet options" switches had
   nothing to act on. This is that output.

   Deliberately shaped like js/quotation-print.js and the BOQ report so
   the three documents read as one family: same letterhead, same meta
   box, same yellow head / red section / grey sub-item table, same
   signature columns. Where they differ, the report wins — it carries
   % Complete and Accomplishment columns a quotation has no use for.

   The money math is NOT re-implemented here. It is read off
   window.pmRpMath, which js/pm-admin.js publishes from the single copy
   the builder itself uses, so the sheet can never drift from the screen.
   ════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    // Same seller block as the quotation sheet. Kept in step by hand; if the
    // contact line is ever filled in there, fill it in here too.
    const COMPANY = {
        name: "DAC'S CONSTRUCTION",
        logo: 'assets/images/DACS-TRANSPARENT.png',
        contact: ''
    };
    const DOC_LABEL = 'ACCOMPLISHMENT REPORT';

    const esc = (s) => String(s === null || s === undefined ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const M = () => window.pmRpMath || {};
    const fmt = (n) => Number(M().num ? M().num(n) : (n || 0))
        .toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    function prettyDate(key) {
        if (!key) return '';
        // Build from local parts — PH is UTC+8 and new Date('YYYY-MM-DD') is
        // parsed as UTC, which renders the day before.
        const p = String(key).split('-');
        if (p.length !== 3) return String(key);
        const d = new Date(+p[0], +p[1] - 1, +p[2]);
        return isNaN(d) ? String(key)
            : d.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
    }

    const ROMAN = ['I','II','III','IV','V','VI','VII','VIII','IX','X',
                   'XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX'];
    const roman = (n) => ROMAN[n] || String(n + 1);
    const alpha = (n) => n < 26 ? String.fromCharCode(65 + n) : String(n + 1);

    // Staff must never see peso amounts, whatever the document says.
    function showsAmounts(d) {
        if (window.currentUserRole === 'staff') return false;
        return d.showAmounts !== false;
    }
    const showsLogo      = (d) => d.showLogo !== false;
    const showsPrepared  = (d) => d.showSignPrepared !== false;
    const showsSubmitted = (d) => d.showSignSubmitted !== false;

    function companyLine() {
        return [COMPANY.contact].filter(Boolean).join('  ·  ');
    }

    // ── Rows ──────────────────────────────────────────
    // Columns follow the quotation's itemized estimate, plus the one it has no
    // use for:  # | DESCRIPTION | QTY | UNIT | UNIT PRICE | AMOUNT | % COMPLETE
    // With amounts off, UNIT PRICE and AMOUNT drop out and everything shifts.
    //
    // A removed line is not scope and never prints. An optional or waived line
    // prints, labelled, at nothing — exactly as a quotation totals it.
    function rowsHtml(d, money) {
        const m = M();
        const span = money ? 5 : 3;          // label swallows through AMOUNT / UNIT
        const cols = money ? 7 : 5;
        if (!(d.costItems || []).length) {
            return `<tr><td class="p-empty" colspan="${cols}">No work items.</td></tr>`;
        }
        let html = '';
        (d.costItems || []).forEach((ci, ciIdx) => {
            const ciNo = roman(ciIdx);
            const lump = m.isLump(ci);
            html += `<tr class="p-l1"><td class="c-no">${ciNo}.</td>`
                  + `<td colspan="${span}">${esc(ci.name || '')}${lump ? ' <span class="p-lot">LOT</span>' : ''}</td>`
                  + `<td class="c-ctr">${Math.round((m.ciSub(ci) > 0 ? m.ciAcc(ci) / m.ciSub(ci) : 0) * 100)}%</td></tr>`;

            (ci.subItems || []).forEach((si, siIdx) => {
                html += `<tr class="p-l2"><td class="c-no">${alpha(siIdx)}.</td>`
                      + `<td colspan="${span}">${esc(si.name || '')}</td>`
                      + `<td class="c-ctr">${Math.round(m.groupPct(ci, si) * 100)}%</td></tr>`;

                (si.lineItems || []).forEach((li, liIdx) => {
                    const st = li.state || 'normal';
                    if (st === 'removed') return;           // not scope, never printed
                    const label = esc(li.description || '')
                        + (st === 'optional' ? ' <span class="p-tag">(optional)</span>' : '')
                        + (st === 'waived'   ? ' <span class="p-tag">(waived)</span>' : '');
                    html += `<tr class="p-l3${st !== 'normal' ? ' p-muted' : ''}">
                        <td class="c-no">${liIdx + 1}</td>
                        <td>${label}</td>
                        <td class="c-ctr">${esc(li.qty || '')}</td>
                        <td class="c-ctr">${esc(li.unit || '')}</td>
                        ${money ? `<td class="c-amt">${lump ? '<span class="p-tag">scope</span>'
                                        : (m.liRate(li) ? fmt(m.liRate(li)) : '')}</td>
                        <td class="c-amt">${lump ? '' : fmt(m.liTotal(li))}</td>` : ''}
                        <td class="c-ctr">${m.num(li.percentCompletion) ? m.num(li.percentCompletion) + '%' : ''}</td>
                    </tr>`;
                });
            });

            if (money) {
                html += `<tr class="p-sub">
                    <td colspan="${span}">Subtotal — ${ciNo}. ${esc(ci.name || '')}</td>
                    <td class="c-amt">${fmt(m.ciSub(ci))}</td>
                    <td class="c-ctr">${fmt(m.ciAcc(ci))}</td>
                </tr>`;
            }
        });
        return html;
    }

    function imagesHtml(d) {
        const imgs = (d.images || []).filter(i => i && i.url);
        if (!imgs.length) return '';
        return `<div class="p-imgs">${imgs.map(i => `
            <figure><img src="${esc(i.url)}" alt="" onerror="this.closest('figure').style.display='none'">
            ${i.caption ? `<figcaption>${esc(i.caption)}</figcaption>` : ''}</figure>`).join('')}</div>`;
    }

    function summaryHtml(d, money) {
        if (!money) return '';
        const m = M();
        return `<table class="p-tot">
            <tr><td class="k">Total Project Cost:</td><td class="v">${fmt(m.grand(d.costItems))}</td></tr>
            <tr><td class="k">Total Accomplishment:</td><td class="v">${fmt(m.acc(d.costItems))}</td></tr>
            <tr class="p-tot-final"><td class="k">Overall Progress:</td><td class="v">${m.pct(d)}%</td></tr>
        </table>`;
    }

    // Signature columns. "Submitted by" falls back to "Prepared by", then to
    // the company name — the same ladder the quotation sheet uses, and what
    // the editor's hint promises.
    function sigHtml(d) {
        const cols = [];
        if (showsPrepared(d))  cols.push({ label: 'Prepared by', name: d.preparedBy || '' });
        if (showsSubmitted(d)) cols.push({ label: 'Submitted by',
            name: d.submittedBy || d.preparedBy || COMPANY.name });
        cols.push({ label: 'Conforme — Client', name: d.ownerName || '' });
        return `<div class="p-sig">${cols.map(c => `
            <div class="p-sig-col">
                <div class="p-sig-line"></div>
                <div class="p-sig-name">${esc(c.name)}</div>
                <div class="p-sig-role">${esc(c.label)}</div>
            </div>`).join('')}</div>`;
    }

    function sheetHtml(d) {
        const money = showsAmounts(d);
        const base = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);
        const cols = money ? 7 : 5;
        return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>${esc(d.subject || 'Accomplishment Report')} — ${esc(d.projectName || '')}</title>
<style>
  /* Colours mirror js/quotation-print.js and the BOQ report so all three
     read as one family. Every tinted surface carries print-color-adjust:exact —
     without it the browser drops the fills and the sheet prints plain white. */
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:'Segoe UI',Arial,sans-serif;font-size:8.5pt;color:#111;background:#e8e8e8;}
  .page{position:relative;width:210mm;min-height:297mm;background:#fff;margin:12px auto;
        padding:12mm 12mm 14mm;box-shadow:0 2px 12px rgba(0,0,0,.18);}
  .p-ref{position:absolute;top:6mm;right:12mm;font-size:7.5pt;color:#6b7280;}
  .p-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10mm;
          border-bottom:2px solid #111;padding-bottom:4mm;margin-bottom:4mm;}
  .p-head-l{display:flex;gap:4mm;align-items:center;}
  .p-logo{height:16mm;width:auto;}
  .p-co{font-size:13pt;font-weight:800;letter-spacing:.04em;}
  .p-co-sub{font-size:7.5pt;color:#555;margin-top:1mm;}
  .p-head-r{text-align:right;}
  .p-title{font-size:11pt;font-weight:800;text-transform:uppercase;}
  .p-title-sub{font-size:8pt;color:#555;margin-top:1mm;}
  table{border-collapse:collapse;width:100%;}
  .p-meta{margin-bottom:3mm;}
  .p-meta td{border:.4pt solid #111;padding:1.4mm 2mm;font-size:7.5pt;}
  .p-meta .k{background:#111;color:#fff;font-weight:700;white-space:nowrap;
             print-color-adjust:exact;-webkit-print-color-adjust:exact;}
  .p-meta .v{font-weight:600;}
  .p-scope{background:#fffdf3;border:.4pt solid #e5e7eb;padding:2mm;margin-bottom:3mm;font-size:7.5pt;}
  .p-scope-hd{font-weight:700;margin-bottom:.6mm;}
  .p-imgs{display:flex;gap:3mm;margin-bottom:3mm;}
  .p-imgs figure{flex:1;text-align:center;}
  .p-imgs img{width:100%;max-height:45mm;object-fit:cover;border:.4pt solid #d1d5db;}
  .p-imgs figcaption{font-size:6.5pt;color:#555;font-style:italic;margin-top:.8mm;}
  .p-items th{background:#fbbf24;color:#111;border:.4pt solid #f59e0b;padding:1.6mm 1.4mm;
              font-size:6.8pt;font-weight:800;text-transform:uppercase;letter-spacing:.03em;
              print-color-adjust:exact;-webkit-print-color-adjust:exact;}
  .p-items td{border:.4pt solid #cfcfcf;padding:1.2mm 1.4mm;font-size:7.3pt;vertical-align:top;}
  .c-no{width:9mm;text-align:center;}
  .c-ctr{text-align:center;white-space:nowrap;}
  .c-amt{text-align:right;white-space:nowrap;}
  .p-l1 td{background:#c81e1e;color:#fff;font-weight:800;border-color:#991b1b;
           text-transform:uppercase;print-color-adjust:exact;-webkit-print-color-adjust:exact;}
  .p-l2 td{background:#e5e7eb;font-weight:700;border-color:#d1d5db;
           print-color-adjust:exact;-webkit-print-color-adjust:exact;}
  .p-l3:nth-child(even) td{background:#fafafa;print-color-adjust:exact;-webkit-print-color-adjust:exact;}
  .p-sub td{background:#fffde7;font-weight:800;border-top:.8pt solid #fbbf24;
            print-color-adjust:exact;-webkit-print-color-adjust:exact;}
  .p-empty{text-align:center;color:#9ca3af;font-style:italic;padding:8mm;}
  .p-tag{color:#6b7280;font-style:italic;font-size:6.6pt;}
  .p-muted td{color:#6b7280;font-style:italic;}
  .p-lot{font-size:6.4pt;background:rgba(255,255,255,.22);padding:.4mm 1.2mm;border-radius:1mm;}
  .p-tot{width:72mm;margin:3mm 0 0 auto;}
  .p-tot td{padding:1.4mm 0;font-size:8pt;font-weight:700;border-bottom:.3pt solid #e8e8e8;}
  .p-tot .v{text-align:right;}
  .p-tot-final td{font-size:10pt;border-top:1.2pt solid #1f2937;border-bottom:none;padding-top:2mm;}
  .p-sig{display:flex;gap:8mm;margin-top:14mm;}
  .p-sig-col{flex:1;text-align:center;}
  .p-sig-line{border-bottom:.6pt solid #111;height:12mm;}
  .p-sig-name{font-weight:700;font-size:8pt;margin-top:1.4mm;}
  .p-sig-role{font-size:7pt;color:#555;}
  .p-disc{margin-top:8mm;font-size:6.5pt;color:#555;font-style:italic;border-top:.3pt solid #e8e8e8;padding-top:2mm;}
  @media print{
    body{background:#fff;}
    .page{margin:0;box-shadow:none;width:auto;min-height:auto;padding:0;}
    .p-items thead{display:table-row-group;}
    tr{page-break-inside:avoid;}
  }
</style></head><body>
<div class="page">
  ${d.reportNo ? `<div class="p-ref">${esc(d.reportNo)}</div>` : ''}
  <div class="p-head">
    <div class="p-head-l">
      ${showsLogo(d) ? `<img class="p-logo" src="${base}${COMPANY.logo}" alt="" onerror="this.style.display='none'">` : ''}
      <div>
        <div class="p-co">${esc(DOC_LABEL)}</div>
        ${companyLine() ? `<div class="p-co-sub">${esc(companyLine())}</div>` : ''}
      </div>
    </div>
    <div class="p-head-r">
      <div class="p-title">${esc((d.subject || 'ACCOMPLISHMENT REPORT').toUpperCase())}</div>
      ${d.reportNo ? `<div class="p-title-sub">${esc(d.reportNo)}</div>` : ''}
    </div>
  </div>

  <table class="p-meta">
    <colgroup><col style="width:80px"><col style="width:32%"><col style="width:80px"><col></colgroup>
    <tr><td class="k">Client</td><td class="v">${esc(d.ownerName || '')}</td>
        <td class="k">Report No.</td><td class="v">${esc(d.reportNo || '')}</td></tr>
    <tr><td class="k">Project</td><td class="v">${esc(d.projectName || '')}</td>
        <td class="k">Date</td><td class="v">${esc(prettyDate(d.date))}</td></tr>
    <tr><td class="k">Location</td><td class="v">${esc(d.location || '')}</td>
        <td class="k">Period Covered</td><td class="v">${esc(prettyDate(d.asOfDate))}</td></tr>
    ${d.clientAddress || d.area ? `<tr><td class="k">Address</td><td class="v">${esc(d.clientAddress || '')}</td>
        <td class="k">Area</td><td class="v">${esc(d.area || '')}</td></tr>` : ''}
  </table>

  ${d.scopeNote ? `<div class="p-scope"><div class="p-scope-hd">Note:</div>${esc(d.scopeNote)}</div>` : ''}
  ${imagesHtml(d)}

  <table class="p-items">
    <thead><tr>
      <th class="c-no">#</th><th>DESCRIPTION</th><th class="c-ctr">QTY</th><th class="c-ctr">UNIT</th>
      ${money ? '<th class="c-amt">UNIT PRICE</th><th class="c-amt">AMOUNT</th>' : ''}
      <th class="c-ctr">% COMPLETE</th>
    </tr></thead>
    <tbody>${rowsHtml(d, money)}</tbody>
  </table>

  ${summaryHtml(d, money)}
  ${sigHtml(d)}

  <div class="p-disc">
    This report states the work accomplished as of the period covered above and is for progress
    reporting. ${money ? '' : 'Amounts are omitted from this copy. '}
    Printed on ${esc(new Date().toLocaleString('en-PH', { year:'numeric', month:'long', day:'numeric', hour:'numeric', minute:'2-digit', hour12:true }))}
    &nbsp;·&nbsp; ${cols} columns
  </div>
</div>
<script>window.onload=function(){setTimeout(function(){window.print();},350);};<\/script>
</body></html>`;
    }

    // ── Public: print sheet ──────────────────────────────────────────
    window.pmRpPrintSheet = function (doc) {
        const d = doc || window.pmRpCurrentDoc && window.pmRpCurrentDoc();
        if (!d) { alert('Open a report first.'); return; }
        const w = window.open('', '_blank');
        if (!w) { alert('Pop-up blocked — allow pop-ups to print.'); return; }
        w.document.write(sheetHtml(d));
        w.document.close();
    };

    // ── Public: PDF export ───────────────────────────────────────────
    // Same lazy CDN load as every other PDF path in the app (print-utils.js,
    // quotation-print.js). Pinned versions, loaded on first use only.
    function ensureJsPdf() {
        return new Promise((resolve, reject) => {
            if (window.jspdf && window.jspdf.jsPDF) return resolve(window.jspdf.jsPDF);
            const s = document.createElement('script');
            s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
            s.onload = () => {
                const a = document.createElement('script');
                a.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js';
                a.onload = () => resolve(window.jspdf.jsPDF);
                a.onerror = () => reject(new Error('Could not load the PDF table plugin'));
                document.head.appendChild(a);
            };
            s.onerror = () => reject(new Error('Could not load the PDF generator'));
            document.head.appendChild(s);
        });
    }

    window.pmRpExportPDF = async function (doc) {
        const d = doc || window.pmRpCurrentDoc && window.pmRpCurrentDoc();
        if (!d) { alert('Open a report first.'); return; }
        const money = showsAmounts(d);
        const m = M();
        let jsPDF;
        try { jsPDF = await ensureJsPdf(); }
        catch (e) { alert(e.message || 'Could not load the PDF generator.'); return; }

        const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const pageW = pdf.internal.pageSize.getWidth();
        const MG = 12;
        let y = 16;

        pdf.setFont('helvetica', 'bold').setFontSize(13);
        pdf.text(DOC_LABEL, MG, y);
        pdf.setFont('helvetica', 'normal').setFontSize(9);
        pdf.text(String(d.subject || 'Accomplishment Report').toUpperCase(), pageW - MG, y, { align: 'right' });
        y += 3;
        pdf.setDrawColor(17, 17, 17).setLineWidth(0.5).line(MG, y, pageW - MG, y);
        y += 5;

        const metaLabel = { cellWidth: 25, fillColor: [17,17,17], textColor: [255,255,255], fontStyle: 'bold' };
        const meta = [
            ['CLIENT', d.ownerName || '', 'REPORT NO.', d.reportNo || ''],
            ['PROJECT', d.projectName || '', 'DATE', prettyDate(d.date)],
            ['LOCATION', d.location || '', 'PERIOD COVERED', prettyDate(d.asOfDate)]
        ];
        if (d.clientAddress || d.area) meta.push(['ADDRESS', d.clientAddress || '', 'AREA', d.area || '']);
        pdf.autoTable({
            startY: y, margin: { left: MG, right: MG }, body: meta, theme: 'grid',
            styles: { fontSize: 7.5, cellPadding: 1.4, lineColor: [17,17,17], lineWidth: 0.2 },
            columnStyles: { 0: metaLabel, 1: { cellWidth: 'auto', fontStyle: 'bold' },
                            2: Object.assign({}, metaLabel), 3: { cellWidth: 46, fontStyle: 'bold' } }
        });
        y = pdf.lastAutoTable.finalY + 3;

        if (d.scopeNote) {
            pdf.autoTable({
                startY: y, margin: { left: MG, right: MG },
                body: [[{ content: 'NOTE:\n' + d.scopeNote }]], theme: 'plain',
                styles: { fontSize: 7.5, cellPadding: 1.6, fillColor: [255, 253, 243] }
            });
            y = pdf.lastAutoTable.finalY + 3;
        }

        // Body, flattened the same way the HTML sheet flattens it. rowKind runs
        // alongside so didParseCell can colour each level identically.
        const body = [], rowKind = [];
        const span = money ? 5 : 3;          // subtotal label: # .. UNIT PRICE
        const labelSpan = money ? 6 : 4;     // section/sub label: # .. AMOUNT
        (d.costItems || []).forEach((ci, ciIdx) => {
            const ciNo = roman(ciIdx);
            const lump = m.isLump(ci);
            const ciPct = Math.round((m.ciSub(ci) > 0 ? m.ciAcc(ci) / m.ciSub(ci) : 0) * 100);
            body.push([{ content: ciNo + '. ' + String(ci.name || '').toUpperCase() + (lump ? '  (LOT)' : ''),
                         colSpan: labelSpan }, ciPct + '%']);
            rowKind.push('l1');
            (ci.subItems || []).forEach((si, siIdx) => {
                body.push([{ content: alpha(siIdx) + '. ' + (si.name || ''), colSpan: labelSpan },
                           Math.round(m.groupPct(ci, si) * 100) + '%']);
                rowKind.push('l2');
                (si.lineItems || []).forEach((li, liIdx) => {
                    const st = li.state || 'normal';
                    if (st === 'removed') return;
                    const label = (li.description || '')
                        + (st === 'optional' ? ' (optional)' : st === 'waived' ? ' (waived)' : '');
                    const row = [String(liIdx + 1), label, li.qty || '', li.unit || ''];
                    if (money) row.push(lump ? 'scope' : (m.liRate(li) ? fmt(m.liRate(li)) : ''),
                                        lump ? '' : fmt(m.liTotal(li)));
                    row.push(m.num(li.percentCompletion) ? m.num(li.percentCompletion) + '%' : '');
                    body.push(row); rowKind.push(st === 'normal' ? 'l3' : 'l3-muted');
                });
            });
            if (money) {
                body.push([{ content: 'Subtotal — ' + ciNo + '. ' + (ci.name || ''), colSpan: span },
                           fmt(m.ciSub(ci)), fmt(m.ciAcc(ci))]);
                rowKind.push('sub');
            }
        });

        const head = money
            ? [['#','DESCRIPTION','QTY','UNIT','UNIT PRICE','AMOUNT','% COMPLETE']]
            : [['#','DESCRIPTION','QTY','UNIT','% COMPLETE']];
        const colStyles = { 0: { cellWidth: 8, halign: 'center' }, 1: { cellWidth: 'auto' },
                            2: { cellWidth: 14, halign: 'center' }, 3: { cellWidth: 15, halign: 'center' } };
        if (money) {
            colStyles[4] = { cellWidth: 24, halign: 'right' };
            colStyles[5] = { cellWidth: 26, halign: 'right' };
            colStyles[6] = { cellWidth: 20, halign: 'center' };
        } else {
            colStyles[4] = { cellWidth: 22, halign: 'center' };
        }

        pdf.autoTable({
            startY: y, margin: { left: MG, right: MG }, head, body,
            styles: { fontSize: 6.8, cellPadding: 1.2, lineColor: [150,150,150], lineWidth: 0.1 },
            headStyles: { fillColor: [251,191,36], textColor: [0,0,0], fontStyle: 'bold',
                          fontSize: 6.3, halign: 'center', lineColor: [245,158,11] },
            columnStyles: colStyles,
            didParseCell: function (data) {
                if (data.section !== 'body') return;
                switch (rowKind[data.row.index]) {
                    case 'l1':
                        data.cell.styles.fillColor = [200, 30, 30];
                        data.cell.styles.textColor = [255, 255, 255];
                        data.cell.styles.fontStyle = 'bold';
                        data.cell.styles.lineColor = [153, 27, 27];
                        break;
                    case 'l2':
                        data.cell.styles.fillColor = [229, 231, 235];
                        data.cell.styles.fontStyle = 'bold';
                        break;
                    case 'l3-muted':
                        data.cell.styles.textColor = [107, 114, 128];
                        data.cell.styles.fontStyle = 'italic';
                        break;
                    case 'sub':
                        data.cell.styles.fillColor = [255, 253, 231];
                        data.cell.styles.fontStyle = 'bold';
                        break;
                }
            }
        });
        y = pdf.lastAutoTable.finalY + 4;

        if (money) {
            const rows = [['Total Project Cost:', fmt(m.grand(d.costItems))],
                          ['Total Accomplishment:', fmt(m.acc(d.costItems))],
                          ['Overall Progress:', m.pct(d) + '%']];
            const last = rows.length - 1;
            pdf.autoTable({
                // `right` is NOT optional here: with only `left` set autotable
                // falls back to its own default right margin and reports
                // "2 units width could not fit page", quietly squeezing the
                // amount column. (js/quotation-print.js:893 has the same
                // omission — worth fixing there too.)
                startY: y, margin: { left: pageW - MG - 88, right: MG }, body: rows, theme: 'plain',
                styles: { fontSize: 8.5, cellPadding: { top: 1.9, bottom: 1.9, left: 0, right: 0 } },
                columnStyles: { 0: { cellWidth: 52, fontStyle: 'bold', textColor: [55,65,81] },
                                1: { cellWidth: 36, halign: 'right', fontStyle: 'bold', textColor: [31,41,55] } },
                didParseCell: (data) => {
                    if (data.section === 'body' && data.row.index === last) data.cell.styles.fontSize = 10;
                },
                didDrawCell: (data) => {
                    if (data.section !== 'body') return;
                    const c = data.cell;
                    if (data.row.index === last) {
                        pdf.setDrawColor(31,41,55).setLineWidth(0.5).line(c.x, c.y, c.x + c.width, c.y);
                    }
                }
            });
            y = pdf.lastAutoTable.finalY + 4;
        }

        // Signature columns, on a fresh page if they will not fit whole.
        const cols = [];
        if (showsPrepared(d))  cols.push(['Prepared by', d.preparedBy || '']);
        if (showsSubmitted(d)) cols.push(['Submitted by', d.submittedBy || d.preparedBy || COMPANY.name]);
        cols.push(['Conforme — Client', d.ownerName || '']);
        if (y > pdf.internal.pageSize.getHeight() - 45) { pdf.addPage(); y = 20; }
        y += 16;
        const usable = pageW - MG * 2, cw = usable / cols.length;
        cols.forEach((c, i) => {
            const cx = MG + i * cw + cw / 2;
            pdf.setDrawColor(17,17,17).setLineWidth(0.3).line(MG + i * cw + 6, y, MG + (i + 1) * cw - 6, y);
            pdf.setFont('helvetica', 'bold').setFontSize(8).text(String(c[1] || ''), cx, y + 4, { align: 'center' });
            pdf.setFont('helvetica', 'normal').setFontSize(7).setTextColor(85,85,85)
               .text(c[0], cx, y + 8, { align: 'center' });
            pdf.setTextColor(0,0,0);
        });

        const name = (d.reportNo || d.subject || 'Accomplishment Report')
            .replace(/[\\/:*?"<>|]+/g, '') + '.pdf';
        pdf.save(name);
    };
})();
