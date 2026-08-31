(async function () {
  // ── Homepage Statistics: constants ─────────────────────────────
  const VALID_TYPES = new Set(['custom', 'percent', 'plus', 'rating', 'number']);
  const TYPE_LABELS = {
    custom:  'Custom text',
    percent: 'Percentage',
    plus:    'Number with +',
    rating:  'Rating out of 5',
    number:  'Plain number',
  };
  // TasteTheWest defaults — data, not hard-coded editor features.
  const STAT_DEFAULTS = [
    { type: 'percent', value: '100%', label: 'Fresh Daily',     labelAr: 'طازج كل يوم'  },
    { type: 'plus',    value: '4+',   label: 'Pizza Styles',    labelAr: 'تشكيلة بيتزا' },
    { type: 'rating',  value: '★4.8', label: 'Customer Rating', labelAr: 'تقييم العملاء' },
  ];
  const MAX_STATS   = 6;
  const HISTORY_MAX = 20;

  // ── Homepage Statistics: in-memory editor state ────────────────
  // The single source of truth for the editor AND the preview.
  // Each entry: { _id, type, value, label, labelAr, visible }.
  // _id is local editing identity only — NEVER persisted.
  let statisticsState = [];
  let statsHistory    = [];     // deep-copied snapshots for Undo (unsaved only)
  let editSnapshot    = null;   // captured on focus of a value/label field
  let savedBaseline   = '[]';   // JSON.stringify(normStats(loaded)) — dirty baseline
  let _idSeq          = 0;

  // ── Live Preview ────────────────────────────────────────────────
  // The generic double-buffered <iframe> engine lives in live-preview.js.
  // Settings only: builds the restaurant draft, decides WHEN it changed, and
  // reacts to a few controller events. Frame lifecycle / navigation
  // generations / handshake / scaling / Page·Device·Language·Theme·View
  // controls / Expand / message validation are all the controller's.
  let adminMode     = 'edit';    // narrow-screen Edit | Preview toggle (Settings layout)
  let settingsReady = false;     // Settings state fully wired — safe to push a draft

  const _brandObj = {
    hero:     { file: null, url: null },
    logo:     { file: null, url: null },
    location: { file: null, url: null },
  };

  // Fail-closed Settings load. Settings only ever UPDATEs the ONE restaurant row
  // it successfully loaded — never inserts, never guesses, never writes against
  // blank state. Anything other than exactly-one-row → 'error': Save stays
  // disabled, no draft is pushed to the preview, no dirty baseline is set.
  let restaurantLoadState = 'loading';   // 'loading' | 'ready' | 'error'
  let restaurant = null;

  // Direct-in-Preview Location image edit session — Settings' mirror of the
  // controller's transport state, used only by Settings' own guards. Declared
  // here (not with the other loc* draft state further down) so the early
  // controller-event subscriptions can close over it without a TDZ risk.
  let locEditActive  = false;
  let locEditPending = false;   // true while waiting for the Location page to become ready
  let locEditSnapshot = null;   // composition captured on Edit start, for Cancel

  if (!window.LivePreview || typeof window.LivePreview.mount !== 'function') {
    console.error('[settings] LivePreview controller missing — check the <script> order in settings.html');
    if (typeof showToast === 'function') showToast('Live Preview failed to load. Reload the page.', 'error');
    hideLoading();
    return;
  }

  // Mount the preview engine now, so the first public page starts loading in
  // parallel with the auth + restaurant round-trip below (unchanged timing).
  const preview = window.LivePreview.mount({
    root:         document.getElementById('live-preview'),
    expandTarget: document.querySelector('.settings-layout'),
    expandClass:  'is-preview-expanded',
  });

  // Controller → Settings. The generic engine forwards intent; Settings owns
  // the Admin-side reaction (editor DOM, composition draft, Cancel snapshot).
  preview.on('stat-click', ({ previewId }) => focusStatCard(String(previewId)));
  preview.on('locedit-compose', c => {
    if (typeof c.position_x === 'number') locPosX = c.position_x;
    if (typeof c.position_y === 'number') locPosY = c.position_y;
    if (typeof c.zoom === 'number')       locZoom = c.zoom;
    if (c.height) { locHeight = c.height; syncSeg('data-loc-height', locHeight); }
  });
  preview.on('locedit-done',   () => endLocImageEdit(false));
  preview.on('locedit-cancel', () => endLocImageEdit(true));
  preview.on('locedit-ready',  () => { locEditPending = false; updateLocEditUi(); });
  preview.on('locedit-end',    () => { locEditActive = false; locEditPending = false; updateLocEditUi(); });

  // Save is disabled from the very first paint until a single restaurant row
  // has loaded (§5) — a mid-load click can never write.
  const saveBtnEls = ['save-btn', 'save-btn-bottom']
    .map(id => document.getElementById(id)).filter(Boolean);
  saveBtnEls.forEach(b => { b.disabled = true; });

  showLoading();
  const session = await requireAuth();
  if (!session) return;

  // Load the owner's restaurant row WITHOUT .single() so 0 vs >1 vs error are
  // distinguishable and can each fail closed.
  let _loadErr = null, _rows = null;
  try {
    const res = await db.from('restaurants').select('*').eq('owner_id', session.user.id);
    _loadErr = res.error; _rows = res.data;
  } catch (err) { _loadErr = err; }

  if (_loadErr) {
    restaurantLoadState = 'error';
    console.error('[settings] restaurant load failed:', _loadErr && (_loadErr.message || _loadErr), _loadErr);
  } else if (!Array.isArray(_rows) || _rows.length === 0) {
    restaurantLoadState = 'error';
    console.error('[settings] no restaurant row for owner_id', session.user.id,
      '— Settings does not create restaurants.');
  } else if (_rows.length > 1) {
    restaurantLoadState = 'error';
    console.error('[settings] DATA INTEGRITY: ' + _rows.length +
      ' restaurant rows for owner_id ' + session.user.id + ' →', _rows.map(r => r.id));
  } else if (!_rows[0] || !_rows[0].id) {
    restaurantLoadState = 'error';
    console.error('[settings] restaurant row has no id:', _rows[0]);
  } else {
    restaurant = _rows[0];
    restaurantLoadState = 'ready';
  }

  initAdminShell(restaurant ? (restaurant.name_en || restaurant.name_ar || 'My Restaurant') : 'My Restaurant');
  hideLoading();

  if (restaurantLoadState === 'ready') {
    populateForm(restaurant);                       // establishes the dirty baseline + first draft
    saveBtnEls.forEach(b => { b.disabled = false; });
  } else {
    showSettingsLoadError();                        // persistent owner-facing banner
    const addB = document.getElementById('stats-add');
    if (addB) addB.disabled = true;
    renderLivePreview();                            // size the iframe only — postPreviewData is gated on 'ready'
  }

  function showSettingsLoadError() {
    const main = document.querySelector('.admin-main');
    if (!main || document.getElementById('settings-load-error')) return;
    const box = document.createElement('div');
    box.id = 'settings-load-error';
    box.className = 'settings-load-error';
    box.setAttribute('role', 'alert');
    box.textContent = 'Restaurant settings could not be loaded. Reload the page before making changes.';
    const header = main.querySelector('.admin-page-header');
    main.insertBefore(box, header ? header.nextSibling : main.firstChild);
  }

  // Image file pickers + explicit-remove state (hero, logo, location are independent)
  let heroFile = null;
  let logoFile = null;
  let locationFile = null;
  let removeHero = false;
  let removeLogo = false;
  let removeLocation = false;
  // Location-page big visual: 'map' | 'image' — ordinary draft data, not a
  // Statistics-style dirty-tracked field (same as map_embed / map_directions).
  let locVisualMode = (restaurant && restaurant.location_visual_mode === 'image') ? 'image' : 'map';
  // Location image composition (ordinary draft data; the PUBLIC renderer owns
  // how these translate to object-fit / object-position / scale).
  let locFit  = (restaurant && restaurant.location_image_fit === 'contain') ? 'contain' : 'cover';
  let locPosX = numOr(restaurant && restaurant.location_image_position_x, 0, 100, 50);
  let locPosY = numOr(restaurant && restaurant.location_image_position_y, 0, 100, 50);
  let locZoom = numOr(restaurant && restaurant.location_image_zoom, 1, 1.6, 1);
  let locHeight = (restaurant && (restaurant.location_image_height === 'short' || restaurant.location_image_height === 'tall'))
    ? restaurant.location_image_height : 'standard';
  // Direct-in-Preview image editing session state (locEditActive / locEditPending
  // / locEditSnapshot) is declared up with restaurantLoadState — see the note
  // there. Crop position + zoom are NOT shown to the owner as a "focal point":
  // they drag the real image in the real Live Preview.

  // Picking a new file always supersedes a pending "remove".
  initImageInput('hero-file', 'hero-preview', f => { heroFile = f; removeHero = false; updateBrandingRemoveBtns(); postPreviewData(); });
  initImageInput('logo-file', 'logo-preview', f => { logoFile = f; removeLogo = false; updateBrandingRemoveBtns(); postPreviewData(); });
  initImageInput('location-file', 'location-preview', f => { locationFile = f; removeLocation = false; updateBrandingRemoveBtns(); refreshLocCompose(); postPreviewData(); });

  // Show existing images if saved
  if (restaurant && restaurant.hero_image_url) {
    const prev = document.getElementById('hero-preview');
    if (prev) { prev.src = restaurant.hero_image_url; prev.hidden = false; }
  }
  if (restaurant && restaurant.logo_url) {
    const prev = document.getElementById('logo-preview');
    if (prev) { prev.src = restaurant.logo_url; prev.hidden = false; }
  }
  if (restaurant && restaurant.location_image_url) {
    const prev = document.getElementById('location-preview');
    if (prev) { prev.src = restaurant.location_image_url; }
  }
  // Reflect the loaded visual mode in the segmented control + uploader visibility.
  syncSeg('data-loc-visual', locVisualMode);
  const locImgField0 = document.getElementById('loc-image-field');
  if (locImgField0) locImgField0.hidden = locVisualMode !== 'image';

  // ── Remove image buttons ─────────────────────────────────────────
  wireRemoveBtn('hero-remove', 'hero-file', 'hero-preview', () => { heroFile = null; removeHero = true; });
  wireRemoveBtn('logo-remove', 'logo-file', 'logo-preview', () => { logoFile = null; removeLogo = true; });
  wireRemoveBtn('location-remove', 'location-file', 'location-preview', () => { locationFile = null; removeLocation = true; refreshLocCompose(); });
  updateBrandingRemoveBtns();

  // ── Location Visual: Map | Business Image (preview-only until Save) ─────
  document.querySelectorAll('.lp-seg__btn[data-loc-visual]').forEach(btn => {
    btn.addEventListener('click', () => setLocationVisualMode(btn.dataset.locVisual));
  });
  function setLocationVisualMode(mode) {
    locVisualMode = (mode === 'image') ? 'image' : 'map';
    syncSeg('data-loc-visual', locVisualMode);
    const field = document.getElementById('loc-image-field');
    if (field) field.hidden = locVisualMode !== 'image';
    if (locVisualMode !== 'image' && (locEditActive || locEditPending)) endLocImageEdit(false);
    refreshLocCompose();
    postPreviewData();
  }

  // ── Location image: Fit/Fill + Frame Height (owner controls) ─────
  // Detailed composition (position + zoom) is done by DRAGGING the real image
  // in the Live Preview — see startLocImageEdit / PREVIEW_LOCATION_* below.
  document.querySelectorAll('.lp-seg__btn[data-loc-fit]').forEach(btn => {
    btn.addEventListener('click', () => {
      locFit = btn.dataset.locFit === 'contain' ? 'contain' : 'cover';
      if (locFit !== 'cover' && (locEditActive || locEditPending)) endLocImageEdit(false);
      refreshLocCompose(); postPreviewData();
    });
  });
  document.querySelectorAll('.lp-seg__btn[data-loc-height]').forEach(btn => {
    btn.addEventListener('click', () => {
      const h = btn.dataset.locHeight;
      locHeight = (h === 'short' || h === 'tall') ? h : 'standard';
      syncSeg('data-loc-height', locHeight);
      if (locEditActive) {                     // keep the open editor in sync
        preview.updateLocationImageEdit({ position_x: locPosX, position_y: locPosY, zoom: locZoom, height: locHeight });
      }
      postPreviewData();
    });
  });
  const locEditBtn = document.getElementById('loc-edit-btn');
  if (locEditBtn) locEditBtn.addEventListener('click', startLocImageEdit);

  // Sync the (now minimal) Settings image controls to state.
  function refreshLocCompose() {
    const hasImg  = !!locationFile || (!removeLocation && !!(restaurant && restaurant.location_image_url));
    const compose = document.getElementById('loc-compose');
    const editBtn = document.getElementById('loc-edit-btn');
    const hint    = document.getElementById('loc-fit-hint');
    if (compose) compose.hidden = !hasImg;
    if (editBtn) editBtn.hidden = locFit !== 'cover';   // direct edit only makes sense for Fill Frame
    if (hint)    hint.hidden    = locFit !== 'contain';
    syncSeg('data-loc-fit', locFit);
    syncSeg('data-loc-height', locHeight);
    updateLocEditUi();
  }

  function updateLocEditUi() {
    const b = document.getElementById('loc-edit-btn');
    if (b) b.textContent = locEditActive ? 'Editing in Preview…' : 'Edit Image in Preview';
  }

  // Enter direct-edit: ask the controller to put the Location page up and the
  // child into edit mode. Snapshot the composition for Cancel. The controller
  // handles the navigate-then-wait-for-APPLIED sequencing and the transport.
  function startLocImageEdit() {
    if (restaurantLoadState !== 'ready' || locVisualMode !== 'image' || locFit !== 'cover') return;
    if (locEditActive || locEditPending) return;
    locEditSnapshot = { x: locPosX, y: locPosY, zoom: locZoom, height: locHeight };
    locEditActive = true;
    updateLocEditUi();
    if (isNarrowAdmin()) setAdminMode('preview');
    const st = preview.getState();
    if (st.activePage !== 'location' || st.navigating) locEditPending = true;
    preview.startLocationImageEdit({ position_x: locPosX, position_y: locPosY, zoom: locZoom, height: locHeight });
  }
  // Exit edit mode. restore=true → revert composition to the Edit-start snapshot.
  function endLocImageEdit(restore) {
    if (!locEditActive && !locEditPending) return;
    if (restore && locEditSnapshot) {
      locPosX = locEditSnapshot.x; locPosY = locEditSnapshot.y;
      locZoom = locEditSnapshot.zoom; locHeight = locEditSnapshot.height;
    }
    const wasActive = locEditActive;
    locEditActive = false; locEditPending = false; locEditSnapshot = null;
    updateLocEditUi();
    syncSeg('data-loc-height', locHeight);
    if (wasActive) preview.stopLocationImageEdit();
    postPreviewData();   // one full resync now that editing is over (§14 boundary)
  }
  refreshLocCompose();

  // ── Homepage Statistics: wiring ───────────────────────────────
  const addBtn   = document.getElementById('stats-add');
  const undoBtn  = document.getElementById('stats-undo');
  const resetBtn = document.getElementById('stats-reset');
  if (addBtn)   addBtn.addEventListener('click', addStat);
  if (undoBtn)  undoBtn.addEventListener('click', undo);
  if (resetBtn) resetBtn.addEventListener('click', resetStats);

  const statsCards = document.getElementById('stats-cards');
  if (statsCards) {
    statsCards.addEventListener('input',    onStatInput);
    statsCards.addEventListener('change',   onStatChange);
    statsCards.addEventListener('click',    onStatClick);
    statsCards.addEventListener('focusin',  onStatFocusIn);
    statsCards.addEventListener('focusout', onStatFocusOut);
  }

  // Narrow-screen Edit | Preview mode (Settings layout). The preview engine's
  // own Page / Device / Language / Theme / View / Expand controls + the window
  // resize + message listeners are wired by live-preview.js.
  document.querySelectorAll('.lp-seg__btn[data-admin-mode]').forEach(btn => {
    btn.addEventListener('click', () => setAdminMode(btn.dataset.adminMode));
  });
  setAdminMode('edit');

  window.addEventListener('beforeunload', releasePreviewObjectUrls);
  const lpViewBtn = document.getElementById('stats-view-in-preview');
  if (lpViewBtn) lpViewBtn.addEventListener('click', viewStatsInPreview);

  // Scalar restaurant columns the Settings form owns. A Save only writes one of
  // these if the owner actually edited it this session — otherwise the value
  // loaded from the DB is re-sent verbatim. This makes Save a true patch and
  // means a field the form never populated (e.g. a mid-migration load glitch)
  // can NEVER be blanked by clicking Save.
  const SAVED_FIELD_IDS = [
    'name_ar','name_en','tagline_ar','tagline_en','description_ar','description_en',
    'phone','whatsapp','instagram','email','wa_message_ar','wa_message_en',
    'address_ar','address_en','map_directions','map_embed',
    'hours_weekdays_en','hours_weekdays_ar','hours_weekends_en','hours_weekends_ar',
    'sounds_enabled',
  ];
  const editedFields = new Set();
  function noteEdit(e) {
    if (e.target && SAVED_FIELD_IDS.indexOf(e.target.id) !== -1) editedFields.add(e.target.id);
  }

  // Any ordinary Settings field edit refreshes the live preview (rAF-coalesced
  // inside postPreviewData). Statistics edits also call renderLivePreview().
  const settingsForm = document.getElementById('settings-form');
  if (settingsForm) {
    settingsForm.addEventListener('input',  e => { noteEdit(e); postPreviewData(); });
    settingsForm.addEventListener('change', e => { noteEdit(e); postPreviewData(); });
  }

  // Settings state is now fully loaded/wired — safe to push draft data. The
  // controller routes it to whichever frame is ready (first load or active).
  settingsReady = true;
  postPreviewData();

  function wireRemoveBtn(btnId, fileId, previewId, setFlag) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.addEventListener('click', () => {
      setFlag();
      const input = document.getElementById(fileId);
      if (input) input.value = '';
      const prev = document.getElementById(previewId);
      if (prev) { prev.src = ''; prev.hidden = true; }
      updateBrandingRemoveBtns();
      postPreviewData();
    });
  }

  function updateBrandingRemoveBtns() {
    toggleRemoveBtn('hero-remove', 'hero-preview', heroFile);
    toggleRemoveBtn('logo-remove', 'logo-preview', logoFile);
    toggleRemoveBtn('location-remove', 'location-preview', locationFile);
  }
  function toggleRemoveBtn(btnId, previewId, pickedFile) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    const prev = document.getElementById(previewId);
    const hasImage = !!pickedFile || (prev && !prev.hidden && !!prev.getAttribute('src'));
    btn.hidden = !hasImage;
  }

  // Form submit — both the top and bottom Save buttons
  document.getElementById('settings-form').addEventListener('submit', handleSave);
  const topBtn = document.getElementById('save-btn');
  if (topBtn) topBtn.addEventListener('click', () => document.getElementById('settings-form').requestSubmit());

  async function handleSave(e) {
    e.preventDefault();

    // Fail closed: Settings only ever UPDATEs the row it successfully loaded.
    if (restaurantLoadState !== 'ready' || !restaurant || !restaurant.id) {
      showToast('Restaurant settings could not be loaded. Reload the page before saving.', 'error');
      return;
    }

    const btn = document.getElementById('save-btn-bottom');
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-spinner"></span> Saving…';

    // Branding / location image lifecycle — hero, logo and location tracked independently.
    const oldHeroUrl     = restaurant ? (restaurant.hero_image_url     || '') : '';
    const oldLogoUrl     = restaurant ? (restaurant.logo_url           || '') : '';
    const oldLocationUrl = restaurant ? (restaurant.location_image_url || '') : '';
    let uploadedHeroUrl = null;   // set only if THIS save uploaded a new hero object
    let uploadedLogoUrl = null;
    let uploadedLocationUrl = null;
    let persisted = false;        // true only once the restaurants row write succeeds

    // For a form-owned column: the edited form value, else the value loaded
    // from the DB (so an un-touched field is re-persisted, never blanked).
    const fieldVal = (f) => {
      if (editedFields.has(f) || !restaurant) return val(f);
      const cur = restaurant[f];
      return (cur !== undefined && cur !== null) ? String(cur) : val(f);
    };

    try {
      // Validate the required name BEFORE any upload, so a missing name can
      // never leave an orphaned branding object behind. If the form never
      // populated (load glitch) this blocks Save rather than wiping the row.
      if (!fieldVal('name_ar') || !fieldVal('name_en')) {
        showToast('Restaurant name (Arabic and English) is required.', 'error');
        btn.disabled = false; btn.textContent = 'Save Changes';
        return;
      }

      // Resolve the hero/logo/location URLs to persist.
      let heroUrl     = oldHeroUrl;
      let logoUrl     = oldLogoUrl;
      let locationUrl = oldLocationUrl;

      if (heroFile) {
        heroUrl = await uploadToStorage(heroFile, 'branding/' + session.user.id + '-hero');
        uploadedHeroUrl = heroUrl;
      } else if (removeHero) {
        heroUrl = '';
      }

      if (logoFile) {
        logoUrl = await uploadToStorage(logoFile, 'branding/' + session.user.id + '-logo');
        uploadedLogoUrl = logoUrl;
      } else if (removeLogo) {
        logoUrl = '';
      }

      // Switching the visual back to Map does NOT delete a stored image —
      // only an explicit "Remove image" (removeLocation) clears it.
      if (locationFile) {
        // Replacement lands on a UNIQUE key: the currently-published object is
        // left untouched until the DB write succeeds, so a failed Save is a real
        // rollback (old URL still resolves to the ORIGINAL bytes). The old
        // object is deleted only AFTER `persisted`.
        locationUrl = await uploadToStorage(
          locationFile, 'branding/' + session.user.id + '-location-' + uniqueToken()
        );
        uploadedLocationUrl = locationUrl;
      } else if (removeLocation) {
        locationUrl = '';
      }

      // Homepage statistics: persist the builder state as
      // [{ type, value, label, labelAr, visible }] — local ids are dropped.
      const highlights = normStats(statisticsState);

      const soundsEl = document.getElementById('sounds_enabled');
      const payload = {
        name_ar:          fieldVal('name_ar'),
        name_en:          fieldVal('name_en'),
        tagline_ar:       fieldVal('tagline_ar'),
        tagline_en:       fieldVal('tagline_en'),
        description_ar:   fieldVal('description_ar'),
        description_en:   fieldVal('description_en'),
        phone:            fieldVal('phone'),
        whatsapp:         fieldVal('whatsapp').replace(/\D/g, ''),
        instagram:        fieldVal('instagram'),
        email:            fieldVal('email'),
        wa_message_ar:    fieldVal('wa_message_ar'),
        wa_message_en:    fieldVal('wa_message_en'),
        address_ar:       fieldVal('address_ar'),
        address_en:       fieldVal('address_en'),
        map_directions:   fieldVal('map_directions'),
        map_embed:        fieldVal('map_embed'),
        hours_weekdays_en: fieldVal('hours_weekdays_en'),
        hours_weekdays_ar: fieldVal('hours_weekdays_ar'),
        hours_weekends_en: fieldVal('hours_weekends_en'),
        hours_weekends_ar: fieldVal('hours_weekends_ar'),
        hero_image_url:   heroUrl,
        logo_url:         logoUrl,
        location_visual_mode: locVisualMode,
        location_image_url:   locationUrl,
        location_image_fit:        locFit,
        location_image_position_x: locPosX,
        location_image_position_y: locPosY,
        location_image_zoom:       locZoom,
        location_image_height:     locHeight,
        highlights:       highlights,
        sounds_enabled:   (editedFields.has('sounds_enabled') || !restaurant)
          ? (soundsEl ? soundsEl.checked : true)
          : (restaurant.sounds_enabled !== false),
      };

      // UPDATE only — never insert. The guard above guarantees a valid row.id.
      // (A future "Create New Business" flow, not this page, would insert.)
      const result = await db.from('restaurants').update(payload).eq('id', restaurant.id);

      if (result.error) throw new Error(result.error.message);
      persisted = true;

      // Persistence landed — the row now owns heroUrl/logoUrl. Best-effort
      // cleanup of genuinely-orphaned old objects. A same-key upsert
      // (uploaded URL === old URL) is skipped: that object is the one in use.
      if (uploadedHeroUrl && oldHeroUrl && oldHeroUrl !== uploadedHeroUrl) {
        await deleteFromStorage(oldHeroUrl);      // hero extension changed
      } else if (removeHero && oldHeroUrl) {
        await deleteFromStorage(oldHeroUrl);      // hero explicitly removed
      }

      if (uploadedLogoUrl && oldLogoUrl && oldLogoUrl !== uploadedLogoUrl) {
        await deleteFromStorage(oldLogoUrl);      // logo extension changed
      } else if (removeLogo && oldLogoUrl) {
        await deleteFromStorage(oldLogoUrl);      // logo explicitly removed
      }

      if (uploadedLocationUrl && oldLocationUrl && oldLocationUrl !== uploadedLocationUrl) {
        await deleteFromStorage(oldLocationUrl);  // superseded location object (replacement used a fresh key)
      } else if (removeLocation && oldLocationUrl) {
        await deleteFromStorage(oldLocationUrl);  // location image explicitly removed
      }

      // Reset transient branding state so a later save this session is a no-op.
      if (restaurant) {
        restaurant.hero_image_url     = heroUrl;
        restaurant.logo_url           = logoUrl;
        restaurant.location_image_url = locationUrl;
        restaurant.location_visual_mode = locVisualMode;
        restaurant.location_image_fit        = locFit;
        restaurant.location_image_position_x = locPosX;
        restaurant.location_image_position_y = locPosY;
        restaurant.location_image_zoom       = locZoom;
        restaurant.location_image_height     = locHeight;
      }
      heroFile = null; logoFile = null; locationFile = null;
      removeHero = false; removeLogo = false; removeLocation = false;
      const heroInput = document.getElementById('hero-file'); if (heroInput) heroInput.value = '';
      const logoInput = document.getElementById('logo-file'); if (logoInput) logoInput.value = '';
      const locInput  = document.getElementById('location-file'); if (locInput) locInput.value = '';
      updateBrandingRemoveBtns();

      // Statistics: the just-saved state becomes the clean baseline; undo resets.
      if (restaurant) restaurant.highlights = highlights;
      savedBaseline = JSON.stringify(highlights);
      statsHistory = [];
      editSnapshot = null;
      updateUndoBtn();
      recomputeDirty();

      showToast('Settings saved successfully.', 'success');
    } catch (err) {
      // Roll back a newly-uploaded object ONLY when the DB write did not land AND
      // the upload created a genuinely new Storage key. hero/logo still use a
      // FIXED key + upsert, so a same-extension replace has no separate object to
      // roll back (see report §H — production-hardening follow-up). The LOCATION
      // replacement always uses a fresh unique key, so its rollback is
      // unconditional and the previously-published image is never disturbed.
      if (!persisted) {
        if (uploadedHeroUrl && uploadedHeroUrl !== oldHeroUrl) {
          await deleteFromStorage(uploadedHeroUrl);
        }
        if (uploadedLogoUrl && uploadedLogoUrl !== oldLogoUrl) {
          await deleteFromStorage(uploadedLogoUrl);
        }
        if (uploadedLocationUrl && uploadedLocationUrl !== oldLocationUrl) {
          await deleteFromStorage(uploadedLocationUrl);
        }
      }
      console.error(err);
      showToast('Save failed: ' + err.message, 'error');
      // Save failed → stay dirty (recomputeDirty reflects the unchanged baseline).
      recomputeDirty();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save Changes';
    }
  }

  function val(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }

  // Numeric coerce + clamp with a default for missing / non-finite input.
  function numOr(v, min, max, dflt) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    if (!isFinite(n)) return dflt;
    return n < min ? min : (n > max ? max : n);
  }

  // Collision-safe suffix for a NEW Storage object key. Used so an image
  // REPLACEMENT never overwrites the currently-published object before the DB
  // write lands — a failed Save then leaves the live image byte-for-byte intact.
  // Not a secret; not the user's filename.
  function uniqueToken() {
    try {
      if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    } catch (e) {}
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  // Statistic-specific text normalisation: trim surrounding whitespace ONLY.
  // The public renderer and the Live Preview use textContent, so legitimate
  // characters ( < > & # / + % ★ ) must round-trip. Used for both the saved
  // JSON and the dirty-state comparison so they stay consistent.
  function normText(s) {
    return String(s == null ? '' : s).trim();
  }

  // First number found in a string ("★4.8" → 4.8, "12+" → 12); NaN if none.
  function firstNumber(s) {
    const m = String(s == null ? '' : s).match(/-?\d+(?:\.\d+)?/);
    return m ? parseFloat(m[0]) : NaN;
  }
  // Clamp to [min,max] and round to `decimals`; null when not a finite number.
  function clampRound(n, min, max, decimals) {
    if (!Number.isFinite(n)) return null;
    n = Math.min(max, Math.max(min, n));
    const p = Math.pow(10, decimals);
    return Math.round(n * p) / p;
  }

  // ── Statistics: state helpers ─────────────────────────────────
  function nextId() { return 's' + (++_idSeq); }

  function deepCopyState(st) {
    return (st || []).map(s => ({
      _id: s._id, type: s.type, value: s.value,
      label: s.label, labelAr: s.labelAr, visible: s.visible !== false,
    }));
  }

  function statById(id) {
    return statisticsState.find(s => s._id === id) || null;
  }

  // Infer a display type from a legacy value string.
  function inferType(value) {
    const v = String(value == null ? '' : value).trim();
    if (!v) return 'custom';
    if (/[★⭐]/.test(v))          return 'rating';
    if (/%\s*$/.test(v))          return 'percent';
    if (/\+\s*$/.test(v))         return 'plus';
    if (/^-?\d+(?:\.\d+)?$/.test(v)) return 'number';
    return 'custom';
  }

  // Turn a raw control value into the stored/displayed string for a type.
  // Custom is passed through untouched (no trim here — trimming happens at
  // normalise/save time, so typing isn't fought).
  function formatByType(type, raw) {
    const n = firstNumber(raw);
    switch (type) {
      case 'percent': return (Number.isFinite(n) ? clampRound(n, 0, 100, 0) : 0) + '%';
      case 'plus':    return (Number.isFinite(n) ? clampRound(n, 0, 999999, 0) : 0) + '+';
      case 'rating':  return '★' + (Number.isFinite(n) ? clampRound(n, 0, 5, 1) : 0);
      case 'number':  return Number.isFinite(n) ? String(clampRound(n, -999999, 999999, 2)) : '';
      case 'custom':
      default:        return String(raw == null ? '' : raw);
    }
  }

  // Switch a statistic's type, keeping the numeric part where possible.
  function switchType(stat, newType) {
    if (!VALID_TYPES.has(newType)) return;
    if (newType === 'custom') {
      stat.value = normText(stat.value);          // keep the current text (trimmed)
    } else {
      const n = firstNumber(stat.value);
      stat.value = formatByType(newType, Number.isFinite(n) ? n : 0);
    }
    stat.type = newType;
  }

  // DB array → editor state (legacy-tolerant, never throws, never writes).
  // ALL valid existing entries load — nothing is silently discarded. The
  // 6-statistic cap applies only to ADDING new ones.
  function fromDb(list) {
    if (!Array.isArray(list)) return [];
    return list.map(h => {
      const o = (h && typeof h === 'object') ? h : {};
      const value = o.value != null ? String(o.value) : '';
      const type  = (typeof o.type === 'string' && VALID_TYPES.has(o.type)) ? o.type : inferType(value);
      return {
        _id: nextId(),
        type: type,
        value: value,
        label:   o.label   != null ? String(o.label)   : '',
        labelAr: o.labelAr != null ? String(o.labelAr) : '',
        visible: o.visible !== false,
      };
    });
  }

  // Editor state → persisted / comparable shape (no _id, trim-only).
  function normStats(state) {
    return (Array.isArray(state) ? state : []).map(s => ({
      type:    VALID_TYPES.has(s && s.type) ? s.type : 'custom',
      value:   normText(s && s.value),
      label:   normText(s && s.label),
      labelAr: normText(s && s.labelAr),
      visible: !(s && s.visible === false),
    }));
  }

  function sameStats(a, b) {
    return JSON.stringify(normStats(a)) === JSON.stringify(normStats(b));
  }

  function summaryText(stat) {
    return TYPE_LABELS[stat.type] + ' · ' + (normText(stat.value) || '—') +
      (stat.visible === false ? ' · hidden' : '');
  }

  // ── Statistics: dirty / undo ─────────────────────────────────
  function isDirty() {
    return JSON.stringify(normStats(statisticsState)) !== savedBaseline;
  }
  function recomputeDirty() {
    const dirty = isDirty();
    document.querySelectorAll('.stats-dirty').forEach(el => {
      el.textContent = dirty ? '● Unsaved changes' : '✓ All changes saved';
      el.classList.toggle('is-dirty', dirty);
      el.classList.toggle('is-clean', !dirty);
    });
  }
  function pushHistory() {
    statsHistory.push(deepCopyState(statisticsState));
    if (statsHistory.length > HISTORY_MAX) statsHistory.shift();
  }
  function updateUndoBtn() {
    const b = document.getElementById('stats-undo');
    if (b) b.disabled = statsHistory.length === 0;
  }
  function undo() {
    if (!statsHistory.length) return;
    statisticsState = statsHistory.pop();   // snapshots are deep copies
    editSnapshot = null;
    renderStatsEditor();
    renderLivePreview();
    recomputeDirty();
    updateUndoBtn();
  }

  // ── Statistics: mutations ────────────────────────────────────
  function addStat() {
    if (statisticsState.length >= MAX_STATS) return;
    pushHistory();
    const stat = { _id: nextId(), type: 'custom', value: '', label: '', labelAr: '', visible: true };
    statisticsState.push(stat);
    renderStatsEditor(); renderLivePreview(); recomputeDirty(); updateUndoBtn();
    focusInCard(stat._id, 'input[data-role="value"]');
  }

  function resetStats() {
    pushHistory();
    statisticsState = STAT_DEFAULTS.map(d => ({
      _id: nextId(), type: d.type, value: d.value,
      label: d.label, labelAr: d.labelAr, visible: true,
    }));
    renderStatsEditor(); renderLivePreview(); recomputeDirty(); updateUndoBtn();
  }

  function onStatClick(e) {
    const btn = e.target.closest('button[data-role]');
    if (!btn) return;
    const card = btn.closest('.stat-card-ed');
    const stat = statById(card && card.dataset.statId);
    if (!stat) return;
    const role = btn.dataset.role;
    const idx  = statisticsState.indexOf(stat);

    if (role === 'up' && idx > 0) {
      pushHistory();
      const t = statisticsState[idx - 1];
      statisticsState[idx - 1] = statisticsState[idx];
      statisticsState[idx] = t;
      afterStructural(stat._id, 'up');
    } else if (role === 'down' && idx < statisticsState.length - 1) {
      pushHistory();
      const t = statisticsState[idx + 1];
      statisticsState[idx + 1] = statisticsState[idx];
      statisticsState[idx] = t;
      afterStructural(stat._id, 'down');
    } else if (role === 'remove') {
      pushHistory();
      statisticsState = statisticsState.filter(s => s !== stat);
      afterStructural(null, 'remove');
    }
  }

  function afterStructural(focusId, kind) {
    renderStatsEditor(); renderLivePreview(); recomputeDirty(); updateUndoBtn();
    if (focusId) {
      focusInCard(focusId, 'button[data-role="' + (kind === 'down' ? 'down' : 'up') + '"]:not([disabled])',
        'button[data-role]:not([disabled])');
    } else {
      const a = document.getElementById('stats-add');
      if (a && !a.disabled) softFocus(a);
    }
  }

  function onStatInput(e) {
    const card = e.target.closest('.stat-card-ed');
    if (!card) return;
    const stat = statById(card.dataset.statId);
    if (!stat) return;
    const role = e.target.dataset.role;
    if (role === 'value') {
      const numeric = e.target.type === 'number' || e.target.type === 'range';
      if (numeric && e.target.value.trim() === '') {
        // Field transiently empty while editing — keep the last good value,
        // don't flash "0" into the preview. Blur (onStatChange) finalises it.
      } else {
        stat.value = formatByType(stat.type, e.target.value);
      }
      const out = card.querySelector('[data-role="value-out"]');
      if (out) out.textContent = normText(stat.value);
    } else if (role === 'label-en') {
      stat.label = e.target.value;
    } else if (role === 'label-ar') {
      stat.labelAr = e.target.value;
    } else {
      return;
    }
    const sum = card.querySelector('[data-role="summary"]');
    if (sum) sum.textContent = summaryText(stat);
    renderLivePreview();
    recomputeDirty();
  }

  function onStatChange(e) {
    const card = e.target.closest('.stat-card-ed');
    if (!card) return;
    const stat = statById(card.dataset.statId);
    if (!stat) return;
    const role = e.target.dataset.role;

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
      const sum = card.querySelector('[data-role="summary"]');
      if (sum) sum.textContent = summaryText(stat);
      renderLivePreview(); recomputeDirty(); updateUndoBtn();
    } else if (role === 'value' && (e.target.type === 'number' || e.target.type === 'range')) {
      // Final clamp / round / normalisation on blur or slider release —
      // including the case where the field was left empty.
      stat.value = formatByType(stat.type, e.target.value);
      if (e.target.type === 'number') {
        const n = firstNumber(stat.value);
        e.target.value = Number.isFinite(n) ? n : 0;
      }
      const out = card.querySelector('[data-role="value-out"]');
      if (out) out.textContent = normText(stat.value);
      const sum = card.querySelector('[data-role="summary"]');
      if (sum) sum.textContent = summaryText(stat);
      renderLivePreview();
      recomputeDirty();
    }
  }

  // One undo snapshot per field-editing session (focus in → change/blur out).
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
  function isEditField(el) {
    return el && el.matches &&
      el.matches('input[data-role="value"], input[data-role="label-en"], input[data-role="label-ar"]');
  }

  // ── Statistics: editor DOM ───────────────────────────────────
  function renderStatsEditor() {
    const wrap = document.getElementById('stats-cards');
    if (!wrap) return;
    const frag = document.createDocumentFragment();
    const total = statisticsState.length;
    if (!total) {
      const p = document.createElement('p');
      p.className = 'field-hint';
      p.textContent = 'No statistics yet. Use “+ Add statistic”, or “Reset to default”.';
      frag.appendChild(p);
    }
    statisticsState.forEach((stat, idx) => frag.appendChild(buildStatCard(stat, idx, total)));
    wrap.replaceChildren(frag);

    const a = document.getElementById('stats-add');
    const h = document.getElementById('stats-max-hint');
    if (a) a.disabled = total >= MAX_STATS;
    if (h) {
      h.hidden = total < MAX_STATS;
      h.textContent = total > MAX_STATS
        ? 'You have ' + total + ' statistics. The maximum is ' + MAX_STATS +
          ' — remove some before adding more. Nothing is deleted until you Save.'
        : 'Maximum of ' + MAX_STATS + ' statistics.';
    }
  }

  function replaceCard(stat) {
    const old = document.querySelector('.stat-card-ed[data-stat-id="' + stat._id + '"]');
    if (!old) { renderStatsEditor(); return; }
    old.replaceWith(buildStatCard(stat, statisticsState.indexOf(stat), statisticsState.length));
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function buildStatCard(stat, idx, total) {
    const card = el('div', 'stat-card-ed' + (stat.visible === false ? ' is-hidden' : ''));
    card.dataset.statId = stat._id;

    const head = el('div', 'stat-card-ed__head');
    head.appendChild(el('span', 'stat-card-ed__title', 'Statistic ' + (idx + 1)));
    const sum = el('span', 'stat-card-ed__summary', summaryText(stat));
    sum.dataset.role = 'summary';
    head.appendChild(sum);
    card.appendChild(head);

    // Show on website
    const tRow = el('div', 'toggle-row');
    const tInfo = el('div', 'toggle-info');
    tInfo.appendChild(el('strong', null, 'Show on website'));
    tInfo.appendChild(el('span', null, 'Uncheck to hide this from your homepage.'));
    const tLabel = el('label', 'toggle');
    const tCb = document.createElement('input');
    tCb.type = 'checkbox';
    tCb.dataset.role = 'visible';
    tCb.checked = stat.visible !== false;
    tCb.setAttribute('aria-label', 'Show statistic ' + (idx + 1) + ' on website');
    tLabel.appendChild(tCb);
    tLabel.appendChild(el('span', 'toggle-track'));
    tRow.appendChild(tInfo);
    tRow.appendChild(tLabel);
    card.appendChild(tRow);

    // Display style
    const styleGroup = el('div', 'form-group stat-card-ed__row');
    const styleLbl = el('label', null, 'Display style');
    styleLbl.htmlFor = 'st-' + stat._id;
    const styleSel = document.createElement('select');
    styleSel.id = 'st-' + stat._id;
    styleSel.dataset.role = 'type';
    Object.keys(TYPE_LABELS).forEach(k => {
      const o = document.createElement('option');
      o.value = k; o.textContent = TYPE_LABELS[k];
      styleSel.appendChild(o);
    });
    styleSel.value = stat.type;
    styleGroup.appendChild(styleLbl);
    styleGroup.appendChild(styleSel);
    card.appendChild(styleGroup);

    // Value control (type-specific)
    card.appendChild(buildValueRow(stat));

    // Labels
    const lRow = el('div', 'stat-card-ed__row two');
    lRow.appendChild(buildTextField('sle-' + stat._id, 'Label (English)', 'label-en', stat.label, false));
    lRow.appendChild(buildTextField('sla-' + stat._id, 'Label (Arabic)',  'label-ar', stat.labelAr, true));
    card.appendChild(lRow);

    // Footer: reorder + remove
    const foot = el('div', 'stat-card-ed__foot');
    const up = el('button', 'btn btn-ghost btn-sm', '↑ Move up');
    up.type = 'button'; up.dataset.role = 'up'; up.disabled = idx === 0;
    up.setAttribute('aria-label', 'Move statistic ' + (idx + 1) + ' up');
    const down = el('button', 'btn btn-ghost btn-sm', '↓ Move down');
    down.type = 'button'; down.dataset.role = 'down'; down.disabled = idx === total - 1;
    down.setAttribute('aria-label', 'Move statistic ' + (idx + 1) + ' down');
    const spacer = el('span', 'spacer');
    const rm = el('button', 'btn btn-danger btn-sm', 'Remove');
    rm.type = 'button'; rm.dataset.role = 'remove';
    rm.setAttribute('aria-label', 'Remove statistic ' + (idx + 1));
    foot.appendChild(up); foot.appendChild(down); foot.appendChild(spacer); foot.appendChild(rm);
    card.appendChild(foot);

    return card;
  }

  function buildTextField(id, labelText, role, value, rtl) {
    const g = el('div', 'form-group');
    const l = el('label', null, labelText);
    l.htmlFor = id;
    const i = document.createElement('input');
    i.type = 'text'; i.id = id; i.dataset.role = role;
    i.value = value == null ? '' : String(value);
    if (rtl) i.dir = 'rtl';
    g.appendChild(l); g.appendChild(i);
    return g;
  }

  function buildValueRow(stat) {
    const g = el('div', 'form-group stat-card-ed__row');
    const id = 'sv-' + stat._id;
    const n = firstNumber(stat.value);
    const num = Number.isFinite(n) ? n : '';

    let labelText = 'Value';
    let control;

    if (stat.type === 'percent') {
      labelText = 'Percentage';
      const wrap = el('div', 'flex-center gap-1');
      const range = document.createElement('input');
      range.type = 'range'; range.id = id; range.dataset.role = 'value';
      range.min = '0'; range.max = '100'; range.step = '1';
      range.value = String(Number.isFinite(n) ? clampRound(n, 0, 100, 0) : 0);
      range.style.flex = '1';
      const out = el('span', 'stat-value-out', normText(stat.value) || '0%');
      out.dataset.role = 'value-out';
      wrap.appendChild(range); wrap.appendChild(out);
      control = wrap;
    } else if (stat.type === 'plus') {
      labelText = 'Number';
      const wrap = el('div', 'flex-center gap-1');
      const inp = document.createElement('input');
      inp.type = 'number'; inp.id = id; inp.dataset.role = 'value';
      inp.min = '0'; inp.step = '1'; inp.value = num === '' ? '' : String(num);
      inp.style.flex = '1';
      wrap.appendChild(inp);
      wrap.appendChild(el('span', 'text-muted', '+'));
      control = wrap;
    } else if (stat.type === 'rating') {
      labelText = 'Rating (out of 5)';
      const wrap = el('div', 'flex-center gap-1');
      const inp = document.createElement('input');
      inp.type = 'number'; inp.id = id; inp.dataset.role = 'value';
      inp.min = '0'; inp.max = '5'; inp.step = '0.1'; inp.value = num === '' ? '' : String(num);
      inp.style.flex = '1';
      wrap.appendChild(inp);
      wrap.appendChild(el('span', 'text-muted', '/ 5'));
      control = wrap;
    } else if (stat.type === 'number') {
      labelText = 'Number';
      const inp = document.createElement('input');
      inp.type = 'number'; inp.id = id; inp.dataset.role = 'value';
      inp.value = num === '' ? '' : String(num);
      control = inp;
    } else { // custom
      labelText = 'Text';
      const inp = document.createElement('input');
      inp.type = 'text'; inp.id = id; inp.dataset.role = 'value';
      inp.placeholder = 'e.g. 24/7, Since 1998, Free';
      inp.value = stat.value == null ? '' : String(stat.value);
      control = inp;
    }

    const l = el('label', null, labelText);
    l.htmlFor = id;
    g.appendChild(l);
    g.appendChild(control);
    return g;
  }

  // ── Focus helpers (never scroll-jump the page) ───────────────
  function softFocus(node) {
    if (!node) return;
    try { node.focus({ preventScroll: true }); } catch (e) { node.focus(); }
  }
  function focusInCard(id, selector, fallbackSelector) {
    const card = document.querySelector('.stat-card-ed[data-stat-id="' + id + '"]');
    if (!card) return;
    softFocus(card.querySelector(selector) || (fallbackSelector && card.querySelector(fallbackSelector)));
  }

  // ── Click preview card → matching editor card ────────────────
  function focusStatCard(id) {
    if (isNarrowAdmin()) setAdminMode('edit');
    requestAnimationFrame(() => {
      const card = document.querySelector('.stat-card-ed[data-stat-id="' + id + '"]');
      if (!card) return;
      card.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
      card.classList.remove('is-flash');
      void card.offsetWidth;                 // restart the flash animation
      card.classList.add('is-flash');
      setTimeout(() => card.classList.remove('is-flash'), 1300);
      softFocus(card.querySelector('select[data-role="type"], input[data-role="value"], button[data-role]'));
    });
  }

  function isNarrowAdmin() {
    return !!(window.matchMedia && window.matchMedia('(max-width: 1179px)').matches);
  }
  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function setAdminMode(mode) {
    adminMode = (mode === 'preview') ? 'preview' : 'edit';
    const layout = document.querySelector('.settings-layout');
    if (layout) layout.dataset.adminMode = adminMode;
    syncSeg('data-admin-mode', adminMode);
    if (adminMode === 'preview') {
      renderLivePreview();
      requestAnimationFrame(() => preview.applyScale());   // stage now has real size
    }
  }

  function viewStatsInPreview() {
    if (isNarrowAdmin()) setAdminMode('preview');
    preview.showPage('home', { scrollTo: 'highlights' });   // navigate if needed, then scroll
  }

  // Segmented-control sync for Settings' OWN toggles (data-loc-visual /
  // data-loc-fit / data-loc-height / data-admin-mode). The preview engine
  // syncs its own Page / Device / Language / Theme / View controls.
  function syncSeg(attr, value) {
    document.querySelectorAll('.lp-seg__btn[' + attr + ']').forEach(btn => {
      const on = btn.getAttribute(attr) === value;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  // Refresh the Live Preview after a Settings change: re-assert the engine's
  // control state + geometry, then push the current UNSAVED draft. Never
  // touches the DB. No component markup is duplicated.
  function renderLivePreview() {
    preview.refresh();
    postPreviewData();
  }

  // Reuse the pending-file object URL across sends; revoke when the File
  // changes or on unload — no leaked blob: URLs.
  function brandingPreviewUrl(kind, file, removed, savedUrl) {
    const s = _brandObj[kind];
    if (file !== s.file) {
      if (s.url) { try { URL.revokeObjectURL(s.url); } catch (e) {} }
      s.file = file || null;
      s.url  = file ? URL.createObjectURL(file) : null;
    }
    if (s.url) return s.url;
    if (removed) return '';
    return savedUrl || '';
  }
  function releasePreviewObjectUrls() {
    ['hero', 'logo', 'location'].forEach(k => {
      if (_brandObj[k].url) { try { URL.revokeObjectURL(_brandObj[k].url); } catch (e) {} _brandObj[k].url = null; }
    });
  }

  // A draft "restaurants row" (snake_case) assembled from scratch out of the
  // current UNSAVED form values + statisticsState + branding selection. Only
  // the public-facing fields the homepage renders — the loaded row is NOT
  // spread in, so owner_id / id / timestamps / tokens never reach the iframe.
  // The controller wraps this with the authoritative preview lang + theme.
  function buildRestaurantDraft() {
    const soundsEl = document.getElementById('sounds_enabled');
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
      hero_image_url: brandingPreviewUrl('hero', heroFile, removeHero, restaurant && restaurant.hero_image_url),
      logo_url:       brandingPreviewUrl('logo', logoFile, removeLogo, restaurant && restaurant.logo_url),
      location_visual_mode: locVisualMode,
      location_image_url:   brandingPreviewUrl('location', locationFile, removeLocation, restaurant && restaurant.location_image_url),
      location_image_fit:        locFit,
      location_image_position_x: locPosX,
      location_image_position_y: locPosY,
      location_image_zoom:       locZoom,
      location_image_height:     locHeight,
      highlights: statisticsState.map(s => ({
        _previewId: s._id,                                 // local editing id — never persisted
        type:    VALID_TYPES.has(s.type) ? s.type : 'custom',
        value:   normText(s.value),
        label:   normText(s.label),
        labelAr: normText(s.labelAr),
        visible: s.visible !== false,
      })),
    };
  }

  // Push the current Settings draft to the Live Preview. No-op until Settings
  // is fully wired, the restaurant row is loaded (fail-closed), or while the
  // owner is dragging the Location image (the child owns the visual then). The
  // controller handles rAF-coalescing and choosing the target frame.
  function postPreviewData() {
    if (!settingsReady) return;
    if (restaurantLoadState !== 'ready') return;   // never push a non-loaded / blank draft (§9)
    if (locEditActive) return;                     // child owns the live image during a drag (§14)
    preview.setDraft(buildRestaurantDraft());
  }

  // Load statistics from the restaurant row. Never writes to Supabase.
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
    const fields = [
      'name_ar','name_en','tagline_ar','tagline_en',
      'description_ar','description_en',
      'phone','whatsapp','instagram','email',
      'wa_message_ar','wa_message_en',
      'address_ar','address_en','map_directions','map_embed',
      'hours_weekdays_en','hours_weekdays_ar',
      'hours_weekends_en','hours_weekends_ar',
    ];
    fields.forEach(f => {
      const elx = document.getElementById(f);
      if (elx && r[f] !== undefined && r[f] !== null) elx.value = r[f];
    });
    const soundsEl = document.getElementById('sounds_enabled');
    if (soundsEl) soundsEl.checked = r.sounds_enabled !== false;
    initStats(r);
  }
})();
