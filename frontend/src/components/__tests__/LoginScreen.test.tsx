import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRead } from "../../api/types";
import { LoginScreen } from "../LoginScreen";

const { api, ApiError } = vi.hoisted(() => ({
  api: { createUser: vi.fn() },
  ApiError: class extends Error {},
}));

vi.mock("../../api/client", () => ({ api, ApiError }));

const users: UserRead[] = [
  { id: 1, initials: "GC", name: "Gonzalo Carrasco", active: true },
  { id: 2, initials: "VF", name: null, active: true },
  { id: 3, initials: "RL", name: "Rocío López", active: false },
  { id: 4, initials: "SIN_ASIG", name: null, active: true },
];

beforeEach(() => vi.clearAllMocks());

describe("LoginScreen", () => {
  it("ofrece a las personas activas con su nombre completo", () => {
    render(<LoginScreen users={users} loadError={null} onLogin={vi.fn()} />);

    expect(screen.getByRole("option", { name: "Gonzalo Carrasco (GC)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "VF" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /rocío/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "SIN_ASIG" })).not.toBeInTheDocument();
  });

  it("entra como la persona elegida", async () => {
    const onLogin = vi.fn();
    const user = userEvent.setup();
    render(<LoginScreen users={users} loadError={null} onLogin={onLogin} />);

    await user.selectOptions(screen.getByLabelText(/quién eres/i), "Gonzalo Carrasco (GC)");
    await user.click(screen.getByRole("button", { name: /^entrar$/i }));

    expect(onLogin).toHaveBeenCalledWith(users[0]);
  });

  it("permite registrarse solo con el nombre completo", async () => {
    const created: UserRead = { id: 9, initials: "ADS", name: "Ana de Souza", active: true };
    api.createUser.mockResolvedValue(created);
    const onLogin = vi.fn();
    const user = userEvent.setup();
    render(<LoginScreen users={users} loadError={null} onLogin={onLogin} />);

    await user.click(screen.getByRole("button", { name: /regístrate/i }));
    await user.type(screen.getByLabelText(/nombre completo/i), "Ana de Souza");
    await user.click(screen.getByRole("button", { name: /registrarme y entrar/i }));

    await waitFor(() => expect(api.createUser).toHaveBeenCalledWith({ name: "Ana de Souza", initials: null }));
    expect(onLogin).toHaveBeenCalledWith(created);
  });
});
