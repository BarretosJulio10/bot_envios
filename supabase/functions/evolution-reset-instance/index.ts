/**
 * Edge Function: evolution-reset-instance (Uazapi 2.0.1)
 *
 * Responsabilidades:
 * 1. Desconectar a instância na Uazapi via POST /instance/disconnect
 * 2. Limpar o estado no banco (qr_code, instance_created, connection_status)
 * 3. Retornar sucesso para o frontend reiniciar o fluxo do zero
 *
 * Endpoints Uazapi utilizados:
 *   POST /instance/disconnect  → Header: token  → Encerra sessão, exige novo QR
 *   POST /instance/reset       → Header: token  → Reset controlado do runtime (fallback)
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

    // ── Autenticação ─────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Sem header de autorização');

    const jwt = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !user) throw new Error('Não autorizado');

    // ── Buscar config do banco ─────────────────────────────────────────────
    const { data: config, error: configError } = await supabase
      .from('evolution_config')
      .select('instance_id, token, base_url')
      .eq('user_id', user.id)
      .single();

    if (configError || !config) {
      // Sem config: limpar banco e retornar — permite começar do zero
      console.log('[reset-instance] Sem config no banco. Nada a desconectar.');
      return new Response(
        JSON.stringify({ success: true, message: 'Estado limpo. Pode criar uma nova instância.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const uazapiUrl = Deno.env.get('EVOLUTION_API_URL') ?? config.base_url;
    const instanceToken = config.token;

    // ── Tentar desconectar na Uazapi (melhor esforço) ─────────────────────
    if (uazapiUrl && instanceToken) {
      try {
        console.log(`[reset-instance] Desconectando instância: ${config.instance_id}`);

        const disconnectRes = await fetch(`${uazapiUrl}/instance/disconnect`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'token': instanceToken,
          },
        });

        const disconnectBody = await disconnectRes.text();
        console.log(`[reset-instance] Disconnect: ${disconnectRes.status} ${disconnectBody.substring(0, 150)}`);

        // Se disconnect falhou (ex: instância já inexistente), tentar reset como fallback
        if (!disconnectRes.ok) {
          console.warn('[reset-instance] Disconnect falhou. Tentando reset...');
          const resetRes = await fetch(`${uazapiUrl}/instance/reset`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'token': instanceToken,
            },
          });
          const resetBody = await resetRes.text();
          console.log(`[reset-instance] Reset: ${resetRes.status} ${resetBody.substring(0, 150)}`);
          // Não lançar erro aqui — mesmo que o reset/disconnect falhe,
          // limpamos o banco para permitir nova tentativa
        }
      } catch (apiErr: any) {
        // Erro de rede com a Uazapi — logar mas continuar para limpar o banco
        console.error('[reset-instance] Erro ao chamar Uazapi (ignorado):', apiErr.message);
      }
    }

    // ── Limpar estado no banco ─────────────────────────────────────────────
    const { error: dbError } = await supabase
      .from('evolution_config')
      .update({
        instance_created: false,
        qr_code: null,
        connection_status: 'disconnected',
        token: '',
      })
      .eq('user_id', user.id);

    if (dbError) {
      console.error('[reset-instance] Erro ao limpar banco:', dbError);
      throw new Error('Erro ao limpar estado no banco de dados');
    }

    console.log(`[reset-instance] ✅ Instância ${config.instance_id} resetada para o usuário ${user.id}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Instância desconectada. Gere um novo QR Code para reconectar.',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[reset-instance] Erro:', error.message);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
