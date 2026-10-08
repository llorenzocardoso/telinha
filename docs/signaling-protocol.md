# API HTTP e protocolo de sinalização

Fontes: [server/src/app.ts](../server/src/app.ts), [server/src/protocol.ts](../server/src/protocol.ts), [src/lib/protocol.ts](../src/lib/protocol.ts), [src/lib/api.ts](../src/lib/api.ts).

> O protocolo é definido **duas vezes**: no servidor (`server/src/protocol.ts`) e no cliente (`src/lib/protocol.ts`). Não há pacote compartilhado; qualquer mudança precisa ser feita nos dois lados e coberta pelos testes de cada um (`protocol.test.ts`).

## Versões

- `protocolVersion` atual: **2** (`CURRENT_PROTOCOL_VERSION` no servidor, `PROTOCOL_VERSION` no cliente).
- O servidor rejeita clientes com versão menor que `MIN_PROTOCOL_VERSION` (padrão = versão atual).
- Sem `protocolVersion` no corpo, a versão lida é `0` e a requisição é recusada quando o mínimo é 1 ou mais.

## Códigos de sala e identificadores

| Item | Formato |
| --- | --- |
| Código da sala | 6 caracteres de `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (sem `I`, `O`, `0`, `1`); gerado com `crypto.randomBytes` |
| `participantId` | `user-` + 32 hex (`/^user-[a-f0-9]{32}$/`) |
| `token` | 24 bytes aleatórios em base64url (32 caracteres; `/^[A-Za-z0-9_-]{32}$/`) |
| Nome de exibição | `trim()`, máximo 24 caracteres; vazio vira `"Amigo"` |

## API HTTP

Corpo JSON limitado a 32 KB. CORS: ver [security.md](security.md#origens-cors-e-websocket).

### `GET /health`
`200 {"ok": true, "service": "telinha-server"}`. Usado como health check do Render e pelo cliente (ping a cada 2 minutos enquanto está em uma sala).

### `GET /app-config`
`200 {"minAppVersion": "0.2.0", "minProtocolVersion": 2}`. O app compara `minAppVersion` com a própria versão para exigir atualização.

### `POST /rooms`
Cria uma sala e já reserva um seat para o criador. Limite: 8 por IP a cada 15 min.

```json
// request
{ "displayName": "Ana", "protocolVersion": 2, "appVersion": "0.3.0" }
```

Campo `code` no corpo é rejeitado (`400`, "Código personalizado não é suportado.").

```json
// 200
{
  "code": "AB3K7Q",
  "participantId": "user-…",
  "token": "…",
  "displayName": "Ana",
  "wsUrl": "wss://host/ws",
  "protocolVersion": 2,
  "wsAuthMode": "message",
  "iceServers": [{ "urls": "stun:…" }, { "urls": ["turn:…"], "username": "…", "credential": "…" }]
}
```

### `POST /rooms/:code/join`
Reserva um seat em sala existente. Limite: 30 por IP a cada 15 min. Mesma resposta de `POST /rooms`.

| Status | Causa |
| --- | --- |
| `400` | Código inválido |
| `404` | Sala não encontrada |
| `409` | Sala cheia (seats + holds + participantes ≥ 16) |
| `426` | `protocolVersion` abaixo do mínimo (`code: "UPDATE_REQUIRED"`, `minimumProtocolVersion`) |
| `429` | Rate limit (`Retry-After` em segundos) |

### `GET /rooms/:code/ice-servers?participantId=…`
Renova credenciais ICE. Exige `Authorization: Bearer <token>`; `403` se sala, participante ou token não conferem. `200 {"iceServers": [...]}`.

### `DELETE /rooms/:code/participants/:participantId`
Sai da sala. Exige `Authorization: Bearer <token>`. É **idempotente**: sala ou participante inexistente devolve `204`; token errado devolve `403`. Remove seat, hold ou participante conectado e avisa os demais (`participant-left`).

## WebSocket (`/ws`)

`maxPayload` de 64 KB. A origem (`Origin`) deve estar permitida, senão o servidor envia `error` com `code: "origin-not-allowed"` e fecha com 1008.

### Autenticação

**Modo `message` (atual, `wsAuthMode: "message"`)**: o cliente conecta em `wsUrl?protocolVersion=2&appVersion=…` e envia, em até 5 s (`AUTHENTICATION_TIMEOUT_MS`), a primeira mensagem:

```json
{ "type": "authenticate", "code": "AB3K7Q", "participantId": "user-…", "token": "…", "protocolVersion": 2, "appVersion": "0.3.0" }
```

Sem ela, o servidor responde `authentication-timeout` e fecha (1008). Mensagem malformada responde `authentication-error`.

**Modo legado (`query`)**: `code`, `participantId` e `token` na query string. O servidor ainda aceita, mas o token vai parar na URL; o cliente só usa quando a resposta da API não traz `wsAuthMode: "message"`.

Ao admitir, o servidor responde com `hello`. Quatro casos de admissão (`admitSocket`):

1. **Participante já conectado com o mesmo token**: o novo socket substitui o antigo (que é fechado).
2. **Hold** (participante estacionado): reassume a vaga e avisa `participant-presence {connected: true}`.
3. **Seat**: vira participante e avisa `participant-joined`.
4. Caso contrário: `error` "Sala inválida." e fecha (1008).

### Cliente → servidor (`ClientSignal`)

| `type` | Campos | Efeito |
| --- | --- | --- |
| `ping` | — | Servidor responde `pong` |
| `leave` | — | Remove o participante, avisa `participant-left`, fecha o socket |
| `share-started` / `share-stopped` | — | Marca `sharing` e avisa os outros |
| `watch-started` / `watch-stopped` | `to` | Encaminha ao alvo (só se o alvo existe, não é o próprio e, no `started`, está transmitindo) |
| `offer` / `answer` | `to`, `sdp` | Encaminha ao alvo como `from` + `sdp` (SDP ≤ 60 KB) |
| `ice` | `to`, `candidate` | Encaminha o candidato (≤ 8 KB serializado; `candidate` string ≤ 4096) |

Mensagem inválida: o servidor envia `error` (`code: "protocol-error"`) e fecha com 1008.

### Servidor → cliente (`ServerSignal`)

| `type` | Campos | Quando |
| --- | --- | --- |
| `hello` | `you`, `participants[]` | Logo após autenticar; lista inclui holds com `connected: false` |
| `participant-joined` | `participant` | Alguém novo entrou |
| `participant-presence` | `participantId`, `connected` | Alguém caiu (`false`) ou reconectou (`true`) |
| `participant-left` | `participantId` | Saída definitiva (leave, DELETE ou grace expirada) |
| `share-started` | `participantId`, `name` | Alguém começou a transmitir |
| `share-stopped` | `participantId` | Alguém parou |
| `watch-started` / `watch-stopped` | `from`, `to`, `name` | Só para o transmissor alvo. `watch-started` é o **gatilho da oferta**: o transmissor só faz `offer` a quem o enviou. `watch-stopped` encerra o envio a esse espectador |
| `offer` / `answer` | `from`, `sdp` | Negociação |
| `ice` | `from`, `candidate` | Candidato ICE |
| `pong` | — | Resposta a `ping` |
| `error` | `message`, `code?` | Ver tabela abaixo |

Um `participant` é `{ id, name, sharing, connected }`.

> **Compatibilidade entre versões do app.** O formato das mensagens e `PROTOCOL_VERSION` não mudaram, mas `watch-started` deixou de ser só um aviso e virou o gatilho da oferta. Misturar versões gera comportamento inconsistente: um espectador antigo nunca vê lives de um transmissor novo (sua lista dependia de receber stream), e um transmissor antigo continua enviando a todos. Suba `MIN_APP_VERSION` ao publicar esta mudança.

### Códigos de erro do WebSocket

| `code` | Significado | Reação do cliente |
| --- | --- | --- |
| `update-required` | Protocolo antigo | Para de reconectar e abre a tela de atualização obrigatória |
| `origin-not-allowed` | Origem fora da lista | Erro fatal |
| `authentication-timeout` / `authentication-error` | Falha na autenticação | Erro fatal |
| `protocol-error` | Mensagem inválida | Erro fatal |
| *(sem code)* "Sala inválida." | Seat/hold/sala não existe mais | O cliente pede novo seat com `POST /rooms/:code/join` (até 6 vezes) |

### Keepalive

- Servidor envia `ping` WebSocket (nível de protocolo) a cada 25 s.
- Cliente envia `{"type":"ping"}` a cada 20 s.

## Como estender o protocolo

1. Adicione o tipo em `ClientSignal` / `ServerSignal` nos dois arquivos `protocol.ts` e valide o formato em `parseClientSignal` (servidor) e `parseServerSignal` (cliente). Hoje o servidor **fecha** a conexão em mensagem desconhecida, então um cliente novo falando com servidor antigo cai.
2. Trate a mensagem em `wireSocket` (`server/src/app.ts`) e em `handleMessage` (`src/hooks/useTelinhaRoom.ts`).
3. Se a mudança quebra clientes antigos, incremente `CURRENT_PROTOCOL_VERSION` / `PROTOCOL_VERSION` e planeje a subida de `MIN_PROTOCOL_VERSION` (veja [operations.md](operations.md#versões-e-compatibilidade)).
4. Cubra com testes em `server/src/protocol.test.ts`, `server/src/app.test.ts` e `src/lib/protocol.test.ts`.
