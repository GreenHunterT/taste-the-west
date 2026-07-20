# Owner Information Checklist — Taste The West
### Collect before going live

---

## Contact & Identity

- [ ] **Phone number** — displayed on the Contact page and used for click-to-call
- [ ] **WhatsApp number** — country code + digits only (e.g., 966501234567), no spaces or +
- [ ] **Instagram handle** — with or without @ (e.g., @tastethewest)
- [ ] **Snapchat** — if active
- [ ] **Twitter / X** — if active
- [ ] **TikTok** — if active
- [ ] **Email address** — optional; leave blank to hide the email row on the contact page

---

## Location

- [ ] **Full street address** in Arabic
- [ ] **Full street address** in English
- [ ] **Google Maps pin** — exact pin for the restaurant; confirm the map shows the right spot
- [ ] **Google Maps share link** — the short link (maps.app.goo.gl/...) used for "Get Directions"

---

## Opening Hours

- [ ] **Weekday hours** in English (e.g., 12:00 PM – 12:00 AM)
- [ ] **Weekday hours** in Arabic (e.g., ١٢:٠٠ ظهراً – ١٢:٠٠ منتصف الليل)
- [ ] **Weekend hours** in English
- [ ] **Weekend hours** in Arabic
- [ ] Clarify: which days are "weekdays" and which are "weekends" (Sat–Wed / Thu–Fri?)

---

## Visual Assets

- [ ] **Hero photo** — the main banner image shown on the homepage
  - Format: JPG or WEBP
  - Minimum size: 1920 × 1080 px
  - Subject: restaurant exterior, interior seating, or food shot
- [ ] **Logo** — restaurant logo or wordmark
  - Format: PNG with transparent background preferred
  - Minimum size: 400 × 400 px
- [ ] **Product photos** — one per menu item (11 items total)
  - Format: JPG or WEBP
  - Recommended size: 600 × 450 px, under 300 KB each

---

## Menu

- [ ] **Final product list** — confirm the items shown are correct, or provide updated list
- [ ] **Arabic names** for any items that need correction
- [ ] **English names** for any items that need correction
- [ ] **Prices** — confirm or update all 11 prices
- [ ] **Descriptions** — confirm or provide new descriptions (Arabic + English)
- [ ] **Categories** — confirm Pizza / Sides / Drinks, or add/rename categories
- [ ] **Featured items** — which 3 dishes should appear on the homepage?

---

## Admin Access

- [ ] **Owner email address** — used to log in to the admin dashboard
- [ ] Owner to set their own password after first login
  - First login: they can use the temporary password you create in Supabase Auth
  - Then go to: Dashboard → Reset / Change Password (add this flow after launch)

---

## WhatsApp Order Message

- [ ] Confirm the pre-filled WhatsApp message text (Arabic):
  > مرحباً! أريد طلب من تيست ذا ويست.
- [ ] Confirm English version:
  > Hi! I'd like to place an order from Taste The West.
- [ ] Adjust if the restaurant has a preferred greeting or ordering format

---

## Technical (one-time, owner does not need to do this)

- [ ] Schema SQL has been run in Supabase SQL Editor
- [ ] Seed SQL has been run with the owner's real UUID
- [ ] Real phone + WhatsApp updated in Admin → Settings
- [ ] Real hero photo uploaded via Admin → Settings
- [ ] Real logo uploaded via Admin → Settings
- [ ] Product photos uploaded via Admin → Menu → Edit (per item)
- [ ] Google Maps pin verified for the exact address
- [ ] Supabase Auth user created with owner's email
- [ ] `config/supabase.js` committed with final RESTAURANT_ID
