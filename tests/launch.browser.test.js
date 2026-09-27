// Launch-readiness fixes (milestone 1X) — the 404 page served at a NESTED
// missing path (how Vercel serves 404.html) must still be styled and working.
//
//   NODE_PATH=<dir with playwright-core>/node_modules node --test tests/launch.browser.test.js
'use strict';

const test = require('node:test');
const { before, after } = test;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startHarness } = require('./fixtures/harness');

let H;
before(async () => { H = await startHarness(); H.db.reset('featured'); });
after(async () => { if (H) await H.stop(); });

test('nested missing URL → styled 404, no broken assets, Home link works (EN + AR)', async () => {
  const ctx = await H.newContext();
  const body = fs.readFileSync(path.join(__dirname, '..', '404.html'));
  await ctx.route(H.base + '/menu/old-item', (r) => r.fulfill({ status: 404, contentType: 'text/html', body }));
  const p = await ctx.newPage();
  const bad = [], errors = [];
  p.on('response', (r) => { if (r.status() >= 400 && !/old-item|favicon/.test(r.url())) bad.push(r.status() + ' ' + r.url()); });
  p.on('pageerror', (e) => errors.push(e.message));
  for (const lang of ['en', 'ar']) {
    await p.goto(H.base + '/__blank');
    await p.evaluate((l) => localStorage.setItem('souqsite_language', l), lang);
    await p.goto(H.base + '/menu/old-item', { waitUntil: 'networkidle' });
    assert.match(await p.evaluate(() => getComputedStyle(document.body).fontFamily), /Cairo/, 'site stylesheet applied');
    assert.equal(await p.evaluate(() => document.documentElement.dir), lang === 'ar' ? 'rtl' : 'ltr');
    assert.match(await p.$eval('[data-wa-link]', (a) => a.href), /^https:\/\/wa\.me\//, 'app.js ran (WhatsApp link filled)');
    await p.click('.error-actions a.btn-primary');
    await p.waitForURL(/\/index\.html$/);
  }
  assert.deepEqual(bad, []);
  assert.deepEqual(errors, []);
  await ctx.close();
});
