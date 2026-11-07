import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  ChevronDown,
  Globe,
  Layers,
  Square,
} from "lucide-react";
import type { ChatModes } from "@/chatModes.ts";
import { useSettings } from "@/contexts/SettingsContext.tsx";
import { useTranslation } from "react-i18next";
import { FilePill, type FileAttachment } from "./FilePill.tsx";
import { ComposerMenu } from "./ComposerMenu.tsx";
import { AttachedSkillPill } from "./AttachedSkillPill.tsx";
import { PromptLibrary } from "./PromptLibrary.tsx";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import type { MemoTemplateType } from "@/memoTemplates.ts";

export type SkillTag = "pdf" | "word" | "excel";

interface ComposerProps {
  text: string;
  onTextChange: (value: string) => void;
  attachments: FileAttachment[];
  onAttachmentsChange: (attachments: FileAttachment[]) => void;
  isStreaming: boolean;
  onSend: (
    modes: ChatModes,
    attachments: FileAttachment[],
    skill: SkillTag | null,
    templateType?: MemoTemplateType,
  ) => void;
  onStop: () => void;
  /** Retained for the workspace capability contract; images are not a composer skill. */
  supportsVision: boolean;
  modelCapabilities: string[] | null;
  /** False when the active Ollama model reports no thinking capability. */
  supportsThinking: boolean;
  /** Inline notice below the composer (e.g. Ollama offline). */
  notice?: ReactNode;
}

const MAX_LINES = 6;

const TOGGLE_BASE =
  "flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-sec transition-colors";
const TOGGLE_INACTIVE =
  "border-[var(--border)] text-secondary hover:bg-[var(--bg-muted)] hover:text-primary";
const TOGGLE_ACTIVE =
  "border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent)]";

function toggleClass(active: boolean): string {
  return `${TOGGLE_BASE} ${active ? TOGGLE_ACTIVE : TOGGLE_INACTIVE}`;
}

export function Composer({
  text,
  onTextChange,
  attachments,
  onAttachmentsChange,
  isStreaming,
  onSend,
  onStop,
  supportsVision,
  modelCapabilities,
  supportsThinking,
  notice,
}: ComposerProps) {
  const { sendWithEnter } = useSettings();
  const { t } = useTranslation();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [isDeepThink, setIsDeepThink] = useState<boolean>(false);
  const [isWeb, setIsWeb] = useState<boolean>(false);
  const [isThink, setIsThink] = useState<boolean>(false);
  const [attachedSkill, setAttachedSkill] = useState<SkillTag | null>(null);
  const [attachedTemplateType, setAttachedTemplateType] =
    useState<MemoTemplateType>();

  useEffect(() => {
    if (supportsThinking) return;
    setIsThink(false);
    setIsDeepThink(false);
  }, [supportsThinking]);

  // Auto-grow up to 6 lines, then scroll.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 22.4;
    const max = lineHeight * MAX_LINES;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [text]);

  const canSend = !isStreaming && (
    text.trim().length > 0 ||
    attachments.length > 0 ||
    attachedSkill !== null
  );

  const send = () => {
    if (!canSend) return;
    onSend(
      {
        think: supportsThinking && isThink,
        deep_think: supportsThinking && isDeepThink,
        web: isWeb,
      },
      attachments,
      attachedSkill,
      attachedTemplateType,
    );
    onAttachmentsChange([]);
    setAttachedSkill(null);
    setAttachedTemplateType(undefined);
  };

  const attachFile = async (imagesOnly: boolean) => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: imagesOnly ? "Images" : "Documents",
          extensions: imagesOnly
            ? ["png", "jpg", "jpeg", "gif", "webp"]
            : ["pdf", "txt", "docx", "xlsx", "xls", "csv"],
        }],
      });
      if (typeof selected !== "string") return;
      const file = await invoke<{ name: string; size: number; type: string }>("get_file_metadata", {
        filePath: selected,
      });
      onAttachmentsChange([
        ...attachments.filter((item) => item.path !== selected),
        { ...file, path: selected },
      ]);
    } catch (error) {
      console.error("Failed to save the attached file.", error);
      window.alert(`Nogic could not save that file: ${String(error)}`);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter") return;

    if (sendWithEnter) {
      // Enter sends; Shift+Enter keeps the default newline behaviour.
      if (e.shiftKey) return;
      e.preventDefault();
      send();
      return;
    }

    // Enter inserts a newline; Ctrl+Enter (or Cmd+Enter) sends.
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="w-full">
      <div className="rounded-lg border border-border bg-elevated shadow-quiet transition-shadow focus-within:border-border-strong focus-within:shadow-[0_0_0_2px_var(--focus)]">
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-4 pt-3">
            {attachments.map((file) => (
              <FilePill
                key={file.path}
                file={file}
                onRemove={() => onAttachmentsChange(
                  attachments.filter((item) => item.path !== file.path),
                )}
              />
            ))}
          </div>
        )}
        {attachedSkill && (
          <AttachedSkillPill
            skill={attachedSkill}
            templateType={attachedTemplateType}
            onRemove={() => {
              setAttachedSkill(null);
              setAttachedTemplateType(undefined);
            }}
          />
        )}
        <textarea
          id="chat-composer"
          ref={ref}
          dir="auto"
          rows={1}
          value={text}
          placeholder={t("composer.placeholder")}
          onChange={(e) => onTextChange(e.target.value)}
          onKeyDown={onKeyDown}
          className="block w-full resize-none bg-transparent px-4 pb-1 pt-3 text-body text-primary placeholder:text-tertiary focus:outline-none"
        />
        <div className="flex items-center justify-between gap-2 px-2 pb-2">
          <div className="flex min-w-0 items-center gap-1">
            <ComposerMenu
              attachLabel={t("composer.attach")}
              supportsVision={supportsVision}
              onAttachFile={(imagesOnly) => void attachFile(imagesOnly)}
              onSelectSkill={(skill, templateType) => {
                setAttachedSkill(skill);
                setAttachedTemplateType(templateType);
              }}
            />
            <PromptLibrary value={text} onChange={onTextChange} />
            <button
              type="button"
              aria-label="DeepThink"
              aria-pressed={supportsThinking && isDeepThink}
              disabled={!supportsThinking}
              title={
                supportsThinking
                  ? undefined
                  : "This model does not support reasoning."
              }
              onClick={() => setIsDeepThink((active) => !active)}
              className={`${toggleClass(supportsThinking && isDeepThink)} disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <Layers size={14} aria-hidden="true" />
              DeepThink
            </button>
            <button
              type="button"
              aria-label="Web search"
              aria-pressed={isWeb}
              onClick={() => setIsWeb((active) => !active)}
              className={toggleClass(isWeb)}
            >
              <Globe size={14} aria-hidden="true" />
              Web
            </button>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <div className="relative">
              <select
                aria-label="Reasoning mode"
                value={supportsThinking && isThink ? "think" : "fast"}
                onChange={(event) => setIsThink(supportsThinking && event.target.value === "think")}
                className={`h-8 cursor-pointer appearance-none rounded-md border ps-2.5 pe-7 text-sec transition-colors focus:outline-none focus-visible:border-[var(--border-strong)] ${
                  supportsThinking && isThink
                    ? "border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent)]"
                    : "border-[var(--border)] bg-transparent text-secondary hover:bg-[var(--bg-muted)] hover:text-primary"
                }`}
              >
                <option value="fast" className="bg-[var(--bg-elevated)] text-[var(--text-primary)]">
                  Fast
                </option>
                <option value="think" disabled={!supportsThinking} className="bg-[var(--bg-elevated)] text-[var(--text-primary)] disabled:opacity-50">Think</option>
              </select>
              <ChevronDown
                size={12}
                aria-hidden="true"
                className="pointer-events-none absolute end-2 top-1/2 -translate-y-1/2 text-tertiary"
              />
            </div>
            <button
              type="button"
              aria-label={isStreaming ? "Stop generating" : t("composer.send")}
              disabled={!isStreaming && !canSend}
              onClick={isStreaming ? onStop : send}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {isStreaming ? (
                <Square size={16} fill="currentColor" aria-hidden="true" />
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path
                    d="M8 13V3M3.5 7.5 8 3l4.5 4.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
      {notice && <p className="mt-2 text-sec text-secondary">{notice}</p>}
      {attachedSkill && !supportsThinking && (
        <p className="mt-2 text-meta text-[var(--warning)]">
          {t("composer.simpleModelWarning")}
        </p>
      )}
    </div>
  );
}
