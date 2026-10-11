// ════════════════════════════════════════════════════════════════════
// Requests → Item history (WorkMate Stage 1b, 0090). Owner + staff.
//
// The office side of Find Previous Item: search the company's catalogue
// items with their dated history (requests matched to the item plus
// hand-entered historical references), add or retire a historical
// reference, and see the item's photos. Uploading photos, the cover,
// retiring, and reviewing workers' private request photos live in
// js/requests-admin-gallery.js (RA.gallery).
// Every change is a 0090 office RPC. NO MONEY anywhere. Workers see a
// project's history only when Item history is on for it (Projects tab).
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const RA = root.RequestsAdmin;
    if (!RA) return;
    const esc = RA.esc;
    const PAGE = 30;
    const SOURCE_LABEL = {
        upload: 'Uploaded by the office',
        request_photo: 'Copy of a request photo',
        reference: 'For a historical reference',
    };

    // Kept while switching views, so Back returns to the same search.
    const ui = { tab: 'search', text: '', kind: '', category: '', folder: '', from: '', to: '',
                 items: [], hasMore: false, itemId: null };
    let lookups = null;   // { projects, categories } — loaded once per page load

    async function loadLookups() {
        if (lookups) return lookups;
        const [projects, catalog] = await Promise.all([RA.rpc('pr_office_projects'), RA.rpc('pr_office_catalog')]);
        const categories = [...new Set((catalog || []).map(c => c.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
        lookups = { projects: projects || [], categories };
        return lookups;
    }

    function tabsHtml() {
        const tab = (id, label) => '<button class="att-btn' + (ui.tab === id ? ' att-btn--primary' : '') +
            '" type="button" data-tab="' + id + '">' + esc(label) + '</button>';
        return '<div class="req-actions">' + tab('search', 'Search items') + tab('review', 'Photos to review') + '</div>';
    }

    function wireTabs(host) {
        host.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
            ui.tab = b.dataset.tab;
            render(host);
        }));
    }

    function thumbHtml(path) {
        return path
            ? '<img class="hist-thumb" alt="Item photo" data-sign-bucket="item-gallery" data-sign-path="' + esc(path) + '">'
            : '<div class="hist-thumb hist-thumb--empty" aria-hidden="true"><i data-lucide="image"></i></div>';
    }

    function whereLabel(e) {
        return esc(e.project_name || '—') + ' · ' + esc(e.work_name || 'Main Contract');
    }

    function latestHtml(latest) {
        if (!latest) return '<span class="req-muted">No history yet</span>';
        return '<span class="att-pill ' + RA.entryPill(latest) + '">' + esc(latest.label) + '</span>' +
            '<div class="req-muted">' + whereLabel(latest) + ' · ' + esc(RA.entryDateLabel(latest)) + '</div>';
    }

    function searchArgs(offset) {
        return { p_query: ui.text, p_kind: ui.kind || null, p_category: ui.category || null, p_folder: ui.folder || null,
                 p_from: ui.from || null, p_to: ui.to || null, p_limit: PAGE, p_offset: offset };
    }

    // ── Search ──────────────────────────────────────────────────────

    async function renderSearch(host, append) {
        if (!append) {
            ui.items = [];
            ui.hasMore = false;
            host.innerHTML = '<div class="att-stack"><div class="att-empty">Searching…</div></div>';
        }
        let look, page;
        try {
            look = await loadLookups();
            page = await RA.rpc('pr_office_history_search', searchArgs(ui.items.length));
        } catch (e) { RA.fail(host, e); return; }
        ui.items = ui.items.concat((page && page.items) || []);
        ui.hasMore = !!(page && page.has_more);
        const opt = (v, label, cur) => '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(label) + '</option>';
        host.innerHTML =
            '<div class="att-stack">' +
              RA.head('Item history', 'Items the company asked for before, with their dated history and reviewed photos. Workers see a project\'s history only when Item history is on for it (Projects tab). No prices are ever shown.') +
              tabsHtml() +
              '<form class="att-toolbar" data-search>' +
                '<div class="att-search-wrap"><i data-lucide="search"></i>' +
                  '<input class="att-search" type="search" name="text" aria-label="Search" placeholder="Name, other names, brand, size, category…" value="' + esc(ui.text) + '"></div>' +
                '<select class="att-filter" name="kind" aria-label="Kind">' +
                  opt('', 'Materials and tools', ui.kind) + opt('material', 'Materials', ui.kind) + opt('tool', 'Tools', ui.kind) + '</select>' +
                '<select class="att-filter" name="category" aria-label="Category">' + opt('', 'All categories', ui.category) +
                  look.categories.map(c => opt(c, c, ui.category)).join('') + '</select>' +
                '<select class="att-filter" name="folder" aria-label="Project">' + opt('', 'All projects', ui.folder) +
                  look.projects.map(p => opt(p.folder_id, p.name, ui.folder)).join('') + '</select>' +
                '<label class="req-toggle">From <input class="att-input" type="date" name="from" value="' + esc(ui.from) + '"></label>' +
                '<label class="req-toggle">To <input class="att-input" type="date" name="to" value="' + esc(ui.to) + '"></label>' +
                '<button class="att-btn att-btn--primary" type="submit">Search</button>' +
              '</form>' +
              '<div class="att-card"><div class="att-card-body" style="padding:0">' +
                '<div class="req-table-wrap"><table class="att-table"><thead><tr><th></th><th>Item</th><th>Kind</th><th>Brand</th><th>Latest</th></tr></thead><tbody>' +
                ui.items.map(i =>
                    '<tr class="req-row" tabindex="0" data-item="' + esc(i.id) + '">' +
                      '<td>' + thumbHtml(i.cover_path) + '</td>' +
                      '<td><strong>' + esc(RA.itemLabel(i)) + '</strong>' +
                        (i.active ? '' : ' <span class="att-pill att-pill--hidden">No longer listed</span>') +
                        ((i.aliases || []).length ? '<div class="req-muted">Also called: ' + esc(i.aliases.join(', ')) + '</div>' : '') + '</td>' +
                      '<td>' + (i.kind === 'tool' ? 'Tool' : 'Material') + '</td>' +
                      '<td>' + esc(i.brand || '—') + '</td>' +
                      '<td>' + latestHtml(i.latest) + '</td></tr>').join('') +
                '</tbody></table></div>' +
                (ui.items.length ? '' : '<div class="att-empty">No item matches. Items are added in the Catalogue tab.</div>') +
              '</div></div>' +
              (ui.hasMore ? '<div class="req-actions"><button class="att-btn" type="button" data-more>Show more</button></div>' : '') +
            '</div>';
        wireTabs(host);
        host.querySelector('[data-search]').addEventListener('submit', e => {
            e.preventDefault();
            const f = e.target;
            Object.assign(ui, { text: f.text.value.trim(), kind: f.kind.value, category: f.category.value,
                                folder: f.folder.value, from: f.from.value, to: f.to.value });
            renderSearch(host);
        });
        const more = host.querySelector('[data-more]');
        if (more) more.addEventListener('click', () => { more.disabled = true; renderSearch(host, true); });
        host.querySelectorAll('[data-item]').forEach(row => {
            const open = () => { ui.itemId = row.dataset.item; renderItem(host); };
            row.addEventListener('click', e => { if (!e.target.closest('img')) open(); });   // a thumbnail click opens the photo only
            row.addEventListener('keydown', e => { if (e.key === 'Enter') open(); });
        });
        RA.icons();
        RA.signImages(host);
    }

    // ── One item ────────────────────────────────────────────────────

    function photoCard(p) {
        const approved = p.status === 'approved';
        return '<div class="hist-photo-card' + (approved ? '' : ' hist-photo-card--retired') + '">' +
            '<img class="req-photo" alt="Item photo" data-sign-bucket="item-gallery" data-sign-path="' + esc(p.path) + '">' +
            '<div>' + (p.is_cover ? '<span class="att-pill att-pill--done">Cover</span> ' : '') +
              (approved ? '' : '<span class="att-pill att-pill--hidden">Retired</span>') + '</div>' +
            '<div class="req-muted">' + esc(SOURCE_LABEL[p.source] || '') + (p.approved_by_name ? ' · ' + esc(p.approved_by_name) : '') + '</div>' +
            (approved
                ? '<div class="req-actions">' +
                    (p.is_cover ? '' : '<button class="att-btn" type="button" data-act="cover" data-id="' + esc(p.id) + '">Make cover</button>') +
                    '<button class="att-btn att-btn--warn" type="button" data-act="retire-photo" data-id="' + esc(p.id) + '">Retire…</button></div>'
                : '<div class="req-muted">' + esc(p.retire_reason || '') + '</div>') +
            '</div>';
    }

    function entryRow(e) {
        const canRetire = e.entry_kind === 'reference' && !e.retired;
        return '<tr>' +
            '<td><span class="att-pill ' + RA.entryPill(e) + '">' + esc(e.label) + '</span>' +
              (e.retired ? ' <span class="att-pill att-pill--hidden">Retired</span>' : '') + '</td>' +
            '<td>' + whereLabel(e) + '</td>' +
            '<td>' + esc(RA.entryDateLabel(e)) + '</td>' +
            '<td>' + (e.quantity === null || e.quantity === undefined ? '—' : esc(RA.formatQty(e.quantity)) + ' ' + esc(e.unit || '')) + '</td>' +
            '<td>' + esc([e.description, e.note].filter(Boolean).join(' — ') || '—') +
              (e.requester_name ? '<div class="req-muted">Requested by ' + esc(e.requester_name) + '</div>' : '') + '</td>' +
            '<td>' + (canRetire ? '<button class="att-btn att-btn--warn" type="button" data-act="retire-ref" data-id="' + esc(e.entry_id) + '">Retire…</button>' : '') + '</td>' +
            '</tr>';
    }

    async function renderItem(host) {
        host.innerHTML = '<div class="att-stack"><div class="att-empty">Loading the item…</div></div>';
        let look, item;
        try {
            look = await loadLookups();
            item = await RA.rpc('pr_office_history_item', { p_item: ui.itemId });
        } catch (e) { RA.fail(host, e); return; }
        const rerender = () => renderItem(host);
        const photos = item.photos || [];
        const entries = item.entries || [];
        const about = [item.kind === 'tool' ? 'Tool' : 'Material', item.brand, item.category,
                       (item.aliases || []).length ? 'also called ' + item.aliases.join(', ') : '',
                       item.active ? '' : 'no longer listed — workers cannot request it again'].filter(Boolean).join(' · ');
        host.innerHTML =
            '<div class="att-stack">' +
              '<div class="req-actions"><button class="att-btn" type="button" data-back><i data-lucide="arrow-left"></i> Back to results</button></div>' +
              RA.head(RA.itemLabel(item), about) +
              '<div class="att-card"><div class="att-card-head"><div><div class="att-card-title">Photos</div>' +
                '<div class="att-card-sub">Workers see approved photos only, cover first. Retired photos stay here for the record.</div></div>' +
                '<div class="att-card-tools"><button class="att-btn att-btn--primary" type="button" data-act="upload">Upload photo…</button></div></div>' +
                '<div class="att-card-body">' +
                  (photos.length ? '<div class="hist-photos">' + photos.map(photoCard).join('') + '</div>' : '<div class="att-empty">No photos yet.</div>') +
              '</div></div>' +
              '<div class="att-card"><div class="att-card-head"><div><div class="att-card-title">History</div>' +
                '<div class="att-card-sub">Requests matched to this item and hand-entered historical references, newest first. A historical reference creates no expense, stock or purchase.</div></div>' +
                '<div class="att-card-tools"><button class="att-btn att-btn--primary" type="button" data-act="add-ref">Add historical reference…</button></div></div>' +
                '<div class="att-card-body" style="padding:0">' +
                  (entries.length
                    ? '<div class="req-table-wrap"><table class="att-table"><thead><tr><th>What</th><th>Where</th><th>When</th><th>Quantity</th><th>Details</th><th></th></tr></thead><tbody>' +
                      entries.map(entryRow).join('') + '</tbody></table></div>'
                    : '<div class="att-empty">No history yet.</div>') +
              '</div></div>' +
            '</div>';
        const stack = host.firstElementChild;
        stack.querySelector('[data-back]').addEventListener('click', () => { ui.itemId = null; renderSearch(host); });
        stack.addEventListener('click', e => {
            const b = e.target.closest('[data-act]');
            if (!b || b.disabled) return;
            const act = b.dataset.act;
            if (act === 'add-ref') refModal(item, look, rerender);
            else if (act === 'retire-ref') retireRefModal(entries.find(x => x.entry_id === b.dataset.id), rerender);
            else if (act === 'upload') RA.gallery.uploadModal(item, rerender);
            else if (act === 'cover') RA.gallery.setCover(b.dataset.id, b, rerender);
            else if (act === 'retire-photo') RA.gallery.retireModal(photos.find(p => p.id === b.dataset.id), rerender);
        });
        RA.icons();
        RA.signImages(host);
    }

    // ── Historical references ───────────────────────────────────────

    // A project's own Additional Works (owner/staff may read their folders).
    async function workOptions(projectId) {
        const { data, error } = await root.sbClient.from('folders').select('id, name, completed_at')
            .eq('parent_folder_id', projectId).order('name');
        if (error) throw error;
        return data || [];
    }

    function refModal(item, look, rerender) {
        RA.modal({
            title: 'Add historical reference',
            sub: RA.itemLabel(item) + ' — for items used before WorkMate. It creates no expense, stock or purchase.',
            body:
                '<div class="att-field att-span"><label for="histProject">Project</label><select class="att-input" id="histProject" name="project">' +
                  '<option value="">Choose a project…</option>' +
                  look.projects.map(p => '<option value="' + esc(p.folder_id) + '">' + esc(p.name) + (p.completed ? ' (completed)' : '') + '</option>').join('') +
                '</select></div>' +
                '<div class="att-field att-span"><label for="histWork">Main Contract or Additional Works</label>' +
                  '<select class="att-input" id="histWork" name="work" disabled><option value="">Choose a project first</option></select></div>' +
                '<div class="att-field att-span"><label for="histDesc">What was used</label>' +
                  '<input class="att-input" id="histDesc" name="description" maxlength="300" placeholder="e.g. Outlets for the kitchen counter"></div>' +
                '<div class="att-field"><label for="histPrecision">Date</label><select class="att-input" id="histPrecision" name="precision">' +
                  '<option value="exact">Exact day</option><option value="approximate">Around a month</option><option value="unknown">Date unknown</option></select></div>' +
                '<div class="att-field"><label for="histDate">Day <span class="att-hint-inline">(for "Around", any day in that month)</span></label>' +
                  '<input class="att-input" id="histDate" name="date" type="date"></div>' +
                '<div class="att-field att-span"><label for="histNote">Where this came from <span class="att-hint-inline">(optional)</span></label>' +
                  '<input class="att-input" id="histNote" name="note" maxlength="300" placeholder="e.g. old Messenger photo, site diary"></div>' +
                '<div class="att-info att-span"><i data-lucide="eye"></i><div>Workers can read what was used and where it came from. Never type a price, an amount or a person\'s name.</div></div>',
            submitLabel: 'Add reference',
            onOpen: (form) => {
                form.project.addEventListener('change', async () => {
                    const pid = form.project.value;
                    form.work.disabled = true;
                    if (!pid) { form.work.innerHTML = '<option value="">Choose a project first</option>'; return; }
                    form.work.innerHTML = '<option value="">Loading…</option>';
                    let children = [];
                    try {
                        children = await workOptions(pid);
                    } catch (e) {
                        const box = form.querySelector('[data-error]');
                        box.textContent = 'Couldn\'t load the Additional Works (' + RA.errorMessage(e) + '). Main Contract is still available.';
                        box.style.display = 'block';
                    }
                    form.work.innerHTML = '<option value="' + esc(pid) + '">Main Contract</option>' +
                        children.map(c => '<option value="' + esc(c.id) + '">' + esc(c.name) + (c.completed_at ? ' (completed)' : '') + '</option>').join('');
                    form.work.disabled = false;
                });
                form.precision.addEventListener('change', () => {
                    form.date.disabled = form.precision.value === 'unknown';
                    if (form.date.disabled) form.date.value = '';
                });
            },
            onSubmit: async (form) => {
                if (!form.project.value || !form.work.value) throw new Error('BAD_DESTINATION');
                const ref = { description: form.description.value, precision: form.precision.value, date: form.date.value };
                const problem = RA.refProblem(ref);
                if (problem) throw new Error(problem);
                await RA.rpc('pr_office_add_ref', {
                    p_item: item.id,
                    p_folder: form.project.value,
                    p_work: form.work.value,
                    p_description: ref.description.trim(),
                    p_ref_date: ref.precision === 'unknown' ? null : ref.date,
                    p_precision: ref.precision,
                    p_source_note: form.note.value.trim(),
                });
            },
            onDone: rerender,
        });
    }

    function retireRefModal(entry, rerender) {
        if (!entry) return;
        RA.modal({
            title: 'Retire historical reference',
            sub: 'Workers stop seeing it. The office keeps it, marked retired, with your reason.',
            body: '<div class="att-field att-span"><label for="histReason">Why</label>' +
                  '<input class="att-input" id="histReason" name="reason" maxlength="200" placeholder="e.g. wrong item, entered twice"></div>',
            submitLabel: 'Retire',
            warn: true,
            onSubmit: async (form) => {
                if (!form.reason.value.trim()) throw new Error('REASON_REQUIRED');
                await RA.rpc('pr_office_retire_ref', { p_ref: entry.entry_id, p_reason: form.reason.value.trim() });
            },
            onDone: rerender,
        });
    }

    // ── The view ────────────────────────────────────────────────────

    async function render(host) {
        if (ui.tab === 'review') {
            if (!RA.gallery) { RA.fail(host, new Error('The photo review screen did not load. Reload the page.')); return; }
            return RA.gallery.renderReview(host, { tabsHtml, wireTabs });
        }
        return ui.itemId ? renderItem(host) : renderSearch(host);
    }

    RA.views.reqHistory = render;
})(typeof window !== 'undefined' ? window : globalThis);
