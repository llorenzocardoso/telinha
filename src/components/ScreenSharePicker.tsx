import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ShareQuality } from "../hooks/useTelinhaRoom";
import { isTauriRuntime } from "../lib/runtime";
import { ShareCancelledError } from "../media/displayShare";
import {
  WINDOWS_PICKER_ID,
  devRecord,
  getNativeCapability,
  nativeShareFlag,
  setNativeShareFlag,
  type NativeCapability,
  type RecordSummary,
} from "../media/nativeShare";
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
import { NativeSourcePicker } from "./NativeSourcePicker";
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
  // Experimental: seletor próprio com miniaturas, só quando o interruptor está ligado.
  const [nativeFlag, setNativeFlag] = useState(() => nativeShareFlag());
  const [capability, setCapability] = useState<NativeCapability | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recorded, setRecorded] = useState<RecordSummary | null>(null);
  const nativeReady = nativeFlag && capability?.available === true;

  useEffect(() => {
    if (!nativeFlag) return;
    let cancelled = false;
    getNativeCapability()
      .then((found) => {
        if (!cancelled) setCapability(found);
      })
      .catch(() => {
        if (!cancelled) {
          setCapability({ available: false, vendor: "none", encoder: "", reason: "falha ao consultar" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [nativeFlag]);

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
        nativeReady && sourceId ? sourceId : WINDOWS_PICKER_ID,
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

  async function record() {
    if (!sourceId) return;
    setRecording(true);
    setRecorded(null);
    setError(null);
    try {
      const quality = shareQualityFrom(choice, { includeAudio: false, preferH264: true });
      setRecorded(
        await devRecord(
          sourceId,
          5,
          quality.maxHeight ?? 0,
          quality.fps,
          Math.round((quality.maxBitrate ?? 8_000_000) / 1_000_000),
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRecording(false);
    }
  }

  function toggleNativePicker(next: boolean) {
    setNativeShareFlag(next);
    setNativeFlag(next);
    setCapability(null);
    setSourceId(null);
    setError(null);
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
          <Button
            variant="primary"
            size="lg"
            disabled={sharing || (nativeReady && !sourceId)}
            onClick={() => void share()}
          >
            {sharing ? "Abrindo..." : nativeReady ? "Compartilhar" : "Escolher janela"}
          </Button>
        </>
      }
    >
      {nativeReady && <NativeSourcePicker value={sourceId} onChange={setSourceId} />}

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
          nativeReady
            ? "Tela: tudo menos o Discord. Janela: só o som desse aplicativo."
            : nativeRuntime
              ? "O Discord fica de fora quando está aberto."
              : "Inclui áudio quando a fonte escolhida permitir."
        }
        checked={includeAudio}
        onChange={(next) => {
          setIncludeAudio(next);
          localStorage.setItem(AUDIO_KEY, next ? "1" : "0");
        }}
      />

      {nativeRuntime && (
        <Switch
          label="Seletor de telas próprio (experimental)"
          hint="Escolha telas e janelas aqui dentro, com miniaturas e envio direto pelo app."
          checked={nativeFlag}
          onChange={toggleNativePicker}
        />
      )}

      {!nativeReady && (
        <p className="share-note">
          {nativeRuntime
            ? "O Windows mostra aplicativos e monitores no próximo passo."
            : "O navegador mostra abas, janelas e monitores no próximo passo."}
        </p>
      )}
      {nativeFlag && capability && !capability.available && (
        <p className="share-note">
          Compartilhamento nativo indisponível ({capability.reason ?? "sem codificador por GPU"});
          usando o seletor do Windows.
        </p>
      )}

      {nativeReady && import.meta.env.DEV && (
        <div className="share-dev">
          <span>
            Experimental · {capability?.encoder}. Teste de captura: grava a fonte escolhida por 5 s
            na pasta temporária, sem enviar nada.
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={!sourceId || recording}
            onClick={() => void record()}
          >
            {recording ? "Gravando…" : "Gravar 5 s (teste)"}
          </Button>
          {recorded && (
            <span data-testid="share-dev-result">
              {recorded.frames} quadros, {recorded.keyframes} keyframe(s),{" "}
              {(recorded.bytes / 1_000_000).toFixed(1)} MB, {recorded.width}×{recorded.height},{" "}
              {recorded.avgLatencyMs.toFixed(1)} ms · {recorded.path}
            </span>
          )}
        </div>
      )}

      {error && (
        <p className="share-error" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
