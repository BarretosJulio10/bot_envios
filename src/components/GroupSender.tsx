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
  const [caption, setCaption] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [filePreviews, setFilePreviews] = useState<string[]>([]);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [messagesPerBatch, setMessagesPerBatch] = useState(10);
  const [pauseDuration, setPauseDuration] = useState(120);
  const [sendAsDocument, setSendAsDocument] = useState(false);
  const [sendAsSticker, setSendAsSticker] = useState(false);

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
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length > 0) {
      setFiles(prev => [...prev, ...selectedFiles]);

      selectedFiles.forEach(file => {
        if (file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onloadend = () => {
            setFilePreviews(prev => [...prev, reader.result as string]);
          };
          reader.readAsDataURL(file);
        } else {
          setFilePreviews(prev => [...prev, ""]);
        }
      });
    }
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
    setFilePreviews(prev => prev.filter((_, i) => i !== index));
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

    if (!caption && files.length === 0) {
      toast.error("Adicione uma mensagem ou arquivos");
      return;
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");

      // Primeiro, processar todos os uploads e obter as URLs/metadata
      const uploadedFilesMetadata = [];

      for (const file of files) {
        console.log("Iniciando upload do arquivo:", file.name);
        const fileExt = file.name.split('.').pop();
        const fileName = `${user.id}/${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;

        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('whatsapp-files')
          .upload(fileName, file);

        if (uploadError) {
          console.error("Erro no upload de", file.name, ":", uploadError);
          throw uploadError;
        }

        const { data: urlData } = supabase.storage
          .from('whatsapp-files')
          .getPublicUrl(fileName);

        if (!urlData || !urlData.publicUrl) {
          throw new Error(`Não foi possível gerar a URL pública para ${file.name}`);
        }

        uploadedFilesMetadata.push({
          url: urlData.publicUrl,
          type: getFileType(file.type),
          name: file.name
        });
        console.log("Arquivo processado:", file.name, "->", urlData.publicUrl);
      }

      // Atualizar configuração
      const { error: configError } = await supabase
        .from('evolution_config')
        .update({
          pause_after: messagesPerBatch,
          pause_duration: pauseDuration * 1000,
        })
        .eq('user_id', user.id);

      if (configError) throw configError;

      const messagesToInsert: any[] = [];
      const userFileType = sendAsSticker ? 'sticker' : (sendAsDocument ? 'document' : null);
      let globalIndex = 0;

      // Ordem solicitada pelo usuário: Todas as mensagens para um grupo primeiro, depois para o outro
      for (const groupId of Array.from(selectedGroups)) {
        const group = groups.find(g => g.id === groupId);

        // Se temos arquivos, criar uma mensagem para cada arquivo no grupo atual
        if (uploadedFilesMetadata.length > 0) {
          uploadedFilesMetadata.forEach((fileMeta, index) => {
            messagesToInsert.push({
              user_id: user.id,
              group_id: groupId,
              group_name: group?.name || 'Desconhecido',
              image_url: fileMeta.url,
              file_name: fileMeta.name,
              file_type: userFileType || fileMeta.type,
              caption: index === 0 ? (caption || null) : null,
              status: 'queued',
              ordering_index: globalIndex++
            });
          });
        }
        // Se NÃO temos arquivos mas temos legenda, criar mensagem de texto
        else if (caption) {
          messagesToInsert.push({
            user_id: user.id,
            group_id: groupId,
            group_name: group?.name || 'Desconhecido',
            image_url: null,
            file_name: null,
            file_type: 'image',
            caption: caption,
            status: 'queued',
            ordering_index: globalIndex++
          });
        }
      }


      console.log("Inserindo mensagens na fila:", messagesToInsert);

      const { error: insertError } = await supabase
        .from('group_messages')
        .insert(messagesToInsert);

      if (insertError) throw insertError;

      toast.success(`${messagesToInsert.length} mensagens adicionadas à fila!`);

      // Limpar formulário
      setSelectedGroups(new Set());
      setFiles([]);
      setFilePreviews([]);
      setCaption("");
      setSendAsDocument(false);
      setSendAsSticker(false);

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

      setFiles([]);
      setFilePreviews([]);
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
              placeholder="Ex: 10 (recomendado para evitar bloqueio)"
            />
            <p className="text-xs text-muted-foreground">Recomendado: 5-10 mensagens</p>
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
              placeholder="Ex: 120 (2 minutos)"
            />
            <p className="text-xs text-muted-foreground">Recomendado: 120-180 segundos (2-3 min)</p>
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
        <div className="space-y-4">
          <Label htmlFor="file">Arquivos (opcional - você pode selecionar vários)</Label>
          <Input
            id="file"
            type="file"
            onChange={handleFileChange}
            multiple
          />

          {files.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 mt-2">
              {files.map((file, index) => (
                <div key={index} className="relative group bg-accent p-2 rounded-xl border border-white/10 hover:border-white/20 transition-all shadow-sm">
                  {filePreviews[index] ? (
                    <img src={filePreviews[index]} alt="Preview" className="w-full h-24 object-cover rounded-lg" />
                  ) : (
                    <div className="w-full h-24 flex flex-col items-center justify-center bg-black/40 rounded-lg p-1 text-center">
                      <p className="text-[10px] font-medium truncate w-full px-1">{file.name}</p>
                      <p className="text-[9px] text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                    </div>
                  )}
                  <button
                    onClick={() => removeFile(index)}
                    className="absolute -top-2 -right-2 bg-[#ef4444] text-white rounded-full p-1 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col space-y-2 pt-2">
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="groupSendAsDocument"
                checked={sendAsDocument}
                onChange={(e) => {
                  setSendAsDocument(e.target.checked);
                  if (e.target.checked) setSendAsSticker(false);
                }}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <Label htmlFor="groupSendAsDocument" className="text-sm font-medium leading-none">
                Enviar como documento (sem compressão)
              </Label>
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="groupSendAsSticker"
                checked={sendAsSticker}
                onChange={(e) => {
                  setSendAsSticker(e.target.checked);
                  if (e.target.checked) setSendAsDocument(false);
                }}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <Label htmlFor="groupSendAsSticker" className="text-sm font-medium leading-none">
                Enviar como figurinha
              </Label>
            </div>
          </div>
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
