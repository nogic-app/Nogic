import type { SiteData } from "@/components/SiteCard.tsx";
import {
  isLawSourceArray,
  lawSourceLabel,
  type LawSource,
} from "@/lawSources.ts";
import { isPlantDataArray, toPlantCard, type PlantData } from "@/plants.ts";
import { isWebSourceArray, type WebSource } from "@/types/webSources.ts";
import { useSettings } from "@/contexts/SettingsContext.tsx";
import type { FileAttachment } from "@/components/FilePill.tsx";
import type { SkillTag } from "@/components/Composer.tsx";
import type { GeneratedFileType } from "@/components/GeneratedFileCard.tsx";
import { isMemoTemplateType, type MemoTemplateType } from "@/memoTemplates.ts";

export { isLawSourceArray };

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /** Request ID used for event correlation while streaming. */
  id?: string;
  parent_id?: string | null;
  /** SQLite row ID used for persisted-message operations. */
  persistedId?: string;
  isStreaming?: boolean;
  sources?: LawSource[];
  plant_data?: PlantData[];
  /** Web-mode search results, rendered as favicons and a dropdown. */
  web_sources?: WebSource[];
  /** Marks an answer produced by opt-in search after local RAG found no data. */
  unverified_web?: boolean;
  site_data?: SiteData;
  file_path?: string;
  file_size?: number;
  file_type?: GeneratedFileType;
  template_type?: MemoTemplateType | null;
  /** Streamed and persisted reasoning text (Think/DeepThink). */
  thinking?: string;
  /** True while reasoning chunks are arriving between progress steps. */
  isReasoningStreaming?: boolean;
  cached?: boolean;
  /** Current DeepThink pass label, e.g. "Drafting...". */
  step?: string;
  type?: "law_upload" | "plant_upload";
  attachments?: FileAttachment[];
  skill?: SkillTag;
  isEditable?: boolean;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isSiteData(value: unknown): value is SiteData {
  return (
    isRecord(value) &&
    typeof value.display_name === "string" &&
    typeof value.lat === "number" &&
    typeof value.lon === "number" &&
    typeof value.type === "string" &&
    typeof value.plants === "string" &&
    typeof value.water === "string" &&
    typeof value.notes === "string"
  );
}

function isGeneratedFileType(value: unknown): value is GeneratedFileType {
  return value === "PDF" || value === "DOCX" || value === "XLSX";
}

/**
 * Map SQLite history rows onto the display shape. The persisted `thinking`
 * column restores the Reasoning panel for messages loaded from disk.
 */
export function toHistoryMessages(rows: ChatMessage[]): ChatMessage[] {
  return rows.map((row) => {
    const message: ChatMessage = { role: row.role, content: row.content };
    if (typeof row.id === "string") message.id = row.id;
    if (typeof row.parent_id === "string" || row.parent_id === null) {
      message.parent_id = row.parent_id;
    }
    if (row.role === "assistant" && typeof row.id === "string") {
      message.persistedId = row.id;
    }
    if (row.sources && row.sources.length > 0) message.sources = row.sources;
    if (row.plant_data && row.plant_data.length > 0) {
      message.plant_data = row.plant_data;
    }
    if (row.web_sources && row.web_sources.length > 0) {
      message.web_sources = row.web_sources;
    }
    if (row.unverified_web === true) message.unverified_web = true;
    if (isSiteData(row.site_data)) {
      message.site_data = row.site_data;
    }
    if (typeof row.file_path === "string" && row.file_path.trim().length > 0) {
      message.file_path = row.file_path;
    }
    if (typeof row.file_size === "number" && row.file_size >= 0) {
      message.file_size = row.file_size;
    }
    if (isGeneratedFileType(row.file_type)) {
      message.file_type = row.file_type;
    }
    if (isMemoTemplateType(row.template_type)) {
      message.template_type = row.template_type;
    }
    if (
      row.skill === "pdf" ||
      row.skill === "word" ||
      row.skill === "excel"
    ) {
      message.skill = row.skill;
    }
    if (typeof row.thinking === "string" && row.thinking.trim().length > 0) {
      message.thinking = row.thinking;
    }
    if (row.attachments && row.attachments.length > 0) {
      message.attachments = row.attachments;
    }
    return message;
  });
}

export function isChatMessageArray(data: unknown): data is ChatMessage[] {
  return (
    Array.isArray(data) &&
    data.every(
      (message) =>
        isRecord(message) &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string" &&
        (message.id === undefined || typeof message.id === "string") &&
        (message.parent_id === undefined ||
          message.parent_id === null ||
          typeof message.parent_id === "string") &&
        (message.sources === undefined ||
          message.sources === null ||
          isLawSourceArray(message.sources)) &&
        (message.plant_data === undefined ||
          message.plant_data === null ||
          isPlantDataArray(message.plant_data)) &&
        (message.web_sources === undefined ||
          message.web_sources === null ||
          isWebSourceArray(message.web_sources)) &&
        (message.unverified_web === undefined ||
          typeof message.unverified_web === "boolean") &&
        (message.site_data === undefined ||
          message.site_data === null ||
          isSiteData(message.site_data)) &&
        (message.file_path === undefined || typeof message.file_path === "string") &&
        (message.file_size === undefined ||
          message.file_size === null ||
          (typeof message.file_size === "number" &&
            Number.isInteger(message.file_size) &&
            message.file_size >= 0)) &&
        (message.file_type === undefined ||
          message.file_type === null ||
          isGeneratedFileType(message.file_type)) &&
        (message.template_type === undefined ||
          message.template_type === null ||
          isMemoTemplateType(message.template_type)) &&
        (message.thinking === undefined || typeof message.thinking === "string") &&
        (message.step === undefined || typeof message.step === "string") &&
        (message.type === undefined ||
          message.type === "law_upload" ||
          message.type === "plant_upload") &&
        (message.skill === undefined ||
          message.skill === null ||
          message.skill === "pdf" ||
          message.skill === "word" ||
          message.skill === "excel") &&
        (message.isEditable === undefined ||
          typeof message.isEditable === "boolean") &&
        (message.attachments === undefined ||
          message.attachments === null ||
          (Array.isArray(message.attachments) &&
            message.attachments.every((file) =>
              isRecord(file) &&
              typeof file.name === "string" &&
              typeof file.path === "string" &&
              typeof file.type === "string" &&
              typeof file.size === "number",
            ))),
    )
  );
}

export function messageNodeId(message: ChatMessage): string | null {
  return message.persistedId ?? message.id ?? null;
}

export function latestMessageId(messages: ChatMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const id = messageNodeId(messages[index]);
    if (id) return id;
  }
  return null;
}

export function activeBranchMessages(
  messages: ChatMessage[],
  activeLeafId: string | null,
): ChatMessage[] {
  const indexById = new Map<string, number>();
  messages.forEach((message, index) => {
    if (message.id) indexById.set(message.id, index);
    if (message.persistedId) indexById.set(message.persistedId, index);
  });

  const leafId =
    activeLeafId && indexById.has(activeLeafId)
      ? activeLeafId
      : latestMessageId(messages);
  const branch: ChatMessage[] = [];
  const visited = new Set<number>();
  let currentIndex = leafId ? indexById.get(leafId) : undefined;

  while (currentIndex !== undefined && !visited.has(currentIndex)) {
    visited.add(currentIndex);
    const current = messages[currentIndex];
    branch.push(current);
    const parentId =
      current.parent_id === undefined && currentIndex > 0
        ? messageNodeId(messages[currentIndex - 1])
        : current.parent_id;
    currentIndex =
      typeof parentId === "string" ? indexById.get(parentId) : undefined;
  }

  branch.reverse();
  const included = new Set(branch);
  const transient = messages.filter(
    (message) => message.parent_id === undefined && !included.has(message),
  );
  return [...branch, ...transient];
}

export function messageSiblings(
  messages: ChatMessage[],
  message: ChatMessage,
): ChatMessage[] {
  const parentId = message.parent_id ?? null;
  return messages.filter(
    (candidate) =>
      messageNodeId(candidate) !== null &&
      candidate.parent_id === parentId,
  );
}

export function latestDescendantLeafId(
  messages: ChatMessage[],
  rootId: string,
): string | null {
  const childIds = new Map<string, string[]>();
  const indexById = new Map<string, number>();
  messages.forEach((message, index) => {
    const id = messageNodeId(message);
    if (!id) return;
    indexById.set(id, index);
    if (typeof message.parent_id === "string") {
      const children = childIds.get(message.parent_id) ?? [];
      children.push(id);
      childIds.set(message.parent_id, children);
    }
  });

  const visited = new Set<string>();
  const stack = [rootId];
  const leaves: string[] = [];
  while (stack.length > 0) {
    const id = stack.pop();
    if (!id || visited.has(id)) continue;
    visited.add(id);
    const children = childIds.get(id) ?? [];
    if (children.length === 0) {
      leaves.push(id);
    } else {
      stack.push(...children);
    }
  }
  return leaves.reduce<string | null>((latest, id) => {
    if (!latest) return id;
    return (indexById.get(id) ?? -1) > (indexById.get(latest) ?? -1)
      ? id
      : latest;
  }, null);
}

interface WelcomeScreenProps {
  onPromptSelect: (prompt: string) => void;
  t: (key: string) => string;
}

export function WelcomeScreen({ onPromptSelect, t }: WelcomeScreenProps) {
  const { userName } = useSettings();
  const examplePrompts = [
    t("welcome.prompt1"),
    t("welcome.prompt2"),
    t("welcome.prompt3"),
  ];

  return (
    <section className="welcome-screen" aria-label="Welcome">
      <h1 className="welcome-screen-title">
        {t("welcome.greeting")},{" "}
        {userName.trim() || t("welcome.fallbackName")}.
      </h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 w-full max-w-4xl mx-auto px-4 mt-6">
        {examplePrompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            className="w-full text-left border border-[var(--border)] rounded-lg p-3 text-sm text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
            onClick={() => onPromptSelect(prompt)}
          >
            {prompt}
          </button>
        ))}
      </div>
    </section>
  );
}
