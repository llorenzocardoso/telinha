import type { ShareQuality } from "../hooks/useTelinhaRoom";

export const QUALITY_KEY = "telinha-share-quality";

/** Altura escolhida; 0 significa "Original", sem limite de largura nem de altura. */
export type ShareHeight = 0 | 720 | 1080 | 1440;
export type ShareFps = 15 | 30 | 60;

export const SHARE_HEIGHTS: { value: ShareHeight; label: string }[] = [
  { value: 720, label: "720p" },
  { value: 1080, label: "1080p" },
  { value: 1440, label: "1440p" },
  { value: 0, label: "Original" },
];

export const SHARE_FPS: { value: ShareFps; label: string; hint?: string }[] = [
  { value: 15, label: "15 fps" },
  { value: 30, label: "30 fps" },
  { value: 60, label: "60 fps" },
];

export const FPS_HINTS: Record<ShareFps, string> = {
  15: "Economiza banda; bom pra slide e documento.",
  30: "Equilibrado pra quase tudo.",
  60: "Movimento lisinho, ideal pra jogo e vídeo.",
};

export interface SharePreset {
  id: "balanced" | "sharp" | "light";
  label: string;
  height: ShareHeight;
  fps: ShareFps;
}

/**
 * Os três atalhos equivalem exatamente aos presets antigos (standard, qhd e data), para
 * ninguém notar mudança de qualidade sem querer.
 */
export const SHARE_PRESETS: SharePreset[] = [
  { id: "balanced", label: "Equilibrado", height: 1080, fps: 60 },
  { id: "sharp", label: "Nítido", height: 1440, fps: 60 },
  { id: "light", label: "Leve", height: 720, fps: 30 },
];

/** Tabela única de bitrate, em bits por segundo, por resolução e taxa de quadros. */
const BITRATE: Record<ShareHeight, Record<ShareFps, number>> = {
  720: { 15: 2_000_000, 30: 4_000_000, 60: 6_000_000 },
  1080: { 15: 5_000_000, 30: 7_000_000, 60: 10_000_000 },
  1440: { 15: 8_000_000, 30: 12_000_000, 60: 16_000_000 },
  0: { 15: 12_000_000, 30: 18_000_000, 60: 24_000_000 },
};

const WIDTH_FOR: Record<ShareHeight, number> = {
  720: 1280,
  1080: 1920,
  1440: 2560,
  0: 0,
};

export interface ShareChoice {
  height: ShareHeight;
  fps: ShareFps;
}

export function bitrateFor(height: ShareHeight, fps: ShareFps): number {
  return BITRATE[height][fps];
}

export function resolutionLabel(height: ShareHeight): string {
  return SHARE_HEIGHTS.find((item) => item.value === height)?.label ?? "Original";
}

/** "1080p · 60 fps", para o título do diálogo e o rótulo da prévia. */
export function shareSummary(choice: ShareChoice): string {
  return `${resolutionLabel(choice.height)} · ${choice.fps} fps`;
}

/** O atalho que bate com a combinação, ou null quando ela é personalizada. */
export function presetFor(choice: ShareChoice): SharePreset | null {
  return (
    SHARE_PRESETS.find(
      (preset) => preset.height === choice.height && preset.fps === choice.fps,
    ) ?? null
  );
}

/** Monta a ShareQuality que o hook de captura espera. */
export function shareQualityFrom(
  choice: ShareChoice,
  options: { includeAudio: boolean; preferH264: boolean },
): ShareQuality {
  const quality: ShareQuality = {
    fps: choice.fps,
    maxWidth: WIDTH_FOR[choice.height],
    maxBitrate: bitrateFor(choice.height, choice.fps),
    includeAudio: options.includeAudio,
    preferH264: options.preferH264,
  };
  // "Original" não manda largura nem altura, então o Windows entrega a tela como ela é.
  if (choice.height > 0) quality.maxHeight = choice.height;
  return quality;
}

const DEFAULT_CHOICE: ShareChoice = { height: 1080, fps: 60 };

/**
 * Lê a preferência salva. O formato antigo guardava só o índice do preset (0, 1 ou 2);
 * ele continua sendo entendido, para quem já usa não perder a escolha.
 */
export function parseShareChoice(raw: string | null): ShareChoice {
  if (raw === null) return DEFAULT_CHOICE;
  const value = raw.trim();
  if (value === "") return DEFAULT_CHOICE;

  // Formato antigo: o índice do preset na ordem standard, qhd, data.
  if (/^\d$/.test(value)) {
    const legacy: ShareChoice[] = [
      { height: 1080, fps: 60 },
      { height: 1440, fps: 60 },
      { height: 720, fps: 30 },
    ];
    return legacy[Number(value)] ?? DEFAULT_CHOICE;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return DEFAULT_CHOICE;
    const { height, fps } = parsed as { height?: unknown; fps?: unknown };
    return {
      height: isHeight(height) ? height : DEFAULT_CHOICE.height,
      fps: isFps(fps) ? fps : DEFAULT_CHOICE.fps,
    };
  } catch {
    return DEFAULT_CHOICE;
  }
}

export function serializeShareChoice(choice: ShareChoice): string {
  return JSON.stringify({ height: choice.height, fps: choice.fps });
}

function isHeight(value: unknown): value is ShareHeight {
  return SHARE_HEIGHTS.some((item) => item.value === value);
}

function isFps(value: unknown): value is ShareFps {
  return SHARE_FPS.some((item) => item.value === value);
}
