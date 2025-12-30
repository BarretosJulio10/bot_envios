import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Save, Trash2, Upload } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface SavedList {
  id: string;
  name: string;
  group_ids: string[];
  created_at: string;
}

interface SavedGroupListsManagerProps {
  selectedGroups: Set<string>;
  onLoadList: (groupIds: string[]) => Promise<void>;
}

export default function SavedGroupListsManager({ selectedGroups, onLoadList }: SavedGroupListsManagerProps) {
  const [lists, setLists] = useState<SavedList[]>([]);
  const [listName, setListName] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [listToDelete, setListToDelete] = useState<string | null>(null);

  useEffect(() => {
    loadLists();
  }, []);

  const loadLists = async () => {
    const { data } = await supabase
      .from('saved_group_lists')
      .select('*')
      .order('created_at', { ascending: false });

    if (data) {
      const formattedLists = data.map(list => ({
        ...list,
        group_ids: list.group_ids as string[]
      }));
      setLists(formattedLists);
    }
  };

  const saveList = async () => {
    if (!listName.trim()) {
      toast.error("Digite um nome para a lista");
      return;
    }

    if (selectedGroups.size === 0) {
      toast.error("Selecione pelo menos um grupo");
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");

      const { error } = await supabase
        .from('saved_group_lists')
        .insert({
          user_id: user.id,
          name: listName,
          group_ids: Array.from(selectedGroups),
        });

      if (error) throw error;

      toast.success("Lista salva com sucesso!");
      setListName("");
      loadLists();
    } catch (error: any) {
      toast.error(error.message || 'Erro ao salvar lista');
    }
  };

  const loadList = async (groupIds: string[]) => {
    await onLoadList(groupIds);
    toast.success(`${groupIds.length} grupos selecionados! Agora adicione o arquivo/texto e clique em "Adicionar à Fila".`);
  };

  const confirmDelete = (listId: string) => {
    setListToDelete(listId);
    setDeleteDialogOpen(true);
  };

  const deleteList = async () => {
    if (!listToDelete) return;

    try {
      const { error } = await supabase
        .from('saved_group_lists')
        .delete()
        .eq('id', listToDelete);

      if (error) throw error;

      toast.success("Lista excluída!");
      loadLists();
    } catch (error: any) {
      toast.error(error.message || 'Erro ao excluir lista');
    } finally {
      setDeleteDialogOpen(false);
      setListToDelete(null);
    }
  };

  return (
    <>
      <Card className="p-4 space-y-4">
        <h3 className="font-semibold">Gerenciar Listas de Grupos</h3>

        <div className="space-y-2">
          <Label htmlFor="list_name">Nome da Lista</Label>
          <div className="flex gap-2">
            <Input
              id="list_name"
              placeholder="Digite o nome da lista..."
              value={listName}
              onChange={(e) => setListName(e.target.value)}
            />
            <Button onClick={saveList} className="gap-2 whitespace-nowrap">
              <Save className="h-4 w-4" />
              Salvar Lista Atual
            </Button>
          </div>
        </div>

        {lists.length > 0 && (
          <div className="space-y-3">
            <Label className="text-lg font-semibold text-foreground/90">Listas Salvas</Label>
            <div className="space-y-3 max-h-72 overflow-y-auto pr-2 custom-scrollbar">
              {lists.map((list) => (
                <div
                  key={list.id}
                  className="flex items-center justify-between p-4 bg-[#166534] hover:bg-[#14532d] transition-colors rounded-2xl shadow-lg border border-white/10"
                >
                  <div className="flex-1 space-y-1">
                    <div className="font-bold text-white text-lg">{list.name}</div>
                    <div className="text-xs text-white/80 flex items-center gap-2">
                      <span className="bg-black/20 px-2 py-0.5 rounded-full">{list.group_ids.length} grupos</span>
                      <span>•</span>
                      <span>{new Date(list.created_at).toLocaleDateString('pt-BR')}</span>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => loadList(list.group_ids)}
                      className="bg-black hover:bg-black/80 text-white border-none rounded-xl h-10 px-4 gap-2 font-medium"
                    >
                      <Upload className="h-4 w-4" />
                      Carregar
                    </Button>
                    <Button
                      variant="destructive"
                      size="icon"
                      onClick={() => confirmDelete(list.id)}
                      className="bg-[#ef4444] hover:bg-[#dc2626] text-white rounded-xl h-10 w-10 shadow-md"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar Exclusão</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir esta lista? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={deleteList}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
