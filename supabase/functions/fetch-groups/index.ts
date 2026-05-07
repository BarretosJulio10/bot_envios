/**
 * Edge Function: fetch-groups (Fzap v1.23.0)
 *
 * Endpoint Fzap: GET /group/list  (mesmo path da Uazapi ✅)
 * Header: token: <instance_token>  (mesmo da Uazapi ✅)
 * Mudança: parsing da resposta (data.[] ao invés de groups.[])
 */

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
    if (userError || !user) throw new Error('Não autorizado');

    const { data: config, error: configError } = await supabaseClient
      .from('evolution_config')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (configError || !config) throw new Error('Configuração não encontrada');

    const fzapUrl = Deno.env.get('EVOLUTION_API_URL');
    if (!fzapUrl) throw new Error('EVOLUTION_API_URL não configurada');

    if (!config.token) throw new Error('Token da instância não encontrado. Reconecte sua instância.');

    console.log(`[fetch-groups] Buscando grupos de ${fzapUrl}/group/list`);

    // GET /group/list — mesmo endpoint da Uazapi
    const response = await fetch(`${fzapUrl}/group/list`, {
      method: 'GET',
      headers: {
        'token': config.token,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[fetch-groups] Fzap error:', errorText);
      throw new Error(`Erro ao buscar grupos: ${response.status}`);
    }

    const result = await response.json();

    // Fzap pode retornar array direto, em data[], ou em groups[]
    let groupsRaw: any[] = [];
    if (Array.isArray(result)) {
      groupsRaw = result;
    } else if (Array.isArray(result.data)) {
      groupsRaw = result.data;
    } else if (Array.isArray(result.groups)) {
      groupsRaw = result.groups;
    }

    console.log(`[fetch-groups] ${groupsRaw.length} grupos encontrados`);

    const formattedGroups = groupsRaw.map((g: any) => ({
      id: g.id || g.JID || g.jid,
      name: g.name || g.subject || g.Name || 'Sem nome',
      participants: g.participantsCount || g.Participants?.length || g.participants?.length || 0,
    }));

    return new Response(
      JSON.stringify({ success: true, groups: formattedGroups }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[fetch-groups] Erro:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
