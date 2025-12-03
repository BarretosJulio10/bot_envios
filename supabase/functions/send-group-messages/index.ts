import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Supabase Edge Runtime background tasks helper declaration
// This satisfies TypeScript; the platform provides the actual implementation at runtime.
declare const EdgeRuntime: { waitUntil: (promise: Promise<any>) => void };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      throw new Error('Não autorizado');
    }

    // Buscar configuração
    const { data: config, error: configError } = await supabaseClient
      .from('evolution_config')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (configError || !config) {
      throw new Error('Configuração não encontrada');
    }

const evolutionUrl = Deno.env.get('EVOLUTION_API_URL') as string;
const evolutionToken = Deno.env.get('global_apikay') as string;

if (!evolutionUrl || !evolutionToken) {
  throw new Error('Variáveis de ambiente Evolution não configuradas');
}

// Garante que a instância esteja com sessão ativa; reconecta se necessário
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
    // breve espera para a sessão subir
    await new Promise((r) => setTimeout(r, 1500));
    return true;
  } catch (e) {
    console.warn('ensureInstanceSession error:', e);
    return false;
  }
}

    // Buscar todas as mensagens queued
    const { data: allMessages, error: messagesError } = await supabaseClient
      .from('group_messages')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'queued')
      .order('created_at', { ascending: true });

    if (messagesError) throw messagesError;

    if (!allMessages || allMessages.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'Nenhuma mensagem na fila' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Iniciar processamento em background para evitar timeout/504
EdgeRuntime.waitUntil((async () => {
      try {
        // Garante sessão ativa antes de começar
        await ensureInstanceSession(config.instance_id);
        let totalProcessed = 0;
        let sent = 0;
        let failed = 0;
        const batchSize = config.pause_after;

        // Processar em lotes com pausa automática
        for (let batchStart = 0; batchStart < allMessages.length; batchStart += batchSize) {
          const batch = allMessages.slice(batchStart, batchStart + batchSize);
          console.log(`📦 Processando lote ${Math.floor(batchStart/batchSize) + 1}: ${batch.length} mensagens`);

          for (let i = 0; i < batch.length; i++) {
            const message = batch[i];

            try {
              await supabaseClient
                .from('group_messages')
                .update({ status: 'sending', attempts: message.attempts + 1 })
                .eq('id', message.id);

              let payload: any = {};
              let endpoint = '';

              // Se tem arquivo, enviar como mídia
              if (message.image_url) {
                endpoint = `${evolutionUrl}/message/sendMedia/${config.instance_id}`;
                payload = {
                  number: message.group_id,
                  mediatype: message.file_type || 'image',
                  media: message.image_url,
                };
                if (message.caption) {
                  payload.caption = message.caption;
                }
              } else if (message.caption) {
                // Se não tem arquivo, enviar apenas texto
                endpoint = `${evolutionUrl}/message/sendText/${config.instance_id}`;
                payload = {
                  number: message.group_id,
                  text: message.caption,
                };
              }

              console.log(`Sending to group ${message.group_name}:`, payload);

let response = await fetch(endpoint, {
  method: 'POST',
  headers: {
    'apikey': evolutionToken,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(payload),
});

if (!response.ok) {
  const errorText = await response.text();
  // Se a Evolution retornar "No sessions", tentamos reconectar e reenviar uma vez
  if (errorText?.includes('No sessions')) {
    console.warn('No sessions detected. Ensuring instance session and retrying once...');
    await ensureInstanceSession(config.instance_id);
    await new Promise(r => setTimeout(r, 1000));
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'apikey': evolutionToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  }
}

if (!response.ok) {
  const errorText2 = await response.text();
  throw new Error(`Evolution API error: ${response.status} - ${errorText2}`);
}

const result = await response.json();
console.log(`✅ Enviado para grupo ${message.group_name}:`, result);

              await supabaseClient
                .from('group_messages')
                .update({
                  status: 'sent',
                  sent_at: new Date().toISOString(),
                  error_message: null,
                })
                .eq('id', message.id);

              sent++;
            } catch (error: any) {
              console.error(`❌ Erro ao enviar para grupo ${message.group_name}:`, error);
              const errorMessage = error.message || 'Erro desconhecido';
              await supabaseClient
                .from('group_messages')
                .update({ status: 'failed', error_message: errorMessage })
                .eq('id', message.id);
              failed++;
            }

            // Delay entre mensagens (anti-ban)
            if (i < batch.length - 1) {
              const delay = Math.random() * (config.delay_max - config.delay_min) + config.delay_min;
              console.log(`Waiting ${delay}ms before next message`);
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          }

          totalProcessed += batch.length;

          // Pausa após cada lote (exceto o último)
          if (batchStart + batchSize < allMessages.length) {
            console.log(`⏸️ Pausa de ${config.pause_duration}ms após ${batch.length} mensagens (${totalProcessed}/${allMessages.length} processadas)`);
            await new Promise(resolve => setTimeout(resolve, config.pause_duration));
            console.log(`▶️ Retomando envios...`);
          }
        }

        // Sistema de Retry Automático
        const MAX_RETRY_CYCLES = 10;
        const MAX_MESSAGE_ATTEMPTS = 5;
        const RETRY_CYCLE_DELAY = 30000; // 30 segundos
        let retryAttempt = 0;
        let permanentlyFailed = 0;

        while (retryAttempt < MAX_RETRY_CYCLES) {
          const { data: failedMessages } = await supabaseClient
            .from('group_messages')
            .select('*')
            .eq('user_id', user.id)
            .eq('status', 'failed')
            .lt('attempts', MAX_MESSAGE_ATTEMPTS)
            .order('created_at', { ascending: true });

          if (!failedMessages || failedMessages.length === 0) {
            console.log('✅ Todas as mensagens de grupo foram enviadas com sucesso!');
            break;
          }

          console.log(`🔄 Ciclo de retry ${retryAttempt + 1}: ${failedMessages.length} mensagens com falha`);

          for (const message of failedMessages) {
            try {
              await supabaseClient
                .from('group_messages')
                .update({ status: 'sending', attempts: message.attempts + 1 })
                .eq('id', message.id);

              let payload: any = {};
              let endpoint = '';

              if (message.image_url) {
                endpoint = `${evolutionUrl}/message/sendMedia/${config.instance_id}`;
                payload = {
                  number: message.group_id,
                  mediatype: message.file_type || 'image',
                  media: message.image_url,
                };
                if (message.caption) {
                  payload.caption = message.caption;
                }
              } else if (message.caption) {
                endpoint = `${evolutionUrl}/message/sendText/${config.instance_id}`;
                payload = {
                  number: message.group_id,
                  text: message.caption,
                };
              }

let response = await fetch(endpoint, {
  method: 'POST',
  headers: {
    'apikey': evolutionToken,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(payload),
});

if (!response.ok) {
  const errorText = await response.text();
  if (errorText?.includes('No sessions')) {
    console.warn('No sessions on retry. Reconnecting and retrying once...');
    await ensureInstanceSession(config.instance_id);
    await new Promise(r => setTimeout(r, 1000));
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'apikey': evolutionToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  }
}

if (!response.ok) {
  const errorText2 = await response.text();
  throw new Error(`Evolution API error: ${response.status} - ${errorText2}`);
}

              await supabaseClient
                .from('group_messages')
                .update({
                  status: 'sent',
                  sent_at: new Date().toISOString(),
                  error_message: null,
                })
                .eq('id', message.id);

              sent++;
              failed--;
              console.log(`✅ Retry bem-sucedido: ${message.group_name}`);
            } catch (error: any) {
              console.error(`❌ Retry falhou: ${message.group_name}`, error);

              if (message.attempts + 1 >= MAX_MESSAGE_ATTEMPTS) {
                await supabaseClient
                  .from('group_messages')
                  .update({
                    status: 'permanently_failed',
                    error_message: `Falhou após ${MAX_MESSAGE_ATTEMPTS} tentativas: ${error.message}`,
                  })
                  .eq('id', message.id);
                permanentlyFailed++;
                failed--;
              } else {
                await supabaseClient
                  .from('group_messages')
                  .update({ status: 'failed', error_message: error.message })
                  .eq('id', message.id);
              }
            }

            const delay = Math.random() * (config.delay_max - config.delay_min) + config.delay_min;
            await new Promise(resolve => setTimeout(resolve, delay));
          }

          retryAttempt++;

          if (retryAttempt < MAX_RETRY_CYCLES) {
            console.log('⏸️ Aguardando 30s antes do próximo ciclo de retry...');
            await new Promise(resolve => setTimeout(resolve, RETRY_CYCLE_DELAY));
          }
        }

        console.log('Resumo do processamento:', { totalProcessed, sent, failed, permanentlyFailed });
      } catch (e) {
        console.error('Erro no processamento em background:', e);
      }
    })());

    // Resposta imediata para evitar 504 no navegador
    return new Response(
      JSON.stringify({ success: true, message: 'Envio em background iniciado', queued: allMessages.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 202 }
    );

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
