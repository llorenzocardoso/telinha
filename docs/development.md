# Guia de desenvolvimento

## Pré-requisitos

- Windows 10/11 (o app desktop e o áudio nativo são Windows-only; servidor e frontend rodam em qualquer SO).
- Node.js 20+ (CI e Render usam 22).
- Rust com toolchain MSVC (o CI fixa `1.98.0`) e Microsoft Edge WebView2 Runtime.
- Para o E2E: Google Chrome instalado (o Playwright usa `channel: "chrome"`).

## Primeira execução

```powershell
npm ci
npm ci --prefix server
Copy-Item .env.example .env
Copy-Item server/.env.example server/.env
```

| Comando | O que faz |
| --- | --- |
| `npm run dev:all` | Servidor (`tsx watch`, porta 3001) + app Tauri em modo dev (Vite na 1420) |
| `npm run dev:solo` | Servidor + só a interface web em `http://127.0.0.1:1420` |
| `npm run server` | Só o servidor, com recarga automática |
| `npm run dev` | Só o Vite |
| `npm run build:desktop` | Instaladores em `src-tauri/target/release/bundle/` |

`dev:solo` é o ciclo mais rápido para mexer em UI e sinalização: abra **duas janelas anônimas** do navegador (ou dois perfis) para simular dois participantes. No navegador não existe o loopback nativo, então desligue o áudio do sistema; o vídeo usa o `getDisplayMedia` do próprio navegador.

A porta 1420 é fixa (`strictPort`) porque `tauri.conf.json` e a CSP apontam para ela.

## Estrutura de pacotes

São **dois** `package.json` independentes (raiz e `server/`), cada um com seu lockfile, mais o crate Rust em `src-tauri/`. Dependências do servidor não aparecem na raiz. O Vite ignora `src-tauri/**` e `server/**` no watch.

## Testes

| Escopo | Comando | Observação |
| --- | --- | --- |
| Frontend (unitários) | `npm test` | Vitest, ambiente `node`, `src/**/*.test.ts` |
| Servidor | `npm test --prefix server` | Sobe o servidor real em porta efêmera e conversa por HTTP/WebSocket |
| E2E | `npm run test:e2e` | Compila o servidor, sobe servidor + Vite com mídia sintética e roda Playwright |
| Rust | `cargo test --manifest-path src-tauri/Cargo.toml` | |

O que cada suíte cobre:

- **`server/src/app.test.ts`**: criação/entrada, rejeição de código personalizado, `WS_PUBLIC_URL`, versão de protocolo, autenticação por mensagem, CORS e origem do WebSocket, saída idempotente, holds e reconexão, privacidade dos observadores, limite de payload, substituição de socket, `/app-config`, `iceServers` e renovação.
- **`server/src/protocol.test.ts`, `codes.test.ts`, `turn.test.ts`**: validação de mensagens, códigos e nomes, credenciais TURN (com `fetchImpl` e `now` injetados).
- **`src/**/*.test.ts`**: `api`, `protocol`, `ice`, `sessionStore`, `updates`, `diagnostics`, `deepLink`, `watch`, `sounds`, `connectionQuality`, `peerManager`, `displayShare`, `shareAudio`.
- **`e2e/room-flow.spec.ts`**: três usuários (Ana, Bia, Caio) em contextos separados: criar/entrar, transmitir nos dois sentidos, assistir com frames reais, redimensionar a janela, visualização em grade, sair e voltar sem duplicar a pessoa.

### Como o E2E funciona

`npm run test:e2e` executa `scripts/run-e2e.mjs`, que:

1. Reaproveita o servidor (`:3001/health`) e o Vite (`:1420`) se já estiverem rodando; senão os inicia (e os encerra no final).
2. Sobe o Vite com `VITE_API_URL=http://127.0.0.1:3001` e `VITE_E2E_MEDIA=1`.
3. Roda `playwright test` com `PLAYWRIGHT_EXTERNAL_SERVERS=1`.

Com `VITE_E2E_MEDIA=1` (somente em modo dev), o app gera vídeo sintético em um canvas e usa `iceServers: []`. O Chrome é iniciado com flags que desativam throttling em segundo plano e a ocultação de IP local por mDNS, para o WebRTC funcionar entre contextos na mesma máquina. Os testes são **sequenciais** (`fullyParallel: false`) e guardam trace quando falham (`test-results/`).

Rodar um teste específico: `npm run test:e2e -- -g "compartilha"`.

### Convenções de teste

- Lógica de decisão (versões, qualidade de conexão, parsing, sessão) fica em funções puras, testadas sem DOM.
- O E2E seleciona elementos por **papel/texto em português** (`getByRole("button", { name: "Compartilhar tela" })`) e por classes (`.live-choice`, `.lobby-code strong`, `.person-chip`, `.video-area`). Mudar um rótulo ou classe de UI exige ajustar `e2e/room-flow.spec.ts`.
- Testes do servidor usam as opções do `createTelinhaServer` (prazos curtos, `disableRateLimit`) em vez de timers reais longos.

## Lint e formatação

```powershell
npm run lint                  # eslint src playwright.config.ts scripts
npm run lint --prefix server  # eslint src
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

`npm run build` (frontend) roda `tsc` antes do `vite build`: erros de tipo quebram o build. O servidor compila com `tsc` para `server/dist/`.

## CI (`.github/workflows/ci.yml`)

Dispara em push para `main`/`master` e em pull requests, cancelando execuções antigas da mesma ref.

| Job | Roda em | Passos |
| --- | --- | --- |
| `frontend` | Ubuntu, Node 22 | `npm ci`, lint, testes, build (com `VITE_API_URL` de produção) |
| `server` | Ubuntu, Node 22 | `npm ci`, lint, testes, build |
| `e2e` | Ubuntu, Node 22 | `npm ci` (raiz e `server`), `npm run test:e2e` |
| `rust` | Ubuntu | `cargo fmt --check` |
| `rust-windows` | Windows, **só se `src-tauri/**` ou o workflow mudaram** | `cargo test`, `cargo clippy -D warnings` |

Reproduza localmente os mesmos comandos antes de abrir um PR.

## Convenções de código observadas

- **Idioma**: textos de interface, mensagens de erro do servidor e comentários em português; identificadores em inglês.
- **TypeScript estrito** nos dois projetos; o servidor usa ESM com `.js` nos imports.
- **Validação nas fronteiras**: tudo que vem da rede (HTTP, WebSocket, `localStorage`) é validado e normalizado (`parseServerSignal`, `parseClientSignal`, `validSession`, `parseRoomSession`). Siga o padrão ao adicionar entradas.
- **Erros de UI** são mensagens curtas no estado `error` do hook; detalhes técnicos vão para `recordDiagnostic`.
- **Chamadas ao Tauri** sempre toleram falha (`.catch(() => undefined)`) para o app web continuar funcionando.
- **Segredos**: nunca em `.env` versionado. `.env.development` e `.env.production` são versionados e não devem ter credenciais (o `.gitignore` já exclui os demais `.env*`).

## Depuração

| Sintoma | Onde olhar |
| --- | --- |
| Não conecta à sala | `/health` do servidor; console do WebSocket; evento `signal-close` e `server-error` no diagnóstico |
| Entra, mas não vê a tela | `peer-state`, `peer-health` (candidatos `relay`/`srflx`), `media-status` no diagnóstico; veja também [client.md](client.md#peermanager) |
| "Não foi possível conectar direto" | Rede bloqueando UDP/P2P: configure TURN ([operations.md](operations.md#turn)) |
| App empacotado não alcança o servidor | CSP em `src-tauri/tauri.conf.json` (`connect-src`) e `VITE_API_URL` do build |
| Sem áudio do sistema | Evento `share-audio-error`; veja os requisitos em [desktop.md](desktop.md#áudio-do-sistema-audiors) |
| `Tauri` indisponível no navegador | Esperado em `dev:solo`; use `isTauriRuntime()` |

Em qualquer sala, o botão de diagnóstico copia o relatório sanitizado ([client.md](client.md#diagnóstico)). Os eventos úteis incluem `peer-state`, `peer-health`, `media-status`, `ice-error`, `ice-refresh-failed`, `signal-open`, `signal-close`, `seat-refresh-failed`, `share-start-failed` e `share-audio-failed`.

## Receitas

**Adicionar uma mensagem de sinalização**: veja [signaling-protocol.md](signaling-protocol.md#como-estender-o-protocolo).

**Adicionar uma configuração do servidor**: leia em `server/src/index.ts`, passe como opção para `createTelinhaServer`, documente em `server/.env.example`, em [operations.md](operations.md#variáveis-de-ambiente) e (se necessário) em `render.yaml`.

**Adicionar uma configuração do app**: use `VITE_*` (só essas chegam ao frontend), acrescente a `.env.example` e a `src/vite-env.d.ts`, e lembre que o valor é fixado **no build**.

**Alterar um limite de qualidade de vídeo**: presets em `components/ScreenSharePicker.tsx` (`QUALITY_PRESETS`); o bitrate é aplicado em `PeerManager.applyBitrate`.

**Mudar o servidor de produção**: atualize `VITE_API_URL` (build), a CSP de `tauri.conf.json`, `.env.production` e o `api_url` do workflow de release.
