/* ============================================================
   ETHEREAL BALANCE — shared site interactions + rendering
   Depends on: events.js (window.eventsData, window.pastEventsData)
   ============================================================ */
(function(){
  'use strict';
  const $ = (s, c) => (c||document).querySelector(s);
  const $$ = (s, c) => Array.from((c||document).querySelectorAll(s));

  /* ---------- icons ---------- */
  const ICON = {
    clock:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    pin:'<svg viewBox="0 0 24 24"><path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    leaf:'<svg viewBox="0 0 24 24"><path d="M5 19c0-8 6-14 14-14 0 8-6 14-14 14z"/><path d="M5 19c3-3 6-5 10-7"/></svg>'
  };

  /* ---------- nav: solid on scroll ---------- */
  function initNav(){
    const nav = $('.nav');
    const btt = $('.back-to-top');
    if(!nav && !btt) return;
    const overlay = nav && nav.classList.contains('nav--overlay');
    const onScroll = () => {
      const y = window.scrollY;
      if(nav && overlay){ nav.classList.toggle('is-solid', y > window.innerHeight*0.72); }
      if(btt){ btt.classList.toggle('show', y > 600); }
    };
    window.addEventListener('scroll', onScroll, {passive:true});
    onScroll();
    if(btt) btt.addEventListener('click', ()=> window.scrollTo({top:0,behavior:'smooth'}));
  }

  /* ---------- mobile menu ---------- */
  function initMobileMenu(){
    const burger = $('.nav__burger'), menu = $('.mobile-menu');
    if(!burger || !menu) return;
    const close = $('.mobile-menu__close', menu);
    const toggle = (open) => { menu.classList.toggle('is-open', open); document.body.style.overflow = open ? 'hidden' : ''; };
    burger.addEventListener('click', ()=> toggle(true));
    if(close) close.addEventListener('click', ()=> toggle(false));
    $$('.mobile-menu a', menu).forEach(a => a.addEventListener('click', ()=> toggle(false)));
  }

  /* ---------- stat counters: count up on scroll ---------- */
  function animateCount(el){
    const m = (el.textContent || '').trim().match(/^(\d[\d,]*)(.*)$/);
    if(!m) return;
    const target = parseInt(m[1].replace(/,/g,''), 10);
    const suffix = m[2] || '';
    if(isNaN(target)) return;
    const dur = 1300, t0 = performance.now();
    const ease = t => 1 - Math.pow(1 - t, 3);
    (function tick(now){
      const p = Math.min(1, (now - t0)/dur);
      el.textContent = Math.round(ease(p) * target).toLocaleString() + suffix;
      if(p < 1) requestAnimationFrame(tick);
    })(t0);
  }
  function initStatCounters(){
    const els = $$('.stat__num');
    if(!els.length) return;
    if(!('IntersectionObserver' in window)){ els.forEach(animateCount); return; }
    const io = new IntersectionObserver((entries)=>{
      entries.forEach(e=>{ if(e.isIntersecting){ animateCount(e.target); io.unobserve(e.target); } });
    }, {threshold:0.6});
    els.forEach(e=> io.observe(e));
  }

  /* ---------- reveal on scroll ---------- */
  function initReveal(){
    const els = $$('.reveal');
    if(!('IntersectionObserver' in window) || !els.length){ els.forEach(e=>e.classList.add('is-in')); return; }
    const io = new IntersectionObserver((entries)=>{
      entries.forEach(e=>{ if(e.isIntersecting){ e.target.classList.add('is-in'); io.unobserve(e.target); } });
    }, {threshold:0.12, rootMargin:'0px 0px -8% 0px'});
    els.forEach(e=>{
      if(e.classList.contains('is-in')) return;
      // Reveal anything already on screen right now. Async-rendered cards
      // (events, gallery, instructors) mount already in view, and the observer's
      // first callback is unreliable for them on some mobile browsers — which
      // left those sections stuck invisible. Below-the-fold elements still
      // animate in on scroll via the observer.
      const r = e.getBoundingClientRect();
      if(r.top < window.innerHeight && r.bottom > 0){ e.classList.add('is-in'); return; }
      io.observe(e);
    });
  }
  // Safety net for async-rendered card lists (events / gallery): if the observer
  // never fires for them — which can happen on mobile for nodes injected after a
  // data fetch — force them visible so a section is never silently blank.
  function revealFallback(scope){
    setTimeout(()=>{ $$('.reveal', scope).forEach(e=> e.classList.add('is-in')); }, 1400);
  }

  /* ---------- marquee: duplicate for seamless loop ---------- */
  function initMarquee(){
    $$('.marquee__track').forEach(track=>{
      if(track.dataset.cloned) return;
      track.dataset.cloned = '1';
      track.innerHTML += track.innerHTML;
    });
  }

  /* ---------- subtle parallax on feature imagery ---------- */
  function initParallax(){
    if(!window.matchMedia) return;
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if(!window.matchMedia('(min-width:861px)').matches) return;
    const els = $$('.media-split__media img, .break__media img');
    if(!els.length) return;
    let ticking = false;
    const update = () => {
      const vh = window.innerHeight;
      els.forEach(img => {
        const r = img.getBoundingClientRect();
        if(r.bottom < -50 || r.top > vh + 50) return;
        // -0.5 (top of viewport) .. 0.5 (bottom). The image drifts opposite to
        // scroll. Scaled up a touch so the translate never reveals an edge.
        const progress = (r.top + r.height/2 - vh/2) / vh;
        const shift = Math.max(-18, Math.min(18, progress * -28));
        img.style.transform = `translate3d(0,${shift.toFixed(1)}px,0) scale(1.12)`;
      });
      ticking = false;
    };
    const onScroll = () => { if(!ticking){ ticking = true; requestAnimationFrame(update); } };
    window.addEventListener('scroll', onScroll, {passive:true});
    window.addEventListener('resize', onScroll, {passive:true});
    update();
  }

  /* ---------- events: upcoming ---------- */
  const MON = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  function parseDate(str){
    // 'Feb 7, 2026'
    const d = new Date(str);
    if(!isNaN(d)) return {mon:MON[d.getMonth()], day:String(d.getDate()).padStart(2,'0'), yr:d.getFullYear()};
    return {mon:'', day:'', yr:''};
  }
  function eventDate(ev){
    // Prefer the sortable ISO date (Firestore stores it in _sortDate) so events
    // still filter correctly even when the display string isn't parseable.
    const d = new Date(ev._sortDate || ev.date || '');
    return isNaN(d) ? null : d;
  }
  function getUpcoming(){
    const src = (window._firestoreEvents && window._firestoreEvents.length) ? window._firestoreEvents : (window.eventsData || []);
    const today = new Date(); today.setHours(0,0,0,0);
    // Hide events whose date has already passed; keep undated entries.
    return src
      .filter(ev=>{ const d = eventDate(ev); return !d || d >= today; })
      .sort((a,b)=>{ const da = eventDate(a), db = eventDate(b); if(!da||!db) return 0; return da - db; });
  }
  function eventCard(ev){
    const d = parseDate(ev.date || ev._sortDate || '');
    const link = ev.bookingLink || '#';
    return `<article class="ev reveal">
      <div class="ev__date"><span class="ev__mon">${d.mon}</span><span class="ev__day">${d.day}</span><span class="ev__yr">${d.yr}</span></div>
      <div class="ev__body">
        ${ev.type?`<span class="ev__type">${ev.type}</span>`:''}
        <h3>${ev.title||''}</h3>
        <div class="ev__meta">
          ${ev.time?`<span>${ICON.clock}${ev.time}</span>`:''}
          ${ev.venue?`<span>${ICON.pin}${ev.venue}</span>`:''}
        </div>
        ${ev.description?`<p>${ev.description}</p>`:''}
      </div>
      <div class="ev__action"><a class="btn btn-ghost" href="${link}" target="_blank" rel="noopener">Reserve a spot</a></div>
    </article>`;
  }
  function renderUpcoming(){
    const wrap = $('#eventsList'); if(!wrap) return;
    const empty = $('#eventsEmpty');
    const limit = wrap.dataset.limit ? parseInt(wrap.dataset.limit,10) : 99;
    let list = getUpcoming().slice(0, limit);
    if(!list.length){ wrap.innerHTML=''; if(empty) empty.classList.remove('hide'); return; }
    if(empty) empty.classList.add('hide');
    wrap.innerHTML = list.map(eventCard).join('');
    initReveal();
    revealFallback(wrap);
  }
  window.renderEvents = renderUpcoming;
  window.renderUpcoming = renderUpcoming;

  /* ---------- past events gallery + lightbox ---------- */
  function getPast(){
    // The admin-managed gallery (Firestore) is the source of truth, so events
    // added or removed in the admin show up on the site. The local list in
    // events.js is only a fallback for when Firestore has nothing yet.
    // (Previously this preferred the local list, which silently hid every
    // gallery item added through the admin.)
    return (window._firestoreGallery && window._firestoreGallery.length)
      ? window._firestoreGallery
      : (window.pastEventsData || []);
  }
  let LB = {photos:[], i:0, title:'', date:''};
  function renderGallery(){
    const wrap = $('#galleryGrid'); if(!wrap) return;
    const data = getPast();
    wrap.innerHTML = data.map((g,gi)=>{
      const cover = g.coverImage || (g.photos && g.photos[0] && g.photos[0].src) || '';
      const n = (g.photos||[]).length;
      return `<div class="gcard reveal" data-g="${gi}">
        <img src="${cover}" alt="${g.title||''}" loading="lazy">
        <div class="gcard__veil">
          ${g.coverLabel?`<span class="gcard__tag">${g.coverLabel}</span>`:''}
          <span class="gcard__title">${g.title||''}</span>
          <span class="gcard__count">${g.date||''}${n>1?` · ${n} photos`:''}</span>
        </div>
      </div>`;
    }).join('');
    $$('.gcard', wrap).forEach(card=>{
      card.addEventListener('click', ()=> openLightbox(data[parseInt(card.dataset.g,10)]));
    });
    initReveal();
    revealFallback(wrap);
  }
  function openLightbox(g){
    const lb = $('#lightbox'); if(!lb || !g) return;
    LB.photos = (g.photos && g.photos.length) ? g.photos : [{src:g.coverImage, label:g.title}];
    LB.i = 0; LB.title = g.title || ''; LB.date = g.date || '';
    $('#lbTitle').textContent = LB.title;
    $('#lbDate').textContent = LB.date;
    const descEl = $('#lbDesc');
    if(descEl){ descEl.textContent = g.description || ''; descEl.style.display = g.description ? '' : 'none'; }
    paintLightbox();
    lb.classList.add('is-open'); document.body.style.overflow='hidden';
  }
  function paintLightbox(){
    const p = LB.photos[LB.i]; if(!p) return;
    const stage = $('#lbStage');
    const isVid = p.type==='video' || /\.(mp4|mov)$/i.test(p.src||'');
    stage.innerHTML = isVid
      ? `<video class="lb__img" src="${p.src}" controls autoplay playsinline></video>`
      : `<img class="lb__img" src="${p.src}" alt="${p.label||''}">`;
    $('#lbCount').textContent = `${LB.i+1} / ${LB.photos.length}`;
  }
  function moveLightbox(dir){ LB.i = (LB.i + dir + LB.photos.length) % LB.photos.length; paintLightbox(); }
  function closeLightbox(){ const lb=$('#lightbox'); if(lb){ lb.classList.remove('is-open'); document.body.style.overflow=''; const v=lb.querySelector('video'); if(v) v.pause(); } }
  window.renderGalleryFromData = renderGallery;
  window.ebLightbox = {move:moveLightbox, close:closeLightbox};

  function initLightboxControls(){
    const lb = $('#lightbox'); if(!lb) return;
    $('#lbClose').addEventListener('click', closeLightbox);
    $('#lbPrev').addEventListener('click', ()=> moveLightbox(-1));
    $('#lbNext').addEventListener('click', ()=> moveLightbox(1));
    lb.addEventListener('click', (e)=>{ if(e.target===lb) closeLightbox(); });
    document.addEventListener('keydown', (e)=>{
      if(!lb.classList.contains('is-open')) return;
      if(e.key==='Escape') closeLightbox();
      if(e.key==='ArrowRight') moveLightbox(1);
      if(e.key==='ArrowLeft') moveLightbox(-1);
    });
  }

  /* ---------- year stamp ---------- */
  function initYear(){ $$('[data-year]').forEach(e=> e.textContent = new Date().getFullYear()); }

  /* ---------- boot ---------- */
  function boot(){
    initNav(); initMobileMenu(); initReveal(); initMarquee(); initStatCounters();
    renderUpcoming(); renderGallery(); initLightboxControls(); initYear(); initParallax();
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
