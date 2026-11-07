import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

interface PdfViewerModalProps {
  filePath: string;
  initialPage: number;
  onClose: () => void;
  t: (key: string) => string;
}

export function PdfViewerModal({
  filePath,
  initialPage,
  onClose,
  t,
}: PdfViewerModalProps) {
  const [page, setPage] = useState(Math.max(1, initialPage));
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pdfUrl =
    filePath.startsWith("http") || filePath.startsWith("asset:")
      ? filePath
      : convertFileSrc(filePath);
  const filename = filePath.split(/[\\/]/).pop() || filePath;

  useEffect(() => {
    setPage(Math.max(1, initialPage));
    setPageCount(null);
    setError(null);
  }, [filePath, initialPage]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`PDF viewer: ${filename}`}
        className="flex h-[90vh] w-[90vw] flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-center justify-between border-b border-[var(--border)] p-4">
          <p
            className="truncate font-medium text-[var(--text-primary)]"
            title={filename}
          >
            {filename}
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close PDF viewer"
            className="rounded-md p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <div className="flex min-h-0 flex-1 justify-center overflow-auto bg-[var(--bg-muted)] p-4">
          {error ? (
            <p role="alert" className="mt-8 text-sm text-[var(--danger)]">
              {error}
            </p>
          ) : (
            <Document
              file={pdfUrl}
              onLoadSuccess={({ numPages }) => {
                setPageCount(numPages);
                setPage(Math.min(Math.max(1, initialPage), numPages));
              }}
              onLoadError={(cause) => {
                console.error("PDF Load Error:", cause);
                setError("Could not load this law PDF.");
              }}
              loading={
                <p className="mt-8 text-sm text-[var(--text-secondary)]">
                  Loading PDF…
                </p>
              }
              error={
                <p className="mt-8 text-sm text-[var(--danger)]">
                  Could not load this law PDF.
                </p>
              }
            >
              <Page
                pageNumber={page}
                width={Math.min(window.innerWidth * 0.84, 1200)}
                renderAnnotationLayer={false}
                renderTextLayer={false}
              />
            </Document>
          )}
        </div>
        <footer className="flex shrink-0 items-center gap-4 border-t border-[var(--border)] p-3">
          <p className="mr-auto text-[11px] text-[var(--text-tertiary)] italic">
            {t("pdf.ocrDisclaimer")}
          </p>
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            className="flex items-center gap-1 rounded-md px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-muted)] disabled:opacity-40"
          >
            <ChevronLeft size={16} aria-hidden="true" />
            Prev
          </button>
          <span
            className="text-sm text-[var(--text-secondary)]"
            aria-live="polite"
          >
            Page {page}
            {pageCount ? ` of ${pageCount}` : ""}
          </span>
          <button
            type="button"
            disabled={pageCount === null || page >= pageCount}
            onClick={() =>
              setPage((current) =>
                pageCount === null
                  ? current
                  : Math.min(pageCount, current + 1),
              )
            }
            className="flex items-center gap-1 rounded-md px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-muted)] disabled:opacity-40"
          >
            Next
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </footer>
      </div>
    </div>
  );
}
