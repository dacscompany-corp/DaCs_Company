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
      + '</div>'
      + (o.noPrint ? '' : '<scr' + 'ipt>window.onload=function(){setTimeout(function(){window.print();},350);};</scr' + 'ipt>')
      + '</body></html>';
    return html;
};

window.dacsAgreementPdf = function(opts) {
    const html = window.dacsAgreementHtml(opts);
    const w = window.open('', '_blank', 'width=900,height=1160');
    if (!w) { alert('Please allow pop-ups to open the agreement.'); return; }
    w.document.write(html);
    w.document.close();
};

// ── Cost-Plus CLIENT Agreement — the ONE canonical document definition ──────
// Used by: the client portal's first-login agreement modal (Client
// Management.html — sections rendered from here), the client's signed-PDF
// download (client-management-app.js), and the admin's Agreement print
// (user-navigator.js). Edit the client terms ONLY here.
window.dacsClientAgreementDoc = function(clientName, proj, dayStr) {
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
        sections: [
            { heading: '1. Parties', body: 'This Cost-Plus Project Management Agreement is between DAC’s Building Design Services (the “Manager”) — responsible for all construction management activities including labor, procurement, and site supervision — and the Client, the registered account holder, responsible for funding all direct costs and the management fee as defined herein. Each project must be formally linked to both a Manager and a Client account within the system; one account may be linked to several projects, and these terms apply to each linked project.' },
            { heading: '2. Scope of Services', body: 'The Manager provides, on behalf of the Client: labor management (adding, assigning, and scheduling workers; tracking daily labor entries and payroll, including fixed-price/pakyaw job contracts); procurement management (recording material requests, supplier canvassing, purchases, delivery status, and quality checks); out source works (engaging and recording third-party supply-and-install packages as their own cost category); and site supervision (monitoring project progress; uploading site reports, images, milestones, and accomplishment reports accessible by the Client).' },
            { heading: '3. Cost-Plus Fee Structure', body: 'This agreement operates under a Cost-Plus model. Direct costs — labor, materials & supplies, and out source (supply & install) works — are recorded daily as individual entries and grouped into weekly (Sunday–Saturday) summaries. The management fee is the percentage agreed for the Client’s project (projects can have different rates, including 0%), automatically computed on each week’s direct costs and displayed on the dashboard and in every billing report. Total weekly amount = direct costs + the management fee at the project’s agreed rate.' },
            { heading: '4. Payment Terms', body: 'The Manager records project costs daily; entries roll into a weekly summary (Sunday–Saturday) visible in the Client’s portal. The Client is notified, and payment for each week’s bill is due by Friday, per the billing schedule shown in the portal. Payment covers labor, materials, out source works, and the management fee at the project’s agreed rate. The Client may pay suppliers directly or fund the system’s revolving fund for petty purchases.' },
            { heading: '5. Revolving Fund', body: 'An optional revolving fund (petty cash) may be established by the Client for minor and urgent site purchases. The system tracks deductions from the fund with receipts as proof, calculates the remaining balance weekly, and prompts the Client to replenish the fund when the balance falls below the required threshold.' },
            { heading: '6. Responsibilities & System Rules', body: 'Quality control: the Manager logs defective materials, and the system records return and replacement actions. Labor: all workers are managed by the Manager, and payroll is funded and approved by the Client. Price variability: material and labor costs are subject to market fluctuations — quoted estimates are not guaranteed fixed prices. Records & privacy: portal views are convenience summaries of the Company’s official electronic records, supporting documents are available on request, and client data is handled in accordance with the Data Privacy Act of 2012 (R.A. 10173); account credentials are personal.' },
            { heading: '7. Termination', body: 'Either party may request early project termination through the system. Upon termination, the system computes the total consumed labor costs, total materials used, and the equivalent management fee; the final payable balance must be settled in full before the project is officially closed. Termination requests are subject to review and confirmation by the Manager.' },
            { heading: '8. Agreement Confirmation', body: 'By accepting this Agreement, the Client confirms having fully read, understood, and voluntarily agreed to all terms and conditions set forth in this Cost-Plus Project Management Agreement with DAC’s Building Design Services. This digital acceptance serves as a binding confirmation equivalent to a written signature.' }
        ],
        signerLabel: 'Client'
    };
};

// ── DAC's Partnership Agreement — the ONE canonical document definition ──────
// Used by: the partner signing stepper (Dacs Partnership.html), the partner's
// own signed-PDF download (client-management-app.js), and the admin's Partner
// Agreement print (user-navigator.js). Edit the terms HERE so what the partner
// reads, signs, and later reprints is always the same document.
window.dacsPartnerAgreementDoc = function(partnerName, proj, dayStr) {
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
        sections: [
            { heading: '1. Parties & Status', body: 'The Company owns and operates the projects and the partnership portal. The Partner is the registered account holder, granted monitoring access to assigned construction projects and entrusted with client collections as set out herein. Portal access is a monitoring convenience: it does not by itself create, evidence, or limit partnership status or rights under the signed Partnership Agreement.' },
            { heading: '2. Partnership Portal Scope', body: 'The portal gives the Partner a live monitoring view of each assigned project: the direct-cost breakdown (Labor, Materials, Out Source) with weekly summaries; total and remaining cash receipts; and materials procurement, milestones, and accomplishment reports. This view is a summary only — it excludes the Company’s management-fee and client-payment records; complete books remain available from the Company upon reasonable request.' },
            { heading: '3. Handling of Client Collections', body: 'The Partner is authorized to receive payments from clients of assigned projects. Every collection must be recorded in the Company system within forty-eight (48) hours of receipt. From each collection, the portions due the Company — the agreed REVOLVING FUND contribution for project operations and the Company’s COMMISSION at the agreed rate — are Company funds held in trust by the Partner from the moment of collection (Civil Code Art. 1891); they are not the Partner’s money at any time. Project disbursements drawn from collections must be supported by receipts recorded in the system.' },
            { heading: '4. Weekly Remittance & Reconciliation', body: 'On the Company’s weekly schedule the Partner shall remit: (i) the revolving fund contribution for the project, and (ii) the Company’s commission on collections at the agreed rate — each remittance accompanied by an accounting of gross collections, the fund contribution, the commission computation, and the balance retained. The Partner retains the balance of collections as their share only after (i) and (ii) are fully settled. Each week is reconciled against the receipts and disbursements recorded in the system; any deficiency is settled in the weekly reconciliation, late remittances bear interest at the agreed rate, and willful failure to remit amounts held in trust constitutes a breach of fiduciary duty.' },
            { heading: '5. Confidentiality & Data Privacy', body: 'All project, client, and financial information visible in the portal is confidential. The Partner shall handle client data in accordance with the Data Privacy Act of 2012 (R.A. 10173), keep account credentials personal, and report any suspected security incident to the Company within one (1) hour of discovery.' },
            { heading: '6. Company Policies & Conduct', body: 'The Company’s professional-conduct, anti-discrimination, and anti-harassment standards apply to Partners in full, together with the IT-usage and social-media policies governing use of the portal and project information. Actions taken in the portal are recorded with date and time. Unremitted client funds and unrecorded receipts are treated as outstanding partner liabilities in the weekly reconciliation.' },
            { heading: '7. Access Changes & Offboarding', body: 'Portal access follows the Partner’s project assignments and may be updated by the Company. Upon separation or withdrawal, all pending collections must be remitted and reconciled in full, Company accounts and portal access are deactivated as part of offboarding, and confidentiality obligations survive the end of portal access.' },
            { heading: '8. Commitment, Transition & Abandonment', body: '(a) Commitment Period. The Partner commits to remain engaged for the FULL DURATION of each assigned project; this engagement is an agreed term under Article 1785 of the Civil Code. Abandonment — ceasing to perform or to respond regarding assigned projects without justifiable cause — is a breach of this Agreement and a withdrawal in contravention thereof (Art. 1837): the Company may continue the business, deactivate access immediately, and recover damages.\n\n(b) Transition Duty (No Walk-Off). Voluntary withdrawal requires at least sixty (60) days’ prior written notice and a complete turnover: remittance and reconciliation of ALL client collections, handover of records, documents, and credentials, and — where the Partner holds responsible charge under R.A. 9266 — formal transfer to another duly licensed professional accepted by the Company. NO amount is payable to a departing Partner until the Company certifies the turnover complete.\n\n(c) Deferred Holdback. The Company may retain twenty percent (20%) of each distribution or payout due the Partner, releasing it twelve (12) months later; retained amounts are FORFEITED to the Company as partial liquidated damages if the Partner abandons or departs in breach of this Section.\n\n(d) Settlement. Unremitted funds, project deficits, and resulting damages are offset against any amounts due the Partner. Amounts payable to an abandoning Partner exclude goodwill and become due only after all assigned projects are fully reconciled and turned over.' },
            { heading: '9. Agreement Confirmation', body: 'By accepting this Agreement, the Partner confirms having fully read, understood, and voluntarily agreed to all terms and conditions set forth herein, including the handling of client collections held in trust and the commitment and abandonment terms above. This digital acceptance serves as a binding confirmation equivalent to a written signature.' }
        ],
        signerLabel: 'Partner'
    };
};
