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

    // The bold label beside the logo. Deliberately the DOCUMENT type, not the
    // company name — the logo already identifies the sender, and the owner
    // wanted the header to say what the sheet IS (2026-08-06). COMPANY.name is
    // still what signs the document, in the "Submitted by" block below.
    const DOC_LABEL = 'PROJECT QUOTATION';

    // ── Where the client pays ─────────────────────────────────────────
    // The company's own collecting account, so it is the SAME on every
    // quotation. That is why it sits here beside COMPANY instead of in the
    // per-quote `terms` blob — same call as assets/images/dacs-signature.png.
    //
    // Editing this changes what prints on every FUTURE sheet, including a
    // reprint of an old revision. That is deliberate: a client paying today
    // must be shown today's account, never the one that was live when the
    // quotation was frozen. Nothing here is stored per row.
    //
    // `qr` is optional. If the file is missing the <img> drops out via
    // onerror and the bank line, name and number still print — a wrong or
    // broken QR must never take the account number down with it.
    //
    // Set `show:false` to drop the block from every sheet.
    const PAYMENT = {
        show:   true,
        bank:   'BDO',
        name:   'CRISTHER DACOME',
        number: '013570037929',
        qr:     'assets/images/bdo-instapay-qr.png',
        // Printed width of the QR artwork, in mm. Height follows the image's
        // own aspect ratio, so a tall BDO card and a square crop both come out
        // undistorted — this is the ONE number to turn if it prints too small
        // or eats too much of the page foot. A full portrait card at 42mm
        // stands about 82mm tall; a square crop at 55mm stays 55mm.
        qrWidthMm: 55,
        note:   'BDO to BDO transfers are free. Fees may apply for non-BDO transfers.',
        remind: 'Please send proof of payment after every transfer.'
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

    // The quotation's reference images. Migration 0046 moved these from
    // per-section to ONE document-level list, printed once above the itemized
    // estimate. A revision snapshot frozen before 0046 has no `images` key, so
    // fall back to whatever its sections carried — an old sheet must still
    // reprint exactly as it was sent. Capped so a legacy document with images
    // on ten sections cannot print a ten-photo wall.
    const QT_MAX_PRINT_IMAGES = 4;
    function qtDocImages(d) {
        if (d && Array.isArray(d.images) && d.images.length) {
            return d.images.slice(0, QT_MAX_PRINT_IMAGES);
        }
        const legacy = [];
        ((d && d.sections) || []).forEach(sec => (sec.images || []).forEach(im => {
            if (im && im.url && legacy.length < QT_MAX_PRINT_IMAGES) legacy.push(im);
        }));
        return legacy;
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
        const urls = [];
        for (const im of qtDocImages(d)) {
            if (im.url && !urls.includes(im.url)) urls.push(im.url);
        }
        await Promise.all(urls.map(async u => {
            try { map.set(u, await sign(u)); }
            catch (e) { map.set(u, u); }   // fall back to the stored URL
        }));
        return map;
    }

    // What a group / sub-item row prints in the AMOUNT column: NOTHING.
    //
    // A group amount is an EDITOR-ONLY working figure. Printed beside the
    // section total it reads to a client as a SEPARATE charge stacked on top
    // of that total, not as a breakdown of it — so the section total is the
    // only money the sheet shows at this level, and the line rows beneath it
    // carry the detail.
    //
    // History, so this doesn't get restored a third time:
    //   · 2026-08-06 — blanked outright, owner's call, for the reason above.
    //   · 2026-08-26 — restored, gated on the groups genuinely footing to the
    //     section total (an arithmetic test, not a cosmetic one).
    //   · 2026-08-27 — blanked again, owner's call. Even when the figures DO
    //     foot, the sheet still reads as double-billing to a client skimming
    //     it. Correct arithmetic was not enough; the column has to be empty.
    //
    // Both render paths call this — the HTML sheet and the jsPDF export — so
    // they can never drift apart. The sec / g parameters stay in the signature:
    // the callers pass them, and this rule has already swung twice.
    function qtGroupPrintAmount(sec, g) {
        return '';
    }

    // ── Table rows ────────────────────────────────────────────────────
    // `imgMap` maps each stored image URL to a short-lived signed one, resolved
    // by the caller in the PARENT page — see qtSignImages below for why.
    // Does this quotation print its line-level pricing? (migration 0047)
    // Absent on rows and revision snapshots written before 0047, and those
    // always printed their rates — so anything but an explicit false is true.
    function qtShowsLinePricing(d) { return !d || d.showLinePricing !== false; }

    // Does this quotation print the header logo? (migration 0048)
    // Same rule: absent on anything written before 0048, and those all printed
    // the logo — so only an explicit false turns it off.
    function qtShowsLogo(d) { return !d || d.showLogo !== false; }

    // ── Signature blocks ──────────────────────────────────────────────
    // Up to three columns: PREPARED BY (who built the quotation), SUBMITTED BY
    // (who signs it out) and CLIENT APPROVAL. Each is switched independently
    // from the editor — they are different people and different roles.
    //
    // NAMING TRAP: the stored key for the SUBMITTED BY column is
    // `signOff.preparedBy`. That misnomer is frozen into every row written
    // since 0045, when the sheet had ONE company column and it was fed by the
    // "Prepared by" field. Renaming it would switch that column back on for
    // every quotation that had it turned off. The PREPARED BY column added on
    // 2026-08-11 uses `signOff.prepared` instead. Don't "fix" either name.
    //
    // `prepared` is OPT-IN (absent = off) because it is new: a quotation
    // already sent to a client must not grow a signature column on a reprint.
    // The other two are OPT-OUT (absent = on), matching what they always did.
    function qtSigOn(so, name) {
        if (name === 'prepared')  return !!so.prepared;
        if (name === 'submitted') return so.preparedBy !== false;
        return so.clientApproval !== false;
    }

    function qtSigHtml(d, base) {
        const esc = window.qtEscHtml;
        const so  = (d && d.terms && d.terms.signOff) || null;
        // No signOff object at all means a document written before the switches
        // existed. It printed no signature block then, so it must not grow one
        // now — a reprint has to match the copy the client already holds.
        if (!so) return '';

        const cols = [];

        // Author. Deliberately NO signature image: the company mark belongs to
        // whoever signs the document out, not to whoever priced it. Skipped
        // when the field is blank rather than printing an unlabelled rule.
        if (qtSigOn(so, 'prepared') && String(d.preparedBy || '').trim()) {
            cols.push(`<div class="p-sig-col">
      <div class="p-sig-line">${esc(d.preparedBy)}</div>
      <div class="p-sig-role">Prepared By</div>
    </div>`);
        }

        // Signer. submittedBy owns this line; preparedBy is the fallback so
        // every quotation written before the two were split — and every
        // revision frozen before it — still prints the name it always did.
        if (qtSigOn(so, 'submitted')) {
            cols.push(`<div class="p-sig-col p-sig-signed">
      <img class="p-sig-img" src="${base}assets/images/dacs-signature.png" alt=""
           onerror="this.style.display='none';this.parentNode.classList.remove('p-sig-signed');">
      <div class="p-sig-line">${esc(d.submittedBy || d.preparedBy || COMPANY.name)}</div>
      <div class="p-sig-role">Submitted By</div>
    </div>`);
        }

        if (qtSigOn(so, 'client')) {
            cols.push(`<div class="p-sig-col">
      <div class="p-sig-line">${esc(d.clientName || '\u00a0')}</div>
      <div class="p-sig-role">Client Approval / Date</div>
    </div>`);
        }

        return cols.length ? `<div class="p-sig">${cols.join('')}</div>` : '';
    }


    function qtRowsHtml(d, imgMap) {
        const esc = window.qtEscHtml, fmt = window.qtFmt;
        // With pricing off the UNIT PRICE column is dropped entirely, so the
        // table is 5 wide instead of 6 and every colspan shifts with it. The
        // AMOUNT column stays either way — it carries the section totals.
        const rates = qtShowsLinePricing(d);
        const cols  = rates ? 6 : 5;
        const descSpan = cols - 2;                 // desc + qty + unit (+ rate)
        let html = '';
        (d.sections || []).forEach((sec, si) => {
            const lump = sec.pricing === 'lump';
            html += `<tr class="p-l1">
                <td class="c-no">${si + 1}</td>
                <td class="c-desc" colspan="${descSpan}"><strong>${esc(sec.label || 'SECTION')}</strong></td>
                <td class="c-amt"><strong>${fmt(window.qtSectionTotal(sec))}</strong></td>
            </tr>`;

            (sec.groups || []).forEach(g => {
                // A group may carry its own qty / unit (optional, presentation
                // only — never multiplied by anything). Blank prints an empty
                // cell, which is the common case, so the label keeps the room.
                html += `<tr class="p-l2">
                    <td></td>
                    <td class="c-desc">${esc(g.label || '')}</td>
                    <td class="c-qty">${esc(g.qty || '')}</td>
                    <td class="c-unit">${esc(g.unit || '')}</td>
                    ${rates ? '<td class="c-rate"></td>' : ''}
                    <td class="c-amt">${qtGroupPrintAmount(sec, g)}</td>
                </tr>`;

                (g.lines || []).forEach(l => {
                    const state = l.state || 'normal';
                    const cls = state === 'removed'  ? ' p-removed'
                              : state === 'waived'   ? ' p-waived'
                              : state === 'optional' ? ' p-optional' : '';
                    // WAIVED still prints with the rates hidden: "included at
                    // no charge" is information about the offer, not a rate.
                    const amtCell = (lump || !rates) ? (state === 'waived' ? 'WAIVED' : '')
                        : state === 'waived'  ? 'WAIVED'
                        : state === 'removed' ? fmt(window.qtRawLineAmount(l))
                        : fmt(window.qtLineAmount(l));
                    html += `<tr class="p-l3${cls}">
                        <td></td>
                        <td class="c-desc">${esc(l.description || '')}${state === 'optional' ? ' <em>(optional)</em>' : ''}</td>
                        <td class="c-qty">${esc(l.qty || '')}</td>
                        <td class="c-unit">${esc(l.unit || '')}</td>
                        ${rates ? `<td class="c-rate">${lump ? '' : fmt(l.unitPrice)}</td>` : ''}
                        <td class="c-amt">${amtCell}</td>
                    </tr>`;
                });
            });

            // Blank band between sections, like the BOQ report's spacer row.
            if (si < (d.sections || []).length - 1) {
                html += `<tr class="p-spacer"><td colspan="${cols}"></td></tr>`;
            }
        });
        return html;
    }

    // ── Reference image strip ─────────────────────────────────────────
    // One row above the itemized estimate. They share the width, so a single
    // render prints large and four print as a quarter-width strip.
    function qtImagesHtml(d, imgMap) {
        const esc = window.qtEscHtml, imgs = qtDocImages(d);
        if (!imgs.length) return '';
        return `<div class="p-imgs">${imgs.map(im => `
            <figure class="p-img-fig">
                <img src="${esc((imgMap && imgMap.get(im.url)) || im.url)}" alt="${esc(im.name || '')}">
                ${im.caption ? `<figcaption class="p-cap">${esc(im.caption)}</figcaption>` : ''}
            </figure>`).join('')}</div>`;
    }

    // ── Terms ─────────────────────────────────────────────────────────
    function qtTermsHtml(d) {
        const esc = window.qtEscHtml, t = d.terms || {};
        const block = (title, body) => body
            ? `<div class="p-term"><div class="p-term-hd">${esc(title)}</div>
               ${String(body).split('\n').map(l => `<div>${esc(l)}</div>`).join('')}</div>` : '';
        const conds = (t.conditions || []).filter(c => c.include !== false);
        const body = `
        ${block('VALIDITY',         t.validityNote)}
        ${block('PAYMENT TERMS',    t.payment)}
        ${block('DELIVERY TIMELINE',t.deliveryTimeline)}
        ${block('WARRANTY',         t.warranty)}
        ${block('EXCLUSIONS',       t.exclusions)}
        ${conds.length ? `<div class="p-term"><div class="p-term-hd">General Terms &amp; Conditions</div>
            <ol>${conds.map(c => `<li><strong>${esc(c.title)}</strong> ${esc(c.body)}</li>`).join('')}</ol>
        </div>` : ''}`;
        // The rule above the terms belongs to the block, not to each entry —
        // with every field blank it would otherwise print as a stray line.
        return body.trim() ? `<div class="p-terms">${body}</div>` : '';
    }

    // ── Payment details ───────────────────────────────────────────────
    // Sits at the foot of the sheet, under the signatures and above the
    // small print. The QR is a plain <img> off the same origin as the sheet,
    // exactly like the logo and the signature — no signing needed, since it
    // is a repo asset and not a private-bucket upload.
    function qtPaymentHtml(base) {
        const esc = window.qtEscHtml;
        if (!PAYMENT.show) return '';
        // An account with no number is not payable — print nothing rather
        // than a labelled empty box.
        if (!String(PAYMENT.number || '').trim()) return '';
        return `<div class="p-pay">
    <div class="p-pay-body">
      <div class="p-pay-hd">Payment Details</div>
      <table class="p-pay-tbl">
        <tr><td class="p-pay-k">Bank</td><td class="p-pay-v">${esc(PAYMENT.bank)}</td></tr>
        <tr><td class="p-pay-k">Account Name</td><td class="p-pay-v">${esc(PAYMENT.name)}</td></tr>
        <tr><td class="p-pay-k">Account No.</td><td class="p-pay-v p-pay-acct">${esc(PAYMENT.number)}</td></tr>
      </table>
      ${PAYMENT.note   ? `<div class="p-pay-note">${esc(PAYMENT.note)}</div>` : ''}
      ${PAYMENT.remind ? `<div class="p-pay-note">${esc(PAYMENT.remind)}</div>` : ''}
    </div>
    ${PAYMENT.qr ? `<figure class="p-pay-qr">
      <img src="${base}${esc(PAYMENT.qr)}" alt=""
           onerror="this.parentNode.style.display='none';">
    </figure>` : ''}
  </div>`;
    }

    // ── Totals ────────────────────────────────────────────────────────
    function qtTotalsHtml(d) {
        const fmt = window.qtFmt;
        const pc = window.qtProjectCost(d.sections), disc = window.qtDiscountAmount(d),
              sub = window.qtSubTotal(d), vat = window.qtVatAmount(d), tot = window.qtGrandTotal(d);
        const vatRow = d.vatMode === 'none'
            ? `<tr><td>Plus: VAT:</td><td>Not applicable</td></tr>`
            : d.vatMode === 'inclusive'
            ? `<tr><td>VAT (${window.qtParseNum(d.vatPct)}%, included):</td><td>${fmt(vat)}</td></tr>`
            : `<tr><td>Plus: VAT (${window.qtParseNum(d.vatPct)}%):</td><td>${fmt(vat)}</td></tr>`;
        return `
        <table class="p-tot">
            <tr><td>Project Cost:</td><td>${fmt(pc)}</td></tr>
            ${disc ? `<tr><td>Less: Discount:</td><td>(${fmt(disc)})</td></tr>` : ''}
            <tr class="p-sub"><td>Sub-total:</td><td>${fmt(sub)}</td></tr>
            ${vatRow}
            <tr class="p-grand"><td>Total Project Cost:</td><td>${fmt(tot)}</td></tr>
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

        // Open the window synchronously, while the click's transient user
        // activation is still valid. Signing first would spend that budget on
        // network round-trips and get a legitimate print blocked.
        const w = window.open('', '_blank');
        if (!w) { if (window.qtToast) window.qtToast('Pop-up blocked — allow pop-ups to print', 'error'); return; }
        w.document.write('<!DOCTYPE html><meta charset="UTF-8"><title>Preparing…</title><p style="font:14px system-ui;padding:2rem">Preparing quotation…</p>');

        const imgMap = await qtSignImages(d);

        const esc = window.qtEscHtml;
        const base = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);

        const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>${esc(d.subject || 'Project Estimate')} — ${esc(d.projectName || '')}</title>
<style>
  /* Colours and weights mirror the BOQ report (boqPrintReport in
     js/boq-module.js) so both documents read as one family. Every tinted
     surface carries print-color-adjust:exact — without it the browser drops
     the fills at print time and the sheet comes out plain white. */
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:'Segoe UI',Arial,sans-serif;font-size:8.5pt;color:#111;background:#e8e8e8;}
  /* position:relative anchors the .p-rev quote-number stamp in the on-screen
     preview — without it the stamp escapes to the viewport corner. */
  .page{position:relative;width:210mm;min-height:297mm;background:#fff;margin:12px auto;
        padding:12mm 14mm 14mm;box-shadow:0 2px 16px rgba(0,0,0,.18);}

  /* ── Company header ── */
  /* No rule under the header — owner's call, 2026-08-11. The padding stays so
     the info box keeps its distance from the title. */
  .p-head{display:flex;align-items:center;justify-content:space-between;gap:20px;
          padding-bottom:12px;margin-bottom:12px;}
  /* Logo stacked ABOVE its label. */
  .p-head-l{display:flex;flex-direction:column;align-items:center;gap:6px;min-width:0;}
  /* height + width:auto keeps the logo's own aspect ratio — never set both, or
     it stretches. object-fit:contain is the belt to that braces. */
  .p-logo{height:132px;width:auto;max-width:78mm;object-fit:contain;flex-shrink:0;}
  .p-co{font-size:18px;font-weight:800;color:#1a1a2e;letter-spacing:.06em;text-transform:uppercase;
        line-height:1.2;text-align:center;white-space:nowrap;}
  .p-co-sub{font-size:8pt;color:#6b7280;margin-top:3px;text-align:center;}
  .p-head-r{text-align:right;flex-shrink:0;min-width:150px;}
  .p-title{font-size:13px;font-weight:800;color:#1a5c3a;text-transform:uppercase;letter-spacing:.05em;}
  .p-title-sub{font-size:8pt;color:#9ca3af;margin-top:4px;}

  /* ── Document info box — black labels, same as the BOQ report ── */
  .p-meta{width:100%;border-collapse:collapse;margin-bottom:9px;border:2px solid #111;}
  .p-meta td{padding:3px 7px;border:1px solid #111;font-size:8pt;vertical-align:middle;}
  .p-meta .k{background:#111;color:#fff;font-weight:800;text-transform:uppercase;white-space:nowrap;
             -webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .p-meta .v{font-weight:700;color:#111;background:#fff;}

  .p-scope{margin-bottom:9px;font-size:8pt;white-space:pre-wrap;border-left:3px solid #fbbf24;
           padding:5px 9px;background:#fffdf3;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .p-scope-hd{font-weight:800;text-transform:uppercase;font-size:7.5pt;margin-bottom:2px;}

  /* ── Items table ── */
  table.p-items{width:100%;border-collapse:collapse;font-size:7.5pt;table-layout:fixed;}
  table.p-items th{background:#fbbf24;color:#000;font-weight:800;font-size:6.5pt;text-transform:uppercase;
                   letter-spacing:.03em;border:1px solid #f59e0b;padding:4px;text-align:center;
                   -webkit-print-color-adjust:exact;print-color-adjust:exact;}
  table.p-items td{border:1px solid #888;padding:3px 5px;vertical-align:middle;overflow:hidden;}
  .c-no{width:30px;text-align:center;} .c-qty{width:34px;text-align:center;}
  .c-unit{width:40px;text-align:center;} .c-rate{width:70px;text-align:right;}
  .c-amt{width:86px;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}

  /* section — red, same #c81e1e as the BOQ level-1 row */
  tr.p-l1 td{background:#c81e1e;color:#fff;font-weight:800;font-size:7.5pt;text-transform:uppercase;
             border-color:#991b1b;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  /* group / sub-item — light grey */
  tr.p-l2 td{background:#e5e7eb;color:#111;font-weight:700;font-size:7pt;
             -webkit-print-color-adjust:exact;print-color-adjust:exact;}
  tr.p-l3 td{background:#fff;font-size:7pt;}
  tr.p-l3 td.c-desc{padding-left:16px;}
  tr.p-removed td{text-decoration:line-through;color:#999;}
  tr.p-waived td.c-amt{font-weight:800;}
  tr.p-optional td{color:#6b7280;font-style:italic;}
  /* blank band between sections, like the BOQ report's spacer */
  tr.p-spacer td{height:5px;background:#fff;border:none;padding:0;
                 -webkit-print-color-adjust:exact;print-color-adjust:exact;}

  /* ── Reference images — one strip, above the itemized estimate ── */
  .p-imgs{display:flex;gap:5mm;margin-bottom:9px;align-items:flex-start;justify-content:center;
          break-inside:avoid;page-break-inside:avoid;}
  .p-img-fig{flex:1 1 0;min-width:0;max-width:90mm;text-align:center;}
  .p-img-fig img{width:100%;height:auto;max-height:62mm;object-fit:contain;border:1px solid #d0d0d0;}
  .p-cap{font-size:7pt;color:#555;margin-top:2px;font-style:italic;}

  /* ── Totals — the BOQ Summary panel's shape: no fills, hairline rules
        between rows, one heavy rule above the final figure. Nothing here
        depends on background printing, so it survives any printer. ── */
  table.p-tot{margin-left:auto;margin-top:10px;border-collapse:collapse;width:88mm;font-size:8.5pt;}
  table.p-tot td{border:none;border-bottom:1px solid #f0f0f0;padding:5px 0;vertical-align:middle;}
  table.p-tot td:first-child{font-weight:700;color:#374151;}
  table.p-tot td:last-child{text-align:right;font-weight:800;color:#1f2937;
                            white-space:nowrap;font-variant-numeric:tabular-nums;}
  tr.p-sub td{font-weight:800;}
  tr.p-grand td{border-top:2px solid #1f2937;border-bottom:none;padding-top:7px;
                font-size:10pt;font-weight:900;color:#1f2937;text-transform:uppercase;}
  .p-vatnote{text-align:right;font-size:7pt;color:#555;margin-top:3px;font-style:italic;}

  /* ── Terms ── */
  .p-terms{margin-top:10px;font-size:7.5pt;border-top:1.5px solid #ccc;padding-top:7px;}
  .p-term{margin-bottom:7px;}
  .p-term-hd{font-weight:800;font-size:8pt;margin-bottom:3px;text-transform:uppercase;color:#111;}
  .p-term div{margin-left:10px;line-height:1.55;color:#222;}
  .p-term ol{margin:3px 0 0 20px;} .p-term li{margin-bottom:2px;line-height:1.55;}

  /* ── Signatures ── */
  .p-sig{margin-top:14px;display:flex;justify-content:space-between;gap:24px;}
  .p-sig-col{flex:1;text-align:center;font-size:7.5pt;}
  .p-sig-line{border-top:1.5px solid #111;margin-top:28px;padding-top:3px;font-weight:700;font-size:8pt;}
  /* The signature image fills the 28px the blank column leaves for a wet
     signature, so both rules stay on the same baseline. If the file fails to
     load, onerror drops .p-sig-signed and the 28px gap comes back. */
  .p-sig-img{display:block;height:28px;width:auto;max-width:70%;margin:0 auto;
             object-fit:contain;object-position:center bottom;}
  .p-sig-signed .p-sig-line{margin-top:0;}
  .p-sig-role{color:#555;font-size:7pt;margin-top:2px;}

  /* ── Payment details — bordered box at the foot of the sheet. Kept
        whole across a page break: an account number split over two pages
        is how a client mistypes it. ── */
  .p-pay{margin-top:12px;border:1.5px solid #1a1a2e;padding:7px 9px;
         display:flex;gap:10px;align-items:center;
         break-inside:avoid;page-break-inside:avoid;}
  .p-pay-body{flex:1;min-width:0;}
  .p-pay-hd{font-weight:800;font-size:8pt;text-transform:uppercase;color:#111;
            letter-spacing:.03em;margin-bottom:4px;}
  table.p-pay-tbl{border-collapse:collapse;}
  table.p-pay-tbl td{border:none;padding:1px 0;font-size:8pt;vertical-align:baseline;}
  /* Wide enough for "ACCOUNT NAME" on ONE line — at 74px it wrapped and
     pushed the value rows out of alignment. nowrap keeps it honest if a
     longer label is ever added. */
  .p-pay-k{width:92px;color:#555;font-size:7pt;text-transform:uppercase;
           letter-spacing:.02em;white-space:nowrap;}
  .p-pay-v{font-weight:700;color:#111;padding-left:8px !important;}
  /* Tabular figures and wide tracking — the number is meant to be copied
     by hand off a printed page. */
  .p-pay-acct{font-size:10.5pt;font-weight:900;letter-spacing:.08em;
              font-variant-numeric:tabular-nums;white-space:nowrap;}
  .p-pay-note{font-size:6.5pt;color:#555;font-style:italic;margin-top:3px;line-height:1.5;}
  /* The artwork keeps its OWN aspect ratio: height is auto, never a fixed
     square. A portrait BDO card squeezed into a 26mm square box printed the
     QR about 8mm wide and no phone could read it. Width comes from
     PAYMENT.qrWidthMm so it can be tuned in one place. */
  .p-pay-qr{flex:0 0 auto;width:${PAYMENT.qrWidthMm}mm;text-align:center;}
  /* max-height is a runaway guard only, deliberately far above any sane
     card. Set it near the real height and it starts fighting the width:
     contain would letterbox INSIDE the box and shrink the artwork again,
     which is the bug this whole block exists to fix. */
  .p-pay-qr img{width:100%;height:auto;max-height:120mm;object-fit:contain;display:block;}

  .p-disc{margin-top:10px;font-size:6.5pt;color:#666;text-align:center;font-style:italic;
          border-top:1px solid #ddd;padding-top:6px;line-height:1.6;}
  /* Screen-only. It used to be position:fixed so the quote number stamped
     every printed page — but a fixed element repeats at a FIXED offset,
     and with no per-page top margin it landed on top of the table rows on
     page 2. The header already prints the same number at top-right, so the
     stamp is dropped at print time rather than fought with. */
  .p-rev{position:absolute;top:6mm;right:10mm;font-size:7pt;color:#666;}

  /* The margins live on @page, NOT on .page's padding. Padding is applied
     once to the whole block, so it indents page 1 and leaves every later
     page running into the paper's edge. @page applies to each sheet. */
  @page{size:A4 portrait;margin:12mm 10mm 10mm;}
  /* Keep the summary block from being split across a page break. */
  table.p-tot{break-inside:avoid;page-break-inside:avoid;}
  @media print{
    body{background:#fff;}
    .page{width:100%;margin:0;padding:0;box-shadow:none;min-height:auto;}
    .p-rev{display:none;}
    /* A thead repeats at the top of every printed page by default. On page 2
       it can sit above nothing but the totals and read as an empty table, so
       demote it to an ordinary row group: it still renders first, but once. */
    table.p-items thead{display:table-row-group;}
  }
</style></head><body>
<div class="page">
  <div class="p-rev">${esc(d.quoteNo || '')}${d.revNo > 1 ? ' · Rev ' + d.revNo : ''}</div>

  <div class="p-head">
    <div class="p-head-l">
      ${qtShowsLogo(d) ? `<img class="p-logo" src="${base}${COMPANY.logo}" alt="" onerror="this.style.display='none'">` : ''}
      <div>
        <div class="p-co">${esc(DOC_LABEL)}</div>
        ${qtCompanyLine() ? `<div class="p-co-sub">${esc(qtCompanyLine())}</div>` : ''}
      </div>
    </div>
    <div class="p-head-r">
      <div class="p-title">${esc((d.subject || 'PROJECT ESTIMATE').toUpperCase())}</div>
      <div class="p-title-sub">${esc(d.quoteNo || '')}${d.revNo > 1 ? ' · Rev ' + d.revNo : ''}</div>
    </div>
  </div>

  <table class="p-meta">
    <colgroup><col style="width:80px"><col style="width:32%"><col style="width:80px"><col></colgroup>
    <tr><td class="k">Client</td><td class="v">${esc(d.clientName || '')}</td><td class="k">Quote No.</td><td class="v">${esc(d.quoteNo || '')}${d.revNo > 1 ? ' (Rev ' + d.revNo + ')' : ''}</td></tr>
    <tr><td class="k">Project</td><td class="v">${esc(d.projectName || '')}</td><td class="k">Date</td><td class="v">${esc(qtPrettyDate(d.quoteDate))}</td></tr>
    <tr><td class="k">Location</td><td class="v">${esc(d.location || '')}</td><td class="k">Valid Until</td><td class="v">${esc(qtPrettyDate(d.validUntil))}</td></tr>
    ${d.clientAddress || d.area ? `<tr><td class="k">Address</td><td class="v">${esc(d.clientAddress || '')}</td><td class="k">Area</td><td class="v">${esc(d.area || '')}</td></tr>` : ''}
  </table>

  ${d.scopeNote ? `<div class="p-scope"><div class="p-scope-hd">Scope of Work</div>${esc(d.scopeNote)}</div>` : ''}

  ${qtImagesHtml(d, imgMap)}

  <table class="p-items">
    <colgroup><col class="c-no"><col><col class="c-qty"><col class="c-unit">${qtShowsLinePricing(d) ? '<col class="c-rate">' : ''}<col class="c-amt"></colgroup>
    <thead><tr><th>#</th><th>DESCRIPTION</th><th>QTY</th><th>UNIT</th>${qtShowsLinePricing(d) ? '<th>UNIT PRICE</th>' : ''}<th>AMOUNT</th></tr></thead>
    <tbody>${qtRowsHtml(d, imgMap)}</tbody>
  </table>

  ${qtTotalsHtml(d)}
  ${qtTermsHtml(d)}

  ${qtSigHtml(d, base)}

  ${qtPaymentHtml(base)}

  <div class="p-disc">
    This is a price proposal, not a contract, and is not legally binding. Prices hold until the validity
    date shown above and are subject to change thereafter. A formal contract is issued upon approval.
    &nbsp;|&nbsp; Printed on ${esc(new Date().toLocaleString('en-PH', { year:'numeric', month:'long', day:'numeric', hour:'numeric', minute:'2-digit', hour12:true }))}
  </div>
</div>
<script>
  // Chrome stamps the document title across the top of every printed page when
  // "Headers and footers" is ticked. The checkbox can't be reached from code,
  // but the text it prints CAN: blanking the title empties that centre line.
  window.onload=function(){
    var real=document.title;
    window.onafterprint=function(){document.title=real;};
    document.title=' ';
    setTimeout(function(){window.print();},400);
  };
<\/script>
</body></html>`;

        w.document.open();
        w.document.write(html);
        w.document.close();
    };

    // ── PDF export ────────────────────────────────────────────────────
    // jsPDF and autotable load from CDN on first use only, exactly as
    // boqExportPDF() does — they are ~300KB and most sessions never export.
    let _qtPdfReady = false;
    window.qtExportPDF = function (snapshot) {
        if (!_qtPdfReady) {
            if (window.qtToast) window.qtToast('Loading PDF library…');
            const s1 = document.createElement('script');
            s1.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
            s1.onload = function () {
                const s2 = document.createElement('script');
                s2.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js';
                s2.onload = function () { _qtPdfReady = true; qtGeneratePDF(snapshot); };
                s2.onerror = function () { if (window.qtToast) window.qtToast('Could not load the PDF library', 'error'); };
                document.head.appendChild(s2);
            };
            s1.onerror = function () { if (window.qtToast) window.qtToast('Could not load the PDF library', 'error'); };
            document.head.appendChild(s1);
            return;
        }
        qtGeneratePDF(snapshot);
    };

    // Loads an image through a canvas so jsPDF gets raw pixel data. Resolves
    // null on any failure — a missing logo must never block the export.
    function qtLoadImageData(src) {
        return new Promise(resolve => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                try {
                    const c = document.createElement('canvas');
                    c.width = img.naturalWidth; c.height = img.naturalHeight;
                    c.getContext('2d').drawImage(img, 0, 0);
                    resolve({ url: c.toDataURL('image/png'), w: img.naturalWidth, h: img.naturalHeight });
                } catch (e) { resolve(null); }      // tainted canvas
            };
            img.onerror = () => resolve(null);
            img.src = src;
        });
    }

    // async only for the logo. Every call site ignores the return value.
    async function qtGeneratePDF(snapshot) {
        const d = snapshot || qtDoc();
        if (!d) { if (window.qtToast) window.qtToast('Nothing to export', 'error'); return; }
        if (!snapshot && window.qtIsExpired && window.qtIsExpired(d)
            && !confirm(`This quotation lapsed on ${d.validUntil}.\n\nExport it anyway?`)) return;

        const fmt = window.qtFmt;
        const jsPDF = (window.jspdf || window).jsPDF;
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const pageW = doc.internal.pageSize.getWidth();   // 210mm
        const M = 12;
        const base = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);
        let y = M;

        // ── Header — logo with its label underneath, title on the right ──
        // logoH is the LOGO's height; its width is derived from the image's own
        // aspect ratio, never fixed, so the mark can't come out stretched.
        // Skipped entirely when the document has the logo turned off (0048).
        const logo   = qtShowsLogo(d) ? await qtLoadImageData(base + COMPANY.logo) : null;
        const coLine = qtCompanyLine();
        // No logo — switched off, or the file failed to load — means no logo
        // band either: the label block starts at the top margin instead of
        // leaving 34mm of white space where the mark would have been.
        const logoH  = logo ? 34 : 0;
        let logoW = 0, logoCx = M;
        if (logo) {
            logoW  = logoH * (logo.w / logo.h);
            logoCx = M + logoW / 2;
            doc.addImage(logo.url, 'PNG', M, y, logoW, logoH);
        }

        // The label sits centred beneath the logo — but the mark is narrow and
        // the wording is not, so clamp the centre to keep the text inside the
        // left margin. Without this "PROJECT QUOTATION" hangs off the page.
        doc.setFont('helvetica', 'bold').setFontSize(15).setTextColor(26, 26, 46);
        const lblCx = Math.max(logoCx, M + doc.getTextWidth(DOC_LABEL) / 2);
        let blockH = logoH + 7;
        doc.text(DOC_LABEL, lblCx, y + logoH + 5.5, { align: 'center' });
        if (coLine) {
            doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(107, 114, 128);
            doc.text(coLine, lblCx, y + logoH + 10, { align: 'center' });
            blockH = logoH + 11.5;
        }

        // Right-hand title, centred against the whole left block.
        const midY = y + blockH / 2;
        doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(26, 92, 58);
        doc.text((d.subject || 'PROJECT ESTIMATE').toUpperCase(), pageW - M, midY, { align: 'right' });
        doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(156, 163, 175);
        doc.text((d.quoteNo || '') + (d.revNo > 1 ? ' · Rev ' + d.revNo : ''),
                 pageW - M, midY + 5, { align: 'right' });
        doc.setTextColor(0, 0, 0);

        // No accent rule under the header — matches the print sheet, which
        // dropped its green border on 2026-08-11. The advance stays so the
        // info box sits where it always did.
        y += blockH + 6;

        // ── Document info box — black labels, matching the print sheet ──
        const metaRows = [
            // TWO columns of label/value, exactly like the sheet's p-meta table.
            // It used to stack all six in one column AND omit Address and Area,
            // so the PDF and the printed sheet showed different header blocks.
            ['CLIENT',   d.clientName  || '', 'QUOTE NO.',
             (d.quoteNo || '') + (d.revNo > 1 ? ' (Rev ' + d.revNo + ')' : '')],
            ['PROJECT',  d.projectName || '', 'DATE',        qtPrettyDate(d.quoteDate)],
            ['LOCATION', d.location    || '', 'VALID UNTIL', qtPrettyDate(d.validUntil)]
        ];
        // Same gate as the sheet: the row is skipped when both cells are empty,
        // so a quotation written before Area existed (0058) prints unchanged.
        if (d.clientAddress || d.area) {
            metaRows.push(['ADDRESS', d.clientAddress || '', 'AREA', d.area || '']);
        }
        const metaLabel = { cellWidth: 25, fillColor: [17, 17, 17],
                            textColor: [255, 255, 255], fontStyle: 'bold' };
        doc.autoTable({
            startY: y, margin: { left: M, right: M },
            body: metaRows, theme: 'grid',
            styles: { fontSize: 7.5, cellPadding: 1.4, lineColor: [17, 17, 17], lineWidth: 0.2 },
            columnStyles: { 0: metaLabel,
                            1: { cellWidth: 'auto', fontStyle: 'bold' },
                            2: Object.assign({}, metaLabel),
                            3: { cellWidth: 46, fontStyle: 'bold' } }
        });
        y = doc.lastAutoTable.finalY + 3;

        if (d.scopeNote) {
            doc.autoTable({
                startY: y, margin: { left: M, right: M },
                body: [[{ content: 'SCOPE OF WORK\n' + d.scopeNote }]], theme: 'plain',
                styles: { fontSize: 7.5, cellPadding: 1.6, fillColor: [255, 253, 243] }
            });
            y = doc.lastAutoTable.finalY + 3;
        }

        // ── Reference images — one strip, sharing the usable width ─────
        // The bucket is private, so the URLs are signed first (same map the
        // print sheet uses). Any image that fails to load is skipped: a
        // broken render must never cost the client their price list.
        const refImgs = qtDocImages(d);
        if (refImgs.length) {
            const signed = await qtSignImages(d);
            const loaded = await Promise.all(refImgs.map(im =>
                qtLoadImageData(signed.get(im.url) || im.url).then(data => ({ data, im }))));
            const ok = loaded.filter(r => r.data);
            if (ok.length) {
                const gap    = 4;
                const usable = pageW - M * 2;
                const cellW  = (usable - gap * (ok.length - 1)) / ok.length;
                // Uniform row height: the tallest each image may be at cellW,
                // clamped so a portrait render can't swallow the page.
                const boxH = Math.min(58, ...ok.map(r => cellW * (r.data.h / r.data.w)));
                ok.forEach((r, i) => {
                    const scale = Math.min(cellW / r.data.w, boxH / r.data.h);
                    const w = r.data.w * scale, h = r.data.h * scale;
                    const x = M + i * (cellW + gap) + (cellW - w) / 2;
                    doc.addImage(r.data.url, 'PNG', x, y, w, h);
                    if (r.im.caption) {
                        doc.setFont('helvetica', 'italic').setFontSize(6).setTextColor(85, 85, 85);
                        doc.text(String(r.im.caption), M + i * (cellW + gap) + cellW / 2, y + boxH + 3,
                                 { align: 'center', maxWidth: cellW });
                        doc.setTextColor(0, 0, 0);
                    }
                });
                y += boxH + (ok.some(r => r.im.caption) ? 6 : 3);
            }
        }

        // Flatten the tree into autotable rows, preserving the visual levels.
        // `rowKind` runs parallel to `body` so didParseCell can colour each row
        // the same way the print sheet's .p-l1 / .p-l2 / .p-l3 classes do.
        // Same rule as the print sheet: with pricing off the UNIT PRICE column
        // is dropped and every colspan shifts by one (migration 0047).
        const rates    = qtShowsLinePricing(d);
        const descSpan = rates ? 4 : 3;
        const body = [], rowKind = [];
        (d.sections || []).forEach((sec, si) => {
            // Uppercased to match the sheet, where `tr.p-l1 td` carries
            // text-transform:uppercase — a label stored as "general
            // requirements" printed lowercase here and SHOUTED there.
            body.push([{ content: `${si + 1}. ${String(sec.label || 'SECTION').toUpperCase()}`,
                         colSpan: descSpan + 1 },
                       { content: fmt(window.qtSectionTotal(sec)), styles: { halign: 'right' } }]);
            rowKind.push('l1');
            const lump = sec.pricing === 'lump';
            (sec.groups || []).forEach(g => {
                // Same shape as a line row so the optional group qty / unit land
                // under the right headings. Empty strings print empty cells.
                const grow = ['', g.label || '', g.qty || '', g.unit || ''];
                if (rates) grow.push('');
                grow.push({ content: qtGroupPrintAmount(sec, g), styles: { halign: 'right' } });
                body.push(grow);
                rowKind.push('l2');
                (g.lines || []).forEach(l => {
                    const st = l.state || 'normal';
                    const amt = (lump || !rates) ? (st === 'waived' ? 'WAIVED' : '')
                        : st === 'waived'  ? 'WAIVED'
                        : st === 'removed' ? fmt(window.qtRawLineAmount(l))
                        : fmt(window.qtLineAmount(l));
                    const label = (l.description || '')
                        + (st === 'optional' ? ' (optional)' : '')
                        + (st === 'removed'  ? '  [REMOVED]'  : '');
                    const row = ['', '   ' + label, l.qty || '', l.unit || ''];
                    if (rates) row.push(lump ? '' : fmt(l.unitPrice));
                    row.push({ content: amt, styles: { halign: 'right' } });
                    body.push(row);
                    rowKind.push(st === 'optional' || st === 'removed' ? 'l3-muted' : 'l3');
                });
            });
            if (si < (d.sections || []).length - 1) {
                body.push(new Array(descSpan + 2).fill(''));
                rowKind.push('spacer');
            }
        });

        const itemCols = { 0: { cellWidth: 9, halign: 'center' }, 1: { cellWidth: 'auto' },
                           2: { cellWidth: 12, halign: 'center' },
                           3: { cellWidth: 14, halign: 'center' } };
        if (rates) itemCols[4] = { cellWidth: 22, halign: 'right' };
        itemCols[rates ? 5 : 4] = { cellWidth: 26, halign: 'right' };

        doc.autoTable({
            startY: y, margin: { left: M, right: M },
            head: [rates ? ['#', 'DESCRIPTION', 'QTY', 'UNIT', 'UNIT PRICE', 'AMOUNT']
                         : ['#', 'DESCRIPTION', 'QTY', 'UNIT', 'AMOUNT']],
            body,
            styles: { fontSize: 7, cellPadding: 1.3, lineColor: [136, 136, 136], lineWidth: 0.1 },
            headStyles: { fillColor: [251, 191, 36], textColor: [0, 0, 0], fontStyle: 'bold',
                          fontSize: 6.5, halign: 'center', lineColor: [245, 158, 11] },
            columnStyles: itemCols,
            didParseCell: function (data) {
                if (data.section !== 'body') return;
                switch (rowKind[data.row.index]) {
                    case 'l1':       // section — red, same #c81e1e as the sheet
                        data.cell.styles.fillColor = [200, 30, 30];
                        data.cell.styles.textColor = [255, 255, 255];
                        data.cell.styles.fontStyle = 'bold';
                        data.cell.styles.lineColor = [153, 27, 27];
                        break;
                    case 'l2':       // group — light grey
                        data.cell.styles.fillColor = [229, 231, 235];
                        data.cell.styles.fontStyle = 'bold';
                        break;
                    case 'l3-muted':
                        data.cell.styles.textColor = [107, 114, 128];
                        data.cell.styles.fontStyle = 'italic';
                        break;
                    case 'spacer':
                        data.cell.styles.fillColor = [255, 255, 255];
                        data.cell.styles.lineWidth = 0;
                        data.cell.styles.cellPadding = { top: 0.8, bottom: 0.8, left: 0, right: 0 };
                        break;
                }
            }
        });

        y = doc.lastAutoTable.finalY + 4;
        const pc = window.qtProjectCost(d.sections), disc = window.qtDiscountAmount(d),
              sub = window.qtSubTotal(d), vat = window.qtVatAmount(d), tot = window.qtGrandTotal(d);
        const totRows = [['Project Cost:', fmt(pc)]];
        if (disc) totRows.push(['Less: Discount:', '(' + fmt(disc) + ')']);
        totRows.push(['Sub-total:', fmt(sub)]);
        totRows.push(['Plus: VAT:', d.vatMode === 'none' ? 'Not applicable'
                      : d.vatMode === 'inclusive' ? '(incl. ' + fmt(vat) + ')' : fmt(vat)]);
        totRows.push(['TOTAL PROJECT COST:', fmt(tot)]);
        const lastIdx = totRows.length - 1;

        // No fills — the BOQ Summary panel's shape. Hairline under each row,
        // one heavy rule above the final figure, drawn by hand because
        // autotable can't style individual cell borders.
        doc.autoTable({
            startY: y, margin: { left: pageW - M - 88 },
            body: totRows, theme: 'plain',
            styles: { fontSize: 8.5, cellPadding: { top: 1.9, bottom: 1.9, left: 0, right: 0 } },
            columnStyles: { 0: { cellWidth: 52, fontStyle: 'bold', textColor: [55, 65, 81] },
                            1: { cellWidth: 36, halign: 'right', fontStyle: 'bold', textColor: [31, 41, 55] } },
            didParseCell: function (data) {
                if (data.section === 'body' && data.row.index === lastIdx) {
                    data.cell.styles.fontSize = 10;
                }
            },
            didDrawCell: function (data) {
                if (data.section !== 'body') return;
                const c = data.cell;
                if (data.row.index === lastIdx) {
                    doc.setDrawColor(31, 41, 55).setLineWidth(0.5);
                    doc.line(c.x, c.y, c.x + c.width, c.y);            // heavy rule ABOVE
                } else {
                    doc.setDrawColor(232, 232, 232).setLineWidth(0.15);
                    doc.line(c.x, c.y + c.height, c.x + c.width, c.y + c.height);
                }
            }
        });

        y = doc.lastAutoTable.finalY + 3;
        doc.setFont('helvetica', 'italic').setFontSize(6.5).setTextColor(85, 85, 85);
        doc.text(d.vatMode === 'exclusive' ? '*VAT is added to the sub-total above.'
               : d.vatMode === 'inclusive' ? '*Total is VAT inclusive.' : '*VAT not applicable.',
                 pageW - M, y, { align: 'right' });
        doc.setTextColor(0, 0, 0);

        // ── Everything below the totals ──────────────────────────────
        // The PDF used to stop at the VAT note, so the exported file was
        // missing the terms, the signatures, the payment details and the small
        // print — i.e. every part a client actually acts on. Added 2026-08-26.
        // Each block mirrors its HTML twin (qtTermsHtml, qtSigHtml,
        // qtPaymentHtml and the .p-disc footer) so the two sheets can't say
        // different things; change one and change the other.
        const pageH = doc.internal.pageSize.getHeight();
        const CONTENT_W = pageW - 2 * M;
        // Adds a page when the next block will not fit whole. Blocks are small
        // enough that this never has to split one across pages.
        const need = (h) => { if (y + h > pageH - M - 4) { doc.addPage(); y = M; } };

        // ── Terms ────────────────────────────────────────────────────
        const t = d.terms || {};
        const termBlocks = [
            ['VALIDITY',          t.validityNote],
            ['PAYMENT TERMS',     t.payment],
            ['DELIVERY TIMELINE', t.deliveryTimeline],
            ['WARRANTY',          t.warranty],
            ['EXCLUSIONS',        t.exclusions]
        ].filter((b) => String(b[1] || '').trim());
        const conds = (t.conditions || []).filter((c) => c.include !== false);

        // Measure EVERY term block before drawing any of them, so the group can
        // move to a fresh page as ONE unit. Breaking per block strands PAYMENT
        // TERMS at the foot of a page with WARRANTY and EXCLUSIONS overleaf —
        // the terms read as one section and have to stay together.
        doc.setFont('helvetica', 'normal').setFontSize(7.5);
        const measured = termBlocks.map(function (b) {
            const lines = [];
            String(b[1]).split('\n').forEach(function (raw) {
                // A blank line in the source is a deliberate gap — keep it.
                if (!raw.trim()) { lines.push(''); return; }
                doc.splitTextToSize(raw, CONTENT_W).forEach((l) => lines.push(l));
            });
            return { title: b[0], lines: lines, h: 4 + lines.length * 3.3 + 2.4 };
        });
        // Rough allowance for the conditions list, measured the same way.
        let condsH = 0;
        const condLines = conds.map(function (c) {
            const ls = doc.splitTextToSize((c.title ? c.title + ' ' : '') + (c.body || ''),
                                           CONTENT_W - 6);
            condsH += ls.length * 3.3 + 1.6;
            return ls;
        });
        if (conds.length) condsH += 5;
        const termsH = measured.reduce((s, m) => s + m.h, 0) + condsH;

        if (measured.length || conds.length) {
            y += 5;
            // Only worth moving as a unit if it can actually fit on a fresh
            // page. A terms list taller than a page still falls back to
            // per-block breaks below rather than looping forever.
            if (termsH <= pageH - 2 * M) need(termsH);
        }

        measured.forEach(function (m) {
            need(m.h);                      // a no-op when the group already moved
            doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(26, 26, 46);
            doc.text(m.title, M, y);
            y += 4;
            doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(55, 65, 81);
            m.lines.forEach(function (l) { if (l) doc.text(l, M, y); y += 3.3; });
            y += 2.4;
        });

        if (conds.length) {
            need(8);
            doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(26, 26, 46);
            doc.text('GENERAL TERMS & CONDITIONS', M, y);
            y += 4;
            conds.forEach(function (c, i) {
                doc.setFont('helvetica', 'normal').setFontSize(7.5);
                const lines = condLines[i];     // measured with the group above
                need(lines.length * 3.3 + 2);
                doc.setTextColor(55, 65, 81);
                doc.text(String(i + 1) + '.', M, y);
                lines.forEach(function (l, li) { doc.text(l, M + 5, y + li * 3.3); });
                y += lines.length * 3.3 + 1.6;
            });
            y += 1;
        }

        // ── Signatures ───────────────────────────────────────────────
        // Same gate as the sheet: no signOff object means a document written
        // before the switches existed, and it must not grow a block now.
        const so = (d.terms && d.terms.signOff) || null;
        if (so) {
            const sigCols = [];
            if (qtSigOn(so, 'prepared') && String(d.preparedBy || '').trim()) {
                sigCols.push({ name: d.preparedBy, role: 'Prepared By', signed: false });
            }
            if (qtSigOn(so, 'submitted')) {
                sigCols.push({ name: d.submittedBy || d.preparedBy || COMPANY.name,
                               role: 'Submitted By', signed: true });
            }
            if (qtSigOn(so, 'client')) {
                sigCols.push({ name: d.clientName || '', role: 'Client Approval / Date', signed: false });
            }
            if (sigCols.length) {
                // Only fetched when a column actually carries it, and a failed
                // load resolves null — a missing file must never lose the names.
                const sigImg = sigCols.some((c) => c.signed)
                    ? await qtLoadImageData(base + 'assets/images/dacs-signature.png') : null;
                const imgH  = sigImg ? 13 : 0;
                need(imgH + 18);
                y += 7;
                const colW  = CONTENT_W / sigCols.length;
                const lineY = y + imgH + 1;
                sigCols.forEach(function (c, i) {
                    const left = M + colW * i, cx = left + colW / 2;
                    if (c.signed && sigImg) {
                        const w = imgH * (sigImg.w / sigImg.h);
                        doc.addImage(sigImg.url, 'PNG', cx - w / 2, lineY - imgH, w, imgH);
                    }
                    doc.setDrawColor(130, 130, 130).setLineWidth(0.3);
                    doc.line(left + 5, lineY, left + colW - 5, lineY);
                    doc.setFont('helvetica', 'bold').setFontSize(8.5).setTextColor(26, 26, 46);
                    doc.text(c.name || ' ', cx, lineY + 4.2, { align: 'center' });
                    doc.setFont('helvetica', 'normal').setFontSize(6.8).setTextColor(110, 110, 110);
                    doc.text(c.role, cx, lineY + 8, { align: 'center' });
                });
                y = lineY + 12;
            }
        }

        // ── Payment details ──────────────────────────────────────────
        // An account with no number is not payable — print nothing rather than
        // a labelled empty box. Same rule as the sheet.
        if (PAYMENT.show && String(PAYMENT.number || '').trim()) {
            const qr  = PAYMENT.qr ? await qtLoadImageData(base + PAYMENT.qr) : null;
            const qrW = qr ? Math.min(PAYMENT.qrWidthMm || 55, CONTENT_W * 0.42) : 0;
            const qrH = qr ? qrW * (qr.h / qr.w) : 0;
            const notes = [PAYMENT.note, PAYMENT.remind].filter(Boolean);
            const textH = 6 + 3 * 4.6 + notes.length * 3.4 + 5;
            const boxH  = Math.max(qrH + 7, textH);
            need(boxH + 6);
            y += 4;
            doc.setDrawColor(205, 205, 205).setLineWidth(0.3);
            doc.rect(M, y, CONTENT_W, boxH);

            let ty = y + 6;
            doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(26, 26, 46);
            doc.text('PAYMENT DETAILS', M + 5, ty);
            ty += 5.4;
            [['Bank', PAYMENT.bank], ['Account Name', PAYMENT.name],
             ['Account No.', PAYMENT.number]].forEach(function (r) {
                doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(120, 120, 120);
                doc.text(String(r[0]).toUpperCase(), M + 5, ty);
                doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(31, 41, 55);
                doc.text(String(r[1] || ''), M + 33, ty);
                ty += 4.6;
            });
            if (notes.length) {
                ty += 1.2;
                doc.setFont('helvetica', 'italic').setFontSize(6.2).setTextColor(120, 120, 120);
                notes.forEach(function (n) {
                    doc.splitTextToSize(String(n), CONTENT_W - qrW - 14).forEach(function (l) {
                        doc.text(l, M + 5, ty); ty += 3.1;
                    });
                });
            }
            if (qr) doc.addImage(qr.url, 'PNG', pageW - M - qrW - 4, y + (boxH - qrH) / 2, qrW, qrH);
            y += boxH;
        }

        // ── Small print ──────────────────────────────────────────────
        const stamp = new Date().toLocaleString('en-PH', { year: 'numeric', month: 'long',
            day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
        const discText = 'This is a price proposal, not a contract, and is not legally binding. '
            + 'Prices hold until the validity date shown above and are subject to change thereafter. '
            + 'A formal contract is issued upon approval.   |   Printed on ' + stamp;
        doc.setFont('helvetica', 'italic').setFontSize(6).setTextColor(130, 130, 130);
        const dLines = doc.splitTextToSize(discText, CONTENT_W);
        need(dLines.length * 2.8 + 6);
        y += 5;
        dLines.forEach(function (l) { doc.text(l, pageW / 2, y, { align: 'center' }); y += 2.8; });
        doc.setTextColor(0, 0, 0);

        const name = `${(d.quoteNo || 'quotation')}${d.revNo > 1 ? '-rev' + d.revNo : ''}.pdf`;
        doc.save(name.replace(/[^\w.\-]/g, '_'));
    }

})();
