import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ShareQuality } from "../hooks/useTelinhaRoom";
import { isTauriRuntime } from "../lib/runtime";
import { ShareCancelledError } from "../media/displayShare";
import {
  FPS_HINTS,
  QUALITY_KEY,
  SHARE_FPS,
  SHARE_HEIGHTS,
  SHARE_PRESETS,
  parseShareChoice,
  presetFor,
  serializeShareChoice,
  shareQualityFrom,
  shareSummary,
  type ShareFps,
  type ShareHeight,
} from "../media/shareQuality";
import { Button, Dialog, SegmentedControl, Switch } from "./ui";

const AUDIO_KEY = "telinha-share-audio";

interface ScreenSharePickerProps {
  onCancel: () => void;
  onShare: (sourceId: string, quality: ShareQuality) => Promise<void>;
}

interface GpuEncodeInfo {
  available: boolean;
  vendor: string;
  name: string;
}

export function ScreenSharePicker({ onCancel, onShare }: ScreenSharePickerProps) {
  const nativeRuntime = isTauriRuntime();
  const [choice, setChoice] = useState(() => parseShareChoice(localStorage.getItem(QUALITY_KEY)));
  const [includeAudio, setIncludeAudio] = useState(
    () => localStorage.getItem(AUDIO_KEY) !== "0",
  );
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // H.264 é automático: entra quando há encoder por GPU, sem toggle na interface.
  const [gpuInfo, setGpuInfo] = useState<GpuEncodeInfo | null>(null);

  useEffect(() => {
    if (!nativeRuntime) {
      setGpuInfo({ available: false, vendor: "browser", name: "" });
      return;
    }
    void invoke<GpuEncodeInfo>("gpu_encode_info")
      .then(setGpuInfo)
      .catch(() => setGpuInfo({ available: false, vendor: "none", name: "" }));
  }, [nativeRuntime]);

  function choose(next: { height?: ShareHeight; fps?: ShareFps }) {
    const updated = { height: next.height ?? choice.height, fps: next.fps ?? choice.fps };
    setChoice(updated);
    localStorage.setItem(QUALITY_KEY, serializeShareChoice(updated));
  }

  async function share() {
    setSharing(true);
    setError(null);
    try {
      await onShare(
        "screen:windows-picker",
        shareQualityFrom(choice, {
          includeAudio,
          preferH264: Boolean(gpuInfo?.available),
        }),
      );
    } catch (cause) {
      // Cancelar a escolha de tela só devolve a pessoa ao diálogo, sem mensagem de erro.
      if (!(cause instanceof ShareCancelledError)) {
        setError(cause instanceof Error ? cause.message : "Não foi possível compartilhar");
      }
      setSharing(false);
    }
  }

  const preset = presetFor(choice);

  return (
    <Dialog
      title="Compartilhar tela"
      summary={shareSummary(choice)}
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" disabled={sharing} onClick={onCancel}>
            Cancelar
          </Button>
          <Button variant="primary" size="lg" disabled={sharing} onClick={() => void share()}>
            {sharing ? "Abrindo..." : "Escolher janela"}
          </Button>
        </>
      }
    >
      <section className="share-field">
        <header>
          <strong>Atalhos rápidos</strong>
          {/* "Personalizado" aparece sozinho quando a combinação não bate com um atalho. */}
          <span data-testid="share-preset-state">{preset ? preset.label : "Personalizado"}</span>
        </header>
        <div className="share-presets">
          {SHARE_PRESETS.map((item) => (
            <Button
              key={item.id}
              variant={preset?.id === item.id ? "primary" : "outline"}
              onClick={() => choose({ height: item.height, fps: item.fps })}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </section>

      <section className="share-field">
        <header>
          <strong>Resolução</strong>
        </header>
        <SegmentedControl
          label="Resolução"
          value={choice.height}
          onChange={(height) => choose({ height })}
          options={SHARE_HEIGHTS.map((item) => ({ value: item.value, label: item.label }))}
        />
      </section>

      <section className="share-field">
        <header>
          <strong>Taxa de quadros</strong>
        </header>
        <SegmentedControl
          label="Taxa de quadros"
          value={choice.fps}
          onChange={(fps) => choose({ fps })}
          options={SHARE_FPS.map((item) => ({ value: item.value, label: item.label }))}
        />
        <p className="share-hint">{FPS_HINTS[choice.fps]}</p>
      </section>

      <Switch
        label="Incluir som do computador"
        hint={
          nativeRuntime
            ? "O Discord fica de fora quando está aberto."
            : "Inclui áudio quando a fonte escolhida permitir."
        }
        checked={includeAudio}
        onChange={(next) => {
          setIncludeAudio(next);
          localStorage.setItem(AUDIO_KEY, next ? "1" : "0");
        }}
      />

      <p className="share-note">
        {nativeRuntime
          ? "O Windows mostra aplicativos e monitores no próximo passo."
          : "O navegador mostra abas, janelas e monitores no próximo passo."}
      </p>

      {error && (
        <p className="share-error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
