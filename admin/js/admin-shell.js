// =================================================================
//  Admin Shell  (milestone 1I-B)
//
//  The one long-lived Admin document. Owns: authentication + the auth
//  state listener, the ONE hardened restaurant-identity load, the shared
//  AdminContext, the sidebar + topbar, the persistent Live Preview
//  (mounted ONCE via window.LivePreview), hash routing, and the editor
//  view mount/unmount lifecycle.
//
//  Loaded after: supabase CDN, config/supabase.js, client.js (→ window.db),
//  auth.js (→ requireAuth / signOut / showToast / showLoading / hideLoading),
//  live-preview.js (→ window.LivePreview), views/*.js (→ window.AdminViews).
// =================================================================

(async function () {
  'use strict';

  // ── Persisted, UI-only shell state (no drafts, no tokens, no PII) ──
  const UI_KEY = 'ttw_admin_ui';
  function readUi() {
    try {
      const o = JSON.parse(localStorage.getItem(UI_KEY) || '{}');
      return (o && typeof o === 'object') ? o : {};
    } catch (e) { return {}; }
  }
  function writeUi(patch) {
    try { localStorage.setItem(UI_KEY, JSON.stringify(Object.assign(readUi(), patch))); }
    catch (e) { /* private mode / storage disabled — persistence is best-effort */ }
  }

  // ── Public field whitelist for the Preview draft (SAVED state in 1I-B) ──
  // Explicit map — never spread the row, so owner_id / id / timestamps /
  // tokens can't reach the iframe. LivePreview stays schema-ignorant.
  function buildPublicRestaurantDraft(r) {
    r = r || {};
    const numOrUndef = function (v) {
      const n = (typeof v === 'number') ? v : parseFloat(v);
      return isFinite(n) ? n : undefined;
    };
    return {
      name_ar: r.name_ar || '', name_en: r.name_en || '',
      tagline_ar: r.tagline_ar || '', tagline_en: r.tagline_en || '',
      description_ar: r.description_ar || '', description_en: r.description_en || '',
      phone: r.phone || '',
      whatsapp: String(r.whatsapp || '').replace(/\D/g, ''),
      instagram: r.instagram || '', email: r.email || '',
      wa_message_ar: r.wa_message_ar || '', wa_message_en: r.wa_message_en || '',
      address_ar: r.address_ar || '', address_en: r.address_en || '',
      map_directions: r.map_directions || '', map_embed: r.map_embed || '',
      hours_weekdays_en: r.hours_weekdays_en || '', hours_weekdays_ar: r.hours_weekdays_ar || '',
      hours_weekends_en: r.hours_weekends_en || '', hours_weekends_ar: r.hours_weekends_ar || '',
      sounds_enabled: r.sounds_enabled !== false,
      hero_image_url: r.hero_image_url || '',
      logo_url: r.logo_url || '',
      location_visual_mode: r.location_visual_mode || 'map',
      location_image_url: r.location_image_url || '',
      location_image_fit: r.location_image_fit || 'cover',
      location_image_position_x: numOrUndef(r.location_image_position_x),
      location_image_position_y: numOrUndef(r.location_image_position_y),
      location_image_zoom: numOrUndef(r.location_image_zoom),
      location_image_height: r.location_image_height || 'standard',
      highlights: Array.isArray(r.highlights) ? r.highlights.map(function (h) {
        h = h || {};
        return {
          type: (typeof h.type === 'string') ? h.type : 'custom',
          value: h.value != null ? String(h.value) : '',
          label: h.label != null ? String(h.label) : '',
          labelAr: h.labelAr != null ? String(h.labelAr) : '',
          visible: !(h.visible === false),
        };
      }) : [],
    };
  }

  // ── Boot ─────────────────────────────────────────────────────────
  if (!window.LivePreview || typeof window.LivePreview.mount !== 'function') {
    console.error('[shell] LivePreview controller missing — check the <script> order in admin/index.html');
    if (typeof showToast === 'function') showToast('Admin failed to load. Reload the page.', 'error');
    hideLoading();
    return;
  }

  showLoading();

  let session = await requireAuth();          // redirects to /admin/login.html if no session
  if (!session) return;

  // ── The ONE hardened restaurant-identity load (promoted from Settings) ──
  // No `.single()`: 0 / >1 / query error / invalid row are each distinguishable
  // and each fails closed. The Admin NEVER creates or guesses a restaurant.
  let restaurant = null;
  let restaurantLoadState = 'loading';
  {
    let loadErr = null, rows = null;
    try {
      const res = await db.from('restaurants').select('*').eq('owner_id', session.user.id);
      loadErr = res.error; rows = res.data;
    } catch (err) { loadErr = err; }

    if (loadErr) {
      restaurantLoadState = 'error';
      console.error('[shell] restaurant load failed:', loadErr && (loadErr.message || loadErr), loadErr);
    } else if (!Array.isArray(rows) || rows.length === 0) {
      restaurantLoadState = 'error';
      console.error('[shell] no restaurant row for owner_id', session.user.id, '— the Admin does not create restaurants.');
    } else if (rows.length > 1) {
      restaurantLoadState = 'error';
      console.error('[shell] DATA INTEGRITY: ' + rows.length + ' restaurant rows for owner_id ' + session.user.id + ' →', rows.map(function (x) { return x.id; }));
    } else if (!rows[0] || !rows[0].id) {
      restaurantLoadState = 'error';
      console.error('[shell] restaurant row has no id:', rows[0]);
    } else {
      restaurant = rows[0];
      restaurantLoadState = 'ready';
    }
  }

  // ── AdminContext — the shell owns identity; views consume it ──────
  const ctx = {
    db: db,
    session: session,
    restaurant: restaurant,
    restaurantLoadState: restaurantLoadState,
    preview: null,          // set just below
    route: null,            // set by renderRoute()
    pendingAction: null,    // one-shot route action (e.g. #menu&action=new) — a view reads + clears it
    toast: (typeof showToast === 'function') ? showToast : function () {},
  };

  // ── Sidebar / topbar (ONE copy, owned here) ──────────────────────
  const nameEl = document.getElementById('sidebar-name');
  if (nameEl) nameEl.textContent = restaurant ? (restaurant.name_en || restaurant.name_ar || 'My Restaurant') : 'My Restaurant';

  document.querySelectorAll('[data-logout]').forEach(function (b) {
    b.addEventListener('click', signOut);
  });

  const sidebar = document.getElementById('admin-sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const menuBtn = document.getElementById('topbar-menu-btn');
  function closeSidebar() {
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('open');
  }
  if (menuBtn && sidebar && overlay) {
    menuBtn.addEventListener('click', function () {
      sidebar.classList.toggle('open');
      overlay.classList.toggle('open');
    });
    overlay.addEventListener('click', closeSidebar);
  }
  document.querySelectorAll('.sidebar-link').forEach(function (a) {
    a.addEventListener('click', closeSidebar);   // close the drawer after a mobile tap
  });

  // ── Fail-closed banner ──────────────────────────────────────────
  if (restaurantLoadState !== 'ready') {
    const banner = document.getElementById('admin-shell-banner');
    if (banner) banner.hidden = false;
  }

  // ── Restore persisted UI state, then mount the ONE Live Preview ──
  const ui = readUi();
  const initialState = {
    page:   (['home', 'menu', 'location', 'contact'].indexOf(ui.page) !== -1) ? ui.page : 'home',
    device: (ui.device === 'mobile') ? 'mobile' : 'desktop',
    lang:   (ui.lang === 'ar') ? 'ar' : 'en',
    theme:  (ui.theme === 'light') ? 'light' : 'dark',
    zoom:   (ui.zoom === '100') ? '100' : 'fit',
  };

  const shellMain = document.getElementById('admin-shell-main');

  ctx.preview = window.LivePreview.mount({
    root:         document.getElementById('live-preview'),
    expandTarget: shellMain,
    expandClass:  'is-preview-expanded',
    toast:        ctx.toast,
    initialState: initialState,
  });

  // Persist any shared Preview UI-state change (page / device / lang / theme /
  // zoom / expanded). UI-only — never restaurant data.
  ctx.preview.on('state', function (s) {
    writeUi({ page: s.page, device: s.device, lang: s.lang, theme: s.theme, zoom: s.zoom, expanded: s.expanded });
  });

  // Re-seed the shared Preview from the SAVED restaurant row. Editor views call
  // this after a successful Save (so the baseline reflects persisted data and
  // other views see fresh ctx.restaurant) and on unmount (to drop any unsaved
  // draft they pushed). No-op unless the identity load succeeded.
  ctx.setPreviewToSaved = function () {
    if (ctx.restaurantLoadState === 'ready' && ctx.restaurant) {
      ctx.preview.setDraft(buildPublicRestaurantDraft(ctx.restaurant));
    }
  };

  // ── Narrow-screen Edit | Preview pane (shell-owned) ─────────────
  function syncPaneSeg(p) {
    document.querySelectorAll('#admin-pane-seg .lp-seg__btn[data-pane]').forEach(function (b) {
      const on = b.dataset.pane === p;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  function setPane(p) {
    p = (p === 'preview') ? 'preview' : 'edit';
    if (shellMain) shellMain.dataset.pane = p;
    syncPaneSeg(p);
    writeUi({ pane: p });
    if (p === 'preview') requestAnimationFrame(function () { ctx.preview.applyScale(); });
  }
  const restoredPane = (ui.pane === 'preview') ? 'preview' : 'edit';
  if (shellMain) shellMain.dataset.pane = restoredPane;
  syncPaneSeg(restoredPane);
  document.querySelectorAll('#admin-pane-seg .lp-seg__btn[data-pane]').forEach(function (b) {
    b.addEventListener('click', function () { setPane(b.dataset.pane); });
  });

  // Views may request the narrow-screen pane (e.g. "Edit Image in Preview" →
  // show the Preview; a Preview stat-click → return to Edit). No-op on desktop,
  // where both panes are always visible.
  ctx.showPane = function (p) {
    if (window.matchMedia && window.matchMedia('(max-width: 1179px)').matches) setPane(p);
  };

  // ── Restore Expanded — AFTER mount so geometry measures correctly ──
  // (the 1I-A ResizeObserver handles the resulting stage resize).
  if (ui.expanded === true) ctx.preview.setExpanded(true);

  // ── Seed the Preview with the SAVED public restaurant (ready only) ──
  if (restaurantLoadState === 'ready') {
    ctx.preview.setDraft(buildPublicRestaurantDraft(restaurant));
  }

  // ── Router (hash) ──────────────────────────────────────────────
  // All four sections are native shell views (1I-E completed the migration).
  const VIEWS = {
    overview:   { title: 'Overview',   module: 'overview' },
    menu:       { title: 'Menu Items', module: 'menu' },
    categories: { title: 'Categories', module: 'categories' },
    settings:   { title: 'Settings',   module: 'settings' },
  };
  function routeFromHash() {
    const h = (window.location.hash || '').replace(/^#\/?/, '').split(/[?&]/)[0].trim().toLowerCase();
    return VIEWS[h] ? h : 'overview';
  }
  // Optional one-shot action after the route, e.g. `#menu&action=new`. Sanitised
  // to [a-z] (max 16). Consumed once by the view, then stripped from the hash so
  // reload / Back-Forward never replay it.
  function actionFromHash() {
    const parts = (window.location.hash || '').replace(/^#\/?/, '').split(/[?&]/).slice(1);
    for (let i = 0; i < parts.length; i++) {
      const kv = parts[i].split('=');
      if (kv[0] === 'action') return (kv[1] || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 16) || null;
    }
    return null;
  }

  let mountedView = null;   // { name, api }
  let routeSeq = 0;         // guards against a slow async mount() outliving its route
  let currentRoute = null;  // the route whose view is mounted RIGHT NOW

  // Every ACCEPTED navigation stamps its history entry with a monotonic index.
  // On a guard "Stay" we read the incoming entry's stamp to compute the exact
  // history delta that undoes the move (Back, Forward, or a fresh sidebar push)
  // — restoring the pointer WITHOUT overwriting any entry's URL. The hashchange
  // the restoration itself fires is swallowed by `suppressHash`.
  let histIdx = 0;          // stamp on the entry we are currently on
  let histNext = 0;         // next stamp to assign
  let suppressHash = false;

  // ── Shared unsaved-changes contract ─────────────────────────────
  // A view MAY expose `isDirty(): boolean` on its module API. Views with no
  // unsaved state omit it. The shell owns the navigation decision — one
  // confirmation, no stacked prompts, no per-view unload warnings.
  function viewIsDirty() {
    if (!mountedView || !mountedView.api || typeof mountedView.api.isDirty !== 'function') return false;
    try { return !!mountedView.api.isDirty(); } catch (e) { return false; }
  }
  function hashFor(route) {
    return window.location.pathname + window.location.search + '#' + route;
  }
  // Stamp + normalise the CURRENT history entry: replaces its URL with the bare
  // route (drops any `&action=…`) and records this entry's monotonic index.
  // replaceState never fires hashchange, so this is safe to call every route.
  function commitHistory() {
    histIdx = ++histNext;
    try { history.replaceState({ ttwIdx: histIdx }, '', hashFor(currentRoute)); } catch (e) {}
  }

  function makeViewError() {
    const d = document.createElement('div');
    d.className = 'acard admin-view-error';
    d.textContent = 'This section failed to load. Reload the page to try again.';
    return d;
  }

  async function renderRoute() {
    const seq = ++routeSeq;
    const name = routeFromHash();
    currentRoute = name;             // the view about to mount owns navigation from here
    ctx.route = name;
    writeUi({ route: name });

    // Hand any one-shot action to the view via ctx, then stamp + normalise the
    // history entry (drops `&action=…` so a reload / Back doesn't replay it).
    ctx.pendingAction = actionFromHash();
    commitHistory();

    document.querySelectorAll('.sidebar-link').forEach(function (a) {
      a.classList.toggle('active', a.dataset.route === name);
    });
    const tt = document.getElementById('topbar-title');
    if (tt) tt.textContent = VIEWS[name].title;

    if (mountedView && mountedView.api && typeof mountedView.api.unmount === 'function') {
      try { mountedView.api.unmount(); } catch (e) { console.error('[shell] view unmount error:', e); }
    }
    mountedView = null;

    const host = document.getElementById('admin-view');
    if (!host) return;
    host.replaceChildren();   // instant, crisp editor swap — no transition

    const def = VIEWS[name];
    if (def.module && window.AdminViews && window.AdminViews[def.module]) {
      const api = window.AdminViews[def.module];
      mountedView = { name: name, api: api };
      try {
        await api.mount(ctx, host);
        if (seq !== routeSeq && typeof api.unmount === 'function') {
          try { api.unmount(); } catch (e) {}   // a newer route change already superseded us
        }
      } catch (e) {
        console.error('[shell] view mount failed:', name, e);
        if (seq === routeSeq) { mountedView = null; host.replaceChildren(makeViewError()); }
      }
    } else {
      // A module is missing / failed to load — never a migration placeholder.
      host.replaceChildren(makeViewError());
    }
  }

  // ── Auth-state listener for a long-lived document ───────────────
  // Registered before the first view mounts so a mid-boot sign-out is caught.
  db.auth.onAuthStateChange(function (event, sess) {
    if (event === 'SIGNED_OUT' || (!sess && event !== 'INITIAL_SESSION')) {
      window.location.replace('/admin/login.html');
      return;
    }
    if (sess) ctx.session = sess;   // TOKEN_REFRESHED / SIGNED_IN / USER_UPDATED / INITIAL_SESSION
  });

  // Hash-based routing: `hashchange` fires AFTER the URL already changed (sidebar
  // link, Back/Forward, or a programmatic hash set).
  function onHashChange() {
    if (suppressHash) { suppressHash = false; return; }   // our own "Stay" restoration
    const target = routeFromHash();
    if (target !== currentRoute && viewIsDirty()) {
      if (!window.confirm('You have unsaved changes. Leave without saving?')) {
        // STAY: undo the move without corrupting any history entry. A stamped
        // incoming entry (Back/Forward) → go by the stamp delta; an unstamped
        // one (fresh sidebar push) → go back one. The restoration hashchange is
        // swallowed by suppressHash.
        const s = history.state;
        const incoming = (s && typeof s.ttwIdx === 'number') ? s.ttwIdx : null;
        const delta = (incoming === null) ? -1 : (histIdx - incoming);
        if (delta !== 0) {
          suppressHash = true;
          try { history.go(delta); } catch (e) { suppressHash = false; }
        }
        return;
      }
    }
    renderRoute();
  }
  window.addEventListener('hashchange', onHashChange);

  // The ONLY beforeunload listener with behavioural significance. Views expose
  // isDirty() and never install their own beforeunload handlers (object URLs
  // are released by the browser on a real unload; the views revoke explicitly
  // on file replace / modal close / Save / unmount).
  window.addEventListener('beforeunload', function (e) {
    if (viewIsDirty()) { e.preventDefault(); e.returnValue = ''; }
  });

  // Empty / bare hash on cold load → last route (or Overview). replaceState
  // does NOT fire hashchange, so render explicitly.
  const rawHash = (window.location.hash || '').replace(/^#\/?/, '').trim();
  if (!rawHash) {
    const initRoute = VIEWS[ui.route] ? ui.route : 'overview';
    try { history.replaceState(null, '', window.location.pathname + window.location.search + '#' + initRoute); }
    catch (e) { /* keep bare hash — routeFromHash() falls back to overview */ }
  }
  await renderRoute();

  hideLoading();
})();
