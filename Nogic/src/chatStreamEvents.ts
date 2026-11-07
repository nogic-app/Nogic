import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import {
  isSiteData,
  isLawSourceArray,
  type ChatMessage,
} from "@/WorkspaceContent.tsx";
import { isPlantDataArray } from "@/plants.ts";
import { isWebSourceArray } from "@/types/webSources.ts";
import {
  isMemoTemplateType,
  type MemoTemplateType,
} from "@/memoTemplates.ts";
import {
  normalizeErrorPayload,
  type ErrorPayload,
} from "@/types/errors.ts";

const EMPTY_ANSWER_NOTICE =
  "The local model returned an empty answer. Try again or switch modes.";

function isGeneratedFileType(
  value: unknown,
): value is NonNullable<ChatMessage["file_type"]> {
  return value === "PDF" || value === "DOCX" || value === "XLSX";
}

/**
 * Find the assistant message that belongs to a stream event. Events carry the
 * request ID, so chunks always land on their own message even if another
 * message is appended while the stream is running. Older payloads without an
 * ID fall back to the last assistant message.
 */
function assistantIndex(
  current: ChatMessage[],
  messageId: string | null,
): number {
  if (messageId) {
    const index = current.findIndex(
      (message) => message.role === "assistant" && message.id === messageId,
    );
    if (index >= 0) return index;
  }
  const lastIndex = current.length - 1;
  return lastIndex >= 0 && current[lastIndex].role === "assistant"
    ? lastIndex
    : -1;
}

/** Apply an update to one assistant message, addressed by request ID. */
export function updateAssistantMessage(
  current: ChatMessage[],
  messageId: string | null,
  update: (message: ChatMessage) => ChatMessage,
): ChatMessage[] {
  const index = assistantIndex(current, messageId);
  if (index < 0) return current;
  const next = [...current];
  next[index] = update(next[index]);
  return next;
}

/**
 * Finish the streaming message from the authoritative `chat_done` payload.
 *
 * `content` is the full accumulated answer. It replaces the streamed text only
 * when it actually contains text: an empty payload must never wipe out the
 * chunks the user already saw. A new array and a new message object are always
 * returned so React cannot skip the final render.
 */
export function completeAssistantMessage(
  current: ChatMessage[],
  messageId: string | null,
  sources: ChatMessage["sources"],
  plantData: NonNullable<ChatMessage["plant_data"]>,
  webSources: NonNullable<ChatMessage["web_sources"]>,
  siteData: ChatMessage["site_data"],
  finalThinking: string,
  finalContent: string,
  filePath: string | null,
  persistedMessageId: string | null,
  fileSize?: number,
  fileType?: ChatMessage["file_type"],
  templateType?: MemoTemplateType,
  cached = false,
  unverifiedWeb = false,
): ChatMessage[] {
  return updateAssistantMessage(current, messageId, (message) => {
    const finished: ChatMessage = {
      ...message,
      isStreaming: false,
      isReasoningStreaming: false,
      cached,
      sources,
      plant_data: plantData,
      web_sources: webSources,
      site_data: siteData,
      ...(unverifiedWeb ? { unverified_web: true } : {}),
      step: undefined,
    };
    if (persistedMessageId) {
      finished.persistedId = persistedMessageId;
    } else {
      delete finished.persistedId;
    }
    if (filePath) finished.file_path = filePath;
    if (fileSize !== undefined) finished.file_size = fileSize;
    if (fileType !== undefined) finished.file_type = fileType;
    if (templateType !== undefined) finished.template_type = templateType;
    if (finalContent.trim().length > 0) {
      finished.content = finalContent;
    } else if (message.content.trim().length === 0) {
      // Nothing was streamed and the payload has no text either.
      finished.content = EMPTY_ANSWER_NOTICE;
    }
    const thinking =
      finalThinking.trim().length > 0 ? finalThinking : message.thinking;
    if (thinking !== undefined) finished.thinking = thinking;
    return finished;
  });
}

/**
 * Apply one chat-stream event (`chat_thinking_chunk`, `chat_step`,
 * `chat_chunk`, `chat_done`, `error`) to the assistant message whose ID
 * matches the event.
 */
export function handleChatStreamEvent(
  payload: Record<string, unknown>,
  activeRequestId: MutableRefObject<string | null>,
  setIsStreaming: Dispatch<SetStateAction<boolean>>,
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  setErrorPayload: Dispatch<SetStateAction<ErrorPayload | null>>,
): void {
  const messageId = typeof payload.id === "string" ? payload.id : null;

  if (payload.type === "chat_start") {
    setMessages((current) =>
      updateAssistantMessage(current, messageId, (message) => ({
        ...message,
        isStreaming: true,
        isReasoningStreaming: false,
      })),
    );
    setIsStreaming(true);
  } else if (payload.type === "chat_thinking_chunk") {
    if (typeof payload.content !== "string") {
      console.error("Received a thinking chunk without string content.", payload);
      return;
    }
    const thinking = payload.content;
    setMessages((current) =>
      updateAssistantMessage(current, messageId, (message) => ({
        ...message,
        isStreaming: true,
        thinking: (message.thinking ?? "") + thinking,
        isReasoningStreaming:
          message.content.trim().length === 0 &&
          `${message.thinking ?? ""}${thinking}`.trim().length > 0,
      })),
    );
  } else if (payload.type === "chat_step") {
    if (typeof payload.step !== "string") {
      console.error("Received a chat step without a string label.", payload);
      return;
    }
    const step = payload.step;
    setMessages((current) =>
      updateAssistantMessage(current, messageId, (message) =>
        ({
          ...message,
          isStreaming: true,
          isReasoningStreaming: false,
          step: message.content.trim().length > 0 ? "drafting" : step,
        }),
      ),
    );
  } else if (payload.type === "chat_chunk") {
    if (typeof payload.content !== "string") {
      console.error("Received a chat chunk without string content.", payload);
      return;
    }
    const content = payload.content;
    setMessages((current) =>
      updateAssistantMessage(current, messageId, (message) => ({
        ...message,
        isStreaming: true,
        content: message.content + content,
        isReasoningStreaming:
          content.trim().length > 0 ? false : message.isReasoningStreaming,
        ...(content.trim().length > 0
          ? { step: "drafting" }
          : {}),
      })),
    );
  } else if (payload.type === "chat_done") {
    const sources = payload.sources;
    const plantData = payload.plant_data ?? [];
    const webSources = payload.web_sources ?? [];
    const rawSiteData = payload.site_data;
    const siteData =
      rawSiteData === null || rawSiteData === undefined
        ? undefined
        : isSiteData(rawSiteData)
          ? rawSiteData
          : null;
    const finalThinking = payload.thinking;
    const finalContent =
      typeof payload.content === "string" ? payload.content : "";
    const filePath =
      typeof payload.file_path === "string"
        ? payload.file_path
        : null;
    const persistedMessageId =
      typeof payload.message_id === "string" ? payload.message_id : null;
    const fileSize = payload.file_size;
    const fileType = payload.file_type;
    const templateType = payload.template_type;
    const unverifiedWeb = payload.unverified_web === true;
    if (
      !isLawSourceArray(sources) ||
      !isPlantDataArray(plantData) ||
      !isWebSourceArray(webSources) ||
      siteData === null ||
      (payload.unverified_web !== undefined &&
        typeof payload.unverified_web !== "boolean") ||
      (finalThinking !== undefined && typeof finalThinking !== "string") ||
      (fileSize !== undefined &&
        fileSize !== null &&
        (typeof fileSize !== "number" ||
          !Number.isInteger(fileSize) ||
          fileSize < 0)) ||
      (fileType !== undefined &&
        fileType !== null &&
        !isGeneratedFileType(fileType)) ||
      (templateType !== undefined &&
        templateType !== null &&
        !isMemoTemplateType(templateType))
    ) {
      console.error(
        "Received invalid sources, plant data, or site data from the Python sidecar.",
        payload,
      );
      setMessages((current) =>
        updateAssistantMessage(current, messageId, (message) =>
          message.content.length > 0
            ? {
                ...message,
                isStreaming: false,
                isReasoningStreaming: false,
              }
            : {
                ...message,
                content: "The sidecar returned an unreadable response.",
                isStreaming: false,
                isReasoningStreaming: false,
              },
        ),
      );
      activeRequestId.current = null;
      setIsStreaming(false);
      return;
    }
    setMessages((current) =>
      completeAssistantMessage(
        current,
        messageId,
        sources,
        plantData,
        webSources,
        siteData,
        typeof finalThinking === "string" ? finalThinking : "",
        finalContent,
        filePath,
        persistedMessageId,
        typeof fileSize === "number" ? fileSize : undefined,
        isGeneratedFileType(fileType) ? fileType : undefined,
        isMemoTemplateType(templateType) ? templateType : undefined,
        payload.cached === true,
        unverifiedWeb,
      ),
    );
    activeRequestId.current = null;
    setIsStreaming(false);
  } else if (payload.type === "error") {
    const errorPayload = normalizeErrorPayload(payload.payload ?? payload.error);
    setErrorPayload(errorPayload);
    console.error("The Python sidecar reported a chat error.", errorPayload);
    setMessages((current) =>
      updateAssistantMessage(current, messageId, (message) =>
        message.content.length > 0
          ? {
              ...message,
              isStreaming: false,
              isReasoningStreaming: false,
            }
          : {
              ...message,
              content: errorPayload.message,
              isStreaming: false,
              isReasoningStreaming: false,
            },
      ),
    );
    activeRequestId.current = null;
    setIsStreaming(false);
  }
}
