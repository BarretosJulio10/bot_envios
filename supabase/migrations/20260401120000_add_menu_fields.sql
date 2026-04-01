
ALTER TABLE group_messages
  ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'media',
  ADD COLUMN IF NOT EXISTS footer_text TEXT,
  ADD COLUMN IF NOT EXISTS list_button TEXT,
  ADD COLUMN IF NOT EXISTS menu_choices TEXT;

COMMENT ON COLUMN group_messages.message_type IS 'Tipo da mensagem: media, text, menu';
COMMENT ON COLUMN group_messages.footer_text IS 'Rodape opcional para mensagens de menu (Uazapi /send/menu)';
COMMENT ON COLUMN group_messages.list_button IS 'Texto do botao que abre a lista de opcoes';
COMMENT ON COLUMN group_messages.menu_choices IS 'JSON array stringificado com as opcoes da lista [{title: string}]';
