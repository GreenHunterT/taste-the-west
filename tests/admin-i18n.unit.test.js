// Admin interface i18n (milestone 1T) — zero-dependency unit tests.
//
//   node --test tests/admin-i18n.unit.test.js
//
// Loads admin/js/i18n.js in a VM with a minimal DOM/localStorage stub and
// checks: EN/AR dictionary parity, that every key the Admin sources reference
// exists, interpolation, and per-device persistence that never touches the
// Live Preview's own language key.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'admin/js/i18n.js'), 'utf8');

function makeStorage(initial) {
  const m = new Map(Object.entries(initial || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _map: m,
  };
}
function load(storage) {
  const attrs = {};
  const document = {
    documentElement: { setAttribute: (k, v) => { attrs[k] = v; }, getAttribute: (k) => attrs[k], classList: { remove: () => {} } },
    querySelectorAll: () => [],
    addEventListener: () => {},
  };
  const window = {};
  vm.runInNewContext(SRC, { window, document, localStorage: storage, console, JSON });
  return { I18N: window.AdminI18n, rootAttrs: attrs };
}

test('EN and AR dictionaries have identical keys, no empty values, same placeholders', () => {
  const { I18N } = load(makeStorage());
  const { en, ar } = I18N._dicts;
  assert.deepEqual(Object.keys(ar).sort(), Object.keys(en).sort());
  const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',');
  for (const k of Object.keys(en)) {
    assert.ok(en[k].trim(), 'empty EN ' + k);
    assert.ok(ar[k].trim(), 'empty AR ' + k);
    assert.equal(ph(ar[k]), ph(en[k]), 'placeholder mismatch ' + k);
  }
});

test('Arabic strings are actually Arabic (no untranslated English copies)', () => {
  const { I18N } = load(makeStorage());
  const { en, ar } = I18N._dicts;
  // Brand/format-only strings that are legitimately identical in both.
  const SAME_OK = new Set(['stats.summary']);
  for (const k of Object.keys(en)) {
    if (SAME_OK.has(k)) continue;
    assert.notEqual(ar[k], en[k], 'AR identical to EN for ' + k);
    assert.match(ar[k], /[\u0600-\u06FF]/, 'AR has no Arabic letters for ' + k);
  }
});

test('every i18n key referenced by the Admin sources exists', () => {
  const { I18N } = load(makeStorage());
  const dict = I18N._dicts.en;
  const files = [
    'admin/index.html', 'admin/login.html', 'admin/js/admin-shell.js', 'admin/js/auth.js',
    'admin/js/live-preview.js', 'admin/js/views/menu-workspace.js', 'admin/js/views/menu.js',
    'admin/js/views/categories.js', 'admin/js/views/settings.js',
  ];
  const NS = '(?:shell|lang|dirty|preview|common|upload|err|mw|menu|cat|set|stats|tr|login)';
  const re = new RegExp('[\'"](' + NS + '\\.[A-Za-z0-9_.]+)[\'"]', 'g');
  const missing = [];
  let seen = 0;
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of src.matchAll(re)) {
      if (/\.(js|html|css)$/.test(m[1])) continue;   // file names, not keys
      seen++;
      if (!Object.prototype.hasOwnProperty.call(dict, m[1])) missing.push(f + ': ' + m[1]);
    }
  }
  assert.ok(seen > 200, 'expected many key references, found ' + seen);
  assert.deepEqual(missing, []);
});

test('no leftover side-by-side bilingual Admin labels', () => {
  for (const f of ['admin/index.html', 'admin/js/views/settings.js', 'admin/js/live-preview.js', 'admin/css/admin.css']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(!src.includes('bilingual-hint'), f + ' still uses bilingual-hint');
    assert.ok(!/Portal Waves · أمواج/.test(src), f + ' still has the dual-language demo badge');
  }
});

test('t() interpolates vars and nested keys; unknown key falls back to itself', () => {
  const { I18N } = load(makeStorage());
  assert.equal(I18N.t('stats.card', { n: 3 }), 'Statistic 3');
  assert.equal(I18N.t('stats.summary', { type: { key: 'stats.type.percent' }, value: '90%' }), 'Percentage · 90%');
  assert.equal(I18N.t('no.such.key'), 'no.such.key');
  I18N.setLang('ar');
  assert.equal(I18N.t('stats.card', { n: 3 }), 'الإحصائية 3');
  assert.equal(I18N.t('set.hours'), 'ساعات العمل');
});

test('defaults to English; persists Arabic per device without touching other UI keys', () => {
  const storage = makeStorage({ ttw_admin_ui: JSON.stringify({ lang: 'en', adminSounds: false, page: 'menu' }) });
  const a = load(storage);
  assert.equal(a.I18N.getLang(), 'en');
  a.I18N.setLang('ar');
  const blob = JSON.parse(storage.getItem('ttw_admin_ui'));
  assert.equal(blob.adminLang, 'ar');
  assert.equal(blob.lang, 'en', 'Live Preview language must be untouched');
  assert.equal(blob.adminSounds, false);
  assert.equal(blob.page, 'menu');

  // "Reload": a fresh instance restores Arabic.
  const b = load(storage);
  assert.equal(b.I18N.getLang(), 'ar');
  assert.equal(b.rootAttrs['data-admin-lang'], 'ar');
  assert.equal(b.rootAttrs.lang, 'ar');
  assert.equal(b.rootAttrs.dir, undefined, 'document must never be set to dir=rtl');
});

test('invalid stored/requested languages normalize to English; storage failures are tolerated', () => {
  const s1 = makeStorage({ ttw_admin_ui: JSON.stringify({ adminLang: 'fr' }) });
  assert.equal(load(s1).I18N.getLang(), 'en');
  const s2 = makeStorage({ ttw_admin_ui: '{not json' });
  assert.equal(load(s2).I18N.getLang(), 'en');
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const { I18N } = load(broken);
  assert.equal(I18N.setLang('ar'), 'ar');
});

test('onChange listeners fire once per real change', () => {
  const { I18N } = load(makeStorage());
  const calls = [];
  const off = I18N.onChange((l) => calls.push(l));
  I18N.setLang('ar'); I18N.setLang('ar'); I18N.setLang('en');
  off();
  I18N.setLang('ar');
  assert.deepEqual(calls, ['ar', 'en']);
});
