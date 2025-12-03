import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CheckCircle2, Clock, Send, XCircle, Pause, AlertCircle } from "lucide-react";

interface QueueTableProps {
  messages: any[];
}

export default function QueueTable({ messages }: QueueTableProps) {
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'sent':
        return (
          <Badge className="gap-1 bg-primary/20 text-primary border-primary/30">
            <CheckCircle2 className="h-3 w-3" />
            Enviado
          </Badge>
        );
      case 'sending':
        return (
          <Badge className="gap-1 bg-secondary/20 text-secondary border-secondary/30">
            <Send className="h-3 w-3" />
            Enviando
          </Badge>
        );
      case 'failed':
        return (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="h-3 w-3" />
            Falhou
          </Badge>
        );
      case 'permanently_failed':
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge className="gap-1 bg-destructive text-destructive-foreground border-destructive cursor-help">
                  <XCircle className="h-3 w-3" />
                  Falha Permanente
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">Falhou após múltiplas tentativas automáticas</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      case 'paused':
        return (
          <Badge variant="outline" className="gap-1">
            <Pause className="h-3 w-3" />
            Pausado
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="gap-1">
            <Clock className="h-3 w-3" />
            Na Fila
          </Badge>
        );
    }
  };

  return (
    <Card className="border-border/50 shadow-elegant bg-gradient-card">
      <CardHeader>
        <CardTitle>Fila de Envio</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border border-border/50 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-muted/50">
                <TableHead>Arquivo</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Tentativas</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Erro</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {messages.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Nenhuma mensagem na fila
                  </TableCell>
                </TableRow>
              ) : (
                messages.map((message) => (
                  <TableRow key={message.id} className="hover:bg-muted/30">
                    <TableCell className="font-medium">
                      {message.filename}
                    </TableCell>
                    <TableCell>{message.phone}</TableCell>
                    <TableCell>{getStatusBadge(message.status)}</TableCell>
                    <TableCell>{message.attempts}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(message.created_at).toLocaleString('pt-BR')}
                    </TableCell>
                    <TableCell>
                      {message.error_message ? (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex items-center gap-1 text-destructive cursor-help">
                                <AlertCircle className="h-4 w-4" />
                                <span className="text-xs truncate max-w-[150px]">
                                  {message.error_message}
                                </span>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-[300px]">
                              <p className="text-sm">{message.error_message}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      ) : (
                        <span className="text-muted-foreground text-xs">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
