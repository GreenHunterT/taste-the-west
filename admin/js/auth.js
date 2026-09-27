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


// Admin interface i18n (1T) — js/i18n.js loads first; this falls back to the
// English string if it is ever absent, so these helpers never throw.
function adminT(key, vars, fallback) {
  return (window.AdminI18n && typeof window.AdminI18n.t === 'function')
    ? window.AdminI18n.t(key, vars) : (fallback || key);
}

// ── TOAST SYSTEM ─────────────────────────────────────────────────
function showToast(message, type = 'success', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const icons = { success: '✓', error: '✕', warning: '⚠' };
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  // Arabic Admin → the message text reads RTL; the toast's own placement and
  // icon position stay put (layout remains LTR, per 1T).
  const rtl = !!(window.AdminI18n && window.AdminI18n.getLang() === 'ar');
  toast.innerHTML = `<span class="toast-icon">${icons[type] || '·'}</span><span${rtl ? ' dir="rtl" lang="ar"' : ''}>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastOut .25s ease forwards';
    setTimeout(() => toast.remove(), 260);
  }, duration);
}

// ── OWNER-SAFE ERROR MESSAGES (1O hardening) ────────────────────────
// Every Settings/Menu/Categories save-or-delete catch block used to do
// `showToast('X failed: ' + err.message, 'error')` — for a genuine
// PostgREST/Postgres error, `.message` IS the raw backend explanation
// (constraint names, column names, "row-level security policy" wording),
// shown to the owner and passed straight into showToast()'s innerHTML.
// friendlyDbError() replaces that: it NEVER returns the raw message
// verbatim — only one of the hardcoded strings below, or `fallback`. The
// raw error still goes to console.error() at each call site for
// debugging; it just never reaches the toast.
function ownerError(message) {
  return new Error('OWNER_MSG:' + message);
}
function friendlyDbError(err, fallback) {
  const raw = (err && err.message) ? String(err.message) : String(err || '');
  if (raw.indexOf('OWNER_MSG:') === 0) return raw.slice('OWNER_MSG:'.length);
  const low = raw.toLowerCase();
  // uploadToStorage() failures (1W) — say what actually went wrong.
  if (low.indexOf('upload failed') === 0) {
    return (low.indexOf('failed to fetch') !== -1 || low.indexOf('network') !== -1)
      ? adminT('err.network') : adminT('err.upload');
  }
  if (low.indexOf('duplicate key') !== -1 || low.indexOf('already exists') !== -1) {
    return adminT('err.duplicate');
  }
  if (low.indexOf('failed to fetch') !== -1 || low.indexOf('networkerror') !== -1 || low.indexOf('load failed') !== -1) {
    return adminT('err.network');
  }
  if (low.indexOf('row-level security') !== -1 || low.indexOf('permission denied') !== -1) {
    return adminT('err.permission');
  }
  if (low.indexOf('foreign key') !== -1 || low.indexOf('violates') !== -1) {
    return adminT('err.inUse');
  }
  return fallback || adminT('err.generic');
}

// ── LOADING OVERLAY ───────────────────────────────────────────────
function showLoading()  { const el = document.getElementById('admin-loading'); if (el) el.removeAttribute('hidden'); }
function hideLoading()  { const el = document.getElementById('admin-loading'); if (el) el.setAttribute('hidden', ''); }

// ── IMAGE UPLOAD ──────────────────────────────────────────────────
const IMG_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const IMG_MAX_MB = 5;

function validateImageFile(file) {
  if (!IMG_ALLOWED_TYPES.includes(file.type)) {
    return adminT('err.imageType');
  }
  if (file.size > IMG_MAX_MB * 1024 * 1024) {
    return adminT('err.imageSize', { mb: IMG_MAX_MB });
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

// Upload area wording follows the state (1W): "Click to upload" when empty,
// "Click to replace the image" when an image is already chosen / saved.
function syncUploadArea(inputId, hasImage) {
  const input = document.getElementById(inputId);
  const strong = input && input.closest('.img-upload-area') && input.closest('.img-upload-area').querySelector('[data-i18n^="upload."]');
  if (!strong || !window.AdminI18n) return;
  window.AdminI18n.set(strong, hasImage ? 'upload.replace' : 'upload.click');
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
