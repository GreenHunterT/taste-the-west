(async function () {
  showLoading();
  const session = await requireAuth();
  if (!session) return;

  const restaurant = await getMyRestaurant(session.user.id);
  initAdminShell(restaurant ? restaurant.name_en || restaurant.name_ar : 'My Restaurant');
  hideLoading();

  // Populate form with existing data
  if (restaurant) populateForm(restaurant);

  // Image file pickers
  let heroFile = null;
  let logoFile = null;

  initImageInput('hero-file', 'hero-preview', f => { heroFile = f; });
  initImageInput('logo-file', 'logo-preview', f => { logoFile = f; });

  // Show existing images if saved
  if (restaurant && restaurant.hero_image_url) {
    const prev = document.getElementById('hero-preview');
    if (prev) { prev.src = restaurant.hero_image_url; prev.hidden = false; }
  }
  if (restaurant && restaurant.logo_url) {
    const prev = document.getElementById('logo-preview');
    if (prev) { prev.src = restaurant.logo_url; prev.hidden = false; }
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

    try {
      // Upload new images if selected
      let heroUrl = restaurant ? restaurant.hero_image_url : '';
      let logoUrl = restaurant ? restaurant.logo_url       : '';

      if (heroFile) {
        const path = 'branding/' + session.user.id + '-hero';
        heroUrl = await uploadToStorage(heroFile, path);
      }
      if (logoFile) {
        const path = 'branding/' + session.user.id + '-logo';
        logoUrl = await uploadToStorage(logoFile, path);
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

      // Validate required
      if (!payload.name_ar || !payload.name_en) {
        showToast('Restaurant name (Arabic and English) is required.', 'error');
        btn.disabled = false; btn.textContent = 'Save Changes';
        return;
      }

      let result;
      if (restaurant) {
        result = await db.from('restaurants').update(payload).eq('id', restaurant.id);
      } else {
        result = await db.from('restaurants').insert({ ...payload, owner_id: session.user.id });
      }

      if (result.error) throw new Error(result.error.message);

      showToast('Settings saved successfully.', 'success');
    } catch (err) {
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
