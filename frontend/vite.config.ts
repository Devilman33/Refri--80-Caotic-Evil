/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/setupTests.ts"],
    css: true,
    // Los tests de integración de App tipean con userEvent y esperan el debounce del
    // buscador: ~1-1,5 s cada uno. Con 5 s (el default) fallaban por tiempo en una máquina
    // cargada aunque el comportamiento fuera correcto.
    testTimeout: 15000,
  },
});
