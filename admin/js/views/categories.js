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
  function mkBtn(cls, text, data) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = text;
    if (data) Object.keys(data).forEach(function (k) { b.dataset[k] = String(data[k]); });
    return b;
  }
  function makeErrLi(text) {
    var li = el('li', 'empty-state');
    li.style.padding = '28px 0';
    li.appendChild(el('p', 'field-hint', text || 'The category editor is read-only — the restaurant could not be loaded. Reload the page.'));
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
      '      <h1 class="admin-page-title">Categories</h1>',
      '      <p class="admin-page-desc">Categories let customers filter your menu. Renames preview live and go public when you Save.</p>',
      '    </div>',
      '  </div>',
      '  <p class="field-hint settings-view__hint--error" id="cat-error-note" hidden>Categories are read-only — the restaurant could not be loaded. Reload the page.</p>',
      '',
      '  <div class="acard mb-3">',
      '    <div class="acard-title">Add Category</div>',
      '    <form id="add-cat-form" novalidate>',
      '      <div class="form-row">',
      '        <div class="form-group">',
      '          <label for="cat-name-en">Category Name (English) <span class="required">*</span></label>',
      '          <input type="text" id="cat-name-en" placeholder="Pizza" required />',
      '        </div>',
      '        <div class="form-group">',
      '          <label for="cat-name-ar">Category Name (Arabic) <span class="required">*</span></label>',
      '          <input type="text" id="cat-name-ar" dir="rtl" placeholder="بيتزا" required />',
      '        </div>',
      '      </div>',
      '      <button type="submit" class="btn btn-primary" id="add-cat-btn">Add Category</button>',
      '    </form>',
      '  </div>',
      '',
      '  <div class="acard">',
      '    <div class="acard-title">Existing Categories <small style="text-transform:none;font-weight:400;color:var(--amuted)">(Edit to rename · ↑ ↓ to reorder)</small></div>',
      '    <ul class="cat-list" id="cat-list">',
      '      <li class="empty-state" style="padding:32px 0"><div class="empty-state-icon">📋</div><h3>Loading…</h3><p>Fetching your categories.</p></li>',
      '    </ul>',
      '  </div>',
      '',
      '  <div class="modal-backdrop" id="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="cat-confirm-title">',
      '    <div class="confirm-dialog">',
      '      <h2 class="confirm-title" id="cat-confirm-title">Delete category?</h2>',
      '      <p class="confirm-msg" id="confirm-msg">Products in this category will have their category cleared but will not be deleted.</p>',
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
      categories = res.data || [];
      render();
    } catch (err) {
      var msg = String((err && err.message) || err || '');
      if ((err && err.name === 'AbortError') || msg.toLowerCase().indexOf('abort') !== -1) return;
      console.error('[categories view] load failed:', err);
      var listEl = q('#cat-list');
      if (listEl) { listEl.textContent = ''; listEl.appendChild(makeErrLi('Categories could not be loaded. Reload to retry.')); }
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
      li.appendChild(el('h3', null, 'No categories yet'));
      li.appendChild(el('p', null, 'Add your first category above.'));
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
    li.appendChild(el('span', 'cat-drag-handle', '⠿'));

    var info = el('div', 'cat-info');
    info.appendChild(el('div', 'cat-name-en', c.name_en || ''));
    info.appendChild(el('div', 'cat-name-ar', c.name_ar || ''));
    li.appendChild(info);

    var actions = el('div', 'row-actions');
    actions.appendChild(mkBtn('btn btn-ghost btn-sm', 'Edit', { role: 'edit', id: c.id }));
    var up = mkBtn('btn btn-ghost btn-sm', '↑', { role: 'up', idx: idx });
    if (idx === 0) up.disabled = true;
    var down = mkBtn('btn btn-ghost btn-sm', '↓', { role: 'down', idx: idx });
    if (idx === categories.length - 1) down.disabled = true;
    actions.appendChild(up);
    actions.appendChild(down);
    actions.appendChild(mkBtn('btn btn-danger btn-sm', '🗑', { role: 'delete', id: c.id, name: c.name_en || '' }));
    li.appendChild(actions);
    return li;
  }

  function buildEditItem(c) {
    var li = el('li', 'cat-item is-editing');
    li.dataset.id = c.id;

    var info = el('div', 'cat-info');
    var row = el('div', 'form-row');
    row.appendChild(field('Category Name (English)', 'edit-en', c.name_en || '', false));
    row.appendChild(field('Category Name (Arabic)', 'edit-ar', c.name_ar || '', true));
    info.appendChild(row);
    li.appendChild(info);

    var actions = el('div', 'row-actions');
    actions.appendChild(mkBtn('btn btn-primary btn-sm', 'Save', { role: 'cat-save', id: c.id }));
    actions.appendChild(mkBtn('btn btn-ghost btn-sm', 'Cancel', { role: 'cat-cancel' }));
    li.appendChild(actions);
    return li;
  }
  function field(labelText, role, value, rtl) {
    var g = el('div', 'form-group');
    g.appendChild(el('label', null, labelText));
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
    if (!nameEn || !nameAr) { showToast('Both English and Arabic names are required.', 'error'); return; }
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
      showToast('Category renamed.', 'success');
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
      showToast('Rename failed: ' + (err && err.message ? err.message : err), 'error');
    } finally {
      savingEdit = false;
      var b2 = q('#cat-list [data-role="cat-save"]');
      if (b2) { b2.disabled = false; b2.textContent = 'Save'; }
    }
  }

  // =================================================================
  //  Add category
  // =================================================================
  async function addCategory(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (savingAdd || !catsReady) return;
    var nameEn = fv('cat-name-en'), nameAr = fv('cat-name-ar');
    if (!nameEn) { showToast('English category name is required.', 'error'); return; }
    if (!nameAr) { showToast('Arabic category name is required.', 'error'); return; }

    // Slug is internal: generated from the English name, made unique against the
    // already-loaded list. The owner never types or resolves it.
    var slugBase = slugifyCategoryName(nameEn);

    savingAdd = true;
    var btn = q('#add-cat-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="btn-spinner"></span>'; }
    try {
      var res = await ctx.db.from('categories').insert({
        restaurant_id: RID, slug: makeUniqueSlug(slugBase, categories),
        name_en: nameEn, name_ar: nameAr, sort_order: categories.length,
      }).select('id');
      if (res.error && isSlugConflict(res.error)) {
        // Extremely rare cross-tab race — resolve it ourselves, never ask the owner.
        res = await ctx.db.from('categories').insert({
          restaurant_id: RID, slug: slugBase + '-' + uniqueToken().slice(0, 6),
          name_en: nameEn, name_ar: nameAr, sort_order: categories.length,
        }).select('id');
      }
      if (res.error) throw new Error(res.error.message);
      if (!ctx) return;                       // unmounted mid-save
      var newId = (res.data && res.data[0] && res.data[0].id) || null;

      showToast('Category added.', 'success');
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
      showToast('Error: ' + (err && err.message ? err.message : err), 'error');
    } finally {
      savingAdd = false;
      var b2 = q('#add-cat-btn');
      if (b2) { b2.disabled = false; b2.textContent = 'Add Category'; }
    }
  }

  // =================================================================
  //  Reorder  (persists immediately — the legacy model)
  // =================================================================
  async function moveCategory(idx, dir) {
    if (reordering) return;
    var newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= categories.length) return;
    reordering = true;

    var a = categories[idx], b = categories[newIdx];
    categories[idx] = b;
    categories[newIdx] = a;
    render();   // optimistic

    try {
      // Each swapped row gets sort_order === its NEW array index, so the
      // persisted order matches the visible order and survives reload.
      var results = await Promise.all([
        ctx.db.from('categories').update({ sort_order: idx }).eq('id', b.id),
        ctx.db.from('categories').update({ sort_order: newIdx }).eq('id', a.id),
      ]);
      var bad = results.find(function (r) { return r.error; });
      if (bad) { showToast('Reorder failed: ' + bad.error.message, 'error'); await loadAll(); return; }
      b.sort_order = idx;
      a.sort_order = newIdx;
      if (ctx && ctx.preview) ctx.preview.refreshCatalog();
    } catch (err) {
      console.error('[categories view] reorder failed:', err);
      showToast('Reorder failed: ' + (err && err.message ? err.message : err), 'error');
      await loadAll();
    } finally {
      reordering = false;
    }
  }

  // =================================================================
  //  Delete
  // =================================================================
  function askDelete(id, name) {
    pendingDeleteId = id;
    var msg = q('#confirm-msg');
    if (msg) {
      msg.textContent = '"' + (name || 'This category') +
        '" will be deleted. Products in this category will have their category cleared but will NOT be deleted.';
    }
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
      // e.g. a FK RESTRICT constraint — surface the DB's own explanation.
      showToast('Delete failed: ' + res.error.message, 'error');
      return;
    }
    showToast('Category deleted.', 'success');
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
    else if (role === 'up') moveCategory(parseInt(btn.dataset.idx, 10), -1);
    else if (role === 'down') moveCategory(parseInt(btn.dataset.idx, 10), 1);
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
    // language / theme / view stay as the owner left them.
    try { ctx.preview.showPage('menu'); } catch (e) {}

    wireStaticEvents();

    await loadAll();
    if (myToken !== mountToken) return;   // superseded by a newer mount / an unmount
    catsReady = true;
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
    // again. Do NOT touch Preview page / device / lang / theme / view.
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
