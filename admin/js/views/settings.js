// =================================================================
//  Admin Shell — Settings view  (milestone 1I-C)
//
//  The real Restaurant Settings editor, ported from admin/settings.html +
//  admin/js/settings.js to run as a shell view. Lifecycle: mount(ctx, root)
//  / unmount(). It renders ONLY the left-side editing UI — the shared Live
//  Preview belongs to the shell (ctx.preview), mounted once for the shell's
//  life. This view never mounts a preview, never auths, never loads the
//  restaurant identity: it consumes ctx.restaurant / ctx.restaurantLoadState.
//
//  Legacy admin/settings.html + admin/js/settings.js are FROZEN as a
//  rollback until this reaches runtime parity, then settings.html becomes a
//  redirect. This module is the authoritative Settings editor going forward.
// =================================================================

window.AdminViews = window.AdminViews || {};

window.AdminViews.settings = (function () {
  'use strict';

  // ── Constants (never change) ─────────────────────────────────────
  var VALID_TYPES = new Set(['custom', 'percent', 'plus', 'rating', 'number']);
  var TYPE_LABELS = {
    custom:  'Custom text',
    percent: 'Percentage',
    plus:    'Number with +',
    rating:  'Rating out of 5',
    number:  'Plain number',
  };
  var STAT_DEFAULTS = [
    { type: 'percent', value: '100%', label: 'Fresh Daily',     labelAr: 'طازج كل يوم'  },
    { type: 'plus',    value: '4+',   label: 'Pizza Styles',    labelAr: 'تشكيلة بيتزا' },
    { type: 'rating',  value: '★4.8', label: 'Customer Rating', labelAr: 'تقييم العملاء' },
  ];
  var MAX_STATS = 6;
  var HISTORY_MAX = 20;

  // Scalar restaurant columns this form owns. A Save writes one only if the
  // owner actually edited it this session — otherwise the loaded DB value is
  // re-sent verbatim (a true patch; an un-touched field can't be blanked).
  var SAVED_FIELD_IDS = [
    'name_ar', 'name_en', 'tagline_ar', 'tagline_en', 'description_ar', 'description_en',
    'phone', 'whatsapp', 'instagram', 'email', 'wa_message_ar', 'wa_message_en',
    'address_ar', 'address_en', 'map_directions', 'map_embed',
    'hours_weekdays_en', 'hours_weekdays_ar', 'hours_weekends_en', 'hours_weekends_ar',
    'sounds_enabled',
  ];

  // ── Per-mount state (reset by resetState() at the top of mount()) ──
  var ctx, root;
  var teardownFns = [];        // DOM / window listener removers
  var previewOffs = [];        // ctx.preview.on(...) unsubscribers
  var settingsReady = false;
  var currentContextKey = null;

  var statisticsState = [];
  var statsHistory = [];
  var editSnapshot = null;
  var savedBaseline = '[]';
  var _idSeq = 0;

  var _brandObj;               // { hero:{file,url}, logo:{file,url}, location:{file,url} }
  var heroFile, logoFile, locationFile;
  var removeHero, removeLogo, removeLocation;
  var locVisualMode, locFit, locPosX, locPosY, locZoom, locHeight;
  var locEditActive, locEditPending, locEditSnapshot;
  var editedFields;

  function resetState() {
    teardownFns = [];
    previewOffs = [];
    settingsReady = false;
    currentContextKey = null;
    statisticsState = [];
    statsHistory = [];
    editSnapshot = null;
    savedBaseline = '[]';
    _idSeq = 0;
    _brandObj = { hero: { file: null, url: null }, logo: { file: null, url: null }, location: { file: null, url: null } };
    heroFile = logoFile = locationFile = null;
    removeHero = removeLogo = removeLocation = false;
    locEditActive = locEditPending = false;
    locEditSnapshot = null;
    editedFields = new Set();

    var r = (ctx && ctx.restaurant) || null;
    locVisualMode = (r && r.location_visual_mode === 'image') ? 'image' : 'map';
    locFit  = (r && r.location_image_fit === 'contain') ? 'contain' : 'cover';
    locPosX = numOr(r && r.location_image_position_x, 0, 100, 50);
    locPosY = numOr(r && r.location_image_position_y, 0, 100, 50);
    locZoom = numOr(r && r.location_image_zoom, 1, 1.6, 1);
    locHeight = (r && (r.location_image_height === 'short' || r.location_image_height === 'tall')) ? r.location_image_height : 'standard';
  }

  // ── Listener bookkeeping ─────────────────────────────────────────
  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    teardownFns.push(function () { target.removeEventListener(type, fn, opts); });
  }
  function onPreview(name, fn) {
    var off = ctx.preview.on(name, fn);
    if (typeof off === 'function') previewOffs.push(off);
  }

  // ── Small helpers ───────────────────────────────────────────────
  function $(id) { return root ? root.querySelector('#' + id) : null; }
  function val(id) { var el = $(id); return el ? el.value.trim() : ''; }
  function numOr(v, min, max, dflt) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    if (!isFinite(n)) return dflt;
    return n < min ? min : (n > max ? max : n);
  }
  function uniqueToken() {
    try { if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID(); } catch (e) {}
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function normText(s) { return String(s == null ? '' : s).trim(); }
  function firstNumber(s) { var m = String(s == null ? '' : s).match(/-?\d+(?:\.\d+)?/); return m ? parseFloat(m[0]) : NaN; }
  function clampRound(n, min, max, decimals) {
    if (!Number.isFinite(n)) return null;
    n = Math.min(max, Math.max(min, n));
    var p = Math.pow(10, decimals);
    return Math.round(n * p) / p;
  }
  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function softFocus(node) {
    if (!node) return;
    try { node.focus({ preventScroll: true }); } catch (e) { node.focus(); }
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // Segmented-control sync for this view's OWN toggles (data-loc-visual /
  // data-loc-fit / data-loc-height). The preview engine syncs its own
  // Page / Device / Language / Theme / View controls (shell chrome).
  function syncSeg(attr, value) {
    root.querySelectorAll('.lp-seg__btn[' + attr + ']').forEach(function (btn) {
      var isOn = btn.getAttribute(attr) === value;
      btn.classList.toggle('is-active', isOn);
      btn.setAttribute('aria-pressed', isOn ? 'true' : 'false');
    });
  }

  // =================================================================
  //  Editor markup  (left side only — no preview, no page/device/…/
  //  view/expand controls, no Edit|Preview toggle)
  // =================================================================
  function editorMarkup() {
    return [
      '<div class="settings-view">',
      '  <div class="settings-view__bar">',
      '    <span class="stats-dirty is-clean" id="stats-dirty" role="status" aria-live="polite">✓ All changes saved</span>',
      '    <button type="button" class="btn btn-primary btn-sm" id="save-btn">Save Changes</button>',
      '  </div>',
      '  <p class="settings-view__hint">Edits appear in the Live Preview instantly; they go live on your public site only after you Save.</p>',
      '  <p class="settings-view__hint settings-view__hint--error" id="settings-error-note" hidden>Settings are read-only — the restaurant could not be loaded. Reload the page.</p>',
      '',
      '  <form id="settings-form" novalidate>',
      '  <fieldset id="stg-fieldset" class="stg-fieldset">',
      '',
      '  <!-- Identity -->',
      '  <div class="acard" data-pv-page="home" data-pv-target="hero">',
      '    <div class="acard-title">Identity</div>',
      '    <div class="form-row">',
      '      <div class="form-group">',
      '        <label for="name_ar">Name (Arabic) <span class="required">*</span></label>',
      '        <input type="text" id="name_ar" name="name_ar" placeholder="تيست ذا ويست" dir="rtl" required />',
      '      </div>',
      '      <div class="form-group">',
      '        <label for="name_en">Name (English) <span class="required">*</span></label>',
      '        <input type="text" id="name_en" name="name_en" placeholder="Taste The West" required />',
      '      </div>',
      '    </div>',
      '    <div class="form-row">',
      '      <div class="form-group">',
      '        <label for="tagline_ar">Tagline (Arabic)</label>',
      '        <input type="text" id="tagline_ar" name="tagline_ar" placeholder="بيتزا بأسلوب مختلف" dir="rtl" />',
      '      </div>',
      '      <div class="form-group">',
      '        <label for="tagline_en">Tagline (English)</label>',
      '        <input type="text" id="tagline_en" name="tagline_en" placeholder="A Different Kind of Pizza" />',
      '      </div>',
      '    </div>',
      '    <div class="form-row" data-pv-page="home" data-pv-target="about">',
      '      <div class="form-group">',
      '        <label for="description_ar">Description (Arabic)</label>',
      '        <textarea id="description_ar" name="description_ar" dir="rtl" placeholder="وصف المطعم بالعربية…"></textarea>',
      '      </div>',
      '      <div class="form-group">',
      '        <label for="description_en">Description (English)</label>',
      '        <textarea id="description_en" name="description_en" placeholder="Restaurant description in English…"></textarea>',
      '      </div>',
      '    </div>',
      '  </div>',
      '',
      '  <!-- Contact -->',
      '  <div class="acard mt-2" data-pv-page="contact" data-pv-target="contact">',
      '    <div class="acard-title">Contact</div>',
      '    <div class="form-row triple">',
      '      <div class="form-group">',
      '        <label for="phone">Phone <small>(display format)</small></label>',
      '        <input type="tel" id="phone" name="phone" placeholder="+966 5X XXX XXXX" />',
      '      </div>',
      '      <div class="form-group">',
      '        <label for="whatsapp">WhatsApp Number <small>(digits only)</small></label>',
      '        <input type="text" id="whatsapp" name="whatsapp" placeholder="9665XXXXXXXX" />',
      '      </div>',
      '      <div class="form-group">',
      '        <label for="instagram">Instagram</label>',
      '        <input type="text" id="instagram" name="instagram" placeholder="@tastethewest" />',
      '      </div>',
      '    </div>',
      '    <div class="form-row single">',
      '      <div class="form-group">',
      '        <label for="email">Email <small>(leave blank to hide)</small></label>',
      '        <input type="email" id="email" name="email" placeholder="info@example.com" />',
      '      </div>',
      '    </div>',
      '    <div class="form-row">',
      '      <div class="form-group">',
      '        <label for="wa_message_ar">WhatsApp Pre-fill (Arabic)</label>',
      '        <input type="text" id="wa_message_ar" name="wa_message_ar" dir="rtl" placeholder="مرحباً! أريد طلب…" />',
      '      </div>',
      '      <div class="form-group">',
      '        <label for="wa_message_en">WhatsApp Pre-fill (English)</label>',
      '        <input type="text" id="wa_message_en" name="wa_message_en" placeholder="Hi! I\'d like to order…" />',
      '      </div>',
      '    </div>',
      '  </div>',
      '',
      '  <!-- Location -->',
      '  <div class="acard mt-2" data-pv-page="location" data-pv-target="location-visual">',
      '    <div class="acard-title">Location</div>',
      '    <div class="form-row">',
      '      <div class="form-group">',
      '        <label for="address_ar">Address (Arabic)</label>',
      '        <input type="text" id="address_ar" name="address_ar" dir="rtl" placeholder="حي السلطانة، المدينة المنورة" />',
      '      </div>',
      '      <div class="form-group">',
      '        <label for="address_en">Address (English)</label>',
      '        <input type="text" id="address_en" name="address_en" placeholder="Sultana District, Madinah" />',
      '      </div>',
      '    </div>',
      '    <div class="form-row single">',
      '      <div class="form-group">',
      '        <label for="map_directions">Google Maps Share Link</label>',
      '        <input type="text" id="map_directions" name="map_directions" placeholder="https://maps.app.goo.gl/…" />',
      '        <p class="field-hint">Open Google Maps → Share → Copy link</p>',
      '      </div>',
      '    </div>',
      '    <div class="form-row single">',
      '      <div class="form-group">',
      '        <label for="map_embed">Google Maps Embed URL <small>(for the iframe)</small></label>',
      '        <input type="text" id="map_embed" name="map_embed" placeholder="https://maps.google.com/maps?q=…&amp;output=embed" />',
      '        <p class="field-hint">Google Maps → Share → Embed a map → copy the src value from the iframe code</p>',
      '      </div>',
      '    </div>',
      '    <div class="form-row single">',
      '      <div class="form-group">',
      '        <label id="loc-visual-label">Location Visual</label>',
      '        <div class="lp-seg" role="group" aria-labelledby="loc-visual-label" id="loc-visual-seg">',
      '          <button type="button" class="lp-seg__btn is-active" data-loc-visual="map" aria-pressed="true">Interactive Map</button>',
      '          <button type="button" class="lp-seg__btn" data-loc-visual="image" aria-pressed="false">Location Image</button>',
      '        </div>',
      '        <div id="loc-image-field" hidden>',
      '          <div class="img-upload-area" onclick="document.getElementById(\'location-file\').click()">',
      '            <input type="file" id="location-file" accept="image/jpeg,image/png,image/webp" />',
      '            <div class="img-upload-icon">🏬</div>',
      '            <div class="img-upload-label"><strong>Click to upload</strong> or drag and drop</div>',
      '            <div class="img-upload-hint">Restaurant exterior, storefront, entrance or interior · JPG, PNG or WebP · max 5 MB</div>',
      '          </div>',
      '          <div id="loc-compose" hidden>',
      '            <img id="location-preview" class="img-preview-wide" alt="Location image" />',
      '            <label id="loc-fit-label" class="mt-1" style="display:block">Image Display</label>',
      '            <div class="lp-seg" role="group" aria-labelledby="loc-fit-label" id="loc-fit-seg">',
      '              <button type="button" class="lp-seg__btn" data-loc-fit="contain" aria-pressed="false">Fit Entire Image</button>',
      '              <button type="button" class="lp-seg__btn is-active" data-loc-fit="cover" aria-pressed="true">Fill Frame</button>',
      '            </div>',
      '            <label id="loc-height-label" class="mt-1" style="display:block">Frame Height</label>',
      '            <div class="lp-seg" role="group" aria-labelledby="loc-height-label" id="loc-height-seg">',
      '              <button type="button" class="lp-seg__btn" data-loc-height="short" aria-pressed="false">Short</button>',
      '              <button type="button" class="lp-seg__btn is-active" data-loc-height="standard" aria-pressed="true">Standard</button>',
      '              <button type="button" class="lp-seg__btn" data-loc-height="tall" aria-pressed="false">Tall</button>',
      '            </div>',
      '            <button type="button" class="btn btn-secondary btn-sm mt-2" id="loc-edit-btn">Edit Image in Preview</button>',
      '            <p class="field-hint mt-1" id="loc-fit-hint" hidden>Fit Entire Image shows the whole photo; the edges are filled with a soft blur of the same photo so nothing is cropped.</p>',
      '          </div>',
      '          <button type="button" id="location-remove" class="btn btn-danger btn-sm mt-2" hidden>Remove Location Image</button>',
      '          <p class="field-hint mt-1">Shown on the public Location page instead of the map; clicking it opens your Google Maps Share Link.</p>',
      '        </div>',
      '      </div>',
      '    </div>',
      '  </div>',
      '',
      '  <!-- Opening Hours -->',
      '  <div class="acard mt-2" data-pv-page="location" data-pv-target="hours">',
      '    <div class="acard-title">Opening Hours</div>',
      '    <div class="form-row">',
      '      <div class="form-group">',
      '        <label for="hours_weekdays_en">Weekdays (English)</label>',
      '        <input type="text" id="hours_weekdays_en" name="hours_weekdays_en" placeholder="12:00 PM – 12:00 AM" />',
      '      </div>',
      '      <div class="form-group">',
      '        <label for="hours_weekdays_ar">Weekdays (Arabic)</label>',
      '        <input type="text" id="hours_weekdays_ar" name="hours_weekdays_ar" dir="rtl" placeholder="١٢:٠٠ ظهراً – ١٢:٠٠ منتصف الليل" />',
      '      </div>',
      '    </div>',
      '    <div class="form-row">',
      '      <div class="form-group">',
      '        <label for="hours_weekends_en">Weekends (English)</label>',
      '        <input type="text" id="hours_weekends_en" name="hours_weekends_en" placeholder="12:00 PM – 1:00 AM" />',
      '      </div>',
      '      <div class="form-group">',
      '        <label for="hours_weekends_ar">Weekends (Arabic)</label>',
      '        <input type="text" id="hours_weekends_ar" name="hours_weekends_ar" dir="rtl" placeholder="١٢:٠٠ ظهراً – ١:٠٠ فجراً" />',
      '      </div>',
      '    </div>',
      '  </div>',
      '',
      '  <!-- Images -->',
      '  <div class="acard mt-2" data-pv-page="home" data-pv-target="hero">',
      '    <div class="acard-title">Images</div>',
      '    <div class="form-row">',
      '      <div class="form-group">',
      '        <label>Hero Image <small>(displayed on homepage)</small></label>',
      '        <div class="img-upload-area" onclick="document.getElementById(\'hero-file\').click()">',
      '          <input type="file" id="hero-file" accept="image/jpeg,image/png,image/webp" />',
      '          <div class="img-upload-icon">🖼</div>',
      '          <div class="img-upload-label"><strong>Click to upload</strong> or drag and drop</div>',
      '          <div class="img-upload-hint">JPG, PNG or WebP · max 5 MB · 1920×1080 px recommended</div>',
      '        </div>',
      '        <img id="hero-preview" class="img-preview-wide" hidden alt="Hero preview" />',
      '        <button type="button" id="hero-remove" class="btn btn-danger btn-sm mt-1" hidden>Remove Hero Image</button>',
      '        <input type="hidden" id="hero_image_url" name="hero_image_url" />',
      '      </div>',
      '      <div class="form-group">',
      '        <label>Logo / Brand Image <small>(optional)</small></label>',
      '        <div class="img-upload-area" onclick="document.getElementById(\'logo-file\').click()">',
      '          <input type="file" id="logo-file" accept="image/jpeg,image/png,image/webp" />',
      '          <div class="img-upload-icon">🏷</div>',
      '          <div class="img-upload-label"><strong>Click to upload</strong> or drag and drop</div>',
      '          <div class="img-upload-hint">JPG, PNG or WebP · max 5 MB · square format recommended</div>',
      '        </div>',
      '        <img id="logo-preview" class="img-preview-wide" hidden alt="Logo preview" />',
      '        <button type="button" id="logo-remove" class="btn btn-danger btn-sm mt-1" hidden>Remove Logo</button>',
      '        <input type="hidden" id="logo_url" name="logo_url" />',
      '      </div>',
      '    </div>',
      '  </div>',
      '',
      '  <!-- Homepage Statistics -->',
      '  <div class="acard mt-2" id="stats-acard" data-pv-page="home" data-pv-target="highlights">',
      '    <div class="acard-title">Homepage Statistics</div>',
      '    <p class="field-hint">The quick facts shown near the top of your homepage. Order and visibility here match the public site.</p>',
      '    <div class="stats-toolbar">',
      '      <button type="button" class="btn btn-ghost btn-sm" id="stats-undo" disabled>Undo</button>',
      '      <button type="button" class="btn btn-ghost btn-sm" id="stats-reset">Reset to default</button>',
      '      <button type="button" class="btn btn-ghost btn-sm" id="stats-view-in-preview">View in Preview</button>',
      '    </div>',
      '    <div id="stats-cards"></div>',
      '    <button type="button" class="btn btn-secondary btn-sm mt-2" id="stats-add">+ Add statistic</button>',
      '    <p class="field-hint mt-1" id="stats-max-hint" hidden>Maximum of 6 statistics.</p>',
      '  </div>',
      '',
      '  <!-- App settings -->',
      '  <div class="acard mt-2">',
      '    <div class="acard-title">App Settings</div>',
      '    <div class="toggle-row">',
      '      <div class="toggle-info">',
      '        <strong>UI Click Sounds</strong>',
      '        <span>Subtle audio feedback when buttons are pressed</span>',
      '      </div>',
      '      <label class="toggle">',
      '        <input type="checkbox" id="sounds_enabled" name="sounds_enabled" />',
      '        <span class="toggle-track"></span>',
      '      </label>',
      '    </div>',
      '  </div>',
      '',
      '  <div class="settings-view__foot">',
      '    <button type="submit" class="btn btn-primary" id="save-btn-bottom">Save Changes</button>',
      '  </div>',
      '',
      '  </fieldset>',
      '  </form>',
      '</div>',
    ].join('\n');
  }

  // =================================================================
  //  Live Preview draft transport
  // =================================================================
  function brandingPreviewUrl(kind, file, removed, savedUrl) {
    var s = _brandObj[kind];
    if (file !== s.file) {
      if (s.url) { try { URL.revokeObjectURL(s.url); } catch (e) {} }
      s.file = file || null;
      s.url = file ? URL.createObjectURL(file) : null;
    }
    if (s.url) return s.url;
    if (removed) return '';
    return savedUrl || '';
  }
  function releasePreviewObjectUrls() {
    ['hero', 'logo', 'location'].forEach(function (k) {
      if (_brandObj[k].url) { try { URL.revokeObjectURL(_brandObj[k].url); } catch (e) {} _brandObj[k].url = null; }
    });
  }

  // Draft "restaurants row" from the current UNSAVED form values + statistics
  // + branding selection. Only public-facing fields — no owner_id / id /
  // timestamps. The controller wraps this with the authoritative lang + theme.
  function buildRestaurantDraft() {
    var r = ctx.restaurant || null;
    var soundsEl = $('sounds_enabled');
    return {
      name_ar: val('name_ar'), name_en: val('name_en'),
      tagline_ar: val('tagline_ar'), tagline_en: val('tagline_en'),
      description_ar: val('description_ar'), description_en: val('description_en'),
      phone: val('phone'),
      whatsapp: val('whatsapp').replace(/\D/g, ''),
      instagram: val('instagram'), email: val('email'),
      wa_message_ar: val('wa_message_ar'), wa_message_en: val('wa_message_en'),
      address_ar: val('address_ar'), address_en: val('address_en'),
      map_directions: val('map_directions'), map_embed: val('map_embed'),
      hours_weekdays_en: val('hours_weekdays_en'), hours_weekdays_ar: val('hours_weekdays_ar'),
      hours_weekends_en: val('hours_weekends_en'), hours_weekends_ar: val('hours_weekends_ar'),
      sounds_enabled: soundsEl ? soundsEl.checked : true,
      hero_image_url: brandingPreviewUrl('hero', heroFile, removeHero, r && r.hero_image_url),
      logo_url:       brandingPreviewUrl('logo', logoFile, removeLogo, r && r.logo_url),
      location_visual_mode: locVisualMode,
      location_image_url:   brandingPreviewUrl('location', locationFile, removeLocation, r && r.location_image_url),
      location_image_fit:        locFit,
      location_image_position_x: locPosX,
      location_image_position_y: locPosY,
      location_image_zoom:       locZoom,
      location_image_height:     locHeight,
      highlights: statisticsState.map(function (s) {
        return {
          _previewId: s._id,                          // local editing id — never persisted
          type: VALID_TYPES.has(s.type) ? s.type : 'custom',
          value: normText(s.value),
          label: normText(s.label),
          labelAr: normText(s.labelAr),
          visible: s.visible !== false,
        };
      }),
    };
  }

  function postPreviewData() {
    if (!settingsReady) return;
    if (!ctx || ctx.restaurantLoadState !== 'ready') return;   // never push a blank / non-loaded draft
    if (locEditActive) return;                                 // the child owns the live image during a drag
    ctx.preview.setDraft(buildRestaurantDraft());
  }

  // Re-assert the engine's control state + geometry, then push the draft.
  function renderLivePreview() {
    if (ctx && ctx.preview) ctx.preview.refresh();
    postPreviewData();
  }

  // =================================================================
  //  Context-aware Preview  (§9–16)
  //  Starting to edit a field → the SHARED Preview switches to the right
  //  public PAGE + LANGUAGE ONCE, brings the affected content into view, and
  //  briefly highlights it. Typing thereafter → draft updates only. The
  //  context key includes lang, so switching name_en → name_ar re-acts.
  // =================================================================
  // Field id → { page, target (semantic key), lang? }.  lang omitted = keep
  // the current Preview language (phone, email, URLs, images, map, numbers).
  var FIELD_CONTEXT = {
    name_en:        { page: 'home', target: 'hero-name',    lang: 'en' },
    name_ar:        { page: 'home', target: 'hero-name',    lang: 'ar' },
    tagline_en:     { page: 'home', target: 'hero-tagline', lang: 'en' },
    tagline_ar:     { page: 'home', target: 'hero-tagline', lang: 'ar' },
    description_en: { page: 'home', target: 'about',        lang: 'en' },
    description_ar: { page: 'home', target: 'about',        lang: 'ar' },

    address_en:     { page: 'location', target: 'address', lang: 'en' },
    address_ar:     { page: 'location', target: 'address', lang: 'ar' },
    map_directions: { page: 'location', target: 'location-visual' },
    map_embed:      { page: 'location', target: 'location-visual' },

    hours_weekdays_en: { page: 'location', target: 'hours', lang: 'en' },
    hours_weekdays_ar: { page: 'location', target: 'hours', lang: 'ar' },
    hours_weekends_en: { page: 'location', target: 'hours', lang: 'en' },
    hours_weekends_ar: { page: 'location', target: 'hours', lang: 'ar' },

    phone:         { page: 'contact', target: 'contact-phone' },
    whatsapp:      { page: 'contact', target: 'contact-whatsapp' },
    wa_message_en: { page: 'contact', target: 'contact-whatsapp', lang: 'en' },
    wa_message_ar: { page: 'contact', target: 'contact-whatsapp', lang: 'ar' },
    instagram:     { page: 'contact', target: 'contact-instagram' },
    email:         { page: 'contact', target: 'contact-email' },

    'hero-file':       { page: 'home', target: 'hero-image' },
    'hero-remove':     { page: 'home', target: 'hero-image' },
    'logo-file':       { page: 'home', target: 'logo' },
    'logo-remove':     { page: 'home', target: 'logo' },
    'location-file':   { page: 'location', target: 'location-visual' },
    'location-remove': { page: 'location', target: 'location-visual' },

    sounds_enabled: null,   // app-level toggle — no page / no language
  };

  // Resolve the focused element → a normalized context, or null.
  //   { page, tkey (dedupe key part), lang, focus:{type,target|id} | null }
  function contextFor(t) {
    if (!t) return null;
    var card = t.closest && t.closest('.stat-card-ed');
    if (card && card.dataset.statId) {
      var role = (t.dataset && t.dataset.role) || '';
      if (role === 'visible') {
        // toggling visibility can make the card vanish — emphasise the region
        return { page: 'home', tkey: 'stat:' + card.dataset.statId + ':v', lang: '',
                 focus: { type: 'section', target: 'highlights' } };
      }
      var slang = role === 'label-en' ? 'en' : (role === 'label-ar' ? 'ar' : '');
      return { page: 'home', tkey: 'stat:' + card.dataset.statId, lang: slang,
               focus: { type: 'stat', id: card.dataset.statId } };
    }
    if (t.id && Object.prototype.hasOwnProperty.call(FIELD_CONTEXT, t.id)) {
      var m = FIELD_CONTEXT[t.id];
      if (!m) return null;
      return { page: m.page, tkey: m.target || '', lang: m.lang || '',
               focus: m.target ? { type: 'section', target: m.target } : null };
    }
    var h = t.closest && t.closest('[data-pv-page]');
    if (h && h.getAttribute('data-pv-page')) {
      var tk = h.getAttribute('data-pv-target') || '';
      return { page: h.getAttribute('data-pv-page'), tkey: tk, lang: '',
               focus: tk ? { type: 'section', target: tk } : null };
    }
    return null;
  }

  // force=true → act even if the context key is unchanged (explicit owner
  // gestures: "View in Preview", Add / Reset statistic).
  function applyContext(c, force) {
    if (!c || !ctx || ctx.restaurantLoadState !== 'ready') return;
    var key = c.page + '|' + (c.tkey || '') + '|' + (c.lang || '');
    if (!force && key === currentContextKey) return;       // SAME context → nothing (§4, §15)
    currentContextKey = key;
    if (c.lang && ctx.preview.getState().lang !== c.lang) ctx.preview.setLanguage(c.lang);
    ctx.preview.showPage(c.page, c.focus ? { focus: c.focus } : {});
  }

  // Primary trigger (focusin) + robustness trigger (input/change, §5). Deduped
  // by context key, so keystrokes never re-navigate / re-scroll / re-highlight.
  function enterContext(e) {
    if (!settingsReady) return;
    applyContext(contextFor(e && e.target));
  }

  function viewStatsInPreview() {
    ctx.showPane('preview');
    applyContext({ page: 'home', tkey: 'highlights', lang: '',
                   focus: { type: 'section', target: 'highlights' } }, true);
  }

  // =================================================================
  //  Statistics  (ported verbatim from settings.js)
  // =================================================================
  function nextId() { return 's' + (++_idSeq); }
  function deepCopyState(st) {
    return (st || []).map(function (s) {
      return { _id: s._id, type: s.type, value: s.value, label: s.label, labelAr: s.labelAr, visible: s.visible !== false };
    });
  }
  function statById(id) { return statisticsState.find(function (s) { return s._id === id; }) || null; }
  function inferType(value) {
    var v = String(value == null ? '' : value).trim();
    if (!v) return 'custom';
    if (/[★⭐]/.test(v)) return 'rating';
    if (/%\s*$/.test(v)) return 'percent';
    if (/\+\s*$/.test(v)) return 'plus';
    if (/^-?\d+(?:\.\d+)?$/.test(v)) return 'number';
    return 'custom';
  }
  function formatByType(type, raw) {
    var n = firstNumber(raw);
    switch (type) {
      case 'percent': return (Number.isFinite(n) ? clampRound(n, 0, 100, 0) : 0) + '%';
      case 'plus':    return (Number.isFinite(n) ? clampRound(n, 0, 999999, 0) : 0) + '+';
      case 'rating':  return '★' + (Number.isFinite(n) ? clampRound(n, 0, 5, 1) : 0);
      case 'number':  return Number.isFinite(n) ? String(clampRound(n, -999999, 999999, 2)) : '';
      default:        return String(raw == null ? '' : raw);
    }
  }
  function switchType(stat, newType) {
    if (!VALID_TYPES.has(newType)) return;
    if (newType === 'custom') {
      stat.value = normText(stat.value);
    } else {
      var n = firstNumber(stat.value);
      stat.value = formatByType(newType, Number.isFinite(n) ? n : 0);
    }
    stat.type = newType;
  }
  function fromDb(list) {
    if (!Array.isArray(list)) return [];
    return list.map(function (h) {
      var o = (h && typeof h === 'object') ? h : {};
      var value = o.value != null ? String(o.value) : '';
      var type = (typeof o.type === 'string' && VALID_TYPES.has(o.type)) ? o.type : inferType(value);
      return {
        _id: nextId(), type: type, value: value,
        label: o.label != null ? String(o.label) : '',
        labelAr: o.labelAr != null ? String(o.labelAr) : '',
        visible: o.visible !== false,
      };
    });
  }
  function normStats(state) {
    return (Array.isArray(state) ? state : []).map(function (s) {
      return {
        type: VALID_TYPES.has(s && s.type) ? s.type : 'custom',
        value: normText(s && s.value),
        label: normText(s && s.label),
        labelAr: normText(s && s.labelAr),
        visible: !(s && s.visible === false),
      };
    });
  }
  function sameStats(a, b) { return JSON.stringify(normStats(a)) === JSON.stringify(normStats(b)); }
  function summaryText(stat) {
    return TYPE_LABELS[stat.type] + ' · ' + (normText(stat.value) || '—') + (stat.visible === false ? ' · hidden' : '');
  }
  function isDirty() { return JSON.stringify(normStats(statisticsState)) !== savedBaseline; }
  function recomputeDirty() {
    var dirty = isDirty();
    root.querySelectorAll('.stats-dirty').forEach(function (el2) {
      el2.textContent = dirty ? '● Unsaved changes' : '✓ All changes saved';
      el2.classList.toggle('is-dirty', dirty);
      el2.classList.toggle('is-clean', !dirty);
    });
  }
  function pushHistory() {
    statsHistory.push(deepCopyState(statisticsState));
    if (statsHistory.length > HISTORY_MAX) statsHistory.shift();
  }
  function updateUndoBtn() { var b = $('stats-undo'); if (b) b.disabled = statsHistory.length === 0; }
  function undo() {
    if (!statsHistory.length) return;
    statisticsState = statsHistory.pop();
    editSnapshot = null;
    renderStatsEditor(); renderLivePreview(); recomputeDirty(); updateUndoBtn();
  }
  function addStat() {
    if (statisticsState.length >= MAX_STATS) return;
    pushHistory();
    var stat = { _id: nextId(), type: 'custom', value: '', label: '', labelAr: '', visible: true };
    statisticsState.push(stat);
    renderStatsEditor();
    renderLivePreview();                 // draft now carries the new stat (_previewId = stat._id)
    recomputeDirty(); updateUndoBtn();
    focusInCard(stat._id, 'input[data-role="value"]');   // editor focus
    // Preview: Home + statistics into view + highlight the NEW stat (by id, not
    // index). If the page/language must change first, the controller defers the
    // focus until the fresh Home frame has the draft + APPLIED.
    applyContext({ page: 'home', tkey: 'stat:' + stat._id, lang: '',
                   focus: { type: 'stat', id: stat._id } }, true);
  }
  function resetStats() {
    pushHistory();
    statisticsState = STAT_DEFAULTS.map(function (d) {
      return { _id: nextId(), type: d.type, value: d.value, label: d.label, labelAr: d.labelAr, visible: true };
    });
    renderStatsEditor(); renderLivePreview(); recomputeDirty(); updateUndoBtn();
    applyContext({ page: 'home', tkey: 'highlights', lang: '',
                   focus: { type: 'section', target: 'highlights' } }, true);
  }
  function onStatClick(e) {
    var btn = e.target.closest('button[data-role]');
    if (!btn) return;
    var card = btn.closest('.stat-card-ed');
    var stat = statById(card && card.dataset.statId);
    if (!stat) return;
    var role = btn.dataset.role;
    var idx = statisticsState.indexOf(stat);
    if (role === 'up' && idx > 0) {
      pushHistory();
      var t = statisticsState[idx - 1]; statisticsState[idx - 1] = statisticsState[idx]; statisticsState[idx] = t;
      afterStructural(stat._id, 'up');
    } else if (role === 'down' && idx < statisticsState.length - 1) {
      pushHistory();
      var t2 = statisticsState[idx + 1]; statisticsState[idx + 1] = statisticsState[idx]; statisticsState[idx] = t2;
      afterStructural(stat._id, 'down');
    } else if (role === 'remove') {
      pushHistory();
      statisticsState = statisticsState.filter(function (s) { return s !== stat; });
      afterStructural(null, 'remove');
    }
  }
  function afterStructural(focusId, kind) {
    renderStatsEditor(); renderLivePreview(); recomputeDirty(); updateUndoBtn();
    if (focusId) {
      focusInCard(focusId, 'button[data-role="' + (kind === 'down' ? 'down' : 'up') + '"]:not([disabled])', 'button[data-role]:not([disabled])');
    } else {
      var a = $('stats-add');
      if (a && !a.disabled) softFocus(a);
    }
  }
  function onStatInput(e) {
    var card = e.target.closest('.stat-card-ed');
    if (!card) return;
    var stat = statById(card.dataset.statId);
    if (!stat) return;
    var role = e.target.dataset.role;
    if (role === 'value') {
      var numeric = e.target.type === 'number' || e.target.type === 'range';
      if (numeric && e.target.value.trim() === '') { /* keep last good value */ } else {
        stat.value = formatByType(stat.type, e.target.value);
      }
      var out = card.querySelector('[data-role="value-out"]');
      if (out) out.textContent = normText(stat.value);
    } else if (role === 'label-en') {
      stat.label = e.target.value;
    } else if (role === 'label-ar') {
      stat.labelAr = e.target.value;
    } else { return; }
    var sum = card.querySelector('[data-role="summary"]');
    if (sum) sum.textContent = summaryText(stat);
    renderLivePreview();
    recomputeDirty();
  }
  function onStatChange(e) {
    var card = e.target.closest('.stat-card-ed');
    if (!card) return;
    var stat = statById(card.dataset.statId);
    if (!stat) return;
    var role = e.target.dataset.role;
    if (role === 'type') {
      pushHistory();
      switchType(stat, e.target.value);
      replaceCard(stat);
      renderLivePreview(); recomputeDirty(); updateUndoBtn();
      focusInCard(stat._id, 'input[data-role="value"], [data-role="value"]');
    } else if (role === 'visible') {
      pushHistory();
      stat.visible = e.target.checked;
      card.classList.toggle('is-hidden', !stat.visible);
      var sum = card.querySelector('[data-role="summary"]');
      if (sum) sum.textContent = summaryText(stat);
      renderLivePreview(); recomputeDirty(); updateUndoBtn();
    } else if (role === 'value' && (e.target.type === 'number' || e.target.type === 'range')) {
      stat.value = formatByType(stat.type, e.target.value);
      if (e.target.type === 'number') {
        var n = firstNumber(stat.value);
        e.target.value = Number.isFinite(n) ? n : 0;
      }
      var out = card.querySelector('[data-role="value-out"]');
      if (out) out.textContent = normText(stat.value);
      var sum2 = card.querySelector('[data-role="summary"]');
      if (sum2) sum2.textContent = summaryText(stat);
      renderLivePreview();
      recomputeDirty();
    }
  }
  function onStatFocusIn(e) {
    if (!isEditField(e.target)) return;
    if (!editSnapshot) editSnapshot = deepCopyState(statisticsState);
  }
  function onStatFocusOut(e) {
    if (!isEditField(e.target)) return;
    if (editSnapshot && !sameStats(editSnapshot, statisticsState)) {
      statsHistory.push(editSnapshot);
      if (statsHistory.length > HISTORY_MAX) statsHistory.shift();
      updateUndoBtn();
    }
    editSnapshot = null;
  }
  function isEditField(elx) {
    return elx && elx.matches && elx.matches('input[data-role="value"], input[data-role="label-en"], input[data-role="label-ar"]');
  }

  function renderStatsEditor() {
    var wrap = $('stats-cards');
    if (!wrap) return;
    var frag = document.createDocumentFragment();
    var total = statisticsState.length;
    if (!total) {
      var p = document.createElement('p');
      p.className = 'field-hint';
      p.textContent = 'No statistics yet. Use “+ Add statistic”, or “Reset to default”.';
      frag.appendChild(p);
    }
    statisticsState.forEach(function (stat, idx) { frag.appendChild(buildStatCard(stat, idx, total)); });
    wrap.replaceChildren(frag);
    var a = $('stats-add');
    var h = $('stats-max-hint');
    if (a) a.disabled = total >= MAX_STATS;
    if (h) {
      h.hidden = total < MAX_STATS;
      h.textContent = total > MAX_STATS
        ? 'You have ' + total + ' statistics. The maximum is ' + MAX_STATS + ' — remove some before adding more. Nothing is deleted until you Save.'
        : 'Maximum of ' + MAX_STATS + ' statistics.';
    }
  }
  function replaceCard(stat) {
    var old = cardById(stat._id);
    if (!old) { renderStatsEditor(); return; }
    old.replaceWith(buildStatCard(stat, statisticsState.indexOf(stat), statisticsState.length));
  }
  function buildStatCard(stat, idx, total) {
    var card = el('div', 'stat-card-ed' + (stat.visible === false ? ' is-hidden' : ''));
    card.dataset.statId = stat._id;
    var head = el('div', 'stat-card-ed__head');
    head.appendChild(el('span', 'stat-card-ed__title', 'Statistic ' + (idx + 1)));
    var sum = el('span', 'stat-card-ed__summary', summaryText(stat));
    sum.dataset.role = 'summary';
    head.appendChild(sum);
    card.appendChild(head);

    var tRow = el('div', 'toggle-row');
    var tInfo = el('div', 'toggle-info');
    tInfo.appendChild(el('strong', null, 'Show on website'));
    tInfo.appendChild(el('span', null, 'Uncheck to hide this from your homepage.'));
    var tLabel = el('label', 'toggle');
    var tCb = document.createElement('input');
    tCb.type = 'checkbox'; tCb.dataset.role = 'visible';
    tCb.checked = stat.visible !== false;
    tCb.setAttribute('aria-label', 'Show statistic ' + (idx + 1) + ' on website');
    tLabel.appendChild(tCb);
    tLabel.appendChild(el('span', 'toggle-track'));
    tRow.appendChild(tInfo); tRow.appendChild(tLabel);
    card.appendChild(tRow);

    var styleGroup = el('div', 'form-group stat-card-ed__row');
    var styleLbl = el('label', null, 'Display style');
    styleLbl.htmlFor = 'st-' + stat._id;
    var styleSel = document.createElement('select');
    styleSel.id = 'st-' + stat._id; styleSel.dataset.role = 'type';
    Object.keys(TYPE_LABELS).forEach(function (k) {
      var o = document.createElement('option');
      o.value = k; o.textContent = TYPE_LABELS[k];
      styleSel.appendChild(o);
    });
    styleSel.value = stat.type;
    styleGroup.appendChild(styleLbl); styleGroup.appendChild(styleSel);
    card.appendChild(styleGroup);

    card.appendChild(buildValueRow(stat));

    var lRow = el('div', 'stat-card-ed__row two');
    lRow.appendChild(buildTextField('sle-' + stat._id, 'Label (English)', 'label-en', stat.label, false));
    lRow.appendChild(buildTextField('sla-' + stat._id, 'Label (Arabic)', 'label-ar', stat.labelAr, true));
    card.appendChild(lRow);

    var foot = el('div', 'stat-card-ed__foot');
    var up = el('button', 'btn btn-ghost btn-sm', '↑ Move up');
    up.type = 'button'; up.dataset.role = 'up'; up.disabled = idx === 0;
    up.setAttribute('aria-label', 'Move statistic ' + (idx + 1) + ' up');
    var down = el('button', 'btn btn-ghost btn-sm', '↓ Move down');
    down.type = 'button'; down.dataset.role = 'down'; down.disabled = idx === total - 1;
    down.setAttribute('aria-label', 'Move statistic ' + (idx + 1) + ' down');
    var spacer = el('span', 'spacer');
    var rm = el('button', 'btn btn-danger btn-sm', 'Remove');
    rm.type = 'button'; rm.dataset.role = 'remove';
    rm.setAttribute('aria-label', 'Remove statistic ' + (idx + 1));
    foot.appendChild(up); foot.appendChild(down); foot.appendChild(spacer); foot.appendChild(rm);
    card.appendChild(foot);
    return card;
  }
  function buildTextField(id, labelText, role, value, rtl) {
    var g = el('div', 'form-group');
    var l = el('label', null, labelText);
    l.htmlFor = id;
    var i = document.createElement('input');
    i.type = 'text'; i.id = id; i.dataset.role = role;
    i.value = value == null ? '' : String(value);
    if (rtl) i.dir = 'rtl';
    g.appendChild(l); g.appendChild(i);
    return g;
  }
  function buildValueRow(stat) {
    var g = el('div', 'form-group stat-card-ed__row');
    var id = 'sv-' + stat._id;
    var n = firstNumber(stat.value);
    var num = Number.isFinite(n) ? n : '';
    var labelText = 'Value';
    var control;
    if (stat.type === 'percent') {
      labelText = 'Percentage';
      var wrap = el('div', 'flex-center gap-1');
      var range = document.createElement('input');
      range.type = 'range'; range.id = id; range.dataset.role = 'value';
      range.min = '0'; range.max = '100'; range.step = '1';
      range.value = String(Number.isFinite(n) ? clampRound(n, 0, 100, 0) : 0);
      range.style.flex = '1';
      var out = el('span', 'stat-value-out', normText(stat.value) || '0%');
      out.dataset.role = 'value-out';
      wrap.appendChild(range); wrap.appendChild(out);
      control = wrap;
    } else if (stat.type === 'plus') {
      labelText = 'Number';
      var wrap2 = el('div', 'flex-center gap-1');
      var inp = document.createElement('input');
      inp.type = 'number'; inp.id = id; inp.dataset.role = 'value';
      inp.min = '0'; inp.step = '1'; inp.value = num === '' ? '' : String(num);
      inp.style.flex = '1';
      wrap2.appendChild(inp); wrap2.appendChild(el('span', 'text-muted', '+'));
      control = wrap2;
    } else if (stat.type === 'rating') {
      labelText = 'Rating (out of 5)';
      var wrap3 = el('div', 'flex-center gap-1');
      var inp2 = document.createElement('input');
      inp2.type = 'number'; inp2.id = id; inp2.dataset.role = 'value';
      inp2.min = '0'; inp2.max = '5'; inp2.step = '0.1'; inp2.value = num === '' ? '' : String(num);
      inp2.style.flex = '1';
      wrap3.appendChild(inp2); wrap3.appendChild(el('span', 'text-muted', '/ 5'));
      control = wrap3;
    } else if (stat.type === 'number') {
      labelText = 'Number';
      var inp3 = document.createElement('input');
      inp3.type = 'number'; inp3.id = id; inp3.dataset.role = 'value';
      inp3.value = num === '' ? '' : String(num);
      control = inp3;
    } else {
      labelText = 'Text';
      var inp4 = document.createElement('input');
      inp4.type = 'text'; inp4.id = id; inp4.dataset.role = 'value';
      inp4.placeholder = 'e.g. 24/7, Since 1998, Free';
      inp4.value = stat.value == null ? '' : String(stat.value);
      control = inp4;
    }
    var l = el('label', null, labelText);
    l.htmlFor = id;
    g.appendChild(l); g.appendChild(control);
    return g;
  }
  function focusInCard(id, selector, fallbackSelector) {
    var card = cardById(id);
    if (!card) return;
    softFocus(card.querySelector(selector) || (fallbackSelector && card.querySelector(fallbackSelector)));
  }
  // Preview stat card clicked → focus the matching editor card (narrow: Edit pane first).
  function cardById(id) {
    if (!root || !id) return null;
    var all = root.querySelectorAll('.stat-card-ed[data-stat-id]');
    for (var i = 0; i < all.length; i++) {
      if (all[i].getAttribute('data-stat-id') === id) return all[i];
    }
    return null;
  }
  function focusStatCard(id) {
    ctx.showPane('edit');
    requestAnimationFrame(function () {
      var card = cardById(id);
      if (!card) return;
      card.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
      card.classList.remove('is-flash');
      void card.offsetWidth;
      card.classList.add('is-flash');
      setTimeout(function () { card.classList.remove('is-flash'); }, 1300);
      softFocus(card.querySelector('select[data-role="type"], input[data-role="value"], button[data-role]'));
    });
  }

  // =================================================================
  //  Location image  (Map ↔ Location Image, composition, direct edit)
  // =================================================================
  function refreshLocCompose() {
    var r = ctx.restaurant || null;
    var hasImg = !!locationFile || (!removeLocation && !!(r && r.location_image_url));
    var compose = $('loc-compose');
    var editBtn = $('loc-edit-btn');
    var hint = $('loc-fit-hint');
    if (compose) compose.hidden = !hasImg;
    if (editBtn) editBtn.hidden = locFit !== 'cover';
    if (hint) hint.hidden = locFit !== 'contain';
    syncSeg('data-loc-fit', locFit);
    syncSeg('data-loc-height', locHeight);
    updateLocEditUi();
  }
  function updateLocEditUi() {
    var b = $('loc-edit-btn');
    if (b) b.textContent = locEditActive ? 'Editing in Preview…' : 'Edit Image in Preview';
  }
  function setLocationVisualMode(mode) {
    locVisualMode = (mode === 'image') ? 'image' : 'map';
    syncSeg('data-loc-visual', locVisualMode);
    var field = $('loc-image-field');
    if (field) field.hidden = locVisualMode !== 'image';
    if (locVisualMode !== 'image' && (locEditActive || locEditPending)) endLocImageEdit(false);
    refreshLocCompose();
    postPreviewData();
  }
  function startLocImageEdit() {
    if (!ctx || ctx.restaurantLoadState !== 'ready' || locVisualMode !== 'image' || locFit !== 'cover') return;
    if (locEditActive || locEditPending) return;
    locEditSnapshot = { x: locPosX, y: locPosY, zoom: locZoom, height: locHeight };
    locEditActive = true;
    updateLocEditUi();
    ctx.showPane('preview');
    var st = ctx.preview.getState();
    if (st.activePage !== 'location' || st.navigating) locEditPending = true;
    // Lock the context so a follow-up focusin on a Location field doesn't
    // re-navigate; the crop overlay clears any contextual highlight child-side.
    currentContextKey = 'location|location-visual|';
    ctx.preview.startLocationImageEdit({ position_x: locPosX, position_y: locPosY, zoom: locZoom, height: locHeight });
  }
  function endLocImageEdit(restore) {
    if (!locEditActive && !locEditPending) return;
    if (restore && locEditSnapshot) {
      locPosX = locEditSnapshot.x; locPosY = locEditSnapshot.y;
      locZoom = locEditSnapshot.zoom; locHeight = locEditSnapshot.height;
    }
    var wasActive = locEditActive;
    locEditActive = false; locEditPending = false; locEditSnapshot = null;
    updateLocEditUi();
    syncSeg('data-loc-height', locHeight);
    if (wasActive && ctx && ctx.preview) ctx.preview.stopLocationImageEdit();
    postPreviewData();
  }

  // =================================================================
  //  Save
  // =================================================================
  function handleSave(e) {
    if (e && e.preventDefault) e.preventDefault();
    return doSave();
  }
  async function doSave() {
    if (!ctx || ctx.restaurantLoadState !== 'ready' || !ctx.restaurant || !ctx.restaurant.id) {
      showToast('Restaurant settings could not be loaded. Reload the page before saving.', 'error');
      return;
    }
    var restaurant = ctx.restaurant;
    var session = ctx.session;
    var btnBottom = $('save-btn-bottom');
    var btnTop = $('save-btn');
    if (btnBottom) { btnBottom.disabled = true; btnBottom.innerHTML = '<span class="btn-spinner"></span> Saving…'; }
    if (btnTop) btnTop.disabled = true;

    var oldHeroUrl = restaurant.hero_image_url || '';
    var oldLogoUrl = restaurant.logo_url || '';
    var oldLocationUrl = restaurant.location_image_url || '';
    var uploadedHeroUrl = null, uploadedLogoUrl = null, uploadedLocationUrl = null;
    var persisted = false;

    var fieldVal = function (f) {
      if (editedFields.has(f) || !restaurant) return val(f);
      var cur = restaurant[f];
      return (cur !== undefined && cur !== null) ? String(cur) : val(f);
    };

    try {
      if (!fieldVal('name_ar') || !fieldVal('name_en')) {
        showToast('Restaurant name (Arabic and English) is required.', 'error');
        return;
      }

      var heroUrl = oldHeroUrl, logoUrl = oldLogoUrl, locationUrl = oldLocationUrl;

      if (heroFile) {
        heroUrl = await uploadToStorage(heroFile, 'branding/' + session.user.id + '-hero');
        uploadedHeroUrl = heroUrl;
      } else if (removeHero) { heroUrl = ''; }

      if (logoFile) {
        logoUrl = await uploadToStorage(logoFile, 'branding/' + session.user.id + '-logo');
        uploadedLogoUrl = logoUrl;
      } else if (removeLogo) { logoUrl = ''; }

      if (locationFile) {
        locationUrl = await uploadToStorage(locationFile, 'branding/' + session.user.id + '-location-' + uniqueToken());
        uploadedLocationUrl = locationUrl;
      } else if (removeLocation) { locationUrl = ''; }

      var highlights = normStats(statisticsState);
      var soundsEl = $('sounds_enabled');
      var payload = {
        name_ar: fieldVal('name_ar'), name_en: fieldVal('name_en'),
        tagline_ar: fieldVal('tagline_ar'), tagline_en: fieldVal('tagline_en'),
        description_ar: fieldVal('description_ar'), description_en: fieldVal('description_en'),
        phone: fieldVal('phone'),
        whatsapp: fieldVal('whatsapp').replace(/\D/g, ''),
        instagram: fieldVal('instagram'), email: fieldVal('email'),
        wa_message_ar: fieldVal('wa_message_ar'), wa_message_en: fieldVal('wa_message_en'),
        address_ar: fieldVal('address_ar'), address_en: fieldVal('address_en'),
        map_directions: fieldVal('map_directions'), map_embed: fieldVal('map_embed'),
        hours_weekdays_en: fieldVal('hours_weekdays_en'), hours_weekdays_ar: fieldVal('hours_weekdays_ar'),
        hours_weekends_en: fieldVal('hours_weekends_en'), hours_weekends_ar: fieldVal('hours_weekends_ar'),
        hero_image_url: heroUrl,
        logo_url: logoUrl,
        location_visual_mode: locVisualMode,
        location_image_url: locationUrl,
        location_image_fit: locFit,
        location_image_position_x: locPosX,
        location_image_position_y: locPosY,
        location_image_zoom: locZoom,
        location_image_height: locHeight,
        highlights: highlights,
        sounds_enabled: (editedFields.has('sounds_enabled'))
          ? (soundsEl ? soundsEl.checked : true)
          : (restaurant.sounds_enabled !== false),
      };

      var result = await ctx.db.from('restaurants').update(payload).eq('id', restaurant.id);
      if (result.error) throw new Error(result.error.message);
      persisted = true;

      if (uploadedHeroUrl && oldHeroUrl && oldHeroUrl !== uploadedHeroUrl) { await deleteFromStorage(oldHeroUrl); }
      else if (removeHero && oldHeroUrl) { await deleteFromStorage(oldHeroUrl); }

      if (uploadedLogoUrl && oldLogoUrl && oldLogoUrl !== uploadedLogoUrl) { await deleteFromStorage(oldLogoUrl); }
      else if (removeLogo && oldLogoUrl) { await deleteFromStorage(oldLogoUrl); }

      if (uploadedLocationUrl && oldLocationUrl && oldLocationUrl !== uploadedLocationUrl) { await deleteFromStorage(oldLocationUrl); }
      else if (removeLocation && oldLocationUrl) { await deleteFromStorage(oldLocationUrl); }

      // Update ctx.restaurant IN PLACE so the shell + other views see saved data.
      restaurant.name_ar = payload.name_ar; restaurant.name_en = payload.name_en;
      restaurant.tagline_ar = payload.tagline_ar; restaurant.tagline_en = payload.tagline_en;
      restaurant.description_ar = payload.description_ar; restaurant.description_en = payload.description_en;
      restaurant.phone = payload.phone; restaurant.whatsapp = payload.whatsapp;
      restaurant.instagram = payload.instagram; restaurant.email = payload.email;
      restaurant.wa_message_ar = payload.wa_message_ar; restaurant.wa_message_en = payload.wa_message_en;
      restaurant.address_ar = payload.address_ar; restaurant.address_en = payload.address_en;
      restaurant.map_directions = payload.map_directions; restaurant.map_embed = payload.map_embed;
      restaurant.hours_weekdays_en = payload.hours_weekdays_en; restaurant.hours_weekdays_ar = payload.hours_weekdays_ar;
      restaurant.hours_weekends_en = payload.hours_weekends_en; restaurant.hours_weekends_ar = payload.hours_weekends_ar;
      restaurant.hero_image_url = heroUrl;
      restaurant.logo_url = logoUrl;
      restaurant.location_image_url = locationUrl;
      restaurant.location_visual_mode = locVisualMode;
      restaurant.location_image_fit = locFit;
      restaurant.location_image_position_x = locPosX;
      restaurant.location_image_position_y = locPosY;
      restaurant.location_image_zoom = locZoom;
      restaurant.location_image_height = locHeight;
      restaurant.highlights = highlights;
      restaurant.sounds_enabled = payload.sounds_enabled;

      heroFile = logoFile = locationFile = null;
      removeHero = removeLogo = removeLocation = false;
      var hi = $('hero-file'); if (hi) hi.value = '';
      var li = $('logo-file'); if (li) li.value = '';
      var lo = $('location-file'); if (lo) lo.value = '';
      updateBrandingRemoveBtns();

      savedBaseline = JSON.stringify(highlights);
      statsHistory = [];
      editSnapshot = null;
      editedFields.clear();
      updateUndoBtn();
      recomputeDirty();

      // Shared Preview now reflects the just-saved data (equivalent draft, kept
      // with _previewId so preview stat-clicks keep working).
      postPreviewData();

      showToast('Settings saved successfully.', 'success');
    } catch (err) {
      if (!persisted) {
        if (uploadedHeroUrl && uploadedHeroUrl !== oldHeroUrl) { await deleteFromStorage(uploadedHeroUrl); }
        if (uploadedLogoUrl && uploadedLogoUrl !== oldLogoUrl) { await deleteFromStorage(uploadedLogoUrl); }
        if (uploadedLocationUrl && uploadedLocationUrl !== oldLocationUrl) { await deleteFromStorage(uploadedLocationUrl); }
      }
      console.error(err);
      showToast('Save failed: ' + (err && err.message ? err.message : err), 'error');
      recomputeDirty();
    } finally {
      if (btnBottom) { btnBottom.disabled = false; btnBottom.textContent = 'Save Changes'; }
      if (btnTop) btnTop.disabled = false;
    }
  }

  // ── Branding remove buttons ─────────────────────────────────────
  function wireRemoveBtn(btnId, fileId, previewId, setFlag) {
    var btn = $(btnId);
    if (!btn) return;
    on(btn, 'click', function () {
      setFlag();
      var input = $(fileId);
      if (input) input.value = '';
      var prev = $(previewId);
      if (prev) { prev.src = ''; prev.hidden = true; }
      updateBrandingRemoveBtns();
      if (btnId === 'location-remove') refreshLocCompose();
      postPreviewData();
    });
  }
  function updateBrandingRemoveBtns() {
    toggleRemoveBtn('hero-remove', 'hero-preview', heroFile);
    toggleRemoveBtn('logo-remove', 'logo-preview', logoFile);
    toggleRemoveBtn('location-remove', 'location-preview', locationFile);
  }
  function toggleRemoveBtn(btnId, previewId, pickedFile) {
    var btn = $(btnId);
    if (!btn) return;
    var prev = $(previewId);
    var hasImage = !!pickedFile || (prev && !prev.hidden && !!prev.getAttribute('src'));
    btn.hidden = !hasImage;
  }

  // ── Form population ─────────────────────────────────────────────
  function initStats(r) {
    statisticsState = fromDb(r && r.highlights);
    savedBaseline = JSON.stringify(normStats(statisticsState));
    statsHistory = [];
    editSnapshot = null;
    renderStatsEditor();
    renderLivePreview();
    updateUndoBtn();
    recomputeDirty();
  }
  function populateForm(r) {
    ['name_ar', 'name_en', 'tagline_ar', 'tagline_en', 'description_ar', 'description_en',
     'phone', 'whatsapp', 'instagram', 'email', 'wa_message_ar', 'wa_message_en',
     'address_ar', 'address_en', 'map_directions', 'map_embed',
     'hours_weekdays_en', 'hours_weekdays_ar', 'hours_weekends_en', 'hours_weekends_ar'].forEach(function (f) {
      var elx = $(f);
      if (elx && r[f] !== undefined && r[f] !== null) elx.value = r[f];
    });
    var soundsEl = $('sounds_enabled');
    if (soundsEl) soundsEl.checked = r.sounds_enabled !== false;
    initStats(r);
  }

  // =================================================================
  //  Lifecycle
  // =================================================================
  function mount(_ctx, _root) {
    ctx = _ctx;
    root = _root;
    resetState();

    root.innerHTML = editorMarkup();

    var ready = ctx.restaurantLoadState === 'ready' && ctx.restaurant && ctx.restaurant.id;
    var r = ready ? ctx.restaurant : null;

    var form = $('settings-form');
    var fieldset = $('stg-fieldset');
    var saveTop = $('save-btn');
    var saveBottom = $('save-btn-bottom');

    if (!ready) {
      // Fail closed: read-only. The shell banner already explains the error.
      if (fieldset) fieldset.disabled = true;
      if (saveTop) saveTop.disabled = true;
      if (saveBottom) saveBottom.disabled = true;
      var note = $('settings-error-note');
      if (note) note.hidden = false;
      return;   // no populate, no draft, no context wiring, no location edit
    }

    // Existing image previews
    if (r.hero_image_url) { var hp = $('hero-preview'); if (hp) { hp.src = r.hero_image_url; hp.hidden = false; } }
    if (r.logo_url) { var lp = $('logo-preview'); if (lp) { lp.src = r.logo_url; lp.hidden = false; } }
    if (r.location_image_url) { var op = $('location-preview'); if (op) { op.src = r.location_image_url; } }

    syncSeg('data-loc-visual', locVisualMode);
    var locField = $('loc-image-field');
    if (locField) locField.hidden = locVisualMode !== 'image';

    // File pickers (listeners live on the injected elements — removed with them)
    initImageInput('hero-file', 'hero-preview', function (f) { heroFile = f; removeHero = false; updateBrandingRemoveBtns(); postPreviewData(); });
    initImageInput('logo-file', 'logo-preview', function (f) { logoFile = f; removeLogo = false; updateBrandingRemoveBtns(); postPreviewData(); });
    initImageInput('location-file', 'location-preview', function (f) { locationFile = f; removeLocation = false; updateBrandingRemoveBtns(); refreshLocCompose(); postPreviewData(); });

    wireRemoveBtn('hero-remove', 'hero-file', 'hero-preview', function () { heroFile = null; removeHero = true; });
    wireRemoveBtn('logo-remove', 'logo-file', 'logo-preview', function () { logoFile = null; removeLogo = true; });
    wireRemoveBtn('location-remove', 'location-file', 'location-preview', function () { locationFile = null; removeLocation = true; });
    updateBrandingRemoveBtns();

    // Location Visual + composition controls
    root.querySelectorAll('.lp-seg__btn[data-loc-visual]').forEach(function (btn) {
      on(btn, 'click', function () { setLocationVisualMode(btn.dataset.locVisual); });
    });
    root.querySelectorAll('.lp-seg__btn[data-loc-fit]').forEach(function (btn) {
      on(btn, 'click', function () {
        locFit = btn.dataset.locFit === 'contain' ? 'contain' : 'cover';
        if (locFit !== 'cover' && (locEditActive || locEditPending)) endLocImageEdit(false);
        refreshLocCompose(); postPreviewData();
      });
    });
    root.querySelectorAll('.lp-seg__btn[data-loc-height]').forEach(function (btn) {
      on(btn, 'click', function () {
        var h = btn.dataset.locHeight;
        locHeight = (h === 'short' || h === 'tall') ? h : 'standard';
        syncSeg('data-loc-height', locHeight);
        if (locEditActive) ctx.preview.updateLocationImageEdit({ position_x: locPosX, position_y: locPosY, zoom: locZoom, height: locHeight });
        postPreviewData();
      });
    });
    var locEditBtn = $('loc-edit-btn');
    if (locEditBtn) on(locEditBtn, 'click', startLocImageEdit);
    refreshLocCompose();

    // Statistics toolbar + delegated card events
    var addB = $('stats-add'); if (addB) on(addB, 'click', addStat);
    var undoB = $('stats-undo'); if (undoB) on(undoB, 'click', undo);
    var resetB = $('stats-reset'); if (resetB) on(resetB, 'click', resetStats);
    var viewB = $('stats-view-in-preview'); if (viewB) on(viewB, 'click', viewStatsInPreview);
    var statsCards = $('stats-cards');
    if (statsCards) {
      on(statsCards, 'input', onStatInput);
      on(statsCards, 'change', onStatChange);
      on(statsCards, 'click', onStatClick);
      on(statsCards, 'focusin', onStatFocusIn);
      on(statsCards, 'focusout', onStatFocusOut);
    }

    // Ordinary field edits → ensure context (deduped — no repeat nav) → note →
    // draft update. focusin is the primary context trigger; input/change is the
    // robustness net for autofill / programmatic / odd-focus controls (§5).
    var noteEdit = function (e) {
      if (e.target && SAVED_FIELD_IDS.indexOf(e.target.id) !== -1) editedFields.add(e.target.id);
    };
    if (form) {
      on(form, 'input', function (e) { enterContext(e); noteEdit(e); postPreviewData(); });
      on(form, 'change', function (e) { enterContext(e); noteEdit(e); postPreviewData(); });
      on(form, 'submit', handleSave);
      on(form, 'focusin', enterContext);   // context-aware Preview (§9–16)
    }
    if (saveTop) on(saveTop, 'click', function () { if (form) form.requestSubmit(); });

    // Preview → editor reactions (unsubscribed on unmount)
    onPreview('stat-click', function (d) { focusStatCard(String(d && d.previewId)); });
    onPreview('locedit-compose', function (c) {
      if (typeof c.position_x === 'number') locPosX = c.position_x;
      if (typeof c.position_y === 'number') locPosY = c.position_y;
      if (typeof c.zoom === 'number') locZoom = c.zoom;
      if (c.height) { locHeight = c.height; syncSeg('data-loc-height', locHeight); }
    });
    onPreview('locedit-done', function () { endLocImageEdit(false); });
    onPreview('locedit-cancel', function () { endLocImageEdit(true); });
    onPreview('locedit-ready', function () { locEditPending = false; updateLocEditUi(); });
    onPreview('locedit-end', function () { locEditActive = false; locEditPending = false; updateLocEditUi(); });

    // Tab close while Settings is mounted → don't leak blob: URLs
    on(window, 'beforeunload', releasePreviewObjectUrls);

    populateForm(r);

    settingsReady = true;
    postPreviewData();
  }

  function unmount() {
    // End any open Location image edit (overlay goes away with the transport)
    try { if ((locEditActive || locEditPending) && ctx && ctx.preview) ctx.preview.stopLocationImageEdit(); } catch (e) {}

    teardownFns.forEach(function (fn) { try { fn(); } catch (e) {} });
    teardownFns = [];
    previewOffs.forEach(function (off) { try { off(); } catch (e) {} });
    previewOffs = [];

    // Restore the shared Preview to the SAVED restaurant (drops the unsaved
    // draft this view pushed), THEN revoke its blob: URLs — but one frame
    // later, so the saved PREVIEW_DATA reaches the iframe before the blob a
    // preview <img> may still point at is freed.
    try { if (ctx && ctx.setPreviewToSaved) ctx.setPreviewToSaved(); } catch (e) {}
    var staleUrls = ['hero', 'logo', 'location']
      .map(function (k) { var u = _brandObj[k].url; _brandObj[k].url = null; _brandObj[k].file = null; return u; })
      .filter(Boolean);
    if (staleUrls.length) {
      requestAnimationFrame(function () {
        staleUrls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} });
      });
    }

    settingsReady = false;
    currentContextKey = null;
    ctx = null;
    root = null;
  }

  return { mount: mount, unmount: unmount };
})();
