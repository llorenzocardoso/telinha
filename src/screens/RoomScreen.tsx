import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, BellOff, PhoneOff, Settings, Video, VideoOff } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { RoomSession } from "../lib/api";
import { inviteLink } from "../lib/trayLive";
import {
  ConnectionState,
  useTelinhaRoom,
  type ScreenShareInfo,
  type ShareQuality,
} from "../hooks/useTelinhaRoom";
import { ErrorNotice } from "../components/ConnectionStatus";
import { areSoundsEnabled, setSoundsEnabled } from "../lib/sounds";
import {
  addWatching,
  mosaicColumns,
  parseWatchVolumes,
  pruneWatching,
  removeWatching,
  setWatchVolume,
} from "../lib/watch";
import { ScreenSharePicker } from "../components/ScreenSharePicker";
import { CameraSettings } from "../components/CameraSettings";
import { CameraStrip } from "../components/CameraStrip";
import { VideoTile } from "../components/VideoTile";
import { LiveControls } from "../components/LiveControls";
import { RoomLayout } from "../components/RoomLayout";
import { describeParticipants } from "../room/participants";
import { Button, ConnectionIndicator, Dock, EmptyState, IconButton } from "../components/ui";

interface RoomScreenProps {
  session: RoomSession;
  onLeave: () => void;
  onSessionRefresh?: (session: RoomSession) => void;
  onUpdateRequired?: () => void;
  onSharingChange?: (sharing: boolean) => void;
  openPicker?: boolean;
  onPickerOpened?: () => void;
  trayStartRequest?: boolean;
  onTrayStartHandled?: () => void;
}

const VOLUMES_KEY = "telinha-watch-volumes";

/** "1080p · 60 fps" para o rótulo da prévia; "Original" quando não há limite de altura. */
function describeShareQuality(quality: ShareQuality | null): string {
  if (!quality) return "";
  const resolution = quality.maxHeight && quality.maxHeight > 0 ? `${quality.maxHeight}p` : "Original";
  return `${resolution} · ${quality.fps} fps`;
}

interface RoomToast {
  id: number;
  kind: "live" | "ended" | "copied" | "copy-failed";
  name: string;
  shareId?: string;
}

export function RoomScreen({
  session,
  onLeave,
  onSessionRefresh,
  onUpdateRequired,
  onSharingChange,
  openPicker,
  onPickerOpened,
  trayStartRequest,
  onTrayStartHandled,
}: RoomScreenProps) {
  const [copied, setCopied] = useState(false);
  const [diagnosticsCopied, setDiagnosticsCopied] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cameraSettingsOpen, setCameraSettingsOpen] = useState(false);
  const [watchingIds, setWatchingIds] = useState<string[]>([]);
  // Volume de cada transmissão nesta sala, por participante.
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  // Último volume usado com cada nome, para a pessoa voltar no mesmo nível em outra sessão.
  const [rememberedVolumes, setRememberedVolumes] = useState(() =>
    parseWatchVolumes(localStorage.getItem(VOLUMES_KEY)),
  );
  const [chromeVisible, setChromeVisible] = useState(true);
  const [controlsLocked, setControlsLocked] = useState(false);
  const [watchFullscreen, setWatchFullscreen] = useState(() => {
    return localStorage.getItem("telinha-watch-fullscreen") === "1";
  });
  const [roomSounds, setRoomSounds] = useState(areSoundsEnabled);
  // Qualidade escolhida no picker, só para o rótulo da prévia.
  const [shareQuality, setShareQuality] = useState<ShareQuality | null>(null);
  const [liveSince, setLiveSince] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [toasts, setToasts] = useState<RoomToast[]>([]);
  const knownLives = useRef<Map<string, string>>(new Map());
  const toastSeq = useRef(0);
  const hideTimer = useRef<number | null>(null);
  const codeRef = useRef(session.code);
  const isSharingRef = useRef(false);
  const stopShareRef = useRef<() => Promise<void>>(async () => undefined);
  const {
    connectionState,
    isSharing,
    isCameraOn,
    cameraSupported,
    screenShares,
    cameras,
    participants,
    watcherCounts,
    watcherNames,
    watcherIds,
    connectionQuality,
    copyDiagnostics,
    retryConnections,
    startShare,
    stopShare,
    startCamera,
    stopCamera,
    applyCameraDevice,
    setWatchingShare,
    error,
  } = useTelinhaRoom(session, { onSessionRefresh, onUpdateRequired });

  useEffect(() => {
    onSharingChange?.(isSharing || isCameraOn);
  }, [isSharing, isCameraOn, onSharingChange]);

  // O selo "Ao vivo" conta o tempo no ar; o relógio só corre enquanto há transmissão.
  useEffect(() => {
    if (!isSharing) {
      setLiveSince(null);
      return;
    }
    setLiveSince((current) => current ?? Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isSharing]);

  useEffect(() => {
    void invoke("set_discord_presence", { code: session.code }).catch(() => undefined);
    return () => {
      void invoke("set_discord_presence", { code: null }).catch(() => undefined);
    };
  }, [session.code]);
  const localId = session.participantId;
  const remoteShares = screenShares.filter((share) => share.participantIdentity !== localId);
  const localShare = screenShares.find((share) => share.participantIdentity === localId);
  const watchingShares = watchingIds
    .map((id) => remoteShares.find((share) => share.participantIdentity === id))
    .filter((share): share is NonNullable<typeof share> => Boolean(share));
  const watching = watchingShares.length > 0 && !pickerOpen;
  const hosting = isSharing && !watching && !pickerOpen;
  const multiWatch = watchingShares.length > 1;
  const hasCameras = cameras.length > 0;
  const remoteShareKey = remoteShares
    .map((share) => `${share.participantIdentity}\t${share.participantName}`)
    .join("\0");

  useEffect(() => {
    codeRef.current = session.code;
    isSharingRef.current = isSharing;
    stopShareRef.current = stopShare;
  });

  useEffect(() => {
    if (trayStartRequest) {
      onTrayStartHandled?.();
      if (isSharingRef.current) return;
      setPickerOpen(true);
    }
  }, [trayStartRequest, onTrayStartHandled]);

  useEffect(() => {
    if (openPicker) {
      onPickerOpened?.();
      setPickerOpen(true);
    }
  }, [openPicker, onPickerOpened]);

  useEffect(() => {
    const available = remoteShareKey
      ? remoteShareKey.split("\0").map((entry) => entry.split("\t")[0] ?? "")
      : [];
    setWatchingIds((current) => {
      const next = pruneWatching(current, available);
      return next.length === current.length && next.every((id, index) => id === current[index])
        ? current
        : next;
    });
  }, [remoteShareKey]);

  useEffect(() => {
    const next = new Map<string, string>();
    if (remoteShareKey) {
      for (const entry of remoteShareKey.split("\0")) {
        const [id, name] = entry.split("\t");
        if (id) next.set(id, name || "Alguém");
      }
    }
    const previous = knownLives.current;
    if (previous.size > 0) {
      for (const [id, name] of next) {
        if (!previous.has(id)) {
          toastSeq.current += 1;
          const idn = toastSeq.current;
          setToasts((current) => [...current, { id: idn, kind: "live", name, shareId: id }]);
          window.setTimeout(() => {
            setToasts((current) => current.filter((toast) => toast.id !== idn));
          }, 6000);
        }
      }
      for (const [id, name] of previous) {
        if (!next.has(id)) {
          toastSeq.current += 1;
          const idn = toastSeq.current;
          setToasts((current) => [...current, { id: idn, kind: "ended", name }]);
          window.setTimeout(() => {
            setToasts((current) => current.filter((toast) => toast.id !== idn));
          }, 4000);
        }
      }
    }
    knownLives.current = next;
  }, [remoteShareKey]);

  useEffect(() => {
    const layout = pickerOpen
      ? "picker"
      : watching
        ? watchFullscreen
          ? "watch"
          : multiWatch
            ? "watch-dual"
            : "watch-window"
        : hosting
          ? "host"
          : hasCameras
            ? "lobby-cameras"
            : "lobby";
    void invoke("set_window_layout", { layout }).catch(() => undefined);
  }, [pickerOpen, watching, hosting, watchFullscreen, multiWatch, hasCameras]);

  useEffect(() => {
    localStorage.setItem("telinha-watch-fullscreen", watchFullscreen ? "1" : "0");
  }, [watchFullscreen]);

  useEffect(() => {
    localStorage.setItem(VOLUMES_KEY, JSON.stringify(rememberedVolumes));
  }, [rememberedVolumes]);

  const watchedRef = useRef<string[]>([]);
  useEffect(() => {
    const previous = watchedRef.current;
    for (const id of watchingIds) {
      if (!previous.includes(id)) {
        setWatchingShare(id, true);
      }
    }
    for (const id of previous) {
      if (!watchingIds.includes(id)) {
        setWatchingShare(id, false);
      }
    }
    watchedRef.current = watchingIds;
  }, [setWatchingShare, watchingIds]);

  useEffect(() => {
    return () => {
      for (const id of watchedRef.current) {
        setWatchingShare(id, false);
      }
    };
  }, [setWatchingShare]);

  useEffect(() => {
    if (!watching) {
      setChromeVisible(true);
      if (hideTimer.current) {
        window.clearTimeout(hideTimer.current);
      }
      return;
    }

    function scheduleHide() {
      if (hideTimer.current) {
        window.clearTimeout(hideTimer.current);
      }
      if (controlsLocked) {
        setChromeVisible(true);
        return;
      }
      hideTimer.current = window.setTimeout(() => {
        setChromeVisible(false);
      }, 2000);
    }

    function onMove() {
      setChromeVisible(true);
      scheduleHide();
    }

    scheduleHide();
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (hideTimer.current) {
        window.clearTimeout(hideTimer.current);
      }
    };
  }, [controlsLocked, watching]);

  const closeCameraSettings = useCallback(() => {
    setCameraSettingsOpen(false);
    void applyCameraDevice();
  }, [applyCameraDevice]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (cameraSettingsOpen) {
          closeCameraSettings();
          return;
        }
        if (pickerOpen) {
          setPickerOpen(false);
          return;
        }
        if (watching && watchFullscreen) {
          setWatchFullscreen(false);
          return;
        }
        if (watching) {
          setWatchingIds([]);
        }
      }
      if (event.key === "F11" && watching) {
        event.preventDefault();
        setWatchFullscreen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cameraSettingsOpen, closeCameraSettings, pickerOpen, watching, watchFullscreen]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    listen("toggle-share", () => {
      if (isSharing) {
        void stopShare();
        return;
      }
      setPickerOpen(true);
    })
      .then((fn) => {
        if (cancelled) {
          fn();
          return;
        }
        unlisten = fn;
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [isSharing, stopShare]);

  function pushToast(kind: RoomToast["kind"], message: string) {
    toastSeq.current += 1;
    const idn = toastSeq.current;
    setToasts((current) => [...current, { id: idn, kind, name: message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== idn));
    }, 3000);
  }

  async function copyToClipboard(text: string): Promise<boolean> {
    try {
      await invoke("copy_to_clipboard", { text });
      return true;
    } catch {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        return false;
      }
    }
  }

  async function copyWithToast(text: string, successMessage: string) {
    const ok = await copyToClipboard(text);
    pushToast(ok ? "copied" : "copy-failed", ok ? successMessage : "Não foi possível copiar");
  }

  const copyWithToastRef = useRef(copyWithToast);
  copyWithToastRef.current = copyWithToast;

  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<() => void> = [];
    const handlers: Array<[string, () => void]> = [
      ["tray-copy-link", () => void copyWithToastRef.current(inviteLink(codeRef.current), "Link de compartilhamento copiado")],
      ["tray-copy-code", () => void copyWithToastRef.current(codeRef.current, "Código copiado")],
      [
        "tray-stop-live",
        () => {
          if (isSharingRef.current) void stopShareRef.current();
        },
      ],
    ];
    for (const [event, handler] of handlers) {
      listen(event, handler)
        .then((fn) => {
          if (cancelled) fn();
          else unlisteners.push(fn);
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
      unlisteners.forEach((fn) => fn());
    };
  }, []);

  async function copyCode() {
    try {
      await invoke("copy_to_clipboard", { text: session.code });
    } catch {
      await navigator.clipboard.writeText(session.code);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function copyDiagnosticReport() {
    const text = copyDiagnostics();
    try {
      await invoke("copy_to_clipboard", { text });
    } catch {
      await navigator.clipboard.writeText(text);
    }
    setDiagnosticsCopied(true);
    window.setTimeout(() => setDiagnosticsCopied(false), 2000);
  }

  const connected = connectionState === ConnectionState.Connected;
  const reconnecting = connectionState === ConnectionState.Reconnecting;
  const localViewers = watcherCounts[localId] ?? 0;
  const shareSummary = describeShareQuality(shareQuality);

  /** O RoomCode quer saber se a cópia deu certo para dar o retorno no próprio botão. */
  const copyRoomCode = useCallback(() => copyToClipboard(session.code), [session.code]);

  const people = useMemo(
    () =>
      describeParticipants({
        people: participants,
        localId,
        watching: watchingIds,
        watchers: watcherIds[localId] ?? [],
      }),
    [participants, localId, watchingIds, watcherIds],
  );

  function shareVolume(share: ScreenShareInfo): number {
    return volumes[share.participantIdentity] ?? rememberedVolumes[share.participantName] ?? 100;
  }

  function changeShareVolume(share: ScreenShareInfo, volume: number) {
    setVolumes((current) => setWatchVolume(current, share.participantIdentity, volume));
    setRememberedVolumes((current) => setWatchVolume(current, share.participantName, volume));
  }

  function watchShare(id: string) {
    setWatchingIds((current) =>
      current.includes(id) ? removeWatching(current, id) : addWatching(current, id),
    );
  }

  function stopWatching(id?: string) {
    if (!id) {
      setWatchingIds([]);
      return;
    }
    setWatchingIds((current) => removeWatching(current, id));
  }

  function watchAll() {
    setWatchingIds(remoteShares.map((share) => share.participantIdentity));
  }

  function watchOnly(id: string) {
    setWatchingIds([id]);
  }

  function toggleRoomSounds() {
    const next = !roomSounds;
    setRoomSounds(next);
    setSoundsEnabled(next);
  }

  function toggleCamera() {
    if (isCameraOn) {
      stopCamera();
      return;
    }
    void startCamera();
  }

  const cameraReady = connected && cameraSupported;
  const cameraLabel = isCameraOn ? "Desligar câmera" : "Ligar câmera";
  const cameraHint = cameraSupported
    ? cameraLabel
    : "O servidor desta sala ainda não aceita câmera";
  const cameraIcon = isCameraOn ? (
    <Video aria-hidden="true" strokeWidth={2.2} />
  ) : (
    <VideoOff aria-hidden="true" strokeWidth={2.2} />
  );
  const openCameraSettings = () => setCameraSettingsOpen(true);
  const cameraSettings = cameraSettingsOpen ? (
    <CameraSettings onClose={closeCameraSettings} />
  ) : null;

  function toggleOwnShare() {
    if (isSharing) {
      void stopShare();
      return;
    }
    setPickerOpen(true);
  }

  if (pickerOpen) {
    return (
      <ScreenSharePicker
        onCancel={() => setPickerOpen(false)}
        onShare={async (sourceId, quality) => {
          await startShare(sourceId, quality);
          setShareQuality(quality);
          await copyWithToast(inviteLink(session.code), "Link de compartilhamento copiado");
          setPickerOpen(false);
        }}
      />
    );
  }

  if (watching) {
    return (
      <div
        className={`screen watch ${watchFullscreen ? "is-full" : "is-window"} ${
          multiWatch ? "is-mosaic" : ""
        } ${chromeVisible ? "chrome-on" : "chrome-off"}`}
      >
        {watchingShares.map(
          (share) =>
            share.stream && (
              <WatchAudio
                key={share.participantIdentity}
                stream={share.stream}
                volume={shareVolume(share)}
              />
            ),
        )}

        {/* O vídeo ocupa a janela inteira; nada de barra fixa. */}
        <div
          className="watch-video"
          data-count={watchingShares.length}
          style={
            multiWatch
              ? {
                  gridTemplateColumns: `repeat(${mosaicColumns(watchingShares.length)}, minmax(0, 1fr))`,
                }
              : undefined
          }
        >
          {watchingShares.map((share) => (
            <div key={share.participantIdentity} className="watch-pane">
              {share.stream ? (
                <VideoTile stream={share.stream} active />
              ) : (
                <div className="watch-pane-empty">
                  <p>Conectando…</p>
                </div>
              )}
              {multiWatch && (
                <span className="watch-pane-name">{share.participantName}</span>
              )}
            </div>
          ))}
        </div>

        {/* Dois selos flutuantes: o que está na tela e o código da sala. */}
        <div className="watch-badges">
          <span className="watch-badge">
            <span className="watch-badge-dot" aria-hidden="true" />
            {multiWatch
              ? `${watchingShares.length} transmissões`
              : `Tela de ${watchingShares[0]?.participantName ?? ""}`}
          </span>
          <span className="watch-badge is-code">{session.code}</span>
        </div>

        <div className="watch-status">
          <ConnectionIndicator quality={connectionQuality} />
          {isSharing && (
            <span className="watch-self">Sua tela está ao vivo · {localViewers} assistindo</span>
          )}
        </div>

        <CameraStrip cameras={cameras} variant="overlay" onOpenSettings={openCameraSettings} />

        <LiveControls
          volumes={watchingShares.map((share) => ({
            id: share.participantIdentity,
            name: multiWatch ? share.participantName : undefined,
            volume: shareVolume(share),
            onChange: (next: number) => changeShareVolume(share, next),
          }))}
          choices={remoteShares.map((share) => ({
            id: share.participantIdentity,
            name: share.participantName,
            active: watchingIds.includes(share.participantIdentity),
          }))}
          fullscreen={watchFullscreen}
          connected={connected}
          isSharing={isSharing}
          cameraOn={isCameraOn}
          cameraReady={cameraReady}
          cameraLabel={cameraHint}
          sideBySide={multiWatch}
          onWatchOnly={watchOnly}
          onWatchAll={watchAll}
          onToggleFullscreen={() => setWatchFullscreen((open) => !open)}
          onToggleShare={toggleOwnShare}
          onToggleCamera={toggleCamera}
          onStopWatching={() => stopWatching()}
          onLeaveRoom={onLeave}
          onLockChange={setControlsLocked}
        />

        {error && (
          <ErrorNotice
            error={error}
            copied={diagnosticsCopied}
            onCopy={() => void copyDiagnosticReport()}
            onRetry={() => void retryConnections()}
            overlay
          />
        )}
        <ToastStack
          toasts={toasts}
          onWatch={(id) => {
            watchShare(id);
            setToasts((current) => current.filter((toast) => toast.shareId !== id));
          }}
        />
        {cameraSettings}
      </div>
    );
  }

  const stage = isSharing ? (
    <div className="stage-preview" data-testid="live-preview">
      {localShare?.stream ? (
        <VideoTile stream={localShare.stream} active />
      ) : (
        <div className="stage-placeholder">
          <p>Preparando a prévia...</p>
        </div>
      )}
      <span className="stage-preview-label">
        Prévia da sua tela{shareSummary ? ` · ${shareSummary}` : ""}
      </span>
    </div>
  ) : remoteShares.length > 0 ? (
    <EmptyState
      title={
        remoteShares.length === 1
          ? `Tela de ${remoteShares[0]!.participantName}`
          : `${remoteShares.length} transmissões ao vivo`
      }
      hint="Escolha quem assistir aqui ou na lista ao lado."
      actions={
        <>
          <Button variant="primary" onClick={() => watchOnly(remoteShares[0]!.participantIdentity)}>
            Assistir
          </Button>
          {remoteShares.length > 1 && (
            <Button variant="outline" onClick={watchAll}>
              Ver lado a lado
            </Button>
          )}
        </>
      }
    />
  ) : (
    <EmptyState
      title="Ninguém transmitindo ainda"
      hint="Mande o convite pra galera ou comece você mesmo pela barra abaixo."
      actions={
        <>
          <Button
            variant="tonal"
            onClick={() => void copyWithToast(inviteLink(session.code), "Convite copiado")}
          >
            Copiar convite
          </Button>
          <Button variant="outline" onClick={() => void copyCode()}>
            {copied ? "Copiado!" : "Copiar código"}
          </Button>
        </>
      }
    />
  );

  // A dock é igual nas duas telas: só o botão do meio troca de verbo.
  const dock = (
    <Dock label="Controles da sala" variant="fixed">
      <Button
        variant={isSharing ? "danger" : "primary"}
        size="lg"
        shortcut="Ctrl+Shift+S"
        disabled={!connected}
        onClick={toggleOwnShare}
      >
        {isSharing ? "Parar transmissão" : "Compartilhar tela"}
      </Button>
      <IconButton
        label={cameraHint}
        icon={cameraIcon}
        variant="tonal"
        active={isCameraOn}
        disabled={!cameraReady}
        onClick={toggleCamera}
      />
      <IconButton
        label="Escolher câmera"
        icon={<Settings aria-hidden="true" strokeWidth={1.8} />}
        onClick={openCameraSettings}
      />
      <Button
        variant="outline"
        onClick={() => void copyWithToast(inviteLink(session.code), "Convite copiado")}
      >
        Copiar convite
      </Button>
      <IconButton
        label={roomSounds ? "Silenciar avisos da sala" : "Ativar avisos da sala"}
        icon={
          roomSounds ? (
            <Bell aria-hidden="true" strokeWidth={1.8} />
          ) : (
            <BellOff aria-hidden="true" strokeWidth={1.8} />
          )
        }
        active={roomSounds}
        onClick={toggleRoomSounds}
      />
      <IconButton
        label="Sair da sala"
        icon={<PhoneOff aria-hidden="true" strokeWidth={1.8} />}
        variant="danger"
        onClick={onLeave}
      />
    </Dock>
  );

  return (
    <RoomLayout
      code={session.code}
      onCopyCode={copyRoomCode}
      connectionQuality={connectionQuality}
      airTimeMs={isSharing && liveSince !== null ? now - liveSince : undefined}
      people={people}
      stage={stage}
      dock={dock}
      onWatch={watchOnly}
    >
      <CameraStrip cameras={cameras} variant="row" onOpenSettings={openCameraSettings} />
      {isSharing && (
        <p className="room-viewers" aria-live="polite">
          {localViewers === 0
            ? "Ninguém assistindo ainda"
            : `Assistindo: ${watcherNames[localId]?.join(", ") ?? localViewers}`}
        </p>
      )}
      {reconnecting && <p className="room-banner">A conexão caiu. Tentando de novo...</p>}
      {error && (
        <ErrorNotice
          error={error}
          copied={diagnosticsCopied}
          onCopy={() => void copyDiagnosticReport()}
          onRetry={() => void retryConnections()}
        />
      )}
      <ToastStack toasts={toasts} onWatch={watchShare} />
      {cameraSettings}
    </RoomLayout>
  );
}

function ToastStack({
  toasts,
  onWatch,
}: {
  toasts: RoomToast[];
  onWatch: (shareId: string) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div className="room-toasts">
      {toasts.map((toast) => (
        <div key={toast.id} className={`room-toast ${toast.kind}`}>
          <span>
            {toast.kind === "live"
              ? `${toast.name} começou a transmitir`
              : toast.kind === "ended"
                ? `${toast.name} encerrou`
                : toast.name}
          </span>
          {toast.kind === "live" && toast.shareId && (
            <button type="button" className="btn btn-primary" onClick={() => onWatch(toast.shareId!)}>
              Assistir
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function WatchAudio({
  stream,
  volume,
}: {
  stream: MediaStream;
  volume: number;
}) {
  const elementRef = useRef<HTMLAudioElement | null>(null);
  const volumeRef = useRef(volume);
  volumeRef.current = volume;

  useEffect(() => {
    // O ontrack do vídeo chega antes do áudio, com o MESMO objeto MediaStream, então não
    // basta reagir à identidade da stream: é preciso escutar a faixa que chega depois.
    let element: HTMLAudioElement | null = null;

    function detach() {
      if (!element) return;
      element.srcObject = null;
      element.remove();
      if (elementRef.current === element) elementRef.current = null;
      element = null;
    }

    function sync() {
      const tracks = stream.getAudioTracks();
      if (tracks.length === 0) {
        detach();
        return;
      }
      if (!element) {
        element = document.createElement("audio");
        element.autoplay = true;
        element.setAttribute("playsinline", "true");
        document.body.appendChild(element);
        elementRef.current = element;
      }
      element.srcObject = new MediaStream(tracks);
      element.volume = volumeRef.current / 100;
      try {
        // O autoplay já cobre o caso; play() é só o empurrão para quem o ignora.
        const playing = element.play();
        if (playing && typeof playing.catch === "function") playing.catch(() => undefined);
      } catch {
        // Nem todo ambiente implementa play().
      }
    }

    sync();
    stream.addEventListener("addtrack", sync);
    stream.addEventListener("removetrack", sync);
    return () => {
      stream.removeEventListener("addtrack", sync);
      stream.removeEventListener("removetrack", sync);
      detach();
    };
  }, [stream]);

  useEffect(() => {
    if (elementRef.current) elementRef.current.volume = volume / 100;
  }, [volume]);

  return null;
}
