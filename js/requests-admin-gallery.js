// ════════════════════════════════════════════════════════════════════
// Requests → Item history → product photos (WorkMate Stage 1b, 0090).
//
// Upload a product photo, choose the cover, retire a photo, and the
// "Photos to review" queue: a worker's PRIVATE request photo is either
// published as a reviewed COPY (the original stays private) or kept
// private. A person checks every photo first: no prices, no personal
// details, the product only. The file goes to the private item-gallery
// bucket as <company>/<item>/<uuid>.jpg, then a 0090 office RPC records
// it. Photos are re-encoded in the browser first, which also drops
// camera metadata such as GPS location. Nothing is ever deleted here.
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const RA = root.RequestsAdmin;
    if (!RA) return;
    const esc = RA.esc;
    const GALLERY = 'item-gallery';
    const REQUEST_PHOTOS = 'request-photos';
    const CHECKS = [
        'No price, amount, receipt or price tag is visible',
        'No face, name, phone number or other personal detail is visible',
        'It shows only the product',
    ];

    function checklistHtml() {
        return '<fieldset class="hist-checks att-span"><legend>Before it goes to the workers\u2019 gallery</legend>' +
            CHECKS.map((c, i) => '<label class="req-toggle"><input type="checkbox" name="check' + i + '"> ' + esc(c) + '</label>').join('') +
            '</fieldset>';
    }

    function checklistOk(form) {
        return CHECKS.every((c, i) => form['check' + i].checked);
    }

    // Re-encode (drops camera metadata), then store under a fresh uuid name.
    async function storeCopy(itemId, source) {
        if (!root.DacsReceipts) throw new Error('UPLOAD_FAILED: the photo tools did not load — reload the page');
        const blob = await root.DacsReceipts.compressToBlob(source, 1200, 0.8);
        const path = RA.galleryPath(root.currentDataUserId, itemId, root.DacsReceipts.newId());
        const { error } = await root.sbClient.storage.from(GALLERY).upload(path, blob, { upsert: false, contentType: 'image/jpeg' });
        if (error) throw new Error('UPLOAD_FAILED: ' + (error.message || error));
        return path;
    }

    function uploadModal(item, rerender) {
        const refs = (item.entries || []).filter(e => e.entry_kind === 'reference' && !e.retired);
        const hasCover = (item.photos || []).some(p => p.is_cover);
        RA.modal({
            title: 'Upload a product photo',
            sub: RA.itemLabel(item),
            body:
                '<div class="att-field att-span"><label for="galFile">Photo</label>' +
                  '<input class="att-input" id="galFile" name="file" type="file" accept="image/*"></div>' +
                (refs.length
                    ? '<div class="att-field att-span"><label for="galRef">For a historical reference <span class="att-hint-inline">(optional)</span></label>' +
                      '<select class="att-input" id="galRef" name="ref"><option value="">No — a general photo of the item</option>' +
                      refs.map(r => '<option value="' + esc(r.entry_id) + '">' +
                        esc((r.project_name || '') + ' · ' + RA.entryDateLabel(r) + ' · ' + (r.description || '')) + '</option>').join('') +
                      '</select></div>'
                    : '') +
                '<label class="req-toggle att-span"><input type="checkbox" name="cover"' + (hasCover ? '' : ' checked') + '> Make it the cover photo</label>' +
                checklistHtml(),
            submitLabel: 'Upload',
            onSubmit: async (form) => {
                const file = form.file.files && form.file.files[0];
                if (!file) throw new Error('NO_PHOTO');
                if (!checklistOk(form)) throw new Error('CHECKLIST_REQUIRED');
                const path = await storeCopy(item.id, file);
                await RA.rpc('pr_office_add_gallery_photo', {
                    p_item: item.id,
                    p_path: path,
                    p_checklist: true,
                    p_make_cover: form.cover.checked,
                    p_ref: (form.ref && form.ref.value) || null,
                });
            },
            onDone: rerender,
        });
    }

    async function setCover(photoId, button, rerender) {
        button.disabled = true;
        try {
            await RA.rpc('pr_office_set_cover', { p_photo: photoId });
            rerender();
        } catch (err) {
            alert(RA.errorMessage(err));
            button.disabled = false;
        }
    }

    function retireModal(photo, rerender) {
        if (!photo) return;
        RA.modal({
            title: 'Retire this photo',
            sub: 'Workers stop seeing it on their next refresh. The office keeps it, greyed out, with your reason.',
            body: '<div class="att-field att-span"><label for="galReason">Why</label>' +
                  '<input class="att-input" id="galReason" name="reason" maxlength="200" placeholder="e.g. a price tag is visible"></div>',
            submitLabel: 'Retire',
            warn: true,
            onSubmit: async (form) => {
                if (!form.reason.value.trim()) throw new Error('REASON_REQUIRED');
                await RA.rpc('pr_office_retire_photo', { p_photo: photo.id, p_reason: form.reason.value.trim() });
            },
            onDone: rerender,
        });
    }

    // ── Photos to review ────────────────────────────────────────────

    function approveModal(q, rerender) {
        RA.modal({
            title: 'Approve a copy for the gallery',
            sub: RA.itemLabel(q.item) + ' · ' + q.project_name,
            body:
                '<img class="hist-review-img att-span" alt="Request photo" data-sign-bucket="' + REQUEST_PHOTOS + '" data-sign-path="' + esc(q.path) + '">' +
                '<label class="req-toggle att-span"><input type="checkbox" name="cover"> Make it the cover photo</label>' +
                checklistHtml() +
                '<div class="att-info att-span"><i data-lucide="shield-check"></i><div>If anything in the photo fails a check, keep it private instead — you can upload a clean photo from the item\u2019s page.</div></div>',
            submitLabel: 'Approve copy',
            onOpen: (form) => { RA.signImages(form); },
            onSubmit: async (form) => {
                if (!checklistOk(form)) throw new Error('CHECKLIST_REQUIRED');
                const { data, error } = await root.sbClient.storage.from(REQUEST_PHOTOS).download(q.path);
                if (error || !data) throw new Error('UPLOAD_FAILED: ' + ((error && error.message) || 'could not read the original photo'));
                const path = await storeCopy(q.item.id, data);
                await RA.rpc('pr_office_publish_photo', {
                    p_photo: q.photo_id,
                    p_path: path,
                    p_checklist: true,
                    p_make_cover: form.cover.checked,
                });
            },
            onDone: rerender,
        });
    }

    async function renderReview(host, nav) {
        host.innerHTML = '<div class="att-stack"><div class="att-empty">Loading photos to review…</div></div>';
        let queue;
        try { queue = await RA.rpc('pr_office_photo_queue'); } catch (e) { RA.fail(host, e); return; }
        queue = queue || [];
        const rerender = () => renderReview(host, nav);
        host.innerHTML =
            '<div class="att-stack">' +
              RA.head('Item history', 'Photos workers attached to requests for catalogue items. Approve a COPY for the workers\u2019 gallery, or keep it private. The worker\u2019s original always stays private.') +
              nav.tabsHtml() +
              (queue.length
                ? '<div class="hist-review">' + queue.map(q =>
                    '<div class="att-card" data-photo="' + esc(q.photo_id) + '"><div class="att-card-body att-stack">' +
                      '<img class="hist-review-img" alt="Request photo" data-sign-bucket="' + REQUEST_PHOTOS + '" data-sign-path="' + esc(q.path) + '">' +
                      '<div><strong>' + esc(RA.itemLabel(q.item)) + '</strong>' +
                        '<div class="req-muted">' + esc(q.project_name) + ' · ' + esc(q.work_name) + ' · ' + esc(q.requester_name) +
                        ' · ' + esc(RA.formatManila(q.created_at)) + '</div></div>' +
                      '<div class="req-actions">' +
                        '<button class="att-btn att-btn--primary" type="button" data-act="approve">Approve a copy…</button>' +
                        '<button class="att-btn" type="button" data-act="private">Keep private</button>' +
                      '</div>' +
                    '</div></div>').join('') + '</div>'
                : '<div class="att-empty">No photos waiting for review.</div>') +
            '</div>';
        nav.wireTabs(host);
        host.querySelectorAll('[data-photo]').forEach(card => card.addEventListener('click', async (e) => {
            const b = e.target.closest('[data-act]');
            if (!b || b.disabled) return;
            const q = queue.find(x => x.photo_id === card.dataset.photo);
            if (!q) return;
            if (b.dataset.act === 'approve') { approveModal(q, rerender); return; }
            if (!confirm('Keep this photo private? It leaves this list and never goes to the gallery.')) return;
            b.disabled = true;
            try {
                await RA.rpc('pr_office_keep_private', { p_photo: q.photo_id });
                rerender();
            } catch (err) {
                alert(RA.errorMessage(err));
                b.disabled = false;
            }
        }));
        RA.icons();
        RA.signImages(host);
    }

    RA.gallery = { uploadModal, setCover, retireModal, renderReview };
})(typeof window !== 'undefined' ? window : globalThis);