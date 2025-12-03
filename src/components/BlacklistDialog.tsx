// TODO: Componente para gerenciar blacklist
// Aceita IDs separados por vírgula (ex: 1,2,3,7,30) ou números individuais

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Ban, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export default function BlacklistDialog() {
  // TODO: Campo único para aceitar números ou IDs separados por vírgula
  const [input, setInput] = useState("");
  const [reason, setReason] = useState("");
  const queryClient = useQueryClient();

  const { data: blacklist = [] } = useQuery({
    queryKey: ['blacklist'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('blacklist')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data;
    }
  });

  // TODO: Adicionar à blacklist - parsear IDs ou números
  const addMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Não autenticado');

      // TODO: Parsear entrada: remover espaços, separar por vírgula, ignorar inválidos
      const items = input
        .split(',')
        .map(item => item.trim())
        .filter(item => item.length > 0);

      if (items.length === 0) {
        throw new Error('Entrada inválida');
      }

      // TODO: Detectar se são IDs (apenas números) ou telefones (podem ter +, -, etc)
      const isNumberIds = items.every(item => /^\d+$/.test(item));

      if (isNumberIds) {
        // TODO: Salvar como lista de IDs
        const { error } = await supabase
          .from('blacklist')
          .insert({ 
            user_id: user.id, 
            number_ids: items.join(','),
            reason,
            phone: `IDs: ${items.join(',')}` // Para exibição
          });
        if (error) throw error;
      } else {
        // TODO: Salvar números individuais (múltiplos registros)
        const records = items.map(phone => ({
          user_id: user.id,
          phone: phone.replace(/\D/g, ''),
          reason
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
      setInput('');
      setReason('');
    },
    onError: (error: any) => {
      toast.error(error.message);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('blacklist')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blacklist'] });
      toast.success('Número removido da blacklist');
    },
    onError: (error: any) => {
      toast.error(error.message);
    }
  });

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Ban className="h-4 w-4" />
          Blacklist ({blacklist.length})
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Lista de Números Bloqueados</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* TODO: Formulário com campo único para IDs ou números */}
          <div className="grid gap-3 p-4 border rounded-lg bg-muted/30">
            <div className="space-y-2">
              <Label>Números ou IDs</Label>
              <Input
                placeholder="Ex: 1,2,3,7,30 ou 5521987654321,5521999999999"
                value={input}
                onChange={(e) => setInput(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Separe por vírgula. IDs apenas numéricos (1,2,3) ou telefones completos
              </p>
            </div>
            <div className="space-y-2">
              <Label>Motivo (opcional)</Label>
              <Textarea
                placeholder="Ex: Cliente solicitou remoção"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
              />
            </div>
            <Button 
              onClick={() => addMutation.mutate()}
              disabled={!input || addMutation.isPending}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              Adicionar à Blacklist
            </Button>
          </div>

          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Número</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead className="w-[80px]">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {blacklist.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                      Nenhum número bloqueado
                    </TableCell>
                  </TableRow>
                ) : (
                  blacklist.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono">{item.phone}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {item.reason || '-'}
                      </TableCell>
                      <TableCell className="text-sm">
                        {new Date(item.created_at).toLocaleDateString('pt-BR')}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteMutation.mutate(item.id)}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
