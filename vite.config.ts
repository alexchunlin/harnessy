/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { harnessyServer } from "./src/server/plugin";

export default defineConfig({
  plugins: [react(), harnessyServer()],
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "node",
  },
});
