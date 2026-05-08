# AI MEMORY - Bot Envios WhatsApp

## Contexto do Projeto
Sistema de envios em massa (WhatsApp) utilizando **Evolution Go API** (docs.evolutionfoundation.com.br/evolution-go).
O sistema utiliza Supabase (Edge Functions + Database + Storage) e projeto atual: `uvvaxwtumuabfklccjgd`.
GitHub: `https://github.com/BarretosJulio10/bot_envios.git`

## ⚠️ REGRA DE OURO — Nunca Esquecer

### Autenticação Evolution Go
A Evolution Go usa **APENAS o header `apikey`** — não existe header `token` separado.
- **Admin routes** (criar instância): `apikey = ADMIN_KEY` (Secret `global_apikay`)
- **Instance routes** (conectar, QR, enviar, status): `apikey = INSTANCE_TOKEN` (coluna `token` da tabela `evolution_config`)

### Campo do QR Code — Bug Histórico
- ❌ ERRADO: `data.QRCode` (Fzap antigo)
- ✅ CERTO:  `data.Qrcode` (Q maiúsculo, r/c minúsculo — Evolution Go)

### Campos de Status — PascalCase
- ❌ ERRADO: `data.connected`, `data.loggedIn`
- ✅ CERTO:  `data.Connected`, `data.LoggedIn`

---

## Infraestrutura (2026-05-08)

### Servidor Evolution Go (Self-Hosted)
- **Manager URL**: `https://129.121.54.97/manager` (painel administrativo web)
- **API Base URL**: `https://129.121.54.97` (Secret: `EVOLUTION_API_URL`)
- **Admin Key**: configurado no Secret `global_apikay`

> ⚠️ ATENÇÃO: O Admin Key foi exposto acidentalmente. Regenerar no painel `/manager` e atualizar o Secret `global_apikay` no Supabase assim que possível.

### Supabase
- **Projeto**: `uvvaxwtumuabfklccjgd`
- **Secrets configurados**:
  - `EVOLUTION_API_URL` = `https://129.121.54.97`
  - `global_apikay` = Admin Key do Evolution Go

---

## Endpoints Corretos (Evolution Go)

| Operação | Método | Endpoint | apikey |
|---|---|---|---|
| Criar instância | POST | `/instance/create` | ADMIN KEY |
| Conectar sessão | POST | `/instance/connect` | INSTANCE TOKEN |
| Obter QR Code | GET | `/instance/qr` → `data.Qrcode` | INSTANCE TOKEN |
| Status | GET | `/instance/status` → `data.Connected`, `data.LoggedIn` | INSTANCE TOKEN |
| Logout | DELETE | `/instance/logout` | INSTANCE TOKEN |
| Enviar texto | POST | `/send/text` → `{ number, text }` | INSTANCE TOKEN |
| Enviar mídia | POST | `/send/media` → `{ number, url, type, caption, filename }` | INSTANCE TOKEN |
| Listar grupos | GET | `/group/list` → `data[].JID`, `data[].Name` | INSTANCE TOKEN |

---

## Edge Functions (todas deployadas)

| Função | Propósito |
|---|---|
| `evolution-create-instance` | POST /instance/create + connect + polling QR /instance/qr |
| `evolution-status` | GET /instance/status + atualiza QR /instance/qr |
| `evolution-reset-instance` | DELETE /instance/logout + limpa banco |
| `send-messages` | POST /send/text ou /send/media |
| `send-group-messages` | POST /send/text ou /send/media para grupos |
| `fetch-groups` | GET /group/list com apikey = instance token |
| `test-connection` | GET /instance/status (Connected, LoggedIn) |
| `cleanup-files` | Limpeza de arquivos do Storage |

---

## Fluxo de Conexão WhatsApp

```
[Conectar WhatsApp]
       ↓
evolution-create-instance
  1. POST /instance/create (apikey = ADMIN KEY)  → retorna data.token
  2. POST /instance/connect (apikey = INSTANCE TOKEN)
  3. polling GET /instance/qr (até 8 tentativas, 2s cada) → data.Qrcode
       ↓
[QR Code renderizado no modal]
       ↓
[polling a cada 3s] → evolution-status
  GET /instance/status → data.LoggedIn === true
       ↓
[WhatsApp conectado — modal fecha]
```

## Reset de Instância
- `DELETE /instance/logout` com `apikey = INSTANCE TOKEN`
- Limpa banco: `instance_created=false`, `qr_code=null`, `connection_status='disconnected'`, `token=''`
- Tolerante a falhas (limpa banco mesmo se API não responder)

## Histórico de Migrações
- v1.x: Uazapi API
- v2.0: Fzap API (fzap.pagoupix.com.br) — URL/chaves incorretas
- v2.2.0 (2026-05-08): Evolution Go self-hosted (129.121.54.97) — VERSÃO ATUAL ✅
