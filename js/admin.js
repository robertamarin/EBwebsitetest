// ============================================
// ETHEREAL BALANCE - ADMIN DASHBOARD MODULE
// ============================================
import {
    db, auth,
    collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
    query, where, orderBy, limit, onSnapshot,
    serverTimestamp, firestoreIncrement,
    signInWithEmailAndPassword, onAuthStateChanged, signOut
} from './firebase-config.js';

// ============================================
// AUTHENTICATION
// ============================================
onAuthStateChanged(auth, (user) => {
    if (user) {
        document.getElementById('adminLogin').style.display = 'none';
        document.getElementById('adminDashboard').style.display = 'flex';
        loadDashboardData();
    } else {
        document.getElementById('adminLogin').style.display = 'flex';
        document.getElementById('adminDashboard').style.display = 'none';
    }
});

document.getElementById('adminLoginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('adminEmail').value;
    const password = document.getElementById('adminPassword').value;
    const errorEl = document.getElementById('adminError');
    errorEl.textContent = '';

    try {
        await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
        errorEl.textContent = 'Invalid email or password';
    }
});

window.adminLogout = async function() {
    await signOut(auth);
};

// ============================================
// SECTION NAVIGATION
// ============================================
window.switchAdminSection = function(section) {
    // Hide all sections
    document.querySelectorAll('.admin-section').forEach(el => {
        el.style.display = 'none';
    });

    // Show target section
    const target = document.getElementById('section' + section.charAt(0).toUpperCase() + section.slice(1));
    if (target) target.style.display = 'block';

    // Update nav active state
    document.querySelectorAll('.admin-nav-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.section === section);
    });

    // Load section data
    switch (section) {
        case 'overview': loadDashboardData(); break;
        case 'products': loadProducts(); break;
        case 'orders': loadOrders(); break;
        case 'settings': loadSettings(); break;
    }

    // Close sidebar on mobile
    document.getElementById('adminSidebar')?.classList.remove('open');
};

window.toggleAdminSidebar = function() {
    document.getElementById('adminSidebar')?.classList.toggle('open');
};

// ============================================
// DASHBOARD OVERVIEW
// ============================================
async function loadDashboardData() {
    try {
        // Load all orders
        const ordersSnapshot = await getDocs(
            query(collection(db, 'orders'), orderBy('createdAt', 'desc'))
        );

        const orders = [];
        ordersSnapshot.forEach(doc => {
            orders.push({ id: doc.id, ...doc.data() });
        });

        // Calculate stats
        const now = new Date();
        const thisMonth = orders.filter(o => {
            const d = o.createdAt?.toDate?.() || new Date(0);
            return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        });

        const totalRevenue = orders
            .filter(o => o.status !== 'refunded')
            .reduce((sum, o) => sum + (o.total || 0), 0);

        const monthRevenue = thisMonth
            .filter(o => o.status !== 'refunded')
            .reduce((sum, o) => sum + (o.total || 0), 0);

        // Load product count
        const productsSnapshot = await getDocs(collection(db, 'products'));
        const productCount = productsSnapshot.size;

        // Render stats
        const statsGrid = document.getElementById('adminStats');
        statsGrid.innerHTML = `
            <div class="admin-stat-card">
                <div class="admin-stat-label">Total Revenue</div>
                <div class="admin-stat-value">$${(totalRevenue / 100).toFixed(2)}</div>
            </div>
            <div class="admin-stat-card">
                <div class="admin-stat-label">This Month</div>
                <div class="admin-stat-value">$${(monthRevenue / 100).toFixed(2)}</div>
                <div class="admin-stat-change">${thisMonth.length} orders</div>
            </div>
            <div class="admin-stat-card">
                <div class="admin-stat-label">Total Orders</div>
                <div class="admin-stat-value">${orders.length}</div>
            </div>
            <div class="admin-stat-card">
                <div class="admin-stat-label">Products</div>
                <div class="admin-stat-value">${productCount}</div>
            </div>
        `;

        // Render recent orders (last 10)
        const recent = orders.slice(0, 10);
        renderOrdersTable(recent, 'adminRecentOrders');

    } catch (error) {
        console.error('Error loading dashboard:', error);
    }
}

// ============================================
// PRODUCTS MANAGEMENT
// ============================================
let allAdminProducts = [];

async function loadProducts() {
    try {
        const snapshot = await getDocs(
            query(collection(db, 'products'), orderBy('createdAt', 'desc'))
        );

        allAdminProducts = [];
        snapshot.forEach(doc => {
            allAdminProducts.push({ id: doc.id, ...doc.data() });
        });

        const container = document.getElementById('adminProductsTable');

        if (allAdminProducts.length === 0) {
            container.innerHTML = '<p style="padding: 40px; text-align: center; color: var(--stone);">No products yet. Click "Add Product" to create your first product.</p>';
            return;
        }

        container.innerHTML = `
            <table class="admin-table">
                <thead>
                    <tr>
                        <th>Image</th>
                        <th>Name</th>
                        <th>Category</th>
                        <th>Price</th>
                        <th>Inventory</th>
                        <th>Status</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${allAdminProducts.map(p => {
                        const img = p.images && p.images[0]
                            ? `<img class="product-thumb" src="${escapeAttr(p.images[0])}" alt="">`
                            : '<div class="product-thumb" style="background: var(--sand);"></div>';
                        const categoryLabels = { physical: 'Product', digital: 'Digital', service: 'Service' };
                        return `
                            <tr>
                                <td>${img}</td>
                                <td><strong>${escapeHtml(p.name)}</strong></td>
                                <td>${escapeHtml(categoryLabels[p.category] || p.category)}</td>
                                <td>$${(p.price / 100).toFixed(2)}</td>
                                <td>${p.inventory === -1 ? '&infin;' : p.inventory}</td>
                                <td><span class="status-badge ${p.isActive ? 'active' : 'inactive'}">${p.isActive ? 'Active' : 'Inactive'}</span></td>
                                <td>
                                    <div class="admin-actions">
                                        <button class="admin-action-btn" onclick="editProduct('${p.id}')" title="Edit">
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                        </button>
                                        <button class="admin-action-btn delete" onclick="deleteProduct('${p.id}', '${escapeAttr(p.name)}')" title="Delete">
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        `;
    } catch (error) {
        console.error('Error loading products:', error);
    }
}

window.openProductEditor = function(productId) {
    const modal = document.getElementById('productEditorModal');
    const title = document.getElementById('productEditorTitle');
    const form = document.getElementById('productEditorForm');

    // Reset form
    form.reset();
    document.getElementById('productEditId').value = '';
    document.getElementById('productInventory').value = '-1';
    document.getElementById('productActive').checked = true;
    document.getElementById('productFeatured').checked = false;

    if (productId) {
        title.textContent = 'Edit Product';
        const product = allAdminProducts.find(p => p.id === productId);
        if (product) {
            document.getElementById('productEditId').value = product.id;
            document.getElementById('productName').value = product.name || '';
            document.getElementById('productPrice').value = (product.price / 100).toFixed(2);
            document.getElementById('productCategory').value = product.category || 'physical';
            document.getElementById('productSubcategory').value = product.subcategory || '';
            document.getElementById('productDescription').value = product.description || '';
            document.getElementById('productImages').value = (product.images || []).join(', ');
            document.getElementById('productInventory').value = product.inventory ?? -1;
            document.getElementById('productComparePrice').value = product.compareAtPrice ? (product.compareAtPrice / 100).toFixed(2) : '';
            document.getElementById('productDetails').value = product.details || '';
            document.getElementById('productDigitalUrl').value = product.digitalFileUrl || '';
            document.getElementById('productActive').checked = product.isActive !== false;
            document.getElementById('productFeatured').checked = product.isFeatured === true;
        }
    } else {
        title.textContent = 'Add Product';
    }

    modal.style.display = 'flex';
};

window.closeProductEditor = function() {
    document.getElementById('productEditorModal').style.display = 'none';
};

window.editProduct = function(productId) {
    window.openProductEditor(productId);
};

window.saveProduct = async function(e) {
    e.preventDefault();

    const editId = document.getElementById('productEditId').value;
    const priceValue = parseFloat(document.getElementById('productPrice').value);
    const comparePriceValue = parseFloat(document.getElementById('productComparePrice').value);
    const imagesRaw = document.getElementById('productImages').value;

    const productData = {
        name: document.getElementById('productName').value.trim(),
        slug: document.getElementById('productName').value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        price: Math.round(priceValue * 100), // Convert to cents
        category: document.getElementById('productCategory').value,
        subcategory: document.getElementById('productSubcategory').value.trim(),
        description: document.getElementById('productDescription').value.trim(),
        images: imagesRaw ? imagesRaw.split(',').map(s => s.trim()).filter(Boolean) : [],
        inventory: parseInt(document.getElementById('productInventory').value) || -1,
        compareAtPrice: comparePriceValue ? Math.round(comparePriceValue * 100) : null,
        details: document.getElementById('productDetails').value.trim(),
        digitalFileUrl: document.getElementById('productDigitalUrl').value.trim() || null,
        isActive: document.getElementById('productActive').checked,
        isFeatured: document.getElementById('productFeatured').checked,
        updatedAt: serverTimestamp()
    };

    try {
        if (editId) {
            await updateDoc(doc(db, 'products', editId), productData);
            showToast('Product updated successfully', 'success');
        } else {
            productData.createdAt = serverTimestamp();
            await addDoc(collection(db, 'products'), productData);
            showToast('Product created successfully', 'success');
        }

        closeProductEditor();
        loadProducts();
    } catch (error) {
        console.error('Error saving product:', error);
        showToast('Error saving product', 'error');
    }
};

window.deleteProduct = async function(productId, productName) {
    if (!confirm(`Are you sure you want to delete "${productName}"? This cannot be undone.`)) {
        return;
    }

    try {
        await deleteDoc(doc(db, 'products', productId));
        showToast('Product deleted', 'success');
        loadProducts();
    } catch (error) {
        console.error('Error deleting product:', error);
        showToast('Error deleting product', 'error');
    }
};

// ============================================
// ORDERS MANAGEMENT
// ============================================
let allAdminOrders = [];

window.loadOrders = async function() {
    try {
        const statusFilter = document.getElementById('orderStatusFilter')?.value || 'all';

        let q;
        if (statusFilter === 'all') {
            q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
        } else {
            q = query(
                collection(db, 'orders'),
                where('status', '==', statusFilter),
                orderBy('createdAt', 'desc')
            );
        }

        const snapshot = await getDocs(q);
        allAdminOrders = [];
        snapshot.forEach(doc => {
            allAdminOrders.push({ id: doc.id, ...doc.data() });
        });

        renderOrdersTable(allAdminOrders, 'adminOrdersTable');

    } catch (error) {
        console.error('Error loading orders:', error);
    }
};

function renderOrdersTable(orders, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (orders.length === 0) {
        container.innerHTML = '<p style="padding: 40px; text-align: center; color: var(--stone);">No orders found.</p>';
        return;
    }

    container.innerHTML = `
        <table class="admin-table">
            <thead>
                <tr>
                    <th>Order</th>
                    <th>Date</th>
                    <th>Customer</th>
                    <th>Items</th>
                    <th>Total</th>
                    <th>Status</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${orders.map(order => {
                    const orderId = order.id.slice(0, 8).toUpperCase();
                    const date = order.createdAt?.toDate?.()
                        ? order.createdAt.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                        : 'N/A';
                    const itemCount = order.items?.reduce((sum, i) => sum + i.quantity, 0) || 0;

                    return `
                        <tr>
                            <td><strong>#${orderId}</strong></td>
                            <td>${date}</td>
                            <td>${escapeHtml(order.customerName || order.customerEmail || 'N/A')}</td>
                            <td>${itemCount} item${itemCount !== 1 ? 's' : ''}</td>
                            <td>$${((order.total || 0) / 100).toFixed(2)}</td>
                            <td><span class="status-badge ${order.status}">${order.status}</span></td>
                            <td>
                                <button class="admin-action-btn" onclick="openOrderDetail('${order.id}')" title="View">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                </button>
                            </td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;
}

window.openOrderDetail = function(orderId) {
    const order = allAdminOrders.find(o => o.id === orderId);
    if (!order) return;

    const modal = document.getElementById('orderDetailModal');
    const content = document.getElementById('orderDetailContent');

    const shortId = order.id.slice(0, 8).toUpperCase();
    const date = order.createdAt?.toDate?.()
        ? order.createdAt.toDate().toLocaleDateString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
        })
        : 'N/A';

    const itemsHtml = (order.items || []).map(item => `
        <div class="order-item-row">
            <span>${escapeHtml(item.name)} &times; ${item.quantity}</span>
            <span>$${((item.price * item.quantity) / 100).toFixed(2)}</span>
        </div>
    `).join('');

    const shippingHtml = order.shippingAddress ? `
        <div class="order-detail-section">
            <h4>Shipping Address</h4>
            <p style="font-size: 0.9rem; color: var(--charcoal); line-height: 1.6;">
                ${escapeHtml(order.shippingName || '')}<br>
                ${escapeHtml(order.shippingAddress.line1 || '')}<br>
                ${order.shippingAddress.line2 ? escapeHtml(order.shippingAddress.line2) + '<br>' : ''}
                ${escapeHtml(order.shippingAddress.city || '')}, ${escapeHtml(order.shippingAddress.state || '')} ${escapeHtml(order.shippingAddress.postal_code || '')}<br>
                ${escapeHtml(order.shippingAddress.country || '')}
            </p>
        </div>
    ` : '';

    const trackingHtml = order.shippingAddress ? `
        <div class="order-detail-section">
            <h4>Tracking</h4>
            ${order.trackingNumber
                ? `<p style="font-size: 0.9rem;">
                    ${escapeHtml(order.trackingCarrier || '')} - ${escapeHtml(order.trackingNumber)}
                   </p>`
                : '<p style="font-size: 0.85rem; color: var(--stone);">No tracking number added yet.</p>'
            }
            <div class="tracking-form">
                <select id="trackingCarrier_${order.id}">
                    <option value="USPS">USPS</option>
                    <option value="UPS">UPS</option>
                    <option value="FedEx">FedEx</option>
                    <option value="DHL">DHL</option>
                    <option value="Other">Other</option>
                </select>
                <input type="text" id="trackingNumber_${order.id}" placeholder="Tracking number" value="${escapeAttr(order.trackingNumber || '')}">
                <button onclick="saveTracking('${order.id}')">Save</button>
            </div>
        </div>
    ` : '';

    content.innerHTML = `
        <div class="order-detail-header">
            <div>
                <h2 style="margin-bottom: 4px;">Order #${shortId}</h2>
                <div class="order-detail-id">${date}</div>
            </div>
            <span class="status-badge ${order.status}">${order.status}</span>
        </div>

        <div class="order-detail-section">
            <h4>Customer</h4>
            <p style="font-size: 0.9rem; color: var(--charcoal);">
                ${escapeHtml(order.customerName || 'N/A')}<br>
                <a href="mailto:${escapeAttr(order.customerEmail || '')}" style="color: var(--sage-dark);">${escapeHtml(order.customerEmail || '')}</a>
            </p>
        </div>

        <div class="order-detail-section">
            <h4>Items</h4>
            ${itemsHtml}
            <div class="order-total-row">
                <span>Total</span>
                <span>$${((order.total || 0) / 100).toFixed(2)}</span>
            </div>
        </div>

        ${shippingHtml}
        ${trackingHtml}

        <div class="order-detail-section">
            <h4>Update Status</h4>
            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                ${['paid', 'fulfilled', 'shipped', 'delivered', 'refunded'].map(status => `
                    <button class="btn-admin-secondary" style="padding: 8px 16px; font-size: 0.8rem; ${order.status === status ? 'background: var(--charcoal); color: white; border-color: var(--charcoal);' : ''}"
                        onclick="updateOrderStatus('${order.id}', '${status}')">
                        ${status.charAt(0).toUpperCase() + status.slice(1)}
                    </button>
                `).join('')}
            </div>
        </div>

        <div class="order-detail-section">
            <h4>Notes</h4>
            <textarea id="orderNotes_${order.id}" style="width: 100%; padding: 12px; border: 1.5px solid var(--sand); border-radius: 10px; font-family: 'Outfit', sans-serif; font-size: 0.9rem; min-height: 80px; resize: vertical;"
                placeholder="Internal notes...">${escapeHtml(order.notes || '')}</textarea>
            <button class="btn-admin-primary" style="margin-top: 8px; padding: 8px 16px; font-size: 0.85rem;"
                onclick="saveOrderNotes('${order.id}')">Save Notes</button>
        </div>
    `;

    modal.style.display = 'flex';
};

window.closeOrderDetail = function() {
    document.getElementById('orderDetailModal').style.display = 'none';
};

window.updateOrderStatus = async function(orderId, status) {
    try {
        await updateDoc(doc(db, 'orders', orderId), {
            status: status,
            updatedAt: serverTimestamp()
        });
        showToast(`Order updated to "${status}"`, 'success');

        // Refresh the order detail view
        const order = allAdminOrders.find(o => o.id === orderId);
        if (order) {
            order.status = status;
            openOrderDetail(orderId);
        }

        // Refresh tables
        loadOrders();
        loadDashboardData();
    } catch (error) {
        console.error('Error updating order status:', error);
        showToast('Error updating order', 'error');
    }
};

window.saveTracking = async function(orderId) {
    const carrier = document.getElementById(`trackingCarrier_${orderId}`)?.value || '';
    const number = document.getElementById(`trackingNumber_${orderId}`)?.value?.trim() || '';

    if (!number) {
        showToast('Please enter a tracking number', 'error');
        return;
    }

    try {
        await updateDoc(doc(db, 'orders', orderId), {
            trackingCarrier: carrier,
            trackingNumber: number,
            status: 'shipped',
            updatedAt: serverTimestamp()
        });
        showToast('Tracking saved & order marked as shipped', 'success');

        const order = allAdminOrders.find(o => o.id === orderId);
        if (order) {
            order.trackingCarrier = carrier;
            order.trackingNumber = number;
            order.status = 'shipped';
            openOrderDetail(orderId);
        }

        loadOrders();
    } catch (error) {
        console.error('Error saving tracking:', error);
        showToast('Error saving tracking info', 'error');
    }
};

window.saveOrderNotes = async function(orderId) {
    const notes = document.getElementById(`orderNotes_${orderId}`)?.value?.trim() || '';

    try {
        await updateDoc(doc(db, 'orders', orderId), {
            notes: notes,
            updatedAt: serverTimestamp()
        });
        showToast('Notes saved', 'success');
    } catch (error) {
        console.error('Error saving notes:', error);
        showToast('Error saving notes', 'error');
    }
};

// ============================================
// SETTINGS
// ============================================
async function loadSettings() {
    try {
        const settingsDoc = await getDoc(doc(db, 'settings', 'store'));
        if (settingsDoc.exists()) {
            const data = settingsDoc.data();
            document.getElementById('settingShippingRate').value = data.shippingRate ? (data.shippingRate / 100).toFixed(2) : '';
            document.getElementById('settingFreeShipping').value = data.freeShippingThreshold ? (data.freeShippingThreshold / 100).toFixed(2) : '';
            document.getElementById('settingTaxRate').value = data.taxRate || '';
            document.getElementById('settingStoreEnabled').checked = data.storeEnabled !== false;
        }
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

window.saveSettings = async function(e) {
    e.preventDefault();

    const shippingRate = parseFloat(document.getElementById('settingShippingRate').value) || 0;
    const freeShipping = parseFloat(document.getElementById('settingFreeShipping').value) || 0;
    const taxRate = parseFloat(document.getElementById('settingTaxRate').value) || 0;
    const storeEnabled = document.getElementById('settingStoreEnabled').checked;

    try {
        const settingsRef = doc(db, 'settings', 'store');
        const settingsDoc = await getDoc(settingsRef);

        const data = {
            shippingRate: Math.round(shippingRate * 100),
            freeShippingThreshold: Math.round(freeShipping * 100),
            taxRate: taxRate,
            storeEnabled: storeEnabled,
            updatedAt: serverTimestamp()
        };

        if (settingsDoc.exists()) {
            await updateDoc(settingsRef, data);
        } else {
            await addDoc(collection(db, 'settings'), data);
        }

        showToast('Settings saved', 'success');
    } catch (error) {
        console.error('Error saving settings:', error);
        showToast('Error saving settings', 'error');
    }
};

// ============================================
// UTILITIES
// ============================================
function showToast(message, type = 'success') {
    const toast = document.getElementById('adminToast');
    if (!toast) return;

    toast.textContent = message;
    toast.className = `admin-toast ${type} active`;

    setTimeout(() => {
        toast.classList.remove('active');
    }, 3000);
}

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
