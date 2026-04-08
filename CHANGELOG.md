# CHANGELOG

Todas as mudanças notáveis deste projeto serão documentadas aqui.
Formato: [MAJOR.MINOR.PATCH] - YYYY-MM-DD

---

## [1.2.0] - 2026-04-08

### Added
- **Nova Edge Function `evolution-reset-instance`**
  - **Contexto:** Usuário ficava preso na tela de QR Code após erro de conexão sem poder reiniciar o fluxo.
  - **Justificativa técnica:** Necessidade de endpoint que desconecte a instância na Uazapi e limpe o estado no banco de forma atômica.
  - **Endpoints Uazapi utilizados:**
    - `POST /instance/disconnect` (primário) — encerra sessão, exige novo QR.
    - `POST /instance/reset` (fallback) — reset controlado do runtime quando disconnect falha.
  - **Impacto no banco:** `UPDATE evolution_config SET instance_created=false, qr_code=null, connection_status='disconnected', token=''`
  - **Impacto nas APIs:** Nova Edge Function deployada no Supabase (project: `foifugnuaehjtjftpkrk`). JWT obrigatório.
  - **Impacto nas regras de negócio:** Usuário pode reiniciar o fluxo de conexão a qualquer momento sem recarregar a página.

### Changed
- **`ConfigDialog.tsx` — Fluxo de conexão com recuperação de erros**
  - **Contexto:** A tela de QR Code não tinha botão de saída/reset. Erros de polling silenciosos mantinham o usuário preso em tela com QR expirado.
  - **Justificativa técnica:** UX crítica — fluxo de conexão deve sempre ter saída clara.
  - **Mudanças específicas:**
    1. Adicionados botões **"Voltar"** e **"Limpar e Gerar Novo QR"** na tela do QR Code.
    2. Estado `pollingFailed` (boolean) exibe alerta visual (`AlertTriangle`) quando polling atinge 5 erros consecutivos.
    3. Contador de erros visível durante polling (`(X/5 erros)`).
    4. Removida restauração automática de QR expirado do banco ao reabrir o modal (`loadConfig` não vai mais para step `qrcode`).
    5. Polling atualiza QR Code na tela se Uazapi retornar novo QR no status.
  - **Impacto no banco:** Leitura apenas — não persiste QR code ao reabrir modal.
  - **Impacto nas APIs:** Chama nova `evolution-reset-instance` ao clicar em Voltar ou Limpar.
  - **Impacto nas regras de negócio:** QR expirado não é mais exibido automaticamente. Usuário precisa reconectar explicitamente.

### Refactored
- **`AI_MEMORY.md`** atualizado com:
  - Tabela de Edge Functions.
  - Diagrama do fluxo de conexão.
  - Endpoints de disconnect/reset documentados.

---

## [1.1.0] - Anterior

### Added
- Migração da Evolution API para Uazapi 2.0.1.
- Edge Functions: `evolution-create-instance`, `evolution-status`, `send-messages`, `send-group-messages`, `fetch-groups`, `test-connection`, `cleanup-files`.
- Sistema de envio individual e para grupos.
- Configuração de delay e pausas por lote.
