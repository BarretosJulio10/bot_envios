# CHANGELOG

Todas as mudanças notáveis deste projeto serão documentadas aqui.
Formato: [MAJOR.MINOR.PATCH] - YYYY-MM-DD

---

## [2.1.0] - 2026-05-07

### Added
- Migração completa da infraestrutura de WhatsApp para **Fzap API** (v1.23.0).
- Implementação de tokens curtos (12 caracteres) para sessões, visando maior compatibilidade com headers HTTP da Fzap.
- Suporte a múltiplos headers de autenticação (`token` e `apikey`) nas requisições de sessão.

### Fixed
- Erro 405 (Method Not Allowed) ao criar instância: Corrigido apontamento de `EVOLUTION_API_URL` nos Secrets do Supabase.
- Erro 409 (Conflict): Resolvido através da geração de tokens únicos obrigatórios na criação do usuário/instância.
- Polling de QR Code: Ajustado para capturar o código mesmo em status "Connecting", contornando o delay de inicialização do websocket.

### Security
- Configuração de `global_apikay` (Admin Token) protegida como Secret no Supabase.

---

## [1.3.0] - 2026-05-07

### Added
- **Migração para Fzap API (v1.23.0)**
  - **Contexto da mudança:** Substituição completa da infraestrutura Uazapi pela Fzap, mantendo o frontend intacto.
  - **Justificativa técnica:** Melhor escalabilidade e separação de endpoints por tipo de mídia exigidos pela Fzap.
  - **Configuração Fzap:**
    - **API de WhatsApp**: Fzap API (v1.23.0)
    - **URL Base**: `https://fzap.pagoupix.com.br`
    - **Autenticação**:
      - Global: `global_apikay` (Admin Token) para criação de instâncias.
      - Instância: Token alfanumérico curto (12 chars) gerado em cada conexão.
    - **Fluxo de Conexão**: `POST /admin/users` -> `POST /session/connect` -> `GET /session/qr`.
    - **Polling**: Realizado pela função `evolution-status` que busca o QR Code se `loggedIn` for falso.
  - **Impacto em APIs:** 
    - 6 Edge Functions refatoradas e deployadas no Supabase (projeto uvvaxwtumuabfklccjgd).
    - `evolution-create-instance`: Alterado para usar `POST /admin/users` (com Authorization: ADMIN_TOKEN) + `POST /session/connect` + `GET /session/qr`.
    - `evolution-status` / `test-connection`: Atualizados para verificar `GET /session/status` e o campo `loggedIn`.
    - `evolution-reset-instance`: Atualizado para `POST /session/disconnect` e `POST /session/reset`.
    - `fetch-groups`: Lógica de parsing ajustada para lidar com a resposta do `GET /group/list`.
    - `send-messages` / `send-group-messages`: Modularização dos envios (`/chat/send/image`, `/chat/send/video`, etc.) usando novo payload (`phone`, `caption`, `body`).
  - **Impacto no banco de dados:** Nenhum estrutural. O campo `token` da tabela `evolution_config` armazena o token de sessão retornado pela Fzap na criação do usuário.
  - **Impacto em regras de negócio:** Fluxos de polling de QR Code ajustados para respeitar a assincronicidade da API Fzap (QR demora alguns segundos para ser gerado).

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
