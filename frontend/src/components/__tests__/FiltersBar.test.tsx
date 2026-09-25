import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SampleSearchFilters } from "../../api/types";
import { FiltersBar } from "../FiltersBar";

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
});
