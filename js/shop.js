// ============================================
// ETHEREAL BALANCE - SHOP MODULE
// ============================================
import { db, collection, getDocs } from './firebase-config.js';

let allProducts = [];
let currentFilter = 'all';
let currentModalProduct = null;
let currentImageIndex = 0;

// ============================================
// PRODUCT LOADING
// ============================================
async function loadProducts() {
    const grid = document.getElementById('shopGrid');
    const loading = document.getElementById('shopLoading');

    try {
        const snapshot = await getDocs(collection(db, 'products'));
        allProducts = [];

        snapshot.forEach(doc => {
            const data = doc.data();
            const isActive = data.isActive === true || data.active === true;

            if (!isActive) return;

            allProducts.push({
                id: doc.id,
                ...data,
                isActive: true
            });
        });

        allProducts.sort((a, b) => {
            const aTime = a.createdAt?.toMillis?.() || 0;
            const bTime = b.createdAt?.toMillis?.() || 0;
            return bTime - aTime;
        });

        if (loading) loading.classList.add('hidden');
        renderProducts(allProducts);

    } catch (error) {
        console.error('Error loading products:', error);
        if (loading) loading.classList.add('hidden');

        // Show empty state
        if (grid) {
            grid.innerHTML = `
                <div class="shop-empty" style="grid-column: 1 / -1;">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
                        <line x1="3" y1="6" x2="21" y2="6"/>
                        <path d="M16 10a4 4 0 01-8 0"/>
                    </svg>
                    <h3>Shop Coming Soon</h3>
                    <p>Our curated collection is being prepared. Check back soon.</p>
                </div>
            `;
        }
    }
}

// ============================================
// PRODUCT RENDERING
// ============================================
function renderProducts(products) {
    const grid = document.getElementById('shopGrid');
    if (!grid) return;

    const filtered = currentFilter === 'all'
        ? products
        : products.filter(p => p.category === currentFilter);

    if (filtered.length === 0) {
        grid.innerHTML = `
            <div class="shop-empty" style="grid-column: 1 / -1;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
                    <line x1="3" y1="6" x2="21" y2="6"/>
                    <path d="M16 10a4 4 0 01-8 0"/>
                </svg>
                <h3>No Products Found</h3>
                <p>There are no products in this category yet.</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = filtered.map((product, index) => {
        const priceDisplay = formatPrice(product.price);
        const originalPrice = product.compareAtPrice
            ? `<span class="original-price">${formatPrice(product.compareAtPrice)}</span>`
            : '';

        const badgeHtml = getBadgeHtml(product);
        const categoryLabel = getCategoryLabel(product.category);
        const mainImage = product.images && product.images.length > 0
            ? product.images[0]
            : 'assets/shop/placeholder.jpg';

        return `
            <div class="product-card stagger-item" data-category="${escapeHtml(product.category)}" style="animation-delay: ${index * 0.1}s">
                <div class="product-image" onclick="openProductModal('${product.id}')">
                    <img src="${escapeHtml(mainImage)}" alt="${escapeHtml(product.name)}" loading="lazy">
                    ${badgeHtml}
                    <div class="product-quick-view">
                        <button class="quick-view-btn">Quick View</button>
                    </div>
                </div>
                <div class="product-info">
                    <span class="product-category">${escapeHtml(categoryLabel)}</span>
                    <h3>${escapeHtml(product.name)}</h3>
                    <p class="product-price">${priceDisplay}${originalPrice}</p>
                    <button class="product-add-btn" onclick="event.stopPropagation(); window.addToCartFromShop('${product.id}')">
                        Add to Bag
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// ============================================
// FILTERING
// ============================================
window.filterProducts = function(filter) {
    currentFilter = filter;

    // Update active filter button
    document.querySelectorAll('.shop-filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filter);
    });

    renderProducts(allProducts);
};

// ============================================
// PRODUCT DETAIL MODAL
// ============================================
window.openProductModal = function(productId) {
    const product = allProducts.find(p => p.id === productId);
    if (!product) return;

    currentModalProduct = product;
    currentImageIndex = 0;

    const modal = document.getElementById('productModal');
    const details = document.getElementById('productModalDetails');
    const galleryImg = document.getElementById('productModalImage');
    const galleryNav = document.getElementById('productModalGalleryNav');

    // Set main image
    const mainImage = product.images && product.images.length > 0
        ? product.images[0]
        : 'assets/shop/placeholder.jpg';
    galleryImg.src = mainImage;
    galleryImg.alt = product.name;

    // Gallery dots
    if (product.images && product.images.length > 1) {
        galleryNav.innerHTML = product.images.map((_, i) =>
            `<button class="product-modal-gallery-dot ${i === 0 ? 'active' : ''}" onclick="switchModalImage(${i})"></button>`
        ).join('');
        galleryNav.style.display = 'flex';
    } else {
        galleryNav.style.display = 'none';
    }

    // Product details
    const priceHtml = product.compareAtPrice
        ? `${formatPrice(product.price)} <span class="original-price">${formatPrice(product.compareAtPrice)}</span>`
        : formatPrice(product.price);

    const categoryLabel = getCategoryLabel(product.category);
    const inventoryNote = product.category === 'physical' && product.inventory !== -1 && product.inventory <= 5
        ? `<p style="color: var(--terracotta); font-size: 0.85rem; margin-bottom: 16px;">Only ${product.inventory} left in stock</p>`
        : '';

    const quantityControl = product.category !== 'service'
        ? `<div class="product-modal-quantity">
               <label>Quantity</label>
               <div class="quantity-controls">
                   <button class="quantity-btn" onclick="updateModalQuantity(-1)">-</button>
                   <span class="quantity-value" id="modalQuantity">1</span>
                   <button class="quantity-btn" onclick="updateModalQuantity(1)">+</button>
               </div>
           </div>`
        : '';

    const detailsList = product.details
        ? `<div class="product-modal-details-list">
               <h4>Details</h4>
               <ul>${product.details.split('\n').filter(d => d.trim()).map(d => `<li>${escapeHtml(d.trim())}</li>`).join('')}</ul>
           </div>`
        : '';

    details.innerHTML = `
        <span class="product-modal-category">${escapeHtml(categoryLabel)}</span>
        <h2 class="product-modal-title">${escapeHtml(product.name)}</h2>
        <p class="product-modal-price">${priceHtml}</p>
        ${inventoryNote}
        <p class="product-modal-description">${escapeHtml(product.description || '')}</p>
        ${quantityControl}
        <button class="product-modal-add-btn" onclick="addToCartFromModal()">
            Add to Bag
        </button>
        ${detailsList}
    `;

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
};

window.closeProductModal = function() {
    const modal = document.getElementById('productModal');
    modal.classList.remove('active');
    document.body.style.overflow = '';
    currentModalProduct = null;
};

window.switchModalImage = function(index) {
    if (!currentModalProduct || !currentModalProduct.images) return;
    currentImageIndex = index;

    const img = document.getElementById('productModalImage');
    img.src = currentModalProduct.images[index];

    document.querySelectorAll('.product-modal-gallery-dot').forEach((dot, i) => {
        dot.classList.toggle('active', i === index);
    });
};

window.updateModalQuantity = function(delta) {
    const el = document.getElementById('modalQuantity');
    let qty = parseInt(el.textContent) + delta;
    if (qty < 1) qty = 1;
    if (qty > 99) qty = 99;

    // Check inventory
    if (currentModalProduct && currentModalProduct.category === 'physical' &&
        currentModalProduct.inventory !== -1 && qty > currentModalProduct.inventory) {
        qty = currentModalProduct.inventory;
    }

    el.textContent = qty;
};

window.addToCartFromModal = function() {
    if (!currentModalProduct) return;
    const qty = parseInt(document.getElementById('modalQuantity')?.textContent || '1');
    window.Cart.addItem(currentModalProduct, qty);

    // Visual feedback
    const btn = document.querySelector('.product-modal-add-btn');
    const originalText = btn.textContent;
    btn.textContent = 'Added!';
    btn.style.background = 'var(--sage)';
    setTimeout(() => {
        btn.textContent = originalText;
        btn.style.background = '';
    }, 1500);
};

window.addToCartFromShop = function(productId) {
    const product = allProducts.find(p => p.id === productId);
    if (!product) return;
    window.Cart.addItem(product, 1);

    // Visual feedback on card button
    const cards = document.querySelectorAll('.product-card');
    cards.forEach(card => {
        const btn = card.querySelector('.product-add-btn');
        if (btn && card.querySelector(`[onclick*="${productId}"]`)) {
            const originalText = btn.textContent;
            btn.textContent = 'Added!';
            btn.classList.add('added');
            setTimeout(() => {
                btn.textContent = originalText;
                btn.classList.remove('added');
            }, 1500);
        }
    });
};

// ============================================
// CHECKOUT SUCCESS HANDLER
// ============================================
function handleCheckoutReturn() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') === 'success') {
        window.Cart.clear();
        const banner = document.getElementById('orderSuccessBanner');
        if (banner) {
            banner.classList.add('active');
        }
        // Clean URL
        window.history.replaceState({}, '', window.location.pathname + '#shop');
    }
}

window.closeOrderBanner = function() {
    const banner = document.getElementById('orderSuccessBanner');
    if (banner) banner.classList.remove('active');
};

// ============================================
// UTILITY FUNCTIONS
// ============================================
function formatPrice(cents) {
    return '$' + (cents / 100).toFixed(2);
}

function getCategoryLabel(category) {
    const labels = {
        physical: 'Products',
        digital: 'Digital',
        service: 'Services'
    };
    return labels[category] || category;
}

function getBadgeHtml(product) {
    if (product.compareAtPrice && product.compareAtPrice > product.price) {
        return '<span class="product-badge sale">Sale</span>';
    }
    if (product.isFeatured) {
        return '<span class="product-badge">Featured</span>';
    }
    if (product.category === 'digital') {
        return '<span class="product-badge digital">Digital</span>';
    }
    if (product.category === 'service') {
        return '<span class="product-badge service">Service</span>';
    }
    return '';
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeProductModal();
    }
});

// Close modal on overlay click
document.getElementById('productModal')?.addEventListener('click', (e) => {
    if (e.target.classList.contains('product-modal-overlay')) {
        closeProductModal();
    }
});

// ============================================
// INITIALIZE
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    loadProducts();
    handleCheckoutReturn();
});
