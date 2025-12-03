-- Criar tabela para mensagens de grupo
CREATE TABLE IF NOT EXISTS public.group_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL,
  group_name TEXT NOT NULL,
  image_url TEXT,
  caption TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'permanently_failed')),
  attempts INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  sent_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT
);

-- Enable RLS
ALTER TABLE public.group_messages ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view their own group messages" 
ON public.group_messages 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own group messages" 
ON public.group_messages 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own group messages" 
ON public.group_messages 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own group messages" 
ON public.group_messages 
FOR DELETE 
USING (auth.uid() = user_id);

-- Index para performance
CREATE INDEX idx_group_messages_user_status ON public.group_messages(user_id, status);
CREATE INDEX idx_group_messages_created_at ON public.group_messages(created_at DESC);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.group_messages;