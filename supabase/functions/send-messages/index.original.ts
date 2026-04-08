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

      const batchSize = config.pause_after || 5;
      const pauseDuration = config.pause_duration || 30000;

      // Executar o envio em background para impedir timeout no painel do usuário
      // @ts-ignore - EdgeRuntime is injected globally by Deno/Supabase
      EdgeRuntime.waitUntil((async () => {
        try {
          // Processa lotes intercalados por pause_duration
          for (let i = 0; i < allFilteredMessages.length; i += batchSize) {
            const batch = allFilteredMessages.slice(i, i + batchSize);
            console.log(`📦 Processando lote: ${batch.length} msg(s) (Índice ${i} até ${i + batchSize - 1})`);

            for (let j = 0; j < batch.length; j++) {
              const message = batch[j];
              try {
                // Update status to sending
                await supabase.from('messages').update({ status: 'sending', attempts: message.attempts + 1 }).eq('id', message.id);
                console.log(`Processando mensagem ${message.id}: ${message.filename} para ${message.phone}`);

                if (!message.file_url) throw new Error('Nenhum arquivo apontado');
                
                // Extração e assinatura de URL
                const urlParts = message.file_url.split('/whatsapp-files/');
                if (urlParts.length < 2) throw new Error('Caminho inválido');
                const filePath = urlParts[1];

                const { data: signedData, error: signedError } = await supabase.storage.from('whatsapp-files').createSignedUrl(filePath, 60 * 30);
                if (signedError || !signedData?.signedUrl) throw new Error(`Erro URL: ${signedError?.message || ''}`);
                const signedUrl = signedData.signedUrl;

                const ext = message.filename?.split('.').pop()?.toLowerCase() || '';
                let mediaType = 'document';
                if (message.file_type === 'document') mediaType = 'document';
                else if (message.file_type === 'sticker') mediaType = 'sticker';
                else if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'svg'].includes(ext)) mediaType = 'image';
                else if (['mp4', 'mov', 'webm', 'm4v', 'avi', '3gp', 'mkv', 'flv', 'wmv', 'mpeg', 'mpg'].includes(ext)) mediaType = 'video';
                else if (['mp3', 'm4a', 'wav', 'ogg', 'aac', 'flac', 'wma', 'opus'].includes(ext)) mediaType = 'audio';
                else if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'zip', 'rar', '7z', 'csv'].includes(ext)) mediaType = 'document';

                let endpoint = `${evolutionApiUrl}/send/media`;
                let payload: any = {
                  number: message.phone,
                  type: mediaType,
                  file: signedUrl,
                  docName: message.filename || 'arquivo',
                  text: message.message_text || '',
                  delay: 1200,
                };

                if (mediaType === 'sticker') {
                  payload = { number: message.phone, type: 'sticker', file: signedUrl };
                }

                const response = await fetch(endpoint, {
                  method: 'POST',
                  headers: { 
                    'Content-Type': 'application/json', 
                    'token': config.token || evolutionApiKey 
                  },
                  body: JSON.stringify(payload),
                });
                
                if (!response.ok) {
                  const errorBody = await response.text();
                  throw new Error(`Uazapi API ${response.status}: ${errorBody}`);
                }
                const result = await response.json();
                await supabase.from('messages').update({ status: 'sent', sent_at: new Date().toISOString(), evolution_msg_id: result.key?.id || null, error_message: null }).eq('id', message.id);
                console.log(`Msg enviada p/ ${message.phone}`);
              } catch (err: any) {
                console.error(`Falha msg ${message.id}:`, err);
                await supabase.from('messages').update({ status: 'failed', error_message: err.message || 'Erro' }).eq('id', message.id);
              }

              // Anti-ban delay entre mensagens do mesmo lote (exceto na última mensagem da fila geral)
              if (i + j < allFilteredMessages.length - 1) {
                const delayMs = Math.random() * (config.delay_max - config.delay_min) + config.delay_min;
                console.log(`Timeout Msg: Aguardando ${delayMs}ms anti-ban`);
                await new Promise(r => setTimeout(r, delayMs));
              }
            } // Fim do For do Batch Interno

            // Se ainda houver próximos lotes, aplicar a pausa longa (pause_duration)
            if (i + batchSize < allFilteredMessages.length) {
              console.log(`Pausa Longa entre lotes: Aguardando ${pauseDuration}ms`);
              await new Promise(r => setTimeout(r, pauseDuration));
            }
          }
          console.log(`✅ Fila inteira processada em background.`);
        } catch (bgError) {
          console.error("Erro critico no background job: ", bgError);
        }
      })());

      return new Response(
        JSON.stringify({ success: true, message: 'Processamento em massa iniciado em background.', count: allFilteredMessages.length }),
        { status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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
