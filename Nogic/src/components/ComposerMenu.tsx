import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ChevronRight,
  FileSpreadsheet,
  FileText,
  FileType,
  Image,
  Paperclip,
} from "lucide-react";
import {
  MEMO_TEMPLATE_OPTIONS,
  type MemoTemplateType,
} from "@/memoTemplates.ts";

type SkillTag = "pdf" | "word" | "excel";

interface ComposerMenuProps {
  attachLabel: string;
  supportsVision: boolean;
  onAttachFile: (imagesOnly: boolean) => void;
  onSelectSkill: (
    skill: SkillTag,
    templateType?: MemoTemplateType,
  ) => void;
}

export function ComposerMenu({
  attachLabel,
  supportsVision,
  onAttachFile,
  onSelectSkill,
}: ComposerMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [openFormat, setOpenFormat] = useState<"pdf" | "word" | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  const selectSkill = (
    skill: SkillTag,
    templateType?: MemoTemplateType,
  ) => {
    setIsOpen(false);
    setOpenFormat(null);
    onSelectSkill(skill, templateType);
  };

  const renderTemplateMenu = (format: "pdf" | "word") => (
    <div
      role="menu"
      aria-label={`${format === "pdf" ? "PDF" : "Word"} layouts`}
      className="ms-5 border-s border-border ps-1"
    >
      {MEMO_TEMPLATE_OPTIONS.map(({ type, label }) => (
        <button
          key={`${format}-${type}`}
          type="button"
          role="menuitem"
          className="flex w-full items-center rounded px-2 py-1.5 text-start text-meta text-secondary hover:bg-[var(--bg-muted)] hover:text-primary"
          onClick={() => selectSkill(format, type)}
        >
          {label}
        </button>
      ))}
    </div>
  );

  const renderFormatMenu = (
    format: "pdf" | "word",
    label: string,
    icon: ReactNode,
  ) => (
    <>
      <button
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={openFormat === format}
        onClick={() =>
          setOpenFormat((current) => current === format ? null : format)
        }
        className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-start text-sec hover:bg-[var(--bg-muted)] hover:text-primary"
      >
        <span className="flex items-center gap-2">
          {icon}
          {label}
        </span>
        <ChevronRight size={14} aria-hidden="true" />
      </button>
      {openFormat === format && renderTemplateMenu(format)}
    </>
  );

  const renderFormatIcon = (format: "pdf" | "word") =>
    format === "pdf"
      ? <FileText size={14} aria-hidden="true" />
      : <FileType size={14} aria-hidden="true" />;

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        type="button"
        aria-label={attachLabel}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-secondary transition-colors hover:bg-[var(--bg-muted)] hover:text-primary"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {isOpen && (
        <div
          role="menu"
          aria-label="Skills"
          className="absolute bottom-full start-0 z-20 mb-2 w-56 rounded-md border border-border bg-[var(--bg-elevated)] p-1 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
        >
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-start text-sec hover:bg-[var(--bg-muted)] hover:text-primary"
            onClick={() => {
              setIsOpen(false);
              onAttachFile(false);
            }}
          >
            <Paperclip size={14} aria-hidden="true" />
            Add File
          </button>
          {supportsVision && (
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-start text-sec hover:bg-[var(--bg-muted)] hover:text-primary"
              onClick={() => {
                setIsOpen(false);
                onAttachFile(true);
              }}
            >
              <Image size={14} aria-hidden="true" />
              Add Image
            </button>
          )}
          <div role="separator" className="my-1 border-t border-border" />
          <p className="px-2 pb-1 pt-1 text-meta uppercase tracking-wide text-tertiary">
            Skills
          </p>
          {renderFormatMenu("pdf", "Generate PDF", renderFormatIcon("pdf"))}
          {renderFormatMenu("word", "Generate Word", renderFormatIcon("word"))}
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-start text-sec hover:bg-[var(--bg-muted)] hover:text-primary"
            onClick={() => selectSkill("excel")}
          >
            <FileSpreadsheet size={14} aria-hidden="true" />
            Generate Excel
          </button>
        </div>
      )}
    </div>
  );
}
