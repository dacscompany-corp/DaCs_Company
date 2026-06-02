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
