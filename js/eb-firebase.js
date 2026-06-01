// ============================================================
// ETHEREAL BALANCE — Firebase (read-only data + community signup)
// Optional enhancement layer: if Firestore has live events / gallery /
// partners they override the static data in events.js. Falls back silently.
// ============================================================
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getFirestore, collection, getDocs, addDoc, query, where, Timestamp }
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

// ---- live data overrides ----
window._firestoreReady = (async () => {
  if(!db) return false;
  try {
    const snap = await getDocs(query(collection(db,'events'), where('active','==',true)));
    if(snap.size > 0){
      window._firestoreEvents = snap.docs.map(d=>{ const x=d.data(); return {
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
        title:x.title||'', date:x.date||'', coverImage:x.coverImage||'', coverLabel:x.coverLabel||x.title||'',
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
        await addDoc(collection(db,'community'), {
          name, email, phone, smsOptIn: sms, createdAt: Timestamp.now(), source:'website'
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
