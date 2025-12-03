-- TODO: Adicionar suporte para múltiplas listas salvas e gerenciamento de blacklist melhorado

-- Adicionar campo para armazenar lista de IDs na blacklist (formato: "1,2,3,7")
ALTER TABLE blacklist ADD COLUMN IF NOT EXISTS number_ids text;

-- Criar tabela para armazenar listas salvas de contatos
CREATE TABLE IF NOT EXISTS saved_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  contacts jsonb NOT NULL, -- Array de objetos: [{phone, message_text, filename}]
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Habilitar RLS na tabela saved_lists
ALTER TABLE saved_lists ENABLE ROW LEVEL SECURITY;

-- Políticas RLS para saved_lists
CREATE POLICY "Users can view their own lists"
  ON saved_lists FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own lists"
  ON saved_lists FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own lists"
  ON saved_lists FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own lists"
  ON saved_lists FOR DELETE
  USING (auth.uid() = user_id);

-- Trigger para atualizar updated_at em saved_lists
CREATE TRIGGER update_saved_lists_updated_at
  BEFORE UPDATE ON saved_lists
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Adicionar campos para salvar credenciais de instância Evolution no config
ALTER TABLE evolution_config ADD COLUMN IF NOT EXISTS instance_created boolean DEFAULT false;
ALTER TABLE evolution_config ADD COLUMN IF NOT EXISTS qr_code text;
ALTER TABLE evolution_config ADD COLUMN IF NOT EXISTS connection_status text DEFAULT 'disconnected';

-- Criar índice para melhorar performance
CREATE INDEX IF NOT EXISTS idx_saved_lists_user_id ON saved_lists(user_id);

-- Comentário explicativo
COMMENT ON TABLE saved_lists IS 'Armazena listas de contatos salvas pelo usuário para envios futuros';
COMMENT ON COLUMN saved_lists.contacts IS 'Array JSON com dados dos contatos: phone, message_text, filename';
COMMENT ON COLUMN blacklist.number_ids IS 'IDs separados por vírgula para blacklist (ex: 1,2,3,7,30)';
COMMENT ON COLUMN evolution_config.instance_created IS 'Indica se a instância foi criada automaticamente';
COMMENT ON COLUMN evolution_config.qr_code IS 'QR Code base64 da última conexão';
COMMENT ON COLUMN evolution_config.connection_status IS 'Status da conexão: disconnected, connecting, connected';