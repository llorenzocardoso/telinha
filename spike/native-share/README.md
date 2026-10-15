# native-share (protótipo e ferramentas de medição)

Esta pasta **não faz parte do app nem do CI**. É onde nasceu o compartilhamento nativo (veja
[docs/desktop.md](../../docs/desktop.md#compartilhamento-nativo-experimental)) e o que ficou útil para medir:

| Caminho | Para quê |
| --- | --- |
| `src/pipeline.rs`, `src/bin/sender.rs` | Protótipo 1: captura + encoder + webrtc-rs. Serviu para provar que uma pilha WebRTC em Rust puro controla pior o congestionamento. Só histórico |
| `src/bin/sender_lk.rs` | Protótipo 2: o mesmo pipeline com o libwebrtc (fonte pré-codificada). É o desenho que foi para o app |
| `harness/impair.mjs`, `harness/run.mjs`, `harness/matrix2.sh` | Proxy UDP que impõe banda, atraso, jitter e perda, e a matriz "Chrome de hoje × emissor nativo" por cenário |
| `harness/e2e-app.mjs` | Roda o **app de verdade** (porta de depuração do WebView2) com dois espectadores no Chrome: seletor, ícones, prévia, áudio, janela fechada |
| `harness/quality-app.mjs`, `harness/quality-chrome.mjs`, `harness/metrics.mjs`, `harness/qualitywin.ps1` | Qualidade da imagem: PSNR/SSIM do quadro recebido contra o cartão de teste, nos dois caminhos |
| `harness/testwin.ps1` | Janela animada (com tom opcional) para ser compartilhada |
| `baseline/baseline.mjs` | Medição de fps/bitrate do emissor atual (Chrome) em loopback |

Tudo precisa de Windows, de Chrome e de `node_modules` da raiz (os scripts importam `playwright-core` de lá).
Os scripts abrem janelas de verdade (a de teste, o app, um Chrome fora da tela principal); rode-os sabendo disso.

Como rodar a verificação do app de verdade e a de qualidade está em
[docs/native-share-testing.md](../../docs/native-share-testing.md#medições-automáticas).
