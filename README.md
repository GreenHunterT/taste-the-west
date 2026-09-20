# Taste The West

A bilingual restaurant website (public site + a private owner Admin) built on
the SouqSite template lineage. **Not fully static** — the public pages and
Admin both read/write a real Supabase project (Postgres + Auth + Storage).
`config/shop.js` / `config/products.js` remain in the repo only as bundled
placeholder/seed data and an emergency fallback shape — see "Data model"
below.

---

## Features

- Bilingual (Arabic / English) with live toggle, no page reload
- One canonical dark visual design — no theme switch
- Mobile-first, tested at 320px → 1440px
- RTL-ready (Arabic activates automatic layout mirroring)
- WhatsApp-first contact (pre-filled message, floating button)
- Cinematic "Portal" page transitions with an automatic low-motion fallback
  (`prefers-reduced-motion`) — no user-facing setting, the browser/OS decides
- Optional customer-facing UI sound, owner-controlled, independent of the
  Admin's own interaction sounds
- A private Admin (`/admin`) for the owner to edit Settings, Menu Items, and
  Categories, with a live Preview of the real public site (Page / Device /
  Language controls; Preview always scales to fit — there is no separate
  "100%" mode)

---

## File Structure

```
taste-the-west/
├── index.html            Homepage
├── products.html         Full product catalog with category filter
├── location.html         Google Maps embed + address / hours
├── contact.html          WhatsApp block + contact details
├── 404.html
│
├── admin/                Private owner dashboard (Supabase Auth-gated)
│   ├── index.html         The persistent Admin shell (Menu + Settings)
│   ├── login.html         Sign-in
│   └── js/                Shell, auth, Live Preview, and the 3 admin views
│
├── config/
│   ├── shop.js           Bundled placeholder restaurant + emergency fallback
│   ├── products.js       Bundled placeholder menu + emergency fallback
│   ├── products.json     Reference JSON format
│   └── translations.js   UI strings in Arabic + English
│
├── css/
│   └── style.css         All styles (CSS variables, single canonical design)
│
├── js/
│   └── app.js            Public runtime — Supabase fetch, rendering, i18n
│
├── supabase/
│   ├── schema.sql         Full schema + RLS policies + Storage policies
│   └── migrations/        Follow-up SQL, applied by hand in the SQL Editor
│
└── assets/
    └── images/           Placeholder art (real media lives in Supabase Storage)
```

---

## Data model

The **database is the source of truth** for everything the owner can edit —
restaurant identity/contact/hours/images, menu items, and categories — via
Admin → Settings / Menu. `config/shop.js` and `config/products.js` are used
only in two situations: (1) as the shape the Admin Preview warms up with
before the real draft arrives, and (2) as an emergency, non-catalog fallback
if `RESTAURANT_ID`/Supabase are not configured at all. **Editing these files
does not change the live site once Supabase is configured** — always use
Admin. See `supabase/schema.sql` for the schema and Row Level Security
policies, and `supabase/migrations/` for anything applied afterward.

Migrations in `supabase/migrations/` are numbered and must be run **in
order, with an application deploy in between where a migration's own
comment says so** — this is a staged expand/deploy/contract rollout, not a
batch of independent scripts. Running a later-phase migration before the
matching app code is live and confirmed working will temporarily break the
public site. Each file's own header states exactly when it is safe to run.

---

## Local Usage

This is no longer a pure `file://`-safe static site — Admin's routing and
the public pages' same-origin Supabase calls expect a real HTTP origin. Serve
the repo root with any static file server, e.g.:

```
python -m http.server 8080
```

or the VS Code Live Server extension, then open `http://localhost:8080/`.
`config/supabase.js` must point at a real Supabase project for anything
beyond the bundled placeholder content to appear.

---

## Deployment

### Vercel (primary target — see `vercel.json`)

1. Connect the GitHub repo to Vercel.
2. Framework preset: **Other** (no build command, no output directory).
3. Deploy. `vercel.json` rewrites `/admin` → `/admin/index.html` and adds
   `noindex`/frame/content-type headers to every `/admin/*` route.

### GitHub Pages

Works for the public pages, but GitHub Pages has no equivalent to
`vercel.json`'s rewrites/headers — visiting `/admin` (without `index.html`)
will 404, and the Admin will not get the `noindex`/frame-protection headers.
Vercel is the supported target for the full site including Admin.

---

## localStorage Keys

| Key | Values | Default |
|-----|--------|---------|
| `souqsite_language` | `'ar'` \| `'en'` | `SHOP_SETTINGS.defaultLanguage` |

User preferences persist across sessions. Clear `localStorage` to reset.

---

## Adding Translations / Languages

All UI strings are in `config/translations.js`.  
To add a language (e.g. Urdu):

1. Add a new top-level key `ur: { nav: {...}, hero: {...}, ... }` matching the `en`/`ar` structure.
2. Add a lang button in each HTML file: `<button class="lang-btn" data-lang="ur">اردو</button>`
3. Update the anti-FOUC script default fallback if needed.

---

## Version Roadmap

| Version | Features |
|---------|----------|
| Early static prototype ✓ | Public site, WhatsApp contact, products catalog, location map, bilingual |
| **V1 (current)** ✓ | Supabase-backed data, private owner Admin (Settings / Menu / Categories, live Preview), Portal page transitions, customer + Admin sound |
| V2+ (explicitly out of scope for now) | Ordering, payments, delivery, staff roles/accounts, analytics, multi-tenant "SouqSite" platform |

---

## Manual Testing Checklist

**Customer site**
- [ ] Homepage hero image loads, shop name and tagline appear correctly
- [ ] Hero WhatsApp button opens correct wa.me link
- [ ] Scroll past hero — nav transitions from transparent to solid dark
- [ ] Language toggle (EN · عربية) switches all UI text without reload; Arabic never briefly shows English
- [ ] Arabic mode: layout shifts to RTL, no broken alignment
- [ ] Language choice persists after page refresh (localStorage)
- [ ] Products page: all cards render, category filter shows/hides correctly
- [ ] Location page: map iframe loads, address shows in current language
- [ ] "Get Directions" button opens Google Maps
- [ ] Contact page: WhatsApp block opens wa.me, phone link works, Instagram/email hidden if empty
- [ ] Floating WhatsApp button visible on all pages, moves to left side in RTL
- [ ] Footer copyright year is current
- [ ] Mobile 320–430px: no horizontal scroll, hamburger menu opens cleanly
- [ ] Keyboard navigation: gold focus ring visible on all interactive elements
- [ ] Page-to-page navigation shows the Portal transition (or its low-motion
      fallback under `prefers-reduced-motion`) with no loading dots and no
      flash of the wrong language
- [ ] Turning off a browser/OS internet connection mid-navigation shows a
      plain "temporarily unavailable" state — never the bundled demo menu
      prices/contact details presented as if real

**Admin**
- [ ] `/admin` while signed out redirects to `/admin/login.html`
- [ ] Wrong password shows a generic error (never reveals whether the email exists)
- [ ] Sign in → Menu / Settings load; Sign Out returns to a signed-out state
- [ ] Save a Settings field → Admin Preview and the public site both reflect it
- [ ] Add / edit / delete a product and a category; Preview and public Menu match
- [ ] Replace the hero, logo, and a product image; the previous image keeps
      working if you reload before saving (nothing is deleted early)
