-- =================================================================
--  Migration 007 — Explicit homepage Featured order  (milestone 1V)
--
--  Adds products.featured_order — the product's position in the homepage
--  Featured section. Completely independent of products.sort_order (its
--  position inside its menu category, 1U / migration 006):
--    • reordering the menu never writes featured_order
--    • reordering Featured never writes sort_order
--  products.featured (BOOLEAN) keeps its meaning: "is featured". The Admin
--  caps it at 3; the homepage shows the first 3 AVAILABLE featured items by
--  featured_order ASC (NULLs last → catalog order), exactly like before for
--  any row this migration has not positioned.
--
--  Backfill: every featured row that has no featured_order yet is numbered
--  in TODAY's homepage order — catalog order (category sort_order, then the
--  product's sort_order, then created_at, then id) — so the current homepage
--  selection and sequence are preserved. Nothing is unfeatured, even if more
--  than 3 are featured (the Admin flags that state instead).
--
--  Safe to re-run: ADD COLUMN IF NOT EXISTS, and the backfill only touches
--  featured rows whose featured_order is still NULL, appending them after
--  any positions that already exist. Grants are table-level (003), so the
--  new column needs no GRANT; RLS, views and Storage are untouched.
--
--  ROLLOUT: run this BEFORE deploying the 1V app code — the 1V Admin writes
--  featured_order. The public site works with or without the column.
-- =================================================================

BEGIN;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS featured_order INTEGER;

WITH base AS (
  SELECT restaurant_id, COALESCE(MAX(featured_order), -1) AS max_pos
    FROM products
   WHERE featured = true
   GROUP BY restaurant_id
),
ranked AS (
  SELECT p.id,
         (b.max_pos + ROW_NUMBER() OVER (
            PARTITION BY p.restaurant_id
            ORDER BY c.sort_order ASC NULLS LAST, c.created_at ASC NULLS LAST, c.id ASC NULLS LAST,
                     p.sort_order ASC NULLS LAST, p.created_at ASC NULLS LAST, p.id ASC
         ))::INTEGER AS pos
    FROM products p
    JOIN base b            ON b.restaurant_id = p.restaurant_id
    LEFT JOIN categories c ON c.id = p.category_id
   WHERE p.featured = true
     AND p.featured_order IS NULL
)
UPDATE products p
   SET featured_order = r.pos
  FROM ranked r
 WHERE p.id = r.id;

COMMIT;
