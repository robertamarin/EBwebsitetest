// ============================================
// ETHEREAL BALANCE - TESTIMONIALS MODULE
// Renders admin-managed testimonials filtered by category into
// #testimonialsGrid (data-category="Corporate" or "Training,Class").
// The section stays hidden until at least one matching testimonial exists.
// ============================================
import { db, collection, getDocs } from './firebase-config.js';

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

function card(t) {
    const logo = t.imageUrl
        ? `<img class="testimonial__logo" src="${escapeAttr(t.imageUrl)}" alt="${escapeAttr(t.company || t.name)}" loading="lazy">`
        : '';
    const title = t.title ? `<span class="testimonial__title">${escapeHtml(t.title)}</span>` : '';
    const company = t.company ? `<span class="testimonial__company">${escapeHtml(t.company)}</span>` : '';
    return `
        <figure class="testimonial reveal">
            <svg class="testimonial__mark" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9.5 6C6.5 7.3 5 9.6 5 13v5h6v-6H8.2c.2-1.8 1-3 2.6-3.7L9.5 6zm9 0c-3 1.3-4.5 3.6-4.5 7v5h6v-6h-2.8c.2-1.8 1-3 2.6-3.7L18.5 6z"/></svg>
            <blockquote class="testimonial__quote">${escapeHtml(t.quote)}</blockquote>
            <figcaption class="testimonial__who">
                ${logo}
                <span class="testimonial__name">${escapeHtml(t.name)}</span>
                ${title}
                ${company}
            </figcaption>
        </figure>`;
}

async function loadTestimonials() {
    const grid = document.getElementById('testimonialsGrid');
    const section = document.getElementById('testimonials');
    if (!grid) return;

    const cats = (grid.dataset.category || '')
        .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

    try {
        const snapshot = await getDocs(collection(db, 'testimonials'));
        const items = [];
        snapshot.forEach(d => {
            const x = d.data();
            if (x.isActive === false) return;
            const c = (x.category || '').toLowerCase();
            if (cats.length && !cats.includes(c)) return;
            items.push({ id: d.id, ...x });
        });
        items.sort((a, b) => (a.order || 0) - (b.order || 0));

        if (!items.length) {
            if (section) section.style.display = 'none';
            return;
        }

        grid.innerHTML = items.map(card).join('');
        if (section) section.style.display = '';

        if ('IntersectionObserver' in window) {
            const io = new IntersectionObserver((entries) => {
                entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } });
            }, { threshold: 0.12 });
            grid.querySelectorAll('.reveal').forEach(el => io.observe(el));
        } else {
            grid.querySelectorAll('.reveal').forEach(el => el.classList.add('is-in'));
        }
    } catch (error) {
        console.error('Error loading testimonials:', error);
        if (section) section.style.display = 'none';
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadTestimonials);
} else {
    loadTestimonials();
}
