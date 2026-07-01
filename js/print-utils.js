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
window.dacsAgreementPdf = function(opts) {
    const o = opts || {};
    const esc = s => String(s == null ? '' : s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const logo = window.location.origin + '/assets/images/DACS-TRANSPARENT.png';
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
      + '@media print{body{background:#fff;padding:0;}.page{box-shadow:none;margin:0;width:auto;min-height:auto;padding:18mm 16mm;}}'
      + '</style></head><body><div class="page">'
      + '<div class="wm"><img src="' + logo + '" onerror="this.style.display=\'none\'"></div>'
      + '<div class="lh"><img src="' + logo + '" onerror="this.style.display=\'none\'"><div class="co">DAC’s Building Design Services</div><div class="tag">Building Design &amp; Project Management</div></div>'
      + '<div class="title">' + esc(o.title || 'Agreement') + '</div>'
      + '<div class="refline">' + (o.ref ? 'Ref. ' + esc(o.ref) + ' &nbsp;·&nbsp; ' : '') + esc(o.subtitle || '') + '</div>'
      + (o.preamble ? '<div class="preamble">' + esc(o.preamble) + '</div>' : '')
      + (parties ? '<div class="parties">' + parties + '</div>' : '')
      + sections
      + '<div class="exec"><b>IN WITNESS WHEREOF,</b> the ' + signerLabel + ' has electronically signed this document on the date and time indicated below.</div>'
      + '<div class="sign-block"><div class="sign-col">' + (o.signatureImage ? '<img class="sig-img" src="' + esc(o.signatureImage) + '" alt="signature"/>' : '') + '<div class="sig-line">' + esc(o.signature || '') + '</div><div class="sig-lbl">' + signerLabel + ' — Signature over Printed Name</div></div>'
      + '<div class="sign-col"><div class="sig-line">' + esc(o.dateStr || '') + '</div><div class="sig-lbl">Date &amp; Time Signed</div></div></div>'
      + '<div class="foot">' + (o.footerNote ? esc(o.footerNote) + ' ' : 'This document was electronically executed and is legally retained by DAC’s Building Design Services. ') + (o.ip ? 'Signed from IP ' + esc(o.ip) + '. ' : '') + 'A binding confirmation equivalent to a written signature.</div>'
      + '</div><scr' + 'ipt>window.onload=function(){setTimeout(function(){window.print();},350);};</scr' + 'ipt></body></html>';
    const w = window.open('', '_blank', 'width=900,height=1160');
    if (!w) { alert('Please allow pop-ups to open the agreement.'); return; }
    w.document.write(html);
    w.document.close();
};
