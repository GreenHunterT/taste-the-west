-- =================================================================
--  Migration 003 — Reconcile RLS after the live 002 outage
--  Milestone 1O.3 — records + hardens a fix already applied live
--
--  CONTEXT: 001 created restaurants_public and granted anon SELECT on it.
--  002 then ran `REVOKE SELECT ON public.restaurants FROM anon`. Both were
--  correct in isolation, but 002 exposed a pre-existing defect this
--  migration now fixes at the source, plus tightens privilege beyond what
--  was strictly required to stop the outage. 001/002 are NOT rewritten —
--  they are already applied live; this is an append-only follow-up.
--
--  ROOT CAUSE OF THE OUTAGE (confirmed against both the live
--  `pg_policies` inspection and this repo's pre-003 schema.sql):
--  `products_owner_read`, `products_owner_insert/update/delete`, and the
--  categories/restaurants owner policies were all created WITHOUT an
--  explicit `TO <role>` clause. A CREATE POLICY with no TO clause applies
--  to PUBLIC — i.e. every role, including anon — not just its intended
--  `authenticated` owner. Postgres RLS evaluates ALL applicable permissive
--  policies for a command and OR's their results, so an anonymous SELECT
--  on `products` had to evaluate BOTH `products_public_read`
--  (`available = true`, harmless) AND `products_owner_read`
--  (`restaurant_id IN (SELECT id FROM restaurants WHERE owner_id =
--  auth.uid())`) — even though anon could never satisfy the second one.
--  Evaluating that subquery AS anon requires SELECT on the base
--  `restaurants` table; once 002 revoked that grant, the subquery itself
--  raised "permission denied for table restaurants" instead of quietly
--  evaluating to false — and a hard permission error during RLS
--  evaluation aborts the WHOLE query, not just that one policy's
--  contribution. `categories` has no owner SELECT policy at all (only
--  owner insert/update/delete, which SELECT never evaluates), which is
--  exactly why `categories` kept working while `products` broke.
--
--  This migration's job: scope every owner policy to `TO authenticated`
--  explicitly (so anon never evaluates them at all), scope every public
--  policy to `TO anon` explicitly, retire the now-redundant base-table
--  `restaurants_public_read`, add the owner SELECT policy Admin actually
--  depends on (restaurants_owner_select — see admin/js/auth.js
--  getMyRestaurant() and admin/js/admin-shell.js's restaurant-identity
--  load; categories_owner_read — see admin/js/views/categories.js's
--  loadAll()), retire restaurant INSERT/DELETE entirely (repository
--  search found no active callsite for either — the only base-table
--  `restaurants` calls anywhere in js/app.js or admin/ are SELECT
--  (admin/js/auth.js, admin/js/admin-shell.js) and UPDATE
--  (admin/js/views/settings.js); this app never creates or deletes a
--  restaurant row from the browser — restaurant provisioning is a manual
--  one-time SQL step, see schema.sql's seed block), and reset every
--  relevant relation's table-level grants to a closed-world baseline
--  (REVOKE ALL, then GRANT back exactly the intended set) rather than
--  selectively revoking individual privileges off of an unknown starting
--  grant state.
--
--  Idempotent by construction: DROP POLICY IF EXISTS + CREATE POLICY for
--  every policy touched (ALTER POLICY cannot safely add/change a TO list
--  in one step across an unknown drifted starting state — see the manual
--  live fix in the 1O.3 report, which used ALTER POLICY successfully only
--  because its exact starting shape was already known); REVOKE ALL on a
--  relation with no privileges left to revoke is a silent no-op, not an
--  error, so this is equally safe to run against the fresh state or the
--  live drifted one.
-- =================================================================

-- Explicit transaction: if any statement below fails, everything applied
-- so far in this run rolls back rather than leaving a partially-applied
-- security state (some tables re-scoped, others still pre-003).
BEGIN;

-- ── RESTAURANTS ──────────────────────────────────────────────────
-- Public customers no longer need base-table read access at all — they
-- have used `restaurants_public` (001) since the 1O rollout, and that view
-- runs as its owning role (not RLS-subject — see 001's own comment), so it
-- needs no policy here to keep working. Keeping a broad `USING (true)`
-- base-table SELECT around anyway, just because anon's table-level grant
-- happens to be revoked, is not defense in depth — a future re-grant
-- mistake would instantly re-expose every column again. Retire it outright.
DROP POLICY IF EXISTS "restaurants_public_read" ON public.restaurants;

-- Replaces the accidental reliance on restaurants_public_read's
-- `USING (true)` for Admin's own restaurant-identity SELECT (§7 of the
-- 1O.3 brief). Scoped to authenticated + the row's actual owner only — a
-- random authenticated user with no owned restaurant sees zero rows here,
-- matching admin-shell.js's existing fail-closed handling of that case.
DROP POLICY IF EXISTS "restaurants_owner_select" ON public.restaurants;
CREATE POLICY "restaurants_owner_select"
  ON public.restaurants FOR SELECT
  TO authenticated
  USING (auth.uid() = owner_id);

-- No restaurants_owner_insert / restaurants_owner_delete: a repository
-- search of every `.from('restaurants')` / `/rest/v1/restaurants` callsite
-- in js/app.js and admin/ found none that INSERT or DELETE — restaurant
-- rows are provisioned once, manually, via schema.sql's seed block, never
-- from the browser. Dropped outright rather than recreated, so a random
-- authenticated user (or a compromised owner session) cannot self-enroll
-- a new restaurant or delete the existing one even in principle — there
-- is no policy that would ever permit it, regardless of what auth.uid()
-- is. If a real INSERT/DELETE need is ever added to the app, it must
-- come with its own reviewed policy at that time, not a standing one
-- kept "just in case."
DROP POLICY IF EXISTS "restaurants_owner_insert" ON public.restaurants;
DROP POLICY IF EXISTS "restaurants_owner_delete" ON public.restaurants;

-- WITH CHECK is explicit (not merely relying on Postgres's documented
-- fallback of reusing USING when WITH CHECK is omitted on UPDATE) so a
-- future reader never has to know that rule to see the guarantee: an
-- owner can update their own row, but the POST-update row must still
-- have owner_id = auth.uid() — it can never be reassigned to someone else.
DROP POLICY IF EXISTS "restaurants_owner_update" ON public.restaurants;
CREATE POLICY "restaurants_owner_update"
  ON public.restaurants FOR UPDATE
  TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);


-- ── CATEGORIES ───────────────────────────────────────────────────
-- Scoped to anon explicitly (was implicit PUBLIC) and to exactly
-- TasteTheWest's one row — this is a dedicated single-restaurant project
-- (see 001's own "WHY (ROWS)" comment); a future second restaurant row
-- must not become publicly enumerable just because this policy said
-- `USING (true)`.
DROP POLICY IF EXISTS "categories_public_read" ON public.categories;
CREATE POLICY "categories_public_read"
  ON public.categories FOR SELECT
  TO anon
  USING (restaurant_id = '57ee591f-39fb-4320-af05-fec66ebd512a'::uuid);

-- NEW — categories had no owner SELECT policy at all before this
-- migration; Admin's Categories editor (admin/js/views/categories.js
-- loadAll()) reads via the authenticated session and, once
-- categories_public_read above is scoped to anon only, needs its own
-- explicit grant to keep working. Mirrors products_owner_read.
DROP POLICY IF EXISTS "categories_owner_read" ON public.categories;
CREATE POLICY "categories_owner_read"
  ON public.categories FOR SELECT
  TO authenticated
  USING (restaurant_id IN (SELECT id FROM public.restaurants WHERE owner_id = auth.uid()));

DROP POLICY IF EXISTS "categories_owner_insert" ON public.categories;
CREATE POLICY "categories_owner_insert"
  ON public.categories FOR INSERT
  TO authenticated
  WITH CHECK (restaurant_id IN (SELECT id FROM public.restaurants WHERE owner_id = auth.uid()));

-- WITH CHECK explicit, same reasoning as restaurants_owner_update above:
-- an owner cannot UPDATE a category's restaurant_id to point at a
-- restaurant they don't own — the post-update row is re-checked against
-- the same ownership condition.
DROP POLICY IF EXISTS "categories_owner_update" ON public.categories;
CREATE POLICY "categories_owner_update"
  ON public.categories FOR UPDATE
  TO authenticated
  USING (restaurant_id IN (SELECT id FROM public.restaurants WHERE owner_id = auth.uid()))
  WITH CHECK (restaurant_id IN (SELECT id FROM public.restaurants WHERE owner_id = auth.uid()));

DROP POLICY IF EXISTS "categories_owner_delete" ON public.categories;
CREATE POLICY "categories_owner_delete"
  ON public.categories FOR DELETE
  TO authenticated
  USING (restaurant_id IN (SELECT id FROM public.restaurants WHERE owner_id = auth.uid()));


-- ── PRODUCTS ─────────────────────────────────────────────────────
-- This pair (public_read scoped to anon + owner_read scoped to
-- authenticated) is the actual fix for the live outage — it is what was
-- manually applied via ALTER POLICY during the incident; recorded here as
-- CREATE POLICY (via drop+create) so a fresh project — or this project
-- rebuilt from schema.sql — lands in the same fixed state without anyone
-- needing to know about the incident.
DROP POLICY IF EXISTS "products_public_read" ON public.products;
CREATE POLICY "products_public_read"
  ON public.products FOR SELECT
  TO anon
  USING (available = true AND restaurant_id = '57ee591f-39fb-4320-af05-fec66ebd512a'::uuid);

-- Scoping this to `TO authenticated` (it was implicit PUBLIC before) is
-- the actual root-cause fix — see this file's header comment. Anon no
-- longer ever evaluates this policy's restaurants-subquery at all.
DROP POLICY IF EXISTS "products_owner_read" ON public.products;
CREATE POLICY "products_owner_read"
  ON public.products FOR SELECT
  TO authenticated
  USING (restaurant_id IN (SELECT id FROM public.restaurants WHERE owner_id = auth.uid()));

DROP POLICY IF EXISTS "products_owner_insert" ON public.products;
CREATE POLICY "products_owner_insert"
  ON public.products FOR INSERT
  TO authenticated
  WITH CHECK (restaurant_id IN (SELECT id FROM public.restaurants WHERE owner_id = auth.uid()));

-- WITH CHECK explicit, same reasoning as restaurants_owner_update above:
-- an owner cannot UPDATE a product's restaurant_id to point at a
-- restaurant they don't own — the post-update row is re-checked against
-- the same ownership condition.
DROP POLICY IF EXISTS "products_owner_update" ON public.products;
CREATE POLICY "products_owner_update"
  ON public.products FOR UPDATE
  TO authenticated
  USING (restaurant_id IN (SELECT id FROM public.restaurants WHERE owner_id = auth.uid()))
  WITH CHECK (restaurant_id IN (SELECT id FROM public.restaurants WHERE owner_id = auth.uid()));

DROP POLICY IF EXISTS "products_owner_delete" ON public.products;
CREATE POLICY "products_owner_delete"
  ON public.products FOR DELETE
  TO authenticated
  USING (restaurant_id IN (SELECT id FROM public.restaurants WHERE owner_id = auth.uid()));


-- ── TABLE GRANTS — CLOSED-WORLD RESET ──────────────────────────────
-- None of these privileges were ever explicitly granted by this repo —
-- `products`/`categories`/`restaurants`/`restaurants_public` picked up
-- SELECT/INSERT/UPDATE/DELETE/REFERENCES/TRIGGER/TRUNCATE for anon and
-- authenticated from Supabase's own default privileges at table-creation
-- time. Rather than selectively REVOKE individual privileges off of an
-- unknown, possibly-still-drifted starting grant state (which only ever
-- proves absent exactly the privileges it names), REVOKE ALL first on
-- each relation for both roles — a genuine closed-world reset, so the
-- GRANTs immediately below are a complete, self-contained statement of
-- the entire intended privilege surface, not a diff against an assumption.
-- REVOKE ALL on a relation with nothing left to revoke is a silent
-- no-op, not an error — safe against any starting state.
REVOKE ALL PRIVILEGES ON public.restaurants        FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON public.products           FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON public.categories         FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON public.restaurants_public FROM anon, authenticated;

-- anon: SELECT only, and never on the restaurants base table at all —
-- public reads go exclusively through restaurants_public (see that
-- view's own comment for why it needs no base-table grant to work).
GRANT SELECT
  ON public.products, public.categories, public.restaurants_public
  TO anon;

-- authenticated: SELECT + UPDATE on restaurants (Admin reads its own row
-- and edits Settings — never creates or deletes one, see the
-- restaurants_owner_insert/delete comment above); full SELECT/INSERT/
-- UPDATE/DELETE on products/categories (Admin's actual Menu/Categories
-- CRUD); SELECT only on restaurants_public (not required by Admin, but
-- harmless and consistent with anon's own access to the same safe view).
GRANT SELECT, UPDATE
  ON public.restaurants
  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.products, public.categories
  TO authenticated;
GRANT SELECT
  ON public.restaurants_public
  TO authenticated;

COMMIT;

-- Schema USAGE and any sequence/function privileges anon/authenticated
-- already hold are untouched — this migration only ever resets table-
-- level DML/DDL-adjacent privileges on these four relations, never
-- schema access, Storage, Auth, or service_role.
