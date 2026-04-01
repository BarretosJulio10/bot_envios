/**
 * Edge Function: test-connection (Uazapi 2.0.1)
 * 
 * Endpoint Uazapi: GET /instance/status
 * Header: token (token da instância)
 * 
 * Verifica se a instância do usuário está conectada ao WhatsApp.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
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

    // Buscar config incluindo o token da instância
    const { data: config, error: configError } = await supabase
      .from('evolution_config')
      .select('instance_id, token, base_url')
      .eq('user_id', user.id)
      .single();

    if (configError || !config) {
      return new Response(
        JSON.stringify({ success: false, message: 'Configure sua instância Uazapi primeiro.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!config.token) {
      return new Response(
        JSON.stringify({ success: false, message: 'Token da instância não encontrado. Recrie a instância.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const uazapiUrl = Deno.env.get('EVOLUTION_API_URL') ?? config.base_url;
    if (!uazapiUrl) throw new Error('URL da Uazapi não configurada nos Secrets');

    console.log(`[test-connection] Testando conexão de: ${config.instance_id}`);

    // GET /instance/status — usa o token da instância
    const res = await fetch(`${uazapiUrl}/instance/status`, {
      method: 'GET',
      headers: {
        'token': config.token,
        'Content-Type': 'application/json',
      },
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
    const isConnected = data.status?.connected === true;

    return new Response(
      JSON.stringify({
        success: true,
        connected: isConnected,
        message: isConnected
          ? '✅ WhatsApp conectado e funcionando!'
          : '⚠️ Instância encontrada, mas desconectada. Escaneie o QR Code.',
        data,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[test-connection] Erro:', error.message);
    return new Response(
      JSON.stringify({ success: false, message: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
