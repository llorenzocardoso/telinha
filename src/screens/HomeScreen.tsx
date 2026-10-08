import { useEffect, useState, type ReactNode } from "react";
import { createRoom, enterRoom, isValidRoomCode, type RoomSession } from "../lib/api";
import { roomCodeFromInput } from "../lib/roomCode";
import { Button } from "../components/ui";

const NAME_KEY = "telinha-display-name";
const MAX_NAME_LENGTH = 24;

interface HomeScreenProps {
  onJoin: (session: RoomSession) => void;
  error?: string | null;
  invite?: ReactNode;
  joining?: boolean;
  beforeEnter?: () => Promise<void>;
}

export function HomeScreen({
  onJoin,
  error: incomingError,
  invite,
  joining,
  beforeEnter,
}: HomeScreenProps) {
  const [displayName, setDisplayName] = useState(() => localStorage.getItem(NAME_KEY) ?? "");
  const [code, setCode] = useState("");
  const [operation, setOperation] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<string | null>(incomingError ?? null);
  const nickname = displayName.trim();
  const busy = operation !== null || Boolean(joining);
  const codeReady = isValidRoomCode(code);

  useEffect(() => {
    if (incomingError) setError(incomingError);
  }, [incomingError]);

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
          <h1>Telinha</h1>
          <p>Compartilhe sua tela em segundos.</p>
        </header>

        {/* Uma faixa única: o mesmo nome serve para criar e para entrar. */}
        <label className="home-name">
          <span>Seu nome</span>
          <input
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
          <section className="home-card is-primary" aria-labelledby="home-create">
            <h2 id="home-create">Criar sala</h2>
            <p>Você recebe um código pra mandar pra quem vai assistir.</p>
            <Button
              variant="primary"
              size="lg"
              block
              disabled={busy || !nickname}
              onClick={() => void handleCreate()}
            >
              {operation === "create" ? "Abrindo sala..." : "Criar sala"}
            </Button>
          </section>

          <section className="home-card" aria-labelledby="home-join">
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
                type="submit"
                variant="outline"
                size="lg"
                block
                disabled={busy || !codeReady || !nickname}
              >
                {operation === "join" || joining ? "Entrando..." : "Entrar na sala"}
              </Button>
            </form>
          </section>
        </div>

        {invite}

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
      </div>
    </main>
  );
}
