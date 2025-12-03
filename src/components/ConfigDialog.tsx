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
import { Loader2, CheckCircle, Wifi } from "lucide-react";

interface ConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

export default function ConfigDialog({ open, onOpenChange, onSaved }: ConfigDialogProps) {
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"form" | "qrcode" | "connected">("form");
  const [qrCode, setQrCode] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [instanceName, setInstanceName] = useState("");
  const [errorCount, setErrorCount] = useState(0);
  const [config, setConfig] = useState({
    delay_min: 8000,
    delay_max: 12000,
    pause_after: 20,
    pause_duration: 60000,
  });

  useEffect(() => {
    if (open) {
      loadConfig();
      setErrorCount(0); // Reset error count when opening
    } else {
      // Reset tudo quando fechar
      setStep("form");
      setQrCode("");
      setPairingCode("");
      setErrorCount(0);
    }
  }, [open]);

  // TODO: Polling para verificar status da conexão a cada 3 segundos quando exibindo QR code
  useEffect(() => {
    if (step !== "qrcode" || !open) return;

    let errorCountLocal = 0;
    const maxErrors = 5; // Parar após 5 erros consecutivos

    const interval = setInterval(async () => {
      try {
        const { data, error } = await supabase.functions.invoke('evolution-status');
        
        if (error) {
          console.error('Status check error:', error);
          errorCountLocal++;
          setErrorCount(errorCountLocal);
          
          // Parar polling após muitos erros
          if (errorCountLocal >= maxErrors) {
            console.error('Too many errors, stopping status check');
            clearInterval(interval);
            toast.error('Erro ao verificar status. Tente novamente.');
            setStep("form");
          }
          return;
        }

        // Reset error count on success
        errorCountLocal = 0;
        setErrorCount(0);

        // TODO: Quando conectar (connected = true), fechar modal automaticamente
        if (data.connected) {
          clearInterval(interval);
          setStep("connected");
          setTimeout(() => {
            onSaved();
            onOpenChange(false);
          }, 2000);
        }
      } catch (err) {
        console.error('Status polling error:', err);
        errorCountLocal++;
        setErrorCount(errorCountLocal);
        
        if (errorCountLocal >= maxErrors) {
          clearInterval(interval);
          toast.error('Erro ao verificar status. Tente novamente.');
          setStep("form");
        }
      }
    }, 3000); // Verificar a cada 3 segundos

    return () => clearInterval(interval);
  }, [step, open, onSaved, onOpenChange]);

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
      
      // Não reabrir QR automaticamente se o modal acabou de abrir
      // Apenas se ainda estiver no step "form"
      if (step === "form" && data.instance_created && data.connection_status !== 'open' && data.qr_code) {
        setQrCode(data.qr_code);
        setStep("qrcode");
      }
    }
  };

  // TODO: Criar instância na Evolution API usando os secrets
  const handleCreateInstance = async () => {
    if (!instanceName) {
      toast.error("Informe o nome da instância");
      return;
    }

    setLoading(true);
    try {
      // TODO: Chamar edge function para criar instância e obter QR code
      const { data, error } = await supabase.functions.invoke('evolution-create-instance', {
        body: {
          instance_name: instanceName,
        }
      });

      if (error) throw error;

      if (!data.success) {
        throw new Error(data.error || 'Erro ao criar instância');
      }

      // TODO: Armazenar QR code base64 e pairing code
      setQrCode(data.qrCode);
      setPairingCode(data.pairingCode);
      setStep("qrcode");
      
      toast.success(data.message);
    } catch (error: any) {
      console.error('Create instance error:', error);
      toast.error(error.message || 'Erro ao criar instância');
    } finally {
      setLoading(false);
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
          base_url: '', // Será preenchido pelos secrets
          token: '', // Será preenchido pelos secrets
          ...config
        }, {
          onConflict: 'user_id'
        });

      if (error) throw error;

      toast.success("Configuração salva com sucesso!");
      onSaved(); // Notificar que salvou
    } catch (error: any) {
      console.error('Save config error:', error);
      toast.error(error.message || "Erro ao salvar configuração");
    } finally {
      setLoading(false);
    }
  };

  // TODO: Testar conexão com a Evolution API
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
            {step === "form" && "Configuração Evolution API"}
            {step === "qrcode" && "Escaneie o QR Code"}
            {step === "connected" && "Conectado!"}
          </DialogTitle>
          <DialogDescription>
            {step === "form" && "Configure a instância e parâmetros de envio"}
            {step === "qrcode" && "Use seu WhatsApp para escanear o código"}
            {step === "connected" && "WhatsApp conectado com sucesso!"}
          </DialogDescription>
        </DialogHeader>

        {/* TODO: Formulário inicial para configurar instância */}
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

        {/* TODO: Exibir QR Code base64 e pairing code */}
        {step === "qrcode" && (
          <div className="space-y-4">
            <div className="flex justify-center">
              {qrCode && (
                <img 
                  src={qrCode}
                  alt="QR Code"
                  className="w-64 h-64 border-2 border-border rounded-lg"
                />
              )}
            </div>

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

            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Aguardando conexão...
            </div>
          </div>
        )}

        {/* TODO: Mensagem de sucesso quando conectar */}
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
