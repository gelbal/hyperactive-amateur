// ABOUTME: StorageDurabilityChip — compact warning when clips live in non-persistent browser storage.
// ABOUTME: Uses session-only dismissal so the warning returns on the next mount while risk remains.
import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import {
  isManualInstallHintContext,
  requestPersistence,
  useCanInstall,
} from "../lib/install";
import { selectClipCount, useAppStore } from "../store/useAppStore";

const BASE_COPY =
  "This project can be cleared by the browser — visit regularly or install the app.";
const IOS_STORAGE_CAVEAT =
  "Installing the app later starts with separate storage, so this browser project will stay here.";

export function StorageDurabilityChip() {
  const clipCount = useAppStore(selectClipCount);
  const durability = useAppStore((s) => s.session.storageDurability);
  const installable = useCanInstall();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || clipCount === 0 || durability === "persistent") return null;

  const copy = isManualInstallHintContext(installable)
    ? `${BASE_COPY} ${IOS_STORAGE_CAVEAT}`
    : BASE_COPY;

  return (
    <aside
      aria-label="Storage durability notice"
      className="w-full max-w-3xl border border-orange-400/40 bg-orange-950/25 px-3 py-2 text-orange-100 sm:px-4"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-300" aria-hidden />
        <p className="min-w-0 flex-1 text-xs leading-5 text-orange-100/85">{copy}</p>
        <button
          type="button"
          aria-label="Request persistent storage"
          // Called synchronously in the click handler so the browser treats
          // the persistence request as user-gesture anchored.
          onClick={() => {
            void requestPersistence().then((storageDurability) => {
              useAppStore.getState().actions.setStorageDurability(storageDurability);
            });
          }}
          className="h-7 shrink-0 whitespace-nowrap rounded border border-orange-300/30 px-2 text-xs text-orange-100 hover:bg-orange-900/50"
        >
          Protect project
        </button>
        <button
          type="button"
          aria-label="Dismiss storage durability notice"
          onClick={() => setDismissed(true)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-orange-300/30 text-orange-100 hover:bg-orange-900/50"
        >
          <X size={14} />
        </button>
      </div>
    </aside>
  );
}
