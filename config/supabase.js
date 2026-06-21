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

const SUPABASE_URL      = 'YOUR_SUPABASE_URL';       // e.g. https://xyzxyz.supabase.co
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';  // eyJhbGci... (anon/public key)

// UUID of the restaurant row — get it after running the seed query in schema.sql.
// Dashboard → Table Editor → restaurants → copy the id column value.
const RESTAURANT_ID = 'YOUR_RESTAURANT_UUID';         // e.g. a1b2c3d4-e5f6-...
