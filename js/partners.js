// ============================================
// ETHEREAL BALANCE - PARTNERS MODULE
// Loads partners dynamically from Firestore and renders:
//   1. the "In Good Company" marquee (#partnersTrack) on landing pages
//   2. the full partners showcase grid (#partnersList) on partners.html
// Names link to the partner's site when a `website` field is set.
// ============================================
import { db, collection, getDocs, query, where } from './firebase-config.js';

// Seed fallback so the showcase page never looks empty before admin data loads.
// Add real partners + website URLs in the admin panel; they override this.
const SEED_PARTNERS = [
    { name: 'Park Hyatt Aviara', category: 'Hotel & Resort' },
    { name: 'Orli Hotel', category: 'Hotel' },
    { name: 'Lucia', category: 'Hotel' },
    { name: 'Moniker', category: 'Community' },
    { name: 'SAGO', category: 'Community' },
    { name: 'Studio Casually', category: 'Studio' },
    { name: 'LSKD', category: 'Brand' },
    { name: 'ROAM Homeware', category: 'Brand' },
    { name: 'Wonderland', category: 'Community' }
];

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
}
function escapeAttr(text) {
    return String(text == null ? '' : text)
        .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function normalizeUrl(url) {
    if (!url) return '';
    const u = String(url).trim();
    if (!u) return '';
    return /^https?:\/\//i.test(u) ? u : 'https://' + u;
}

async function fetchPartners() {
    try {
        const snapshot = await getDocs(query(collection(db, 'partners'), where('isActive', '==', true)));
        const partners = [];
        const seen = new Set();
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const key = typeof data.name === 'string' ? data.name.trim().toLowerCase() : '';
            if (key && !seen.has(key)) { seen.add(key); partners.push({ id: docSnap.id, ...data }); }
        });
        partners.sort((a, b) => (a.order || 0) - (b.order || 0));
        return partners;
    } catch (error) {
        console.error('Error loading partners:', error);
        return [];
    }
}

function marqueeItem(p) {
    const url = normalizeUrl(p.website || p.url);
    const name = escapeHtml(p.name);
    return url
        ? `<a class="marquee__item" href="${escapeAttr(url)}" target="_blank" rel="noopener">${name}</a>`
        : `<span class="marquee__item">${name}</span>`;
}

function renderMarquee(partners) {
    const track = document.getElementById('partnersTrack');
    if (!track || !partners.length) return; // keep static fallback markup if no data
    const items = partners.map(marqueeItem).join('');
    track.innerHTML = items + items;       // duplicate for seamless loop
    track.dataset.cloned = '1';            // stop site.js initMarquee from cloning again
}

function partnerCard(p) {
    const url = normalizeUrl(p.website || p.url);
    const name = escapeHtml(p.name);
    const cat = p.category ? `<span class="partner-card__cat">${escapeHtml(p.category)}</span>` : '';
    const inner = `<span class="partner-card__name">${name}</span>${cat}`;
    return url
        ? `<a class="partner-card" href="${escapeAttr(url)}" target="_blank" rel="noopener">${inner}<span class="partner-card__go">Visit site &#8599;</span></a>`
        : `<div class="partner-card">${inner}</div>`;
}

function renderList(partners) {
    const grid = document.getElementById('partnersList');
    if (!grid) return;
    const data = partners.length ? partners : SEED_PARTNERS;
    grid.innerHTML = data.map(partnerCard).join('');
}

async function init() {
    const needsMarquee = document.getElementById('partnersTrack');
    const needsList = document.getElementById('partnersList');
    if (!needsMarquee && !needsList) return;
    const partners = await fetchPartners();
    renderMarquee(partners);
    renderList(partners);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
