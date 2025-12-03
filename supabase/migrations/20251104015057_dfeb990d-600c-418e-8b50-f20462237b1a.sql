-- Criar tabela para salvar listas de grupos
CREATE TABLE IF NOT EXISTS public.saved_group_lists (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  group_ids JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.saved_group_lists ENABLE ROW LEVEL SECURITY;

-- Políticas RLS
CREATE POLICY "Users can view their own group lists"
  ON public.saved_group_lists
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own group lists"
  ON public.saved_group_lists
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own group lists"
  ON public.saved_group_lists
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own group lists"
  ON public.saved_group_lists
  FOR DELETE
  USING (auth.uid() = user_id);

-- Adicionar coluna file_type na tabela group_messages para suportar diferentes tipos de arquivo
ALTER TABLE public.group_messages 
ADD COLUMN IF NOT EXISTS file_type TEXT DEFAULT 'image';

-- Índices
CREATE INDEX IF NOT EXISTS idx_saved_group_lists_user_id ON public.saved_group_lists(user_id);