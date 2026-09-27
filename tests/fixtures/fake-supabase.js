// Test-only stand-in for the supabase-js UMD bundle (served in place of the
// CDN script by tests/fixtures/harness.js). Offline and deterministic: every
// table query is proxied to the harness's ONE fake database
// (POST /__fake/query), so data persists across reloads and is shared with
// the mocked PostgREST reads. Writes are also mirrored into window.__writes so
// tests can prove that an Admin language switch never reaches the database.
(function () {
  'use strict';

  window.__writes = [];

  function run(q) {
    if (q.op !== 'select') window.__writes.push({ table: q.table, op: q.op, payload: q.payload, filters: q.filters });
    return fetch('/__fake/query', { method: 'POST', body: JSON.stringify(q) })
      .then(function (r) { return r.json(); });
  }

  function builder(table) {
    var q = { table: table, op: 'select', payload: null, filters: [] };
    var b = {
      select: function () { return b; },
      eq: function (k, v) { q.filters.push([k, v]); return b; },
      order: function () { return b; },
      abortSignal: function () { return b; },
      update: function (p) { q.op = 'update'; q.payload = p; return b; },
      insert: function (p) { q.op = 'insert'; q.payload = p; return b; },
      delete: function () { q.op = 'delete'; return b; },
      then: function (res, rej) { return run(q).then(res, rej); },
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
