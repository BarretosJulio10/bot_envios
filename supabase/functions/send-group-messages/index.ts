/**
 * Edge Function: send-group-messages (Fzap v1.23.0)
 *
 * Diferenças Fzap vs Uazapi:
 *   - Texto: POST /chat/send/text, campo body (era /send/text, campo text)
 *   - Mídia: endpoints separados /chat/send/{image|video|audio|document|sticker}
 *   - Lista: POST /chat/send/list, sections/rows (era /send/menu, choices)
 *   - Campo destinatário: phone (era number)
 *   - Status check: GET /session/status (era GET /instance/status)
 *   - Reconectar: POST /session/connect (era POST /instance/connect)
 *   - Header: token: <instance_token>  (igual ✅)
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
    if (userError || !user) throw new Error('Nao autorizado');

    const { data: config, error: configError } = await supabaseClient
      .from('evolution_config')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (configError || !config) throw new Error('Configuracao nao encontrada');

    const fzapUrl = Deno.env.get('EVOLUTION_API_URL');
    if (!fzapUrl) throw new Error('EVOLUTION_API_URL nao definida');

    if (!config.token) {
      throw new Error('Token da instância não encontrado no banco. Reconecte sua instância Fzap no painel.');
    }
    const apiToken = config.token;

    // ── Envio para Fzap com retry automático ─────────────────────────────────
    async function sendToFzap(endpoint: string, payload: any, retry = true): Promise<any> {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'token': apiToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const responseText = await response.text();
      let result: any;
      try { result = JSON.parse(responseText); } catch { result = { error: responseText }; }

      if (!response.ok) {
        if (retry && responseText.includes('no session')) {
          console.warn('[send-group] No session. Reconectando...');
          await ensureSession();
          await new Promise(r => setTimeout(r, 1000));
          return sendToFzap(endpoint, payload, false);
        }
        throw new Error(`Fzap API ${response.status}: ${responseText}`);
      }
      return result;
    }

    // ── Verificar e reconectar sessão (Fzap) ─────────────────────────────────
    async function ensureSession() {
      try {
        // GET /session/status (era GET /instance/status)
        const stateRes = await fetch(`${fzapUrl}/session/status`, {
          method: 'GET',
          headers: { 'token': apiToken },
        });

        if (stateRes.ok) {
          const stateJson = await stateRes.json();
          const loggedIn = stateJson?.data?.loggedIn;
          if (loggedIn === true) return true;
        }

        console.log('[send-group] Sessão não está logada. Tentando reconectar...');

        // POST /session/connect (era POST /instance/connect)
        const connectRes = await fetch(`${fzapUrl}/session/connect`, {
          method: 'POST',
          headers: { 'token': apiToken, 'Content-Type': 'application/json' },
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

      if (message.message_type === 'menu') {
        // ── Lista interativa (Fzap: /chat/send/list com sections/rows) ───────
        // Uazapi usava: /send/menu, choices: [{title, description, rowId}]
        // Fzap usa:     /chat/send/list, sections: [{ title, rows: [{rowId, title, desc}] }]
        endpoint = `${fzapUrl}/chat/send/list`;

        let choices: any[] = [];
        try {
          choices = JSON.parse(message.menu_choices || '[]');
        } catch {
          choices = [];
        }

        // Converter choices (Uazapi) → sections/rows (Fzap)
        payload = {
          phone: message.group_id,           // era number
          text: message.caption || '',        // corpo da mensagem
          title: message.caption || '',
          footer: message.footer_text || '',
          buttonText: message.list_button || 'Ver opções',
          sections: [
            {
              title: 'Opções',
              rows: choices.map((c: any, idx: number) => ({
                rowId: c.rowId || c.id || `row-${idx}`,
                title: c.title || c.description || '',
                desc:  c.description || c.desc || '',
              })),
            },
          ],
        };

      } else if (message.image_url) {
        // ── Mensagem com mídia ──────────────────────────────────────────────
        const urlParts = message.image_url.split('/whatsapp-files/');
        if (urlParts.length < 2) throw new Error('Caminho do arquivo invalido na URL');
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

        // Fzap: endpoints separados por tipo (era /send/media único na Uazapi)
        if (mediaType === 'sticker') {
          endpoint = `${fzapUrl}/chat/send/sticker`;
          payload = { phone: message.group_id, sticker: signedUrl };
        } else if (mediaType === 'image') {
          endpoint = `${fzapUrl}/chat/send/image`;
          payload = { phone: message.group_id, image: signedUrl, caption: message.caption || '', fileName: filename };
        } else if (mediaType === 'video') {
          endpoint = `${fzapUrl}/chat/send/video`;
          payload = { phone: message.group_id, video: signedUrl, caption: message.caption || '', fileName: filename };
        } else if (mediaType === 'audio') {
          endpoint = `${fzapUrl}/chat/send/audio`;
          payload = { phone: message.group_id, audio: signedUrl };
        } else {
          endpoint = `${fzapUrl}/chat/send/document`;
          payload = { phone: message.group_id, document: signedUrl, fileName: filename, caption: message.caption || '' };
        }

      } else if (message.caption) {
        // ── Texto puro ─────────────────────────────────────────────────────
        // Fzap: /chat/send/text, campo body (era /send/text, campo text)
        endpoint = `${fzapUrl}/chat/send/text`;
        payload = {
          phone: message.group_id,   // era number
          body: message.caption,     // era text
        };
      }

      if (endpoint) {
        await sendToFzap(endpoint, payload);
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
    console.log(`📦 Lote seguro Grupos Fzap: safeBatch=${safeBatch}`);

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
      } catch (err: any) {
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
