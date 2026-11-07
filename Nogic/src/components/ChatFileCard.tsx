import { save } from "@tauri-apps/plugin-dialog";
import {
  GeneratedFileCard,
  type GeneratedFileType,
} from "@/components/GeneratedFileCard.tsx";
import { openGeneratedFilePath } from "@/generatedFile.ts";
import { requestSidecar } from "@/sidecarRequest.ts";
import type { ChatMessage } from "@/WorkspaceContent.tsx";
import type { SkillTag } from "@/components/Composer.tsx";
import type { MemoTemplateType } from "@/memoTemplates.ts";

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

interface ChatFileCardProps {
  message: ChatMessage;
  previousUser?: ChatMessage;
  showErrorCard: boolean;
  onRetry: (
    prompt: string,
    skill: SkillTag,
    templateType?: MemoTemplateType | null,
  ) => void;
}

export function ChatFileCard({
  message,
  previousUser,
  showErrorCard,
  onRetry,
}: ChatFileCardProps) {
  const fileType = message.file_type ?? (
    message.file_path
      ? generatedFileType(message.file_path)
      : typeForSkill(previousUser?.skill ?? "pdf")
  );
  const retrySkill = previousUser?.skill ?? fileSkill(fileType);
  const templateType = message.template_type ?? previousUser?.template_type;
  if (message.file_path) {
    return (
      <GeneratedFileCard
        fileName={fileNameFromPath(message.file_path)}
        fileType={fileType}
        filePath={message.file_path}
        fileSize={message.file_size ?? Number.NaN}
        templateType={templateType}
        status="success"
        onRetry={
          retrySkill && previousUser
            ? () => onRetry(
                previousUser.content,
                retrySkill,
                previousUser.template_type,
              )
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
    );
  }
  if (!previousUser?.skill || !showErrorCard) return null;
  return (
    <GeneratedFileCard
      fileName={`Nogic ${fileType} document.${fileType.toLowerCase()}`}
      fileType={fileType}
      filePath=""
      fileSize={Number.NaN}
      templateType={templateType}
      status="error"
      errorMessage={message.content}
      onRetry={
        retrySkill
          ? () => onRetry(
              previousUser.content,
              retrySkill,
              previousUser.template_type,
            )
          : undefined
      }
      onOpen={() => undefined}
      onSaveAs={() => undefined}
    />
  );
}
