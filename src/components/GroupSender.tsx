import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Send, Upload, Trash2, RefreshCw, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import SavedGroupListsManager from "./SavedGroupListsManager";

interface Group {
  id: string;
  name: string;
  participants: number;
}

interface GroupMessage {
  id: string;
  group_id: string;
  group_name: string;
  image_url: string | null;
  caption: string | null;
  status: string;
  attempts: number;
  created_at: string;
  sent_at: string | null;
  error_message: string | null;
}

export default function GroupSender() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string>("");
  const [caption, setCaption] = useState("");
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [messagesPerBatch, setMessagesPerBatch] = useState(5);
  const [pauseDuration, setPauseDuration] = useState(30);

  useEffect(() => {
    loadMessages();
    loadConfig();

    const channel = supabase
      .channel('group-messages-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'group_messages'
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

  const loadConfig = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: config } = await supabase
      .from('evolution_config')
      .select('pause_after, pause_duration')
      .eq('user_id', user.id)
      .single();

    if (config) {
      setMessagesPerBatch(config.pause_after || 5);
      setPauseDuration(Math.floor((config.pause_duration || 30000) / 1000));
    }
  };

  const loadMessages = async () => {
    const { data } = await supabase
      .from('group_messages')
      .select('*')
      .order('created_at', { ascending: false });

    if (data) setMessages(data);
  };

  const fetchGroups = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('fetch-groups');

      if (error) throw error;

      if (data.success) {
        setGroups(data.groups);
        toast.success(`${data.groups.length} grupos encontrados!`);
      } else {
        toast.error(data.error || 'Erro ao buscar grupos');
      }
    } catch (error: any) {
      toast.error(error.message || 'Erro ao buscar grupos');
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      
      // Preview apenas para imagens
      if (selectedFile.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onloadend = () => {
          setFilePreview(reader.result as string);
        };
        reader.readAsDataURL(selectedFile);
      } else {
        setFilePreview("");
      }
    }
  };

  const getFileType = (mimeType: string): string => {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) return 'audio';
    return 'document';
  };

  const toggleGroup = (groupId: string) => {
    const newSelected = new Set(selectedGroups);
    if (newSelected.has(groupId)) {
      newSelected.delete(groupId);
    } else {
      newSelected.add(groupId);
    }
    setSelectedGroups(newSelected);
  };

  const selectAll = () => {
    if (selectedGroups.size === groups.length) {
      setSelectedGroups(new Set());
    } else {
      setSelectedGroups(new Set(groups.map(g => g.id)));
    }
  };

  const loadListGroups = async (groupIds: string[]) => {
    setSelectedGroups(new Set(groupIds));
    
    // Se não temos os grupos carregados, buscar automaticamente
    if (groups.length === 0) {
      await fetchGroups();
    }
  };

  const createMessages = async () => {
    if (selectedGroups.size === 0) {
      toast.error("Selecione pelo menos um grupo");
      return;
    }

    if (!caption && !file) {
      toast.error("Adicione uma mensagem ou arquivo");
      return;
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");

      let fileUrl = null;
      let fileType = 'image';

      // Upload do arquivo se existir
      if (file) {
        const fileExt = file.name.split('.').pop();
        const fileName = `${user.id}/${Date.now()}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from('whatsapp-files')
          .upload(fileName, file);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from('whatsapp-files')
          .getPublicUrl(fileName);

        fileUrl = publicUrl;
        fileType = getFileType(file.type);
      }

      // Atualizar configuração com os novos parâmetros (convertendo segundos para milissegundos)
      const { error: configError } = await supabase
        .from('evolution_config')
        .update({
          pause_after: messagesPerBatch,
          pause_duration: pauseDuration * 1000,
        })
        .eq('user_id', user.id);

      if (configError) throw configError;

      // Criar mensagens para cada grupo selecionado
      const messagesToInsert = Array.from(selectedGroups).map(groupId => {
        const group = groups.find(g => g.id === groupId);
        return {
          user_id: user.id,
          group_id: groupId,
          group_name: group?.name || 'Desconhecido',
          image_url: fileUrl,
          file_type: fileType,
          caption: caption || null,
          status: 'queued',
        };
      });

      const { error: insertError } = await supabase
        .from('group_messages')
        .insert(messagesToInsert);

      if (insertError) throw insertError;

      toast.success(`${messagesToInsert.length} mensagens adicionadas à fila!`);
      
      // Limpar formulário
      setSelectedGroups(new Set());
      setFile(null);
      setFilePreview("");
      setCaption("");
      
    } catch (error: any) {
      toast.error(error.message || 'Erro ao criar mensagens');
    } finally {
      setLoading(false);
    }
  };

  const startSending = async () => {
    const queued = messages.filter(m => m.status === 'queued');
    if (queued.length === 0) {
      toast.error("Não há mensagens na fila!");
      return;
    }

    setSending(true);
    toast.success("Envio de mensagens em grupo iniciado!");

    try {
      const { data, error } = await supabase.functions.invoke('send-group-messages');

      if (error) throw error;

      if (data.success) {
        toast.success(data.message || 'Envio iniciado! Acompanhe o progresso em tempo real.');
      } else {
        toast.error(data.error || 'Erro ao enviar mensagens');
      }
    } catch (error: any) {
      toast.error(error.message || 'Erro ao enviar mensagens');
    } finally {
      setSending(false);
    }
  };

  const cleanupAfterSending = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Deletar mensagens enviadas com sucesso
      const { error: deleteError } = await supabase
        .from('group_messages')
        .delete()
        .eq('user_id', user.id)
        .eq('status', 'sent');

      if (deleteError) throw deleteError;

      // Limpar arquivos do storage
      const { data: files } = await supabase
        .storage
        .from('whatsapp-files')
        .list(user.id);

      if (files && files.length > 0) {
        const filePaths = files.map(file => `${user.id}/${file.name}`);
        await supabase.storage
          .from('whatsapp-files')
          .remove(filePaths);
      }

      toast.success("Banco de dados limpo automaticamente!");
      
    } catch (error: any) {
      console.error('Cleanup error:', error);
    }
  };

  const clearAll = async () => {
    if (!confirm("Deseja limpar todas as mensagens e arquivos?")) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Deletar mensagens de grupo
      await supabase
        .from('group_messages')
        .delete()
        .eq('user_id', user.id);

      // Deletar campanhas
      await supabase
        .from('campaigns')
        .delete()
        .eq('user_id', user.id);

      // Limpar arquivos do storage
      const { data: files } = await supabase
        .storage
        .from('whatsapp-files')
        .list(user.id);

      if (files && files.length > 0) {
        const filePaths = files.map(file => `${user.id}/${file.name}`);
        await supabase.storage
          .from('whatsapp-files')
          .remove(filePaths);
      }

      setFile(null);
      setFilePreview("");
      setCaption("");
      toast.success("Tudo limpo!");
      
    } catch (error: any) {
      toast.error(error.message || 'Erro ao limpar');
    }
  };

  const stats = {
    queued: messages.filter(m => m.status === 'queued').length,
    sent: messages.filter(m => m.status === 'sent').length,
    failed: messages.filter(m => m.status === 'failed' || m.status === 'permanently_failed').length,
  };

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="text-sm text-muted-foreground">Na Fila</div>
          <div className="text-2xl font-bold">{stats.queued}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-muted-foreground">Enviadas</div>
          <div className="text-2xl font-bold text-green-600">{stats.sent}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-muted-foreground">Falhas</div>
          <div className="text-2xl font-bold text-red-600">{stats.failed}</div>
        </Card>
      </div>

      {/* Controles de Pausa */}
      <Card className="p-4">
        <h3 className="font-semibold mb-4">Configuração de Pausas</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="messages_per_batch">Mensagens antes da pausa</Label>
            <Input
              id="messages_per_batch"
              type="number"
              value={messagesPerBatch}
              onChange={(e) => setMessagesPerBatch(parseInt(e.target.value))}
              min={1}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pause_duration">Duração da pausa (segundos)</Label>
            <Input
              id="pause_duration"
              type="number"
              value={pauseDuration}
              onChange={(e) => setPauseDuration(parseInt(e.target.value))}
              min={1}
              step={1}
            />
          </div>
        </div>
      </Card>

      {/* Buscar Grupos */}
      <Card className="p-4">
        <Button onClick={fetchGroups} disabled={loading} className="gap-2">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Buscar Meus Grupos
        </Button>
      </Card>

      {/* Lista de Grupos */}
      {groups.length > 0 && (
        <Card className="p-4">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold">Selecione os Grupos ({selectedGroups.size}/{groups.length})</h3>
            <Button variant="outline" size="sm" onClick={selectAll}>
              {selectedGroups.size === groups.length ? 'Desmarcar Todos' : 'Selecionar Todos'}
            </Button>
          </div>
          <div className="max-h-64 overflow-y-auto space-y-2">
            {groups.map((group) => (
              <div
                key={group.id}
                className="flex items-center space-x-2 p-2 hover:bg-accent rounded-lg cursor-pointer"
                onClick={() => toggleGroup(group.id)}
              >
                <Checkbox
                  checked={selectedGroups.has(group.id)}
                  onCheckedChange={() => toggleGroup(group.id)}
                />
                <div className="flex-1">
                  <div className="font-medium">{group.name}</div>
                  <div className="text-xs text-muted-foreground">{group.participants} participantes</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Gerenciador de Listas */}
      <SavedGroupListsManager 
        selectedGroups={selectedGroups}
        onLoadList={loadListGroups}
      />

      {/* Upload e Mensagem */}
      <Card className="p-4 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="file">Arquivo (opcional - imagem, vídeo, áudio ou documento)</Label>
          <Input
            id="file"
            type="file"
            onChange={handleFileChange}
          />
          {filePreview && (
            <img src={filePreview} alt="Preview" className="w-32 h-32 object-cover rounded-lg" />
          )}
          {file && !filePreview && (
            <div className="p-3 bg-accent rounded-lg">
              <p className="text-sm font-medium">{file.name}</p>
              <p className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="caption">Mensagem</Label>
          <Textarea
            id="caption"
            placeholder="Digite sua mensagem aqui..."
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={4}
          />
        </div>

        <div className="flex gap-2">
          <Button onClick={createMessages} disabled={loading} className="gap-2">
            <Upload className="h-4 w-4" />
            Adicionar à Fila
          </Button>
          <Button onClick={startSending} disabled={sending || stats.queued === 0} className="gap-2">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Iniciar Envio
          </Button>
          <Button onClick={clearAll} variant="destructive" className="gap-2">
            <Trash2 className="h-4 w-4" />
            Limpar Tudo
          </Button>
        </div>
      </Card>

      {/* Tabela de Mensagens */}
      {messages.length > 0 && (
        <Card className="p-4">
          <h3 className="font-semibold mb-4">Fila de Mensagens</h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2">Grupo</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Tentativas</th>
                  <th className="text-left p-2">Data</th>
                </tr>
              </thead>
              <tbody>
                {messages.map((msg) => (
                  <tr key={msg.id} className="border-b">
                    <td className="p-2">{msg.group_name}</td>
                    <td className="p-2">
                      <Badge
                        variant={
                          msg.status === 'sent' ? 'default' :
                          msg.status === 'failed' || msg.status === 'permanently_failed' ? 'destructive' :
                          msg.status === 'sending' ? 'secondary' : 'outline'
                        }
                      >
                        {msg.status}
                      </Badge>
                    </td>
                    <td className="p-2">{msg.attempts}</td>
                    <td className="p-2 text-sm text-muted-foreground">
                      {new Date(msg.created_at).toLocaleString('pt-BR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
