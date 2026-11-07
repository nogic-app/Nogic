import { useEffect, useState } from "react";
import { resolveResource } from "@tauri-apps/api/path";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { useTranslation } from "react-i18next";
import { Markdown } from "./Markdown.tsx";
import { X } from "lucide-react";

interface HelpModalProps {
  open: boolean;
  onClose: () => void;
}

export function HelpModal({ open, onClose }: HelpModalProps) {
  const { t } = useTranslation();
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setContent("");
    setLoading(true);
    setLoadFailed(false);

    const loadDocumentation = async () => {
      try {
        const path = await resolveResource("docs/DOCUMENTATION.md");
        const documentation = await readTextFile(path);
        if (!cancelled) setContent(documentation);
      } catch (error) {
        console.error("Could not load the bundled documentation.", error);
        if (!cancelled) setLoadFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadDocumentation();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={t("settings.helpTitle")}
        className="flex h-[600px] w-[800px] max-h-[calc(100vh-32px)] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-xl bg-[var(--bg)] shadow-xl"
      >
        <header className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
          <h2 className="text-title font-medium text-[var(--text-primary)]">
            {t("settings.helpTitle")}
          </h2>
          <button
            type="button"
            aria-label={t("settings.close")}
            title={t("settings.close")}
            onClick={onClose}
            className="sidebar-icon-button rounded-md p-1"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 text-sec leading-relaxed text-[var(--text-primary)]">
          {loading && (
            <p role="status" className="text-[var(--text-secondary)]">
              {t("settings.helpLoading")}
            </p>
          )}
          {loadFailed && (
            <p role="alert" className="text-[var(--text-secondary)]">
              {t("settings.helpLoadFailed")}
            </p>
          )}
          {!loading && !loadFailed && content && <Markdown>{content}</Markdown>}
        </div>
      </section>
    </div>
  );
}
