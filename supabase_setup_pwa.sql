-- ===============================================
-- SETUP DO BANCO DE DADOS: PWA CLIENTE FINAL
-- ===============================================

-- 1. Tabela: pwa_clientes
CREATE TABLE IF NOT EXISTS public.pwa_clientes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome TEXT NOT NULL,
    telefone TEXT NOT NULL UNIQUE,
    documento TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Tabela: pwa_arquivos
CREATE TABLE IF NOT EXISTS public.pwa_arquivos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id UUID REFERENCES public.pwa_clientes(id) ON DELETE CASCADE,
    nome_arquivo TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    status TEXT DEFAULT 'enviado', -- 'enviado', 'visualizado', 'baixado'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Tabela: pwa_push_tokens
-- Armazena o token do Firebase FCM para notificação de cada aparelho do cliente.
CREATE TABLE IF NOT EXISTS public.pwa_push_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id UUID REFERENCES public.pwa_clientes(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    device_info TEXT, -- Ex: 'Chrome no Android'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ===============================================
-- SEGURANÇA: ROW LEVEL SECURITY (RLS)
-- ===============================================
ALTER TABLE public.pwa_clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pwa_arquivos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pwa_push_tokens ENABLE ROW LEVEL SECURITY;

-- (Opcional) Liberação inicial para Auth, até definirmos a regra de RLS restrita por telefone/UUID
CREATE POLICY "Acesso Restrito Clientes" ON "public"."pwa_clientes" AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "Acesso Restrito Arquivos" ON "public"."pwa_arquivos" AS PERMISSIVE FOR SELECT TO authenticated USING (true);

-- ===============================================
-- SETUP DO STORAGE: ARQUIVOS SEGUROS DO PWA
-- ===============================================
INSERT INTO storage.buckets (id, name, public) 
VALUES ('pwa_arquivos_bucket', 'pwa_arquivos_bucket', false)
ON CONFLICT (id) DO NOTHING;

-- Policies do Storage (Bucket fechado, apenas leitura por Signed URLs ou usuários autenticados)
CREATE POLICY "Leitura PWA Arquivos" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'pwa_arquivos_bucket');
CREATE POLICY "Upload Backend" ON storage.objects FOR INSERT TO service_role WITH CHECK (bucket_id = 'pwa_arquivos_bucket');
