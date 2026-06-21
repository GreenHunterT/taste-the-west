// =================================================================
//  SOUQSITE — App Runtime  v1.2
//  Reads globals: SHOP_SETTINGS, SHOP, PRODUCTS, TRANSLATIONS
//  V2 upgrade path: replace config file loads with fetch() calls
// =================================================================
(function () {
  'use strict';

  // Inline SVG placeholder shown when a product image fails to load.
  // Keeps the card layout intact — no blank collapse, no broken icon.
  const IMG_PLACEHOLDER = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3">' +
    '<rect width="4" height="3" fill="#2b2820"/>' +
    '</svg>'
  );

  // ── LANGUAGE HELPERS ────────────────────────────────────────────
  function getLang() {
    return (
      localStorage.getItem('souqsite_language') ||
      (typeof SHOP_SETTINGS !== 'undefined' ? SHOP_SETTINGS.defaultLanguage : 'ar')
    );
  }

  function t(key) {
    if (typeof TRANSLATIONS === 'undefined') return null;
    const lang = getLang();
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

  // Returns the bilingual hours string for `type` ('weekdays' | 'weekends').
  // Falls back to the English value if the *Ar key is not set.
  function shopHours(lang, type) {
    if (typeof SHOP === 'undefined' || !SHOP.hours) return '';
    if (lang === 'ar') return SHOP.hours[type + 'Ar'] || SHOP.hours[type] || '';
    return SHOP.hours[type] || '';
  }

  // ── SET LANGUAGE ────────────────────────────────────────────────
  function setLanguage(lang) {
    localStorage.setItem('souqsite_language', lang);
    document.documentElement.lang = lang;
    document.documentElement.dir  = lang === 'ar' ? 'rtl' : 'ltr';
    applyTranslations(lang);
    applyShopContent(lang);
    applyOgTags();
    updateWaLinks();
    // Per-page refreshes
    const page = document.body.dataset.page;
    if (page === 'home')     refreshHighlights(lang);
    if (page === 'products') refreshFilterAll();
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
    setText('nav-logo',     name);
    setText('footer-logo',  name);
    setText('footer-name',  name);
    setText('footer-tag',   shopTagline(lang));
    setText('hero-name',    name);
    setText('hero-tagline', shopTagline(lang));
    setText('about-desc',   shopDesc(lang));
    // Inner pages include page name in title for better SEO
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

  // ── OPEN GRAPH ───────────────────────────────────────────────────
  // Fills og: tags so WhatsApp/social share shows a real preview card.
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

  // ── THEME ────────────────────────────────────────────────────────
  function getTheme() {
    return (
      localStorage.getItem('souqsite_theme') ||
      (typeof SHOP_SETTINGS !== 'undefined' ? SHOP_SETTINGS.defaultTheme : 'dark')
    );
  }

  function applyTheme(theme) {
    if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }

  function toggleTheme() {
    const next = getTheme() === 'dark' ? 'light' : 'dark';
    localStorage.setItem('souqsite_theme', next);
    applyTheme(next);
  }

  // ── WHATSAPP LINKS ───────────────────────────────────────────────
  function waLink() {
    if (typeof SHOP === 'undefined') return '#';
    const msg = t('wa.message') || (SHOP.social && SHOP.social.whatsappMessage) || '';
    return 'https://wa.me/' + SHOP.whatsapp + '?text=' + encodeURIComponent(msg);
  }

  function updateWaLinks() {
    const url = waLink();
    document.querySelectorAll('[data-wa-link]').forEach(el => { el.href = url; });
  }

  // ── NAVIGATION ───────────────────────────────────────────────────
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

    // Active link
    const pageMap = { home: 'index.html', products: 'products.html', location: 'location.html', contact: 'contact.html' };
    const file = pageMap[document.body.dataset.page];
    document.querySelectorAll('.nav-link').forEach(l => {
      l.classList.toggle('active', l.getAttribute('href') === file);
    });

    // Theme toggle
    const themeBtn = document.getElementById('theme-btn');
    if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

    // Language toggle (event delegation — catches both desktop and mobile buttons)
    document.addEventListener('click', e => {
      const btn = e.target.closest('.lang-btn');
      if (btn && btn.dataset.lang) setLanguage(btn.dataset.lang);
    });

    // Subtle sound on interactive element clicks (requires user gesture — safe here)
    document.addEventListener('click', e => {
      if (e.target.closest('.btn, .filter-btn, .lang-btn, .theme-btn, .nav-toggle')) {
        playUISound();
      }
    }, true);
  }

  // ── HOME PAGE ────────────────────────────────────────────────────
  function initHome() {
    if (typeof SHOP === 'undefined') return;

    // Hero background — Ken Burns zoom on load
    const heroBg = document.getElementById('hero-bg');
    if (heroBg && SHOP.hero && SHOP.hero.image) {
      heroBg.setAttribute('role', 'img');
      heroBg.setAttribute('aria-label', shopName(getLang()) + ' store');
      const probe = new Image();
      probe.onload = () => {
        heroBg.style.backgroundImage = "url('" + SHOP.hero.image + "')";
        heroBg.classList.add('loaded');
      };
      probe.src = SHOP.hero.image;
    }

    // Highlights
    refreshHighlights(getLang());

    // Featured products (max 3)
    if (typeof PRODUCTS !== 'undefined') {
      renderProductGrid(PRODUCTS.filter(p => p.featured).slice(0, 3), 'featured-grid');
    }
  }

  // Extracted so setLanguage can re-render highlights without re-running all of initHome.
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

  // ── PRODUCTS PAGE ────────────────────────────────────────────────
  function initProducts() {
    if (typeof PRODUCTS === 'undefined') return;
    const filterBar = document.getElementById('filter-bar');
    const grid      = document.getElementById('products-grid');
    if (!grid) return;

    renderProductGrid(PRODUCTS, 'products-grid');

    if (filterBar) {
      const cats = ['all', ...new Set(PRODUCTS.map(p => p.category).filter(Boolean))];
      filterBar.innerHTML = cats.map(cat => `
        <button class="filter-btn${cat === 'all' ? ' active' : ''}" data-cat="${cat}">
          ${cat === 'all' ? (t('products.filterAll') || 'All') : capitalize(cat)}
        </button>
      `).join('');

      filterBar.addEventListener('click', e => {
        const btn = e.target.closest('.filter-btn');
        if (!btn) return;
        filterBar.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        grid.querySelectorAll('.product-card').forEach(card => {
          card.style.display = (btn.dataset.cat === 'all' || card.dataset.cat === btn.dataset.cat) ? '' : 'none';
        });
      });
    }
  }

  function refreshFilterAll() {
    const allBtn = document.querySelector('.filter-btn[data-cat="all"]');
    if (allBtn) allBtn.textContent = t('products.filterAll') || 'All';
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

  // ── PRODUCT CARD RENDERER ────────────────────────────────────────
  function renderProductGrid(products, containerId) {
    const grid = document.getElementById(containerId);
    if (!grid) return;

    if (!products.length) {
      grid.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:40px 0">No products to show.</p>';
      return;
    }

    const lang = getLang();

    grid.innerHTML = products.map(p => {
      const name   = lang === 'ar' ? p.name : (p.nameEn || p.name);
      const desc   = lang === 'ar' ? p.description : (p.descriptionEn || p.description);
      const imgSrc = p.image || IMG_PLACEHOLDER;
      return `
        <article class="product-card" data-cat="${p.category || ''}">
          <div class="product-img">
            <img
              src="${imgSrc}"
              alt="${name}"
              loading="lazy"
            />
            ${p.category ? `<span class="product-cat-badge" aria-hidden="true">${capitalize(p.category)}</span>` : ''}
          </div>
          <div class="product-body">
            <h3 class="product-name">${name}</h3>
            ${p.price ? `<div class="product-price">${p.price}</div>` : ''}
            ${desc    ? `<p class="product-desc">${desc}</p>`         : ''}
          </div>
        </article>
      `;
    }).join('');

    // Post-render error handlers — keeps card layout intact if an image 404s.
    grid.querySelectorAll('.product-img img').forEach(function(img) {
      img.addEventListener('error', function() {
        this.src = IMG_PLACEHOLDER;
      }, { once: true });
    });

    if (grid.classList.contains('reveal-grid')) grid.classList.add('visible');
  }

  // ── SCROLL REVEAL ────────────────────────────────────────────────
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

  // ── SOUND FEEDBACK ───────────────────────────────────────────────
  // Uses Web Audio API — no audio files needed, zero network requests.
  // Disable per shop: set SHOP_SETTINGS.sounds = false in shop.js.
  var _audioCtx = null;
  function playUISound() {
    if (typeof SHOP_SETTINGS === 'undefined' || !SHOP_SETTINGS.sounds) return;
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

  // ── HELPERS ──────────────────────────────────────────────────────
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

  // ── BOOT ─────────────────────────────────────────────────────────
  function boot() {
    const lang  = getLang();
    const theme = getTheme();

    applyTheme(theme);
    initNav();
    applyTranslations(lang);
    applyShopContent(lang);
    applyOgTags();
    updateWaLinks();
    initReveal();

    // Footer year
    const yearEl = document.getElementById('footer-year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    switch (document.body.dataset.page) {
      case 'home':     initHome();     break;
      case 'products': initProducts(); break;
      case 'location': initLocation(); break;
      case 'contact':  initContact();  break;
    }
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', boot)
    : boot();
})();
