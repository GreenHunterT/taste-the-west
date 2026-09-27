// Admin usability / polish pass (milestone 1W) — real-browser tests for the
// changes that have behaviour (not cosmetic snapshots). Same offline harness.
//
//   NODE_PATH=<dir with playwright-core>/node_modules node --test tests/admin-polish.browser.test.js
'use strict';

const test = require('node:test');
const { before, after } = test;
const assert = require('node:assert/strict');
const { startHarness } = require('./fixtures/harness');

let H, page, base;
before(async () => {
  H = await startHarness(); ({ page, base } = H);
  // A test may end with unsaved edits; leaving the page then raises the
  // browser's own "Leave site?" prompt (the Admin's unload guard working) —
  // accept it so the next test can navigate.
  page.on('dialog', (d) => { if (d.type() === 'beforeunload') d.accept().catch(() => {}); });
});
after(async () => { if (H) await H.stop(); });

async function until(fn, ms, what) {
  const end = Date.now() + (ms || 4000);
  let last;
  while (Date.now() < end) {
    try { last = await fn(); if (last) return last; } catch (e) { last = String(e); }
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error('timed out waiting for ' + (what || 'condition') + ' (last: ' + JSON.stringify(last) + ')');
}
async function open(hash, wait, lang, width) {
  await page.setViewportSize({ width: width || 1440, height: 900 });
  await page.goto(base + '/__blank');
  await page.evaluate((v) => localStorage.setItem('ttw_admin_ui', JSON.stringify({ adminLang: v, lang: 'en' })), lang || 'en');
  await page.goto(base + '/admin/index.html#' + hash);
  await page.waitForSelector(wait);
}
const openSettings = (lang, w) => open('settings', '#name_en[value], #settings-form', lang, w)
  .then(() => page.waitForFunction(() => document.querySelector('#name_en').value === 'Taste The West'));
const openItems = (lang, w) => open('menu&section=items', '#products-table-wrap tr[data-id] [data-role="drag"]:not([disabled])', lang, w);
const visible = (sel) => page.$eval(sel, (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length) && getComputedStyle(e).display !== 'none');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// ── P1: [hidden] really hides ───────────────────────────────────────
test('no image → no broken preview and no "Remove" button (settings + product editor)', async () => {
  H.db.reset('featured');
  await openSettings();
  for (const id of ['hero-preview', 'hero-remove', 'logo-preview', 'logo-remove']) {
    assert.equal(await visible('#' + id), false, id + ' must be hidden');
  }
  await openItems();
  await page.click('tr[data-id="mar"] .btn-edit');
  await page.waitForSelector('#product-modal.open');
  assert.equal(await visible('#p-image-preview'), false);
  assert.equal(await visible('#p-image-remove'), false);
  assert.equal(await page.$eval('.img-upload-label [data-i18n^="upload."]', (e) => e.textContent), 'Click to upload');
  await page.click('#modal-cancel');
});

test('existing / picked image → preview + Remove shown, upload area says "replace"', async () => {
  H.db.reset('featured');
  H.db.tables.products.find((p) => p.id === 'mar').image_url = base + '/assets/images/product-placeholder.svg';
  await openItems();
  await page.click('tr[data-id="mar"] .btn-edit');
  await page.waitForSelector('#product-modal.open');
  assert.equal(await visible('#p-image-remove'), true);
  assert.equal(await page.$eval('#product-modal .img-upload-label [data-i18n^="upload."]', (e) => e.textContent), 'Click to replace the image');
  await page.click('#p-image-remove');
  assert.equal(await page.$eval('#product-modal .img-upload-label [data-i18n^="upload."]', (e) => e.textContent), 'Click to upload');
  await page.click('#modal-cancel');

  await openSettings('ar');
  await page.setInputFiles('#hero-file', { name: 'hero.png', mimeType: 'image/png', buffer: PNG });
  assert.equal(await visible('#hero-remove'), true);
  assert.equal(await page.$eval('#hero-file', (i) => i.closest('.img-upload-area').querySelector('[data-i18n^="upload."]').textContent), 'انقر لاستبدال الصورة');
});

test('image upload failure shows a clear, specific message (EN) and nothing is saved', async () => {
  H.db.reset('featured');
  await openSettings();
  await page.evaluate(() => {
    window.db.storage.from = () => ({
      upload: async () => ({ error: { message: 'The object exceeded the maximum allowed size' } }),
      remove: async () => ({ error: null }),
      getPublicUrl: (p) => ({ data: { publicUrl: 'https://example.invalid/' + p } }),
    });
  });
  const w0 = H.db.writes.length;
  await page.setInputFiles('#logo-file', { name: 'logo.png', mimeType: 'image/png', buffer: PNG });
  await page.click('#save-btn');
  await page.waitForFunction(() => [...document.querySelectorAll('.toast-error')].some((e) => /could not be uploaded/.test(e.textContent)));
  assert.equal(H.db.writes.length, w0, 'no restaurant write after a failed upload');
});

// ── Maps embed ──────────────────────────────────────────────────────
test('pasting the Google Maps embed CODE keeps only the map link, and saves it', async () => {
  H.db.reset('featured');
  await openSettings();
  const snippet = '<iframe src="https://www.google.com/maps/embed?pb=!1m18!2d39.6&amp;hl=en" width="600" height="450" style="border:0;" allowfullscreen="" loading="lazy"></iframe>';
  await page.fill('#map_embed', snippet);
  assert.equal(await page.inputValue('#map_embed'), 'https://www.google.com/maps/embed?pb=!1m18!2d39.6&hl=en');
  await page.click('#save-btn');
  await until(() => H.db.tables.restaurants[0].map_embed === 'https://www.google.com/maps/embed?pb=!1m18!2d39.6&hl=en', 4000, 'saved link');
  // A plain link is left untouched.
  await page.fill('#map_embed', 'https://maps.google.com/maps?q=x&output=embed');
  assert.equal(await page.inputValue('#map_embed'), 'https://maps.google.com/maps?q=x&output=embed');
});

// ── Validation feedback ─────────────────────────────────────────────
test('product editor flags every missing required field, focuses the first, and writes nothing', async () => {
  H.db.reset('featured');
  await openItems('ar');
  await page.click('#add-product-btn');
  await page.waitForSelector('#product-modal.open');
  await page.fill('#p-name-en', 'Soup');
  const w0 = H.db.writes.length;
  await page.click('#modal-save');
  assert.deepEqual(await page.$$eval('#product-form [aria-invalid="true"]', (e) => e.map((x) => x.id)), ['p-name-ar', 'p-price']);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'p-name-ar');
  await page.waitForFunction(() => [...document.querySelectorAll('.toast-error')].some((e) => /يُرجى تعبئة الحقول المحدّدة/.test(e.textContent)));
  assert.equal(H.db.writes.length, w0);
  await page.fill('#p-name-ar', 'شوربة');
  assert.deepEqual(await page.$$eval('#product-form [aria-invalid="true"]', (e) => e.map((x) => x.id)), ['p-price'], 'typing clears the flag');
  await page.click('#modal-cancel');
  await page.click('#add-product-btn');
  assert.equal(await page.$$eval('#product-form [aria-invalid]', (e) => e.length), 0, 'flags reset when the editor reopens');
  await page.click('#modal-cancel');
});

test('Settings: missing business name is flagged', async () => {
  H.db.reset('featured');
  await openSettings();
  await page.fill('#name_en', '');
  await page.click('#save-btn');
  assert.equal(await page.$eval('#name_en', (e) => e.getAttribute('aria-invalid')), 'true');
  await page.fill('#name_en', 'Taste The West');
  assert.equal(await page.$eval('#name_en', (e) => e.getAttribute('aria-invalid')), null);
});

// ── Unsaved-changes clarity ─────────────────────────────────────────
test('Live Preview says when it is showing unsaved changes; guard still protects the draft', async () => {
  H.db.reset('featured');
  await openSettings();
  assert.equal(await page.$eval('.live-preview__hint', (e) => e.textContent), 'Updates as you edit. Changes go live only after you Save.');
  assert.equal(await visible('#lp-draft-chip'), false);
  await page.fill('#tagline_en', 'New tagline');
  await until(() => visible('#lp-draft-chip'), 2000, 'chip on');
  await page.click('.admin-navlink[data-route="menu"]');
  await page.waitForSelector('#admin-dirty-dialog[open]');
  await page.click('[data-dirty-stay]');
  assert.equal(await page.inputValue('#tagline_en'), 'New tagline');
  await page.click('#save-btn');
  await until(() => H.db.tables.restaurants[0].tagline_en === 'New tagline', 4000, 'saved');
  await until(async () => !(await visible('#lp-draft-chip')), 2000, 'chip off after save');

  // Menu editor too, and it clears on Cancel.
  await openItems();
  await page.click('tr[data-id="mar"] .btn-edit');
  await page.fill('#p-price', '12');
  await until(() => visible('#lp-draft-chip'), 2000, 'chip on (menu)');
  await page.click('#modal-cancel');
  await until(async () => !(await visible('#lp-draft-chip')), 2000, 'chip off after cancel');
});

test('Settings save bar stays in view while scrolling on a tablet-width layout', async () => {
  H.db.reset('featured');
  await openSettings('en', 768);
  await page.evaluate(() => window.scrollTo(0, 2500));
  await page.waitForTimeout(150);
  const r = await page.$eval('#save-btn', (b) => b.getBoundingClientRect().top);
  assert.ok(r >= 0 && r < 160, 'Save button visible near the top after scrolling: ' + r);
});

test('Settings cards: everyday business info first, advanced last', async () => {
  H.db.reset('featured');
  await openSettings();
  assert.deepEqual(await page.$$eval('#admin-view .acard-title', (e) => e.map((x) => x.textContent.trim())),
    ['Identity', 'Contact', 'Opening Hours', 'Location', 'Images', 'Homepage Statistics', 'Content Labels', 'Website Sounds', 'Page Transition']);
});

// ── Menu table ──────────────────────────────────────────────────────
test('menu rows: labeled actions, no duplicate headings, Hide/Show still works', async () => {
  H.db.reset('featured');
  await openItems();
  assert.deepEqual(await page.$$eval('tr[data-id="mar"] .row-actions .btn', (e) => e.map((x) => x.textContent.trim())), ['Edit', 'Hide', 'Delete']);
  assert.equal(await page.$eval('tr[data-id="las"] .btn-toggle', (e) => e.textContent.trim()), 'Show');
  assert.match(await page.$eval('tr[data-id="mar"] .btn-toggle', (e) => e.title), /Hide from your public menu/);
  assert.equal(await page.$$eval('.data-table th', (e) => e.filter((x) => /category/i.test(x.textContent)).length), 0, 'redundant Category column removed');
  assert.equal(await visible('.menu-items-title, .menu-workspace .admin-page-title'), false, 'no repeated "Menu Items" heading');
  assert.notEqual(await page.$eval('#table-search', (e) => getComputedStyle(e).backgroundColor), 'rgb(255, 255, 255)', 'search box styled');
  await page.click('tr[data-id="mar"] .btn-toggle');
  await until(() => H.db.tables.products.find((p) => p.id === 'mar').available === false, 4000, 'hidden');
  await until(async () => (await page.$eval('tr[data-id="mar"] .btn-toggle', (e) => e.textContent.trim())) === 'Show', 4000, 'label flips');
});

test('responsive: every row action reachable, no page overflow (EN/AR, 1440 → 320)', async () => {
  H.db.reset('featured');
  const problems = [];
  for (const lang of ['en', 'ar']) {
    for (const w of [1440, 1024, 768, 390, 320]) {
      await openItems(lang, w);
      const r = await page.evaluate(() => {
        const out = [];
        const de = document.documentElement;
        if (de.scrollWidth > de.clientWidth + 1) out.push('page overflow');
        const wrap = document.querySelector('#products-table-wrap').getBoundingClientRect();
        document.querySelectorAll('#products-table-wrap .row-actions .btn').forEach((b) => {
          const q = b.getBoundingClientRect();
          if (q.right > wrap.right + 1 || q.left < wrap.left - 1) out.push('action clipped: ' + b.textContent.trim());
        });
        const card = document.querySelector('#featured-card').getBoundingClientRect();
        document.querySelectorAll('#featured-card button, #featured-card select').forEach((b) => {
          const q = b.getBoundingClientRect();
          if (q.width && (q.right > card.right + 1 || q.left < card.left - 1)) out.push('featured control overflow');
        });
        return [...new Set(out)];
      });
      r.forEach((x) => problems.push(`${lang} ${w}: ${x}`));
      await openSettings(lang, w);
      if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)) problems.push(`${lang} ${w}: settings page overflow`);
    }
  }
  assert.deepEqual(problems, []);
});

test('no uncaught page errors; no unexpected REST writes', () => {
  assert.deepEqual(H.pageErrors, []);
  assert.deepEqual(H.netWrites, []);
});
