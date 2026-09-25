export type SampleType =
  | "vial_celulas"
  | "rna"
  | "rna_later"
  | "proteinas"
  | "medio_condicionado"
  | "reactivo"
  | "plasma"
  | "otros";

export const SAMPLE_TYPE_LABELS: Record<SampleType, string> = {
  vial_celulas: "Vial de Células",
  rna: "RNA",
  rna_later: "RNA later",
  proteinas: "Proteínas",
  medio_condicionado: "Medio Condicionado",
  reactivo: "Reactivo",
  plasma: "Plasma",
  otros: "Otros",
};

export type SampleStatus = "active" | "withdrawn";

export const SAMPLE_STATUS_LABELS: Record<SampleStatus, string> = {
  active: "Activa",
  withdrawn: "Retirada",
};

export type MovementAction = "freeze" | "thaw" | "move";

/** OJO: este mapa TIENE que crecer con cada acción para que el historial la renderice,
 * pero el desplegable del formulario NO se deriva de él (ver ACTION_OPTIONS en
 * MovementForm): `POST /movements` solo implementa congelamiento y descongelamiento, y
 * derivar el desplegable de acá hacía aparecer en la UI acciones que ese endpoint
 * rechaza. */
export const MOVEMENT_ACTION_LABELS: Record<MovementAction, string> = {
  freeze: "Congelamiento",
  thaw: "Descongelamiento",
  move: "Traslado",
};

export type BoxType = "carton_81" | "plastic_100";

export const BOX_TYPE_LABELS: Record<BoxType, string> = {
  carton_81: "Caja de cartón (9×9)",
  plastic_100: "Caja plástica (10×10)",
};

export const SECTION_CODES = ["I", "II", "III", "IV"] as const;
export const RACK_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;

// Carga inicial de las listas desplegables (docs/FORMULARIO.md); la tabla de
// usuarios (administrable vía GET /users) puede agregar más con el tiempo.
export const DEFAULT_OPERATOR_INITIALS = [
  "BPG",
  "DB",
  "DM",
  "EV",
  "GC",
  "JCI",
  "MN",
  "MS",
  "RL",
  "VC",
  "JF",
] as const;

export const DEFAULT_OWNER_INITIALS = [
  "BPG",
  "DB",
  "DM",
  "GC",
  "JCI",
  "MN",
  "MS",
  "APS",
  "VF",
  "DRZ",
  "VC",
  "JF",
] as const;

export interface SampleWithLocation {
  id: number;
  environ_id: string | null;
  description: string | null;
  type: SampleType;
  type_other: string | null;
  owner_id: number;
  passage: number | null;
  is_core: boolean | null;
  box_id: number;
  position: string;
  notes: string | null;
  status: SampleStatus;
  created_at: string;
  updated_at: string;
  location: string;
}

/** Solo los datos descriptivos. La ubicación y el estado cambian por movimientos, para
 * no romper la trazabilidad (ver SampleUpdate en el backend). */
export interface SampleUpdate {
  environ_id?: string | null;
  description?: string | null;
  type?: SampleType;
  type_other?: string | null;
  owner_id?: number;
  passage?: number | null;
  is_core?: boolean | null;
  notes?: string | null;
}

export interface MovementRead {
  id: number;
  sample_id: number;
  action: MovementAction;
  date: string;
  operator_id: number | null;
  /** `null` cuando el movimiento vino del importador: el Excel histórico no lo traía. */
  operator_initials: string | null;
  box_id: number;
  position: string;
  location: string | null;
  from_box_id: number | null;
  from_position: string | null;
  from_location: string | null;
  note: string | null;
  created_at: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface UserRead {
  id: number;
  initials: string;
  name: string | null;
  active: boolean;
}

export interface SectionRead {
  id: number;
  code: string;
}

export interface RackRead {
  id: number;
  section_id: number;
  letter: string;
  slot: "center" | "right";
  capacity: number;
}

export interface BoxRead {
  id: number;
  rack_id: number;
  number: number;
  box_type: BoxType;
  label: string | null;
  owner_id: number | null;
  is_full: boolean | null;
}

// % de uso (GET /occupancy/*, issue #7). `percent` viene redondeado a 2 decimales.
export interface FreezerOccupancy {
  active: number;
  capacity: number;
  percent: number;
}

export interface SectionOccupancy extends FreezerOccupancy {
  section_id: number;
  code: string;
}

export interface RackOccupancy extends FreezerOccupancy {
  rack_id: number;
  letter: string;
  section_code: string;
}

export interface BoxOccupancy extends FreezerOccupancy {
  box_id: number;
  number: number;
  rack_id: number;
  rack_letter: string;
  section_code: string;
  box_type: BoxType;
  is_full: boolean | null;
}

// Alertas (GET /alerts, issue #8). Cuatro contadores con cuatro destinos distintos:
// "llenas" y "casi llenas" NO son el mismo estado de la vista de % de uso.
export interface AlertsRead {
  unassigned_samples: number;
  nearly_full_boxes: number;
  full_boxes: number;
  inconsistent_full_boxes: number;
  boxes: BoxOccupancy[];
}

/** Centinela que el importador asigna a las filas sin Encargado (docs/DATOS.md). No es
 * una persona: nunca se muestra crudo en la UI. */
export const UNASSIGNED_INITIALS = "SIN_ASIG";

export interface BoxPositionStatus {
  position: string;
  occupied: boolean;
  sample_id: number | null;
  environ_id: string | null;
  is_core: boolean | null;
}

// Campos del formulario de movimientos (docs/FORMULARIO.md). `rack_letter` +
// `box_number` corresponden a "Nombre Caja"; el frontend parte el texto
// combinado (p. ej. `A12`) en estos dos campos antes de enviarlos.
export interface MovementCreate {
  action: MovementAction;
  date: string;
  operator_initials: string;
  rack_letter: string;
  box_number: number;
  position: string;
  environ_id?: string | null;
  description?: string | null;
  sample_type?: SampleType | null;
  type_other?: string | null;
  passage?: number | null;
  is_core?: boolean | null;
  non_core_owner_initials?: string | null;
  box_is_full?: boolean | null;
  note?: string | null;
}

/** Traslado. Se direcciona por `sample.id`: un environ_id cubre hasta cientos de tubos. */
export interface SampleMoveCreate {
  date: string;
  operator_initials: string;
  rack_letter: string;
  box_number: number;
  position: string;
  note?: string | null;
}

/** Resultado de buscar una lista de IDs pegada. `missing` lo calcula el servidor: con el
 * diff en el cliente contra una respuesta paginada, los IDs fuera de la página se
 * reportarían como faltantes. */
export interface IdLookupResult {
  items: SampleWithLocation[];
  total: number;
  missing: string[];
}

export interface MovementResult {
  sample: SampleWithLocation;
  movement: MovementRead;
}

export interface PositionConflict {
  message: string;
  next_free_position: string | null;
}

export interface AutocompleteSuggestion {
  environ_id: string | null;
  description: string | null;
  sample_type: SampleType | null;
  type_other: string | null;
  passage: number | null;
  is_core: boolean | null;
  owner_initials: string | null;
  rack_letter: string | null;
  box_number: number | null;
  box_id: number | null;
  next_free_position: string | null;
}

// Importaciones y sus anomalías (issue #8). Los contadores de cada corrida son la serie
// de calidad de datos: dos seguidas dicen si el Excel mejoró.
export interface ImportRunRead {
  id: number;
  source_name: string;
  started_at: string;
  total_rows: number;
  imported: number;
  withdrawn: number;
  skipped_already_imported: number;
  skipped_invalid: number;
  conflicts_resolved: number;
  anomalies_count: number;
}

export type AnomalyStatus = "pending" | "resolved" | "accepted";

/** Anomalías de un mismo motivo y columna: la unidad con la que el laboratorio corrige. */
export interface AnomalyGroup {
  reason: string;
  column: string;
  total: number;
  pending: number;
}

export interface AnomalyResolveRequest {
  operator_initials: string;
  status?: AnomalyStatus;
  reason?: string;
  column?: string;
  ids?: number[];
}

export interface SampleSearchFilters {
  environ_id?: string;
  description?: string;
  owner_initials?: string;
  type?: SampleType;
  is_core?: boolean;
  passage?: number;
  status?: SampleStatus;
  date_from?: string;
  date_to?: string;
  section_code?: string;
  rack_letter?: string;
  box_number?: number;
  sort_by?: SampleSortKey;
  sort_dir?: "asc" | "desc";
  page?: number;
  page_size?: number;
}

export type SampleSortKey =
  | "environ_id"
  | "description"
  | "type"
  | "owner"
  | "passage"
  | "status"
  | "location"
  | "created_at";
