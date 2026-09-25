import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../../api/client";
import type { SampleSearchFilters, UserRead } from "../../api/types";
import { FiltersBar } from "../FiltersBar";

vi.mock("../../api/client", async () => {
  const actual = await vi.importActual<typeof import("../../api/client")>("../../api/client");
  return { ...actual, api: { ...actual.api, downloadSamplesCsv: vi.fn() } };
});

const USERS: UserRead[] = [
  { id: 1, initials: "GC", name: "Gonzalo Carrasco", active: true },
  { id: 2, initials: "VF", name: null, active: true },
  { id: 3, initials: "SIN_ASIG", name: null, active: true },
];

function setup(filters: SampleSearchFilters = { page: 1, page_size: 25 }) {
  const onChange = vi.fn();
  const onMyInitialsChange = vi.fn();
  const onToggleMyFilter = vi.fn();
  render(
    <FiltersBar
      filters={filters}
      onChange={onChange}
      myInitials=""
      onMyInitialsChange={onMyInitialsChange}
      myFilterActive={false}
      onToggleMyFilter={onToggleMyFilter}
      total={42}
      users={USERS}
    />,
  );
  return { onChange, onMyInitialsChange, onToggleMyFilter };
}

describe("FiltersBar", () => {
  it("actualiza el filtro de ID Environ y reinicia la página, con debounce", async () => {
    const { onChange } = setup({ page: 3, page_size: 25 });

    fireEvent.change(screen.getByLabelText(/id environ/i), { target: { value: "BP1" } });

    // Los campos de texto esperan 300 ms: cada tecla disparaba una búsqueda y la tabla
    // parpadeaba. El input muestra lo tipeado al instante; solo la consulta espera.
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/id environ/i)).toHaveValue("BP1");

    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ environ_id: "BP1", page: 1 })),
    );
  });

  it("no debouncea los selects: un solo gesto se aplica al instante", async () => {
    const { onChange } = setup();
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText(/^sección/i), "II");

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ section_code: "II", page: 1 }));
  });

  it("filtra por Núcleo = Sí", async () => {
    const { onChange } = setup();
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText(/núcleo/i), "true");

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ is_core: true }));
  });

  it("el Encargado es una lista de los usuarios registrados, con su nombre completo", async () => {
    const { onChange } = setup();
    const user = userEvent.setup();
    const select = screen.getByLabelText(/encargado/i);

    // El centinela del importador no es una persona: no se ofrece.
    expect(screen.queryByRole("option", { name: "SIN_ASIG" })).not.toBeInTheDocument();
    await user.selectOptions(select, "Gonzalo Carrasco");

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ owner_initials: "GC", page: 1 }));
    // Sin nombre registrado se muestran las iniciales.
    expect(screen.getByRole("option", { name: "VF" })).toBeInTheDocument();
  });

  it("filtra por estado retirada", async () => {
    const { onChange } = setup();
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText(/estado/i), "withdrawn");

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ status: "withdrawn" }));
  });

  it('el botón "Mis muestras" está deshabilitado sin iniciales cargadas', () => {
    setup();
    expect(screen.getByRole("button", { name: /mis muestras/i })).toBeDisabled();
  });

  it('permite activar "Mis muestras" cuando hay iniciales cargadas', async () => {
    const onToggleMyFilter = vi.fn();
    render(
      <FiltersBar
        filters={{ page: 1, page_size: 25 }}
        onChange={vi.fn()}
        myInitials="GC"
        onMyInitialsChange={vi.fn()}
        myFilterActive={false}
        onToggleMyFilter={onToggleMyFilter}
        total={42}
        users={USERS}
      />,
    );
    const user = userEvent.setup();
    const button = screen.getByRole("button", { name: /mis muestras/i });
    expect(button).toBeEnabled();

    await user.click(button);
    expect(onToggleMyFilter).toHaveBeenCalledTimes(1);
  });

  it('"Limpiar filtros" conserva el tamaño de página pero borra el resto', async () => {
    const { onChange } = setup({ environ_id: "BP1", status: "active", page: 3, page_size: 25 });
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /limpiar filtros/i }));

    expect(onChange).toHaveBeenCalledWith({ page: 1, page_size: 25 });
  });

  it("el botón de export muestra el total y se deshabilita sin resultados", () => {
    const { rerender } = render(
      <FiltersBar
        filters={{ page: 1, page_size: 25 }}
        onChange={vi.fn()}
        myInitials=""
        onMyInitialsChange={vi.fn()}
        myFilterActive={false}
        onToggleMyFilter={vi.fn()}
        total={1284}
        users={USERS}
      />,
    );

    // El conteo va en el botón para saber cuánto se baja ANTES de hacer clic.
    expect(screen.getByRole("button", { name: /exportar csv \(1\.284\)/i })).toBeEnabled();

    rerender(
      <FiltersBar
        filters={{ page: 1, page_size: 25 }}
        onChange={vi.fn()}
        myInitials=""
        onMyInitialsChange={vi.fn()}
        myFilterActive={false}
        onToggleMyFilter={vi.fn()}
        total={0}
        users={USERS}
      />,
    );

    expect(screen.getByRole("button", { name: /exportar csv \(0\)/i })).toBeDisabled();
  });

  it("el export pide todos los resultados del filtro, no la página visible", async () => {
    const download = vi.spyOn(api, "downloadSamplesCsv").mockResolvedValue({
      blob: new Blob(["x"], { type: "text/csv" }),
      filename: "muestras.csv",
    });
    globalThis.URL.createObjectURL = vi.fn(() => "blob:x");
    globalThis.URL.revokeObjectURL = vi.fn();

    setup({ page: 3, page_size: 25, section_code: "II", sort_by: "location" });
    await userEvent.click(screen.getByRole("button", { name: /exportar csv/i }));

    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    const sent = download.mock.calls[0][0];
    expect(sent).toEqual({ section_code: "II" });
    expect(sent).not.toHaveProperty("page");
    expect(sent).not.toHaveProperty("page_size");
  });

  it("un error del export se muestra inline y no borra la tabla", async () => {
    vi.spyOn(api, "downloadSamplesCsv").mockRejectedValue(
      new ApiError(422, "La búsqueda devuelve 30000 filas y el máximo exportable es 25000."),
    );

    setup();
    await userEvent.click(screen.getByRole("button", { name: /exportar csv/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/máximo exportable/i);
  });
});

