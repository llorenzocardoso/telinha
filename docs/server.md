# Servidor de sinalização

Código em [server/](../server/): Node 20+ (Render usa 22), TypeScript, Express 4, `ws`, `cors`, `dotenv`. ESM (`"type": "module"`, imports com extensão `.js`).

## Arquivos

| Arquivo | Responsabilidade |
| --- | --- |
| `src/index.ts` | Lê o ambiente, instancia o servidor, escuta `PORT`/`HOST`, trata `SIGINT`/`SIGTERM` |
| `src/app.ts` | `createTelinhaServer(options)`: rotas HTTP, WebSocket, salas, limites, limpeza |
| `src/protocol.ts` | Parsers e limites das mensagens do cliente (`parseClientAuthentication`, `parseClientSignal`) |
| `src/codes.ts` | Alfabeto/tamanho do código, normalização, nome de exibição, URL pública do WebSocket |
| `src/turn.ts` | `createIceServerProvider`: STUN público + credenciais Cloudflare TURN com cache |
| `scripts/start.mjs` | `npm start`: roda `dist/index.js` se existir, senão `tsx src/index.ts` |
| `*.test.ts` | Testes Vitest (veja [development.md](development.md#testes)) |

`createTelinhaServer` recebe todas as opções por parâmetro (`TelinhaServerOptions`), o que permite testes sem tocar em `process.env`. Só `index.ts` lê variáveis de ambiente.

## Modelo de dados (somente memória)

```ts
Room {
  createdAt, emptiedAt,
  seats:        Map<id, Seat>         // vaga reservada via HTTP, ainda sem WebSocket
  holds:        Map<id, Hold>         // participante que caiu, aguardando reconexão
  participants: Map<id, Participant>  // conectado (tem ws)
}
```

`rooms` é um `Map<code, Room>` por instância. **Não há persistência nem sincronização entre instâncias**: escalar horizontalmente exigiria mover esse estado para fora do processo.

## Constantes que governam o comportamento

| Constante | Valor | Significado |
| --- | --- | --- |
| `SEAT_TTL_MS` | 2 min | Tempo para o cliente abrir o WebSocket depois do HTTP |
| `RECONNECT_GRACE_MS` | 15 min | Quanto tempo um participante estacionado (hold) mantém a vaga |
| `EMPTY_ROOM_GRACE_MS` | 15 min | Sala sem ninguém é removida depois disso |
| `ROOM_TTL_MS` | 6 h | Sala vazia com mais de 6 h de vida é removida (não derruba sala com gente dentro) |
| `MAX_ROOM_SIZE` | 16 | Seats + holds + participantes |
| `RATE_WINDOW_MS` | 15 min | Janela do rate limit |
| `CREATE_LIMIT` / `JOIN_LIMIT` | 8 / 30 | Requisições por IP na janela |
| `MAX_RATE_BUCKETS` | 10 000 | Teto de IPs rastreados; os mais antigos saem primeiro |
| `AUTHENTICATION_TIMEOUT_MS` | 5 s | Prazo da mensagem `authenticate` |
| `WS_HEARTBEAT_MS` | 25 s | Intervalo do `ping` do servidor |
| `MAX_SIGNAL_PAYLOAD_BYTES` | 64 KB | Tamanho máximo de uma mensagem WebSocket |
| Limpeza (`cleanupIntervalMs`) | 5 s | Varredura de salas expiradas e buckets vencidos |

> Atenção: `ROOM_TTL_MS` só remove salas **vazias** (`shouldDropRoom` exige `roomIsEmpty`). Uma sala ocupada continua existindo enquanto houver seat, hold ou participante.

## Ciclo de uma pessoa

- `issueSeat` cria o seat (HTTP). `consumeSeat` o consome ao autenticar.
- `parkParticipant` (WebSocket fechou sem `leave`): move para `holds`, preserva `name` e `sharing`, avisa `participant-presence {connected:false}`.
- `reclaimHold`: reconexão com o mesmo token.
- `expireHolds`: grace vencida → remove e avisa `participant-left`.
- `dismissParticipant` (leave ou DELETE): remove de tudo, avisa `participant-left`, fecha o socket com 1000.
- `markRoomActivity` / `shouldDropRoom`: controlam `emptiedAt` para a remoção de salas vazias.

Comparação de tokens usa `timingSafeEqual` (`tokensEqual`).

## Entrega de mensagens

Em `wireSocket`:

- Mensagens só são processadas se o socket ainda é o do participante (`current.ws === ws`); sockets substituídos são ignorados.
- `share-started` / `share-stopped`: broadcast para todos menos o autor.
- `watch-*`: entrega só ao transmissor alvo, nunca a terceiros (há teste cobrindo "não divulga espectadores para terceiros").
- `offer` / `answer` / `ice`: entrega só ao destinatário, com `from` preenchido pelo **servidor** (o cliente não consegue forjar remetente).
- Destinatário inexistente: a mensagem é descartada em silêncio.

## ICE e TURN (`src/turn.ts`)

`getIceServers()`:

1. Sem `CLOUDFLARE_TURN_KEY_ID` **e** `CLOUDFLARE_TURN_API_TOKEN`: devolve `PUBLIC_STUN_SERVERS` (Google ×2, Cloudflare ×1).
2. Com as duas: `POST https://rtc.live.cloudflare.com/v1/turn/keys/<keyId>/credentials/generate-ice-servers` com `{ttl}`, timeout de 4 s.
3. Resposta é normalizada por `parseIceServers` e mesclada com os STUN públicos que faltarem.
4. Cache em memória: renova depois de `max(ttl/2, ttl − 5 min)`.
5. Em qualquer falha (HTTP, timeout, resposta vazia): registra o erro e devolve o cache anterior ou só STUN. **A criação de sala nunca falha por causa do TURN.**

TTL: `CLOUDFLARE_TURN_TTL_SECONDS`, limitado entre 60 e 86 400 s (padrão 86 400). As credenciais são **compartilhadas por todos os participantes** enquanto o cache valer.

## Configuração lida em `index.ts`

| Variável | Efeito |
| --- | --- |
| `PORT`, `HOST` | Endereço (padrão 3001 / 0.0.0.0) |
| `WS_PUBLIC_URL` | Fixa o `wsUrl` devolvido; aceita `http(s)://`, `ws(s)://` ou host puro e acrescenta `/ws` (`resolvePublicWsUrl`) |
| `TRUST_PROXY` | `1` habilita `trust proxy`. Também é ativado automaticamente se existir `RENDER` |
| `CORS_ORIGINS` | Origens extras, separadas por vírgula |
| `MIN_PROTOCOL_VERSION` | Inteiro positivo; inválido volta ao padrão (versão atual) |
| `MIN_APP_VERSION` | Publicado em `/app-config` (padrão `0.2.0`) |
| `CLOUDFLARE_TURN_*` | Veja acima |

Sem `WS_PUBLIC_URL`, `wsUrlFromRequest` monta a URL com `Host` e `X-Forwarded-Proto`. Atrás de proxy, prefira configurar `WS_PUBLIC_URL`.

`index.ts` carrega `server/.env` e depois o `.env` do diretório de execução (`dotenv.config()` duas vezes).

## Receitas

**Adicionar uma rota HTTP.** Registre em `createTelinhaServer` depois do `app.use(express.json(...))`. Se recebe `protocolVersion`, use o middleware `requireProtocol`; se pode ser abusada, envolva com `rateLimited(map, limite)` (crie um novo `Map` de buckets e inclua-o na varredura do `setInterval` de limpeza).

**Mudar um limite.** Altere a constante no topo de `app.ts` e atualize a tabela acima e [signaling-protocol.md](signaling-protocol.md). Os testes que dependem de tempo usam as opções (`reconnectGraceMs`, `emptyRoomGraceMs`, `cleanupIntervalMs`, `authenticationTimeoutMs`) para encurtar prazos.

**Autenticar uma rota nova por participante.** Reaproveite `bearerToken(req)`, `findIdentity(room, participantId)` e `tokensEqual`, como em `GET /rooms/:code/ice-servers`.
