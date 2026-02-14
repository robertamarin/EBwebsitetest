// ============================================
// ETHEREAL BALANCE - CART MODULE
// ============================================

const Cart = {
    KEY: 'eb_cart',

    getCart() {
        try {
            const data = localStorage.getItem(this.KEY);
            return data ? JSON.parse(data) : { items: [], updatedAt: Date.now() };
        } catch {
            return { items: [], updatedAt: Date.now() };
        }
    },

    saveCart(cart) {
        cart.updatedAt = Date.now();
        localStorage.setItem(this.KEY, JSON.stringify(cart));
        this.updateUI();
    },

    addItem(product, quantity = 1) {
        const cart = this.getCart();
        const existing = cart.items.find(i => i.productId === product.id);

        if (existing) {
            existing.quantity += quantity;
        } else {
            cart.items.push({
                productId: product.id,
                name: product.name,
                price: product.price,
                quantity,
                category: product.category,
                image: (product.images && product.images[0]) || ''
            });
        }

        this.saveCart(cart);
        this.openDrawer();
    },

    removeItem(productId) {
        const cart = this.getCart();
        cart.items = cart.items.filter(i => i.productId !== productId);
        this.saveCart(cart);
    },

    updateQuantity(productId, quantity) {
        const cart = this.getCart();
        const item = cart.items.find(i => i.productId === productId);
        if (item) {
            if (quantity <= 0) {
                this.removeItem(productId);
                return;
            }
            item.quantity = quantity;
            this.saveCart(cart);
        }
    },

    getTotal() {
        const cart = this.getCart();
        return cart.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    },

    getCount() {
        const cart = this.getCart();
        return cart.items.reduce((sum, item) => sum + item.quantity, 0);
    },

    clear() {
        localStorage.removeItem(this.KEY);
        this.updateUI();
    },

    updateUI() {
        // Update cart count badge
        const count = this.getCount();
        const badge = document.getElementById('cartCount');
        if (badge) {
            badge.textContent = count;
            badge.style.display = count > 0 ? 'flex' : 'none';
        }

        // Update cart drawer contents
        this.renderDrawer();

        // Update subtotal
        const subtotal = document.getElementById('cartSubtotal');
        if (subtotal) {
            subtotal.textContent = '$' + (this.getTotal() / 100).toFixed(2);
        }

        // Show/hide footer based on items
        const footer = document.getElementById('cartDrawerFooter');
        if (footer) {
            footer.style.display = this.getCount() > 0 ? 'block' : 'none';
        }
    },

    renderDrawer() {
        const container = document.getElementById('cartDrawerItems');
        if (!container) return;

        const cart = this.getCart();

        if (cart.items.length === 0) {
            container.innerHTML = `
                <div class="cart-empty">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
                        <line x1="3" y1="6" x2="21" y2="6"/>
                        <path d="M16 10a4 4 0 01-8 0"/>
                    </svg>
                    <h4>Your bag is empty</h4>
                    <p>Discover our curated collection</p>
                    <a href="#shop" class="btn" onclick="toggleCartDrawer()">Browse Shop</a>
                </div>
            `;
            return;
        }

        container.innerHTML = cart.items.map(item => {
            const categoryLabels = { physical: 'Product', digital: 'Digital', service: 'Service' };
            const categoryLabel = categoryLabels[item.category] || item.category;
            const imageHtml = item.image
                ? `<img src="${escapeAttr(item.image)}" alt="${escapeAttr(item.name)}">`
                : '';

            return `
                <div class="cart-item">
                    <div class="cart-item-image">${imageHtml}</div>
                    <div class="cart-item-details">
                        <div>
                            <div class="cart-item-name">${escapeHtml(item.name)}</div>
                            <div class="cart-item-category">${escapeHtml(categoryLabel)}</div>
                        </div>
                        <div class="cart-item-bottom">
                            <div class="cart-item-quantity">
                                <button class="cart-item-qty-btn" onclick="window.Cart.updateQuantity('${item.productId}', ${item.quantity - 1})">-</button>
                                <span class="cart-item-qty-value">${item.quantity}</span>
                                <button class="cart-item-qty-btn" onclick="window.Cart.updateQuantity('${item.productId}', ${item.quantity + 1})">+</button>
                            </div>
                            <span class="cart-item-price">$${((item.price * item.quantity) / 100).toFixed(2)}</span>
                        </div>
                        <button class="cart-item-remove" onclick="window.Cart.removeItem('${item.productId}')">Remove</button>
                    </div>
                </div>
            `;
        }).join('');
    },

    openDrawer() {
        document.getElementById('cartDrawer')?.classList.add('active');
        document.getElementById('cartDrawerOverlay')?.classList.add('active');
        document.body.style.overflow = 'hidden';
    },

    closeDrawer() {
        document.getElementById('cartDrawer')?.classList.remove('active');
        document.getElementById('cartDrawerOverlay')?.classList.remove('active');
        document.body.style.overflow = '';
    }
};

// Utility functions
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function escapeAttr(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Toggle cart drawer (called from nav button and overlay)
window.toggleCartDrawer = function() {
    const drawer = document.getElementById('cartDrawer');
    if (drawer?.classList.contains('active')) {
        Cart.closeDrawer();
    } else {
        Cart.openDrawer();
    }
};

// Expose Cart globally for other modules
window.Cart = Cart;

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    Cart.updateUI();
});

export default Cart;
