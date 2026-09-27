// Admin interface i18n (milestone 1T) — real-browser integration tests.
//
// Drives the real admin/index.html in headless Chrome against an offline
// fake Supabase (tests/fixtures/harness.js + fake-supabase.js + mocked REST), so it never
// touches the live project. Every DB write (client or REST) is recorded, which
// is how "switching language never writes" is proven.
//
// Requires playwright-core (not a project dependency — the site has no build
// step). Run from any folder that has it installed:
//   npm i playwright-core            # e.g. in a scratch dir
//   NODE_PATH=<that dir>/node_modules node --test tests/admin-i18n.browser.test.js
// Optional: CHROME_PATH=<chrome.exe>, SHOT_DIR=<folder> (saves screenshots).
'use strict';

const test = require('node:test');
const { before, after } = test;
const assert = require('node:assert/strict');
const path = require('node:path');
const { startHarness } = require('./fixtures/harness');

const SHOT_DIR = process.env.SHOT_DIR || '';

let H, page, base, netWrites, pageErrors;

before(async () => {
  H = await startHarness();
  ({ page, base, netWrites, pageErrors } = H);
});

after(async () => { if (H) await H.stop(); });

// ── helpers ─────────────────────────────────────────────────────────
async function openSettings() {
  await page.goto(base + '/admin/index.html#settings');
  await page.waitForFunction(() => {
    const el = document.querySelector('#name_en');
    return el && el.value === 'Taste The West';
  });
}
async function openMenu() {
  await page.goto(base + '/admin/index.html#menu&section=items');
  await page.waitForSelector('#products-table-wrap tbody tr');
}
const adminLang = () => page.evaluate(() => document.documentElement.getAttribute('data-admin-lang'));
const previewLang = () => page.evaluate(() => document.querySelector('.lp-seg__btn[data-lang].is-active').dataset.lang);
const writeCount = () => page.evaluate(() => window.__writes.length).then((n) => n + netWrites.length);
const text = (sel) => page.$eval(sel, (e) => e.textContent.trim());
const cardTitles = () => page.$$eval('#admin-view .acard-title', (els) => els.map((e) => e.textContent.trim()));
const labelFor = (id) => page.$eval('label[for="' + id + '"]', (e) => e.textContent.replace(/\s+/g, ' ').replace(/\s*\*\s*$/, '').trim());
function formSnapshot() {
  return page.$$eval('#admin-view input, #admin-view textarea, #admin-view select', (els) =>
    els.map((e) => [e.id || e.name || e.dataset.role, e.type === 'checkbox' ? e.checked : e.value]));
}
function rect(sel) { return page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, w: r.width }; }); }
async function setAdminLang(l) { await page.click('[data-ui-lang="' + l + '"]'); }
async function resetStorage() {
  await page.goto(base + '/__blank');
  await page.evaluate(() => localStorage.clear());
}

// ── A. English Admin mode ───────────────────────────────────────────
test('A. English Admin: English chrome, Arabic content fields still visible, preview untouched', async () => {
  await resetStorage();
  await openSettings();
  assert.equal(await adminLang(), 'en');
  assert.deepEqual((await cardTitles()).slice(0, 5), ['Identity', 'Contact', 'Opening Hours', 'Location', 'Images']);
  assert.ok((await cardTitles()).includes('Page Transition'));
  assert.ok((await cardTitles()).includes('Homepage Statistics'));
  assert.equal(await labelFor('hours_weekdays_en'), 'Weekdays (English)');
  assert.equal(await labelFor('hours_weekdays_ar'), 'Weekdays (Arabic)');
  assert.equal(await text('#save-btn'), 'Save Changes');
  assert.equal(await text('[data-transition-style="portal"]'), 'Portal Waves');
  // No simultaneous EN+AR Admin wording anywhere in the editor chrome.
  const arabicInChrome = await page.$$eval('#admin-view [data-i18n]', (els) =>
    els.filter((e) => /[\u0600-\u06FF]/.test(e.textContent)).map((e) => e.textContent.trim()));
  assert.deepEqual(arabicInChrome, []);
  for (const id of ['name_ar', 'tagline_ar', 'description_ar', 'hours_weekdays_ar', 'catalog_label_ar', 'address_ar']) {
    assert.ok(await page.isVisible('#' + id), id + ' visible');
  }
  assert.equal(await page.inputValue('#name_ar'), 'تيست ذا ويست');
  assert.equal(await previewLang(), 'en');
});

// ── B. Arabic Admin mode ────────────────────────────────────────────
test('B. Arabic Admin: Arabic chrome, English fields visible, RTL text, layout fixed, no dirty/no writes', async () => {
  await openSettings();
  const before = await formSnapshot();
  const writesBefore = await writeCount();
  const edBefore = await rect('.admin-shell__editor');
  const pvBefore = await rect('.admin-shell__preview');

  await setAdminLang('ar');
  assert.equal(await adminLang(), 'ar');

  const titles = await cardTitles();
  assert.deepEqual(titles.slice(0, 5), ['الهوية', 'معلومات التواصل', 'ساعات العمل', 'الموقع', 'الصور']);
  assert.ok(titles.includes('انتقال الصفحات'));
  assert.ok(titles.includes('إحصائيات الصفحة الرئيسية'));
  assert.equal(await labelFor('hours_weekdays_en'), 'أيام الأسبوع (الإنجليزية)');
  assert.equal(await labelFor('hours_weekdays_ar'), 'أيام الأسبوع (العربية)');
  assert.equal(await labelFor('hours_weekends_en'), 'عطلة نهاية الأسبوع (الإنجليزية)');
  assert.equal(await labelFor('name_en'), 'الاسم (الإنجليزية)');
  assert.equal(await text('#save-btn'), 'حفظ التغييرات');
  assert.equal(await text('[data-transition-style="portal"]'), 'أمواج البوابة');
  assert.equal(await text('.admin-navlink[data-route="settings"]'), 'الإعدادات');
  assert.equal(await text('.live-preview__title'), 'المعاينة المباشرة');
  assert.equal(await text('.stat-card-ed__title'), 'الإحصائية 1');
  // Only ONE language shown: no leftover English in translated chrome.
  const englishLeft = await page.$$eval('#admin-view [data-i18n]', (els) =>
    els.filter((e) => e.offsetParent !== null && /[A-Za-z]{4,}/.test(e.textContent.replace(/JPG|PNG|WebP|Google|Portal|src|WhatsApp|HTML/g, '')))
      .map((e) => e.getAttribute('data-i18n') + ': ' + e.textContent.trim()));
  assert.deepEqual(englishLeft, []);

  // English business fields remain visible and untouched.
  for (const id of ['name_en', 'tagline_en', 'description_en', 'hours_weekdays_en', 'hours_weekends_en', 'catalog_label_en', 'address_en']) {
    assert.ok(await page.isVisible('#' + id), id + ' visible');
  }
  assert.deepEqual(await formSnapshot(), before, 'no field value changed');

  // Direction: Arabic UI text is RTL; the document + content inputs are not flipped.
  const dirs = await page.evaluate(() => {
    const cs = (sel) => getComputedStyle(document.querySelector(sel)).direction;
    return {
      htmlDirAttr: document.documentElement.getAttribute('dir'),
      body: getComputedStyle(document.body).direction,
      shell: cs('.admin-shell__main'),
      label: cs('label[for="hours_weekdays_en"]'),
      title: cs('.acard-title'),
      hint: cs('.settings-view__hint'),
      enInput: cs('#name_en'),
      arInput: cs('#name_ar'),
      labelAlign: getComputedStyle(document.querySelector('label[for="name_en"]')).textAlign,
      titleSpacing: getComputedStyle(document.querySelector('.acard-title')).letterSpacing,
    };
  });
  assert.equal(dirs.htmlDirAttr, null);
  assert.equal(dirs.body, 'ltr');
  assert.equal(dirs.shell, 'ltr');
  assert.equal(dirs.label, 'rtl');
  assert.equal(dirs.title, 'rtl');
  assert.equal(dirs.hint, 'rtl');
  assert.equal(dirs.enInput, 'ltr');
  assert.equal(dirs.arInput, 'rtl');
  assert.match(dirs.labelAlign, /start|right/);
  assert.ok(dirs.titleSpacing === 'normal' || dirs.titleSpacing === '0px', 'no letter-spacing on Arabic: ' + dirs.titleSpacing);

  // Dashboard geometry identical: settings left, Live Preview right.
  const edAfter = await rect('.admin-shell__editor');
  const pvAfter = await rect('.admin-shell__preview');
  assert.deepEqual(edAfter, edBefore);
  assert.deepEqual(pvAfter, pvBefore);
  assert.ok(pvAfter.l >= edAfter.r - 1, 'preview stays to the right of the editor');

  // State safety.
  assert.equal(await page.$eval('#stats-dirty', (e) => e.classList.contains('is-clean')), true);
  assert.equal(await text('#stats-dirty'), '✓ تم حفظ جميع التغييرات');
  assert.equal(await writeCount(), writesBefore, 'no DB write');
  assert.equal(await previewLang(), 'en', 'preview language unaffected');
});

// ── C. Persistence ──────────────────────────────────────────────────
test('C. Persistence: Arabic survives a reload; stored separately from the preview language', async () => {
  await openSettings();
  assert.equal(await adminLang(), 'ar');
  assert.equal(await text('.admin-navlink[data-route="menu"]'), 'القائمة');
  assert.equal(await page.$eval('[data-ui-lang="ar"]', (e) => e.getAttribute('aria-pressed')), 'true');
  assert.equal(await page.$eval('[data-ui-lang="en"]', (e) => e.getAttribute('aria-pressed')), 'false');
  const blob = await page.evaluate(() => JSON.parse(localStorage.getItem('ttw_admin_ui')));
  assert.equal(blob.adminLang, 'ar');
  assert.notEqual(blob.lang, 'ar');
});

// ── D. Independence ─────────────────────────────────────────────────
test('D. Independence: Admin AR + Preview EN, Admin EN + Preview AR', async () => {
  await openSettings();
  assert.equal(await adminLang(), 'ar');
  assert.equal(await previewLang(), 'en');                       // Admin AR + Preview EN

  await page.click('.lp-seg__btn[data-lang="ar"]');
  assert.equal(await previewLang(), 'ar');
  assert.equal(await adminLang(), 'ar', 'preview switch leaves Admin language');

  await setAdminLang('en');                                        // Admin EN + Preview AR
  assert.equal(await adminLang(), 'en');
  assert.equal(await previewLang(), 'ar', 'Admin switch leaves preview language');
  assert.equal(await text('.lp-seg__btn[data-lang="en"]'), 'English');

  await setAdminLang('ar');
  assert.equal(await text('.lp-seg__btn[data-lang="en"]'), 'الإنجليزية');
  assert.equal(await previewLang(), 'ar');

  await page.click('.lp-seg__btn[data-lang="en"]');
  const blob = await page.evaluate(() => JSON.parse(localStorage.getItem('ttw_admin_ui')));
  assert.equal(blob.lang, 'en');
  assert.equal(blob.adminLang, 'ar');
});

// ── E. State safety with unsaved edits ──────────────────────────────
test('E. Switching language keeps drafts + dirty state exactly; guard dialog is localized', async () => {
  await openSettings();
  const writesBefore = await writeCount();
  await page.fill('#name_en', 'Taste The West X');
  await page.fill('#hours_weekdays_ar', 'تجربة');
  assert.equal(await page.$eval('#stats-dirty', (e) => e.classList.contains('is-dirty')), true);
  const snap = await formSnapshot();

  await setAdminLang('en');
  assert.deepEqual(await formSnapshot(), snap);
  assert.equal(await text('#stats-dirty'), '● Unsaved changes');
  await setAdminLang('ar');
  assert.deepEqual(await formSnapshot(), snap);
  assert.equal(await text('#stats-dirty'), '● تغييرات غير محفوظة');

  // Dirty guard still fires, in Arabic.
  await page.click('.admin-navlink[data-route="menu"]');
  await page.waitForSelector('#admin-dirty-dialog[open]');
  assert.equal(await text('#admin-dirty-title'), 'تغييرات غير محفوظة');
  assert.equal(await text('[data-dirty-stay]'), 'البقاء');
  await page.click('[data-dirty-stay]');
  await page.waitForFunction(() => !document.querySelector('#admin-dirty-dialog').open);
  assert.equal(await page.inputValue('#name_en'), 'Taste The West X', 'Stay keeps the draft');

  // Restore → clean again; still no writes.
  await page.fill('#name_en', 'Taste The West');
  await page.fill('#hours_weekdays_ar', '١٢ ظهراً – ١٢ ليلاً');
  assert.equal(await page.$eval('#stats-dirty', (e) => e.classList.contains('is-clean')), true);
  assert.equal(await writeCount(), writesBefore);
});

// ── Settings regression: stats, transition demo, save ───────────────
test('Settings regression: stat cards, transition demo badge, and Save still work in Arabic', async () => {
  await openSettings();
  await page.click('#stats-add');
  assert.equal(await page.$$eval('.stat-card-ed', (e) => e.length), 3);
  assert.equal(await page.$eval('.stat-card-ed:nth-child(3) .stat-card-ed__title', (e) => e.textContent), 'الإحصائية 3');
  await page.selectOption('.stat-card-ed:nth-child(1) select[data-role="type"]', 'plus');
  assert.match(await text('.stat-card-ed:nth-child(1) [data-role="summary"]'), /^رقم مع \+ · /);
  await setAdminLang('en');
  assert.match(await text('.stat-card-ed:nth-child(1) [data-role="summary"]'), /^Number with \+ · /);
  assert.equal(await page.$eval('.stat-card-ed:nth-child(1) select[data-role="type"]', (e) => e.value), 'plus');
  await setAdminLang('ar');

  await page.click('#transition-preview-btn');
  await page.waitForFunction(() => document.querySelector('#lp-transition-demo-badge').textContent.trim() !== '');
  assert.equal(await text('#lp-transition-demo-badge'), 'أمواج البوابة');
  await setAdminLang('en');
  assert.equal(await text('#lp-transition-demo-badge'), 'Portal Waves');
  await setAdminLang('ar');

  const w0 = await page.evaluate(() => window.__writes.length);
  await page.click('#save-btn');
  await page.waitForFunction((n) => window.__writes.length > n, w0);
  const last = await page.evaluate(() => window.__writes[window.__writes.length - 1]);
  assert.equal(last.table, 'restaurants');
  assert.equal(last.op, 'update');
  assert.equal(last.payload.highlights.length, 3);
  await page.waitForFunction(() => [...document.querySelectorAll('.toast span:last-child')].some((e) => /تم حفظ الإعدادات بنجاح/.test(e.textContent)));
  assert.equal(await page.$eval('#save-btn-bottom', (e) => e.textContent.trim()), 'حفظ التغييرات');
});

// ── Menu regression ─────────────────────────────────────────────────
test('Menu regression: table, add/edit/delete/availability and categories in Arabic', async () => {
  await openMenu();
  assert.equal(await adminLang(), 'ar');
  assert.deepEqual(await page.$$eval('.data-table th', (e) => e.map((x) => x.textContent.trim()).filter(Boolean)),
    ['الاسم', 'السعر', 'الحالة', 'الإجراءات']);
  assert.equal(await text('.menu-tab[data-section="items"]'), 'أصناف القائمة');
  // Business data shown as-is (both names).
  assert.match(await text('tr[data-id="p1"] .product-name-cell'), /Classic Margherita.*مارغريتا كلاسيك/);

  // Edit modal: both language fields; switching Admin language keeps values and stays clean.
  await page.click('tr[data-id="p1"] .btn-edit');
  await page.waitForSelector('#product-modal.open');
  assert.equal(await text('#modal-title'), 'تعديل صنف');
  assert.ok(await page.isVisible('#p-name-en'));
  assert.ok(await page.isVisible('#p-name-ar'));
  const w0 = await writeCount();
  await setAdminLang('en');
  assert.equal(await text('#modal-title'), 'Edit Menu Item');
  assert.equal(await page.inputValue('#p-name-en'), 'Classic Margherita');
  assert.equal(await page.inputValue('#p-price'), '39');
  await setAdminLang('ar');
  assert.equal(await writeCount(), w0);
  // Edit + save → one products update.
  await page.fill('#p-price', '41');
  await page.click('#modal-save');
  await page.waitForFunction(() => window.__writes.some((w) => w.table === 'products' && w.op === 'update' && w.payload.price === '41'));

  // Add → insert.
  await page.click('#add-product-btn');
  await page.waitForSelector('#product-modal.open');
  assert.equal(await text('#modal-title'), 'إضافة صنف');
  await page.fill('#p-name-en', 'Test Pie');
  await page.fill('#p-name-ar', 'فطيرة');
  await page.fill('#p-price', '20');
  await page.selectOption('#p-category', 'c1');
  await page.click('#modal-save');
  await page.waitForFunction(() => window.__writes.some((w) => w.table === 'products' && w.op === 'insert' && w.payload.name_en === 'Test Pie'));

  // Availability toggle → update.
  await page.waitForSelector('tr[data-id="p1"] .btn-toggle');
  assert.equal(await page.$eval('tr[data-id="p1"] .btn-toggle', (e) => e.textContent.trim()), 'إخفاء');
  await page.click('tr[data-id="p1"] .btn-toggle');
  await page.waitForFunction(() => window.__writes.some((w) => w.table === 'products' && w.op === 'update' && w.payload.available === false));

  // Delete → localized confirm with the item name, then delete.
  await page.waitForSelector('tr[data-id="p2"] .btn-delete');
  await page.click('tr[data-id="p2"] .btn-delete');
  await page.waitForSelector('#confirm-modal.open');
  assert.equal(await text('#confirm-msg'), 'سيُحذف «Lemon Mint» من قائمتك نهائياً. لا يمكن التراجع عن ذلك.');
  await page.click('#confirm-ok');
  await page.waitForFunction(() => window.__writes.some((w) => w.table === 'products' && w.op === 'delete'));

  // Categories tab.
  await page.click('.menu-tab[data-section="categories"]');
  await page.waitForSelector('.cat-item');
  assert.equal(await text('.categories-view .admin-page-title'), 'الفئات');
  await page.click('.cat-item [data-role="edit"]');
  assert.deepEqual(await page.$$eval('.cat-item.is-editing label', (e) => e.map((x) => x.textContent)),
    ['اسم الفئة (الإنجليزية)', 'اسم الفئة (العربية)']);
  await page.fill('.cat-item.is-editing [data-role="edit-en"]', 'Pizzas');
  await page.click('.cat-item.is-editing [data-role="cat-save"]');
  await page.waitForFunction(() => window.__writes.some((w) => w.table === 'categories' && w.op === 'update' && w.payload.name_en === 'Pizzas'));
  await page.fill('#cat-name-en', 'Desserts');
  await page.fill('#cat-name-ar', 'حلويات');
  await page.click('#add-cat-btn');
  await page.waitForFunction(() => window.__writes.some((w) => w.table === 'categories' && w.op === 'insert'));
  assert.equal(await text('#add-cat-btn'), 'إضافة فئة');
  assert.deepEqual(netWrites, [], 'no unexpected REST writes');
});

// ── Responsive ──────────────────────────────────────────────────────
test('Responsive: no overflow / overlap in either language from 1440px down to 320px', async () => {
  const widths = [1440, 1180, 1024, 768, 390, 320];
  const problems = [];
  for (const lang of ['en', 'ar']) {
    for (const route of ['settings', 'menu']) {
      for (const w of widths) {
        await page.setViewportSize({ width: w, height: 900 });
        if (route === 'settings') await openSettings(); else await openMenu();
        if ((await adminLang()) !== lang) await setAdminLang(lang);
        const r = await page.evaluate(() => {
          const out = [];
          const de = document.documentElement;
          if (de.scrollWidth > de.clientWidth + 1) out.push('page h-scroll ' + de.scrollWidth + '>' + de.clientWidth);
          const vw = de.clientWidth;
          const bar = document.querySelector('.admin-appbar');
          bar.querySelectorAll('a, button').forEach((b) => {
            const rr = b.getBoundingClientRect();
            if (rr.width && (rr.right > vw + 1 || rr.left < -1)) out.push('appbar item off-screen: ' + b.textContent.trim());
          });
          const lang = document.querySelector('.admin-lang').getBoundingClientRect();
          const nav = [...document.querySelectorAll('.admin-navlink')].map((a) => a.getBoundingClientRect());
          const acts = document.querySelector('.admin-appbar__actions').getBoundingClientRect();
          if (nav.some((n) => n.right > lang.left + 1)) out.push('lang toggle overlaps nav');
          if (lang.right > acts.left + 1) out.push('lang toggle overlaps actions');
          if (bar.getBoundingClientRect().height > 60) out.push('appbar grew: ' + bar.getBoundingClientRect().height);
          document.querySelectorAll('#admin-view .acard').forEach((card) => {
            const cr = card.getBoundingClientRect();
            if (!cr.width) return;
            card.querySelectorAll('label, button, .lp-seg, .acard-title, .field-hint, input, select, textarea').forEach((el) => {
              const er = el.getBoundingClientRect();
              if (!er.width || el.offsetParent === null) return;
              // Pre-existing (before 1T): the products table overflows its card
              // on narrow widths in both languages — out of scope here.
              if (el.closest('#products-table-wrap')) return;
              if (er.right > cr.right + 1 || er.left < cr.left - 1) out.push('overflow in card: ' + (el.id || el.getAttribute('data-i18n') || el.className));
            });
          });
          const ed = document.querySelector('.admin-shell__editor').getBoundingClientRect();
          const pv = document.querySelector('.admin-shell__preview').getBoundingClientRect();
          if (window.matchMedia('(min-width: 1180px)').matches && pv.left < ed.right - 1) out.push('preview not right of editor');
          return out;
        });
        r.forEach((p) => problems.push(`${lang} ${route} ${w}px: ${p}`));
        if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, `${lang}-${route}-${w}.png`) });
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  assert.deepEqual([...new Set(problems)], []);
});

// ── First paint (1T.1) ──────────────────────────────────────────────
// Samples what is actually painted while the (slow) CDN script is still
// loading: whenever the Admin chrome is visible it must already be in the
// saved language — never an English frame first.
async function samplePaint(n, gapMs) {
  const seen = [];
  for (let i = 0; i < n; i++) {
    try {
      seen.push(await page.evaluate(() => {
        const nav = document.querySelector('.admin-navlink[data-route="settings"]');
        if (!nav || !document.body) return 'no-dom';
        const visible = getComputedStyle(document.body).visibility === 'visible';
        return visible ? nav.textContent.trim() : 'hidden';
      }));
    } catch (e) { seen.push('nav'); }
    await new Promise((r) => setTimeout(r, gapMs));
  }
  return seen;
}
async function setStoredAdminLang(l) {
  await page.goto(base + '/__blank');
  await page.evaluate((v) => localStorage.setItem('ttw_admin_ui', JSON.stringify({ adminLang: v, lang: 'en' })), l);
}

test('First paint A: saved Arabic never paints English (slow CDN)', async () => {
  await setStoredAdminLang('ar');
  H.knobs.cdnDelayMs = 1500;
  try {
    await page.goto(base + '/admin/index.html#settings', { waitUntil: 'commit' });
    const seen = await samplePaint(25, 50);
    assert.ok(!seen.includes('Settings'), 'English frame was painted: ' + seen.join(','));
    assert.ok(seen.includes('الإعدادات'), 'Arabic visible while the CDN is still loading: ' + seen.join(','));
  } finally { H.knobs.cdnDelayMs = 0; }
  await page.waitForFunction(() => document.querySelector('#name_en') && document.querySelector('#name_en').value === 'Taste The West');
  assert.equal(await adminLang(), 'ar');
});

test('First paint B: saved English paints English immediately, never hidden', async () => {
  await setStoredAdminLang('en');
  H.knobs.cdnDelayMs = 1500;
  try {
    await page.goto(base + '/admin/index.html#settings', { waitUntil: 'commit' });
    const seen = (await samplePaint(25, 50)).filter((x) => x !== 'no-dom' && x !== 'nav');
    assert.ok(seen.length && seen.every((x) => x === 'Settings'), seen.join(','));
  } finally { H.knobs.cdnDelayMs = 0; }
});

test('First paint fail-safe: Admin becomes visible even if i18n.js fails to load', async () => {
  await setStoredAdminLang('ar');
  H.knobs.blockI18n = true;
  try {
    await page.goto(base + '/admin/index.html#settings', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => getComputedStyle(document.body).visibility === 'visible', null, { timeout: 3000 });
  } finally { H.knobs.blockI18n = false; }
  pageErrors.length = 0;   // the shell is expected to error without i18n.js
  await setStoredAdminLang('en');
});

test('no uncaught page errors during the whole run', () => {
  assert.deepEqual(pageErrors, []);
});
