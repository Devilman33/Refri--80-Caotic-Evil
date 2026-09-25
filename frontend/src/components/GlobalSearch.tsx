import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { api } from "../api/client";
import type { SampleWithLocation } from "../api/types";
import { parseViewerQuery } from "../three/freezerLayout";

const DEBOUNCE_MS = 300;
const MAX_SUGGESTIONS = 8;

export interface GlobalSearchProps {
  /** Un solo resultado (o una sugerencia elegida): ir a su posición en el 3D con el detalle. */
  onPickSample: (sample: SampleWithLocation) => void;
  /** Varios resultados: la tabla filtrada por ese texto. */
  onShowMany: (query: string, includeWithdrawn: boolean) => void;
  /** Una ubicación (`A5`, `A5-3B`): el 3D enfocado en esa caja o posición. */
  onLocation: (query: string) => void;
  /** Mensaje que llega de afuera, p. ej. "No existe el rack Z" desde el visor. */
  message?: string | null;
}

type Suggestion = { kind: "location"; query: string } | { kind: "sample"; sample: SampleWithLocation };

/** Una ubicación con caja (`A5`, `A5-3B`). La letra sola no cuenta: casi todos los IDs
 * empiezan con letra y escribir "B" no puede saltar al rack B. */
function isLocation(text: string): boolean {
  const parsed = parseViewerQuery(text);
  return parsed.ok && parsed.boxNumber !== null;
}

/**
 * Buscador de la barra superior: ID Environ, ID Origen o ubicación.
 *
 *   tecla ─► debounce ─► ¿ubicación? ─ sí ─► sugerencia "Ir a A5-3B"
 *                          │
 *                          └──────────► /samples/search?q=…&status=active
 *                                        (la respuesta de un pedido viejo se descarta)
 *   Enter ─► sugerencia marcada, o: 0 → mensaje · 1 → onPickSample · N → onShowMany
 */
export function GlobalSearch({ onPickSample, onShowMany, onLocation, message }: GlobalSearchProps) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestSeq = useRef(0);
  const [text, setText] = useState("");
  const [results, setResults] = useState<SampleWithLocation[]>([]);
  const [total, setTotal] = useState(0);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "empty">("idle");

  const query = text.trim();
  const suggestions: Suggestion[] = [
    ...(isLocation(query) ? [{ kind: "location", query } as const] : []),
    ...results.map((sample) => ({ kind: "sample", sample }) as const),
  ];

  // `/` enfoca el buscador desde cualquier parte, salvo mientras se escribe en otro campo.
  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName))) return;
      event.preventDefault();
      inputRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function search(value: string): Promise<{ items: SampleWithLocation[]; total: number } | null> {
    const seq = ++requestSeq.current;
    setStatus("loading");
    return api
      .searchSamples({ q: value, status: "active", page: 1, page_size: MAX_SUGGESTIONS })
      .then((page) => {
        // Escribir "BP0" y luego "BP01": si la respuesta de "BP0" llega después, se descarta.
        if (seq !== requestSeq.current) return null;
        setResults(page.items);
        setTotal(page.total);
        setStatus(page.total === 0 ? "empty" : "idle");
        return page;
      })
      .catch(() => {
        if (seq === requestSeq.current) setStatus("error");
        return null;
      });
  }

  useEffect(() => {
    setActive(-1);
    if (query.length < 2) {
      requestSeq.current += 1;
      setResults([]);
      setTotal(0);
      setStatus("idle");
      return;
    }
    const timer = window.setTimeout(() => void search(query), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    // `search` solo usa setters y refs estables: no hace falta como dependencia.
  }, [query]);

  function reset() {
    requestSeq.current += 1;
    setText("");
    setResults([]);
    setTotal(0);
    setStatus("idle");
    setOpen(false);
    setActive(-1);
  }

  function choose(suggestion: Suggestion) {
    if (suggestion.kind === "location") onLocation(suggestion.query);
    else onPickSample(suggestion.sample);
    reset();
  }

  async function submit() {
    if (active >= 0 && suggestions[active]) {
      choose(suggestions[active]);
      return;
    }
    if (!query) return;
    if (isLocation(query)) {
      choose({ kind: "location", query });
      return;
    }
    const page = await search(query);
    if (!page) return;
    if (page.total === 1) choose({ kind: "sample", sample: page.items[0] });
    else if (page.total > 1) {
      onShowMany(query, false);
      reset();
    } else setOpen(true);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && suggestions.length) {
      event.preventDefault();
      setOpen(true);
      setActive((index) => (index + 1) % suggestions.length);
    } else if (event.key === "ArrowUp" && suggestions.length) {
      event.preventDefault();
      setOpen(true);
      setActive((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      void submit();
    } else if (event.key === "Escape") {
      if (open) setOpen(false);
      else reset();
    }
  }

  const showList = open && query.length > 0 && (suggestions.length > 0 || status !== "idle");
  const optionId = (index: number) => `${listId}-opcion-${index}`;

  return (
    <div className="global-search">
      <label htmlFor={`${listId}-input`} className="sr-only">
        Buscar muestra o ubicación
      </label>
      <input
        ref={inputRef}
        id={`${listId}-input`}
        type="search"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={active >= 0 ? optionId(active) : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder="ID, ID Origen o ubicación (A5-3B)"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={handleKeyDown}
      />
      <kbd className="global-search__key" aria-hidden="true">
        /
      </kbd>
      {showList && (
        <div className="global-search__list">
          <ul id={listId} role="listbox" aria-label="Resultados">
            {suggestions.map((suggestion, index) => (
              <li
                key={suggestion.kind === "location" ? "ubicacion" : suggestion.sample.id}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                className={index === active ? "active" : undefined}
                // mousedown y no click: el blur del input cerraría la lista antes del click.
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(suggestion);
                }}
              >
                {suggestion.kind === "location" ? (
                  <>
                    <span className="global-search__id">{suggestion.query.toUpperCase()}</span>
                    <span className="global-search__meta">Ir a la ubicación en el freezer</span>
                  </>
                ) : (
                  <>
                    <span className="global-search__id">{suggestion.sample.environ_id ?? "Sin ID"}</span>
                    <span className="global-search__meta">{suggestion.sample.description ?? ""}</span>
                    <span className="global-search__loc">{suggestion.sample.location}</span>
                    {suggestion.sample.is_core && <span className="global-search__core">Núcleo</span>}
                  </>
                )}
              </li>
            ))}
          </ul>
          {total > results.length && (
            <button
              type="button"
              className="link-button global-search__more"
              onMouseDown={(event) => {
                event.preventDefault();
                onShowMany(query, false);
                reset();
              }}
            >
              Ver las {total} en la tabla
            </button>
          )}
        </div>
      )}
      <p className="global-search__msg" role="status">
        {status === "loading" && "Buscando…"}
        {status === "error" && (
          <>
            No se pudo buscar.{" "}
            <button type="button" className="link-button" onClick={() => void search(query)}>
              Reintentar
            </button>
          </>
        )}
        {status === "empty" && (
          <>
            No hay muestras activas con «{query}».{" "}
            <button
              type="button"
              className="link-button"
              onClick={() => {
                onShowMany(query, true);
                reset();
              }}
            >
              Buscar también retiradas
            </button>
          </>
        )}
        {status === "idle" && message}
      </p>
    </div>
  );
}
