// ─────────────────────────────────────────────────────────────────
//  TASTE THE WEST — Shop Configuration
//  Edit this file to customize branding, contact, location, and hours.
//  Do NOT edit app.js, HTML files, or style.css per client.
// ─────────────────────────────────────────────────────────────────
const SHOP_SETTINGS = {
  defaultLanguage: 'ar',    // 'ar' | 'en'
  defaultTheme:    'dark',  // 'dark' | 'light'
  sounds:          true,    // subtle UI click feedback — set false to disable
};

const SHOP = {

  // ── Identity ──────────────────────────────────────────────────
  name:       "تيست ذا ويست",
  nameEn:     "Taste The West",
  tagline:    "بيتزا بأسلوب مختلف",
  taglineEn:  "A Different Kind of Pizza",
  description:
    "تجربة بيتزا مستوحاة من الطابع الغربي بلمسة فريدة — أسلوب مختلف يصل إلى المدينة المنورة.",
  descriptionEn:
    "A western-inspired pizza experience with a unique taste, bringing a different style of pizza to Madinah.",

  // ── Contact ───────────────────────────────────────────────────
  // DEMO PLACEHOLDERS — replace with owner's real numbers before launch
  phone:     "+966 50 000 0000",    // ← demo number, visible on contact page
  whatsapp:  "966500000000",        // ← demo number, used in WhatsApp button links
  instagram: "@tastethewest",
  email:     "",                    // leave empty to hide email row

  // ── Location ──────────────────────────────────────────────────
  address: {
    en: "Sultana District, Madinah Al-Munawwarah",
    ar: "حي السلطانة، المدينة المنورة"
  },
  // Map embed: approximate Sultana area. Update with exact pin once address confirmed.
  mapEmbed:      "https://maps.google.com/maps?q=24.4672,39.6151&z=16&output=embed",
  mapDirections: "https://maps.app.goo.gl/Mymexj1XcgqD6cdk7",

  // ── Hours ─────────────────────────────────────────────────────
  hours: {
    weekdays:   "12:00 PM – 12:00 AM",
    weekdaysAr: "١٢:٠٠ ظهراً – ١٢:٠٠ منتصف الليل",
    weekends:   "12:00 PM – 1:00 AM",
    weekendsAr: "١٢:٠٠ ظهراً – ١:٠٠ فجراً"
  },

  // ── Homepage highlights ───────────────────────────────────────
  highlights: [
    { value: "100%", label: "Fresh Daily",     labelAr: "طازج كل يوم"   },
    { value: "4+",   label: "Pizza Styles",    labelAr: "تشكيلة بيتزا"  },
    { value: "★4.8", label: "Customer Rating", labelAr: "تقييم العملاء" }
  ],

  // ── Hero image ────────────────────────────────────────────────
  // Placeholder — replace with owner's actual restaurant photo before launch.
  // Recommended: 1920×1080px, under 500KB. Upload via Admin → Settings.
  hero: {
    image: "assets/images/hero-placeholder.svg"
  },

  // ── WhatsApp pre-filled message ───────────────────────────────
  social: {
    whatsappMessage: "مرحباً! أريد طلب من تيست ذا ويست."
  },

  // ── Categories (static fallback — auto-loaded from DB when Supabase configured) ──
  categories: [
    { slug: 'pizza',  nameAr: 'بيتزا',    nameEn: 'Pizza'  },
    { slug: 'sides',  nameAr: 'مقبلات',   nameEn: 'Sides'  },
    { slug: 'drinks', nameAr: 'مشروبات',  nameEn: 'Drinks' },
  ]
};
