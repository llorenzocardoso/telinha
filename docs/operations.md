# Operação: configuração, deploy e releases

## Variáveis de ambiente

### Aplicativo (build time)

Variáveis `VITE_*` são **embutidas no build**; mudar uma exige gerar o app de novo. Arquivos lidos pelo Vite: `.env`, `.env.development` (versionado, aponta para `http://localhost:3001`), `.env.production` (versionado, aponta para `https://telinha-server.onrender.com`).

| Variável | Finalidade |
| --- | --- |
| `VITE_API_URL` | URL HTTP do servidor. Build de produção **falha** se estiver vazia ou apontar para `localhost`/`127.0.0.1` |
| `VITE_ALLOW_LOCAL_API` | `1` permite gerar build de produção apontando para localhost (útil para testar um `.exe` local) |
| `VITE_TURN_URL`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL` | TURN próprio. Quando `VITE_TURN_URL` existe, **substitui** os servidores devolvidos pela sessão |
| `VITE_E2E_MEDIA` | `1` ativa mídia sintética (só funciona em modo dev; usado pelo E2E) |

### Servidor

Modelo em `server/.env.example`.

| Variável | Padrão | Finalidade |
| --- | --- | --- |
| `PORT` / `HOST` | `3001` / `0.0.0.0` | Onde escuta |
| `WS_PUBLIC_URL` | derivada do `Host` | URL pública do WebSocket devolvida aos clientes |
| `TRUST_PROXY` | desligado (ligado se `RENDER` existe) | `1` confia no primeiro proxy para obter o IP real |
| `CORS_ORIGINS` | — | Origens web adicionais (localhost e Tauri já são aceitos) |
| `MIN_PROTOCOL_VERSION` | versão atual do protocolo (2) | Menor protocolo aceito |
| `MIN_APP_VERSION` | `0.2.0` | Menor versão do app; publicada em `/app-config` |
| `CLOUDFLARE_TURN_KEY_ID`, `CLOUDFLARE_TURN_API_TOKEN` | — | Habilitam TURN (precisam das duas) |
| `CLOUDFLARE_TURN_TTL_SECONDS` | `86400` | Validade das credenciais (60–86 400) |

### Desktop (runtime)

| Variável | Finalidade |
| --- | --- |
| `TELINHA_DISCORD_APP_ID` | Habilita o Rich Presence do Discord ([desktop.md](desktop.md#discord-rich-presence)) |

### Segredos do GitHub Actions

`TAURI_SIGNING_PRIVATE_KEY` e `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` assinam os pacotes de atualização. A chave pública correspondente está em `src-tauri/tauri.conf.json`. **Perder a chave privada impede que apps já instalados aceitem novas atualizações.**

## Deploy do servidor

### Render (`render.yaml`)

Serviço web `telinha-server`: plano `free`, região `oregon`, `rootDir: server`, build `npm install && npm run build`, start `npm start`, health check `/health`, `NODE_VERSION=22`, `MIN_PROTOCOL_VERSION=2`, `MIN_APP_VERSION=0.2.0`. `CLOUDFLARE_TURN_KEY_ID` e `CLOUDFLARE_TURN_API_TOKEN` estão como `sync: false`: informe os valores no painel do Render.

Como o Render define `RENDER`, `trust proxy` já é ativado. Defina `WS_PUBLIC_URL` (por exemplo `https://telinha-server.onrender.com`) para o `wsUrl` não depender dos cabeçalhos do proxy.

### Outro provedor

```powershell
cd server
npm ci
npm run build
npm start
```

Requisitos: Node 20+, suporte a WebSocket e **uma única instância** (o estado é em memória). Configure `WS_PUBLIC_URL`, `TRUST_PROXY=1` (se houver proxy), `MIN_PROTOCOL_VERSION` e, se quiser TURN, as variáveis da Cloudflare.

### Implicações do estado em memória

- Reiniciar ou fazer deploy derruba todas as salas; os clientes tentam reconectar e, ao receber "Sala inválida", pedem novo seat, mas a sala em si não existe mais e o `join` devolve `404`.
- Planos gratuitos que hibernam por inatividade têm partida a frio; o cliente faz ping no `/health` durante a sala.
- Não escale para mais de uma instância sem externalizar o estado.

### Verificação pós-deploy

```powershell
curl https://<servidor>/health        # {"ok":true,"service":"telinha-server"}
curl https://<servidor>/app-config    # minAppVersion e minProtocolVersion esperados
```

Crie uma sala por `POST /rooms` e confira que `wsUrl` é `wss://…/ws` e que `iceServers` contém entradas `turn:` quando o TURN está configurado.

## TURN

Sem TURN, o app usa só STUN: funciona na maioria das redes, mas falha com CGNAT, firewalls restritivos ou UDP bloqueado (sintoma: "Não foi possível conectar direto"). Opções:

1. **Cloudflare TURN no servidor** (recomendado): defina `CLOUDFLARE_TURN_KEY_ID` e `CLOUDFLARE_TURN_API_TOKEN`. O servidor entrega credenciais temporárias na sessão e na renovação.
2. **TURN próprio no app**: `VITE_TURN_URL` (+ usuário/credencial) no build. As credenciais ficam **no binário distribuído**, então não use segredos de longa duração sensíveis.

Quando uma conexão falha, o cliente renova as credenciais e tenta de novo forçando relay (`iceTransportPolicy: "relay"`) se houver TURN configurado.

Depois de configurar, valide no diagnóstico de uma sala: `peer-health` com `localRelayCandidates > 0` e `candidateType: "relay"` em redes restritivas.

## Versões e compatibilidade

Existem **dois eixos** independentes:

| Eixo | Onde fica | Como força atualização |
| --- | --- | --- |
| Versão do **protocolo** (inteiro) | `server/src/protocol.ts` (`CURRENT_PROTOCOL_VERSION`) e `src/lib/protocol.ts` (`PROTOCOL_VERSION`) | `MIN_PROTOCOL_VERSION` no servidor: HTTP responde `426 UPDATE_REQUIRED` e o WebSocket envia `update-required` |
| Versão do **app** (semver) | Ver lista abaixo | `MIN_APP_VERSION` no servidor: `/app-config` leva o app a exibir atualização obrigatória |

A versão do app aparece em **cinco** lugares que devem andar juntos a cada release:

1. `package.json` (`version`)
2. `src-tauri/Cargo.toml` (`version`)
3. `src-tauri/tauri.conf.json` (`version`), usada pelo updater e pelo nome dos artefatos
4. `src/lib/protocol.ts` (`APP_VERSION`), usada na comparação com `minAppVersion` e enviada ao servidor
5. `server/package.json` (`version`, informativa)

> Não há automação que sincronize esses valores. Se `APP_VERSION` ficar menor que `MIN_APP_VERSION`, o app mostra a atualização como obrigatória.

### Mudando o protocolo sem derrubar ninguém

1. Publique o servidor aceitando as duas versões (o `MIN_PROTOCOL_VERSION` anterior continua válido).
2. Distribua a nova versão do app.
3. Quando a base de usuários migrar, suba `MIN_PROTOCOL_VERSION` (e, se quiser forçar, `MIN_APP_VERSION`).

O `.env.example` do servidor registra essa mesma prática ("durante a migração mantenha o mínimo anterior").

## Release dos instaladores

Workflow **Release Windows** (`.github/workflows/release.yml`), disparo manual em *Actions → Release Windows → Run workflow*:

1. Informe `api_url` (padrão `https://telinha-server.onrender.com`); vira `VITE_API_URL` do build.
2. Em `windows-latest`: Node 22, Rust 1.98.0 com cache, `npm ci`, `tauri-action`.
3. O `tauri-action` compila, assina os pacotes de atualização com os segredos e cria a **release publicada** (`releaseDraft: false`, `prerelease: false`) de nome `Telinha v<versão>`, tag `telinha-v<versão>-build-<número da execução>`, incluindo `latest.json` (`includeUpdaterJson: true`).
4. Os `.msi` e `.exe` também são enviados como artefato `telinha-windows`.

> O README fala em "draft", mas o workflow atual publica a release direto. Como os apps instalados consultam `releases/latest/download/latest.json`, **a release fica disponível para auto-atualização assim que o workflow termina**.

### Checklist de release

- [ ] CI verde na `main` (frontend, servidor, E2E, Rust).
- [ ] Versão atualizada nos cinco lugares acima.
- [ ] Se o protocolo mudou: servidor já em produção aceitando a versão nova.
- [ ] `api_url` do workflow aponta para o servidor de produção.
- [ ] Rodar o workflow e conferir a release e o `latest.json`.
- [ ] Testar a atualização em uma instalação anterior.
- [ ] Só então, se necessário, subir `MIN_APP_VERSION`.

## Atualização no app instalado

No arranque, o app consulta `/app-config` e o `latest.json`. Se há versão nova, mostra um aviso (que pode ser adiado) ou, se a versão atual é menor que `minAppVersion`, uma tela obrigatória. A instalação é `passive` (barra de progresso do Windows) e o app reinicia sozinho.

## Rollback

- **Servidor**: faça redeploy do commit anterior (as salas ativas são perdidas).
- **App**: o updater instala a versão mais recente da release marcada como "latest". Para retirar uma versão ruim, publique uma versão corrigida (ou apague/rebaixe a release no GitHub para que `latest` volte à anterior). Evite subir `MIN_APP_VERSION` para uma versão com problemas.
