// =================================================================
//  Admin Supabase Client
//  Loaded after: supabase CDN, ../../config/supabase.js
//  Exports: window.db (the Supabase client instance)
// =================================================================

(function () {
  if (typeof supabase === 'undefined') {
    document.body.innerHTML = '<p style="color:#ef4444;padding:40px;font-family:sans-serif">Supabase SDK failed to load. Check your internet connection and refresh.</p>';
    throw new Error('Supabase SDK not loaded');
  }
  if (!SUPABASE_URL.startsWith('https://') || SUPABASE_URL.includes('YOUR_')) {
    console.warn('[Admin] Supabase is not configured. Fill in config/supabase.js.');
  }
  window.db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
})();
