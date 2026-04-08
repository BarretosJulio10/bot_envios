# AI MEMORY - Bot Envios Uazapi

## Contexto do Projeto
Sistema de envios em massa (WhatsApp) migrado da Evolution API para a **Uazapi**.
O sistema utiliza Supabase (Edge Functions + Database + Storage).

## Regra de Ouro (Sempre Seguir)
1. **UAZAPI APENAS:** Nunca use termos ou lógica relacionados à "Evolution API". 
2. **AUTENTICAÇÃO:** 
   - `admintoken` (Header): Usado para operações administrativas (ex: criar instância). Vem do secret `global_apikay`.
   - `token` (Header): Usado para operações da instância (ex: enviar mensagem, verificar status). Vem da coluna `token` na tabela `evolution_config`.
3. **ENDPOINTS CRÍTICOS (Uazapi 2.0.1):**
   - `POST /instance/create`: Requer `admintoken`. Retorna o `token` da instância.
   - `POST /instance/connect`: Requer `token`. Gera QR Code ou Pairing Code. Timeout: 2 min (QR) / 5 min (pairing).
   - `GET /instance/status`: Requer `token`. QR atualizado vem em `instance.qrcode`.
   - `POST /instance/disconnect`: Requer `token`. Encerra sessão, exige novo QR na reconexão.
   - `POST /instance/reset`: Requer `token`. Reset controlado do runtime (usar como fallback do disconnect).

## Edge Functions Existentes
| Função | Propósito |
|---|---|
| `evolution-create-instance` | Cria instância + gera QR Code |
| `evolution-status` | Polling de status (connected/connecting) |
| `evolution-reset-instance` | Desconecta + limpa banco (reset do fluxo) |
| `send-messages` | Envio individual |
| `send-group-messages` | Envio para grupos |
| `fetch-groups` | Lista grupos |
| `test-connection` | Testa conectividade |
| `cleanup-files` | Limpeza de arquivos |

## Fluxo de Conexão WhatsApp
```
form → [Conectar WhatsApp] → evolution-create-instance → step: qrcode
qrcode → [polling a cada 3s] → evolution-status → step: connected (auto-fecha)
qrcode → [Limpar e Gerar Novo QR] → evolution-reset-instance → step: form
qrcode → [Voltar] → evolution-reset-instance → step: form
```

## Reset de Instância (evolution-reset-instance)
- Chama `POST /instance/disconnect` na Uazapi
- Fallback: `POST /instance/reset` se disconnect falhar
- Limpa banco: `instance_created=false`, `qr_code=null`, `connection_status='disconnected'`, `token=''`
- É tolerante a falhas de rede (limpa banco mesmo se Uazapi não responder)

## Status Atual
- Fluxo de conexão com QR Code implementado e com recuperação de erros.
- QR Code expirado do banco NÃO é mais restaurado automaticamente ao reabrir modal.
- Polling exibe contador de erros na tela (não só toast silencioso).

## Histórico de Mudanças Recentes
- Implementado fluxo de reset: botões "Voltar" e "Limpar e Gerar Novo QR" na tela do QR.
- Criada Edge Function `evolution-reset-instance` (deploy realizado).
- Corrigido: não restaurar QR expirado do banco ao reabrir o modal.
- Corrigido: exibir estado de erro visível quando polling falha após 5 tentativas.
