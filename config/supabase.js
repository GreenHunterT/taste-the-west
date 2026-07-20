// =================================================================
//  Supabase Configuration — fill in after creating your project.
//
//  Find these values at:
//  https://supabase.com/dashboard/project/<your-project>/settings/api
//
//  The anon key is SAFE to commit and expose publicly.
//  It is NOT the service_role key. RLS policies protect the data.
//  NEVER put the service_role key in any frontend file.
// =================================================================

const SUPABASE_URL      = 'https://cblnagqjmlzismkojxud.supabase.co';       // e.g. https://xyzxyz.supabase.co
const SUPABASE_ANON_KEY = 'sb_publishable_Em1qaLuY8YGLROI4nFsIPw_U0GgF2P2';  // eyJhbGci... (anon/public key)

// UUID of the restaurant row — get it after running the seed query in schema.sql.
// Dashboard → Table Editor → restaurants → copy the id column value.
const RESTAURANT_ID = '57ee591f-39fb-4320-af05-fec66ebd512a';         // e.g. a1b2c3d4-e5f6-...
