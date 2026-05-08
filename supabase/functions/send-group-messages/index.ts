/**
 * Edge Function: send-group-messages (Evolution Go API)
 *
 * Endpoints corretos:
 *   texto:  POST /send/text   | body: { number, text }
 *   mídia:  POST /send/media  | body: { number, url, type, caption, filename }
 *   status: GET  /instance/status  | data.Connected, data.LoggedIn
 *   reconect: POST /instance/connect
 *
 * Autenticação: apikey = INSTANCE TOKEN (não mais "token")
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(
      req.headers.get('Authorization')?.split(' ')[1] ?? ''
    );
    if (userError || !user) throw new Error('Não autorizado');

    const { data: config, error: configError } = await supabaseClient
      .from('evolution_config')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (configError || !config) throw new Error('Configuração não encontrada');

    const apiUrl = Deno.env.get('EVOLUTION_API_URL');
    if (!apiUrl) throw new Error('EVOLUTION_API_URL não definida');

    if (!config.token) {
      throw new Error('Token da instância não encontrado. Reconecte sua instância.');
    }
    // Evolution Go: apikey = INSTANCE TOKEN
    const apiToken = config.token;

    // ── Envio para Evolution Go com retry automático ──────────────────────────
    async function sendToApi(endpoint: string, payload: any, retry = true): Promise<any> {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'apikey': apiToken, // Evolution Go: apikey, não token
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const responseText = await response.text();
      let result: any;
      try { result = JSON.parse(responseText); } catch { result = { error: responseText }; }

      if (!response.ok) {
        // Reconnect automático se sessão cair
        if (retry && (responseText.includes('no session') || response.status === 401)) {
          console.warn('[send-group] Sessão perdida. Reconectando...');
          await ensureSession();
          await new Promise(r => setTimeout(r, 1000));
          return sendToApi(endpoint, payload, false);
        }
        throw new Error(`API ${response.status}: ${responseText}`);
      }
      return result;
    }

    // ── Verificar e reconectar sessão (Evolution Go) ──────────────────────────
    async function ensureSession() {
      try {
        // GET /instance/status | apikey = INSTANCE TOKEN
        const stateRes = await fetch(`${apiUrl}/instance/status`, {
          method: 'GET',
          headers: { 'apikey': apiToken },
        });

        if (stateRes.ok) {
          const stateJson = await stateRes.json();
          // Evolution Go: campos com inicial MAIÚSCULA
          const loggedIn = stateJson?.data?.LoggedIn;
          if (loggedIn === true) return true;
        }

        console.log('[send-group] Não logado. Tentando reconectar...');

        // POST /instance/connect | apikey = INSTANCE TOKEN
        const connectRes = await fetch(`${apiUrl}/instance/connect`, {
          method: 'POST',
          headers: { 'apikey': apiToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ immediate: true }),
        });

        if (!connectRes.ok) {
          const txt = await connectRes.text();
          console.warn(`[send-group] Reconexão falhou (${connectRes.status}): ${txt}`);
          return false;
        }

        await new Promise(r => setTimeout(r, 1500));
        return true;
      } catch (e) {
        console.warn('[send-group] ensureSession error:', e);
        return false;
      }
    }

    // ── Processar mensagem individual do lote ─────────────────────────────────
    async function processMessage(message: any) {
      let payload: any = {};
      let endpoint = '';

      if (message.image_url) {
        // ── Mensagem com mídia ──────────────────────────────────────────────
        const urlParts = message.image_url.split('/whatsapp-files/');
        if (urlParts.length < 2) throw new Error('Caminho do arquivo inválido na URL');
        const filePath = urlParts[1];

        const { data: signedData, error: signedError } = await supabaseClient
          .storage
          .from('whatsapp-files')
          .createSignedUrl(filePath, 60 * 30);

        if (signedError || !signedData?.signedUrl) {
          throw new Error(`Erro URL assinada: ${signedError?.message}`);
        }
        const signedUrl = signedData.signedUrl;

        const filename = message.file_name || filePath.split('/').pop() || 'file';
        const ext = filename.split('.').pop()?.toLowerCase() || '';

        let mediaType = 'document';
        if (message.file_type === 'sticker') mediaType = 'sticker';
        else if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'svg'].includes(ext)) mediaType = 'image';
        else if (['mp4', 'mov', 'webm', 'm4v', 'avi', '3gp', 'mkv', 'flv', 'wmv'].includes(ext)) mediaType = 'video';
        else if (['mp3', 'm4a', 'wav', 'ogg', 'aac', 'flac', 'opus'].includes(ext)) mediaType = 'audio';

        // Evolution Go: POST /send/media com campo "number" e "type"
        endpoint = `${apiUrl}/send/media`;
        payload = {
          number: message.group_id,
          url: signedUrl,
          type: mediaType,
          caption: message.caption || '',
          filename: filename,
        };

      } else if (message.caption) {
        // ── Texto puro ─────────────────────────────────────────────────────
        // Evolution Go: POST /send/text, campo "number" e "text"
        endpoint = `${apiUrl}/send/text`;
        payload = {
          number: message.group_id,
          text: message.caption,
        };
      }

      if (endpoint) {
        console.log(`[send-group] Enviando para ${message.group_id} via ${endpoint}`);
        await sendToApi(endpoint, payload);
      }
    }

    // ── Buscar mensagens na fila ──────────────────────────────────────────────
    const { data: allMessages, error: messagesError } = await supabaseClient
      .from('group_messages')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .order('ordering_index', { ascending: true });

    if (messagesError) throw messagesError;

    if (!allMessages || allMessages.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'Fila vazia' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const delayMin = config.delay_min || 10000;
    const delayMax = config.delay_max || 30000;
    const avgDelay = (delayMin + delayMax) / 2;
    const targetMs = 45000;
    const computedBatch = Math.floor(targetMs / Math.max(1, avgDelay));
    const safeBatch = Math.max(1, Math.min(config.pause_after || 100, Math.min(10, computedBatch)));

    const batch = allMessages.slice(0, safeBatch);
    console.log(`📦 Lote grupos: safeBatch=${safeBatch}`);

    await ensureSession();

    let sentCount = 0;
    let failedCount = 0;

    for (let i = 0; i < batch.length; i++) {
      const msg = batch[i];
      try {
        await supabaseClient.from('group_messages').update({ status: 'sending', attempts: msg.attempts + 1 }).eq('id', msg.id);
        await processMessage(msg);
        await supabaseClient.from('group_messages').update({ status: 'sent', sent_at: new Date().toISOString(), error_message: null }).eq('id', msg.id);
        sentCount++;
        console.log(`✅ Grupo msg enviada: ${msg.id}`);
      } catch (err: any) {
        console.error(`❌ Falha grupo msg ${msg.id}:`, err.message);
        await supabaseClient.from('group_messages').update({ status: 'failed', error_message: err.message }).eq('id', msg.id);
        failedCount++;
      }

      if (i < batch.length - 1) {
        const delay = Math.random() * (config.delay_max - config.delay_min) + config.delay_min;
        await new Promise(r => setTimeout(r, delay));
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed: batch.length,
        sent: sentCount,
        failed: failedCount,
        moreRemaining: allMessages.length > batch.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error: any) {
    console.error('[send-group-messages] Erro:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
