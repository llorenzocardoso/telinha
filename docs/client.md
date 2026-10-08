# Cliente (React + WebRTC)

Código em [src/](../src/). React 19, TypeScript, Vite 6, `lucide-react` para ícones. Não há roteador nem biblioteca de estado: `App.tsx` alterna entre `HomeScreen` e `RoomScreen` conforme exista uma `RoomSession`.

## Visão por arquivo

| Arquivo | Responsabilidade |
| --- | --- |
| `App.tsx` | Sessão ativa, convites por deep link, saída/encerramento, fluxo de atualização, diálogo de fechar janela |
| `screens/HomeScreen.tsx` | Nome do usuário, criar sala, entrar com código |
| `screens/RoomScreen.tsx` | Lobby, lista de pessoas, escolha de transmissões, visualização (tela cheia, janela, grade/mosaico), avisos sonoros, cópia de código/diagnóstico |
| `hooks/useTelinhaRoom.ts` | WebSocket de sinalização, lista de pessoas, transmissão local, reconexão, métricas |
| `room/peerManager.ts` | Uma `RTCPeerConnection` por par, negociação, recuperação de mídia, coleta de estatísticas |
| `room/connectionQuality.ts` | Classifica a qualidade (`good` / `unstable` / `reconnecting` / `offline`) |
| `media/displayShare.ts` | Opções e chamada de `getDisplayMedia`; fluxo sintético para E2E |
| `media/shareAudio.ts` | Recebe PCM do Rust e o converte numa `MediaStreamTrack` via `AudioWorklet` |
| `lib/api.ts` | Cliente HTTP (criar/entrar/sair, ICE, config) e URLs/mensagens de autenticação do WebSocket |
| `lib/protocol.ts` | Tipos e `parseServerSignal`; `PROTOCOL_VERSION` e `APP_VERSION` |
| `lib/ice.ts` | Monta a lista de `iceServers` do `RTCPeerConnection` |
| `lib/sessionStore.ts` | Persistência da sessão ativa e fila de saídas pendentes |
| `lib/updates.ts` | Comparação de versões e atualização via plugin updater |
| `lib/diagnostics.ts` | Buffer de eventos sanitizados para "copiar diagnóstico" |
| `lib/deepLink.ts`, `lib/watch.ts`, `lib/sounds.ts`, `lib/runtime.ts` | Deep links, seleção de transmissões e mosaico, sons de aviso, detecção do Tauri |
| `components/` | `ScreenSharePicker`, `LiveControls`, `VideoTile`, `VolumeControl`, `ConnectionStatus`, `UpdatePrompt`, `ClosePrompt` |

Testes unitários ficam ao lado do código (`*.test.ts`, Vitest em ambiente `node`, sem DOM). Lógica que precisa de teste deve viver em módulos puros, como `lib/*` e `room/connectionQuality.ts`.

## Sessão do usuário

`RoomSession` (`lib/api.ts`): `code`, `participantId`, `token`, `displayName`, `wsUrl`, `protocolVersion`, `wsAuthMode`, `iceServers`.

- `App` guarda a sessão em estado e em `localStorage` (`saveActiveSession`), renovando o carimbo a cada 60 s. `loadActiveSession` descarta sessões com mais de **20 minutos** ou inválidas. Isso permite recarregar o app e voltar para a sala.
- Ao sair (`leaveRoom`): limpa a sessão local e chama `DELETE /rooms/:code/participants/:id`. Se a chamada falhar (timeout de 3 s, rede), a sessão entra em uma fila (`queuePendingLeave`, máximo 8) e é reenviada em `flushPendingLeaves` na próxima abertura ou antes de entrar em outra sala.
- `onSessionRefresh` (`adoptSession`) troca a sessão por uma nova quando o servidor não reconhece mais o seat (veja reconexão).

## `useTelinhaRoom`

Recebe `session` e devolve estado e ações da sala.

**Retorno:** `connectionState`, `isSharing`, `screenShares`, `participants`, `watcherCounts`, `watcherNames`, `connectionQuality`, `error`, e as ações `startShare`, `stopShare`, `setWatchingShare`, `retryConnections`, `copyDiagnostics`.

**Estado em refs.** Pessoas, streams remotas, observadores e o `PeerManager` ficam em `useRef` e são publicados no estado React por funções `publish*`. Isso evita recriar a conexão a cada renderização, mas exige chamar `publishPeople` / `publishShares` / `publishWatchers` depois de mexer nas refs.

**Efeito principal** (depende de `session`): cria o `PeerManager`, abre o WebSocket, trata mensagens e inicia timers (ping do WebSocket a cada 20 s, `/health` a cada 120 s, coleta de métricas a cada 2 s). A função de limpeza envia `leave`, fecha peers e zera tudo.

### Tratamento de mensagens do servidor

| Mensagem | Ação |
| --- | --- |
| `hello` | Substitui a lista de pessoas; estado → `Connected`; reenvia `watch-started` a cada live que o usuário assiste e que ainda transmite; se estiver transmitindo, reenvia `share-started` e faz `offer` só aos membros conectados da audiência |
| `participant-joined` | Adiciona a pessoa e republica as lives; só faz `offer` se ela já estiver na audiência |
| `participant-presence` | `connected:false` → fecha o peer, limpa stream e remove da audiência; `true` → reenvia `watch-started` se o usuário a assiste e refaz a `offer` se ela está na audiência |
| `participant-left` | Remove a pessoa, fecha o peer e tira da audiência |
| `share-started` / `share-stopped` | Marca `isSharing` e republica as lives (a live aparece sem mídia); ao parar, descarta a stream e fecha o peer se a pessoa não está na audiência |
| `watch-started` | **Gatilho da oferta.** Se o usuário transmite e o espectador é conhecido e conectado: entra na audiência e recebe uma `offer` com as faixas locais (idempotente: repetir com a conexão viva só atualiza o nome) |
| `watch-stopped` | Tira o espectador da audiência; se o usuário ainda assiste a ele, `stopSending` renegocia sem faixas; senão fecha a conexão |
| `offer` / `answer` / `ice` | Repassa ao `PeerManager` |
| `error` | `update-required` → fatal + abre atualização obrigatória; "Sala inválida" → tenta novo seat; demais → fatal |

### Reconexão

```mermaid
flowchart TD
    close[WebSocket fechou] --> fatal{fatal, fechado<br/>ou reseating?}
    fatal -- sim --> stop[Não reconecta]
    fatal -- não --> tries{8 tentativas?}
    tries -- sim --> off[Disconnected:<br/>"A conexão caiu..."]
    tries -- não --> wait["Espera min(1s × 2^n, 8s)"] --> open[Novo WebSocket<br/>com a mesma sessão]
    open --> ok{hello?}
    ok -- sim --> done[Connected; zera tentativas e reseats]
    ok -- "Sala inválida" --> seat{reseats < 6?}
    seat -- sim --> join[POST /rooms/:code/join<br/>→ onSessionRefresh]
    seat -- não --> dead["A sala caiu..."]
```

Enquanto o servidor guardar o hold (15 min), a reconexão com o mesmo token recupera a identidade. Depois disso, o cliente tenta um novo seat; mudar de `participantId` faz a pessoa aparecer como nova para os outros.

### Transmissão

`startShare(sourceId, quality)`:

1. `cleanupNativeShare()` para qualquer transmissão anterior.
2. `startDisplayMediaShare` chama `getDisplayMedia` (no Tauri, o seletor nativo do WebView2). Rejeição por cancelamento vira o erro "Seleção de tela cancelada.".
3. No app Windows com áudio ligado, `needsNativeAudioLoopback` é verdadeiro (o navegador não entrega áudio de sistema): cria a faixa via `createShareAudioTrack`, escuta os eventos `share-audio` / `share-audio-error` e chama `invoke("start_share_capture", { includeAudio: true, includeVideo: false, ... })`.
4. A faixa de vídeo `ended` (usuário parou pelo Windows) dispara `stopShare`.
5. Envia `share-started`. **Não faz `offer` a ninguém**: a mídia só é enviada a quem pedir (`watch-started`), então o upload cresce com o número de espectadores, não com o tamanho da sala.

`stopShare` envia `share-stopped`, esvazia a audiência, chama `stopSending` nos peers dos quais o usuário ainda recebe mídia e fecha os demais, depois para as faixas e chama `stop_share_capture`.

### Oferta sob demanda

Três conjuntos separados no hook:

- **Quem está ao vivo** vem de `participants` (flag `sharing` do servidor), via `buildScreenShares` (`src/room/screenShares.ts`). `screenShares[i].stream` é `null` até a primeira faixa chegar; a UI mostra "Conectando…" nesse estado e não monta `<video>`.
- **Audiência** (`ShareAudience`, `src/room/shareAudience.ts`): quem enviou `watch-started` à live local e ainda não parou. `PeerManager.shouldSendTo` consulta esse conjunto, então uma conexão só recebe as faixas locais se o par está na audiência (inclusive conexões criadas por ofertas recebidas).
- **Assistindo** (`watchingRef`): alimentado por `setWatchingShare`. Usado para reenviar `watch-started` após reconexão e para decidir se a conexão com um par ainda tem mídia útil.

Quem não assiste ninguém não mantém `RTCPeerConnection`. Recuperação: se nenhuma faixa chega 10 s depois de `watch-started`, o pedido é reenviado uma vez (`nextWatchAction`, `src/lib/watch.ts`); após 20 s o erro "A live não chegou. Tente assistir de novo." é exibido.

Eventos de diagnóstico: `audience-change` (`count`, sem ids) e `audience-offer-failed`.

> **Compatibilidade.** Não há detecção de versão do par. Um cliente antigo continua oferecendo a todos, e nunca vê lives de um transmissor novo (a lista dele dependia de receber stream). Ao publicar esta mudança, suba `MIN_APP_VERSION`.

**Presets de qualidade** (`ScreenSharePicker`):

| Preset | Resolução máx. | FPS | Bitrate máx. de vídeo |
| --- | --- | --- | --- |
| Padrão (índice 0) | 1920×1080 | 60 | 10 Mbps |
| 2K | 2560×1440 | 60 | 16 Mbps |
| Leve | 1280×720 | 30 | 4 Mbps |

Áudio: bitrate máximo de 320 kbps. `contentHint = "motion"` nas faixas de vídeo. Preferência de codec: H.264 se a GPU for detectada (`gpu_encode_info`) e a opção estiver ligada; caso contrário VP8.

## `PeerManager`

Uma `RTCPeerConnection` por participante remoto, criada sob demanda (`ensure`).

- **Negociação ("perfect negotiation")**: `polite = localId.localeCompare(peerId) > 0`. Em colisão de ofertas, o lado "impolite" ignora a oferta recebida; o "polite" faz `rollback` e aceita.
- **Candidatos ICE** que chegam antes da descrição remota ficam em `pendingIce` e são aplicados em `flushIce`.
- **Falha de conexão** (`connectionState === "failed"`): uma vez por peer, `recover()` renova os `iceServers` (`GET /rooms/:code/ice-servers`); se houver TURN configurado, força `iceTransportPolicy: "relay"` e faz uma `offer` com `iceRestart`.
- **Vigilância de mídia** (`collectHealth` a cada 2 s → `evaluateMedia`): se existe vídeo remoto mas nenhum frame decodificado após **8 s**:
  - com bytes recebidos → falha de codec: força VP8 e renegocia (`recovering-codec`);
  - sem bytes → falha de rede: renegocia com `iceRestart` (`recovering-network`);
  - se ainda não chegar nada em mais 8 s → `stalled-codec` / `stalled-network`.
  - Ao receber frames volta para `receiving`. Os estados viram mensagens de erro em `useTelinhaRoom`.
- **Envio por par**: a opção `shouldSendTo(peerId)` decide se `syncLocalTracks` adiciona as faixas locais a uma conexão. `stopSending(peerId)` remove as faixas daquela conexão e renegocia (se o peer não está em `stable`, a renegociação espera a resposta). `offer` e `stopSending` do mesmo peer rodam em série. `peerIds()` lista as conexões abertas. Quem decide fechar a conexão é o hook (`reconcilePeer`): sem o par na audiência e sem assisti-lo, fecha; se ainda o assiste, só chama `stopSending`.
- `retryAll()` (botão "tentar novamente") reinicia ICE em todos os peers.
- `applyBitrate` define `maxBitrate`, `degradationPreference: "maintain-framerate"` e prioridade alta no vídeo.

`PeerHealthSample` carrega RTT, perda de pacotes, bitrate, codec, contagem de candidatos por tipo (host/srflx/relay) e tipo do par escolhido.

### Qualidade de conexão

`classifyConnectionQuality(state, samples)`:

| Resultado | Condição (avaliadas nesta ordem) |
| --- | --- |
| `reconnecting` | WebSocket conectando/reconectando, ou algum peer `new`/`connecting` |
| `offline` | WebSocket desconectado, ou algum peer `disconnected`/`failed`/`closed` |
| `unstable` | Algum peer com perda > 5% ou RTT > 400 ms |
| `good` | Demais casos |

## ICE no cliente (`lib/ice.ts`)

`buildIceServers(env, sessionServers)`:

- Com `VITE_TURN_URL`: STUN públicos + esse TURN (usuário/credencial das variáveis `VITE_TURN_*`). **Os servidores da sessão são ignorados.**
- Sem ela: STUN públicos + os `iceServers` devolvidos pelo servidor.
- `iceCandidatePoolSize: 4`.

## Armazenamento local (`localStorage`)

| Chave | Conteúdo |
| --- | --- |
| `telinha-display-name` | Nome do usuário (máx. 24 caracteres ao aceitar convite) |
| `telinha-active-session-v2` | `{ savedAt, session }`; válido por 20 min |
| `telinha-pending-leaves-v2` | Sessões cuja saída ainda precisa ser enviada (máx. 8) |
| `telinha-share-quality` | Índice do preset de qualidade |
| `telinha-share-audio` | `"0"` desliga o áudio do sistema |
| `telinha-share-gpu` | `"0"` desliga a preferência por H.264/GPU |
| `telinha-watch-volume`, `telinha-watch-fullscreen` | Volume e modo de visualização |
| `telinha-room-sounds` | `"0"` desliga os avisos sonoros da sala |

Mudar o formato de uma chave de sessão exige subir o sufixo (`-v2` → `-v3`) para não ler dados antigos.

## Diagnóstico

`recordDiagnostic(evento, detalhes)` guarda até 100 eventos em memória. Chaves cujo nome é `token`, `sdp`, `candidate`, `code`, `name`, `url`, `ip` ou `address` são **removidas**, e strings são cortadas em 240 caracteres. `buildDiagnostics()` devolve o JSON (com versões do app e do protocolo) copiado pelo botão de diagnóstico. Ao registrar novos eventos, nunca coloque dados de rede ou identidade em chaves fora dessa lista sem sanitizar.

## Fluxo de atualização

No arranque, `App` busca `/app-config` e consulta o updater em paralelo; `decideUpdate({current, minimum, available})` retorna:

- `required: true` se a versão atual é menor que `minAppVersion` (o diálogo não pode ser adiado);
- `required: false` se há versão nova publicada;
- `null` caso contrário.

`installAvailableUpdate` baixa, instala e chama `relaunch()`.

## Deep links e instância única

URLs `telinha://join?code=ABC123&name=Ana` (ou `telinha://join/ABC123`) abrem o convite; `telinha://share` abre o seletor de transmissão quando já há sala. O Rust emite o evento `telinha-open-url` (inclusive ao reabrir o app já rodando). Veja [desktop.md](desktop.md).

## Variáveis `VITE_*`

Consulte [operations.md](operations.md#variáveis-de-ambiente). Em `vite.config.ts`, um build de **produção** falha se `VITE_API_URL` estiver vazia ou apontar para localhost, a menos que `VITE_ALLOW_LOCAL_API=1`.

## Modo E2E

Com `VITE_E2E_MEDIA=1` **e** `import.meta.env.DEV`, o app troca `getDisplayMedia` por um `canvas.captureStream` sintético e usa `iceServers: []` (só candidatos locais). Nunca depende de tela real, o que torna o fluxo testável no CI.
