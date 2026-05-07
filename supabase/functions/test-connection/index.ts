/**
 * Edge Function: test-connection (Fzap v1.23.0)
 * Endpoint Fzap: GET /session/status  (era GET /instance/status)
 * Header: token: <instance_token>
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
        JSON.stringify({ success: false, message: 'Configure sua instância Fzap primeiro.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!config.token) {
      return new Response(
        JSON.stringify({ success: false, message: 'Token da instância não encontrado. Recrie a instância.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const fzapUrl = Deno.env.get('EVOLUTION_API_URL') ?? config.base_url;
    if (!fzapUrl) throw new Error('URL da Fzap não configurada nos Secrets');

    console.log(`[test-connection] Testando conexão: ${config.instance_id}`);

    // GET /session/status (era GET /instance/status)
    const res = await fetch(`${fzapUrl}/session/status`, {
      method: 'GET',
      headers: { 'token': config.token, 'Content-Type': 'application/json' },
    });

    const body = await res.text();
    console.log(`[test-connection] Resposta: ${res.status} ${body.substring(0, 200)}`);

    if (!res.ok) {
      return new Response(
        JSON.stringify({ success: false, message: `Instância não encontrada ou token inválido (${res.status})` }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = JSON.parse(body);
    // Fzap: loggedIn = WhatsApp autenticado
    const isConnected = data.data?.loggedIn === true;

    return new Response(
      JSON.stringify({
        success: true,
        connected: isConnected,
        message: isConnected
          ? '✅ WhatsApp conectado e funcionando!'
          : '⚠️ Instância encontrada, mas desconectada. Escaneie o QR Code.',
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
