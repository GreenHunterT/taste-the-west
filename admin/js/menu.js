// =================================================================
//  Admin — Menu Items Management
// =================================================================
(async function () {
  showLoading();
  const session = await requireAuth();
  if (!session) return;

  const restaurant = await getMyRestaurant(session.user.id);
  initAdminShell(restaurant ? restaurant.name_en || restaurant.name_ar : 'My Restaurant');

  if (!restaurant) {
    hideLoading();
    showToast('No restaurant found. Please fill in Settings first.', 'warning', 6000);
    document.getElementById('products-table-wrap').innerHTML =
      '<p style="color:var(--amuted);padding:24px">No restaurant configured yet. <a href="settings.html">Go to Settings</a></p>';
    return;
  }

  const RID = restaurant.id;
  // Use authenticated token so owner sees unavailable products
  const s = await requireAuth();
  if (!s) return;
  const authToken = s.access_token;

  let allProducts  = [];
  let allCategories = [];
  let productImageFile = null;

  // ── Load data ────────────────────────────────────────────────────
  async function loadAll() {
    const base = SUPABASE_URL + '/rest/v1';
    const h = { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + authToken };

    const [pRes, cRes] = await Promise.all([
      fetch(base + '/products?restaurant_id=eq.' + RID + '&order=sort_order&select=*,categories(id,slug,name_ar,name_en)', { headers: h }),
      fetch(base + '/categories?restaurant_id=eq.' + RID + '&order=sort_order', { headers: h }),
    ]);

    allProducts   = pRes.ok ? await pRes.json()   : [];
    allCategories = cRes.ok ? await cRes.json()   : [];

    populateCategoryDropdowns();
    renderTable();
  }

  function populateCategoryDropdowns() {
    const opts = '<option value="">— None —</option>' +
      allCategories.map(c => `<option value="${c.id}">${c.name_en} / ${c.name_ar}</option>`).join('');

    document.getElementById('cat-filter').innerHTML =
      '<option value="">All categories</option>' +
      allCategories.map(c => `<option value="${c.id}">${c.name_en}</option>`).join('');

    document.getElementById('p-category').innerHTML = opts;
  }

  // ── Render table ──────────────────────────────────────────────────
  function renderTable(filterText, filterCat) {
    const wrap = document.getElementById('products-table-wrap');
    let list = allProducts;

    if (filterText) {
      const q = filterText.toLowerCase();
      list = list.filter(p =>
        (p.name_en || '').toLowerCase().includes(q) ||
        (p.name_ar || '').toLowerCase().includes(q)
      );
    }
    if (filterCat) {
      list = list.filter(p => p.category_id === filterCat);
    }

    if (!list.length) {
      wrap.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🍕</div>
          <h3>${allProducts.length ? 'No results' : 'No items yet'}</h3>
          <p>${allProducts.length ? 'Try clearing your filters.' : 'Add your first menu item to get started.'}</p>
          ${!allProducts.length ? '<button class="btn btn-primary" id="add-product-btn-empty">+ Add Item</button>' : ''}
        </div>`;
      const emptyBtn = document.getElementById('add-product-btn-empty');
      if (emptyBtn) emptyBtn.addEventListener('click', openAddModal);
      return;
    }

    const PLACEHOLDER = '../assets/images/product-placeholder.svg';

    wrap.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th style="width:52px"></th>
            <th>Name</th>
            <th>Category</th>
            <th>Price</th>
            <th>Status</th>
            <th style="width:130px">Actions</th>
          </tr>
        </thead>
        <tbody id="products-tbody">
          ${list.map(p => {
            const cat = p.categories;
            const catName = cat ? cat.name_en : '—';
            const imgSrc  = p.image_url || PLACEHOLDER;
            const avBadge = p.available
              ? '<span class="badge badge-success">Active</span>'
              : '<span class="badge badge-muted">Hidden</span>';
            const ftBadge = p.featured
              ? '<span class="badge badge-gold" style="margin-left:4px">★ Featured</span>'
              : '';
            return `
              <tr data-id="${p.id}">
                <td>
                  <img src="${imgSrc}" class="product-thumb"
                       alt="" onerror="this.src='${PLACEHOLDER}'" />
                </td>
                <td class="product-name-cell">
                  <strong>${esc(p.name_en)}</strong>
                  <span>${esc(p.name_ar)}</span>
                </td>
                <td>${esc(catName)}</td>
                <td>${esc(p.price)}</td>
                <td>${avBadge}${ftBadge}</td>
                <td>
                  <div class="row-actions">
                    <button class="btn btn-ghost btn-sm btn-edit" data-id="${p.id}" title="Edit">✏</button>
                    <button class="btn btn-ghost btn-sm btn-toggle" data-id="${p.id}"
                            data-available="${p.available}"
                            title="${p.available ? 'Hide' : 'Show'}">
                      ${p.available ? '👁' : '🚫'}
                    </button>
                    <button class="btn btn-danger btn-sm btn-delete" data-id="${p.id}"
                            data-name="${esc(p.name_en)}" title="Delete">🗑</button>
                  </div>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>`;

    // Wire row actions
    wrap.querySelectorAll('.btn-edit').forEach(btn =>
      btn.addEventListener('click', () => openEditModal(btn.dataset.id)));

    wrap.querySelectorAll('.btn-toggle').forEach(btn =>
      btn.addEventListener('click', () => toggleAvailable(btn.dataset.id, btn.dataset.available === 'true')));

    wrap.querySelectorAll('.btn-delete').forEach(btn =>
      btn.addEventListener('click', () => confirmDelete(btn.dataset.id, btn.dataset.name)));
  }

  // ── Search / filter ────────────────────────────────────────────────
  document.getElementById('table-search').addEventListener('input', e => {
    renderTable(e.target.value.trim(), document.getElementById('cat-filter').value);
  });
  document.getElementById('cat-filter').addEventListener('change', e => {
    renderTable(document.getElementById('table-search').value.trim(), e.target.value);
  });

  // ── Modal helpers ──────────────────────────────────────────────────
  function openModal() {
    document.getElementById('product-modal').classList.add('open');
    document.getElementById('p-name-en').focus();
  }
  function closeModal() {
    document.getElementById('product-modal').classList.remove('open');
    document.getElementById('product-form').reset();
    document.getElementById('product-id').value = '';
    const prev = document.getElementById('p-image-preview');
    prev.src = ''; prev.hidden = true;
    productImageFile = null;
    document.getElementById('modal-title').textContent = 'Add Menu Item';
  }

  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('product-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });

  // ── Add button ─────────────────────────────────────────────────────
  function openAddModal() {
    closeModal();
    document.getElementById('modal-title').textContent = 'Add Menu Item';
    document.getElementById('p-available').checked = true;
    openModal();
  }
  document.getElementById('add-product-btn').addEventListener('click', openAddModal);

  // ── Edit ───────────────────────────────────────────────────────────
  function openEditModal(id) {
    const p = allProducts.find(x => x.id === id);
    if (!p) return;
    closeModal();
    document.getElementById('modal-title').textContent = 'Edit Menu Item';
    document.getElementById('product-id').value  = p.id;
    document.getElementById('p-name-ar').value   = p.name_ar  || '';
    document.getElementById('p-name-en').value   = p.name_en  || '';
    document.getElementById('p-desc-ar').value   = p.description_ar || '';
    document.getElementById('p-desc-en').value   = p.description_en || '';
    document.getElementById('p-price').value     = p.price    || '';
    document.getElementById('p-category').value  = p.category_id || '';
    document.getElementById('p-sort').value      = p.sort_order  || 0;
    document.getElementById('p-featured').checked  = !!p.featured;
    document.getElementById('p-available').checked = p.available !== false;

    if (p.image_url) {
      const prev = document.getElementById('p-image-preview');
      prev.src = p.image_url; prev.hidden = false;
    }
    openModal();
  }

  // ── Image picker ───────────────────────────────────────────────────
  initImageInput('p-image-file', 'p-image-preview', f => { productImageFile = f; });

  // ── Save (add or edit) ────────────────────────────────────────────
  document.getElementById('modal-save').addEventListener('click', async () => {
    const nameEn = document.getElementById('p-name-en').value.trim();
    const nameAr = document.getElementById('p-name-ar').value.trim();
    const price  = document.getElementById('p-price').value.trim();

    if (!nameEn || !nameAr) { showToast('Name (Arabic and English) is required.', 'error'); return; }
    if (!price)              { showToast('Price is required.', 'error'); return; }

    const saveBtn = document.getElementById('modal-save');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="btn-spinner"></span> Saving…';

    try {
      let imageUrl = null;
      const editId = document.getElementById('product-id').value;

      if (productImageFile) {
        const path = 'products/' + RID + '-' + Date.now();
        imageUrl = await uploadToStorage(productImageFile, path);
      } else if (editId) {
        const existing = allProducts.find(x => x.id === editId);
        imageUrl = existing ? existing.image_url : null;
      }

      const catVal = document.getElementById('p-category').value;
      const payload = {
        restaurant_id:  RID,
        name_ar:        nameAr,
        name_en:        nameEn,
        description_ar: document.getElementById('p-desc-ar').value.trim(),
        description_en: document.getElementById('p-desc-en').value.trim(),
        price:          price,
        category_id:    catVal || null,
        image_url:      imageUrl || '',
        featured:       document.getElementById('p-featured').checked,
        available:      document.getElementById('p-available').checked,
        sort_order:     parseInt(document.getElementById('p-sort').value, 10) || 0,
      };

      let result;
      if (editId) {
        result = await db.from('products').update(payload).eq('id', editId);
      } else {
        result = await db.from('products').insert(payload);
      }

      if (result.error) throw new Error(result.error.message);

      showToast(editId ? 'Item updated.' : 'Item added.', 'success');
      closeModal();
      await loadAll();
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Item';
    }
  });

  // ── Toggle available ───────────────────────────────────────────────
  async function toggleAvailable(id, currentlyAvailable) {
    const { error } = await db.from('products')
      .update({ available: !currentlyAvailable })
      .eq('id', id);
    if (error) { showToast('Update failed: ' + error.message, 'error'); return; }
    showToast(currentlyAvailable ? 'Item hidden from menu.' : 'Item is now visible.', 'success');
    await loadAll();
  }

  // ── Delete ─────────────────────────────────────────────────────────
  let pendingDeleteId = null;
  function confirmDelete(id, name) {
    pendingDeleteId = id;
    document.getElementById('confirm-msg').textContent =
      `"${name}" will be permanently removed from your menu. This cannot be undone.`;
    document.getElementById('confirm-modal').classList.add('open');
  }
  document.getElementById('confirm-cancel').addEventListener('click', () => {
    pendingDeleteId = null;
    document.getElementById('confirm-modal').classList.remove('open');
  });
  document.getElementById('confirm-ok').addEventListener('click', async () => {
    if (!pendingDeleteId) return;
    document.getElementById('confirm-modal').classList.remove('open');
    const { error } = await db.from('products').delete().eq('id', pendingDeleteId);
    pendingDeleteId = null;
    if (error) { showToast('Delete failed: ' + error.message, 'error'); return; }
    showToast('Item deleted.', 'success');
    await loadAll();
  });

  // ── Escape HTML ────────────────────────────────────────────────────
  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Init ───────────────────────────────────────────────────────────
  await loadAll();
  hideLoading();
})();
