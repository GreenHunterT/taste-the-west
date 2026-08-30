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

  // Live Preview state — admin-only. NEVER persisted, NEVER in undo history,
  // NEVER part of the dirty comparison. The preview is a same-origin <iframe>
  // of a REAL public page (../<page>.html?adminPreview=1).
  let previewPage   = 'home';    // 'home' | 'menu' | 'location' | 'contact'
  let previewDevice = 'desktop'; // 'desktop' | 'mobile'
  let previewLang   = 'en';      // 'en' | 'ar'  — authoritative; only the language control / a validated child message change it
  let previewTheme  = 'dark';    // 'dark' | 'light' — authoritative, same rule
  let previewZoom   = 'fit';     // 'fit' | '100'
  let adminMode     = 'edit';    // narrow-screen Edit | Preview toggle
  let previewPendingScroll = null;  // e.g. 'highlights' — fired once the next page is ready
  // Whitelisted preview targets. The iframe src is only ever built from this
  // map after validating the key — never from a raw postMessage string.
  const PREVIEW_PAGES = {
    home:     '../index.html',
    menu:     '../products.html',
    location: '../location.html',
    contact:  '../contact.html',
  };
  // Simulated CSS viewport width. Desktop = 1024: the smallest width at which
  // the public stylesheet's real desktop layout is fully active (its breakpoints
  // are 768px and 1024px), so downscaling into the preview panel is far gentler
  // and text/images stay legible.
  const PREVIEW_VP_W = { desktop: 1024, mobile: 390 };
  const lpStage = document.getElementById('lp-stage');

  // ── Double-buffered preview frames ───────────────────────────────
  // Two <iframe> slots. Only ACTIVE is shown/interactive. A page switch loads
  // the next page in the OTHER (incoming) slot, invisibly, runs the full
  // handshake, then crossfades — the current page never blanks.
  const previewFrames = Array.prototype.slice.call(document.querySelectorAll('.preview-frame'));
  let activeFrame       = null;                       // frame currently shown (null until first promotion)
  let incomingFrame     = previewFrames[0] || null;   // frame loading a page during a switch / first load
  // Monotonic navigation generation. Baked into each preview URL as
  // `?previewNav=N`; the child reads it from its OWN url at boot and stamps
  // every message with it, so a stale document (whose slot was re-navigated)
  // can never be mistaken for the current pending navigation — the iframe
  // contentWindow identity alone is NOT sufficient (it survives same-origin
  // src changes). Not a timestamp: a plain incrementing integer.
  let previewNavId      = 1;
  let pendingNav        = previewFrames[0]
    ? { id: previewNavId, page: 'home', frame: previewFrames[0] }   // first load = navigation #1
    : null;
  let activeNavId       = 0;
  let activePreviewPage = 'home';   // the page ACTUALLY rendered/visible (can briefly lag previewPage)
  let previewReady      = false;    // the pending frame has posted a matching PREVIEW_READY
  let activeReady       = false;    // the active frame has rendered a draft at least once
  let previewInitDone   = false;    // the parent's Settings state is ready to send
  let previewSendQueued = false;
  const _brandObj = { hero: { file: null, url: null }, logo: { file: null, url: null } };

  if (lpStage) lpStage.dataset.theme = previewTheme;   // themed first-load surface (behind the frames)

  // Per-frame load-failure watchers (added once, never removed — not global).
  previewFrames.forEach(f => {
    f.addEventListener('error', () => {
      if (pendingNav && pendingNav.frame === f) handleNavFailure();
    });
  });

  // Register the handshake listener synchronously — a frame may post
  // PREVIEW_READY during the awaits below, before the rest of the wiring runs.
  window.addEventListener('message', onPreviewMessage);

  // Kick off the first-load navigation through the SAME generation mechanism as
  // every page switch (no special / unstamped first-load path).
  if (previewFrames[0]) previewFrames[0].src = previewSrc('home', previewNavId);

  showLoading();
  const session = await requireAuth();
  if (!session) return;

  const restaurant = await getMyRestaurant(session.user.id);
  initAdminShell(restaurant ? restaurant.name_en || restaurant.name_ar : 'My Restaurant');
  hideLoading();

  // Populate form with existing data
  if (restaurant) populateForm(restaurant);
  else { renderStatsEditor(); renderLivePreview(); recomputeDirty(); updateUndoBtn(); }

  // Image file pickers + explicit-remove state (hero and logo are independent)
  let heroFile = null;
  let logoFile = null;
  let removeHero = false;
  let removeLogo = false;

  // Picking a new file always supersedes a pending "remove".
  initImageInput('hero-file', 'hero-preview', f => { heroFile = f; removeHero = false; updateBrandingRemoveBtns(); postPreviewData(); });
  initImageInput('logo-file', 'logo-preview', f => { logoFile = f; removeLogo = false; updateBrandingRemoveBtns(); postPreviewData(); });

  // Show existing images if saved
  if (restaurant && restaurant.hero_image_url) {
    const prev = document.getElementById('hero-preview');
    if (prev) { prev.src = restaurant.hero_image_url; prev.hidden = false; }
  }
  if (restaurant && restaurant.logo_url) {
    const prev = document.getElementById('logo-preview');
    if (prev) { prev.src = restaurant.logo_url; prev.hidden = false; }
  }

  // ── Remove image buttons ─────────────────────────────────────────
  wireRemoveBtn('hero-remove', 'hero-file', 'hero-preview', () => { heroFile = null; removeHero = true; });
  wireRemoveBtn('logo-remove', 'logo-file', 'logo-preview', () => { logoFile = null; removeLogo = true; });
  updateBrandingRemoveBtns();

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

  // Preview page / device / language / theme / zoom — ALL preview-only:
  // never persisted, never dirty, never in Statistics Undo. Only lang + theme
  // travel to the iframe (as preview metadata); page is the iframe src; device
  // and zoom are pure parent-side sizing.
  document.querySelectorAll('.lp-seg__btn[data-page]').forEach(btn => {
    btn.addEventListener('click', () => setPreviewPage(btn.dataset.page));
  });
  document.querySelectorAll('.lp-seg__btn[data-device]').forEach(btn => {
    btn.addEventListener('click', () => { previewDevice = btn.dataset.device; renderLivePreview(); });
  });
  document.querySelectorAll('.lp-seg__btn[data-lang]').forEach(btn => {
    btn.addEventListener('click', () => { previewLang = btn.dataset.lang; renderLivePreview(); });
  });
  document.querySelectorAll('.lp-seg__btn[data-theme]').forEach(btn => {
    btn.addEventListener('click', () => { previewTheme = btn.dataset.theme; renderLivePreview(); });
  });
  document.querySelectorAll('.lp-seg__btn[data-zoom]').forEach(btn => {
    btn.addEventListener('click', () => { previewZoom = btn.dataset.zoom; renderLivePreview(); });
  });
  // Narrow-screen Edit | Preview mode.
  document.querySelectorAll('.lp-seg__btn[data-admin-mode]').forEach(btn => {
    btn.addEventListener('click', () => setAdminMode(btn.dataset.adminMode));
  });
  setAdminMode('edit');

  // Live Preview iframe plumbing (message listener already registered above).
  window.addEventListener('resize', () => requestAnimationFrame(applyPreviewScale));
  window.addEventListener('beforeunload', releasePreviewObjectUrls);
  const lpExpandBtn = document.getElementById('lp-expand');
  if (lpExpandBtn) lpExpandBtn.addEventListener('click', toggleExpand);
  const lpViewBtn = document.getElementById('stats-view-in-preview');
  if (lpViewBtn) lpViewBtn.addEventListener('click', viewStatsInPreview);

  // Any ordinary Settings field edit refreshes the live preview (rAF-coalesced
  // inside postPreviewData). Statistics edits also call renderLivePreview().
  const settingsForm = document.getElementById('settings-form');
  if (settingsForm) {
    settingsForm.addEventListener('input',  postPreviewData);
    settingsForm.addEventListener('change', postPreviewData);
  }

  // Settings state is now fully loaded/wired — safe to push draft data.
  previewInitDone = true;
  if (previewReady && pendingNav) sendPreviewNow(pendingNav.frame, pendingNav.id);
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
    const btn = document.getElementById('save-btn-bottom');
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-spinner"></span> Saving…';

    // Branding image lifecycle — hero and logo tracked independently.
    const oldHeroUrl = restaurant ? (restaurant.hero_image_url || '') : '';
    const oldLogoUrl = restaurant ? (restaurant.logo_url       || '') : '';
    let uploadedHeroUrl = null;   // set only if THIS save uploaded a new hero object
    let uploadedLogoUrl = null;
    let persisted = false;        // true only once the restaurants row write succeeds

    try {
      // Validate the required name BEFORE any upload, so a missing name can
      // never leave an orphaned branding object behind.
      if (!val('name_ar') || !val('name_en')) {
        showToast('Restaurant name (Arabic and English) is required.', 'error');
        btn.disabled = false; btn.textContent = 'Save Changes';
        return;
      }

      // Resolve the hero/logo URLs to persist.
      let heroUrl = oldHeroUrl;
      let logoUrl = oldLogoUrl;

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

      // Homepage statistics: persist the builder state as
      // [{ type, value, label, labelAr, visible }] — local ids are dropped.
      const highlights = normStats(statisticsState);

      const payload = {
        name_ar:          val('name_ar'),
        name_en:          val('name_en'),
        tagline_ar:       val('tagline_ar'),
        tagline_en:       val('tagline_en'),
        description_ar:   val('description_ar'),
        description_en:   val('description_en'),
        phone:            val('phone'),
        whatsapp:         val('whatsapp').replace(/\D/g, ''),
        instagram:        val('instagram'),
        email:            val('email'),
        wa_message_ar:    val('wa_message_ar'),
        wa_message_en:    val('wa_message_en'),
        address_ar:       val('address_ar'),
        address_en:       val('address_en'),
        map_directions:   val('map_directions'),
        map_embed:        val('map_embed'),
        hours_weekdays_en: val('hours_weekdays_en'),
        hours_weekdays_ar: val('hours_weekdays_ar'),
        hours_weekends_en: val('hours_weekends_en'),
        hours_weekends_ar: val('hours_weekends_ar'),
        hero_image_url:   heroUrl,
        logo_url:         logoUrl,
        highlights:       highlights,
        sounds_enabled:   document.getElementById('sounds_enabled').checked,
      };

      const result = restaurant
        ? await db.from('restaurants').update(payload).eq('id', restaurant.id)
        : await db.from('restaurants').insert({ ...payload, owner_id: session.user.id });

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

      // Reset transient branding state so a later save this session is a no-op.
      if (restaurant) { restaurant.hero_image_url = heroUrl; restaurant.logo_url = logoUrl; }
      heroFile = null; logoFile = null;
      removeHero = false; removeLogo = false;
      const heroInput = document.getElementById('hero-file'); if (heroInput) heroInput.value = '';
      const logoInput = document.getElementById('logo-file'); if (logoInput) logoInput.value = '';
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
      // Roll back a newly-uploaded branding object ONLY when the DB write did
      // not land AND the upload created a genuinely new Storage key. A same-key
      // upsert replaced the object the unchanged DB row still points at —
      // deleting it would break that row, so leave it.
      if (!persisted) {
        if (uploadedHeroUrl && uploadedHeroUrl !== oldHeroUrl) {
          await deleteFromStorage(uploadedHeroUrl);
        }
        if (uploadedLogoUrl && uploadedLogoUrl !== oldLogoUrl) {
          await deleteFromStorage(uploadedLogoUrl);
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
      requestAnimationFrame(applyPreviewScale);   // stage now has real size
    }
  }

  function toggleExpand() {
    const layout = document.querySelector('.settings-layout');
    if (!layout) return;
    const on = !layout.classList.contains('is-preview-expanded');
    layout.classList.toggle('is-preview-expanded', on);
    if (lpExpandBtn) {
      lpExpandBtn.textContent = on ? 'Back to editor' : 'Expand';
      lpExpandBtn.setAttribute('aria-pressed', String(on));
    }
    requestAnimationFrame(applyPreviewScale);
  }

  // Change the previewed public page (double-buffered). `page` is validated
  // against PREVIEW_PAGES; the iframe src is only ever built from that map.
  // ACTIVE stays visible and interactive; the OTHER slot loads `page` invisibly,
  // runs the full handshake, then crossfades in (completeNavigation). Every
  // preview display setting and all unsaved Settings are untouched.
  // Preview URL for a page + navigation generation. The child reads `previewNav`
  // from this at boot; it is the ONLY source of the document's generation.
  function previewSrc(page, navId) {
    return PREVIEW_PAGES[page] + '?adminPreview=1&previewNav=' + navId;
  }

  function setPreviewPage(page) {
    if (!PREVIEW_PAGES[page] || previewFrames.length < 2) return;
    if (pendingNav && pendingNav.page === page) return;          // already loading it
    if (!pendingNav && page === activePreviewPage) return;       // already showing it
    previewPage = page;                       // requested page — selector reflects it now
    syncSeg('data-page', previewPage);
    const incoming = (activeFrame === previewFrames[0]) ? previewFrames[1] : previewFrames[0];
    previewNavId += 1;
    pendingNav    = { id: previewNavId, page: page, frame: incoming };
    incomingFrame = incoming;
    previewReady  = false;
    incoming.classList.remove('is-active', 'is-leaving');
    incoming.setAttribute('aria-hidden', 'true');
    if (lpStage) lpStage.dataset.theme = previewTheme;
    applyPreviewScale();                      // pre-size so it appears at the right dimensions
    incoming.src = previewSrc(page, previewNavId);
  }

  // Incoming frame is ready (matched PREVIEW_APPLIED): promote it over the
  // current ACTIVE frame with a short crossfade, then recycle the old frame.
  function completeNavigation() {
    if (!pendingNav) return;
    const incoming = pendingNav.frame;
    const outgoing = (activeFrame && activeFrame !== incoming) ? activeFrame : null;

    applyPreviewScale();                      // both frames sized identically — no jump
    activeFrame       = incoming;
    activeNavId       = pendingNav.id;
    activePreviewPage = pendingNav.page;
    activeReady       = true;
    incomingFrame     = null;
    previewReady      = false;
    const doScroll = previewPendingScroll;
    previewPendingScroll = null;
    pendingNav = null;

    incoming.classList.remove('is-leaving');
    incoming.classList.add('is-active');      // opacity 0 → 1 (or instant, reduced motion)
    incoming.removeAttribute('aria-hidden');

    if (doScroll) scrollPreviewTo(doScroll, 'auto');   // frame is active now; position before it settles

    if (!outgoing) return;                    // first load — nothing to fade out

    if (prefersReducedMotion()) {
      parkFrame(outgoing);
      return;
    }
    outgoing.classList.remove('is-active');
    outgoing.classList.add('is-leaving');     // opacity 1 → 0
    const done = () => {
      outgoing.removeEventListener('transitionend', done);
      clearTimeout(safety);
      parkFrame(outgoing);
    };
    const safety = setTimeout(done, 260);     // cleanup only — not the readiness signal
    outgoing.addEventListener('transitionend', done);
  }

  // Take a faded-out frame fully out of play and stop its document so no
  // hidden public page keeps running. It is reused as the next incoming slot.
  // Bails if the frame has since been re-tasked (rapid navigation) so a stale
  // crossfade cleanup can never blank a frame that is now loading a new page.
  function parkFrame(f) {
    if (!f || f === activeFrame || f === incomingFrame) return;
    if (pendingNav && f === pendingNav.frame) return;
    f.classList.remove('is-active', 'is-leaving');
    f.setAttribute('aria-hidden', 'true');
    try { f.src = 'about:blank'; } catch (e) {}
  }

  // Incoming page could not load / initialise. Keep the working ACTIVE page
  // visible; put the page selector back to it; surface a small notice.
  function handleNavFailure() {
    if (!pendingNav) return;
    const dead = pendingNav.frame;
    pendingNav = null;
    incomingFrame = null;
    previewReady = false;
    previewPendingScroll = null;
    parkFrame(dead);
    previewPage = activePreviewPage;
    syncSeg('data-page', previewPage);
    if (typeof showToast === 'function') showToast('Preview page could not be loaded.', 'error');
  }

  function viewStatsInPreview() {
    if (isNarrowAdmin()) setAdminMode('preview');
    if (pendingNav) {
      previewPendingScroll = 'highlights';        // fires in completeNavigation
      if (pendingNav.page !== 'home') setPreviewPage('home');
      return;
    }
    if (activePreviewPage !== 'home') {
      previewPendingScroll = 'highlights';
      setPreviewPage('home');
      return;
    }
    requestAnimationFrame(() => { applyPreviewScale(); scrollPreviewTo('highlights'); });
  }

  function scrollPreviewTo(target, behavior) {
    if (activeFrame && activeFrame.contentWindow) {
      activeFrame.contentWindow.postMessage(
        { type: 'PREVIEW_SCROLL_TO', target: target, behavior: behavior || 'smooth' },
        window.location.origin);
    }
  }

  function syncSeg(attr, value) {
    document.querySelectorAll('.lp-seg__btn[' + attr + ']').forEach(btn => {
      const on = btn.getAttribute(attr) === value;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  // ── The ONE Live Preview render path ─────────────────────────
  // The preview is a same-origin <iframe> of the real public homepage. This
  // function only: sets the simulated device viewport + scale, keeps the
  // segmented controls in sync, and pushes the current UNSAVED Settings draft
  // to the iframe. No component markup is duplicated. Never touches the DB.
  function renderLivePreview() {
    const stage = document.getElementById('lp-stage');
    if (stage) {
      stage.dataset.device = previewDevice;
      stage.dataset.zoom   = previewZoom;
      stage.dataset.theme  = previewTheme;   // themed loading surface (no white flash)
    }
    syncSeg('data-page',   previewPage);
    syncSeg('data-device', previewDevice);
    syncSeg('data-lang',   previewLang);
    syncSeg('data-theme',  previewTheme);
    syncSeg('data-zoom',   previewZoom);
    applyPreviewScale();
    postPreviewData();
  }

  // Geometry model (scale-to-fit without pre-transform clipping):
  //   .preview-frame — the REAL website document. Rendered at the full unscaled
  //     virtual viewport (targetW × tall: 1024 desktop / 390 mobile), then
  //     CSS-scaled from its own top-left. The document keeps believing its
  //     viewport is targetW wide, so the real desktop breakpoint is used.
  //   #lp-viewport  — sized to the SCALED, on-screen rectangle (targetW*scale ×
  //     availH). `overflow: hidden` only trims each frame's invisible
  //     scaled-away layout overflow, so #lp-stage gets no phantom scrollbars.
  //     It carries NO transform — that lives on the frames.
  //   #lp-stage     — the visible Admin preview area; the only scroll boundary
  //     (100% mode can scroll it horizontally; .admin-main is `overflow-x: clip`
  //     so the admin page never scrolls).
  // Both frames get identical width/height/transform → an exact crossfade stack.
  // Reads previewDevice, previewZoom and the live stage size, so it is correct
  // after resize, Expand, mode switch and page navigation.
  function applyPreviewScale() {
    const stage = document.getElementById('lp-stage');
    const vp    = document.getElementById('lp-viewport');
    if (!stage || !vp || !previewFrames.length) return;
    const targetW = PREVIEW_VP_W[previewDevice] || 1024;
    const availW  = Math.max(stage.clientWidth  || targetW, 1);
    const availH  = Math.max(stage.clientHeight || Math.round(availW * 1.4), 240);

    const scale = (previewZoom === '100')
      ? 1
      : Math.max(Math.min(1, availW / targetW), 0.25);

    const fw = targetW + 'px';                        // unscaled virtual width
    const fh = Math.round(availH / scale) + 'px';     // unscaled virtual height (tall)
    const tf = scale === 1 ? 'none' : ('scale(' + scale + ')');
    previewFrames.forEach(f => {
      f.style.width     = fw;
      f.style.height    = fh;
      f.style.transform = tf;                         // scale the document itself
    });
    vp.style.width     = Math.round(targetW * scale) + 'px';   // on-screen rectangle
    vp.style.height    = Math.round(availH) + 'px';
    vp.style.transform = 'none';                      // never transform the viewport box
    stage.dataset.scale = scale.toFixed(3);
    stage.dataset.zoom  = previewZoom;
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
    ['hero', 'logo'].forEach(k => {
      if (_brandObj[k].url) { try { URL.revokeObjectURL(_brandObj[k].url); } catch (e) {} _brandObj[k].url = null; }
    });
  }

  // A draft "restaurants row" (snake_case) assembled from scratch out of the
  // current UNSAVED form values + statisticsState + branding selection. Only
  // the public-facing fields the homepage renders — the loaded row is NOT
  // spread in, so owner_id / id / timestamps / tokens never reach the iframe.
  function buildPreviewPayload() {
    const soundsEl = document.getElementById('sounds_enabled');
    const r = {
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
      highlights: statisticsState.map(s => ({
        _previewId: s._id,                                 // local editing id — never persisted
        type:    VALID_TYPES.has(s.type) ? s.type : 'custom',
        value:   normText(s.value),
        label:   normText(s.label),
        labelAr: normText(s.labelAr),
        visible: s.visible !== false,
      })),
    };
    // lang + theme are authoritative preview metadata, echoed on EVERY send so
    // an ordinary Settings edit can never reset them. Taken straight from parent
    // state — never from the admin document, restaurant data or localStorage.
    return { restaurant: r, lang: previewLang, theme: previewTheme };
  }

  // Ordinary Settings edits → refresh the ACTIVE frame in place (no reload, no
  // double buffer). Coalesced to one send per animation frame.
  function postPreviewData() {
    if (!previewInitDone || !activeFrame || !activeReady) return;
    if (previewSendQueued) return;
    previewSendQueued = true;
    requestAnimationFrame(() => { previewSendQueued = false; sendPreviewNow(activeFrame, activeNavId); });
  }
  function sendPreviewNow(frame, navId) {
    if (!previewInitDone || !frame || !frame.contentWindow) return;
    frame.contentWindow.postMessage(
      { type: 'PREVIEW_DATA', nav: navId, payload: buildPreviewPayload() }, window.location.origin);
  }

  // Two frame contentWindows may exist during a transition — and a slot's
  // contentWindow identity SURVIVES a same-origin src change, so source alone
  // cannot tell a stale document from the fresh one in the same slot. Every
  // child message therefore carries `nav` (the generation from its boot URL);
  // READY / APPLIED / ERROR are only acted on when `msg.nav` still matches the
  // navigation they claim to belong to.
  function onPreviewMessage(e) {
    if (e.origin !== window.location.origin) return;
    const src = e.source;
    const fromActive   = !!(activeFrame   && src === activeFrame.contentWindow);
    const fromIncoming = !!(incomingFrame && src === incomingFrame.contentWindow);
    if (!fromActive && !fromIncoming) return;
    const msg = e.data;
    if (!msg || typeof msg !== 'object') return;
    const isPending = fromIncoming && pendingNav && incomingFrame === pendingNav.frame;
    const navMatchesPending = isPending && msg.nav === pendingNav.id;

    if (msg.type === 'PREVIEW_READY') {
      if (navMatchesPending) {
        previewReady = true;
        sendPreviewNow(pendingNav.frame, pendingNav.id);   // no-op until previewInitDone
      } else if (fromActive && msg.nav === activeNavId) {
        sendPreviewNow(activeFrame, activeNavId);          // active re-announced (rare)
      }
      // stale READY (msg.nav ≠ current generation) → ignored: no PREVIEW_DATA sent
    } else if (msg.type === 'PREVIEW_APPLIED') {
      if (navMatchesPending) completeNavigation();
      // stale / mismatched APPLIED → ignore; that frame is recycled on the next nav
    } else if (msg.type === 'PREVIEW_ERROR') {
      if (navMatchesPending) handleNavFailure();
      // a stale generation's error must NOT cancel the newer incoming navigation
    } else if (msg.type === 'PREVIEW_STAT_CLICK') {
      if (fromActive) focusStatCard(String(msg.previewId));
    } else if (msg.type === 'PREVIEW_NAVIGATE') {
      // Same-site nav link clicked inside the ACTIVE preview. Validated against
      // the page allow-list; arbitrary paths are ignored.
      if (fromActive && PREVIEW_PAGES[msg.page]) setPreviewPage(msg.page);
    } else if (msg.type === 'PREVIEW_THEME_CHANGE') {
      // Real in-iframe theme button — keep the parent Theme control in sync.
      // The child already applied it, so no re-send; not a Settings change.
      if (fromActive && (msg.theme === 'dark' || msg.theme === 'light')) {
        previewTheme = msg.theme;
        syncSeg('data-theme', previewTheme);
        if (lpStage) lpStage.dataset.theme = previewTheme;
      }
    } else if (msg.type === 'PREVIEW_LANGUAGE_CHANGE') {
      // Real in-iframe language toggle — keep the parent Language control in
      // sync. Child already applied it; no re-send; not a Settings change.
      if (fromActive && (msg.lang === 'ar' || msg.lang === 'en')) {
        previewLang = msg.lang;
        syncSeg('data-lang', previewLang);
      }
    }
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
