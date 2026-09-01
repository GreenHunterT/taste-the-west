// =================================================================
//  Admin Shell — Overview view  (ported from the legacy dashboard)
//
//  Lifecycle: mount(ctx, root) / unmount().  Exactly one view is mounted
//  in #admin-view at a time; the shell unmounts the previous one first.
//  Overview does NOT drive the Live Preview — the preview stays wherever
//  the owner last left it.
// =================================================================

window.AdminViews = window.AdminViews || {};

window.AdminViews.overview = (function () {
  'use strict';

  let _abort = null;   // cancels the in-flight stats fetch on unmount

  function skeleton(root) {
    root.innerHTML = [
      '<div class="admin-page-header">',
      '  <div>',
      '    <h1 class="admin-page-title">Overview</h1>',
      '    <p class="admin-page-desc" id="ov-welcome">Loading…</p>',
      '  </div>',
      '  <a href="../index.html" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">',
      '    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
      '    View Public Site',
      '  </a>',
      '</div>',
      '<div class="stats-grid" id="ov-stats">',
      '  <div class="stat-card"><div class="stat-value" id="ov-stat-products">—</div><div class="stat-label">Menu Items</div></div>',
      '  <div class="stat-card"><div class="stat-value" id="ov-stat-available">—</div><div class="stat-label">Available</div></div>',
      '  <div class="stat-card"><div class="stat-value" id="ov-stat-featured">—</div><div class="stat-label">Featured</div></div>',
      '  <div class="stat-card"><div class="stat-value" id="ov-stat-categories">—</div><div class="stat-label">Categories</div></div>',
      '</div>',
      '<p class="field-hint" id="ov-stats-note" hidden></p>',
      '<div class="acard">',
      '  <div class="acard-title">Quick Actions</div>',
      '  <div class="flex" style="gap:12px;flex-wrap:wrap">',
      '    <a href="menu.html"       class="btn btn-primary">+ Add Product</a>',
      '    <a href="categories.html" class="btn btn-secondary">Manage Categories</a>',
      '    <a href="settings.html"   class="btn btn-secondary">Restaurant Settings</a>',
      '  </div>',
      '</div>',
    ].join('\n');
  }

  function setText(root, id, val) {
    const el = root.querySelector('#' + id);
    if (el) el.textContent = val;
  }

  async function mount(ctx, root) {
    skeleton(root);

    const name = (ctx.restaurant && (ctx.restaurant.name_en || ctx.restaurant.name_ar)) || 'your restaurant';
    setText(root, 'ov-welcome', 'Welcome back — ' + name);

    // Fail-closed: the shell already shows its banner. Don't fetch stats
    // against a restaurant we could not load; leave the tiles as “—”.
    if (ctx.restaurantLoadState !== 'ready' || !ctx.restaurant || !ctx.restaurant.id) {
      const note = root.querySelector('#ov-stats-note');
      if (note) { note.hidden = false; note.textContent = 'Stats are unavailable until the restaurant loads.'; }
      return;
    }

    // Fresh session so a refreshed/expired access token is never reused for the
    // authenticated raw request below.
    let session = null;
    try {
      const res = await ctx.db.auth.getSession();
      session = res && res.data ? res.data.session : null;
    } catch (e) { session = null; }
    if (!session) return;   // the shell's auth-state listener handles the redirect

    _abort = new AbortController();
    const rid  = ctx.restaurant.id;
    const base = SUPABASE_URL + '/rest/v1';
    const authHeaders = { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + session.access_token };
    const anonHeaders = { 'apikey': SUPABASE_ANON_KEY };

    try {
      const [pRes, cRes] = await Promise.all([
        fetch(base + '/products?restaurant_id=eq.' + rid + '&select=id,available,featured', { headers: authHeaders, signal: _abort.signal }),
        fetch(base + '/categories?restaurant_id=eq.' + rid + '&select=id', { headers: anonHeaders, signal: _abort.signal }),
      ]);
      const products   = pRes.ok ? await pRes.json() : [];
      const categories = cRes.ok ? await cRes.json() : [];

      setText(root, 'ov-stat-products',   String(products.length));
      setText(root, 'ov-stat-available',  String(products.filter(p => p.available).length));
      setText(root, 'ov-stat-featured',   String(products.filter(p => p.featured).length));
      setText(root, 'ov-stat-categories', String(categories.length));

      if (!pRes.ok || !cRes.ok) {
        const note = root.querySelector('#ov-stats-note');
        if (note) { note.hidden = false; note.textContent = 'Some stats could not be loaded. Reload to retry.'; }
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;   // unmounted mid-fetch — expected
      console.error('[overview] stats load failed:', err);
      const note = root.querySelector('#ov-stats-note');
      if (note) { note.hidden = false; note.textContent = 'Stats could not be loaded. Reload to retry.'; }
    } finally {
      _abort = null;
    }
  }

  function unmount() {
    if (_abort) { try { _abort.abort(); } catch (e) {} _abort = null; }
  }

  return { mount: mount, unmount: unmount };
})();
