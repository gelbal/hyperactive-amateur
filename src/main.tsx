// ABOUTME: React entrypoint that mounts the App component to the #root div.
// ABOUTME: Loads global styles (Tailwind) here so they apply across the tree.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";
import { installWindowHook } from "./lib/logger";

// window.__haLogs exposes the in-memory log ring buffer (no secrets in it)
// on every build: a phone run with a cable and Web Inspector reads it here,
// and ?halogs=1 renders the same buffer on screen for browsers without one.
installWindowHook();

// Register the service worker in production builds only — a SW in dev would
// cache Vite's HMR assets and break the dev loop. Registration failure is
// non-fatal; the app still works online without the SW.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root element not found");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
