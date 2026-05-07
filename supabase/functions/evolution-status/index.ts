
/**
 * Edge Function: evolution-status (Master Fullstack Edition)
 * Fluxo: Status Check -> QR Polling (if not logged in) -> DB Update
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
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (configError || !config) throw new Error('Configuração não encontrada');

    const fzapUrl = Deno.env.get('EVOLUTION_API_URL') ?? config.base_url;
    const adminToken = Deno.env.get('global_apikay');
    const instanceToken = config.token;

    if (!fzapUrl || !adminToken || !instanceToken) {
      throw new Error('Configurações de API incompletas (URL/Token)');
    }

    // 1. CHECAR STATUS DA SESSÃO
    const statusRes = await fetch(`${fzapUrl}/session/status`, {
      method: 'GET',
      headers: {
        'apikey': adminToken,
        'token': instanceToken
      }
    });

    const statusData = await statusRes.json();
    console.log(`[Master Status] Resposta Status:`, JSON.stringify(statusData));

    const isLoggedIn = statusData.data?.loggedIn === true;
    const isConnected = statusData.data?.connected === true;

    let qrCode = config.qr_code;

    // 2. SE NÃO ESTIVER LOGADO, BUSCAR QR CODE ATUALIZADO
    if (!isLoggedIn) {
      const qrRes = await fetch(`${fzapUrl}/session/qr`, {
        method: 'GET',
        headers: {
          'apikey': adminToken,
          'token': instanceToken
        }
      });

      if (qrRes.ok) {
        const qrData = await qrRes.json();
        let code = qrData.data?.QRCode ?? "";
        if (code && code.length > 50) {
          if (!code.startsWith('data:')) code = `data:image/png;base64,${code}`;
          qrCode = code;
        }
      }
    }

    // 3. ATUALIZAR BANCO
    const connection_status = isLoggedIn ? 'connected' : (isConnected ? 'connecting' : 'disconnected');
    
    await supabase.from('evolution_config').update({
      connection_status,
      qr_code: isLoggedIn ? null : qrCode,
      updated_at: new Date().toISOString()
    }).eq('user_id', user.id);

    return new Response(
      JSON.stringify({
        success: true,
        connected: isConnected,
        loggedIn: isLoggedIn,
        qrCode: isLoggedIn ? null : qrCode,
        status: connection_status
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[Master Status Error]:', error.message);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
