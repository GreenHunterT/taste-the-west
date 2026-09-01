// =================================================================
//  Admin Auth Utilities
//  Every protected admin page calls requireAuth() on load.
//  Also wires up the sidebar logout button.
// =================================================================

// Redirect to login if no active session. Returns the session or null.
async function requireAuth() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) {
    window.location.replace('/admin/login.html');
    return null;
  }
  return session;
}

// Fetch the restaurant owned by the current user.
// Returns the restaurant row, or null if not found.
async function getMyRestaurant(userId) {
  const { data, error } = await db
    .from('restaurants')
    .select('*')
    .eq('owner_id', userId)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('[Auth] Error fetching restaurant:', error.message);
  }
  return data || null;
}

// Sign out and redirect to login.
async function signOut() {
  await db.auth.signOut();
  window.location.replace('/admin/login.html');
}

// Populate the sidebar restaurant name + wire logout buttons.
function initAdminShell(restaurantName) {
  // Sidebar name
  const nameEl = document.getElementById('sidebar-name');
  if (nameEl && restaurantName) nameEl.textContent = restaurantName;

  // Active nav link
  const page = document.body.dataset.adminPage;
  document.querySelectorAll('.sidebar-link').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });

  // Logout buttons
  document.querySelectorAll('[data-logout]').forEach(btn => {
    btn.addEventListener('click', signOut);
  });

  // Mobile sidebar toggle
  const sidebar  = document.getElementById('admin-sidebar');
  const overlay  = document.getElementById('sidebar-overlay');
  const menuBtn  = document.getElementById('topbar-menu-btn');

  if (menuBtn && sidebar && overlay) {
    menuBtn.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      overlay.classList.toggle('open');
    });
    overlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('open');
    });
  }
}

// ── TOAST SYSTEM ─────────────────────────────────────────────────
function showToast(message, type = 'success', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const icons = { success: '✓', error: '✕', warning: '⚠' };
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type] || '·'}</span><span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastOut .25s ease forwards';
    setTimeout(() => toast.remove(), 260);
  }, duration);
}

// ── LOADING OVERLAY ───────────────────────────────────────────────
function showLoading()  { const el = document.getElementById('admin-loading'); if (el) el.removeAttribute('hidden'); }
function hideLoading()  { const el = document.getElementById('admin-loading'); if (el) el.setAttribute('hidden', ''); }

// ── IMAGE UPLOAD ──────────────────────────────────────────────────
const IMG_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const IMG_MAX_MB = 5;

function validateImageFile(file) {
  if (!IMG_ALLOWED_TYPES.includes(file.type)) {
    return 'Image must be JPG, PNG, or WebP.';
  }
  if (file.size > IMG_MAX_MB * 1024 * 1024) {
    return `Image must be smaller than ${IMG_MAX_MB} MB.`;
  }
  return null;
}

// Uploads a file to Supabase Storage and returns its public URL.
// path example: 'products/uuid.jpg', 'branding/hero.jpg'
async function uploadToStorage(file, storagePath) {
  const ext      = file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '');
  const safePath = storagePath + '.' + ext;

  const { error: upErr } = await db.storage
    .from('restaurant-media')
    .upload(safePath, file, { upsert: true, contentType: file.type });

  if (upErr) throw new Error('Upload failed: ' + upErr.message);

  const { data: { publicUrl } } = db.storage
    .from('restaurant-media')
    .getPublicUrl(safePath);

  return publicUrl;
}

// Given a Supabase Storage *public URL* for the `restaurant-media` bucket,
// return just the object key (e.g. "products/<rid>-<ts>.jpg"), or null when
// the URL is empty, malformed, from another origin, or from another bucket.
// Never throws.
function storageKeyFromPublicUrl(url) {
  if (!url || typeof url !== 'string') return null;

  let target, origin;
  try {
    target = new URL(url);
    origin = new URL(SUPABASE_URL);
  } catch (e) {
    return null; // malformed url (or misconfigured SUPABASE_URL)
  }

  // Same Supabase project only — ignore external / CDN / pasted URLs.
  if (target.origin !== origin.origin) return null;

  // Accept the plain public form and the image-transform public form.
  const MARKERS = [
    '/storage/v1/object/public/restaurant-media/',
    '/storage/v1/render/image/public/restaurant-media/',
  ];
  let key = null;
  for (const marker of MARKERS) {
    const at = target.pathname.indexOf(marker);
    if (at !== -1) { key = target.pathname.slice(at + marker.length); break; }
  }
  if (!key) return null; // same origin, but not a restaurant-media public object

  try {
    key = decodeURIComponent(key);
  } catch (e) {
    return null; // malformed percent-encoding
  }

  key = key.replace(/^\/+/, '').trim();
  return key || null;
}

// Best-effort delete of a `restaurant-media` object identified by its public
// URL. Never throws. Returns { status: 'ok' | 'skipped' | 'error', key, error? }
// so callers can tell a real failure from a no-op.
async function deleteFromStorage(url) {
  const key = storageKeyFromPublicUrl(url);
  if (!key) return { status: 'skipped', key: null };

  try {
    const { error } = await db.storage.from('restaurant-media').remove([key]);
    if (error) {
      console.warn('[storage] delete failed for', key, '—', error.message);
      return { status: 'error', key, error };
    }
    return { status: 'ok', key };
  } catch (err) {
    console.warn('[storage] delete threw for', key, '—', err && err.message);
    return { status: 'error', key, error: err };
  }
}

// Wire up a file input → preview image + validate.
// Returns a getter function: call it to get the selected File (or null if none selected).
function initImageInput(inputId, previewId, onFilePicked) {
  const input   = document.getElementById(inputId);
  const preview = document.getElementById(previewId);
  if (!input) return () => null;

  let currentFile = null;

  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;
    const err = validateImageFile(file);
    if (err) { showToast(err, 'error'); input.value = ''; return; }
    currentFile = file;
    if (preview) {
      preview.src = URL.createObjectURL(file);
      preview.hidden = false;
    }
    if (onFilePicked) onFilePicked(file);
  });

  // Drag-and-drop on the upload area
  const area = input.closest('.img-upload-area');
  if (area) {
    area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('drag-over'); });
    area.addEventListener('dragleave', ()  => area.classList.remove('drag-over'));
    area.addEventListener('drop', e => {
      e.preventDefault();
      area.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (!file) return;
      const err = validateImageFile(file);
      if (err) { showToast(err, 'error'); return; }
      currentFile = file;
      if (preview) { preview.src = URL.createObjectURL(file); preview.hidden = false; }
      if (onFilePicked) onFilePicked(file);
    });
  }

  return () => currentFile;
}
