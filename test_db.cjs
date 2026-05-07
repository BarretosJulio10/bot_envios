const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY);
async function run() {
  try {
    const { data, error } = await supabase.from('evolution_config').select('*').order('updated_at', { ascending: false }).limit(1);
    if (error) throw error;
    console.log(JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(e.message);
  }
}
run();
