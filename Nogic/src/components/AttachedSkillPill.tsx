import { FileSpreadsheet, FileText, FileType, X } from "lucide-react";
import {
  memoTemplateLabel,
  type MemoTemplateType,
} from "@/memoTemplates.ts";
import type { SkillTag } from "./Composer.tsx";

interface AttachedSkillPillProps {
  skill: SkillTag;
  templateType?: MemoTemplateType;
  onRemove: () => void;
}

export function AttachedSkillPill({
  skill,
  templateType,
  onRemove,
}: AttachedSkillPillProps) {
  const icon = skill === "pdf"
    ? <FileText size={16} />
    : skill === "word"
      ? <FileType size={16} />
      : <FileSpreadsheet size={16} />;
  const label = skill === "pdf"
    ? "PDF report"
    : skill === "word"
      ? "Word document"
      : "Excel document";

  return (
    <div className="flex px-4 pt-3">
      <div className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-muted)] px-2.5 py-2 text-[var(--text-primary)]">
        <span aria-hidden="true">{icon}</span>
        <span className="text-sec font-medium">
          {label}
          {templateType && (
            <span className="text-meta text-secondary">
              · {memoTemplateLabel(templateType)}
            </span>
          )}
        </span>
        <button
          type="button"
          aria-label="Remove document skill"
          onClick={onRemove}
          className="rounded p-0.5 text-tertiary hover:bg-[var(--bg-elevated)] hover:text-primary"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
