// TODO: Edge Function para testar conexão simples com Evolution API
// Faz ping na API e verifica se as credenciais estão corretas

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // TODO: Tratar requisições OPTIONS (CORS)
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // TODO: Inicializar cliente Supabase para buscar configuração do usuário
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('No authorization header');

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) throw new Error('Unauthorized');

    // TODO: Buscar credenciais dos secrets
    const base_url = Deno.env.get('EVOLUTION_API_URL');
    const global_apikey = Deno.env.get('global_apikay');
    
    if (!base_url || !global_apikey) {
      throw new Error('Configuração da Evolution API não encontrada nos secrets');
    }

    // TODO: Buscar instance_id do banco
    const { data: config, error: configError } = await supabase
      .from('evolution_config')
      .select('instance_id')
      .eq('user_id', user.id)
      .single();

    if (configError || !config?.instance_id) {
      throw new Error('Configure a instância primeiro');
    }

    console.log(`Testing connection to ${base_url} for instance ${config.instance_id}`);

    // TODO: Testar conexão com Evolution API usando rota correta
    // Rota oficial: GET /instance/connectionState/{instance}
    const response = await fetch(
      `${base_url}/instance/connectionState/${config.instance_id}`,
      {
        method: 'GET',
        headers: {
          'apikey': global_apikey,
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Evolution API error:', response.status, errorText);
      
      // TODO: Tratar erro 404 (instância não encontrada) de forma amigável
      if (response.status === 404) {
        throw new Error('Instância não encontrada. Verifique o Instance ID.');
      }
      
      throw new Error(`Evolution API error (${response.status}): ${errorText}`);
    }

    const result = await response.json();
    console.log('Connection test result:', result);

    // TODO: Verificar estado da instância
    // Estados possíveis: "open" (conectado), "close" (desconectado)
    const state = result?.instance?.state;
    const isConnected = state === 'open';
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        connected: isConnected,
        instanceState: state,
        message: isConnected 
          ? '✅ Conexão ativa — WhatsApp conectado!' 
          : `⚠️ Instância encontrada, mas não conectada. Estado: ${state}. Por favor, conecte via QR Code.`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error in test-connection function:', error);
    return new Response(
      JSON.stringify({ 
        success: false,
        connected: false,
        error: `❌ Erro: ${error.message}`
      }),
      { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
