// Shared offline harness for the Admin browser tests (1T, 1U).
//
// • A static server for the repo root, plus POST /__fake/query — the ONE fake
//   database. tests/fixtures/fake-supabase.js (served in place of the supabase-js
//   CDN bundle) proxies every client query here, and mocked PostgREST GETs
//   (the Menu view's raw fetch + the public pages inside the Live Preview) read
//   the SAME state — so writes survive reloads and reach the public render.
// • Mocked REST rows are returned in INSERTION order (the `order=` param is
//   ignored on purpose): any ordering seen in the UI is the app's own sort.
// • Knobs: db.failIf(fn) makes matching writes fail; cdnDelayMs / blockI18n
//   (1T.1 first-paint tests).
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..', '..');
const FAKE_SUPABASE = fs.readFileSync(path.join(__dirname, 'fake-supabase.js'), 'utf8');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp3': 'audio/mpeg' };

let clock = Date.parse('2026-01-01T00:00:00Z');
function ts() { clock += 1000; return new Date(clock).toISOString(); }

function restaurantRow() {
  return {
    id: 'r1', owner_id: 'u1', updated_at: '2026-01-01T00:00:00Z',
    name_en: 'Taste The West', name_ar: 'تيست ذا ويست',
    tagline_en: 'A Different Kind of Pizza', tagline_ar: 'بيتزا بأسلوب مختلف',
    description_en: 'Wood-fired pizza.', description_ar: 'بيتزا على الحطب.',
    phone: '+966 50 000 0000', whatsapp: '966500000000', instagram: '@ttw', email: '',
    wa_message_en: 'Hi!', wa_message_ar: 'مرحباً!',
    address_en: 'Sultana District, Madinah', address_ar: 'حي السلطانة، المدينة المنورة',
    map_directions: '', map_embed: '',
    hours_weekdays_en: '12 PM – 12 AM', hours_weekdays_ar: '١٢ ظهراً – ١٢ ليلاً',
    hours_weekends_en: '12 PM – 1 AM', hours_weekends_ar: '١٢ ظهراً – ١ فجراً',
    sounds_enabled: true, transition_enabled: true, transition_style: 'portal', transition_color: '#d4af65',
    business_type: 'restaurant',
    catalog_label_en: '', catalog_label_ar: '', featured_title_en: '', featured_title_ar: '',
    catalog_heading_en: '', catalog_heading_ar: '',
    hero_image_url: '', logo_url: '', location_visual_mode: 'map', location_image_url: '',
    highlights: [
      { type: 'percent', value: '100%', label: 'Quality', labelAr: 'جودة', visible: true },
      { type: 'rating', value: '★4.8', label: 'Rating', labelAr: 'تقييم', visible: true },
    ],
  };
}
function cat(id, slug, en, ar, order) {
  return { id, restaurant_id: 'r1', slug, name_en: en, name_ar: ar, sort_order: order, created_at: ts() };
}
function prod(id, catId, en, ar, order, extra) {
  return Object.assign({ id, restaurant_id: 'r1', category_id: catId, name_en: en, name_ar: ar,
    description_en: '', description_ar: '', price: '10', image_url: '', featured: false, featured_order: null, available: true,
    sort_order: order, created_at: ts(), updated_at: ts() }, extra || {});
}

const SEEDS = {
  // The 1T localization fixture.
  i18n: () => ({
    restaurants: [restaurantRow()],
    categories: [cat('c1', 'pizza', 'Pizza', 'بيتزا', 0), cat('c2', 'drinks', 'Drinks', 'مشروبات', 1)],
    products: [
      prod('p1', 'c1', 'Classic Margherita', 'مارغريتا كلاسيك', 0, { price: '39', featured: true }),
      prod('p2', 'c2', 'Lemon Mint', 'ليمون بالنعناع', 1, { price: '12', available: false }),
    ],
  }),
  // The 1U ordering fixture — legacy-style data: a tie, a NULL, a hidden item.
  order: () => ({
    restaurants: [restaurantRow()],
    categories: [
      cat('c1', 'pizza', 'Pizza', 'بيتزا', 0),
      cat('c2', 'pasta', 'Pasta', 'باستا', 1),
      cat('c3', 'drinks', 'Drinks', 'مشروبات', 2),
    ],
    products: [
      prod('pep', 'c1', 'Pepperoni', 'ببروني', 0, { featured: true }),
      prod('mar', 'c1', 'Margherita', 'مارغريتا', 1, { featured: true }),
      prod('hid', 'c1', 'Hidden Calzone', 'كالزوني مخفي', 2, { available: false }),
      prod('ttw', 'c1', 'Taste The West Special', 'سبيشل تيست ذا ويست', 2, { featured: true }),   // tie with hid
      prod('alf', 'c2', 'Alfredo', 'ألفريدو', 0),
      prod('bol', 'c2', 'Bolognese', 'بولونيز', null),                                        // legacy NULL
      prod('lem', 'c3', 'Lemon Mint', 'ليمون بالنعناع', 0),
      prod('col', 'c3', 'Cola', 'كولا', 1),
    ],
  }),
  // 1V: menu order ≠ homepage Featured order (the milestone's own example).
  featured: () => ({
    restaurants: [restaurantRow()],
    categories: [cat('c1', 'pizza', 'Pizza', 'بيتزا', 0), cat('c2', 'pasta', 'Pasta', 'باستا', 1)],
    products: [
      prod('mar', 'c1', 'Margherita', 'مارغريتا', 0),
      prod('pep', 'c1', 'Pepperoni', 'ببروني', 1),
      prod('ttw', 'c1', 'Taste The West Special', 'سبيشل تيست ذا ويست', 2, { featured: true, featured_order: 0 }),
      prod('bbq', 'c1', 'BBQ Ranch Chicken', 'دجاج رانش باربكيو', 3, { featured: true, featured_order: 2 }),
      prod('alf', 'c2', 'Chicken Alfredo', 'دجاج ألفريدو', 0, { featured: true, featured_order: 1 }),
      prod('bol', 'c2', 'Bolognese', 'بولونيز', 1),
      prod('las', 'c2', 'Lasagna', 'لازانيا', 2, { available: false }),
    ],
  }),
  // 1V: legacy data — 5 featured, no featured_order, one of them hidden.
  featuredLegacy: () => ({
    restaurants: [restaurantRow()],
    categories: [cat('c1', 'pizza', 'Pizza', 'بيتزا', 0), cat('c2', 'pasta', 'Pasta', 'باستا', 1)],
    products: [
      prod('pep', 'c1', 'Pepperoni', 'ببروني', 0, { featured: true }),
      prod('mar', 'c1', 'Margherita', 'مارغريتا', 1, { featured: true }),
      prod('las', 'c2', 'Lasagna', 'لازانيا', 0, { featured: true, available: false }),
      prod('alf', 'c2', 'Chicken Alfredo', 'دجاج ألفريدو', 1, { featured: true }),
      prod('bol', 'c2', 'Bolognese', 'بولونيز', 2, { featured: true }),
    ],
  }),
};

function createDb() {
  const db = { tables: null, writes: [], failIf: null };
  db.reset = function (seed) {
    db.tables = SEEDS[seed || 'i18n']();
    db.writes = [];
    db.failIf = null;
  };
  db.reset('i18n');

  function matches(row, filters) { return (filters || []).every(([k, v]) => row[k] === v); }
  db.query = function (q) {
    const rows = db.tables[q.table] || (db.tables[q.table] = []);
    const hit = rows.filter((r) => matches(r, q.filters));
    if (q.op === 'select') return { data: JSON.parse(JSON.stringify(hit)), error: null };
    db.writes.push(q);
    if (db.failIf && db.failIf(q)) return { data: null, error: { message: 'simulated failure' } };
    if (q.op === 'update') {
      hit.forEach((r) => { Object.assign(r, q.payload); if ('updated_at' in r) r.updated_at = ts(); });
      return { data: JSON.parse(JSON.stringify(hit)), error: null };
    }
    if (q.op === 'insert') {
      const payloads = Array.isArray(q.payload) ? q.payload : [q.payload];
      const made = payloads.map((p, i) => {
        const row = Object.assign({ id: q.table + '-' + db.writes.length + '-' + i, created_at: ts() }, p);
        rows.push(row);
        return row;
      });
      return { data: made.map((r) => ({ id: r.id })), error: null };
    }
    if (q.op === 'delete') {
      db.tables[q.table] = rows.filter((r) => hit.indexOf(r) === -1);
      if (q.table === 'categories') {   // ON DELETE SET NULL
        const gone = hit.map((r) => r.id);
        db.tables.products.forEach((p) => { if (gone.indexOf(p.category_id) !== -1) p.category_id = null; });
      }
      return { data: null, error: null };
    }
    return { data: null, error: { message: 'unsupported op ' + q.op } };
  };

  // PostgREST GET mock (insertion order; restaurant filter ignored — one tenant).
  db.rest = function (url) {
    const u = new URL(url);
    const p = u.pathname;
    if (p.endsWith('/restaurants_public')) {
      return db.tables.restaurants.map((r) => { const o = Object.assign({}, r); delete o.owner_id; return o; });
    }
    if (p.endsWith('/categories')) return JSON.parse(JSON.stringify(db.tables.categories));
    if (p.endsWith('/products')) {
      let list = db.tables.products.slice();
      if (u.searchParams.get('available') === 'eq.true') list = list.filter((x) => x.available);
      return list.map((x) => {
        const c = db.tables.categories.find((k) => k.id === x.category_id);
        return Object.assign({}, x, { categories: c ? { id: c.id, slug: c.slug, name_ar: c.name_ar, name_en: c.name_en } : null });
      });
    }
    return [];
  };
  return db;
}

async function startHarness(opts) {
  opts = opts || {};
  const db = createDb();
  const knobs = { cdnDelayMs: 0, blockI18n: false };
  const netWrites = [];
  const pageErrors = [];

  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
    if (u === '/__blank') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>blank</title>'); return; }
    if (u === '/__fake/query' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let out;
        try { out = db.query(JSON.parse(body)); } catch (e) { out = { data: null, error: { message: String(e) } }; }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(out));
      });
      return;
    }
    let f = path.join(ROOT, u);
    if (!f.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: fs.existsSync(CHROME) ? CHROME : undefined });

  async function newContext(ctxOpts) {
    const context = await browser.newContext(Object.assign({ viewport: { width: 1440, height: 900 } }, ctxOpts || {}));
    await context.route('**/*', async (route) => {
      const req = route.request();
      const url = req.url();
      if (url.startsWith(base)) {
        if (knobs.blockI18n && url.endsWith('/admin/js/i18n.js')) return route.abort();
        return route.continue();
      }
      if (url.includes('supabase-js')) {
        if (knobs.cdnDelayMs) await new Promise((r) => setTimeout(r, knobs.cdnDelayMs));
        return route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_SUPABASE });
      }
      if (/\.supabase\.co\//.test(url)) {
        if (req.method() !== 'GET') { netWrites.push(req.method() + ' ' + url); return route.fulfill({ status: 403, body: '{}' }); }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(db.rest(url)) });
      }
      return route.abort();   // fonts / anything external
    });
    return context;
  }

  const context = await newContext(opts.context);
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(String((e && e.message) || e)));

  return {
    base, browser, context, page, db, knobs, netWrites, pageErrors, newContext,
    async stop() { await browser.close(); server.close(); },
  };
}

module.exports = { startHarness };
