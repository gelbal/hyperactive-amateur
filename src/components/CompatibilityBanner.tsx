// ABOUTME: CompatibilityBanner — feature-detects required APIs and warns if any are missing.
// ABOUTME: Dismissible, persisted in localStorage so it doesn't nag returning users.
import { useEffect, useState } from "react";
import { X } from "lucide-react";

const DISMISS_KEY = "hyperactive-amateur-compat-dismissed";

interface SupportReport {
  ok: boolean;
  missing: string[];
}

export function detectSupport(): SupportReport {
  const missing: string[] = [];
  if (typeof MediaRecorder === "undefined") missing.push("MediaRecorder");
  else {
    try {
      if (!MediaRecorder.isTypeSupported("video/webm; codecs=vp9,opus")) {
        missing.push("WebM/VP9 recording");
      }
    } catch {
      missing.push("MediaRecorder");
    }
  }
  if (typeof HTMLCanvasElement === "undefined" || typeof HTMLCanvasElement.prototype.captureStream !== "function") {
    missing.push("Canvas captureStream");
  }
  if (typeof window !== "undefined" && typeof (window as Window & { AudioContext?: unknown }).AudioContext === "undefined") {
    missing.push("Web Audio API");
  }
  if (typeof indexedDB === "undefined") missing.push("IndexedDB");
  return { ok: missing.length === 0, missing };
}

export function CompatibilityBanner() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return window.localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [report, setReport] = useState<SupportReport | null>(null);

  useEffect(() => {
    setReport(detectSupport());
  }, []);

  if (!report || report.ok || dismissed) return null;

  const handleDismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // localStorage might be disabled; in that case the banner just won't persist.
    }
    setDismissed(true);
  };

  return (
    <div
      role="alert"
      className="bg-orange-900/80 border-b border-orange-700 text-orange-100 px-4 py-2 flex items-center gap-3"
    >
      <span className="text-sm flex-1">
        Hyperactive Amateur needs Chrome or Edge. Your browser is missing: {report.missing.join(", ")}.
      </span>
      <button
        type="button"
        aria-label="Dismiss compatibility banner"
        onClick={handleDismiss}
        className="text-orange-200 hover:text-white"
      >
        <X size={16} />
      </button>
    </div>
  );
}
