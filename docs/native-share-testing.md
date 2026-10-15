# Testando o compartilhamento nativo (experimental)

O compartilhamento nativo captura a tela em Rust (Windows Graphics Capture), codifica H.264 na GPU e envia
com o libwebrtc, o mesmo motor do Chrome e do Discord. Isso permite o seletor próprio de telas e janelas,
com miniaturas e ícones. Como o objetivo é **igualar ou superar a qualidade do compartilhamento de sempre**,
ele fica atrás de um interruptor e só vira padrão depois de testes como os deste roteiro. Como funciona por
dentro: [desktop.md](desktop.md#compartilhamento-nativo-experimental).

## O que já foi medido e o que falta

| | Estado |
| --- | --- |
| Fluidez e congelamentos (rede com perda, banda limitada) | Medido numa máquina, em loopback: empate ou melhor que o caminho de sempre |
| Nitidez de conteúdo estático (SSIM/PSNR) | Medido: empate (SSIM ≈ 0,998 nos dois) |
| Vários espectadores, áudio, prévia, janela fechada, recuperação | Testado no app real, em loopback |
| **Rede real entre duas máquinas, Wi-Fi/4G, NAT, TURN** | **Falta. É o objetivo deste roteiro** |
| **Outras GPUs (AMD, Intel), 1440p/4K, notebook com duas GPUs, HDR, jogos** | **Falta** |

## O que precisa

- Windows 10/11 com **GPU que tenha encoder H.264 por hardware** (NVIDIA, AMD ou Intel; só NVIDIA foi testada).
- Node 22 e Rust 1.98 (`rustup` instala o que o `src-tauri/rust-toolchain.toml` pede).
- Na primeira compilação o libwebrtc pré-compilado é baixado (~500 MB) e o build leva alguns minutos.

```
npm ci
npm run tauri dev        # abre o app; Rust recompila ao mudar
```

Para um app instalável: `npm run build:desktop` (o atualizador precisa da chave de assinatura; sem ela use
`npx tauri build --bundles nsis --config '{"bundle":{"createUpdaterArtifacts":false}}'`).

## Ligar e desligar

No diálogo **Compartilhar tela**, ligue **"Seletor de telas próprio (experimental)"**. A grade aparece (se a
GPU tem encoder; senão o app avisa e usa o seletor do Windows) em duas etapas, como no Discord: primeiro
escolhe-se o **aplicativo ou a tela** (abas "Aplicativos" e "Telas"); em seguida vêm resolução, taxa de quadros,
som e o botão **Compartilhar** (`Voltar` volta à grade). Desligar volta ao caminho de sempre; nada mais muda.
Se o envio nativo falhar ao começar, o app cai sozinho no seletor do Windows.

## Teste solo (só você, no navegador)

```
npm run dev:solo
```

Abra duas janelas anônimas do navegador (ou dois perfis) em `http://127.0.0.1:1420`, entre na mesma sala e
compartilhe. **Isso exercita o caminho de sempre** e confirma que a mudança não o quebrou (sinalização com o
campo `channel`, câmera, lives, reconexão). O caminho nativo **não existe no navegador** (ele precisa do app
Tauri): o interruptor nem aparece lá.

Para testar o nativo sozinho, rode o app (`npm run tauri dev`) e use o navegador como segundo participante:

1. Suba o servidor: `npm run server` (porta 3001).
2. No app, crie a sala e ligue o seletor próprio. No navegador (`http://localhost:1420`) entre pelo código.
3. No app, escolha uma janela, compartilhe; no navegador, clique em **Assistir**.

## Roteiro com outra pessoa (o que mais interessa)

Cada um roda o app (ou o instalador) e usa o servidor de sempre (`VITE_API_URL`). Um cria a sala, o outro entra
pelo código. **Faça cada cenário nos dois sentidos** (quem transmite e quem assiste trocam de lugar).

Para comparar de forma justa, use **o mesmo conteúdo, a mesma qualidade escolhida (Equilibrado, 1080p/60) e a
mesma rede**, alternando só o interruptor: uma rodada com o seletor próprio **ligado**, outra **desligado**.

| # | Cenário | Como | O que observar |
| --- | --- | --- | --- |
| 1 | Texto pequeno | Compartilhar um editor/documento com fonte pequena | Dá para ler? Borrado? Demora para "assentar" depois de rolar? |
| 2 | Vídeo/jogo | Um vídeo em tela cheia ou um jogo | Fluidez, travadas, "escadinha", atraso |
| 3 | Janela | Compartilhar só uma janela, redimensioná-la, trocar de aba, minimizar e restaurar | A live continua? Barras pretas ao redimensionar? |
| 4 | Fechar a janela | Fechar a janela compartilhada | A live termina com aviso, sem travar o app? |
| 5 | Áudio | Tocar música/vídeo no que está compartilhado | Chega estéreo? Volume parecido? Sem eco do Discord? |
| 6 | Dois espectadores | Uma terceira pessoa (ou um segundo app) assiste junto | Os dois recebem? Um sair derruba o outro? |
| 7 | Rede ruim | Wi-Fi fraco, hotspot do celular, VPN | A imagem degrada com graça ou congela? Volta sozinha? |
| 8 | Relay (TURN) | Redes que bloqueiam P2P (4G com CGNAT, rede corporativa) | Conecta? O indicador mostra relay? Banda limitada? |
| 9 | Parar e começar de novo | Compartilhar, parar, compartilhar de novo, 5 vezes | Nenhuma falha, nenhum travamento do app |
| 10 | Maratona | Uma live de 30 minutos ou mais | Memória, CPU/GPU, atraso, nenhuma degradação com o tempo |
| 11 | Jogo minimizado | Com um jogo em tela cheia (por exemplo o Valorant), dar alt-tab para o Telinha e escolhê-lo na lista (aparece com o selo "Minimizada"); depois voltar ao jogo | O jogo está na lista? A live mostra imagem ao voltar ao jogo? Qual a fluidez em jogo? (jogos com anti-cheat e tela cheia exclusiva **não foram testados**) |
| 12 | Trocar a fonte | Com alguém assistindo, usar "Trocar o que compartilha" para ir de uma janela a outra e a uma tela, várias vezes; tentar também uma fonte que acabou de fechar | Quem assiste não reconecta e a imagem volta em segundos (muda de tamanho, com barras)? Uma troca que falha mantém a anterior no ar? O som acompanha a janela nova? |

### Coletar números

Em qualquer momento, **`Ctrl+Shift+D`** copia o diagnóstico da sala (um toast confirma). Cole num arquivo, no
transmissor **e** no espectador, logo depois de cada rodada (o diagnóstico guarda os eventos recentes). O que
procurar nele:

- `native-share-stats` (transmissor): `targetKbps` (taxa que o caminho aguenta, pedida ao encoder),
  `framesPerSecond` e `sentKbps` (o que realmente saiu).
- `peer-health` com `"channel": "native-share"` (nos dois lados): `roundTripTimeMs`, `candidateType`
  (`relay` ou `direct`), `bitrateKbps` e `packetLossPercent` (espectador), `connectionState`.
- `native-share-recovering` / `native-share-recovery-gave-up`: a conexão caiu e o app tentou refazê-la.
- `native-share-fallback`: o envio nativo falhou ao começar e o app usou o seletor do Windows (e o motivo).

Para o caminho de sempre o diagnóstico traz o mesmo `peer-health` sem o campo `channel`, então dá para
comparar bitrate, perda e RTT lado a lado.

### O que reportar

Por rodada: GPU e driver, cenário, conteúdo, rede (cabo, Wi-Fi, 4G), interruptor ligado ou desligado, uma nota
de 1 a 5 para **nitidez**, **fluidez** e **atraso**, se travou ou congelou (quantas vezes, por quanto tempo) e o
diagnóstico dos dois lados. Se possível, um print do espectador com texto pequeno nas duas condições.

**Veredito esperado:** o nativo só deve virar o padrão se, nas redes e no conteúdo que importam, a nitidez e a
fluidez forem **iguais ou melhores** e nenhum cenário acima falhar. Qualquer cenário em que ele fique pior,
anote qual.

## Medições automáticas

Para repetir as medições objetivas numa máquina (precisa de Windows, Chrome e `npm ci`; abre janelas):

```
# 1. servidor e app com a porta de depuração do WebView2
npm run build --prefix server && node server/dist/index.js
VITE_NATIVE_SHARE=1 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 npm run tauri dev

# 2. app real, dois espectadores, prévia, ícones, áudio (toca um tom suave por ~4 s), janela fechada
powershell -File spike/native-share/harness/testwin.ps1          # janela animada; anote o PID
node spike/native-share/harness/e2e-app.mjs saida <PID da janela>

# 3. qualidade da imagem (PSNR/SSIM contra o cartão de teste), nativo e Chrome de sempre
powershell -File spike/native-share/harness/qualitywin.ps1       # cartão estático 1280x720
node spike/native-share/harness/quality-app.mjs 15
node spike/native-share/harness/quality-chrome.mjs 15 10 h264
```

Os scripts de rede com perda e banda limitada (`harness/run.mjs`, `matrix2.sh`) estão descritos em
[spike/native-share/README.md](../spike/native-share/README.md). Ao terminar, feche o app e o servidor
(só os processos de desenvolvimento: `src-tauri\\target\\debug\\telinha.exe` e os `node` das portas 1420/3001).

Testes automáticos do repositório (não precisam de GPU, exceto os marcados):

```
npm test                                  # frontend
npm --prefix server test                  # servidor
cd src-tauri && cargo test                # Rust (lógica pura)
cd src-tauri && cargo test native_share -- --ignored --test-threads=1   # GPU + tela; abre uma janelinha própria
```

## Limitações conhecidas

- Só H.264; sem plano B de codec. Resolução e fps não mudam no meio da live (a fonte pode mudar, com "Trocar o que compartilha").
- A prévia da própria live é de poucos quadros por segundo.
- Testado apenas com NVIDIA, 1080p, na mesma máquina (loopback) e com Chrome/WebView2 como espectador.
- Um cliente antigo não assiste uma live nativa: ao publicar, suba `MIN_APP_VERSION`.
