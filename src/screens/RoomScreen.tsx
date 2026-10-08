import { useEffect, useRef, useState } from "react";
import { PhoneOff } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { RoomSession } from "../lib/api";
import { inviteLink } from "../lib/trayLive";
import {
  ConnectionState,
  useTelinhaRoom,
  type ScreenShareInfo,
} from "../hooks/useTelinhaRoom";
import { ConnectionBadge, ErrorNotice } from "../components/ConnectionStatus";
import { areSoundsEnabled, setSoundsEnabled } from "../lib/sounds";
import { addWatching, mosaicColumns, pruneWatching, removeWatching } from "../lib/watch";
import { ScreenSharePicker } from "../components/ScreenSharePicker";
import { VideoTile } from "../components/VideoTile";
import { LiveControls } from "../components/LiveControls";

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
  const [watchingIds, setWatchingIds] = useState<string[]>([]);
  const [volume, setVolume] = useState(() => {
    const stored = Number(localStorage.getItem("telinha-watch-volume"));
    return Number.isFinite(stored) ? Math.min(100, Math.max(0, stored)) : 100;
  });
  const [chromeVisible, setChromeVisible] = useState(true);
  const [controlsLocked, setControlsLocked] = useState(false);
  const [watchFullscreen, setWatchFullscreen] = useState(() => {
    return localStorage.getItem("telinha-watch-fullscreen") === "1";
  });
  const [roomSounds, setRoomSounds] = useState(areSoundsEnabled);
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
    screenShares,
    participants,
    watcherCounts,
    watcherNames,
    connectionQuality,
    copyDiagnostics,
    retryConnections,
    startShare,
    stopShare,
    setWatchingShare,
    error,
  } = useTelinhaRoom(session, { onSessionRefresh, onUpdateRequired });

  useEffect(() => {
    onSharingChange?.(isSharing);
  }, [isSharing, onSharingChange]);

  useEffect(() => {
    void invoke("set_discord_presence", { code: session.code }).catch(() => undefined);
    return () => {
      void invoke("set_discord_presence", { code: null }).catch(() => undefined);
    };
  }, [session.code]);

  const displayName = session.displayName;
  const localId = session.participantId;
  const remoteShares = screenShares.filter((share) => share.participantIdentity !== localId);
  const localShare = screenShares.find((share) => share.participantIdentity === localId);
  const watchingShares = watchingIds
    .map((id) => remoteShares.find((share) => share.participantIdentity === id))
    .filter((share): share is NonNullable<typeof share> => Boolean(share));
  const watching = watchingShares.length > 0 && !pickerOpen;
  const hosting = isSharing && !watching && !pickerOpen;
  const multiWatch = watchingShares.length > 1;
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
          : "lobby";
    void invoke("set_window_layout", { layout }).catch(() => undefined);
  }, [pickerOpen, watching, hosting, watchFullscreen, multiWatch]);

  useEffect(() => {
    localStorage.setItem("telinha-watch-fullscreen", watchFullscreen ? "1" : "0");
  }, [watchFullscreen]);

  useEffect(() => {
    localStorage.setItem("telinha-watch-volume", String(volume));
  }, [volume]);

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

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
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
  }, [pickerOpen, watching, watchFullscreen]);

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
          await copyWithToast(inviteLink(session.code), "Link de compartilhamento copiado");
          setPickerOpen(false);
        }}
      />
    );
  }

  if (watching) {
    return (
      <div
        className={`screen room-screen watching ${watchFullscreen ? "watching-full" : "watching-window"} ${multiWatch ? "watching-mosaic" : ""} ${chromeVisible ? "chrome-on" : "chrome-off"}`}
      >
        {watchingShares.map(
          (share) =>
            share.stream && (
              <WatchAudio
                key={share.participantIdentity}
                stream={share.stream}
                volume={volume}
              />
            ),
        )}
        <header className="watch-chrome top">
          <div className="watch-heading">
            <div className="watch-live-title">
              <span className="watch-live-label"><span />Ao vivo</span>
              <strong>
                {multiWatch
                  ? `${watchingShares.length} transmissões`
                  : watchingShares[0]?.participantName}
              </strong>
            </div>
            {isSharing && (
              <div className="self-live-status">
                Sua tela está ao vivo · {localViewers} assistindo
              </div>
            )}
          </div>
          <ConnectionBadge quality={connectionQuality} />
        </header>

        <div
          className={`video-area ${multiWatch ? "mosaic" : ""}`}
          data-count={watchingShares.length}
          style={
            multiWatch
              ? { gridTemplateColumns: `repeat(${mosaicColumns(watchingShares.length)}, minmax(0, 1fr))` }
              : undefined
          }
        >
          {watchingShares.map((share) => (
            <div key={share.participantIdentity} className="watch-pane">
              {share.stream ? (
                <VideoTile stream={share.stream} active />
              ) : (
                <div className="video-placeholder">
                  <p>Conectando…</p>
                </div>
              )}
              {multiWatch && <span className="watch-pane-name">{share.participantName}</span>}
              {multiWatch && (
                <div className="watch-pane-actions">
                  <button
                    type="button"
                    className="watch-pane-close"
                    onClick={() => stopWatching(share.participantIdentity)}
                  >
                    Fechar
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {remoteShares.length > 1 && (
          <nav className="live-switcher overlay-tabs" aria-label="Escolher transmissão">
            <span className="live-switcher-label">Ao vivo</span>
            {remoteShares.map((share) => (
              <button
                key={share.participantIdentity}
                type="button"
                className={`live-switcher-item ${watchingIds.length === 1 && watchingIds.includes(share.participantIdentity) ? "active" : ""}`}
                aria-pressed={watchingIds.length === 1 && watchingIds.includes(share.participantIdentity)}
                onClick={() => watchOnly(share.participantIdentity)}
              >
                <span className="live-dot" aria-hidden="true" />
                {share.participantName}
              </button>
            ))}
            <button
              type="button"
              className={`live-switcher-item grid-option ${watchingIds.length > 1 ? "active" : ""}`}
              aria-pressed={watchingIds.length > 1}
              onClick={watchAll}
            >
              <GridIcon />
              Ver em grade
            </button>
          </nav>
        )}

        <LiveControls
          volume={volume}
          fullscreen={watchFullscreen}
          connected={connected}
          isSharing={isSharing}
          onVolumeChange={setVolume}
          onToggleFullscreen={() => setWatchFullscreen((open) => !open)}
          onToggleShare={toggleOwnShare}
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
      </div>
    );
  }

  if (hosting) {
    return (
      <div className="screen room-screen host-screen">
        <header className="host-header">
          <div className="host-live-summary">
            <span className="watch-live-label"><span />Ao vivo</span>
            <div>
              <strong>Sua tela</strong>
              <small>
                {localViewers === 0
                  ? "Ninguém assistindo ainda"
                  : `${localViewers} ${localViewers === 1 ? "pessoa assistindo" : "pessoas assistindo"}`}
              </small>
            </div>
          </div>
          <div className="host-header-actions">
            <ConnectionBadge quality={connectionQuality} />
            <button type="button" className="room-code-copy" onClick={copyCode}>
              <span>Sala</span>
              <strong>{session.code}</strong>
              <small>{copied ? "Copiado" : "Copiar"}</small>
            </button>
          </div>
        </header>

        <div className="host-preview">
          {localShare?.stream ? (
            <>
              <VideoTile stream={localShare.stream} active />
              <span className="host-preview-label">Prévia da sua transmissão</span>
            </>
          ) : (
            <div className="video-placeholder">
              <p>Preparando preview...</p>
            </div>
          )}
        </div>

        {remoteShares.length > 0 && (
          <LiveChooser
            shares={remoteShares}
            title="Outras transmissões"
            compact
            onWatch={watchOnly}
            onWatchAll={watchAll}
          />
        )}

        <footer className="host-controls">
          <div className="host-viewers" aria-live="polite">
            {watcherNames[localId]?.length
              ? `Assistindo: ${watcherNames[localId]!.join(", ")}`
              : "Sua transmissão está pronta para receber espectadores"}
          </div>
          <div className="host-control-dock" aria-label="Controles da transmissão">
            <button
              type="button"
              className="host-control-button stop-share"
              onClick={() => void stopShare()}
            >
              <StopShareIcon />
              <span>Parar transmissão</span>
            </button>
            <button type="button" className="host-control-button leave-room" onClick={onLeave}>
              <PhoneOff aria-hidden="true" strokeWidth={2.2} />
              <span>Sair da sala</span>
            </button>
          </div>
          <div className="host-control-spacer" aria-hidden="true" />
        </footer>
        {error && (
          <ErrorNotice
            error={error}
            copied={diagnosticsCopied}
            onCopy={() => void copyDiagnosticReport()}
            onRetry={() => void retryConnections()}
          />
        )}
        <ToastStack toasts={toasts} onWatch={watchShare} />
      </div>
    );
  }

  return (
    <div className="screen room-screen lobby-screen">
      <header className="room-header lobby-header">
        <div className="room-statuses">
          <span className={`status ${connected ? "online" : ""}`}>
            {connected ? displayName : reconnecting ? "Reconectando..." : "Conectando..."}
          </span>
          <ConnectionBadge quality={connectionQuality} />
        </div>
        <div className="lobby-header-actions">
          <button
            type="button"
            className="btn btn-ghost notification-toggle"
            aria-label={roomSounds ? "Silenciar avisos da sala" : "Ativar avisos da sala"}
            aria-pressed={roomSounds}
            title={roomSounds ? "Silenciar avisos da sala" : "Ativar avisos da sala"}
            onClick={toggleRoomSounds}
          >
            <NotificationIcon muted={!roomSounds} />
            <span>Avisos</span>
          </button>
          <button type="button" className="btn btn-ghost lobby-leave" onClick={onLeave}>
            Sair
          </button>
        </div>
      </header>

      <main className="lobby-content">
        {reconnecting && <p className="reconnect-banner">A conexão caiu. Tentando de novo...</p>}

        <div className="lobby-code">
          <p>Código da sala</p>
          <strong>{session.code}</strong>
          <button type="button" className="btn btn-primary" onClick={copyCode}>
            {copied ? "Copiado!" : "Copiar código"}
          </button>
        </div>

        <div className="people-list">
          <p>Na sala</p>
          {participants.length === 0 && <span className="muted">Conectando pessoas...</span>}
          {participants.map((person) => (
            <span key={person.identity} className="person-chip">
              {person.name}
              {person.isLocal ? " (você)" : ""}
              {person.isSharing ? " · no ar" : ""}
              {!person.connected ? " · reconectando" : ""}
            </span>
          ))}
        </div>

        {remoteShares.length > 0 ? (
          <LiveChooser
            shares={remoteShares}
            title="Transmissões ao vivo"
            onWatch={watchOnly}
            onWatchAll={watchAll}
          />
        ) : (
          <p className="hint">Nenhuma transmissão no momento</p>
        )}
      </main>

      <footer className="room-footer lobby-footer">
        <button
          type="button"
          className="btn btn-share"
          onClick={() => setPickerOpen(true)}
          disabled={!connected}
        >
          <span className="share-icon" aria-hidden="true" />
          Compartilhar tela
        </button>
        <span className="shortcut-hint">Ctrl+Shift+S</span>
      </footer>

      {error && (
        <ErrorNotice
          error={error}
          copied={diagnosticsCopied}
          onCopy={() => void copyDiagnosticReport()}
          onRetry={() => void retryConnections()}
        />
      )}
      <ToastStack toasts={toasts} onWatch={watchShare} />
    </div>
  );
}

function NotificationIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
      {muted && <path d="m4 4 16 16" />}
    </svg>
  );
}

function LiveChooser({
  shares,
  title,
  compact,
  onWatch,
  onWatchAll,
}: {
  shares: ScreenShareInfo[];
  title: string;
  compact?: boolean;
  onWatch: (id: string) => void;
  onWatchAll: () => void;
}) {
  return (
    <section className={`live-chooser ${compact ? "compact" : ""}`} aria-label={title}>
      <header className="live-chooser-header">
        <div>
          <span className="live-dot" aria-hidden="true" />
          <strong>{title}</strong>
        </div>
        <span>{shares.length}</span>
      </header>
      <div className="live-choice-list">
        {shares.map((share) => (
          <button
            key={share.participantIdentity}
            type="button"
            className="live-choice"
            onClick={() => onWatch(share.participantIdentity)}
          >
            <span className="live-choice-screen" aria-hidden="true" />
            <span className="live-choice-copy">
              <strong>{share.participantName}</strong>
              <small>Transmitindo agora</small>
            </span>
            <span className="live-choice-action">Assistir</span>
          </button>
        ))}
      </div>
      {shares.length > 1 && (
        <button type="button" className="watch-grid-button" onClick={onWatchAll}>
          <GridIcon />
          Ver todas em grade
        </button>
      )}
    </section>
  );
}

function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function StopShareIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M9 9h6v4H9zM8 21h8M12 17v4" />
    </svg>
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

function WatchAudio({
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
    const tracks = stream.getAudioTracks();
    if (tracks.length === 0) return;
    const element = document.createElement("audio");
    element.autoplay = true;
    element.setAttribute("playsinline", "true");
    element.srcObject = new MediaStream(tracks);
    element.volume = volumeRef.current / 100;
    document.body.appendChild(element);
    elementRef.current = element;
    return () => {
      element.srcObject = null;
      element.remove();
      if (elementRef.current === element) {
        elementRef.current = null;
      }
    };
  }, [stream]);

  useEffect(() => {
    if (elementRef.current) {
      elementRef.current.volume = volume / 100;
    }
  }, [volume]);

  return null;
}
