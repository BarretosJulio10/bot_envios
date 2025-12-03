-- Criar tabela de campanhas (listas salvas)
CREATE TABLE public.campaigns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  total_numbers INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Adicionar campaign_id nas mensagens
ALTER TABLE public.messages ADD COLUMN campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE;

-- Criar tabela de blacklist (números bloqueados)
CREATE TABLE public.blacklist (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  phone TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, phone)
);

-- Índices para performance
CREATE INDEX idx_campaigns_user_id ON public.campaigns(user_id);
CREATE INDEX idx_campaigns_status ON public.campaigns(status);
CREATE INDEX idx_blacklist_user_phone ON public.blacklist(user_id, phone);

-- RLS para campaigns
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own campaigns"
  ON public.campaigns FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own campaigns"
  ON public.campaigns FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own campaigns"
  ON public.campaigns FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own campaigns"
  ON public.campaigns FOR DELETE
  USING (auth.uid() = user_id);

-- RLS para blacklist
ALTER TABLE public.blacklist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own blacklist"
  ON public.blacklist FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own blacklist"
  ON public.blacklist FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own blacklist"
  ON public.blacklist FOR DELETE
  USING (auth.uid() = user_id);

-- Trigger para atualizar updated_at em campaigns
CREATE TRIGGER update_campaigns_updated_at
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Função para limpar arquivos antigos (5 horas após envio)
CREATE OR REPLACE FUNCTION public.cleanup_old_files()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Deletar arquivos do storage que foram enviados há mais de 5 horas
  DELETE FROM storage.objects
  WHERE bucket_id = 'whatsapp-files'
  AND created_at < now() - interval '5 hours'
  AND name IN (
    SELECT DISTINCT SUBSTRING(file_url FROM '[^/]+$')
    FROM public.messages
    WHERE status = 'sent'
    AND sent_at < now() - interval '5 hours'
  );
END;
$$;