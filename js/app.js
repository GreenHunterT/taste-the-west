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
      social: { whatsappMessage: r.wa_message_ar || '' },
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
    const h = {
      'apikey':        SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
    };

    const [rRes, cRes, pRes] = await Promise.all([
      fetch(base + '/restaurants?id=eq.' + RESTAURANT_ID + '&select=*', { headers: h }),
      fetch(base + '/categories?restaurant_id=eq.' + RESTAURANT_ID + '&order=sort_order', { headers: h }),
      fetch(
        base + '/products?restaurant_id=eq.' + RESTAURANT_ID +
        '&available=eq.true&order=sort_order' +
        '&select=*,categories(id,slug,name_ar,name_en)',
        { headers: h }
      ),
    ]);

    if (!rRes.ok) throw new Error('Restaurant fetch failed (' + rRes.status + ')');

    const [restaurantRaw] = await rRes.json();
    if (!restaurantRaw) throw new Error('No restaurant found for RESTAURANT_ID: ' + RESTAURANT_ID);

    const catsRaw  = cRes.ok  ? await cRes.json()  : [];
    const prodsRaw = pRes.ok  ? await pRes.json()  : [];

    // Mutate globals so all existing render functions work unchanged.
    window.SHOP     = mapRestaurant(restaurantRaw);
    window.PRODUCTS = prodsRaw.map(mapProduct);

    window.SHOP.categories = (catsRaw || []).map(c => ({
      slug:   c.slug,
      nameAr: c.name_ar,
      nameEn: c.name_en,
    }));

    // Sync sounds flag to SHOP_SETTINGS so playUISound() respects DB value
    if (typeof SHOP_SETTINGS !== 'undefined') {
      SHOP_SETTINGS.sounds = restaurantRaw.sounds_enabled !== false;
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
    return (
      localStorage.getItem('souqsite_language') ||
      (typeof SHOP_SETTINGS !== 'undefined' ? SHOP_SETTINGS.defaultLanguage : 'ar')
    );
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
    localStorage.setItem('souqsite_language', lang);
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
    return (
      localStorage.getItem('souqsite_theme') ||
      (typeof SHOP_SETTINGS !== 'undefined' ? SHOP_SETTINGS.defaultTheme : 'dark')
    );
  }
  function applyTheme(theme) {
    if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
    else                   document.documentElement.removeAttribute('data-theme');
  }
  function toggleTheme() {
    const next = getTheme() === 'dark' ? 'light' : 'dark';
    localStorage.setItem('souqsite_theme', next);
    applyTheme(next);
  }

  // ── WHATSAPP ──────────────────────────────────────────────────────
  function waLink() {
    if (typeof SHOP === 'undefined') return '#';
    const msg = t('wa.message') || (SHOP.social && SHOP.social.whatsappMessage) || '';
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

    if (typeof PRODUCTS !== 'undefined') {
      renderProductGrid(PRODUCTS.filter(p => p.featured).slice(0, 3), 'featured-grid');
    }
  }

  function refreshHighlights(lang) {
    const hlGrid = document.getElementById('hl-grid');
    if (!hlGrid || typeof SHOP === 'undefined' || !SHOP.highlights) return;
    hlGrid.innerHTML = SHOP.highlights.map(h => `
      <div class="hl-card">
        <div class="hl-value">${h.value}</div>
        <div class="hl-label">${lang === 'ar' ? (h.labelAr || h.label) : (h.label || h.labelAr)}</div>
      </div>
    `).join('');
  }

  // ── PRODUCTS PAGE ─────────────────────────────────────────────────
  function initProducts() {
    if (typeof PRODUCTS === 'undefined') return;
    const filterBar = document.getElementById('filter-bar');
    const grid      = document.getElementById('products-grid');
    if (!grid) return;

    renderProductGrid(PRODUCTS, 'products-grid');

    if (filterBar) {
      buildFilterBar(filterBar, getLang());

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

  // ── BOOT (async) ──────────────────────────────────────────────────
  async function boot() {
    const lang  = getLang();
    const theme = getTheme();

    applyTheme(theme);
    initNav();

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

    switch (document.body.dataset.page) {
      case 'home':     initHome();     break;
      case 'products': initProducts(); break;
      case 'location': initLocation(); break;
      case 'contact':  initContact();  break;
    }
  }

  // Support both DOMContentLoaded and already-loaded pages
  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', () => boot())
    : boot();
})();
