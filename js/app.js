// =================================================================
//  SOUQSITE — App Runtime  v2.0
//
//  V1 mode (static): reads SHOP, PRODUCTS, TRANSLATIONS globals set
//    by config/shop.js, config/products.js, config/translations.js
//
//  V2 mode (Supabase): detects SUPABASE_URL + RESTAURANT_ID from
//    config/supabase.js, fetches live data, then runs the same
//    render path as V1.
//
//  The developer never touches this file per client.
// =================================================================
(function () {
  'use strict';

  // ── IMAGE FALLBACKS ──────────────────────────────────────────────
  // SVG shown inline when an img src fails to load.
  const IMG_BROKEN = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3">' +
    '<rect width="4" height="3" fill="#2b2820"/>' +
    '</svg>'
  );
  // File-based placeholder used when a product has no image URL at all.
  const IMG_DEFAULT = 'assets/images/product-placeholder.svg';

  // ── SUPABASE DETECTION ───────────────────────────────────────────
  function isSupabaseConfigured() {
    return (
      typeof SUPABASE_URL      !== 'undefined' &&
      typeof SUPABASE_ANON_KEY !== 'undefined' &&
      typeof RESTAURANT_ID    !== 'undefined' &&
      SUPABASE_URL.startsWith('https://') &&
      !SUPABASE_URL.includes('YOUR_') &&
      RESTAURANT_ID.length === 36
    );
  }

  // ── ADMIN PREVIEW MODE ───────────────────────────────────────────
  // When this page is embedded in the Admin Settings Live Preview iframe
  // (?adminPreview=1) it renders draft data pushed from the parent via
  // postMessage instead of loading from Supabase. It NEVER writes anything.
  // Absent the flag, everything below is inert and the site behaves normally.
  var PREVIEW = (function () {
    try { return new URLSearchParams(window.location.search).has('adminPreview'); }
    catch (e) { return false; }
  })();
  // Language in preview is AUTHORITATIVE Admin state: the parent echoes it in
  // every PREVIEW_DATA and the child obeys verbatim. It is only ever changed
  // here by (a) a value the parent sent, or (b) the real in-iframe control —
  // which reports the change back UP so parent and child never drift. Never
  // derived from localStorage / restaurant data / a locale default.
  var _previewLang  = null;   // 'ar' | 'en'
  var _previewApplied = false; // set once the first PREVIEW_DATA has been applied
  var _locEdit = null;         // Location-image direct-edit session state (preview only)
  // This document's preview navigation generation — read from its OWN boot URL
  // (?previewNav=N) and fixed for the document's lifetime. Stamped on every
  // message so the parent can reject a stale document whose slot was re-navigated.
  // PREVIEW_DATA never redefines it.
  var _previewNav = (function () {
    try {
      var v = new URLSearchParams(window.location.search).get('previewNav');
      var n = v == null ? NaN : parseInt(v, 10);
      return Number.isFinite(n) ? n : null;
    } catch (e) { return null; }
  })();
  function parentPost(msg) {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(msg, window.location.origin);
      }
    } catch (e) {}
  }

  // In-iframe nav link → Admin preview page key. Turns a same-site navigation
  // click inside the preview into a PREVIEW_NAVIGATE message (the parent owns
  // the page selector + iframe src). Any href that is not one of these four
  // local pages resolves to null and the click is simply neutralised.
  var PREVIEW_NAV_PAGES = {
    'index.html': 'home', '': 'home',
    'products.html': 'menu',
    'location.html': 'location',
    'contact.html': 'contact',
  };
  function previewPageForHref(href) {
    href = String(href || '').trim();
    if (!href || href.charAt(0) === '#') return null;      // in-page anchor / empty
    try {
      var u = new URL(href, window.location.href);
      if (u.origin !== window.location.origin) return null;              // external
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null; // tel:/mailto:
      var base = u.pathname.split('/').pop();
      return Object.prototype.hasOwnProperty.call(PREVIEW_NAV_PAGES, base)
        ? PREVIEW_NAV_PAGES[base] : null;
    } catch (e) { return null; }
  }

  // Live catalog for Admin Preview. Categories + products are NOT Settings
  // state, so the preview loads them read-only from Supabase (publishable key,
  // exactly the access the public site already uses) rather than showing the
  // bundled demo menu. The Admin parent still owns restaurant/settings, pushed
  // in over postMessage.
  var _previewCategories    = null;   // live categories, re-applied after each draft
  var _previewCatalogFailed = false;  // true only if the live catalog fetch errored
  // Unsaved Menu / Categories editor overlay (Admin only). `_previewCatalogBase`
  // is the pristine live product catalog; `_previewCatalogDraft` is Admin's
  // whitelisted per-row patches + new draft rows for BOTH products and
  // categories. The bases are NEVER mutated — previewProducts() /
  // previewCategoriesMerged() return fresh merged arrays on demand.
  var _previewCatalogBase   = null;
  var _previewCatalogDraft  = null;   // { products:[ {id,isDraft,patch} ], categories:[ {id,isDraft,patch} ] } | null

  // ── DB → SHOP SHAPE MAPPING ───────────────────────────────────────
  function mapRestaurant(r) {
    return {
      name:          r.name_ar          || '',
      nameEn:        r.name_en          || '',
      tagline:       r.tagline_ar       || '',
      taglineEn:     r.tagline_en       || '',
      description:   r.description_ar  || '',
      descriptionEn: r.description_en  || '',
      phone:         r.phone            || '',
      whatsapp:      r.whatsapp         || '',
      instagram:     r.instagram        || '',
      email:         r.email            || '',
      address: {
        ar: r.address_ar || '',
        en: r.address_en || '',
      },
      mapEmbed:      r.map_embed        || '',
      mapDirections: r.map_directions   || '',
      // Location-page big visual: 'map' (default) or 'image'. `locationImage`
      // is a public URL shown, as a Google-Maps link, when mode is 'image'.
      // Composition: 'contain' (Fit Whole Image, blurred filler) | 'cover'
      // (Fill Frame) + normalized focal point (0–100) + zoom (1–1.6).
      locationVisualMode: r.location_visual_mode === 'image' ? 'image' : 'map',
      locationImage:      r.location_image_url || '',
      locationImageFit:   r.location_image_fit === 'contain' ? 'contain' : 'cover',
      locationImagePosX:  clampNum(r.location_image_position_x, 0, 100, 50),
      locationImagePosY:  clampNum(r.location_image_position_y, 0, 100, 50),
      locationImageZoom:  clampNum(r.location_image_zoom, 1, 1.6, 1),
      locationImageHeight: (r.location_image_height === 'short' || r.location_image_height === 'tall')
        ? r.location_image_height : 'standard',
      hours: {
        weekdays:   r.hours_weekdays_en || '',
        weekdaysAr: r.hours_weekdays_ar || '',
        weekends:   r.hours_weekends_en || '',
        weekendsAr: r.hours_weekends_ar || '',
      },
      highlights:  Array.isArray(r.highlights) ? r.highlights : [],
      hero:   { image: r.hero_image_url || '' },
      logo:   r.logo_url || '',
      social: {
        whatsappMessage:   r.wa_message_ar || '',
        whatsappMessageEn: r.wa_message_en || '',
      },
      sounds: r.sounds_enabled !== false,
      categories: [], // populated after categories fetch
    };
  }

  function mapProduct(p) {
    return {
      id:            p.id,
      name:          p.name_ar          || '',
      nameEn:        p.name_en          || '',
      description:   p.description_ar  || '',
      descriptionEn: p.description_en  || '',
      price:         p.price            || '',
      category:      p.categories ? p.categories.slug : 'other',
      image:         p.image_url        || '',
      featured:      !!p.featured,
      available:     p.available !== false,
      sort_order:    p.sort_order       || 0,
      _catNameAr:    p.categories ? p.categories.name_ar : '',
      _catNameEn:    p.categories ? p.categories.name_en : '',
    };
  }

  // ── FETCH FROM SUPABASE ───────────────────────────────────────────
  // Uses the PostgREST REST API directly — no SDK needed on the public page.
  // The anon key + RLS policies enforce read-only access to published data.
  async function loadFromSupabase() {
    const base = SUPABASE_URL + '/rest/v1';
    // Anonymous public access: the publishable key goes in `apikey` only.
    // Do NOT add an Authorization header here — a Bearer token must carry a
    // signed-in user's JWT, never the sb_publishable key.
    const h = {
      'apikey': SUPABASE_ANON_KEY,
    };

    // Restaurant row and catalog fetched in parallel, same as before.
    // Reads `restaurants_public` — a column-limited VIEW (see
    // supabase/migrations/001_restaurants_public_view.sql), NOT the base
    // `restaurants` table. RLS protects rows, not columns; the base
    // table's owner_id (and any future internal-only column) must never
    // be reachable by an anonymous caller, including one that bypasses
    // this file and queries PostgREST directly (milestone 1O §5).
    const [rRes, catalog] = await Promise.all([
      fetch(base + '/restaurants_public?id=eq.' + RESTAURANT_ID + '&select=*', { headers: h }),
      fetchCatalog(base, h),
    ]);

    if (!rRes.ok) throw new Error('Restaurant fetch failed (' + rRes.status + ')');

    const [restaurantRaw] = await rRes.json();
    if (!restaurantRaw) throw new Error('No restaurant found for RESTAURANT_ID: ' + RESTAURANT_ID);

    // Mutate globals so all existing render functions work unchanged.
    window.SHOP     = mapRestaurant(restaurantRaw);
    window.PRODUCTS = catalog.products;
    window.SHOP.categories = catalog.categories;

    // Sync sounds flag to SHOP_SETTINGS so playUISound() respects DB value
    if (typeof SHOP_SETTINGS !== 'undefined') {
      SHOP_SETTINGS.sounds = restaurantRaw.sounds_enabled !== false;
    }
  }

  // Public catalog read — categories + available products for RESTAURANT_ID,
  // mapped to the SHOP/PRODUCTS shape. Shared by the normal page load and the
  // Admin Preview: read-only, anon key, no Authorization header. A failed
  // sub-request degrades to an empty list exactly as the old inline code did;
  // a network-level failure rejects and is handled by the caller.
  async function fetchCatalog(base, h) {
    const [cRes, pRes] = await Promise.all([
      fetch(base + '/categories?restaurant_id=eq.' + RESTAURANT_ID + '&order=sort_order', { headers: h }),
      fetch(
        base + '/products?restaurant_id=eq.' + RESTAURANT_ID +
        '&available=eq.true&order=sort_order' +
        '&select=*,categories(id,slug,name_ar,name_en)',
        { headers: h }
      ),
    ]);
    const catsRaw  = cRes.ok ? await cRes.json() : [];
    const prodsRaw = pRes.ok ? await pRes.json() : [];
    return {
      products: (prodsRaw || []).map(mapProduct),
      categories: (catsRaw || []).map(c => ({
        id:         c.id,
        slug:       c.slug,
        nameAr:     c.name_ar,
        nameEn:     c.name_en,
        sort_order: c.sort_order || 0,
      })),
    };
  }

  // Admin Preview only: load the LIVE catalog so the preview reflects the real
  // current menu, never the bundled demo. restaurant/settings still come from
  // the Admin parent via postMessage. On any error, degrade to an empty catalog
  // plus a preview-only notice — demo products are never shown as if real.
  async function loadPreviewCatalog() {
    _previewCatalogFailed = false;
    if (!isSupabaseConfigured()) {
      // No live backend configured: the bundled config IS this site's real
      // content, so keeping the bundled PRODUCTS is accurate, not misleading.
      _previewCategories  = (typeof SHOP !== 'undefined' && Array.isArray(SHOP.categories))
        ? SHOP.categories : [];
      _previewCatalogBase = Array.isArray(window.PRODUCTS) ? window.PRODUCTS : [];
      return;
    }
    const base = SUPABASE_URL + '/rest/v1';
    const h = { 'apikey': SUPABASE_ANON_KEY };
    try {
      const catalog = await fetchCatalog(base, h);
      window.PRODUCTS     = catalog.products;
      _previewCatalogBase = catalog.products;
      _previewCategories  = catalog.categories;
    } catch (e) {
      console.warn('[app.js] preview catalog load failed:', e);
      _previewCatalogFailed = true;
      window.PRODUCTS     = [];
      _previewCatalogBase = [];
      _previewCategories  = [];
    }
  }

  // ── ADMIN PREVIEW: unsaved catalog overlay ────────────────────────
  // Only reached under ?adminPreview=1. Merges Admin's whitelisted per-row
  // patches (and new draft rows) over the pristine live catalog and returns
  // NEW arrays. Unavailable products are dropped, exactly as the public catalog
  // query (available=eq.true) already does. Never mutates the base. A normal
  // visitor never has a draft, so the overlay is a pass-through.
  var PRODUCT_PATCH_FIELDS  = ['name_en', 'name_ar', 'description_en', 'description_ar',
    'price', 'image_url', 'available', 'featured', 'category_id', 'sort_order'];
  var CATEGORY_PATCH_FIELDS = ['name_en', 'name_ar', 'sort_order'];
  var RE_DRAFT_ID    = /^draft:[A-Za-z0-9_-]{1,64}$/;
  var RE_DRAFTCAT_ID = /^draftcat:[A-Za-z0-9_-]{1,64}$/;

  function normChildRows(rows, fields, draftRe) {
    if (!Array.isArray(rows)) return [];
    var out = [];
    rows.forEach(function (row) {
      if (!row || typeof row !== 'object') return;
      var id = String(row.id == null ? '' : row.id).trim();
      if (!id) return;
      var isDraft = draftRe.test(id);
      var src = (row.patch && typeof row.patch === 'object') ? row.patch : {};
      var patch = {};
      fields.forEach(function (k) {
        if (!Object.prototype.hasOwnProperty.call(src, k)) return;
        var v = src[k];
        if (k === 'available' || k === 'featured') patch[k] = (v === true);
        else if (k === 'sort_order') { var n = parseInt(v, 10); if (isFinite(n)) patch[k] = n; }
        else patch[k] = (v == null ? '' : String(v));
      });
      out.push({ id: id, isDraft: isDraft, patch: patch });
    });
    return out;
  }
  function normChildCatalogDraft(d) {
    if (!d || typeof d !== 'object') return null;
    var products   = normChildRows(d.products,   PRODUCT_PATCH_FIELDS,  RE_DRAFT_ID);
    var categories = normChildRows(d.categories, CATEGORY_PATCH_FIELDS, RE_DRAFTCAT_ID);
    if (!products.length && !categories.length) return null;
    return { products: products, categories: categories };
  }

  function previewCatById(id) {
    if (id == null || id === '' || !Array.isArray(_previewCategories)) return null;
    var want = String(id);
    for (var i = 0; i < _previewCategories.length; i++) {
      var c = _previewCategories[i];
      if (c && String(c.id) === want) return c;
    }
    return null;
  }

  // Live categories + Admin's unsaved category overlay, merged by id and sorted
  // by sort_order. Draft categories (draftcat:<id>) are appended. Shape matches
  // fetchCatalog(): { id, slug, nameAr, nameEn, sort_order }. A draft category
  // carries an empty slug — it never produces a public filter tab on its own
  // (the tab list is derived from slugs present on available products).
  function previewCategoriesMerged() {
    var base = Array.isArray(_previewCategories) ? _previewCategories : [];
    var draft = _previewCatalogDraft;
    var rows = draft && draft.categories ? draft.categories : [];
    if (!rows.length) return base.slice();

    var baseIds = {};
    base.forEach(function (c) { if (c && c.id != null) baseIds[String(c.id)] = 1; });
    var patchById = {}, adds = [];
    rows.forEach(function (row) {
      if (row.isDraft && !baseIds[row.id]) adds.push(row);
      else if (baseIds[row.id]) patchById[row.id] = row.patch;
    });

    var out = base.map(function (c) {
      var patch = (c && c.id != null) ? patchById[String(c.id)] : null;
      if (!patch) return c;
      return {
        id: c.id, slug: c.slug,
        nameEn:     ('name_en' in patch)    ? patch.name_en    : c.nameEn,
        nameAr:     ('name_ar' in patch)    ? patch.name_ar    : c.nameAr,
        sort_order: ('sort_order' in patch) ? patch.sort_order : (c.sort_order || 0),
      };
    });
    adds.forEach(function (row) {
      out.push({
        id: row.id, slug: '',
        nameEn: row.patch.name_en || '', nameAr: row.patch.name_ar || '',
        sort_order: ('sort_order' in row.patch) ? row.patch.sort_order : 9999,
      });
    });
    out.sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });
    return out;
  }

  function blankPreviewProduct(id) {
    return {
      id: id, name: '', nameEn: '', description: '', descriptionEn: '',
      price: '', category: '', image: '', featured: false, available: true,
      sort_order: 0, _catNameAr: '', _catNameEn: '',
    };
  }
  function mergeProductPatch(baseProduct, patch) {
    var m = {};
    for (var k in baseProduct) {
      if (Object.prototype.hasOwnProperty.call(baseProduct, k)) m[k] = baseProduct[k];
    }
    if ('name_en' in patch)        m.nameEn        = patch.name_en;
    if ('name_ar' in patch)        m.name          = patch.name_ar;
    if ('description_en' in patch) m.descriptionEn = patch.description_en;
    if ('description_ar' in patch) m.description   = patch.description_ar;
    if ('price' in patch)          m.price         = patch.price;
    if ('image_url' in patch)      m.image         = patch.image_url;
    if ('available' in patch)      m.available     = patch.available;
    if ('featured' in patch)       m.featured      = patch.featured;
    if ('sort_order' in patch)     m.sort_order    = patch.sort_order;
    if ('category_id' in patch) {
      var cat = previewCatById(patch.category_id);
      m.category   = cat ? cat.slug   : '';
      m._catNameAr = cat ? cat.nameAr : '';
      m._catNameEn = cat ? cat.nameEn : '';
    }
    return m;
  }
  function previewProducts() {
    var baseArr = Array.isArray(_previewCatalogBase) ? _previewCatalogBase
      : (Array.isArray(window.PRODUCTS) ? window.PRODUCTS : []);
    var draft = _previewCatalogDraft;
    var pRows = draft && draft.products ? draft.products : [];
    var cRows = draft && draft.categories ? draft.categories : [];
    if (!pRows.length && !cRows.length) return baseArr.slice();

    // Category rename/reorder overlay → the product's displayed category name
    // (badge) must follow, without rewriting any product row.
    var catBySlug = {};
    previewCategoriesMerged().forEach(function (c) { if (c && c.slug) catBySlug[c.slug] = c; });
    function refreshCatNames(p) {
      var c = (p && p.category) ? catBySlug[p.category] : null;
      if (!c) return p;
      var en = c.nameEn || '', ar = c.nameAr || '';
      if (p._catNameEn === en && p._catNameAr === ar) return p;
      var m = {};
      for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) m[k] = p[k];
      m._catNameEn = en; m._catNameAr = ar;
      return m;
    }

    var baseIds = {};
    baseArr.forEach(function (p) { if (p && p.id != null) baseIds[String(p.id)] = 1; });
    var patchById = {}, adds = [];
    pRows.forEach(function (row) {
      if (row.isDraft && !baseIds[row.id]) adds.push(row);
      else if (baseIds[row.id]) patchById[row.id] = row.patch;
      // unknown non-draft id → ignored
    });

    var out = [];
    baseArr.forEach(function (p) {
      var patch = (p && p.id != null) ? patchById[String(p.id)] : null;
      var merged = patch ? mergeProductPatch(p, patch) : p;
      if (merged.available === false) return;   // hidden — real public rule
      out.push(refreshCatNames(merged));
    });
    adds.forEach(function (row) {
      var np = mergeProductPatch(blankPreviewProduct(row.id), row.patch);
      if (np.available === false) return;
      out.push(refreshCatNames(np));
    });

    out.sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });
    return out;
  }

  // ── LOADING OVERLAY ───────────────────────────────────────────────
  var _loadEl = null;
  function showLoading() {
    if (_loadEl || document.body.dataset.page === 'error') return;
    _loadEl = document.createElement('div');
    _loadEl.setAttribute('aria-live', 'polite');
    _loadEl.setAttribute('role', 'status');
    _loadEl.style.cssText =
      'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
      'background:var(--bg,#0e0d0b);z-index:9000;gap:6px';
    for (var i = 0; i < 3; i++) {
      var dot = document.createElement('div');
      dot.style.cssText =
        'width:8px;height:8px;border-radius:50%;background:var(--accent,#c9a84c);' +
        'animation:dotPulse 1.2s ease-in-out ' + (i * 0.2) + 's infinite';
      _loadEl.appendChild(dot);
    }
    // Keyframes (injected once)
    if (!document.getElementById('_dotStyle')) {
      var s = document.createElement('style');
      s.id = '_dotStyle';
      s.textContent = '@keyframes dotPulse{0%,100%{opacity:.3;transform:scaleY(1)}50%{opacity:.9;transform:scaleY(.6)}}';
      document.head.appendChild(s);
    }
    document.body.appendChild(_loadEl);
  }
  function hideLoading() {
    if (_loadEl) { _loadEl.remove(); _loadEl = null; }
  }

  function showAppError(msg) {
    hideLoading();
    var el = document.createElement('div');
    el.style.cssText =
      'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
      'background:var(--card-bg,#1e1c18);color:var(--text-muted,#9a9585);' +
      'padding:28px 36px;border-radius:12px;text-align:center;font-size:14px;' +
      'border:1px solid var(--border,#3a3529);max-width:340px;line-height:1.7;' +
      // Above BOTH the Portal FX layer (100000) and the plain safety cover
      // (99999, css/style.css) — on a failed INTERNAL navigation those are
      // still mid fade-out when this appears (finishPageEntry() below
      // releases them), and this notice must be immediately, unambiguously
      // visible rather than waiting behind that animation (1O.1 §3/§5).
      'z-index:200000';
    el.innerHTML = '<div style="font-size:28px;margin-bottom:12px">⚠</div>' + msg;
    // Small, safe (own DOM node + addEventListener, no inline handler),
    // clickable way to act on "please refresh" beyond waiting for the
    // visitor to find their browser's own reload control (1O.1 §4).
    var retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = '↻ Refresh / تحديث';
    retry.style.cssText =
      'margin-top:16px;padding:8px 20px;border-radius:999px;border:none;' +
      'background:var(--accent,#d4af65);color:#1a1710;font-weight:600;' +
      'font-size:13px;cursor:pointer;font-family:inherit';
    retry.addEventListener('click', function () { window.location.reload(); });
    el.appendChild(retry);
    document.body.appendChild(el);
  }

  // ── LANGUAGE HELPERS ──────────────────────────────────────────────
  function getLang() {
    var fallback = (typeof SHOP_SETTINGS !== 'undefined' ? SHOP_SETTINGS.defaultLanguage : 'ar');
    if (PREVIEW) return _previewLang || fallback;   // preview never reads shared storage
    return localStorage.getItem('souqsite_language') || fallback;
  }

  function t(key) {
    if (typeof TRANSLATIONS === 'undefined') return null;
    const lang  = getLang();
    const parts = key.split('.');
    let val = TRANSLATIONS[lang];
    for (const p of parts) val = val?.[p];
    return typeof val === 'string' ? val : null;
  }

  function shopName(lang) {
    if (typeof SHOP === 'undefined') return '';
    return lang === 'ar' ? SHOP.name : (SHOP.nameEn || SHOP.name);
  }
  function shopTagline(lang) {
    if (typeof SHOP === 'undefined') return '';
    return lang === 'ar' ? SHOP.tagline : (SHOP.taglineEn || SHOP.tagline);
  }
  function shopDesc(lang) {
    if (typeof SHOP === 'undefined') return '';
    return lang === 'ar' ? SHOP.description : (SHOP.descriptionEn || SHOP.description);
  }
  function shopAddr(lang) {
    if (typeof SHOP === 'undefined' || !SHOP.address) return '';
    // Cross-language fallback, matching shopName/shopTagline/shopDesc.
    return lang === 'ar'
      ? (SHOP.address.ar || SHOP.address.en || '')
      : (SHOP.address.en || SHOP.address.ar || '');
  }
  function shopHours(lang, type) {
    if (typeof SHOP === 'undefined' || !SHOP.hours) return '';
    if (lang === 'ar') return SHOP.hours[type + 'Ar'] || SHOP.hours[type] || '';
    return SHOP.hours[type] || SHOP.hours[type + 'Ar'] || '';
  }

  // Returns the display label for a category slug in the given language.
  function getCatLabel(slug, lang) {
    if (typeof SHOP !== 'undefined' && SHOP.categories) {
      const found = SHOP.categories.find(c => c.slug === slug);
      if (found) return lang === 'ar' ? (found.nameAr || found.nameEn) : (found.nameEn || found.nameAr);
    }
    return capitalize(slug);
  }

  // ── SET LANGUAGE ─────────────────────────────────────────────────
  // Normal site: a brief opacity dip hides the text/direction swap instead of
  // a hard flash (§24 of 1N) — purely decorative, ~90ms, skipped entirely
  // under reduced motion. Admin Preview keeps the exact original synchronous
  // timing (the parent's live editor depends on it) — no fade, ever.
  function setLanguage(lang) {
    if (PREVIEW) {
      // Real in-iframe language control: update locally AND report up so the
      // Admin preview-language selector stays in sync. Never touches storage.
      _previewLang = lang;
      parentPost({ type: 'PREVIEW_LANGUAGE_CHANGE', lang: lang });
      applyLanguageNow(lang);
      return;
    }
    localStorage.setItem('souqsite_language', lang);
    if (reducedMotion()) { applyLanguageNow(lang); return; }
    document.body.classList.add('lang-fade');
    setTimeout(function () {
      applyLanguageNow(lang);
      requestAnimationFrame(function () { document.body.classList.remove('lang-fade'); });
    }, 90);
  }
  function applyLanguageNow(lang) {
    document.documentElement.lang = lang;
    document.documentElement.dir  = lang === 'ar' ? 'rtl' : 'ltr';
    applyTranslations(lang);
    applyShopContent(lang);
    applyOgTags();
    updateWaLinks();
    syncSoundBtn();   // accessible label is language-specific (§5 of 1N)
    const page = document.body.dataset.page;
    if (page === 'home')     refreshHighlights(lang);
    if (page === 'products') refreshFilterLabels(lang);
    if (page === 'location') {
      setText('loc-address',  shopAddr(lang));
      setText('loc-weekdays', shopHours(lang, 'weekdays'));
      setText('loc-weekends', shopHours(lang, 'weekends'));
      applyLocationVisual(lang);
    }
    if (page === 'contact') {
      setText('contact-hours', shopHours(lang, 'weekdays') + '  ·  ' + shopHours(lang, 'weekends'));
    }
  }

  function applyTranslations(lang) {
    if (typeof TRANSLATIONS === 'undefined') return;
    const tr = TRANSLATIONS[lang];
    document.querySelectorAll('[data-t]').forEach(el => {
      const parts = el.dataset.t.split('.');
      let val = tr;
      for (const p of parts) val = val?.[p];
      if (typeof val === 'string') el.textContent = val;
    });
    document.querySelectorAll('.lang-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.lang === lang);
    });
  }

  function applyShopContent(lang) {
    if (typeof SHOP === 'undefined') return;
    const name = shopName(lang);
    setText('nav-logo',    name);
    applyNavLogo(lang);
    setText('footer-logo', name);
    setText('footer-name', name);
    setText('footer-tag',  shopTagline(lang));
    setText('hero-name',   name);
    setText('hero-tagline', shopTagline(lang));
    setText('about-desc',  shopDesc(lang));

    const pageLabel = {
      products: t('nav.products'),
      location: t('nav.location'),
      contact:  t('nav.contact'),
    }[document.body.dataset.page];
    document.title = pageLabel
      ? `${pageLabel} | ${name}`
      : `${name} — ${shopTagline(lang)}`;
    setMeta('description', shopDesc(lang).slice(0, 160));
  }

  // Renders the restaurant logo image in the nav brand area when SHOP.logo
  // is set. Falls back silently to text-only branding when it is empty or
  // the image fails to load. DOM APIs only — never innerHTML.
  function applyNavLogo(lang) {
    const img = document.getElementById('nav-logo-img');
    if (!img) return;
    const url = (typeof SHOP !== 'undefined' && SHOP.logo != null)
      ? String(SHOP.logo).trim()
      : '';
    if (!url) {
      img.hidden = true;
      img.removeAttribute('src');
      return;
    }
    const name = shopName(lang);
    img.alt = name ? name + ' logo' : 'Restaurant logo';
    if (img.getAttribute('src') !== url) {
      img.onload  = function () { img.hidden = false; };
      img.onerror = function () { img.hidden = true; img.removeAttribute('src'); };
      img.src = url;
    }
  }

  // ── OPEN GRAPH ────────────────────────────────────────────────────
  function applyOgTags() {
    if (typeof SHOP === 'undefined') return;
    const lang = getLang();
    setOg('og:title',       shopName(lang) + ' — ' + shopTagline(lang));
    setOg('og:description', shopDesc(lang).slice(0, 160));
    setOg('og:url',         window.location.href);
    if (SHOP.hero && SHOP.hero.image) {
      const src    = SHOP.hero.image;
      const imgUrl = src.startsWith('http') ? src : new URL(src, window.location.href).href;
      setOg('og:image', imgUrl);
    }
  }
  function setOg(property, content) {
    let el = document.querySelector('meta[property="' + property + '"]');
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute('property', property);
      document.head.appendChild(el);
    }
    if (content) el.setAttribute('content', content);
  }

  // ── WHATSAPP ──────────────────────────────────────────────────────
  function waLink() {
    if (typeof SHOP === 'undefined') return '#';
    // Prefer the restaurant's live DB message for the active language; fall
    // back to the existing static translation when that message is
    // missing / blank / whitespace-only.
    const lang  = getLang();
    const dbMsg = SHOP.social
      ? (lang === 'ar' ? SHOP.social.whatsappMessage : SHOP.social.whatsappMessageEn)
      : '';
    const msg = (typeof dbMsg === 'string' && dbMsg.trim())
      ? dbMsg
      : (t('wa.message') || '');
    return 'https://wa.me/' + SHOP.whatsapp + '?text=' + encodeURIComponent(msg);
  }
  function updateWaLinks() {
    const url = waLink();
    document.querySelectorAll('[data-wa-link]').forEach(el => {
      el.href = url;
      // Same-tab navigation away from the site was cutting the tap sound off
      // mid-tone (the document unloads before the ~90ms clip finishes) — the
      // most-clicked customer CTA was effectively silent. Opening WhatsApp in
      // its own tab fixes that AND keeps the visitor's place on the site.
      el.target = '_blank';
      el.rel = 'noopener noreferrer';
    });
  }

  // ── PAGE TRANSITIONS ("TasteTheWest Portal", JS-timed marker) ────────
  // This class pair (is-page-leaving / is-page-entering) is PURELY the
  // routing/timing marker — as of milestone 1N v4, language correctness
  // (no untranslated-English frame) is no longer this mechanism's job at
  // all. See the separate, independent "I18N PRE-PAINT GUARD" section
  // below for the actual correctness fix. The no-3-dot-loader behaviour is
  // still owned here (via arrivedSilently / preparePageEntry), since that
  // genuinely is about the transition marker's presence, not the language.
  // As of 1N v6, style.css reacts to these same two classes across TWO
  // coordinated visual layers — a plain html-level safety cover (correctness
  // backstop, reaches full opacity only in the last instant before the
  // document swap) and the richer #page-transition-fx "Portal" layer
  // (dark-glass plates, gold rails, energy seam — the actual premium visual,
  // see style.css). One marker, one routing architecture, never two.
  // Reduced motion is NOT "skip the transition" (1N-v5.1 §7/§17) — it uses
  // the exact same architecture below (marker, preventDefault, class,
  // timed navigate), just a shorter delay and an opacity-only CSS
  // treatment for both layers under that media query. Every visitor gets
  // an intentional branded hand-off; there is exactly one routing system.
  var pageTransitioning = false;   // one-way lock — this document is unloading, never reset...

  // ...EXCEPT when this exact document is restored from BFCache (§13/§30).
  // BFCache freezes and thaws the entire JS heap as-is, so `pageTransitioning`
  // would otherwise come back stuck `true` forever, silently swallowing
  // every click on this page from then on — that part still needs
  // resetting here (this closure owns it; the <head> script has no access
  // to it). Portal CSS classes are deliberately NOT touched here anymore
  // (1P.3): the <head> script's OWN pageshow listener now drives a real
  // sealed→open animation on a persisted restore (see that listener for
  // the full BFCache pre-seal/open-on-restore design) by ADDING
  // `is-page-entering` and removing it two rAFs later — if this listener
  // also unconditionally stripped `is-page-entering` here, in the same
  // synchronous tick, it would erase that class before a single frame
  // painted it, silently breaking the whole mechanism. `is-page-leaving`
  // still gets defensively cleared here as a last-resort backstop in case
  // the head script's own handling was ever bypassed (e.g. a very old
  // cached document from before this class existed) — no non-obvious
  // Portal effect, since without `is-page-leaving` the plates/wave are
  // simply back at their normal idle (invisible) state.
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    pageTransitioning = false;
    document.documentElement.classList.remove('is-page-leaving');
  });

  // Same-tab, same-origin, one of the 4 known public pages, no modifier key,
  // no target=_blank, not a download link. Reuses previewPageForHref()'s
  // pathname-based resolution (never fragile raw-href string matching) so
  // '/', './', 'index.html' and an absolute URL all resolve identically.
  function isPublicInternalNavigation(link, ev) {
    if (PREVIEW) return false;   // §33 — Admin Preview never intercepts page nav
    if (!link || link.tagName !== 'A') return false;
    if (link.target && link.target !== '_self') return false;
    if (link.hasAttribute('download')) return false;
    if (ev && (ev.defaultPrevented || ev.button !== 0 ||
        ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey)) return false;
    return !!previewPageForHref(link.getAttribute('href'));
  }

  // 1P.9 §10 — is this internal link's destination the page already on
  // screen? Compares resolved pathnames (basename only, matching
  // previewPageForHref()'s own resolution so '/', './' and 'index.html'
  // agree). A real hash or query string on the LINK itself is treated as
  // an intentional, different destination and never suppressed — this only
  // catches the plain "click Home while already on Home" case.
  function isSamePublicPageHref(hrefAttr) {
    try {
      var dest = new URL(hrefAttr, location.href);
      if (dest.hash || dest.search) return false;
      var destBase = dest.pathname.split('/').pop() || 'index.html';
      var curBase = location.pathname.split('/').pop() || 'index.html';
      return destBase === curBase;
    } catch (e) { return false; }
  }

  // Close duration + SEALED HOLD, for each motion mode — MUST stay in sync
  // with the matching values in css/style.css (the curtains' transition
  // duration + html.is-page-leaving::before's delay/duration), and the
  // delay below MUST be >= the CSS close transition or the document would
  // unload mid-animation, cutting it off before it visibly finishes — the
  // exact mistake that made v3-v5's animation unreadable. Normal motion:
  // .65s close + 70ms hold = 720ms (1P.4 rebuild §10). Reduced motion
  // (1P.6): the curtains now ACTUALLY TRAVEL under reduced motion too
  // (§1 — the previous `transform: none !important` that pinned them
  // permanently center-sealed was the 1P.5 root cause), just on a
  // shorter, simpler timeline — .33s close + 40ms hold = 370ms. Still
  // deliberately shorter than normal motion (less motion, less time, not
  // an added wait), just no longer near-instant, since the travel itself
  // is now essential rather than decorative.
  var CLOSE_MS_NORMAL = 650, HOLD_MS_NORMAL = 70;
  var CLOSE_MS_REDUCED = 330, HOLD_MS_REDUCED = 40;

  // Close the Portal, then navigate. A plain timeout, not an
  // animationend/transitionend listener: an event that might not fire is
  // exactly the kind of fragility that broke the very first attempt.
  function beginPageExit(url, ev) {
    if (pageTransitioning) { if (ev) ev.preventDefault(); return; }   // §14/§44 — ignore rapid re-clicks
    pageTransitioning = true;
    try { sessionStorage.setItem('ttw_page_transition', '1'); } catch (e) {}
    if (ev) ev.preventDefault();
    document.documentElement.classList.add('is-page-leaving');
    // 1Q.1 — the Portal sound REPLACES the generic 'tap' click sound for a
    // genuine navigation (the click handler skips 'tap' for this branch —
    // see the delegated listener); gated by the SAME pageTransitioning
    // lock above, so a rapid re-click can never double it, no separate
    // debounce needed. Deferred one rAF past the class add: adding
    // is-page-leaving synchronously here invalidates style, but the CSS
    // transition it triggers doesn't visually start interpolating until
    // the browser's NEXT style/paint pass — starting the audio in the
    // same synchronous tick as the class add would make it begin one
    // frame BEFORE the curtains actually move. One rAF (not a guessed
    // delay) aligns the audio's scheduled start with that same next
    // frame — real frame timing, not an assumption.
    requestAnimationFrame(function () { playPortalTransitionSound(); });
    var delay = reducedMotion() ? (CLOSE_MS_REDUCED + HOLD_MS_REDUCED) : (CLOSE_MS_NORMAL + HOLD_MS_NORMAL);
    setTimeout(function () { window.location.href = url; }, delay);
  }

  // Called once this document's own content is ready to be seen (end of
  // boot()). No-ops instantly if this load did not arrive via an intercepted
  // internal link (see the <head> script) — a normal direct/cold load never
  // engages this at all. preparePageEntry() is a cheap read, safe to call
  // any time.
  function preparePageEntry() {
    return document.documentElement.classList.contains('is-page-entering');
  }
  function finishPageEntry() {
    document.documentElement.classList.remove('is-page-entering');
  }

  // ── 1P.9 — SINGLE DESTINATION-READY GATE ─────────────────────────────
  // The only place in this file allowed to reveal the destination (remove
  // is-page-entering, which is what starts the curtain-open CSS
  // transition) — every boot() path below calls THIS, never
  // finishPageEntry() directly, so there is exactly one owner of "the
  // Portal is allowed to open now" (no competing timers/listeners for the
  // fresh-parse path; the <head> script's own BFCache pageshow handler is
  // a separate, already-instant-ready case — see its own comment there).
  // No-ops immediately if this load never arrived via a transition
  // (preparePageEntry() false) — identical to the old direct-call behavior
  // for a cold/direct load.
  //
  // Real-browser diagnostic evidence (1P.9 milestone) showed the safety
  // cover (html::before) fading out in the SAME instant the curtains
  // started their ~650-720ms open transition, and the destination content
  // being revealed with no guaranteed prior paint — both are symptoms of
  // the old code calling finishPageEntry() synchronously, in the same tick
  // as renderShell()/initReveal(), with nothing forcing the browser to
  // actually PAINT the rendered destination before starting the visible
  // open animation. Two rAFs force that paint to happen first (same
  // technique already used, and proven safe in real-browser testing, by
  // the <head> script's BFCache restore path) — both frames are invisible
  // regardless, since the curtains are still 100% sealed throughout.
  //
  // is-page-sealed and is-page-entering are then cleared TOGETHER, not
  // split across a further rAF — measured evidence during this milestone
  // (headless, both motion modes, all 4 pages, warm/cold/slow paths) found
  // curtain geometry identically ~100% sealed (topEdge.bottom ≈ 450) at
  // the instant of EITHER removal regardless of ordering, because the
  // curtain's own position/transition only ever depends on is-page-entering
  // — is-page-sealed clearing one frame earlier or in the same frame is
  // equally invisible either way (still fully covered by the curtain, a
  // z-index above the safety cover). A separating rAF was tried first, but
  // on heavier pages/paths (a full product grid render, a real network
  // fetch just having completed) it measured up to ~200ms of pure added
  // delay for zero visual benefit — exactly the "over-engineered guessed
  // wait" §12 of the brief warns against. This costs 2 frames (~16-35ms)
  // total, not 3.
  function revealDestination() {
    if (!preparePageEntry()) return;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        document.documentElement.classList.remove('is-page-sealed');
        finishPageEntry();
      });
    });
  }

  // ── I18N PRE-PAINT GUARD ─────────────────────────────────────────────
  // Independent of the aperture above, and NOT motion-gated (milestone 1N
  // v4, §33 — this must hold even with animation fully disabled). The <head>
  // script (see index.html) adds `i18n-pending` to <html> whenever the
  // persisted/default language is Arabic — for EVERY load that could show
  // it, transition or cold, direct or refreshed — and style.css holds `body`
  // at `visibility: hidden` while the class is present. `visibility` is a
  // boolean, non-composited property: unlike the aperture's `transform`,
  // there is no GPU layer-promotion window where a stale frame could slip
  // through, which is the exact gap real-browser testing found in the
  // aperture-only v3 design. English never sets this class at all — its
  // static fallback text already IS correct (§7 — no penalty).
  // Released ONLY after renderShell() has applied real translations for the
  // shell currently on screen — see every call site in boot() below. If
  // js/app.js fails to run at all, style.css's own failsafe animation reveals
  // the page after a few seconds rather than trapping the visitor forever
  // (§32) — this function is never involved in that path.
  function releaseI18nGuard() {
    document.documentElement.classList.remove('i18n-pending');
  }

  // ── SAME-SESSION PUBLIC-DATA HANDOFF ────────────────────────────────
  // Audited: every public page currently re-fetches the FULL restaurant row
  // + categories + products on every load, even for a page it was on 30
  // seconds ago. That repeated round-trip is exactly the window the visitor
  // perceives as "loading" between pages. This is a short-lived, PUBLIC-ONLY,
  // self-revalidating cache — never a substitute for showing live data, only
  // for not making the visitor wait for it on every click.
  //   - Session-only (sessionStorage), not persisted across browser restarts.
  //   - Only ever the same fields already rendered to every visitor publicly
  //     (restaurant row + catalog) — no auth, no session, no admin data.
  //   - Keyed to RESTAURANT_ID + a timestamp; ignored once stale or from a
  //     different restaurant.
  //   - ALWAYS revalidated against Supabase in the background immediately
  //     after being used, and the page re-renders if anything actually
  //     changed — this is instant-perceived-navigation, not an offline menu.
  //   - Never read or written under PREVIEW (§33): the Admin iframe's
  //     window.SHOP/PRODUCTS are the Admin's unsaved DRAFT overlay, not real
  //     public data, and must never be written into (or read from) this key.
  var SNAPSHOT_KEY = 'ttw_public_snapshot';
  var SNAPSHOT_MAX_AGE_MS = 60000;   // 60s — "instant navigation", not stale caching
  function saveSnapshot() {
    if (PREVIEW || !isSupabaseConfigured()) return;
    try {
      sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify({
        rid: RESTAURANT_ID,
        t: Date.now(),
        shop: window.SHOP,
        products: window.PRODUCTS,
      }));
    } catch (e) { /* storage full / unavailable — snapshot is an optimisation, not a requirement */ }
  }
  function readSnapshot() {
    if (PREVIEW || !isSupabaseConfigured()) return null;
    try {
      var raw = sessionStorage.getItem(SNAPSHOT_KEY);
      if (!raw) return null;
      var snap = JSON.parse(raw);
      if (!snap || snap.rid !== RESTAURANT_ID) return null;
      if (typeof snap.t !== 'number' || Date.now() - snap.t > SNAPSHOT_MAX_AGE_MS) return null;
      if (!snap.shop || !Array.isArray(snap.products)) return null;
      return snap;
    } catch (e) { return null; }
  }

  // ── LIGHTWEIGHT HTML PREFETCH ────────────────────────────────────────
  // By the time a visitor clicks Menu/Location/Contact, the destination's
  // static HTML (and, from the second navigation on, its data — see the
  // snapshot above) is very likely already sitting in cache. `rel=prefetch`
  // is a low-priority hint — it never competes with the current page's own
  // critical resources — so this is safe to fire once the page is settled.
  var PUBLIC_PAGES = ['index.html', 'products.html', 'location.html', 'contact.html'];
  var _prefetched = {};
  function prefetchHref(href) {
    if (!href || _prefetched[href]) return;
    _prefetched[href] = true;
    try {
      var l = document.createElement('link');
      l.rel = 'prefetch';
      l.href = href;
      document.head.appendChild(l);
    } catch (e) {}
  }
  function prefetchOtherPublicPages() {
    if (PREVIEW) return;
    var pageMap = { home: 'index.html', products: 'products.html', location: 'location.html', contact: 'contact.html' };
    var current = pageMap[document.body.dataset.page] || 'index.html';
    PUBLIC_PAGES.forEach(function (f) { if (f !== current) prefetchHref(f); });
  }
  // Intent prefetch (§15 — optional, kept small): the FIRST time the pointer
  // enters or keyboard focus lands on an internal nav link, prefetch that one
  // destination. `_prefetched` already de-dupes repeated hovers/focus.
  function wireIntentPrefetch() {
    function onIntent(e) {
      var a = e.target.closest && e.target.closest('a');
      if (a && isPublicInternalNavigation(a)) prefetchHref(a.getAttribute('href'));
    }
    document.addEventListener('pointerenter', onIntent, true);   // capture — pointerenter doesn't bubble
    document.addEventListener('focusin', onIntent);
    document.addEventListener('touchstart', onIntent, { passive: true, capture: true });   // §9 — mobile has no hover
  }

  // ── NAVIGATION ────────────────────────────────────────────────────
  function initNav() {
    const header = document.getElementById('site-header');
    const toggle = document.getElementById('nav-toggle');
    const mobile = document.getElementById('nav-mobile');
    if (!header) return;

    wireIntentPrefetch();

    const isHome = document.body.dataset.page === 'home';
    header.classList.add(isHome ? 'transparent' : 'scrolled');

    window.addEventListener('scroll', () => {
      if (window.scrollY > 60) {
        header.classList.remove('transparent');
        header.classList.add('scrolled');
      } else if (isHome) {
        header.classList.remove('scrolled');
        header.classList.add('transparent');
      }
    }, { passive: true });

    if (toggle && mobile) {
      toggle.addEventListener('click', () => {
        const open = mobile.classList.toggle('open');
        toggle.classList.toggle('open', open);
        toggle.setAttribute('aria-expanded', String(open));
      });
      mobile.querySelectorAll('.nav-link').forEach(l => {
        l.addEventListener('click', () => {
          mobile.classList.remove('open');
          toggle.classList.remove('open');
          toggle.setAttribute('aria-expanded', 'false');
        });
      });
    }

    const pageMap = { home: 'index.html', products: 'products.html', location: 'location.html', contact: 'contact.html' };
    const file    = pageMap[document.body.dataset.page];
    document.querySelectorAll('.nav-link').forEach(l => {
      l.classList.toggle('active', l.getAttribute('href') === file);
    });

    initSoundBtn();

    document.addEventListener('click', e => {
      const btn = e.target.closest('.lang-btn');
      if (btn && btn.dataset.lang) { setLanguage(btn.dataset.lang); playUISound('toggle'); }
    });

    // ONE delegated tap path (§8/§9 of 1N) — real customer controls only:
    // header + mobile nav, category filters, primary CTA buttons, WhatsApp
    // buttons (inline + floating), Location/Contact links styled as
    // controls. Never for plain body text links, typing, or scrolling.
    // Language / the sound button itself each report their own
    // `toggle` sound above (state-flip controls, not a plain tap) — kept out
    // of this list so a click on them can never double-sound.
    // A same-origin link to one of the 4 public pages ALSO begins the
    // branded page-transition cover here — same click, same one sound, per
    // §15 of the 1N-v2 redo ("do not play two navigation sounds"). 1Q: for
    // a GENUINE (different-page) Portal navigation that one sound is now
    // the swoosh, not 'tap' — played from inside beginPageExit() itself —
    // so 'tap' is skipped for that branch only; every other match on this
    // selector (filters, WhatsApp, same-page clicks, external/staff links,
    // anything isPublicInternalNavigation() doesn't accept) keeps 'tap'
    // exactly as before.
    document.addEventListener('click', e => {
      const hit = e.target.closest('.btn, .filter-btn, .nav-toggle, .nav-link, .wa-float');
      if (!hit) return;
      if (isPublicInternalNavigation(hit, e) && !isSamePublicPageHref(hit.getAttribute('href'))) {
        beginPageExit(hit.href, e);
        return;
      }
      playUISound('tap');
      if (isPublicInternalNavigation(hit, e)) {
        // 1P.9 §10 — clicking the page already on screen must never
        // close/reload/reopen the Portal over itself.
        e.preventDefault();
      }
    }, true);
  }

  // ── HOME PAGE ──────────────────────────────────────────────────────
  // Hero scroll cue: click/tap smoothly scrolls to whatever section
  // actually follows the hero (not a hardcoded id, so this keeps working
  // if that section is ever reordered/renamed), fades out once the
  // visitor has meaningfully scrolled, and honours the visitor's real
  // motion preference for the scroll itself (the cue's own idle bounce is
  // already handled by the site-wide reduced-motion CSS rule). Runs
  // independently of SHOP data readiness — pure UI chrome.
  function initHeroScrollCue() {
    const cue = document.getElementById('hero-scroll-cue');
    const hero = document.getElementById('hero');
    if (!cue || !hero) return;
    cue.addEventListener('click', function () {
      // Skip past any sibling that's display:none — About, for one, hides
      // itself entirely (applyAboutVisibility()) whenever the owner hasn't
      // given it real content, and scrollIntoView() on a display:none
      // element is a silent no-op (zero box to scroll to), which would
      // otherwise make the cue appear to do nothing.
      let next = hero.nextElementSibling;
      while (next && getComputedStyle(next).display === 'none') next = next.nextElementSibling;
      if (next) next.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    });
    function syncVisibility() {
      cue.classList.toggle('is-hidden', window.scrollY > 60);
    }
    window.addEventListener('scroll', syncVisibility, { passive: true });
    syncVisibility();
  }

  function initHome() {
    initHeroScrollCue();
    if (typeof SHOP === 'undefined') return;

    const heroBg = document.getElementById('hero-bg');
    if (heroBg && SHOP.hero && SHOP.hero.image) {
      heroBg.setAttribute('role', 'img');
      heroBg.setAttribute('aria-label', shopName(getLang()) + ' hero');
      const probe = new Image();
      probe.onload = () => {
        heroBg.style.backgroundImage = "url('" + SHOP.hero.image + "')";
        heroBg.classList.add('loaded');
      };
      probe.onerror = () => heroBg.classList.add('loaded'); // fade in even if image 404s
      probe.src = SHOP.hero.image;
    }

    refreshHighlights(getLang());
    applyAboutVisibility();

    if (PREVIEW && _previewCatalogFailed) {
      showPreviewCatalogNotice('featured-grid');
    } else if (typeof PRODUCTS !== 'undefined') {
      renderProductGrid(PRODUCTS.filter(p => p.featured).slice(0, 3), 'featured-grid');
    }
  }

  // A statistic counts as real content only when it is visible AND has a
  // non-blank value / label / labelAr. `visible === false` or an all-blank
  // entry never renders and never keeps the About section alive.
  function statHasContent(h) {
    if (!h || h.visible === false) return false;
    var v = h.value == null ? '' : String(h.value);
    return !!(v.trim() ||
      (typeof h.label === 'string' && h.label.trim()) ||
      (typeof h.labelAr === 'string' && h.labelAr.trim()));
  }
  // About/Our-Story text exists if EITHER language has meaningful text — the
  // site already falls back across languages, so the check is language-neutral.
  function aboutHasText() {
    if (typeof SHOP === 'undefined') return false;
    var a = SHOP.description, b = SHOP.descriptionEn;
    return !!((typeof a === 'string' && a.trim()) || (typeof b === 'string' && b.trim()));
  }
  // Content-based visibility for the whole About section (shared by the public
  // site and the Live Preview — no preview-only rule). Hides the section when it
  // would be empty; collapses to a single column when only one half has content.
  function applyAboutVisibility() {
    var section = document.getElementById('about');
    if (!section) return;
    var grid    = section.querySelector('.about-grid');
    var textCol = section.querySelector('.about-text');
    var hlGrid  = document.getElementById('hl-grid');

    var hasText  = aboutHasText();
    var hasStats = typeof SHOP !== 'undefined' && Array.isArray(SHOP.highlights) &&
      SHOP.highlights.some(statHasContent);

    if (!hasText && !hasStats) { section.style.display = 'none'; return; }
    section.style.display = '';

    if (textCol) textCol.style.display = hasText  ? '' : 'none';
    if (hlGrid)  hlGrid.style.display  = hasStats ? '' : 'none';
    if (grid) {
      grid.classList.toggle('about-grid--text-only',  hasText && !hasStats);
      grid.classList.toggle('about-grid--stats-only', !hasText && hasStats);
      // In the preview the section can appear after edits, past the point where
      // the scroll-reveal observer would fire — show it without the animation.
      if (PREVIEW) grid.classList.add('visible');
    }
    if (PREVIEW && hlGrid) hlGrid.classList.add('visible');
  }

  // Admin Preview: shown in place of a product grid when the live catalog could
  // not be loaded, so the owner never mistakes bundled demo items for real ones.
  function showPreviewCatalogNotice(containerId) {
    const grid = document.getElementById(containerId || 'featured-grid');
    if (!grid) return;
    grid.textContent = '';
    const p = document.createElement('p');
    p.style.cssText = 'color:var(--text-muted);text-align:center;padding:40px 0;font-size:14px';
    p.textContent = 'Live menu data could not be loaded for this preview.';
    grid.appendChild(p);
  }

  function refreshHighlights(lang) {
    const hlGrid = document.getElementById('hl-grid');
    if (!hlGrid || typeof SHOP === 'undefined' || !SHOP.highlights) return;
    // Owner-entered strings: build with DOM APIs + textContent (no innerHTML).
    // statHasContent keeps legacy entries (no `visible` field) but drops
    // explicit visible:false AND all-blank entries. `type` does not affect output.
    const cards = SHOP.highlights
      .filter(statHasContent)
      .map(h => {
        const card  = document.createElement('div');
        card.className = 'hl-card';
        const value = document.createElement('div');
        value.className = 'hl-value';
        value.textContent = h.value == null ? '' : String(h.value);
        const label = document.createElement('div');
        label.className = 'hl-label';
        label.textContent = lang === 'ar'
          ? (h.labelAr || h.label || '')
          : (h.label || h.labelAr || '');
        card.appendChild(value);
        card.appendChild(label);
        // In Admin Preview: each card links back to its editor card.
        if (PREVIEW && h._previewId != null) {
          card.dataset.previewId = String(h._previewId);
          card.setAttribute('role', 'button');
          card.tabIndex = 0;
          card.style.cursor = 'pointer';
          const send = function () {
            parentPost({ type: 'PREVIEW_STAT_CLICK', previewId: card.dataset.previewId });
          };
          card.addEventListener('click', send);
          card.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); send(); }
          });
        }
        return card;
      });
    hlGrid.replaceChildren(...cards);
  }

  // ── PRODUCTS PAGE ─────────────────────────────────────────────────
  // Idempotent: safe to re-run on every Admin-preview draft update. The filter
  // click handler is delegated and attached once (guarded), so re-rendering the
  // grid / rebuilding the filter buttons never stacks listeners.
  function initProducts() {
    if (typeof PRODUCTS === 'undefined') return;
    const filterBar = document.getElementById('filter-bar');
    const grid      = document.getElementById('products-grid');
    if (!grid) return;

    if (PREVIEW && _previewCatalogFailed) {
      showPreviewCatalogNotice('products-grid');
      return;
    }

    renderProductGrid(PRODUCTS, 'products-grid');

    if (filterBar) {
      buildFilterBar(filterBar, getLang());

      if (!filterBar.dataset.wired) {
        filterBar.dataset.wired = '1';
        filterBar.addEventListener('click', e => {
          const btn = e.target.closest('.filter-btn');
          if (!btn) return;
          filterBar.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const cat = btn.dataset.cat;
          let shown = 0;
          grid.querySelectorAll('.product-card').forEach(card => {
            const on = (cat === 'all' || card.dataset.cat === cat);
            card.style.display = on ? '' : 'none';
            if (on) shown++;
          });
          // A category with zero (visible) products — real for a brand-new /
          // empty category in Admin Preview. Show a clear empty state instead of
          // a blank grid; never silently fall back to All.
          let note = grid.querySelector('.filter-empty-note');
          if (shown === 0 && cat !== 'all') {
            if (!note) {
              note = document.createElement('p');
              note.className = 'filter-empty-note';
              note.style.cssText = 'grid-column:1/-1;color:var(--text-muted);text-align:center;padding:40px 0';
              grid.appendChild(note);
            }
            note.textContent = t('products.emptyCategory') || 'No menu items in this category yet.';
            note.style.display = '';
          } else if (note) {
            note.style.display = 'none';
          }
        });
      }
    }
  }

  // Internal Preview-only filter identity for a merged category. Saved category
  // → its real slug. Draft category (no slug) → a synthetic key built ONLY from
  // the validated draftcat id (never persisted, never a DB value, no arbitrary
  // user content). Empty → no tab.
  function previewFilterKey(c) {
    if (!c) return '';
    if (c.slug) return c.slug;
    var id = String(c.id == null ? '' : c.id);
    if (RE_DRAFTCAT_ID.test(id)) return '__draftcat_' + id.replace(/[^A-Za-z0-9_-]/g, '');
    return '';
  }

  // PUBLIC (PREVIEW === false): filter tabs come from the category slugs
  // actually present on rendered products — a category with no products has no
  // tab (the real customer-facing rule). Tab order follows category sort_order,
  // orphan slugs kept in product order at the end.
  // ADMIN PREVIEW (PREVIEW === true): ONE tab per KNOWN merged category (saved +
  // overlay + draft), regardless of product count, so the owner can see / edit
  // every category — including brand-new and empty ones — ordered by sort_order.
  // Built with DOM APIs + textContent — owner names never touch innerHTML.
  function buildFilterBar(filterBar, lang) {
    if (typeof PRODUCTS === 'undefined') return;

    var frag = document.createDocumentFragment();
    var allBtn = document.createElement('button');
    allBtn.className = 'filter-btn active';
    allBtn.dataset.cat = 'all';
    allBtn.textContent = t('products.filterAll') || 'All';
    frag.appendChild(allBtn);

    if (PREVIEW) {
      previewCategoriesMerged().forEach(function (c) {
        var key = previewFilterKey(c);
        if (!key) return;
        var b = document.createElement('button');
        b.className = 'filter-btn';
        b.dataset.cat = key;
        if (c.id != null && c.id !== '') b.dataset.previewCategoryId = String(c.id);
        var label = (lang === 'ar') ? (c.nameAr || c.nameEn || '') : (c.nameEn || c.nameAr || '');
        if (!label && key.indexOf('__draftcat_') === 0) label = t('products.newCategory') || 'New category';
        b.textContent = label;
        frag.appendChild(b);
      });
    } else {
      var present = {};
      PRODUCTS.forEach(function (p) { if (p && p.category) present[p.category] = 1; });
      var ordered = [];
      var cats = (typeof SHOP !== 'undefined' && Array.isArray(SHOP.categories)) ? SHOP.categories.slice() : [];
      cats.sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });
      cats.forEach(function (c) {
        if (c && c.slug && present[c.slug]) { ordered.push(c.slug); delete present[c.slug]; }
      });
      PRODUCTS.forEach(function (p) {
        if (p && p.category && present[p.category]) { ordered.push(p.category); delete present[p.category]; }
      });
      ordered.forEach(function (slug) {
        var b = document.createElement('button');
        b.className = 'filter-btn';
        b.dataset.cat = slug;
        b.textContent = getCatLabel(slug, lang);
        frag.appendChild(b);
      });
    }

    filterBar.textContent = '';
    filterBar.appendChild(frag);
  }

  function refreshFilterLabels(lang) {
    const filterBar = document.getElementById('filter-bar');
    if (!filterBar) return;
    // Admin Preview labels come from the merged category collection (draft
    // categories have no slug for getCatLabel to resolve) — rebuild the bar.
    if (PREVIEW) { buildFilterBar(filterBar, lang); return; }
    filterBar.querySelectorAll('.filter-btn').forEach(btn => {
      const cat = btn.dataset.cat;
      btn.textContent = (cat === 'all')
        ? (t('products.filterAll') || 'All')
        : getCatLabel(cat, lang);
    });
  }

  // ── LOCATION PAGE ────────────────────────────────────────────────
  // Idempotent: re-run on every Admin-preview draft update.
  function initLocation() {
    if (typeof SHOP === 'undefined') return;
    const lang = getLang();

    setText('loc-address',  shopAddr(lang));
    setText('loc-weekdays', shopHours(lang, 'weekdays'));
    setText('loc-weekends', shopHours(lang, 'weekends'));

    const dirBtn = document.getElementById('directions-btn');
    const safeDirections = safeHttpUrl(SHOP.mapDirections);
    if (dirBtn && safeDirections) dirBtn.href = safeDirections;

    applyLocationVisual(lang);
  }

  // The big Location visual: interactive map OR a composed business image that
  // links to the same Google-Maps destination as "Get Directions". Owns the
  // whole presentation (map vs image, contain vs cover, focal point, zoom,
  // blurred filler). Falls back to the map whenever the image can't be used;
  // hides the block only if neither a map nor an image is configured.
  // DOM/CSSOM APIs only — no innerHTML. Both owner-configurable URLs
  // (mapEmbed iframe src, mapDirections href) go through safeHttpUrl() —
  // a stray javascript:/data: value in Settings must never reach the DOM.
  function applyLocationVisual(lang) {
    const visual  = document.querySelector('.loc-visual');
    const mapWrap = document.getElementById('loc-map-wrap');
    const imgLink = document.getElementById('loc-image-link');
    const img     = document.getElementById('loc-image');
    const blur    = document.getElementById('loc-image-blur');
    const frame   = document.getElementById('map-frame');
    if (!mapWrap && !imgLink) return;

    const safeEmbed = safeHttpUrl(SHOP.mapEmbed);
    const hasMap = !!safeEmbed;
    const url = (SHOP.locationVisualMode === 'image' && typeof SHOP.locationImage === 'string')
      ? SHOP.locationImage.trim() : '';

    // Keep the map iframe loaded whenever a map is configured — in EITHER mode —
    // so an image→map fallback is instant and never flashes an empty frame.
    if (frame && hasMap && frame.getAttribute('src') !== safeEmbed) frame.src = safeEmbed;

    // §8: the whole block is in layout unless there is NEITHER a usable map NOR
    // a usable image. This is decided HERE from data only — never from an
    // in-flight image load. §7: a valid map in map mode is always shown.
    function showBlock(on) {
      if (!visual) return;
      visual.style.display = on ? '' : 'none';
      if (on && PREVIEW) visual.classList.add('visible');   // preview: don't wait on scroll-reveal
    }
    showBlock(hasMap || !!url);

    function showMap() {
      if (img)  { img.onload = null; img.onerror = null; img.removeAttribute('src'); }
      if (blur) blur.style.backgroundImage = '';
      if (imgLink) imgLink.hidden = true;                   // now honoured (CSS [hidden] rule)
      if (mapWrap) mapWrap.hidden = !hasMap;
    }

    if (!url || !imgLink || !img) { showMap(); return; }    // map mode / no usable image → map

    // ── Image mode ──────────────────────────────────────────────
    const fit = SHOP.locationImageFit === 'contain' ? 'contain' : 'cover';

    // Composition (fit / height / crop position / zoom). While the owner is
    // dragging in edit mode the overlay owns all of this locally — a stray
    // PREVIEW_DATA re-render must never jump or reset the image (§14).
    if (!(_locEdit && _locEdit.active)) {
      const height = (SHOP.locationImageHeight === 'short' || SHOP.locationImageHeight === 'tall')
        ? SHOP.locationImageHeight : 'standard';
      const posX = clampNum(SHOP.locationImagePosX, 0, 100, 50);
      const posY = clampNum(SHOP.locationImagePosY, 0, 100, 50);
      const zoom = clampNum(SHOP.locationImageZoom, 1, 1.6, 1);
      imgLink.dataset.height = height;          // frame size (public CSS → responsive px)
      imgLink.classList.toggle('is-contain', fit === 'contain');
      imgLink.style.setProperty('--loc-pos', posX + '% ' + posY + '%');
      imgLink.style.setProperty('--loc-zoom', fit === 'contain' ? '1' : String(zoom));
    }

    const dest = safeHttpUrl(SHOP.mapDirections);
    if (dest) { imgLink.href = dest; imgLink.setAttribute('aria-label', t('location.viewOnMaps') || 'View on Google Maps'); }
    else      { imgLink.removeAttribute('href'); imgLink.removeAttribute('aria-label'); }  // shown, not clickable
    const badge = document.getElementById('loc-image-badge-text');
    if (badge) badge.textContent = t('location.viewOnMaps') || 'View on Google Maps';

    const name = shopName(lang);
    img.alt = (name ? name + ' — ' : '') + (t('location.title') || 'Location');

    const reveal = function () {
      // Blurred filler derives from the SAME cached image; only in Fit mode.
      if (blur) blur.style.backgroundImage = (fit === 'contain') ? 'url(' + JSON.stringify(url) + ')' : '';
      if (mapWrap) mapWrap.hidden = true;      // hide the map ONLY once the image is ready (§9)
      if (imgLink) imgLink.hidden = false;
    };
    img.onload  = reveal;
    img.onerror = function () {
      img.onload = null; img.onerror = null;
      showMap();                                // broken image → the map stays / returns
      if (!hasMap) showBlock(false);            // ...and if there is no map either, hide the block (§8)
    };
    if (img.getAttribute('src') !== url) img.src = url;
    else if (img.complete && img.naturalWidth > 0) reveal();  // already loaded (re-render)
  }

  // ── ADMIN PREVIEW: Location image direct-edit ───────────────────
  // Only in ?adminPreview=1. The owner drags / zooms / resizes the REAL Location
  // image inside the real page; normalized composition is reported UP to the
  // parent (which owns the draft). The child applies the live transform locally
  // during a drag — no full page re-render per pointermove (§14).
  var _locEditRaf = false;

  function locEditReport(final) {
    if (!_locEdit) return;
    var send = function () {
      parentPost({
        type: 'PREVIEW_LOCATION_COMPOSE',
        position_x: Math.round(_locEdit.x),
        position_y: Math.round(_locEdit.y),
        zoom: Math.round(_locEdit.zoom * 100) / 100,
        height: _locEdit.height,
      });
    };
    if (final) { send(); return; }
    if (_locEditRaf) return;
    _locEditRaf = true;
    requestAnimationFrame(function () { _locEditRaf = false; send(); });
  }

  function locEditApplyTransform() {
    var link = document.getElementById('loc-image-link');
    if (!link || !_locEdit) return;
    link.style.setProperty('--loc-pos', _locEdit.x + '% ' + _locEdit.y + '%');
    link.style.setProperty('--loc-zoom', String(_locEdit.zoom));
    link.dataset.height = _locEdit.height;
    if (_locEdit.overlay) {
      var zv = _locEdit.overlay.querySelector('[data-loc-zoom-val]');
      if (zv) zv.textContent = Math.round(_locEdit.zoom * 100) + '%';
      var zr = _locEdit.overlay.querySelector('input[type="range"]');
      if (zr && String(Math.round(_locEdit.zoom * 100)) !== zr.value) zr.value = String(Math.round(_locEdit.zoom * 100));
      _locEdit.overlay.querySelectorAll('[data-h]').forEach(function (b) {
        b.classList.toggle('is-on', b.dataset.h === _locEdit.height);
      });
    }
  }

  function locEditBuildOverlay() {
    var mk = function (tag, cls, txt) { var n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
    var box = mk('div', 'loc-edit');

    var head = mk('div', 'loc-edit__head');
    head.appendChild(mk('span', 'loc-edit__badge', 'Editing image'));
    head.appendChild(mk('span', 'loc-edit__hint', 'Drag to reposition'));
    box.appendChild(head);

    var ctl = mk('div', 'loc-edit__controls');

    var zoomRow = mk('div', 'loc-edit__row');
    zoomRow.appendChild(mk('span', 'loc-edit__lbl', 'Zoom'));
    var zoom = document.createElement('input');
    zoom.type = 'range'; zoom.min = '100'; zoom.max = '160'; zoom.step = '2';
    zoom.value = String(Math.round(_locEdit.zoom * 100));
    zoom.setAttribute('aria-label', 'Zoom');
    zoom.addEventListener('input', function () {
      _locEdit.zoom = clampNum(zoom.value, 100, 160, 100) / 100;
      locEditApplyTransform(); locEditReport();
    });
    zoom.addEventListener('change', function () { locEditReport(true); });
    zoomRow.appendChild(zoom);
    var zv = mk('span', 'loc-edit__val', Math.round(_locEdit.zoom * 100) + '%');
    zv.setAttribute('data-loc-zoom-val', '');
    zoomRow.appendChild(zv);
    ctl.appendChild(zoomRow);

    var hRow = mk('div', 'loc-edit__row');
    hRow.appendChild(mk('span', 'loc-edit__lbl', 'Frame'));
    var hSeg = mk('div', 'loc-edit__seg');
    [['short', 'Short'], ['standard', 'Standard'], ['tall', 'Tall']].forEach(function (p) {
      var b = mk('button', null, p[1]); b.type = 'button'; b.dataset.h = p[0];
      if (_locEdit.height === p[0]) b.classList.add('is-on');
      b.addEventListener('click', function () {
        _locEdit.height = p[0]; locEditApplyTransform(); locEditReport(true);
      });
      hSeg.appendChild(b);
    });
    hRow.appendChild(hSeg);
    ctl.appendChild(hRow);

    var pad = mk('div', 'loc-edit__pad');
    var nudge = function (label, glyph, dx, dy) {
      var b = mk('button', 'loc-edit__nudge', glyph); b.type = 'button';
      b.setAttribute('aria-label', label);
      b.addEventListener('click', function () {
        _locEdit.x = clampNum(_locEdit.x + dx, 0, 100, _locEdit.x);
        _locEdit.y = clampNum(_locEdit.y + dy, 0, 100, _locEdit.y);
        locEditApplyTransform(); locEditReport(true);
      });
      return b;
    };
    var STEP = 4;
    pad.appendChild(nudge('Move image up', '↑', 0, -STEP));
    pad.appendChild(nudge('Move image left', '←', -STEP, 0));
    pad.appendChild(mk('span', 'loc-edit__nudge loc-edit__nudge--dot', '●'));
    pad.appendChild(nudge('Move image right', '→', STEP, 0));
    pad.appendChild(nudge('Move image down', '↓', 0, STEP));
    ctl.appendChild(pad);

    var acts = mk('div', 'loc-edit__actions');
    var reset = mk('button', 'loc-edit__btn', 'Reset'); reset.type = 'button';
    reset.addEventListener('click', function () {
      _locEdit.x = 50; _locEdit.y = 50; _locEdit.zoom = 1; _locEdit.height = 'standard';
      locEditApplyTransform(); locEditReport(true);
    });
    var cancel = mk('button', 'loc-edit__btn', 'Cancel'); cancel.type = 'button';
    cancel.addEventListener('click', function () { locEditTeardown(); parentPost({ type: 'PREVIEW_LOCATION_EDIT_CANCEL' }); });
    var done = mk('button', 'loc-edit__btn loc-edit__btn--primary', 'Done'); done.type = 'button';
    done.addEventListener('click', function () { locEditReport(true); locEditTeardown(); parentPost({ type: 'PREVIEW_LOCATION_EDIT_DONE' }); });
    acts.appendChild(reset); acts.appendChild(cancel); acts.appendChild(done);
    ctl.appendChild(acts);

    box.appendChild(ctl);
    return box;
  }

  function locEditStart(seed) {
    var link = document.getElementById('loc-image-link');
    var img  = document.getElementById('loc-image');
    if (!PREVIEW || !link || !img) { parentPost({ type: 'PREVIEW_LOCATION_EDIT_DONE' }); return; }
    if (_locEdit) locEditTeardown();

    _locEdit = {
      active: true,
      x: clampNum(seed && seed.position_x, 0, 100, 50),
      y: clampNum(seed && seed.position_y, 0, 100, 50),
      zoom: clampNum(seed && seed.zoom, 1, 1.6, 1),
      height: (seed && (seed.height === 'short' || seed.height === 'tall')) ? seed.height : 'standard',
      drag: null, overlay: null, onDown: null, onMove: null, onUp: null,
    };

    link.classList.remove('is-contain');      // editing is Fill-Frame only (nothing to crop in contain)
    link.classList.add('loc-editing');
    link.dataset.prevHref = link.getAttribute('href') || '';
    link.removeAttribute('href');              // dragging must not fire the Maps link (§20)
    locEditApplyTransform();

    var SENS = 1.15;
    _locEdit.onDown = function (ev) {
      if (ev.button != null && ev.button !== 0) return;
      if (ev.target && ev.target.closest && ev.target.closest('.loc-edit__controls')) return;
      ev.preventDefault();
      try { link.setPointerCapture(ev.pointerId); } catch (e) {}
      _locEdit.drag = { id: ev.pointerId, px: ev.clientX, py: ev.clientY };
      link.classList.add('is-grabbing');
    };
    _locEdit.onMove = function (ev) {
      var d = _locEdit.drag;
      if (!d || ev.pointerId !== d.id) return;
      var r = link.getBoundingClientRect();
      _locEdit.x = clampNum(_locEdit.x - (ev.clientX - d.px) / (r.width  || 1) * 100 * SENS, 0, 100, _locEdit.x);
      _locEdit.y = clampNum(_locEdit.y - (ev.clientY - d.py) / (r.height || 1) * 100 * SENS, 0, 100, _locEdit.y);
      d.px = ev.clientX; d.py = ev.clientY;
      locEditApplyTransform(); locEditReport();
    };
    _locEdit.onUp = function (ev) {
      if (!_locEdit.drag || ev.pointerId !== _locEdit.drag.id) return;
      try { link.releasePointerCapture(ev.pointerId); } catch (e) {}
      _locEdit.drag = null;
      link.classList.remove('is-grabbing');
      locEditReport(true);
    };
    link.addEventListener('pointerdown', _locEdit.onDown);
    link.addEventListener('pointermove', _locEdit.onMove);
    link.addEventListener('pointerup', _locEdit.onUp);
    link.addEventListener('pointercancel', _locEdit.onUp);

    _locEdit.overlay = locEditBuildOverlay();
    link.appendChild(_locEdit.overlay);
  }

  function locEditTeardown() {
    var link = document.getElementById('loc-image-link');
    if (link && _locEdit) {
      link.removeEventListener('pointerdown', _locEdit.onDown);
      link.removeEventListener('pointermove', _locEdit.onMove);
      link.removeEventListener('pointerup', _locEdit.onUp);
      link.removeEventListener('pointercancel', _locEdit.onUp);
      link.classList.remove('loc-editing', 'is-grabbing');
      if (_locEdit.overlay && _locEdit.overlay.parentNode) _locEdit.overlay.parentNode.removeChild(_locEdit.overlay);
      if (link.dataset.prevHref) { link.setAttribute('href', link.dataset.prevHref); delete link.dataset.prevHref; }
    }
    _locEdit = null;
  }

  // ── CONTACT PAGE ─────────────────────────────────────────────────
  function initContact() {
    if (typeof SHOP === 'undefined') return;
    const lang = getLang();

    const phoneEl = document.getElementById('contact-phone');
    if (phoneEl) {
      if (SHOP.phone) {
        phoneEl.href = 'tel:' + SHOP.phone.replace(/\s/g, '');
        const p = phoneEl.querySelector('p');
        if (p) p.textContent = SHOP.phone;
      } else {
        phoneEl.style.display = 'none';
      }
    }

    const instaEl = document.getElementById('contact-insta');
    if (instaEl) {
      if (SHOP.instagram) {
        const p = instaEl.querySelector('p');
        if (p) p.textContent = SHOP.instagram;
        instaEl.href = 'https://instagram.com/' + SHOP.instagram.replace('@', '');
      } else {
        instaEl.style.display = 'none';
      }
    }

    const emailEl = document.getElementById('contact-email');
    if (emailEl) {
      if (SHOP.email) {
        const p = emailEl.querySelector('p');
        if (p) p.textContent = SHOP.email;
        emailEl.href = 'mailto:' + SHOP.email;
      } else {
        emailEl.style.display = 'none';
      }
    }

    setText('contact-hours', shopHours(lang, 'weekdays') + '  ·  ' + shopHours(lang, 'weekends'));
  }

  // ── PRICE FORMATTING (milestone 1P.1 — permanent Riyal symbol) ──────
  // `products.price` is a free-text column (see supabase/schema.sql — not
  // numeric, and changing that is out of scope here: no migration, no
  // schema change, no rewriting of stored values). Pre-1P.1 rows were
  // typed by the owner as e.g. "39 SAR"; going forward the Admin field
  // guides bare-numeric entry instead (see admin/js/views/menu.js), but
  // this formatter must render EITHER convention identically, since old
  // rows are never rewritten. It takes the leading numeric token from
  // whatever is stored (dropping any legacy "SAR"/other suffix) and
  // appends the one true symbol — never storing or round-tripping the
  // symbol itself, purely a render-time presentation step.
  var RIYAL_SYMBOL = '﷼';
  function formatPrice(raw) {
    if (raw == null) return '';
    var s = String(raw).trim();
    if (!s) return '';
    var m = s.match(/-?\d+(?:\.\d+)?/);
    return (m ? m[0] : s) + ' ' + RIYAL_SYMBOL;
  }

  // ── PRODUCT CARD RENDERER ─────────────────────────────────────────
  // Built with DOM APIs + textContent — owner-entered name / description /
  // price / category never touch innerHTML. In Admin Preview each card carries
  // data-preview-id so the editor can focus/highlight the exact product.
  function renderProductGrid(products, containerId) {
    const grid = document.getElementById(containerId);
    if (!grid) return;

    grid.textContent = '';

    if (!products || !products.length) {
      const empty = document.createElement('p');
      empty.style.cssText = 'color:var(--text-muted);text-align:center;padding:40px 0';
      empty.textContent = 'No items to show.';
      grid.appendChild(empty);
      if (grid.classList.contains('reveal-grid')) grid.classList.add('visible');
      return;
    }

    const lang = getLang();
    const frag = document.createDocumentFragment();

    products.forEach(function (p) {
      const name = lang === 'ar' ? p.name : (p.nameEn || p.name);
      const desc = lang === 'ar' ? p.description : (p.descriptionEn || p.description);
      const catName = (p._catNameAr || p._catNameEn)
        ? (lang === 'ar' ? (p._catNameAr || p._catNameEn) : (p._catNameEn || p._catNameAr))
        : getCatLabel(p.category || '', lang);
      const imgSrc = p.image || IMG_DEFAULT;

      const card = document.createElement('article');
      card.className = 'product-card';
      card.dataset.cat = p.category || '';
      if (PREVIEW && p.id != null && p.id !== '') card.dataset.previewId = String(p.id);

      const imgWrap = document.createElement('div');
      imgWrap.className = 'product-img';
      const img = document.createElement('img');
      img.src = imgSrc;
      img.alt = name || '';
      img.loading = 'lazy';
      img.addEventListener('error', function () { this.src = IMG_BROKEN; }, { once: true });
      imgWrap.appendChild(img);
      if (p.category) {
        const badge = document.createElement('span');
        badge.className = 'product-cat-badge';
        badge.setAttribute('aria-hidden', 'true');
        badge.textContent = catName;
        imgWrap.appendChild(badge);
      }

      const body = document.createElement('div');
      body.className = 'product-body';
      const h3 = document.createElement('h3');
      h3.className = 'product-name';
      h3.textContent = name || '';
      body.appendChild(h3);
      if (p.price) {
        const price = document.createElement('div');
        price.className = 'product-price';
        // `.price-amount` forces one fixed LTR run for "<number> ﷼" (see
        // css/style.css) — without it, the Riyal glyph's own strong-RTL
        // bidi class next to a plain digit run can visually reorder inside
        // an `[dir=rtl]` ancestor, splitting the symbol from its number.
        const amount = document.createElement('span');
        amount.className = 'price-amount';
        amount.textContent = formatPrice(p.price);
        price.appendChild(amount);
        body.appendChild(price);
      }
      if (desc) {
        const dp = document.createElement('p');
        dp.className = 'product-desc';
        dp.textContent = desc;
        body.appendChild(dp);
      }

      card.appendChild(imgWrap);
      card.appendChild(body);
      frag.appendChild(card);
    });

    grid.appendChild(frag);
    if (grid.classList.contains('reveal-grid')) grid.classList.add('visible');
  }

  // ── SCROLL REVEAL ─────────────────────────────────────────────────
  // `immediate` (1P.7): the Portal curtains are ALREADY the reveal
  // mechanism for a transition arrival — an above-the-fold .reveal/
  // .reveal-grid element ALSO waiting on its own IntersectionObserver
  // callback (inherently async, "a frame or two" per below) raced the
  // curtains' own fast ease-out opening and lost: real-browser testing
  // showed the curtain gap opening onto still-opacity:0 page title/filter
  // bar content that only faded in a beat later — the site owner's
  // reported "empty gap, page appears later" bug, confirmed via a frozen
  // half-open capture showing exactly those elements at opacity:0 while
  // products-grid (which separately force-adds `.visible` on render, see
  // above) was already visible. `immediate` skips the observer entirely
  // for whatever is ALREADY in the viewport at this exact moment — no
  // redundant concealment on top of the curtains — while anything below
  // the fold still gets the observer attached completely normally, so the
  // scroll-triggered entrance (a real, separate, unrelated feature) is
  // untouched. Cold/direct loads keep the original "a frame or two" async
  // polish — only the Portal-arrival case needs this.
  function initReveal(immediate) {
    const targets = document.querySelectorAll('.reveal, .reveal-grid');
    if (!('IntersectionObserver' in window)) {
      targets.forEach(el => el.classList.add('visible'));
      return;
    }
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -32px 0px' });
    const vh = window.innerHeight || document.documentElement.clientHeight;
    targets.forEach(el => {
      if (immediate) {
        const r = el.getBoundingClientRect();
        if (r.bottom > 0 && r.top < vh) { el.classList.add('visible'); return; }
      }
      io.observe(el);
    });
  }

  // ── SOUND FEEDBACK ────────────────────────────────────────────────
  // Two independent gates, BOTH must pass:
  //   owner permission  — restaurants.sounds_enabled → SHOP_SETTINGS.sounds
  //                        (global site-level switch; false = always silent)
  //   visitor preference — ttw_public_sounds in localStorage (per-device;
  //                        absent = on, so sound is ON by default whenever
  //                        the owner allows it)
  // Never inside the Admin Live Preview iframe (?adminPreview=1) regardless
  // of either flag — that guard is unconditional (see PREVIEW check below).
  // One AudioContext, one master gain, reused for every call.
  var _audioCtx = null, _audioMaster = null;
  function ownerSoundsEnabled() {
    return typeof SHOP_SETTINGS !== 'undefined'
      ? SHOP_SETTINGS.sounds !== false
      : (typeof SHOP !== 'undefined' ? SHOP.sounds !== false : false);
  }
  function visitorSoundsOn() {
    try { return localStorage.getItem('ttw_public_sounds') !== 'off'; }
    catch (e) { return true; }
  }
  function publicSoundsAllowed() {
    return !PREVIEW && ownerSoundsEnabled() && visitorSoundsOn();
  }
  function ensureAudio() {
    if (_audioCtx) return _audioCtx;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      _audioCtx = new AC();
      _audioMaster = _audioCtx.createGain();
      _audioMaster.gain.value = 0.09;   // conservative — never startle a headphone user
      _audioMaster.connect(_audioCtx.destination);
    } catch (e) { _audioCtx = null; _audioMaster = null; }
    return _audioCtx;
  }
  // kind: 'tap' (default — any click) | 'toggle' (a preference/state flip:
  // language, the sound button itself). Deliberately just these two —
  // this is a restaurant site, not an editor; no success/warning/focus/tick
  // vocabulary here.
  function playUISound(kind) {
    if (!publicSoundsAllowed()) return;
    var c = ensureAudio();
    if (!c || !_audioMaster) return;
    if (c.state === 'suspended') { try { c.resume(); } catch (e) {} }
    try {
      var isToggle = kind === 'toggle';
      var t0  = c.currentTime;
      var dur = isToggle ? 0.10 : 0.09;
      var osc  = c.createOscillator();
      var gain = c.createGain();
      osc.connect(gain);
      gain.connect(_audioMaster);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(isToggle ? 620 : 720, t0);
      osc.frequency.exponentialRampToValueAtTime(isToggle ? 520 : 480, t0 + dur);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(1, t0 + Math.min(0.012, dur * 0.4));
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
      osc.onended = function () { try { osc.disconnect(); gain.disconnect(); } catch (e) {} };
    } catch (e) { /* fail silently — audio must never break the site */ }
  }

  // ── PORTAL TRANSITION SOUND (milestone 1Q.1 — futuristic energy) ──────
  // Replaces 1Q's noise-dominant "airy swoosh" (rejected — wrong character,
  // wrong sync) entirely. Same gates, same shared AudioContext/master gain
  // as playUISound() above — no second sound system. Four synthesized
  // layers, no external file:
  //   A. ENERGY BODY    — triangle oscillator, smooth low->mid-high pitch
  //                        glide + a parallel lowpass brightness sweep;
  //                        the main tonal "energy building" character.
  //   B. SHIMMER         — a quieter sine, harmonically above the body,
  //                        silent until the second half, then fades in —
  //                        the "electronic shimmer as curtains near center."
  //   C. TEXTURE (noise) — very low-gain filtered noise under the tonal
  //                        layers, for air/movement only — never dominant
  //                        (this is what 1Q got backwards: noise WAS the
  //                        sound there; here it's a barely-there garnish).
  //   D. CENTER-MEET ACCENT — a short (~80ms) two-tone pulse timed to the
  //                        END of the close, i.e. the instant the curtains
  //                        actually meet — not a notification beep, a
  //                        harmonic convergence (root + a fifth above).
  // Duration is DERIVED from the real Portal timing constants (CLOSE_MS_*/
  // HOLD_MS_*), never an independent guessed value — the energy build
  // spans the close, the accent lands at end-of-close, the tail decays
  // during the hold, so the whole sound naturally matches whichever motion
  // mode is active without a separate reduced-motion implementation.
  var _texNoiseBuffer = null;
  function getTextureNoiseBuffer(c) {
    if (_texNoiseBuffer && _texNoiseBuffer.sampleRate === c.sampleRate) return _texNoiseBuffer;
    var len = Math.ceil(c.sampleRate * 1.0);
    var buf = c.createBuffer(1, len, c.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    _texNoiseBuffer = buf;
    return buf;
  }
  function playPortalTransitionSound() {
    if (!publicSoundsAllowed()) return;
    var c = ensureAudio();
    if (!c || !_audioMaster) return;
    if (c.state === 'suspended') { try { c.resume(); } catch (e) {} }
    try {
      var closeMs  = reducedMotion() ? CLOSE_MS_REDUCED : CLOSE_MS_NORMAL;
      var holdMs   = reducedMotion() ? HOLD_MS_REDUCED  : HOLD_MS_NORMAL;
      var closeDur = closeMs / 1000;     // energy build spans the real close duration
      var holdDur  = holdMs  / 1000;     // tail decays during the real sealed hold
      var t0 = c.currentTime;
      var meetT = t0 + closeDur;         // curtains meet = end of close
      var endT  = meetT + holdDur;

      var voice = c.createGain();        // per-call submix — individual layers stay
      voice.gain.value = 1;              // conservative; shared master gain (0.09) does the real attenuation
      voice.connect(_audioMaster);

      var bodyStartFreq = 130, bodyEndFreq = 480;

      // A — ENERGY BODY
      var body = c.createOscillator();
      body.type = 'triangle';
      body.frequency.setValueAtTime(bodyStartFreq, t0);
      body.frequency.exponentialRampToValueAtTime(bodyEndFreq, t0 + closeDur * 0.95);

      var bodyFilter = c.createBiquadFilter();
      bodyFilter.type = 'lowpass';
      bodyFilter.Q.value = 0.7;          // low Q — brightness sweep, never a resonant whistle
      bodyFilter.frequency.setValueAtTime(700, t0);
      bodyFilter.frequency.exponentialRampToValueAtTime(3200, meetT);

      var bodyGain = c.createGain();
      bodyGain.gain.setValueAtTime(0.0001, t0);
      bodyGain.gain.exponentialRampToValueAtTime(0.55, t0 + closeDur * 0.10);   // 0-10%: very soft onset
      bodyGain.gain.exponentialRampToValueAtTime(0.85, t0 + closeDur * 0.65);   // 10-65%: energy rises
      bodyGain.gain.exponentialRampToValueAtTime(0.5,  t0 + closeDur * 0.95);   // 65-95%: eases back, making room for the accent
      bodyGain.gain.exponentialRampToValueAtTime(0.0001, endT);                 // decays through the hold

      body.connect(bodyFilter);
      bodyFilter.connect(bodyGain);
      bodyGain.connect(voice);

      // B — HIGH ENERGY SHIMMER (quieter, enters late, harmonically above the body)
      var shimmer = c.createOscillator();
      shimmer.type = 'sine';
      shimmer.frequency.setValueAtTime(bodyStartFreq * 2.5, t0);
      shimmer.frequency.exponentialRampToValueAtTime(bodyEndFreq * 2.2, t0 + closeDur * 0.95);

      var shimmerGain = c.createGain();
      shimmerGain.gain.setValueAtTime(0.0001, t0);
      shimmerGain.gain.setValueAtTime(0.0001, t0 + closeDur * 0.55);            // silent through the first half
      shimmerGain.gain.exponentialRampToValueAtTime(0.28, t0 + closeDur * 0.80);// fades in, "shimmer becomes present"
      shimmerGain.gain.exponentialRampToValueAtTime(0.32, meetT);
      shimmerGain.gain.exponentialRampToValueAtTime(0.0001, endT);

      shimmer.connect(shimmerGain);
      shimmerGain.connect(voice);

      // C — OPTIONAL TEXTURE: very quiet filtered noise, air/movement only
      var tex = c.createBufferSource();
      tex.buffer = getTextureNoiseBuffer(c);
      var texFilter = c.createBiquadFilter();
      texFilter.type = 'lowpass';
      texFilter.Q.value = 0.5;
      texFilter.frequency.value = 1800;   // soft, no hiss/whistle — fixed, not swept (this is garnish, not the 1Q design)
      var texGain = c.createGain();
      texGain.gain.setValueAtTime(0.0001, t0);
      texGain.gain.exponentialRampToValueAtTime(0.045, t0 + closeDur * 0.5);
      texGain.gain.exponentialRampToValueAtTime(0.06, meetT);
      texGain.gain.exponentialRampToValueAtTime(0.0001, endT);
      tex.connect(texFilter);
      texFilter.connect(texGain);
      texGain.connect(voice);

      // D — CENTER-MEET ACCENT: short harmonic pulse exactly at end-of-close
      var accentDur = 0.08;
      var accent1 = c.createOscillator();   // root, at the body's own ending pitch
      accent1.type = 'sine';
      accent1.frequency.setValueAtTime(bodyEndFreq, meetT);
      var accent2 = c.createOscillator();   // a fifth above — convergence, not a single "ding"
      accent2.type = 'sine';
      accent2.frequency.setValueAtTime(bodyEndFreq * 1.5, meetT);
      var accentGain = c.createGain();
      accentGain.gain.setValueAtTime(0.0001, meetT);
      accentGain.gain.exponentialRampToValueAtTime(0.4, meetT + 0.012);   // fast attack, restrained peak
      accentGain.gain.exponentialRampToValueAtTime(0.0001, meetT + accentDur);
      accent1.connect(accentGain);
      accent2.connect(accentGain);
      accentGain.connect(voice);

      var nodes = [body, shimmer, tex, accent1, accent2];
      body.start(t0);         body.stop(endT + 0.02);
      shimmer.start(t0);      shimmer.stop(endT + 0.02);
      tex.start(t0);          tex.stop(endT + 0.02);
      accent1.start(meetT);   accent1.stop(meetT + accentDur + 0.02);
      accent2.start(meetT);   accent2.stop(meetT + accentDur + 0.02);

      var allNodes = [body, bodyFilter, bodyGain, shimmer, shimmerGain, tex, texFilter, texGain,
                       accent1, accent2, accentGain, voice];
      body.onended = function () {
        try { allNodes.forEach(function (n) { n.disconnect(); }); } catch (e) {}
      };
    } catch (e) { /* fail silently — audio must never block or break navigation */ }
  }

  // ── Customer sound toggle (header) ─────────────────────────────────
  // Hidden entirely when the owner has turned Customer Site Sounds off —
  // never shown claiming sound is available when it globally isn't.
  function syncSoundBtn() {
    const btn = document.getElementById('sound-btn');
    if (!btn) return;
    if (!ownerSoundsEnabled()) { btn.hidden = true; return; }
    btn.hidden = false;
    const on = visitorSoundsOn();
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    const label = on ? (t('nav.soundOn') || 'Sound on') : (t('nav.soundOff') || 'Sound off');
    btn.setAttribute('aria-label', label);
    btn.title = label;
  }
  function initSoundBtn() {
    const btn = document.getElementById('sound-btn');
    syncSoundBtn();
    if (!btn) return;
    btn.addEventListener('click', () => {
      const wasOn = visitorSoundsOn();
      if (wasOn) playUISound('toggle');       // confirm BEFORE muting
      try { localStorage.setItem('ttw_public_sounds', wasOn ? 'off' : 'on'); } catch (e) {}
      syncSoundBtn();
      if (!wasOn) playUISound('toggle');      // confirm AFTER enabling
    });
  }

  // ── HELPERS ───────────────────────────────────────────────────────
  function setText(id, text) {
    const el = document.getElementById(id);
    if (el && text !== undefined && text !== null) el.textContent = text;
  }
  function setMeta(name, content) {
    let el = document.querySelector('meta[name="' + name + '"]');
    if (!el) { el = document.createElement('meta'); el.name = name; document.head.appendChild(el); }
    if (content) el.content = content;
  }
  function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
  function reducedMotion() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (e) { return false; }
  }
  // Numeric coerce + clamp with a default for missing / non-finite input.
  function clampNum(v, min, max, dflt) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    if (!isFinite(n)) return dflt;
    return n < min ? min : (n > max ? max : n);
  }
  // Owner-configurable destinations (Google Maps embed src / directions
  // href) are free-text DB fields — never allow them to reach an href/src
  // as a javascript: or data: URI. Returns the URL unchanged only if it
  // parses as a plain http(s) destination, else '' (treated as absent by
  // every call site). No general sanitizer — just a protocol allowlist for
  // exactly the two owner-configurable URL fields that reach the DOM raw.
  function safeHttpUrl(url) {
    if (!url || typeof url !== 'string') return '';
    try {
      var u = new URL(url, window.location.href);
      return (u.protocol === 'http:' || u.protocol === 'https:') ? url : '';
    } catch (e) { return ''; }
  }

  // Run whichever page-specific renderer the public site normally uses for this
  // document. Reused for the first Admin-preview paint AND every later draft
  // update — no parallel renderers. Each initX() is idempotent.
  function renderCurrentPage() {
    switch (document.body.dataset.page) {
      case 'home':     initHome();     break;
      case 'products': initProducts(); break;
      case 'location': initLocation(); break;
      case 'contact':  initContact();  break;
    }
  }

  // ── ADMIN PREVIEW: render from parent-supplied draft data ────────
  async function initPreviewMode() {
    const page = document.body.dataset.page;

    // Stay visually hidden until the parent's real Preview state (language,
    // unsaved draft) has been applied — otherwise a freshly navigated page
    // paints its bundled-default language for a frame and flashes.
    // Revealed again in applyPreviewData(), which also posts PREVIEW_APPLIED.
    // Reachable ONLY via boot()'s `if (PREVIEW)` branch, so a normal visitor is
    // never affected.
    document.documentElement.style.visibility = 'hidden';

    // In-iframe navigation: a same-site nav link becomes a PREVIEW_NAVIGATE
    // message (the parent owns the page selector + iframe src). Every other
    // link — WhatsApp / Instagram / Maps / mailto / tel / "#" — is neutralised
    // so the preview can never wander off the site. Stat cards keep their own
    // click-to-edit handler.
    document.addEventListener('click', function (e) {
      const a = e.target.closest('a');
      if (!a || a.closest('.hl-card')) return;
      e.preventDefault();
      const pg = previewPageForHref(a.getAttribute('href') || '');
      if (pg) parentPost({ type: 'PREVIEW_NAVIGATE', page: pg });
    }, true);

    window.addEventListener('message', onPreviewMessage);

    // Live categories + products, read-only — only where the page renders them.
    // restaurant/settings still arrive from the Admin parent via postMessage.
    if (page === 'home' || page === 'products') {
      await loadPreviewCatalog();
      if (typeof SHOP !== 'undefined' && Array.isArray(_previewCategories)) {
        SHOP.categories = _previewCategories;
      }
    }

    // First paint from bundled config (still hidden) so layout is warm, then
    // tell the parent we're ready for the real settings draft.
    const lang = getLang();
    applyTranslations(lang);
    applyShopContent(lang);
    applyOgTags();
    updateWaLinks();
    initReveal();
    const yearEl = document.getElementById('footer-year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();
    renderCurrentPage();

    parentPost({ type: 'PREVIEW_READY', nav: _previewNav });
  }

  // ── ADMIN PREVIEW: semantic focus / highlight ──────────────────────
  // The parent sends a KNOWN key (never a CSS selector / DOM path); the child
  // maps it to a real element on whichever public page is loaded, brings it to
  // centre, and briefly emphasises it. Unknown keys are ignored. Normal
  // visitors never reach this — it runs only under ?adminPreview=1, and
  // `.pv-focus` is only ever added here.
  var PV_FOCUS_TARGETS = {
    hero:               function () { return document.getElementById('hero'); },
    'hero-name':        function () { return document.getElementById('hero-name'); },
    'hero-tagline':     function () { return document.getElementById('hero-tagline'); },
    'hero-image':       function () { return document.getElementById('hero-bg') || document.getElementById('hero'); },
    logo:               function () { return document.querySelector('.nav-logo') || document.getElementById('nav-logo'); },
    about:              function () { return document.getElementById('about-desc') || document.getElementById('about'); },
    highlights:         function () { return document.getElementById('hl-grid'); },
    address:            function () { return document.getElementById('loc-address') || document.querySelector('.location-details'); },
    'location-visual':  function () { return document.querySelector('.loc-visual'); },
    hours:              function () { return document.getElementById('loc-weekdays') || document.querySelector('.location-details'); },
    contact:            function () { return document.querySelector('.contact-grid') || document.querySelector('.contact-info-list'); },
    'contact-phone':    function () { return document.getElementById('contact-phone'); },
    'contact-whatsapp': function () { return document.querySelector('[data-wa-link]') || document.querySelector('.contact-grid'); },
    'contact-instagram':function () { return document.getElementById('contact-insta'); },
    'contact-email':    function () { return document.getElementById('contact-email'); },
  };

  var _pvFocusEl = null, _pvFocusT1 = 0, _pvFocusT2 = 0;
  function _pvReduced() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (e) { return false; }
  }
  function pvClearFocus() {
    if (_pvFocusT1) { clearTimeout(_pvFocusT1); _pvFocusT1 = 0; }
    if (_pvFocusT2) { clearTimeout(_pvFocusT2); _pvFocusT2 = 0; }
    if (_pvFocusEl) { try { _pvFocusEl.classList.remove('pv-focus', 'pv-focus--out'); } catch (e) {} _pvFocusEl = null; }
  }
  // Centre `el` in THIS document's own viewport. Never Element.scrollIntoView():
  // that recurses through every ancestor scroll container INCLUDING the parent
  // <iframe>, so it also scrolls the Admin shell and drags the left editor with
  // it (the 1I-D Settings/Menu auto-scroll bug). Window.scrollTo() acts only on
  // this window and cannot reach the embedder.
  function pvScrollCenter(el, behavior) {
    try {
      var doc = document.scrollingElement || document.documentElement || document.body;
      if (!doc) return;
      var viewH = window.innerHeight || doc.clientHeight || 0;
      var rect = el.getBoundingClientRect();
      var cur = (window.pageYOffset != null) ? window.pageYOffset : doc.scrollTop;
      var top = cur + rect.top + (rect.height / 2) - (viewH / 2);
      var max = Math.max(0, (doc.scrollHeight || 0) - viewH);
      top = top < 0 ? 0 : (top > max ? max : top);
      window.scrollTo({ top: top, left: (window.pageXOffset || 0), behavior: behavior });
    } catch (e) {
      try { window.scrollTo(0, Math.max(0, (el.offsetTop || 0) - 120)); } catch (e2) {}
    }
  }
  function pvFocusElement(el, doHighlight, behavior) {
    if (!el) return;
    var reduced = _pvReduced();
    pvScrollCenter(el, (behavior === 'auto' || reduced) ? 'auto' : 'smooth');
    if (doHighlight === false) return;
    if (_pvFocusEl === el) return;                 // already emphasised — don't restart the animation
    pvClearFocus();
    _pvFocusEl = el;
    el.classList.add('pv-focus');
    _pvFocusT1 = setTimeout(function () {
      _pvFocusT1 = 0;
      if (_pvFocusEl === el) el.classList.add('pv-focus--out');   // begin the fade
      _pvFocusT2 = setTimeout(function () {
        _pvFocusT2 = 0;
        if (_pvFocusEl === el) { el.classList.remove('pv-focus', 'pv-focus--out'); _pvFocusEl = null; }
      }, reduced ? 0 : 480);
    }, reduced ? 750 : 950);
  }
  function onPreviewFocus(msg) {
    if (msg.kind === 'stat') {
      var want = String(msg.id == null ? '' : msg.id);
      var target = null;
      if (want) {
        var cards = document.querySelectorAll('.hl-card[data-preview-id]');
        for (var i = 0; i < cards.length; i++) {
          if (cards[i].getAttribute('data-preview-id') === want) { target = cards[i]; break; }
        }
      }
      if (!target) target = document.getElementById('hl-grid');   // hidden / not-yet-rendered stat → the region
      pvFocusElement(target, msg.highlight !== false, msg.behavior);
      return;
    }
    if (msg.kind === 'product') {
      var wantP = String(msg.id == null ? '' : msg.id);
      var tp = null;
      if (wantP) {
        var pcards = document.querySelectorAll('.product-card[data-preview-id]');
        for (var j = 0; j < pcards.length; j++) {
          if (pcards[j].getAttribute('data-preview-id') === wantP) { tp = pcards[j]; break; }
        }
      }
      // hidden (unavailable) / not-yet-rendered product → the grid region
      if (!tp) tp = document.getElementById('products-grid') || document.getElementById('featured-grid');
      pvFocusElement(tp, msg.highlight !== false, msg.behavior);
      return;
    }
    if (msg.kind === 'category') {
      var wantC = String(msg.id == null ? '' : msg.id);
      var tc = null;
      if (wantC) {
        var tabs = document.querySelectorAll('.filter-btn[data-preview-category-id]');
        for (var m = 0; m < tabs.length; m++) {
          if (tabs[m].getAttribute('data-preview-category-id') === wantC) { tc = tabs[m]; break; }
        }
      }
      // Every known category (saved / renamed / draft, product-less or not) has
      // a tab in Preview, so this normally resolves. The region is only a
      // last-resort fallback for an id that isn't rendered yet.
      if (!tc) tc = document.getElementById('filter-bar');
      pvFocusElement(tc, msg.highlight !== false, msg.behavior);
      return;
    }
    // section
    var key = String(msg.target == null ? '' : msg.target);
    if (!Object.prototype.hasOwnProperty.call(PV_FOCUS_TARGETS, key)) return;
    pvFocusElement(PV_FOCUS_TARGETS[key](), msg.highlight !== false, msg.behavior);
  }

  function onPreviewMessage(e) {
    if (e.origin !== window.location.origin) return;      // same-origin only
    if (e.source !== window.parent) return;               // from our embedder only
    const msg = e.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'PREVIEW_DATA') {
      applyPreviewData(msg.payload || {}, msg.nav);
    } else if (msg.type === 'PREVIEW_FOCUS') {
      onPreviewFocus(msg);
    } else if (msg.type === 'PREVIEW_REFRESH_CATALOG') {
      onPreviewRefreshCatalog(msg);
    } else if (msg.type === 'PREVIEW_LOCATION_EDIT') {
      if (msg.on) { pvClearFocus(); locEditStart(msg.seed || {}); }
      else        locEditTeardown();
    }
  }

  // Admin Save / Delete landed — re-pull the LIVE public catalog so the preview
  // stops showing the unsaved overlay and reflects persisted data. Optional
  // msg.focus is applied only after the fresh grid is in the DOM. Never shows a
  // demo fallback; a failed re-pull keeps the existing "could not be loaded"
  // notice via renderCurrentPage().
  async function onPreviewRefreshCatalog(msg) {
    var page = document.body.dataset.page;
    _previewCatalogDraft = null;                 // persisted data is the truth now
    if (page === 'home' || page === 'products') {
      await loadPreviewCatalog();
      if (typeof SHOP !== 'undefined') SHOP.categories = previewCategoriesMerged();   // draft is null now → == live base
      window.PRODUCTS = previewProducts();
      renderCurrentPage();
    }
    if (msg && msg.focus) {
      requestAnimationFrame(function () { onPreviewFocus(msg.focus); });
    }
  }

  // Draft restaurant row (+ highlights carrying local _previewId) from Admin.
  // Applied through the SAME render path as live DB content. Never persisted.
  // `nav` is the generation the parent thinks this document is. It must equal
  // this document's own generation (from its boot URL). A mismatch means the
  // message was meant for a different document (a slot mid-renavigation) — drop
  // it, and DO NOT adopt the foreign generation.
  function applyPreviewData(payload, nav) {
    payload = payload || {};
    if (nav != null && _previewNav != null && nav !== _previewNav) return;
    const r = payload.restaurant || {};
    try {
      window.SHOP = mapRestaurant(r);                     // includes highlights pass-through
      // Catalog stays LIVE: the Admin draft owns restaurant/settings, but
      // categories + products remain whatever Supabase returned for the preview.
      if (Array.isArray(_previewCategories)) window.SHOP.categories = _previewCategories;
      if (typeof SHOP_SETTINGS !== 'undefined' && r.sounds_enabled !== undefined) {
        SHOP_SETTINGS.sounds = r.sounds_enabled !== false;
      }

      // Unsaved Menu / Categories overlay (may be null). Recompute categories +
      // PRODUCTS from the pristine bases + patches, only where they're rendered.
      if (Object.prototype.hasOwnProperty.call(payload, 'catalog')) {
        _previewCatalogDraft = normChildCatalogDraft(payload.catalog);
      }
      if (document.body.dataset.page === 'home' || document.body.dataset.page === 'products') {
        if (typeof window.SHOP !== 'undefined') window.SHOP.categories = previewCategoriesMerged();
        window.PRODUCTS = previewProducts();
      }

      // Language is authoritative Admin state, echoed on EVERY message. Obey a
      // valid value; otherwise KEEP the current one — never fall back to a
      // locale / localStorage default. That fallback was the language-reset bug.
      if (payload.lang === 'ar' || payload.lang === 'en') _previewLang = payload.lang;

      const lang = _previewLang || getLang();
      document.documentElement.lang = lang;
      document.documentElement.dir  = lang === 'ar' ? 'rtl' : 'ltr';

      applyTranslations(lang);
      applyShopContent(lang);
      applyOgTags();
      updateWaLinks();
      renderCurrentPage();
    } finally {
      // First application done: reveal this document and tell the parent it is
      // ready to promote (crossfade over the current page). `finally` so a render
      // error can never leave the preview stuck hidden. No setTimeout in the
      // handshake — PREVIEW_APPLIED is the sole readiness signal.
      if (!_previewApplied) {
        _previewApplied = true;
        document.documentElement.style.visibility = '';
        parentPost({ type: 'PREVIEW_APPLIED', nav: _previewNav });
      }
    }
  }

  // ── BOOT (async) ──────────────────────────────────────────────────
  // Applies translations/branding/reveal + renders the page-specific content.
  // Shared by: the immediate snapshot render, the normal (no-snapshot) path,
  // and the quiet background revalidation — ONE render pipeline, called from
  // wherever content is actually ready, instead of three copies of it.
  function renderShell(lang) {
    applyTranslations(lang);
    applyShopContent(lang);
    applyOgTags();
    updateWaLinks();
    syncSoundBtn();   // re-sync against the current owner setting
    const yearEl = document.getElementById('footer-year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();
    renderCurrentPage();
  }

  async function boot() {
    const lang = getLang();

    initNav();
    // Read ONCE, early: whether this load is an intercepted internal
    // transition arrival (§I) — purely the cosmetic aperture now, see the
    // "PAGE TRANSITIONS" section above. Language correctness is handled
    // entirely separately by the i18n guard below.
    const arrivedSilently = preparePageEntry();

    if (PREVIEW) {
      // §33 — Admin Preview has its own persistent double-buffer transition
      // architecture; this site's gate/loader/i18n-guard logic must never
      // layer on top of it, and the public snapshot must never mix with the
      // Admin's unsaved draft overlay. In practice none of these classes can
      // be set from inside the iframe (see isPublicInternalNavigation /
      // saveSnapshot), but strip them explicitly rather than relying on that
      // alone.
      document.documentElement.classList.remove('is-page-entering', 'is-page-leaving', 'i18n-pending');
      initPreviewMode().catch(function (e) {
        console.warn('[app.js] preview init failed:', e);
        parentPost({ type: 'PREVIEW_ERROR', nav: _previewNav });   // parent keeps the current page visible
      });
      return;
    }

    // 1P.4 rebuild — the Portal's gold wave edges carry a "living" SVG
    // SMIL <animate attributeName="d"> morph (see the four public HTML
    // files) that runs continuously and independently of the close/open
    // transform, purely decorative. Under reduced motion, §21 of the
    // 1P.4 brief asks for it to be paused, not just visually suppressed —
    // CSS alone cannot stop a running SMIL animation, only
    // SVGSVGElement.pauseAnimations() can. Runs once, unconditionally,
    // this early (never reached under PREVIEW — see the return above).
    if (reducedMotion()) {
      document.querySelectorAll('.portal-edge').forEach(function (svg) {
        try { if (typeof svg.pauseAnimations === 'function') svg.pauseAnimations(); } catch (e) {}
      });
    }

    if (isSupabaseConfigured()) {
      // Same-session snapshot: render instantly from already-known public
      // data (no network wait at all), THEN quietly revalidate — never a
      // loader for this path, and the DOM is only touched again if the live
      // data actually differs (§12/§22 — no card-replacement flash).
      const snap = readSnapshot();
      if (snap) {
        window.SHOP = snap.shop;
        window.PRODUCTS = snap.products;
        if (typeof SHOP_SETTINGS !== 'undefined') SHOP_SETTINGS.sounds = snap.shop.sounds !== false;
        renderShell(lang);
        releaseI18nGuard();   // real translations are on screen now — safe to reveal
        initReveal(arrivedSilently);
        revealDestination();
        prefetchOtherPublicPages();
        const priorSignature = JSON.stringify({ shop: snap.shop, products: snap.products });
        loadFromSupabase().then(function () {
          saveSnapshot();
          const freshSignature = JSON.stringify({ shop: window.SHOP, products: window.PRODUCTS });
          if (freshSignature !== priorSignature) {
            renderShell(lang);
            // 1P.7: this rebuilds .reveal/.reveal-grid elements fresh —
            // without this, they'd sit at opacity:0 with no observer ever
            // reattached (the original one already fired-and-unobserved
            // for the OLD nodes), leaving content the visitor already saw
            // once silently invisible until they scroll. Always
            // `immediate` here regardless of how this page was reached:
            // by the time a background reconcile fires, the visitor has
            // already been looking at this content — re-hiding then
            // re-revealing it a beat later would be a confusing flash,
            // never a wanted "entrance."
            initReveal(true);
          }
        }).catch(function (e) { console.warn('[app.js] background revalidate failed:', e); });
        return;
      }

      // No usable snapshot — a genuine cold path (first visit this session,
      // or the 60s window lapsed). §24: NEVER the 3-dot loader while a
      // silent-boot hold is active (transition arrival) — the branded gate
      // is already covering this wait; §25: for a true cold visit with no
      // hold active, the loader is the accepted fallback. The i18n guard
      // (if active) stays up regardless — it is independent of this loader.
      if (!arrivedSilently) showLoading();
      try {
        await loadFromSupabase();
        saveSnapshot();
      } catch (err) {
        if (!arrivedSilently) hideLoading();
        console.error('[app.js] Supabase load error:', err);
        // 1O §15: config/shop.js + config/products.js are DEMO PLACEHOLDER
        // business data (fake phone/WhatsApp/address/hours/menu prices) —
        // Admin Settings/Menu only ever write to the DATABASE, so these
        // bundled files stay frozen at their original placeholder values
        // forever, even long after a real launch. A prior version of this
        // catch block rendered them through the normal page pipeline on
        // every failure so the destination was never caught mid-translation
        // — but that also means ANY future outage, no matter how long after
        // launch, would present the ORIGINAL placeholder contact details and
        // menu to a real customer as if current. Hide the real content
        // outright instead of selectively blanking each unsafe field —
        // #page-content is a sibling of the error box below (never a
        // parent), so hiding it cannot hide the notice itself, and it
        // needs no translation since it is not perceivable either way.
        var pc = document.getElementById('page-content');
        if (pc) pc.style.visibility = 'hidden';
        releaseI18nGuard();
        showAppError(
          'فشل تحميل المحتوى. يرجى تحديث الصفحة.<br/>' +
          '<span style="font-size:12px;opacity:.6">Failed to load content. Please refresh.</span>'
        );
        revealDestination();   // never leave the customer stuck under the gate on a load failure — opens onto this error state, not a blank one
        return;
      }
      if (!arrivedSilently) hideLoading();
    }

    renderShell(lang);
    releaseI18nGuard();   // real translations are on screen now — safe to reveal
    initReveal(arrivedSilently);

    // Content is ready — if this load was an intercepted transition arrival,
    // open the gate now (§7/§8). No-op otherwise.
    revealDestination();
    prefetchOtherPublicPages();
  }

  // Support both DOMContentLoaded and already-loaded pages
  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', () => boot())
    : boot();
})();
