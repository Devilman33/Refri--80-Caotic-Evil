import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NucleoWarning } from "../NucleoWarning";

describe("NucleoWarning", () => {
  it("muestra el warning cuando la muestra es del Núcleo Environ", () => {
    render(<NucleoWarning isCore={true} />);
    expect(screen.getByText(/núcleo environ/i)).toBeInTheDocument();
  });

  it("no muestra nada cuando la muestra no es del Núcleo", () => {
    const { container } = render(<NucleoWarning isCore={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("no muestra nada cuando el dato es desconocido", () => {
    const { container } = render(<NucleoWarning isCore={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
