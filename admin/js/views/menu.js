// =================================================================
//  Admin Shell — Menu Items view  (milestone 1I-D)
//
//  The real Menu editor. Lifecycle: mount(ctx, root) / unmount() / isDirty().
//  It renders ONLY the left-side editing UI (list + Add/Edit modal + Delete
//  confirm); the shared Live Preview belongs to the shell (ctx.preview),
//  mounted once for the shell's life. This view never auths, never loads the
//  restaurant identity, never mounts a preview — it consumes ctx.restaurant /
//  ctx.restaurantLoadState / ctx.db / ctx.preview / ctx.showPane.
//
//  Unsaved product edits reach the Preview through ctx.preview.setCatalogDraft
//  (a whitelisted overlay — never a DB write). This module is authoritative;
//  the old standalone admin/menu.html is now a redirect to /admin/#menu.
// =================================================================

window.AdminViews = window.AdminViews || {};

window.AdminViews.menu = (function () {
  'use strict';

  // Modal field id → Preview language when that field is edited. Fields absent
  // here (price / category / sort / image / toggles) keep the current Preview
  // language. Language is never inferred from typed characters.
  var FIELD_LANG = { 'p-name-en': 'en', 'p-name-ar': 'ar', 'p-desc-en': 'en', 'p-desc-ar': 'ar' };

  // ── Per-mount state (reset by resetState() at the top of mount()) ──
  var ctx, root;
  var mountToken = 0;          // bumped on every mount + unmount; guards a slow async mount()
  var teardownFns = [];
  var menuReady = false;
  var saving = false;
  var contextKey = '';
  var RID = '';

  var allProducts = [];
  var allCategories = [];

  var editingId = null;        // real product id | 'draft:<token>' | null
  var editingRow = null;       // the allProducts row when editing a SAVED product
  var editImageFile = null;    // freshly picked File for the row being edited
  var editImageObjUrl = null;  // object URL for that File (draft + modal thumb) — revoked on close
  var removeImage = false;

  var pendingDeleteId = null;
  var pendingDeleteImg = '';
  var loadAbort = null;

  function resetState() {
    teardownFns = [];
    menuReady = false;
    saving = false;
    contextKey = '';
    RID = '';
    allProducts = [];
    allCategories = [];
    editingId = null;
    editingRow = null;
    editImageFile = null;
    editImageObjUrl = null;
    removeImage = false;
    pendingDeleteId = null;
    pendingDeleteImg = '';
    loadAbort = null;
  }

  // ── Small helpers ───────────────────────────────────────────────
  function on(target, type, fn, opts) {
    if (!target) return;
    target.addEventListener(type, fn, opts);
    teardownFns.push(function () { try { target.removeEventListener(type, fn, opts); } catch (e) {} });
  }
  function q(sel) { return root ? root.querySelector(sel) : null; }
  function fv(id) { var e = q('#' + id); return e ? String(e.value == null ? '' : e.value).trim() : ''; }
  function setVal(id, v) { var e = q('#' + id); if (e) e.value = (v == null ? '' : v); }
  function opt(value, label) {
    var o = document.createElement('option');
    o.value = value == null ? '' : String(value);
    o.textContent = label == null ? '' : String(label);
    return o;
  }
  function softFocus(node) {
    if (!node) return;
    try { node.focus({ preventScroll: true }); } catch (e) { node.focus(); }
  }
  function uniqueToken() {
    try { if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID(); } catch (e) {}
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function langForField(id) {
    return Object.prototype.hasOwnProperty.call(FIELD_LANG, id) ? FIELD_LANG[id] : '';
  }
  function makeErrNote(text) {
    var p = document.createElement('p');
    p.className = 'field-hint';
    p.style.cssText = 'color:var(--amuted);padding:24px';
    p.textContent = text || 'The menu editor is read-only — the restaurant could not be loaded. Reload the page.';
    return p;
  }

  // =================================================================
  //  Markup  (left side only — list + Add/Edit modal + Delete confirm)
  // =================================================================
  function viewMarkup() {
    return [
      '<div class="menu-view">',
      '  <div class="admin-page-header">',
      '    <div>',
      '      <h1 class="admin-page-title">Menu Items</h1>',
      '      <p class="admin-page-desc">Manage all products on your public menu. Edits preview instantly; they go live only after you Save.</p>',
      '    </div>',
      '    <button class="btn btn-primary" id="add-product-btn" type="button">+ Add Item</button>',
      '  </div>',
      '  <p class="field-hint settings-view__hint--error" id="menu-error-note" hidden>Menu is read-only — the restaurant could not be loaded. Reload the page.</p>',
      '',
      '  <div class="acard">',
      '    <div class="table-toolbar">',
      '      <div class="table-search">',
      '        <svg class="table-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>',
      '        <input type="search" id="table-search" placeholder="Search items…" />',
      '      </div>',
      '      <select id="cat-filter" style="width:auto"><option value="">All categories</option></select>',
      '    </div>',
      '    <div id="products-table-wrap">',
      '      <div class="empty-state"><div class="empty-state-icon">🍕</div><h3>Loading…</h3><p>Fetching your menu items.</p></div>',
      '    </div>',
      '  </div>',
      '',
      '  <!-- Add / Edit Modal -->',
      '  <div class="modal-backdrop" id="product-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">',
      '    <div class="modal">',
      '      <div class="modal-header">',
      '        <h2 class="modal-title" id="modal-title">Add Menu Item</h2>',
      '        <button class="modal-close" id="modal-close" type="button" aria-label="Close">×</button>',
      '      </div>',
      '      <div class="modal-body">',
      '        <form id="product-form" novalidate>',
      '          <input type="hidden" id="product-id" />',
      '          <div class="form-row">',
      '            <div class="form-group">',
      '              <label for="p-name-ar">Name (Arabic) <span class="required">*</span></label>',
      '              <input type="text" id="p-name-ar" dir="rtl" placeholder="مارغريتا كلاسيك" required />',
      '            </div>',
      '            <div class="form-group">',
      '              <label for="p-name-en">Name (English) <span class="required">*</span></label>',
      '              <input type="text" id="p-name-en" placeholder="Classic Margherita" required />',
      '            </div>',
      '          </div>',
      '          <div class="form-row">',
      '            <div class="form-group">',
      '              <label for="p-desc-ar">Description (Arabic)</label>',
      '              <textarea id="p-desc-ar" dir="rtl" placeholder="وصف المنتج…" rows="2"></textarea>',
      '            </div>',
      '            <div class="form-group">',
      '              <label for="p-desc-en">Description (English)</label>',
      '              <textarea id="p-desc-en" placeholder="Product description…" rows="2"></textarea>',
      '            </div>',
      '          </div>',
      '          <div class="form-row triple">',
      '            <div class="form-group">',
      '              <label for="p-price">Price (﷼) <span class="required">*</span></label>',
      '              <input type="text" id="p-price" placeholder="e.g. 39 or 18.5" required />',
      '            </div>',
      '            <div class="form-group">',
      '              <label for="p-category">Category</label>',
      '              <select id="p-category"><option value="">— None —</option></select>',
      '            </div>',
      '            <div class="form-group">',
      '              <label for="p-sort">Sort Order</label>',
      '              <input type="number" id="p-sort" value="0" min="0" />',
      '            </div>',
      '          </div>',
      '          <div class="form-group mb-2">',
      '            <label>Product Image <small>(JPG · PNG · WebP · max 5 MB)</small></label>',
      '            <div class="img-upload-area" onclick="document.getElementById(\'p-image-file\').click()">',
      '              <input type="file" id="p-image-file" accept="image/jpeg,image/png,image/webp" />',
      '              <div class="img-upload-icon">📷</div>',
      '              <div class="img-upload-label"><strong>Click to upload</strong> or drag and drop</div>',
      '              <div class="img-upload-hint">600×450 px recommended</div>',
      '            </div>',
      '            <div style="margin-top:10px">',
      '              <img id="p-image-preview" class="img-preview" hidden alt="Product preview" />',
      '              <button type="button" id="p-image-remove" class="btn btn-danger btn-sm mt-1" hidden>Remove image</button>',
      '            </div>',
      '          </div>',
      '          <div class="divider"></div>',
      '          <div class="toggle-row">',
      '            <div class="toggle-info"><strong>Featured</strong><span>Shows on the homepage spotlight</span></div>',
      '            <label class="toggle"><input type="checkbox" id="p-featured" /><span class="toggle-track"></span></label>',
      '          </div>',
      '          <div class="toggle-row">',
      '            <div class="toggle-info"><strong>Available</strong><span>Visible on the public menu (uncheck to hide temporarily)</span></div>',
      '            <label class="toggle"><input type="checkbox" id="p-available" checked /><span class="toggle-track"></span></label>',
      '          </div>',
      '        </form>',
      '      </div>',
      '      <div class="modal-footer">',
      '        <button class="btn btn-ghost btn-sm" id="mn-view-preview" type="button">View in Preview</button>',
      '        <button class="btn btn-ghost" id="modal-cancel" type="button">Cancel</button>',
      '        <button class="btn btn-primary" id="modal-save" type="button">Save Item</button>',
      '      </div>',
      '    </div>',
      '  </div>',
      '',
      '  <!-- Confirm Delete Dialog -->',
      '  <div class="modal-backdrop" id="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">',
      '    <div class="confirm-dialog">',
      '      <h2 class="confirm-title" id="confirm-title">Delete item?</h2>',
      '      <p class="confirm-msg" id="confirm-msg">This will permanently remove the item from your menu. This cannot be undone.</p>',
      '      <div class="confirm-actions">',
      '        <button class="btn btn-ghost" id="confirm-cancel" type="button">Cancel</button>',
      '        <button class="btn btn-danger" id="confirm-ok" type="button">Delete</button>',
      '      </div>',
      '    </div>',
      '  </div>',
      '</div>',
    ].join('\n');
  }

  // =================================================================
  //  Data load  (fresh session token for the authenticated raw read)
  // =================================================================
  async function loadAll() {
    if (!ctx || ctx.restaurantLoadState !== 'ready') return;

    // Re-verify the session on every load so a refreshed / expired access token
    // is never reused for the authenticated raw request below (the shell is
    // long-lived — a token captured at mount would eventually be stale).
    var session = null;
    try {
      var s = await ctx.db.auth.getSession();
      session = s && s.data ? s.data.session : null;
    } catch (e) { session = null; }
    if (!session) return;   // the shell's auth-state listener owns the redirect

    if (loadAbort) { try { loadAbort.abort(); } catch (e) {} }
    loadAbort = new AbortController();
    var signal = loadAbort.signal;

    var base = SUPABASE_URL + '/rest/v1';
    var h = { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + session.access_token };

    try {
      var res = await Promise.all([
        fetch(base + '/products?restaurant_id=eq.' + RID + '&order=sort_order&select=*,categories(id,slug,name_ar,name_en)', { headers: h, signal: signal }),
        fetch(base + '/categories?restaurant_id=eq.' + RID + '&order=sort_order', { headers: h, signal: signal }),
      ]);
      var pRes = res[0], cRes = res[1];
      allProducts   = pRes.ok ? await pRes.json() : [];
      allCategories = cRes.ok ? await cRes.json() : [];
      populateCategoryControls();
      renderTable();
      if (!pRes.ok || !cRes.ok) showToast('Some menu data could not be loaded. Reload to retry.', 'warning', 5000);
    } catch (e) {
      if (e && e.name === 'AbortError') return;   // unmounted / superseded mid-fetch
      console.error('[menu view] load failed:', e);
      var wrap = q('#products-table-wrap');
      if (wrap) { wrap.textContent = ''; wrap.appendChild(makeErrNote('Menu could not be loaded. Reload to retry.')); }
    } finally {
      loadAbort = null;
    }
  }

  function populateCategoryControls() {
    var filter = q('#cat-filter');
    if (filter) {
      var cur = filter.value;
      filter.textContent = '';
      filter.appendChild(opt('', 'All categories'));
      allCategories.forEach(function (c) { filter.appendChild(opt(c.id, c.name_en || c.name_ar || '—')); });
      filter.value = cur;
    }
    var sel = q('#p-category');
    if (sel) {
      var curS = sel.value;
      sel.textContent = '';
      sel.appendChild(opt('', '— None —'));
      allCategories.forEach(function (c) {
        sel.appendChild(opt(c.id, (c.name_en || '—') + ' / ' + (c.name_ar || '—')));
      });
      sel.value = curS;
    }
  }

  // ── Table ────────────────────────────────────────────────────────
  // Admin-only surface. Every owner-entered value is escaped via esc(); the
  // Preview / public rendering path is DOM-built (js/app.js).
  function renderTable() {
    var wrap = q('#products-table-wrap');
    if (!wrap) return;

    var qtext = (q('#table-search') ? q('#table-search').value.trim() : '');
    var qcat  = (q('#cat-filter') ? q('#cat-filter').value : '');

    var list = allProducts.slice();
    if (qtext) {
      var ql = qtext.toLowerCase();
      list = list.filter(function (p) {
        return (p.name_en || '').toLowerCase().indexOf(ql) !== -1 ||
               (p.name_ar || '').toLowerCase().indexOf(ql) !== -1;
      });
    }
    if (qcat) list = list.filter(function (p) { return p.category_id === qcat; });

    if (!list.length) {
      wrap.innerHTML =
        '<div class="empty-state">' +
        '<div class="empty-state-icon">🍕</div>' +
        '<h3>' + (allProducts.length ? 'No results' : 'No items yet') + '</h3>' +
        '<p>' + (allProducts.length ? 'Try clearing your filters.' : 'Add your first menu item to get started.') + '</p>' +
        (allProducts.length ? '' : '<button class="btn btn-primary" id="add-product-btn-empty" type="button">+ Add Item</button>') +
        '</div>';
      return;
    }

    var PLACEHOLDER = '../assets/images/product-placeholder.svg';
    var rows = list.map(function (p) {
      var cat = p.categories;
      var catName = cat ? cat.name_en : '—';
      var imgSrc = p.image_url || PLACEHOLDER;
      var avBadge = p.available
        ? '<span class="badge badge-success">Active</span>'
        : '<span class="badge badge-muted">Hidden</span>';
      var ftBadge = p.featured ? '<span class="badge badge-gold" style="margin-left:4px">★ Featured</span>' : '';
      return '' +
        '<tr data-id="' + esc(p.id) + '">' +
          '<td><img src="' + esc(imgSrc) + '" class="product-thumb" alt="" onerror="this.src=\'' + PLACEHOLDER + '\'" /></td>' +
          '<td class="product-name-cell"><strong>' + esc(p.name_en) + '</strong><span>' + esc(p.name_ar) + '</span></td>' +
          '<td>' + esc(catName) + '</td>' +
          '<td>' + esc(p.price) + '</td>' +
          '<td>' + avBadge + ftBadge + '</td>' +
          '<td><div class="row-actions">' +
            '<button class="btn btn-ghost btn-sm btn-edit" type="button" data-id="' + esc(p.id) + '" title="Edit">✏</button>' +
            '<button class="btn btn-ghost btn-sm btn-toggle" type="button" data-id="' + esc(p.id) + '" data-available="' + (p.available ? 'true' : 'false') + '" title="' + (p.available ? 'Hide' : 'Show') + '">' + (p.available ? '👁' : '🚫') + '</button>' +
            '<button class="btn btn-danger btn-sm btn-delete" type="button" data-id="' + esc(p.id) + '" data-name="' + esc(p.name_en) + '" title="Delete">🗑</button>' +
          '</div></td>' +
        '</tr>';
    }).join('');

    wrap.innerHTML =
      '<table class="data-table"><thead><tr>' +
      '<th style="width:52px"></th><th>Name</th><th>Category</th><th>Price</th><th>Status</th><th style="width:130px">Actions</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>';
  }

  // Delegated — one listener for the whole table, survives every re-render.
  function onTableClick(e) {
    var addEmpty = e.target.closest('#add-product-btn-empty');
    if (addEmpty) { openAddModal(); return; }
    var btn = e.target.closest('button[data-id]');
    if (!btn) return;
    var id = btn.dataset.id;
    if (btn.classList.contains('btn-edit')) openEditModal(id);
    else if (btn.classList.contains('btn-toggle')) toggleAvailable(id, btn.dataset.available === 'true');
    else if (btn.classList.contains('btn-delete')) confirmDelete(id, btn.dataset.name || '');
  }

  // =================================================================
  //  Context-aware Preview  (per-product; reuses the 1I-C focus protocol)
  // =================================================================
  // Starting to edit a product → the shared Preview switches to Menu + the
  // right LANGUAGE (for *_en / *_ar fields) ONCE, brings the card to centre,
  // and briefly highlights it. Typing thereafter → catalog-draft only.
  function applyProductContext(id, lang, force) {
    if (!ctx || ctx.restaurantLoadState !== 'ready' || !id) return;
    var key = 'menu|product:' + id + '|' + (lang || '');
    if (!force && key === contextKey) return;      // same context → nothing (no re-nav / re-highlight)
    contextKey = key;
    if (lang && ctx.preview.getState().lang !== lang) ctx.preview.setLanguage(lang);
    ctx.preview.showPage('menu', { focus: { type: 'product', id: id } });
  }

  // =================================================================
  //  Unsaved product draft → Preview catalog overlay
  // =================================================================
  function currentDraftImageUrl() {
    if (editImageObjUrl) return editImageObjUrl;   // freshly picked file (blob:)
    if (removeImage) return '';
    if (editingRow && editingRow.image_url) return editingRow.image_url;
    return '';
  }
  function pushProductDraft() {
    if (!menuReady || !editingId || !ctx || ctx.restaurantLoadState !== 'ready') return;
    var patch = {
      name_en: fv('p-name-en'),
      name_ar: fv('p-name-ar'),
      description_en: fv('p-desc-en'),
      description_ar: fv('p-desc-ar'),
      price: fv('p-price'),
      category_id: (q('#p-category') || {}).value || '',
      featured: !!(q('#p-featured') || {}).checked,
      available: !!(q('#p-available') || {}).checked,
      sort_order: parseInt(fv('p-sort'), 10) || 0,
      image_url: currentDraftImageUrl(),
    };
    ctx.preview.setCatalogDraft({ products: [{ id: editingId, patch: patch }] });
  }

  function onModalField(e) {
    if (!menuReady || !editingId) return;
    var id = (e.target && e.target.id) || '';
    applyProductContext(editingId, langForField(id));
    if (e.type === 'input' || e.type === 'change') pushProductDraft();
  }

  // =================================================================
  //  Image picker  (single object URL → modal thumb + Preview draft)
  // =================================================================
  function clearEditObjUrl() {
    if (!editImageObjUrl) return;
    var dead = editImageObjUrl;
    editImageObjUrl = null;
    // Defer: a Preview <img> in the iframe may still point at it for a frame.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { try { URL.revokeObjectURL(dead); } catch (e) {} });
    });
  }
  function setEditImageFile(file) {
    var err = (typeof validateImageFile === 'function') ? validateImageFile(file) : null;
    if (err) { showToast(err, 'error'); var fi0 = q('#p-image-file'); if (fi0) fi0.value = ''; return; }
    clearEditObjUrl();
    editImageFile = file;
    removeImage = false;
    editImageObjUrl = URL.createObjectURL(file);
    var prev = q('#p-image-preview');
    if (prev) { prev.src = editImageObjUrl; prev.hidden = false; }
    updateImageRemoveBtn();
    pushProductDraft();
  }
  function wireImagePicker() {
    var input = q('#p-image-file');
    if (!input) return;
    on(input, 'change', function () {
      var f = input.files && input.files[0];
      if (f) setEditImageFile(f);
    });
    var area = input.closest('.img-upload-area');
    if (area) {
      on(area, 'dragover', function (e) { e.preventDefault(); area.classList.add('drag-over'); });
      on(area, 'dragleave', function () { area.classList.remove('drag-over'); });
      on(area, 'drop', function (e) {
        e.preventDefault();
        area.classList.remove('drag-over');
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) setEditImageFile(f);
      });
    }
  }
  function onRemoveImage() {
    clearEditObjUrl();
    editImageFile = null;
    removeImage = true;
    var fi = q('#p-image-file'); if (fi) fi.value = '';
    var prev = q('#p-image-preview'); if (prev) { prev.src = ''; prev.hidden = true; }
    updateImageRemoveBtn();
    pushProductDraft();
  }
  function updateImageRemoveBtn() {
    var btn = q('#p-image-remove');
    if (!btn) return;
    var prev = q('#p-image-preview');
    var hasImage = !!editImageFile || (prev && !prev.hidden && !!prev.getAttribute('src'));
    btn.hidden = !hasImage;
  }

  // =================================================================
  //  Modal open / close
  // =================================================================
  function setModalTitle(t) { var el = q('#modal-title'); if (el && t) el.textContent = t; }
  function resetModalForm() {
    var form = q('#product-form');
    if (form) form.reset();
    setVal('product-id', '');
    var prev = q('#p-image-preview'); if (prev) { prev.src = ''; prev.hidden = true; }
    var fi = q('#p-image-file'); if (fi) fi.value = '';
    clearEditObjUrl();
    editImageFile = null;
    removeImage = false;
    updateImageRemoveBtn();
  }
  function showModal(title) {
    setModalTitle(title);
    var m = q('#product-modal');
    if (m) m.classList.add('open');
    softFocus(q('#p-name-en'));
  }
  function hideModalDom() {
    var m = q('#product-modal');
    if (m) m.classList.remove('open');
  }
  function cancelModal() {
    editingId = null;
    editingRow = null;
    contextKey = '';
    resetModalForm();
    hideModalDom();
    if (ctx && ctx.preview) ctx.preview.clearCatalogDraft();   // temp / edited card → back to saved catalog
  }
  function viewInPreview() {
    if (!editingId) return;
    ctx.showPane('preview');
    applyProductContext(editingId, '', true);
  }

  function openAddModal() {
    if (!menuReady) return;
    resetModalForm();
    editingId = 'draft:' + uniqueToken();
    editingRow = null;
    removeImage = false;
    editImageFile = null;
    var av = q('#p-available'); if (av) av.checked = true;
    // Overlay + context BEFORE the modal opens, so the name_en autofocus that
    // showModal() triggers dedupes to a no-op (its context key is already set).
    contextKey = '';
    pushProductDraft();                           // temporary product enters the overlay
    applyProductContext(editingId, 'en', true);   // Menu + EN + scroll/highlight the temp card
    showModal('Add Menu Item');
  }

  function openEditModal(id) {
    if (!menuReady) return;
    var p = allProducts.find(function (x) { return x.id === id; });
    if (!p) return;
    resetModalForm();
    editingId = id;
    editingRow = p;
    removeImage = false;
    editImageFile = null;
    setVal('product-id', p.id);
    setVal('p-name-ar', p.name_ar);
    setVal('p-name-en', p.name_en);
    setVal('p-desc-ar', p.description_ar);
    setVal('p-desc-en', p.description_en);
    setVal('p-price', p.price);
    setVal('p-category', p.category_id || '');
    setVal('p-sort', p.sort_order || 0);
    var ft = q('#p-featured'); if (ft) ft.checked = !!p.featured;
    var av = q('#p-available'); if (av) av.checked = p.available !== false;
    if (p.image_url) { var prev = q('#p-image-preview'); if (prev) { prev.src = p.image_url; prev.hidden = false; } }
    updateImageRemoveBtn();
    contextKey = '';
    pushProductDraft();                           // baseline overlay == saved values (no visible change)
    applyProductContext(id, 'en', true);          // Menu + EN + scroll/highlight this card
    showModal('Edit Menu Item');
  }

  // =================================================================
  //  Save  (add or edit — rollback-safe image handling)
  // =================================================================
  async function handleSave(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (saving || !menuReady) return;
    saving = true;
    try { await doSave(); }
    finally { saving = false; }
  }

  async function doSave() {
    if (!ctx || ctx.restaurantLoadState !== 'ready' || !ctx.restaurant || !ctx.restaurant.id) {
      showToast('Menu could not be loaded. Reload the page before saving.', 'error');
      return;
    }
    var nameEn = fv('p-name-en'), nameAr = fv('p-name-ar'), price = fv('p-price');
    if (!nameEn || !nameAr) { showToast('Name (Arabic and English) is required.', 'error'); return; }
    if (!price) { showToast('Price is required.', 'error'); return; }

    var saveBtn = q('#modal-save');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<span class="btn-spinner"></span> Saving…'; }

    // Tracks the object THIS save uploaded + whether the DB write landed. A
    // fresh upload is rolled back ONLY when persistence did not succeed.
    var editId = editingRow ? editingRow.id : null;   // real UPDATE only for a saved row
    var oldUrl = editingRow ? (editingRow.image_url || '') : '';
    var uploadedThisOp = null;
    var persisted = false;

    try {
      var imageUrl;
      if (editImageFile) {
        imageUrl = await uploadToStorage(editImageFile, 'products/' + RID + '-' + Date.now());
        uploadedThisOp = imageUrl;
      } else if (removeImage) {
        imageUrl = '';
      } else if (editId) {
        imageUrl = oldUrl;
      } else {
        imageUrl = '';
      }

      var catVal = (q('#p-category') || {}).value || '';
      var payload = {
        restaurant_id:  RID,
        name_ar:        nameAr,
        name_en:        nameEn,
        description_ar: fv('p-desc-ar'),
        description_en: fv('p-desc-en'),
        price:          price,
        category_id:    catVal || null,
        image_url:      imageUrl || '',
        featured:       !!(q('#p-featured') || {}).checked,
        available:      !!(q('#p-available') || {}).checked,
        sort_order:     parseInt(fv('p-sort'), 10) || 0,
      };

      var savedId = editId;
      if (editId) {
        var ures = await ctx.db.from('products').update(payload).eq('id', editId);
        if (ures.error) throw new Error(ures.error.message);
      } else {
        var ires = await ctx.db.from('products').insert(payload).select('id');
        if (ires.error) throw new Error(ires.error.message);
        savedId = (ires.data && ires.data[0] && ires.data[0].id) || null;
      }
      persisted = true;

      // Persistence succeeded — the row now owns `imageUrl`; best-effort clean
      // up the now-unreferenced old object only.
      if (uploadedThisOp && oldUrl && oldUrl !== uploadedThisOp) await deleteFromStorage(oldUrl);
      else if (removeImage && oldUrl) await deleteFromStorage(oldUrl);

      showToast(editId ? 'Item updated.' : 'Item added.', 'success');
      if (ctx && typeof ctx.sound === 'function') ctx.sound('success');

      // Tear the editor down, drop the overlay, re-pull the real catalog, then
      // highlight the persisted card exactly once.
      editingId = null;
      editingRow = null;
      editImageFile = null;
      removeImage = false;
      contextKey = '';
      resetModalForm();
      hideModalDom();
      ctx.preview.clearCatalogDraft();
      await loadAll();
      if (savedId != null) ctx.preview.refreshCatalog({ focus: { type: 'product', id: savedId } });
      else ctx.preview.refreshCatalog();
    } catch (err) {
      // Roll back ONLY the object this op uploaded, and ONLY if never persisted.
      if (uploadedThisOp && !persisted) { try { await deleteFromStorage(uploadedThisOp); } catch (e2) {} }
      console.error('[menu view] save failed:', err);
      showToast(friendlyDbError(err, 'Save failed. Please try again.'), 'error', 5500);
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Item'; }
    }
  }

  // =================================================================
  //  Availability toggle (row action — persists immediately, like legacy)
  // =================================================================
  async function toggleAvailable(id, currentlyAvailable) {
    var res = await ctx.db.from('products').update({ available: !currentlyAvailable }).eq('id', id);
    if (res.error) { console.error('[menu view] availability toggle failed:', res.error); showToast(friendlyDbError(res.error, 'Update failed. Please try again.'), 'error', 5500); return; }
    showToast(currentlyAvailable ? 'Item hidden from menu.' : 'Item is now visible.', 'success');
    await loadAll();
    if (ctx && ctx.preview) ctx.preview.refreshCatalog();
  }

  // =================================================================
  //  Delete
  // =================================================================
  function confirmDelete(id, name) {
    pendingDeleteId = id;
    var p = allProducts.find(function (x) { return x.id === id; });
    pendingDeleteImg = p ? (p.image_url || '') : '';
    var msg = q('#confirm-msg');
    if (msg) msg.textContent = '"' + (name || 'This item') + '" will be permanently removed from your menu. This cannot be undone.';
    var m = q('#confirm-modal'); if (m) m.classList.add('open');
    if (ctx && typeof ctx.sound === 'function') ctx.sound('warning');
  }
  function closeConfirm() {
    pendingDeleteId = null;
    pendingDeleteImg = '';
    var m = q('#confirm-modal'); if (m) m.classList.remove('open');
  }
  async function doDelete() {
    if (!pendingDeleteId) return;
    var id = pendingDeleteId, img = pendingDeleteImg;
    closeConfirm();

    var res = await ctx.db.from('products').delete().eq('id', id);
    if (res.error) { console.error('[menu view] delete failed:', res.error); showToast(friendlyDbError(res.error, 'Delete failed. Please try again.'), 'error', 5500); return; }

    // Row is gone — best-effort remove its image. A Storage failure here must
    // not undo the delete.
    await deleteFromStorage(img);
    showToast('Item deleted.', 'success');

    if (editingId && editingRow && editingRow.id === id) {
      editingId = null;
      editingRow = null;
      contextKey = '';
      resetModalForm();
      hideModalDom();
    }
    if (ctx && ctx.preview) ctx.preview.clearCatalogDraft();
    await loadAll();
    if (ctx && ctx.preview) ctx.preview.refreshCatalog();
  }

  // =================================================================
  //  Static event wiring
  // =================================================================
  function wireStaticEvents() {
    var search = q('#table-search');
    if (search) on(search, 'input', function () { renderTable(); });
    var catf = q('#cat-filter');
    if (catf) on(catf, 'change', function () { renderTable(); });

    var addBtn = q('#add-product-btn');
    if (addBtn) on(addBtn, 'click', openAddModal);

    var wrap = q('#products-table-wrap');
    if (wrap) on(wrap, 'click', onTableClick);

    var mClose = q('#modal-close'); if (mClose) on(mClose, 'click', cancelModal);
    var mCancel = q('#modal-cancel'); if (mCancel) on(mCancel, 'click', cancelModal);
    var mBack = q('#product-modal');
    if (mBack) on(mBack, 'click', function (e) { if (e.target === e.currentTarget) cancelModal(); });
    var mSave = q('#modal-save'); if (mSave) on(mSave, 'click', handleSave);
    var mView = q('#mn-view-preview'); if (mView) on(mView, 'click', viewInPreview);

    var form = q('#product-form');
    if (form) {
      on(form, 'focusin', onModalField);
      on(form, 'input', onModalField);
      on(form, 'change', onModalField);
      on(form, 'submit', handleSave);
    }

    wireImagePicker();
    var rmBtn = q('#p-image-remove');
    if (rmBtn) on(rmBtn, 'click', onRemoveImage);

    var cCancel = q('#confirm-cancel'); if (cCancel) on(cCancel, 'click', closeConfirm);
    var cOk = q('#confirm-ok'); if (cOk) on(cOk, 'click', doDelete);
    var cBack = q('#confirm-modal');
    if (cBack) on(cBack, 'click', function (e) { if (e.target === e.currentTarget) closeConfirm(); });
    // No beforeunload blob revoke here: the browser releases object URLs on a
    // real unload, and revoking speculatively would break the Preview image if
    // the owner CANCELS the unload. Explicit revoke happens on file replace /
    // modal close / Save transition / unmount (clearEditObjUrl + the unmount
    // double-rAF revoke below). The shell owns the ONE beforeunload warning.
  }

  // =================================================================
  //  Lifecycle
  // =================================================================
  async function mount(_ctx, _root) {
    var myToken = ++mountToken;
    ctx = _ctx;
    root = _root;
    resetState();

    root.innerHTML = viewMarkup();

    var ready = ctx.restaurantLoadState === 'ready' && ctx.restaurant && ctx.restaurant.id;
    if (!ready) {
      // Fail closed: read-only. The shell banner already explains the error.
      var wrap = q('#products-table-wrap');
      if (wrap) { wrap.textContent = ''; wrap.appendChild(makeErrNote()); }
      var addb = q('#add-product-btn'); if (addb) addb.disabled = true;
      var note = q('#menu-error-note'); if (note) note.hidden = false;
      return;   // no load, no wiring, no preview drive
    }
    RID = ctx.restaurant.id;

    // Drive the shared Preview to Menu ONCE — page context only. Device /
    // language / view are the owner's and stay untouched;
    // showPage() is a no-op if Menu is already active.
    try { ctx.preview.showPage('menu'); } catch (e) {}

    wireStaticEvents();

    var pending = ctx.pendingAction || null;   // one-shot shell route action (e.g. #menu&action=new)
    ctx.pendingAction = null;

    await loadAll();
    if (myToken !== mountToken) return;         // a newer mount / an unmount superseded us
    menuReady = true;

    if (pending === 'new') openAddModal();
  }

  // Unsaved-changes contract for the shell's navigation guard (§4). Dirty only
  // while an Add/Edit modal is open with real unsaved content — a new draft with
  // any field filled, or an edit whose form differs from the saved row. Row
  // actions (toggle available, delete) persist immediately and are never dirty.
  function isDirty() {
    if (!menuReady || !editingId) return false;
    if (editingRow) {
      if (fv('p-name-en') !== (editingRow.name_en || '')) return true;
      if (fv('p-name-ar') !== (editingRow.name_ar || '')) return true;
      if (fv('p-desc-en') !== (editingRow.description_en || '')) return true;
      if (fv('p-desc-ar') !== (editingRow.description_ar || '')) return true;
      if (fv('p-price') !== (editingRow.price || '')) return true;
      if (((q('#p-category') || {}).value || '') !== (editingRow.category_id || '')) return true;
      if ((parseInt(fv('p-sort'), 10) || 0) !== (editingRow.sort_order || 0)) return true;
      if (!!(q('#p-featured') || {}).checked !== !!editingRow.featured) return true;
      if (!!(q('#p-available') || {}).checked !== (editingRow.available !== false)) return true;
      return !!(editImageFile || removeImage);
    }
    // new product draft
    if (fv('p-name-en') || fv('p-name-ar') || fv('p-desc-en') || fv('p-desc-ar') || fv('p-price')) return true;
    if ((q('#p-category') || {}).value) return true;
    if (editImageFile) return true;
    if ((q('#p-featured') || {}).checked) return true;         // default is unchecked
    if (!(q('#p-available') || {}).checked) return true;       // default is checked
    return false;
  }

  function unmount() {
    mountToken++;                               // invalidate any still-in-flight mount()
    if (loadAbort) { try { loadAbort.abort(); } catch (e) {} loadAbort = null; }

    teardownFns.forEach(function (fn) { try { fn(); } catch (e) {} });
    teardownFns = [];

    // Drop the unsaved product overlay so the shared Preview shows the saved
    // catalog again. Do NOT touch Preview page / device / lang / view —
    // those persist across shell routes by design.
    try { if (ctx && ctx.preview) ctx.preview.clearCatalogDraft(); } catch (e) {}

    if (editImageObjUrl) {
      var dead = editImageObjUrl;
      editImageObjUrl = null;
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { try { URL.revokeObjectURL(dead); } catch (e) {} });
      });
    }

    menuReady = false;
    contextKey = '';
    editingId = null;
    editingRow = null;
    ctx = null;
    root = null;
  }

  return { mount: mount, unmount: unmount, isDirty: isDirty };
})();
