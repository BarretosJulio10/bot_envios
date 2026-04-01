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
   - `POST /instance/connect`: Requer `token`. Gera QR Code ou Pairing Code.
   - `GET /instance/status`: Requer `token`.

## Histórico de Mudanças Recentes
- Migração de `/instance/create` para usar `admintoken`.
- Correção de `/instance/connect` de GET para POST.
- [A FAZER] Remover envio de `token` no body do `/instance/create` (Uazapi gera o token).
- [A FAZER] Renomear variáveis internas de `evolution` para `uazapi` gradualmente.

## Status Atual
- Backend sincronizado (GitHub).
- Falha reportada no Login (Status 400). Causa provável: payload de criação incorreto (campo `token` no body).
