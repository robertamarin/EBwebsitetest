// ============================================
// ETHEREAL BALANCE - ADMIN DASHBOARD MODULE
// ============================================
import {
    db, auth, storage,
    collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
    query, where, orderBy, limit, onSnapshot,
    serverTimestamp, firestoreIncrement, writeBatch, Timestamp,
    signInWithEmailAndPassword, onAuthStateChanged, signOut,
    storageRef, uploadBytes, getDownloadURL, deleteObject, listAll, getMetadata
} from './firebase-config.js';

// ============================================
// IMAGE UPLOAD CONFIG & PROTECTION
// ============================================
const UPLOAD_CONFIG = {
    maxFileSize: 10 * 1024 * 1024,     // 10MB per file
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
        return `"${file.name}" is ${sizeMB}MB. Max is 10MB.`;
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
let storageModulePromise = null;

async function getMetadataSize(itemRef) {
    try {
        if (!storageModulePromise) {
            storageModulePromise = import('https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js');
        }
        const storageModule = await storageModulePromise;
        if (typeof storageModule.getMetadata !== 'function') return null;

        const metadata = await storageModule.getMetadata(itemRef);
        return metadata?.size || 0;
    } catch (error) {
        return null;
    }
}

async function collectStorageUsage(folderRef) {
    const result = await listAll(folderRef);

    let totalBytes = 0;
    let totalFiles = 0;

    for (const itemRef of result.items) {
        const size = await getMetadataSize(itemRef);
        totalBytes += size == null ? 300 * 1024 : size;
        totalFiles += 1;
    }

    for (const prefixRef of result.prefixes) {
        const subfolderUsage = await collectStorageUsage(prefixRef);
        totalBytes += subfolderUsage.totalBytes;
        totalFiles += subfolderUsage.totalFiles;
    }

    return { totalBytes, totalFiles };
}

async function updateStorageUsage() {
    const barFill = document.getElementById('storageBarFill');
    const usedText = document.getElementById('storageUsedText');
    if (!barFill || !usedText) return;

    try {
        const imagesRef = storageRef(storage, 'images');
        const { totalBytes, totalFiles } = await collectStorageUsage(imagesRef);

        const limitBytes = UPLOAD_CONFIG.storageLimitGB * 1024 * 1024 * 1024;
        const percent = Math.min(100, (totalBytes / limitBytes) * 100);
        const usedMB = (totalBytes / (1024 * 1024)).toFixed(1);

        barFill.style.width = percent + '%';
        barFill.className = 'storage-bar-fill' +
            (percent >= 90 ? ' danger' : percent >= UPLOAD_CONFIG.warningThresholdPercent ? ' warning' : '');

        usedText.textContent = `${usedMB} MB used (${totalFiles} images)`;
    } catch (e) {
        usedText.textContent = 'Unable to check (enable Storage access in Firebase Console)';
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
        case 'community': loadSubscribers(); break;
        case 'orders': loadOrders(); break;
        case 'partners': loadPartners(); break;
        case 'settings': loadSettings(); updateStorageUsage(); break;
    }

    document.getElementById('adminSidebar')?.classList.remove('open');
    document.getElementById('adminSidebarBackdrop')?.classList.remove('active');
};

window.toggleAdminSidebar = function() {
    const sidebar = document.getElementById('adminSidebar');
    const backdrop = document.getElementById('adminSidebarBackdrop');
    sidebar?.classList.toggle('open');
    backdrop?.classList.toggle('active');
};

// ============================================
// DASHBOARD OVERVIEW
// ============================================
async function loadDashboardData() {
    try {
        const [productsSnap, ordersSnap, subscribersSnap] = await Promise.all([
            getDocs(query(collection(db, 'products'), where('isActive', '==', true))),
            getDocs(query(collection(db, 'orders'), orderBy('createdAt', 'desc'), limit(10))),
            getDocs(collection(db, 'subscribers'))
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
            <div class="admin-stat-card">
                <div class="admin-stat-label">Community Members</div>
                <div class="admin-stat-value">${subscribersSnap.size}</div>
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

// PARTNERS MANAGEMENT
// ============================================
let allAdminPartners = [];

async function loadPartners() {
    try {
        let snapshot;
        try {
            snapshot = await getDocs(query(collection(db, 'partners'), orderBy('order', 'asc')));
        } catch (queryError) {
            console.warn('Falling back to non-ordered partner query:', queryError);
            snapshot = await getDocs(collection(db, 'partners'));
        }

        allAdminPartners = [];
        snapshot.forEach(d => {
            allAdminPartners.push({ id: d.id, ...d.data() });
        });

        const container = document.getElementById('adminPartnersTable');

        if (allAdminPartners.length === 0) {
            container.innerHTML = '<p style="padding: 40px; text-align: center; color: var(--stone);">No partners yet. Click "Seed Existing Partners" to import your current partners, or "Add Partner" to add a new one.</p>';
            return;
        }

        container.innerHTML = `
            <table class="admin-table">
                <thead>
                    <tr>
                        <th>Order</th>
                        <th>Name</th>
                        <th>Website</th>
                        <th>Category</th>
                        <th>Status</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${allAdminPartners.map(p => {
                        const categoryLabels = { hospitality: 'Hospitality', corporate: 'Corporate', community: 'Community' };
                        return `
                            <tr>
                                <td>${p.order ?? 0}</td>
                                <td><strong>${escapeHtml(p.name)}</strong></td>
                                <td>${p.url ? `<a href="${escapeAttr(p.url)}" target="_blank" rel="noopener" style="color: var(--sage-dark); text-decoration: none;">${escapeHtml(p.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a>` : '<span style="color: var(--stone);">\u2014</span>'}</td>
                                <td>${escapeHtml(categoryLabels[p.category] || p.category || '\u2014')}</td>
                                <td><span class="status-badge ${p.isActive !== false ? 'active' : 'inactive'}">${p.isActive !== false ? 'Active' : 'Inactive'}</span></td>
                                <td>
                                    <div class="admin-actions">
                                        <button class="admin-action-btn" onclick="editPartner('${p.id}')" title="Edit">
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                        </button>
                                        <button class="admin-action-btn delete" onclick="deletePartner('${p.id}', '${escapeAttr(p.name)}')" title="Delete">
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
        console.error('Error loading partners:', error);
        document.getElementById('adminPartnersTable').innerHTML = '<p style="padding: 40px; text-align: center; color: var(--red);">Error loading partners. Check console for details.</p>';
    }
}

window.openPartnerEditor = function(partnerId) {
    const modal = document.getElementById('partnerEditorModal');
    const title = document.getElementById('partnerEditorTitle');
    const form = document.getElementById('partnerEditorForm');

    form.reset();
    document.getElementById('partnerEditId').value = '';
    document.getElementById('partnerOrder').value = allAdminPartners.length;
    document.getElementById('partnerActive').checked = true;

    if (partnerId) {
        title.textContent = 'Edit Partner';
        const partner = allAdminPartners.find(p => p.id === partnerId);
        if (partner) {
            document.getElementById('partnerEditId').value = partner.id;
            document.getElementById('partnerName').value = partner.name || '';
            document.getElementById('partnerUrl').value = partner.url || '';
            document.getElementById('partnerCategory').value = partner.category || 'community';
            document.getElementById('partnerLogo').value = partner.logoUrl || '';
            document.getElementById('partnerOrder').value = partner.order ?? 0;
            document.getElementById('partnerActive').checked = partner.isActive !== false;
        }
    } else {
        title.textContent = 'Add Partner';
    }

    modal.style.display = 'flex';
};

window.closePartnerEditor = function() {
    document.getElementById('partnerEditorModal').style.display = 'none';
};

window.editPartner = function(partnerId) {
    window.openPartnerEditor(partnerId);
};

window.savePartner = async function(e) {
    e.preventDefault();

    const editId = document.getElementById('partnerEditId').value;

    const partnerData = {
        name: document.getElementById('partnerName').value.trim(),
        url: document.getElementById('partnerUrl').value.trim() || null,
        category: document.getElementById('partnerCategory').value,
        logoUrl: document.getElementById('partnerLogo').value.trim() || null,
        order: parseInt(document.getElementById('partnerOrder').value) || 0,
        isActive: document.getElementById('partnerActive').checked,
        updatedAt: serverTimestamp()
    };

    try {
        if (editId) {
            await updateDoc(doc(db, 'partners', editId), partnerData);
            showToast('Partner updated successfully', 'success');
        } else {
            partnerData.createdAt = serverTimestamp();
            await addDoc(collection(db, 'partners'), partnerData);
            showToast('Partner created successfully', 'success');
        }

        closePartnerEditor();
        loadPartners();
    } catch (error) {
        console.error('Error saving partner:', error);
        showToast('Error saving partner', 'error');
    }
};

window.deletePartner = async function(partnerId, partnerName) {
    if (!confirm(`Are you sure you want to delete "${partnerName}"? This cannot be undone.`)) {
        return;
    }

    try {
        await deleteDoc(doc(db, 'partners', partnerId));
        showToast('Partner deleted', 'success');
        loadPartners();
    } catch (error) {
        console.error('Error deleting partner:', error);
        showToast('Error deleting partner', 'error');
    }
};

// Seed existing hardcoded partners into Firestore
window.seedPartners = async function() {
    const existing = await getDocs(collection(db, 'partners'));
    if (existing.size > 0) {
        if (!confirm(`There are already ${existing.size} partners in the database. Do you want to add the default partners anyway? (This may create duplicates.)`)) {
            return;
        }
    }

    const defaultPartners = [
        { name: 'Roam Homeware', url: 'https://roamhomeware.com/', category: 'community' },
        { name: 'Orli Hotel (Orli La Jolla)', url: 'https://stayorli.com/', category: 'hospitality' },
        { name: 'Lucia at Aviara', url: 'https://luciaaviara.com/', category: 'hospitality' },
        { name: 'SAGO', url: 'https://www.sagoencinitas.com/', category: 'hospitality' },
        { name: 'LSKD', url: 'https://lskd.com', category: 'corporate' },
        { name: 'Wonderland', url: 'https://www.wonderlandob.com/', category: 'hospitality' },
        { name: 'Studio Casually', url: 'https://www.studiocasually.com/contact', category: 'community' },
        { name: 'HERO Fitness', url: 'https://heroboardfitness.com', category: 'community' },
        { name: 'Moniker Coffee Co.', url: 'https://www.monikercoffee.com/', category: 'community' },
        { name: 'Ocean Pacific Gym & Wellness', url: 'https://www.oceanpacificgym.com/', category: 'community' },
        { name: 'Trident Coffee', url: 'https://tridentcoffee.com/', category: 'community' },
        { name: 'LMNT', url: 'https://drinklmnt.com/', category: 'corporate' },
        { name: 'Yesly', url: 'https://yeslywater.com/', category: 'corporate' },
        { name: 'PNKYS', url: 'https://drinkpnkys.com/', category: 'community' },
        { name: 'Brogi Mats', url: 'https://brogiyoga.com/', category: 'community' },
        { name: 'VYB Swim', url: 'https://www.vybswim.com', category: 'community' },
        { name: 'Brick & Bell', url: 'https://www.instagram.com/brickandbell/?hl=en', category: 'community' },
        { name: 'Olive Club', url: 'https://oliveclubhouse.com/', category: 'community' },
        { name: 'Zaytouna Olive Oil', url: 'https://zaytounaoliveoil.com/', category: 'community' },
        { name: 'Like Air', url: 'https://likeair.com/', category: 'community' },
        { name: 'Blenders', url: 'https://blenderseyewear.com', category: 'corporate' },
        { name: 'SunBum', url: 'https://www.sunbum.com/', category: 'corporate' },
        { name: 'ATARAHbody', url: 'https://atarahbody.com/', category: 'community' },
        { name: 'BUYA', url: 'https://www.instagram.com/buya.designs/?hl=en', category: 'community' },
        { name: 'Organic Jaguar', url: 'https://organicjaguar.com', category: 'community' },
        { name: 'Herbs to Acupuncture', url: 'https://www.herbstoacupuncture.com/', category: 'community' },
        { name: 'SLATE', url: 'https://slatemilk.com', category: 'corporate' },
        { name: 'WildSociety', url: 'https://wildsociety.com', category: 'community' }
    ];

    try {
        showToast('Seeding partners...', 'success');
        for (let i = 0; i < defaultPartners.length; i++) {
            await addDoc(collection(db, 'partners'), {
                ...defaultPartners[i],
                order: i,
                isActive: true,
                logoUrl: null,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });
        }
        showToast(`${defaultPartners.length} partners added successfully!`, 'success');
        loadPartners();
    } catch (error) {
        console.error('Error seeding partners:', error);
        showToast('Error seeding partners. Check console for details.', 'error');
    }
};

// ============================================
// COMMUNITY / SUBSCRIBERS
// ============================================
let allSubscribers = [];

async function loadSubscribers() {
    try {
        const snap = await getDocs(query(collection(db, 'subscribers'), orderBy('joinedAt', 'desc')));
        allSubscribers = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Stats
        const total = allSubscribers.length;
        const smsCount = allSubscribers.filter(s => s.smsOptIn).length;
        const thisMonth = allSubscribers.filter(s => {
            if (!s.joinedAt) return false;
            const joined = s.joinedAt.toDate ? s.joinedAt.toDate() : new Date(s.joinedAt);
            const now = new Date();
            return joined.getMonth() === now.getMonth() && joined.getFullYear() === now.getFullYear();
        }).length;

        const statsEl = document.getElementById('communityStats');
        if (statsEl) {
            statsEl.innerHTML = `
                <div class="admin-stat-card">
                    <div class="admin-stat-label">Total Members</div>
                    <div class="admin-stat-value">${total}</div>
                </div>
                <div class="admin-stat-card">
                    <div class="admin-stat-label">SMS Opted In</div>
                    <div class="admin-stat-value">${smsCount}</div>
                </div>
                <div class="admin-stat-card">
                    <div class="admin-stat-label">Joined This Month</div>
                    <div class="admin-stat-value">${thisMonth}</div>
                </div>
            `;
        }

        // Table
        const tableEl = document.getElementById('adminSubscribersTable');
        if (!tableEl) return;

        if (allSubscribers.length === 0) {
            tableEl.innerHTML = `
                <div class="admin-empty-state">
                    <p>No community members yet. Once people sign up on the website, they'll appear here.</p>
                </div>
            `;
            return;
        }

        let rows = allSubscribers.map(s => {
            const joinDate = s.joinedAt
                ? (s.joinedAt.toDate ? s.joinedAt.toDate() : new Date(s.joinedAt)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                : '—';
            return `<tr>
                <td>${escapeHtml(s.name)}</td>
                <td>${escapeHtml(s.email)}</td>
                <td>${escapeHtml(s.phone) || '—'}</td>
                <td>${s.smsOptIn ? '<span class="status-badge active">Yes</span>' : '<span class="status-badge inactive">No</span>'}</td>
                <td>${joinDate}</td>
                <td>
                    <div class="admin-actions">
                        <button class="admin-action-btn delete" title="Remove" onclick="removeSubscriber('${s.id}', '${escapeAttr(s.email)}')">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6m3,0V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2v2"/></svg>
                        </button>
                    </div>
                </td>
            </tr>`;
        }).join('');

        tableEl.innerHTML = `
            <table class="admin-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Phone</th>
                        <th>SMS</th>
                        <th>Joined</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        `;
    } catch (error) {
        console.error('Error loading subscribers:', error);
        showToast('Error loading community data', 'error');
    }
}

window.removeSubscriber = async function(id, email) {
    if (!confirm(`Remove ${email} from the community?`)) return;
    try {
        await deleteDoc(doc(db, 'subscribers', id));
        showToast('Member removed', 'success');
        loadSubscribers();
    } catch (error) {
        console.error('Error removing subscriber:', error);
        showToast('Error removing member', 'error');
    }
};

window.exportSubscribers = function() {
    if (allSubscribers.length === 0) {
        showToast('No subscribers to export', 'error');
        return;
    }

    const headers = ['Name', 'Email', 'Phone', 'SMS Opted In', 'Joined'];
    const csvRows = [headers.join(',')];

    allSubscribers.forEach(s => {
        const joinDate = s.joinedAt
            ? (s.joinedAt.toDate ? s.joinedAt.toDate() : new Date(s.joinedAt)).toISOString().split('T')[0]
            : '';
        csvRows.push([
            `"${(s.name || '').replace(/"/g, '""')}"`,
            `"${(s.email || '').replace(/"/g, '""')}"`,
            `"${(s.phone || '').replace(/"/g, '""')}"`,
            s.smsOptIn ? 'Yes' : 'No',
            joinDate
        ].join(','));
    });

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ethereal-balance-community-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('CSV exported', 'success');
};

window.deleteAllSubscribers = async function() {
    if (!confirm('Delete ALL community members? This cannot be undone.')) return;
    if (!confirm('Are you absolutely sure? This will remove every subscriber.')) return;
    try {
        const snap = await getDocs(collection(db, 'subscribers'));
        if (snap.empty) { showToast('No members to delete', 'error'); return; }
        const BATCH_SIZE = 500;
        const docs = snap.docs;
        for (let i = 0; i < docs.length; i += BATCH_SIZE) {
            const batch = writeBatch(db);
            docs.slice(i, i + BATCH_SIZE).forEach(d => batch.delete(d.ref));
            await batch.commit();
        }
        showToast(`Deleted ${docs.length} member(s)`, 'success');
        loadSubscribers();
    } catch (err) {
        console.error('Error deleting subscribers:', err);
        showToast('Error deleting members', 'error');
    }
};

window.importSubscribersCSV = async function(input) {
    const file = input.files[0];
    if (!file) return;
    input.value = '';

    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) {
        showToast('CSV is empty or has no data rows', 'error');
        return;
    }

    // Robust CSV row parser (handles quotes, commas in values)
    function parseRow(line) {
        const cols = [];
        let cur = '', inQuote = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') { inQuote = !inQuote; }
            else if (ch === ',' && !inQuote) { cols.push(cur.trim()); cur = ''; }
            else { cur += ch; }
        }
        cols.push(cur.trim());
        return cols;
    }

    // Use the same parser for headers and data rows
    const headers = parseRow(lines[0]).map(h => h.toLowerCase());
    const nameIdx  = headers.findIndex(h => h === 'name');
    const emailIdx = headers.findIndex(h => h === 'email');
    const phoneIdx = headers.findIndex(h => h.includes('phone'));

    console.log('[CSV Import] Headers:', headers);
    console.log('[CSV Import] Indices — name:', nameIdx, 'email:', emailIdx, 'phone:', phoneIdx);

    if (emailIdx === -1) {
        showToast('CSV must have an "Email" column', 'error');
        return;
    }

    const incoming = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = parseRow(lines[i]);
        const email = (cols[emailIdx] || '').toLowerCase().trim();
        if (!email) continue;
        const phone = phoneIdx !== -1 ? (cols[phoneIdx] || '').trim() : '';
        const name  = nameIdx  !== -1 ? (cols[nameIdx]  || '').trim() : '';
        if (i <= 3) console.log(`[CSV Import] Row ${i}:`, { name, email, phone, raw: cols });
        incoming.push({ name, email, phone });
    }

    if (incoming.length === 0) {
        showToast('No valid rows found in CSV', 'error');
        return;
    }

    console.log(`[CSV Import] Parsed ${incoming.length} rows. Phones found: ${incoming.filter(m => m.phone).length}`);

    // Load existing emails from Firestore to deduplicate
    showToast('Checking for duplicates…', 'success');
    const existingSnap = await getDocs(collection(db, 'subscribers'));
    const existingEmails = new Set(existingSnap.docs.map(d => (d.data().email || '').toLowerCase().trim()));

    const toAdd = incoming.filter(m => !existingEmails.has(m.email));
    const skipped = incoming.length - toAdd.length;

    if (toAdd.length === 0) {
        showToast(`All ${skipped} member(s) already exist — nothing imported`, 'error');
        return;
    }

    // Batch-write new members (Firestore limit: 500 per batch)
    const BATCH_SIZE = 500;
    const now = new Date();
    for (let i = 0; i < toAdd.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        toAdd.slice(i, i + BATCH_SIZE).forEach(m => {
            const ref = doc(collection(db, 'subscribers'));
            batch.set(ref, {
                name:     m.name,
                email:    m.email,
                phone:    m.phone,
                smsOptIn: false,
                active:   true,
                source:   'csv-import',
                joinedAt: Timestamp.fromDate(now),
            });
        });
        await batch.commit();
    }

    const msg = skipped > 0
        ? `Imported ${toAdd.length} member(s). Skipped ${skipped} duplicate(s).`
        : `Imported ${toAdd.length} member(s).`;
    showToast(msg, 'success');
    loadSubscribers();
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
            document.getElementById('settingHeroEyebrow').value = data.heroEyebrow || '';
            document.getElementById('settingHeroHeading').value = data.heroHeading || '';
            document.getElementById('settingHeroDescription').value = data.heroDescription || '';
            document.getElementById('settingHeroPrimaryCtaLabel').value = data.heroPrimaryCtaLabel || '';
            document.getElementById('settingHeroPrimaryCtaHref').value = data.heroPrimaryCtaHref || '';
            document.getElementById('settingHeroSecondaryCtaLabel').value = data.heroSecondaryCtaLabel || '';
            document.getElementById('settingHeroSecondaryCtaHref').value = data.heroSecondaryCtaHref || '';
            document.getElementById('settingAboutHeading').value = data.aboutHeading || '';
            document.getElementById('settingAboutParagraph1').value = data.aboutParagraph1 || '';
            document.getElementById('settingAboutParagraph2').value = data.aboutParagraph2 || '';
            document.getElementById('settingAboutParagraph3').value = data.aboutParagraph3 || '';
            document.getElementById('settingContactHeading').value = data.contactHeading || '';
            document.getElementById('settingContactDescription').value = data.contactDescription || '';
            document.getElementById('settingColorCharcoal').value = data.themeCharcoal || '#2d2d2d';
            document.getElementById('settingColorTerracotta').value = data.themeTerracotta || '#c4907a';
            document.getElementById('settingColorSageDark').value = data.themeSageDark || '#7a9167';
            document.getElementById('settingColorCream').value = data.themeCream || '#f7f4f0';
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
    const heroEyebrow = document.getElementById('settingHeroEyebrow').value.trim();
    const heroHeading = document.getElementById('settingHeroHeading').value.trim();
    const heroDescription = document.getElementById('settingHeroDescription').value.trim();
    const heroPrimaryCtaLabel = document.getElementById('settingHeroPrimaryCtaLabel').value.trim();
    const heroPrimaryCtaHref = document.getElementById('settingHeroPrimaryCtaHref').value.trim();
    const heroSecondaryCtaLabel = document.getElementById('settingHeroSecondaryCtaLabel').value.trim();
    const heroSecondaryCtaHref = document.getElementById('settingHeroSecondaryCtaHref').value.trim();
    const aboutHeading = document.getElementById('settingAboutHeading').value.trim();
    const aboutParagraph1 = document.getElementById('settingAboutParagraph1').value.trim();
    const aboutParagraph2 = document.getElementById('settingAboutParagraph2').value.trim();
    const aboutParagraph3 = document.getElementById('settingAboutParagraph3').value.trim();
    const contactHeading = document.getElementById('settingContactHeading').value.trim();
    const contactDescription = document.getElementById('settingContactDescription').value.trim();
    const themeCharcoal = document.getElementById('settingColorCharcoal').value;
    const themeTerracotta = document.getElementById('settingColorTerracotta').value;
    const themeSageDark = document.getElementById('settingColorSageDark').value;
    const themeCream = document.getElementById('settingColorCream').value;

    try {
        const settingsRef = doc(db, 'settings', 'store');
        const data = {
            shippingRate: Math.round(shippingRate * 100),
            freeShippingThreshold: Math.round(freeShipping * 100),
            taxRate,
            storeEnabled,
            heroEyebrow,
            heroHeading,
            heroDescription,
            heroPrimaryCtaLabel,
            heroPrimaryCtaHref,
            heroSecondaryCtaLabel,
            heroSecondaryCtaHref,
            aboutHeading,
            aboutParagraph1,
            aboutParagraph2,
            aboutParagraph3,
            contactHeading,
            contactDescription,
            themeCharcoal,
            themeTerracotta,
            themeSageDark,
            themeCream,
            updatedAt: serverTimestamp()
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
