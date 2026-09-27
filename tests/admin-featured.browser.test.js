// Explicit homepage Featured items (milestone 1V) — real-browser tests.
//
// Same offline harness as 1T/1U (tests/fixtures/harness.js). The fixture's
// menu order (Margherita, Pepperoni, Taste The West Special, BBQ …) differs
// from its Featured order (Taste The West Special, Chicken Alfredo, BBQ), so
// every test can prove the two orders stay independent.
//
//   NODE_PATH=<dir with playwright-core>/node_modules node --test tests/admin-featured.browser.test.js
'use strict';

const test = require('node:test');
const { before, after } = test;
const assert = require('node:assert/strict');
const { startHarness } = require('./fixtures/harness');

let H, page, base;
before(async () => { H = await startHarness(); ({ page, base } = H); });
after(async () => { if (H) await H.stop(); });

// ── helpers ─────────────────────────────────────────────────────────
async function until(fn, ms, what) {
  const end = Date.now() + (ms || 4000);
  let last;
  while (Date.now() < end) {
    try { last = await fn(); if (last) return last; } catch (e) { last = String(e); }
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error('timed out waiting for ' + (what || 'condition') + ' (last: ' + JSON.stringify(last) + ')');
}
const prod = (id) => H.db.tables.products.find((p) => p.id === id);
const sortSnap = () => JSON.stringify(H.db.tables.products.map((p) => [p.id, p.category_id, p.sort_order]));
const featSnap = () => JSON.stringify(H.db.tables.products.map((p) => [p.id, !!p.featured, p.featured_order]));
async function setAdminLang(l) {
  await page.goto(base + '/__blank');
  await page.evaluate((v) => localStorage.setItem('ttw_admin_ui', JSON.stringify({ adminLang: v, lang: 'en', page: 'menu' })), l);
}
async function openItems() {
  await page.goto(base + '/__blank');
  await page.goto(base + '/admin/index.html#menu&section=items');
  await page.waitForSelector('#products-table-wrap tr[data-id] [data-role="drag"]:not([disabled])');
  await page.waitForSelector('#featured-add-select:not([disabled]), #featured-full:not([hidden])');
}
const featuredIds = () => page.$$eval('#featured-list li[data-fid]', (e) => e.map((x) => x.dataset.fid));
const slotLabels = () => page.$$eval('#featured-list .featured-slot', (e) => e.map((x) => x.textContent));
const menuIds = () => page.$$eval('#products-table-wrap tr[data-id]', (e) => e.map((x) => x.dataset.id));
async function homepage() {
  const p = await H.context.newPage();
  await p.goto(base + '/__blank');
  await p.evaluate(() => localStorage.setItem('souqsite_language', 'en'));
  await p.goto(base + '/index.html');
  await p.waitForSelector('#featured-grid .product-name, #featured-grid p');
  const names = await p.$$eval('#featured-grid .product-name', (e) => e.map((x) => x.textContent.trim()));
  await p.goto(base + '/products.html');
  await p.waitForSelector('#products-grid .product-name');
  const menu = await p.$$eval('#products-grid .product-name', (e) => e.map((x) => x.textContent.trim()));
  await p.close();
  return { featured: names, menu };
}
async function mouseDrag(fromHandle, toRow) {
  await page.locator(toRow).evaluate((e) => e.scrollIntoView({ block: 'center' }));
  const a = await page.locator(fromHandle).boundingBox();
  const b = await page.locator(toRow).boundingBox();
  const x = a.x + a.width / 2;
  await page.mouse.move(x, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, b.y + 3, { steps: 10 });
  await page.mouse.up();
}
const previewFeatured = () => page.frameLocator('iframe.preview-frame.is-active').locator('#featured-grid .product-name').allTextContents();

// ── Baseline / A ────────────────────────────────────────────────────
test('A. homepage shows exactly the 3 chosen items in Featured order (not menu order)', async () => {
  H.db.reset('featured');
  await setAdminLang('en');
  await openItems();
  assert.deepEqual(await featuredIds(), ['ttw', 'alf', 'bbq']);
  assert.deepEqual(await slotLabels(), ['Featured #1', 'Featured #2', 'Featured #3']);
  assert.deepEqual(await menuIds(), ['mar', 'pep', 'ttw', 'bbq', 'alf', 'bol', 'las']);
  const hp = await homepage();
  assert.deepEqual(hp.featured, ['Taste The West Special', 'Chicken Alfredo', 'BBQ Ranch Chicken']);
  assert.deepEqual(hp.menu.slice(0, 4), ['Margherita', 'Pepperoni', 'Taste The West Special', 'BBQ Ranch Chicken']);
});

// ── B / G / H ───────────────────────────────────────────────────────
test('B. reorder Featured (mouse) → homepage + Live Preview change, menu order does not; persists on reload', async () => {
  H.db.reset('featured');
  await openItems();
  const sorts = sortSnap();
  await mouseDrag('#featured-list li[data-fid="bbq"] [data-role="fdrag"]', '#featured-list li[data-fid="ttw"]');
  assert.deepEqual(await featuredIds(), ['bbq', 'ttw', 'alf']);
  await until(() => prod('bbq').featured_order === 0 && prod('ttw').featured_order === 1 && prod('alf').featured_order === 2, 4000, 'db featured order');
  assert.equal(sortSnap(), sorts, 'menu sort_order untouched');
  assert.ok(H.db.writes.every((w) => !(w.payload && 'sort_order' in w.payload)), 'no sort_order write at all');
  await until(async () => (await previewFeatured()).join('|') === 'BBQ Ranch Chicken|Taste The West Special|Chicken Alfredo', 6000, 'preview homepage');

  await openItems();
  assert.deepEqual(await featuredIds(), ['bbq', 'ttw', 'alf'], 'reload keeps Featured order');
  assert.deepEqual(await menuIds(), ['mar', 'pep', 'ttw', 'bbq', 'alf', 'bol', 'las'], 'menu order unchanged');
  const hp = await homepage();
  assert.deepEqual(hp.featured, ['BBQ Ranch Chicken', 'Taste The West Special', 'Chicken Alfredo']);
  assert.deepEqual(hp.menu.slice(0, 4), ['Margherita', 'Pepperoni', 'Taste The West Special', 'BBQ Ranch Chicken']);
});

// ── C ───────────────────────────────────────────────────────────────
test('C. reordering the Menu (and moving category) never changes Featured order', async () => {
  H.db.reset('featured');
  await openItems();
  const feats = featSnap();
  await mouseDrag('tr[data-id="bbq"] [data-role="drag"]', 'tr[data-id="mar"]');
  await until(() => prod('bbq').sort_order === 0, 4000, 'menu reorder');
  await page.click('tr[data-id="alf"] [data-role="down"]');
  await until(() => prod('alf').sort_order === 1, 4000, 'menu ↓');
  assert.equal(featSnap(), feats, 'featured / featured_order untouched by menu reorder');
  assert.deepEqual(await featuredIds(), ['ttw', 'alf', 'bbq']);

  // Moving a featured item to another category keeps its Featured position.
  await page.click('tr[data-id="ttw"] .btn-edit');
  await page.waitForSelector('#product-modal.open');
  await page.selectOption('#p-category', 'c2');
  await page.click('#modal-save');
  await until(() => prod('ttw').category_id === 'c2', 4000, 'category change');
  assert.equal(prod('ttw').featured_order, 0);
  assert.deepEqual((await homepage()).featured, ['Taste The West Special', 'Chicken Alfredo', 'BBQ Ranch Chicken']);
});

// ── D / E ───────────────────────────────────────────────────────────
test('D+E. remove closes the gap; add appends at the end', async () => {
  H.db.reset('featured');
  await openItems();
  await page.click('#featured-list li[data-fid="alf"] [data-role="fremove"]');
  await until(() => prod('alf').featured === false && prod('alf').featured_order === null, 4000, 'removed');
  assert.deepEqual(await featuredIds(), ['ttw', 'bbq']);
  assert.deepEqual(await slotLabels(), ['Featured #1', 'Featured #2', 'Featured #3']);
  assert.equal(await page.$eval('#featured-list li.is-empty .featured-name', (e) => e.textContent), 'Empty slot');
  assert.deepEqual((await homepage()).featured, ['Taste The West Special', 'BBQ Ranch Chicken']);

  await page.selectOption('#featured-add-select', 'bol');
  await page.click('#featured-add-btn');
  await until(() => prod('bol').featured === true, 4000, 'added');
  assert.deepEqual(await featuredIds(), ['ttw', 'bbq', 'bol'], 'appended at the end');
  assert.ok(prod('bol').featured_order > prod('bbq').featured_order);
  assert.deepEqual((await homepage()).featured, ['Taste The West Special', 'BBQ Ranch Chicken', 'Bolognese']);
});

// ── F ───────────────────────────────────────────────────────────────
test('F. a 4th Featured item is prevented (card + product editor) with a clear message', async () => {
  H.db.reset('featured');
  await openItems();
  assert.equal(await page.$eval('#featured-add-btn', (b) => b.disabled), true);
  assert.equal(await page.$eval('#featured-add-select', (b) => b.disabled), true);
  assert.equal(await page.$eval('#featured-full', (e) => e.hidden), false);
  assert.equal(await page.$eval('#featured-full', (e) => e.textContent), 'Maximum of 3 featured items. Remove one item before adding another.');

  await page.click('tr[data-id="mar"] .btn-edit');
  await page.waitForSelector('#product-modal.open');
  await page.click('#p-featured + .toggle-track');
  await page.waitForSelector('.toast-warning');
  assert.match(await page.$eval('.toast-warning', (e) => e.textContent), /Remove one item before adding another/);
  assert.equal(await page.$eval('#p-featured', (e) => e.checked), false, 'toggle refused');
  // Even a forced checkbox is stopped at Save.
  await page.$eval('#p-featured', (e) => { e.checked = true; });
  const w0 = H.db.writes.length;
  await page.click('#modal-save');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(H.db.writes.length, w0, 'nothing saved');
  assert.equal(H.db.tables.products.filter((p) => p.featured).length, 3);
  await page.click('#modal-cancel');
});

test('F2. product editor: ON appends when there is room; OFF removes and closes the gap', async () => {
  H.db.reset('featured');
  await openItems();
  await page.click('tr[data-id="ttw"] .btn-edit');
  await page.waitForSelector('#product-modal.open');
  await page.click('#p-featured + .toggle-track');
  assert.equal(await page.$eval('#p-featured', (e) => e.checked), false);
  await page.click('#modal-save');
  await until(() => prod('ttw').featured === false && prod('ttw').featured_order === null, 4000, 'unfeatured via editor');
  await until(async () => (await featuredIds()).join() === 'alf,bbq', 4000, 'list');

  await page.click('tr[data-id="mar"] .btn-edit');
  await page.waitForSelector('#product-modal.open');
  await page.click('#p-featured + .toggle-track');
  assert.equal(await page.$eval('#p-featured', (e) => e.checked), true);
  await page.click('#modal-save');
  await until(() => prod('mar').featured === true, 4000, 'featured via editor');
  assert.equal(prod('mar').featured_order, 3, 'appended after the current max');
  assert.equal(prod('mar').sort_order, 0, 'menu position untouched');
  await until(async () => (await featuredIds()).join() === 'alf,bbq,mar', 4000, 'list appended');
  assert.deepEqual((await homepage()).featured, ['Chicken Alfredo', 'BBQ Ranch Chicken', 'Margherita']);
});

// ── J. keyboard / ↑↓ / touch ────────────────────────────────────────
test('J. ↑/↓ buttons and keyboard ArrowUp/ArrowDown reorder Featured', async () => {
  H.db.reset('featured');
  await openItems();
  assert.equal(await page.$eval('#featured-list li[data-fid="ttw"] [data-role="fup"]', (b) => b.disabled), true);
  assert.equal(await page.$eval('#featured-list li[data-fid="bbq"] [data-role="fdown"]', (b) => b.disabled), true);
  await page.click('#featured-list li[data-fid="ttw"] [data-role="fdown"]');
  await until(async () => (await featuredIds()).join() === 'alf,ttw,bbq', 4000, '↓');
  await page.focus('#featured-list li[data-fid="bbq"] [data-role="fdrag"]');
  await page.keyboard.press('ArrowUp');
  await until(async () => (await featuredIds()).join() === 'alf,bbq,ttw', 4000, 'keyboard ↑');
  await until(() => page.evaluate(() => document.activeElement && document.activeElement.closest('li') && document.activeElement.closest('li').dataset.fid === 'bbq'), 3000, 'focus kept');
  await until(() => prod('alf').featured_order === 0 && prod('bbq').featured_order === 1 && prod('ttw').featured_order === 2, 4000, 'db');
});

test('J2. touch drag reorders Featured on a phone-sized Admin', async () => {
  H.db.reset('featured');
  const ctx = await H.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await p.goto(base + '/admin/index.html#menu&section=items');
  await p.waitForSelector('#featured-list li[data-fid] [data-role="fdrag"]:not([disabled])');
  await p.locator('#featured-list li[data-fid="ttw"]').evaluate((e) => e.scrollIntoView({ block: 'center' }));
  const a = await p.locator('#featured-list li[data-fid="bbq"] [data-role="fdrag"]').boundingBox();
  const b = await p.locator('#featured-list li[data-fid="ttw"]').boundingBox();
  const x = a.x + a.width / 2, y0 = a.y + a.height / 2, y1 = b.y + 3;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
  for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + (y1 - y0) * i / 10 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await until(() => prod('bbq').featured_order === 0, 4000, 'touch featured reorder');
  const overflow = await p.$$eval('#featured-list li.featured-item', (lis) => lis.flatMap((li) => {
    const r = li.getBoundingClientRect();
    return [...li.children].filter((c) => { const q = c.getBoundingClientRect(); return q.width && (q.right > r.right + 1 || q.left < r.left - 1); }).map((c) => c.className);
  }));
  assert.deepEqual(overflow, [], 'featured rows fit at 390px');
  await ctx.close();
});

// ── Failure ─────────────────────────────────────────────────────────
test('failed persistence restores the previous Featured state with a localized error', async () => {
  H.db.reset('featured');
  await setAdminLang('ar');
  try {
    await openItems();
    const feats = featSnap();
    H.db.failIf = (q) => q.table === 'products' && q.op === 'update' && q.payload && 'featured_order' in q.payload &&
      q.filters.some((f) => f[1] === 'alf');
    await page.click('#featured-list li[data-fid="alf"] [data-role="fup"]');
    await page.waitForSelector('.toast-error');
    assert.match(await page.$eval('.toast-error', (e) => e.textContent), /تعذّر تحديث الأصناف المميّزة/);
    H.db.failIf = null;
    await until(async () => (await featuredIds()).join() === 'ttw,alf,bbq', 4000, 'UI restored');
    assert.equal(featSnap(), feats, 'DB rolled back');
    // Failed add, too.
    await page.click('#featured-list li[data-fid="bbq"] [data-role="fremove"]');
    await until(() => prod('bbq').featured === false, 4000, 'removed');
    await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));   // wait for THIS failure's toast
    H.db.failIf = (q) => q.op === 'update' && q.payload && q.payload.featured === true;
    await page.waitForSelector('#featured-add-btn:not([disabled])');   // the remove write has fully finished
    await page.selectOption('#featured-add-select', 'pep');
    await page.click('#featured-add-btn');
    await page.waitForSelector('.toast-error');
    H.db.failIf = null;
    await until(async () => (await featuredIds()).join() === 'ttw,alf', 4000, 'add rolled back');
    assert.equal(prod('pep').featured, false);
  } finally { H.db.failIf = null; await setAdminLang('en'); }
});

// ── Legacy / hidden / deleted ───────────────────────────────────────
test('legacy: >3 featured with NULL order — nothing unfeatured, deterministic, clearly flagged', async () => {
  H.db.reset('featuredLegacy');
  await openItems();
  assert.deepEqual(await featuredIds(), ['pep', 'mar', 'las', 'alf', 'bol'], 'catalog-order fallback');
  assert.equal(await page.$eval('#featured-legacy', (e) => e.hidden), false);
  assert.equal(await page.$eval('#featured-list li[data-fid="las"] .featured-note', (e) => e.textContent), 'Hidden — not shown on the homepage');
  assert.equal(await page.$eval('#featured-list li[data-fid="bol"] .featured-note', (e) => e.textContent), 'Over the limit — not shown on the homepage');
  assert.equal(await page.$$eval('#featured-list li[data-fid="alf"] .featured-note', (e) => e.length), 0, 'alf IS shown (hidden las is skipped)');
  assert.equal(await page.$eval('#featured-add-btn', (b) => b.disabled), true);
  assert.deepEqual((await homepage()).featured, ['Pepperoni', 'Margherita', 'Chicken Alfredo']);
  assert.equal(H.db.tables.products.filter((p) => p.featured).length, 5, 'no data silently unfeatured');

  // Drag the over-limit item into the top 3 → it becomes visible, positions get real values.
  await mouseDrag('#featured-list li[data-fid="bol"] [data-role="fdrag"]', '#featured-list li[data-fid="pep"]');
  await until(() => prod('bol').featured_order === 0, 4000, 'legacy reorder');
  assert.deepEqual((await homepage()).featured, ['Bolognese', 'Pepperoni', 'Margherita']);
  // Removing extras clears the warning.
  await page.click('#featured-list li[data-fid="las"] [data-role="fremove"]');
  await until(() => prod('las').featured === false, 4000, 'rm las');
  await page.click('#featured-list li[data-fid="alf"] [data-role="fremove"]');
  await until(async () => page.$eval('#featured-legacy', (e) => e.hidden), 4000, 'warning cleared');
});

test('hidden + deleted featured products: skipped publicly, list compacts', async () => {
  H.db.reset('featured');
  await openItems();
  await page.click('tr[data-id="alf"] .btn-toggle');
  await until(() => prod('alf').available === false, 4000, 'hidden');
  await until(async () => (await page.$$eval('#featured-list li[data-fid="alf"] .featured-note', (e) => e.map((x) => x.textContent))).join() === 'Hidden — not shown on the homepage', 4000, 'hidden note');
  assert.equal(prod('alf').featured, true, 'hiding does not unfeature');
  assert.deepEqual((await homepage()).featured, ['Taste The West Special', 'BBQ Ranch Chicken']);

  await page.click('tr[data-id="ttw"] .btn-delete');
  await page.click('#confirm-ok');
  await until(async () => (await featuredIds()).join() === 'alf,bbq', 4000, 'deleted compacts');
  assert.deepEqual(await slotLabels(), ['Featured #1', 'Featured #2', 'Featured #3']);
  assert.deepEqual((await homepage()).featured, ['BBQ Ranch Chicken']);
});

// ── I. Admin language ───────────────────────────────────────────────
test('I. Featured card is translated in EN and Arabic; layout unchanged', async () => {
  H.db.reset('featured');
  await setAdminLang('en');
  await openItems();
  assert.equal(await page.$eval('#featured-card .acard-title', (e) => e.textContent), 'Homepage Featured');
  assert.equal(await page.$eval('#featured-add-btn', (e) => e.textContent), 'Add to Featured');
  assert.equal(await page.$eval('#featured-list li[data-fid="ttw"] [data-role="fremove"]', (e) => e.getAttribute('aria-label')), 'Remove from Featured');
  await page.click('[data-ui-lang="ar"]');
  assert.equal(await page.$eval('#featured-card .acard-title', (e) => e.textContent), 'الأصناف المميّزة في الصفحة الرئيسية');
  assert.deepEqual(await slotLabels(), ['المميّز #1', 'المميّز #2', 'المميّز #3']);
  assert.equal(await page.$eval('#featured-list li[data-fid="ttw"] [data-role="fremove"]', (e) => e.getAttribute('aria-label')), 'إزالة من المميّزة');
  assert.equal(await page.$eval('#featured-list li[data-fid="ttw"] [data-role="fup"]', (e) => e.getAttribute('aria-label')), 'نقل للأعلى');
  assert.equal(await page.$eval('#featured-full', (e) => e.textContent), 'الحد الأقصى 3 أصناف مميّزة. أزل صنفاً قبل إضافة صنف آخر.');
  const ed = await page.$eval('.admin-shell__editor', (e) => e.getBoundingClientRect().right);
  const pv = await page.$eval('.admin-shell__preview', (e) => e.getBoundingClientRect().left);
  assert.ok(pv >= ed - 1, 'Live Preview stays right');
  const bad = await page.$$eval('#featured-card *', (els) => {
    const c = document.querySelector('#featured-card').getBoundingClientRect();
    return els.filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.right > c.right + 1 || r.left < c.left - 1); }).map((e) => e.className || e.tagName);
  });
  assert.deepEqual(bad, [], 'nothing overflows the card');
  await setAdminLang('en');
});

test('no uncaught page errors; no unexpected REST writes', () => {
  assert.deepEqual(H.pageErrors, []);
  assert.deepEqual(H.netWrites, []);
});
