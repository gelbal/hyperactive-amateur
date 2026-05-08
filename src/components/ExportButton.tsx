// ABOUTME: ExportButton — top-bar button that opens the ExportDialog.
import { useState } from "react";
import { Download } from "lucide-react";
import { ExportDialog } from "./ExportDialog";

export function ExportButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label="Export"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-3 py-2 text-sm rounded bg-zinc-900 border border-zinc-700 text-zinc-200 hover:bg-zinc-800 hover:border-zinc-500 transition-colors"
      >
        <Download size={14} />
        Export
      </button>
      <ExportDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
