import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  groupSources,
  listNativeSources,
  loadIcons,
  loadThumbnails,
  type NativeSource,
} from "../media/nativeShare";
import { Button, SegmentedControl } from "./ui";

interface NativeSourcePickerProps {
  /** Id da fonte destacada (`screen:…` ou `window:…`), ou null. */
  value: string | null;
  /** Escolher uma fonte já avança: a tela de qualidade vem depois, como no Discord. */
  onPick: (source: NativeSource) => void;
}

type Kind = NativeSource["kind"];

export function describeSource(source: NativeSource): string {
  const size = source.width && source.height ? `${source.width}×${source.height}` : "";
  return [source.kind === "window" ? source.app : null, size].filter(Boolean).join(" · ");
}

/** Grade de aplicativos e telas com miniaturas, no lugar do seletor do Windows. */
export function NativeSourcePicker({ value, onPick }: NativeSourcePickerProps) {
  const [sources, setSources] = useState<NativeSource[] | null>(null);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [icons, setIcons] = useState<Record<string, string>>({});
  const [pickedKind, setPickedKind] = useState<Kind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++generation.current;
    const cancelled = () => generation.current !== mine;
    setError(null);
    setThumbnails({});
    setIcons({});
    try {
      const found = await listNativeSources();
      if (cancelled()) return;
      setSources(found);
      // Os ícones são pequenos e ajudam a achar a janela; vêm primeiro, as miniaturas depois.
      await loadIcons(
        found.filter((source) => source.kind === "window").map((source) => source.id),
        (id, url) => setIcons((current) => ({ ...current, [id]: url })),
        cancelled,
      );
      // Uma janela minimizada não tem imagem para mostrar: o ícone fica no lugar.
      await loadThumbnails(
        found.filter((source) => !source.minimized).map((source) => source.id),
        (id, url) => setThumbnails((current) => ({ ...current, [id]: url })),
        cancelled,
      );
    } catch (cause) {
      if (cancelled()) return;
      setError(cause instanceof Error ? cause.message : String(cause));
      setSources([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      generation.current += 1;
    };
  }, [refresh]);

  const { screens, windows } = useMemo(() => groupSources(sources ?? []), [sources]);
  // Abre nos aplicativos, como o Discord; sem nenhum, nas telas. Depois vale o que a pessoa clicar.
  const kind: Kind = pickedKind ?? (windows.length > 0 ? "window" : "screen");
  const visible = kind === "screen" ? screens : windows;

  return (
    <section className="share-field source-picker">
      <header>
        <strong>O que compartilhar</strong>
        <Button variant="ghost" size="sm" onClick={() => void refresh()}>
          Atualizar
        </Button>
      </header>
      <SegmentedControl
        label="Tipo de fonte"
        value={kind}
        onChange={setPickedKind}
        options={[
          { value: "window", label: "Aplicativos" },
          { value: "screen", label: "Telas" },
        ]}
      />
      {sources === null && <p className="share-hint">Procurando aplicativos e telas…</p>}
      {sources !== null && visible.length === 0 && !error && (
        <p className="share-hint">
          {kind === "screen" ? "Nenhuma tela encontrada." : "Nenhum aplicativo aberto para compartilhar."}
        </p>
      )}
      {error && (
        <p className="share-error" role="alert">
          {error}
        </p>
      )}
      <div className="source-grid" role="group" aria-label="Fontes disponíveis">
        {visible.map((source) => {
          const selected = source.id === value;
          const thumbnail = thumbnails[source.id];
          const icon = icons[source.id];
          return (
            <button
              key={source.id}
              type="button"
              className={`source-card${selected ? " is-selected" : ""}`}
              aria-pressed={selected}
              onClick={() => onPick(source)}
            >
              <span className="source-thumb">
                {thumbnail ? (
                  <img src={thumbnail} alt="" draggable={false} />
                ) : icon ? (
                  <img className="source-thumb-icon" src={icon} alt="" draggable={false} />
                ) : null}
                {source.minimized && <span className="source-badge">Minimizada</span>}
              </span>
              <span className="source-title">
                {icon && <img className="source-icon" src={icon} alt="" draggable={false} />}
                <span className="source-name" title={source.name}>
                  {source.name}
                </span>
              </span>
              <span className="source-meta">{describeSource(source)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
