import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      throw new Error('Não autorizado');
    }

    // Buscar configuração do Evolution
    const { data: config, error: configError } = await supabaseClient
      .from('evolution_config')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (configError || !config) {
      throw new Error('Configuração não encontrada');
    }

    const evolutionUrl = Deno.env.get('EVOLUTION_API_URL');
    const evolutionToken = Deno.env.get('global_apikay');

    if (!evolutionUrl || !evolutionToken) {
      throw new Error('Variáveis de ambiente Evolution não configuradas');
    }

    console.log(`Fetching groups from ${evolutionUrl}/group/fetchAllGroups/${config.instance_id}?getParticipants=true`);

    // Buscar grupos do WhatsApp
    const response = await fetch(
      `${evolutionUrl}/group/fetchAllGroups/${config.instance_id}?getParticipants=true`,
      {
        method: 'GET',
        headers: {
          'apikey': evolutionToken,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Evolution API error:', errorText);
      throw new Error(`Erro ao buscar grupos: ${response.status}`);
    }

    const groups = await response.json();
    console.log(`Found ${groups.length} groups`);

    return new Response(
      JSON.stringify({
        success: true,
        groups: groups.map((g: any) => ({
          id: g.id,
          name: g.subject || 'Sem nome',
          participants: g.participants?.length || 0,
        })),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
