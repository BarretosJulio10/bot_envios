import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Send, Pause, RotateCcw, Download } from "lucide-react";
import { toast } from "sonner";
import UploadSection from "@/components/UploadSection";
import QueueTable from "@/components/QueueTable";
import StatsCards from "@/components/StatsCards";

export default function IndividualSender() {
    const [messages, setMessages] = useState<any[]>([]);
    const [isSending, setIsSending] = useState(false);
    const isSendingRef = useRef(false);
    const [sentSincePause, setSentSincePause] = useState(0);

    // Refs for tracking totals during a session without re-renders affecting logic
    const sessionStats = useRef({
        totalSent: 0,
        totalFailed: 0
    });

    useEffect(() => {
        loadMessages();

        // Realtime subscription
        const channel = supabase
            .channel('messages-changes-individual')
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

    const loadMessages = async () => {
        const { data } = await supabase
            .from('messages')
            .select('*')
            .order('created_at', { ascending: false });

        if (data) setMessages(data);
    };

    const startSending = async () => {
        // Check config existence
        const { data: configData } = await supabase
            .from('evolution_config')
            .select('*')
            .single();

        if (!configData) {
            toast.error("Configure a API Evolution primeiro!");
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

        // Reset session stats
        sessionStats.current = { totalSent: 0, totalFailed: 0 };
        // setSentSincePause(0); // Optional: reset pause counter or keep it? Original code reset it in sendLoop pause logic.

        const pauseAfter = configData.pause_after ?? 100;
        const pauseDuration = configData.pause_duration ?? 60000;

        console.log(`⚙️ Config: pause_after=${pauseAfter}, pause_duration=${pauseDuration}ms`);

        let localSentSincePause = 0; // Local counter for the loop recursion

        const sendLoop = async () => {
            if (!isSendingRef.current) {
                console.log('⏹️ sendLoop: Parado pelo usuário');
                return;
            }

            console.log(`📞 sendLoop: Chamando edge function... (sentSincePause=${localSentSincePause}/${pauseAfter}, totalSent=${sessionStats.current.totalSent})`);

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

                localSentSincePause += sent;
                sessionStats.current.totalSent += sent;
                sessionStats.current.totalFailed += failed;

                // Update UI counter if needed, though mostly internal
                setSentSincePause(localSentSincePause);

                console.log(`📊 Atualizado: sentSincePause=${localSentSincePause}/${pauseAfter}, totalSent=${sessionStats.current.totalSent}, processed=${processed}, sent=${sent}, failed=${failed}, moreRemaining=${more}`);

                if (more) {
                    // Há mais mensagens na fila
                    if (localSentSincePause < pauseAfter) {
                        // Ainda não atingiu o limite de pause_after, continuar imediatamente
                        // (O delay entre mensagens individuais acontece DENTRO da Edge Function no backend OU se for 1 por 1, o backend retorna rápido.
                        //  No caso do backend "legacy" que revertemos, ele processa lotes e delays internos. Se revertemos para o código de 5 dias atrás, ele deve ter isso.)
                        console.log(`⏩ Continuando imediatamente (${localSentSincePause}/${pauseAfter})...`);
                        sendLoop();
                    } else {
                        // Atingiu o limite, pausar antes de continuar
                        console.log(`⏸️ Atingiu ${pauseAfter} envios. Pausando por ${pauseDuration}ms...`);
                        toast.info(`Pausando por ${pauseDuration / 1000}s após ${localSentSincePause} envios`);

                        setTimeout(() => {
                            if (isSendingRef.current) {
                                console.log('▶️ Retomando após pausa...');
                                localSentSincePause = 0; // Reset counter
                                setSentSincePause(0);
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
                    toast.success(`Envio concluído! Total enviado: ${sessionStats.current.totalSent}`);
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
    };

    const cleanupStorageFiles = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            const { data: files, error: listError } = await supabase
                .storage
                .from('whatsapp-files')
                .list(user.id);

            if (listError) {
                console.error('Error listing files:', listError);
                return;
            }

            if (files && files.length > 0) {
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
            const { error: msgError } = await supabase
                .from('messages')
                .delete()
                .eq('user_id', user.id);

            const { error: blacklistError } = await supabase
                .from('blacklist')
                .delete()
                .eq('user_id', user.id);

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
        <div className="space-y-8">
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
        </div>
    );
}
