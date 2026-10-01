// ════════════════════════════════════════════════════════════════════
// PUBLIC SITE (index.html) — v2, 2026-10-01.
// One page, four sections (#/home, #/services, #/projects, #/book); this file
// shows one at a time, runs the header / curtain / scroll effects, and the
// Home, Services and Projects behaviour. The booking wizard is js/booking.js;
// testimonials + feedback + floating buttons are js/site-widgets.js.
// Ported from docs/design/dacs-website-v2.dc.html (Studio page dropped).
// ════════════════════════════════════════════════════════════════════
(function (root) {
  'use strict';

  const PAGES = ['home', 'services', 'projects', 'book'];

  // Design key 'pN' → the portfolio export already in the repo.
  const img = (k) => encodeURI('assets/images/portfolio/DaCs_AIRBNB PROFILE.pdf (' + String(k).slice(1) + ').png');

  // ── Data (copied from the design, Task 5/6/7 fill these in) ──
  const SERVICES = [
    { id:'vertical-construction', category:'Construction', title:'Vertical Construction', short:'Our core service: multi-storey building construction from structure to finishing.', description:'Our main service. We build multi-storey residential and commercial structures, handling structural works, formworks, partitions and finishing under one team.', features:['Carpentry Works','Wall Partitions','Painting Works','Glass & Aluminum Installation','Structural Works','Form Works'], images:[['p11','Mallari Bldg. — Proposal'],['p13','AUM Bldg. — Proposal']] },
    { id:'interior-design', category:'Design', title:'Interior Design', short:'Creating functional and beautiful interior spaces tailored to your lifestyle and preferences.', description:'We craft interior spaces that balance aesthetics with function — transforming bare units into fully personalized living environments. From concept boards to construction-ready design plans, our interior designers handle every detail.', features:['Space planning & layout optimization','Material & finish selection','Furniture & lighting design','Concept to turnover coordination'], images:[['p1','Avida Towers Vita — Proposal'],['p5','San Lorenzo Place — Proposal'],['p9','Health Works — Proposal']] },
    { id:'architectural-design', category:'Design', title:'Architectural Design', short:'Comprehensive architectural planning and design solutions that bring your vision to life.', description:'Our architects deliver comprehensive building plans that meet local codes, reflect your design vision, and serve as the precise blueprint for your construction team. We specialize in both residential and commercial projects.', features:['Floor plan & elevation design','Permit-ready documentation','Residential & commercial projects','3D architectural visualization'], images:[['p11','Mallari Bldg. — Proposal'],['p13','AUM Bldg. — Proposal']] },
    { id:'engineering-design', category:'Design', title:'Engineering Design', short:'Structural and engineering solutions ensuring safety, efficiency, and long-term durability.', description:'Structural integrity is non-negotiable. Our civil and structural engineers design systems that are safe, efficient, and built to last — coordinating with architects to ensure every design is buildable and code-compliant.', features:['Structural analysis & design','Electrical & mechanical systems','Foundation & load calculations','Code compliance & safety checks'], images:[['p13','AUM Bldg. — Proposal'],['p11','Mallari Bldg. — Proposal']] },
    { id:'interior-renovation', category:'Construction', title:'Interior Renovation', short:'Transforming existing spaces with quality craftsmanship, attention to detail, and commitment to excellence.', description:"We bring new life to existing spaces through precision renovation work. Whether it's a condo unit, clinic, or commercial space, our team handles the full scope — from demolition to finishing — with minimal disruption.", features:['Full & partial renovation','Condo & residential units','Commercial space fit-outs','Clean, on-schedule delivery'], images:[['p5','San Lorenzo Place — Proposal'],['p1','Avida Towers Vita — Proposal'],['p9','Health Works — Proposal']] },
    { id:'residential-construction', category:'Construction', title:'Residential Construction', short:'Building dream homes from foundation to finish with expert planning and quality construction throughout.', description:'From single-family homes to multi-story residential buildings, we manage the full build — from groundbreaking to final handover. We use quality materials, trusted subcontractors, and tight project management to deliver on time.', features:['Single & multi-family homes','Foundation to finishing work','Regular progress updates','On-time project delivery'], images:[['p11','Mallari Bldg. — Proposal'],['p1','Avida Towers Vita — Proposal'],['p5','San Lorenzo Place — Proposal']] },
    { id:'ground-up-construction', category:'Construction', title:'Ground-Up Construction', short:'Complete construction services from site preparation to final touches, delivering fully finished spaces ready for occupancy.', description:'We handle complete construction from bare land to fully built structure. Our team coordinates every phase — site preparation, structural work, MEP systems, and interior finishing — under one roof for seamless execution.', features:['Site preparation & excavation','Structural framing & concrete work','MEP systems installation','Complete interior & exterior finish'], images:[['p13','AUM Bldg. — Proposal'],['p11','Mallari Bldg. — Proposal']] },
    { id:'commercial-renovation', category:'Construction', title:'Commercial Renovation', short:'Large-scale commercial projects including subdivisions and townships, executed with precision planning and professional coordination.', description:'We specialize in transforming commercial spaces — offices, clinics, retail stores, and multi-use buildings. Our commercial renovation team delivers polished results that reflect your brand and serve your customers.', features:['Office & retail fit-outs','Clinic & healthcare spaces','Multi-use building renovation','Brand-aligned design execution'], images:[['p9','Health Works — Proposal'],['p13','AUM Bldg. — Proposal']] },
    { id:'allied-services', category:'Allied', dark:true, title:'Collaborations & Allied Services', short:'Electrical and plumbing works delivered with our partner trades.', description:'Working with trusted partner trades, we deliver the electrical and plumbing systems your building needs, coordinated with our design and construction teams.', features:['Electrical Works','Plumbing Works'], images:[['p13','AUM Bldg. — Proposal'],['p11','Mallari Bldg. — Proposal']] }
  ];
  const SCOPE = {
    'vertical-construction':['Carpentry Works','Wall Partitions','Painting Works','Glass & Aluminum Installation','Structural Works','Form Works'],
    'allied-services':['Electrical Works','Plumbing Works'],
    'interior-design':['Space Assessment','Design Conceptualization','Space Planning','Style Guide / Mood Board','Material & Finish Selection','Furniture & Lighting Design','3D Visualization','Working Drawings'],
    'architectural-design':['Site Analysis','Schematic Design','Floor Plans & Elevations','3D Architectural Visualization','Design Development','Permit-ready Documentation','Construction Drawings'],
    'engineering-design':['Structural Analysis & Design','Foundation & Load Calculations','Electrical Systems Design','Mechanical Systems Design','Plumbing & Sanitary Design','Code Compliance & Safety Checks'],
    'interior-renovation':['Site Inspection','Demolition & Hauling','Masonry Works','Ceiling & Wall Partitions','Tile & Flooring Works','Carpentry & Cabinetry','Painting Works','Final Cleaning & Turnover'],
    'residential-construction':['Housing Projects','Civil & Architectural Works','Structural Works','Masonry Works','Roofing Works','Electrical & Plumbing Works','Finishing Works','Turnover & Handover'],
    'ground-up-construction':['Site Preparation & Excavation','Formworks','Rebar Works','Concrete & Structural Works','MEP Systems Installation','Glass & Aluminum Installation','Exterior & Interior Finishing'],
    'commercial-renovation':['Office Fit-outs','Retail & Storefront Works','Clinic & Healthcare Spaces','Multi-use Building Renovation','Glass & Aluminum Installation','Signage & Branding Integration','Brand-aligned Design Execution']
  };
  const AREAS = [
    { city:'Quezon City', region:'Metro Manila · Home base', n:3, q:'Quezon City, Metro Manila' },
    { city:'Makati', region:'Metro Manila', n:1, q:'Makati, Metro Manila' },
    { city:'Taguig', region:'Metro Manila', n:1, q:'Bonifacio Global City, Taguig' },
    { city:'Valenzuela City', region:'Metro Manila', n:1, q:'Valenzuela City' },
    { city:'Iligan City', region:'Lanao del Norte, Mindanao', n:1, q:'Iligan City' }
  ];
  const PROJECTS = [
    { title:'Avida Towers Vita', type:'Residential', scope:'Interior', city:'Quezon City', a:['p1','Proposal','Proposed studio unit interior design at Vertis North, Bagong Pag-asa, Quezon City, Metro Manila.'], b:['p2','Turnover','Completed studio unit interior design & construction at Vertis North, Bagong Pag-asa, Quezon City, Metro Manila.'] },
    { title:'Park Triangle Residences', type:'Residential', scope:'Interior', city:'Taguig', a:['p3','Before','Existing unit condition at 32nd St. corner 11th Ave., Fort Bonifacio, Taguig — before full interior renovation.'], b:['p4','Turnover','Full luxury interior fit-out completed at 32nd St. corner 11th Ave., Fort Bonifacio, Taguig, Metro Manila.'] },
    { title:'San Lorenzo Place', type:'Residential', scope:'Interior', city:'Makati', a:['p5','Proposal','Proposed dark-luxury interior design at Chino Roces Ave., corner Epifanio delos Santos Ave., Makati, 1223 Metro Manila.'], b:['p6','Turnover','Contemporary dark-luxury interior renovation completed at Chino Roces Ave. corner EDSA, Makati, Metro Manila.'] },
    { title:'SMDC Grass Residence', type:'Residential', scope:'Interior', city:'Quezon City', a:['p7','Turnover','Cozy modern interior design and furnishing at Grass Residences, Nueva Viscaya, Bago Bantay, Quezon City.'], b:['p8','Detail','Interior detail views — bedroom, living area, and entertainment setup at Grass Residences, Quezon City.'] },
    { title:'Health Works', type:'Commercial', scope:'Clinic', city:'Quezon City', a:['p9','Proposal','Proposed clinic interior design at 2F Waltermart The Junction Place, Quezon City — featuring pink fluted walls and marble reception.'], b:['p10','Turnover','Completed dental clinic interior construction at 2F Waltermart The Junction Place, Quezon City — pink fluted walls and marble accents.'] },
    { title:'Mallari Bldg.', type:'Residential', scope:'Building', city:'Valenzuela City', a:['p11','Proposal','Proposed multi-storey residential apartment building at Maya St., Brgy. Ugong, Valenzuela City.'], b:['p12','Turnover','Completed multi-storey residential apartment building at Maya St., Brgy. Ugong, Valenzuela City.'] },
    { title:'AUM Bldg.', type:'Commercial', scope:'Mixed-Use', city:'Iligan City', a:['p13','Proposal','Proposed mixed-use commercial building for Tom N Toms Coffee & Mayo Diagnostics at Corner Araneta St., Roxas Ave., Iligan City.'], b:['p14','Turnover','Completed mixed-use commercial building housing Tom N Toms Coffee & Mayo Diagnostics at Corner Araneta St., Roxas Ave., Iligan City.'] }
  ];
  const SLIDES = [[0,'p2'],[1,'p4'],[2,'p6'],[3,'p8'],[4,'p10'],[5,'p12'],[6,'p14']].map(([i,k]) => ({ k, title: PROJECTS[i].title, loc: PROJECTS[i].city }));
  const FEATURED = [1, 2, 4, 6];
  const SPANS = [[7,'7/5'],[5,'5/5'],[5,'5/5'],[7,'7/5'],[4,'4/5'],[4,'4/5'],[4,'4/5']];
  const FAQS = [
    ['How long does a typical project take?','Project timelines vary based on scope. Interior design projects typically take 4–8 weeks, while full residential construction can take 3–6 months. We provide a detailed schedule during your consultation.'],
    ['Is the initial consultation really free?',"Yes! Your first consultation with us is completely free and no-obligation. We'll discuss your project, understand your vision, and give you a clear picture of how we can help — before any commitment."],
    ['Can I see the design before construction starts?','Absolutely. We provide detailed design plans, floor layouts, and visual references for your approval before any construction work begins. Your sign-off is required before we proceed.'],
    ['Do you handle building permits?','Yes, we assist with the permit application process. Our licensed architect ensures all plans are compliant with local building codes and ordinances in the Philippines.'],
    ['What areas do you serve?','We are based in Quezon City and primarily serve Metro Manila and nearby provinces. We have also completed projects in other regions — contact us to discuss your location.'],
    ['How much does it cost to start?',"Costs depend on project scope, materials, and timeline. We offer solutions for a range of budgets. Book a free consultation and we'll provide a tailored quote at no cost to you."]
  ];

  // '#/services' → 'services'; old '#appointment' bookmarks → 'book';
  // old '#services' anchors still work; anything else (incl. Studio) → 'home'.
  function resolveRoute(hash) {
    const h = String(hash || '').replace(/^#\/?/, '');
    if (h === 'appointment') return 'book';
    return PAGES.includes(h) ? h : 'home';
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PAGES, resolveRoute, img, SERVICES, SCOPE, AREAS, PROJECTS, SLIDES, FEATURED, SPANS, FAQS };
    return;
  }

  // ═════════════════════════ browser only ═════════════════════════
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const reduced = !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);

  let page = null;
  const inits = [];
  function registerInit(fn) { inits.push(fn); }

  // ── Router ──
  function show(p) {
    page = p;
    $$('.page').forEach((s) => { s.hidden = s.dataset.page !== p; });
    $('#ctaBand').hidden = p === 'book';
    $$('[data-nav]').forEach((a) => {
      const on = a.dataset.nav === p;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    closeMenu();
    root.scrollTo(0, 0);
    try { history.replaceState(null, '', '#/' + p); } catch (e) { /* file:// */ }
    document.title = (p === 'home' ? '' : ({ services: 'Services', projects: 'Projects', book: 'Book a Consultation' })[p] + ' · ') + "DAC's Building Design Services";
    document.dispatchEvent(new CustomEvent('dacs:page', { detail: { page: p } }));
    refreshFx(); fx();
  }

  function navigate(p) {
    p = PAGES.includes(p) ? p : 'home';
    if (p === page) { root.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' }); closeMenu(); return; }
    const c = $('#curtain');
    if (reduced || !c || !c.animate) return show(p);
    c.style.transformOrigin = 'bottom';
    const a = c.animate([{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }],
      { duration: 420, easing: 'cubic-bezier(.7,0,.3,1)', fill: 'forwards' });
    a.onfinish = () => {
      show(p);
      c.style.transformOrigin = 'top';
      c.animate([{ transform: 'scaleY(1)' }, { transform: 'scaleY(0)' }],
        { duration: 520, delay: 120, easing: 'cubic-bezier(.7,0,.3,1)', fill: 'forwards' });
    };
  }

  function initRouter() {
    document.addEventListener('click', (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      const t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('a[href="#main"]')) {
        e.preventDefault();
        const m = $('#main'); if (m) m.focus();
        return;
      }
      const a = t.closest('a[href^="#/"]');
      if (!a) return;
      e.preventDefault();
      navigate(resolveRoute(a.getAttribute('href')));
    });
    root.addEventListener('hashchange', () => { if (location.hash === '#main') return; navigate(resolveRoute(location.hash)); });
  }

  // ── Header + mobile menu ──
  function closeMenu() {
    const m = $('#mmenu'); if (!m || m.hidden) return;
    m.hidden = true; document.body.style.overflow = '';
    const t = $('#menuToggle'); if (t) t.setAttribute('aria-expanded', 'false');
  }
  function initHeader() {
    const t = $('#menuToggle');
    if (t) t.addEventListener('click', () => {
      const m = $('#mmenu'); const open = m.hidden;
      m.hidden = !open; document.body.style.overflow = open ? 'hidden' : '';
      t.setAttribute('aria-expanded', String(open));
    });
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMenu(); document.dispatchEvent(new Event('dacs:escape')); } });
    $('#toTop').addEventListener('click', () => root.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' }));
  }

  // ── Effects: reveal, count-up, parallax, header state, timeline fill, magnetic ──
  let io = null;
  function revealEl(el) {
    if (el.hasAttribute('data-reveal')) el.setAttribute('data-rv', '1');
    [el].concat($$('[data-count]', el)).forEach((c) => {
      if (!c.hasAttribute('data-count') || c.getAttribute('data-cv') === '1') return;
      c.setAttribute('data-cv', '1');
      const to = +c.getAttribute('data-count'), suf = c.getAttribute('data-suffix') || '', t0 = performance.now();
      const tick = (t) => { const p = clamp((t - t0) / 1600, 0, 1);
        c.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))) + suf; if (p < 1) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
  }
  function refreshFx() {
    if (reduced || !('IntersectionObserver' in root)) return;
    if (!io) io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) { revealEl(e.target); io.unobserve(e.target); }
    }), { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    $$('[data-reveal]:not([data-rv])').forEach((el) => {
      el.setAttribute('data-rv', '0');
      el.style.transitionDelay = (el.getAttribute('data-delay') || 0) + 'ms';
      io.observe(el);
    });
    $$('[data-count]:not([data-cv])').forEach((el) => {
      el.setAttribute('data-cv', '0');
      el.textContent = '0' + (el.getAttribute('data-suffix') || '');
      io.observe(el);
    });
  }
  function fx() {
    const y = root.scrollY, vh = root.innerHeight;
    $('#hdr').classList.toggle('is-clear', page === 'home' && y <= 40);
    $('#toTop').classList.toggle('is-on', y > vh);
    const tl = $('#procLine'), fill = $('#procFill');
    if (tl && fill && page === 'home') {
      const r = tl.getBoundingClientRect(), p = reduced ? 1 : clamp((vh * 0.6 - r.top) / (r.height - 16), 0, 1);
      fill.style.height = 'calc(' + (p * 100) + '% - ' + (p * 16) + 'px)';
      $$('[data-tl-node]', tl).forEach((n) => n.classList.toggle('is-on', reduced || n.getBoundingClientRect().top < vh * 0.6));
    }
    if (reduced) return;
    const hp = $('#heroParallax'); if (hp && page === 'home') hp.style.transform = 'translate3d(0,' + (y * 0.35) + 'px,0)';
    $$('.page:not([hidden]) [data-parallax]').forEach((el) => {
      const r = el.parentElement.getBoundingClientRect(), f = +el.getAttribute('data-parallax');
      el.style.transform = 'translate3d(0,' + ((r.top + r.height / 2 - vh / 2) * -f) + 'px,0)';
    });
  }
  function initFx() {
    let raf = null;
    root.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(() => { raf = null; fx(); }); }, { passive: true });
    root.addEventListener('resize', fx);
    if (reduced || !root.matchMedia('(hover: hover)').matches) return;
    let mag = null;
    root.addEventListener('mousemove', (e) => {
      const t = e.target.closest ? e.target.closest('[data-magnetic]') : null;
      if (mag && mag !== t) { mag.style.transform = ''; mag = null; }
      if (!t) return;
      const r = t.getBoundingClientRect();
      t.style.transition = 'transform .25s var(--ease), background .2s, color .2s';
      t.style.transform = 'translate(' + (e.clientX - r.left - r.width / 2) * 0.22 + 'px,' + (e.clientY - r.top - r.height / 2) * 0.32 + 'px)';
      mag = t;
    });
  }

  // Shared before/after slider: el has --pos, role="slider"; returns set(pos).
  function beforeAfter(el) {
    const set = (pos) => { pos = clamp(pos, 2, 98); el.style.setProperty('--pos', pos + '%'); el.setAttribute('aria-valuenow', String(Math.round(pos))); };
    const at = (e) => { const r = el.getBoundingClientRect(); set((e.clientX - r.left) / r.width * 100); };
    let drag = false;
    el.addEventListener('pointerdown', (e) => { drag = true; try { el.setPointerCapture(e.pointerId); } catch (x) {} at(e); });
    el.addEventListener('pointermove', (e) => { if (drag) at(e); });
    ['pointerup', 'pointercancel'].forEach((t) => el.addEventListener(t, () => { drag = false; }));
    el.addEventListener('keydown', (e) => {
      const cur = parseFloat(el.getAttribute('aria-valuenow')) || 50;
      if (e.key === 'ArrowLeft') { set(cur - 5); e.preventDefault(); }
      if (e.key === 'ArrowRight') { set(cur + 5); e.preventDefault(); }
    });
    set(50);
    return set;
  }

  // ── Home ──
  function initHero() {
    const wrap = $('#heroSlides'), bars = $('#heroBars'); if (!wrap) return;
    wrap.innerHTML = SLIDES.map((s, i) => '<img class="hero-img" src="' + img(s.k) + '" alt="' + esc(s.title) +
      '"' + (i ? ' loading="lazy"' : '') + '>').join('');
    bars.innerHTML = SLIDES.map((_, i) => '<button type="button" class="hero-bar" aria-label="Slide ' + (i + 1) +
      '"><span></span></button>').join('');
    const imgs = $$('.hero-img', wrap), btns = $$('.hero-bar', bars);
    let cur = 0, timer = null;
    function go(i) {
      cur = (i + SLIDES.length) % SLIDES.length;
      imgs.forEach((im, k) => im.classList.toggle('is-on', k === cur));
      btns.forEach((b, k) => {
        b.classList.toggle('is-done', k < cur);
        b.classList.remove('is-active'); if (k === cur) { void b.offsetWidth; b.classList.add('is-active'); }
      });
      $('#heroNum').textContent = String(cur + 1).padStart(2, '0');
      $('#heroTitle').textContent = SLIDES[cur].title;
      $('#heroLoc').textContent = SLIDES[cur].loc;
      start();
    }
    function start() {
      clearInterval(timer);
      if (reduced) return;
      timer = setInterval(() => { if (page === 'home' && $('#caseView').hidden) go(cur + 1); }, 6500);
    }
    btns.forEach((b, k) => b.addEventListener('click', () => go(k)));
    $('#heroPrev').addEventListener('click', () => go(cur - 1));
    $('#heroNext').addEventListener('click', () => go(cur + 1));
    go(0);
  }

  function initFeatured() {
    const tabs = $('#featTabs'), ba = $('#featBA'); if (!tabs || !ba) return;
    const set = beforeAfter(ba);
    function pick(i) {
      const p = PROJECTS[i];
      $('#featBefore').src = img(p.a[0]); $('#featBefore').alt = p.title + ' — ' + p.a[1];
      $('#featAfter').src = img(p.b[0]);  $('#featAfter').alt = p.title + ' — ' + p.b[1];
      $('#featBeforeLabel').textContent = p.a[1]; $('#featAfterLabel').textContent = p.b[1];
      $('#featDesc').textContent = p.b[2];
      $$('button', tabs).forEach((b) => { const on = +b.dataset.i === i; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); });
      set(50);
    }
    tabs.innerHTML = FEATURED.map((i) => '<button type="button" class="feat-tab" data-i="' + i + '">' + esc(PROJECTS[i].title) + '</button>').join('');
    tabs.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) pick(+b.dataset.i); });
    pick(FEATURED[0]);
  }

  function initCarousel() {
    const el = $('#carTrack'); if (!el) return;
    const one = [];
    PROJECTS.forEach((p) => [p.a, p.b].filter((v) => v[1] === 'Turnover' || v[1] === 'Detail')
      .forEach((v) => one.push({ title: p.title, src: img(v[0]) })));
    el.innerHTML = one.concat(one).map((c, i) => '<a href="#/projects" class="car-item" data-car-item' +
      (i >= one.length ? ' aria-hidden="true" tabindex="-1"' : '') + '>' +
      '<img src="' + c.src + '" alt="' + esc(c.title) + '" loading="lazy"><span class="car-cap">' + esc(c.title) +
      ' · Turnover</span></a>').join('');
    let paused = false, x = null, center = null;
    ['mouseenter', 'touchstart', 'focusin'].forEach((t) => el.addEventListener(t, () => { paused = true; }, { passive: true }));
    ['mouseleave', 'touchend', 'focusout'].forEach((t) => el.addEventListener(t, () => { paused = false; x = null; }));
    (function loop() {
      if (page === 'home') {
        if (!paused && !reduced && $('#caseView').hidden) {
          x = (x == null ? el.scrollLeft : x) + 0.6;
          const half = el.scrollWidth / 2; if (x >= half) x -= half;
          el.scrollLeft = x;
        } else x = el.scrollLeft;
        const vr = el.getBoundingClientRect(), cx = vr.left + vr.width / 2;
        let best = null, bd = Infinity;
        $$('[data-car-item]', el).forEach((it) => { const r = it.getBoundingClientRect(); const d = Math.abs(r.left + r.width / 2 - cx); if (d < bd) { bd = d; best = it; } });
        if (best !== center) { if (center) center.classList.remove('is-center'); if (best) best.classList.add('is-center'); center = best; }
      }
      requestAnimationFrame(loop);
    })();
  }

  function initFaq() {
    const list = $('#faqList'); if (!list) return;
    list.innerHTML = FAQS.map((q, i) => '<div class="faq-item' + (i === 0 ? ' is-open' : '') + '">' +
      '<button type="button" class="faq-q" aria-expanded="' + (i === 0) + '" aria-controls="faq-a' + i + '" id="faq-q' + i + '">' +
      '<span>' + esc(q[0]) + '</span><span class="faq-icon" aria-hidden="true">+</span></button>' +
      '<div class="faq-a" id="faq-a' + i + '" role="region" aria-labelledby="faq-q' + i + '"><div><p>' + esc(q[1]) + '</p></div></div></div>').join('');
    list.addEventListener('click', (e) => {
      const btn = e.target.closest('.faq-q'); if (!btn) return;
      const item = btn.parentElement, open = !item.classList.contains('is-open');
      $$('.faq-item', list).forEach((it) => { it.classList.remove('is-open'); $('.faq-q', it).setAttribute('aria-expanded', 'false'); });
      if (open) { item.classList.add('is-open'); btn.setAttribute('aria-expanded', 'true'); }
    });
  }

  registerInit(initHero); registerInit(initFeatured); registerInit(initCarousel); registerInit(initFaq);

  // ── Services ──
  const AREA_ZOOM = (i) => (AREAS[i].city === 'Iligan City' ? 12 : 13);

  function bookService(id) {
    if (typeof root.dacsStartBooking === 'function') root.dacsStartBooking(id);
    navigate('book');
  }

  function initServices() {
    const idx = $('#svcIndex'), wrap = $('#svcPanels'); if (!wrap) return;
    idx.innerHTML = SERVICES.map((s, i) => '<a href="#svc-' + s.id + '" class="svc-jump" data-jump="' + s.id + '"><span>' +
      String(i + 1).padStart(2, '0') + '</span>' + esc(s.title) + '</a>').join('');
    idx.addEventListener('click', (e) => {
      const a = e.target.closest('[data-jump]'); if (!a) return;
      e.preventDefault();
      const el = document.getElementById('svc-' + a.dataset.jump);
      if (el) root.scrollTo({ top: el.getBoundingClientRect().top + root.scrollY - 128, behavior: reduced ? 'auto' : 'smooth' });
    });

    wrap.innerHTML = SERVICES.map((x, i) => {
      const dark = x.dark != null ? x.dark : i % 2 === 1;
      const tone = dark ? 'is-dark' : (i % 4 === 2 ? 'is-cream' : 'is-light');
      const cat = x.category === 'Allied' ? 'Partner Trades' : (x.id === 'vertical-construction' ? 'Our Main Service' : x.category + ' Services');
      const num = String(i + 1).padStart(2, '0');
      return '<section class="svc-panel ' + tone + (dark ? ' is-flip' : '') + '" id="svc-' + x.id + '" aria-labelledby="svc-h-' + x.id + '">' +
        '<div class="svc-text">' +
          '<span class="svc-eyebrow" data-reveal>' + num + ' · ' + esc(cat) + '</span>' +
          '<h2 id="svc-h-' + x.id + '" data-reveal data-delay="80">' + esc(x.title) + '</h2>' +
          '<p data-reveal data-delay="140">' + esc(x.description) + '</p>' +
          '<ul class="svc-scope" data-reveal data-delay="200">' + (SCOPE[x.id] || x.features || []).map((f) => '<li>' + esc(f) + '</li>').join('') + '</ul>' +
          '<div data-reveal data-delay="260"><button type="button" class="svc-book" data-book="' + x.id + '" data-magnetic="1">Book this service →</button></div>' +
        '</div>' +
        '<div class="svc-media">' +
          '<div class="svc-layers" data-parallax="0.08">' + x.images.map((im, k) =>
            '<img src="' + img(im[0]) + '" alt="' + esc(im[1]) + '" loading="lazy" class="' + (k ? '' : 'is-on') + '">').join('') + '</div>' +
          '<div class="svc-thumbs-bar"><span class="svc-img-label">' + esc(x.images[0][1]) + '</span><div class="svc-thumbs">' +
            x.images.map((im, k) => '<button type="button" class="svc-thumb' + (k ? '' : ' is-on') + '" data-k="' + k + '" aria-label="' + esc(im[1]) + '">' +
              '<img src="' + img(im[0]) + '" alt="" loading="lazy"></button>').join('') +
          '</div></div>' +
        '</div></section>';
    }).join('');

    const pickImg = (btn) => {
      const panel = btn.closest('.svc-panel'), k = +btn.dataset.k;
      $$('.svc-layers img', panel).forEach((im, j) => im.classList.toggle('is-on', j === k));
      $$('.svc-thumb', panel).forEach((b, j) => b.classList.toggle('is-on', j === k));
      $('.svc-img-label', panel).textContent = $$('.svc-layers img', panel)[k].alt;
    };
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-book]'); if (b) return bookService(b.dataset.book);
      const t = e.target.closest('.svc-thumb'); if (t) pickImg(t);
    });
    wrap.addEventListener('mouseover', (e) => { const t = e.target.closest('.svc-thumb'); if (t) pickImg(t); });

    const list = $('#areaList'), map = $('#areaMap');
    function pickArea(i) {
      $$('button', list).forEach((b) => { const on = +b.dataset.i === i; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); });
      map.src = 'https://maps.google.com/maps?q=' + encodeURIComponent(AREAS[i].q) + '&z=' + AREA_ZOOM(i) + '&output=embed';
    }
    list.innerHTML = AREAS.map((a, i) => '<button type="button" class="area-item" data-i="' + i + '">' +
      '<span class="area-dot"></span><span class="area-city">' + esc(a.city) + '</span><span class="area-region">' + esc(a.region) + '</span>' +
      '<span class="area-n">' + a.n + (a.n === 1 ? ' project' : ' projects') + '</span></button>').join('');
    list.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) pickArea(+b.dataset.i); });
    pickArea(0);
  }

  registerInit(initServices);

  // ── Projects + case study ──
  const caseService = (p) => (p.type === 'Commercial' ? 'commercial-renovation'
    : (p.scope === 'Building' ? 'residential-construction' : 'interior-design'));

  function initProjects() {
    const grid = $('#prjGrid'), bar = $('#prjFilters'), cv = $('#caseView'); if (!grid) return;
    let filter = 'All', idx = -1, lastFocus = null, lastIdx = -1;
    const setCase = beforeAfter($('#caseBA'));

    const bucket = () => (root.innerWidth >= 1000 ? 'wide' : root.innerWidth >= 700 ? 'mid' : 'small');
    let curBucket = bucket();
    function renderGrid() {
      const wide = curBucket === 'wide', small = curBucket === 'small';
      const vis = PROJECTS.map((p, i) => ({ p, i })).filter(({ p }) => filter === 'All' || p.type === filter);
      grid.innerHTML = vis.map(({ p, i }, k) => {
        const sp = wide ? SPANS[k % SPANS.length] : [small ? 12 : 6, small ? '4/3' : '4/3'];
        return '<button type="button" class="prj-card" data-i="' + i + '" style="grid-column:span ' + sp[0] + ';aspect-ratio:' + sp[1] + '">' +
          '<img src="' + img(p.b[0]) + '" alt="' + esc(p.title) + '" loading="lazy"><span class="prj-shade"></span>' +
          '<span class="prj-type">' + esc(p.type) + '</span>' +
          '<span class="prj-meta"><span><span class="prj-sub">' + esc(p.scope) + ' · ' + esc(p.city) + '</span>' +
          '<span class="prj-title">' + esc(p.title) + '</span></span><span class="prj-arrow" aria-hidden="true">↗</span></span></button>';
      }).join('');
    }
    function renderFilters() {
      if (bar.children.length) {
        $$('[data-f]', bar).forEach((b) => { const on = b.dataset.f === filter; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); });
        return;
      }
      const counts = { All: PROJECTS.length,
        Residential: PROJECTS.filter((p) => p.type === 'Residential').length,
        Commercial: PROJECTS.filter((p) => p.type === 'Commercial').length };
      bar.innerHTML = ['All', 'Residential', 'Commercial'].map((l) => '<button type="button" class="prj-filter' +
        (l === filter ? ' is-on' : '') + '" aria-pressed="' + (l === filter) + '" data-f="' + l + '">' + l + ' <span>' + counts[l] + '</span></button>').join('');
    }
    function openCase(i) {
      idx = (i + PROJECTS.length) % PROJECTS.length;
      const p = PROJECTS[idx];
      $('#caseNum').textContent = String(idx + 1).padStart(2, '0') + ' / ' + String(PROJECTS.length).padStart(2, '0');
      $('#caseEyebrow').textContent = p.type + ' · ' + p.scope;
      $('#caseTitle').textContent = p.title;
      $('#caseCity').textContent = p.city; $('#caseType').textContent = p.type; $('#caseScope').textContent = p.scope;
      $('#caseA').src = img(p.a[0]); $('#caseA').alt = p.title + ' — ' + p.a[1];
      $('#caseB').src = img(p.b[0]); $('#caseB').alt = p.title + ' — ' + p.b[1];
      $('#caseALabel').textContent = p.a[1]; $('#caseBLabel').textContent = p.b[1];
      $('#caseADesc').textContent = p.a[2]; $('#caseBDesc').textContent = p.b[2];
      $$('.case-cap-label').forEach((el, k) => { el.textContent = k ? p.b[1] : p.a[1]; });
      setCase(50);
      if (cv.hidden) { lastFocus = document.activeElement; lastIdx = lastFocus && lastFocus.dataset ? lastFocus.dataset.i : -1; cv.hidden = false; document.body.style.overflow = 'hidden'; cv.scrollTop = 0; $('#caseClose').focus(); }
    }
    function closeCase() {
      if (cv.hidden) return;
      cv.hidden = true; document.body.style.overflow = ''; idx = -1;
      let back = lastFocus;
      if (back && !back.isConnected && lastIdx != null && lastIdx !== -1) back = grid.querySelector('[data-i="' + lastIdx + '"]');
      if (back && back.focus) back.focus();
    }

    bar.addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (!b) return; filter = b.dataset.f; renderFilters(); renderGrid(); });
    grid.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) openCase(+b.dataset.i); });
    $('#caseClose').addEventListener('click', closeCase);
    $('#casePrev').addEventListener('click', () => openCase(idx - 1));
    $('#caseNext').addEventListener('click', () => openCase(idx + 1));
    $('#caseBook').addEventListener('click', () => { const p = PROJECTS[idx]; closeCase(); bookService(caseService(p)); });
    document.addEventListener('dacs:escape', closeCase);
    document.addEventListener('dacs:page', closeCase);
    // Modal: Tab / Shift+Tab wrap inside the case view while it is open.
    cv.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const items = $$('button, [tabindex="0"], a[href]', cv).filter((el) => !el.disabled);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    let rt = null;
    root.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { const b = bucket(); if (b !== curBucket) { curBucket = b; renderGrid(); } }, 150); });
    renderFilters(); renderGrid();
  }

  registerInit(initProjects);

  function initSite() {
    initRouter(); initHeader(); initFx();
    inits.forEach((fn) => {
      try { fn(); } catch (err) {
        if (typeof _dacsReportError === 'function') _dacsReportError('error', 'init failed: ' + (err && err.message), 'js/script.js', 0, 0, err && err.stack);
      }
    });
    show(resolveRoute(location.hash));
  }

  root.DacsSite = { SERVICES, SCOPE, AREAS, PROJECTS, navigate, registerInit, beforeAfter, refreshFx, esc, img, $, $$, clamp, reduced,
    get page() { return page; } };
  document.addEventListener('DOMContentLoaded', initSite);
})(typeof window !== 'undefined' ? window : this);
