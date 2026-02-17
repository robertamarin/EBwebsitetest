// ============================================
// ETHEREAL BALANCE - PARTNERS MODULE
// Loads partners dynamically from Firestore
// ============================================
import { db, collection, getDocs, query, orderBy } from './firebase-config.js';

async function loadPartners() {
    const track = document.getElementById('partnersTrack');
    const list = document.getElementById('partnersList');

    if (!track && !list) return;

    try {
        const q = query(
            collection(db, 'partners'),
            orderBy('order', 'asc')
        );

        const snapshot = await getDocs(q);
        const partners = [];
        const seenPartnerNames = new Set();
        snapshot.forEach(doc => {
            const data = doc.data();
            const normalizedName = typeof data.name === 'string' ? data.name.trim().toLowerCase() : '';

            if (data.isActive !== false && normalizedName && !seenPartnerNames.has(normalizedName)) {
                seenPartnerNames.add(normalizedName);
                partners.push({ id: doc.id, ...data });
            }
        });

        if (partners.length === 0) return;

        // Build marquee track (duplicate for infinite scroll animation)
        if (track) {
            const logos = partners.map(p => {
                const text = document.createElement('div');
                text.textContent = p.name;
                return `<div class="partner-logo">${text.textContent}</div>`;
            }).join('');
            track.innerHTML = logos + logos; // Duplicated for seamless loop
        }

        // Build partners list (with links)
        if (list) {
            list.innerHTML = partners.map(p => {
                if (p.url) {
                    const nameEl = document.createElement('span');
                    nameEl.textContent = p.name;
                    const urlAttr = p.url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
                    return `<li><a href="${urlAttr}" target="_blank" rel="noopener">${nameEl.textContent}</a></li>`;
                }
                const nameEl = document.createElement('span');
                nameEl.textContent = p.name;
                return `<li>${nameEl.textContent}</li>`;
            }).join('');
        }

    } catch (error) {
        console.error('Error loading partners:', error);
    }
}

// Load partners when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadPartners);
} else {
    loadPartners();
}
