/**
 * Edge Function: evolution-reset-instance (Fzap v1.23.0)
 *
 * Responsabilidades:
 * 1. Desconectar a instância na Fzap via POST /session/disconnect
 * 2. Fallback: POST /session/reset (se disconnect falhar)
 * 3. Limpar o estado no banco (qr_code, instance_created, connection_status, token)
 * 4. Retornar sucesso para o frontend reiniciar o fluxo do zero
 *
 * Diferenças Fzap vs Uazapi:
 *   - Disconnect: /session/disconnect (era /instance/disconnect)
 *   - Reset fallback: /session/reset (era /instance/reset)
 *   - Headers: token: <instance_token>  (mesmo da Uazapi ✅)
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
      // Sem config: estado já limpo, pode criar nova instância
      console.log('[reset-instance] Sem config no banco. Nada a desconectar.');
      return new Response(
        JSON.stringify({ success: true, message: 'Estado limpo. Pode criar uma nova instância.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const fzapUrl      = Deno.env.get('EVOLUTION_API_URL') ?? config.base_url;
    const instanceToken = config.token;

    // ── Tentar desconectar na Fzap (melhor esforço) ────────────────────────
    if (fzapUrl && instanceToken) {
      try {
        console.log(`[reset-instance] Desconectando instância: ${config.instance_id}`);

        // POST /session/disconnect  (era POST /instance/disconnect)
        const disconnectRes = await fetch(`${fzapUrl}/session/disconnect`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'token': instanceToken,
          },
        });

        const disconnectBody = await disconnectRes.text();
        console.log(`[reset-instance] Disconnect: ${disconnectRes.status} ${disconnectBody.substring(0, 150)}`);

        // Se disconnect falhou, tentar /session/reset como fallback
        if (!disconnectRes.ok) {
          console.warn('[reset-instance] Disconnect falhou. Tentando /session/reset...');

          // POST /session/reset  (era POST /instance/reset)
          const resetRes = await fetch(`${fzapUrl}/session/reset`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'token': instanceToken,
            },
          });
          const resetBody = await resetRes.text();
          console.log(`[reset-instance] Reset: ${resetRes.status} ${resetBody.substring(0, 150)}`);
          // Mesmo que falhe, continuamos para limpar o banco
        }

      } catch (apiErr: any) {
        // Erro de rede — logar mas continuar limpando o banco
        console.error('[reset-instance] Erro ao chamar Fzap (ignorado):', apiErr.message);
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
