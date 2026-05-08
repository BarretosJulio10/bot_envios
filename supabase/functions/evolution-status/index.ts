/**
 * Edge Function: whatsapp-status (Evolution Go API)
 *
 * GET /instance/status  |  apikey = INSTANCE TOKEN
 * GET /instance/qr      |  apikey = INSTANCE TOKEN
 *
 * Campos de resposta:
 *   status:  data.Connected, data.LoggedIn  (ambos com inicial maiúscula)
 *   QR Code: data.Qrcode                    (Q maiúsculo, r/c minúsculo)
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

    // Buscar configuração do banco
    const { data: config, error: configError } = await supabase
      .from('evolution_config')
      .select('instance_id, token, base_url, connection_status, qr_code')
      .eq('user_id', user.id)
      .single();

    if (configError || !config) {
      throw new Error('Configuração da instância não encontrada. Configure primeiro.');
    }

    if (!config.token) {
      throw new Error('Token da instância não encontrado. Reconecte a instância.');
    }

    const apiUrl       = Deno.env.get('EVOLUTION_API_URL') ?? config.base_url;
    const instanceToken = config.token;

    if (!apiUrl) throw new Error('URL da API não configurada');

    console.log(`[whatsapp-status] Verificando status: ${config.instance_id}`);

    // ── GET /instance/status  |  apikey = INSTANCE TOKEN ───────────────────
    const statusRes = await fetch(`${apiUrl}/instance/status`, {
      method: 'GET',
      headers: { 'apikey': instanceToken },
    });

    const statusText = await statusRes.text();
    console.log(`[whatsapp-status] Status response (${statusRes.status}): ${statusText.substring(0, 200)}`);

    // Campos com inicial MAIÚSCULA na Evolution Go: Connected, LoggedIn
    let isConnected = false;
    let isLoggedIn  = false;

    if (statusRes.ok) {
      const statusData = JSON.parse(statusText);
      isConnected = statusData.data?.Connected === true;
      isLoggedIn  = statusData.data?.LoggedIn  === true;
    }

    // ── GET /instance/qr  |  apikey = INSTANCE TOKEN ───────────────────────
    // Campo: data.Qrcode (Q maiúsculo, r/c minúsculo!)
    let qrCode: string | null = config.qr_code ?? null;

    if (!isLoggedIn) {
      const qrRes = await fetch(`${apiUrl}/instance/qr`, {
        method: 'GET',
        headers: { 'apikey': instanceToken },
      });

      const qrText = await qrRes.text();
      console.log(`[whatsapp-status] QR response (${qrRes.status}): ${qrText.substring(0, 100)}...`);

      if (qrRes.ok) {
        const qrData = JSON.parse(qrText);
        const code = qrData.data?.Qrcode ?? '';
        if (code && code.length > 50) {
          qrCode = code.startsWith('data:') ? code : `data:image/png;base64,${code}`;
          console.log(`[whatsapp-status] ✅ QR Code atualizado!`);
        }
      }
    } else {
      // Logado: limpar QR Code do banco
      qrCode = null;
      console.log(`[whatsapp-status] ✅ WhatsApp conectado e logado!`);
    }

    // ── Atualizar banco ─────────────────────────────────────────────────────
    const newStatus = isLoggedIn ? 'connected' : (isConnected ? 'connecting' : 'disconnected');

    await supabase
      .from('evolution_config')
      .update({
        connection_status: newStatus,
        qr_code: isLoggedIn ? null : qrCode,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id);

    return new Response(
      JSON.stringify({
        success: true,
        connected: isConnected,
        loggedIn: isLoggedIn,
        qrCode: isLoggedIn ? null : qrCode,
        status: newStatus,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[whatsapp-status] Erro:', error.message);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
