import { invoke } from "@tauri-apps/api/core";
import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import { listenSidecar as listen } from "@/sidecarEvents.ts";
import { updateAssistantMessage } from "@/chatStreamEvents.ts";
import { mergeStreamMessage, remapChatStream } from "@/chatStreamCache.ts";
import { dispatchChatStreamEvent } from "@/chatStreamDispatcher.ts";
import type { ChatItem } from "@/components/Sidebar.tsx";
import {
  isChatMessageArray,
  isRecord,
  latestMessageId,
  toHistoryMessages,
  type ChatMessage,
} from "@/WorkspaceContent.tsx";
import { isTauriCallbackIdError } from "@/sidecarRequest.ts";
import { isPlantDataArray } from "@/plants.ts";
import type { ErrorPayload } from "@/types/errors.ts";
import { isTokenUsage, type TokenUsage } from "@/types/tokenUsage.ts";
import type { FileAttachment } from "@/components/FilePill.tsx";

export interface PythonMessageRefs {
  activeRequestId: RefObject<string | null>;
  historyRequestId: RefObject<string | null>;
  plantLookupRequestId: RefObject<string | null>;
  remappedChatId: RefObject<string | null>;
  activeChatId: RefObject<string | null>;
  activeStreamsRef: RefObject<
    Record<string, { message: ChatMessage; requestId: string }>
  >;
  draftsRef: RefObject<
    Record<string, { text: string; attachments: FileAttachment[] }>
  >;
  chatCache: RefObject<Record<string, ChatMessage[]>>;
  mutationRollback: RefObject<(() => void) | null>;
  pendingRegeneration: RefObject<{
    requestId: string;
    parentId: string | null;
  } | null>;
}

interface PythonMessageSetters {
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setActiveLeafId: Dispatch<SetStateAction<string | null>>;
  setIsStreaming: Dispatch<SetStateAction<boolean>>;
  setActiveChat: Dispatch<SetStateAction<ChatItem | null>>;
  setErrorPayload: Dispatch<SetStateAction<ErrorPayload | null>>;
  setLastTokenUsage: Dispatch<SetStateAction<TokenUsage | null>>;
}

export function usePythonMessages(
  refs: PythonMessageRefs,
  setters: PythonMessageSetters,
): void {
  const {
    activeRequestId,
    historyRequestId,
    plantLookupRequestId,
    remappedChatId,
    activeChatId,
    activeStreamsRef,
    draftsRef,
    chatCache,
    mutationRollback,
    pendingRegeneration,
  } = refs;
  const {
    setMessages,
    setActiveLeafId,
    setIsStreaming,
    setActiveChat,
    setErrorPayload,
    setLastTokenUsage,
  } = setters;

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    const startListening = async () => {
      try {
        const stopListening = await listen<string>("python-message", (event) => {
          let payload: unknown;
          try {
            payload = JSON.parse(event.payload);
          } catch (error) {
            console.error("Received invalid JSON from the Python sidecar.", error);
            return;
          }

          if (!isRecord(payload) || typeof payload.type !== "string") {
            console.error("Received an invalid message from the Python sidecar.", payload);
            return;
          }

          if (payload.type === "chat_id_synced") {
            if (
              typeof payload.old_id !== "string" ||
              typeof payload.new_id !== "string"
            ) {
              console.error("Received an invalid chat ID update from the Python sidecar.", payload);
              return;
            }
            const temporaryChatId = payload.old_id;
            const updatedChatId = payload.new_id;
            remapChatStream(
              temporaryChatId,
              updatedChatId,
              activeStreamsRef,
              chatCache,
            );
            if (activeChatId.current === temporaryChatId) {
              remappedChatId.current = updatedChatId;
              historyRequestId.current = null;
              activeChatId.current = updatedChatId;
              activeRequestId.current =
                activeStreamsRef.current[updatedChatId]?.requestId ?? null;
              setActiveChat((current) =>
                current?.id === temporaryChatId
                  ? { ...current, id: updatedChatId }
                  : current,
              );
            }
            return;
          }

          if (payload.type === "chat_title_updated") {
            const titleData = isRecord(payload.data) ? payload.data : payload;
            if (
              typeof titleData.chat_id !== "string" ||
              typeof titleData.new_title !== "string"
            ) {
              console.error("Received an invalid chat title update from the Python sidecar.", payload);
              return;
            }
            const updatedChatId = titleData.chat_id;
            const updatedTitle = titleData.new_title;
            setActiveChat((current) =>
              current?.id === updatedChatId
                ? { ...current, title: updatedTitle }
                : current,
            );
            return;
          }

          const requestId = typeof payload.id === "string" ? payload.id : null;
          if (
            payload.type === "error" &&
            requestId !== null &&
            requestId === historyRequestId.current
          ) {
            console.error("The Python sidecar failed to load chat history.", payload.error);
            historyRequestId.current = null;
            return;
          }

          if (
            payload.type === "response" &&
            requestId !== null &&
            requestId === historyRequestId.current
          ) {
            if (!isChatMessageArray(payload.data)) {
              console.error("Received invalid chat history from the Python sidecar.", payload);
              return;
            }
            const messages = toHistoryMessages(payload.data);
            const chatId = activeChatId.current;
            const activeStream = chatId
              ? activeStreamsRef.current[chatId]
              : undefined;
            const restoredMessages = activeStream
              ? mergeStreamMessage(
                  messages,
                  activeStream.requestId,
                  activeStream.message,
                )
              : messages;
            if (chatId) chatCache.current[chatId] = restoredMessages;
            setMessages(restoredMessages);
            setActiveLeafId((current) => {
              if (activeStream) return activeStream.requestId;
              if (
                current &&
                restoredMessages.some(
                  (message) =>
                    message.id === current || message.persistedId === current,
                )
              ) {
                return current;
              }
              return latestMessageId(restoredMessages);
            });
            historyRequestId.current = null;
            return;
          }

          if (
            requestId !== null &&
            requestId === plantLookupRequestId.current
          ) {
            plantLookupRequestId.current = null;

            if (payload.type === "error") {
              const detail =
                typeof payload.error === "string" && payload.error.trim().length > 0
                  ? payload.error.trim().split("\n")[0]
                  : "Unknown sidecar error.";
              console.error("The Python sidecar failed to look up a plant.", payload.error);
              setMessages((current) =>
                updateAssistantMessage(current, requestId, (message) => ({
                  ...message,
                  content: `Could not read the plant table: ${detail}`,
                })),
              );
              return;
            }
            if (payload.type !== "response") return;

            if (!isPlantDataArray(payload.data)) {
              console.error("Received invalid plant lookup data from the Python sidecar.", payload);
              setMessages((current) =>
                updateAssistantMessage(current, requestId, (message) => ({
                  ...message,
                  content: "The sidecar returned an unreadable plant table.",
                })),
              );
              return;
            }

            const rows = payload.data;
            setMessages((current) =>
              updateAssistantMessage(current, requestId, (message) => ({
                ...message,
                content: rows.length > 0 ? "" : "Not in the table.",
                plant_data: rows,
              })),
            );
            return;
          }

          dispatchChatStreamEvent(
            payload,
            {
              activeRequestId,
              activeChatId,
              activeStreamsRef,
              historyRequestId,
              draftsRef,
              chatCache,
              mutationRollback,
              pendingRegeneration,
            },
            {
              setMessages,
              setActiveLeafId,
              setIsStreaming,
              setErrorPayload,
              setLastTokenUsage,
            },
          );
        });

        if (cancelled) {
          stopListening();
          return;
        }
        unlisten = stopListening;
      } catch (error) {
        if (cancelled && isTauriCallbackIdError(error)) return;
        console.error("Failed to listen for Python sidecar messages.", error);
      }
    };

    const startTimer = window.setTimeout(() => {
      void startListening();
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(startTimer);
      unlisten?.();
    };
  }, [
    activeChatId,
    activeStreamsRef,
    activeRequestId,
    historyRequestId,
    plantLookupRequestId,
    remappedChatId,
    setActiveChat,
    draftsRef,
    setErrorPayload,
    chatCache,
    mutationRollback,
    pendingRegeneration,
    setMessages,
    setIsStreaming,
  ]);
}
