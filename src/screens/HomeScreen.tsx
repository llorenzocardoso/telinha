import { useEffect, useRef, useState } from "react";
import { createRoom, enterRoom, isValidRoomCode, type RoomSession } from "../lib/api";
import { roomCodeFromInput } from "../lib/roomCode";
import { isTauriRuntime } from "../lib/runtime";
import { Button } from "../components/ui";
import logo from "../assets/telinha-logo.svg";

const NAME_KEY = "telinha-display-name";
const RELEASES_URL = "https://github.com/llorenzocardoso/telinha/releases/latest";
const MAX_NAME_LENGTH = 24;

export interface HomeInvite {
  code: string;
  name?: string;
}

interface HomeScreenProps {
  onJoin: (session: RoomSession) => void;
  error?: string | null;
  /** Convite aberto por link: preenche o código e destaca o cartão de entrar. */
  invite?: HomeInvite | null;
  onDismissInvite?: () => void;
  joining?: boolean;
  beforeEnter?: () => Promise<void>;
}

export function HomeScreen({
  onJoin,
  error: incomingError,
  invite,
  onDismissInvite,
  joining,
  beforeEnter,
}: HomeScreenProps) {
  const [displayName, setDisplayName] = useState(() => localStorage.getItem(NAME_KEY) ?? "");
  const [code, setCode] = useState(invite?.code ?? "");
  const nameInput = useRef<HTMLInputElement>(null);
  const joinButton = useRef<HTMLButtonElement>(null);
  const [operation, setOperation] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<string | null>(incomingError ?? null);
  const nickname = displayName.trim();
  const busy = operation !== null || Boolean(joining);
  const codeReady = isValidRoomCode(code);

  useEffect(() => {
    if (incomingError) setError(incomingError);
  }, [incomingError]);

  // O convite vira o próprio formulário de entrar: vale o nome que estiver no campo.
  useEffect(() => {
    if (!invite) return;
    setCode(invite.code);
    const name =
      invite.name?.trim().slice(0, MAX_NAME_LENGTH) || nameInput.current?.value.trim() || "";
    setDisplayName(name);
    // Depois do render, quando o botão já está habilitado pelo nome.
    const focus = window.setTimeout(() => {
      (name ? joinButton.current : nameInput.current)?.focus();
    }, 0);
    return () => window.clearTimeout(focus);
  }, [invite]);

  function persistName() {
    localStorage.setItem(NAME_KEY, nickname);
    return nickname;
  }

  async function handleCreate() {
    if (!nickname) {
      setError("Digite seu nome para continuar.");
      return;
    }
    setOperation("create");
    setError(null);
    try {
      await beforeEnter?.();
      onJoin(await createRoom(persistName()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar a sala.");
    } finally {
      setOperation(null);
    }
  }

  async function handleJoin(event: React.FormEvent) {
    event.preventDefault();
    if (!codeReady) {
      setError("Digite o código de 6 caracteres da sala.");
      return;
    }
    if (!nickname) {
      setError("Digite seu nome para continuar.");
      return;
    }
    setOperation("join");
    setError(null);
    try {
      await beforeEnter?.();
      onJoin(await enterRoom(code, persistName()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível entrar na sala.");
    } finally {
      setOperation(null);
    }
  }

  return (
    <main className="screen home">
      <div className="home-shell">
        <header className="home-head">
          <img className="home-logo" src={logo} alt="" width={72} height={72} />
          <h1>Telinha</h1>
          <p>Compartilhe sua tela em segundos.</p>
        </header>

        {invite && (
          <div className="home-invite" role="status">
            <p>
              Você foi convidado para a sala <strong>{invite.code}</strong>. Confira seu nome e
              clique em <strong>Entrar na sala</strong>.
            </p>
            <button type="button" className="home-invite-dismiss" onClick={onDismissInvite}>
              Ignorar
            </button>
          </div>
        )}

        {/* Uma faixa única: o mesmo nome serve para criar e para entrar. */}
        <label className="home-name">
          <span>Seu nome</span>
          <input
            ref={nameInput}
            type="text"
            placeholder="Como você quer aparecer"
            value={displayName}
            maxLength={MAX_NAME_LENGTH}
            autoComplete="nickname"
            disabled={busy}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>

        <div className="home-cards">
          {/* Com convite, o destaque passa para o cartão de entrar. */}
          <section
            className={invite ? "home-card" : "home-card is-primary"}
            aria-labelledby="home-create"
          >
            <h2 id="home-create">Criar sala</h2>
            <p>Você recebe um código pra mandar pra quem vai assistir.</p>
            <Button
              variant={invite ? "outline" : "primary"}
              size="lg"
              block
              disabled={busy || !nickname}
              onClick={() => void handleCreate()}
            >
              {operation === "create" ? "Abrindo sala..." : "Criar sala"}
            </Button>
          </section>

          <section
            className={invite ? "home-card is-invited" : "home-card"}
            aria-labelledby="home-join"
          >
            <h2 id="home-join">Entrar</h2>
            <form className="home-join" onSubmit={handleJoin}>
              <input
                type="text"
                aria-label="Código ou link do convite"
                placeholder="Código ou link do convite"
                value={code}
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
                onChange={(event) => setCode(roomCodeFromInput(event.target.value))}
              />
              <Button
                ref={joinButton}
                type="submit"
                variant={invite ? "primary" : "outline"}
                size="lg"
                block
                disabled={busy || !codeReady || !nickname}
              >
                {operation === "join" || joining ? "Entrando..." : "Entrar na sala"}
              </Button>
            </form>
          </section>
        </div>

        {joining && (
          <p className="home-hint" aria-live="polite">
            Entrando na sala...
          </p>
        )}
        {error && (
          <p className="home-error" role="alert">
            {error}
          </p>
        )}

        <p className="home-note">Sem conta. A imagem vai direto entre vocês.</p>
        {!isTauriRuntime() && (
          <p className="home-note">
            Usa Windows?{" "}
            <a href={RELEASES_URL} target="_blank" rel="noreferrer">
              Baixe o app
            </a>{" "}
            para escolher telas com miniaturas e capturar o áudio do sistema.
          </p>
        )}
      </div>
    </main>
  );
}
