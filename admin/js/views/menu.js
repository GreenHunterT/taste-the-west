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

  // Admin interface i18n (1T). Owner-entered data is never translated.
  var I18N = window.AdminI18n;
  var t = I18N.t;
  var SORT = window.AdminSortable;   // drag-to-reorder + order persistence (1U)
  // An HTML-string attribute pair that stamps + pre-translates one element.
  function i18nAttr(key) { return ' data-i18n="' + key + '"' + (I18N.getLang() === 'ar' ? ' dir="rtl" lang="ar"' : ''); }

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
  var reorderBusy = false;     // a reorder write is in flight (1U)

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
    reorderBusy = false;
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
  function makeErrNote(key) {
    var p = document.createElement('p');
    p.className = 'field-hint';
    p.style.cssText = 'color:var(--amuted);padding:24px';
    I18N.set(p, key || 'menu.readOnly');
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
      '      <h1 class="admin-page-title" data-i18n="mw.items">Menu Items</h1>',
      '      <p class="admin-page-desc" data-i18n="menu.desc">Manage all products on your public menu. Edits preview instantly; they go live only after you Save.</p>',
      '    </div>',
      '    <button class="btn btn-primary" id="add-product-btn" type="button" data-i18n="menu.add">+ Add Item</button>',
      '  </div>',
      '  <p class="field-hint settings-view__hint--error" id="menu-error-note" hidden data-i18n="menu.readOnly">Menu is read-only — the restaurant could not be loaded. Reload the page.</p>',
      '',
      '  <div class="acard">',
      '    <div class="table-toolbar">',
      '      <div class="table-search">',
      '        <svg class="table-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>',
      '        <input type="search" id="table-search" placeholder="Search items…" data-i18n-placeholder="menu.search" />',
      '      </div>',
      '      <select id="cat-filter" style="width:auto"><option value="" data-i18n="menu.allCategories">All categories</option></select>',
      '    </div>',
      '    <p class="field-hint reorder-hint" id="menu-reorder-hint" data-i18n="order.menuHint">Drag ⠿ or use ↑ ↓ to reorder items within their category.</p>',
      '    <div id="products-table-wrap">',
      '      <div class="empty-state"><div class="empty-state-icon">🍕</div><h3 data-i18n="common.loading">Loading…</h3><p data-i18n="menu.loadingDesc">Fetching your menu items.</p></div>',
      '    </div>',
      '  </div>',
      '',
      '  <!-- Add / Edit Modal -->',
      '  <div class="modal-backdrop" id="product-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">',
      '    <div class="modal">',
      '      <div class="modal-header">',
      '        <h2 class="modal-title" id="modal-title" data-i18n="menu.modalAdd">Add Menu Item</h2>',
      '        <button class="modal-close" id="modal-close" type="button" aria-label="Close" data-i18n-aria-label="common.close">×</button>',
      '      </div>',
      '      <div class="modal-body">',
      '        <form id="product-form" novalidate>',
      '          <input type="hidden" id="product-id" />',
      '          <div class="form-row">',
      '            <div class="form-group">',
      '              <label for="p-name-ar" data-i18n="menu.nameAr">Name (Arabic) <span class="required">*</span></label>',
      '              <input type="text" id="p-name-ar" dir="rtl" placeholder="مارغريتا كلاسيك" required />',
      '            </div>',
      '            <div class="form-group">',
      '              <label for="p-name-en" data-i18n="menu.nameEn">Name (English) <span class="required">*</span></label>',
      '              <input type="text" id="p-name-en" placeholder="Classic Margherita" required />',
      '            </div>',
      '          </div>',
      '          <div class="form-row">',
      '            <div class="form-group">',
      '              <label for="p-desc-ar" data-i18n="menu.descAr">Description (Arabic)</label>',
      '              <textarea id="p-desc-ar" dir="rtl" placeholder="وصف المنتج…" rows="2"></textarea>',
      '            </div>',
      '            <div class="form-group">',
      '              <label for="p-desc-en" data-i18n="menu.descEn">Description (English)</label>',
      '              <textarea id="p-desc-en" placeholder="Product description…" rows="2"></textarea>',
      '            </div>',
      '          </div>',
      '          <div class="form-row">',
      '            <div class="form-group">',
      '              <label for="p-price" data-i18n="menu.price">Price (﷼) <span class="required">*</span></label>',
      '              <input type="text" id="p-price" placeholder="e.g. 39 or 18.5" data-i18n-placeholder="menu.pricePh" required />',
      '            </div>',
      '            <div class="form-group">',
      '              <label for="p-category" data-i18n="menu.category">Category</label>',
      '              <select id="p-category"><option value="" data-i18n="common.none">— None —</option></select>',
      '            </div>',
      '          </div>',
      '          <div class="form-group mb-2">',
      '            <label data-i18n="menu.image">Product Image <small data-i18n="menu.imageNote">(JPG · PNG · WebP · max 5 MB)</small></label>',
      '            <div class="img-upload-area" onclick="document.getElementById(\'p-image-file\').click()">',
      '              <input type="file" id="p-image-file" accept="image/jpeg,image/png,image/webp" />',
      '              <div class="img-upload-icon">📷</div>',
      '              <div class="img-upload-label" data-i18n-dir><strong data-i18n="upload.click">Click to upload</strong> <span data-i18n="upload.drag">or drag and drop</span></div>',
      '              <div class="img-upload-hint" data-i18n="menu.imageHint">600×450 px recommended</div>',
      '            </div>',
      '            <div style="margin-top:10px">',
      '              <img id="p-image-preview" class="img-preview" hidden alt="Product preview" data-i18n-alt="menu.imageAlt" />',
      '              <button type="button" id="p-image-remove" class="btn btn-danger btn-sm mt-1" hidden data-i18n="menu.removeImage">Remove image</button>',
      '            </div>',
      '          </div>',
      '          <div class="divider"></div>',
      '          <div class="toggle-row">',
      '            <div class="toggle-info"><strong data-i18n="menu.featured">Featured</strong><span data-i18n="menu.featuredDesc">Shows on the homepage spotlight</span></div>',
      '            <label class="toggle"><input type="checkbox" id="p-featured" /><span class="toggle-track"></span></label>',
      '          </div>',
      '          <div class="toggle-row">',
      '            <div class="toggle-info"><strong data-i18n="menu.available">Available</strong><span data-i18n="menu.availableDesc">Visible on the public menu (uncheck to hide temporarily)</span></div>',
      '            <label class="toggle"><input type="checkbox" id="p-available" checked /><span class="toggle-track"></span></label>',
      '          </div>',
      '        </form>',
      '      </div>',
      '      <div class="modal-footer">',
      '        <button class="btn btn-ghost btn-sm" id="mn-view-preview" type="button" data-i18n="common.viewInPreview">View in Preview</button>',
      '        <button class="btn btn-ghost" id="modal-cancel" type="button" data-i18n="common.cancel">Cancel</button>',
      '        <button class="btn btn-primary" id="modal-save" type="button" data-i18n="menu.saveItem">Save Item</button>',
      '      </div>',
      '    </div>',
      '  </div>',
      '',
      '  <!-- Confirm Delete Dialog -->',
      '  <div class="modal-backdrop" id="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">',
      '    <div class="confirm-dialog">',
      '      <h2 class="confirm-title" id="confirm-title" data-i18n="menu.deleteTitle">Delete item?</h2>',
      '      <p class="confirm-msg" id="confirm-msg" data-i18n="menu.deleteMsg">This will permanently remove the item from your menu. This cannot be undone.</p>',
      '      <div class="confirm-actions">',
      '        <button class="btn btn-ghost" id="confirm-cancel" type="button" data-i18n="common.cancel">Cancel</button>',
      '        <button class="btn btn-danger" id="confirm-ok" type="button" data-i18n="common.delete">Delete</button>',
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
      allCategories = SORT.sortRows(cRes.ok ? await cRes.json() : []);
      allProducts   = sortProducts(pRes.ok ? await pRes.json() : []);
      populateCategoryControls();
      renderTable();
      if (!pRes.ok || !cRes.ok) showToast(t('menu.someNotLoaded'), 'warning', 5000);
    } catch (e) {
      if (e && e.name === 'AbortError') return;   // unmounted / superseded mid-fetch
      console.error('[menu view] load failed:', e);
      var wrap = q('#products-table-wrap');
      if (wrap) { wrap.textContent = ''; wrap.appendChild(makeErrNote('menu.loadFailed')); }
    } finally {
      loadAbort = null;
    }
  }

  function populateCategoryControls() {
    var filter = q('#cat-filter');
    if (filter) {
      var cur = filter.value;
      filter.textContent = '';
      var allOpt = opt('', ''); I18N.set(allOpt, 'menu.allCategories');
      filter.appendChild(allOpt);
      allCategories.forEach(function (c) { filter.appendChild(opt(c.id, c.name_en || c.name_ar || '—')); });
      filter.value = cur;
    }
    var sel = q('#p-category');
    if (sel) {
      var curS = sel.value;
      sel.textContent = '';
      var noneOpt = opt('', ''); I18N.set(noneOpt, 'common.none');
      sel.appendChild(noneOpt);
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
    var hint = q('#menu-reorder-hint');
    if (hint) I18N.set(hint, qtext ? 'order.searchHint' : 'order.menuHint');

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
        '<h3' + i18nAttr(allProducts.length ? 'menu.noResults' : 'menu.empty') + '>' + esc(t(allProducts.length ? 'menu.noResults' : 'menu.empty')) + '</h3>' +
        '<p' + i18nAttr(allProducts.length ? 'menu.noResultsDesc' : 'menu.emptyDesc') + '>' + esc(t(allProducts.length ? 'menu.noResultsDesc' : 'menu.emptyDesc')) + '</p>' +
        (allProducts.length ? '' : '<button class="btn btn-primary" id="add-product-btn-empty" type="button"' + i18nAttr('menu.add') + '>' + esc(t('menu.add')) + '</button>') +
        '</div>';
      return;
    }

    var PLACEHOLDER = '../assets/images/product-placeholder.svg';
    var reorderOk = canReorder();
    var lastGroup = null;
    var rows = list.map(function (p) {
      var cat = p.categories;
      var catName = cat ? cat.name_en : '—';
      var imgSrc = p.image_url || PLACEHOLDER;
      var avBadge = p.available
        ? '<span class="badge badge-success"' + i18nAttr('menu.badgeActive') + '>' + esc(t('menu.badgeActive')) + '</span>'
        : '<span class="badge badge-muted"' + i18nAttr('menu.badgeHidden') + '>' + esc(t('menu.badgeHidden')) + '</span>';
      var ftBadge = p.featured ? '<span class="badge badge-gold" style="margin-left:4px"' + i18nAttr('menu.badgeFeatured') + '>' + esc(t('menu.badgeFeatured')) + '</span>' : '';
      var toggleKey = p.available ? 'menu.hide' : 'menu.show';
      // Category group header (All categories view) — items reorder WITHIN it.
      var g = groupKey(p);
      var head = '';
      if (!qcat && g !== lastGroup) {
        var gc = catById(g);
        head = '<tr class="menu-group-row"><td colspan="7">' +
          (gc ? '<strong>' + esc(gc.name_en || '—') + '</strong> <span>' + esc(gc.name_ar || '') + '</span>'
              : '<strong' + i18nAttr('menu.uncategorized') + '>' + esc(t('menu.uncategorized')) + '</strong>') +
          '</td></tr>';
      }
      lastGroup = g;
      // ↑ / ↓ bounds come from the FULL category group, never the visible subset.
      var full = groupRows(g);
      var pos = full.indexOf(p);
      var dis = function (cond) { return (!reorderOk || cond) ? ' disabled' : ''; };
      var handleAttrs = ' title="' + esc(t('order.handle')) + '" aria-label="' + esc(t('order.handle')) + '" data-i18n-title="order.handle" data-i18n-aria-label="order.handle"';
      return head +
        '<tr data-id="' + esc(p.id) + '" data-group="' + esc(g) + '">' +
          '<td class="reorder-cell"><div class="reorder-ctl">' +
            '<button type="button" class="drag-handle" data-role="drag" data-pid="' + esc(p.id) + '"' + handleAttrs + dis(full.length < 2) + '>⠿</button>' +
            '<span class="reorder-arrows">' +
              '<button type="button" class="reorder-btn" data-role="up" data-pid="' + esc(p.id) + '" title="' + esc(t('common.moveUp')) + '" aria-label="' + esc(t('common.moveUp')) + '" data-i18n-title="common.moveUp" data-i18n-aria-label="common.moveUp"' + dis(pos <= 0) + '>↑</button>' +
              '<button type="button" class="reorder-btn" data-role="down" data-pid="' + esc(p.id) + '" title="' + esc(t('common.moveDown')) + '" aria-label="' + esc(t('common.moveDown')) + '" data-i18n-title="common.moveDown" data-i18n-aria-label="common.moveDown"' + dis(pos === -1 || pos >= full.length - 1) + '>↓</button>' +
            '</span>' +
          '</div></td>' +
          '<td><img src="' + esc(imgSrc) + '" class="product-thumb" alt="" onerror="this.src=\'' + PLACEHOLDER + '\'" /></td>' +
          '<td class="product-name-cell"><strong>' + esc(p.name_en) + '</strong><span>' + esc(p.name_ar) + '</span></td>' +
          '<td>' + esc(catName) + '</td>' +
          '<td>' + esc(p.price) + '</td>' +
          '<td>' + avBadge + ftBadge + '</td>' +
          '<td><div class="row-actions">' +
            '<button class="btn btn-ghost btn-sm btn-edit" type="button" data-id="' + esc(p.id) + '" title="' + esc(t('common.edit')) + '" aria-label="' + esc(t('common.edit')) + '" data-i18n-title="common.edit" data-i18n-aria-label="common.edit">✏</button>' +
            '<button class="btn btn-ghost btn-sm btn-toggle" type="button" data-id="' + esc(p.id) + '" data-available="' + (p.available ? 'true' : 'false') + '" title="' + esc(t(toggleKey)) + '" aria-label="' + esc(t(toggleKey)) + '" data-i18n-title="' + toggleKey + '" data-i18n-aria-label="' + toggleKey + '">' + (p.available ? '👁' : '🚫') + '</button>' +
            '<button class="btn btn-danger btn-sm btn-delete" type="button" data-id="' + esc(p.id) + '" data-name="' + esc(p.name_en) + '" title="' + esc(t('common.delete')) + '" aria-label="' + esc(t('common.delete')) + '" data-i18n-title="common.delete" data-i18n-aria-label="common.delete">🗑</button>' +
          '</div></td>' +
        '</tr>';
    }).join('');

    wrap.innerHTML =
      '<table class="data-table"><thead><tr>' +
      '<th class="reorder-cell"></th>' +
      '<th style="width:52px"></th>' +
      '<th' + i18nAttr('menu.col.name') + '>' + esc(t('menu.col.name')) + '</th>' +
      '<th' + i18nAttr('menu.col.category') + '>' + esc(t('menu.col.category')) + '</th>' +
      '<th' + i18nAttr('menu.col.price') + '>' + esc(t('menu.col.price')) + '</th>' +
      '<th' + i18nAttr('menu.col.status') + '>' + esc(t('menu.col.status')) + '</th>' +
      '<th style="width:130px"' + i18nAttr('menu.col.actions') + '>' + esc(t('menu.col.actions')) + '</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>';
  }

  // =================================================================
  //  Item order  (1U) — products.sort_order = position WITHIN the category.
  //  Canonical Admin order = category order, then item order (the same rule
  //  the public site uses). Reorders persist immediately, like the existing
  //  availability / delete row actions; nothing is written while dragging.
  // =================================================================
  function catById(id) {
    for (var i = 0; i < allCategories.length; i++) if (allCategories[i].id === id) return allCategories[i];
    return null;
  }
  // '' = uncategorized (no category / a category that no longer exists).
  function groupKey(p) { return (p && p.category_id && catById(p.category_id)) ? p.category_id : ''; }
  function sortProducts(list) {
    var idx = {};
    allCategories.forEach(function (c, i) { idx[c.id] = i; });
    return (list || []).slice().sort(function (a, b) {
      var ga = Object.prototype.hasOwnProperty.call(idx, a.category_id) ? idx[a.category_id] : Infinity;
      var gb = Object.prototype.hasOwnProperty.call(idx, b.category_id) ? idx[b.category_id] : Infinity;
      if (ga !== gb) return ga < gb ? -1 : 1;
      return SORT.compare(a, b);
    });
  }
  // The FULL ordered item list of one category — hidden (unavailable) items
  // and items filtered out by search are always included.
  function groupRows(key) { return allProducts.filter(function (p) { return groupKey(p) === key; }); }

  // Position for a product being saved into `catId`: an edit that stays in
  // its category keeps its place; a new product, or one moved to another
  // category, goes to the END of the destination category.
  function draftSortOrder(catId) {
    catId = catId || '';
    if (editingRow && (editingRow.category_id || '') === catId) return editingRow.sort_order == null ? null : editingRow.sort_order;
    var key = catById(catId) ? catId : '';
    return SORT.nextOrder(groupRows(key).filter(function (p) { return !editingRow || p.id !== editingRow.id; }));
  }

  // Search narrows the table to an arbitrary subset, so reordering is paused
  // while it is active (a clear hint says why). A category filter is safe: it
  // shows that category's complete list.
  function searchActive() { return !!(q('#table-search') && q('#table-search').value.trim()); }
  function canReorder() { return menuReady && !reorderBusy && !searchActive(); }

  function moveProduct(id, dir, refocus) {
    if (!canReorder()) return;
    var p = allProducts.find(function (x) { return x.id === id; });
    if (!p) return;
    var key = groupKey(p);
    var ids = groupRows(key).map(function (x) { return x.id; });
    var i = ids.indexOf(id), j = i + dir;
    if (i === -1 || j < 0 || j >= ids.length) return;
    ids.splice(i, 1);
    ids.splice(j, 0, id);
    reorderGroup(key, ids, id, refocus);
  }

  function refocusRow(id, role) {
    if (!role || !id) return;
    var tr = q('#products-table-wrap tr[data-id="' + CSS.escape(id) + '"]');
    if (!tr) return;
    var b = tr.querySelector('[data-role="' + role + '"]:not([disabled])') || tr.querySelector('[data-role="drag"]:not([disabled])');
    if (b) softFocus(b);
  }

  async function reorderGroup(key, orderedIds, movedId, refocus) {
    if (!canReorder()) { renderTable(); return; }
    var full = groupRows(key);
    var byId = {};
    full.forEach(function (p) { byId[p.id] = p; });
    // Only ever apply an order that covers the WHOLE category exactly — a
    // partial/filtered subset could otherwise scramble hidden items.
    if (orderedIds.length !== full.length || orderedIds.some(function (id) { return !byId[id]; })) { renderTable(); return; }

    var ordered = orderedIds.map(function (id) { return byId[id]; });
    var changes = SORT.plan(ordered);
    if (!changes.length) { renderTable(); return; }
    var snapshot = full.map(function (p) { return { row: p, sort_order: p.sort_order }; });

    reorderBusy = true;
    ordered.forEach(function (p, i) { p.sort_order = i; });
    allProducts = sortProducts(allProducts);
    renderTable();
    try {
      var res = await SORT.persist(ctx.db, 'products', changes);
      if (!ctx) return;                                  // unmounted mid-save
      if (!res.ok) throw res.error;
      showToast(t('order.saved'), 'success', 1800);
      if (ctx.preview) ctx.preview.refreshCatalog({ focus: { type: 'product', id: movedId } });
    } catch (err) {
      console.error('[menu view] reorder failed:', err);
      snapshot.forEach(function (s) { s.row.sort_order = s.sort_order; });
      allProducts = sortProducts(allProducts);
      showToast(t('order.failed'), 'error', 5500);
      if (ctx && typeof ctx.sound === 'function') ctx.sound('warning');
      reorderBusy = false;
      renderTable();
      await loadAll();                                   // re-sync with the database's truth
      if (ctx && ctx.preview) ctx.preview.refreshCatalog();
    } finally {
      reorderBusy = false;
      if (root) { renderTable(); refocusRow(movedId, refocus); }
    }
  }

  // Delegated — one listener for the whole table, survives every re-render.
  function onTableClick(e) {
    var addEmpty = e.target.closest('#add-product-btn-empty');
    if (addEmpty) { openAddModal(); return; }
    var mv = e.target.closest('button[data-role="up"], button[data-role="down"]');
    if (mv) { moveProduct(mv.dataset.pid, mv.dataset.role === 'up' ? -1 : 1, mv.dataset.role); return; }
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
      sort_order: draftSortOrder((q('#p-category') || {}).value || ''),
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
  function setModalTitle(key) { var el = q('#modal-title'); if (el && key) I18N.set(el, key); }
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
  function showModal(titleKey) {
    setModalTitle(titleKey);
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
    showModal('menu.modalAdd');
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
    var ft = q('#p-featured'); if (ft) ft.checked = !!p.featured;
    var av = q('#p-available'); if (av) av.checked = p.available !== false;
    if (p.image_url) { var prev = q('#p-image-preview'); if (prev) { prev.src = p.image_url; prev.hidden = false; } }
    updateImageRemoveBtn();
    contextKey = '';
    pushProductDraft();                           // baseline overlay == saved values (no visible change)
    applyProductContext(id, 'en', true);          // Menu + EN + scroll/highlight this card
    showModal('menu.modalEdit');
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
      showToast(t('menu.notLoadedSave'), 'error');
      return;
    }
    var nameEn = fv('p-name-en'), nameAr = fv('p-name-ar'), price = fv('p-price');
    if (!nameEn || !nameAr) { showToast(t('menu.nameRequired'), 'error'); return; }
    if (!price) { showToast(t('menu.priceRequired'), 'error'); return; }

    var saveBtn = q('#modal-save');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<span class="btn-spinner"></span> '; I18N.set(saveBtn, 'common.saving'); }

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
        sort_order:     draftSortOrder(catVal),   // same category → kept; new / moved → end of category (1U)
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

      showToast(t(editId ? 'menu.updated' : 'menu.added'), 'success');
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
      showToast(friendlyDbError(err, t('common.saveFailed')), 'error', 5500);
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = ''; I18N.set(saveBtn, 'menu.saveItem'); }
    }
  }

  // =================================================================
  //  Availability toggle (row action — persists immediately, like legacy)
  // =================================================================
  async function toggleAvailable(id, currentlyAvailable) {
    var res = await ctx.db.from('products').update({ available: !currentlyAvailable }).eq('id', id);
    if (res.error) { console.error('[menu view] availability toggle failed:', res.error); showToast(friendlyDbError(res.error, t('common.updateFailed')), 'error', 5500); return; }
    showToast(t(currentlyAvailable ? 'menu.hiddenToast' : 'menu.visibleToast'), 'success');
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
    // `name` is owner data — passed as a plain var (textContent, never HTML).
    if (msg) I18N.set(msg, 'menu.deleteMsgNamed', { name: name || t('menu.thisItem') });
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
    if (res.error) { console.error('[menu view] delete failed:', res.error); showToast(friendlyDbError(res.error, t('common.deleteFailed')), 'error', 5500); return; }

    // Row is gone — best-effort remove its image. A Storage failure here must
    // not undo the delete.
    await deleteFromStorage(img);
    showToast(t('menu.deleted'), 'success');

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
    if (wrap) {
      on(wrap, 'click', onTableClick);
      // Drag inside ONE category group only — rows of other categories (and
      // the group header rows) are never valid drop positions (1U).
      teardownFns.push(SORT.attach(wrap, {
        item: 'tr[data-id]',
        handle: '[data-role="drag"]',
        id: function (n) { return n.dataset.id; },
        group: function (n) { return n.dataset.group || ''; },
        disabled: function () { return !canReorder(); },
        onDrop: function (g, ids, movedId) { reorderGroup(g, ids, movedId, null); },
        onKey: function (n, dir) { moveProduct(n.dataset.id, dir, 'drag'); },
      }));
    }

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
    I18N.apply(root);

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
    renderTable();                               // enable the reorder controls now that the list is live

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
