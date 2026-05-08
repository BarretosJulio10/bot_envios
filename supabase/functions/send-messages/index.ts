/**
 * Edge Function: send-messages (Evolution Go API)
 *
 * Endpoints corretos:
 *   texto: POST /send/text   | body: { number, text }
 *   mídia: POST /send/media  | body: { number, url, type, caption, filename }
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
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('No authorization header');

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) throw new Error('Unauthorized');

    const { action } = await req.json();
    console.log(`Action received: ${action} for user: ${user.id}`);

    const apiUrl = Deno.env.get('EVOLUTION_API_URL');
    if (!apiUrl) throw new Error('EVOLUTION_API_URL não configurada');

    const { data: config, error: configError } = await supabase
      .from('evolution_config')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (configError || !config || !config.instance_id) {
      throw new Error('Configuração não encontrada. Conecte sua instância primeiro.');
    }

    if (!config.token) {
      throw new Error('Token da instância não encontrado. Reconecte sua instância.');
    }
    // Evolution Go: apikey = INSTANCE TOKEN
    const instanceToken = config.token;

    if (action === 'pause') {
      await supabase
        .from('messages')
        .update({ status: 'paused' })
        .eq('user_id', user.id)
        .eq('status', 'sending');

      return new Response(
        JSON.stringify({ success: true, message: 'Envios pausados' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'retry') {
      await supabase
        .from('messages')
        .update({ status: 'queued', attempts: 0 })
        .eq('user_id', user.id)
        .eq('status', 'failed');

      return new Response(
        JSON.stringify({ success: true, message: 'Falhas reenfileiradas' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'start') {
      const { data: blacklist } = await supabase
        .from('blacklist')
        .select('phone, number_ids');

      const blacklistedNumbers = new Set(blacklist?.map(b => b.phone) || []);
      const blacklistedIds = new Set<string>();

      blacklist?.forEach(item => {
        if (item.number_ids) {
          const ids = item.number_ids.split(',').map((id: string) => id.trim());
          ids.forEach((id: string) => blacklistedIds.add(id));
        }
      });

      const { data: allMessages, error: messagesError } = await supabase
        .from('messages')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'queued')
        .order('created_at', { ascending: true });

      if (messagesError) throw messagesError;

      const allFilteredMessages = allMessages
        ?.filter(m => {
          if (blacklistedNumbers.has(m.phone)) return false;
          const fileId = m.filename?.split('.')[0];
          if (fileId && blacklistedIds.has(fileId)) return false;
          return true;
        }) || [];

      if (allFilteredMessages.length === 0) {
        return new Response(
          JSON.stringify({ success: true, message: 'Nenhuma mensagem na fila' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`Total de ${allFilteredMessages.length} mensagens para enviar`);

      const delayMin = config.delay_min || 10000;
      const delayMax = config.delay_max || 30000;
      const avgDelay = (delayMin + delayMax) / 2;
      const targetMs = 45000;
      const computedBatch = Math.floor(targetMs / Math.max(1, avgDelay));
      const safeBatch = Math.max(1, Math.min(config.pause_after || 100, Math.min(10, computedBatch)));

      const batch = allFilteredMessages.slice(0, safeBatch);
      console.log(`📦 Lote seguro Fzap: safeBatch=${safeBatch}, avgDelay=${avgDelay}ms`);

      let sentCount = 0;
      let failedCount = 0;

      for (let i = 0; i < batch.length; i++) {
        const message = batch[i];

        try {
          await supabase.from('messages').update({ status: 'sending', attempts: message.attempts + 1 }).eq('id', message.id);
          console.log(`Processando mensagem ${message.id}: ${message.filename} para ${message.phone}`);

          if (!message.file_url) throw new Error('Nenhum arquivo apontado');

          // URL assinada do Supabase Storage
          const urlParts = message.file_url.split('/whatsapp-files/');
          if (urlParts.length < 2) throw new Error('Caminho inválido');
          const filePath = urlParts[1];

          const { data: signedData, error: signedError } = await supabase.storage
            .from('whatsapp-files')
            .createSignedUrl(filePath, 60 * 30);

          if (signedError || !signedData?.signedUrl) {
            throw new Error(`Erro URL: ${signedError?.message || ''}`);
          }
          const signedUrl = signedData.signedUrl;

          const ext = message.filename?.split('.').pop()?.toLowerCase() || '';

          // Determinar tipo de mídia
          let mediaType = 'document';
          if (message.file_type === 'sticker') mediaType = 'sticker';
          else if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'svg'].includes(ext)) mediaType = 'image';
          else if (['mp4', 'mov', 'webm', 'm4v', 'avi', '3gp', 'mkv', 'flv', 'wmv', 'mpeg', 'mpg'].includes(ext)) mediaType = 'video';
          else if (['mp3', 'm4a', 'wav', 'ogg', 'aac', 'flac', 'wma', 'opus'].includes(ext)) mediaType = 'audio';
          else if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'zip', 'rar', '7z', 'csv'].includes(ext)) mediaType = 'document';

          // Evolution Go: endpoint único /send/media para todos os tipos de mídia
          // Campo "number" (não "phone"), "url", "type", "caption", "filename"
          let endpoint: string;
          let payload: any;

          if (mediaType === 'sticker') {
            endpoint = `${apiUrl}/send/media`;
            payload = { number: message.phone, url: signedUrl, type: 'sticker', filename: message.filename || 'sticker' };
          } else if (mediaType === 'image') {
            endpoint = `${apiUrl}/send/media`;
            payload = { number: message.phone, url: signedUrl, type: 'image', caption: message.message_text || '', filename: message.filename || 'imagem' };
          } else if (mediaType === 'video') {
            endpoint = `${apiUrl}/send/media`;
            payload = { number: message.phone, url: signedUrl, type: 'video', caption: message.message_text || '', filename: message.filename || 'video' };
          } else if (mediaType === 'audio') {
            endpoint = `${apiUrl}/send/media`;
            payload = { number: message.phone, url: signedUrl, type: 'audio', filename: message.filename || 'audio' };
          } else {
            // document (default)
            endpoint = `${apiUrl}/send/media`;
            payload = { number: message.phone, url: signedUrl, type: 'document', caption: message.message_text || '', filename: message.filename || 'arquivo' };
          }

          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': instanceToken, // Evolution Go usa apikey, não token
            },
            body: JSON.stringify(payload),
          });

          if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Fzap API ${response.status}: ${errorBody}`);
          }

          const result = await response.json();
          await supabase.from('messages').update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            evolution_msg_id: result.data?.id || null,
            error_message: null,
          }).eq('id', message.id);

          console.log(`✅ Msg enviada p/ ${message.phone}`);
          sentCount++;

        } catch (err: any) {
          console.error(`Falha msg ${message.id}:`, err);
          await supabase.from('messages').update({
            status: 'failed',
            error_message: err.message || 'Erro',
          }).eq('id', message.id);
          failedCount++;
        }

        if (i < batch.length - 1) {
          const delayMs = Math.random() * (config.delay_max - config.delay_min) + config.delay_min;
          console.log(`Aguardando ${delayMs}ms anti-ban`);
          await new Promise(r => setTimeout(r, delayMs));
        }
      }

      const processed = batch.length;
      const moreRemaining = allFilteredMessages.length > batch.length;

      return new Response(
        JSON.stringify({ success: true, processed, sent: sentCount, failed: failedCount, moreRemaining }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    throw new Error('Ação inválida');

  } catch (error: any) {
    console.error('Error in send-messages function:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
