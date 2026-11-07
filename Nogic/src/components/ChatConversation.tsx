import { useMemo, useState } from "react";
import { useSettings } from "@/contexts/SettingsContext.tsx";
import type { ChatModes } from "@/chatModes.ts";
import { lawSourceLabel } from "@/lawSources.ts";
import { toPlantCard } from "@/plants.ts";
import { ChatFileCard } from "@/components/ChatFileCard.tsx";
import { AssistantMessage, UserMessage } from "@/components/Message.tsx";
import { Markdown } from "@/components/Markdown.tsx";
import { SourceFooter } from "@/components/SourceFooter.tsx";
import { LawUploadCard } from "@/components/LawUploadCard.tsx";
import { PlantUploadCard } from "@/components/PlantUploadCard.tsx";
import { PlantCard } from "@/components/PlantCard.tsx";
import { SiteCard } from "@/components/SiteCard.tsx";
import { WebSources } from "@/components/WebSources.tsx";
import { FilePill } from "@/components/FilePill.tsx";
import {
  latestDescendantLeafId,
  messageNodeId,
  messageSiblings,
  type ChatMessage,
} from "@/WorkspaceContent.tsx";
import type { PlantData } from "@/plants.ts";
import type { SkillTag } from "@/components/Composer.tsx";
import type { MemoTemplateType } from "@/memoTemplates.ts";
import { requestSidecar } from "@/sidecarRequest.ts";

function isLawPdfPath(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

interface ChatConversationProps {
  messages: ChatMessage[];
  branchMessages: ChatMessage[];
  isStreaming: boolean;
  elapsedSeconds: number;
  editingMessageId: string | null;
  isThinkMode: boolean;
  modes: ChatModes;
  isExtractive: boolean;
  onRetry: (
    prompt: string,
    skill: SkillTag,
    templateType?: MemoTemplateType | null,
  ) => void;
  onEditMessage: (messageId: string, content: string) => Promise<void>;
  onEditingMessageChange: (messageId: string | null) => void;
  onRegenerateMessage: (messageId: string) => Promise<void>;
  onSelectBranch: (leafId: string) => void;
  onOpenPdf: (filePath: string, page: number) => void;
}

export function ChatConversation({
  messages,
  branchMessages,
  isStreaming,
  elapsedSeconds,
  editingMessageId,
  isThinkMode,
  modes,
  isExtractive,
  onRetry,
  onEditMessage,
  onEditingMessageChange,
  onRegenerateMessage,
  onSelectBranch,
  onOpenPdf,
}: ChatConversationProps) {
  const { showSources } = useSettings();
  const [selectedPlants, setSelectedPlants] = useState<PlantData[]>([]);
  const [comparisonOpen, setComparisonOpen] = useState(false);

  const comparisonMarkdown = useMemo(() => {
    const cell = (value: string, sourceUrl: string) =>
      `[${value || "Not recorded"}](${sourceUrl})`;
    const headers = selectedPlants.map(
      (plant) => plant.common_name?.trim() || plant.latin_name,
    );
    const rows: Array<[string, string[]]> = [
      ["Water", selectedPlants.map((plant) => plant.water_need?.trim() || "")],
      ["Sun", selectedPlants.map((plant) => plant.sun_exposure?.trim() || "")],
      [
        "Native Region",
        selectedPlants.map((plant) =>
          plant.native_to_morocco
            ? "Native to Morocco"
            : "Not marked native to Morocco",
        ),
      ],
    ];
    return [
      `| Feature | ${headers.join(" | ")} |`,
      `| --- | ${headers.map(() => "---").join(" | ")} |`,
      ...rows.map(
        ([feature, values]) =>
          `| ${feature} | ${(values as string[])
            .map((value, index) => cell(value, selectedPlants[index].source_url))
            .join(" | ")} |`,
      ),
    ].join("\n");
  }, [selectedPlants]);

  const togglePlant = (plant: PlantData, selected: boolean) => {
    setSelectedPlants((current) =>
      selected
        ? current.some((item) => item.id === plant.id)
          ? current
          : [...current, plant]
        : current.filter((item) => item.id !== plant.id),
    );
  };

  return (
    <>
      {messages.map((message, index) => {
    const key = message.id ?? `${message.role}-${index}`;
    const isUnverifiedWeb = message.unverified_web === true;
    const siblings = messageSiblings(branchMessages, message);
    const messageId = messageNodeId(message);
    const siblingIndex = siblings.findIndex(
      (sibling) => messageNodeId(sibling) === messageId,
    );
    const branchNavigation =
      !isStreaming && siblings.length > 1 && siblingIndex >= 0
        ? {
            current: siblingIndex + 1,
            total: siblings.length,
            onPrevious: () => selectSibling(siblingIndex - 1),
            onNext: () => selectSibling(siblingIndex + 1),
          }
        : undefined;
    function selectSibling(index: number) {
      const sibling = siblings[index];
      const siblingId = sibling ? messageNodeId(sibling) : null;
      if (!siblingId) return;
      onSelectBranch(
        latestDescendantLeafId(branchMessages, siblingId) ?? siblingId,
      );
    }

    if (message.type === "law_upload") {
      return <LawUploadCard key={key} />;
    }
    if (message.type === "plant_upload") {
      return <PlantUploadCard key={key} />;
    }
    if (message.role === "user") {
      return (
        <UserMessage
          key={key}
          content={message.content}
          isEditing={message.id === editingMessageId}
          onEditingChange={(isEditing) =>
            onEditingMessageChange(isEditing ? message.id ?? null : null)
          }
          branchNavigation={branchNavigation}
          onSave={
            message.id && message.isEditable !== false
              ? (content) => onEditMessage(message.id ?? "", content)
              : undefined
          }
        >
          <Markdown>{message.content}</Markdown>
          {message.skill && (
            <span className="mt-2 inline-flex items-center rounded-md bg-[var(--accent-subtle)] px-2 py-1 text-meta font-medium text-[var(--accent)]">
              {message.skill === "pdf"
                ? "📄 PDF Report"
                : message.skill === "word"
                  ? "📝 Word Document"
                  : "📊 Excel Document"}
            </span>
          )}
          {message.attachments && message.attachments.length > 0 && (
            <div className="mt-2 grid gap-2">
              {message.attachments.map((file) => (
                <FilePill key={`${file.path}-${file.name}`} file={file} />
              ))}
            </div>
          )}
        </UserMessage>
      );
    }
    const previousMessage = messages[index - 1];
    const previousUser =
      previousMessage?.role === "user" ? previousMessage : undefined;
    return (
      <div key={key}>
        <AssistantMessage
          isStreaming={
            message.isStreaming ??
            (isStreaming && index === messages.length - 1)
          }
          elapsedSeconds={elapsedSeconds}
          thinkingText={message.thinking}
          isReasoningStreaming={
            message.isReasoningStreaming === true &&
            typeof message.thinking === "string" &&
            message.thinking.trim().length > 0
          }
          stepText={message.step}
          showThinking={isThinkMode}
          modes={modes}
          isExtractive={isExtractive}
          rawContent={message.content}
          persistedMessageId={message.persistedId}
          isCached={message.cached === true}
          unverifiedWeb={isUnverifiedWeb}
          branchNavigation={branchNavigation}
          onRegenerate={
            index === messages.length - 1 && message.persistedId
              ? (messageId) => void onRegenerateMessage(messageId)
              : undefined
          }
        >
          {message.content ? <Markdown>{message.content}</Markdown> : null}
          {!isUnverifiedWeb && (
            <ChatFileCard
              message={message}
              previousUser={previousUser}
              showErrorCard={!(isStreaming && index === messages.length - 1)}
              onRetry={onRetry}
            />
          )}
        </AssistantMessage>
        {!isUnverifiedWeb && message.site_data && (
          <SiteCard data={message.site_data} />
        )}
        {!isUnverifiedWeb &&
          message.plant_data &&
          message.plant_data.length > 0 && (
          <ul className="mt-2 space-y-1" aria-label="Plant results">
            {message.plant_data.map((plant) => (
              <PlantCard
                key={plant.id}
                plant={toPlantCard(plant)}
                selected={selectedPlants.some((item) => item.id === plant.id)}
                onSelectionChange={(selected) => togglePlant(plant, selected)}
              />
            ))}
          </ul>
        )}
        {!isUnverifiedWeb &&
          message.web_sources &&
          message.web_sources.length > 0 && (
          <WebSources sources={message.web_sources} />
        )}
        {!isUnverifiedWeb &&
          showSources &&
          message.sources &&
          message.sources.length > 0 && (
          <SourceFooter
            label="Sources"
            items={message.sources.map((source) => ({
              label: lawSourceLabel(source),
              onClick: async () => {
                const filePath = await requestSidecar(
                  "get_law_pdf_path",
                  {
                    law_name: source.law_name,
                    country: source.country ?? "MA",
                  },
                  isLawPdfPath,
                );
                onOpenPdf(filePath, source.page_num);
              },
            }))}
          />
        )}
      </div>
    );
      })}
      {selectedPlants.length >= 2 && (
        <button
          type="button"
          className="fixed bottom-24 left-1/2 z-30 -translate-x-1/2 rounded-md border border-border bg-[var(--bg-elevated)] px-4 py-2 text-sec text-primary shadow-xl hover:bg-[var(--bg-muted)]"
          onClick={() => setComparisonOpen(true)}
        >
          Compare {selectedPlants.length} Plants
        </button>
      )}
      {comparisonOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-6">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="plant-comparison-title"
            className="max-h-[80vh] w-full max-w-3xl overflow-auto rounded-lg border border-border bg-[var(--bg-elevated)] p-5 shadow-xl"
          >
            <div className="mb-4 flex items-center justify-between gap-4">
              <h2 id="plant-comparison-title" className="text-body font-medium">
                Plant comparison
              </h2>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-sec text-secondary hover:bg-[var(--bg-muted)]"
                onClick={() => setComparisonOpen(false)}
              >
                Close
              </button>
            </div>
            <Markdown>{comparisonMarkdown}</Markdown>
          </div>
        </div>
      )}
    </>
  );
}
