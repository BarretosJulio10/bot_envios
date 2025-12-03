import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Buscar mensagens enviadas há mais de 5 horas
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    
    const { data: oldMessages, error: queryError } = await supabase
      .from('messages')
      .select('file_url')
      .eq('status', 'sent')
      .lt('sent_at', fiveHoursAgo)
      .not('file_url', 'is', null);

    if (queryError) {
      throw queryError;
    }

    if (!oldMessages || oldMessages.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Nenhum arquivo para limpar',
          deleted: 0 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Deletar arquivos do storage
    let deletedCount = 0;
    for (const msg of oldMessages) {
      if (msg.file_url) {
        // Extrair path do arquivo da URL
        const urlParts = msg.file_url.split('/');
        const bucketIndex = urlParts.indexOf('whatsapp-files');
        if (bucketIndex !== -1) {
          const filePath = urlParts.slice(bucketIndex + 1).join('/');
          
          const { error: deleteError } = await supabase
            .storage
            .from('whatsapp-files')
            .remove([filePath]);

          if (!deleteError) {
            deletedCount++;
            console.log(`Deleted file: ${filePath}`);
          } else {
            console.error(`Failed to delete ${filePath}:`, deleteError);
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `${deletedCount} arquivos deletados com sucesso`,
        deleted: deletedCount,
        total: oldMessages.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error in cleanup-files function:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
