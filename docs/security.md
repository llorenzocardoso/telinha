# Segurança e privacidade

## Modelo

- **Sem contas.** Quem conhece o código de sala (6 caracteres de um alfabeto de 32 símbolos, ≈ 10⁹ combinações) pode entrar, até o limite de 16 pessoas. O código é o único segredo de acesso à sala; trate-o como convite, não como senha forte.
- **Identidade por sessão.** Cada entrada recebe `participantId` + `token` aleatórios (`crypto.randomBytes`). Todo o resto (WebSocket, renovação de ICE, saída) exige esse token.
- **Servidor não-confiável para mídia.** Áudio e vídeo vão por WebRTC (DTLS-SRTP) entre os participantes. O servidor de sinalização vê só metadados de sala e as descrições SDP/candidatos que encaminha.

## Autenticação e autorização

| Superfície | Proteção |
| --- | --- |
| `POST /rooms`, `POST /rooms/:code/join` | Sem token (é onde ele nasce). Limitadas por IP (8 e 30 por 15 min) e por `protocolVersion` |
| WebSocket | Mensagem `authenticate` em até 5 s; token comparado em tempo constante; a URL **não** carrega o token no modo atual |
| `GET /rooms/:code/ice-servers` | `Authorization: Bearer <token>` + `participantId` |
| `DELETE /rooms/:code/participants/:id` | `Authorization: Bearer <token>`; `403` se não confere |
| Mensagens de sinalização | O servidor define `from` com o remetente autenticado; o cliente não pode forjar |
| `watch-*` | Entregues só ao transmissor alvo; terceiros não veem quem assiste a quem |

Pontos de atenção:

- O **modo legado** de autenticação (`code`, `participantId`, `token` na query string) continua aceito pelo servidor. Esses valores podem acabar em logs de proxy. Se não houver clientes antigos que dependam dele, considere removê-lo e subir `MIN_PROTOCOL_VERSION`.
- Um participante com a sessão em `localStorage` (20 min) pode retomá-la após reiniciar o app. A sessão fica em texto no armazenamento local do WebView.
- Salas não têm dono nem moderação: qualquer participante pode transmitir e ver as transmissões. Não há mecanismo de expulsão.

## Entrada validada

- Corpo JSON: 32 KB. Mensagem WebSocket: 64 KB. SDP: 60 KB. Candidato ICE: 4 096 caracteres em `candidate` e 8 KB serializado.
- Formato estrito de ids, tokens e códigos (regex em `protocol.ts` e `codes.ts`).
- Nome de exibição: aparado e limitado a 24 caracteres. O frontend renderiza texto via React (escapado por padrão); não introduza `dangerouslySetInnerHTML` com nomes de usuário.
- O servidor fecha a conexão em mensagem inválida (1008) e no excesso de payload.

## Origens, CORS e WebSocket

Origens aceitas por padrão: `http://localhost:1420`, `http://127.0.0.1:1420`, `http(s)://tauri.localhost`, `tauri://localhost`, mais `CORS_ORIGINS`.

- HTTP: o middleware `cors` apenas **omite** os cabeçalhos CORS para origens não permitidas (o navegador bloqueia; o servidor não responde `403`).
- WebSocket: origem não permitida recebe `origin-not-allowed` e o socket é fechado.
- Requisições **sem** `Origin` (curl, apps nativos) são aceitas; a proteção real nesses casos é o token.

## Limites de abuso

Rate limit por IP em memória, só nas rotas de criação e entrada. Atrás de proxy, `trust proxy` precisa estar ligado (`TRUST_PROXY=1`, ou `RENDER` definido), senão todos os clientes parecem ter o IP do proxy. O número de IPs rastreados é limitado a 10 000. Não há limite por sala além de 16 pessoas, nem limite de mensagens WebSocket por segundo (só o tamanho).

## Privacidade

- Nenhum dado persistido: salas, nomes e tokens ficam em memória e somem ao reiniciar.
- O relatório de diagnóstico do cliente remove `token`, `sdp`, `candidate`, `code`, `name`, `url`, `ip` e `address` e limita strings a 240 caracteres; inclui versões, estados de conexão, codec, bytes/frames, contagem de candidatos por tipo e métricas de qualidade.
- Logs do servidor: apenas inicialização, encerramento e falhas do TURN. Não registre códigos, tokens nem IPs ao adicionar logs.
- IPs de participantes ficam expostos uns aos outros nos candidatos ICE de uma conexão direta (inerente ao P2P). Com `iceTransportPolicy: "relay"` (ativado na recuperação, quando há TURN) o IP do par não é revelado.
- Discord Rich Presence (opcional) mostra o código da sala ao Discord local quando `TELINHA_DISCORD_APP_ID` está definido.

## Segurança do app desktop

- CSP restrita (`default-src 'self'`; `connect-src` enumera os hosts do servidor, localhost e GitHub para o updater). `style-src` inclui `'unsafe-inline'`. Qualquer domínio novo precisa ser adicionado de forma explícita.
- Permissões do Tauri mínimas por capability (`src-tauri/capabilities/default.json`).
- O WebView2 concede automaticamente câmera/microfone (necessário para o áudio gerado no app). Outros tipos de permissão não são concedidos.
- Atualizações: pacotes assinados (minisign) e verificados com a chave pública embutida; o endpoint é HTTPS do GitHub.
- O repositório não configura assinatura de código do Windows (só a assinatura do updater), então o SmartScreen pode alertar na instalação. Confirme se existe um certificado fora do repositório.

## Segredos

| Segredo | Onde vive |
| --- | --- |
| `CLOUDFLARE_TURN_API_TOKEN` e key id | Variáveis do serviço (Render); nunca no repositório |
| `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)` | Secrets do GitHub Actions |
| Credenciais TURN dos clientes | Geradas pelo servidor, temporárias (TTL até 24 h) e compartilhadas entre quem as recebe no período |
| `VITE_TURN_*` | **Embutidas no binário**: use apenas credenciais descartáveis/limitadas |

`.gitignore` exclui `.env*` (exceto os exemplos e os `.env.development` / `.env.production`, que só contêm URLs). Revise sempre o diff antes de commitar.

## Checklist para mudanças sensíveis

- [ ] Nova entrada de rede validada (tipo, tamanho, formato).
- [ ] Rota que age sobre um participante exige o token (`bearerToken` + `tokensEqual`).
- [ ] Nenhum log, diagnóstico ou screenshot expõe token, código de sala, SDP, IP ou nome.
- [ ] Novo domínio de servidor refletido na CSP e na lista de CORS.
- [ ] Nova permissão do Tauri adicionada com o menor escopo possível.
