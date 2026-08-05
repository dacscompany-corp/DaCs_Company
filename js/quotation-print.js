/* ════════════════════════════════════════════════════════════════════
   QUOTATION PRINT — A4 sheet and PDF export.

   Renders EITHER the live quotation (no argument) or a frozen revision
   snapshot (passed in), so a revision always prints exactly as it was
   sent rather than picking up later edits.
   ════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    // Seller block. Confirm the contact line and TIN with the owner before
    // the first real quotation goes out — these print on every sheet.
    const COMPANY = {
        name:    "DAC'S CONSTRUCTION",
        logo:    'assets/images/DACS-TRANSPARENT.png',
        contact: '',   // e.g. 'hello@example.com / 09XXXXXXXXX'
        tin:     ''    // e.g. '000-000-000-000'
    };

    function qtDoc() {
        // The live quotation, shaped like a snapshot.
        const q = (window.qtState && window.qtState.current) || window._qtCurrentForPrint;
        return q || null;
    }

    function qtCompanyLine() {
        return [COMPANY.contact, COMPANY.tin ? 'TIN: ' + COMPANY.tin : '']
            .filter(Boolean).join(' · ');
    }

    function qtPrettyDate(key) {
        if (!key) return '';
        const d = new Date(key + 'T00:00:00');
        return isNaN(d) ? key : d.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
    }

    // ── Image signing ─────────────────────────────────────────────────
    // The `uploads` bucket is PRIVATE (migration 0027). supabase-config.js §11b
    // swaps stored URLs for signed ones via a MutationObserver — but that
    // observer watches THIS document only, and the print sheet is written into
    // a separate window that never loads the shim. So every image has to be
    // resolved HERE, in the parent page, before the HTML string is built;
    // otherwise the client-facing sheet prints broken-image icons.
    //
    // The result is a lookup map, NEVER written back onto `im.url`: signed URLs
    // expire, and persisting one would push a dead link into the database and
    // into every future revision snapshot.
    async function qtSignImages(d) {
        const map = new Map();
        const sign = window.dacsMaybeSignUrl;
        if (typeof sign !== 'function') return map;
        for (const sec of (d.sections || [])) {
            for (const im of (sec.images || [])) {
                if (!im.url || map.has(im.url)) continue;
                try { map.set(im.url, await sign(im.url)); }
                catch (e) { map.set(im.url, im.url); }   // fall back to the stored URL
            }
        }
        return map;
    }

    // ── Table rows ────────────────────────────────────────────────────
    // `imgMap` maps each stored image URL to a short-lived signed one, resolved
    // by the caller in the PARENT page — see qtSignImages below for why.
    function qtRowsHtml(d, imgMap) {
        const esc = window.qtEscHtml, fmt = window.qtFmt;
        let html = '';
        (d.sections || []).forEach((sec, si) => {
            const lump = sec.pricing === 'lump';
            html += `<tr class="p-l1">
                <td class="c-no">${si + 1}</td>
                <td class="c-desc" colspan="4"><strong>${esc(sec.label || 'SECTION')}</strong></td>
                <td class="c-amt"><strong>${fmt(window.qtSectionTotal(sec))}</strong></td>
            </tr>`;

            (sec.images || []).forEach(im => {
                html += `<tr class="p-img"><td></td><td colspan="5">
                    <img src="${esc((imgMap && imgMap.get(im.url)) || im.url)}" alt="${esc(im.name || '')}">
                    ${im.caption ? `<div class="p-cap">${esc(im.caption)}</div>` : ''}
                </td></tr>`;
            });

            (sec.groups || []).forEach(g => {
                html += `<tr class="p-l2">
                    <td></td>
                    <td class="c-desc" colspan="4">${esc(g.label || '')}</td>
                    <td class="c-amt">${lump && g.lumpAmount !== '' && g.lumpAmount !== undefined && g.lumpAmount !== null
                        ? fmt(g.lumpAmount) : (lump ? '' : fmt(window.qtGroupTotal(g)))}</td>
                </tr>`;

                (g.lines || []).forEach(l => {
                    const state = l.state || 'normal';
                    const cls = state === 'removed'  ? ' p-removed'
                              : state === 'waived'   ? ' p-waived'
                              : state === 'optional' ? ' p-optional' : '';
                    const amtCell = lump ? ''
                        : state === 'waived'  ? 'WAIVED'
                        : state === 'removed' ? fmt(window.qtRawLineAmount(l))
                        : fmt(window.qtLineAmount(l));
                    html += `<tr class="p-l3${cls}">
                        <td></td>
                        <td class="c-desc">${esc(l.description || '')}${state === 'optional' ? ' <em>(optional)</em>' : ''}</td>
                        <td class="c-qty">${esc(l.qty || '')}</td>
                        <td class="c-unit">${esc(l.unit || '')}</td>
                        <td class="c-rate">${lump ? '' : fmt(l.unitPrice)}</td>
                        <td class="c-amt">${amtCell}</td>
                    </tr>`;
                });
            });
        });
        return html;
    }

    // ── Terms ─────────────────────────────────────────────────────────
    function qtTermsHtml(d) {
        const esc = window.qtEscHtml, t = d.terms || {};
        const block = (title, body) => body
            ? `<div class="p-term"><div class="p-term-hd">${esc(title)}</div>
               ${String(body).split('\n').map(l => `<div>${esc(l)}</div>`).join('')}</div>` : '';
        const conds = (t.conditions || []).filter(c => c.include !== false);
        return `
        ${block('VALIDITY',         t.validityNote)}
        ${block('PAYMENT TERMS',    t.payment)}
        ${block('DELIVERY TIMELINE',t.deliveryTimeline)}
        ${block('WARRANTY',         t.warranty)}
        ${block('EXCLUSIONS',       t.exclusions)}
        ${conds.length ? `<div class="p-term"><div class="p-term-hd">GENERAL TERMS &amp; CONDITIONS</div>
            <ol>${conds.map(c => `<li><strong>${esc(c.title)}</strong> ${esc(c.body)}</li>`).join('')}</ol>
        </div>` : ''}`;
    }

    // ── Totals ────────────────────────────────────────────────────────
    function qtTotalsHtml(d) {
        const fmt = window.qtFmt;
        const pc = window.qtProjectCost(d.sections), disc = window.qtDiscountAmount(d),
              sub = window.qtSubTotal(d), vat = window.qtVatAmount(d), tot = window.qtGrandTotal(d);
        const vatRow = d.vatMode === 'none'
            ? `<tr><td>PLUS: VAT</td><td class="c-amt">Not applicable</td></tr>`
            : d.vatMode === 'inclusive'
            ? `<tr><td>VAT (${window.qtParseNum(d.vatPct)}%, included)</td><td class="c-amt">${fmt(vat)}</td></tr>`
            : `<tr><td>PLUS: VAT (${window.qtParseNum(d.vatPct)}%)</td><td class="c-amt">${fmt(vat)}</td></tr>`;
        return `
        <table class="p-tot">
            <tr><td>PROJECT COST</td><td class="c-amt">${fmt(pc)}</td></tr>
            ${disc ? `<tr><td>LESS: DISCOUNT</td><td class="c-amt">(${fmt(disc)})</td></tr>` : ''}
            <tr class="p-sub"><td>SUB TOTAL</td><td class="c-amt">${fmt(sub)}</td></tr>
            ${vatRow}
            <tr class="p-grand"><td>TOTAL PROJECT COST</td><td class="c-amt">${fmt(tot)}</td></tr>
        </table>
        <p class="p-vatnote">${d.vatMode === 'exclusive' ? '*VAT is added to the sub-total above.'
            : d.vatMode === 'inclusive' ? '*Total is VAT inclusive.' : '*VAT not applicable.'}</p>`;
    }

    // ── Entry point ───────────────────────────────────────────────────
    // async only because the private-bucket images must be signed before the
    // sheet is built. Every call site is an inline handler that ignores the
    // return value, so no caller changes.
    window.qtPrintSheet = async function (snapshot) {
        const d = snapshot || qtDoc();
        if (!d) { if (window.qtToast) window.qtToast('Nothing to print', 'error'); return; }

        // An expired price should not go out by accident. Asked BEFORE any
        // signing work, so declining costs nothing.
        if (!snapshot && window.qtIsExpired && window.qtIsExpired(d)) {
            if (!confirm(`This quotation lapsed on ${d.validUntil}.\n\nPrint it anyway?`)) return;
        }

        const imgMap = await qtSignImages(d);

        const esc = window.qtEscHtml;
        const base = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);

        const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>${esc(d.subject || 'Project Estimate')} — ${esc(d.projectName || '')}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:'Segoe UI',Arial,sans-serif;font-size:9pt;color:#111;background:#e8e8e8;}
  .page{width:210mm;min-height:297mm;background:#fff;margin:12px auto;padding:12mm 14mm;box-shadow:0 2px 16px rgba(0,0,0,.18);}
  .p-head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #111;padding-bottom:8px;}
  .p-logo{height:52px;}
  .p-co{font-size:12pt;font-weight:700;}
  .p-title{font-size:14pt;font-weight:700;text-align:right;}
  .p-meta{width:100%;border-collapse:collapse;margin-top:10px;font-size:8.5pt;}
  .p-meta td{border:1px solid #d0d0d0;padding:4px 6px;}
  .p-meta .k{background:#f2f2f2;font-weight:700;width:22%;}
  .p-scope{margin-top:10px;font-size:8.5pt;white-space:pre-wrap;}
  table.p-items{width:100%;border-collapse:collapse;margin-top:12px;font-size:8pt;}
  table.p-items th{background:#f2f2f2;border:1px solid #c8c8c8;padding:4px;text-align:center;font-size:7.5pt;}
  table.p-items td{border:1px solid #e0e0e0;padding:3px 5px;vertical-align:top;}
  .c-no{width:26px;text-align:center;} .c-qty{width:38px;text-align:center;}
  .c-unit{width:44px;text-align:center;} .c-rate{width:72px;text-align:right;}
  .c-amt{width:88px;text-align:right;font-variant-numeric:tabular-nums;}
  tr.p-l1 td{background:#fafafa;}
  tr.p-l2 td{padding-left:14px;font-weight:600;}
  tr.p-l3 td.c-desc{padding-left:26px;}
  tr.p-removed td{text-decoration:line-through;color:#999;}
  tr.p-waived  td.c-amt{font-weight:700;}
  tr.p-optional td{color:#666;}
  tr.p-img img{max-width:150mm;max-height:70mm;object-fit:contain;margin:4px 0;}
  .p-cap{font-size:7.5pt;color:#555;}
  table.p-tot{margin-left:auto;margin-top:12px;border-collapse:collapse;width:78mm;font-size:8.5pt;}
  table.p-tot td{border:1px solid #d0d0d0;padding:4px 6px;}
  .p-sub td{font-weight:700;} .p-grand td{font-weight:700;background:#eaf7ef;font-size:9.5pt;}
  .p-vatnote{text-align:right;font-size:7.5pt;color:#555;margin-top:3px;}
  .p-term{margin-top:10px;font-size:8pt;} .p-term-hd{font-weight:700;background:#f2f2f2;padding:3px 5px;}
  .p-term ol{margin:4px 0 0 18px;} .p-term li{margin-bottom:3px;}
  .p-sign{display:flex;gap:30mm;margin-top:18mm;font-size:8.5pt;}
  .p-sign div{flex:1;border-top:1px solid #111;padding-top:3px;}
  .p-rev{position:fixed;top:6mm;right:10mm;font-size:7.5pt;color:#666;}
  @media print{body{background:#fff;} .page{margin:0;box-shadow:none;} @page{size:A4;margin:0;}}
</style></head><body>
<div class="page">
  <div class="p-rev">${esc(d.quoteNo || '')}${d.revNo > 1 ? ' · Rev ' + d.revNo : ''}</div>
  <div class="p-head">
    <div>
      <img class="p-logo" src="${base}${COMPANY.logo}" alt="">
      <div class="p-co">${esc(COMPANY.name)}</div>
      <div style="font-size:8pt;color:#555;">${esc(qtCompanyLine())}</div>
    </div>
    <div class="p-title">${esc((d.subject || 'PROJECT ESTIMATE').toUpperCase())}</div>
  </div>

  <table class="p-meta">
    <tr><td class="k">CLIENT</td><td>${esc(d.clientName || '')}</td><td class="k">QUOTE NO.</td><td>${esc(d.quoteNo || '')}${d.revNo > 1 ? ' (Rev ' + d.revNo + ')' : ''}</td></tr>
    <tr><td class="k">PROJECT</td><td>${esc(d.projectName || '')}</td><td class="k">DATE</td><td>${esc(qtPrettyDate(d.quoteDate))}</td></tr>
    <tr><td class="k">LOCATION</td><td>${esc(d.location || '')}</td><td class="k">VALID UNTIL</td><td>${esc(qtPrettyDate(d.validUntil))}</td></tr>
    ${d.clientAddress || d.clientTin ? `<tr><td class="k">ADDRESS</td><td>${esc(d.clientAddress || '')}</td><td class="k">TIN</td><td>${esc(d.clientTin || '')}</td></tr>` : ''}
  </table>

  ${d.scopeNote ? `<div class="p-scope"><strong>SCOPE OF WORK</strong><br>${esc(d.scopeNote)}</div>` : ''}

  <table class="p-items">
    <thead><tr><th>#</th><th>DESCRIPTION</th><th>QTY</th><th>UNIT</th><th>UNIT PRICE</th><th>AMOUNT</th></tr></thead>
    <tbody>${qtRowsHtml(d, imgMap)}</tbody>
  </table>

  ${qtTotalsHtml(d)}
  ${qtTermsHtml(d)}

  <div class="p-sign">
    ${(d.terms && d.terms.signOff && d.terms.signOff.preparedBy !== false)
      ? `<div>${esc(d.preparedBy || '')}<br><span style="font-size:7.5pt;color:#666;">SUBMITTED BY</span></div>` : ''}
    ${(d.terms && d.terms.signOff && d.terms.signOff.clientApproval !== false)
      ? `<div><span style="font-size:7.5pt;color:#666;">CLIENT APPROVAL / DATE</span></div>` : ''}
  </div>
</div>
<script>window.onload=function(){setTimeout(function(){window.print();},400);};<\/script>
</body></html>`;

        const w = window.open('', '_blank');
        if (!w) { if (window.qtToast) window.qtToast('Pop-up blocked — allow pop-ups to print', 'error'); return; }
        w.document.write(html);
        w.document.close();
    };

})();
