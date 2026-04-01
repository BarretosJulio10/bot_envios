/**
 * Edge Function: evolution-create-instance (Uazapi 2.0.1)
 * 
 * Fluxo:
 * 1. Recebe instance_name do frontend
 * 2. Cria instância via POST /instance/create (admintoken)
 * 3. Captura o token retornado pela Uazapi
 * 4. Conecta via POST /instance/connect (token) → gera QR Code
 * 5. Salva config no banco (token, qrcode, status)
 * 6. Retorna QR Code para o frontend exibir
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

    // Autenticar usuário
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Sem header de autorização');

    const jwt = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !user) throw new Error('Não autorizado');

    const { instance_name } = await req.json();
    if (!instance_name) throw new Error('instance_name é obrigatório');

    // Credenciais do servidor Uazapi (configuradas nos Supabase Secrets)
    const uazapiUrl = Deno.env.get('EVOLUTION_API_URL');   // ex: https://api.uazapi.com
    const adminToken = Deno.env.get('global_apikay');       // admintoken da Uazapi

    if (!uazapiUrl || !adminToken) {
      throw new Error('EVOLUTION_API_URL ou global_apikay não configurados nos Secrets');
    }

    console.log(`[create-instance] Criando instância: ${instance_name} para usuário: ${user.id}`);

    // ───────────────────────────────────────────────
    // PASSO 1: Criar a instância (usa admintoken)
    // POST /instance/create
    // Header: admintoken
    // Body: { name: string, systemName?: string }
    // Response: { token: string, instance: { qrcode, paircode, status, ... }, ... }
    // ───────────────────────────────────────────────
    const createRes = await fetch(`${uazapiUrl}/instance/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'admintoken': adminToken,
      },
      body: JSON.stringify({
        name: instance_name,
        systemName: 'uazapiGO',
      }),
    });

    const createBody = await createRes.text();
    console.log(`[create-instance] Resposta do create: ${createRes.status} ${createBody}`);

    if (!createRes.ok) {
      throw new Error(`Erro ao criar instância (${createRes.status}): ${createBody}`);
    }

    const createData = JSON.parse(createBody);

    // O token da instância é retornado diretamente no campo 'token'
    const instanceToken = createData.token;
    if (!instanceToken) {
      throw new Error(`Token não retornado pela Uazapi. Resposta: ${createBody}`);
    }

    console.log(`[create-instance] Token da instância obtido: ${instanceToken.substring(0, 8)}...`);

    // ───────────────────────────────────────────────
    // PASSO 2: Conectar a instância para gerar QR Code
    // POST /instance/connect
    // Header: token (token da instância, NÃO o admintoken)
    // Body: {} (sem phone = gera QR Code; com phone = gera pairing code)
    // Response: { connected, loggedIn, jid, instance: { qrcode, paircode, status } }
    // ───────────────────────────────────────────────
    const connectRes = await fetch(`${uazapiUrl}/instance/connect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'token': instanceToken,
      },
      body: JSON.stringify({}),
    });

    const connectBody = await connectRes.text();
    console.log(`[create-instance] Resposta do connect: ${connectRes.status} ${connectBody.substring(0, 200)}`);

    if (!connectRes.ok) {
      throw new Error(`Erro ao conectar instância (${connectRes.status}): ${connectBody}`);
    }

    const connectData = JSON.parse(connectBody);

    // QR Code e pairing code estão dentro de 'instance'
    const qrCode   = connectData.instance?.qrcode   ?? connectData.qrcode   ?? null;
    const pairingCode = connectData.instance?.paircode ?? connectData.paircode ?? null;

    // ───────────────────────────────────────────────
    // PASSO 3: Salvar configuração no banco de dados
    // ───────────────────────────────────────────────
    const { error: dbError } = await supabase
      .from('evolution_config')
      .upsert({
        user_id: user.id,
        base_url: uazapiUrl,
        instance_id: instance_name,
        token: instanceToken,       // Token da instância (necessário para envios)
        instance_created: true,
        qr_code: qrCode,
        connection_status: 'connecting',
      }, { onConflict: 'user_id' });

    if (dbError) {
      console.error('[create-instance] Erro ao salvar config:', dbError);
      throw new Error('Erro ao salvar configuração no banco');
    }

    return new Response(
      JSON.stringify({
        success: true,
        qrCode,
        pairingCode,
        instanceName: instance_name,
        message: qrCode
          ? 'Instância criada! Escaneie o QR Code com seu WhatsApp.'
          : 'Instância criada. Aguardando QR Code...',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[create-instance] Erro:', error.message);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
