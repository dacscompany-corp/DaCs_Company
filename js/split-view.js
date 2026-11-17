// ════════════════════════════════════════════════════════════════════
// Split view — the shared "triage split view" frame for the office
// screens (spec docs/superpowers/specs/2026-11-14-office-split-view-
// redesign-design.md, variant B of the "Dacs Web Admin" design).
//
// A screen hands the frame its tabs and rows and fills the panel; it
// keeps its own data loading, RPCs and role checks. The frame knows
// nothing about money and must never draw an amount of its own.
//
//   SplitView.render(host, cfg)   header · tabs with counts · list | panel
//   SplitView.panelHtml(p)        the right-hand panel, Dacs Web Detail order
//   SplitView.form(panel, opts)   a form in the panel (RA.modal's contract)
//   NavCounts                     the red "needs you" counts on the tabs
//
// Works in a browser (window.SplitView, window.NavCounts) and in Node for
// tests/split-view.test.js (module.exports = pure half).
// ════════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';

    // ── Pure helpers ────────────────────────────────────────────────

    // Tones → the existing pill classes in css/attendance-admin.css, whose
    // colours already equal the design's (green done, gold to-do, red
    // problem, blue check, taupe site works, grey neutral).
    const PILL = {
        done: 'att-pill att-pill--done',
        gold: 'att-pill att-pill--working',
        red: 'att-pill att-pill--abandoned',
        solidRed: 'att-pill sv-pill--solid-red',
        check: 'att-pill att-pill--pc',
        pm: 'att-pill att-pill--pm',
        none: 'att-pill att-pill--none',
    };
    function pillClass(tone) {
        return PILL[tone] || PILL.none;
    }

    // The tab a screen opens on: the one the user picked this session, if
    // it still exists; otherwise the first — unless that is a "needs you"
    // tab with nothing in it, which would open the screen on a blank list.
    // Then the first later tab that has something in it (narrower tabs such
    // as the Queue's Urgent are often empty exactly when "needs you" is),
    // or the second tab when every tab is empty.
    function pickDefaultTab(tabs, saved) {
        const list = tabs || [];
        if (saved && list.some(t => t.id === saved)) return saved;
        if (!list.length) return null;
        if (list[0].needs && !list[0].count && list.length > 1) {
            const full = list.slice(1).find(t => t.count > 0);
            return (full || list[1]).id;
        }
        return list[0].id;
    }

    function flatIds(groups) {
        const out = [];
        (groups || []).forEach(g => (g.rows || []).forEach(r => out.push(r.id)));
        return out;
    }

    // Next: the row after the selected one. When an action moved the
    // selected row out of the list, the row that now sits at its old
    // place is the next one — never back to the top.
    function nextAfter(ids, id, lastIndex) {
        const list = ids || [];
        const i = id === null || id === undefined ? -1 : list.indexOf(id);
        if (i >= 0) return list[i + 1] || null;
        return list[lastIndex] || null;
    }

    // Next, by the order the user saw when they chose the item: an action
    // can move the chosen row to another group (arranged → "Nothing left to
    // arrange", or a later batch), and Next must still go to the row that
    // was below it then. The first row of that old order still in the list
    // wins; without a snapshot, plain nextAfter.
    function nextFrom(order, id, ids, lastIndex) {
        const list = ids || [];
        if (!order || !order.length) return nextAfter(list, id, lastIndex);
        const i = order.indexOf(id);
        if (i < 0) return nextAfter(list, id, lastIndex);
        for (let k = i + 1; k < order.length; k++) {
            if (order[k] !== id && list.indexOf(order[k]) >= 0) return order[k];
        }
        return null;
    }

    // How a re-render treats the panel. The same item keeps its panel
    // element (an open form, its scroll, no flash, no refetch); only a
    // refresh the screen asks for (after an action) reloads it — into the
    // same element, so the old content stays until the new answer lands.
    function panelPlan(current, panelId, selected, refresh) {
        if (!selected) return { reuse: false, reload: false };
        const reuse = selected === current && panelId === selected;
        return { reuse: reuse, reload: !reuse || !!refresh };
    }

    // What the panel shows: the item asked for (even one outside the
    // list), else on a desktop the first row. A phone shows the list until
    // a row is tapped.
    function pickSelected(ids, wanted, isPhone) {
        if (wanted) return wanted;
        if (isPhone) return null;
        return (ids || [])[0] || null;
    }

    // Only the newest request may fill the panel: a slow answer to an
    // earlier click must not overwrite a later one.
    function seq() {
        let n = 0;
        return {
            next() { n += 1; return n; },
            isLatest(k) { return k === n; },
        };
    }

    function badgeText(n) {
        const x = Number(n);
        if (n === null || n === undefined || !isFinite(x) || x <= 0) return null;
        return x > 99 ? '99+' : String(Math.floor(x));
    }

    const pure = { pillClass, pickDefaultTab, flatIds, nextAfter, nextFrom, panelPlan, pickSelected, seq, badgeText };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = pure;
        return;
    }

    // ── Browser half ────────────────────────────────────────────────

    function esc(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function icons() {
        if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
    }

    function isPhone() {
        return !!(root.matchMedia && root.matchMedia('(max-width: 720px)').matches);
    }

    // Per screen (cfg.key), for this session: list scroll, where the
    // selected row sat (for Next), which item the panel shows, and whether
    // a phone is showing the panel rather than the list.
    const mem = {};
    function memFor(key) {
        return mem[key] || (mem[key] = { scroll: 0, lastIndex: 0, current: null, phonePanel: false });
    }

    // A screen that opens an item from code (e.g. "open this request")
    // calls this first, so a phone shows the item rather than the list.
    function openPanel(key) {
        memFor(key).phonePanel = true;
    }

    function pills(list) {
        return (list || []).filter(p => p && p.text)
            .map(p => '<span class="' + pillClass(p.tone) + '">' + esc(p.text) + '</span>').join('');
    }

    function rowHtml(r, selected) {
        const cls = 'sv-row' + (r.id === selected ? ' is-selected' : '') +
            (r.stripe === 'red' ? ' sv-row--stripe-red' : '') + (r.tint ? ' sv-row--tint' : '') + (r.dim ? ' sv-row--dim' : '');
        return '<button type="button" class="' + cls + '" data-id="' + esc(r.id) + '"' +
                (r.id === selected ? ' aria-current="true"' : '') + '>' +
            '<span class="sv-row-main">' +
              '<span class="sv-row-title">' + esc(r.title) + '</span>' +
              (r.sub ? '<span class="sv-row-sub">' + esc(r.sub) + '</span>' : '') +
              (r.meta ? '<span class="sv-row-meta">' + esc(r.meta) + '</span>' : '') +
              ((r.chips || []).length ? '<span class="sv-row-chips">' + pills(r.chips) + '</span>' : '') +
            '</span>' +
            '<span class="sv-row-side">' +
              (r.right ? '<span class="sv-row-right">' + esc(r.right) + '</span>' : '') +
              (r.pill ? pills([r.pill]) : '') +
            '</span>' +
            '</button>';
    }

    function groupHtml(g, selected) {
        return '<div class="sv-group">' +
            '<div class="sv-group-head sv-tone-' + esc(g.tone || 'ink') + '">' +
              '<span class="sv-group-title">' + esc(g.title) + '</span>' +
              (g.badge ? pills([g.badge]) : '') +
              (g.meta ? '<span class="sv-group-meta">' + g.meta + '</span>' : '') +
              '<span class="sv-group-count">' + (g.rows || []).length + '</span>' +
            '</div>' +
            (g.rows || []).map(r => rowHtml(r, selected)).join('') +
            '</div>';
    }

    function menuHtml(items) {
        return '<div class="sv-menu" role="menu" hidden>' + items.map((it, i) =>
            '<button type="button" role="menuitem" class="sv-menu-item" data-sv-more="' + i + '">' +
              (it.icon ? '<i data-lucide="' + esc(it.icon) + '"></i>' : '') + esc(it.label) + '</button>').join('') +
            '</div>';
    }

    // Fill the window below the split's own top, so the list and the panel
    // scroll on their own. Phones scroll the page instead (CSS).
    function measure(scope) {
        (scope || document).querySelectorAll('.sv-split').forEach(el => {
            const top = el.getBoundingClientRect().top + (root.scrollY || 0);
            el.style.setProperty('--sv-top', Math.max(0, Math.round(top)) + 'px');
        });
    }
    if (root.addEventListener) root.addEventListener('resize', () => measure());

    // cfg: see docs/superpowers/plans/2026-11-14-office-split-view-phase1.md, Task 2.
    // Plain strings (titles, subs, row text, pill text) are escaped here.
    // Fields that take HTML — aside, notice, listTools, group meta, empty,
    // and in the panel the sections, facts values, history html and
    // actions — must arrive already escaped by the screen (RA.esc).
    function render(host, cfg) {
        const m = memFor(cfg.key);
        const phone = isPhone();

        // Keep the list where it was and the search box focused across
        // re-renders of the same screen.
        const oldBody = host.dataset.svKey === cfg.key ? host.querySelector('.sv-list-body') : null;
        if (oldBody) m.scroll = oldBody.scrollTop;
        const oldSearch = host.querySelector('.sv-search input');
        const hadFocus = !!(oldSearch && document.activeElement === oldSearch);
        const caret = hadFocus ? oldSearch.selectionStart : null;
        const oldPanel = host.dataset.svKey === cfg.key ? host.querySelector('.sv-panel') : null;
        const oldPanelBody = oldPanel ? oldPanel.querySelector('.sv-panel-body') : null;
        const oldPanelScroll = oldPanelBody ? oldPanelBody.scrollTop : 0;

        const ids = flatIds(cfg.groups);
        const selected = phone ? (m.phonePanel ? (cfg.selectedId || null) : null) : pickSelected(ids, cfg.selectedId, false);
        const plan = panelPlan(m.current, oldPanel ? (oldPanel.dataset.svId || null) : null, selected, cfg.refreshPanel);
        // A newly chosen item: remember the order the user sees now, for Next.
        if (selected && selected !== m.current) {
            m.order = ids.slice();
            if (ids.indexOf(selected) >= 0) m.lastIndex = ids.indexOf(selected);
        }
        m.current = selected;

        const tabs = (cfg.tabs || []).map(t => {
            const on = t.id === cfg.tab;
            const hasCount = t.count !== null && t.count !== undefined;
            const cntCls = 'sv-tab-n' + (on ? ' is-on' : (t.needs && t.count ? ' is-needs' : ''));
            return '<button type="button" role="tab" class="sv-tab' + (on ? ' is-on' : '') + '" aria-selected="' + on + '" data-sv-tab="' + esc(t.id) + '">' +
                esc(t.label) + (hasCount ? '<span class="' + cntCls + '">' + esc(t.count) + '</span>' : '') + '</button>';
        }).join('');

        host.dataset.svKey = cfg.key;
        host.innerHTML =
            '<div class="sv' + (selected && phone ? ' sv--panel' : '') + '">' +
              '<div class="sv-head">' +
                '<h2 class="sv-title">' + esc(cfg.title) + '</h2>' +
                (cfg.sub ? '<span class="sv-sub">' + esc(cfg.sub) + '</span>' : '<span class="sv-sub"></span>') +
                (cfg.aside ? '<div class="sv-head-aside">' + cfg.aside + '</div>' : '') +
                (cfg.live ? '<span class="sv-live"><span class="sv-live-dot"></span>' + esc(cfg.live) + '</span>' : '') +
                ((cfg.more || []).length ? '<div class="sv-more"><button type="button" class="sv-icon-btn" data-sv-more-toggle aria-haspopup="menu" aria-expanded="false" aria-label="More"><i data-lucide="ellipsis"></i></button>' + menuHtml(cfg.more) + '</div>' : '') +
                (cfg.primary ? '<button type="button" class="sv-primary" data-sv-primary>' +
                    (cfg.primary.icon ? '<i data-lucide="' + esc(cfg.primary.icon) + '"></i>' : '') + esc(cfg.primary.label) + '</button>' : '') +
              '</div>' +
              (cfg.notice || '') +
              '<div class="sv-tabs"><div class="sv-tabs-track" role="tablist">' + tabs + '</div></div>' +
              '<div class="sv-split">' +
                '<section class="sv-list" aria-label="List">' +
                  '<div class="sv-list-tools">' +
                    '<label class="sv-search"><i data-lucide="search"></i>' +
                      '<input type="search" aria-label="Search" placeholder="' + esc((cfg.search || {}).placeholder || 'Search…') + '" value="' + esc((cfg.search || {}).value || '') + '"></label>' +
                    (cfg.listTools || '') +
                    (cfg.listMeta ? '<div class="sv-list-meta" aria-live="polite">' + esc(cfg.listMeta) + '</div>' : '') +
                  '</div>' +
                  '<div class="sv-list-body">' +
                    (ids.length ? (cfg.groups || []).filter(g => (g.rows || []).length).map(g => groupHtml(g, selected)).join('')
                                : '<div class="sv-empty">' + (cfg.empty || '') + '</div>') +
                  '</div>' +
                '</section>' +
                '<section class="sv-panel" aria-live="polite"></section>' +
              '</div>' +
            '</div>';

        const rootEl = host.querySelector('.sv');
        let panel = host.querySelector('.sv-panel');
        // The same item keeps its panel element: an open form, what was typed
        // in it and where it was scrolled survive a search keystroke, a filter
        // or a tab change, with no refetch.
        if (plan.reuse) {
            panel.replaceWith(oldPanel);
            panel = oldPanel;
            const pb = panel.querySelector('.sv-panel-body');
            if (pb) pb.scrollTop = oldPanelScroll;
        }
        const body = host.querySelector('.sv-list-body');
        body.scrollTop = m.scroll;

        function show(id) {
            m.current = id;
            m.order = flatIds(cfg.groups);
            const i = m.order.indexOf(id);
            if (i >= 0) m.lastIndex = i;
            host.querySelectorAll('.sv-row').forEach(b => {
                const on = b.dataset.id === id;
                b.classList.toggle('is-selected', on);
                if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
            });
            if (isPhone()) { m.phonePanel = true; rootEl.classList.add('sv--panel'); root.scrollTo && root.scrollTo(0, 0); }
            panel.dataset.svId = id;
            panel.dataset.svRestore = '';
            cfg.onSelect(id, panel);
        }

        host.querySelectorAll('[data-sv-tab]').forEach(b => b.addEventListener('click', () => {
            if (b.dataset.svTab !== cfg.tab && cfg.onTab) cfg.onTab(b.dataset.svTab);
        }));
        const search = host.querySelector('.sv-search input');
        search.addEventListener('input', () => { if (cfg.search && cfg.search.onInput) cfg.search.onInput(search.value); });
        if (hadFocus) { search.focus(); try { search.setSelectionRange(caret, caret); } catch (e) { /* type=search */ } }
        body.addEventListener('click', e => {
            const b = e.target.closest('.sv-row');
            if (b) show(b.dataset.id);
        });
        if (cfg.onListTools) cfg.onListTools(rootEl);
        if (cfg.onEmpty && !ids.length) cfg.onEmpty(rootEl);
        const prim = host.querySelector('[data-sv-primary]');
        if (prim) prim.addEventListener('click', () => cfg.primary.onClick());
        const toggle = host.querySelector('[data-sv-more-toggle]');
        if (toggle) {
            const menu = toggle.parentNode.querySelector('.sv-menu');
            const close = () => { menu.hidden = true; toggle.setAttribute('aria-expanded', 'false'); document.removeEventListener('click', outside, true); };
            const outside = e => { if (!toggle.parentNode.contains(e.target)) close(); };
            toggle.addEventListener('click', () => {
                if (!menu.hidden) { close(); return; }
                menu.hidden = false; toggle.setAttribute('aria-expanded', 'true');
                document.addEventListener('click', outside, true);
            });
            menu.addEventListener('keydown', e => { if (e.key === 'Escape') { close(); toggle.focus(); } });
            menu.querySelectorAll('[data-sv-more]').forEach(b => b.addEventListener('click', () => {
                close(); cfg.more[+b.dataset.svMore].onClick();
            }));
        }
        // Next and Back live in the panel, which the screen redraws and the
        // frame may carry over between renders: one listener per panel
        // element, reading the state of the latest render.
        panel._svState = {
            next() {
                const n = nextFrom(m.order, m.current, flatIds(cfg.groups), m.lastIndex);
                if (!n) return;
                show(n);
                const row = host.querySelector('.sv-row[data-id="' + (root.CSS && CSS.escape ? CSS.escape(n) : n) + '"]');
                if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
            },
            back() {
                m.phonePanel = false;
                rootEl.classList.remove('sv--panel');
            },
        };
        if (!panel._svBound) {
            panel._svBound = true;
            panel.addEventListener('click', e => {
                const st = panel._svState;
                if (e.target.closest('[data-sv-next]')) st.next();
                else if (e.target.closest('[data-sv-back]')) st.back();
            });
        }

        measure(host);
        icons();
        if (selected) {
            panel.dataset.svId = selected;
            if (plan.reload) {
                // A reload of the same item keeps its content until the new
                // answer lands, then restores the scroll (fill()).
                panel.dataset.svRestore = plan.reuse ? String(oldPanelScroll) : '';
                cfg.onSelect(selected, panel);
            }
        } else {
            panel.dataset.svId = '';
            panel.innerHTML = '<div class="sv-panel-empty">Pick something on the left.</div>';
        }
    }

    // Put a panel's html in place, keeping its scroll position when the
    // same item is redrawn (after an action) rather than a new one opened.
    function fill(panel, html) {
        panel.innerHTML = html;
        const body = panel.querySelector('.sv-panel-body');
        if (body && panel.dataset.svRestore) body.scrollTop = +panel.dataset.svRestore;
        panel.dataset.svRestore = '';
        icons();
    }

    // The right-hand panel, in the order of the design's "Dacs Web Detail":
    // kicker · title · sub · pills, then the sections, then a footer bar
    // with the actions on the left and Next on the right.
    function panelHtml(p) {
        return '<div class="sv-panel-in">' +
            '<header class="sv-panel-head">' +
              '<button type="button" class="sv-back" data-sv-back><i data-lucide="arrow-left"></i>Back</button>' +
              (p.kicker ? '<div class="sv-kicker">' + esc(p.kicker) + '</div>' : '') +
              '<h3 class="sv-panel-title">' + esc(p.title) + '</h3>' +
              (p.sub ? '<div class="sv-panel-sub">' + esc(p.sub) + '</div>' : '') +
              ((p.pills || []).length ? '<div class="sv-panel-pills">' + pills(p.pills) + '</div>' : '') +
            '</header>' +
            '<div class="sv-panel-body">' + (p.sections || []).filter(Boolean).join('') + '</div>' +
            ((p.actions || p.nextLabel) ? '<footer class="sv-panel-foot">' +
              '<div class="sv-panel-actions">' + (p.actions || '') + '</div>' +
              (p.nextLabel ? '<button type="button" class="sv-next" data-sv-next>' + esc(p.nextLabel) + '<i data-lucide="arrow-right"></i></button>' : '') +
            '</footer>' : '') +
            '</div>';
    }

    function section(title, html) {
        return '<section class="sv-sec">' + (title ? '<div class="sv-sec-title">' + esc(title) + '</div>' : '') + html + '</section>';
    }

    const NOTICE_TONES = { red: 1, gold: 1, green: 1, grey: 1 };
    function notice(tone, icon, title, html) {
        const t = NOTICE_TONES[tone] ? tone : 'grey';
        return '<div class="sv-notice sv-notice--' + t + '"><i data-lucide="' + esc(icon || 'info') + '"></i>' +
            '<div><div class="sv-notice-title">' + esc(title) + '</div>' + (html ? '<div class="sv-notice-body">' + html + '</div>' : '') + '</div></div>';
    }

    // rows: [label, valueHtml, mono?] — a row with no value is left out.
    function facts(rows) {
        const list = (rows || []).filter(r => r && r[1] !== null && r[1] !== undefined && r[1] !== '');
        return '<dl class="sv-facts">' + list.map(r =>
            '<div class="sv-fact"><dt>' + esc(r[0]) + '</dt><dd' + (r[2] ? ' class="sv-mono"' : '') + '>' + r[1] + '</dd></div>').join('') + '</dl>';
    }

    // items: [{ when, html }], newest first. Above collapsedAbove items the
    // list starts folded, as the old request page did.
    function history(items, collapsedAbove) {
        const list = items || [];
        const inner = '<ul class="sv-history">' + list.map(it =>
            '<li><div class="sv-history-when">' + esc(it.when) + '</div><div class="sv-history-text">' + it.html + '</div></li>').join('') + '</ul>';
        const open = !(collapsedAbove >= 0) || list.length <= collapsedAbove;
        return '<details class="sv-sec sv-hist"' + (open ? ' open' : '') + '><summary class="sv-sec-title">History <span class="sv-hist-n">' +
            list.length + '</span></summary>' + inner + '</details>';
    }

    // In a panel the error keeps Back: on a phone the list is hidden while a
    // panel shows, so without it the office would be stuck on the error.
    function error(where, message) {
        const inPanel = !!(where.classList && where.classList.contains('sv-panel'));
        where.innerHTML =
            (inPanel ? '<div class="sv-error-back"><button type="button" class="sv-back" data-sv-back><i data-lucide="arrow-left"></i>Back</button></div>' : '') +
            '<div class="sv-error"><i data-lucide="alert-triangle"></i><div>' + esc(message) + '</div></div>';
        icons();
    }

    function defaultMessage(err) {
        return String((err && (err.message || err.error_description)) || err || 'Something went wrong.');
    }

    // A form in the panel, with RA.modal's contract: onSubmit throws to
    // keep the form open with the message; success runs onDone. Cancel and
    // Escape run onCancel (usually: redraw the item).
    function form(panel, opts) {
        panel.innerHTML =
            '<div class="sv-panel-in">' +
              '<header class="sv-panel-head">' +
                (opts.kicker ? '<div class="sv-kicker">' + esc(opts.kicker) + '</div>' : '') +
                '<h3 class="sv-panel-title">' + esc(opts.title) + '</h3>' +
                (opts.sub ? '<div class="sv-panel-sub">' + esc(opts.sub) + '</div>' : '') +
              '</header>' +
              '<form class="sv-form" autocomplete="off" novalidate>' +
                '<div class="sv-panel-body sv-form-body">' + (opts.body || '') +
                  '<div class="sv-form-error" data-error role="alert" hidden></div>' +
                '</div>' +
                '<footer class="sv-panel-foot"><div class="sv-panel-actions">' +
                  '<button type="submit" class="att-btn ' + (opts.warn ? 'att-btn--warn' : 'att-btn--primary') + '" data-submit>' + esc(opts.submitLabel || 'Save') + '</button>' +
                  '<button type="button" class="att-btn" data-cancel>Cancel</button>' +
                '</div></footer>' +
              '</form>' +
            '</div>';
        const f = panel.querySelector('form');
        const errorBox = panel.querySelector('[data-error]');
        const submit = panel.querySelector('[data-submit]');
        let closed = false;
        function close() { closed = true; f.removeEventListener('keydown', onKey); }
        function cancel() { if (closed) return; close(); if (opts.onCancel) opts.onCancel(); }
        function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); cancel(); } }
        f.addEventListener('keydown', onKey);
        panel.querySelector('[data-cancel]').addEventListener('click', cancel);
        f.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (closed || submit.disabled) return;
            errorBox.hidden = true;
            submit.disabled = true;
            try {
                await opts.onSubmit(f);
                close();
                if (opts.onDone) opts.onDone();
            } catch (err) {
                errorBox.textContent = (opts.errorMessage || defaultMessage)(err);
                errorBox.hidden = false;
                submit.disabled = false;
            }
        });
        if (opts.onOpen) opts.onOpen(f);
        const first = f.querySelector('input:not([type=hidden]):not([type=radio]), select, textarea');
        if (first) first.focus();
        const body = panel.querySelector('.sv-panel-body');
        if (body) body.scrollTop = 0;
        icons();
        return { close };
    }

    // ── NavCounts — the red "needs you" counts on the top tabs ──────
    //
    // A section registers a loader that returns its "Needs you" count for
    // THIS account; the chrome (js/admin.js) draws empty badge spans
    // [data-nav-count="<section>"] and asks for a refresh of the sections
    // the account can see. A screen that already has the data sets the
    // count itself. A count is a number of items, never an amount; a
    // failed loader shows no badge, never a wrong one.
    const counts = {};
    const loaders = {};
    let running = null, runningAt = 0;

    function paint() {
        document.querySelectorAll('[data-nav-count]').forEach(el => {
            const text = badgeText(counts[el.dataset.navCount]);
            el.textContent = text || '';
            el.hidden = !text;
        });
        if (typeof root.syncPtabPill === 'function') root.syncPtabPill(false);
    }
    function set(section, n) {
        counts[section] = (n === null || n === undefined) ? null : Number(n);
        paint();
    }
    function get(section) {
        return counts[section] === undefined ? null : counts[section];
    }
    function register(section, loader) {
        loaders[section] = loader;
    }
    // Calls closer than a second apart share the running refresh (the
    // chrome is redrawn several times while the portal opens).
    function refresh(sections) {
        const now = Date.now();
        if (running && now - runningAt < 1000) return running;
        runningAt = now;
        running = (async () => {
            for (const section of sections || []) {
                const load = loaders[section];
                if (!load) continue;
                try { set(section, await load()); }
                catch (e) { set(section, null); }
            }
        })();
        return running;
    }

    root.NavCounts = { register, set, get, refresh, paint };

    root.SplitView = Object.assign({}, pure, {
        render, panelHtml, section, notice, facts, history, pills, form, error, fill, openPanel, esc, isPhone,
    });
})(typeof window !== 'undefined' ? window : globalThis);
