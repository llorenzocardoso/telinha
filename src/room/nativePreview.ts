/**
 * Prévia da própria live para quem transmite. O envio nativo não passa por uma `MediaStream` no
 * app, então a prévia é montada aqui: a cada instante busca-se o último quadro que o codificador
 * recebeu (o que quem assiste vê, sem fotografar a janela de novo) e ele é desenhado num canvas,
 * cuja captura vira a stream que a interface já sabe mostrar. É só uma prévia, com poucos quadros
 * por segundo; quem assiste recebe o vídeo de verdade.
 */
export interface NativePreviewOptions {
  /** Devolve o quadro mais recente como data URL; rejeita enquanto não houver um. */
  fetchFrame: (sourceId: string) => Promise<string>;
  /** Intervalo entre quadros, em ms. */
  intervalMs?: number;
}

const DEFAULT_INTERVAL_MS = 500;
const FALLBACK_SIZE = { width: 960, height: 540 };

export class NativePreview {
  private timer: number | undefined;
  private stream: MediaStream | null = null;
  private stopped = true;

  constructor(private readonly options: NativePreviewOptions) {}

  start(sourceId: string): MediaStream {
    this.stop();
    this.stopped = false;
    const canvas = document.createElement("canvas");
    canvas.width = FALLBACK_SIZE.width;
    canvas.height = FALLBACK_SIZE.height;
    const context = canvas.getContext("2d");
    const stream = canvas.captureStream(Math.ceil(1000 / (this.options.intervalMs ?? DEFAULT_INTERVAL_MS)));
    this.stream = stream;

    let busy = false;
    const tick = async () => {
      // Uma captura mais lenta que o intervalo não empilha pedidos.
      if (busy || this.stopped || !context) return;
      busy = true;
      try {
        const image = new Image();
        image.src = await this.options.fetchFrame(sourceId);
        await image.decode();
        if (this.stopped) return;
        if (canvas.width !== image.naturalWidth || canvas.height !== image.naturalHeight) {
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
        }
        context.drawImage(image, 0, 0);
      } catch {
        // Ainda sem quadro (ou janela minimizada, que não gera novos): fica o último.
      } finally {
        busy = false;
      }
    };
    void tick();
    this.timer = window.setInterval(() => void tick(), this.options.intervalMs ?? DEFAULT_INTERVAL_MS);
    return stream;
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== undefined) {
      window.clearInterval(this.timer);
      this.timer = undefined;
    }
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
  }
}
