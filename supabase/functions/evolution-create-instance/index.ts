/**
 * Edge Function: whatsapp-create-instance (Evolution Go API)
 *
 * Fluxo oficial Evolution Go:
 * 1. POST /instance/create  (apikey = ADMIN KEY)  → retorna data.token da instância
 * 2. POST /instance/connect (apikey = INSTANCE TOKEN) → inicia websocket
 * 3. GET  /instance/qr      (apikey = INSTANCE TOKEN) → polling p/ data.Qrcode
 *
 * Autenticação: APENAS header "apikey"
 *   - Admin routes: apikey = global admin key
 *   - Instance routes: apikey = instance token
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
    if (!authHeader) throw new Error('Header Authorization ausente');
    const jwt = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !user) throw new Error('Usuário não autorizado');

    const body = await req.json();
    const instance_name = body.instance_name;
    if (!instance_name) throw new Error('Nome da instância é obrigatório');

    const apiUrl   = Deno.env.get('EVOLUTION_API_URL');
    const adminKey = Deno.env.get('global_apikay');

    if (!apiUrl || !adminKey) {
      throw new Error('EVOLUTION_API_URL ou global_apikay não configurados nos Secrets');
    }

    console.log(`[whatsapp] Criando instância: ${instance_name}`);

    // ── PASSO 1: Criar instância ────────────────────────────────────────────
    // POST /instance/create  |  apikey = ADMIN KEY
    const createRes = await fetch(`${apiUrl}/instance/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': adminKey,
      },
      body: JSON.stringify({ name: instance_name }),
    });

    const createText = await createRes.text();
    console.log(`[whatsapp] Create response (${createRes.status}): ${createText.substring(0, 300)}`);

    if (!createRes.ok) {
      throw new Error(`Falha ao criar instância (${createRes.status}): ${createText}`);
    }

    const createData = JSON.parse(createText);
    // Evolution Go retorna: { data: { token: "...", name: "...", ... }, message: "success" }
    const instanceToken = createData.data?.token;
    if (!instanceToken) {
      throw new Error(`Token não retornado. Resposta: ${createText}`);
    }

    console.log(`[whatsapp] Instância criada. Token: ${instanceToken.substring(0, 8)}...`);

    // ── PASSO 2: Conectar instância ─────────────────────────────────────────
    // POST /instance/connect  |  apikey = INSTANCE TOKEN
    console.log(`[whatsapp] Conectando instância...`);
    const connectRes = await fetch(`${apiUrl}/instance/connect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': instanceToken,
      },
      body: JSON.stringify({ immediate: true }),
    });

    const connectText = await connectRes.text();
    console.log(`[whatsapp] Connect response (${connectRes.status}): ${connectText.substring(0, 300)}`);

    // ── PASSO 3: Polling para QR Code ───────────────────────────────────────
    // GET /instance/qr  |  apikey = INSTANCE TOKEN
    // Campo retornado: data.Qrcode (Q maiúsculo, r/c minúsculo!)
    let qrCode = '';
    console.log(`[whatsapp] Iniciando polling do QR Code...`);

    for (let attempt = 1; attempt <= 8; attempt++) {
      await new Promise(r => setTimeout(r, 2000)); // aguarda 2s entre tentativas

      const qrRes = await fetch(`${apiUrl}/instance/qr`, {
        method: 'GET',
        headers: { 'apikey': instanceToken },
      });

      const qrText = await qrRes.text();
      console.log(`[whatsapp] QR tentativa ${attempt} (${qrRes.status}): ${qrText.substring(0, 150)}`);

      if (qrRes.ok) {
        const qrData = JSON.parse(qrText);
        // ATENÇÃO: Campo é "Qrcode" (não "QRCode"!)
        const code = qrData.data?.Qrcode ?? '';
        if (code && code.length > 50) {
          qrCode = code.startsWith('data:') ? code : `data:image/png;base64,${code}`;
          console.log(`[whatsapp] QR Code obtido com sucesso na tentativa ${attempt}!`);
          break;
        }
      }
    }

    // ── PASSO 4: Salvar no banco ────────────────────────────────────────────
    const { error: upsertError } = await supabase
      .from('evolution_config')
      .upsert({
        user_id: user.id,
        instance_id: instance_name,
        token: instanceToken,
        base_url: apiUrl,
        connection_status: 'connecting',
        qr_code: qrCode || null,
        instance_created: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

    if (upsertError) {
      console.error('[whatsapp] Erro ao salvar no banco:', upsertError);
      throw new Error('Erro ao salvar configuração no banco');
    }

    console.log(`[whatsapp] ✅ Instância ${instance_name} criada e salva. QR: ${qrCode ? 'SIM' : 'Aguardando...'}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: qrCode ? 'QR Code gerado com sucesso!' : 'Instância criada. Aguardando QR Code...',
        qrCode: qrCode || null,
        instance_id: instance_name,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[whatsapp] Erro:', error.message);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
