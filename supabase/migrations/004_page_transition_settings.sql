-- =================================================================
--  Migration 004 — Configurable public page-transition settings
--  Milestone 1R
--
--  Adds three restaurant-level columns so the public-site page transition
--  (the "Portal Waves" curtains, or the new Fade / Slide alternatives) is
--  staff-configurable from Admin Settings instead of hardcoded:
--
--    transition_enabled  BOOLEAN — master on/off switch
--    transition_style    TEXT    — 'portal' | 'fade' | 'slide'
--    transition_color    TEXT    — hex color used by Portal Waves only
--
--  Defaults preserve TasteTheWest's current, already-accepted behaviour
--  exactly: enabled, 'portal', the existing gold (#d4af65 — see
--  css/style.css --gold-light / --accent). An existing row that never
--  gets these columns touched reads back identically to today.
--
--  No CHECK constraints — matching this schema's existing minimal style
--  (see supabase/schema.sql's own note on location_image_fit/position/zoom):
--  transition_style and transition_color are validated/clamped in app code
--  on both write (admin/js/views/settings.js) and read (js/app.js).
-- =================================================================

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS transition_enabled BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS transition_style   TEXT    DEFAULT 'portal',
  ADD COLUMN IF NOT EXISTS transition_color   TEXT    DEFAULT '#d4af65';

-- restaurants_public must expose the new columns too — the public site's
-- js/app.js reads restaurant settings exclusively through this view (see
-- migration 001), never the base table. Re-running CREATE OR REPLACE VIEW
-- is safe and matches how 001/003 already evolve this same view.
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
  transition_enabled, transition_style, transition_color
FROM public.restaurants
WHERE id = '57ee591f-39fb-4320-af05-fec66ebd512a'::uuid;

-- No grant changes needed: anon/authenticated already hold SELECT on
-- restaurants_public (migration 003) and authenticated already holds
-- SELECT/UPDATE on the restaurants base table — both privileges are
-- table-level, so they automatically cover these new columns.
