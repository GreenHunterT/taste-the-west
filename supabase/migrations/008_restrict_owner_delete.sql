-- =================================================================
--  Migration 008 — restaurants.owner_id: ON DELETE CASCADE → RESTRICT
--
--  Deleting the owner's Auth user used to delete the restaurant row and,
--  through categories/products ON DELETE CASCADE, the entire menu. With
--  RESTRICT that delete fails instead. To change owner, re-point owner_id
--  first, then remove the old user.
--
--  Changes no data. Safe to re-run: if the owner FK is already RESTRICT
--  (for example fixed by hand in the dashboard) it does nothing.
--
--  ROLLOUT: run any time — the app code does not depend on it.
-- =================================================================

BEGIN;

DO $$
DECLARE
  v_attnum SMALLINT;
  r RECORD;
BEGIN
  SELECT attnum INTO v_attnum FROM pg_attribute
   WHERE attrelid = 'public.restaurants'::regclass AND attname = 'owner_id';

  -- Drop any owner_id → auth.users FK whose delete rule is not RESTRICT…
  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.restaurants'::regclass AND contype = 'f'
       AND confrelid = 'auth.users'::regclass AND conkey = ARRAY[v_attnum]
       AND confdeltype <> 'r'
  LOOP
    EXECUTE format('ALTER TABLE public.restaurants DROP CONSTRAINT %I', r.conname);
  END LOOP;

  -- …and make sure exactly one RESTRICT FK exists.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.restaurants'::regclass AND contype = 'f'
       AND confrelid = 'auth.users'::regclass AND conkey = ARRAY[v_attnum]
  ) THEN
    ALTER TABLE public.restaurants
      ADD CONSTRAINT restaurants_owner_id_fkey
      FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE RESTRICT;
  END IF;
END
$$;

COMMIT;
