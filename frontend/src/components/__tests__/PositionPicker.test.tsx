import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PositionPicker } from "../PositionPicker";

function cell(position: string) {
  return screen.getByRole("button", { name: new RegExp(`^Posición ${position},`) });
}

describe("PositionPicker · teclado", () => {
  it("es una sola parada de Tab y entra por la primera posición habilitada", async () => {
    render(<PositionPicker boxType="carton_81" occupied={new Set(["1A"])} value={null} onChange={vi.fn()} />);
    const tabbable = screen.getAllByRole("button").filter((button) => button.tabIndex === 0);
    expect(tabbable).toHaveLength(1);
    // 1A está ocupada y deshabilitada en modo congelamiento: la entrada es 2A.
    await userEvent.tab();
    expect(cell("2A")).toHaveFocus();
  });

  it("entra por la posición elegida", async () => {
    render(<PositionPicker boxType="carton_81" occupied={new Set()} value="5E" onChange={vi.fn()} />);
    await userEvent.tab();
    expect(cell("5E")).toHaveFocus();
  });

  it("recorre la caja de cartón con flechas: columnas 1–9, filas A–I", async () => {
    render(<PositionPicker boxType="carton_81" occupied={new Set()} value="1A" onChange={vi.fn()} />);
    await userEvent.tab();
    await userEvent.keyboard("{ArrowRight}");
    expect(cell("2A")).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(cell("2B")).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}{ArrowUp}");
    expect(cell("1A")).toHaveFocus();
    await userEvent.keyboard("{End}");
    expect(cell("9I")).toHaveFocus();
    await userEvent.keyboard("{Home}");
    expect(cell("1A")).toHaveFocus();
  });

  it("salta las posiciones que no se pueden elegir", async () => {
    render(<PositionPicker boxType="carton_81" occupied={new Set(["2A", "3A"])} value="1A" onChange={vi.fn()} />);
    await userEvent.tab();
    await userEvent.keyboard("{ArrowRight}");
    expect(cell("4A")).toHaveFocus();
  });

  it("recorre la caja plástica de a 10 por fila y elige con Enter", async () => {
    const onChange = vi.fn();
    render(<PositionPicker boxType="plastic_100" occupied={new Set()} value="1" onChange={onChange} />);
    await userEvent.tab();
    await userEvent.keyboard("{ArrowDown}{ArrowRight}");
    expect(cell("12")).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("12");
  });
});
