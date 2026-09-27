// Test-only stand-in for the supabase-js UMD bundle (served in place of the
// CDN script by tests/admin-i18n.browser.test.js). Offline, deterministic,
// and it records every write in window.__writes so tests can prove that an
// Admin language switch never reaches the database.
(function () {
  'use strict';

  var restaurant = {
    id: 'r1', owner_id: 'u1', updated_at: '2026-01-01T00:00:00Z',
    name_en: 'Taste The West', name_ar: 'تيست ذا ويست',
    tagline_en: 'A Different Kind of Pizza', tagline_ar: 'بيتزا بأسلوب مختلف',
    description_en: 'Wood-fired pizza.', description_ar: 'بيتزا على الحطب.',
    phone: '+966 50 000 0000', whatsapp: '966500000000', instagram: '@ttw', email: '',
    wa_message_en: 'Hi!', wa_message_ar: 'مرحباً!',
    address_en: 'Sultana District, Madinah', address_ar: 'حي السلطانة، المدينة المنورة',
    map_directions: '', map_embed: '',
    hours_weekdays_en: '12 PM – 12 AM', hours_weekdays_ar: '١٢ ظهراً – ١٢ ليلاً',
    hours_weekends_en: '12 PM – 1 AM', hours_weekends_ar: '١٢ ظهراً – ١ فجراً',
    sounds_enabled: true, transition_enabled: true, transition_style: 'portal', transition_color: '#d4af65',
    business_type: 'restaurant',
    catalog_label_en: '', catalog_label_ar: '', featured_title_en: '', featured_title_ar: '',
    catalog_heading_en: '', catalog_heading_ar: '',
    hero_image_url: '', logo_url: '', location_visual_mode: 'map', location_image_url: '',
    highlights: [
      { type: 'percent', value: '100%', label: 'Quality', labelAr: 'جودة', visible: true },
      { type: 'rating', value: '★4.8', label: 'Rating', labelAr: 'تقييم', visible: true },
    ],
  };
  var tables = {
    restaurants: [restaurant],
    categories: [
      { id: 'c1', restaurant_id: 'r1', slug: 'pizza', name_en: 'Pizza', name_ar: 'بيتزا', sort_order: 0 },
      { id: 'c2', restaurant_id: 'r1', slug: 'drinks', name_en: 'Drinks', name_ar: 'مشروبات', sort_order: 1 },
    ],
  };
  window.__writes = [];
  window.__fakeTables = tables;

  function builder(table) {
    var op = 'select', payload = null, filters = [];
    var b = {
      select: function () { return b; },
      eq: function (k, v) { filters.push([k, v]); return b; },
      order: function () { return b; },
      abortSignal: function () { return b; },
      update: function (p) { op = 'update'; payload = p; return b; },
      insert: function (p) { op = 'insert'; payload = p; return b; },
      delete: function () { op = 'delete'; return b; },
      then: function (res, rej) {
        var rows = (tables[table] || []).filter(function (r) {
          return filters.every(function (f) { return f[0] === 'owner_id' || r[f[0]] === f[1]; });
        });
        var out;
        if (op === 'select') {
          out = { data: rows, error: null };
        } else {
          window.__writes.push({ table: table, op: op, payload: payload, filters: filters });
          if (op === 'update') {
            rows.forEach(function (r) { Object.assign(r, payload); r.updated_at = new Date().toISOString(); });
            out = { data: rows.map(function (r) { return { updated_at: r.updated_at }; }), error: null };
          } else if (op === 'insert') {
            var row = Object.assign({ id: table + '-' + (window.__writes.length) }, payload);
            (tables[table] = tables[table] || []).push(row);
            out = { data: [{ id: row.id }], error: null };
          } else {
            tables[table] = (tables[table] || []).filter(function (r) { return rows.indexOf(r) === -1; });
            out = { data: null, error: null };
          }
        }
        return Promise.resolve(out).then(res, rej);
      },
    };
    return b;
  }

  var session = { user: { id: 'u1' }, access_token: 'test-token' };
  window.supabase = {
    createClient: function () {
      return {
        auth: {
          getSession: function () { return Promise.resolve({ data: { session: session } }); },
          onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
          signOut: function () { window.__writes.push({ table: 'auth', op: 'signOut' }); return Promise.resolve({}); },
          signInWithPassword: function () { return Promise.resolve({ data: {}, error: { message: 'x' } }); },
        },
        from: builder,
        storage: {
          from: function () {
            return {
              upload: function () { window.__writes.push({ table: 'storage', op: 'upload' }); return Promise.resolve({ error: null }); },
              remove: function () { window.__writes.push({ table: 'storage', op: 'remove' }); return Promise.resolve({ error: null }); },
              getPublicUrl: function (p) { return { data: { publicUrl: 'https://example.invalid/' + p } }; },
            };
          },
        },
      };
    },
  };
})();
