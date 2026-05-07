# AI MEMORY - Bot Envios Fzap

## Contexto do Projeto
Sistema de envios em massa (WhatsApp) migrado da Uazapi para a **Fzap API (v1.23.0)**.
O sistema utiliza Supabase (Edge Functions + Database + Storage) e projeto atual: `uvvaxwtumuabfklccjgd`.

## Regra de Ouro (Sempre Seguir)
1. **FZAP APENAS:** Nunca use termos ou lógica relacionados à "Evolution API" ou "Uazapi" nas novas implementações. 
2. **AUTENTICAÇÃO:** 
   - `Authorization` (Header): Usado apenas para operações administrativas na rota `/admin/users` (ex: criar instância). Vem do secret `global_apikay`.
   - `token` (Header): Usado para TODAS AS OUTRAS operações da instância (ex: conectar, enviar mensagem, verificar status). Vem da coluna `token` na tabela `evolution_config` (salvo durante a criação).
3. **ENDPOINTS CRÍTICOS (Fzap v1.23.0):**
   - `POST /admin/users`: Requer `Authorization: <ADMIN_TOKEN>`. Cria a instância e retorna o `token` de sessão no body.
   - `POST /session/connect`: Requer `token: <session_token>`. Inicia a conexão websocket.
   - `GET /session/qr`: Requer `token`. Obtém o QR Code em Base64 (assíncrono, pode requerer polling).
   - `GET /session/status`: Requer `token`. Verifica status (logado = `data.loggedIn === true`).
   - `POST /session/disconnect` e `POST /session/reset`: Usados para encerrar e resetar sessões ativas.
   - Envios de mídia usam endpoints separados (`/chat/send/image`, `/chat/send/video`, etc.) passando propriedades tipadas (ex: `phone`, `caption`, `image`).

## Edge Functions Existentes
| Função | Propósito |
|---|---|
| `evolution-create-instance` | Cria instância (/admin/users) + conecta + gera QR Code (/session/qr) |
| `evolution-status` | Polling de status (GET /session/status) |
| `evolution-reset-instance` | Desconecta + limpa banco (reset do fluxo) |
| `send-messages` | Envio individual (refatorada para múltiplos endpoints de mídia) |
| `send-group-messages` | Envio para grupos (usando /chat/send/list, etc) |
| `fetch-groups` | Lista grupos (GET /group/list) |
| `test-connection` | Testa conectividade (GET /session/status) |
| `cleanup-files` | Limpeza de arquivos |

## Fluxo de Conexão WhatsApp
```
form → [Conectar WhatsApp] → evolution-create-instance → step: qrcode
qrcode → [polling a cada 3s] → evolution-status → step: connected (auto-fecha)
qrcode → [Limpar e Gerar Novo QR] → evolution-reset-instance → step: form
qrcode → [Voltar] → evolution-reset-instance → step: form
```

## Reset de Instância (evolution-reset-instance)
- Chama `POST /session/disconnect` na Fzap.
- Fallback: `POST /session/reset` se disconnect falhar.
- Limpa banco: `instance_created=false`, `qr_code=null`, `connection_status='disconnected'`, `token=''`
- É tolerante a falhas de rede (limpa banco mesmo se API não responder).

## Estado Atual (2026-05-07)
O sistema foi migrado com sucesso para a **Fzap API (v1.23.0)**.
- **Backend**: 8 Supabase Edge Functions deployadas no projeto `uvvaxwtumuabfklccjgd`.
- **Secrets**: `EVOLUTION_API_URL` e `global_apikay` configurados.
- **Tokens**: Sistema utiliza tokens curtos de 12 caracteres para máxima compatibilidade.
- **Status**: Instâncias sendo criadas com sucesso (Status: "Conectando"). QRCode agora é buscado agressivamente durante o polling.

### Configurações Importantes
- **Admin Token**: `P3BpI2Cz1nUmFOXdHOeuGUzk` (Secret: `global_apikay`).
- **Base URL**: `https://fzap.pagoupix.com.br` (Secret: `EVOLUTION_API_URL`).
- **Headers**: Usar `Authorization: <admin_token>` para rotas `/admin` e `token: <inst_token>` (ou `apikey`) para rotas de sessão.
