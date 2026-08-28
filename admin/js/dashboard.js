(async function () {
  showLoading();
  const session = await requireAuth();
  if (!session) return;

  const restaurant = await getMyRestaurant(session.user.id);
  initAdminShell(restaurant ? restaurant.name_en || restaurant.name_ar : 'My Restaurant');

  const name = restaurant
    ? (restaurant.name_en || restaurant.name_ar || 'your restaurant')
    : 'your restaurant';

  const welcomeEl = document.getElementById('welcome-msg');
  if (welcomeEl) welcomeEl.textContent = 'Welcome back — ' + name;

  if (!restaurant) {
    hideLoading();
    showToast('No restaurant found for this account. Go to Settings to create one.', 'warning', 6000);
    return;
  }

  // Fetch stats in parallel
  const rid = restaurant.id;
  // Anonymous read (categories_public_read): publishable key in `apikey` only,
  // never as a Bearer token.
  const headers = {
    'apikey': SUPABASE_ANON_KEY,
  };

  // Use the admin session token so RLS owner policies apply (sees unavailable products too)
  const s = await requireAuth();
  if (!s) return;
  const authHeaders = {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + s.access_token,
  };

  const base = SUPABASE_URL + '/rest/v1';

  const [pRes, cRes] = await Promise.all([
    fetch(base + '/products?restaurant_id=eq.' + rid + '&select=id,available,featured', { headers: authHeaders }),
    fetch(base + '/categories?restaurant_id=eq.' + rid + '&select=id', { headers }),
  ]);

  const products   = pRes.ok   ? await pRes.json()   : [];
  const categories = cRes.ok   ? await cRes.json()   : [];

  const available = products.filter(p => p.available).length;
  const featured  = products.filter(p => p.featured).length;

  setText('stat-products',   String(products.length));
  setText('stat-available',  String(available));
  setText('stat-featured',   String(featured));
  setText('stat-categories', String(categories.length));

  hideLoading();

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }
})();
