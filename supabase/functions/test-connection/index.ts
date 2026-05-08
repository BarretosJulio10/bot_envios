/**
 * Edge Function: test-connection (Evolution Go API)
 *
 * Endpoint: GET /instance/status  |  apikey = INSTANCE TOKEN
 * Resposta: { data: { Connected: bool, LoggedIn: bool, Name: string } }
 *
 * Campos com inicial MAIÚSCULA: Connected, LoggedIn (diferente do Fzap antigo)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Sem header de autorização');

    const jwt = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !user) throw new Error('Não autorizado');

    const { data: config, error: configError } = await supabase
      .from('evolution_config')
      .select('instance_id, token, base_url')
      .eq('user_id', user.id)
      .single();

    if (configError || !config) {
      return new Response(
        JSON.stringify({ success: false, message: 'Configure sua instância WhatsApp primeiro.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!config.token) {
      return new Response(
        JSON.stringify({ success: false, message: 'Token da instância não encontrado. Recrie a instância.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const apiUrl = Deno.env.get('EVOLUTION_API_URL') ?? config.base_url;
    if (!apiUrl) throw new Error('URL da API não configurada nos Secrets');

    console.log(`[test-connection] Testando: ${config.instance_id}`);

    // GET /instance/status | apikey = INSTANCE TOKEN (Evolution Go)
    const res = await fetch(`${apiUrl}/instance/status`, {
      method: 'GET',
      headers: { 'apikey': config.token },
    });

    const body = await res.text();
    console.log(`[test-connection] Resposta (${res.status}): ${body.substring(0, 200)}`);

    if (!res.ok) {
      return new Response(
        JSON.stringify({ success: false, message: `Instância não encontrada ou token inválido (${res.status})` }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = JSON.parse(body);
    // Evolution Go: campos com inicial MAIÚSCULA (Connected, LoggedIn)
    const isConnected = data.data?.Connected === true;
    const isLoggedIn  = data.data?.LoggedIn  === true;

    return new Response(
      JSON.stringify({
        success: true,
        connected: isLoggedIn,
        message: isLoggedIn
          ? '✅ WhatsApp conectado e funcionando!'
          : isConnected
            ? '⚠️ Sessão iniciada, mas não autenticada. Escaneie o QR Code.'
            : '⚠️ Instância desconectada. Clique em Conectar WhatsApp.',
        data: data.data,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[test-connection] Erro:', error.message);
    return new Response(
      JSON.stringify({ success: false, message: error.message }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
