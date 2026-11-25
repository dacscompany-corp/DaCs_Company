// ════════════════════════════════════════════════════════════════════
// Office frame (v5) — the shared frame of the office screens (spec
// docs/superpowers/specs/2026-11-14-office-split-view-redesign-design.md
// rev 2, design docs/design/office-v5). The file keeps its Phase 1 name.
//
// A screen hands the frame its tabs and cards and fills the pop-up; it
// keeps its own data loading, RPCs and role checks. The frame knows
// nothing about money and must never draw an amount of its own.
//
//   SplitView.render(host, cfg)   header · tiles · tabs with counts · cards
//   SplitView.panelHtml(p)        one item in the pop-up (What to do now, Next)
//   SplitView.page(panel, p)      the shell for an existing item page
//   SplitView.form(panel, opts)   a form in the pop-up (RA.modal's contract)
//   SplitView.closePop()          close the pop-up (screen changes call it)
//   NavCounts                     the red "needs you" counts on the tabs
// Existing .att-modal forms (RA.modal, Work Plan, Attendance) are styled
// by css/split-view.css to the v5 form and take the item's place.
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

    // What the pop-up shows (v5): only the item asked for — a card the
    // user clicked or a link from elsewhere. Nothing opens by itself; ids is
    // kept so call sites need not change.
    function pickSelected(ids, wanted) {
        return wanted || null;
    }

    // A top tab's count (D5): the sum of the link counts this account sees
    // under it. A count at zero, a failed one (null) or a nonsense value
    // adds nothing; a sum of zero shows no badge (null).
    function navTotal(counts, keys) {
        let sum = 0;
        (keys || []).forEach(k => {
            const n = Number((counts || {})[k]);
            if ((counts || {})[k] !== null && isFinite(n) && n > 0) sum += n;
        });
        return sum > 0 ? sum : null;
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

    // Weekly bonus day dots (v5): one letter per day.
    const DOTS = {
        o: ['On time', ''], l: ['Late', 'L'], m: ['Missed', '✕'],
        u: ['Could not be verified', '?'], t: ['Not yet', ''], x: ['Not a working day', '–'],
    };
    function dotsOf(letters) {
        return String(letters || '').split('').filter(c => DOTS[c]).map(c => ({ tone: c, label: DOTS[c][0], ch: DOTS[c][1] }));
    }

    // How many cards are ticked (Shopping list → "Record purchase (N)").
    function tickCount(groups) {
        let n = 0;
        (groups || []).forEach(g => (g.rows || []).forEach(r => { if (r.tick && r.tick.on) n += 1; }));
        return n;
    }

    function badgeText(n) {
        const x = Number(n);
        if (n === null || n === undefined || !isFinite(x) || x <= 0) return null;
        return x > 99 ? '99+' : String(Math.floor(x));
    }

    const pure = { pillClass, pickDefaultTab, flatIds, nextAfter, nextFrom, panelPlan, pickSelected, navTotal, dotsOf, tickCount, seq, badgeText };

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

    // Per screen (cfg.key), for this session: which item the pop-up shows,
    // the order the user saw when they opened it (for Next), where it sat,
    // whether "How …" is open, and the latest cfg (Next reads its groups).
    const mem = {};
    function memFor(key) {
        return mem[key] || (mem[key] = { lastIndex: 0, current: null, order: null, howOpen: false, cfg: null, host: null });
    }

    function pills(list) {
        return (list || []).filter(p => p && p.text)
            .map(p => '<span class="' + pillClass(p.tone) + '">' + esc(p.text) + '</span>').join('');
    }

    // One card (v5): status pill, chips and the mono figure on top; title,
    // sub-line and meta; the next-step button (only when the screen gives
    // one) and "Open ›" at the bottom.
    function cardHtml(r, openId) {
        const on = r.id === openId;
        const cls = 'sv-card' + (on ? ' is-open' : '') + (r.stripe === 'red' ? ' sv-card--stripe-red' : '') +
            (r.tint ? ' sv-card--tint' : '') + (r.dim ? ' sv-card--dim' : '');
        return '<div class="' + cls + '" role="button" tabindex="0" data-id="' + esc(r.id) + '"' + (on ? ' aria-current="true"' : '') + '>' +
            '<div class="sv-card-top">' +
              (r.tick ? '<button type="button" class="sv-tick' + (r.tick.on ? ' is-on' : '') + '" data-sv-tick aria-pressed="' + !!r.tick.on + '" aria-label="' +
                  esc(r.tick.label || 'Tick') + '" title="' + esc(r.tick.label || 'Tick') + '"><i data-lucide="check"></i></button>' : '') +
              (r.pill ? pills([r.pill]) : '') + pills(r.chips) +
              (r.right ? '<span class="sv-card-right">' + esc(r.right) + '</span>' : '') +
            '</div>' +
            '<div class="sv-card-title">' + esc(r.title) + '</div>' +
            (r.sub ? '<div class="sv-card-sub">' + esc(r.sub) + '</div>' : '') +
            (r.meta ? '<div class="sv-card-meta">' + esc(r.meta) + '</div>' : '') +
            (r.dots ? '<div class="sv-dots">' + dotsOf(r.dots).map(d =>
                '<span class="sv-dot sv-dot--' + d.tone + '" title="' + esc(d.label) + '">' + esc(d.ch) + '</span>').join('') + '</div>' : '') +
            '<div class="sv-card-foot">' +
              (r.nextLabel ? '<button type="button" class="sv-card-step" data-sv-next-step>' + esc(r.nextLabel) + '</button>' : '') +
              '<span class="sv-card-open">Open ›</span>' +
            '</div>' +
            '</div>';
    }

    function groupHtml(g, openId) {
        const rows = g.rows || [];
        // A group with no title is just its cards (a screen with one list).
        const head = g.title ? '<div class="sv-group-head">' +
              '<span class="sv-group-title sv-tone-' + esc(g.tone || 'ink') + '">' + esc(g.title) + '</span>' +
              '<span class="sv-group-count">· ' + rows.length + '</span>' +
              (g.badge ? pills([g.badge]) : '') +
              (g.meta ? '<div class="sv-group-meta">' + g.meta + '</div>' : '') +
            '</div>' : '';
        return '<section class="sv-group">' + head +
            '<div class="sv-cards">' + rows.map(r => cardHtml(r, openId)).join('') + '</div>' +
            '</section>';
    }

    function menuHtml(items) {
        return '<div class="sv-menu" role="menu" hidden>' + items.map((it, i) =>
            '<button type="button" role="menuitem" class="sv-menu-item" data-sv-more="' + i + '">' +
              (it.icon ? '<i data-lucide="' + esc(it.icon) + '"></i>' : '') + esc(it.label) + '</button>').join('') +
            '</div>';
    }

    // "How …": explanations and legends that are text, folded by default.
    function howHtml(how, open) {
        if (!how) return '';
        return '<details class="sv-how"' + (open ? ' open' : '') + '><summary><i data-lucide="circle-help"></i><span>' + esc(how.title) + '</span></summary>' +
            '<div class="sv-how-body">' +
              (how.text ? '<p class="sv-how-text">' + esc(how.text) + '</p>' : '') +
              (how.rows || []).map(r => '<div class="sv-how-row"><strong>' + esc(r[0]) + '</strong><span>' + esc(r[1]) + '</span></div>').join('') +
            '</div></details>';
    }

    // ── The pop-up (one per page, on <body>) ────────────────────────
    // Screens fill its .sv-panel through cfg.onSelect; living outside every
    // screen host, it survives the screen's re-renders untouched.
    let pop = null;
    function popEl() {
        if (pop) return pop;
        pop = document.createElement('div');
        pop.id = 'svPop';
        pop.className = 'sv-pop';
        pop.hidden = true;
        pop.innerHTML =
            '<div class="sv-pop-scrim" data-sv-scrim></div>' +
            '<div class="sv-pop-box" role="dialog" aria-modal="true" aria-labelledby="svPopTitle">' +
              '<button type="button" class="sv-pop-x" data-sv-close aria-label="Close"><i data-lucide="x"></i></button>' +
              '<section class="sv-panel" aria-live="polite"></section>' +
            '</div>';
        document.body.appendChild(pop);
        pop.addEventListener('click', e => {
            if (e.target.closest('[data-sv-close]')) { closePop(); return; }
            // A click outside the box closes it — but never drops an open
            // form: a stray click must not lose what was typed.
            // A page that holds typed work (page({ keep: true }), e.g. Record
            // purchase) is never closed by a stray click either.
            if (e.target.closest('[data-sv-scrim]')) { if (!popPanel().querySelector('form.sv-form, [data-sv-keep]')) closePop(); return; }
            const m = mem[pop.dataset.svKey];
            if (m && e.target.closest('[data-sv-next]')) nextIn(m);
        });
        // Escape closes the pop-up; with a form open it goes back to the
        // item instead, wherever the focus is (the form also stops its own
        // Escape). Tab and Shift+Tab stay inside the box.
        document.addEventListener('keydown', e => {
            if (!pop || pop.hidden) return;
            // An existing form (.att-modal: RA.modal, Work Plan, Attendance)
            // open over the item owns Escape and Tab until it closes.
            if (document.querySelector('.att-modal')) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                const back = pop.querySelector('.sv-panel .sv-form-back');
                if (back) { back.click(); return; }
                // A kept page (Record purchase) closes only through ✕ or its
                // own Cancel, never by Escape.
                if (pop.querySelector('.sv-panel [data-sv-keep]')) return;
                closePop();
                return;
            }
            if (e.key === 'Tab') trapTab(e, pop.querySelector('.sv-pop-box'));
        });
        return pop;
    }
    function trapTab(e, box) {
        const list = Array.from(box.querySelectorAll('button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])'))
            .filter(el => !el.disabled && el.offsetParent !== null);
        if (!list.length) return;
        const first = list[0], last = list[list.length - 1];
        if (!box.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
        else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    function popPanel() { return popEl().querySelector('.sv-panel'); }
    // A new item gets a new, empty panel element: listeners a screen put on
    // the old one (panel.onclick, addEventListener) can never fire for the
    // next item or another screen. A refresh of the same item keeps it.
    function freshPanel() {
        const old = popPanel();
        const fresh = old.cloneNode(false);
        fresh.dataset.svId = '';
        fresh.dataset.svRestore = '';
        old.replaceWith(fresh);
        return fresh;
    }
    function popOwner() { return pop && !pop.hidden ? pop.dataset.svKey : null; }

    function openPop(key) {
        const p = popEl();
        p.dataset.svKey = key;
        if (p.hidden) {
            p.hidden = false;
            // The page behind stays still while the pop-up is open.
            document.documentElement.classList.add('sv-pop-on');
            const x = p.querySelector('.sv-pop-x');
            if (x) x.focus({ preventScroll: true });
        }
        return popPanel();
    }

    // Close the pop-up: tell the screen (it forgets the item — it must not
    // redraw from here) and put focus back on the item's card.
    function closePop() {
        if (!pop || pop.hidden) return;
        const m = mem[pop.dataset.svKey];
        pop.hidden = true;
        document.documentElement.classList.remove('sv-pop-on');
        const panel = popPanel();
        panel.dataset.svId = '';
        if (!m) return;
        const was = m.current;
        m.current = null;
        let card = null;
        if (m.host) {
            m.host.querySelectorAll('.sv-card.is-open').forEach(c => { c.classList.remove('is-open'); c.removeAttribute('aria-current'); });
            card = was ? m.host.querySelector('.sv-card[data-id="' + (root.CSS && CSS.escape ? CSS.escape(was) : was) + '"]') : null;
        }
        if (card && card.offsetParent !== null) card.focus({ preventScroll: true });
        if (m.cfg && m.cfg.onClose) m.cfg.onClose(was);
    }

    function markOpen(m, id) {
        if (!m.host) return;
        m.host.querySelectorAll('.sv-card').forEach(c => {
            const on = c.dataset.id === id;
            c.classList.toggle('is-open', on);
            if (on) c.setAttribute('aria-current', 'true'); else c.removeAttribute('aria-current');
        });
    }

    // Open one item in the pop-up. start: it was opened by the card's
    // next-step button, so the screen begins that step.
    function showIn(m, id, start) {
        const cfg = m.cfg;
        m.current = id;
        m.order = flatIds(cfg.groups);
        const i = m.order.indexOf(id);
        if (i >= 0) m.lastIndex = i;
        markOpen(m, id);
        openPop(cfg.key);
        popEl().querySelector('.sv-pop-box').classList.remove('sv-pop-box--wide');
        const panel = freshPanel();
        panel.dataset.svId = id;
        panel.dataset.svRestore = '';
        cfg.onSelect(id, panel, { start: !!start });
    }

    // Open one item of a screen from code (a screen whose content is its own,
    // e.g. Attendance's worker's day): that screen's onSelect fills the pop-up.
    function openItem(key, id) {
        const m = mem[key];
        if (!m || !m.cfg || !m.host || !m.host.isConnected) return false;
        showIn(m, id, false);
        return true;
    }

    // Next: the card that was after this one when it was opened.
    function nextIn(m) {
        const n = nextFrom(m.order, m.current, flatIds(m.cfg.groups), m.lastIndex);
        if (!n) return;
        const order = m.order;
        showIn(m, n, false);
        if (order) m.order = order;
        const card = m.host && m.host.querySelector('.sv-card[data-id="' + (root.CSS && CSS.escape ? CSS.escape(n) : n) + '"]');
        if (card && card.scrollIntoView) card.scrollIntoView({ block: 'nearest' });
    }

    // A switch that is off (Stock, Tools): one card with its title, the
    // sentence and the switch-on button (who may press it is the screen's).
    function offHtml(off) {
        return '<div class="sv-off"><div class="sv-off-title">' + esc(off.title) + '</div>' +
            (off.text ? '<div class="sv-off-text">' + esc(off.text) + '</div>' : '') +
            (off.button ? '<button type="button" class="sv-primary" data-sv-off>' + esc(off.button.label) + '</button>' : '') +
            '</div>';
    }

    // An existing item page in the pop-up: the shell draws kicker, title,
    // pills, sub, "What to do now" (p.step) and the footer with Next, and
    // returns the element the page's own renderer fills. p.wide: the
    // largest pages and forms (Record purchase) get a wider box. p.keep: the
    // page holds typed work — a click outside or Escape never closes it.
    function page(panel, p) {
        popEl().querySelector('.sv-pop-box').classList.toggle('sv-pop-box--wide', !!p.wide);
        panel.innerHTML = '<div class="sv-panel-in">' +
            '<header class="sv-panel-head">' +
              (p.kicker ? '<div class="sv-kicker">' + esc(p.kicker) + '</div>' : '') +
              (p.title ? '<h3 class="sv-panel-title" id="svPopTitle">' + esc(p.title) + '</h3>' : '') +
              ((p.pills || []).length ? '<div class="sv-panel-pills">' + pills(p.pills) + '</div>' : '') +
            '</header>' +
            '<div class="sv-panel-body sv-page-body">' +
              (p.sub ? '<div class="sv-panel-sub">' + esc(p.sub) + '</div>' : '') +
              (p.step || '') +
              '<div class="sv-page-host"' + (p.keep ? ' data-sv-keep' : '') + '></div>' +
            '</div>' +
            // The item's buttons (p.actions, already escaped) on the left of
            // the footer and Next on the right, as panelHtml draws them.
            ((p.actions || p.nextLabel) ? '<footer class="sv-panel-foot"><div class="sv-panel-actions">' + (p.actions || '') + '</div>' +
              (p.nextLabel ? '<button type="button" class="sv-next" data-sv-next>' + esc(p.nextLabel) + '<i data-lucide="chevron-right"></i></button>' : '') +
              '</footer>' : '') +
            '</div>';
        icons();
        return panel.querySelector('.sv-page-host');
    }

    // cfg: see docs/superpowers/plans/2026-11-16-office-v5-phase1.md, Task 2,
    // and 2026-11-16-office-v5-remaining-screens.md, Task 1 (seg, tiles, lede,
    // strips, off, legend, dots, ticks, tickBar, search: false).
    // Plain strings (titles, subs, card text, pill text, help, how) are
    // escaped here. Fields that take HTML — notice, aside, toolbar, group
    // meta, empty, and in the pop-up the sections, step, facts values,
    // history html and actions — must arrive already escaped (RA.esc).
    function render(host, cfg) {
        const m = memFor(cfg.key);
        m.cfg = cfg;
        m.host = host;

        // Keep the search box focused across re-renders of the same screen.
        const oldSearch = host.dataset.svKey === cfg.key ? host.querySelector('.sv-search input') : null;
        const hadFocus = !!(oldSearch && document.activeElement === oldSearch);
        const caret = hadFocus ? oldSearch.selectionStart : null;

        const ids = flatIds(cfg.groups);
        const selected = pickSelected(ids, cfg.selectedId);
        const owned = popOwner() === cfg.key;
        const panelId = owned ? (popPanel().dataset.svId || null) : null;
        const plan = panelPlan(m.current, panelId, selected, cfg.refreshPanel);
        // A newly opened item: remember the order the user sees now, for Next.
        if (selected && selected !== m.current) {
            m.order = ids.slice();
            if (ids.indexOf(selected) >= 0) m.lastIndex = ids.indexOf(selected);
        }

        const tabs = (cfg.tabs || []).map(t => {
            const on = t.id === cfg.tab;
            const hasCount = t.count !== null && t.count !== undefined;
            const cntCls = 'sv-tab-n' + (on ? ' is-on' : '') + (t.needs && t.count ? ' is-needs' : '');
            return '<button type="button" role="tab" class="sv-tab' + (on ? ' is-on' : '') + '" aria-selected="' + on + '" data-sv-tab="' + esc(t.id) + '">' +
                esc(t.label) + (hasCount ? '<span class="' + cntCls + '">' + esc(t.count) + '</span>' : '') + '</button>';
        }).join('');
        const help = (cfg.tabs || []).filter(t => t.id === cfg.tab).map(t => t.help || '')[0] || '';
        const prim = cfg.primary;
        const primIcon = prim ? (/^(Add|New|Register|Create)\b/.test(prim.label) ? 'plus' : prim.icon) : null;
        const seg = cfg.seg ? '<div class="sv-seg" role="group">' + cfg.seg.options.map(o =>
            '<button type="button" class="sv-seg-btn' + (o.id === cfg.seg.value ? ' is-on' : '') + '" aria-pressed="' + (o.id === cfg.seg.value) + '" data-sv-seg="' + esc(o.id) + '">' +
            esc(o.label) + '</button>').join('') + '</div>' : '';
        const tiles = (cfg.tiles || []).length ? '<div class="sv-tiles">' + cfg.tiles.map(t =>
            '<button type="button" class="sv-tile' + (t.tab === cfg.tab ? ' is-on' : '') + '" data-sv-tile="' + esc(t.tab || '') + '">' +
              '<span class="sv-tile-n sv-tone-' + esc(t.tone || 'ink') + '">' + esc(t.n) + '</span><span class="sv-tile-label">' + esc(t.label) + '</span></button>').join('') + '</div>' : '';
        const legend = (cfg.legend || []).length ? '<div class="sv-legend">' + cfg.legend.map(l =>
            '<span class="sv-legend-item"><span class="sv-dot sv-dot--' + esc(l.tone) + '"></span>' + esc(l.label) + '</span>').join('') + '</div>' : '';
        const ticked = cfg.tickBar ? tickCount(cfg.groups) : 0;

        host.dataset.svKey = cfg.key;
        host.innerHTML =
            '<div class="sv">' +
              '<div class="sv-head">' +
                '<div class="sv-head-text">' +
                  '<h2 class="sv-title">' + esc(cfg.title) + '</h2>' +
                  (cfg.sub ? '<div class="sv-sub">' + esc(cfg.sub) + '</div>' : '') +
                '</div>' +
                (cfg.live ? '<span class="sv-live"><span class="sv-live-dot"></span>' + esc(cfg.live) + '</span>' : '') +
                seg +
                ((cfg.more || []).length ? '<div class="sv-more"><button type="button" class="sv-more-btn" data-sv-more-toggle aria-haspopup="menu" aria-expanded="false">More<i data-lucide="ellipsis"></i></button>' + menuHtml(cfg.more) + '</div>' : '') +
                (prim ? '<button type="button" class="sv-primary" data-sv-primary>' +
                    (primIcon ? '<i data-lucide="' + esc(primIcon) + '"></i>' : '') + esc(prim.label) + '</button>' : '') +
              '</div>' +
              (cfg.notice || '') +
              (cfg.off ? offHtml(cfg.off) : (
              tiles +
              (cfg.lede ? '<div class="sv-lede">' + esc(cfg.lede) + '</div>' : '') +
              (cfg.strips || []).map(t => '<div class="sv-strip"><i data-lucide="info"></i><span>' + esc(t) + '</span></div>').join('') +
              howHtml(cfg.how, m.howOpen) +
              '<div class="sv-tabs" role="tablist">' + tabs + '</div>' +
              (help ? '<div class="sv-tab-help">' + esc(help) + '</div>' : '') +
              (cfg.aside ? '<div class="sv-aside">' + cfg.aside + '</div>' : '') +
              '<div class="sv-toolbar">' +
                (cfg.search === false ? '' : '<label class="sv-search"><i data-lucide="search"></i>' +
                  '<input type="search" aria-label="Search" placeholder="' + esc((cfg.search || {}).placeholder || 'Search…') + '" value="' + esc((cfg.search || {}).value || '') + '"></label>') +
                (cfg.toolbar || '') +
                (cfg.showing ? '<span class="sv-showing" aria-live="polite">' + esc(cfg.showing) + '</span>' : '') +
              '</div>' +
              legend +
              // cfg.custom: a tab that keeps its own content (sections, tables,
              // its own buttons) inside the frame; cfg.onCustom(el) fills it.
              (cfg.custom ? '<div class="sv-custom" data-sv-custom></div>' :
              '<div class="sv-body">' +
                (ids.length ? (cfg.groups || []).filter(g => (g.rows || []).length).map(g => groupHtml(g, selected)).join('')
                            : '<div class="sv-empty"><i data-lucide="circle-check"></i><div>' + (cfg.empty || '') + '</div></div>') +
              '</div>') +
              (cfg.tickBar && ticked > 0 ? '<div class="sv-tickbar"><button type="button" class="sv-tickbar-btn" data-sv-tickbar>' +
                  esc(cfg.tickBar.label) + ' (' + ticked + ')</button></div>' : ''))) +
            '</div>';

        const rootEl = host.querySelector('.sv');
        const show = (id, start) => showIn(m, id, start);
        host.querySelectorAll('[data-sv-tab]').forEach(b => b.addEventListener('click', () => {
            if (b.dataset.svTab === cfg.tab) return;
            if (popOwner() === cfg.key) closePop();
            if (cfg.onTab) cfg.onTab(b.dataset.svTab);
        }));
        const how = host.querySelector('.sv-how');
        if (how) how.addEventListener('toggle', () => { m.howOpen = how.open; });
        const search = host.querySelector('.sv-search input');
        if (search) {
            search.addEventListener('input', () => { if (cfg.search && cfg.search.onInput) cfg.search.onInput(search.value); });
            if (hadFocus) { search.focus(); try { search.setSelectionRange(caret, caret); } catch (e) { /* type=search */ } }
        }
        host.querySelectorAll('[data-sv-seg]').forEach(b => b.addEventListener('click', () => {
            if (b.dataset.svSeg === cfg.seg.value) return;
            if (popOwner() === cfg.key) closePop();
            cfg.seg.onChange(b.dataset.svSeg);
        }));
        host.querySelectorAll('[data-sv-tile]').forEach(b => b.addEventListener('click', () => {
            const tab = b.dataset.svTile;
            if (!tab || tab === cfg.tab || !cfg.onTab) return;
            if (popOwner() === cfg.key) closePop();
            cfg.onTab(tab);
        }));
        const offBtn = host.querySelector('[data-sv-off]');
        if (offBtn) offBtn.addEventListener('click', () => cfg.off.button.onClick());
        const tickBar = host.querySelector('[data-sv-tickbar]');
        if (tickBar) tickBar.addEventListener('click', () => cfg.tickBar.onClick());

        const body = host.querySelector('.sv-body');
        if (body) body.addEventListener('click', e => {
            const tick = e.target.closest('[data-sv-tick]');
            if (tick) {
                // A tick box chooses the card for the tick bar; it never
                // opens the card.
                e.stopPropagation();
                const card = tick.closest('.sv-card');
                if (card && cfg.onTick) cfg.onTick(card.dataset.id, tick.getAttribute('aria-pressed') !== 'true');
                return;
            }
            const step = e.target.closest('[data-sv-next-step]');
            if (step) {
                // The card's next-step button: open the item and start that
                // step. Stop here, so the press is not also a card click.
                e.stopPropagation();
                const card = step.closest('.sv-card');
                if (card) show(card.dataset.id, true);
                return;
            }
            const card = e.target.closest('.sv-card');
            if (!card) return;
            if (card.dataset.id === m.current && popOwner() === cfg.key) closePop();
            else show(card.dataset.id, false);
        });
        if (body) body.addEventListener('keydown', e => {
            const card = e.target.classList && e.target.classList.contains('sv-card') ? e.target : null;
            if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); show(card.dataset.id, false); }
        });

        if (cfg.onToolbar) cfg.onToolbar(rootEl);
        const custom = host.querySelector('[data-sv-custom]');
        if (custom && cfg.onCustom) cfg.onCustom(custom);
        if (cfg.onEmpty && !ids.length) cfg.onEmpty(rootEl);
        const primBtn = host.querySelector('[data-sv-primary]');
        if (primBtn) primBtn.addEventListener('click', () => cfg.primary.onClick());
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
        icons();

        if (selected) {
            m.current = selected;
            if (plan.reload) {
                // A reload of the same item keeps its element and content
                // until the new answer lands, then restores its scroll
                // (fill()); another item (a link from elsewhere) gets a
                // fresh element.
                openPop(cfg.key);
                const panel = plan.reuse ? popPanel() : freshPanel();
                const pb = panel.querySelector('.sv-panel-body');
                panel.dataset.svId = selected;
                panel.dataset.svRestore = plan.reuse && pb ? String(pb.scrollTop) : '';
                cfg.onSelect(selected, panel, {});
            }
        } else if (owned) {
            closePop();
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

    // One item in the pop-up (v5): kicker · title · pills on top; then the
    // sub-line, "What to do now" (p.step, from nextStep()), the sections;
    // a footer with the actions on the left and Next on the right.
    function panelHtml(p) {
        return '<div class="sv-panel-in">' +
            '<header class="sv-panel-head">' +
              (p.kicker ? '<div class="sv-kicker">' + esc(p.kicker) + '</div>' : '') +
              '<h3 class="sv-panel-title" id="svPopTitle">' + esc(p.title) + '</h3>' +
              ((p.pills || []).length ? '<div class="sv-panel-pills">' + pills(p.pills) + '</div>' : '') +
            '</header>' +
            '<div class="sv-panel-body">' +
              (p.sub ? '<div class="sv-panel-sub">' + esc(p.sub) + '</div>' : '') +
              (p.step || '') +
              (p.sections || []).filter(Boolean).join('') +
            '</div>' +
            ((p.actions || p.nextLabel) ? '<footer class="sv-panel-foot">' +
              '<div class="sv-panel-actions">' + (p.actions || '') + '</div>' +
              (p.nextLabel ? '<button type="button" class="sv-next" data-sv-next>' + esc(p.nextLabel) + '<i data-lucide="chevron-right"></i></button>' : '') +
            '</footer>' : '') +
            '</div>';
    }

    // "What to do now": one sentence and at most one button. buttonHtml is
    // the screen's own button for that action (same data-act as the real
    // one inside the item), already escaped; '' for a sentence alone.
    function nextStep(text, buttonHtml) {
        return '<div class="sv-step"><div class="sv-step-main"><div class="sv-step-k">What to do now</div>' +
            '<div class="sv-step-text">' + esc(text) + '</div></div>' + (buttonHtml || '') + '</div>';
    }

    // A short "done" message at the bottom of the screen.
    let toastTimer = null;
    function toast(text) {
        let el = document.getElementById('svToast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'svToast';
            el.className = 'sv-toast';
            el.setAttribute('role', 'status');
            document.body.appendChild(el);
        }
        el.innerHTML = '<i data-lucide="check"></i><span>' + esc(text) + '</span>';
        el.hidden = false;
        icons();
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
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

    // An error message. In the pop-up the box keeps its ✕, so the office
    // is never stuck on it.
    function error(where, message) {
        where.innerHTML = '<div class="sv-error"><i data-lucide="alert-triangle"></i><div>' + esc(message) + '</div></div>';
        icons();
    }

    function defaultMessage(err) {
        return String((err && (err.message || err.error_description)) || err || 'Something went wrong.');
    }

    // A form in the pop-up, with RA.modal's contract: onSubmit throws to
    // keep the form open with the message; success runs onDone and shows
    // opts.doneText as a toast. "Back without saving", Cancel and Escape
    // run onCancel (usually: redraw the item) — Escape stops there, so it
    // does not also close the pop-up.
    function form(panel, opts) {
        panel.innerHTML =
            '<div class="sv-panel-in">' +
              '<header class="sv-panel-head sv-form-head">' +
                '<button type="button" class="sv-form-back" data-cancel><i data-lucide="arrow-left"></i>Back without saving</button>' +
                (opts.kicker ? '<div class="sv-kicker">' + esc(opts.kicker) + '</div>' : '') +
                '<h3 class="sv-panel-title sv-form-title" id="svPopTitle">' + esc(opts.title) + '</h3>' +
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
        function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); } }
        f.addEventListener('keydown', onKey);
        panel.querySelectorAll('[data-cancel]').forEach(b => b.addEventListener('click', cancel));
        f.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (closed || submit.disabled) return;
            errorBox.hidden = true;
            submit.disabled = true;
            try {
                await opts.onSubmit(f);
                close();
                if (opts.doneText) toast(opts.doneText);
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
        // A top tab: the sum of its links' counts (D5); zero shows nothing.
        document.querySelectorAll('[data-nav-total]').forEach(el => {
            const text = badgeText(navTotal(counts, el.dataset.navTotal.split(' ')));
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
        render, panelHtml, page, section, notice, facts, history, pills, form, nextStep, toast, closePop, open: openItem, error, fill, esc, isPhone,
    });
})(typeof window !== 'undefined' ? window : globalThis);
