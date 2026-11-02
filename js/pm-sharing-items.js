/* ══════════════════════════════════════════════════════════
   PM PROFIT SHARING — PERSONAL ITEMS (window.PMShareItems)
   Spec: docs/superpowers/specs/2026-10-31-pm-sharing-personal-items-design.md

   An item the owner or the partner bought for THEMSELVES out of a PM
   project's money. It lowers only that person's sharing figure, after the
   split — PMShare.project does the sum. OUTSIDE the money model: never a
   bill, expense, Spent, Profit, payout or amount owed.

   The ONLY file that names the pm_si_* server functions
   (tests/pm-sharing-items.test.js fences it). The main owner writes; other
   owner-role accounts read; staff get nothing (no panel, no fetch).
   Receipts: pmSharing/<company>/<yyyy-mm>/<uuid>.jpg, uploaded here and
   opened through a short-lived signed link.
   ══════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  const ERRORS = {
    OWNER_ONLY: 'Only the main owner can record personal items.',
    PROJECT_UNMAPPED: 'Project not linked to a company — sharing locked.',
    WRONG_COMPANY: 'This project belongs to another company.',
    BAD_CHARGED_TO: 'Choose who the item is charged to.',
    BAD_NAME: 'Enter the item name (up to 120 characters).',
    BAD_NOTE: 'Keep the note to 500 characters.',
    BAD_REASON: 'Keep the reason to 500 characters.',
    BAD_AMOUNT: 'Enter an amount above ₱0 and below ₱100,000,000.',
    BAD_PRECISION: 'Use at most 2 decimal places.',
    BAD_DATE: 'Enter the date bought — not a future date.',
    BAD_RECEIPT_PATH: 'The receipt photo could not be linked. Choose it again.',
    REASON_REQUIRED: 'Give a reason.',
    ITEM_VOIDED: 'This item was already voided.',
    ITEM_CHANGED: 'This item was changed by someone else — reload.',
    NOT_FOUND: 'This item no longer exists — reload.',
    OP_REUSED: 'This save clashed with an earlier one — close the form and try again.',
    BAD_OP: 'This save clashed with an earlier one — close the form and try again.',
    INACTIVE: 'This account is not active.',
    NOT_SIGNED_IN: 'Sign in again and retry.',
  };
  function errorText(message) {
    const m = String(message || '');
    const key = Object.keys(ERRORS).find(k => m.indexOf(k) !== -1);
    return key ? ERRORS[key] : m;
  }

  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const P = () => root.PMShare;
  const WHO = { owner: 'You', partner: 'Partner' };

  // ── pure helpers ───────────────────────────────────────────────────
  // Local (PH) date key — never toISOString (UTC lags a day before 8 AM).
  function todayKey(now) {
    const d = now || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function fmtDay(key) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
    if (!m) return String(key || '');
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
      .toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  // The amount is sent AS TYPED (commas removed) so the server refuses 10.005
  // instead of the browser rounding it.
  function parseAmount(str) {
    const s = String(str == null ? '' : str).replace(/,/g, '').trim();
    if (/^\d+\.\d{3,}$/.test(s)) return { ok: false, error: ERRORS.BAD_PRECISION };
    if (!/^\d{1,8}(\.\d{1,2})?$/.test(s) || !(Number(s) > 0)) return { ok: false, error: ERRORS.BAD_AMOUNT };
    return { ok: true, value: s };
  }
  function validate(f, mode, now) {
    const errors = {};
    if (f.chargedTo !== 'owner' && f.chargedTo !== 'partner') errors.chargedTo = ERRORS.BAD_CHARGED_TO;
    const name = String(f.itemName || '').trim();
    if (!name || name.length > 120) errors.itemName = ERRORS.BAD_NAME;
    const a = parseAmount(f.amount);
    if (!a.ok) errors.amount = a.error;
    const day = String(f.boughtOn || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > todayKey(now)) errors.boughtOn = ERRORS.BAD_DATE;
    const note = String(f.note || '').trim();
    if (note.length > 500) errors.note = ERRORS.BAD_NOTE;
    const reason = String(f.reason || '').trim();
    if (reason.length > 500) errors.reason = ERRORS.BAD_REASON;
    else if (mode === 'correct' && !reason) errors.reason = ERRORS.REASON_REQUIRED;
    const ok = !Object.keys(errors).length;
    return { ok, errors, value: ok ? { chargedTo: f.chargedTo, itemName: name, amount: a.value, boughtOn: day,
                                       note: note || null, reason: reason || null } : null };
  }
  function newOpId() {
    if (root.DacsReceipts && typeof root.DacsReceipts.newId === 'function') return root.DacsReceipts.newId();
    return root.crypto.randomUUID();
  }

  // ── server calls (the server re-checks everything) ─────────────────
  async function rpc(name, args) {
    const sb = root.sbClient;
    if (!sb || typeof sb.rpc !== 'function') throw new Error('Not connected');
    const { data, error } = await sb.rpc(name, args);
    if (error) throw new Error(error.message || String(error));
    return data;
  }
  const server = {
    record: (op, projectId, v, receiptPath) => rpc('pm_si_record', {
      p_op_id: op, p_project: projectId, p_charged_to: v.chargedTo, p_item_name: v.itemName, p_amount: v.amount,
      p_bought_on: v.boughtOn, p_note: v.note, p_receipt_path: receiptPath || null }),
    correct: (op, item, v, receiptPath) => rpc('pm_si_correct', {
      p_op_id: op, p_id: item.id, p_expected_version: item.version, p_charged_to: v.chargedTo, p_item_name: v.itemName,
      p_amount: v.amount, p_bought_on: v.boughtOn, p_note: v.note, p_receipt_path: receiptPath || null, p_reason: v.reason }),
    void: (op, item, reason) => rpc('pm_si_void', {
      p_op_id: op, p_id: item.id, p_expected_version: item.version, p_reason: String(reason || '').trim() }),
  };
  // No receipt_uploads ledger row: the item row is what holds the path.
  async function uploadReceipt(file, companyId) {
    const R = root.DacsReceipts;
    const blob = await R.compressToBlob(file);
    const path = R.receiptPath('pm_sharing', companyId);
    const { error } = await root.sbClient.storage.from('uploads').upload(path, blob, { upsert: false, contentType: 'image/jpeg' });
    if (error) throw new Error('Couldn\'t upload the photo: ' + (error.message || error));
    return path;
  }

  // ── panel ──────────────────────────────────────────────────────────
  const S = { el: null, projectId: null, items: [], canEdit: false, companyId: null, onChange: null,
              mode: null, item: null, opId: null, receiptPath: null, busy: false };
  const toast = (msg, isErr) => { if (typeof root._pmToast === 'function') root._pmToast(msg, !!isErr); };
  const btn = 'style="font:600 12px \'IBM Plex Sans\';padding:5px 10px;border-radius:8px;border:1px solid #d6dde4;background:#fff;color:#334155;cursor:pointer;"';

  const known = {};   // every item ever rendered, so Receipt works where mount() was never called (dashboard, print)
  function panelHtml(items, canEdit, opts) {
    const p = P(), list = items || [];
    const noButtons = !!(opts && opts.print);
    list.forEach(i => { if (i && i.id) known[i.id] = i; });
    const t = p.itemTotals(list);
    const rows = list.map(i => {
      const voided = i.status === 'voided';
      const amount = esc(p.pesos(p.toCents(i.amount)));
      return '<div class="pm-si-row" style="display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px solid #eef0f3;'
        + (voided ? 'opacity:.55;' : '') + '">'
        + '<div style="min-width:0;"><div style="font:600 13px \'IBM Plex Sans\';color:#1f2420;">' + esc(i.item_name) + '</div>'
        + '<div style="font:500 12px \'IBM Plex Sans\';color:#6c6c70;">' + esc(WHO[i.charged_to] || '') + ' · ' + esc(fmtDay(i.bought_on))
        + (i.note ? ' · ' + esc(i.note) : '') + '</div>'
        + (voided ? '<div style="font:600 12px \'IBM Plex Sans\';color:#8f352c;">Voided — ' + esc(i.void_reason) + '</div>' : '')
        + '</div>'
        + '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">'
        + '<span style="font:700 13px \'IBM Plex Sans\';">' + (voided ? '<s>' + amount + '</s>' : amount) + '</span>'
        + (!noButtons && i.receipt_path ? '<button type="button" ' + btn + ' onclick="PMShareItems.openReceipt(\'' + esc(i.id) + '\')">Receipt</button>' : '')
        + (!noButtons && canEdit && !voided
            ? '<button type="button" ' + btn + ' onclick="PMShareItems.openCorrect(\'' + esc(i.id) + '\')">Correct</button>'
              + '<button type="button" ' + btn + ' onclick="PMShareItems.voidItem(\'' + esc(i.id) + '\')">Void</button>'
            : '')
        + '</div></div>';
    }).join('');
    return '<div style="background:#fff;border:1px solid #e7e6e2;border-radius:14px;padding:16px 18px;margin-top:16px;">'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">'
      + '<div><div style="font:700 14px \'IBM Plex Sans\';color:#1f2420;">Personal items</div>'
      + '<div style="font:500 12px \'IBM Plex Sans\';color:#6c6c70;">Bought for one person — comes off only that person\'s share. Not a project cost.</div>'
      + '<div style="font:600 12.5px \'IBM Plex Sans\';color:#334155;margin-top:4px;">You −' + esc(p.pesos(t.ownerCents))
      + ' · Partner −' + esc(p.pesos(t.partnerCents)) + '</div></div>'
      + (canEdit && !noButtons ? '<button type="button" class="pm-btn pm-btn-primary" onclick="PMShareItems.openAdd()">Add item</button>' : '')
      + '</div>'
      + (rows || '<div style="font:500 12.5px \'IBM Plex Sans\';color:#8794a3;padding-top:10px;">No personal items.</div>')
      + '</div>';
  }
  function mount(el, opts) {
    if (!el) return;
    if (root.currentUserRole !== 'owner') { el.innerHTML = ''; return; }
    Object.assign(S, { el, projectId: opts.projectId, items: opts.items || [], canEdit: !!opts.canEdit,
                       companyId: opts.companyId || null, onChange: opts.onChange || null });
    el.innerHTML = panelHtml(S.items, S.canEdit);
  }

  // ── form (markup in admin.html: #pmSiModal) ────────────────────────
  const $ = (id) => document.getElementById(id);
  const FIELDS = { chargedTo: 'pmSiChargedTo', itemName: 'pmSiName', amount: 'pmSiAmount', boughtOn: 'pmSiDate',
                   note: 'pmSiNote', reason: 'pmSiReason' };
  function showErrors(errors) {
    Object.keys(FIELDS).forEach(k => { const e = $('err-' + FIELDS[k]); if (e) e.textContent = errors[k] || ''; });
  }
  function openForm(mode, item) {
    S.mode = mode; S.item = item || null; S.opId = newOpId(); S.receiptPath = null;
    $('pmSiTitle').textContent = mode === 'correct' ? 'Correct personal item' : 'Add personal item';
    $('pmSiChargedTo').value = item ? item.charged_to : '';
    $('pmSiName').value = item ? item.item_name : '';
    $('pmSiAmount').value = item ? String(Number(item.amount)) : '';
    $('pmSiDate').value = item ? item.bought_on : todayKey();
    $('pmSiNote').value = item && item.note ? item.note : '';
    $('pmSiReason').value = '';
    $('pmSiReceipt').value = '';
    $('pmSiReasonRow').style.display = mode === 'correct' ? '' : 'none';
    $('pmSiErr').textContent = '';
    showErrors({});
    $('pmSiModal').style.display = 'flex';
  }
  function openAdd() { if (S.canEdit) openForm('record', null); }
  function openCorrect(id) {
    const item = S.items.find(x => x.id === id);
    if (S.canEdit && item && item.status === 'active') openForm('correct', item);
  }
  // A new photo was picked: the next save uploads it (a retry reuses the upload).
  function onReceiptChange() { S.receiptPath = null; }
  function closeForm() {
    if (S.busy) return;   // a save is in flight: its values and op id must not vanish under it
    $('pmSiModal').style.display = 'none';
    S.mode = null; S.item = null; S.opId = null; S.receiptPath = null;
  }
  function setBusy(on) {
    S.busy = on;
    const save = $('pmSiSaveBtn'), cancel = $('pmSiCancelBtn');
    if (save) save.disabled = on;
    if (cancel) cancel.disabled = on;
  }
  async function reload() {
    if (!S.onChange) return;
    try { await S.onChange(); }
    catch (e) { toast('Saved, but the list could not refresh — reload the page.', true); }
  }
  async function submit() {
    if (S.busy || !S.mode) return;
    const f = {};
    Object.keys(FIELDS).forEach(k => { f[k] = $(FIELDS[k]).value; });
    const v = validate(f, S.mode);
    showErrors(v.errors);
    if (!v.ok) return;
    // Everything the save needs is captured now; the form state is not read again.
    const mode = S.mode, opId = S.opId, item = S.item, projectId = S.projectId, companyId = S.companyId;
    setBusy(true); $('pmSiErr').textContent = '';
    let saved = false;
    try {
      const fileEl = $('pmSiReceipt');
      const file = fileEl && fileEl.files && fileEl.files[0];
      if (file && !S.receiptPath) S.receiptPath = await uploadReceipt(file, companyId);
      const path = S.receiptPath || (mode === 'correct' ? item.receipt_path : null);
      if (mode === 'record') await server.record(opId, projectId, v.value, path);
      else await server.correct(opId, item, v.value, path);
      saved = true;
    } catch (e) {
      $('pmSiErr').textContent = errorText(e.message);
    } finally {
      setBusy(false);
    }
    if (!saved) return;
    closeForm();
    toast(mode === 'record' ? 'Personal item added' : 'Personal item corrected');
    await reload();
  }
  async function voidItem(id) {
    const item = S.items.find(x => x.id === id);
    if (!S.canEdit || S.busy || !item || item.status !== 'active') return;
    const reason = root.prompt('Why are you voiding "' + item.item_name + '"? It will count ₱0 and stay in the history.');
    if (reason == null) return;
    if (!String(reason).trim()) { toast(ERRORS.REASON_REQUIRED, true); return; }
    S.busy = true;
    let done = false;
    try {
      await server.void(newOpId(), item, reason);
      done = true;
      toast('Personal item voided');
    } catch (e) {
      toast('Void failed: ' + errorText(e.message), true);
    } finally {
      S.busy = false;
    }
    if (done) await reload();
  }
  async function openReceipt(id) {
    const item = S.items.find(x => x.id === id) || known[id];
    if (!item || !item.receipt_path) return;
    const w = root.open('', '_blank');
    if (!w) { toast('Allow pop-ups to open the receipt.', true); return; }
    try { w.opener = null; } catch (e) { /* ignore */ }
    try {
      const { data, error } = await root.sbClient.storage.from('uploads').createSignedUrl(item.receipt_path, 600);
      if (error || !data) throw new Error('no link');
      w.location = data.signedUrl;
    } catch (e) {
      w.close();
      toast('Could not open the receipt.', true);
    }
  }

  root.PMShareItems = { ERRORS, errorText, todayKey, parseAmount, validate, newOpId, server, panelHtml, mount,
                        openAdd, openCorrect, onReceiptChange, closeForm, submit, voidItem, openReceipt, _state: S };
})(typeof window !== 'undefined' ? window : globalThis);
