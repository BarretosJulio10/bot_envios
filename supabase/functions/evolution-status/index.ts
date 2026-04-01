/**
 * Edge Function: evolution-status (Uazapi 2.0.1)
 * 
 * Endpoint Uazapi: GET /instance/status
 * Header: token (token da instância, não admintoken)
 * 
 * Response: {
 *   instance: { status, qrcode, paircode, name, profileName, ... },
 *   status: { connected: bool, loggedIn: bool, jid: ... }
 * }
 * 
 * Esta função faz polling para verificar se o QR Code foi escaneado.
 * Retorna { connected: true } quando a instância estiver online.
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

    // Autenticar usuário
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Sem header de autorização');

    const jwt = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !user) throw new Error('Não autorizado');

    // Buscar config do banco (inclui token da instância)
    const { data: config, error: configError } = await supabase
      .from('evolution_config')
      .select('instance_id, token, base_url, connection_status')
      .eq('user_id', user.id)
      .single();

    if (configError || !config) {
      throw new Error('Configuração Uazapi não encontrada. Configure sua instância primeiro.');
    }

    if (!config.token) {
      throw new Error('Token da instância não encontrado. Reconecte a instância.');
    }

    const uazapiUrl = Deno.env.get('EVOLUTION_API_URL') ?? config.base_url;
    if (!uazapiUrl) throw new Error('URL da Uazapi não configurada');

    console.log(`[evolution-status] Verificando status de: ${config.instance_id}`);

    // ───────────────────────────────────────────────
    // GET /instance/status
    // Header: token (token da instância)
    // Response: { status: { connected, loggedIn, jid }, instance: { status, qrcode, paircode } }
    // ───────────────────────────────────────────────
    const statusRes = await fetch(`${uazapiUrl}/instance/status`, {
      method: 'GET',
      headers: {
        'token': config.token,
        'Content-Type': 'application/json',
      },
    });

    const statusBody = await statusRes.text();
    console.log(`[evolution-status] Resposta: ${statusRes.status} ${statusBody.substring(0, 300)}`);

    if (!statusRes.ok) {
      throw new Error(`Erro ao verificar status (${statusRes.status}): ${statusBody}`);
    }

    const statusData = JSON.parse(statusBody);

    const isConnected = statusData.status?.connected === true;
    const instanceStatus = statusData.instance?.status ?? 'unknown';
    const qrCode = statusData.instance?.qrcode ?? null;
    const pairingCode = statusData.instance?.paircode ?? null;

    // Atualizar status no banco se mudou
    if (isConnected && config.connection_status !== 'open') {
      await supabase
        .from('evolution_config')
        .update({ connection_status: 'open' })
        .eq('user_id', user.id);
    } else if (!isConnected && qrCode && config.connection_status !== 'connecting') {
      await supabase
        .from('evolution_config')
        .update({ connection_status: 'connecting', qr_code: qrCode })
        .eq('user_id', user.id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        connected: isConnected,
        instanceStatus,
        qrCode,
        pairingCode,
        data: statusData,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[evolution-status] Erro:', error.message);
    return new Response(
      JSON.stringify({ success: false, message: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
