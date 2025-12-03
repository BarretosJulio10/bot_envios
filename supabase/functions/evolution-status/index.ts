// TODO: Edge Function para verificar status da instância Evolution
// Usado para detectar quando o QR code foi escaneado e fechar o modal automaticamente

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // TODO: Tratar requisições OPTIONS
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // TODO: Autenticar usuário
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('No authorization header');

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) throw new Error('Unauthorized');

    // TODO: Buscar configuração do usuário (apenas instance_id)
    const { data: config, error: configError } = await supabase
      .from('evolution_config')
      .select('instance_id')
      .eq('user_id', user.id)
      .single();

    if (configError || !config?.instance_id) {
      throw new Error('Configuração não encontrada');
    }

    // TODO: Buscar credenciais dos secrets
    const base_url = Deno.env.get('EVOLUTION_API_URL');
    const global_apikey = Deno.env.get('global_apikay');
    
    if (!base_url || !global_apikey) {
      throw new Error('Configuração da Evolution API não encontrada nos secrets');
    }

    console.log(`Checking status for instance: ${config.instance_id}`);

    // TODO: Fazer requisição GET para verificar estado da conexão
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
      throw new Error(`Erro ao verificar status: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log('Connection state:', result);

    // TODO: Extrair estado da resposta
    // Estados possíveis: "open" (conectado), "close" (desconectado), "connecting"
    const state = result?.instance?.state || 'disconnected';
    const isConnected = state === 'open';

    // TODO: Atualizar status no banco de dados
    let newStatus = 'disconnected';
    if (isConnected) {
      newStatus = 'connected';
    } else if (state === 'connecting') {
      newStatus = 'connecting';
    }

    // TODO: Limpar QR code do banco quando conectar (não precisa mais)
    const updateData: any = {
      connection_status: newStatus,
    };

    if (isConnected) {
      updateData.qr_code = null; // Limpar QR code após conexão bem-sucedida
    }

    await supabase
      .from('evolution_config')
      .update(updateData)
      .eq('user_id', user.id);

    // TODO: Retornar status atualizado
    return new Response(
      JSON.stringify({
        success: true,
        connected: isConnected,
        status: newStatus,
        state,
        message: isConnected 
          ? 'WhatsApp conectado com sucesso!' 
          : `Status: ${state}`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error in evolution-status:', error);
    return new Response(
      JSON.stringify({ 
        success: false,
        connected: false,
        error: error.message 
      }),
      { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
