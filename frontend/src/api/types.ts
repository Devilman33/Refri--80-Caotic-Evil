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

export type MovementAction = "freeze" | "thaw";

export const MOVEMENT_ACTION_LABELS: Record<MovementAction, string> = {
  freeze: "Congelamiento",
  thaw: "Descongelamiento",
};

export const SECTION_CODES = ["I", "II", "III", "IV"] as const;
export const RACK_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;

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

export interface MovementRead {
  id: number;
  sample_id: number;
  action: MovementAction;
  date: string;
  operator_id: number | null;
  box_id: number;
  position: string;
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
  page?: number;
  page_size?: number;
}
