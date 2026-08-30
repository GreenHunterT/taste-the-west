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
  // Language + theme in preview are AUTHORITATIVE Admin state: the parent echoes
  // them in every PREVIEW_DATA and the child obeys verbatim. They are only ever
  // changed here by (a) a value the parent sent, or (b) the real in-iframe
  // control — which reports the change back UP so parent and child never drift.
  // Never derived from localStorage / restaurant data / a locale default.
  var _previewLang  = null;   // 'ar' | 'en'
  var _previewTheme = null;   // 'dark' | 'light'
  var _previewApplied = false; // set once the first PREVIEW_DATA has been applied
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
    const [rRes, catalog] = await Promise.all([
      fetch(base + '/restaurants?id=eq.' + RESTAURANT_ID + '&select=*', { headers: h }),
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
        slug:   c.slug,
        nameAr: c.name_ar,
        nameEn: c.name_en,
      })),
    };
  }

  // Admin Preview only: load the LIVE catalog so the preview reflects the real
  // current menu, never the bundled demo. restaurant/settings still come from
  // the Admin parent via postMessage. On any error, degrade to an empty catalog
  // plus a preview-only notice — demo products are never shown as if real.
  async function loadPreviewCatalog() {
    if (!isSupabaseConfigured()) {
      // No live backend configured: the bundled config IS this site's real
      // content, so keeping the bundled PRODUCTS is accurate, not misleading.
      _previewCategories = (typeof SHOP !== 'undefined' && Array.isArray(SHOP.categories))
        ? SHOP.categories : [];
      return;
    }
    const base = SUPABASE_URL + '/rest/v1';
    const h = { 'apikey': SUPABASE_ANON_KEY };
    try {
      const catalog = await fetchCatalog(base, h);
      window.PRODUCTS    = catalog.products;
      _previewCategories = catalog.categories;
    } catch (e) {
      console.warn('[app.js] preview catalog load failed:', e);
      _previewCatalogFailed = true;
      window.PRODUCTS    = [];
      _previewCategories = [];
    }
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
      'border:1px solid var(--border,#3a3529);z-index:9999;max-width:340px;line-height:1.7';
    el.innerHTML = '<div style="font-size:28px;margin-bottom:12px">⚠</div>' + msg;
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
    if (typeof SHOP === 'undefined') return '';
    return lang === 'ar' ? SHOP.address.ar : SHOP.address.en;
  }
  function shopHours(lang, type) {
    if (typeof SHOP === 'undefined' || !SHOP.hours) return '';
    if (lang === 'ar') return SHOP.hours[type + 'Ar'] || SHOP.hours[type] || '';
    return SHOP.hours[type] || '';
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
  function setLanguage(lang) {
    if (PREVIEW) {
      // Real in-iframe language control: update locally AND report up so the
      // Admin preview-language selector stays in sync. Never touches storage.
      _previewLang = lang;
      parentPost({ type: 'PREVIEW_LANGUAGE_CHANGE', lang: lang });
    } else {
      localStorage.setItem('souqsite_language', lang);
    }
    document.documentElement.lang = lang;
    document.documentElement.dir  = lang === 'ar' ? 'rtl' : 'ltr';
    applyTranslations(lang);
    applyShopContent(lang);
    applyOgTags();
    updateWaLinks();
    const page = document.body.dataset.page;
    if (page === 'home')     refreshHighlights(lang);
    if (page === 'products') refreshFilterLabels(lang);
    if (page === 'location') {
      setText('loc-address',  shopAddr(lang));
      setText('loc-weekdays', shopHours(lang, 'weekdays'));
      setText('loc-weekends', shopHours(lang, 'weekends'));
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

  // ── THEME ─────────────────────────────────────────────────────────
  function getTheme() {
    var fallback = (typeof SHOP_SETTINGS !== 'undefined' ? SHOP_SETTINGS.defaultTheme : 'dark');
    if (PREVIEW) return _previewTheme || fallback;   // preview never reads shared storage
    return localStorage.getItem('souqsite_theme') || fallback;
  }
  function applyTheme(theme) {
    if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
    else                   document.documentElement.removeAttribute('data-theme');
  }
  function toggleTheme() {
    const next = getTheme() === 'dark' ? 'light' : 'dark';
    if (PREVIEW) {
      // Real in-iframe theme control: update locally AND report up so the Admin
      // preview-theme selector stays in sync. Never touches storage.
      _previewTheme = next;
      applyTheme(next);
      parentPost({ type: 'PREVIEW_THEME_CHANGE', theme: next });
      return;
    }
    localStorage.setItem('souqsite_theme', next);
    applyTheme(next);
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
    document.querySelectorAll('[data-wa-link]').forEach(el => { el.href = url; });
  }

  // ── NAVIGATION ────────────────────────────────────────────────────
  function initNav() {
    const header = document.getElementById('site-header');
    const toggle = document.getElementById('nav-toggle');
    const mobile = document.getElementById('nav-mobile');
    if (!header) return;

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

    const themeBtn = document.getElementById('theme-btn');
    if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

    document.addEventListener('click', e => {
      const btn = e.target.closest('.lang-btn');
      if (btn && btn.dataset.lang) setLanguage(btn.dataset.lang);
    });

    document.addEventListener('click', e => {
      if (e.target.closest('.btn, .filter-btn, .lang-btn, .theme-btn, .nav-toggle')) {
        playUISound();
      }
    }, true);
  }

  // ── HOME PAGE ──────────────────────────────────────────────────────
  function initHome() {
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
          grid.querySelectorAll('.product-card').forEach(card => {
            card.style.display =
              (btn.dataset.cat === 'all' || card.dataset.cat === btn.dataset.cat) ? '' : 'none';
          });
        });
      }
    }
  }

  function buildFilterBar(filterBar, lang) {
    if (typeof PRODUCTS === 'undefined') return;
    const cats = ['all', ...new Set(PRODUCTS.map(p => p.category).filter(Boolean))];
    filterBar.innerHTML = cats.map(cat => `
      <button class="filter-btn${cat === 'all' ? ' active' : ''}" data-cat="${cat}">
        ${cat === 'all' ? (t('products.filterAll') || 'All') : getCatLabel(cat, lang)}
      </button>
    `).join('');
  }

  function refreshFilterLabels(lang) {
    const filterBar = document.getElementById('filter-bar');
    if (!filterBar) return;
    filterBar.querySelectorAll('.filter-btn').forEach(btn => {
      const cat = btn.dataset.cat;
      btn.textContent = (cat === 'all')
        ? (t('products.filterAll') || 'All')
        : getCatLabel(cat, lang);
    });
  }

  // ── LOCATION PAGE ────────────────────────────────────────────────
  function initLocation() {
    if (typeof SHOP === 'undefined') return;
    const lang = getLang();

    const frame = document.getElementById('map-frame');
    if (frame && SHOP.mapEmbed) frame.src = SHOP.mapEmbed;

    setText('loc-address',  shopAddr(lang));
    setText('loc-weekdays', shopHours(lang, 'weekdays'));
    setText('loc-weekends', shopHours(lang, 'weekends'));

    const dirBtn = document.getElementById('directions-btn');
    if (dirBtn && SHOP.mapDirections) dirBtn.href = SHOP.mapDirections;
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

  // ── PRODUCT CARD RENDERER ─────────────────────────────────────────
  function renderProductGrid(products, containerId) {
    const grid = document.getElementById(containerId);
    if (!grid) return;

    if (!products || !products.length) {
      grid.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:40px 0">No items to show.</p>';
      return;
    }

    const lang = getLang();

    grid.innerHTML = products.map(p => {
      const name    = lang === 'ar' ? p.name : (p.nameEn || p.name);
      const desc    = lang === 'ar' ? p.description : (p.descriptionEn || p.description);
      const catName = p._catNameAr || p._catNameEn
        ? (lang === 'ar' ? (p._catNameAr || p._catNameEn) : (p._catNameEn || p._catNameAr))
        : getCatLabel(p.category || '', lang);
      // Use file placeholder when image is empty; broken src falls back to IMG_BROKEN inline.
      const imgSrc  = p.image || IMG_DEFAULT;
      return `
        <article class="product-card" data-cat="${p.category || ''}">
          <div class="product-img">
            <img src="${imgSrc}" alt="${name}" loading="lazy" />
            ${p.category ? `<span class="product-cat-badge" aria-hidden="true">${catName}</span>` : ''}
          </div>
          <div class="product-body">
            <h3 class="product-name">${name}</h3>
            ${p.price ? `<div class="product-price">${p.price}</div>` : ''}
            ${desc    ? `<p class="product-desc">${desc}</p>`         : ''}
          </div>
        </article>
      `;
    }).join('');

    grid.querySelectorAll('.product-img img').forEach(function (img) {
      img.addEventListener('error', function () { this.src = IMG_BROKEN; }, { once: true });
    });

    if (grid.classList.contains('reveal-grid')) grid.classList.add('visible');
  }

  // ── SCROLL REVEAL ─────────────────────────────────────────────────
  function initReveal() {
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
    targets.forEach(el => io.observe(el));
  }

  // ── SOUND FEEDBACK ────────────────────────────────────────────────
  var _audioCtx = null;
  function playUISound() {
    if (PREVIEW) return;                 // no click beeps inside the Admin preview
    const sounds = typeof SHOP_SETTINGS !== 'undefined'
      ? SHOP_SETTINGS.sounds
      : (typeof SHOP !== 'undefined' ? SHOP.sounds : false);
    if (!sounds) return;
    try {
      if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (_audioCtx.state === 'suspended') _audioCtx.resume();
      const osc  = _audioCtx.createOscillator();
      const gain = _audioCtx.createGain();
      osc.connect(gain);
      gain.connect(_audioCtx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(780, _audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(520, _audioCtx.currentTime + 0.09);
      gain.gain.setValueAtTime(0.045, _audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, _audioCtx.currentTime + 0.11);
      osc.start(_audioCtx.currentTime);
      osc.stop(_audioCtx.currentTime + 0.11);
    } catch (e) {}
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
    // theme, unsaved draft) has been applied — otherwise a freshly navigated
    // page paints its bundled-default language/theme for a frame and flashes.
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
    applyTheme(getTheme());
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

  function onPreviewMessage(e) {
    if (e.origin !== window.location.origin) return;      // same-origin only
    if (e.source !== window.parent) return;               // from our embedder only
    const msg = e.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'PREVIEW_DATA') {
      applyPreviewData(msg.payload || {}, msg.nav);
    } else if (msg.type === 'PREVIEW_SCROLL_TO' && msg.target === 'highlights') {
      const g = document.getElementById('hl-grid');
      if (g) g.scrollIntoView({ behavior: msg.behavior === 'auto' ? 'auto' : 'smooth', block: 'center' });
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

      // Language + theme are authoritative Admin state, echoed on EVERY message.
      // Obey a valid value; otherwise KEEP the current one — never fall back to a
      // locale / localStorage default. That fallback was the language-reset bug.
      if (payload.lang === 'ar' || payload.lang === 'en')        _previewLang  = payload.lang;
      if (payload.theme === 'dark' || payload.theme === 'light') _previewTheme = payload.theme;

      const lang = _previewLang || getLang();
      document.documentElement.lang = lang;
      document.documentElement.dir  = lang === 'ar' ? 'rtl' : 'ltr';
      applyTheme(_previewTheme || getTheme());

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
  async function boot() {
    const lang  = getLang();
    const theme = getTheme();

    applyTheme(theme);
    initNav();

    if (PREVIEW) {
      initPreviewMode().catch(function (e) {
        console.warn('[app.js] preview init failed:', e);
        parentPost({ type: 'PREVIEW_ERROR', nav: _previewNav });   // parent keeps the current page visible
      });
      return;
    }

    if (isSupabaseConfigured()) {
      showLoading();
      try {
        await loadFromSupabase();
      } catch (err) {
        console.error('[app.js] Supabase load error:', err);
        showAppError(
          'فشل تحميل المحتوى. يرجى تحديث الصفحة.<br/>' +
          '<span style="font-size:12px;opacity:.6">Failed to load content. Please refresh.</span>'
        );
        return;
      }
      hideLoading();
    }

    applyTranslations(lang);
    applyShopContent(lang);
    applyOgTags();
    updateWaLinks();
    initReveal();

    const yearEl = document.getElementById('footer-year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    renderCurrentPage();
  }

  // Support both DOMContentLoaded and already-loaded pages
  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', () => boot())
    : boot();
})();
