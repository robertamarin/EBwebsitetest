// ============================================
// ETHEREAL BALANCE - CHECKOUT MODULE
// ============================================
import { FUNCTIONS_BASE_URL } from './firebase-config.js';

window.initiateCheckout = async function() {
    const cart = window.Cart.getCart();
    if (cart.items.length === 0) return;

    const btn = document.getElementById('cartCheckoutBtn');
    const originalText = btn.textContent;
    btn.textContent = 'Processing...';
    btn.disabled = true;

    try {
        const response = await fetch(`${FUNCTIONS_BASE_URL}/createCheckoutSession`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                items: cart.items.map(item => ({
                    productId: item.productId,
                    quantity: item.quantity
                })),
                successUrl: window.location.origin + window.location.pathname + '?checkout=success',
                cancelUrl: window.location.origin + window.location.pathname + '?checkout=cancelled#shop'
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Checkout failed');
        }

        const { sessionUrl } = await response.json();

        if (sessionUrl) {
            // Redirect to Stripe Checkout
            window.location.href = sessionUrl;
        } else {
            throw new Error('No checkout URL received');
        }

    } catch (error) {
        console.error('Checkout error:', error);
        alert('Something went wrong with checkout. Please try again.\n\n' + error.message);
        btn.textContent = originalText;
        btn.disabled = false;
    }
};
