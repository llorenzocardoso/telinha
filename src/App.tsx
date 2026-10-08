import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ClosePrompt } from "./components/ClosePrompt";
import { UpdatePrompt } from "./components/UpdatePrompt";
import { createRoom, enterRoom, fetchAppConfig, leaveRoomSession, type RoomSession } from "./lib/api";
import { APP_VERSION } from "./lib/protocol";
import { decideUpdate, findAvailableUpdate, installAvailableUpdate } from "./lib/updates";
import { actionFromUrls } from "./lib/deepLink";
import {
  clearActiveSession,
  flushPendingLeaves,
  loadActiveSession,
  queuePendingLeave,
  saveActiveSession,
} from "./lib/sessionStore";
import { HomeScreen } from "./screens/HomeScreen";
import { RoomScreen } from "./screens/RoomScreen";
import "./styles/tokens.css";
import "./App.css";

const NAME_KEY = "telinha-display-name";

interface PendingInvite {
  code: string;
  name?: string;
}

function displayName(override?: string): string {
  return override?.trim() || localStorage.getItem(NAME_KEY)?.trim() || "Amigo";
}

function App() {
  const [session, setSession] = useState<RoomSession | null>(loadActiveSession);
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [pendingInvite, setPendingInvite] = useState<PendingInvite | null>(null);
  const [pendingShare, setPendingShare] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [closePrompt, setClosePrompt] = useState(false);
  const [updatePrompt, setUpdatePrompt] = useState<{ required: boolean; version: string } | null>(null);
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [trayStartRequest, setTrayStartRequest] = useState(false);
  const sessionRef = useRef(session);
  const isSharingRef = useRef(false);
  const updateRequiredRef = useRef(false);
  const trayCreatingRef = useRef(false);

  const adoptSession = useCallback((next: RoomSession) => {
    sessionRef.current = next;
    saveActiveSession(next);
    setSession(next);
  }, []);

  const flushLeaves = useCallback(
    () => flushPendingLeaves((pending) => leaveRoomSession(pending)),
    [],
  );

  const releaseSession = useCallback(async (current: RoomSession) => {
    clearActiveSession();
    try {
      await leaveRoomSession(current);
    } catch {
      queuePendingLeave(current);
    }
  }, []);

  const leaveRoom = useCallback(async () => {
    const current = sessionRef.current;
    if (current) await releaseSession(current);
    sessionRef.current = null;
    setSession(null);
    setPendingShare(false);
    setIsSharing(false);
    setClosePrompt(false);
  }, [releaseSession]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    isSharingRef.current = isSharing;
  }, [isSharing]);

  useEffect(() => {
    updateRequiredRef.current = Boolean(updatePrompt?.required);
  }, [updatePrompt]);

  useEffect(() => {
    void invoke("set_tray_state", { roomActive: Boolean(session), sharing: isSharing }).catch(
      () => undefined,
    );
  }, [session, isSharing]);

  useEffect(() => {
    void flushLeaves();
  }, [flushLeaves]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listen("tray-start-live", () => {
      if (isSharingRef.current || updateRequiredRef.current || trayCreatingRef.current) return;
      if (sessionRef.current) {
        setTrayStartRequest(true);
        return;
      }
      trayCreatingRef.current = true;
      setJoinError(null);
      void flushLeaves()
        .then(() => createRoom(displayName()))
        .then((next) => {
          adoptSession(next);
          setTrayStartRequest(true);
        })
        .catch((err: Error) => setJoinError(err.message))
        .finally(() => {
          trayCreatingRef.current = false;
        });
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [adoptSession, flushLeaves]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [config, available] = await Promise.all([fetchAppConfig(), findAvailableUpdate()]);
      if (cancelled) return;
      const decision = decideUpdate({
        current: APP_VERSION,
        minimum: config?.minAppVersion,
        available,
      });
      if (!decision) return;
      setUpdatePrompt((current) => (current?.required ? current : decision));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function runUpdate() {
    setUpdating(true);
    setUpdateError(null);
    try {
      await installAvailableUpdate(setUpdateProgress);
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : "Não foi possível atualizar.");
      setUpdating(false);
    }
  }

  useEffect(() => {
    if (!session) return;
    saveActiveSession(session);
    const refresh = window.setInterval(() => saveActiveSession(session), 60_000);
    return () => window.clearInterval(refresh);
  }, [session]);

  useEffect(() => {
    if (!session) {
      void invoke("set_window_layout", { layout: "home" }).catch(() => undefined);
    }
  }, [session]);

  useEffect(() => {
    function applyUrls(urls: string[]) {
      const action = actionFromUrls(urls);
      if (!action) return;
      if (action.action === "join") {
        setJoinError(null);
        setPendingInvite({ code: action.code, name: action.name });
        void invoke("show_main_window").catch(() => undefined);
      }
      if (action.action === "share") {
        if (sessionRef.current) {
          setPendingShare(true);
        }
        void invoke("show_main_window").catch(() => undefined);
      }
      if (action.action === "open") {
        void invoke("show_main_window").catch(() => undefined);
      }
    }

    let unlisten: (() => void) | undefined;
    let cancelled = false;

    listen<string[]>("telinha-open-url", (event) => {
      applyUrls(event.payload);
    })
      .then((fn) => {
        if (cancelled) {
          fn();
          return;
        }
        unlisten = fn;
      })
      .catch(() => undefined);

    void import("@tauri-apps/plugin-deep-link")
      .then(async (deepLink) => {
        if (cancelled) return;
        const current = await deepLink.getCurrent();
        if (current?.length) {
          applyUrls(current);
        }
        const stop = await deepLink.onOpenUrl((urls) => applyUrls(urls));
        if (cancelled) {
          stop();
          return;
        }
        const previous = unlisten;
        unlisten = () => {
          stop();
          previous?.();
        };
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listen("app-quit-requested", () => {
      void leaveRoom().finally(() => {
        void invoke("quit_app").catch(() => undefined);
      });
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [leaveRoom]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listen("window-close-requested", () => {
      setClosePrompt(true);
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
  }, []);

  useEffect(() => {
    if (!pendingCode) return;
    let cancelled = false;
    void flushLeaves()
      .then(() => enterRoom(pendingCode, displayName()))
      .then((next) => {
        if (!cancelled) {
          adoptSession(next);
          setPendingCode(null);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setJoinError(err.message);
          setPendingCode(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [adoptSession, flushLeaves, pendingCode]);

  async function acceptInvite(invite: PendingInvite) {
    if (invite.name) {
      localStorage.setItem(NAME_KEY, invite.name.slice(0, 24));
    }
    if (sessionRef.current?.code === invite.code) {
      setPendingInvite(null);
      return;
    }
    if (sessionRef.current) {
      await leaveRoom();
    }
    setPendingInvite(null);
    setJoinError(null);
    setPendingShare(false);
    setPendingCode(invite.code);
  }

  const updateDialog = updatePrompt ? (
    <UpdatePrompt
      required={updatePrompt.required}
      version={updatePrompt.version}
      progress={updateProgress}
      error={updateError}
      updating={updating}
      onUpdate={() => void runUpdate()}
      onLater={() => setUpdatePrompt(null)}
    />
  ) : null;

  const closeDialog = closePrompt ? (
    <ClosePrompt
      inRoom={Boolean(session)}
      isSharing={isSharing}
      onMinimize={() => {
        setClosePrompt(false);
        void invoke("hide_main_window").catch(() => undefined);
      }}
      onLeaveRoom={() => {
        void leaveRoom();
      }}
      onQuit={() => {
        void leaveRoom().finally(() => {
          void invoke("quit_app").catch(() => undefined);
        });
      }}
      onCancel={() => setClosePrompt(false)}
    />
  ) : null;

  const inviteBanner = pendingInvite ? (
    <div className="notice">
      <strong>Entrar na sala {pendingInvite.code}?</strong>
      <p>
        {session
          ? `Você já está em ${session.code}. Confirmar troca para a sala ${pendingInvite.code} como ${displayName(pendingInvite.name)}.`
          : `Abrir a Telinha como ${displayName(pendingInvite.name)}.`}
      </p>
      <div className="notice-actions">
        <button type="button" className="btn btn-secondary" onClick={() => setPendingInvite(null)}>
          Agora não
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void acceptInvite(pendingInvite)}>
          Entrar
        </button>
      </div>
    </div>
  ) : null;

  if (session) {
    return (
      <div className="app-shell">
        {updateDialog}
        {closeDialog}
        {inviteBanner ? <div className="notice-overlay">{inviteBanner}</div> : null}
        <RoomScreen
          session={session}
          onLeave={() => void leaveRoom()}
          onSessionRefresh={adoptSession}
          onUpdateRequired={() => setUpdatePrompt({ required: true, version: APP_VERSION })}
          onSharingChange={setIsSharing}
          openPicker={pendingShare}
          onPickerOpened={() => setPendingShare(false)}
          trayStartRequest={trayStartRequest}
          onTrayStartHandled={() => setTrayStartRequest(false)}
        />
      </div>
    );
  }

  return (
    <>
      {updateDialog}
      {closeDialog}
      <HomeScreen
        onJoin={adoptSession}
        error={joinError}
        invite={inviteBanner}
        joining={Boolean(pendingCode)}
        beforeEnter={flushLeaves}
      />
    </>
  );
}

export default App;
