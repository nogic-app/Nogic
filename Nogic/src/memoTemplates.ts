export const MEMO_TEMPLATE_OPTIONS = [
  { type: "default", label: "Default Memo" },
  { type: "client_summary", label: "Client Summary" },
  { type: "legal_reference", label: "Legal Reference" },
  { type: "checklist", label: "Checklist" },
] as const;

export type MemoTemplateType = (typeof MEMO_TEMPLATE_OPTIONS)[number]["type"];

export function isMemoTemplateType(value: unknown): value is MemoTemplateType {
  return MEMO_TEMPLATE_OPTIONS.some((template) => template.type === value);
}

export function memoTemplateLabel(
  templateType: MemoTemplateType,
): string {
  return MEMO_TEMPLATE_OPTIONS.find(
    (template) => template.type === templateType,
  )?.label ?? "Default Memo";
}
