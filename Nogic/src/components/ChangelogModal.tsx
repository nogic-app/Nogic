import { X } from "lucide-react";
import { useEffect } from "react";
import { Button } from "./ui/button.tsx";

export const CURRENT_APP_VERSION = "1.1.0";

interface ChangelogModalProps {
  open: boolean;
  onClose: () => void;
}

export function ChangelogModal({ open, onClose }: ChangelogModalProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="changelog-title"
        className="w-full max-w-lg rounded-xl bg-[var(--bg)] p-6 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h2 id="changelog-title" className="text-title font-medium text-[var(--text-primary)]">
            What's New in v1.1.0
          </h2>
          <button type="button" aria-label="Close" onClick={onClose} className="sidebar-icon-button rounded-md p-1">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <ul className="mt-5 list-disc space-y-2 ps-5 text-sec text-[var(--text-secondary)]">
          <li>AI Chat Titles</li>
          <li>VRAM Control (keep_alive)</li>
          <li>Model Deletion</li>
          <li>AI Persona</li>
          <li>Temperature/Context Sliders</li>
          <li>Plant Comparison</li>
          <li>Clear Context</li>
          <li>Token Usage</li>
        </ul>
        <div className="mt-6 flex justify-end">
          <Button onClick={onClose}>Got it</Button>
        </div>
      </div>
    </div>
  );
}
