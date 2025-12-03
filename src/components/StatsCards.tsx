import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Clock, Send, XCircle } from "lucide-react";

interface StatsCardsProps {
  messages: any[];
}

export default function StatsCards({ messages }: StatsCardsProps) {
  const stats = {
    total: messages.length,
    queued: messages.filter(m => m.status === 'queued').length,
    sent: messages.filter(m => m.status === 'sent').length,
    failed: messages.filter(m => m.status === 'failed' || m.status === 'permanently_failed').length,
  };

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card className="border-border/50 shadow-elegant bg-gradient-card hover:shadow-glow transition-shadow">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total</CardTitle>
          <Send className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.total}</div>
          <p className="text-xs text-muted-foreground">mensagens</p>
        </CardContent>
      </Card>

      <Card className="border-border/50 shadow-elegant bg-gradient-card hover:shadow-glow transition-shadow">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Na Fila</CardTitle>
          <Clock className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.queued}</div>
          <p className="text-xs text-muted-foreground">aguardando envio</p>
        </CardContent>
      </Card>

      <Card className="border-border/50 shadow-elegant bg-gradient-card hover:shadow-glow transition-shadow">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Enviados</CardTitle>
          <CheckCircle2 className="h-4 w-4 text-primary" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-primary">{stats.sent}</div>
          <p className="text-xs text-muted-foreground">com sucesso</p>
        </CardContent>
      </Card>

      <Card className="border-border/50 shadow-elegant bg-gradient-card hover:shadow-glow transition-shadow">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Falhas</CardTitle>
          <XCircle className="h-4 w-4 text-destructive" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-destructive">{stats.failed}</div>
          <p className="text-xs text-muted-foreground">erro no envio</p>
        </CardContent>
      </Card>
    </div>
  );
}
