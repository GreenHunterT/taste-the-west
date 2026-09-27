-- =================================================================
--  Migration 006 — Deterministic catalog order  (milestone 1U)
--
--  DATA-ONLY. No new columns: categories.sort_order and products.sort_order
--  already exist. 1U changes what they MEAN:
--
--    categories.sort_order — position of the category (global, per restaurant)
--    products.sort_order   — position of the item WITHIN its category
--
--  Before 1U, products were ordered by one flat sort_order across all
--  categories (a manual number in the item form, default 0), so most rows
--  tie and Postgres returned ties in an arbitrary order. This renumbers every
--  row 0..n-1 per restaurant (categories) and per restaurant + category
--  (products), keeping today's relative order: sort_order ASC (NULLs last),
--  then created_at, then id — the exact tie-break the app now uses, so
--  nothing visibly reshuffles inside a category.
--
--  Safe to run before OR after deploying the 1U app code, and safe to re-run
--  (only rows whose value actually changes are updated). The app never needs
--  consecutive numbers — it tolerates ties and NULLs — this just normalizes
--  existing data once. RLS, grants, views and Storage are untouched.
--  Note: the products updated_at trigger bumps updated_at on renumbered rows.
-- =================================================================

BEGIN;

WITH ranked AS (
  SELECT id,
         (ROW_NUMBER() OVER (
            PARTITION BY restaurant_id
            ORDER BY sort_order ASC NULLS LAST, created_at ASC NULLS LAST, id ASC
         ) - 1)::INTEGER AS pos
  FROM categories
)
UPDATE categories c
   SET sort_order = r.pos
  FROM ranked r
 WHERE c.id = r.id
   AND c.sort_order IS DISTINCT FROM r.pos;

-- category_id NULL (uncategorized) forms its own group, like in the app.
WITH ranked AS (
  SELECT id,
         (ROW_NUMBER() OVER (
            PARTITION BY restaurant_id, category_id
            ORDER BY sort_order ASC NULLS LAST, created_at ASC NULLS LAST, id ASC
         ) - 1)::INTEGER AS pos
  FROM products
)
UPDATE products p
   SET sort_order = r.pos
  FROM ranked r
 WHERE p.id = r.id
   AND p.sort_order IS DISTINCT FROM r.pos;

COMMIT;
