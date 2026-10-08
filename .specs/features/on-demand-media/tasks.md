# On-Demand Media Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user — do not proceed without it.**

---

**Design**: `.specs/features/on-demand-media/design.md`
**Spec**: `.specs/features/on-demand-media/spec.md`
**Status**: Draft

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec — confirm before Execute. Guidelines found: `README.md` (seção "Contribuindo": testes quando há mudança de lógica, rodar os comandos de qualidade), `docs/development.md`, `.github/workflows/ci.yml` (lint, test, build, e2e), `vite.config.ts` (`test.include: src/**/*.test.ts`). Não há `AGENTS.md`/`CLAUDE.md`/`CONTRIBUTING.md`.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Módulos puros (`src/room/shareAudience.ts`, `src/room/screenShares.ts`, `src/lib/watch.ts`) | unit | Todos os ramos; 1:1 com os ACs e edge cases listados | `src/**/*.test.ts` (ao lado do código) | `npm test` |
| `PeerManager` (`src/room/peerManager.ts`) | unit (com `MockPeerConnection`) | Todos os ramos novos; ACs ONDEM-04, 11, 14 e colisão de ofertas | `src/room/peerManager.test.ts` | `npm test` |
| Hook `useTelinhaRoom`, `RoomScreen`, `VideoTile` | e2e | Fluxos de ONDEM-01/02/07–13/15/16/18 ponta a ponta; lógica decisória extraída para módulos puros (a repo não tem infra de teste de hooks/DOM) | `e2e/*.spec.ts` | `npm run test:e2e` |
| Docs | none | build gate | — | `npm run build` |

## Parallelism Assessment

> Generated from codebase — confirm before Execute.

| Test Type | Parallel-Safe? | Isolation Model | Evidence |
| --- | --- | --- | --- |
| unit (Vitest) | Yes | Dependências mockadas; sem estado global compartilhado | `src/room/peerManager.test.ts` usa `MockPeerConnection`; `vite.config.ts` ambiente `node` |
| e2e (Playwright) | No | Portas fixas 3001/1420, servidores compartilhados, contextos criados por teste | `playwright.config.ts` (`fullyParallel: false`), `scripts/run-e2e.mjs` |

## Gate Check Commands

> Generated from codebase — confirm before Execute.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | Tasks só com unit tests | `npm test` |
| Full | Tasks com e2e | `npm run lint && npm test && npm run test:e2e` |
| Build | Fim de fase, tasks só de docs/tipos | `npm run lint && npm test && npm run build && npm run test:e2e` |

> Pré-requisito do e2e: Google Chrome instalado (`channel: "chrome"`) e `npm ci --prefix server` feito (o script compila o servidor).

---

## Execution Plan

### Phase 1: Foundations (módulos puros e PeerManager, ordem livre)

```
T1 [P]  ShareAudience
T2 [P]  PeerManager: shouldSendTo + peerIds
T3 [P]  buildScreenShares (puro)
T4 [P]  nextWatchAction (puro)
```

### Phase 2: Lista de lives independente de mídia, depois troca do envio

```
T3 → T5 → T6
T1 ──────→ T6
T2 ──────→ T6
```

### Phase 3: Parar de enviar

```
T2 → T7 → T8 → T9
T6 ───────────→ T9
```

### Phase 4: Resiliência

```
T6 → T10 → T11
T4 ───────→ T11
```

### Phase 5: Verificação ponta a ponta e docs

```
T9, T10, T11 → T12 → T13
```

---

## Task Breakdown

### T1: Criar `ShareAudience` [P]

**What**: Classe pura com a audiência da live local (`add`, `remove`, `has`, `ids`, `names`, `clear`, `size`).
**Where**: `src/room/shareAudience.ts` + `src/room/shareAudience.test.ts`
**Depends on**: None
**Reuses**: Forma `Map<string, string>` de `watchersRef` em `useTelinhaRoom.ts`
**Requirement**: ONDEM-05 (idempotência), ONDEM-11 (remoção), ONDEM-12 (clear)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `add` devolve `"added"` na primeira vez e `"updated"` ao repetir o mesmo id (atualiza o nome, não duplica)
- [ ] `remove` devolve `true`/`false` conforme o id existia; `has`, `ids`, `names`, `size` consistentes após cada operação
- [ ] `clear` esvazia e `size` volta a 0
- [ ] Testes cobrem todos os ramos acima (1:1 com ONDEM-05/11/12)
- [ ] Gate check passes: `npm test`
- [ ] Test count: `npm test` mostra os novos testes e nenhum teste existente removido

**Tests**: unit
**Gate**: quick
**Commit**: `feat(room): add ShareAudience to track current viewers of the local share`

---

### T2: `PeerManager`: gating por peer e `peerIds()` [P]

**What**: Nova opção `shouldSendTo(peerId)`; `syncLocalTracks` só adiciona faixas locais quando verdadeira (inclusive em conexões criadas por oferta recebida); novo `peerIds()`.
**Where**: `src/room/peerManager.ts` (modify) + `src/room/peerManager.test.ts`
**Depends on**: None
**Reuses**: `ensure`, `handleDescription`, `syncLocalTracks`, `MockPeerConnection`
**Requirement**: ONDEM-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `syncLocalTracks(peerId, …)` não adiciona faixas quando `shouldSendTo(peerId)` é falso e adiciona quando é verdadeiro
- [ ] Conexão criada por `handleDescription(peer, "offer", …)` de um peer fora da audiência **não** recebe faixas locais (teste cobre `ensure` e `handleDescription`)
- [ ] `offer(peerId)` com `shouldSendTo` falso não adiciona senders
- [ ] `peerIds()` lista os peers abertos e some o peer depois de `close`
- [ ] Opção nova obrigatória aplicada a todos os `new PeerManager(...)` existentes (testes e hook, este com `() => true` provisório para não mudar o comportamento até T6)
- [ ] Gate check passes: `npm test`
- [ ] Test count: testes existentes de `PeerManager` seguem passando (sem remoções)

**Tests**: unit
**Gate**: quick
**Commit**: `feat(peer): gate local tracks per peer with shouldSendTo`

---

### T3: `buildScreenShares` puro [P]

**What**: Função pura que monta `ScreenShareInfo[]` a partir de pessoas, streams remotas e stream local, com `stream` nulável.
**Where**: `src/room/screenShares.ts` + `src/room/screenShares.test.ts`
**Depends on**: None
**Reuses**: Lógica de `publishShares` (`src/hooks/useTelinhaRoom.ts:128`) e o tipo `RoomPerson`
**Requirement**: ONDEM-07, ONDEM-10

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Remoto com `isSharing = true` e sem stream → entrada com `stream: null` (ONDEM-07)
- [ ] Remoto com `isSharing = true` e stream → entrada com a stream
- [ ] Remoto com `isSharing = false` e stream residual → **sem** entrada (ONDEM-10)
- [ ] Pessoa ausente de `people` com stream residual → sem entrada
- [ ] Remoto desconectado (`connected = false`) mas `isSharing = true` → entrada com `stream: null` (ONDEM-10, queda)
- [ ] Entrada local só se `localSharing && localStream`
- [ ] Ordem estável: local primeiro, depois remotos na ordem de `people`
- [ ] Gate check passes: `npm test`
- [ ] Test count: novos testes presentes, nenhum removido

**Tests**: unit
**Gate**: quick
**Commit**: `feat(room): derive screen shares from participants with nullable streams`

---

### T4: `nextWatchAction` puro [P]

**What**: Função pura que decide `idle | wait | resend | fail` para um transmissor assistido sem stream.
**Where**: `src/lib/watch.ts` (modify) + `src/lib/watch.test.ts`
**Depends on**: None
**Reuses**: Arquivo e testes existentes de `watch.ts`
**Requirement**: ONDEM-18

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `hasStream = true` → `"idle"` em qualquer tempo
- [ ] `elapsedMs < 10_000` → `"wait"`
- [ ] `elapsedMs >= 10_000`, `resent = false` → `"resend"`
- [ ] `resent = true` e `elapsedMs < 20_000` → `"wait"`; `elapsedMs >= 20_000` → `"fail"` (limites exatos testados: 9_999, 10_000, 19_999, 20_000)
- [ ] Constantes `WATCH_RESEND_MS = 10_000` e `WATCH_FAIL_MS = 20_000` exportadas
- [ ] Gate check passes: `npm test`
- [ ] Test count: testes existentes de `watch` seguem passando

**Tests**: unit
**Gate**: quick
**Commit**: `feat(watch): add nextWatchAction for stalled watch requests`

---

### T5: Lista de lives vem de `participants`; UI tolera `stream` nulo

**What**: `ScreenShareInfo.stream` vira `MediaStream | null`; o hook passa a usar `buildScreenShares`; `VideoTile`/`RoomScreen` mostram "Conectando…" quando `stream` é nulo. **Comportamento de envio inalterado** (ainda eager).
**Where**: `src/hooks/useTelinhaRoom.ts`, `src/components/VideoTile.tsx`, `src/screens/RoomScreen.tsx` (modify)
**Depends on**: T3
**Reuses**: `buildScreenShares` (T3), classes CSS de `.watch-pane`
**Requirement**: ONDEM-07, ONDEM-08, ONDEM-09, ONDEM-10

> ⚠️ Toca 3 arquivos: a mudança de tipo quebra a compilação nos três ao mesmo tempo; dividir deixaria o build vermelho entre commits (merge backward, conforme a regra de dependência de compilação).

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `publishShares` chama `buildScreenShares` com `peopleRef`, `remoteStreamsRef`, `localStreamRef`, `sharingRef`
- [ ] `RoomScreen` filtra `remoteShares` sem assumir `stream` presente; `watchingShares` com `stream === null` renderiza o placeholder (texto "Conectando…") e **não** um `<video>`
- [ ] Toasts de live/encerrada e `pruneWatching` continuam funcionando com a lista derivada de `participants`
- [ ] `npm run build` sem erros de tipo
- [ ] Gate check passes: `npm run lint && npm test && npm run test:e2e` (o E2E existente, `room-flow.spec.ts`, passa **sem alterar** suas expectativas)
- [ ] Test count: suíte unit e E2E sem testes removidos ou enfraquecidos

**Tests**: e2e (regressão do fluxo existente; a lógica de derivação está coberta por T3)
**Gate**: full
**Commit**: `refactor(room): list lives from participants instead of received streams`

---

### T6: Hook: oferecer só à audiência

**What**: Trocar `offerToEveryone` por envio sob demanda: `watch-started` → `ShareAudience.add` → `offer`; `hello`, `participant-joined` e `participant-presence` só reoferecem a quem está na audiência; `shouldSendTo` passa a consultar a audiência; `recordDiagnostic("audience-change", { count })`.
**Where**: `src/hooks/useTelinhaRoom.ts` (modify) + `e2e/room-flow.spec.ts` (ajuste se necessário, mantendo as expectativas)
**Depends on**: T1, T2, T5
**Reuses**: `ShareAudience`, `shouldSendTo` (T2), `offerTo`, `publishWatchers`, `recordDiagnostic`
**Requirement**: ONDEM-01, 02, 03, 05, 06, 16, 19, 20

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `startShare` não chama oferta a ninguém (ONDEM-01)
- [ ] `watch-started` com `to === localId`, transmitindo e `from` conhecido/conectado → `offerTo(from)` (ONDEM-02); repetido com conexão viva → sem nova oferta (ONDEM-05); sem transmitir ou `from` desconhecido → ignorado (ONDEM-06)
- [ ] `participant-joined`, `participant-presence` (conectado) e `hello` não oferecem a quem não está na audiência (ONDEM-03); `hello` reoferece só a membros conectados (ONDEM-16)
- [ ] `watchersRef` substituído por `ShareAudience`; `watcherCounts`/`watcherNames` publicados com a mesma forma (`[localId]`)
- [ ] `audience-change` registrado com `count` e sem ids/nomes (ONDEM-19)
- [ ] `git diff` não toca `server/` nem `PROTOCOL_VERSION` (ONDEM-20)
- [ ] Gate check passes: `npm run lint && npm test && npm run test:e2e`; o E2E `room-flow.spec.ts` continua verde com as mesmas expectativas (lista de lives visível, vídeo toca ao assistir, grade, sair e voltar)
- [ ] Test count: nenhum teste removido

**Tests**: e2e
**Gate**: full
**Commit**: `feat(room): send media only to participants who ask to watch`

---

### T7: `PeerManager.stopSending` com serialização por peer

**What**: `stopSending(peerId)` remove as faixas locais **daquela** conexão e renegocia; `offer` e `stopSending` do mesmo peer executam em série.
**Where**: `src/room/peerManager.ts` (modify) + `src/room/peerManager.test.ts`
**Depends on**: T2
**Reuses**: `removeLocalTracks` (versão por peer), `offer`, cadeia de promises por entrada
**Requirement**: ONDEM-11, ONDEM-14

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Depois de `stopSending(p)`, a conexão de `p` não tem senders com faixa e uma nova oferta foi enviada
- [ ] Peers diferentes de `p` não são afetados
- [ ] `offer(p)` seguido imediatamente de `stopSending(p)` termina sem faixas enviadas (ordem preservada; teste usa `createOffer` com atraso controlado)
- [ ] `stopSending` em colisão de ofertas (peer impolite com `makingOffer`) não lança e não deixa o peer em `have-local-offer` indefinido
- [ ] `stopSending` de peer inexistente é no-op sem erro
- [ ] `MockPeerConnection.removeTrack` atualizado para remover o sender
- [ ] Gate check passes: `npm test`
- [ ] Test count: testes existentes seguem passando

**Tests**: unit
**Gate**: quick
**Commit**: `feat(peer): stop sending local tracks to a single peer`

---

### T8: `PeerManager.closeIfIdle`

**What**: Fecha a conexão do peer quando não há faixa enviada nem faixa remota ativa; devolve se fechou.
**Where**: `src/room/peerManager.ts` (modify) + `src/room/peerManager.test.ts`
**Depends on**: T7
**Reuses**: `close`, `getSenders`, `getReceivers`
**Requirement**: ONDEM-11, ONDEM-13, edge case do par bidirecional

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Sem senders com faixa e sem receivers com faixa `live` → fecha e retorna `true`; `peerIds()` não inclui o peer
- [ ] Com sender ativo **ou** receiver `live` → mantém e retorna `false`
- [ ] Peer inexistente → `false` sem erro
- [ ] Gate check passes: `npm test`
- [ ] Test count: testes existentes seguem passando

**Tests**: unit
**Gate**: quick
**Commit**: `feat(peer): close connections that carry no media in either direction`

---

### T9: Hook: caminhos de parada

**What**: `watch-stopped`, espectador que cai/sai, `stopShare` e "parar de assistir" liberam o envio: `audience.remove` → `stopSending` → `closeIfIdle`; `share-stopped`/`participant-left` de transmissor remoto também usam `closeIfIdle` em vez de `closePeer` incondicional.
**Where**: `src/hooks/useTelinhaRoom.ts` (modify) + `e2e/` (asserções adicionadas em T12)
**Depends on**: T6, T8
**Reuses**: `ShareAudience.remove/clear`, `stopSending`, `closeIfIdle`
**Requirement**: ONDEM-11, ONDEM-12, ONDEM-13, ONDEM-14

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `watch-stopped` de `V` → `audience.remove(V)`, `stopSending(V)`, `closeIfIdle(V)` (ONDEM-11)
- [ ] `participant-presence` desconectado e `participant-left` de um espectador → mesmo tratamento, sem erro se o peer já não existe
- [ ] `stopShare` → `audience.clear()`, `stopSending` e `closeIfIdle` em cada peer (ONDEM-12)
- [ ] Parar de assistir `S` (`setWatchingShare(S, false)`) → `closeIfIdle(S)` quando `S` não está na audiência (ONDEM-13)
- [ ] Par bidirecional: parar de enviar a `B` não fecha a conexão enquanto `B` ainda transmite para o usuário
- [ ] Gate check passes: `npm run lint && npm test && npm run test:e2e` (suíte existente verde)
- [ ] Test count: nenhum teste removido

**Tests**: e2e (regressão; asserção específica em T12)
**Gate**: full
**Commit**: `feat(room): release media when viewers stop watching or the share ends`

> ⚠️ A cobertura ponta a ponta de ONDEM-11/12/13 (0 peers depois de parar) é adicionada em T12, que é a primeira task com o debug hook. As regras de decisão estão cobertas por unit em T1, T7 e T8.

---

### T10: Hook: reenviar `watch-started` após reconexão

**What**: Manter `watchingRef` em `setWatchingShare` e reenviar `watch-started` em `hello` (para quem ainda transmite) e em `participant-presence` conectado do transmissor assistido.
**Where**: `src/hooks/useTelinhaRoom.ts` (modify)
**Depends on**: T6
**Reuses**: `sendSignal`, `peopleRef`
**Requirement**: ONDEM-15, ONDEM-17

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `setWatchingShare(id, true/false)` mantém `watchingRef`
- [ ] Em `hello`, para cada id de `watchingRef` ainda com `isSharing = true` → `watch-started` (ONDEM-15); ids que pararam de transmitir são removidos de `watchingRef`
- [ ] Em `participant-presence` conectado de um id de `watchingRef` → `watch-started` (ONDEM-17)
- [ ] Gate check passes: `npm run lint && npm test && npm run test:e2e`
- [ ] Test count: nenhum teste removido

**Tests**: e2e (regressão; reconexão verificada em T12)
**Gate**: full
**Commit**: `feat(room): re-request watched shares after reconnecting`

---

### T11: Hook: reenvio e falha de "sem stream"

**What**: Para cada transmissor assistido sem stream, aplicar `nextWatchAction`: reenviar `watch-started` uma vez após 10 s e, após 20 s, exibir "A live não chegou. Tente assistir de novo.".
**Where**: `src/hooks/useTelinhaRoom.ts` (modify)
**Depends on**: T4, T10
**Reuses**: `nextWatchAction` (T4), estado `error`, `recordDiagnostic`
**Requirement**: ONDEM-18

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Temporizador por transmissor assistido sem stream consulta `nextWatchAction` periodicamente (1 s) e para quando a stream chega ou o usuário para de assistir
- [ ] `"resend"` → um único `watch-started`; `"fail"` → `setError` com a mensagem e nenhum reenvio adicional
- [ ] Mensagem de erro é limpa quando a stream chega (padrão já usado para `P2P_BLOCKED_MESSAGE`)
- [ ] Temporizadores limpos no cleanup do efeito principal (sem vazamento ao trocar de sessão)
- [ ] Gate check passes: `npm run lint && npm test && npm run test:e2e`
- [ ] Test count: nenhum teste removido

**Tests**: e2e (regressão; a decisão temporal está coberta por unit em T4)
**Gate**: full
**Commit**: `feat(room): retry watch requests that receive no media`

---

### T12: E2E de audiência sob demanda (com hook de debug dev-only)

**What**: Expor `window.__telinhaDebug.peerIds()` só quando `import.meta.env.DEV && VITE_E2E_MEDIA === "1"` e adicionar um spec Playwright que prova o envio sob demanda.
**Where**: `src/hooks/useTelinhaRoom.ts` (modify, bloco guardado) + `e2e/on-demand-media.spec.ts` (novo)
**Depends on**: T9, T10, T11
**Reuses**: helpers de `e2e/room-flow.spec.ts` (`enterName`, `startSyntheticShare`, `watchAndAssertFrames`)
**Requirement**: ONDEM-01, 02, 07, 08, 09, 11, 12, 13, 15, 18 (ponta a ponta)

> ⚠️ O hook de debug só existe para ser assertado; ficam na mesma task para não haver código sem verificação.

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Ana transmite, Bia assiste, Caio não: `peerIds()` de Caio é `[]`, de Bia e de Ana tem 1 id (ONDEM-01/02/07)
- [ ] Caio vê a live de Ana na lista sem mídia; ao clicar, vê o estado "Conectando…" e depois o vídeo tocando (`currentTime > 0`) (ONDEM-08/09)
- [ ] Caio para de assistir: `peerIds()` de Caio e de Ana voltam a 1 (só Bia) (ONDEM-11/13)
- [ ] Ana para de transmitir: `peerIds()` de todos fica `[]` (ONDEM-12)
- [ ] Derrubar a rede de Bia (`context.setOffline(true)` e depois `false`) → o vídeo volta sem clique (ONDEM-15)
- [ ] Em build de produção (`npm run build`) `window.__telinhaDebug` não existe (verificado por busca no bundle em `dist/`: a string `__telinhaDebug` ausente)
- [ ] Gate check passes: `npm run lint && npm test && npm run build && npm run test:e2e`
- [ ] Test count: spec novo presente; `room-flow.spec.ts` intacto

**Tests**: e2e
**Gate**: build
**Commit**: `test(e2e): verify media is sent only to active viewers`

---

### T13: Atualizar a documentação

**What**: Descrever o novo modelo em `docs/client.md` (hook, `PeerManager`, `ShareAudience`), `docs/architecture.md` (diagrama e nota sobre mesh sob demanda) e `docs/signaling-protocol.md` (semântica de `watch-*`).
**Where**: `docs/client.md`, `docs/architecture.md`, `docs/signaling-protocol.md` (modify)
**Depends on**: T12
**Reuses**: Seções existentes; diagramas Mermaid do `design.md`
**Requirement**: ONDEM-20 (nota de compatibilidade)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `client.md`: tabela de mensagens do servidor e seção de transmissão refletem "oferta sob demanda"; menciona `shouldSendTo`, `stopSending`, `closeIfIdle` e o estado "conectando"
- [ ] `architecture.md`: decisão "mesh P2P" cita que o envio é só para quem assiste
- [ ] `signaling-protocol.md`: `watch-started` passa a ser descrito como **gatilho** da oferta; nota de compatibilidade (clientes antigos × novos) e recomendação de subir `MIN_APP_VERSION`
- [ ] Gate check passes: `npm run build`

**Tests**: none
**Gate**: build
**Commit**: `docs: describe on-demand media negotiation`

---

## Parallel Execution Map

```
Phase 1:  T1 [P]   T2 [P]   T3 [P]   T4 [P]
            │        │        │        │
Phase 2:    │        │        └→ T5    │
            └────────┴────────→ T6    │
Phase 3:             └→ T7 → T8 → T9 (T6)
Phase 4:                 T6 → T10 → T11 (T4)
Phase 5:       T9, T10, T11 → T12 → T13
```

---

## Diagram-Definition Cross-Check

| Task | Depends On (body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T1 | None | — | ✅ Match |
| T2 | None | — | ✅ Match |
| T3 | None | — | ✅ Match |
| T4 | None | — | ✅ Match |
| T5 | T3 | T3 → T5 | ✅ Match |
| T6 | T1, T2, T5 | T1, T2, T5 → T6 | ✅ Match |
| T7 | T2 | T2 → T7 | ✅ Match |
| T8 | T7 | T7 → T8 | ✅ Match |
| T9 | T6, T8 | T8 → T9, T6 → T9 | ✅ Match |
| T10 | T6 | T6 → T10 | ✅ Match |
| T11 | T4, T10 | T10 → T11, T4 → T11 | ✅ Match |
| T12 | T9, T10, T11 | T9, T10, T11 → T12 | ✅ Match |
| T13 | T12 | T12 → T13 | ✅ Match |

`[P]` só em T1–T4, que não dependem entre si. Tasks com e2e (T5, T6, T9–T12) são sequenciais por a Parallelism Assessment marcar e2e como não paralelo-seguro.

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1 | Módulo puro | unit | unit | ✅ OK |
| T2 | `PeerManager` | unit | unit | ✅ OK |
| T3 | Módulo puro | unit | unit | ✅ OK |
| T4 | Módulo puro (`lib/watch.ts`) | unit | unit | ✅ OK |
| T5 | Hook + UI | e2e | e2e (regressão; lógica coberta por T3) | ✅ OK |
| T6 | Hook | e2e | e2e | ✅ OK |
| T7 | `PeerManager` | unit | unit | ✅ OK |
| T8 | `PeerManager` | unit | unit | ✅ OK |
| T9 | Hook | e2e | e2e (regressão; asserção específica em T12; decisão em T1/T7/T8) | ✅ OK |
| T10 | Hook | e2e | e2e (regressão; asserção específica em T12) | ✅ OK |
| T11 | Hook | e2e | e2e (regressão; decisão temporal em T4) | ✅ OK |
| T12 | Hook (debug) + e2e | e2e | e2e | ✅ OK |
| T13 | Docs | none | none | ✅ OK |

> Nota: T9–T11 mudam o hook e só ganham asserção ponta a ponta específica em T12, porque o repo não tem como testar o hook isoladamente (sem infra de DOM/React). Para não deferir testes, a **decisão** de cada uma já está coberta por unit em T1/T4/T7/T8, e T9–T11 exigem o E2E existente verde. Se o Verifier considerar isso insuficiente, a alternativa é incluir em T9 e T10 um passo de E2E mínimo e mover o debug hook de T12 para T6.

## Requirement Coverage

| Requirement | Tasks |
| --- | --- |
| ONDEM-01, 02, 03, 05, 06 | T1, T6, T12 |
| ONDEM-04 | T2 |
| ONDEM-07, 08, 09, 10 | T3, T5, T12 |
| ONDEM-11, 12, 13, 14 | T1, T7, T8, T9, T12 |
| ONDEM-15, 16, 17 | T6, T10, T12 |
| ONDEM-18 | T4, T11, T12 |
| ONDEM-19 | T6 |
| ONDEM-20 | T6, T13 |

**Coverage:** 20 total, 20 mapped to tasks, 0 unmapped.
