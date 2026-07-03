// ════════════════════════════════════════════════════════════════════
// GLOBAL: force EVERY printed document to grayscale (black & white).
// All print/PDF outputs in the app open a blank popup via window.open() and
// write their own HTML. We wrap window.open once here (this file loads on every
// page) so any such popup gets a grayscale @media print rule injected — no need
// to touch each of the ~10 print generators. Screen view keeps its colors; only
// the printed/saved-PDF output is desaturated.
(function () {
    if (window.__dacsBwPrintPatched) return;
    window.__dacsBwPrintPatched = true;

    const BW_STYLE_ID = 'dacs-bw-print-style';
    // One global print stylesheet injected into EVERY print popup, so all PDFs come
    // out grayscale AND consistently positioned/presentable without editing each of
    // the ~20 document generators. Uses !important so it layers over their own CSS.
    const BW_TAG =
        '<style id="' + BW_STYLE_ID + '">' +
        '@media print{' +
          'html{-webkit-filter:grayscale(100%)!important;filter:grayscale(100%)!important;}' +
          '*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;box-shadow:none!important;}' +
          // A4 with comfortable, uniform margins so nothing is jammed to the edge.
          '@page{size:A4 portrait;margin:14mm 12mm;}' +
          'html,body{background:#fff!important;margin:0!important;padding:0!important;}' +
          // Common page/sheet wrappers: center, cap width, drop screen chrome.
          'body>.page,body>.sheet,body>.doc,body>.invoice,body>.a4,.print-page{' +
            'margin:0 auto!important;box-shadow:none!important;border:none!important;' +
            'border-radius:0!important;max-width:186mm!important;width:100%!important;}' +
          // Don't slice rows, cards, or signature blocks across pages.
          'tr,.sig-row,.sig-block,.pay-box,.totals-wrap,.cm-bd-box,.card,.box{break-inside:avoid;page-break-inside:avoid;}' +
          'thead{display:table-header-group;}' +          // repeat table headers per page
          'tfoot{display:table-footer-group;}' +
          '.noprint,.no-print{display:none!important;}' +
        '}' +
        '</style>';

    // Inject the grayscale <style> into any markup that lacks it. Prefer inside
    // <head>; fall back to prepending so it always applies.
    function withBw(markup) {
        const s = String(markup == null ? '' : markup);
        if (s.indexOf(BW_STYLE_ID) !== -1) return s;
        if (/<\/head>/i.test(s)) return s.replace(/<\/head>/i, BW_TAG + '</head>');
        if (/<head[^>]*>/i.test(s)) return s.replace(/(<head[^>]*>)/i, '$1' + BW_TAG);
        // No <head> in this chunk — only prepend if it looks like the doc start.
        if (/^\s*(<!doctype|<html)/i.test(s)) return BW_TAG + s;
        return s;
    }

    function injectStyleEl(win) {
        try {
            const doc = win.document;
            if (!doc || doc.getElementById(BW_STYLE_ID)) return;
            const head = doc.head || doc.getElementsByTagName('head')[0] || doc.documentElement;
            if (!head) return;
            const style = doc.createElement('style');
            style.id = BW_STYLE_ID;
            style.textContent = BW_TAG.replace(/^<style[^>]*>/, '').replace(/<\/style>$/, '');
            head.appendChild(style);
        } catch (e) { /* ignore */ }
    }

    const _open = window.open.bind(window);
    window.open = function (url, name, features) {
        const win = _open(url, name, features);
        if (win && (!url || url === '' || url === 'about:blank')) {
            try {
                // Patch this popup's write/writeln so the grayscale rule is baked
                // into whatever HTML the generator writes (guaranteed before print).
                const d = win.document;
                if (d && !d.__dacsBwWrap) {
                    d.__dacsBwWrap = true;
                    const _w = d.write.bind(d), _wl = d.writeln.bind(d);
                    d.write   = function (m) { return _w(withBw(m)); };
                    d.writeln = function (m) { return _wl(withBw(m)); };
                }
            } catch (e) { /* ignore */ }
            // Belt-and-suspenders for popups that set innerHTML/srcdoc instead.
            setTimeout(() => injectStyleEl(win), 60);
            setTimeout(() => injectStyleEl(win), 300);
        }
        return win;
    };
})();

/**
 * Standardized print header for all DAC's admin documents.
 *
 * @param {string} [docTitle]    – Document type label  (e.g. "Weekly Billing Report")
 * @param {string} [docSubtitle] – Secondary descriptor (e.g. "Generated: May 5, 2026")
 * @returns {string} Inline-styled HTML string ready to embed in any print window.
 */
window.dacsPrintHeader = function(docTitle, docSubtitle) {
    const logoUrl = window.location.origin + '/assets/images/DACS-TRANSPARENT.png';
    const rightCol = docTitle
        ? `<div style="text-align:right;flex-shrink:0;min-width:160px;">
    <div style="font-size:13px;font-weight:700;color:#1a5c3a;text-transform:uppercase;letter-spacing:0.05em;">${docTitle}</div>
    ${docSubtitle ? `<div style="font-size:11px;color:#9ca3af;margin-top:4px;line-height:1.5;">${docSubtitle}</div>` : ''}
  </div>`
        : '';
    return `<div style="display:flex;align-items:center;gap:18px;padding-bottom:14px;border-bottom:3px solid #1a5c3a;margin-bottom:22px;">
  <img src="${logoUrl}" alt="DAC's Logo" style="height:64px;width:auto;object-fit:contain;flex-shrink:0;" onerror="this.style.display='none'">
  <div style="flex:1;">
    <div style="font-size:16px;font-weight:800;color:#1a1a2e;letter-spacing:0.06em;text-transform:uppercase;">DAC'S BUILDING DESIGN SERVICES</div>
    <div style="font-size:11px;color:#6b7280;margin-top:3px;">Professional Building Design &amp; Construction Management</div>
  </div>
  ${rightCol}
</div>`;
};

/**
 * ONE shared, formal letterhead-style AGREEMENT PDF used by every agreement /
 * terms-and-conditions document across the whole app, so they all look identical.
 * Opens a print window and auto-prints.
 *
 * opts = {
 *   title,            // e.g. "Project Partnership Agreement"
 *   subtitle,         // e.g. "Cost-Plus Terms & Conditions"
 *   ref,              // reference no. (optional)
 *   preamble,         // opening legal paragraph (HTML-safe text)
 *   parties,          // [{label, value}, ...] — the metadata grid
 *   sections,         // [{heading, body}, ...] — the T&C clauses
 *   signature,        // typed/printed name
 *   signatureImage,   // drawn signature image URL (optional)
 *   dateStr,          // formatted date/time signed
 *   signerLabel,      // e.g. "Client" or "Partner"
 *   ip,               // optional IP note
 *   footerNote,       // optional closing line
 * }
 */
// Build the agreement document HTML. Pass noPrint:true to omit the auto-print
// script — used to EMBED the document (iframe srcdoc) in the partner signing
// stepper instead of opening a print window.
window.dacsAgreementHtml = function(opts) {
    const o = opts || {};
    const esc = s => String(s == null ? '' : s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const logo = window.location.origin + '/assets/images/DACS-TRANSPARENT.png';

    // (Uploaded-PDF agreements never reach this HTML builder — dacsAgreementPdf
    // routes them to dacsAgreementViewSigned: one native PDF tab containing the
    // agreement pages + the signature certificate as the last page.)
    const parties = (o.parties || []).map(p =>
        `<div><b>${esc(p.label)}:</b> ${esc(p.value)}</div>`).join('');
    const sections = (o.sections || []).map(s =>
        `<h2>${esc(s.heading)}</h2><div class="body">${esc(s.body)}</div>`).join('');
    const signerLabel = esc(o.signerLabel || 'Client');
    const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>' + esc(o.title || 'Agreement') + '</title>'
      + '<style>'
      + '*{box-sizing:border-box;margin:0;padding:0}'
      + 'body{font-family:"Georgia","Times New Roman",serif;color:#20242e;background:#e9eaee;padding:26px;font-size:13px;line-height:1.75;}'
      + '.page{width:210mm;min-height:297mm;margin:0 auto;background:#fff;padding:30mm 26mm;box-shadow:0 4px 26px rgba(0,0,0,.14);position:relative;}'
      + '.wm{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;}'
      + '.wm img{width:360px;opacity:.05;}'
      + '.lh{display:flex;flex-direction:column;align-items:center;text-align:center;border-bottom:2.5px solid #0f5d3d;padding-bottom:16px;margin-bottom:24px;position:relative;}'
      + '.lh img{height:66px;margin-bottom:8px;}'
      + '.lh .co{font-size:19px;font-weight:700;letter-spacing:.3px;color:#111827;}'
      + '.lh .tag{font-size:10.5px;letter-spacing:3px;text-transform:uppercase;color:#0f5d3d;margin-top:2px;}'
      + '.title{text-align:center;font-size:20px;font-weight:700;letter-spacing:.5px;margin:6px 0 4px;}'
      + '.refline{text-align:center;font-size:11px;color:#6b7280;letter-spacing:1px;text-transform:uppercase;margin-bottom:26px;}'
      + '.preamble{margin-bottom:20px;text-align:justify;}'
      + '.parties{display:grid;grid-template-columns:1fr 1fr;gap:6px 30px;margin:0 0 22px;font-size:12.5px;border:1px solid #e5e7eb;border-radius:8px;padding:14px 18px;background:#fafbfc;}'
      + '.parties b{color:#374151;}'
      + 'h2{font-size:13.5px;font-weight:700;margin:20px 0 7px;color:#0f5d3d;text-transform:uppercase;letter-spacing:.6px;}'
      + '.body{white-space:pre-wrap;text-align:justify;color:#2b2f39;}'
      + '.exec{margin-top:26px;font-size:12.5px;color:#374151;}'
      + '.sign-block{margin-top:46px;display:grid;grid-template-columns:1fr 1fr;gap:56px;align-items:end;}'
      + '.sign-col{display:flex;flex-direction:column;justify-content:flex-end;min-height:104px;}'
      + '.sig-img{max-width:100%;max-height:66px;object-fit:contain;align-self:flex-start;margin-bottom:2px;}'
      + '.sig-line{border-bottom:1.4px solid #111;padding-bottom:5px;font-family:Georgia,serif;font-style:italic;font-size:21px;min-height:34px;}'
      + '.sig-lbl{font-size:10.5px;color:#6b7280;margin-top:7px;text-transform:uppercase;letter-spacing:1px;}'
      + '.foot{margin-top:40px;border-top:1px dashed #cfd3da;padding-top:12px;font-size:10.5px;color:#9aa0ab;text-align:center;}'
      + '.dl-bar{position:fixed;top:0;left:0;right:0;z-index:50;display:flex;gap:8px;justify-content:flex-end;align-items:center;flex-wrap:wrap;padding:10px 16px;background:#fff;border-bottom:1px solid #e5e7eb;box-shadow:0 2px 10px rgba(0,0,0,.06);}'
      + 'body.has-bar{padding-top:88px;}'
      + '.dl-btn{display:inline-flex;align-items:center;gap:7px;padding:11px 18px;border:none;border-radius:10px;background:#0f5d3d;color:#fff;font-family:Arial,sans-serif;font-size:13.5px;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(15,93,61,.35);}'
      + '.dl-btn.alt{background:#fff;color:#0f5d3d;border:1.5px solid #0f5d3d;box-shadow:none;}'
      + '@media print{body{background:#fff;padding:0!important;}.page{box-shadow:none;margin:0;width:auto;min-height:auto;padding:18mm 16mm;}.dl-bar{display:none!important;}}'
      + '</style></head><body' + (o.noPrint ? '' : ' class="has-bar"') + '>'
      + (o.noPrint ? '' :
          '<div class="dl-bar">'
        + (o.docLinkUrl ? '<button class="dl-btn alt" onclick="window.open(\'' + esc(o.docLinkUrl) + '\',\'_blank\')">&#128196; Open Agreement PDF</button>' : '')
        + '<button class="dl-btn" onclick="try{window.opener._dacsAgrDl();}catch(e){window.print();}">&#11015;&#65039; Download PDF</button>'
        + '<button class="dl-btn alt" onclick="window.print()">&#128424; Print</button>'
        + '</div>')
      + '<div class="page">'
      + '<div class="wm"><img src="' + logo + '" onerror="this.style.display=\'none\'"></div>'
      + '<div class="lh"><img src="' + logo + '" onerror="this.style.display=\'none\'"><div class="co">DAC’s Building Design Services</div><div class="tag">Building Design &amp; Project Management</div></div>'
      + '<div class="title">' + esc(o.title || 'Agreement') + '</div>'
      + '<div class="refline">' + (o.ref ? 'Ref. ' + esc(o.ref) + ' &nbsp;·&nbsp; ' : '') + esc(o.subtitle || '') + '</div>'
      + (o.preamble ? '<div class="preamble">' + esc(o.preamble) + '</div>' : '')
      + (parties ? '<div class="parties">' + parties + '</div>' : '')
      + sections
      + '<div class="exec"><b>IN WITNESS WHEREOF,</b> the ' + signerLabel + ' has electronically signed this document on the date and time indicated below.</div>'
      + '<div class="sign-block"><div class="sign-col">' + (o.signatureImage ? '<img class="sig-img" src="' + esc(o.signatureImage) + '" alt="signature"/>' : '') + '<div class="sig-line">' + esc(o.signature || '') + '</div><div class="sig-lbl">' + signerLabel + ' — Signature over Printed Name</div></div>'
      + '<div class="sign-col"><img class="sig-img" src="' + window.location.origin + '/assets/images/dacs-signature.png" alt="" onerror="this.style.display=\'none\'" style="align-self:center;margin:0 auto 2px;"/><div class="sig-line"></div><div class="sig-lbl">DAC’s Building Design Services — Authorized Representative</div></div></div>'
      + '<div class="sign-block" style="margin-top:20px;"><div class="sign-col" style="min-height:auto;"><div class="sig-line">' + esc(o.dateStr || '') + '</div><div class="sig-lbl">Date &amp; Time Signed</div></div><div></div></div>'
      + '<div class="foot">' + (o.footerNote ? esc(o.footerNote) + ' ' : 'This document was electronically executed and is legally retained by DAC’s Building Design Services. ') + (o.ip ? 'Signed from IP ' + esc(o.ip) + '. ' : '') + 'A binding confirmation equivalent to a written signature.</div>'
      + '</div>'
      + '</body></html>';
    return html;
};

window.dacsAgreementPdf = function(opts) {
    // Uploaded-PDF agreements: show ONE native PDF tab (agreement + certificate
    // page) instead of a wrapper page — nothing custom to clutter the viewer.
    if (opts && opts.pdfEmbedUrl) return window.dacsAgreementViewSigned(opts);
    // Remember the document so the popup's "Download PDF" button can hand it
    // back to dacsAgreementDownloadPdf (a REAL file download via jsPDF — the
    // print dialog is unreliable for saving: it defaults to the last printer).
    window._dacsLastAgrOpts = opts;
    window._dacsAgrDl = function () { window.dacsAgreementDownloadPdf(window._dacsLastAgrOpts); };
    const html = window.dacsAgreementHtml(opts);
    const w = window.open('', '_blank', 'width=900,height=1160');
    if (!w) { alert('Please allow pop-ups to open the agreement.'); return; }
    w.document.write(html);
    w.document.close();
};

// Lazy-load pdf-lib (for merging the signed agreement PDF + certificate page).
function _dacsEnsurePdfLib() {
    return new Promise((resolve, reject) => {
        if (window.PDFLib && window.PDFLib.PDFDocument) return resolve(window.PDFLib);
        const s = document.createElement('script');
        s.src = 'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js';
        s.onload = () => (window.PDFLib && window.PDFLib.PDFDocument) ? resolve(window.PDFLib) : reject(new Error('pdf-lib failed to initialise'));
        s.onerror = () => reject(new Error('Could not load the PDF merge library'));
        document.head.appendChild(s);
    });
}

// Lazy-load jsPDF (same CDN + pattern as boq-module.js).
function _dacsEnsureJsPDF() {
    return new Promise((resolve, reject) => {
        if (window.jspdf && window.jspdf.jsPDF) return resolve(window.jspdf.jsPDF);
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        s.onload = () => (window.jspdf && window.jspdf.jsPDF) ? resolve(window.jspdf.jsPDF) : reject(new Error('jsPDF failed to initialise'));
        s.onerror = () => reject(new Error('Could not load the PDF library (offline?)'));
        document.head.appendChild(s);
    });
}

// Best-effort image URL → dataURL (for the drawn signature / logo).
async function _dacsImgDataUrl(url) {
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const blob = await res.blob();
        return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.onerror = () => r(null); fr.readAsDataURL(blob); });
    } catch (_) { return null; }
}

// Build the letterhead document/certificate as a jsPDF doc (shared by the
// download and the signed-PDF viewer). Throws if the library can't load.
async function _dacsAgrCertDoc(o) {
    const jsPDF = await _dacsEnsureJsPDF();

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = 210, ML = 20, MR = 20, CW = W - ML - MR;   // content width 170mm
    const BOTTOM = 277;
    let y = 18;
    const guard = (need) => { if (y + (need || 0) > BOTTOM) { doc.addPage(); y = 18; } };
    const writeWrapped = (text, size, style, color, lineH, extraGapAfter) => {
        doc.setFont('times', style || 'normal'); doc.setFontSize(size);
        doc.setTextColor(color[0], color[1], color[2]);
        // honour explicit blank lines (pre-wrap bodies like Partnership §8)
        String(text || '').split('\n').forEach(par => {
            if (!par.trim()) { y += lineH * 0.7; return; }
            doc.splitTextToSize(par, CW).forEach(line => { guard(lineH); doc.text(line, ML, y); y += lineH; });
        });
        y += (extraGapAfter || 0);
    };

    // Letterhead: logo (best-effort) + company + tagline + green rule
    const logo = await _dacsImgDataUrl(window.location.origin + '/assets/images/DACS-TRANSPARENT.png');
    if (logo) { try { doc.addImage(logo, 'PNG', W / 2 - 11, y, 22, 22); y += 25; } catch (_) { y += 2; } }
    doc.setFont('times', 'bold'); doc.setFontSize(15); doc.setTextColor(17, 24, 39);
    doc.text('DAC’s Building Design Services', W / 2, y, { align: 'center' }); y += 5.5;
    doc.setFont('times', 'normal'); doc.setFontSize(8); doc.setTextColor(15, 93, 61);
    doc.text('B U I L D I N G   D E S I G N   &   P R O J E C T   M A N A G E M E N T', W / 2, y, { align: 'center' }); y += 4;
    doc.setDrawColor(15, 93, 61); doc.setLineWidth(0.8); doc.line(ML, y, W - MR, y); y += 9;

    // Title + ref line
    doc.setFont('times', 'bold'); doc.setFontSize(14); doc.setTextColor(17, 24, 39);
    doc.text(String(o.title || 'Agreement'), W / 2, y, { align: 'center' }); y += 6;
    const refline = (o.ref ? 'Ref. ' + o.ref + '   ·   ' : '') + (o.subtitle || '');
    if (refline.trim()) { doc.setFont('times', 'normal'); doc.setFontSize(8.5); doc.setTextColor(107, 114, 128); doc.text(refline.toUpperCase(), W / 2, y, { align: 'center' }); }
    y += 9;

    if (o.preamble) writeWrapped(o.preamble, 10, 'normal', [32, 36, 46], 4.6, 3);

    // Parties box (two columns)
    const parties = o.parties || [];
    if (parties.length) {
        const rows = Math.ceil(parties.length / 2);
        const boxH = rows * 5.6 + 7;
        guard(boxH + 4);
        doc.setDrawColor(229, 231, 235); doc.setFillColor(250, 251, 252); doc.setLineWidth(0.3);
        doc.roundedRect(ML, y, CW, boxH, 2, 2, 'FD');
        doc.setFontSize(9.5);
        parties.forEach((p2, i) => {
            const col = i % 2, row = Math.floor(i / 2);
            const px = ML + 5 + col * (CW / 2), py = y + 6.5 + row * 5.6;
            doc.setFont('times', 'bold'); doc.setTextColor(55, 65, 81);
            const lbl = String(p2.label || '') + ': ';
            doc.text(lbl, px, py);
            doc.setFont('times', 'normal'); doc.setTextColor(32, 36, 46);
            doc.text(String(p2.value || ''), px + doc.getTextWidth(lbl) + 1, py);
        });
        y += boxH + 7;
    }

    // Sections
    (o.sections || []).forEach(s => {
        guard(16);   // keep heading with at least a couple of body lines
        doc.setFont('times', 'bold'); doc.setFontSize(10.5); doc.setTextColor(15, 93, 61);
        doc.text(String(s.heading || '').toUpperCase(), ML, y); y += 5.2;
        writeWrapped(s.body, 10, 'normal', [43, 47, 57], 4.6, 4);
    });

    // Execution + signature block
    guard(52);
    y += 3;
    const signerLabel = String(o.signerLabel || 'Client');
    writeWrapped('IN WITNESS WHEREOF, the ' + signerLabel + ' has electronically signed this document on the date and time indicated below.', 9.5, 'normal', [55, 65, 81], 4.4, 8);
    guard(58);
    const colW = (CW - 16) / 2, x1 = ML, x2 = ML + colW + 16;
    let sigY = y + 22;
    if (o.signatureImage) {
        const sig = await _dacsImgDataUrl(o.signatureImage);
        if (sig) { try { doc.addImage(sig, 'PNG', x1, sigY - 20, 46, 17); } catch (_) {} }
    }
    // Company countersignature (assets/images/dacs-signature.png; skipped if
    // absent) — centered over the company column's line.
    const compSig = await _dacsImgDataUrl(window.location.origin + '/assets/images/dacs-signature.png');
    if (compSig) { try { doc.addImage(compSig, 'PNG', x2 + (colW - 34) / 2, sigY - 16, 34, 13); } catch (_) {} }
    doc.setFont('times', 'italic'); doc.setFontSize(13); doc.setTextColor(17, 24, 39);
    doc.text(String(o.signature || ''), x1, sigY - 1);
    doc.setDrawColor(17, 17, 17); doc.setLineWidth(0.4);
    doc.line(x1, sigY + 1, x1 + colW, sigY + 1); doc.line(x2, sigY + 1, x2 + colW, sigY + 1);
    doc.setFont('times', 'normal'); doc.setFontSize(7.5); doc.setTextColor(107, 114, 128);
    doc.text(signerLabel.toUpperCase() + ' — SIGNATURE OVER PRINTED NAME', x1, sigY + 5.5);
    doc.text('DAC’S BUILDING DESIGN SERVICES — AUTHORIZED REPRESENTATIVE', x2, sigY + 5.5);
    // Date line on its own row below the two signatures
    let dateY = sigY + 20;
    doc.setFont('times', 'italic'); doc.setFontSize(13); doc.setTextColor(17, 24, 39);
    doc.text(String(o.dateStr || ''), x1, dateY - 1);
    doc.setDrawColor(17, 17, 17); doc.line(x1, dateY + 1, x1 + colW, dateY + 1);
    doc.setFont('times', 'normal'); doc.setFontSize(7.5); doc.setTextColor(107, 114, 128);
    doc.text('DATE & TIME SIGNED', x1, dateY + 5.5);
    y = dateY + 12;

    // Footer note
    guard(12);
    doc.setDrawColor(207, 211, 218); doc.setLineDashPattern([1.2, 1.2], 0); doc.line(ML, y, W - MR, y); doc.setLineDashPattern([], 0);
    y += 4.5;
    const foot = (o.footerNote ? o.footerNote + ' ' : 'This document was electronically executed and is legally retained by DAC’s Building Design Services. ')
        + (o.ip ? 'Signed from IP ' + o.ip + '. ' : '') + 'A binding confirmation equivalent to a written signature.';
    doc.setFontSize(7.5);
    doc.splitTextToSize(foot, CW).forEach(line => { doc.text(line, W / 2, y, { align: 'center' }); y += 3.6; });

    const fname = (String(o.title || 'Agreement') + (o.signature ? ' - ' + o.signature : '') + '.pdf').replace(/[\\/:*?"<>|]+/g, '');
    return { doc, fname };
}

// Lazy-load Mozilla pdf.js (to READ text positions inside the uploaded PDF —
// pdf-lib can only draw, it cannot find where the signature lines are).
function _dacsEnsurePdfJs() {
    return new Promise((resolve, reject) => {
        if (window.pdfjsLib) return resolve(window.pdfjsLib);
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
        s.onload = () => {
            if (!window.pdfjsLib) return reject(new Error('pdf.js failed to initialise'));
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            resolve(window.pdfjsLib);
        };
        s.onerror = () => reject(new Error('Could not load the PDF text reader'));
        document.head.appendChild(s);
    });
}

// Render a PDF's pages as clean white CANVASES inside a container — looks
// like a document on paper (no dark viewer chrome, no iframe toolbar).
// Used by the signing screens for uploaded-PDF agreements.
window.dacsRenderPdfInto = async function (container, url) {
    const pdfjs = await _dacsEnsurePdfJs();
    const doc = await pdfjs.getDocument({ url }).promise;
    container.innerHTML = '';
    const cssWidth = container.clientWidth || 700;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: (cssWidth / base.width) * dpr });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(vp.width);
        canvas.height = Math.round(vp.height);
        canvas.style.width = '100%';
        canvas.style.display = 'block';
        if (p > 1) { canvas.style.borderTop = '1px dashed #e5e7eb'; canvas.style.marginTop = '14px'; canvas.style.paddingTop = '14px'; }
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        container.appendChild(canvas);
        try { page.cleanup(); } catch (_) {}
    }
    try { doc.destroy(); } catch (_) {}
};

// Extract the SECTION TEXT of an uploaded agreement PDF (numbered headings +
// their paragraphs), so the signing screens can render it in the elegant
// paper design instead of showing raw PDF pages. Letterhead, title, parties
// blanks, signature lines and footer are skipped — the paper design
// regenerates those (filled in). Cached per URL.
window._dacsAgrSecCache = {};
window.dacsAgrPdfSections = async function (url) {
    if (window._dacsAgrSecCache[url]) return window._dacsAgrSecCache[url];
    const bytes = await (await fetch(url)).arrayBuffer();
    const lines = await _dacsScanPdfLines(bytes);
    lines.sort((a, b) => (a.page - b.page) || (b.y - a.y));   // reading order
    const secs = [];
    let cur = null;
    const isDrop = (s) =>
        /^_+$/.test(s)
        || (/_{3,}/.test(s) && s.replace(/_/g, '').trim().length < 8)
        || /SIGNATURE\s*OVER\s*PRINTED|DATE\s*&?\s*TIME\s*SIGNED|AUTHORIZED\s*REPRESENTATIVE|SIGNED\s+ELECTRONICALLY/i.test(s)
        || /^(Partner|Client|Company|Project|Start\s*Date|Contract\s*Value)\s*:/i.test(s)
        || /electronically\s+executed\s+and\s+is\s+legally\s+retained/i.test(s)
        || /BUILDING\s+DESIGN\s+&\s+PROJECT\s+MANAGEMENT/i.test(s);
    lines.forEach(L => {
        const s = L.raw.replace(/\s+/g, ' ').trim();
        if (!s || isDrop(s)) return;
        if (/^\d{1,2}\.\s+\S/.test(s) && s.length < 90) {     // numbered heading
            cur = { heading: s, body: '' };
            secs.push(cur);
            return;
        }
        if (!cur) return;    // title/preamble before first heading → regenerated by the paper design
        if (/IN\s+WITNESS\s+WHEREOF/i.test(s)) { cur = null; return; }   // end of body text
        if (/^\([a-z]\)\s/i.test(s) && cur.body) cur.body += '\n\n' + s; // keep (a)/(b) paragraph breaks
        else cur.body += (cur.body ? ' ' : '') + s;
    });
    if (secs.length) window._dacsAgrSecCache[url] = secs;
    return secs;
};

// Scan the PDF's text into LINES with per-character x positions, so labels
// that share one row (e.g. "PARTNER — SIGNATURE…" and "DATE & TIME SIGNED"
// side by side) each get their own precise anchor x.
// Each line: { page (0-based), y, raw, xAt(charIdx) }.
async function _dacsScanPdfLines(bytes) {
    const pdfjs = await _dacsEnsurePdfJs();
    const doc = await pdfjs.getDocument({ data: bytes.slice(0) }).promise;   // slice: pdf.js consumes the buffer
    const lines = [];
    for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const tc = await page.getTextContent();
        const rows = new Map();   // rounded y → parts
        tc.items.forEach(it => {
            if (!it.str || !it.str.trim()) return;
            const y = Math.round(it.transform[5]);
            let e = rows.get(y); if (!e) { e = []; rows.set(y, e); }
            e.push({ x: it.transform[4], w: it.width || 0, s: it.str });
        });
        rows.forEach((parts, y) => {
            parts.sort((a, b) => a.x - b.x);
            let raw = '';
            const ranges = [];
            parts.forEach(pt => {
                if (raw) raw += ' ';
                ranges.push({ start: raw.length, end: raw.length + pt.s.length, x: pt.x, w: pt.w, len: pt.s.length });
                raw += pt.s;
            });
            lines.push({
                page: p - 1, y, raw,
                // x of a character index — interpolates inside an item using its width
                xAt(idx) {
                    for (const r of ranges) {
                        if (idx <= r.end) {
                            const off = Math.max(0, idx - r.start);
                            return r.x + (r.len ? (r.w * off / r.len) : 0);
                        }
                    }
                    const last = ranges[ranges.length - 1];
                    return last ? last.x + last.w : 0;
                }
            });
        });
        try { page.cleanup(); } catch (_) {}
    }
    try { doc.destroy(); } catch (_) {}
    return lines;
}

// STAMP the e-signature onto the uploaded agreement PDF itself — ON the
// template's own signature lines (found by anchor text). The name and drawn
// signature land above "PARTNER — SIGNATURE OVER PRINTED NAME", the date
// above "DATE & TIME SIGNED", the company signature above "AUTHORIZED
// REPRESENTATIVE" (if the template has one). If no anchors are found, falls
// back to a signature block at the bottom of the last page.
async function _dacsAgrStampBlob(o) {
    const PDFLib = await _dacsEnsurePdfLib();
    const bytes = await (await fetch(o.pdfEmbedUrl)).arrayBuffer();
    let lines = [];
    try { lines = await _dacsScanPdfLines(bytes); } catch (e) { console.warn('Text scan failed (using fallback position):', e.message || e); }

    // Anchor labels — the LAST match in the document wins (signature blocks
    // live at the end); each gets its own x even when labels share a row.
    const findLast = (re) => {
        let hit = null;
        lines.forEach(L => { const m = L.raw.match(re); if (m) hit = { page: L.page, y: L.y, x: L.xAt(m.index) }; });
        return hit;
    };
    const findLastSpan = (re) => {
        let hit = null;
        lines.forEach(L => {
            const m = L.raw.match(re);
            if (m) hit = { page: L.page, y: L.y, x: L.xAt(m.index), xEnd: L.xAt(m.index + m[0].length) };
        });
        return hit;
    };
    const anchors = {
        signer : findLast(/(PARTNER|CLIENT)?\s*[—–-]*\s*SIGNATURE\s*OVER\s*PRINTED/i),
        date   : findLast(/DATE\s*&?\s*(AND\s*)?TIME\s*SIGNED/i),
        company: findLastSpan(/AUTHORIZED\s*REPRESENTATIVE/i)
    };

    const pdf = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
    const pages = pdf.getPages();
    const fontIt = await pdf.embedFont(PDFLib.StandardFonts.TimesRomanItalic);
    const fontSm = await pdf.embedFont(PDFLib.StandardFonts.Helvetica);
    const ink  = PDFLib.rgb(0.07, 0.09, 0.15);
    const gray = PDFLib.rgb(0.42, 0.45, 0.50);

    let sigImg = null;
    if (o.signatureImage) {
        try {
            const sb = await (await fetch(o.signatureImage)).arrayBuffer();
            try { sigImg = await pdf.embedPng(sb); } catch (_) { sigImg = await pdf.embedJpg(sb); }
        } catch (_) { sigImg = null; }
    }
    let compImg = null;
    try {
        const cb = await (await fetch(window.location.origin + '/assets/images/dacs-signature.png')).arrayBuffer();
        compImg = await pdf.embedPng(cb);
    } catch (_) { compImg = null; }

    // ── Fill the template's detail blanks ("Partner: ____", "Project: ____",
    // "Start Date: ____", "Contract Value: ____") — first match wins.
    (o.fillFields || []).forEach(f => {
        if (!f || !f.value) return;
        const re = new RegExp(String(f.label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:', 'i');
        for (const L of lines) {
            const m = L.raw.match(re);
            if (!m) continue;
            const pg = pages[L.page];
            if (pg) pg.drawText(String(f.value), {
                x: L.xAt(m.index + m[0].length) + 6, y: L.y + 1.5, size: 10.5, font: fontIt, color: ink
            });
            break;
        }
    });

    // ── Fill the PREAMBLE blanks:
    //   "entered into on ________"          → the signing date
    //   "________ (the “Partner/Client”)"   → the signer's name
    const dayOnly = String(o.dateStr || '').split(' at ')[0];
    [
        { re: /entered\s+into\s+on\s*_+/i,                     value: dayOnly },
        { re: /_+\s*\(\s*the\s*[“”"']*\s*(Partner|Client)/i,   value: String(o.signature || '') }
    ].forEach(f => {
        if (!f.value) return;
        for (const L of lines) {
            const m = L.raw.match(f.re);
            if (!m) continue;
            const uIdx = m.index + m[0].search(/_/);   // start of the underscore run
            const pg = pages[L.page];
            if (pg) pg.drawText(f.value, { x: L.xAt(uIdx) + 4, y: L.y + 1.5, size: 10.5, font: fontIt, color: ink });
            break;
        }
    });

    if (anchors.signer && pages[anchors.signer.page]) {
        // ── On the template's own signature lines ───────────────────────────
        const sp = pages[anchors.signer.page];
        const a  = anchors.signer;
        sp.drawText(String(o.signature || ''), { x: a.x + 4, y: a.y + 16, size: 13, font: fontIt, color: ink });
        if (sigImg) {
            // The drawn scrawl sits over the typed name, like ink on a real
            // contract — kept low so it can't collide with the text above.
            const s = Math.min(110 / sigImg.width, 26 / sigImg.height, 1);
            sp.drawImage(sigImg, { x: a.x + 34, y: a.y + 18, width: sigImg.width * s, height: sigImg.height * s });
        }
        const note = 'SIGNED ELECTRONICALLY' + (o.ip ? ' · IP ' + String(o.ip) : '');
        sp.drawText(note, { x: a.x, y: a.y - 9, size: 5.8, font: fontSm, color: gray });

        if (anchors.date && pages[anchors.date.page]) {
            pages[anchors.date.page].drawText(String(o.dateStr || ''), {
                x: anchors.date.x + 4, y: anchors.date.y + 16, size: 11.5, font: fontIt, color: ink
            });
        }
        if (anchors.company && pages[anchors.company.page] && compImg) {
            const c2 = Math.min(110 / compImg.width, 26 / compImg.height, 1);
            const cw = compImg.width * c2;
            // centered over the label's span
            const spanW = Math.max(0, (anchors.company.xEnd || anchors.company.x) - anchors.company.x);
            pages[anchors.company.page].drawImage(compImg, {
                x: anchors.company.x + Math.max(0, (spanW - cw) / 2), y: anchors.company.y + 18, width: cw, height: compImg.height * c2
            });
        }
    } else {
        // ── Fallback: bottom of the last page ───────────────────────────────
        const page = pages[pages.length - 1];
        const width = page.getSize().width;
        const yBase = 58, colW = 175, leftX = 58;
        const rightX = Math.max(width / 2 + 24, width - colW - 58);
        if (sigImg) {
            const s = Math.min(130 / sigImg.width, 40 / sigImg.height, 1);
            page.drawImage(sigImg, { x: leftX, y: yBase + 24, width: sigImg.width * s, height: sigImg.height * s });
        }
        page.drawText(String(o.signature || ''), { x: leftX, y: yBase + 11, size: 14, font: fontIt, color: ink });
        page.drawLine({ start: { x: leftX, y: yBase + 7 }, end: { x: leftX + colW, y: yBase + 7 }, thickness: 0.8, color: ink });
        page.drawText(String(o.signerLabel || 'Partner').toUpperCase() + ' — SIGNED ELECTRONICALLY' + (o.dateStr ? ' · ' + String(o.dateStr).toUpperCase() : ''),
            { x: leftX, y: yBase - 3, size: 6.5, font: fontSm, color: gray });
        if (o.ip) page.drawText('IP ' + String(o.ip), { x: leftX, y: yBase - 12, size: 6, font: fontSm, color: gray });
        if (compImg) {
            const c2 = Math.min(110 / compImg.width, 34 / compImg.height, 1);
            const cw = compImg.width * c2;
            page.drawImage(compImg, { x: rightX + Math.max(0, (colW - cw) / 2), y: yBase + 24, width: cw, height: compImg.height * c2 });
        }
        page.drawLine({ start: { x: rightX, y: yBase + 7 }, end: { x: rightX + colW, y: yBase + 7 }, thickness: 0.8, color: ink });
        page.drawText('DAC’S BUILDING DESIGN SERVICES — AUTHORIZED REPRESENTATIVE',
            { x: rightX, y: yBase - 3, size: 6.5, font: fontSm, color: gray });
    }

    return new Blob([await pdf.save()], { type: 'application/pdf' });
}

// TRUE one-click download of the agreement as a PDF file. For uploaded-PDF
// agreements (opts.pdfEmbedUrl) the file is the document ITSELF with the
// signature stamped onto its last page — nothing else added.
window.dacsAgreementDownloadPdf = async function (opts) {
    const o = opts || {};
    if (o.pdfEmbedUrl) {
        const fname = (String(o.title || 'Agreement') + (o.signature ? ' - ' + o.signature : '') + ' (signed).pdf').replace(/[\\/:*?"<>|]+/g, '');
        try {
            const blob = await _dacsAgrStampBlob(o);
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob); a.download = fname;
            document.body.appendChild(a); a.click();
            setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
        } catch (e) {
            console.warn('Signature stamping failed — opening the raw document instead:', e.message || e);
            window.open(o.pdfEmbedUrl, '_blank');
        }
        return;
    }
    let built;
    try { built = await _dacsAgrCertDoc(o); }
    catch (e) { alert(e.message || 'PDF library unavailable.'); return; }
    built.doc.save(built.fname);
};

// View a signed uploaded-PDF agreement: opens ONE native browser PDF tab
// showing the document itself with the signature stamped on its last page.
// Unsigned review copies open the raw document unstamped.
window.dacsAgreementViewSigned = async function (opts) {
    const o = opts || {};
    const w = window.open('', '_blank');
    if (!w) { alert('Please allow pop-ups to open the agreement.'); return; }
    try {
        w.document.write('<title>' + String(o.title || 'Agreement').replace(/</g, '&lt;') + '</title>'
            + '<body style="font-family:Arial,sans-serif;padding:44px;color:#374151;font-size:15px;">Preparing the signed document…</body>');
        w.document.close();
    } catch (_) {}
    if (o.unsigned || (!o.signature && !o.signatureImage)) {
        try { w.location.href = o.pdfEmbedUrl; } catch (_) {}
        return;
    }
    try {
        const blob = await _dacsAgrStampBlob(o);
        w.location.href = URL.createObjectURL(blob);
    } catch (e) {
        console.warn('Signature stamping failed — opening the raw document:', e.message || e);
        try { w.location.href = o.pdfEmbedUrl; } catch (_) {}
    }
};

// ── Editable agreement templates (versioned) ────────────────────────────────
// The section text of the two canonical documents below is the STANDARD text.
// Admins can edit it in User Navigator → "Agreements": edits are saved to
// settings/agreementDoc_client + settings/agreementDoc_partner as a NEW
// version with the previous versions kept in `history`. Signing records the
// version signed (profiles.*_doc_version + agreement_events.doc_version), and
// every reprint renders the SIGNED version's text — editing the template
// never rewrites an already-signed document.
window._dacsAgrTpl = null;   // { client:{sections,version,history}, partner:{...} }

window.dacsLoadAgreementTemplates = async function (force) {
    if (window._dacsAgrTpl && !force) return window._dacsAgrTpl;
    const out = { client: { sections: null, version: 1, history: [] },
                  partner: { sections: null, version: 1, history: [] } };
    try {
        if (typeof db !== 'undefined') {
            const [c, p] = await Promise.all([
                db.collection('settings').doc('agreementDoc_client').get().catch(() => null),
                db.collection('settings').doc('agreementDoc_partner').get().catch(() => null)
            ]);
            const read = (snap, k) => {
                const d = snap && snap.exists ? snap.data() : null;
                if (!d) return;
                if (d.mode === 'pdf' && d.pdfUrl) {
                    out[k] = { mode: 'pdf', pdfUrl: d.pdfUrl, pdfName: d.pdfName || 'Agreement.pdf',
                               sections: null, version: d.version || 2, history: Array.isArray(d.history) ? d.history : [] };
                } else if (Array.isArray(d.sections) && d.sections.length) {
                    out[k] = { mode: 'sections', sections: d.sections, version: d.version || 2,
                               history: Array.isArray(d.history) ? d.history : [] };
                }
            };
            read(c, 'client'); read(p, 'partner');
        }
    } catch (e) { console.warn('Agreement templates load failed (using standard text):', e.message || e); }
    window._dacsAgrTpl = out;
    return out;
};

// Current template for a document kind ('client' | 'partner').
// mode 'sections' → editable/standard text; mode 'pdf' → admin-uploaded PDF.
window.dacsAgrTemplate = function (kind) {
    const t = (window._dacsAgrTpl && window._dacsAgrTpl[kind]) || {};
    if (t.mode === 'pdf' && t.pdfUrl)
        return { mode: 'pdf', pdfUrl: t.pdfUrl, pdfName: t.pdfName || 'Agreement.pdf', sections: null, version: t.version || 2 };
    return { mode: 'sections', sections: t.sections || window.DACS_AGR_DEFAULT_SECTIONS[kind], version: t.sections ? (t.version || 2) : 1 };
};

// The document of a SPECIFIC signed version (for reprints). Version 1 = the
// standard hardcoded text; later versions come from the settings history.
// Returns { mode, sections?, pdfUrl?, pdfName? }; falls back to the current
// template when the version can't be resolved.
window.dacsAgrVersionDoc = function (kind, version) {
    const cur = window.dacsAgrTemplate(kind);
    if (!version || version === cur.version) return cur;   // legacy signature or current
    if (version <= 1) return { mode: 'sections', sections: window.DACS_AGR_DEFAULT_SECTIONS[kind], version: 1 };
    const t = (window._dacsAgrTpl && window._dacsAgrTpl[kind]) || {};
    const h = (t.history || []).find(x => x && x.version === version);
    if (h && h.mode === 'pdf' && h.pdfUrl) return { mode: 'pdf', pdfUrl: h.pdfUrl, pdfName: h.pdfName || 'Agreement.pdf', version };
    if (h && Array.isArray(h.sections) && h.sections.length) return { mode: 'sections', sections: h.sections, version };
    return cur;
};

// Back-compat wrapper: sections of a signed version (null when that version
// is an uploaded PDF — callers then handle pdf-mode via dacsAgrVersionDoc).
window.dacsAgrVersionSections = function (kind, version) {
    const d = window.dacsAgrVersionDoc(kind, version);
    return d.mode === 'pdf' ? null : d.sections;
};

// ── Cost-Plus CLIENT Agreement — the ONE canonical document definition ──────
// Used by: the client portal's first-login agreement modal (Client
// Management.html — sections rendered from here), the client's signed-PDF
// download (client-management-app.js), and the admin's Agreement print
// (user-navigator.js). Section TEXT is the v1 standard — current text may be
// admin-edited (see dacsLoadAgreementTemplates above).
window.dacsClientAgreementDoc = function(clientName, proj, dayStr, sectionsOverride) {
    const p = proj || {};
    const feePct = (p.managementFeePct != null ? p.managementFeePct : 15) + '%';
    return {
        title: 'Cost-Plus Project Management Agreement',
        subtitle: 'Client Agreement',
        preamble: 'This Agreement is entered into on ' + (dayStr || '____________') + ' between DAC’s Building Design Services (the “Manager”) and ' + (clientName || '____________') + ' (the “Client”) for the construction project identified below. By electronically signing this Agreement, the Client acknowledges having read, understood, and voluntarily accepted all terms and conditions herein.',
        parties: [
            { label: 'Client', value: clientName || '—' },
            ...(p.projectName ? [{ label: 'Project', value: p.projectName }] : []),
            ...(p.budget != null ? [{ label: 'Contract Value', value: '₱' + Number(p.budget).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }] : []),
            ...(p.projectName ? [{ label: 'Management Fee', value: feePct + ' on direct costs' }] : []),
            ...(p.startDate ? [{ label: 'Start Date', value: p.startDate }] : []),
            ...(p.plannedEndDate ? [{ label: 'Planned Completion', value: p.plannedEndDate }] : [])
        ],
        sections: sectionsOverride || window.dacsAgrTemplate('client').sections || window.DACS_AGR_DEFAULT_SECTIONS.client,
        signerLabel: 'Client'
    };
};

// ── DAC's Partnership Agreement — the ONE canonical document definition ──────
// Used by: the partner signing stepper (Dacs Partnership.html), the partner's
// own signed-PDF download (client-management-app.js), and the admin's Partner
// Agreement print (user-navigator.js). Edit the terms HERE so what the partner
// reads, signs, and later reprints is always the same document.
window.dacsPartnerAgreementDoc = function(partnerName, proj, dayStr, sectionsOverride) {
    const p = proj || {};
    return {
        title: 'DAC’s Partnership Agreement',
        subtitle: 'Partner Agreement',
        preamble: 'This Agreement is entered into on ' + (dayStr || '____________') + ' between DAC’s Building Design Services (the “Company”) and ' + (partnerName || '____________') + ' (the “Partner”). By electronically signing this Agreement, the Partner acknowledges having read, understood, and voluntarily accepted all terms and conditions herein, including the handling of client collections held in trust for the partnership.',
        parties: [
            { label: 'Partner', value: partnerName || '—' },
            { label: 'Company', value: 'DAC’s Building Design Services' },
            ...(p.projectName ? [{ label: 'Project', value: p.projectName }] : []),
            ...(p.budget != null ? [{ label: 'Contract Value', value: '₱' + Number(p.budget).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }] : []),
            ...(p.startDate ? [{ label: 'Start Date', value: p.startDate }] : []),
            ...(p.plannedEndDate ? [{ label: 'Planned Completion', value: p.plannedEndDate }] : [])
        ],
        sections: sectionsOverride || window.dacsAgrTemplate('partner').sections || window.DACS_AGR_DEFAULT_SECTIONS.partner,
        signerLabel: 'Partner'
    };
};

// ── The STANDARD (v1) section text of both documents ────────────────────────
window.DACS_AGR_DEFAULT_SECTIONS = {
    client: [
        { heading: '1. Parties', body: 'This Cost-Plus Project Management Agreement is between DAC’s Building Design Services (the “Manager”) — responsible for all construction management activities including labor, procurement, and site supervision — and the Client, the registered account holder, responsible for funding all direct costs and the management fee as defined herein. Each project must be formally linked to both a Manager and a Client account within the system; one account may be linked to several projects, and these terms apply to each linked project.' },
        { heading: '2. Scope of Services', body: 'The Manager provides, on behalf of the Client: labor management (adding, assigning, and scheduling workers; tracking daily labor entries and payroll, including fixed-price/pakyaw job contracts); procurement management (recording material requests, supplier canvassing, purchases, delivery status, and quality checks); out source works (engaging and recording third-party supply-and-install packages as their own cost category); and site supervision (monitoring project progress; uploading site reports, images, milestones, and accomplishment reports accessible by the Client).' },
        { heading: '3. Cost-Plus Fee Structure', body: 'This agreement operates under a Cost-Plus model. Direct costs — labor, materials & supplies, and out source (supply & install) works — are recorded daily as individual entries and grouped into weekly (Sunday–Saturday) summaries. The management fee is the percentage agreed for the Client’s project (projects can have different rates, including 0%), automatically computed on each week’s direct costs and displayed on the dashboard and in every billing report. Total weekly amount = direct costs + the management fee at the project’s agreed rate.' },
        { heading: '4. Payment Terms', body: 'The Manager records project costs daily; entries roll into a weekly summary (Sunday–Saturday) visible in the Client’s portal. The Client is notified, and payment for each week’s bill is due by Friday, per the billing schedule shown in the portal. Payment covers labor, materials, out source works, and the management fee at the project’s agreed rate. The Client may pay suppliers directly or fund the system’s revolving fund for petty purchases.' },
        { heading: '5. Revolving Fund', body: 'An optional revolving fund (petty cash) may be established by the Client for minor and urgent site purchases. The system tracks deductions from the fund with receipts as proof, calculates the remaining balance weekly, and prompts the Client to replenish the fund when the balance falls below the required threshold.' },
        { heading: '6. Responsibilities & System Rules', body: 'Quality control: the Manager logs defective materials, and the system records return and replacement actions. Labor: all workers are managed by the Manager, and payroll is funded and approved by the Client. Price variability: material and labor costs are subject to market fluctuations — quoted estimates are not guaranteed fixed prices. Records & privacy: portal views are convenience summaries of the Company’s official electronic records, supporting documents are available on request, and client data is handled in accordance with the Data Privacy Act of 2012 (R.A. 10173); account credentials are personal.' },
        { heading: '7. Termination', body: 'Either party may request early project termination through the system. Upon termination, the system computes the total consumed labor costs, total materials used, and the equivalent management fee; the final payable balance must be settled in full before the project is officially closed. Termination requests are subject to review and confirmation by the Manager.' },
        { heading: '8. Agreement Confirmation', body: 'By accepting this Agreement, the Client confirms having fully read, understood, and voluntarily agreed to all terms and conditions set forth in this Cost-Plus Project Management Agreement with DAC’s Building Design Services. This digital acceptance serves as a binding confirmation equivalent to a written signature.' }
    ],
    partner: [
        { heading: '1. Parties & Status', body: 'The Company owns and operates the projects and the partnership portal. The Partner is the registered account holder, granted monitoring access to assigned construction projects and entrusted with client collections as set out herein. Portal access is a monitoring convenience: it does not by itself create, evidence, or limit partnership status or rights under the signed Partnership Agreement.' },
            { heading: '2. Partnership Portal Scope', body: 'The portal gives the Partner a live monitoring view of each assigned project: the direct-cost breakdown (Labor, Materials, Out Source) with weekly summaries; total and remaining cash receipts; and materials procurement, milestones, and accomplishment reports. This view is a summary only — it excludes the Company’s management-fee and client-payment records; complete books remain available from the Company upon reasonable request.' },
            { heading: '3. Handling of Client Collections', body: 'The Partner is authorized to receive payments from clients of assigned projects. Every collection must be recorded in the Company system within forty-eight (48) hours of receipt. From each collection, the portions due the Company — the agreed REVOLVING FUND contribution for project operations and the Company’s COMMISSION at the agreed rate — are Company funds held in trust by the Partner from the moment of collection (Civil Code Art. 1891); they are not the Partner’s money at any time. Project disbursements drawn from collections must be supported by receipts recorded in the system.' },
            { heading: '4. Weekly Remittance & Reconciliation', body: 'On the Company’s weekly schedule the Partner shall remit: (i) the revolving fund contribution for the project, and (ii) the Company’s commission on collections at the agreed rate — each remittance accompanied by an accounting of gross collections, the fund contribution, the commission computation, and the balance retained. The Partner retains the balance of collections as their share only after (i) and (ii) are fully settled. Each week is reconciled against the receipts and disbursements recorded in the system; any deficiency is settled in the weekly reconciliation, late remittances bear interest at the agreed rate, and willful failure to remit amounts held in trust constitutes a breach of fiduciary duty.' },
            { heading: '5. Confidentiality & Data Privacy', body: 'All project, client, and financial information visible in the portal is confidential. The Partner shall handle client data in accordance with the Data Privacy Act of 2012 (R.A. 10173), keep account credentials personal, and report any suspected security incident to the Company within one (1) hour of discovery.' },
            { heading: '6. Company Policies & Conduct', body: 'The Company’s professional-conduct, anti-discrimination, and anti-harassment standards apply to Partners in full, together with the IT-usage and social-media policies governing use of the portal and project information. Actions taken in the portal are recorded with date and time. Unremitted client funds and unrecorded receipts are treated as outstanding partner liabilities in the weekly reconciliation.' },
            { heading: '7. Access Changes & Offboarding', body: 'Portal access follows the Partner’s project assignments and may be updated by the Company. Upon separation or withdrawal, all pending collections must be remitted and reconciled in full, Company accounts and portal access are deactivated as part of offboarding, and confidentiality obligations survive the end of portal access.' },
            { heading: '8. Commitment, Transition & Abandonment', body: '(a) Commitment Period. The Partner commits to remain engaged for the FULL DURATION of each assigned project; this engagement is an agreed term under Article 1785 of the Civil Code. Abandonment — ceasing to perform or to respond regarding assigned projects without justifiable cause — is a breach of this Agreement and a withdrawal in contravention thereof (Art. 1837): the Company may continue the business, deactivate access immediately, and recover damages.\n\n(b) Transition Duty (No Walk-Off). Voluntary withdrawal requires at least sixty (60) days’ prior written notice and a complete turnover: remittance and reconciliation of ALL client collections, handover of records, documents, and credentials, and — where the Partner holds responsible charge under R.A. 9266 — formal transfer to another duly licensed professional accepted by the Company. NO amount is payable to a departing Partner until the Company certifies the turnover complete.\n\n(c) Deferred Holdback. The Company may retain twenty percent (20%) of each distribution or payout due the Partner, releasing it twelve (12) months later; retained amounts are FORFEITED to the Company as partial liquidated damages if the Partner abandons or departs in breach of this Section.\n\n(d) Settlement. Unremitted funds, project deficits, and resulting damages are offset against any amounts due the Partner. Amounts payable to an abandoning Partner exclude goodwill and become due only after all assigned projects are fully reconciled and turned over.' },
            { heading: '9. Agreement Confirmation', body: 'By accepting this Agreement, the Partner confirms having fully read, understood, and voluntarily agreed to all terms and conditions set forth herein, including the handling of client collections held in trust and the commitment and abandonment terms above. This digital acceptance serves as a binding confirmation equivalent to a written signature.' }
    ]
};

// Warm the template cache as soon as the shim is up, so signing modals and
// prints render the current admin-edited text (falls back to standard).
try { if (typeof db !== 'undefined') window.dacsLoadAgreementTemplates(); } catch (_) {}
