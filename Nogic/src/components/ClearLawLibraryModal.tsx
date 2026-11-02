import { X } from "lucide-react";
import { Button } from "./ui/button.tsx";
import { fetchLawStatus } from "@/lawLibrary.ts";
import { requestSidecar } from "@/sidecarRequest.ts";

interface ClearLawLibraryModalProps {
  open: boolean;
  onClose: () => void;
}

function isSuccessfulClear(value: unknown): value is { success: true } {
  return (
    typeof value === "object" &&
    value !== null &&
    "success" in value &&
    value.success === true
  );
}

export function ClearLawLibraryModal({
  open,
  onClose,
}: ClearLawLibraryModalProps) {
  if (!open) return null;

  const clearLibrary = async () => {
    try {
      await requestSidecar("clear_law_library", {}, isSuccessfulClear);
      await fetchLawStatus();
      onClose();
    } catch (error) {
      console.error("Failed to clear the law library.", error);
      window.alert(`Nogic could not clear the law library: ${String(error)}`);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
          <h2 className="text-title font-medium text-[var(--text-primary)]">
            Clear Law Library
          </h2>
          <button
            type="button"
            aria-label="Close clear law library"
            onClick={onClose}
            className="sidebar-icon-button rounded-md p-1"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="px-6 py-4">
          <p className="text-sec text-[var(--text-secondary)]">
            This will delete all indexed law articles and PDF files. This cannot
            be undone.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-6 py-3">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="accent"
            onClick={() => void clearLibrary()}
            className="bg-[var(--danger)] text-white hover:opacity-90"
          >
            Clear Law Library
          </Button>
        </div>
      </div>
    </div>
  );
}
