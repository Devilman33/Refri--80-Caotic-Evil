import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SampleWithLocation, UserRead } from "../../api/types";
import { ReturnModal } from "../ReturnModal";

const { api, ApiError } = vi.hoisted(() => {
  class ApiErrorMock extends Error {
    status: number;
    detail: unknown;
    constructor(status: number, message: string, detail?: unknown) {
      super(message);
      this.status = status;
      this.detail = detail;
    }
  }
  return {
    api: {
      returnSample: vi.fn(),
      listSections: vi.fn(),
      listRacks: vi.fn(),
      listBoxOccupancy: vi.fn(),
      getBoxPositions: vi.fn(),
    },
    ApiError: ApiErrorMock,
  };
});

vi.mock("../../api/client", () => ({ api, ApiError }));

const users: UserRead[] = [{ id: 1, initials: "GC", name: "Gonzalo", active: true }];
const withdrawn: SampleWithLocation = {
  id: 7,
  environ_id: "BP007",
  description: null,
  type: "rna",
  type_other: null,
  owner_ids: [1],
  passage: null,
  is_core: false,
  box_id: 3,
  position: "3B",
  notes: null,
  status: "withdrawn",
  created_at: "2026-01-10T00:00:00Z",
  updated_at: "2026-01-10T00:00:00Z",
  location: "III · F12 · 3B",
  section_code: "III",
  rack_letter: "F",
  box_number: 12,
};

beforeEach(() => {
  vi.clearAllMocks();
  api.listSections.mockResolvedValue([]);
  api.listRacks.mockResolvedValue([]);
  api.listBoxOccupancy.mockResolvedValue([]);
});

describe("ReturnModal", () => {
  it("por defecto la devuelve a su lugar de antes", async () => {
    api.returnSample.mockResolvedValue({ sample: { ...withdrawn, status: "active" }, movement: {} });
    const onReturned = vi.fn();
    const user = userEvent.setup();
    render(<ReturnModal sample={withdrawn} users={users} sessionInitials="GC" onClose={vi.fn()} onReturned={onReturned} />);

    await user.type(screen.getByLabelText(/motivo/i), "Se sacó por error");
    await user.click(screen.getByRole("button", { name: /^devolver al refri$/i }));

    await waitFor(() =>
      expect(api.returnSample).toHaveBeenCalledWith(7, expect.objectContaining({ operator_initials: "GC", note: "Se sacó por error" })),
    );
    expect(api.returnSample.mock.calls[0][1]).not.toHaveProperty("position");
    expect(onReturned).toHaveBeenCalledWith(expect.objectContaining({ status: "active" }), expect.stringMatching(/devuelta/));
  });

  it("si su lugar se ocupó, ofrece la siguiente libre de la misma caja", async () => {
    api.returnSample
      .mockRejectedValueOnce(new ApiError(409, "La posición 3B ya está ocupada", { message: "La posición 3B ya está ocupada", next_free_position: "4B" }))
      .mockResolvedValueOnce({ sample: { ...withdrawn, status: "active", position: "4B" }, movement: {} });
    const user = userEvent.setup();
    render(<ReturnModal sample={withdrawn} users={users} sessionInitials="GC" onClose={vi.fn()} onReturned={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /^devolver al refri$/i }));
    await user.click(await screen.findByRole("button", { name: /siguiente libre de la misma caja \(4B\)/i }));

    await waitFor(() =>
      expect(api.returnSample).toHaveBeenLastCalledWith(
        7,
        expect.objectContaining({ rack_letter: "F", box_number: 12, position: "4B" }),
      ),
    );
  });
});
