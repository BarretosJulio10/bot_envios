// TODO: Edge Function para criar instância automaticamente na Evolution API
// Fluxo: recebe base_url e token -> cria instância -> retorna QR code base64

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // TODO: Tratar requisições OPTIONS (CORS preflight)
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // TODO: Inicializar cliente Supabase para autenticação e acesso ao banco
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('No authorization header');

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) throw new Error('Unauthorized');

    const { instance_name } = await req.json();

    if (!instance_name) {
      throw new Error('instance_name é obrigatório');
    }

    // TODO: Buscar base_url e token dos secrets do Supabase
    const base_url = Deno.env.get('EVOLUTION_API_URL');
    const global_apikey = Deno.env.get('global_apikay');
    
    if (!base_url || !global_apikey) {
      throw new Error('Configuração da Evolution API não encontrada nos secrets');
    }

    console.log(`Creating instance: ${instance_name} for user: ${user.id}`);


    // TODO: Fazer requisição POST para Evolution API para criar instância
    // Rota oficial: POST /instance/create
    const createResponse = await fetch(`${base_url}/instance/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'admintoken': global_apikey, // Uazapi usa admintoken para criação
      },
      body: JSON.stringify({
        name: instance_name,
        systemName: 'uazapiGO',
      }),
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      throw new Error(`Erro ao criar instância: ${createResponse.status} - ${errorText}`);
    }

    const createResult = await createResponse.json();
    console.log('Instance creation response:', createResult);

    // O Uazapi retorna o token no campo 'token' do objeto principal ou dentro de 'instance'
    const instance_token = createResult.token || createResult.instance?.token;

    if (!instance_token) {
      throw new Error('Token da instância não retornado pela Uazapi');
    }

    console.log('Instance token obtained:', instance_token);

    // Uazapi
    // Rota /instance/connect usando o token da instancia no header ou parametros
    const connectResponse = await fetch(
      `${base_url}/instance/connect`,
      {
        method: 'POST', // Uazapi usa POST para conexão
        headers: {
          'token': instance_token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({}), // Corpo vazio para gerar QR Code
      }
    );

    if (!connectResponse.ok) {
      const errorText = await connectResponse.text();
      throw new Error(`Erro ao obter QR code: ${connectResponse.status} - ${errorText}`);
    }

    const connectResult = await connectResponse.json();
    console.log('QR code obtained');

    // TODO: Extrair QR code base64 da resposta
    // O QR code vem no campo "base64" já com o prefixo data:image/png;base64,
    const qrCodeBase64 = connectResult.base64;
    const pairingCode = connectResult.pairingCode;

    // TODO: Salvar configuração no banco com QR code e status "connecting"
    const { error: configError } = await supabase
      .from('evolution_config')
      .upsert({
        user_id: user.id,
        base_url,
        instance_id: instance_name,
        token: instance_token,
        instance_created: true,
        qr_code: qrCodeBase64,
        connection_status: 'connecting',
      }, {
        onConflict: 'user_id',
      });

    if (configError) {
      console.error('Error saving config:', configError);
      throw new Error('Erro ao salvar configuração');
    }

    // TODO: Retornar sucesso com QR code base64 e pairing code
    return new Response(
      JSON.stringify({
        success: true,
        qrCode: qrCodeBase64,
        pairingCode,
        instanceName: instance_name,
        message: 'Instância criada com sucesso! Escaneie o QR code.',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error in evolution-create-instance:', error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error.message 
      }),
      { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
