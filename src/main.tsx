// ABOUTME: React entrypoint that mounts the App component to the #root div.
// ABOUTME: Loads global styles (Tailwind) here so they apply across the tree.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";

if (import.meta.env.PROD && import.meta.env.VITE_ANTHROPIC_API_KEY) {
  // eslint-disable-next-line no-console
  console.warn(
    "[Hyperpad] Anthropic API key detected in production bundle. Migrate to a server proxy before public deploy. See docs/AI-MIGRATION.md.",
  );
}
if (import.meta.env.PROD && import.meta.env.VITE_GEMINI_API_KEY) {
  // eslint-disable-next-line no-console
  console.warn(
    "[Hyperpad] Gemini API key detected in production bundle. Migrate to a server proxy before public deploy. See docs/AI-MIGRATION.md.",
  );
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root element not found");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
