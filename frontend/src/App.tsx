import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "./api/client";
import { UNASSIGNED_INITIALS } from "./api/types";
import type { BoxOccupancy, Page, SampleSearchFilters, SampleWithLocation, UserRead } from "./api/types";
import { AlertsPanel, type AlertDestination } from "./components/AlertsPanel";
import { AnomaliesView } from "./components/AnomaliesView";
import { FiltersBar } from "./components/FiltersBar";
import { IdListSearch } from "./components/IdListSearch";
import { MoveModal } from "./components/MoveModal";
import {
  FreezerViewer,
  type FreePositionSelection,
  type FreezerFocusTarget,
  type OccupiedPositionSelection,
} from "./components/FreezerViewer";
import { Header } from "./components/Header";
import { MovementForm, type MovementFormPrefill } from "./components/MovementForm";
import { OccupancyView } from "./components/OccupancyView";
import { Pagination } from "./components/Pagination";
import { SampleDetail } from "./components/SampleDetail";
import { SampleEditModal } from "./components/SampleEditModal";
import { SamplesTable, type SortState } from "./components/SamplesTable";
import type { BoxFilter } from "./utils/occupancy";

const THEME_KEY = "refri:theme";
const MY_INITIALS_KEY = "refri:mis-iniciales";
const DEFAULT_PAGE_SIZE = 25;

type Theme = "light" | "dark";
// "anomalies" es una vista pero NO una pestaña: el control segmentado se queda en tres,
// que son las tres formas de VER el inventario. Corregir datos es otra tarea, y se llega
// desde el panel de alertas con un breadcrumb para volver.
type ViewMode = "table" | "3d" | "usage" | "anomalies";

function readTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [filters, setFilters] = useState<SampleSearchFilters>({ page: 1, page_size: DEFAULT_PAGE_SIZE });
  const [result, setResult] = useState<Page<SampleWithLocation> | null>(null);
  const [users, setUsers] = useState<UserRead[]>([]);
  const [selected, setSelected] = useState<SampleWithLocation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [myInitials, setMyInitials] = useState(() => localStorage.getItem(MY_INITIALS_KEY) ?? "");
  const [showMovementForm, setShowMovementForm] = useState(false);
  const [movementInitial, setMovementInitial] = useState<MovementFormPrefill | undefined>(undefined);
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [focusTarget, setFocusTarget] = useState<FreezerFocusTarget | null>(null);
  const [thawSelection, setThawSelection] = useState<OccupiedPositionSelection | null>(null);
  const [freezerKey, setFreezerKey] = useState(0);
  const [reloadToken, setReloadToken] = useState(0);
  const [editing, setEditing] = useState<SampleWithLocation | null>(null);
  const [alertCount, setAlertCount] = useState(0);
  const [showAlerts, setShowAlerts] = useState(false);
  const [boxFilter, setBoxFilter] = useState<BoxFilter>("all");
  const [moving, setMoving] = useState<SampleWithLocation | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [idListMode, setIdListMode] = useState(false);
  const [idListResult, setIdListResult] = useState<Page<SampleWithLocation> | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(MY_INITIALS_KEY, myInitials);
  }, [myInitials]);

  useEffect(() => {
    api.listUsers().then(setUsers).catch(() => setUsers([]));
  }, []);

  // "Cambiaron los filtros" y "se pidió un refetch" son dos cosas distintas. Antes el
  // refresh posterior a un movimiento era `setFilters(current => ({ ...current }))`: un
  // hack de identidad de objeto que funcionaba solo porque el efecto dependía de la
  // referencia. Con el debounce de abajo eso se volvería un no-op silencioso (congelás una
  // muestra y la tabla sigue mostrando la página vieja), así que el refetch explícito tiene
  // su propio token.
  useEffect(() => {
    let cancelled = false;
    // La primera carga usa el estado vacío; los refetch posteriores mantienen la tabla
    // montada con aria-busy, para que escribir en un filtro no borre lo que se estaba
    // leyendo.
    setLoading(true);
    setError(null);
    api
      .searchSamples(filters)
      .then((data) => {
        if (!cancelled) setResult(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "No se pudo cargar el listado");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filters, reloadToken]);

  const ownerLookup = useMemo(() => {
    const map: Record<number, string> = {};
    for (const user of users) map[user.id] = user.initials;
    return map;
  }, [users]);

  const myFilterActive = Boolean(
    myInitials.trim() && filters.owner_initials?.toUpperCase() === myInitials.trim().toUpperCase(),
  );

  const sort: SortState | null = filters.sort_by ? { key: filters.sort_by, direction: filters.sort_dir ?? "asc" } : null;

  function handleSortChange(next: SortState | null) {
    setFilters((current) => ({
      ...current,
      sort_by: next?.key,
      sort_dir: next?.direction,
      page: 1,
    }));
  }

  function toggleMyFilter() {
    const initials = myInitials.trim().toUpperCase();
    if (!initials) return;
    setFilters((current) => ({
      ...current,
      owner_initials: myFilterActive ? undefined : initials,
      page: 1,
    }));
  }

  function openMovementForm(initial?: MovementFormPrefill) {
    setMovementInitial(initial);
    setShowMovementForm(true);
  }

  function closeMovementForm() {
    setShowMovementForm(false);
    setMovementInitial(undefined);
    // Si se cierra un descongelamiento abierto desde el visor, la selección queda obsoleta.
    setThawSelection(null);
  }

  // Clic en una posición libre del visor 3D (issue #6): abre el formulario de
  // ingreso con la caja y la posición ya elegidas.
  function handleSelectFreePosition(selection: FreePositionSelection) {
    openMovementForm({
      action: "freeze",
      sectionCode: selection.sectionCode,
      rackLetter: selection.rackLetter,
      boxNumber: selection.boxNumber,
      boxType: selection.boxType,
      position: selection.position,
    });
  }

  // Clic en una posición ocupada del visor 3D: muestra el detalle de esa
  // muestra con la opción de descongelarla desde esa misma caja/posición.
  function handleSelectOccupiedPosition(selection: OccupiedPositionSelection) {
    setThawSelection(selection);
    api
      .getSample(selection.sampleId)
      .then(setSelected)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "No se pudo cargar la muestra"));
  }

  function handleThaw() {
    if (!thawSelection) return;
    openMovementForm({
      action: "thaw",
      sectionCode: thawSelection.sectionCode,
      rackLetter: thawSelection.rackLetter,
      boxNumber: thawSelection.boxNumber,
      boxType: thawSelection.boxType,
      position: thawSelection.position,
    });
    setSelected(null);
  }

  // "Ver en el refri" desde un resultado de búsqueda (issue #6): cambia a la
  // vista 3D y enfoca la caja resaltando la posición de esa muestra.
  function handleViewInFreezer(sample: SampleWithLocation) {
    setViewMode("3d");
    setFocusTarget({ boxId: sample.box_id, position: sample.position, token: Date.now() });
  }

  // "Ver en el refri" desde la vista de % de uso (issue #7): enfoca la subcaja sin resaltar posición.
  function handleViewBoxInFreezer(box: BoxOccupancy) {
    setViewMode("3d");
    setFocusTarget({ boxId: box.box_id, position: null, token: Date.now() });
  }

  // Cada alerta lleva a un destino distinto de una vista que YA existe: el panel es un
  // enrutador, no una pantalla nueva.
  function handleAlertNavigate(destination: AlertDestination) {
    setShowAlerts(false);
    if (destination.kind === "unassigned") {
      setViewMode("table");
      setFilters((current) => ({ ...current, owner_initials: UNASSIGNED_INITIALS, page: 1 }));
      return;
    }
    if (destination.kind === "anomalies") {
      setViewMode("anomalies");
      return;
    }
    setBoxFilter(destination.filter);
    setViewMode("usage");
  }

  const unassignedFilterActive = filters.owner_initials === UNASSIGNED_INITIALS;

  // En modo lista de IDs la tabla muestra ese resultado y no el de los filtros: son dos
  // búsquedas distintas y mezclarlas haría imposible saber cuál se está viendo.
  const tableResult = idListMode ? idListResult : result;

  return (
    <div className="app">
      <Header
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        viewMode={viewMode}
      />
      <main className="app-main">
        <div className="filters-actions">
          <button type="button" className="btn" onClick={() => openMovementForm(undefined)}>
            + Nuevo movimiento
          </button>
          {alertCount > 0 && (
            <button
              type="button"
              className={`btn-ghost${showAlerts ? " on" : ""}`}
              aria-expanded={showAlerts}
              onClick={() => setShowAlerts((open) => !open)}
            >
              <span aria-live="polite">⚠ {alertCount} alertas</span>
            </button>
          )}
          <div className="view-toggle" role="group" aria-label="Vista">
            <button
              type="button"
              className={viewMode === "table" ? "on" : ""}
              aria-pressed={viewMode === "table"}
              onClick={() => setViewMode("table")}
            >
              Vista tabla
            </button>
            <button
              type="button"
              className={viewMode === "3d" ? "on" : ""}
              aria-pressed={viewMode === "3d"}
              onClick={() => setViewMode("3d")}
            >
              Vista 3D
            </button>
            <button
              type="button"
              className={viewMode === "usage" ? "on" : ""}
              aria-pressed={viewMode === "usage"}
              onClick={() => setViewMode("usage")}
            >
              % de uso
            </button>
          </div>
        </div>

        {viewMode === "table" && !idListMode && (
          <div className="filters-actions">
            <button type="button" className="btn-ghost" onClick={() => setIdListMode(true)}>
              Buscar por lista de IDs
            </button>
          </div>
        )}

        {viewMode === "table" && idListMode && (
          <IdListSearch
            onResult={(lookup) =>
              setIdListResult(
                lookup ? { items: lookup.items, total: lookup.total, page: 1, page_size: lookup.total || 1 } : null,
              )
            }
            onClose={() => setIdListMode(false)}
          />
        )}

        {viewMode === "table" && !idListMode && (
          <FiltersBar
            filters={filters}
            onChange={setFilters}
            myInitials={myInitials}
            onMyInitialsChange={setMyInitials}
            myFilterActive={myFilterActive}
            onToggleMyFilter={toggleMyFilter}
            total={result?.total ?? 0}
          />
        )}

        {showAlerts && (
          <div className="panel">
            <AlertsPanel
              reloadToken={reloadToken}
              onNavigate={handleAlertNavigate}
              onCountChange={setAlertCount}
            />
          </div>
        )}

        {viewMode === "table" && unassignedFilterActive && (
          <div className="filters-actions">
            <span className="alerts-chip">
              Sin encargado
              <button
                type="button"
                aria-label="Quitar el filtro de muestras sin encargado"
                onClick={() => setFilters((current) => ({ ...current, owner_initials: undefined, page: 1 }))}
              >
                ×
              </button>
            </span>
          </div>
        )}

        {viewMode === "usage" && (
          <OccupancyView key={freezerKey} onViewBox={handleViewBoxInFreezer} initialFilter={boxFilter} />
        )}

        {viewMode === "anomalies" && (
          <AnomaliesView
            onBack={() => {
              setViewMode("table");
              setShowAlerts(true);
            }}
            operatorInitials={myInitials.trim().toUpperCase()}
          />
        )}
        {notice && (
          <p className="field-notice" role="status">
            {notice}
          </p>
        )}

        {viewMode === "table" && loading && !result && !idListMode && (
          <div className="empty-state">Cargando muestras…</div>
        )}
        {viewMode === "table" && error && (
          <div className="empty-state" role="alert">
            {error}
          </div>
        )}
        {!error && tableResult && viewMode === "table" && (
          <div aria-busy={loading} style={loading ? { opacity: 0.6 } : undefined}>
            <SamplesTable
              samples={tableResult.items}
              ownerLookup={ownerLookup}
              onSelect={setSelected}
              sort={sort}
              onSortChange={handleSortChange}
              onViewInFreezer={handleViewInFreezer}
            />
            <Pagination
              page={tableResult.page}
              pageSize={tableResult.page_size}
              total={tableResult.total}
              onPageChange={(page) => setFilters((current) => ({ ...current, page }))}
            />
          </div>
        )}
        {viewMode === "3d" && (
          <FreezerViewer
            key={freezerKey}
            focusTarget={focusTarget}
            onSelectFreePosition={handleSelectFreePosition}
            onSelectOccupiedPosition={handleSelectOccupiedPosition}
          />
        )}
      </main>

      {selected && !editing && (
        <SampleDetail
          sample={selected}
          ownerLabel={ownerLookup[selected.owner_id] ?? "—"}
          onClose={() => {
            setSelected(null);
            setThawSelection(null);
          }}
          onThaw={thawSelection && thawSelection.sampleId === selected.id ? handleThaw : undefined}
          onEdit={() => setEditing(selected)}
          onMove={() => setMoving(selected)}
        />
      )}

      {moving && (
        <MoveModal
          sample={moving}
          users={users}
          onClose={() => setMoving(null)}
          onMoved={(updated, summary) => {
            setMoving(null);
            // Se reabre el detalle con el dato fresco y la línea que dice de dónde a
            // dónde: el momento que importa no puede terminar en un diálogo que se cierra.
            setSelected(updated);
            setNotice(summary);
            setReloadToken((token) => token + 1);
            setFreezerKey((key) => key + 1);
          }}
        />
      )}

      {editing && (
        <SampleEditModal
          sample={editing}
          users={users}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setEditing(null);
            setSelected(updated);
            setReloadToken((token) => token + 1);
          }}
        />
      )}

      {showMovementForm && (
        <MovementForm
          users={users}
          initial={movementInitial}
          onClose={closeMovementForm}
          onSubmitted={() => {
            api.listUsers().then(setUsers).catch(() => undefined);
            setReloadToken((token) => token + 1);
            setFreezerKey((key) => key + 1);
          }}
        />
      )}
    </div>
  );
}
