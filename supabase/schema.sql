-- =================================================================
--  TASTE THE WEST — Supabase Database Schema
--  Run this entire file in the Supabase SQL Editor (one shot).
--  Project: https://supabase.com/dashboard/project/<your-project>
-- =================================================================


-- ── EXTENSIONS ───────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ── RESTAURANTS ──────────────────────────────────────────────────
-- One row per deployed restaurant. owner_id maps to auth.users.
CREATE TABLE IF NOT EXISTS restaurants (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Identity
  name_ar          TEXT NOT NULL DEFAULT '',
  name_en          TEXT NOT NULL DEFAULT '',
  tagline_ar       TEXT          DEFAULT '',
  tagline_en       TEXT          DEFAULT '',
  description_ar   TEXT          DEFAULT '',
  description_en   TEXT          DEFAULT '',

  -- Contact
  phone            TEXT          DEFAULT '',
  whatsapp         TEXT          DEFAULT '',  -- digits only: 9665XXXXXXXX
  instagram        TEXT          DEFAULT '',
  email            TEXT          DEFAULT '',

  -- Location
  address_ar       TEXT          DEFAULT '',
  address_en       TEXT          DEFAULT '',
  map_embed        TEXT          DEFAULT '',  -- Google Maps iframe ?output=embed src
  map_directions   TEXT          DEFAULT '',  -- maps.app.goo.gl share link

  -- Hours (bilingual)
  hours_weekdays_en TEXT         DEFAULT '',
  hours_weekdays_ar TEXT         DEFAULT '',
  hours_weekends_en TEXT         DEFAULT '',
  hours_weekends_ar TEXT         DEFAULT '',

  -- Media (public URLs from Supabase Storage)
  hero_image_url   TEXT          DEFAULT '',
  logo_url         TEXT          DEFAULT '',

  -- WhatsApp pre-fill messages
  wa_message_ar    TEXT          DEFAULT '',
  wa_message_en    TEXT          DEFAULT '',

  -- App behaviour
  sounds_enabled   BOOLEAN       DEFAULT true,

  -- Homepage highlights: [{value, label, labelAr}]
  highlights       JSONB         DEFAULT '[]'::jsonb,

  created_at       TIMESTAMPTZ   DEFAULT NOW(),
  updated_at       TIMESTAMPTZ   DEFAULT NOW()
);


-- ── CATEGORIES ───────────────────────────────────────────────────
-- Each restaurant defines its own category list.
CREATE TABLE IF NOT EXISTS categories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,

  slug          TEXT NOT NULL,   -- URL-safe key used as data-cat: 'pizza', 'drinks'
  name_ar       TEXT NOT NULL DEFAULT '',
  name_en       TEXT NOT NULL DEFAULT '',
  sort_order    INTEGER      DEFAULT 0,

  created_at    TIMESTAMPTZ  DEFAULT NOW(),

  UNIQUE (restaurant_id, slug)
);


-- ── PRODUCTS ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  category_id    UUID          REFERENCES categories(id)  ON DELETE SET NULL,

  name_ar        TEXT NOT NULL DEFAULT '',
  name_en        TEXT NOT NULL DEFAULT '',
  description_ar TEXT          DEFAULT '',
  description_en TEXT          DEFAULT '',
  price          TEXT NOT NULL DEFAULT '',  -- display string: "49 SAR"

  image_url      TEXT          DEFAULT '',  -- public URL from Storage; empty = placeholder
  featured       BOOLEAN       DEFAULT false,
  available      BOOLEAN       DEFAULT true,  -- false = hidden from public site
  sort_order     INTEGER       DEFAULT 0,

  created_at     TIMESTAMPTZ   DEFAULT NOW(),
  updated_at     TIMESTAMPTZ   DEFAULT NOW()
);


-- ── UPDATED_AT TRIGGERS ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER restaurants_updated_at
  BEFORE UPDATE ON restaurants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── ROW LEVEL SECURITY ────────────────────────────────────────────
ALTER TABLE restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories  ENABLE ROW LEVEL SECURITY;
ALTER TABLE products    ENABLE ROW LEVEL SECURITY;


-- restaurants
-- Public: anyone can read any restaurant row (needed for public site).
-- Owner: full write access to their own row only.
CREATE POLICY "restaurants_public_read"
  ON restaurants FOR SELECT USING (true);

CREATE POLICY "restaurants_owner_insert"
  ON restaurants FOR INSERT WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "restaurants_owner_update"
  ON restaurants FOR UPDATE USING (auth.uid() = owner_id);

CREATE POLICY "restaurants_owner_delete"
  ON restaurants FOR DELETE USING (auth.uid() = owner_id);


-- categories
-- Public: read all categories for any restaurant.
-- Owner: write only for their own restaurant.
CREATE POLICY "categories_public_read"
  ON categories FOR SELECT USING (true);

CREATE POLICY "categories_owner_insert"
  ON categories FOR INSERT WITH CHECK (
    restaurant_id IN (SELECT id FROM restaurants WHERE owner_id = auth.uid())
  );

CREATE POLICY "categories_owner_update"
  ON categories FOR UPDATE USING (
    restaurant_id IN (SELECT id FROM restaurants WHERE owner_id = auth.uid())
  );

CREATE POLICY "categories_owner_delete"
  ON categories FOR DELETE USING (
    restaurant_id IN (SELECT id FROM restaurants WHERE owner_id = auth.uid())
  );


-- products
-- Public: only available=true rows are readable.
-- Owner: can read ALL their products (including unavailable), and write.
-- Note: two SELECT policies — Supabase merges them with OR.
CREATE POLICY "products_public_read"
  ON products FOR SELECT USING (available = true);

CREATE POLICY "products_owner_read"
  ON products FOR SELECT USING (
    restaurant_id IN (SELECT id FROM restaurants WHERE owner_id = auth.uid())
  );

CREATE POLICY "products_owner_insert"
  ON products FOR INSERT WITH CHECK (
    restaurant_id IN (SELECT id FROM restaurants WHERE owner_id = auth.uid())
  );

CREATE POLICY "products_owner_update"
  ON products FOR UPDATE USING (
    restaurant_id IN (SELECT id FROM restaurants WHERE owner_id = auth.uid())
  );

CREATE POLICY "products_owner_delete"
  ON products FOR DELETE USING (
    restaurant_id IN (SELECT id FROM restaurants WHERE owner_id = auth.uid())
  );


-- ── STORAGE SETUP ─────────────────────────────────────────────────
-- After running this SQL, do the following in the Supabase Dashboard:
--
-- 1. Go to Storage → New Bucket
--    Name:   restaurant-media
--    Public: YES  (images must be publicly accessible for the website)
--
-- 2. Go to Storage → restaurant-media → Policies → New Policy
--
--    Policy 1 — Public read:
--      Operation: SELECT
--      Policy definition (check expression): true
--      Name: storage_public_read
--
--    Policy 2 — Authenticated uploads:
--      Operation: INSERT
--      Policy definition (check expression): (auth.role() = 'authenticated')
--      Name: storage_owner_upload
--
--    Policy 3 — Authenticated updates:
--      Operation: UPDATE
--      Using expression: (auth.role() = 'authenticated')
--      Name: storage_owner_update
--
--    Policy 4 — Authenticated deletes:
--      Operation: DELETE
--      Using expression: (auth.role() = 'authenticated')
--      Name: storage_owner_delete
--
-- Storage folder structure (created automatically on first upload):
--   restaurant-media/
--     products/    ← product images
--     branding/    ← hero + logo images


-- ── SEED: TASTE THE WEST ─────────────────────────────────────────
-- Run AFTER creating the owner account via the admin login page.
-- Replace <OWNER_USER_ID> with the UUID from auth.users.
--
-- INSERT INTO restaurants (owner_id, name_ar, name_en, tagline_ar, tagline_en,
--   description_ar, description_en, phone, whatsapp, instagram,
--   address_ar, address_en,
--   map_embed, map_directions,
--   hours_weekdays_en, hours_weekdays_ar,
--   hours_weekends_en, hours_weekends_ar,
--   wa_message_ar, wa_message_en,
--   highlights, sounds_enabled)
-- VALUES (
--   '<OWNER_USER_ID>',
--   'تيست ذا ويست', 'Taste The West',
--   'بيتزا بأسلوب مختلف', 'A Different Kind of Pizza',
--   'تجربة بيتزا مستوحاة من الطابع الغربي بلمسة فريدة — أسلوب مختلف يصل إلى المدينة المنورة.',
--   'A western-inspired pizza experience with a unique taste, bringing a different style of pizza to Madinah.',
--   '+966 5X XXX XXXX', '9665XXXXXXXX', '@tastethewest',
--   'حي السلطانة، المدينة المنورة', 'Sultana District, Madinah Al-Munawwarah',
--   'https://maps.google.com/maps?q=24.4672,39.6151&z=16&output=embed',
--   'https://maps.app.goo.gl/Mymexj1XcgqD6cdk7',
--   '12:00 PM – 12:00 AM', '١٢:٠٠ ظهراً – ١٢:٠٠ منتصف الليل',
--   '12:00 PM – 1:00 AM',  '١٢:٠٠ ظهراً – ١:٠٠ فجراً',
--   'مرحباً! أريد طلب من تيست ذا ويست.',
--   'Hi! I''d like to place an order from Taste The West.',
--   '[{"value":"100%","label":"Fresh Daily","labelAr":"طازج كل يوم"},{"value":"4+","label":"Pizza Styles","labelAr":"تشكيلة بيتزا"},{"value":"★4.8","label":"Customer Rating","labelAr":"تقييم العملاء"}]',
--   true
-- );
--
-- Then get the restaurant ID:
-- SELECT id FROM restaurants WHERE owner_id = '<OWNER_USER_ID>';
-- Copy it into config/supabase.js as RESTAURANT_ID.
