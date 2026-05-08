/**
 * Edge Function: whatsapp-reset-instance (Evolution Go API)
 *
 * Fluxo de reset:
 * 1. DELETE /instance/logout  (apikey = INSTANCE TOKEN) → logout WhatsApp
 * 2. Limpar estado no banco
 *
 * Nota: Mantemos a instância criada no servidor (apenas deslogamos).
 * Para deletar completamente: DELETE /instance/delete (apikey = ADMIN KEY)
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
    if (!authHeader) throw new Error('Header Authorization ausente');
    const jwt = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !user) throw new Error('Usuário não autorizado');

    // Buscar config
    const { data: config } = await supabase
      .from('evolution_config')
      .select('instance_id, token, base_url')
      .eq('user_id', user.id)
      .single();

    // Tentar deslogar na API (best effort)
    if (config?.token) {
      const apiUrl       = Deno.env.get('EVOLUTION_API_URL') ?? config.base_url;
      const instanceToken = config.token;

      try {
        console.log(`[whatsapp-reset] Fazendo logout: ${config.instance_id}`);

        // DELETE /instance/logout  |  apikey = INSTANCE TOKEN
        const logoutRes = await fetch(`${apiUrl}/instance/logout`, {
          method: 'DELETE',
          headers: { 'apikey': instanceToken },
        });

        const logoutText = await logoutRes.text();
        console.log(`[whatsapp-reset] Logout (${logoutRes.status}): ${logoutText.substring(0, 150)}`);
      } catch (apiErr: any) {
        console.warn('[whatsapp-reset] Erro na API (ignorado):', apiErr.message);
      }
    } else {
      console.log('[whatsapp-reset] Nenhuma config no banco. Apenas limpando estado.');
    }

    // Limpar banco
    const { error: dbError } = await supabase
      .from('evolution_config')
      .update({
        instance_created: false,
        qr_code: null,
        connection_status: 'disconnected',
        token: '',
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id);

    if (dbError) {
      console.error('[whatsapp-reset] Erro ao limpar banco:', dbError);
      throw new Error('Erro ao limpar estado no banco');
    }

    console.log(`[whatsapp-reset] ✅ Instância resetada para usuário ${user.id}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Instância desconectada. Gere um novo QR Code para reconectar.',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[whatsapp-reset] Erro:', error.message);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
