# Iniciar live pela tray Specification

## Problem Statement

Hoje, para começar uma live é preciso abrir a janela, criar ou entrar numa sala, abrir o seletor de tela e depois copiar o código na mão. A tray do Windows só tem "Mostrar Telinha" e "Sair". Queremos que a tray seja o ponto de entrada: iniciar a live, escolher a tela e ter o link de convite na área de transferência, sem navegar pelo app.

## Goals

- [ ] A partir da tray, o usuário chega ao seletor de tela em um clique, criando a sala se ainda não estiver em uma.
- [ ] Ao confirmar a tela, o link `<API_URL>/j/CODE` da sala atual está na área de transferência e o usuário é avisado por um toast dentro do app.
- [ ] Com uma sala ativa, a tray permite copiar o link ou o código e parar a live, sem abrir a janela.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Download direto do instalador | A página de convite só aponta para a release mais recente do GitHub |
| `?name=` no link copiado | Decidido: o parser usa `name` para definir o nome de quem entra, o que confundiria o convidado |
| Popup/janela flutuante ancorada na tray | Menu nativo atende; fica como evolução |
| Toast nativo do Windows, troca do ícone da tray, tooltip dinâmico | Decidido: feedback só por toast dentro do app |
| Lista de espectadores no menu da tray | Fora do pedido |
| Iniciar com o Windows (autostart) | Feature separada |
| Fazer o `telinha://share` criar sala quando não há sessão | Comportamento atual mantido (só abre o picker se já houver sala) |
| Rollback da sala quando o picker é cancelado | Decidido: a sala continua aberta |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Quem cria a sala pela tray | O frontend, usando `createRoom` e o nome salvo (`telinha-display-name`, padrão "Amigo") | A criação e a sessão vivem no frontend; a tray só emite evento | y |
| Link copiado | `<API_URL>/j/CODE` (URL pública do servidor, a mesma `VITE_API_URL` do app), sem query string. O servidor serve uma página que abre `telinha://join/CODE` e tem o link para a release mais recente | Decisão do usuário: `telinha://` não vira link clicável em chats; https sim | y |
| Quando o link é copiado | Sempre que uma live começa de fato (após `startShare` concluir), por qualquer caminho: tray, botão da sala ou Ctrl+Shift+S | Decisão do usuário: "em qualquer início de live" | y |
| Feedback | Toast dentro do app | Decisão do usuário | y |
| Janela ao usar "Copiar link" / "Copiar código" da tray | A janela **não** é mostrada; a cópia acontece e o toast só é visível se a janela já estiver visível | Esses itens existem para uso rápido sem abrir o app; sem toast nativo não há outro feedback | n |
| Janela ao usar "Iniciar live" ou "Parar live" | "Iniciar live" mostra e foca a janela; "Parar live" não mostra a janela | Iniciar exige o seletor visível; parar é uma ação rápida | n |
| Texto dos itens | "Iniciar live", "Parar live", "Copiar link", "Copiar código" | Mesmo idioma e tom dos itens atuais ("Mostrar Telinha", "Sair") | n |
| Falha ao copiar no clipboard do Tauri | Fallback para `navigator.clipboard`, como `copyCode` já faz; se também falhar, toast de erro | Reaproveita o padrão existente | y |
| Ordem dos itens | Iniciar/Parar live, Copiar link, Copiar código, separador, Mostrar Telinha, Sair | Ações da live primeiro | n |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: Iniciar live pela tray ⭐ MVP

**User Story**: Como streamer, quero clicar em "Iniciar live" na tray, escolher a tela e ter o link de convite copiado, para chamar meus amigos sem navegar pelo app.

**Why P1**: É o pedido central da feature.

**Acceptance Criteria**:

1. WHEN o usuário clica em "Iniciar live" e não há sala ativa THEN system SHALL criar uma sala com o nome salvo, entrar nela e abrir o seletor de tela.
2. WHEN o usuário clica em "Iniciar live" e há sala ativa THEN system SHALL manter essa sala, sem criar outra, e abrir o seletor de tela.
3. WHEN o usuário clica em "Iniciar live" THEN system SHALL mostrar e focar a janela principal, mesmo que estivesse escondida.
4. WHEN o usuário confirma uma fonte no seletor e a live começa (pela tray, pelo botão da sala ou pelo atalho) THEN system SHALL copiar `<API_URL>/j/CODE` (CODE = código da sala atual, sem `?name=`) para a área de transferência.
5. WHEN o link é copiado ao iniciar a live THEN system SHALL mostrar um toast dentro do app informando que o link foi copiado.
6. WHEN o usuário cancela ou fecha o seletor sem escolher uma fonte THEN system SHALL manter a sala aberta, não copiar nada e não mostrar toast de cópia.
7. WHEN a criação da sala falha THEN system SHALL manter o usuário na tela inicial exibindo a mensagem de erro já usada para falha de criação de sala, e não abrir o seletor.
8. WHEN "Iniciar live" é acionado enquanto uma criação de sala disparada pela tray ainda está em andamento THEN system SHALL ignorar o acionamento extra, sem criar uma segunda sala.

**Independent Test**: Sem sala ativa, clicar em "Iniciar live" na tray, escolher uma tela, e colar: o texto colado é `<API_URL>/j/<código da sala exibida>`; o toast apareceu.

---

### P1: Menu da tray conforme o estado ⭐ MVP

**User Story**: Como streamer, quero que o menu da tray mostre só as ações que fazem sentido agora, para não clicar em algo inválido.

**Why P1**: "Iniciar live" que vira "Parar live" é parte do fluxo básico; sem isso o item fica enganoso durante a live.

**Acceptance Criteria**:

1. WHEN não há sala ativa THEN system SHALL mostrar "Iniciar live" e não mostrar "Copiar link", "Copiar código" nem "Parar live".
2. WHEN há sala ativa e o usuário não está compartilhando THEN system SHALL mostrar "Iniciar live", "Copiar link" e "Copiar código".
3. WHEN o usuário está compartilhando a tela THEN system SHALL mostrar "Parar live", "Copiar link" e "Copiar código" e não mostrar "Iniciar live".
4. WHEN a live para (pelo botão da sala, pelo atalho Ctrl+Shift+S, pela tray ou por erro) THEN system SHALL voltar a mostrar "Iniciar live" no lugar de "Parar live".
5. WHEN o usuário sai da sala THEN system SHALL voltar ao menu sem sala ativa (AC 1).
6. WHEN o app inicia com uma sessão restaurada de `loadActiveSession` THEN system SHALL refletir essa sala no menu (AC 2).
7. "Mostrar Telinha" e "Sair" SHALL continuar presentes em todos os estados, com o comportamento atual.

**Independent Test**: Percorrer os estados (sem sala, sala sem live, live, sair) abrindo o menu da tray em cada um e conferindo os itens.

---

### P1: Copiar link e código pela tray ⭐ MVP

**User Story**: Como streamer, quero copiar o link ou o código da sala pela tray, para repassar a um amigo sem abrir a janela.

**Why P1**: É o segundo pedido explícito (link de join da sala atual).

**Acceptance Criteria**:

1. WHEN o usuário clica em "Copiar link" THEN system SHALL copiar `<API_URL>/j/CODE` da sala atual, sem `?name=`.
2. WHEN o usuário clica em "Copiar código" THEN system SHALL copiar somente o CODE da sala atual (6 caracteres, como exibido na sala).
3. WHEN "Copiar link" ou "Copiar código" é acionado THEN system SHALL registrar um toast de confirmação, e SHALL NOT mostrar nem focar a janela.
4. WHEN o clipboard falha nos dois mecanismos THEN system SHALL mostrar um toast de erro de cópia e não alterar o estado da sala.
5. WHEN o código muda porque a sessão foi renovada ou o usuário trocou de sala THEN system SHALL copiar o código da sala atual no momento do clique, nunca um valor antigo.

**Independent Test**: Em uma sala, clicar em "Copiar link", colar e conferir `<API_URL>/j/<código>`; repetir com "Copiar código" e conferir só o código.

---

### P2: Parar live pela tray

**User Story**: Como streamer, quero parar a live pela tray, para encerrar sem trazer a janela para frente.

**Why P2**: Útil, mas o botão da sala e o atalho Ctrl+Shift+S já param a live.

**Acceptance Criteria**:

1. WHEN o usuário clica em "Parar live" THEN system SHALL parar o compartilhamento, manter a sala aberta e não mostrar a janela.
2. WHEN a live para pela tray THEN system SHALL aplicar o AC 4 de "Menu da tray conforme o estado".

**Independent Test**: Durante uma live, clicar em "Parar live" na tray: os espectadores deixam de receber a tela, a sala continua, e o menu volta a mostrar "Iniciar live".

---

### P1: Página de convite no servidor ⭐ MVP

**User Story**: Como convidado que já tem o Telinha, quero clicar no link recebido e cair direto na sala.

**Why P1**: Sem ela o link https copiado não abriria o app.

**Acceptance Criteria**:

1. WHEN `GET /j/CODE` recebe um código válido (6 caracteres do alfabeto de salas, normalizado como nas outras rotas) THEN server SHALL responder 200 `text/html` com um link e um redirecionamento automático para `telinha://join/CODE`.
2. WHEN a página é exibida THEN server SHALL incluir um link para `https://github.com/llorenzocardoso/telinha/releases/latest`.
3. WHEN o código é inválido THEN server SHALL responder 404 sem incluir `telinha://join` no corpo.

**Independent Test**: Abrir `<API_URL>/j/<código>` no navegador e ver o Telinha abrir na tela de convite.

---

## Edge Cases

- WHEN o usuário já está compartilhando e dispara o evento de iniciar live de algum jeito (ex.: evento atrasado) THEN system SHALL não abrir o seletor nem reiniciar a captura.
- WHEN há convite pendente (`pendingInvite`) aberto THEN "Iniciar live" SHALL seguir o fluxo normal e o convite continua exibido.
- WHEN há diálogo de atualização obrigatória aberto THEN system SHALL não criar sala nem abrir o seletor (o diálogo bloqueia o uso).
- WHEN a janela está escondida e o usuário usa "Iniciar live" THEN system SHALL mostrar a janela antes de abrir o seletor.
- WHEN o usuário aciona "Iniciar live" em sequência rápida THEN system SHALL tratar como no AC 8 de "Iniciar live pela tray".

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| TRAYLIVE-01 | P1: Iniciar live — cria sala se não houver (AC 1) | Specify | Pending |
| TRAYLIVE-02 | P1: Iniciar live — reaproveita sala ativa (AC 2) | Specify | Pending |
| TRAYLIVE-03 | P1: Iniciar live — mostra janela e abre o seletor (AC 3) | Specify | Pending |
| TRAYLIVE-04 | P1: Iniciar live — copia o link ao começar a live (AC 4) | Specify | Pending |
| TRAYLIVE-05 | P1: Iniciar live — toast ao copiar (AC 5) | Specify | Pending |
| TRAYLIVE-06 | P1: Iniciar live — cancelar o seletor mantém a sala (AC 6) | Specify | Pending |
| TRAYLIVE-07 | P1: Iniciar live — falha ao criar sala (AC 7) | Specify | Pending |
| TRAYLIVE-08 | P1: Iniciar live — ignorar acionamento duplicado (AC 8) | Specify | Pending |
| TRAYLIVE-09 | P1: Menu — itens por estado (AC 1-3) | Specify | Pending |
| TRAYLIVE-10 | P1: Menu — atualização ao mudar live / sala / restaurar sessão (AC 4-6) | Specify | Pending |
| TRAYLIVE-11 | P1: Menu — "Mostrar Telinha" e "Sair" preservados (AC 7) | Specify | Pending |
| TRAYLIVE-12 | P1: Copiar link (AC 1, 5) | Specify | Pending |
| TRAYLIVE-13 | P1: Copiar código (AC 2, 5) | Specify | Pending |
| TRAYLIVE-14 | P1: Copiar — sem mostrar janela, com toast (AC 3) | Specify | Pending |
| TRAYLIVE-15 | P1: Copiar — falha de clipboard (AC 4) | Specify | Pending |
| TRAYLIVE-16 | P2: Parar live pela tray | Specify | Pending |
| TRAYLIVE-17 | Edge: já compartilhando, atualização obrigatória | Specify | Pending |
| TRAYLIVE-18 | P1: Página de convite `/j/CODE` (AC 1-3) | Specify | Pending |

**Coverage:** 18 total, 0 mapped to tasks, 18 unmapped ⚠️ (esperado nesta fase)

---

## Implicit-Requirement Dimensions (sweep)

| Dimension | Resolution |
| --- | --- |
| Input validation & bounds | N/A because não há entrada do usuário; o código vem da sessão e já é validado pelo servidor |
| Failure / partial-failure states | TRAYLIVE-07 (criação falha), TRAYLIVE-06 (picker cancelado), TRAYLIVE-15 (clipboard falha) |
| Idempotency / retry / duplicate handling | TRAYLIVE-08 (duplo clique), TRAYLIVE-17 (já compartilhando) |
| Auth boundaries & rate limits | N/A because nenhuma API nova; reaproveita `createRoom` |
| Concurrency / ordering | TRAYLIVE-08, TRAYLIVE-10 e TRAYLIVE-12 (estado do menu e do código sempre lidos no momento da ação) |
| Data lifecycle / expiry | N/A because nada novo é persistido; a sessão continua gerida por `sessionStore` |
| Observability | N/A because o app não tem logging estruturado para esse tipo de ação |
| External-dependency failure | Coberto por TRAYLIVE-07 (servidor indisponível) e TRAYLIVE-15 (clipboard) |
| State-transition integrity | TRAYLIVE-09 e TRAYLIVE-10 (menu espelha: sem sala / sala / live) |

---

## Success Criteria

- [ ] Sem sala, do clique em "Iniciar live" até a live no ar são só 2 interações: clicar na tray e escolher a tela.
- [ ] O texto na área de transferência após iniciar a live é exatamente `<API_URL>/j/<código da sala atual>`.
- [ ] O menu da tray nunca mostra "Iniciar live" durante uma live nem "Parar live" fora dela.
- [ ] Nenhum teste existente (`npm test`) quebra e "Mostrar Telinha" / "Sair" seguem funcionando.
