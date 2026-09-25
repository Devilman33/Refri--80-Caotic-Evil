import { useState } from "react";
import { api, ApiError } from "../api/client";
import type { IdLookupResult } from "../api/types";

export interface IdListSearchProps {
  onResult: (result: IdLookupResult | null) => void;
  onClose: () => void;
}

/**
 * Buscar una lista de IDs pegada o escaneada.
 *
 * Es un MODO, no un treceavo filtro: `.filters-bar` ya tiene doce controles y una textarea
 * no entra en esa grilla. Además la tarea es distinta — reconciliar tubos que se tienen en
 * la mano contra el inventario — y mezclarla con los filtros confundiría las dos.
 */
export function IdListSearch({ onResult, onClose }: IdListSearchProps) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[] | null>(null);

  // Mismo criterio de separadores que el backend, solo para el conteo en vivo.
  const count = text
    .split(/[,;\n\r\t ]+/)
    .map((chunk) => chunk.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean).length;

  async function search() {
    if (count === 0) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.lookupByIds(text);
      setMissing(result.missing);
      onResult(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo buscar la lista");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="panel">
      <div className="filters-actions" style={{ marginBottom: 8 }}>
        <strong>Buscar por lista de IDs</strong>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            onResult(null);
            onClose();
          }}
        >
          Volver a los filtros
        </button>
      </div>

      <p className="field-hint">
        Pegá o escaneá los IDs Environ. Sirven comas, punto y coma, espacios o un ID por
        línea. Mientras esta búsqueda esté activa, los demás filtros no se aplican.
      </p>

      <div className="field field--full">
        <label htmlFor="id-list">IDs</label>
        <textarea
          id="id-list"
          rows={4}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="BP001, BP002, BP003…"
        />
      </div>

      <div className="filters-actions">
        <span className="field-hint">{count === 1 ? "1 ID pegado" : `${count} IDs pegados`}</span>
        <button type="button" className="btn" onClick={() => void search()} disabled={count === 0 || loading}>
          {loading ? "Buscando…" : "Buscar"}
        </button>
      </div>

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      {/* Con 40 tubos en la mano, la pregunta no es cuáles aparecieron sino cuáles faltan.
          Por eso el bloque de no encontrados es el resultado principal, no una nota al pie. */}
      {missing !== null && missing.length > 0 && (
        <div className="panel" style={{ marginTop: 12 }}>
          <strong>No encontrados ({missing.length})</strong>
          <p className="field-hint" style={{ marginTop: 4 }}>
            Estos IDs no tienen ninguna muestra registrada:
          </p>
          <p>
            <code>{missing.join(", ")}</code>
          </p>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => void navigator.clipboard?.writeText(missing.join("\n"))}
          >
            Copiar los faltantes
          </button>
        </div>
      )}

      {missing !== null && missing.length === 0 && (
        <p className="field-notice" role="status" style={{ marginTop: 12 }}>
          Están todos: ninguno de los IDs pegados falta en el inventario.
        </p>
      )}
    </div>
  );
}
