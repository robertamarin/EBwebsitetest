// ============================================
// ETHEREAL BALANCE - ADMIN DASHBOARD MODULE
// ============================================
import {
    db, auth, storage,
    collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
    query, where, orderBy, limit, onSnapshot,
    serverTimestamp, firestoreIncrement,
    signInWithEmailAndPassword, onAuthStateChanged, signOut,
    storageRef, uploadBytes, getDownloadURL, deleteObject, listAll
} from './firebase-config.js';

// ============================================
// IMAGE UPLOAD CONFIG & PROTECTION
// ============================================
const UPLOAD_CONFIG = {
    maxFileSize: 2 * 1024 * 1024,      // 2MB per file
    maxDimension: 1200,                  // max width or height in px
    jpegQuality: 0.8,                    // 80% JPEG quality
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp'],
    storageLimitGB: 5,                   // Firebase free tier limit
    warningThresholdPercent: 80          // show warning at 80%
};

// Pending uploads per zone (keyed by zone element id)
const pendingUploads = {};

/**
 * Compress an image file client-side before upload.
 * Resizes to max 1200px on longest side + converts to JPEG at 80% quality.
 * Returns a Blob ready for Firebase upload.
 */
function compressImage(file) {
    return new Promise((resolve, reject) => {
        // If file is already small enough and is JPEG, skip compression
        if (file.size < 200 * 1024 && file.type === 'image/jpeg') {
            return resolve(file);
        }

        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);

            let { width, height } = img;
            const maxDim = UPLOAD_CONFIG.maxDimension;

            // Scale down if necessary
            if (width > maxDim || height > maxDim) {
                if (width > height) {
                    height = Math.round(height * (maxDim / width));
                    width = maxDim;
                } else {
                    width = Math.round(width * (maxDim / height));
                    height = maxDim;
                }
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            canvas.toBlob(
                (blob) => {
                    if (blob) {
                        resolve(blob);
                    } else {
                        reject(new Error('Compression failed'));
                    }
                },
                'image/jpeg',
                UPLOAD_CONFIG.jpegQuality
            );
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Failed to load image'));
        };
        img.src = url;
    });
}

/**
 * Validate a file before processing.
 * Returns error string or null if valid.
 */
function validateFile(file) {
    if (!UPLOAD_CONFIG.allowedTypes.includes(file.type)) {
        return `"${file.name}" is not a supported format. Use JPG, PNG, or WebP.`;
    }
    if (file.size > UPLOAD_CONFIG.maxFileSize) {
        const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
        return `"${file.name}" is ${sizeMB}MB. Max is 2MB.`;
    }
    return null;
}

/**
 * Upload a compressed image blob to Firebase Storage.
 * Returns the download URL.
 */
async function uploadImageToStorage(blob, storagePath) {
    const ref = storageRef(storage, storagePath);
    await uploadBytes(ref, blob, { contentType: 'image/jpeg' });
    return await getDownloadURL(ref);
}

/**
 * Upload all pending files for a zone and return array of download URLs.
 */
async function uploadAllPending(zoneId, storageBasePath) {
    const files = pendingUploads[zoneId] || [];
    const urls = [];

    for (let i = 0; i < files.length; i++) {
        const { blob, name } = files[i];
        const timestamp = Date.now();
        const safeName = name.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
        const path = `${storageBasePath}/${timestamp}_${safeName}`;
        const url = await uploadImageToStorage(blob, path);
        urls.push(url);
    }

    // Clear pending
    pendingUploads[zoneId] = [];
    return urls;
}

/**
 * Initialize a drag-and-drop upload zone.
 */
function initUploadZone(zoneId, inputId, previewId, multiple = false) {
    const zone = document.getElementById(zoneId);
    const input = document.getElementById(inputId);
    const preview = document.getElementById(previewId);
    if (!zone || !input || !preview) return;

    // Initialize pending array
    if (!pendingUploads[zoneId]) pendingUploads[zoneId] = [];

    // Click to open file picker
    zone.addEventListener('click', () => input.click());

    // File input change
    input.addEventListener('change', () => {
        handleFiles(input.files, zoneId, previewId, multiple);
        input.value = '';
    });

    // Drag events
    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('dragover');
    });
    zone.addEventListener('dragleave', () => {
        zone.classList.remove('dragover');
    });
    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('dragover');
        handleFiles(e.dataTransfer.files, zoneId, previewId, multiple);
    });
}

/**
 * Process dropped/selected files: validate, compress, add to pending, show preview.
 */
async function handleFiles(fileList, zoneId, previewId, multiple) {
    const files = Array.from(fileList);
    const preview = document.getElementById(previewId);
    if (!preview) return;

    for (const file of files) {
        const error = validateFile(file);
        if (error) {
            showToast(error, 'error');
            continue;
        }

        try {
            const compressed = await compressImage(file);
            const entry = { blob: compressed, name: file.name, previewUrl: URL.createObjectURL(compressed) };

            if (multiple) {
                pendingUploads[zoneId].push(entry);
            } else {
                // Single mode: replace any existing
                pendingUploads[zoneId] = [entry];
            }
        } catch (err) {
            showToast(`Failed to process "${file.name}"`, 'error');
        }
    }

    renderPreviews(zoneId, previewId, multiple);
}

/**
 * Render image previews for a zone's pending uploads + existing URLs.
 */
function renderPreviews(zoneId, previewId, multiple) {
    const preview = document.getElementById(previewId);
    if (!preview) return;

    const pending = pendingUploads[zoneId] || [];
    const existingUrls = preview.dataset.existingUrls ? JSON.parse(preview.dataset.existingUrls) : [];

    let html = '';

    // Existing (already uploaded) images
    existingUrls.forEach((url, i) => {
        html += `
            <div class="image-preview-item">
                <img src="${escapeAttr(url)}" alt="Image">
                <button type="button" class="remove-image" onclick="removeExistingImage('${zoneId}','${previewId}',${i})">&times;</button>
            </div>
        `;
    });

    // Pending (not yet uploaded) images
    pending.forEach((entry, i) => {
        html += `
            <div class="image-preview-item">
                <img src="${entry.previewUrl}" alt="Preview">
                <button type="button" class="remove-image" onclick="removePendingImage('${zoneId}','${previewId}',${i})">&times;</button>
            </div>
        `;
    });

    preview.innerHTML = html;
}

window.removeExistingImage = function(zoneId, previewId, index) {
    const preview = document.getElementById(previewId);
    const existing = preview.dataset.existingUrls ? JSON.parse(preview.dataset.existingUrls) : [];
    existing.splice(index, 1);
    preview.dataset.existingUrls = JSON.stringify(existing);
    renderPreviews(zoneId, previewId, true);
};

window.removePendingImage = function(zoneId, previewId, index) {
    const pending = pendingUploads[zoneId] || [];
    if (pending[index]?.previewUrl) URL.revokeObjectURL(pending[index].previewUrl);
    pending.splice(index, 1);
    renderPreviews(zoneId, previewId, true);
};

// ============================================
// STORAGE USAGE TRACKER
// ============================================
async function updateStorageUsage() {
    const barFill = document.getElementById('storageBarFill');
    const usedText = document.getElementById('storageUsedText');
    if (!barFill || !usedText) return;

    try {
        // List all items in the images/ folder to estimate usage
        const imagesRef = storageRef(storage, 'images');
        const result = await listAll(imagesRef);

        // Count files across all sub-folders
        let totalFiles = 0;
        const folders = [result]; // Start with root images/
        // Check sub-folders
        for (const folderRef of result.prefixes) {
            const subResult = await listAll(folderRef);
            totalFiles += subResult.items.length;
        }
        totalFiles += result.items.length;

        // Estimate: average compressed image is ~300KB
        const estimatedBytes = totalFiles * 300 * 1024;
        const limitBytes = UPLOAD_CONFIG.storageLimitGB * 1024 * 1024 * 1024;
        const percent = Math.min(100, (estimatedBytes / limitBytes) * 100);

        const usedMB = (estimatedBytes / (1024 * 1024)).toFixed(1);

        barFill.style.width = percent + '%';
        barFill.className = 'storage-bar-fill' +
            (percent >= 90 ? ' danger' : percent >= UPLOAD_CONFIG.warningThresholdPercent ? ' warning' : '');

        usedText.textContent = `~${usedMB} MB used (${totalFiles} images)`;
    } catch (e) {
        usedText.textContent = 'Unable to check (enable Storage in Firebase Console)';
        barFill.style.width = '0%';
    }
}

// ============================================
// AUTHENTICATION
// ============================================
onAuthStateChanged(auth, (user) => {
    if (user) {
        document.getElementById('adminLogin').style.display = 'none';
        document.getElementById('adminDashboard').style.display = 'flex';
        loadDashboardData();
        initAllUploadZones();
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
// INIT UPLOAD ZONES
// ============================================
function initAllUploadZones() {
    initUploadZone('productImageZone', 'productImageInput', 'productImagePreview', true);
    initUploadZone('eventImageZone', 'eventImageInput', 'eventImagePreview', false);
    initUploadZone('galleryCoverZone', 'galleryCoverInput', 'galleryCoverPreview', false);
    initUploadZone('galleryPhotosZone', 'galleryPhotosInput', 'galleryPhotosList', true);
}

// ============================================
// SECTION NAVIGATION
// ============================================
window.switchAdminSection = function(section) {
    document.querySelectorAll('.admin-section').forEach(el => {
        el.style.display = 'none';
    });

    const target = document.getElementById('section' + section.charAt(0).toUpperCase() + section.slice(1));
    if (target) target.style.display = 'block';

    document.querySelectorAll('.admin-nav-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.section === section);
    });

    switch (section) {
        case 'overview': loadDashboardData(); break;
        case 'products': loadProducts(); break;
        case 'events': loadEvents(); break;
        case 'gallery': loadGalleryItems(); break;
        case 'orders': loadOrders(); break;
        case 'partners': loadPartners(); break;
        case 'settings': loadSettings(); updateStorageUsage(); break;
    }

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
        const [productsSnap, ordersSnap] = await Promise.all([
            getDocs(query(collection(db, 'products'), where('isActive', '==', true))),
            getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc'), limit(10)))
        ]);

        const statsEl = document.getElementById('adminStats');
        const orders = [];
        let totalRevenue = 0;
        ordersSnap.forEach(d => {
            const data = d.data();
            orders.push({ id: d.id, ...data });
            totalRevenue += data.total || 0;
        });

        statsEl.innerHTML = `
            <div class="admin-stat-card">
                <div class="admin-stat-label">Active Products</div>
                <div class="admin-stat-value">${productsSnap.size}</div>
            </div>
            <div class="admin-stat-card">
                <div class="admin-stat-label">Total Orders</div>
                <div class="admin-stat-value">${orders.length}</div>
            </div>
            <div class="admin-stat-card">
                <div class="admin-stat-label">Revenue</div>
                <div class="admin-stat-value">$${(totalRevenue / 100).toFixed(2)}</div>
            </div>
        `;

        renderOrdersTable(orders.slice(0, 5), 'adminRecentOrders');
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
        const snapshot = await getDocs(query(collection(db, 'products'), orderBy('createdAt', 'desc')));
        allAdminProducts = [];
        snapshot.forEach(d => allAdminProducts.push({ id: d.id, ...d.data() }));

        const container = document.getElementById('adminProductsTable');
        if (allAdminProducts.length === 0) {
            container.innerHTML = '<p style="padding: 40px; text-align: center; color: var(--stone);">No products yet. Click "+ Add Product" to create one.</p>';
            return;
        }

        container.innerHTML = `
            <table class="admin-table">
                <thead><tr>
                    <th></th><th>Name</th><th>Category</th><th>Price</th><th>Status</th><th>Actions</th>
                </tr></thead>
                <tbody>
                    ${allAdminProducts.map(p => {
                        const img = p.images && p.images[0]
                            ? `<img class="product-thumb" src="${escapeAttr(p.images[0])}" alt="">`
                            : `<div class="product-thumb" style="background: var(--sand);"></div>`;
                        return `<tr>
                            <td>${img}</td>
                            <td><strong>${escapeHtml(p.name)}</strong></td>
                            <td>${escapeHtml(p.category)}</td>
                            <td>$${((p.price || 0) / 100).toFixed(2)}</td>
                            <td><span class="status-badge ${p.isActive ? 'active' : 'inactive'}">${p.isActive ? 'Active' : 'Inactive'}</span></td>
                            <td class="admin-actions">
                                <button class="admin-action-btn" onclick="editProduct('${p.id}')" title="Edit">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                </button>
                                <button class="admin-action-btn delete" onclick="deleteProduct('${p.id}','${escapeAttr(p.name)}')" title="Delete">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                                </button>
                            </td>
                        </tr>`;
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
    const preview = document.getElementById('productImagePreview');

    form.reset();
    document.getElementById('productEditId').value = '';
    document.getElementById('productInventory').value = '-1';
    document.getElementById('productActive').checked = true;
    document.getElementById('productFeatured').checked = false;
    pendingUploads['productImageZone'] = [];
    preview.dataset.existingUrls = '[]';
    preview.innerHTML = '';

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
            document.getElementById('productInventory').value = product.inventory ?? -1;
            document.getElementById('productComparePrice').value = product.compareAtPrice ? (product.compareAtPrice / 100).toFixed(2) : '';
            document.getElementById('productDetails').value = product.details || '';
            document.getElementById('productDigitalUrl').value = product.digitalFileUrl || '';
            document.getElementById('productActive').checked = product.isActive !== false;
            document.getElementById('productFeatured').checked = product.isFeatured === true;

            // Show existing images
            if (product.images && product.images.length > 0) {
                preview.dataset.existingUrls = JSON.stringify(product.images);
                renderPreviews('productImageZone', 'productImagePreview', true);
            }
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

    showToast('Saving product...', 'success');

    try {
        // Upload any pending images
        const newUrls = await uploadAllPending('productImageZone', 'images/products');

        // Combine existing + new URLs
        const preview = document.getElementById('productImagePreview');
        const existingUrls = preview.dataset.existingUrls ? JSON.parse(preview.dataset.existingUrls) : [];
        const allImages = [...existingUrls, ...newUrls];

        const productData = {
            name: document.getElementById('productName').value.trim(),
            slug: document.getElementById('productName').value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            price: Math.round(priceValue * 100),
            category: document.getElementById('productCategory').value,
            subcategory: document.getElementById('productSubcategory').value.trim(),
            description: document.getElementById('productDescription').value.trim(),
            images: allImages,
            inventory: parseInt(document.getElementById('productInventory').value) || -1,
            compareAtPrice: comparePriceValue ? Math.round(comparePriceValue * 100) : null,
            details: document.getElementById('productDetails').value.trim(),
            digitalFileUrl: document.getElementById('productDigitalUrl').value.trim() || null,
            isActive: document.getElementById('productActive').checked,
            isFeatured: document.getElementById('productFeatured').checked,
            updatedAt: serverTimestamp()
        };

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
        showToast('Error saving product: ' + error.message, 'error');
    }
};

window.deleteProduct = async function(productId, productName) {
    if (!confirm(`Are you sure you want to delete "${productName}"? This cannot be undone.`)) return;

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
// EVENTS MANAGEMENT
// ============================================
let allAdminEvents = [];

async function loadEvents() {
    try {
        const snapshot = await getDocs(query(collection(db, 'events'), orderBy('date', 'asc')));
        allAdminEvents = [];
        snapshot.forEach(d => allAdminEvents.push({ id: d.id, ...d.data() }));

        const container = document.getElementById('adminEventsGrid');
        if (allAdminEvents.length === 0) {
            container.innerHTML = '<div class="admin-empty-state"><p>No events yet. Click "+ Add Event" to create one.</p></div>';
            return;
        }

        container.innerHTML = allAdminEvents.map(ev => `
            <div class="admin-event-card">
                ${ev.coverImage ? `<img class="admin-event-card-cover" src="${escapeAttr(ev.coverImage)}" alt="">` : '<div class="admin-event-card-cover"></div>'}
                <div class="admin-event-card-body">
                    <h4>${escapeHtml(ev.title)}</h4>
                    <div class="event-meta-text">
                        ${escapeHtml(ev.dateDisplay || '')} ${ev.time ? '&middot; ' + escapeHtml(ev.time) : ''}<br>
                        ${ev.venue ? escapeHtml(ev.venue) : ''}
                    </div>
                    <span class="status-badge ${ev.active !== false ? 'active' : 'inactive'}">${ev.active !== false ? 'Active' : 'Inactive'}</span>
                </div>
                <div class="admin-event-card-actions">
                    <button onclick="editEvent('${ev.id}')">Edit</button>
                    <button class="delete" onclick="deleteEvent('${ev.id}','${escapeAttr(ev.title)}')">Delete</button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading events:', error);
    }
}

window.openEventEditor = function(eventId) {
    const modal = document.getElementById('eventEditorModal');
    const title = document.getElementById('eventEditorTitle');
    const form = document.getElementById('eventEditorForm');
    const preview = document.getElementById('eventImagePreview');

    form.reset();
    document.getElementById('eventEditId').value = '';
    document.getElementById('eventActive').checked = true;
    pendingUploads['eventImageZone'] = [];
    preview.dataset.existingUrls = '[]';
    preview.innerHTML = '';

    if (eventId) {
        title.textContent = 'Edit Event';
        const ev = allAdminEvents.find(e => e.id === eventId);
        if (ev) {
            document.getElementById('eventEditId').value = ev.id;
            document.getElementById('eventTitle').value = ev.title || '';
            document.getElementById('eventDateDisplay').value = ev.dateDisplay || '';
            document.getElementById('eventDateSort').value = ev.date ? (ev.date.toDate ? ev.date.toDate().toISOString().split('T')[0] : ev.date) : '';
            document.getElementById('eventTime').value = ev.time || '';
            document.getElementById('eventType').value = ev.type || '';
            document.getElementById('eventVenue').value = ev.venue || '';
            document.getElementById('eventDescription').value = ev.description || '';
            document.getElementById('eventBookingLink').value = ev.bookingLink || '';
            document.getElementById('eventActive').checked = ev.active !== false;

            if (ev.coverImage) {
                preview.dataset.existingUrls = JSON.stringify([ev.coverImage]);
                renderPreviews('eventImageZone', 'eventImagePreview', false);
            }
        }
    } else {
        title.textContent = 'Add Event';
    }

    modal.style.display = 'flex';
};

window.closeEventEditor = function() {
    document.getElementById('eventEditorModal').style.display = 'none';
};

window.editEvent = function(eventId) {
    window.openEventEditor(eventId);
};

window.saveEvent = async function(e) {
    e.preventDefault();
    showToast('Saving event...', 'success');

    try {
        const editId = document.getElementById('eventEditId').value;

        // Upload cover image if pending
        const newUrls = await uploadAllPending('eventImageZone', 'images/events');
        const preview = document.getElementById('eventImagePreview');
        const existingUrls = preview.dataset.existingUrls ? JSON.parse(preview.dataset.existingUrls) : [];
        const coverImage = newUrls[0] || existingUrls[0] || '';

        const eventData = {
            title: document.getElementById('eventTitle').value.trim(),
            dateDisplay: document.getElementById('eventDateDisplay').value.trim(),
            date: document.getElementById('eventDateSort').value,
            time: document.getElementById('eventTime').value.trim(),
            type: document.getElementById('eventType').value.trim(),
            venue: document.getElementById('eventVenue').value.trim(),
            description: document.getElementById('eventDescription').value.trim(),
            bookingLink: document.getElementById('eventBookingLink').value.trim() || '#',
            coverImage: coverImage,
            active: document.getElementById('eventActive').checked,
            updatedAt: serverTimestamp()
        };

        if (editId) {
            await updateDoc(doc(db, 'events', editId), eventData);
            showToast('Event updated', 'success');
        } else {
            eventData.createdAt = serverTimestamp();
            await addDoc(collection(db, 'events'), eventData);
            showToast('Event created', 'success');
        }

        closeEventEditor();
        loadEvents();
    } catch (error) {
        console.error('Error saving event:', error);
        showToast('Error saving event: ' + error.message, 'error');
    }
};

window.deleteEvent = async function(eventId, eventTitle) {
    if (!confirm(`Delete event "${eventTitle}"? This cannot be undone.`)) return;

    try {
        await deleteDoc(doc(db, 'events', eventId));
        showToast('Event deleted', 'success');
        loadEvents();
    } catch (error) {
        console.error('Error deleting event:', error);
        showToast('Error deleting event', 'error');
    }
};

// ============================================
// GALLERY MANAGEMENT
// ============================================
let allAdminGallery = [];

async function loadGalleryItems() {
    try {
        const snapshot = await getDocs(query(collection(db, 'gallery'), orderBy('sortOrder', 'asc')));
        allAdminGallery = [];
        snapshot.forEach(d => allAdminGallery.push({ id: d.id, ...d.data() }));

        const container = document.getElementById('adminGalleryGrid');
        if (allAdminGallery.length === 0) {
            container.innerHTML = '<div class="admin-empty-state"><p>No galleries yet. Click "+ Add Gallery" to create one.</p></div>';
            return;
        }

        container.innerHTML = allAdminGallery.map(g => `
            <div class="admin-gallery-card">
                ${g.coverImage ? `<img class="admin-gallery-card-cover" src="${escapeAttr(g.coverImage)}" alt="">` : '<div class="admin-gallery-card-cover"></div>'}
                <div class="admin-gallery-card-body">
                    <h4>${escapeHtml(g.title)}</h4>
                    <div class="gallery-count">${(g.photos || []).length} photos &middot; ${escapeHtml(g.date || '')}</div>
                </div>
                <div class="admin-gallery-card-actions">
                    <button onclick="editGallery('${g.id}')">Edit</button>
                    <button class="delete" onclick="deleteGallery('${g.id}','${escapeAttr(g.title)}')">Delete</button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading gallery:', error);
    }
}

window.openGalleryEditor = function(galleryId) {
    const modal = document.getElementById('galleryEditorModal');
    const title = document.getElementById('galleryEditorTitle');
    const form = document.getElementById('galleryEditorForm');
    const coverPreview = document.getElementById('galleryCoverPreview');
    const photosList = document.getElementById('galleryPhotosList');

    form.reset();
    document.getElementById('galleryEditId').value = '';
    document.getElementById('gallerySortOrder').value = '0';
    document.getElementById('galleryActive').checked = true;
    pendingUploads['galleryCoverZone'] = [];
    pendingUploads['galleryPhotosZone'] = [];
    coverPreview.dataset.existingUrls = '[]';
    coverPreview.innerHTML = '';
    photosList.innerHTML = '';
    photosList.dataset.existingPhotos = '[]';

    if (galleryId) {
        title.textContent = 'Edit Gallery';
        const g = allAdminGallery.find(item => item.id === galleryId);
        if (g) {
            document.getElementById('galleryEditId').value = g.id;
            document.getElementById('galleryTitle').value = g.title || '';
            document.getElementById('galleryDate').value = g.date || '';
            document.getElementById('galleryCoverLabel').value = g.coverLabel || '';
            document.getElementById('gallerySortOrder').value = g.sortOrder || 0;
            document.getElementById('galleryActive').checked = g.active !== false;

            if (g.coverImage) {
                coverPreview.dataset.existingUrls = JSON.stringify([g.coverImage]);
                renderPreviews('galleryCoverZone', 'galleryCoverPreview', false);
            }

            // Show existing photos
            if (g.photos && g.photos.length > 0) {
                photosList.dataset.existingPhotos = JSON.stringify(g.photos);
                renderGalleryPhotosList(g.photos);
            }
        }
    } else {
        title.textContent = 'Add Gallery';
    }

    modal.style.display = 'flex';
};

/**
 * Render the sortable photos list inside the gallery editor.
 * Each photo has a thumbnail, label input, and remove button.
 */
function renderGalleryPhotosList(photos) {
    const list = document.getElementById('galleryPhotosList');
    if (!list) return;

    // Combine existing photos with pending uploads
    const pending = pendingUploads['galleryPhotosZone'] || [];

    let html = '';

    // Existing photos
    photos.forEach((photo, i) => {
        const src = photo.url || photo.src || '';
        const label = photo.label || '';
        html += `
            <div class="gallery-photo-row" data-index="${i}" data-type="existing">
                <img src="${escapeAttr(src)}" alt="">
                <input type="text" value="${escapeAttr(label)}" placeholder="Label (optional)" onchange="updatePhotoLabel(${i}, this.value)">
                <button type="button" onclick="removeGalleryPhoto(${i})">&times;</button>
            </div>
        `;
    });

    // Pending uploads
    pending.forEach((entry, i) => {
        html += `
            <div class="gallery-photo-row" data-index="${i}" data-type="pending">
                <img src="${entry.previewUrl}" alt="">
                <input type="text" value="" placeholder="Label (optional)" data-pending-label="${i}">
                <button type="button" onclick="removePendingGalleryPhoto(${i})">&times;</button>
            </div>
        `;
    });

    list.innerHTML = html;
}

window.updatePhotoLabel = function(index, label) {
    const list = document.getElementById('galleryPhotosList');
    const photos = list.dataset.existingPhotos ? JSON.parse(list.dataset.existingPhotos) : [];
    if (photos[index]) {
        photos[index].label = label;
        list.dataset.existingPhotos = JSON.stringify(photos);
    }
};

window.removeGalleryPhoto = function(index) {
    const list = document.getElementById('galleryPhotosList');
    const photos = list.dataset.existingPhotos ? JSON.parse(list.dataset.existingPhotos) : [];
    photos.splice(index, 1);
    list.dataset.existingPhotos = JSON.stringify(photos);
    renderGalleryPhotosList(photos);
};

window.removePendingGalleryPhoto = function(index) {
    const pending = pendingUploads['galleryPhotosZone'] || [];
    if (pending[index]?.previewUrl) URL.revokeObjectURL(pending[index].previewUrl);
    pending.splice(index, 1);
    const list = document.getElementById('galleryPhotosList');
    const photos = list.dataset.existingPhotos ? JSON.parse(list.dataset.existingPhotos) : [];
    renderGalleryPhotosList(photos);
};

// Override handleFiles for gallery photos zone to also update the photos list
const originalHandleFiles = handleFiles;
const galleryPhotosHandler = async function(fileList, zoneId, previewId, multiple) {
    if (zoneId === 'galleryPhotosZone') {
        const files = Array.from(fileList);
        for (const file of files) {
            const error = validateFile(file);
            if (error) {
                showToast(error, 'error');
                continue;
            }
            try {
                const compressed = await compressImage(file);
                const entry = { blob: compressed, name: file.name, previewUrl: URL.createObjectURL(compressed) };
                pendingUploads[zoneId].push(entry);
            } catch (err) {
                showToast(`Failed to process "${file.name}"`, 'error');
            }
        }
        // Re-render the photos list instead of the grid preview
        const list = document.getElementById('galleryPhotosList');
        const photos = list.dataset.existingPhotos ? JSON.parse(list.dataset.existingPhotos) : [];
        renderGalleryPhotosList(photos);
    } else {
        await originalHandleFiles(fileList, zoneId, previewId, multiple);
    }
};

// Patch the gallery photos upload zone to use our custom handler
function patchGalleryPhotosZone() {
    const zone = document.getElementById('galleryPhotosZone');
    const input = document.getElementById('galleryPhotosInput');
    if (!zone || !input) return;

    // Remove existing listeners by cloning
    const newZone = zone.cloneNode(true);
    zone.parentNode.replaceChild(newZone, zone);
    const newInput = newZone.querySelector('#galleryPhotosInput');

    if (!pendingUploads['galleryPhotosZone']) pendingUploads['galleryPhotosZone'] = [];

    newZone.addEventListener('click', () => newInput.click());
    newInput.addEventListener('change', () => {
        galleryPhotosHandler(newInput.files, 'galleryPhotosZone', 'galleryPhotosList', true);
        newInput.value = '';
    });
    newZone.addEventListener('dragover', (e) => { e.preventDefault(); newZone.classList.add('dragover'); });
    newZone.addEventListener('dragleave', () => newZone.classList.remove('dragover'));
    newZone.addEventListener('drop', (e) => {
        e.preventDefault();
        newZone.classList.remove('dragover');
        galleryPhotosHandler(e.dataTransfer.files, 'galleryPhotosZone', 'galleryPhotosList', true);
    });
}

window.closeGalleryEditor = function() {
    document.getElementById('galleryEditorModal').style.display = 'none';
};

window.editGallery = function(galleryId) {
    window.openGalleryEditor(galleryId);
    // Patch gallery photos zone after modal is open
    setTimeout(patchGalleryPhotosZone, 50);
};

// Also patch when adding new
const origOpenGalleryEditor = window.openGalleryEditor;
window.openGalleryEditor = function(galleryId) {
    origOpenGalleryEditor(galleryId);
    setTimeout(patchGalleryPhotosZone, 50);
};

window.saveGallery = async function(e) {
    e.preventDefault();
    showToast('Saving gallery...', 'success');

    try {
        const editId = document.getElementById('galleryEditId').value;

        // Upload cover
        const coverUrls = await uploadAllPending('galleryCoverZone', 'images/gallery');
        const coverPreview = document.getElementById('galleryCoverPreview');
        const existingCovers = coverPreview.dataset.existingUrls ? JSON.parse(coverPreview.dataset.existingUrls) : [];
        const coverImage = coverUrls[0] || existingCovers[0] || '';

        // Upload new gallery photos
        const newPhotoUrls = await uploadAllPending('galleryPhotosZone', 'images/gallery');

        // Get labels for pending photos
        const pendingLabels = [];
        document.querySelectorAll('[data-pending-label]').forEach(input => {
            pendingLabels.push(input.value.trim());
        });

        // Combine existing + new photos
        const list = document.getElementById('galleryPhotosList');
        const existingPhotos = list.dataset.existingPhotos ? JSON.parse(list.dataset.existingPhotos) : [];
        const newPhotos = newPhotoUrls.map((url, i) => ({
            url: url,
            label: pendingLabels[i] || '',
            type: 'image'
        }));
        const allPhotos = [...existingPhotos, ...newPhotos];

        const galleryData = {
            title: document.getElementById('galleryTitle').value.trim(),
            date: document.getElementById('galleryDate').value.trim(),
            coverLabel: document.getElementById('galleryCoverLabel').value.trim(),
            coverImage: coverImage,
            sortOrder: parseInt(document.getElementById('gallerySortOrder').value) || 0,
            photos: allPhotos,
            active: document.getElementById('galleryActive').checked,
            updatedAt: serverTimestamp()
        };

        if (editId) {
            await updateDoc(doc(db, 'gallery', editId), galleryData);
            showToast('Gallery updated', 'success');
        } else {
            galleryData.createdAt = serverTimestamp();
            await addDoc(collection(db, 'gallery'), galleryData);
            showToast('Gallery created', 'success');
        }

        closeGalleryEditor();
        loadGalleryItems();
    } catch (error) {
        console.error('Error saving gallery:', error);
        showToast('Error saving gallery: ' + error.message, 'error');
    }
};

window.deleteGallery = async function(galleryId, galleryTitle) {
    if (!confirm(`Delete gallery "${galleryTitle}"? This cannot be undone.`)) return;

    try {
        await deleteDoc(doc(db, 'gallery', galleryId));
        showToast('Gallery deleted', 'success');
        loadGalleryItems();
    } catch (error) {
        console.error('Error deleting gallery:', error);
        showToast('Error deleting gallery', 'error');
    }
};

// ============================================
// ORDERS MANAGEMENT
// ============================================
let allAdminOrders = [];
let allPartners = [];

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
            <thead><tr>
                <th>Order</th><th>Date</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th><th>Actions</th>
            </tr></thead>
            <tbody>
                ${orders.map(order => {
                    const orderId = order.id.slice(0, 8).toUpperCase();
                    const date = order.createdAt?.toDate?.()
                        ? order.createdAt.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                        : 'N/A';
                    const itemCount = order.items?.reduce((sum, i) => sum + i.quantity, 0) || 0;

                    return `<tr>
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
                    </tr>`;
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
                ? `<p style="font-size: 0.9rem;">${escapeHtml(order.trackingCarrier || '')} - ${escapeHtml(order.trackingNumber)}</p>`
                : '<p style="font-size: 0.85rem; color: var(--stone);">No tracking number added yet.</p>'
            }
            <div class="tracking-form">
                <select id="trackingCarrier_${order.id}">
                    <option value="USPS">USPS</option><option value="UPS">UPS</option><option value="FedEx">FedEx</option><option value="DHL">DHL</option><option value="Other">Other</option>
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
        await updateDoc(doc(db, 'orders', orderId), { status, updatedAt: serverTimestamp() });
        showToast(`Order updated to "${status}"`, 'success');
        const order = allAdminOrders.find(o => o.id === orderId);
        if (order) { order.status = status; openOrderDetail(orderId); }
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
    if (!number) { showToast('Please enter a tracking number', 'error'); return; }

    try {
        await updateDoc(doc(db, 'orders', orderId), {
            trackingCarrier: carrier, trackingNumber: number, status: 'shipped', updatedAt: serverTimestamp()
        });
        showToast('Tracking saved & order marked as shipped', 'success');
        const order = allAdminOrders.find(o => o.id === orderId);
        if (order) { order.trackingCarrier = carrier; order.trackingNumber = number; order.status = 'shipped'; openOrderDetail(orderId); }
        loadOrders();
    } catch (error) {
        console.error('Error saving tracking:', error);
        showToast('Error saving tracking info', 'error');
    }
};

window.saveOrderNotes = async function(orderId) {
    const notes = document.getElementById(`orderNotes_${orderId}`)?.value?.trim() || '';
    try {
        await updateDoc(doc(db, 'orders', orderId), { notes, updatedAt: serverTimestamp() });
        showToast('Notes saved', 'success');
    } catch (error) {
        console.error('Error saving notes:', error);
        showToast('Error saving notes', 'error');
    }
};

// ============================================
// PARTNERS
// ============================================
const LEGACY_SITE_PARTNERS = [
    { name: 'Roam Homeware', url: 'https://roamhomeware.com/' },
    { name: 'Orli Hotel (Orli La Jolla)', url: 'https://stayorli.com/' },
    { name: 'Lucia at Aviara', url: 'https://luciaaviara.com/' },
    { name: 'SAGO', url: 'https://www.sagoencinitas.com/' },
    { name: 'LSKD', url: 'https://lskd.com' },
    { name: 'Wonderland', url: 'https://www.wonderlandob.com/' },
    { name: 'Studio Casually', url: 'https://www.studiocasually.com/contact' },
    { name: 'HERO Fitness', url: 'https://heroboardfitness.com' },
    { name: 'Moniker Coffee Co.', url: 'https://www.monikercoffee.com/' },
    { name: 'Ocean Pacific Gym & Wellness', url: 'https://www.oceanpacificgym.com/' },
    { name: 'Trident Coffee', url: 'https://tridentcoffee.com/' },
    { name: 'LMNT', url: 'https://drinklmnt.com/' },
    { name: 'Yesly', url: 'https://yeslywater.com/' },
    { name: 'PNKYS', url: 'https://drinkpnkys.com/' },
    { name: 'Brogi Mats', url: 'https://brogiyoga.com/' },
    { name: 'VYB Swim', url: 'https://www.vybswim.com' },
    { name: 'Brick & Bell', url: 'https://www.instagram.com/brickandbell/?hl=en' },
    { name: 'Olive Club', url: 'https://oliveclubhouse.com/' },
    { name: 'Zaytouna Olive Oil', url: 'https://zaytounaoliveoil.com/' },
    { name: 'Like Air', url: 'https://likeair.com/' },
    { name: 'Blenders', url: 'https://blenderseyewear.com' },
    { name: 'SunBum', url: 'https://www.sunbum.com/' },
    { name: 'ATARAHbody', url: 'https://atarahbody.com/' },
    { name: 'BUYA', url: 'https://www.instagram.com/buya.designs/?hl=en' },
    { name: 'Organic Jaguar', url: 'https://organicjaguar.com' },
    { name: 'Herbs to Acupuncture', url: 'https://www.herbstoacupuncture.com/' },
    { name: 'SLATE', url: 'https://slatemilk.com' },
    { name: 'WildSociety', url: 'https://wildsociety.com' }
];

let hasBackfilledLegacyPartners = false;

async function ensureLegacyPartnersBackfilled(existingPartners) {
    if (hasBackfilledLegacyPartners) return false;

    const existingKeys = new Set(
        (existingPartners || []).map((p) => `${String(p.name || '').trim().toLowerCase()}|${String(p.url || '').trim().toLowerCase()}`)
    );

    const missingPartners = LEGACY_SITE_PARTNERS.filter((p) => {
        const key = `${p.name.trim().toLowerCase()}|${p.url.trim().toLowerCase()}`;
        return !existingKeys.has(key);
    });

    if (missingPartners.length === 0) {
        hasBackfilledLegacyPartners = true;
        return false;
    }

    let addedCount = 0;

    for (const partner of missingPartners) {
        try {
            await addDoc(collection(db, 'partners'), {
                name: partner.name,
                url: partner.url,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                source: 'legacy-site'
            });
            addedCount += 1;
        } catch (error) {
            console.warn(`Skipping legacy partner backfill for "${partner.name}"`, error);
        }
    }

    hasBackfilledLegacyPartners = true;
    return addedCount > 0;
}

async function loadPartners() {
    const table = document.getElementById('adminPartnersTable');
    if (!table) return;

    table.innerHTML = '<p style="padding: 24px; text-align: center; color: var(--stone);">Loading partners...</p>';

    try {
        let snap;
        try {
            snap = await getDocs(query(collection(db, 'partners'), orderBy('createdAt', 'desc')));
        } catch (queryError) {
            console.warn('Falling back to non-ordered partner query:', queryError);
            snap = await getDocs(collection(db, 'partners'));
        }

        allPartners = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Render partners even if backfill writes are blocked by Firestore rules.
        // This prevents the UI from getting stuck in "Error loading partners".
        const addedLegacyPartners = await ensureLegacyPartnersBackfilled(allPartners);

        if (addedLegacyPartners || allPartners.length === 0) {
            const refreshed = await getDocs(collection(db, 'partners'));
            allPartners = refreshed.docs.map(d => ({ id: d.id, ...d.data() }));
        }

        allPartners.sort((a, b) => {
            const aTime = a.createdAt?.toMillis?.() || 0;
            const bTime = b.createdAt?.toMillis?.() || 0;
            return bTime - aTime;
        });

        if (!allPartners.length) {
            table.innerHTML = '<p style="padding: 24px; text-align: center; color: var(--stone);">No custom partners added yet.</p>';
            return;
        }

        table.innerHTML = `
            <table class="admin-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Website</th>
                        <th style="text-align:right;">Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${allPartners.map(p => `
                        <tr>
                            <td>${escapeHtml(p.name || '')}</td>
                            <td><a href="${escapeAttr(p.url || '#')}" target="_blank" rel="noopener">${escapeHtml(p.url || '')}</a></td>
                            <td style="text-align:right;">
                                <button class="btn-admin-secondary" type="button" onclick="deletePartner('${p.id}')">Delete</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } catch (error) {
        console.error('Error loading partners:', error);
        table.innerHTML = '<p style="padding: 24px; text-align: center; color: var(--red);">Error loading partners.</p>';
    }
}

window.savePartner = async function(e) {
    e.preventDefault();

    const nameEl = document.getElementById('partnerName');
    const urlEl = document.getElementById('partnerUrl');
    if (!nameEl || !urlEl) return;

    const name = nameEl.value.trim();
    const url = urlEl.value.trim();

    if (!name || !url) {
        showToast('Please enter partner name and URL', 'error');
        return;
    }

    try {
        await addDoc(collection(db, 'partners'), {
            name,
            url,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });

        nameEl.value = '';
        urlEl.value = '';
        showToast('Partner added', 'success');
        loadPartners();
    } catch (error) {
        console.error('Error adding partner:', error);
        showToast('Error adding partner', 'error');
    }
};

window.deletePartner = async function(partnerId) {
    if (!partnerId) return;

    try {
        await deleteDoc(doc(db, 'partners', partnerId));
        showToast('Partner removed', 'success');
        loadPartners();
    } catch (error) {
        console.error('Error deleting partner:', error);
        showToast('Error deleting partner', 'error');
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
        const data = {
            shippingRate: Math.round(shippingRate * 100),
            freeShippingThreshold: Math.round(freeShipping * 100),
            taxRate, storeEnabled, updatedAt: serverTimestamp()
        };

        await setDoc(settingsRef, data, { merge: true });

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
    setTimeout(() => toast.classList.remove('active'), 3000);
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
