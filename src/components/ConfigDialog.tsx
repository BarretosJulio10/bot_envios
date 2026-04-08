import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, CheckCircle, Wifi, RefreshCcw, ArrowLeft, AlertTriangle } from "lucide-react";

interface ConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export default function ConfigDialog({ open, onOpenChange, onSaved }: ConfigDialogProps) {
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [step, setStep] = useState<"form" | "qrcode" | "connected">("form");
  const [qrCode, setQrCode] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [instanceName, setInstanceName] = useState("");
  const [pollingErrors, setPollingErrors] = useState(0);
  const [pollingFailed, setPollingFailed] = useState(false);
  const [config, setConfig] = useState({
    delay_min: 8000,
    delay_max: 12000,
    pause_after: 20,
    pause_duration: 60000,
  });

  // Reset completo de estados ao fechar ou abrir o modal
  useEffect(() => {
    if (open) {
      loadConfig();
      setPollingErrors(0);
      setPollingFailed(false);
    } else {
      setStep("form");
      setQrCode("");
      setPairingCode("");
      setPollingErrors(0);
      setPollingFailed(false);
    }
  }, [open]);

  // Polling para verificar status da conexão a cada 3 segundos quando exibindo QR code
  useEffect(() => {
    if (step !== "qrcode" || !open) return;

    let errorCountLocal = 0;
    const maxErrors = 5;

    const interval = setInterval(async () => {
      try {
        const { data, error } = await supabase.functions.invoke('evolution-status');

        if (error) {
          console.error('[ConfigDialog] Status check error:', error);
          errorCountLocal++;
          setPollingErrors(errorCountLocal);

          if (errorCountLocal >= maxErrors) {
            console.error('[ConfigDialog] Muitos erros no polling. Parando.');
            clearInterval(interval);
            setPollingFailed(true);
          }
          return;
        }

        // Reset de erros em caso de sucesso
        errorCountLocal = 0;
        setPollingErrors(0);
        setPollingFailed(false);

        // QR code atualizado pode vir no status — atualizar na tela
        if (data.qrCode && data.qrCode !== qrCode) {
          setQrCode(data.qrCode);
        }

        if (data.connected) {
          clearInterval(interval);
          setStep("connected");
          setTimeout(() => {
            onSaved();
            onOpenChange(false);
          }, 2000);
        }
      } catch (err) {
        console.error('[ConfigDialog] Status polling error:', err);
        errorCountLocal++;
        setPollingErrors(errorCountLocal);

        if (errorCountLocal >= maxErrors) {
          clearInterval(interval);
          setPollingFailed(true);
        }
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [step, open]);

  const loadConfig = async () => {
    const { data } = await supabase
      .from('evolution_config')
      .select('*')
      .single();

    if (data) {
      setInstanceName(data.instance_id || "");
      setConfig({
        delay_min: data.delay_min,
        delay_max: data.delay_max,
        pause_after: data.pause_after,
        pause_duration: data.pause_duration,
      });

      // NÃO restaurar QR do banco automaticamente —
      // QR codes expiram em ~2 min. Usuário deve reconectar manualmente.
    }
  };

  const handleCreateInstance = async () => {
    if (!instanceName) {
      toast.error("Informe o nome da instância");
      return;
    }

    setLoading(true);
    setPollingFailed(false);
    setPollingErrors(0);

    try {
      const { data, error } = await supabase.functions.invoke('evolution-create-instance', {
        body: { instance_name: instanceName },
      });

      if (error) throw error;

      if (!data.success) {
        throw new Error(data.error || 'Erro ao criar instância');
      }

      setQrCode(data.qrCode || "");
      setPairingCode(data.pairingCode || "");
      setStep("qrcode");

      toast.success(data.message || "QR Code gerado! Escaneie com seu WhatsApp.");
    } catch (error: any) {
      console.error('[ConfigDialog] Create instance error:', error);
      toast.error(error.message || 'Erro ao criar instância. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Limpa o estado da instância na Uazapi e no banco,
   * retornando ao formulário para gerar um novo QR.
   */
  const handleReset = async () => {
    setResetting(true);
    try {
      const { data, error } = await supabase.functions.invoke('evolution-reset-instance');

      if (error) throw error;

      if (!data.success) {
        throw new Error(data.error || 'Erro ao resetar instância');
      }

      // Voltar ao formulário com estado limpo
      setStep("form");
      setQrCode("");
      setPairingCode("");
      setPollingErrors(0);
      setPollingFailed(false);

      toast.success("Instância limpa! Clique em 'Conectar WhatsApp' para gerar um novo QR Code.");
    } catch (error: any) {
      console.error('[ConfigDialog] Reset error:', error);
      toast.error(error.message || 'Erro ao limpar instância. Tente fechar e abrir novamente.');
    } finally {
      setResetting(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!instanceName.trim()) {
      toast.error("Informe o nome da instância");
      return;
    }

    setLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");

      const { error } = await supabase
        .from('evolution_config')
        .upsert({
          user_id: user.id,
          instance_id: instanceName.trim(),
          base_url: '',
          token: '',
          ...config,
        }, { onConflict: 'user_id' });

      if (error) throw error;

      toast.success("Configuração salva com sucesso!");
      onSaved();
    } catch (error: any) {
      console.error('[ConfigDialog] Save config error:', error);
      toast.error(error.message || "Erro ao salvar configuração");
    } finally {
      setLoading(false);
    }
  };

  const handleTestConnection = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('test-connection');

      if (error) throw error;

      if (data.success) {
        toast.success(data.message);
      } else {
        toast.warning(data.message);
      }
    } catch (error: any) {
      toast.error(error.message || 'Erro ao testar conexão');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] bg-card border-border/50">
        <DialogHeader>
          <DialogTitle>
            {step === "form" && "Configuração Uazapi"}
            {step === "qrcode" && "Escaneie o QR Code"}
            {step === "connected" && "Conectado!"}
          </DialogTitle>
          <DialogDescription>
            {step === "form" && "Configure a instância e parâmetros de envio"}
            {step === "qrcode" && "Use seu WhatsApp para escanear o código"}
            {step === "connected" && "WhatsApp conectado com sucesso!"}
          </DialogDescription>
        </DialogHeader>

        {/* ── Step: Formulário ─────────────────────────────────────────── */}
        {step === "form" && (
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="instance_name">Nome da Instância</Label>
              <Input
                id="instance_name"
                placeholder="minha-instancia"
                value={instanceName}
                onChange={(e) => setInstanceName(e.target.value)}
                required
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                A URL e token são configurados nos Saved Secrets
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="delay_min">Delay Mín (ms)</Label>
                <Input
                  id="delay_min"
                  type="number"
                  value={config.delay_min}
                  onChange={(e) => setConfig({ ...config, delay_min: parseInt(e.target.value) })}
                  disabled={loading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="delay_max">Delay Máx (ms)</Label>
                <Input
                  id="delay_max"
                  type="number"
                  value={config.delay_max}
                  onChange={(e) => setConfig({ ...config, delay_max: parseInt(e.target.value) })}
                  disabled={loading}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="pause_after">Pausar após (msgs)</Label>
                <Input
                  id="pause_after"
                  type="number"
                  value={config.pause_after}
                  onChange={(e) => setConfig({ ...config, pause_after: parseInt(e.target.value) })}
                  disabled={loading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pause_duration">Duração pausa (ms)</Label>
                <Input
                  id="pause_duration"
                  type="number"
                  value={config.pause_duration}
                  onChange={(e) => setConfig({ ...config, pause_duration: parseInt(e.target.value) })}
                  disabled={loading}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={handleTestConnection}
                disabled={loading}
              >
                <Wifi className="mr-2 h-4 w-4" />
                Testar Conexão
              </Button>
              <Button
                type="button"
                onClick={handleCreateInstance}
                disabled={loading || !instanceName}
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Criando...
                  </>
                ) : (
                  "Conectar WhatsApp"
                )}
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? "Salvando..." : "Salvar"}
              </Button>
            </div>
          </form>
        )}

        {/* ── Step: QR Code ─────────────────────────────────────────────── */}
        {step === "qrcode" && (
          <div className="space-y-4">

            {/* QR Code */}
            <div className="flex justify-center">
              {qrCode ? (
                <img
                  src={qrCode}
                  alt="QR Code WhatsApp"
                  className="w-64 h-64 border-2 border-border rounded-lg"
                />
              ) : (
                <div className="w-64 h-64 border-2 border-dashed border-border rounded-lg flex items-center justify-center text-muted-foreground text-sm">
                  Aguardando QR Code...
                </div>
              )}
            </div>

            {/* Pairing code */}
            {pairingCode && (
              <div className="text-center space-y-1">
                <p className="text-sm text-muted-foreground">
                  Ou use o código de pareamento:
                </p>
                <p className="text-2xl font-bold tracking-wider">
                  {pairingCode}
                </p>
              </div>
            )}

            {/* Status: Aguardando ou Erro */}
            {pollingFailed ? (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 space-y-3">
                <div className="flex items-center gap-2 text-destructive text-sm font-medium">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                  Não foi possível verificar o status da conexão.
                  O QR Code pode ter expirado.
                </div>
                <p className="text-xs text-muted-foreground">
                  Limpe e gere um novo QR Code para tentar novamente.
                </p>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Aguardando conexão...
                {pollingErrors > 0 && (
                  <span className="text-amber-500 text-xs">
                    ({pollingErrors}/{5} erros)
                  </span>
                )}
              </div>
            )}

            {/* Botões de ação */}
            <div className="flex gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={handleReset}
                disabled={resetting}
              >
                {resetting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Limpando...
                  </>
                ) : (
                  <>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Voltar
                  </>
                )}
              </Button>
              <Button
                type="button"
                className="flex-1"
                onClick={handleReset}
                disabled={resetting}
              >
                {resetting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Limpando...
                  </>
                ) : (
                  <>
                    <RefreshCcw className="mr-2 h-4 w-4" />
                    Limpar e Gerar Novo QR
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* ── Step: Conectado ───────────────────────────────────────────── */}
        {step === "connected" && (
          <div className="flex flex-col items-center justify-center py-8 space-y-4">
            <CheckCircle className="h-16 w-16 text-green-500" />
            <p className="text-lg font-semibold">WhatsApp Conectado!</p>
            <p className="text-sm text-muted-foreground">
              Você já pode enviar mensagens
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
