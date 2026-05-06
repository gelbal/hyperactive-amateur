// ABOUTME: React entrypoint that mounts the App component to the #root div.
// ABOUTME: Loads global styles (Tailwind) here so they apply across the tree.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root element not found");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
