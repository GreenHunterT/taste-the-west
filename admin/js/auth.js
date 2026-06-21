// =================================================================
//  Admin Auth Utilities
//  Every protected admin page calls requireAuth() on load.
//  Also wires up the sidebar logout button.
// =================================================================

// Redirect to login if no active session. Returns the session or null.
async function requireAuth() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) {
    window.location.replace('/admin/');
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
  window.location.replace('/admin/');
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
