// Test-only stand-in for supabase-js used by tests/recovery.browser.test.js.
// Mirrors the parts of supabase-js 2.116 the login / reset pages rely on:
//  • URL detection (implicit flow): a `#access_token=…&type=recovery` link
//    becomes a session, the URL is cleared, and PASSWORD_RECOVERY is emitted on
//    a LATER tick (exactly like the real SDK's setTimeout);
//  • resetPasswordForEmail / verifyOtp / updateUser / signOut.
// Configured per test through window.__FAKE_AUTH (set by an init script);
// every call is recorded in window.__authCalls.
(function () {
  'use strict';
  var cfg = window.__FAKE_AUTH || {};
  var calls = window.__authCalls = [];
  var subs = [];
  var session = cfg.session || null;
  function emit(ev, s) { subs.forEach(function (fn) { try { fn(ev, s); } catch (e) {} }); }

  var ready = new Promise(function (resolve) {
    setTimeout(function () {
      var h = location.hash;
      if (/access_token=/.test(h) && /type=recovery/.test(h)) {
        session = { user: { id: 'u1' }, access_token: 'recovery-token' };
        history.replaceState(null, '', location.pathname + location.search);
        setTimeout(function () { emit('PASSWORD_RECOVERY', session); }, 0);
      }
      resolve();
    }, 5);
  });

  window.supabase = {
    createClient: function () {
      return {
        auth: {
          getSession: function () { return ready.then(function () { return { data: { session: session } }; }); },
          onAuthStateChange: function (fn) { subs.push(fn); return { data: { subscription: { unsubscribe: function () {} } } }; },
          signInWithPassword: function () { return Promise.resolve({ data: {}, error: { message: 'Invalid login credentials', status: 400 } }); },
          resetPasswordForEmail: function (email, opts) {
            calls.push(['resetPasswordForEmail', email, opts]);
            if (cfg.resetThrow) return Promise.reject(new TypeError('Failed to fetch'));
            return Promise.resolve(cfg.resetError ? { data: null, error: cfg.resetError } : { data: {}, error: null });
          },
          verifyOtp: function (p) {
            calls.push(['verifyOtp', p]);
            if (cfg.otpError) return Promise.resolve({ data: {}, error: cfg.otpError });
            session = { user: { id: 'u1' }, access_token: 'recovery-token' };
            setTimeout(function () { emit('PASSWORD_RECOVERY', session); }, 0);
            return Promise.resolve({ data: { session: session }, error: null });
          },
          updateUser: function (p) {
            calls.push(['updateUser', p]);
            if (!session) return Promise.resolve({ data: null, error: { status: 401, message: 'Auth session missing!' } });
            return Promise.resolve(cfg.updateError ? { data: null, error: cfg.updateError } : { data: { user: { id: 'u1' } }, error: null });
          },
          signOut: function () { calls.push(['signOut']); session = null; return Promise.resolve({ error: null }); },
        },
      };
    },
  };
})();
