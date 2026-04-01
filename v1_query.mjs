
const projectRef = 'uvvaxwtumuabfklccjgd';
const token = 'sbp_d123c0bfff918fecd770f64bcaeb6c5a5b131b7e';
const sql = `
ALTER TABLE group_messages
  ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'media',
  ADD COLUMN IF NOT EXISTS footer_text TEXT,
  ADD COLUMN IF NOT EXISTS list_button TEXT,
  ADD COLUMN IF NOT EXISTS menu_choices TEXT;

COMMENT ON COLUMN group_messages.message_type IS 'Tipo da mensagem: media, text, menu';
COMMENT ON COLUMN group_messages.footer_text IS 'Rodape opcional para mensagens de menu (Uazapi /send/menu)';
COMMENT ON COLUMN group_messages.list_button IS 'Texto do botao que abre a lista de opcoes';
COMMENT ON COLUMN group_messages.menu_choices IS 'JSON array stringificado com as opcoes da lista [{title: string}]';
`;

async function run() {
  console.log(`Enviando SQL para o projeto ${projectRef} via Management API...`);
  try {
    const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query: sql })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ Erro da API:', data);
      process.exit(1);
    } else {
      console.log('✅ SQL EXECUTADO COM SUCESSO!');
      console.log('Resposta:', JSON.stringify(data, null, 2));
    }
  } catch (error) {
    console.error('❌ Erro de rede/falha:', error.message);
    process.exit(1);
  }
}

run();
