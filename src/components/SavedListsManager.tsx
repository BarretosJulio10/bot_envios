// TODO: Componente para gerenciar listas salvas
// Permite selecionar múltiplas listas, editar números inline e deletar listas

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { List, Trash2, Edit2, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export default function SavedListsManager() {
  const [selectedLists, setSelectedLists] = useState<Set<string>>(new Set());
  const [editingList, setEditingList] = useState<string | null>(null);
  const [editedContacts, setEditedContacts] = useState<any[]>([]);
  const [textEditMode, setTextEditMode] = useState(false);
  const [textContent, setTextContent] = useState('');
  const queryClient = useQueryClient();

  // TODO: Buscar listas salvas do banco
  const { data: savedLists = [] } = useQuery({
    queryKey: ['saved-lists'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('saved_lists')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data;
    }
  });

  // TODO: Deletar lista
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('saved_lists')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-lists'] });
      toast.success('Lista removida');
    },
    onError: (error: any) => {
      toast.error(error.message);
    }
  });

  // TODO: Salvar alterações de uma lista (edição inline)
  const updateMutation = useMutation({
    mutationFn: async ({ id, contacts }: { id: string, contacts: any[] }) => {
      const { error } = await supabase
        .from('saved_lists')
        .update({ contacts })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['saved-lists'] });
      toast.success('Lista atualizada');
      setEditingList(null);
    },
    onError: (error: any) => {
      toast.error(error.message);
    }
  });

  // TODO: Alternar seleção de lista
  const toggleListSelection = (listId: string) => {
    const newSelected = new Set(selectedLists);
    if (newSelected.has(listId)) {
      newSelected.delete(listId);
    } else {
      newSelected.add(listId);
    }
    setSelectedLists(newSelected);
  };

  // TODO: Iniciar edição de lista
  const startEditing = (list: any) => {
    setEditingList(list.id);
    setEditedContacts([...list.contacts]);
    setTextEditMode(false);
    
    // Converter para formato texto
    const textLines = list.contacts.map((c: any, idx: number) => 
      `${idx + 1};${c.phone}`
    ).join('\n');
    setTextContent(textLines);
  };

  // Converter texto para array de contatos
  const parseTextToContacts = (text: string): any[] => {
    const lines = text.trim().split('\n').filter(line => line.trim());
    return lines.map(line => {
      const parts = line.split(';');
      const phone = parts.length > 1 ? parts[1].trim() : parts[0].trim();
      return { phone };
    });
  };

  // TODO: Atualizar contato editado
  const updateContact = (index: number, field: string, value: string) => {
    const updated = [...editedContacts];
    updated[index] = { ...updated[index], [field]: value };
    setEditedContacts(updated);
  };

  // TODO: Salvar edições
  const saveEdits = () => {
    if (!editingList) return;
    
    // Se estiver em modo texto, converter o texto para contatos
    const contactsToSave = textEditMode ? parseTextToContacts(textContent) : editedContacts;
    
    // Preservar dados adicionais dos contatos originais (message_text, filename, file_url)
    const list = savedLists.find(l => l.id === editingList);
    if (list && textEditMode) {
      const originalContacts = list.contacts;
      const updatedContacts = contactsToSave.map((newContact, idx) => {
        const original = originalContacts[idx] || {};
        return {
          ...original,
          phone: newContact.phone
        };
      });
      updateMutation.mutate({ id: editingList, contacts: updatedContacts });
    } else {
      updateMutation.mutate({ id: editingList, contacts: contactsToSave });
    }
  };

  // TODO: Enviar mensagens para listas selecionadas
  const sendToSelectedLists = async () => {
    if (selectedLists.size === 0) {
      toast.error("Selecione pelo menos uma lista");
      return;
    }

    try {
      const listsToSend = savedLists.filter(list => selectedLists.has(list.id));
      
      // TODO: Consolidar contatos de todas as listas selecionadas (evitar duplicatas)
      const allContacts = new Map();
      listsToSend.forEach(list => {
        const contacts = Array.isArray(list.contacts) ? list.contacts : [];
        contacts.forEach((contact: any) => {
          // Usar telefone como chave para evitar duplicação
          if (!allContacts.has(contact.phone)) {
            allContacts.set(contact.phone, contact);
          }
        });
      });

      const uniqueContacts = Array.from(allContacts.values());

      // TODO: Inserir mensagens na fila
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Não autenticado');

      const messages = uniqueContacts.map(contact => ({
        user_id: user.id,
        phone: contact.phone,
        message_text: contact.message_text || '',
        filename: contact.filename || 'arquivo',
        file_url: contact.file_url || '',
        status: 'queued',
      }));

      const { error } = await supabase.from('messages').insert(messages);
      if (error) throw error;

      toast.success(`${messages.length} mensagens adicionadas à fila (${listsToSend.length} listas)`);
      setSelectedLists(new Set());
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <List className="h-4 w-4" />
          Listas Salvas ({savedLists.length})
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Gerenciar Listas Salvas</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {savedLists.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              Nenhuma lista salva ainda
            </div>
          ) : (
            <>
              {/* TODO: Botão para enviar listas selecionadas */}
              {selectedLists.size > 0 && (
                <Button onClick={sendToSelectedLists} className="w-full">
                  Enviar {selectedLists.size} lista(s) selecionada(s)
                </Button>
              )}

              {/* TODO: Tabela de listas */}
              {savedLists.map(list => (
                <div key={list.id} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {/* TODO: Checkbox para seleção múltipla */}
                      <Checkbox
                        checked={selectedLists.has(list.id)}
                        onCheckedChange={() => toggleListSelection(list.id)}
                      />
                      <div>
                        <h3 className="font-semibold">{list.name}</h3>
                        <p className="text-sm text-muted-foreground">
                          {Array.isArray(list.contacts) ? list.contacts.length : 0} contatos
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      {/* TODO: Botões de ação */}
                      {editingList === list.id ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setTextEditMode(!textEditMode)}
                          >
                            {textEditMode ? 'Modo Tabela' : 'Modo Texto'}
                          </Button>
                          <Button
                            size="sm"
                            onClick={saveEdits}
                            disabled={updateMutation.isPending}
                          >
                            <Save className="h-4 w-4 mr-1" />
                            Salvar
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => startEditing(list)}
                        >
                          <Edit2 className="h-4 w-4 mr-1" />
                          Editar
                        </Button>
                      )}
                      
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => deleteMutation.mutate(list.id)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {/* TODO: Exibir/editar contatos quando em modo de edição */}
                  {editingList === list.id && (
                    <>
                      {textEditMode ? (
                        <div className="space-y-2">
                          <p className="text-sm text-muted-foreground">
                            Formato: número;telefone (um por linha)
                          </p>
                          <textarea
                            value={textContent}
                            onChange={(e) => setTextContent(e.target.value)}
                            className="w-full h-64 p-3 font-mono text-sm border rounded-md bg-background"
                            placeholder="1;5521982153814&#10;2;5521982343814&#10;3;552198444814"
                          />
                        </div>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Telefone</TableHead>
                              <TableHead>Mensagem</TableHead>
                              <TableHead>Arquivo</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {editedContacts.map((contact, idx) => (
                              <TableRow key={idx}>
                                <TableCell>
                                  <Input
                                    value={contact.phone}
                                    onChange={(e) => updateContact(idx, 'phone', e.target.value)}
                                    className="font-mono text-sm"
                                  />
                                </TableCell>
                                <TableCell>
                                  <Input
                                    value={contact.message_text || ''}
                                    onChange={(e) => updateContact(idx, 'message_text', e.target.value)}
                                    className="text-sm"
                                  />
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                  {contact.filename}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
