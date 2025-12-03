import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { LogOut, Settings, Send, Pause, RotateCcw, Download, Users } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import UploadSection from "@/components/UploadSection";
import QueueTable from "@/components/QueueTable";
import StatsCards from "@/components/StatsCards";
import ConfigDialog from "@/components/ConfigDialog";
import SavedListsManager from "@/components/SavedListsManager";
import GroupSender from "@/components/GroupSender";

export default function Dashboard() {
  const [hasConfig, setHasConfig] = useState(false);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [messages, setMessages] = useState<any[]>([]);
  const [isSending, setIsSending] = useState(false);
  const isSendingRef = useRef(false);

  useEffect(() => {
    checkConfig();
    loadMessages();
    
    // Realtime subscription
    const channel = supabase
      .channel('messages-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages'
        },
        () => {
          loadMessages();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const checkConfig = async () => {
    const { data } = await supabase
      .from('evolution_config')
      .select('*')
      .single();
    
    setHasConfig(!!data);
    if (!data) {
      setIsConfigOpen(true);
    }
  };

  const loadMessages = async () => {
    const { data } = await supabase
      .from('messages')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (data) setMessages(data);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast.success("Logout realizado!");
  };

  const startSending = async () => {
    if (!hasConfig) {
      toast.error("Configure a API Evolution primeiro!");
      setIsConfigOpen(true);
      return;
    }

    const queued = messages.filter(m => m.status === 'queued');
    if (queued.length === 0) {
      toast.error("Não há mensagens na fila!");
      return;
    }

    console.log('🚀 startSending: Iniciando envios...');
    setIsSending(true);
    isSendingRef.current = true;
    toast.success("Envio iniciado!");

    try {
      const { data: cfg } = await supabase
        .from('evolution_config')
        .select('pause_after, pause_duration')
        .single();

      const pauseAfter = cfg?.pause_after ?? 100;
      const pauseDuration = cfg?.pause_duration ?? 60000;
      
      console.log(`⚙️ Config: pause_after=${pauseAfter}, pause_duration=${pauseDuration}ms`);

      let sentSincePause = 0;
      let totalSent = 0;

      const sendLoop = async () => {
        if (!isSendingRef.current) {
          console.log('⏹️ sendLoop: Parado pelo usuário');
          return;
        }

        console.log(`📞 sendLoop: Chamando edge function... (sentSincePause=${sentSincePause}/${pauseAfter}, totalSent=${totalSent})`);
        
        try {
          const { data, error } = await supabase.functions.invoke('send-messages', {
            body: { action: 'start' }
          });
          
          if (error) throw error;

          console.log('✅ Batch result:', data);

          const sent = data?.sent || 0;
          const failed = data?.failed || 0;
          const processed = data?.processed || 0;
          const more = data?.moreRemaining;

          sentSincePause += sent;
          totalSent += sent;

          console.log(`📊 Atualizado: sentSincePause=${sentSincePause}/${pauseAfter}, totalSent=${totalSent}, processed=${processed}, sent=${sent}, failed=${failed}, moreRemaining=${more}`);

          if (more) {
            // Há mais mensagens na fila
            if (sentSincePause < pauseAfter) {
              // Ainda não atingiu o limite de pause_after, continuar imediatamente
              console.log(`⏩ Continuando imediatamente (${sentSincePause}/${pauseAfter})...`);
              sendLoop();
            } else {
              // Atingiu o limite, pausar antes de continuar
              console.log(`⏸️ Atingiu ${pauseAfter} envios. Pausando por ${pauseDuration}ms...`);
              toast.info(`Pausando por ${pauseDuration / 1000}s após ${sentSincePause} envios`);
              
              setTimeout(() => {
                if (isSendingRef.current) {
                  console.log('▶️ Retomando após pausa...');
                  sentSincePause = 0; // Reset counter
                  sendLoop();
                } else {
                  console.log('⏹️ Parado durante a pausa');
                }
              }, pauseDuration);
            }
          } else {
            // Não há mais mensagens, finalizar
            console.log('🎉 Todos os envios concluídos!');
            setIsSending(false);
            isSendingRef.current = false;
            toast.success(`Envio concluído! Total enviado: ${totalSent}`);
            await cleanupStorageFiles();
          }
        } catch (err: any) {
          console.error('❌ Batch error:', err);
          setIsSending(false);
          isSendingRef.current = false;
          toast.error(err.message || 'Erro durante o envio');
        }
      };

      // Iniciar loop
      sendLoop();
    } catch (e: any) {
      console.error('❌ Erro ao carregar configuração:', e);
      setIsSending(false);
      toast.error(e.message || 'Erro ao carregar configuração');
    }
  };

  const cleanupStorageFiles = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Listar todos os arquivos do usuário no bucket
      const { data: files, error: listError } = await supabase
        .storage
        .from('whatsapp-files')
        .list(user.id);

      if (listError) {
        console.error('Error listing files:', listError);
        return;
      }

      if (files && files.length > 0) {
        // Deletar todos os arquivos
        const filePaths = files.map(file => `${user.id}/${file.name}`);
        const { error: deleteError } = await supabase
          .storage
          .from('whatsapp-files')
          .remove(filePaths);

        if (deleteError) {
          console.error('Error deleting files:', deleteError);
        } else {
          console.log(`Deleted ${filePaths.length} files from storage`);
        }
      }
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  };

  const pauseSending = async () => {
    console.log('⏸️ pauseSending: Pausando envios...');
    isSendingRef.current = false;
    setIsSending(false);
    
    try {
      const { error } = await supabase.functions.invoke('send-messages', {
        body: { action: 'pause' }
      });
      
      if (error) throw error;
      toast.success("Envio pausado!");
    } catch (error: any) {
      toast.error(error.message || "Erro ao pausar");
    }
  };

  const retryFailed = async () => {
    try {
      const { error } = await supabase.functions.invoke('send-messages', {
        body: { action: 'retry' }
      });
      
      if (error) throw error;
      toast.success("Reenvio iniciado!");
    } catch (error: any) {
      toast.error(error.message || "Erro ao reenviar");
    }
  };

  const exportLogs = () => {
    const csv = [
      ['Arquivo', 'Telefone', 'Status', 'Tentativas', 'Data Criação', 'Data Envio', 'Erro'].join(','),
      ...messages.map(m => [
        m.filename,
        m.phone,
        m.status,
        m.attempts,
        m.created_at,
        m.sent_at || '',
        m.error_message || ''
      ].join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `logs-${new Date().toISOString()}.csv`;
    a.click();
    toast.success("Log exportado!");
  };

  const clearQueue = async () => {
    if (!confirm("Deseja limpar toda a fila?")) return;
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    try {
      // Deletar mensagens
      const { error: msgError } = await supabase
        .from('messages')
        .delete()
        .eq('user_id', user.id);
      
      // Limpar blacklist também (como solicitado)
      const { error: blacklistError } = await supabase
        .from('blacklist')
        .delete()
        .eq('user_id', user.id);
      
      // Limpar arquivos do storage
      await cleanupStorageFiles();
      
      if (msgError || blacklistError) {
        toast.error("Erro ao limpar fila");
      } else {
        toast.success("Fila, blacklist e arquivos limpos!");
      }
    } catch (error: any) {
      toast.error(error.message || "Erro ao limpar");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold bg-gradient-primary bg-clip-text text-transparent">
            WhatsApp Sender
          </h1>
          <div className="flex gap-2">
            <SavedListsManager />
            
            <Button
              variant="outline"
              size="icon"
              onClick={() => setIsConfigOpen(true)}
              title="Configurações"
            >
              <Settings className="h-4 w-4" />
            </Button>
            
            <Button
              variant="outline"
              size="icon"
              onClick={handleLogout}
              title="Sair"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Tabs defaultValue="individual" className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-8">
            <TabsTrigger value="individual" className="gap-2">
              <Send className="h-4 w-4" />
              Envio Individual
            </TabsTrigger>
            <TabsTrigger value="groups" className="gap-2">
              <Users className="h-4 w-4" />
              Envio para Grupos
            </TabsTrigger>
          </TabsList>

          <TabsContent value="individual" className="space-y-8">
            <StatsCards messages={messages} />
            <UploadSection onUploadComplete={loadMessages} />

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={startSending}
                disabled={isSending}
                className="gap-2"
              >
                <Send className="h-4 w-4" />
                Iniciar Envio
              </Button>
              <Button
                onClick={pauseSending}
                variant="outline"
                className="gap-2"
              >
                <Pause className="h-4 w-4" />
                Pausar
              </Button>
              <Button
                onClick={retryFailed}
                variant="outline"
                className="gap-2"
              >
                <RotateCcw className="h-4 w-4" />
                Reenviar Falhas
              </Button>
              <Button
                onClick={exportLogs}
                variant="outline"
                className="gap-2"
              >
                <Download className="h-4 w-4" />
                Exportar Log
              </Button>
              <Button
                onClick={clearQueue}
                variant="destructive"
                className="gap-2"
              >
                Limpar Fila
              </Button>
            </div>

            <QueueTable messages={messages} />
          </TabsContent>

          <TabsContent value="groups">
            <GroupSender />
          </TabsContent>
        </Tabs>
      </main>

      <ConfigDialog
        open={isConfigOpen}
        onOpenChange={setIsConfigOpen}
        onSaved={() => {
          setHasConfig(true);
          checkConfig();
        }}
      />
    </div>
  );
}
