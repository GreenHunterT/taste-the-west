// =================================================================
//  Admin Shell — Categories view  (milestone 1I-E)
//
//  The real Categories editor. Lifecycle: mount(ctx, root) / unmount() /
//  isDirty(). Renders ONLY the left-side editing UI (Add form + list with
//  inline rename / reorder / delete); the shared Live Preview belongs to the
//  shell (ctx.preview). This view never auths, never loads the restaurant
//  identity, never mounts a preview — it consumes ctx.restaurant /
//  ctx.restaurantLoadState / ctx.db / ctx.preview.
//
//  RENAME is an UPDATE by id — slug + id preserved, product relationships
//  untouched. Unsaved name edits reach the Preview through
//  ctx.preview.setCatalogDraft({ categories: [...] }) — a whitelisted overlay,
//  never a DB write. This module is authoritative; the old standalone
//  admin/categories.html now redirects into the Menu workspace at
//  /admin/#menu&section=categories, where this view is the Categories tab.
// =================================================================

window.AdminViews = window.AdminViews || {};

window.AdminViews.categories = (function () {
  'use strict';

  var CAT_FIELD_LANG = { 'cat-name-en': 'en', 'cat-name-ar': 'ar' };

  // Admin interface i18n (1T). Owner-entered category names are never translated.
  var I18N = window.AdminI18n;
  var t = I18N.t;
  var SORT = window.AdminSortable;   // drag-to-reorder + order persistence (1U)

  // ── Per-mount state (reset by resetState() at the top of mount()) ──
  var ctx, root;
  var mountToken = 0;
  var teardownFns = [];
  var catsReady = false;
  var savingAdd = false;
  var savingEdit = false;
  var reordering = false;
  var contextKey = '';
  var RID = '';

  var categories = [];
  var editingCatId = null;      // real category id being inline-renamed | null
  var addDraftId = null;        // 'draftcat:<token>' while the Add form has focus | null
  var pendingDeleteId = null;
  var loadAbort = null;

  function resetState() {
    teardownFns = [];
    catsReady = false;
    savingAdd = false;
    savingEdit = false;
    reordering = false;
    contextKey = '';
    RID = '';
    categories = [];
    editingCatId = null;
    addDraftId = null;
    pendingDeleteId = null;
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
  function fvRole(role) {
    // role is always a hard-coded literal ('edit-en' / 'edit-ar') — no interpolation of user input.
    var e = q('#cat-list [data-role="' + role + '"]');
    return e ? String(e.value == null ? '' : e.value).trim() : '';
  }
  function softFocus(node) {
    if (!node) return;
    try { node.focus({ preventScroll: true }); } catch (e) { node.focus(); }
  }
  function uniqueToken() {
    try { if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID(); } catch (e) {}
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  // Same as el(), but the text is an Admin string key (stamped → live-switchable).
  function elT(tag, cls, key) {
    var n = el(tag, cls);
    I18N.set(n, key);
    return n;
  }
  function mkBtn(cls, text, data) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = text;
    if (data) Object.keys(data).forEach(function (k) { b.dataset[k] = String(data[k]); });
    return b;
  }
  // Icon-only button (↑ / ↓ / 🗑): the glyph stays, the accessible name is translated.
  function mkIconBtn(cls, glyph, labelKey, data) {
    var b = mkBtn(cls, glyph, data);
    I18N.setAttr(b, 'aria-label', labelKey);
    I18N.setAttr(b, 'title', labelKey);
    return b;
  }
  function makeErrLi(key) {
    var li = el('li', 'empty-state');
    li.style.padding = '28px 0';
    li.appendChild(elT('p', 'field-hint', key || 'cat.readOnly'));
    return li;
  }

  // ── Internal slug generation (owner never types or sees a slug) ──
  // Deterministic: NFKD-fold accents to ASCII, lowercase, then any run of
  // non-[a-z0-9] becomes one "-", trimmed. Empty result (e.g. a non-Latin
  // English name) falls back to "category".
  function slugifyCategoryName(name) {
    var s = String(name == null ? '' : name);
    try { s = s.normalize('NFKD').replace(/[̀-ͯ]/g, ''); } catch (e) { /* older engines */ }
    s = s.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')   // any run of non-alphanumerics -> a single hyphen
      .replace(/^-+|-+$/g, '');      // trim leading / trailing hyphens
    return s || 'category';
  }
  // First free slug: base, then base-2, base-3, … checked against the already
  // loaded category collection. No network loop.
  function makeUniqueSlug(base, existing) {
    var used = {};
    (existing || []).forEach(function (c) { if (c && c.slug) used[String(c.slug).toLowerCase()] = 1; });
    if (!used[base]) return base;
    for (var i = 2; i < 5000; i++) {
      if (!used[base + '-' + i]) return base + '-' + i;
    }
    return base + '-' + uniqueToken().slice(0, 6);   // pathological fallback
  }
  function isSlugConflict(err) {
    if (!err) return false;
    if (err.code === '23505') return true;            // Postgres unique_violation
    var m = String(err.message || '').toLowerCase();
    return m.indexOf('duplicate') !== -1 || m.indexOf('unique') !== -1 || m.indexOf('slug') !== -1;
  }
  function catLangForField(node) {
    if (!node) return '';
    if (node.id && Object.prototype.hasOwnProperty.call(CAT_FIELD_LANG, node.id)) return CAT_FIELD_LANG[node.id];
    var role = node.getAttribute && node.getAttribute('data-role');
    if (role === 'edit-en') return 'en';
    if (role === 'edit-ar') return 'ar';
    return '';
  }

  // =================================================================
  //  Markup  (left side only — Add form + list + delete confirm)
  // =================================================================
  function viewMarkup() {
    return [
      '<div class="categories-view">',
      '  <div class="admin-page-header">',
      '    <div>',
      '      <h1 class="admin-page-title" data-i18n="mw.categories">Categories</h1>',
      '      <p class="admin-page-desc" data-i18n="cat.desc">Categories let customers filter your menu. Renames preview live and go public when you Save.</p>',
      '    </div>',
      '  </div>',
      '  <p class="field-hint settings-view__hint--error" id="cat-error-note" hidden data-i18n="cat.readOnly">Categories are read-only — the restaurant could not be loaded. Reload the page.</p>',
      '',
      '  <div class="acard mb-3">',
      '    <div class="acard-title" data-i18n="cat.addTitle">Add Category</div>',
      '    <form id="add-cat-form" novalidate>',
      '      <div class="form-row">',
      '        <div class="form-group">',
      '          <label for="cat-name-en" data-i18n="cat.nameEn">Category Name (English) <span class="required">*</span></label>',
      '          <input type="text" id="cat-name-en" placeholder="Pizza" required />',
      '        </div>',
      '        <div class="form-group">',
      '          <label for="cat-name-ar" data-i18n="cat.nameAr">Category Name (Arabic) <span class="required">*</span></label>',
      '          <input type="text" id="cat-name-ar" dir="rtl" placeholder="بيتزا" required />',
      '        </div>',
      '      </div>',
      '      <button type="submit" class="btn btn-primary" id="add-cat-btn" data-i18n="cat.addTitle">Add Category</button>',
      '    </form>',
      '  </div>',
      '',
      '  <div class="acard">',
      '    <div class="acard-title" data-i18n="cat.existing">Existing Categories <small style="text-transform:none;font-weight:400;color:var(--amuted)" data-i18n="cat.existingHint">(Edit to rename · ↑ ↓ to reorder)</small></div>',
      '    <ul class="cat-list" id="cat-list">',
      '      <li class="empty-state" style="padding:32px 0"><div class="empty-state-icon">📋</div><h3 data-i18n="common.loading">Loading…</h3><p data-i18n="cat.loadingDesc">Fetching your categories.</p></li>',
      '    </ul>',
      '  </div>',
      '',
      '  <div class="modal-backdrop" id="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="cat-confirm-title">',
      '    <div class="confirm-dialog">',
      '      <h2 class="confirm-title" id="cat-confirm-title" data-i18n="cat.deleteTitle">Delete category?</h2>',
      '      <p class="confirm-msg" id="confirm-msg" data-i18n="cat.deleteMsg">Products in this category will have their category cleared but will not be deleted.</p>',
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
  //  Data load  (supabase-js — it manages its own auth token)
  // =================================================================
  async function loadAll() {
    if (!ctx || ctx.restaurantLoadState !== 'ready') return;
    if (loadAbort) { try { loadAbort.abort(); } catch (e) {} }
    loadAbort = (typeof AbortController === 'function') ? new AbortController() : null;
    try {
      var query = ctx.db.from('categories').select('*').eq('restaurant_id', RID).order('sort_order');
      if (loadAbort && typeof query.abortSignal === 'function') query = query.abortSignal(loadAbort.signal);
      var res = await query;
      if (res.error) throw new Error(res.error.message);
      // Canonical order (sort_order → created_at → id): ties / legacy nulls
      // render deterministically, exactly like the public site (1U).
      categories = SORT.sortRows(res.data || []);
      render();
    } catch (err) {
      var msg = String((err && err.message) || err || '');
      if ((err && err.name === 'AbortError') || msg.toLowerCase().indexOf('abort') !== -1) return;
      console.error('[categories view] load failed:', err);
      var listEl = q('#cat-list');
      if (listEl) { listEl.textContent = ''; listEl.appendChild(makeErrLi('cat.loadFailed')); }
    } finally {
      loadAbort = null;
    }
  }

  // =================================================================
  //  List rendering  (DOM-built — owner names never touch innerHTML)
  // =================================================================
  function render() {
    var list = q('#cat-list');
    if (!list) return;
    list.textContent = '';
    if (!categories.length) {
      var li = el('li', 'empty-state');
      li.style.padding = '32px 0';
      li.appendChild(el('div', 'empty-state-icon', '📋'));
      li.appendChild(elT('h3', null, 'cat.empty'));
      li.appendChild(elT('p', null, 'cat.emptyDesc'));
      list.appendChild(li);
      return;
    }
    categories.forEach(function (c, idx) {
      list.appendChild(c.id === editingCatId ? buildEditItem(c) : buildRowItem(c, idx));
    });
  }

  function buildRowItem(c, idx) {
    var li = el('li', 'cat-item');
    li.dataset.id = c.id;
    // Real drag handle (1U): pointer drag (mouse / touch / pen) or ArrowUp /
    // ArrowDown when focused. Disabled while a rename is open or a reorder saves.
    var handle = mkIconBtn('cat-drag-handle', '⠿', 'order.handle', { role: 'drag' });
    handle.disabled = !canReorder();
    li.appendChild(handle);

    var info = el('div', 'cat-info');
    info.appendChild(el('div', 'cat-name-en', c.name_en || ''));
    info.appendChild(el('div', 'cat-name-ar', c.name_ar || ''));
    li.appendChild(info);

    var actions = el('div', 'row-actions');
    var editBtn = mkBtn('btn btn-ghost btn-sm', '', { role: 'edit', id: c.id });
    I18N.set(editBtn, 'common.edit');
    actions.appendChild(editBtn);
    var up = mkIconBtn('btn btn-ghost btn-sm', '↑', 'common.moveUp', { role: 'up', idx: idx });
    if (idx === 0 || !canReorder()) up.disabled = true;
    var down = mkIconBtn('btn btn-ghost btn-sm', '↓', 'common.moveDown', { role: 'down', idx: idx });
    if (idx === categories.length - 1 || !canReorder()) down.disabled = true;
    actions.appendChild(up);
    actions.appendChild(down);
    actions.appendChild(mkIconBtn('btn btn-danger btn-sm', '🗑', 'common.delete', { role: 'delete', id: c.id, name: c.name_en || '' }));
    li.appendChild(actions);
    return li;
  }

  function buildEditItem(c) {
    var li = el('li', 'cat-item is-editing');
    li.dataset.id = c.id;

    var info = el('div', 'cat-info');
    var row = el('div', 'form-row');
    row.appendChild(field('cat.nameEn', 'edit-en', c.name_en || '', false));
    row.appendChild(field('cat.nameAr', 'edit-ar', c.name_ar || '', true));
    info.appendChild(row);
    li.appendChild(info);

    var actions = el('div', 'row-actions');
    var saveBtn = mkBtn('btn btn-primary btn-sm', '', { role: 'cat-save', id: c.id });
    I18N.set(saveBtn, 'common.save');
    var cancelBtn = mkBtn('btn btn-ghost btn-sm', '', { role: 'cat-cancel' });
    I18N.set(cancelBtn, 'common.cancel');
    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);
    li.appendChild(actions);
    return li;
  }
  function field(labelKey, role, value, rtl) {
    var g = el('div', 'form-group');
    g.appendChild(elT('label', null, labelKey));
    var i = document.createElement('input');
    i.type = 'text';
    i.dataset.role = role;
    i.value = value == null ? '' : String(value);
    if (rtl) i.dir = 'rtl';
    g.appendChild(i);
    return g;
  }

  // =================================================================
  //  Context-aware Preview  (per-category; reuses the generic protocol)
  // =================================================================
  function applyCategoryContext(id, lang, force) {
    if (!ctx || ctx.restaurantLoadState !== 'ready' || !id) return;
    var key = 'menu|category:' + id + '|' + (lang || '');
    if (!force && key === contextKey) return;
    contextKey = key;
    if (lang && ctx.preview.getState().lang !== lang) ctx.preview.setLanguage(lang);
    ctx.preview.showPage('menu', { focus: { type: 'category', id: id } });
  }

  // =================================================================
  //  Unsaved category draft → Preview catalog overlay
  // =================================================================
  function ensureAddDraft() {
    if (!addDraftId) addDraftId = 'draftcat:' + uniqueToken();
  }
  function pushCategoryDraft() {
    if (!catsReady || !ctx || ctx.restaurantLoadState !== 'ready') return;
    var rows = [];
    if (editingCatId) {
      rows.push({ id: editingCatId, isDraft: false, patch: { name_en: fvRole('edit-en'), name_ar: fvRole('edit-ar') } });
    }
    if (addDraftId) {
      rows.push({ id: addDraftId, isDraft: true, patch: { name_en: fv('cat-name-en'), name_ar: fv('cat-name-ar') } });
    }
    ctx.preview.setCatalogDraft({ categories: rows });
  }

  function onAddField(e) {
    if (!catsReady) return;
    var id = e.target && e.target.id;
    if (id !== 'cat-name-en' && id !== 'cat-name-ar') return;
    ensureAddDraft();
    pushCategoryDraft();   // temp category enters the overlay FIRST (so the tab exists)
    applyCategoryContext(addDraftId, catLangForField(e.target));   // then Menu + lang + highlight it
  }
  function onListField(e) {
    if (!catsReady || !editingCatId) return;
    var role = e.target && e.target.getAttribute && e.target.getAttribute('data-role');
    if (role !== 'edit-en' && role !== 'edit-ar') return;
    pushCategoryDraft();
    applyCategoryContext(editingCatId, role === 'edit-ar' ? 'ar' : 'en');
  }

  // =================================================================
  //  Inline rename  (UPDATE by id — slug + id preserved)
  // =================================================================
  function enterCatEdit(id) {
    if (!catsReady) return;
    editingCatId = id;
    render();
    softFocus(q('#cat-list [data-role="edit-en"]'));
    contextKey = '';
    pushCategoryDraft();
    applyCategoryContext(id, 'en', true);
  }
  function cancelCatEdit() {
    editingCatId = null;
    contextKey = '';
    render();
    if (ctx && ctx.preview) ctx.preview.clearCatalogDraft();
  }
  async function saveCatEdit(id) {
    if (savingEdit) return;
    var nameEn = fvRole('edit-en'), nameAr = fvRole('edit-ar');
    if (!nameEn || !nameAr) { showToast(t('cat.bothRequired'), 'error'); return; }
    savingEdit = true;
    var btn = q('#cat-list [data-role="cat-save"]');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="btn-spinner"></span>'; }
    try {
      // UPDATE the existing row by id. Slug and id are deliberately NOT changed —
      // renaming must never orphan products that reference category_id (§8).
      var res = await ctx.db.from('categories').update({ name_en: nameEn, name_ar: nameAr }).eq('id', id);
      if (res.error) throw new Error(res.error.message);
      if (!ctx) return;                       // unmounted mid-save
      var row = categories.find(function (c) { return c.id === id; });
      if (row) { row.name_en = nameEn; row.name_ar = nameAr; }
      showToast(t('cat.renamed'), 'success');
      if (ctx && typeof ctx.sound === 'function') ctx.sound('success');
      editingCatId = null;
      contextKey = '';
      render();
      if (ctx.preview) {
        ctx.preview.clearCatalogDraft();
        ctx.preview.refreshCatalog({ focus: { type: 'category', id: id } });
      }
    } catch (err) {
      console.error('[categories view] rename failed:', err);
      showToast(friendlyDbError(err, t('cat.renameFailed')), 'error', 5500);
    } finally {
      savingEdit = false;
      var b2 = q('#cat-list [data-role="cat-save"]');
      if (b2) { b2.disabled = false; b2.textContent = ''; I18N.set(b2, 'common.save'); }
    }
  }

  // =================================================================
  //  Add category
  // =================================================================
  async function addCategory(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (savingAdd || !catsReady) return;
    var nameEn = fv('cat-name-en'), nameAr = fv('cat-name-ar');
    if (!nameEn) { showToast(t('cat.enRequired'), 'error'); return; }
    if (!nameAr) { showToast(t('cat.arRequired'), 'error'); return; }

    // Slug is internal: generated from the English name, made unique against the
    // already-loaded list. The owner never types or resolves it.
    var slugBase = slugifyCategoryName(nameEn);

    savingAdd = true;
    var btn = q('#add-cat-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="btn-spinner"></span>'; }
    try {
      var res = await ctx.db.from('categories').insert({
        restaurant_id: RID, slug: makeUniqueSlug(slugBase, categories),
        name_en: nameEn, name_ar: nameAr, sort_order: SORT.nextOrder(categories),   // appended at the end (1U)
      }).select('id');
      if (res.error && isSlugConflict(res.error)) {
        // Extremely rare cross-tab race — resolve it ourselves, never ask the owner.
        res = await ctx.db.from('categories').insert({
          restaurant_id: RID, slug: slugBase + '-' + uniqueToken().slice(0, 6),
          name_en: nameEn, name_ar: nameAr, sort_order: SORT.nextOrder(categories),
        }).select('id');
      }
      if (res.error) throw new Error(res.error.message);
      if (!ctx) return;                       // unmounted mid-save
      var newId = (res.data && res.data[0] && res.data[0].id) || null;

      showToast(t('cat.added'), 'success');
      if (ctx && typeof ctx.sound === 'function') ctx.sound('success');
      var f = q('#add-cat-form'); if (f) f.reset();
      addDraftId = null;
      contextKey = '';
      await loadAll();
      if (!ctx || !ctx.preview) return;
      ctx.preview.clearCatalogDraft();
      if (newId) ctx.preview.refreshCatalog({ focus: { type: 'category', id: newId } });
      else ctx.preview.refreshCatalog();
    } catch (err) {
      console.error('[categories view] add failed:', err);
      showToast(friendlyDbError(err, t('cat.addFailed')), 'error', 5500);
    } finally {
      savingAdd = false;
      var b2 = q('#add-cat-btn');
      if (b2) { b2.disabled = false; b2.textContent = ''; I18N.set(b2, 'cat.addTitle'); }
    }
  }

  // =================================================================
  //  Reorder  (persists immediately — same model as before 1U; ↑ / ↓ and
  //  drag share ONE path). Optimistic: the new order shows at once, only the
  //  rows whose sort_order changes are written, and on failure the previous
  //  order is restored locally AND re-read from the database so the list and
  //  the DB never disagree.
  // =================================================================
  function canReorder() { return catsReady && !reordering && !editingCatId; }

  // refocus: 'drag' | 'up' | 'down' — which control of the moved row gets
  // keyboard focus back after the list re-renders (keyboard / ↑↓ users).
  function moveCategory(idx, dir, refocus) {
    var newIdx = idx + dir;
    if (!canReorder() || newIdx < 0 || newIdx >= categories.length) return;
    var ids = categories.map(function (c) { return c.id; });
    var moved = ids.splice(idx, 1)[0];
    ids.splice(newIdx, 0, moved);
    reorderCategories(ids, moved, refocus);
  }
  function refocusRow(id, role) {
    if (!role || !id) return;
    var li = q('#cat-list li[data-id="' + CSS.escape(id) + '"]');
    if (!li) return;
    var b = li.querySelector('[data-role="' + role + '"]:not([disabled])') || li.querySelector('[data-role="drag"]');
    if (b) softFocus(b);
  }

  async function reorderCategories(orderedIds, movedId, refocus) {
    if (!canReorder()) { render(); return; }
    var byId = {};
    categories.forEach(function (c) { byId[c.id] = c; });
    // The drop must describe exactly the loaded list — never a partial subset.
    if (orderedIds.length !== categories.length || orderedIds.some(function (id) { return !byId[id]; })) { render(); return; }

    var snapshot = categories.map(function (c) { return { row: c, sort_order: c.sort_order }; });
    var ordered = orderedIds.map(function (id) { return byId[id]; });
    var changes = SORT.plan(ordered);
    if (!changes.length) { render(); return; }

    reordering = true;
    ordered.forEach(function (c, i) { c.sort_order = i; });
    categories = ordered;
    render();
    try {
      var res = await SORT.persist(ctx.db, 'categories', changes);
      if (!ctx) return;                                  // unmounted mid-save
      if (!res.ok) throw res.error;
      showToast(t('order.saved'), 'success', 1800);
      if (ctx.preview) ctx.preview.refreshCatalog(movedId ? { focus: { type: 'category', id: movedId } } : undefined);
    } catch (err) {
      console.error('[categories view] reorder failed:', err);
      snapshot.forEach(function (s) { s.row.sort_order = s.sort_order; });
      categories = snapshot.map(function (s) { return s.row; });
      showToast(t('order.failed'), 'error', 5500);
      if (ctx && typeof ctx.sound === 'function') ctx.sound('warning');
      reordering = false;
      render();
      await loadAll();                                   // re-sync with the database's truth
      if (ctx && ctx.preview) ctx.preview.refreshCatalog();
    } finally {
      reordering = false;
      render();
      refocusRow(movedId, refocus);
    }
  }

  // =================================================================
  //  Delete
  // =================================================================
  function askDelete(id, name) {
    pendingDeleteId = id;
    var msg = q('#confirm-msg');
    // `name` is owner data — passed as a plain var (textContent, never HTML).
    if (msg) I18N.set(msg, 'cat.deleteMsgNamed', { name: name || t('cat.thisCategory') });
    var m = q('#confirm-modal'); if (m) m.classList.add('open');
    if (ctx && typeof ctx.sound === 'function') ctx.sound('warning');
  }
  function closeConfirm() {
    pendingDeleteId = null;
    var m = q('#confirm-modal'); if (m) m.classList.remove('open');
  }
  async function doDelete() {
    if (!pendingDeleteId) return;
    var id = pendingDeleteId;
    closeConfirm();
    var res = await ctx.db.from('categories').delete().eq('id', id);
    if (res.error) {
      console.error('[categories view] delete failed:', res.error);
      showToast(friendlyDbError(res.error, t('common.deleteFailed')), 'error', 5500);
      return;
    }
    showToast(t('cat.deleted'), 'success');
    if (editingCatId === id) editingCatId = null;
    contextKey = '';
    if (ctx && ctx.preview) ctx.preview.clearCatalogDraft();
    await loadAll();
    if (ctx && ctx.preview) ctx.preview.refreshCatalog();
  }

  // =================================================================
  //  Static event wiring
  // =================================================================
  function wireStaticEvents() {
    var addForm = q('#add-cat-form');
    if (addForm) {
      on(addForm, 'submit', addCategory);
      on(addForm, 'focusin', onAddField);
      on(addForm, 'input', onAddField);
    }
    var list = q('#cat-list');
    if (list) {
      teardownFns.push(SORT.attach(list, {
        item: 'li.cat-item[data-id]',
        handle: '[data-role="drag"]',
        id: function (n) { return n.dataset.id; },
        group: function () { return 'categories'; },
        disabled: function () { return !canReorder(); },
        onDrop: function (g, ids, movedId) { reorderCategories(ids, movedId); },
        onKey: function (n, dir) {
          var idx = categories.findIndex(function (c) { return c.id === n.dataset.id; });
          if (idx !== -1) moveCategory(idx, dir, 'drag');
        },
      }));
      on(list, 'click', onListClick);
      on(list, 'focusin', onListField);
      on(list, 'input', onListField);
    }
    var cCancel = q('#confirm-cancel'); if (cCancel) on(cCancel, 'click', closeConfirm);
    var cOk = q('#confirm-ok'); if (cOk) on(cOk, 'click', doDelete);
    var cBack = q('#confirm-modal');
    if (cBack) on(cBack, 'click', function (e) { if (e.target === e.currentTarget) closeConfirm(); });
  }
  function onListClick(e) {
    var btn = e.target.closest('button[data-role]');
    if (!btn) return;
    var role = btn.dataset.role;
    if (role === 'edit') enterCatEdit(btn.dataset.id);
    else if (role === 'cat-save') saveCatEdit(btn.dataset.id);
    else if (role === 'cat-cancel') cancelCatEdit();
    else if (role === 'up') moveCategory(parseInt(btn.dataset.idx, 10), -1, 'up');
    else if (role === 'down') moveCategory(parseInt(btn.dataset.idx, 10), 1, 'down');
    else if (role === 'delete') askDelete(btn.dataset.id, btn.dataset.name || '');
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
      var note = q('#cat-error-note'); if (note) note.hidden = false;
      var form = q('#add-cat-form');
      if (form) form.querySelectorAll('input, button').forEach(function (n) { n.disabled = true; });
      var listEl = q('#cat-list');
      if (listEl) { listEl.textContent = ''; listEl.appendChild(makeErrLi()); }
      return;   // no load, no wiring, no preview drive
    }
    RID = ctx.restaurant.id;

    // Drive the shared Preview to Menu ONCE — page context only. Device /
    // language / view stay as the owner left them.
    try { ctx.preview.showPage('menu'); } catch (e) {}

    wireStaticEvents();

    await loadAll();
    if (myToken !== mountToken) return;   // superseded by a newer mount / an unmount
    catsReady = true;
    render();                             // enable the reorder controls now that the list is live
  }

  // Unsaved-changes contract for the shell's navigation guard (§5). Dirty while
  // an inline rename holds values that differ from the saved row, or the Add
  // form has any name typed. Reorder persists immediately and is never dirty.
  function isDirty() {
    if (!catsReady) return false;
    if (editingCatId) {
      var row = categories.find(function (c) { return c.id === editingCatId; });
      if (!row) return true;
      if (fvRole('edit-en') !== (row.name_en || '')) return true;
      if (fvRole('edit-ar') !== (row.name_ar || '')) return true;
    }
    if (fv('cat-name-en') || fv('cat-name-ar')) return true;   // unsaved Add draft
    return false;
  }

  function unmount() {
    mountToken++;
    if (loadAbort) { try { loadAbort.abort(); } catch (e) {} loadAbort = null; }

    teardownFns.forEach(function (fn) { try { fn(); } catch (e) {} });
    teardownFns = [];

    // Drop the unsaved category overlay so the Preview shows the saved catalog
    // again. Do NOT touch Preview page / device / lang / view.
    try { if (ctx && ctx.preview) ctx.preview.clearCatalogDraft(); } catch (e) {}

    catsReady = false;
    contextKey = '';
    editingCatId = null;
    addDraftId = null;
    ctx = null;
    root = null;
  }

  return { mount: mount, unmount: unmount, isDirty: isDirty };
})();
