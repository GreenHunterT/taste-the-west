// =================================================================
//  Admin — Categories Management
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
    return;
  }

  const RID = restaurant.id;
  let categories = [];

  // ── Load ───────────────────────────────────────────────────────────
  async function load() {
    const { data, error } = await db
      .from('categories')
      .select('*')
      .eq('restaurant_id', RID)
      .order('sort_order');

    if (error) { showToast('Failed to load categories: ' + error.message, 'error'); return; }
    categories = data || [];
    render();
  }

  // ── Render list ────────────────────────────────────────────────────
  function render() {
    const list = document.getElementById('cat-list');
    if (!categories.length) {
      list.innerHTML = `
        <li class="empty-state" style="padding:32px 0">
          <div class="empty-state-icon">📋</div>
          <h3>No categories yet</h3>
          <p>Add your first category above.</p>
        </li>`;
      return;
    }

    list.innerHTML = categories.map((c, idx) => `
      <li class="cat-item" data-id="${c.id}">
        <span class="cat-drag-handle" title="Reorder">⠿</span>
        <div class="cat-info">
          <div class="cat-name-en">${esc(c.name_en)} <span class="cat-slug">${esc(c.slug)}</span></div>
          <div class="cat-name-ar">${esc(c.name_ar)}</div>
        </div>
        <div class="row-actions">
          <button class="btn btn-ghost btn-sm btn-move-up"   data-idx="${idx}" title="Move up"   ${idx === 0 ? 'disabled' : ''}>↑</button>
          <button class="btn btn-ghost btn-sm btn-move-down" data-idx="${idx}" title="Move down" ${idx === categories.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="btn btn-danger btn-sm btn-delete-cat" data-id="${c.id}" data-name="${esc(c.name_en)}" title="Delete">🗑</button>
        </div>
      </li>
    `).join('');

    // Wire buttons
    list.querySelectorAll('.btn-move-up').forEach(btn =>
      btn.addEventListener('click', () => moveCategory(parseInt(btn.dataset.idx), -1)));
    list.querySelectorAll('.btn-move-down').forEach(btn =>
      btn.addEventListener('click', () => moveCategory(parseInt(btn.dataset.idx), +1)));
    list.querySelectorAll('.btn-delete-cat').forEach(btn =>
      btn.addEventListener('click', () => askDelete(btn.dataset.id, btn.dataset.name)));
  }

  // ── Add ────────────────────────────────────────────────────────────
  document.getElementById('add-cat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const slug   = document.getElementById('cat-slug').value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const nameEn = document.getElementById('cat-name-en').value.trim();
    const nameAr = document.getElementById('cat-name-ar').value.trim();

    if (!slug || !nameEn || !nameAr) {
      showToast('All three fields are required.', 'error'); return;
    }
    if (!/^[a-z0-9-]+$/.test(slug)) {
      showToast('Slug must only contain lowercase letters, numbers, and hyphens.', 'error'); return;
    }
    if (categories.some(c => c.slug === slug)) {
      showToast('A category with this slug already exists.', 'error'); return;
    }

    const btn = document.getElementById('add-cat-btn');
    btn.disabled = true; btn.innerHTML = '<span class="btn-spinner"></span>';

    const { error } = await db.from('categories').insert({
      restaurant_id: RID,
      slug,
      name_en: nameEn,
      name_ar: nameAr,
      sort_order: categories.length,
    });

    btn.disabled = false; btn.textContent = 'Add Category';

    if (error) { showToast('Error: ' + error.message, 'error'); return; }

    document.getElementById('add-cat-form').reset();
    showToast('Category added.', 'success');
    await load();
  });

  // ── Reorder (up/down) ──────────────────────────────────────────────
  async function moveCategory(idx, dir) {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= categories.length) return;

    // Swap in local array
    [categories[idx], categories[newIdx]] = [categories[newIdx], categories[idx]];

    // Persist new sort_order for both
    const updates = [
      db.from('categories').update({ sort_order: idx    }).eq('id', categories[newIdx].id),
      db.from('categories').update({ sort_order: newIdx }).eq('id', categories[idx].id),
    ];
    const results = await Promise.all(updates);
    const err = results.find(r => r.error);
    if (err) { showToast('Reorder failed: ' + err.error.message, 'error'); await load(); return; }

    render(); // optimistic re-render
  }

  // ── Delete ─────────────────────────────────────────────────────────
  let pendingDeleteId = null;
  function askDelete(id, name) {
    pendingDeleteId = id;
    document.getElementById('confirm-msg').textContent =
      `"${name}" will be deleted. Products in this category will have their category cleared but will NOT be deleted.`;
    document.getElementById('confirm-modal').classList.add('open');
  }
  document.getElementById('confirm-cancel').addEventListener('click', () => {
    pendingDeleteId = null;
    document.getElementById('confirm-modal').classList.remove('open');
  });
  document.getElementById('confirm-ok').addEventListener('click', async () => {
    if (!pendingDeleteId) return;
    document.getElementById('confirm-modal').classList.remove('open');
    const { error } = await db.from('categories').delete().eq('id', pendingDeleteId);
    pendingDeleteId = null;
    if (error) { showToast('Delete failed: ' + error.message, 'error'); return; }
    showToast('Category deleted.', 'success');
    await load();
  });

  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  await load();
  hideLoading();
})();
