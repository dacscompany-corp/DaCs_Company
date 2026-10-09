// ════════════════════════════════════════════════════════════════════
// RECEIPT STORAGE — expense / payroll receipt photos as FILES in the private
// `uploads` bucket, never base64 inside the row (spec docs/superpowers/specs/
// 2026-10-08-receipt-photos-storage-design.md). The row stores the public-
// FORMAT URL; supabase-config.js §11b signs it wherever the page shows it.
// Separate print windows don't run §11b, so their HTML goes through signHtml.
// Access (migration 0089): owner/staff of the company in path segment 2 only.
// ════════════════════════════════════════════════════════════════════
(function (root) {
  'use strict';
  const FOLDER = { expense: 'expenseReceipts', payroll: 'payrollReceipts' };
  const PUB_RE = /\/storage\/v1\/object\/public\/uploads\/([^?#"'\s<>)]+)/;
  const PUB_RE_G = /https?:\/\/[^"'\s<>)]*\/storage\/v1\/object\/public\/uploads\/[^"'\s<>)]+/g;

  function newId() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID().toLowerCase();
    const b = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = b.map((x) => x.toString(16).padStart(2, '0')).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }

  // <folder>/<owner>/<yyyy-mm>/<uuid>.jpg — month from LOCAL parts (PH, UTC+8).
  function receiptPath(kind, ownerId, now, id) {
    const folder = FOLDER[kind];
    if (!folder) throw new Error('Unknown receipt kind: ' + kind);
    if (!ownerId) throw new Error('No company account to file the receipt under — sign in again.');
    const d = now || new Date();
    const ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    return folder + '/' + String(ownerId).toLowerCase() + '/' + ym + '/' + (id || newId()) + '.jpg';
  }

  function isInlinePhoto(v) { return typeof v === 'string' && v.startsWith('data:'); }
  function storagePathOf(url) {
    const m = String(url || '').match(PUB_RE);
    return m ? decodeURIComponent(m[1]) : null;
  }

  // Same processing receipts always had (max 900 px, JPEG 0.75), as a Blob.
  function compressToBlob(file, max, quality) {
    const MAX = max || 900, Q = quality || 0.75;
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Couldn\'t read the photo file.'));
      reader.onload = (ev) => {
        const img = new Image();
        img.onerror = () => reject(new Error('That file is not a photo this browser can read.'));
        img.onload = () => {
          let w = img.width, h = img.height;
          if (w > MAX || h > MAX) {
            if (w > h) { h = Math.round(h * MAX / w); w = MAX; } else { w = Math.round(w * MAX / h); h = MAX; }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Couldn\'t process the photo.'))), 'image/jpeg', Q);
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // Ledger row first (so a file can never exist without one), then the file.
  async function uploadReceipt(kind, blob, ownerId) {
    const sb = root.sbClient;
    const path = receiptPath(kind, ownerId);
    const { error: ledgerErr } = await sb.from('receipt_uploads').insert({ path, owner_id: String(ownerId).toLowerCase(), kind });
    if (ledgerErr) throw new Error('Couldn\'t register the photo upload: ' + (ledgerErr.message || ledgerErr));
    const { error: upErr } = await sb.storage.from('uploads').upload(path, blob, { upsert: false, contentType: 'image/jpeg' });
    if (upErr) throw new Error('Couldn\'t upload the photo: ' + (upErr.message || upErr));
    return sb.storage.from('uploads').getPublicUrl(path).data.publicUrl;
  }

  // For window.open('')+document.write popups: sign every stored link first.
  async function signHtml(html) {
    const text = String(html || '');
    const urls = [...new Set(text.match(PUB_RE_G) || [])];
    if (!urls.length) return text;
    const sign = root.dacsMaybeSignUrl || ((u) => Promise.resolve(u));
    const signed = await Promise.all(urls.map((u) => sign(u)));
    let out = text;
    urls.forEach((u, i) => { out = out.split(u).join(signed[i]); });
    return out;
  }

  root.DacsReceipts = { FOLDER, newId, receiptPath, isInlinePhoto, storagePathOf, compressToBlob, uploadReceipt, signHtml };
})(window);