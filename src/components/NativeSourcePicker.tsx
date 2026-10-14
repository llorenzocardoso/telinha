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
  /** Id da fonte escolhida (`screen:…` ou `window:…`), ou null enquanto nada foi escolhido. */
  value: string | null;
  onChange: (id: string) => void;
}

type Kind = NativeSource["kind"];

function describe(source: NativeSource): string {
  const size = source.width && source.height ? `${source.width}×${source.height}` : "";
  return [source.kind === "window" ? source.app : null, size].filter(Boolean).join(" · ");
}

/** Grade de telas e janelas com miniaturas, no lugar do seletor do Windows. */
export function NativeSourcePicker({ value, onChange }: NativeSourcePickerProps) {
  const [sources, setSources] = useState<NativeSource[] | null>(null);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [icons, setIcons] = useState<Record<string, string>>({});
  const [kind, setKind] = useState<Kind>("screen");
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const valueRef = useRef(value);
  valueRef.current = value;

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
      const { screens } = groupSources(found);
      const stillThere = found.some((source) => source.id === valueRef.current);
      if (!stillThere && screens[0]) onChange(screens[0].id);
      // Os ícones são pequenos e ajudam a achar a janela; vêm primeiro, as miniaturas depois.
      await loadIcons(
        found.filter((source) => source.kind === "window").map((source) => source.id),
        (id, url) => setIcons((current) => ({ ...current, [id]: url })),
        cancelled,
      );
      await loadThumbnails(
        found.map((source) => source.id),
        (id, url) => setThumbnails((current) => ({ ...current, [id]: url })),
        cancelled,
      );
    } catch (cause) {
      if (cancelled()) return;
      setError(cause instanceof Error ? cause.message : String(cause));
      setSources([]);
    }
  }, [onChange]);

  useEffect(() => {
    void refresh();
    return () => {
      generation.current += 1;
    };
  }, [refresh]);

  const { screens, windows } = useMemo(() => groupSources(sources ?? []), [sources]);
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
        onChange={setKind}
        options={[
          { value: "screen", label: `Telas (${screens.length})` },
          { value: "window", label: `Janelas (${windows.length})` },
        ]}
      />
      {sources === null && <p className="share-hint">Procurando telas e janelas…</p>}
      {sources !== null && visible.length === 0 && !error && (
        <p className="share-hint">
          {kind === "screen" ? "Nenhuma tela encontrada." : "Nenhuma janela aberta para compartilhar."}
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
          return (
            <button
              key={source.id}
              type="button"
              className={`source-card${selected ? " is-selected" : ""}`}
              aria-pressed={selected}
              onClick={() => onChange(source.id)}
            >
              <span className="source-thumb">
                {thumbnail ? <img src={thumbnail} alt="" draggable={false} /> : null}
              </span>
              <span className="source-title">
                {icons[source.id] && (
                  <img className="source-icon" src={icons[source.id]} alt="" draggable={false} />
                )}
                <span className="source-name" title={source.name}>
                  {source.name}
                </span>
              </span>
              <span className="source-meta">{describe(source)}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
