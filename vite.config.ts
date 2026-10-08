/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

function assertProductionApiUrl(env: Record<string, string>) {
  if (env.VITE_ALLOW_LOCAL_API === "1") {
    return;
  }
  const api = env.VITE_API_URL ?? "";
  if (!api || /localhost|127\.0\.0\.1/i.test(api)) {
    throw new Error(
      "Defina VITE_API_URL com a URL pública do servidor para o build de produção, ou VITE_ALLOW_LOCAL_API=1.",
    );
  }
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  if (command === "build" && mode === "production") {
    assertProductionApiUrl(env);
  }

  return {
    plugins: [react()],
    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
      watch: {
        ignored: ["**/src-tauri/**", "**/server/**"],
      },
    },
    test: {
      // Testes de componente pedem jsdom com "// @vitest-environment jsdom" no topo do arquivo.
      environment: "node",
      include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    },
  };
});
