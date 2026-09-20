-- =================================================================
--  Migration 001 — Public-safe restaurant projection (EXPAND phase)
--  Milestone 1O (production hardening), corrected in 1O.1, staged in 1O.2
--
--  ROLLOUT: this is phase 1 of a 2-phase expand/contract rollout, chosen
--  specifically so applying this migration never breaks the CURRENTLY
--  DEPLOYED (pre-1O) application code. See the top of
--  002_revoke_anon_restaurants_select.sql for phase 2 and the exact order.
--
--    EXPAND (this file):  add the new safe view; do NOT remove the old
--                          base-table anon access yet. Old deployed code
--                          (queries `restaurants` directly) keeps working;
--                          new code (queries `restaurants_public`) also
--                          starts working, the moment this file is run —
--                          even before the new code is deployed.
--    DEPLOY:               ship the 1O application code (separately, not
--                          part of this file) once this migration is live.
--    CONTRACT (002):       only once the new code is confirmed live and
--                          working, revoke the old base-table anon grant.
--
--  WHY (COLUMNS):
--  RLS protects ROWS, not COLUMNS. The existing policy
--  ("restaurants_public_read" ON restaurants FOR SELECT USING (true))
--  lets any anonymous caller — not just this site's own front-end code —
--  request ANY column via PostgREST, e.g.
--    GET /rest/v1/restaurants?select=owner_id
--  `owner_id` (a foreign key into auth.users) has no reason to ever leave
--  the server.
--
--  WHY (ROWS):
--  This is a DEDICATED single-restaurant project, not the future shared
--  multi-tenant SouqSite database — TasteTheWest is the only row that
--  should ever be publicly readable from it. The view hardcodes that one
--  row rather than relying on the CLIENT to always add `?id=eq.<RID>`,
--  which would not be a real boundary (any caller can omit it).
--
--  This migration is idempotent — safe to re-run. It does NOT touch
--  INSERT/UPDATE/DELETE policies, does NOT change the authenticated
--  (owner) role's access at all, does NOT touch categories/products or
--  Storage, and — unlike the pre-1O.2 version of this file — does NOT
--  revoke anything. The revoke is 002, run only after deploy.
-- =================================================================

-- The public projection: every column the public site's mapRestaurant()
-- (js/app.js) actually reads, and nothing else (excludes owner_id,
-- created_at, updated_at) — for exactly TasteTheWest's one restaurant row.
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
  sounds_enabled, highlights
FROM public.restaurants
WHERE id = '57ee591f-39fb-4320-af05-fec66ebd512a'::uuid;

-- VIEW SECURITY SEMANTICS — read this before touching `security_invoker`:
-- This view is deliberately left as an ordinary ("security definer")
-- view — do NOT add `WITH (security_invoker = true)`. A plain view runs
-- with the privileges of the view's OWNER (whichever role ran this
-- migration, typically the project's `postgres` role), not the querying
-- role, and — because that owner also owns `restaurants` and this schema
-- never sets `FORCE ROW LEVEL SECURITY` — the owner's own reads of the
-- base table are NOT subject to RLS at all (Postgres exempts the table
-- owner from RLS by default). That is exactly what makes this
-- architecture work, in BOTH rollout phases: the view can read the full
-- base table internally and apply its own WHERE id = ... filter
-- regardless of what grant `anon` currently holds on the base table.
-- `security_invoker = true` would flip this: the view would then run AS
-- THE CALLER (anon). That is harmless during THIS phase (anon can still
-- read the base table directly), but the moment 002 revokes that grant,
-- an invoker-security view would start failing with a permission error
-- for every anonymous request instead of returning the safe projection.
-- Since this view must keep working unchanged across both phases, it is
-- defined once, correctly, as a definer view from the start.
--
-- Required final state (after 002 — see that file):
--   anon        → CAN query restaurants_public (below)
--   anon        → CANNOT query the restaurants base table (002)
--   anon        → CANNOT obtain owner_id (not a column in this view)
--   anon        → CANNOT enumerate any other restaurant row (WHERE above)
--   authenticated (owner) → completely untouched; Admin still reads/writes
--     the base table directly under the existing restaurants_owner_*
--     policies, which are not modified by this migration or by 002.

GRANT SELECT ON public.restaurants_public TO anon, authenticated;

-- Deliberately NO "REVOKE SELECT ON public.restaurants FROM anon" here —
-- that is 002, run only after the new application code is confirmed live.
-- Until then, anon keeps its existing (pre-1O) direct read access to the
-- base table, so the CURRENTLY DEPLOYED code keeps working unmodified.
