(async function () {
  showLoading();
  const session = await requireAuth();
  if (!session) return;

  const restaurant = await getMyRestaurant(session.user.id);
  initAdminShell(restaurant ? restaurant.name_en || restaurant.name_ar : 'My Restaurant');
  hideLoading();

  // Populate form with existing data
  if (restaurant) populateForm(restaurant);

  // Image file pickers + explicit-remove state (hero and logo are independent)
  let heroFile = null;
  let logoFile = null;
  let removeHero = false;
  let removeLogo = false;

  // Picking a new file always supersedes a pending "remove".
  initImageInput('hero-file', 'hero-preview', f => { heroFile = f; removeHero = false; updateBrandingRemoveBtns(); });
  initImageInput('logo-file', 'logo-preview', f => { logoFile = f; removeLogo = false; updateBrandingRemoveBtns(); });

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
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save Changes';
    }
  }

  function val(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
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
      const el = document.getElementById(f);
      if (el && r[f] !== undefined && r[f] !== null) el.value = r[f];
    });
    const soundsEl = document.getElementById('sounds_enabled');
    if (soundsEl) soundsEl.checked = r.sounds_enabled !== false;
  }
})();
