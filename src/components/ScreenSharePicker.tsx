import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ShareQuality } from "../hooks/useTelinhaRoom";
import { isTauriRuntime } from "../lib/runtime";

interface ScreenSharePickerProps {
  onCancel: () => void;
  onShare: (sourceId: string, quality: ShareQuality) => Promise<void>;
}

const QUALITY_PRESETS = [
  {
    id: "standard",
    name: "Padrão",
    hint: "1080p · 60fps",
    fps: 60,
    maxWidth: 1920,
    maxHeight: 1080,
    maxBitrate: 10_000_000,
  },
  {
    id: "qhd",
    name: "2K",
    hint: "1440p · 60fps",
    fps: 60,
    maxWidth: 2560,
    maxHeight: 1440,
    maxBitrate: 16_000_000,
  },
  {
    id: "data",
    name: "Leve",
    hint: "720p · 30fps",
    fps: 30,
    maxWidth: 1280,
    maxHeight: 720,
    maxBitrate: 4_000_000,
  },
] as const;

const QUALITY_KEY = "telinha-share-quality";
const AUDIO_KEY = "telinha-share-audio";
const GPU_KEY = "telinha-share-gpu";

interface GpuEncodeInfo {
  available: boolean;
  vendor: string;
  name: string;
}

function gpuEncodeDetail(info: GpuEncodeInfo | null): string {
  if (!info) return "Verificando aceleração de vídeo...";
  if (!info.available) {
    return "GPU compatível não detectada; VP8 será usado";
  }
  return info.name
    ? `Aceleração por GPU quando disponível · ${info.name}`
    : "Aceleração por GPU quando disponível";
}

function storedQualityIndex(): number {
  const value = Number(localStorage.getItem(QUALITY_KEY));
  return Number.isInteger(value) && value >= 0 && value < QUALITY_PRESETS.length ? value : 0;
}

export function ScreenSharePicker({ onCancel, onShare }: ScreenSharePickerProps) {
  const nativeRuntime = isTauriRuntime();
  const [qualityIndex, setQualityIndex] = useState(storedQualityIndex);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [includeAudio, setIncludeAudio] = useState(
    () => localStorage.getItem(AUDIO_KEY) !== "0",
  );
  const [gpuInfo, setGpuInfo] = useState<GpuEncodeInfo | null>(null);
  const [preferH264, setPreferH264] = useState(
    () => localStorage.getItem(GPU_KEY) !== "0",
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!nativeRuntime) {
      setGpuInfo({ available: false, vendor: "browser", name: "" });
      setPreferH264(false);
      return;
    }
    void invoke<GpuEncodeInfo>("gpu_encode_info")
      .then((info) => {
        setGpuInfo(info);
        if (!info.available) {
          setPreferH264(false);
        }
      })
      .catch(() => {
        setGpuInfo({ available: false, vendor: "none", name: "" });
        setPreferH264(false);
      });
  }, [nativeRuntime]);

  const quality = QUALITY_PRESETS[qualityIndex]!;

  async function handleShare() {
    setSharing(true);
    setError(null);
    try {
      await onShare("screen:windows-picker", {
        fps: quality.fps,
        maxWidth: quality.maxWidth,
        maxHeight: quality.maxHeight,
        maxBitrate: quality.maxBitrate,
        includeAudio,
        preferH264: Boolean(gpuInfo?.available && preferH264),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível compartilhar");
      setSharing(false);
    }
  }

  return (
    <div className="share-picker">
      <header className="share-preflight-header">
        <span className="share-preflight-icon" aria-hidden="true" />
        <div>
          <span className="share-preflight-eyebrow">Pré-transmissão</span>
          <h1>Compartilhar tela</h1>
          <p>
            {nativeRuntime
              ? "O Windows mostrará aplicativos e monitores no próximo passo."
              : "O navegador mostrará abas, janelas e monitores no próximo passo."}
          </p>
        </div>
      </header>

      <main className="share-settings">
        <div className="share-setting quality-cluster">
          <div className="share-setting-copy">
            <strong>Qualidade</strong>
            <span>Resolução e fluidez solicitadas ao Windows</span>
          </div>
          <div className="share-setting-control">
            <button
              type="button"
              className="quality-summary"
              onClick={() => setSettingsOpen((open) => !open)}
              aria-expanded={settingsOpen}
            >
              <strong>{quality.name}</strong>
              <span>{quality.hint}</span>
            </button>
            {settingsOpen && (
              <div className="quality-popover">
                <p>Qualidade da transmissão</p>
                {QUALITY_PRESETS.map((preset, index) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={index === qualityIndex ? "active" : ""}
                    onClick={() => {
                      setQualityIndex(index);
                      localStorage.setItem(QUALITY_KEY, String(index));
                      setSettingsOpen(false);
                    }}
                  >
                    <strong>{preset.name}</strong>
                    <span>{preset.hint}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <label className="share-setting share-toggle">
          <div className="share-setting-copy">
            <strong>Áudio do sistema</strong>
            <span>
              {nativeRuntime
                ? "Inclui o som do computador; o Discord fica de fora quando está aberto"
                : "Inclui áudio quando a fonte escolhida permitir"}
            </span>
          </div>
          <span className="share-setting-control">
            <input
              type="checkbox"
              checked={includeAudio}
              onChange={(event) => {
                setIncludeAudio(event.target.checked);
                localStorage.setItem(AUDIO_KEY, event.target.checked ? "1" : "0");
              }}
            />
            <span className="share-toggle-track" aria-hidden="true" />
          </span>
        </label>

        <label
          className={`share-setting share-toggle ${gpuInfo && !gpuInfo.available ? "is-disabled" : ""}`}
          title="Prefere H.264. O Chromium decide se o encoder da GPU será usado."
        >
          <div className="share-setting-copy">
            <strong>Preferir H.264</strong>
            <span>{gpuEncodeDetail(gpuInfo)}</span>
          </div>
          <span className="share-setting-control">
            <input
              type="checkbox"
              checked={Boolean(gpuInfo?.available && preferH264)}
              disabled={!gpuInfo?.available}
              onChange={(event) => {
                setPreferH264(event.target.checked);
                localStorage.setItem(GPU_KEY, event.target.checked ? "1" : "0");
              }}
            />
            <span className="share-toggle-track" aria-hidden="true" />
          </span>
        </label>
      </main>

      {error && <p className="share-preflight-error">{error}</p>}

      <footer className="share-picker-footer">
        <p>Você escolherá a fonte uma única vez.</p>
        <div className="share-picker-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={sharing}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-go-live"
            onClick={() => void handleShare()}
            disabled={sharing}
          >
            {sharing ? "Abrindo..." : "Continuar"}
          </button>
        </div>
      </footer>
    </div>
  );
}
