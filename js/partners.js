// ============================================
// ETHEREAL BALANCE - PARTNERS MODULE
// Loads partners dynamically from Firestore
// ============================================
import { db, collection, getDocs, query, where } from './firebase-config.js';

async function loadPartners() {
    const track = document.getElementById('partnersTrack');

    if (!track) return;

    try {
        const q = query(
            collection(db, 'partners'),
            where('isActive', '==', true)
        );

        const snapshot = await getDocs(q);
        const partners = [];
        const seenPartnerNames = new Set();
        snapshot.forEach(doc => {
            const data = doc.data();
            const normalizedName = typeof data.name === 'string' ? data.name.trim().toLowerCase() : '';

            if (normalizedName && !seenPartnerNames.has(normalizedName)) {
                seenPartnerNames.add(normalizedName);
                partners.push({ id: doc.id, ...data });
            }
        });

        // Sort client-side to avoid needing a composite Firestore index
        partners.sort((a, b) => (a.order || 0) - (b.order || 0));

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
