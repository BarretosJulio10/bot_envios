import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
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

    if (configError || !config) throw new Error('Configuração Evolution não encontrada');

    const evolutionUrl = config.base_url;
    const evolutionToken = config.token;

    if (!evolutionUrl || !evolutionToken) {
      throw new Error('Variáveis de ambiente Evolution não configuradas');
    }

    const mimeTypes: Record<string, string> = {
      'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'webp': 'image/webp',
      'gif': 'image/gif', 'bmp': 'image/bmp', 'tiff': 'image/tiff', 'svg': 'image/svg+xml',
      'mp4': 'video/mp4', 'mov': 'video/quicktime', 'webm': 'video/webm', 'm4v': 'video/x-m4v',
      'avi': 'video/x-msvideo', '3gp': 'video/3gpp', 'mkv': 'video/x-matroska',
      'mp3': 'audio/mpeg', 'm4a': 'audio/mp4', 'wav': 'audio/wav', 'ogg': 'audio/ogg',
      'aac': 'audio/aac', 'flac': 'audio/flac', 'opus': 'audio/opus',
      'pdf': 'application/pdf', 'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'xls': 'application/vnd.ms-excel',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'ppt': 'application/vnd.ms-powerpoint',
      'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'txt': 'text/plain', 'zip': 'application/zip', 'rar': 'application/vnd.rar',
      '7z': 'application/x-7z-compressed', 'csv': 'text/csv'
    };

    async function sendToEvolution(endpoint: string, payload: any, retry = true): Promise<any> {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'apikey': evolutionToken,
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
          await ensureInstanceSession(config.instance_id);
          await new Promise(r => setTimeout(r, 1000));
          return sendToEvolution(endpoint, payload, false);
        }
        throw new Error(`Evolution API ${response.status}: ${responseText}`);
      }
      return result;
    }

    async function ensureInstanceSession(instanceId: string) {
      try {
        const stateRes = await fetch(`${evolutionUrl}/instance/connectionState/${instanceId}`, {
          method: 'GET',
          headers: { 'apikey': evolutionToken },
        });
        if (stateRes.ok) {
          const stateJson = await stateRes.json();
          const state = stateJson?.instance?.state || stateJson?.state;
          if (state === 'open') return true;
        }

        console.log(`Instance ${instanceId} not open or unknown. Trying reconnect...`);
        const connectRes = await fetch(`${evolutionUrl}/instance/connect/${instanceId}`, {
          method: 'GET',
          headers: { 'apikey': evolutionToken },
        });
        if (!connectRes.ok) {
          const txt = await connectRes.text();
          console.warn(`Reconnect failed (${connectRes.status}): ${txt}`);
          return false;
        }
        await new Promise((r) => setTimeout(r, 1500));
        return true;
      } catch (e) {
        console.warn('ensureInstanceSession error:', e);
        return false;
      }
    }

    async function processMessage(message: any) {
      let payload: any = {};
      let endpoint = '';

      if (message.image_url) {
        const urlParts = message.image_url.split('/whatsapp-files/');
        if (urlParts.length < 2) throw new Error('Caminho do arquivo inválido na URL');
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

        if (message.file_type === 'document') mediaType = 'document';
        else if (message.file_type === 'sticker') mediaType = 'sticker';
        else if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'svg'].includes(ext)) mediaType = 'image';
        else if (['mp4', 'mov', 'webm', 'm4v', 'avi', '3gp', 'mkv', 'flv', 'wmv', 'mpeg', 'mpg'].includes(ext)) mediaType = 'video';
        else if (['mp3', 'm4a', 'wav', 'ogg', 'aac', 'flac', 'wma', 'opus'].includes(ext)) mediaType = 'audio';
        else if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'zip', 'rar', '7z', 'csv'].includes(ext)) mediaType = 'document';

        const mimetype = mimeTypes[ext] || 'application/octet-stream';

        if (mediaType === 'sticker') {
          endpoint = `${evolutionUrl}/message/sendSticker/${config.instance_id}`;
          const imageResponse = await fetch(signedUrl);
          if (!imageResponse.ok) throw new Error(`Failed to fetch sticker image`);
          const arrayBuffer = await imageResponse.arrayBuffer();
          const bytes = new Uint8Array(arrayBuffer);
          let binary = '';
          const chunkSize = 8192;
          for (let j = 0; j < bytes.length; j += chunkSize) {
            const chunk = bytes.subarray(j, Math.min(j + chunkSize, bytes.length));
            binary += String.fromCharCode.apply(null, Array.from(chunk));
          }
          const base64 = btoa(binary);
          payload = { number: message.group_id, sticker: base64, delay: 1200, presence: 'composing' };
        } else {
          endpoint = `${evolutionUrl}/message/sendMedia/${config.instance_id}`;
          payload = {
            number: message.group_id,
            mediatype: mediaType,
            mimetype: mimetype,
            media: signedUrl,
            fileName: filename,
            caption: message.caption || '',
            delay: 1200,
            presence: 'composing'
          };
        }
      } else if (message.caption) {
        endpoint = `${evolutionUrl}/message/sendText/${config.instance_id}`;
        payload = { number: message.group_id, text: message.caption, delay: 1200, presence: 'composing' };
      }

      if (endpoint) {
        await sendToEvolution(endpoint, payload);
      }
    }

    // Main fetch with ordering_index support
    const { data: allMessages, error: messagesError } = await supabaseClient
      .from('group_messages')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .order('ordering_index', { ascending: true });

    if (messagesError) throw messagesError;
    if (!allMessages || allMessages.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'Fila vazia' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    EdgeRuntime.waitUntil((async () => {
      try {
        await ensureInstanceSession(config.instance_id);
        const batchSize = config.pause_after || 5;

        for (let i = 0; i < allMessages.length; i += batchSize) {
          const batch = allMessages.slice(i, i + batchSize);
          for (const msg of batch) {
            try {
              await supabaseClient.from('group_messages').update({ status: 'sending', attempts: msg.attempts + 1 }).eq('id', msg.id);
              await processMessage(msg);
              await supabaseClient.from('group_messages').update({ status: 'sent', sent_at: new Date().toISOString(), error_message: null }).eq('id', msg.id);
            } catch (err: any) {
              await supabaseClient.from('group_messages').update({ status: 'failed', error_message: err.message }).eq('id', msg.id);
            }
            const delay = Math.random() * (config.delay_max - config.delay_min) + config.delay_min;
            await new Promise(r => setTimeout(r, delay));
          }
          if (i + batchSize < allMessages.length) {
            await new Promise(r => setTimeout(r, config.pause_duration || 30000));
          }
        }

        // Retry logic
        let retryCycle = 0;
        while (retryCycle < 3) {
          const { data: failed } = await supabaseClient.from('group_messages').select('*').eq('user_id', user.id).eq('status', 'failed').lt('attempts', 5);
          if (!failed || failed.length === 0) break;
          for (const msg of failed) {
            try {
              await supabaseClient.from('group_messages').update({ status: 'sending', attempts: msg.attempts + 1 }).eq('id', msg.id);
              await processMessage(msg);
              await supabaseClient.from('group_messages').update({ status: 'sent', sent_at: new Date().toISOString(), error_message: null }).eq('id', msg.id);
            } catch (err: any) {
              await supabaseClient.from('group_messages').update({ status: 'failed', error_message: err.message }).eq('id', msg.id);
            }
            await new Promise(r => setTimeout(r, 2000));
          }
          retryCycle++;
          await new Promise(r => setTimeout(r, 10000));
        }
      } catch (e) {
        console.error('Background process error:', e);
      }
    })());

    return new Response(JSON.stringify({ success: true, message: 'Processamento iniciado', count: allMessages.length }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 202 });

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 });
  }
});
