import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, setSessionUserId } from "./api/client";
import { UNASSIGNED_INITIALS } from "./api/types";
import type { BoxOccupancy, Page, SampleSearchFilters, SampleWithLocation, UserRead } from "./api/types";
import { AlertsPanel, alertTotal, type AlertDestination } from "./components/AlertsPanel";
import { AnomaliesView } from "./components/AnomaliesView";
import { BoxMoveModal, type BoxMoveTarget } from "./components/BoxMoveModal";
import { FiltersBar } from "./components/FiltersBar";
import { FreezerAdminModal } from "./components/FreezerAdminModal";
import { GlobalSearch } from "./components/GlobalSearch";
import { FreezeForm, type LocationPrefill } from "./components/FreezeForm";
import {
  FreezerViewer,
  type FreePositionSelection,
  type FreezerFocusTarget,
  type OccupiedPositionSelection,
} from "./components/FreezerViewer";
import { Header } from "./components/Header";
import { IdListSearch } from "./components/IdListSearch";
import { LoginScreen } from "./components/LoginScreen";
import { MoveModal } from "./components/MoveModal";
import { OccupancyView } from "./components/OccupancyView";
import { Pagination } from "./components/Pagination";
import { SampleDetail } from "./components/SampleDetail";
import { SampleEditModal } from "./components/SampleEditModal";
import { SamplesTable, type SortState } from "./components/SamplesTable";
import { ThawForm } from "./components/ThawForm";
import { UsersModal } from "./components/UsersModal";
import type { BoxFilter } from "./utils/occupancy";
import { canModifySample, ownersOf, userLabel } from "./utils/users";

const THEME_KEY = "refri:theme";
const SESSION_KEY = "refri:sesion-usuario";
const DEFAULT_PAGE_SIZE = 25;
const NOTICE_MS = 8000;

type Theme = "light" | "dark";
// "anomalies" es una vista pero NO una pestaña: el control segmentado se queda en tres,
// que son las tres formas de VER el inventario. Corregir datos es otra tarea, y se llega
// desde el panel de alertas con un breadcrumb para volver.
type ViewMode = "table" | "3d" | "usage" | "anomalies";

/** Qué formulario de movimiento está abierto. Congelar y descongelar son dos formularios
 * distintos a pedido del laboratorio: compartían pantalla y se confundían. */
type MovementDialog = { kind: "freeze" | "thaw"; initial?: LocationPrefill } | null;

function readTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readSessionId(): number | null {
  const stored = Number(localStorage.getItem(SESSION_KEY));
  return Number.isInteger(stored) && stored > 0 ? stored : null;
}

/** La caja y posición de una muestra ya elegida, para abrir su retiro prellenado. Sin las
 * partes de la ubicación (backend anterior) el formulario abre vacío en vez de adivinar. */
function locationPrefill(sample: SampleWithLocation): LocationPrefill | undefined {
  if (!sample.section_code || !sample.rack_letter || sample.box_number === undefined) return undefined;
  return {
    sectionCode: sample.section_code,
    rackLetter: sample.rack_letter,
    boxNumber: sample.box_number,
    boxType: sample.box_type,
    position: sample.position,
  };
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [users, setUsers] = useState<UserRead[] | null>(null);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<number | null>(readSessionId);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const reloadUsers = useCallback(() => {
    api
      .listUsers()
      .then((list) => {
        setUsers(list);
        setUsersError(null);
      })
      .catch(() => {
        setUsers([]);
        setUsersError("No se pudo cargar la lista de usuarios. ¿Está levantado el backend?");
      });
  }, []);

  useEffect(reloadUsers, [reloadUsers]);

  // Una sesión guardada de alguien que ya no existe o fue desactivado no vale: vuelve a
  // la pantalla de entrada en vez de fallar en la primera escritura.
  const sessionUser = useMemo(
    () => users?.find((user) => user.id === sessionId && user.active) ?? null,
    [users, sessionId],
  );

  useEffect(() => {
    setSessionUserId(sessionUser?.id ?? null);
  }, [sessionUser]);

  function login(user: UserRead) {
    localStorage.setItem(SESSION_KEY, String(user.id));
    setSessionUserId(user.id);
    setUsers((current) => (current?.some((entry) => entry.id === user.id) ? current : [...(current ?? []), user]));
    setSessionId(user.id);
  }

  function logout() {
    localStorage.removeItem(SESSION_KEY);
    setSessionUserId(null);
    setSessionId(null);
  }

  if (users === null) return <div className="empty-state">Cargando…</div>;
  if (!sessionUser) return <LoginScreen users={users} loadError={usersError} onLogin={login} />;

  return (
    <Workspace
      theme={theme}
      onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
      users={users}
      sessionUser={sessionUser}
      onUsersChanged={reloadUsers}
      onLogout={logout}
    />
  );
}

interface WorkspaceProps {
  theme: Theme;
  onToggleTheme: () => void;
  users: UserRead[];
  sessionUser: UserRead;
  onUsersChanged: () => void;
  onLogout: () => void;
}

function Workspace({ theme, onToggleTheme, users, sessionUser, onUsersChanged, onLogout }: WorkspaceProps) {
  const [filters, setFilters] = useState<SampleSearchFilters>({ page: 1, page_size: DEFAULT_PAGE_SIZE });
  const [result, setResult] = useState<Page<SampleWithLocation> | null>(null);
  const [selected, setSelected] = useState<SampleWithLocation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [movementDialog, setMovementDialog] = useState<MovementDialog>(null);
  // El visor 3D es la primera vista: es la que el laboratorio usa para ubicarse.
  const [viewMode, setViewMode] = useState<ViewMode>("3d");
  const [focusTarget, setFocusTarget] = useState<FreezerFocusTarget | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [editing, setEditing] = useState<SampleWithLocation | null>(null);
  const [alertCount, setAlertCount] = useState(0);
  const [showAlerts, setShowAlerts] = useState(false);
  const [boxFilter, setBoxFilter] = useState<BoxFilter>("all");
  const [moving, setMoving] = useState<SampleWithLocation | null>(null);
  const [movingBox, setMovingBox] = useState<BoxMoveTarget | null>(null);
  const [showFreezerAdmin, setShowFreezerAdmin] = useState(false);
  const [showUsers, setShowUsers] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [idListMode, setIdListMode] = useState(false);
  const [idListResult, setIdListResult] = useState<Page<SampleWithLocation> | null>(null);
  const [locationQuery, setLocationQuery] = useState<{ query: string; token: number } | null>(null);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);

  // El aviso "N alertas" de la barra. Antes lo calculaba AlertsPanel, que solo se monta
  // al abrir ese mismo aviso, y el aviso solo aparecía con N > 0: nunca se veía.
  useEffect(() => {
    let cancelled = false;
    api
      .getAlerts()
      .then((data) => {
        if (!cancelled) setAlertCount(alertTotal(data));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  // Los avisos de resultado ("Muestra retirada: …") se van solos: antes quedaban para
  // siempre y el siguiente se confundía con el anterior.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

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
    // Nombre completo cuando la persona se registró con uno. El centinela del importador
    // se deja crudo porque la tabla lo reconoce para mostrar la marca "Sin encargado".
    for (const user of users) map[user.id] = user.initials === UNASSIGNED_INITIALS ? user.initials : userLabel(user);
    return map;
  }, [users]);

  const myFilterActive = filters.owner_initials === sessionUser.initials;

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
    setFilters((current) => ({
      ...current,
      owner_initials: myFilterActive ? undefined : sessionUser.initials,
      page: 1,
    }));
  }

  /** Después de cualquier cambio de inventario: tabla, visor, % de uso y alertas vuelven a
   * pedir sus datos con `reloadToken`, sin desmontarse. */
  function refreshInventory() {
    setReloadToken((token) => token + 1);
  }

  // Clic en una posición libre del visor 3D (issue #6): abre el congelamiento con la caja
  // y la posición ya elegidas.
  function handleSelectFreePosition(selection: FreePositionSelection) {
    setMovementDialog({
      kind: "freeze",
      initial: {
        sectionCode: selection.sectionCode,
        rackLetter: selection.rackLetter,
        boxNumber: selection.boxNumber,
        boxType: selection.boxType,
        position: selection.position,
      },
    });
  }

  // Clic en una posición ocupada del visor 3D: muestra el detalle de esa muestra.
  function handleSelectOccupiedPosition(selection: OccupiedPositionSelection) {
    api
      .getSample(selection.sampleId)
      .then(setSelected)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "No se pudo cargar la muestra"));
  }

  function handleThaw(sample: SampleWithLocation) {
    setSelected(null);
    setMovementDialog({ kind: "thaw", initial: locationPrefill(sample) });
  }

  // "Ver en el refri" desde un resultado de búsqueda (issue #6): cambia a la
  // vista 3D y enfoca la caja resaltando la posición de esa muestra.
  function handleViewInFreezer(sample: SampleWithLocation) {
    setViewMode("3d");
    setFocusTarget({ boxId: sample.box_id, position: sample.position, token: Date.now() });
  }

  // Buscador global (docs/PLAN_FRONTEND.md, F3). Un resultado: su posición en el 3D con el
  // detalle abierto. Varios: la tabla filtrada. Una ubicación: el 3D enfocado ahí.
  function handlePickSample(sample: SampleWithLocation) {
    setSearchMessage(null);
    setViewMode("3d");
    setFocusTarget({ boxId: sample.box_id, position: sample.position, token: Date.now() });
    setSelected(sample);
  }

  function handleShowMany(query: string, includeWithdrawn: boolean) {
    setSearchMessage(null);
    setIdListMode(false);
    setViewMode("table");
    setFilters((current) => ({
      page: 1,
      page_size: current.page_size,
      q: query,
      status: includeWithdrawn ? undefined : "active",
    }));
  }

  function handleLocation(query: string) {
    setSearchMessage(null);
    setViewMode("3d");
    setLocationQuery({ query, token: Date.now() });
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

  const selectedOwners = selected ? ownersOf(selected, users) : [];

  // El detalle es un panel (docs/PLAN_FRONTEND.md, D2). Se oculta mientras se mueve o edita
  // esa muestra: un solo foco de trabajo a la vez, y al terminar vuelve con el dato fresco.
  const detailPanel =
    selected && !editing && !moving ? (
      <SampleDetail
        sample={selected}
        users={users}
        canModify={canModifySample(selected, selectedOwners, sessionUser)}
        onClose={() => setSelected(null)}
        onThaw={() => handleThaw(selected)}
        onEdit={() => setEditing(selected)}
        onMove={() => setMoving(selected)}
        onViewInFreezer={viewMode === "3d" ? undefined : () => handleViewInFreezer(selected)}
      />
    ) : null;

  return (
    <div className="app">
      <Header
        theme={theme}
        onToggleTheme={onToggleTheme}
        viewMode={viewMode}
        sessionUser={sessionUser}
        onOpenUsers={() => setShowUsers(true)}
        onOpenFreezerAdmin={() => setShowFreezerAdmin(true)}
        onLogout={onLogout}
        search={
          <GlobalSearch
            onPickSample={handlePickSample}
            onShowMany={handleShowMany}
            onLocation={handleLocation}
            message={searchMessage}
          />
        }
        onFreeze={() => setMovementDialog({ kind: "freeze" })}
        onThaw={() => setMovementDialog({ kind: "thaw" })}
        alertCount={alertCount}
        alertsOpen={showAlerts}
        onToggleAlerts={() => setShowAlerts((open) => !open)}
      />
      <main className="app-main">
        <nav className="filters-actions" aria-label="Vistas">
          <div className="view-toggle" role="group" aria-label="Vista">
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
              className={viewMode === "table" ? "on" : ""}
              aria-pressed={viewMode === "table"}
              onClick={() => setViewMode("table")}
            >
              Vista tabla
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
        </nav>

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
            users={users}
            myFilterActive={myFilterActive}
            onToggleMyFilter={toggleMyFilter}
            total={result?.total ?? 0}
          />
        )}

        {showAlerts && (
          <div className="panel">
            <AlertsPanel reloadToken={reloadToken} onNavigate={handleAlertNavigate} onCountChange={setAlertCount} />
          </div>
        )}

        {viewMode === "table" && filters.q && (
          <div className="filters-actions">
            <span className="alerts-chip">
              Búsqueda: «{filters.q}»
              <button
                type="button"
                aria-label="Quitar la búsqueda"
                onClick={() => setFilters((current) => ({ ...current, q: undefined, page: 1 }))}
              >
                ×
              </button>
            </span>
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

        {notice && (
          <p className="app-notice" role="status">
            <span>{notice}</span>
            <button type="button" className="app-notice__close" aria-label="Cerrar aviso" onClick={() => setNotice(null)}>
              ×
            </button>
          </p>
        )}

        {viewMode === "usage" && (
          <OccupancyView
            reloadToken={reloadToken}
            onViewBox={handleViewBoxInFreezer}
            onMoveBox={(box) =>
              setMovingBox({
                boxId: box.box_id,
                label: `${box.section_code} · ${box.rack_letter}${box.number}`,
                active: box.active,
              })
            }
            initialFilter={boxFilter}
          />
        )}

        {viewMode === "anomalies" && (
          <AnomaliesView
            onBack={() => {
              setViewMode("table");
              setShowAlerts(true);
            }}
            operatorInitials={sessionUser.initials}
          />
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
          <div className={`table-split${detailPanel ? " table-split--detail" : ""}`}>
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
            {detailPanel}
          </div>
        )}
        {viewMode === "3d" && (
          <FreezerViewer
            reloadToken={reloadToken}
            focusTarget={focusTarget}
            locationQuery={locationQuery}
            onQueryMessage={setSearchMessage}
            onSelectFreePosition={handleSelectFreePosition}
            onSelectOccupiedPosition={handleSelectOccupiedPosition}
            onMoveBox={setMovingBox}
            onBoxChanged={(message) => {
              setNotice(message);
              refreshInventory();
            }}
            detailSlot={detailPanel}
          />
        )}
      </main>

      {/* Fuera del 3D y de la tabla (p. ej. % de uso) el detalle igual se ve, como hoja. */}
      {viewMode !== "3d" && viewMode !== "table" && detailPanel}

      {moving && (
        <MoveModal
          sample={moving}
          users={users}
          sessionInitials={sessionUser.initials}
          onClose={() => setMoving(null)}
          onMoved={(updated, summary) => {
            setMoving(null);
            // Se reabre el detalle con el dato fresco y la línea que dice de dónde a
            // dónde: el momento que importa no puede terminar en un diálogo que se cierra.
            setSelected(updated);
            setNotice(summary);
            refreshInventory();
          }}
        />
      )}

      {movingBox && (
        <BoxMoveModal
          box={movingBox}
          users={users}
          sessionInitials={sessionUser.initials}
          onClose={() => setMovingBox(null)}
          onMoved={(summary) => {
            const movedBoxId = movingBox.boxId;
            setMovingBox(null);
            setNotice(summary);
            refreshInventory();
            // La caja conserva su id y cambia de lugar: el visor la busca en el layout nuevo
            // y enfoca el destino (docs/PLAN_FRONTEND.md, F4).
            setViewMode("3d");
            setFocusTarget({ boxId: movedBoxId, position: null, token: Date.now() });
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

      {movementDialog?.kind === "freeze" && (
        <FreezeForm
          users={users}
          sessionInitials={sessionUser.initials}
          initial={movementDialog.initial}
          onClose={() => setMovementDialog(null)}
          onSubmitted={() => {
            onUsersChanged();
            refreshInventory();
          }}
          onFinished={setNotice}
        />
      )}

      {movementDialog?.kind === "thaw" && (
        <ThawForm
          users={users}
          sessionUser={sessionUser}
          initial={movementDialog.initial}
          onClose={() => setMovementDialog(null)}
          onSubmitted={(movement) => {
            setNotice(`Muestra retirada: ${movement.sample.environ_id ?? "sin ID"} (${movement.sample.location}).`);
            refreshInventory();
          }}
        />
      )}

      {showFreezerAdmin && (
        <FreezerAdminModal
          users={users}
          sessionInitials={sessionUser.initials}
          onClose={() => setShowFreezerAdmin(false)}
          onChanged={(message) => {
            setNotice(message);
            refreshInventory();
          }}
        />
      )}

      {showUsers && <UsersModal users={users} onClose={() => setShowUsers(false)} onChanged={onUsersChanged} />}
    </div>
  );
}
