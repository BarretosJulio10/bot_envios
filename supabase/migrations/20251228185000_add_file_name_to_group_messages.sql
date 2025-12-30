-- Adicionar coluna file_name na tabela group_messages
ALTER TABLE public.group_messages 
ADD COLUMN IF NOT EXISTS file_name TEXT;
