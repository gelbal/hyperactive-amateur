/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Expose env vars starting with GEMINI_ in addition to the default VITE_
  // prefix. Lets us read import.meta.env.GEMINI_API_KEY without a prefix.
  envPrefix: ["VITE_", "GEMINI_"],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    css: false,
  },
});
