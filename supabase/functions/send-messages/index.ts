/**
 * Edge Function: send-messages (Fzap v1.23.0)
 *
 * Diferenças Fzap vs Uazapi:
 *   - Endpoints separados por tipo de mídia (era /send/media único):
 *       image   → POST /chat/send/image    campo: image
 *       video   → POST /chat/send/video    campo: video
 *       audio   → POST /chat/send/audio    campo: audio
 *       doc     → POST /chat/send/document campo: document
 *       sticker → POST /chat/send/sticker  campo: sticker
 *   - Campo destinatário: phone (era number)
 *   - Campo legenda: caption (era text)
 *   - Campo arquivo: tipado (era file)
 *   - Header: token: <instance_token>  (igual ✅)
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

    const fzapUrl = Deno.env.get('EVOLUTION_API_URL');
    if (!fzapUrl) throw new Error('EVOLUTION_API_URL não configurada');

    const { data: config, error: configError } = await supabase
      .from('evolution_config')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (configError || !config || !config.instance_id) {
      throw new Error('Configuração da Fzap não encontrada. Conecte sua instância primeiro.');
    }

    if (!config.token) {
      throw new Error('Token da instância não encontrado. Reconecte sua instância Fzap no painel de configuração.');
    }
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

          // ──────────────────────────────────────────────────────────────────
          // Fzap: endpoints separados por tipo (era /send/media único na Uazapi)
          // Campos: phone (era number), caption (era text), arquivo tipado (era file)
          // ──────────────────────────────────────────────────────────────────
          let endpoint: string;
          let payload: any;

          if (mediaType === 'sticker') {
            endpoint = `${fzapUrl}/chat/send/sticker`;
            payload = { phone: message.phone, sticker: signedUrl };
          } else if (mediaType === 'image') {
            endpoint = `${fzapUrl}/chat/send/image`;
            payload = {
              phone: message.phone,
              image: signedUrl,
              caption: message.message_text || '',
              fileName: message.filename || 'imagem',
            };
          } else if (mediaType === 'video') {
            endpoint = `${fzapUrl}/chat/send/video`;
            payload = {
              phone: message.phone,
              video: signedUrl,
              caption: message.message_text || '',
              fileName: message.filename || 'video',
            };
          } else if (mediaType === 'audio') {
            endpoint = `${fzapUrl}/chat/send/audio`;
            payload = {
              phone: message.phone,
              audio: signedUrl,
            };
          } else {
            // document (default)
            endpoint = `${fzapUrl}/chat/send/document`;
            payload = {
              phone: message.phone,
              document: signedUrl,
              fileName: message.filename || 'arquivo',
              caption: message.message_text || '',
            };
          }

          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'token': instanceToken,
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
