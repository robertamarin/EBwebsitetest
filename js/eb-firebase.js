// ============================================================
// ETHEREAL BALANCE — Firebase (read-only data + community signup)
// Optional enhancement layer: if Firestore has live events / gallery /
// partners they override the static data in events.js. Falls back silently.
// ============================================================
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getFirestore, collection, getDocs, addDoc, query, where, Timestamp, doc, getDoc }
  from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyAMk6ytOsRIp4ICQRMZrdhQe90-gMEuDDM",
  authDomain: "ethereal-balance.firebaseapp.com",
  projectId: "ethereal-balance",
  storageBucket: "ethereal-balance.firebasestorage.app",
  messagingSenderId: "1062807553833",
  appId: "1:1062807553833:web:0e368360755c03d5fe9938"
};

let db;
try { db = getFirestore(initializeApp(firebaseConfig)); }
catch(e){ console.log('Firebase init skipped:', e.message); }

// ---- editable text infrastructure ----
// Shared with admin.js (js/admin.js EB_TEXT_SELECTORS) — keep IDENTICAL so the
// positional slot keys line up between the public site and the admin editor.
const EB_TEXT_SELECTORS = ['.hero__eyebrow','.hero h1','.hero__sub','.page-hero .eyebrow','.page-hero h1','.page-hero .lede','.section .eyebrow','.section .h2','.section .lede','.section--tight .eyebrow','.section--tight .h2','.section--tight .lede','.why__h','.why__p','.feature-card h3','.feature-card p','.exp-row__title','.exp-row__desc','.offer-row__kicker','.offer-row__title','.offer-row__desc','.step h3','.step p','.stat__num','.stat__label','.media-split__tag','.quote','.break__attr','.community-inner h2','.community-inner p','.cta-band h2','.cta-band .lede','.footer__brand p'];
function ebPagePrefix(name){
  let f = (name != null ? name : (location.pathname.split('/').pop() || 'index.html'));
  f = f.split('/').pop();
  if(!f) f = 'index.html';
  return f.replace(/\.html$/i,'') || 'index';
}

// ---- live data overrides ----
window._firestoreReady = (async () => {
  if(!db) return false;
  try {
    // Read all events, then hide only the ones explicitly turned off. Mirrors
    // the admin's "active unless turned off" logic so events that never had an
    // `active` field written still show up.
    const snap = await getDocs(collection(db,'events'));
    const liveDocs = snap.docs.filter(d => d.data().active !== false);
    if(liveDocs.length > 0){
      window._firestoreEvents = liveDocs.map(d=>{ const x=d.data(); return {
        title:x.title||'', date:x.dateDisplay||'', _sortDate:x.date||'', time:x.time||'',
        type:x.type||'', venue:x.venue||'', description:x.description||'', bookingLink:x.bookingLink||'#'
      };});
      window._firestoreEvents.sort((a,b)=>(a._sortDate||'').localeCompare(b._sortDate||''));
    }
  } catch(e){ console.log('Events fetch skipped:', e.message); }

  try {
    const snap = await getDocs(query(collection(db,'gallery'), where('active','==',true)));
    if(snap.size > 0){
      window._firestoreGallery = snap.docs.map(d=>{ const x=d.data(); return {
        title:x.title||'', date:x.date||'', description:x.description||'', coverImage:x.coverImage||'', coverLabel:x.coverLabel||x.title||'',
        _sortOrder:x.sortOrder||0,
        photos:(x.photos||[]).map(p=>({src:p.url||p.src||'', label:p.label||'', type:p.type||'image', poster:p.poster||''}))
      };});
      window._firestoreGallery.sort((a,b)=>(b._sortOrder||0)-(a._sortOrder||0));
    }
  } catch(e){ console.log('Gallery fetch skipped:', e.message); }

  if(typeof window.renderEvents==='function') window.renderEvents();
  if(typeof window.renderGalleryFromData==='function') window.renderGalleryFromData();
  return true;
})();

// ---- store visibility ----
// If the admin "store enabled" toggle is off, remove every store entry point
// (nav Shop link, mobile menu link, footer link, and the cart icon) site-wide.
(async () => {
  if(!db) return;
  try {
    const snap = await getDoc(doc(db,'settings','store'));
    const enabled = !snap.exists() || snap.data().storeEnabled !== false;
    if(enabled) return;
    document.querySelectorAll('a[href="shop.html"]').forEach(a=>{
      const li = a.closest('li');
      (li || a).style.display = 'none';
    });
    document.querySelectorAll('.nav__cart').forEach(el=> el.style.display='none');
  } catch(e){ console.log('Store settings skipped:', e.message); }
})();

// ---- page image overrides ----
// Any <img data-img-slot="page.key"> can be swapped from the admin portal
// without touching code. The static src stays as the fallback.
(async () => {
  if(!db) return;
  const slots = document.querySelectorAll('img[data-img-slot]');
  if(!slots.length) return;
  try {
    const snap = await getDoc(doc(db,'settings','pageImages'));
    if(!snap.exists()) return;
    const images = snap.data().images || {};
    slots.forEach(img => {
      const url = images[img.dataset.imgSlot];
      if(url) img.src = url;
    });
  } catch(e){ console.log('Page images skipped:', e.message); }
})();

// ---- page text overrides ----
// Every matched text element is tagged with a positional data-edit key and,
// if the admin has set an override for that key, its content is swapped.
// The authored HTML stays as the fallback, so nothing changes by default.
(async () => {
  if(!db) return;
  let els;
  try { els = document.querySelectorAll(EB_TEXT_SELECTORS.join(',')); }
  catch(e){ return; }
  if(!els.length) return;
  const prefix = ebPagePrefix();
  els.forEach((el,i)=>{ el.dataset.edit = prefix + '.' + i; });
  try {
    const snap = await getDoc(doc(db,'settings','pageText'));
    if(!snap.exists()) return;
    const text = snap.data().text || {};
    els.forEach(el=>{
      const v = text[el.dataset.edit];
      if(v != null && v !== '') el.innerHTML = v;
    });
  } catch(e){ console.log('Page text skipped:', e.message); }
})();

// ---- community signup ----
const form = document.getElementById('communitySignupForm');
if(form){
  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const btn = document.getElementById('communitySubmitBtn');
    const name = (document.getElementById('communityName')||{}).value || '';
    const email = (document.getElementById('communityEmail')||{}).value || '';
    const phone = (document.getElementById('communityPhone')||{}).value || '';
    const sms = (document.getElementById('communitySmsOptIn')||{}).checked || false;
    if(!name || !email) return;
    if(btn){ btn.disabled = true; btn.textContent = 'Joining…'; }
    try {
      if(db){
        // Write to 'subscribers' with the exact shape the admin reads and the
        // Firestore rules require (name, email, active, joinedAt). The old code
        // wrote to a 'community' collection that no rule allowed, so every
        // public signup silently failed and never reached the admin list.
        await addDoc(collection(db,'subscribers'), {
          name, email, phone, smsOptIn: sms, active: true,
          source:'website', joinedAt: Timestamp.now()
        });
      }
      const wrap = document.getElementById('communityFormWrapper');
      const ok = document.getElementById('communitySuccess');
      if(wrap) wrap.style.display='none';
      if(ok) ok.classList.add('is-shown');
    } catch(err){
      console.log('Community signup error:', err.message);
      if(btn){ btn.disabled=false; btn.textContent='Join the community'; }
      alert('Something went wrong — please try again.');
    }
  });
}
