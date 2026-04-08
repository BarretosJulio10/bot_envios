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

    // Credenciais Uazapi
    const uazapiUrl = Deno.env.get('EVOLUTION_API_URL');
    const uazapiToken = Deno.env.get('global_apikay');
    const instanceId = config.instance_id?.trim();

    if (!uazapiUrl) throw new Error('EVOLUTION_API_URL nao definida');
    if (!uazapiToken) throw new Error('global_apikay nao definida');
    if (!instanceId) throw new Error('Instance ID nao configurado');

    // Token da instância — OBRIGATÓRIO. NÃO usar admintoken (global_apikay) para envios!
    if (!config.token) {
      throw new Error('Token da instância não encontrado no banco. Reconecte sua instância Uazapi no painel.');
    }
    const apiToken = config.token;

    // Funcao para envio via Uazapi com retry automatico
    async function sendToUazapi(endpoint: string, payload: any, retry = true): Promise<any> {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'token': apiToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const responseText = await response.text();
      let result;
      try {
        result = JSON.parse(responseText);
      } catch {
        result = { error: responseText };
      }

      if (!response.ok) {
        if (retry && responseText.includes('No sessions')) {
          console.warn('No sessions. Reconnecting...');
          await ensureInstanceSession();
          await new Promise(r => setTimeout(r, 1000));
          return sendToUazapi(endpoint, payload, false);
        }
        throw new Error(`Uazapi API ${response.status}: ${responseText}`);
      }
      return result;
    }

    // Verifica e reconecta instancia na Uazapi
    async function ensureInstanceSession() {
      try {
        const stateRes = await fetch(`${uazapiUrl}/instance/status`, {
          method: 'GET',
          headers: { 'token': apiToken },
        });
        if (stateRes.ok) {
          const stateJson = await stateRes.json();
          const state = stateJson?.instance?.state || stateJson?.state;
          if (state === 'open') return true;
        }

        console.log('Instance not open. Trying reconnect...');
        const connectRes = await fetch(`${uazapiUrl}/instance/connect`, {
          method: 'POST',
          headers: { 
            'token': apiToken,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({}),
        });
        if (!connectRes.ok) {
          const txt = await connectRes.text();
          console.warn(`Reconnect failed (${connectRes.status}): ${txt}`);
          return false;
        }
        await new Promise(r => setTimeout(r, 1500));
        return true;
      } catch (e) {
        console.warn('ensureInstanceSession error:', e);
        return false;
      }
    }

    // Processa cada mensagem individual do lote
    async function processMessage(message: any) {
      let payload: any = {};
      let endpoint = '';

      if (message.message_type === 'menu') {
        endpoint = `${uazapiUrl}/send/menu`;
        payload = {
          number: message.group_id,
          type: 'list',
          text: message.caption || '',
          footerText: message.footer_text || '',
          listButton: message.list_button || 'Ver opções',
          choices: JSON.parse(message.menu_choices || '[]'),
          delay: 1200,
        };
      } else if (message.image_url) {
        const urlParts = message.image_url.split('/whatsapp-files/');
        if (urlParts.length < 2) throw new Error('Caminho do arquivo invalido na URL');
        const filePath = urlParts[1];

        const { data: signedData, error: signedError } = await supabaseClient
          .storage
          .from('whatsapp-files')
          .createSignedUrl(filePath, 60 * 30);

        if (signedError || !signedData?.signedUrl) throw new Error(`Erro URL assinada: ${signedError?.message}`);
        const signedUrl = signedData.signedUrl;

        const filename = message.file_name || filePath.split('/').pop() || 'file';
        const ext = filename.split('.').pop()?.toLowerCase() || '';
        let mediaType = 'document';

        if (message.file_type === 'sticker') mediaType = 'sticker';
        else if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'svg'].includes(ext)) mediaType = 'image';
        else if (['mp4', 'mov', 'webm', 'm4v', 'avi', '3gp', 'mkv', 'flv', 'wmv'].includes(ext)) mediaType = 'video';
        else if (['mp3', 'm4a', 'wav', 'ogg', 'aac', 'flac', 'opus'].includes(ext)) mediaType = 'audio';

        endpoint = `${uazapiUrl}/send/media`;

        if (mediaType === 'sticker') {
          // Uazapi: sticker via /send/media com type sticker
          payload = {
            number: message.group_id,
            type: 'sticker',
            file: signedUrl,
            delay: 1200,
          };
        } else {
          // Uazapi usa 'text' para legenda (nao 'caption')
          payload = {
            number: message.group_id,
            type: mediaType,
            file: signedUrl,
            docName: filename,
            text: message.caption || '',
            delay: 1200,
          };
        }
      } else if (message.caption) {
        endpoint = `${uazapiUrl}/send/text`;
        payload = { number: message.group_id, text: message.caption, delay: 1200 };
      }

      if (endpoint) {
        await sendToUazapi(endpoint, payload);
      }
    }

    // Busca mensagens na fila
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

    // Processamento síncrono em lote controlado (evita timeout e respeita UI)
    const delayMin = config.delay_min || 10000;
    const delayMax = config.delay_max || 30000;
    const avgDelay = (delayMin + delayMax) / 2;
    const targetMs = 45000; 
    const computedBatch = Math.floor(targetMs / Math.max(1, avgDelay));
    const safeBatch = Math.max(1, Math.min(config.pause_after || 100, Math.min(10, computedBatch)));

    const batch = allMessages.slice(0, safeBatch);
    console.log(`📦 Processando lote seguro Grupos: safeBatch=${safeBatch}`);

    await ensureInstanceSession();

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

    const processed = batch.length;
    const moreRemaining = allMessages.length > batch.length;

    return new Response(
      JSON.stringify({ success: true, processed, sent: sentCount, failed: failedCount, moreRemaining }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
