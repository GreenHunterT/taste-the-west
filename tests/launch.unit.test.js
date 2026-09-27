// Launch-readiness fixes (milestone 1X) — zero-dependency checks.
//
//   node --test tests/launch.unit.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('/admin redirects to /admin/ (the Admin loads css/ and js/ relative to its folder)', () => {
  const cfg = JSON.parse(read('vercel.json'));
  const r = (cfg.redirects || []).find((x) => x.source === '/admin');
  assert.ok(r, 'redirect for /admin');
  assert.equal(r.destination, '/admin/');
  assert.ok(!(cfg.rewrites || []).some((x) => x.source === '/admin'), 'no rewrite serving the Admin AT /admin');
  // Why: the Admin's own asset references are relative — they only work under /admin/.
  const html = read('admin/index.html');
  assert.match(html, /href="css\/admin\.css"/);
  assert.match(html, /src="js\/admin-shell\.js"/);
  const hdr = (cfg.headers || []).find((h) => h.source === '/admin/(.*)');
  assert.ok(hdr && hdr.headers.some((h) => h.key === 'X-Frame-Options' && h.value === 'DENY'), 'admin still frame-protected');
});

test('404.html resolves relative assets/links from the site root', () => {
  const html = read('404.html');
  const base = html.indexOf('<base href="/"');
  assert.ok(base !== -1, '<base href="/"> present');
  const firstRelative = html.search(/(href|src)="(?!https?:|data:|#|\/)[^"]+"/);
  assert.ok(firstRelative === -1 || base < firstRelative, '<base> comes before the first relative URL');
});

test('schema.sql demo seed refuses to run over an existing restaurant', () => {
  const sql = read('supabase/schema.sql');
  const guard = sql.indexOf('IF EXISTS (SELECT 1 FROM restaurants WHERE id = _rid) THEN');
  const del = sql.indexOf('DELETE FROM products   WHERE restaurant_id = _rid;');
  assert.ok(guard !== -1 && del !== -1 && guard < del, 'guard runs before any DELETE');
  assert.match(sql, /FOR A NEW, EMPTY SUPABASE PROJECT ONLY/);
});
