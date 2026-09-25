import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FreezerUsagePanel } from "../FreezerUsagePanel";

describe("FreezerUsagePanel", () => {
  it("no muestra nada sin selección", () => {
    const { container } = render(<FreezerUsagePanel rack={null} box={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("muestra el % del rack seleccionado", () => {
    render(
      <FreezerUsagePanel
        rack={{
          sectionCode: "II",
          letter: "C",
          occupancy: { rack_id: 3, letter: "C", section_code: "II", active: 81, capacity: 405, percent: 20 },
        }}
        box={null}
      />,
    );
    expect(screen.getByText("Rack C · Sección II")).toBeInTheDocument();
    expect(screen.getByText("20 %")).toBeInTheDocument();
  });

  it("calcula el % de la subcaja con sus luces", () => {
    render(<FreezerUsagePanel rack={null} box={{ number: 5, occupied: 73, total: 81 }} />);
    expect(screen.getByText("Subcaja 5 · 73/81")).toBeInTheDocument();
    expect(screen.getByText("90,1 %")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "% de uso de la subcaja 5" })).toHaveClass("usage-bar--near-full");
  });
});
