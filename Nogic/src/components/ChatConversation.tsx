import { invoke } from "@tauri-apps/api/core";
import { useMemo, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { useSettings } from "@/contexts/SettingsContext.tsx";
import type { ChatModes } from "@/chatModes.ts";
import { lawSourceLabel } from "@/lawSources.ts";
import { toPlantCard } from "@/plants.ts";
import { openGeneratedFilePath } from "@/generatedFile.ts";
import { requestSidecar } from "@/sidecarRequest.ts";
import {
  GeneratedFileCard,
  type GeneratedFileType,
} from "@/components/GeneratedFileCard.tsx";
import { AssistantMessage, UserMessage } from "@/components/Message.tsx";
import { Markdown } from "@/components/Markdown.tsx";
import { SourceFooter } from "@/components/SourceFooter.tsx";
import { LawUploadCard } from "@/components/LawUploadCard.tsx";
import { PlantUploadCard } from "@/components/PlantUploadCard.tsx";
import { PlantCard } from "@/components/PlantCard.tsx";
import { SiteCard } from "@/components/SiteCard.tsx";
import { WebSources } from "@/components/WebSources.tsx";
import { FilePill } from "@/components/FilePill.tsx";
import type { ChatMessage } from "@/WorkspaceContent.tsx";
import type { PlantData } from "@/plants.ts";
import type { SkillTag } from "@/components/Composer.tsx";

function generatedFileType(
  filePath: string,
  storedType?: GeneratedFileType,
): GeneratedFileType {
  if (storedType) return storedType;
  const extension = filePath.split(".").pop()?.toLowerCase();
  if (extension === "docx") return "DOCX";
  if (extension === "xlsx") return "XLSX";
  return "PDF";
}

function fileSkill(fileType: GeneratedFileType): SkillTag | null {
  if (fileType === "DOCX") return "word";
  if (fileType === "XLSX") return "excel";
  return "pdf";
}

function typeForSkill(skill: SkillTag): GeneratedFileType {
  if (skill === "word") return "DOCX";
  if (skill === "excel") return "XLSX";
  return "PDF";
}

function fileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

async function saveGeneratedFile(filePath: string, fileName: string): Promise<void> {
  const fileType = generatedFileType(filePath);
  const extension = fileName.split(".").pop()?.toLowerCase() || fileType.toLowerCase();
  const destinationPath = await save({
    defaultPath: fileName,
    filters: [{ name: fileType, extensions: [extension] }],
  });
  if (!destinationPath) return;
  await requestSidecar<string>(
    "save_generated_file",
    { file_path: filePath, destination_path: destinationPath },
    (value): value is string => typeof value === "string",
  );
}

interface ChatConversationProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  elapsedSeconds: number;
  isThinkMode: boolean;
  modes: ChatModes;
  isExtractive: boolean;
  onRetry: (prompt: string, skill: SkillTag) => void;
}

export function ChatConversation({
  messages,
  isStreaming,
  elapsedSeconds,
  isThinkMode,
  modes,
  isExtractive,
  onRetry,
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
    if (message.type === "law_upload") {
      return <LawUploadCard key={key} />;
    }
    if (message.type === "plant_upload") {
      return <PlantUploadCard key={key} />;
    }
    if (message.role === "user") {
      return (
        <UserMessage key={key}>
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
    const fileType = message.file_type ?? (
      message.file_path
        ? generatedFileType(message.file_path)
        : typeForSkill(previousUser?.skill ?? "pdf")
    );
    const retrySkill =
      previousUser?.skill
        ? previousUser.skill
        : fileSkill(fileType);
    const fileCard = message.file_path ? (
      <GeneratedFileCard
        fileName={fileNameFromPath(message.file_path)}
        fileType={fileType}
        filePath={message.file_path}
        fileSize={message.file_size ?? Number.NaN}
        status="success"
        onRetry={
          retrySkill && previousUser
            ? () => onRetry(previousUser.content, retrySkill)
            : undefined
        }
        onOpen={() => openGeneratedFilePath(message.file_path ?? "")}
        onSaveAs={() =>
          saveGeneratedFile(
            message.file_path ?? "",
            fileNameFromPath(message.file_path ?? ""),
          )
        }
      />
    ) : previousUser?.skill && !(isStreaming && index === messages.length - 1) ? (
      <GeneratedFileCard
        fileName={`Nogic ${fileType} document.${fileType.toLowerCase()}`}
        fileType={fileType}
        filePath=""
        fileSize={Number.NaN}
        status="error"
        errorMessage={message.content}
        onRetry={
          retrySkill
            ? () => onRetry(previousUser.content, retrySkill)
            : undefined
        }
        onOpen={() => undefined}
        onSaveAs={() => undefined}
      />
    ) : null;

    return (
      <div key={key}>
        <AssistantMessage
          isStreaming={isStreaming && index === messages.length - 1}
          elapsedSeconds={elapsedSeconds}
          thinkingText={message.thinking}
          stepText={message.step}
          showThinking={isThinkMode}
          modes={modes}
          isExtractive={isExtractive}
          rawContent={message.content}
        >
          {message.content ? <Markdown>{message.content}</Markdown> : null}
          {fileCard}
        </AssistantMessage>
        {message.site_data && <SiteCard data={message.site_data} />}
        {message.plant_data && message.plant_data.length > 0 && (
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
        {message.web_sources && message.web_sources.length > 0 && (
          <WebSources sources={message.web_sources} />
        )}
        {showSources && message.sources && message.sources.length > 0 && (
          <SourceFooter
            label="Sources"
            items={message.sources.map((source) => ({
              label: lawSourceLabel(source),
              onClick: () =>
                invoke<void>("open_law_pdf", {
                  lawName: source.law_name,
                  country: source.country ?? "MA",
                  pageNum: source.page_num,
                }),
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
