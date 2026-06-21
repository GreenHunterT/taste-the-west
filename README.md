# SouqSite

A production-quality, reusable website template for small physical shops in Makkah.  
Fully static — no server, no database, no build step required.

---

## Features

- Bilingual (Arabic / English) with live toggle, no page reload
- Dark mode default, premium light mode — persisted in localStorage
- Mobile-first, tested at 375px → 1440px
- RTL-ready (Arabic activates automatic layout mirroring)
- WhatsApp-first contact (pre-filled message, floating button)
- All shop data in two config files — zero app logic changes needed per client

---

## File Structure

```
SouqSite/
├── index.html            Homepage
├── products.html         Full product catalog with category filter
├── location.html         Google Maps embed + address / hours
├── contact.html          WhatsApp block + contact details
│
├── config/
│   ├── shop.js           ← EDIT THIS for each new shop
│   ├── products.js       ← EDIT THIS with real products
│   ├── products.json     Reference JSON format (for future API)
│   └── translations.js   UI strings in Arabic + English
│
├── css/
│   └── style.css         All styles (CSS variables, dark/light themes)
│
├── js/
│   └── app.js            Runtime — renders config, handles lang/theme
│
└── assets/
    └── images/           Place shop hero + product photos here
```

---

## Local Usage

Open `index.html` directly in any browser — no server needed.  
For Google Maps to embed, an internet connection is required.

> **Tip:** Use VS Code Live Server for the best local experience.

---

## Deployment

### GitHub Pages

1. Push the folder contents to a GitHub repo (root or `/docs` folder).
2. Settings → Pages → Source: `main` branch, `/ (root)`.
3. Site is live at `https://username.github.io/repo-name/`.

All paths are relative — no changes needed.

### Vercel

1. Connect the GitHub repo to Vercel.
2. Framework preset: **Other** (no build command, no output directory).
3. Deploy — done. Vercel auto-detects static files.

---

## Customizing for a New Shop (5 steps)

### 1. Duplicate the folder
Copy `SouqSite/` and rename it — e.g. `AlNoor/`.

### 2. Edit `config/shop.js`

```js
const SHOP_SETTINGS = {
  defaultLanguage: 'ar',   // 'ar' | 'en'
  defaultTheme:    'dark', // 'dark' | 'light'
};

const SHOP = {
  name:        "اسم المتجر",       // Arabic name
  nameEn:      "Shop Name",         // English name
  tagline:     "الشعار بالعربي",
  taglineEn:   "English tagline",
  description: "وصف المتجر ...",
  descriptionEn: "Shop description ...",

  phone:     "+966 5X XXX XXXX",
  whatsapp:  "9665XXXXXXXX",       // digits only, no + or spaces
  instagram: "@handle",
  email:     "",                   // leave empty to hide

  address: {
    en: "Street, District, Makkah",
    ar: "الشارع، الحي، مكة المكرمة"
  },
  mapEmbed:      "https://maps.google.com/maps?q=LAT,LNG&z=16&output=embed",
  mapDirections: "https://maps.google.com/maps?q=LAT,LNG",

  hours: {
    weekdays: "9:00 AM – 10:00 PM",
    weekends: "Open All Day"
  },

  highlights: [
    { value: "15+",  label: "Years of Experience", labelAr: "سنة من الخبرة" },
    { value: "200+", label: "Products",             labelAr: "منتج"          },
    { value: "★5.0", label: "Customer Rating",     labelAr: "تقييم العملاء"  }
  ],

  hero: {
    image: "assets/images/hero.jpg"   // replace with real shop photo
  },

  social: {
    whatsappMessage: "Hello! I'd like to know more."
  }
};
```

### 3. Edit `config/products.js`

Add the shop's real products. Set `featured: true` on up to 3 to appear on the homepage.

```js
const PRODUCTS = [
  {
    id: 1,
    name:          "اسم المنتج",
    nameEn:        "Product Name",
    price:         "45 SAR",
    category:      "category-slug",
    image:         "assets/images/products/item1.jpg",
    description:   "وصف قصير",
    descriptionEn: "Short description",
    featured:      true
  },
  // ...
];
```

### 4. Replace images

| File | Purpose |
|------|---------|
| `assets/images/hero.jpg` | Homepage hero background |
| `assets/images/products/item1.jpg` | Product photos (match `image` in products.js) |

Recommended sizes: hero `1920×1080`, products `600×450`.

### 5. Deploy

Push to GitHub → Vercel or GitHub Pages picks it up automatically.

---

## localStorage Keys

| Key | Values | Default |
|-----|--------|---------|
| `souqsite_language` | `'ar'` \| `'en'` | `SHOP_SETTINGS.defaultLanguage` |
| `souqsite_theme` | `'dark'` \| `'light'` | `SHOP_SETTINGS.defaultTheme` |

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
| **V1** ✓ | Static site, WhatsApp contact, products catalog, location map |
| **V1.1** ✓ | Bilingual, dark/light theme, GitHub/Vercel deploy-ready |
| V2 | Owner dashboard, login, live product editing (replace config/*.js with API) |
| V3 | QR code generation, order request form |
| V4 | Delivery network integration |

**V2 upgrade path:** `app.js` already separates data-loading from rendering. Replace the `<script src="config/shop.js">` tag with a `fetch('/api/shop')` call in `js/app.js` — the render functions (`initHome`, `initProducts`, etc.) stay unchanged.

---

## Manual Testing Checklist

- [ ] Homepage hero image loads, shop name and tagline appear correctly
- [ ] Hero WhatsApp button opens correct wa.me link
- [ ] Scroll past hero — nav transitions from transparent to solid dark
- [ ] Language toggle (EN · عربية) switches all UI text without reload
- [ ] Arabic mode: layout shifts to RTL, no broken alignment
- [ ] Theme toggle (☀ / 🌙) switches between dark and light instantly
- [ ] Language + theme choices persist after page refresh (localStorage)
- [ ] Products page: all cards render, category filter shows/hides correctly
- [ ] "All" filter button text switches language with the toggle
- [ ] Location page: map iframe loads, address shows in current language
- [ ] "Get Directions" button opens Google Maps
- [ ] Contact page: WhatsApp block opens wa.me, phone link works, Instagram/email hidden if empty
- [ ] Floating WhatsApp button visible on all pages, moves to left side in RTL
- [ ] Footer copyright year is current
- [ ] Mobile 375px: no horizontal scroll, hamburger menu opens cleanly
- [ ] Mobile 768px: nav links visible, no overflow issues
- [ ] Keyboard navigation: gold focus ring visible on all interactive elements
