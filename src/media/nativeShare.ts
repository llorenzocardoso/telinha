import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../lib/runtime";

/**
 * Interruptor experimental do compartilhamento nativo (captura e codificação em Rust).
 * Desligado por padrão: sem ele o app continua usando o seletor do Windows (`getDisplayMedia`).
 * Para ligar: `localStorage.setItem("telinha-native-share", "1")` ou `VITE_NATIVE_SHARE=1`.
 */
export const NATIVE_SHARE_KEY = "telinha-native-share";

/** Id que o app usa quando quem escolhe a fonte é o seletor do próprio Windows. */
export const WINDOWS_PICKER_ID = "screen:windows-picker";

export interface NativeCapability {
  available: boolean;
  vendor: string;
  encoder: string;
  reason?: string | null;
}

export interface NativeSource {
  /** `screen:<HMONITOR>` ou `window:<HWND>`. */
  id: string;
  kind: "screen" | "window";
  name: string;
  app?: string | null;
  pid?: number | null;
  width: number;
  height: number;
  /** Janela minimizada (um jogo depois do alt-tab): lista-se com o tamanho de quando abrir. */
  minimized?: boolean;
}

export function nativeShareFlag(): boolean {
  if (!isTauriRuntime()) return false;
  if (import.meta.env.VITE_NATIVE_SHARE === "1") return true;
  try {
    return localStorage.getItem(NATIVE_SHARE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Liga ou desliga o seletor próprio; vale a partir da próxima vez que se compartilha. */
export function setNativeShareFlag(enabled: boolean): void {
  try {
    localStorage.setItem(NATIVE_SHARE_KEY, enabled ? "1" : "0");
  } catch {
    // Sem armazenamento a escolha não persiste; o interruptor da tela continua valendo na sessão.
  }
}

/**
 * Se uma falha ao iniciar o envio nativo deve cair no seletor do Windows. Só não cai quando a falha
 * é da fonte escolhida (a janela fechou antes de começar): aí trocar de caminho esconderia o
 * problema; todas as outras (sem encoder por GPU, captura que não abre) dizem respeito ao envio
 * nativo, e o seletor do Windows ainda resolve.
 */
export function shouldFallBackToWindowsPicker(message: string): boolean {
  return !/não existe mais|Fonte inválida/i.test(message);
}

/** Fontes nativas têm id `screen:<n>` / `window:<n>`; o id legado do seletor do Windows não. */
export function isNativeSourceId(id: string): boolean {
  return /^(screen|window):\d+$/.test(id);
}

export function getNativeCapability(): Promise<NativeCapability> {
  return invoke<NativeCapability>("native_share_capability");
}

export function listNativeSources(): Promise<NativeSource[]> {
  return invoke<NativeSource[]>("native_share_sources");
}

/** `width` maior serve à prévia da própria live; o seletor usa o padrão. */
export function nativeThumbnail(id: string, width?: number): Promise<string> {
  return invoke<string>("native_share_thumbnail", { id, width: width ?? null });
}

/**
 * Prévia da própria live: o último quadro que o codificador recebeu (o que quem assiste vê), em data
 * URL. Pedir já faz o envio passar a produzi-la; devolve `null` até o primeiro quadro ficar pronto.
 */
export function nativePreviewFrame(): Promise<string | null> {
  return invoke<string | null>("native_share_preview");
}

/** Ícone do aplicativo dono de uma janela (PNG em data URL); `null` para telas e sem ícone. */
export function nativeIcon(id: string): Promise<string | null> {
  return invoke<string | null>("native_share_icon", { id });
}

export function groupSources(sources: NativeSource[]): {
  screens: NativeSource[];
  windows: NativeSource[];
} {
  return {
    screens: sources.filter((source) => source.kind === "screen"),
    windows: sources.filter((source) => source.kind === "window"),
  };
}

/**
 * Busca uma imagem por fonte aos poucos (no máximo `limit` ao mesmo tempo): cada captura de janela
 * custa tempo, e o seletor deve abrir de imediato e ir preenchendo as imagens.
 */
async function loadEach(
  ids: string[],
  fetchOne: (id: string) => Promise<string | null>,
  onResult: (id: string, dataUrl: string) => void,
  isCancelled: () => boolean,
  limit: number,
): Promise<void> {
  const queue = [...ids];
  async function worker() {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      if (isCancelled()) return;
      try {
        const url = await fetchOne(id);
        if (url && !isCancelled()) onResult(id, url);
      } catch {
        // Janela que sumiu ou protegida: o cartão fica sem imagem.
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, worker));
}

export function loadThumbnails(
  ids: string[],
  onThumbnail: (id: string, dataUrl: string) => void,
  isCancelled: () => boolean,
  limit = 2,
): Promise<void> {
  return loadEach(ids, (id) => nativeThumbnail(id), onThumbnail, isCancelled, limit);
}

export function loadIcons(
  ids: string[],
  onIcon: (id: string, dataUrl: string) => void,
  isCancelled: () => boolean,
  limit = 2,
): Promise<void> {
  return loadEach(ids, nativeIcon, onIcon, isCancelled, limit);
}
