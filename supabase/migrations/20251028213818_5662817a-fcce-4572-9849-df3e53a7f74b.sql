-- Tabela de configurações da API Evolution
CREATE TABLE public.evolution_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  base_url TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  token TEXT NOT NULL,
  delay_min INTEGER DEFAULT 8000,
  delay_max INTEGER DEFAULT 12000,
  pause_after INTEGER DEFAULT 20,
  pause_duration INTEGER DEFAULT 60000,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- Tabela de mensagens/fila de envio
CREATE TABLE public.messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  phone TEXT NOT NULL,
  message_text TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'paused')),
  attempts INTEGER DEFAULT 0,
  evolution_msg_id TEXT,
  error_message TEXT,
  file_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  sent_at TIMESTAMP WITH TIME ZONE
);

-- Índices para melhor performance
CREATE INDEX idx_messages_user_id ON public.messages(user_id);
CREATE INDEX idx_messages_status ON public.messages(status);
CREATE INDEX idx_messages_created_at ON public.messages(created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.evolution_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies para evolution_config
CREATE POLICY "Users can view their own config"
  ON public.evolution_config FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own config"
  ON public.evolution_config FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own config"
  ON public.evolution_config FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own config"
  ON public.evolution_config FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies para messages
CREATE POLICY "Users can view their own messages"
  ON public.messages FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own messages"
  ON public.messages FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own messages"
  ON public.messages FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own messages"
  ON public.messages FOR DELETE
  USING (auth.uid() = user_id);

-- Função para atualizar updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Trigger para evolution_config
CREATE TRIGGER update_evolution_config_updated_at
  BEFORE UPDATE ON public.evolution_config
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Habilitar realtime para messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;

-- Storage bucket para arquivos
INSERT INTO storage.buckets (id, name, public)
VALUES ('whatsapp-files', 'whatsapp-files', false);

-- RLS para storage
CREATE POLICY "Users can upload their own files"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'whatsapp-files' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can view their own files"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'whatsapp-files' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can delete their own files"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'whatsapp-files' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );