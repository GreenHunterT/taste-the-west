-- =================================================================
--  Migration 005 — Generic business identity + configurable niche labels
--  Milestone 1S
--
--  Adds:
--    business_type      TEXT — metadata only (no schema/behaviour branches
--                        on it yet). One of: restaurant | cafe | bakery |
--                        retail | clothing | salon | services | other.
--                        Not exposed via restaurants_public — it has no
--                        public-facing use yet, so it stays admin-only
--                        (least-privilege: no reason for anon to read it).
--
--    catalog_label_en/ar    — overrides the public catalog nav link +
--                              catalog-page eyebrow label (default: "Menu" /
--                              "القائمة" — see config/translations.js
--                              nav.products / products.label).
--    featured_title_en/ar   — overrides the homepage featured-section title
--                              (default: "Featured Dishes" / "أطباق مميزة" —
--                              see config/translations.js featured.title).
--    catalog_heading_en/ar  — overrides the catalog-page <h1> (default:
--                              "Full Menu" / "القائمة الكاملة" — see
--                              config/translations.js products.title).
--
--  All six label columns default to '' (empty). An empty value means "use
--  today's TasteTheWest wording" — the fallback lives in
--  config/translations.js and js/app.js (customLabelOverride), never
--  duplicated here. This is what makes existing rows (including
--  TasteTheWest's) render byte-for-byte identical to before this
--  migration: an untouched row has empty label columns, so every public
--  page falls straight through to the same static translation it already
--  used.
--
--  No CHECK constraint on business_type — matching this schema's existing
--  minimal style (see 004's own note); the Admin <select> only offers the
--  known values, and nothing branches on it yet regardless of what it holds.
-- =================================================================

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS business_type       TEXT DEFAULT 'restaurant',
  ADD COLUMN IF NOT EXISTS catalog_label_en    TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS catalog_label_ar    TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS featured_title_en   TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS featured_title_ar   TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS catalog_heading_en  TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS catalog_heading_ar  TEXT DEFAULT '';

-- restaurants_public gains only the six PUBLIC label columns — business_type
-- is intentionally left out (admin-only metadata, no anon read need). The
-- public site's js/app.js reads restaurant settings exclusively through
-- this view (see migration 001); re-running CREATE OR REPLACE VIEW is safe
-- and matches how 001/003/004 already evolve this same view.
CREATE OR REPLACE VIEW public.restaurants_public AS
SELECT
  id,
  name_ar, name_en, tagline_ar, tagline_en, description_ar, description_en,
  phone, whatsapp, instagram, email,
  address_ar, address_en, map_embed, map_directions,
  location_visual_mode, location_image_url, location_image_fit,
  location_image_position_x, location_image_position_y,
  location_image_zoom, location_image_height,
  hours_weekdays_en, hours_weekdays_ar, hours_weekends_en, hours_weekends_ar,
  hero_image_url, logo_url,
  wa_message_ar, wa_message_en,
  sounds_enabled, highlights,
  transition_enabled, transition_style, transition_color,
  catalog_label_en, catalog_label_ar,
  featured_title_en, featured_title_ar,
  catalog_heading_en, catalog_heading_ar
FROM public.restaurants
WHERE id = '57ee591f-39fb-4320-af05-fec66ebd512a'::uuid;

-- No grant changes needed: anon/authenticated already hold SELECT on
-- restaurants_public (migration 003) and authenticated already holds
-- SELECT/UPDATE on the restaurants base table — both privileges are
-- table-level, so they automatically cover these new columns.
