import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Upload, FileText, Save, Plus } from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";

interface UploadSectionProps {
  onUploadComplete: () => void;
}

export default function UploadSection({ onUploadComplete }: UploadSectionProps) {
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [files, setFiles] = useState<FileList | null>(null);
  const [messageText, setMessageText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [campaignName, setCampaignName] = useState("");
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [blacklistInput, setBlacklistInput] = useState("");
  const [sendAsDocument, setSendAsDocument] = useState(false);
  const queryClient = useQueryClient();

  const addToBlacklist = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Não autenticado');

      const items = blacklistInput
        .split(',')
        .map(item => item.trim())
        .filter(item => item.length > 0);

      if (items.length === 0) {
        throw new Error('Entrada inválida');
      }

      const isNumberIds = items.every(item => /^\d+$/.test(item));

      if (isNumberIds) {
        const { error } = await supabase
          .from('blacklist')
          .insert({
            user_id: user.id,
            number_ids: items.join(','),
            phone: `IDs: ${items.join(',')}`
          });
        if (error) throw error;
      } else {
        const records = items.map(phone => ({
          user_id: user.id,
          phone: phone.replace(/\D/g, '')
        }));

        const { error } = await supabase
          .from('blacklist')
          .insert(records);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blacklist'] });
      toast.success('Adicionado à blacklist');
      setBlacklistInput('');
    },
    onError: (error: any) => {
      toast.error(error.message);
    }
  });

  const processUpload = async (saveName?: string) => {
    if (!csvFile || !files || files.length === 0) {
      toast.error("Selecione CSV e arquivos!");
      return;
    }

    setUploading(true);

    try {
      // TODO: Parse CSV para extrair dados
      const csvText = await csvFile.text();
      const lines = csvText.split('\n').slice(1); // Remove header
      const csvData: { [key: string]: string } = {};

      lines.forEach(line => {
        const [id, phone] = line.split(';').map(s => s.trim());
        if (id && phone) csvData[id] = phone.replace(/\D/g, '');
      });

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");

      // TODO: Buscar blacklist (números E IDs)
      const { data: blacklist } = await supabase
        .from('blacklist')
        .select('phone, number_ids');

      const blacklistedNumbers = new Set(blacklist?.map(b => b.phone) || []);
      const blacklistedIds = new Set<string>();

      // TODO: Parsear IDs da blacklist
      blacklist?.forEach(item => {
        if (item.number_ids) {
          const ids = item.number_ids.split(',').map(id => id.trim());
          ids.forEach(id => blacklistedIds.add(id));
        }
      });

      // TODO: Filtrar números e IDs bloqueados
      const validContacts = Object.entries(csvData).filter(
        ([id, phone]) => !blacklistedNumbers.has(phone) && !blacklistedIds.has(id)
      );

      const blockedCount = Object.keys(csvData).length - validContacts.length;
      if (blockedCount > 0) {
        toast.warning(`${blockedCount} número(s) bloqueado(s) removido(s)`);
      }

      if (validContacts.length === 0) {
        toast.error("Todos os números estão na blacklist!");
        setUploading(false);
        return;
      }

      // TODO: Se saveName foi fornecido, salvar lista permanentemente
      if (saveName) {
        const contactsToSave = await Promise.all(
          Array.from(files).map(async (file, i) => {
            const fileName = file.name;
            const fileId = fileName.split('.')[0];
            const phone = csvData[fileId];

            if (!phone || blacklistedNumbers.has(phone) || blacklistedIds.has(fileId)) {
              return null;
            }

            // Upload file
            const filePath = `${user.id}/${Date.now()}_${fileName}`;
            const { error: uploadError } = await supabase.storage
              .from('whatsapp-files')
              .upload(filePath, file);

            if (uploadError) throw uploadError;

            const { data: { publicUrl } } = supabase.storage
              .from('whatsapp-files')
              .getPublicUrl(filePath);

            return {
              phone,
              message_text: messageText,
              filename: fileName,
              file_url: publicUrl,
            };
          })
        );

        const validContactsToSave = contactsToSave.filter(c => c !== null);

        // TODO: Salvar lista na tabela saved_lists
        await supabase.from('saved_lists').insert({
          user_id: user.id,
          name: saveName,
          contacts: validContactsToSave,
        });

        toast.success(`Lista "${saveName}" salva com ${validContactsToSave.length} contatos!`);
      }

      // TODO: Criar campanha para envio imediato
      const { data: campaign, error: campaignError } = await supabase
        .from('campaigns')
        .insert({
          user_id: user.id,
          name: saveName || `Campanha ${new Date().toLocaleString('pt-BR')}`,
          total_numbers: validContacts.length
        })
        .select()
        .single();

      if (campaignError) throw campaignError;

      // TODO: Upload files and create messages (se ainda não foi feito no save)
      let successCount = 0;
      if (!saveName) {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const fileName = file.name;
          const fileId = fileName.split('.')[0];
          const phone = csvData[fileId];

          if (!phone || blacklistedNumbers.has(phone) || blacklistedIds.has(fileId)) continue;

          // Upload file
          const filePath = `${user.id}/${Date.now()}_${fileName}`;
          const { error: uploadError } = await supabase.storage
            .from('whatsapp-files')
            .upload(filePath, file);

          if (uploadError) throw uploadError;

          const { data: { publicUrl } } = supabase.storage
            .from('whatsapp-files')
            .getPublicUrl(filePath);

          // Create message in queue
          await supabase.from('messages').insert({
            user_id: user.id,
            campaign_id: campaign.id,
            filename: fileName,
            phone: phone,
            message_text: messageText,
            file_url: publicUrl,
            status: 'queued',
            file_type: sendAsDocument ? 'document' : undefined
          });

          successCount++;
        }
      } else {
        successCount = validContacts.length;
      }

      toast.success(`${successCount} mensagens adicionadas à fila!`);
      setCsvFile(null);
      setFiles(null);
      setMessageText("");
      setCampaignName("");
      setShowSaveDialog(false);
      onUploadComplete();

    } catch (error: any) {
      toast.error(error.message || "Erro ao processar arquivos");
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await processUpload();
  };

  const handleSaveAndProcess = () => {
    if (!campaignName.trim()) {
      toast.error("Digite um nome para a campanha");
      return;
    }
    setShowSaveDialog(false);
    processUpload(campaignName);
  };

  return (
    <Card className="border-border/50 shadow-elegant bg-gradient-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="h-5 w-5 text-primary" />
          Upload de Arquivos
        </CardTitle>
        <CardDescription>
          Envie o CSV e os arquivos para criar a fila de envio
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="csv">Arquivo CSV (id;whatsapp)</Label>
            <div className="flex items-center gap-2">
              <Input
                id="csv"
                type="file"
                accept=".csv"
                onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                disabled={uploading}
                required
              />
              {csvFile && (
                <FileText className="h-5 w-5 text-primary" />
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="files">Arquivos (PDF, imagens, vídeos, etc)</Label>
            <Input
              id="files"
              type="file"
              multiple
              onChange={(e) => setFiles(e.target.files)}
              disabled={uploading}
              required
            />
            {files && (
              <p className="text-sm text-muted-foreground">
                {files.length} arquivo(s) selecionado(s)
              </p>
            )}
            <div className="flex items-center space-x-2 pt-2">
              <input
                type="checkbox"
                id="sendAsDocument"
                checked={sendAsDocument}
                onChange={(e) => setSendAsDocument(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <Label htmlFor="sendAsDocument" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                Enviar como documento (sem compressão)
              </Label>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="blacklist">Blacklist</Label>
            <div className="flex gap-2">
              <Input
                id="blacklist"
                placeholder="Ex: 1,2,3,7,30 ou números completos separados por vírgula"
                value={blacklistInput}
                onChange={(e) => setBlacklistInput(e.target.value)}
                disabled={addToBlacklist.isPending}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => addToBlacklist.mutate()}
                disabled={!blacklistInput || addToBlacklist.isPending}
                title="Adicionar à blacklist"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="message">Mensagem (opcional)</Label>
            <Textarea
              id="message"
              placeholder="Olá! Segue o documento solicitado..."
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              disabled={uploading}
              rows={4}
            />
          </div>

          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={uploading}
              className="flex-1"
            >
              {uploading ? "Processando..." : "Adicionar à Fila"}
            </Button>

            <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
              <DialogTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  disabled={uploading || !csvFile || !files}
                  className="gap-2"
                >
                  <Save className="h-4 w-4" />
                  Salvar Lista
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Salvar Lista de Envio</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Nome da Campanha</Label>
                    <Input
                      placeholder="Ex: Campanha Janeiro 2025"
                      value={campaignName}
                      onChange={(e) => setCampaignName(e.target.value)}
                    />
                  </div>
                  <Button onClick={handleSaveAndProcess} className="w-full">
                    Confirmar e Adicionar
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
