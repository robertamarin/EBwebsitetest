// ============================================
// ETHEREAL BALANCE - INSTRUCTORS MODULE
// Loads instructors dynamically from Firestore
// ============================================
import { db, collection, getDocs, query, orderBy } from './firebase-config.js';

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function escapeAttr(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function initials(name) {
    return (name || '')
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map(w => w.charAt(0).toUpperCase())
        .join('');
}

function buildCard(inst) {
    const photo = inst.photoUrl
        ? `<img src="${escapeAttr(inst.photoUrl)}" alt="${escapeAttr(inst.name)}" loading="lazy">`
        : `<div class="instructor-photo-placeholder">${escapeHtml(initials(inst.name))}</div>`;

    const tags = (inst.specialties || []).length
        ? `<div class="instructor-specialties">${inst.specialties
              .map(s => `<span class="instructor-tag">${escapeHtml(s)}</span>`)
              .join('')}</div>`
        : '';

    const social = inst.instagram
        ? `<div class="instructor-social">
                <a href="${escapeAttr(inst.instagram)}" target="_blank" rel="noopener">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" stroke="none"/></svg>
                    Instagram
                </a>
           </div>`
        : '';

    const title = inst.title ? `<div class="instructor-title">${escapeHtml(inst.title)}</div>` : '';
    const bio = inst.bio ? `<p class="instructor-bio">${escapeHtml(inst.bio)}</p>` : '';

    return `
        <article class="instructor-card">
            <div class="instructor-photo">${photo}</div>
            <div class="instructor-info">
                <h3 class="instructor-name">${escapeHtml(inst.name)}</h3>
                ${title}
                ${bio}
                ${tags}
                ${social}
            </div>
        </article>
    `;
}

async function loadInstructors() {
    const grid = document.getElementById('instructorsGrid');
    const section = document.getElementById('instructors');
    if (!grid) return;

    try {
        let snapshot;
        try {
            snapshot = await getDocs(query(collection(db, 'instructors'), orderBy('order', 'asc')));
        } catch (queryError) {
            console.warn('Falling back to non-ordered instructor query:', queryError);
            snapshot = await getDocs(collection(db, 'instructors'));
        }

        const instructors = [];
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            if (data.isActive !== false) instructors.push({ id: docSnap.id, ...data });
        });

        // Hide the whole section if there are no instructors to show
        if (instructors.length === 0) {
            if (section) section.style.display = 'none';
            return;
        }

        grid.innerHTML = instructors.map(buildCard).join('');

        // Staggered fade-in as cards scroll into view. Opacity-only so the
        // CSS hover lift (transform) keeps working without conflict.
        const cards = grid.querySelectorAll('.instructor-card');
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('revealed');
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.12 });

        cards.forEach((card, i) => {
            card.style.transitionDelay = `${i * 0.08}s`;
            observer.observe(card);
        });
    } catch (error) {
        console.error('Error loading instructors:', error);
        if (section) section.style.display = 'none';
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadInstructors);
} else {
    loadInstructors();
}
