# Documentação técnica do Telinha

Referência para quem desenvolve ou opera o Telinha. O [README da raiz](../README.md) cobre a visão de produto e a instalação; estes documentos descrevem **como o código funciona** e **o que mudar (e onde) quando algo precisa evoluir**.

| Documento | Quando consultar |
| --- | --- |
| [architecture.md](architecture.md) | Entender os componentes, os fluxos principais e as decisões de projeto |
| [signaling-protocol.md](signaling-protocol.md) | Alterar ou depurar a API HTTP e as mensagens WebSocket |
| [server.md](server.md) | Mexer no servidor de sinalização (salas, sessões, limites, TURN) |
| [client.md](client.md) | Mexer na interface React, no WebRTC, na reconexão e no armazenamento local |
| [desktop.md](desktop.md) | Mexer no shell Tauri/Rust (captura de áudio, janela, deep links, updater) |
| [development.md](development.md) | Rodar, testar, depurar e seguir as convenções do repositório |
| [operations.md](operations.md) | Configurar variáveis, fazer deploy, publicar releases e forçar atualizações |
| [security.md](security.md) | Modelo de ameaças, autenticação, limites e privacidade |

## Mapa rápido do código

```text
src/                      Frontend React 19 + TypeScript (Vite)
  App.tsx                   Estado global: sessão, convites, atualização, fechamento
  screens/                  HomeScreen (criar/entrar) e RoomScreen (sala e transmissão)
  hooks/useTelinhaRoom.ts   Coração do cliente: WebSocket, pessoas, transmissão, reconexão
  room/peerManager.ts       Conexões RTCPeerConnection, negociação, recuperação, métricas
  media/                    Captura (getDisplayMedia), áudio nativo via AudioWorklet
  lib/                      API HTTP, protocolo, ICE, sessão local, updates, diagnóstico
server/src/               Servidor Express + ws
  app.ts                    Salas, sessões, HTTP, WebSocket, limites
  protocol.ts / codes.ts    Validação de mensagens e códigos de sala
  turn.ts                   Credenciais ICE (STUN público + Cloudflare TURN)
src-tauri/src/            Shell desktop Rust (Tauri 2)
  lib.rs                    Plugins, bandeja, atalho global, deep links, comandos
  audio.rs / capture.rs     Loopback WASAPI, listagem de fontes, layout da janela
e2e/ + scripts/           Playwright com mídia sintética
.github/workflows/        CI e release dos instaladores
render.yaml               Serviço do servidor no Render
```

## Convenções desta documentação

- Caminhos são relativos à raiz do repositório.
- "Versão do protocolo" e "versão do app" são coisas distintas; veja [operations.md](operations.md#versões-e-compatibilidade).
- Os números citados (limites, tempos, tamanhos) vêm das constantes do código no momento da escrita. Ao alterar uma constante, atualize o documento correspondente.
