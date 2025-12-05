import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    const { action } = await req.json();
    console.log(`Action received: ${action} for user: ${user.id}`);

    // Get Evolution API credentials from secrets
    const evolutionApiUrl = Deno.env.get('EVOLUTION_API_URL');
    const evolutionApiKey = Deno.env.get('global_apikay');

    if (!evolutionApiUrl || !evolutionApiKey) {
      throw new Error('Credenciais da Evolution API não configuradas');
    }

    // Get user config (delays, instance_id, etc)
    const { data: config, error: configError } = await supabase
      .from('evolution_config')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (configError || !config || !config.instance_id) {
      throw new Error('Configuração da Evolution API não encontrada');
    }

    if (action === 'pause') {
      // Pause all sending messages
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
      // Reset failed messages to queued
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

    // Start sending
    if (action === 'start') {
      // TODO: Buscar blacklist (números E IDs)
      const { data: blacklist } = await supabase
        .from('blacklist')
        .select('phone, number_ids');

      const blacklistedNumbers = new Set(blacklist?.map(b => b.phone) || []);
      const blacklistedIds = new Set<string>();

      // TODO: Parsear IDs da blacklist
      blacklist?.forEach(item => {
        if (item.number_ids) {
          const ids = item.number_ids.split(',').map((id: string) => id.trim());
          ids.forEach((id: string) => blacklistedIds.add(id));
        }
      });

      // Get queued messages
      const { data: allMessages, error: messagesError } = await supabase
        .from('messages')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'queued')
        .order('created_at', { ascending: true });

      if (messagesError) {
        throw messagesError;
      }

      // Filter blacklist
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

      // Calculate safe batch size based on delays to avoid timeout
      const delayMin = config.delay_min || 10000;
      const delayMax = config.delay_max || 30000;
      const avgDelay = (delayMin + delayMax) / 2;
      const targetMs = 45000; // 45 seconds max execution time
      const computedBatch = Math.floor(targetMs / Math.max(1, avgDelay));
      const safeBatch = Math.max(1, Math.min(config.pause_after || 100, Math.min(10, computedBatch)));

      const batch = allFilteredMessages.slice(0, safeBatch);
      console.log(`📦 Processando lote seguro: safeBatch=${safeBatch}, avgDelay=${avgDelay}ms, total na fila=${allFilteredMessages.length}`);

      let sentCount = 0;
      let failedCount = 0;

      for (let i = 0; i < batch.length; i++) {
        const message = batch[i];

        try {
          // Update status to sending
          await supabase
            .from('messages')
            .update({ status: 'sending', attempts: message.attempts + 1 })
            .eq('id', message.id);

          console.log(`Processing message ${message.id}: ${message.filename} to ${message.phone}`);

          if (message.file_url) {
            // Extract file path from the public URL
            const urlParts = message.file_url.split('/whatsapp-files/');
            if (urlParts.length < 2) {
              throw new Error('Caminho do arquivo inválido na URL');
            }
            const filePath = urlParts[1]; // {user_id}/{filename}

            console.log(`Generating signed URL for: ${filePath}`);

            // Generate signed URL (valid for 30 minutes)
            const { data: signedData, error: signedError } = await supabase
              .storage
              .from('whatsapp-files')
              .createSignedUrl(filePath, 60 * 30);

            if (signedError || !signedData?.signedUrl) {
              throw new Error(`Erro ao gerar URL assinada: ${signedError?.message || 'URL não gerada'}`);
            }

            const signedUrl = signedData.signedUrl;
            console.log(`Signed URL generated: ${signedUrl.substring(0, 100)}...`);

            // Detect media type from filename extension or force document/sticker if specified
            const ext = message.filename.split('.').pop()?.toLowerCase() || '';
            let mediaType = 'document';

            if (message.file_type === 'document') {
              mediaType = 'document';
            } else if (message.file_type === 'sticker') {
              mediaType = 'sticker';
            } else if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'svg'].includes(ext)) mediaType = 'image';
            else if (['mp4', 'mov', 'webm', 'm4v', 'avi', '3gp', 'mkv', 'flv', 'wmv', 'mpeg', 'mpg'].includes(ext)) mediaType = 'video';
            else if (['mp3', 'm4a', 'wav', 'ogg', 'aac', 'flac', 'wma', 'opus'].includes(ext)) mediaType = 'audio';
            else if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'zip', 'rar', '7z', 'csv'].includes(ext)) mediaType = 'document';

            // Send media via Evolution API
            let endpoint = `${evolutionApiUrl}/message/sendMedia/${config.instance_id}`;
            let payload: any = {
              number: message.phone,
              mediatype: mediaType,
              media: signedUrl,
              fileName: message.filename,
              caption: message.message_text || '',
            };

            if (mediaType === 'sticker') {
              endpoint = `${evolutionApiUrl}/message/sendSticker/${config.instance_id}`;

              // Fetch the image and convert to base64 using chunks to avoid stack overflow
              const imageResponse = await fetch(signedUrl);
              if (!imageResponse.ok) throw new Error(`Failed to fetch image for sticker: ${imageResponse.statusText}`);
              const arrayBuffer = await imageResponse.arrayBuffer();

              const bytes = new Uint8Array(arrayBuffer);
              let binary = '';
              const len = bytes.byteLength;
              const chunkSize = 8192; // Process in 8KB chunks

              for (let i = 0; i < len; i += chunkSize) {
                const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
                binary += String.fromCharCode.apply(null, Array.from(chunk));
              }

              const base64 = btoa(binary);
              const mimeType = imageResponse.headers.get('content-type') || 'image/png';

              payload = {
                number: message.phone,
                sticker: `data:${mimeType};base64,${base64}`
              };
            }

            console.log(`Sending ${mediaType} to ${message.phone}:`, JSON.stringify(payload, null, 2));

            const response = await fetch(
              endpoint,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'apikey': evolutionApiKey,
                },
                body: JSON.stringify(payload),
              }
            );

            if (!response.ok) {
              const errorBody = await response.text();
              throw new Error(`Evolution API ${response.status}: ${errorBody}`);
            }

            const result = await response.json();
            console.log(`${mediaType} sent successfully to ${message.phone}:`, result);

            // Update to sent
            await supabase
              .from('messages')
              .update({
                status: 'sent',
                sent_at: new Date().toISOString(),
                evolution_msg_id: result.key?.id || null,
              })
              .eq('id', message.id);

            sentCount++;
            console.log(`Message ${message.id} marked as sent`);
          } else {
            throw new Error('Nenhum arquivo para enviar');
          }
        } catch (error: any) {
          console.error(`Failed to send message ${message.id}:`, error);
          const errorMessage = error.message || 'Erro desconhecido';
          await supabase
            .from('messages')
            .update({ status: 'failed', error_message: errorMessage })
            .eq('id', message.id);
          failedCount++;
          console.log(`Message ${message.id} marked as failed: ${errorMessage}`);
        }

        // Delay between messages (anti-ban)
        if (i < batch.length - 1) {
          const delay = Math.random() * (config.delay_max - config.delay_min) + config.delay_min;
          console.log(`Waiting ${delay}ms before next message`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }

      const processed = batch.length;
      const moreRemaining = allFilteredMessages.length > batch.length;
      console.log(`📊 Lote concluído: processed=${processed}, sent=${sentCount}, failed=${failedCount}, moreRemaining=${moreRemaining}`);

      return new Response(
        JSON.stringify({ success: true, processed, sent: sentCount, failed: failedCount, moreRemaining }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

      // Batch-based processing completed above. Returning early.
      // (Retry automático removido para evitar timeouts.)
    }

    throw new Error('Ação inválida');

  } catch (error: any) {
    console.error('Error in send-messages function:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
