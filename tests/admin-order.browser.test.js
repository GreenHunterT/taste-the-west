// Drag-to-reorder categories + menu items (milestone 1U) — real-browser tests.
//
// Same offline harness as the 1T tests (tests/fixtures/harness.js): the fake
// database persists across reloads and feeds both the Admin and the public
// pages, and mocked REST rows come back in INSERTION order, so every order
// asserted below is produced by the app's own sorting.
//
//   NODE_PATH=<dir with playwright-core>/node_modules node --test tests/admin-order.browser.test.js
'use strict';

const test = require('node:test');
const { before, after } = test;
const assert = require('node:assert/strict');
const { startHarness } = require('./fixtures/harness');

let H, page, base;

before(async () => {
  H = await startHarness();
  ({ page, base } = H);
});
after(async () => { if (H) await H.stop(); });

// ── helpers ─────────────────────────────────────────────────────────
async function until(fn, ms, what) {
  const end = Date.now() + (ms || 4000);
  let last;
  while (Date.now() < end) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error('timed out waiting for ' + (what || 'condition') + ' (last: ' + JSON.stringify(last) + ')');
}
function num(v) { return (typeof v === 'number') ? v : Infinity; }
function dbCatOrder() {
  return H.db.tables.categories.slice()
    .sort((a, b) => num(a.sort_order) - num(b.sort_order) || (a.created_at < b.created_at ? -1 : 1)).map((c) => c.id);
}
function dbItemOrder(catId) {
  return H.db.tables.products.filter((p) => p.category_id === catId).slice()
    .sort((a, b) => num(a.sort_order) - num(b.sort_order) || (a.created_at < b.created_at ? -1 : 1)).map((p) => p.id);
}
function sortSnapshot() { return JSON.stringify(H.db.tables.products.map((p) => [p.id, p.category_id, p.sort_order])); }
async function setAdminLang(l) {
  await page.goto(base + '/__blank');
  await page.evaluate((v) => localStorage.setItem('ttw_admin_ui', JSON.stringify({ adminLang: v, lang: 'en', page: 'menu' })), l);
}
// Always a REAL reload (via a blank page): goto() to the same URL + hash is
// only a same-document hash change and would keep stale in-memory view state.
async function openItems() {
  await page.goto(base + '/__blank');
  await page.goto(base + '/admin/index.html#menu&section=items');
  await page.waitForSelector('#products-table-wrap tr[data-id] [data-role="drag"]:not([disabled])');
}
async function openCats() {
  await page.goto(base + '/__blank');
  await page.goto(base + '/admin/index.html#menu&section=categories');
  await page.waitForSelector('#cat-list li[data-id] [data-role="drag"]:not([disabled])');
}
const itemRows = () => page.$$eval('#products-table-wrap tr[data-id]', (r) => r.map((x) => x.dataset.id));
const catRows = () => page.$$eval('#cat-list li[data-id]', (r) => r.map((x) => x.dataset.id));
async function mouseDrag(fromHandle, toRow, where) {
  // Bring the pair on screen first (content above the table can push it down).
  await page.locator(toRow).evaluate((e) => e.scrollIntoView({ block: 'center' }));
  const a = await page.locator(fromHandle).boundingBox();
  const b = await page.locator(toRow).boundingBox();
  const x = a.x + a.width / 2;
  await page.mouse.move(x, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, where === 'after' ? b.y + b.height - 3 : b.y + 3, { steps: 10 });
  await page.mouse.up();
}
// The public pages, visited directly (not the preview), in English.
async function publicCatalog() {
  const p = await H.context.newPage();
  await p.goto(base + '/__blank');
  await p.evaluate(() => localStorage.setItem('souqsite_language', 'en'));
  await p.goto(base + '/products.html');
  await p.waitForSelector('#products-grid .product-name');
  const out = {
    items: await p.$$eval('#products-grid .product-name', (e) => e.map((x) => x.textContent.trim())),
    tabs: await p.$$eval('#filter-bar .filter-btn', (e) => e.map((x) => x.textContent.trim()).slice(1)),
  };
  await p.goto(base + '/index.html');
  await p.waitForSelector('#featured-grid .product-name');
  out.featured = await p.$$eval('#featured-grid .product-name', (e) => e.map((x) => x.textContent.trim()));
  await p.close();
  return out;
}
const previewItems = () => page.frameLocator('iframe.preview-frame.is-active').locator('#products-grid .product-name').allTextContents();
const previewTabs = () => page.frameLocator('iframe.preview-frame.is-active').locator('#filter-bar .filter-btn').allTextContents();

// ── Baseline ────────────────────────────────────────────────────────
test('baseline: Admin + public render the deterministic order (ties, NULL, hidden item)', async () => {
  H.db.reset('order');
  await setAdminLang('en');
  await openItems();
  assert.deepEqual(await itemRows(), ['pep', 'mar', 'hid', 'ttw', 'alf', 'bol', 'lem', 'col']);
  assert.deepEqual(await page.$$eval('.menu-group-row strong', (e) => e.map((x) => x.textContent)), ['Pizza', 'Pasta', 'Drinks']);
  const pub = await publicCatalog();
  assert.deepEqual(pub.tabs, ['Pizza', 'Pasta', 'Drinks']);
  assert.deepEqual(pub.items, ['Pepperoni', 'Margherita', 'Taste The West Special', 'Alfredo', 'Bolognese', 'Lemon Mint', 'Cola']);
  assert.deepEqual(pub.featured, ['Pepperoni', 'Margherita', 'Taste The West Special']);
});

// ── A. Categories ───────────────────────────────────────────────────
test('A1. drag a category (mouse) → persisted, survives reload, public + Live Preview follow', async () => {
  H.db.reset('order');
  await openCats();
  const w0 = H.db.writes.length;
  await mouseDrag('#cat-list li[data-id="c3"] [data-role="drag"]', '#cat-list li[data-id="c1"]', 'before');
  assert.deepEqual(await catRows(), ['c3', 'c1', 'c2']);
  await until(() => dbCatOrder().join() === 'c3,c1,c2', 4000, 'db category order');
  assert.ok(H.db.writes.slice(w0).every((w) => w.table === 'categories' && w.op === 'update' && Object.keys(w.payload).join() === 'sort_order'));
  await until(async () => (await previewTabs()).slice(1).join() === 'Drinks,Pizza,Pasta', 6000, 'preview tabs');

  await openCats();
  assert.deepEqual(await catRows(), ['c3', 'c1', 'c2'], 'reload keeps order');
  const pub = await publicCatalog();
  assert.deepEqual(pub.tabs, ['Drinks', 'Pizza', 'Pasta']);
  assert.deepEqual(pub.items.slice(0, 2), ['Lemon Mint', 'Cola']);
});

test('A2. category ↑/↓ buttons + keyboard ArrowUp/ArrowDown on the handle', async () => {
  H.db.reset('order');
  await openCats();
  await page.click('#cat-list li[data-id="c1"] [data-role="down"]');
  await until(() => dbCatOrder().join() === 'c2,c1,c3', 4000, 'down');
  assert.deepEqual(await catRows(), ['c2', 'c1', 'c3']);
  await until(() => page.evaluate(() => document.activeElement && document.activeElement.closest('li') && document.activeElement.closest('li').dataset.id === 'c1'), 3000, 'focus kept on moved row');

  await page.focus('#cat-list li[data-id="c3"] [data-role="drag"]');
  await page.keyboard.press('ArrowUp');
  await until(() => dbCatOrder().join() === 'c2,c3,c1', 4000, 'keyboard up');
  assert.deepEqual(await catRows(), ['c2', 'c3', 'c1']);
  assert.equal(await page.$eval('#cat-list li[data-id="c2"] [data-role="up"]', (b) => b.disabled), true, 'first ↑ disabled');
  assert.equal(await page.$eval('#cat-list li[data-id="c1"] [data-role="down"]', (b) => b.disabled), true, 'last ↓ disabled');
});

// ── B. Products ─────────────────────────────────────────────────────
test('B1. drag an item within its category → persisted, others untouched, public/featured/preview follow', async () => {
  H.db.reset('order');
  await openItems();
  const before = H.db.tables.products.filter((p) => p.category_id !== 'c1').map((p) => [p.id, p.sort_order]);
  await mouseDrag('tr[data-id="ttw"] [data-role="drag"]', 'tr[data-id="pep"]', 'before');
  assert.deepEqual((await itemRows()).slice(0, 4), ['ttw', 'pep', 'mar', 'hid']);
  await until(() => dbItemOrder('c1').join() === 'ttw,pep,mar,hid', 4000, 'db item order');
  assert.deepEqual(H.db.tables.products.filter((p) => p.category_id !== 'c1').map((p) => [p.id, p.sort_order]), before, 'other categories untouched (incl. legacy NULL)');
  await until(async () => (await previewItems())[0] === 'Taste The West Special', 6000, 'preview order');

  await openItems();
  assert.deepEqual((await itemRows()).slice(0, 4), ['ttw', 'pep', 'mar', 'hid'], 'reload keeps order');
  const pub = await publicCatalog();
  assert.deepEqual(pub.items.slice(0, 3), ['Taste The West Special', 'Pepperoni', 'Margherita']);
  assert.deepEqual(pub.featured, ['Taste The West Special', 'Pepperoni', 'Margherita'], 'featured = first 3 featured in menu order');
});

test('B2. a drag can never move an item into another category', async () => {
  H.db.reset('order');
  await openItems();
  const snap = sortSnapshot();
  // Drag Lemon Mint (Drinks) up onto Pepperoni (Pizza).
  await mouseDrag('tr[data-id="lem"] [data-role="drag"]', 'tr[data-id="pep"]', 'before');
  await new Promise((r) => setTimeout(r, 400));
  const rows = await itemRows();
  assert.deepEqual(rows.slice(0, 4), ['pep', 'mar', 'hid', 'ttw'], 'Pizza group unchanged');
  assert.ok(rows.indexOf('lem') > rows.indexOf('bol'), 'Lemon Mint still inside Drinks');
  assert.equal(H.db.tables.products.find((p) => p.id === 'lem').category_id, 'c3');
  assert.ok(!H.db.writes.some((w) => w.payload && 'category_id' in w.payload && w.op === 'update'), 'no category change written');
  // At most a within-Drinks reorder (it is already first there → no write).
  assert.equal(sortSnapshot(), snap);
});

test('B3. item ↑/↓ + keyboard; bounds disabled per category', async () => {
  H.db.reset('order');
  await openItems();
  assert.equal(await page.$eval('tr[data-id="pep"] [data-role="up"]', (b) => b.disabled), true);
  assert.equal(await page.$eval('tr[data-id="ttw"] [data-role="down"]', (b) => b.disabled), true, 'last in Pizza');
  assert.equal(await page.$eval('tr[data-id="alf"] [data-role="up"]', (b) => b.disabled), true, 'first in Pasta');
  await page.click('tr[data-id="pep"] [data-role="down"]');
  await until(() => dbItemOrder('c1').join() === 'mar,pep,hid,ttw', 4000, 'down');
  await page.focus('tr[data-id="col"] [data-role="drag"]');
  await page.keyboard.press('ArrowUp');
  await until(() => dbItemOrder('c3').join() === 'col,lem', 4000, 'keyboard up');
  // Legacy NULL item gets a real position once its group is reordered.
  await page.click('tr[data-id="bol"] [data-role="up"]');
  await until(() => dbItemOrder('c2').join() === 'bol,alf', 4000, 'null item moved');
  assert.deepEqual(H.db.tables.products.filter((p) => p.category_id === 'c2').map((p) => p.sort_order).sort(), [0, 1]);
});

// ── C. Creation / D. category change / deletion ─────────────────────
test('C. new category is appended; new item is appended within its category', async () => {
  H.db.reset('order');
  await openCats();
  await page.fill('#cat-name-en', 'Desserts');
  await page.fill('#cat-name-ar', 'حلويات');
  await page.click('#add-cat-btn');
  await until(async () => (await catRows()).length === 4, 4000, 'new category row');
  assert.equal((await catRows())[3], H.db.tables.categories[3].id, 'appended last');
  assert.equal(H.db.tables.categories[3].sort_order, 3);

  await openItems();
  await page.click('#add-product-btn');
  await page.fill('#p-name-en', 'Iced Tea');
  await page.fill('#p-name-ar', 'شاي مثلج');
  await page.fill('#p-price', '9');
  await page.selectOption('#p-category', 'c3');
  await page.click('#modal-save');
  await until(() => H.db.tables.products.some((p) => p.name_en === 'Iced Tea'), 4000, 'insert');
  const tea = H.db.tables.products.find((p) => p.name_en === 'Iced Tea');
  assert.equal(tea.sort_order, 2);
  await until(async () => (await itemRows()).slice(-1)[0] === tea.id, 4000, 'row appended at end of Drinks');
  assert.equal((await publicCatalog()).items.slice(-1)[0], 'Iced Tea');
  assert.equal(await page.$$eval('#p-sort', (e) => e.length), 0, 'manual Sort Order field replaced by drag / ↑↓');
});

test('D. moving an item to another category lands it at the end of the destination', async () => {
  H.db.reset('order');
  await openItems();
  await page.click('tr[data-id="alf"] .btn-edit');
  await page.waitForSelector('#product-modal.open');
  await page.selectOption('#p-category', 'c3');
  await page.click('#modal-save');
  await until(() => H.db.tables.products.find((p) => p.id === 'alf').category_id === 'c3', 4000, 'moved');
  assert.deepEqual(dbItemOrder('c3'), ['lem', 'col', 'alf']);
  await until(async () => { const r = await itemRows(); return r.indexOf('alf') === r.length - 1; }, 4000, 'admin row at end');
  const pub = await publicCatalog();
  assert.deepEqual(pub.items.slice(-3), ['Lemon Mint', 'Cola', 'Alfredo']);
});

test('D2. delete then reorder; single-item category has no movable controls', async () => {
  H.db.reset('order');
  await openItems();
  await page.click('tr[data-id="mar"] .btn-delete');
  await page.click('#confirm-ok');
  await until(async () => !(await itemRows()).includes('mar'), 4000, 'deleted');
  await mouseDrag('tr[data-id="ttw"] [data-role="drag"]', 'tr[data-id="pep"]', 'before');
  await until(() => dbItemOrder('c1').join() === 'ttw,pep,hid', 4000, 'reorder after delete');
  // Pasta → delete Bolognese → single item: handle + arrows disabled.
  await page.click('tr[data-id="bol"] .btn-delete');
  await page.click('#confirm-ok');
  await until(async () => !(await itemRows()).includes('bol'), 4000, 'deleted bol');
  assert.deepEqual(await page.$$eval('tr[data-id="alf"] button[data-role="drag"], tr[data-id="alf"] button[data-role="up"], tr[data-id="alf"] button[data-role="down"]', (e) => e.map((b) => b.disabled)), [true, true, true]);
});

// ── E. Failure ──────────────────────────────────────────────────────
test('E. failed persistence restores the previous order (UI + DB) with a localized toast', async () => {
  H.db.reset('order');
  await setAdminLang('ar');
  try { await failureScenario(); } finally { H.db.failIf = null; await setAdminLang('en'); }
});
async function failureScenario() {
  await openItems();
  // Only Margherita's move to position 0 fails; Pepperoni's write lands and
  // must be rolled back by the app.
  H.db.failIf = (q) => q.table === 'products' && q.op === 'update' && q.payload.sort_order === 0 &&
    q.filters.some((f) => f[0] === 'id' && f[1] === 'mar');
  await page.click('tr[data-id="pep"] [data-role="down"]');
  await page.waitForSelector('.toast-error');
  assert.match(await page.$eval('.toast-error', (e) => e.textContent), /تعذّر حفظ الترتيب الجديد/);
  H.db.failIf = null;
  await until(async () => (await itemRows()).slice(0, 4).join() === 'pep,mar,hid,ttw', 4000, 'UI restored');
  assert.deepEqual(dbItemOrder('c1'), ['pep', 'mar', 'hid', 'ttw'], 'DB rolled back');
  assert.equal(H.db.tables.products.find((p) => p.id === 'pep').sort_order, 0);

  // Categories too.
  await openCats();
  H.db.failIf = (q) => q.table === 'categories' && q.op === 'update' && q.payload.sort_order === 0 &&
    q.filters.some((f) => f[0] === 'id' && f[1] === 'c2');
  await page.click('#cat-list li[data-id="c1"] [data-role="down"]');
  await page.waitForSelector('.toast-error');
  H.db.failIf = null;
  await until(async () => (await catRows()).join() === 'c1,c2,c3', 4000, 'categories restored');
  assert.deepEqual(dbCatOrder(), ['c1', 'c2', 'c3']);
}

// ── F. Filters / search ─────────────────────────────────────────────
test('F. search pauses reordering; category filter reorders the complete category safely', async () => {
  H.db.reset('order');
  await openItems();
  const snap = sortSnapshot();
  await page.fill('#table-search', 'Pep');
  assert.equal(await page.$eval('#menu-reorder-hint', (e) => e.textContent), 'Clear the search to reorder items.');
  assert.ok(await page.$$eval('#products-table-wrap [data-role]', (e) => e.length && e.every((b) => b.disabled)), 'all reorder controls disabled');
  await page.focus('tr[data-id="pep"] [data-role="drag"]').catch(() => {});
  await page.keyboard.press('ArrowDown');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(sortSnapshot(), snap, 'nothing written while searching');

  await page.fill('#table-search', '');
  await page.selectOption('#cat-filter', 'c1');
  assert.deepEqual(await itemRows(), ['pep', 'mar', 'hid', 'ttw'], 'filter shows the full category incl. hidden item');
  await mouseDrag('tr[data-id="hid"] [data-role="drag"]', 'tr[data-id="pep"]', 'before');
  await until(() => dbItemOrder('c1').join() === 'hid,pep,mar,ttw', 4000, 'filtered reorder');
  assert.deepEqual(dbItemOrder('c2'), ['alf', 'bol']);
  assert.deepEqual(dbItemOrder('c3'), ['lem', 'col']);
  // Hidden (unavailable) item keeps its place but stays off the public site.
  assert.deepEqual((await publicCatalog()).items.slice(0, 3), ['Pepperoni', 'Margherita', 'Taste The West Special']);
});

// ── G. Admin language ───────────────────────────────────────────────
test('G. reorder controls are translated in EN and Arabic; layout unchanged', async () => {
  H.db.reset('order');
  await setAdminLang('en');
  await openItems();
  assert.equal(await page.$eval('tr[data-id="pep"] [data-role="drag"]', (b) => b.getAttribute('aria-label')), 'Drag to reorder');
  assert.equal(await page.$eval('tr[data-id="pep"] [data-role="down"]', (b) => b.getAttribute('aria-label')), 'Move down');
  await page.click('[data-ui-lang="ar"]');
  assert.equal(await page.$eval('tr[data-id="pep"] [data-role="drag"]', (b) => b.getAttribute('aria-label')), 'اسحب لإعادة الترتيب');
  assert.equal(await page.$eval('tr[data-id="pep"] [data-role="down"]', (b) => b.getAttribute('aria-label')), 'نقل للأسفل');
  assert.equal(await page.$eval('#menu-reorder-hint', (e) => e.textContent), 'اسحب ⠿ أو استخدم ↑ ↓ لإعادة ترتيب الأصناف داخل فئتها.');
  const ed = await page.$eval('.admin-shell__editor', (e) => e.getBoundingClientRect().right);
  const pv = await page.$eval('.admin-shell__preview', (e) => e.getBoundingClientRect().left);
  assert.ok(pv >= ed - 1, 'Live Preview stays right of the editor');
  // Arabic mode still reorders correctly.
  await page.click('tr[data-id="pep"] [data-role="down"]');
  await until(() => dbItemOrder('c1').join() === 'mar,pep,hid,ttw', 4000, 'arabic reorder');
  await page.waitForFunction(() => [...document.querySelectorAll('.toast-success')].some((e) => /تم حفظ الترتيب/.test(e.textContent)));
  await openCats();
  assert.equal(await page.$eval('#cat-list li[data-id="c1"] [data-role="drag"]', (b) => b.getAttribute('title')), 'اسحب لإعادة الترتيب');
  await setAdminLang('en');
});

// ── Touch / narrow layout ───────────────────────────────────────────
test('Touch: drag a category and an item with real touch events on a phone-sized Admin', async () => {
  H.db.reset('order');
  const ctx = await H.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  async function touchDrag(fromSel, toSel) {
    await p.locator(fromSel).scrollIntoViewIfNeeded();
    const a = await p.locator(fromSel).boundingBox();
    const b = await p.locator(toSel).boundingBox();
    const x = a.x + a.width / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: a.y + a.height / 2 }] });
    const ty = b.y + 3;
    for (let i = 1; i <= 10; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: a.y + a.height / 2 + (ty - a.y - a.height / 2) * i / 10 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  await p.goto(base + '/admin/index.html#menu&section=categories');
  await p.waitForSelector('#cat-list li[data-id] [data-role="drag"]:not([disabled])');
  // A native scroll taking over the gesture would fire pointercancel (→ no
  // drop); a persisted reorder proves the handle owned the touch drag.
  await touchDrag('#cat-list li[data-id="c3"] [data-role="drag"]', '#cat-list li[data-id="c1"]');
  await until(() => dbCatOrder().join() === 'c3,c1,c2', 4000, 'touch category');

  await p.goto(base + '/admin/index.html#menu&section=items');
  await p.waitForSelector('#products-table-wrap tr[data-id] [data-role="drag"]:not([disabled])');
  await touchDrag('tr[data-id="col"] [data-role="drag"]', 'tr[data-id="lem"]');
  await until(() => dbItemOrder('c3').join() === 'col,lem', 4000, 'touch item');
  await ctx.close();
});

test('Touch: category list fits the phone layout (no handle/actions overflow)', async () => {
  const ctx = await H.newContext({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  for (const l of ['en', 'ar']) {
    await p.goto(base + '/__blank');
    await p.evaluate((v) => localStorage.setItem('ttw_admin_ui', JSON.stringify({ adminLang: v })), l);
    await p.goto(base + '/admin/index.html#menu&section=categories');
    await p.waitForSelector('#cat-list li[data-id]');
    const bad = await p.$$eval('#cat-list li.cat-item', (lis) => lis.flatMap((li) => {
      const r = li.getBoundingClientRect();
      return [...li.querySelectorAll('button')].filter((b) => { const q = b.getBoundingClientRect(); return q.right > r.right + 1 || q.left < r.left - 1; }).map((b) => b.textContent);
    }));
    assert.deepEqual(bad, [], l);
  }
  await ctx.close();
});

test('no uncaught page errors during the whole run; no unexpected REST writes', () => {
  assert.deepEqual(H.pageErrors, []);
  assert.deepEqual(H.netWrites, []);
});
