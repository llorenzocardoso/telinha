# On-Demand Media (negociar mídia só com quem assiste) Specification

## Problem Statement

Hoje, ao iniciar uma live, `useTelinhaRoom` faz `offerToEveryone`: abre uma `RTCPeerConnection` com **todo** participante conectado e envia vídeo e áudio a todos, mesmo a quem nunca clicou em assistir. As mensagens `watch-started` / `watch-stopped` são só notificações. Numa sala de 5 pessoas com 3 lives, são 12 fluxos de saída permanentes (até ~40 Mbps de upload por transmissor no preset Padrão), e cada pessoa recebe as 3 lives. O upload do transmissor deveria crescer com o número de **espectadores**, não com o tamanho da sala.

## Goals

- [ ] Um transmissor só envia mídia a quem pediu para assistir (`watch-started` recebido): fluxos de vídeo = nº de pares (espectador, transmissor).
- [ ] Quem não assiste ninguém não mantém nenhuma `RTCPeerConnection` aberta (0 peers).
- [ ] A lista de lives disponíveis continua aparecendo para todos, sem depender de receber mídia.
- [ ] Sem mudança no servidor, na infraestrutura nem em `PROTOCOL_VERSION`.

## Out of Scope

| Feature | Reason |
| --- | --- |
| SFU / mudança de infraestrutura | Contribuidor sem acesso à infra; decisão do mantenedor |
| Aviso de upload estimado ao transmissor | Melhoria independente (item 2 do plano) |
| Bitrate adaptativo ao nº de espectadores | Melhoria independente (item 3) |
| Limite configurável de espectadores | Melhoria independente (item 4) |
| Mudanças em `server/` ou em mensagens do protocolo | Os `watch-*` já existem e já são entregues só ao transmissor alvo |
| Detecção de versão do par para compatibilidade | Exigiria protocolo novo (ver Assumptions) |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Quem inicia a negociação | O **transmissor** faz a `offer`, ao receber `watch-started` do espectador | Mantém o fluxo atual (transmissor oferece) e o perfect negotiation inalterado | n |
| Compatibilidade com clientes antigos | **Não mantida**: um espectador antigo nunca vê lives de transmissor novo (sua lista depende de receber stream), e um transmissor antigo continua mandando para todos | Distinguir versões exigiria campo novo no protocolo. O mantenedor deve subir `MIN_APP_VERSION` ao publicar esta mudança | n |
| Tempo para considerar "sem stream" após `watch-started` | 10 s, com **um** reenvio de `watch-started`; após outros 10 s, mostrar erro | Cobre mensagem perdida/transmissor reconectando sem laço infinito | n |
| Parada de envio ao espectador | `removeTrack` + renegociação (não `replaceTrack(null)`) | Libera o m-line e permite fechar a conexão ociosa | n |
| Conexão bidirecional (A e B transmitem e se assistem) | Um único `RTCPeerConnection` por par, que só é fechado quando **nenhuma** direção está ativa | É o modelo atual do `PeerManager` | n |
| Observabilidade | Eventos de diagnóstico `audience-change` com `count`, sem ids | `sanitizeDiagnosticDetails` já proíbe chaves sensíveis; ids são desnecessários | n |
| Autenticação/limites | N/A | O servidor define `from` e entrega `watch-*` só ao transmissor alvo; nada novo no servidor | y |
| Dependência externa | N/A | Nenhuma chamada externa nova | y |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: Transmissor envia só a quem assiste ⭐ MVP

**User Story**: Como transmissor, quero que minha live seja enviada apenas a quem está assistindo, para que meu upload cresça com o público e não com o tamanho da sala.

**Why P1**: É o ganho central; sem isso nada muda.

**Acceptance Criteria**:

1. ONDEM-01: WHEN o usuário inicia uma live THEN o sistema SHALL NOT enviar nenhuma `offer` nem criar `RTCPeerConnection` para outros participantes até receber um `watch-started` endereçado a ele.
2. ONDEM-02: WHEN chega `watch-started` com `from = V` e `to = local` E o usuário está transmitindo E `V` é um participante conectado conhecido THEN o sistema SHALL enviar uma `offer` a `V` contendo as faixas locais.
3. ONDEM-03: WHEN um participante entra (`participant-joined`) ou volta (`participant-presence` conectado) THEN o sistema SHALL NOT enviar `offer` a ele, salvo se ele já estiver na audiência do usuário.
4. ONDEM-04: WHEN uma `RTCPeerConnection` é criada ou recebe uma oferta de um peer `P` que **não** está na audiência do usuário THEN o sistema SHALL NOT adicionar as faixas locais a essa conexão (vale também para conexões criadas por ofertas recebidas).
5. ONDEM-05: WHEN chega `watch-started` de `V` que já está na audiência E a conexão com `V` existe e não está `closed`/`failed` THEN o sistema SHALL NOT enviar nova `offer` (idempotente), apenas atualizar o nome exibido.
6. ONDEM-06: WHEN chega `watch-started` e o usuário NÃO está transmitindo, ou `V` não é participante conhecido/conectado THEN o sistema SHALL ignorá-lo sem erro e sem alterar a audiência.

**Independent Test**: Sala com A (transmite), B (assiste) e C (não assiste). Em C, `peerIds()` é vazio; em B tem 1 par com A; em A, 1 par com B.

---

### P1: Lives visíveis sem receber mídia ⭐ MVP

**User Story**: Como espectador potencial, quero ver quem está ao vivo e escolher assistir, sem que a mídia seja enviada antes da minha escolha.

**Why P1**: Hoje a lista de lives é derivada das streams recebidas; sem trocar a fonte, ninguém veria lives quando o envio deixar de ser automático.

**Acceptance Criteria**:

1. ONDEM-07: WHEN um participante remoto está transmitindo (`sharing = true` vindo de `hello`, `participant-joined` ou `share-started`) THEN `screenShares` SHALL conter uma entrada para ele com `stream = null` até a primeira faixa chegar, e a lista de lives da UI SHALL exibi-lo.
2. ONDEM-08: WHEN o usuário escolhe assistir a `S` THEN o sistema SHALL enviar `watch-started` uma vez a `S` e a UI SHALL exibir um estado "conectando" enquanto `stream` for `null`.
3. ONDEM-09: WHEN a primeira faixa de `S` chega THEN a UI SHALL passar a exibir o vídeo no lugar do estado "conectando".
4. ONDEM-10: WHEN `S` para de transmitir (`share-stopped`) ou sai (`participant-left`) THEN o sistema SHALL remover `S` de `screenShares` e da seleção de "assistindo". WHEN `S` cai (`participant-presence` com `connected = false`) THEN o sistema SHALL descartar a stream e fechar a conexão com `S`, mas SHALL manter `S` em `screenShares` com `stream = null` (ainda consta como transmitindo no servidor), voltando a aparecer como "conectando" até ONDEM-17.

**Independent Test**: B vê "Ana" na lista de lives com a live aberta e `peerIds()` de B vazio; ao clicar, o vídeo toca.

---

### P1: Parar de assistir libera o envio ⭐ MVP

**User Story**: Como transmissor, quero que parar de ser assistido por alguém cesse imediatamente o envio a essa pessoa.

**Why P1**: Sem isso o upload só sobe, nunca desce.

**Acceptance Criteria**:

1. ONDEM-11: WHEN chega `watch-stopped` de `V` (ou `V` sai/cai) THEN o sistema SHALL remover `V` da audiência, remover as faixas locais da conexão com `V` e renegociar; E SHALL fechar a conexão se nenhuma direção de mídia ficar ativa (nem enviando a `V`, nem recebendo de `V`).
2. ONDEM-12: WHEN o usuário para a própria live (`stopShare`) THEN o sistema SHALL esvaziar a audiência, parar de enviar a todos e fechar as conexões que não estejam recebendo mídia de um transmissor que o usuário está assistindo.
3. ONDEM-13: WHEN o usuário para de assistir a `S` THEN o sistema SHALL enviar `watch-stopped` (já existente) e SHALL fechar a conexão com `S` se `S` também não estiver na audiência do usuário.
4. ONDEM-14: WHEN `offer` e `stopSending` ocorrem em sequência rápida para o mesmo peer THEN o sistema SHALL executá-las em série, sem deixar o peer enviando mídia após o `watch-stopped` mais recente.

**Independent Test**: C assiste e depois para; `peerIds()` de C e de A voltam a não conter o par.

---

### P2: Recuperação de quedas e perda de mensagem

**User Story**: Como espectador, quero que a live volte sozinha depois de uma queda de conexão, sem precisar clicar de novo.

**Why P2**: Evita regressão: hoje o `hello` reoferece a todos; no novo modelo o espectador precisa repetir o pedido.

**Acceptance Criteria**:

1. ONDEM-15: WHEN o WebSocket do espectador reautentica (`hello`) e há transmissores que ele está assistindo e que ainda constam como transmitindo THEN o sistema SHALL reenviar `watch-started` a cada um.
2. ONDEM-16: WHEN o WebSocket do transmissor reautentica (`hello`) e ele está transmitindo THEN o sistema SHALL enviar `share-started` e SHALL reoferecer apenas a membros da audiência atualmente conectados.
3. ONDEM-17: WHEN o transmissor volta (`participant-presence` conectado) e o usuário o está assistindo THEN o sistema SHALL reenviar `watch-started` a ele.
4. ONDEM-18: WHEN passam 10 s após enviar `watch-started` sem nenhuma faixa de `S` THEN o sistema SHALL reenviar `watch-started` uma vez; WHEN passam outros 10 s sem faixa THEN o sistema SHALL exibir o erro "A live não chegou. Tente assistir de novo." e SHALL NOT reenviar mais.

**Independent Test**: Derrubar o WebSocket do espectador (E2E com `page.context().setOffline`) e ver o vídeo voltar.

---

## Edge Cases

- WHEN o mesmo usuário transmite e assiste a outro transmissor que também o assiste THEN SHALL existir uma única conexão por par, com mídia nos dois sentidos, fechada só quando ambas as direções pararem.
- WHEN `watch-started` chega antes de `share-started` ser processado localmente THEN o sistema SHALL ignorá-lo (ONDEM-06) e o espectador SHALL reenviar pelo mecanismo ONDEM-18.
- WHEN a sessão é trocada (`session` muda) ou o hook é desmontado THEN a audiência SHALL ser limpa e todas as conexões fechadas (comportamento atual de limpeza preservado).
- WHEN `offer` para um espectador falha THEN o sistema SHALL registrar `recordDiagnostic("audience-offer-failed")` sem derrubar a sala e SHALL manter o espectador na audiência.

## Observabilidade

- ONDEM-19: WHEN a audiência muda THEN o sistema SHALL registrar `recordDiagnostic("audience-change", { count })`, sem ids, nomes nem códigos.

## Compatibilidade

- ONDEM-20: A mudança SHALL NOT alterar `server/`, `PROTOCOL_VERSION`, nem o formato de nenhuma mensagem de sinalização.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| ONDEM-01, 02, 03, 05, 06 | P1: Transmissor envia só a quem assiste | Tasks | Pending |
| ONDEM-04 | P1: Transmissor envia só a quem assiste | Tasks | Pending |
| ONDEM-07, 08, 09, 10 | P1: Lives visíveis sem receber mídia | Tasks | Pending |
| ONDEM-11, 12, 13, 14 | P1: Parar de assistir libera o envio | Tasks | Pending |
| ONDEM-15, 16, 17, 18 | P2: Recuperação | Tasks | Pending |
| ONDEM-19 | Observabilidade | Tasks | Pending |
| ONDEM-20 | Compatibilidade | Tasks | Pending |

**Coverage:** 20 total, 20 mapped to tasks, 0 unmapped.

---

## Success Criteria

- [ ] Em sala com 5 pessoas e 3 lives, cada pessoa assistindo uma, o nº de fluxos de vídeo de saída cai de 12 para 4 (verificado por `peerIds()` somados no E2E de 3 clientes: 0 peers para quem não assiste).
- [ ] O E2E existente (`room-flow.spec.ts`) continua passando sem alterar suas expectativas de UI.
- [ ] `npm run lint`, `npm test`, `npm run build` e `npm run test:e2e` passam.
- [ ] `git diff` não toca `server/` nem `PROTOCOL_VERSION`.
