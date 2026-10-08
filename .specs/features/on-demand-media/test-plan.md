# Plano de teste manual: On-Demand Media

## Preparação

Servidor e interface já podem estar rodando. Se não, em dois terminais (use Node 20+; o Node 16 quebra o vitest):

```powershell
npm run build --prefix server; node server/dist/index.js
$env:VITE_API_URL="http://127.0.0.1:3001"; $env:VITE_E2E_MEDIA="1"; npx vite --host 127.0.0.1
```

`VITE_E2E_MEDIA=1` gera vídeo sintético (sem seletor de tela) e expõe `window.__telinhaDebug.peerIds()`, que é a prova central: lista as conexões WebRTC abertas.

Abra `http://127.0.0.1:1420` em **3 janelas independentes** (anônimas ou perfis diferentes): **Ana**, **Bia**, **Caio**. Em cada uma, abra o DevTools (F12) > Console. Para conferir conexões:

```js
__telinhaDebug.peerIds()
```

Ana cria a sala; Bia e Caio entram com o código.

## Roteiro

| # | Ação | Resultado esperado | Requisito |
| --- | --- | --- | --- |
| 1 | Ana clica em Compartilhar tela > Continuar | Bia e Caio veem "Ana" na lista de lives, sem vídeo ainda | ONDEM-07 |
| 2 | Nas 3 janelas: `peerIds()` | `[]` nas três (ninguém abriu conexão) | ONDEM-01 |
| 3 | Bia clica na live da Ana | Vídeo toca na Bia | ONDEM-02/09 |
| 4 | `peerIds()` nas 3 | Ana: 1 id, Bia: 1 id, **Caio: `[]`** | ONDEM-01/02 |
| 5 | Caio clica na live da Ana | Aparece "Conectando…" brevemente, depois o vídeo | ONDEM-08/09 |
| 6 | `peerIds()` | Ana: 2 ids, Bia: 1, Caio: 1 | ONDEM-02 |
| 7 | Na Ana, o contador "assistindo" | Mostra 2 e os nomes Bia, Caio | ONDEM-19 |
| 8 | Caio clica em Parar de assistir | `peerIds()` do Caio volta a `[]`; Ana fica com 1; Bia continua vendo | ONDEM-11/13 |
| 9 | Caio clica de novo na live | Vídeo volta (Ana oferece de novo) | ONDEM-02 |
| 10 | Bia sai da sala (botão Sair) | Ana: `peerIds()` perde a Bia; contador cai | ONDEM-11 |
| 11 | Bia entra de novo com o código | Ana **não** abre conexão com ela; só reaparece a live na lista | ONDEM-03 |
| 12 | Bia assiste de novo | Vídeo toca; Ana volta a 2 ids | ONDEM-02 |
| 13 | Ana clica em Parar transmissão | A live some da lista de todos; `peerIds()` das 3 = `[]` | ONDEM-10/12 |

### Transmissão nos dois sentidos

| # | Ação | Resultado esperado |
| --- | --- | --- |
| 14 | Ana e Bia transmitem; cada uma assiste a outra; Caio não assiste | Ana e Bia com 1 id cada (conexão única, mídia nos dois sentidos); Caio `[]` |
| 15 | Ana para de assistir a Bia (continua transmitindo) | A conexão **não** fecha enquanto a Bia ainda assiste a Ana |
| 16 | Bia para de assistir a Ana | Agora a conexão fecha dos dois lados |

### Recuperação

| # | Ação | Resultado esperado | Requisito |
| --- | --- | --- | --- |
| 17 | Bia assistindo; DevTools > Network > Offline por ~1s, depois Online | O WebSocket reconecta e o vídeo continua sem clicar | ONDEM-15 |
| 18 | Ana (transmissora) com Bia assistindo: derrube e restaure a rede da Ana | A live volta para a Bia sem clique | ONDEM-16/17 |
| 19 | Caio abre a live e logo depois pare o servidor (Ctrl+C), mantenha ~25 s, suba de novo | Sem mídia por 10 s, um reenvio do pedido, depois o erro "A live não chegou. Tente assistir de novo." Não deve haver laço de reenvios | ONDEM-18 |
| 20 | Ana fecha a janela no meio da live | A live some (ou fica "Conectando…" se só caiu); Bia e Caio não ficam com conexão aberta ao reconectar | ONDEM-10 |

### Observabilidade e regressões

| # | Ação | Resultado esperado |
| --- | --- | --- |
| 21 | Na Ana, após os passos 3 a 8, rode `copyDiagnostics` (ou veja o botão de copiar diagnóstico) | Contém eventos `audience-change` com `count` e **sem** ids ou nomes |
| 22 | Layout: grade com 2 lives, trocar entre lives, tela cheia, volume | Tudo como antes da mudança |
| 23 | Console de cada janela | Sem erros vermelhos além de avisos de WebRTC já conhecidos |

## Teste com tela real (sem o modo sintético)

Reinicie o Vite **sem** `VITE_E2E_MEDIA` (`npm run dev:solo`). Repita os passos 1 a 8 com duas janelas. Aqui `__telinhaDebug` não existe: confirme só a parte visual (lista sem vídeo, "Conectando…", vídeo ao clicar, parar de assistir). Opcional: app desktop com `npm run dev:all` (exige Rust/WebView2) para validar o áudio do sistema.

## Para considerar aprovado

- Passos 2, 4, 6, 8, 10, 13 com os `peerIds()` exatos da tabela.
- Nenhuma live fica "Conectando…" para sempre sem mostrar o erro do passo 19.
- `git diff HEAD -- server` vazio (a branch partiu da `dev` e nada foi commitado).

## Automatizado (já verde)

`npm run lint && npm test && npm run build && npm run test:e2e`: 74 testes unitários e 2 e2e (`room-flow` e `on-demand-media`, que cobre os passos 1 a 8, 13 e 17 de forma automática).
