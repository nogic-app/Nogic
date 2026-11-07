import { invoke } from "@tauri-apps/api/core";
import type { Dispatch, RefObject, SetStateAction } from "react";
import {
  handleChatStreamEvent,
} from "@/chatStreamEvents.ts";
import {
  mergeStreamMessage,
  updateTrackedStreamMessage,
} from "@/chatStreamCache.ts";
import type { ChatMessage } from "@/WorkspaceContent.tsx";
import type { ErrorPayload } from "@/types/errors.ts";
import { isTokenUsage, type TokenUsage } from "@/types/tokenUsage.ts";

interface StreamEventRefs {
  activeRequestId: RefObject<string | null>;
  activeChatId: RefObject<string | null>;
  activeStreamsRef: RefObject<
    Record<string, { message: ChatMessage; requestId: string }>
  >;
  historyRequestId: RefObject<string | null>;
  draftsRef: RefObject<Record<string, unknown>>;
  chatCache: RefObject<Record<string, ChatMessage[]>>;
  mutationRollback: RefObject<(() => void) | null>;
  pendingRegeneration: RefObject<{
    requestId: string;
    parentId: string | null;
  } | null>;
}

interface StreamEventSetters {
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setActiveLeafId: Dispatch<SetStateAction<string | null>>;
  setIsStreaming: Dispatch<SetStateAction<boolean>>;
  setErrorPayload: Dispatch<SetStateAction<ErrorPayload | null>>;
  setLastTokenUsage: Dispatch<SetStateAction<TokenUsage | null>>;
}

export function dispatchChatStreamEvent(
  payload: Record<string, unknown>,
  refs: StreamEventRefs,
  setters: StreamEventSetters,
): boolean {
  const requestId = typeof payload.id === "string" ? payload.id : null;
  if (requestId === null) return false;

  const streamEntry = Object.entries(refs.activeStreamsRef.current).find(
    ([, stream]) => stream.requestId === requestId,
  );
  const chatId =
    streamEntry?.[0] ??
    (requestId === refs.activeRequestId.current
      ? refs.activeChatId.current
      : null);
  if (!chatId) return false;
  const isActiveStream = chatId === refs.activeChatId.current;

  if (streamEntry) {
    const [trackedChatId, stream] = streamEntry;
    stream.message = updateTrackedStreamMessage(
      stream.message,
      stream.requestId,
      payload,
    );
    const cachedMessages = refs.chatCache.current[trackedChatId];
    if (cachedMessages) {
      refs.chatCache.current[trackedChatId] = mergeStreamMessage(
        cachedMessages,
        stream.requestId,
        stream.message,
      );
    }
  }

  if (payload.type === "chat_start") {
    const pending = refs.pendingRegeneration.current;
    if (pending?.requestId === requestId) {
      if (isActiveStream) {
        setters.setMessages((current) => {
          const placeholder: ChatMessage = {
            role: "assistant",
            content: "",
            id: requestId,
            parent_id: pending.parentId,
            isStreaming: true,
            thinking: "",
          };
          if (current.some((message) => message.id === requestId)) {
            return current.map((message) =>
              message.id === requestId
                ? { ...message, isStreaming: true }
                : message,
            );
          }
          return [...current, placeholder];
        });
        setters.setActiveLeafId(requestId);
      }
      refs.pendingRegeneration.current = null;
      refs.mutationRollback.current = null;
    }
  }

  if (payload.type === "chat_done") {
    if (isActiveStream) {
      refs.mutationRollback.current = null;
      if (isTokenUsage(payload.usage)) {
        setters.setLastTokenUsage(payload.usage);
      } else if (payload.usage !== undefined) {
        console.error(
          "Received invalid token usage from the Python sidecar.",
          payload,
        );
      }
    }
    delete refs.draftsRef.current[chatId];
    if (isActiveStream && !chatId.startsWith("temp_")) {
      if (typeof payload.message_id === "string") {
        setters.setActiveLeafId(payload.message_id);
      }
      const refreshId = `history:${crypto.randomUUID()}`;
      refs.historyRequestId.current = refreshId;
      void invoke("send_to_sidecar", {
        message: JSON.stringify({
          action: "get_history",
          id: refreshId,
          chat_id: chatId,
        }),
      }).catch((error: unknown) => {
        if (refs.historyRequestId.current === refreshId) {
          refs.historyRequestId.current = null;
        }
        console.error(
          "Failed to refresh chat history after a response.",
          error,
        );
      });
    }
  }

  if (isActiveStream) {
    handleChatStreamEvent(
      payload,
      refs.activeRequestId,
      setters.setIsStreaming,
      setters.setMessages,
      setters.setErrorPayload,
    );
  }
  if (payload.type === "error" && refs.mutationRollback.current && isActiveStream) {
    refs.pendingRegeneration.current = null;
    refs.mutationRollback.current();
    refs.mutationRollback.current = null;
  }
  if (
    streamEntry &&
    (payload.type === "chat_done" || payload.type === "error")
  ) {
    delete refs.activeStreamsRef.current[chatId];
    if (refs.pendingRegeneration.current?.requestId === requestId) {
      refs.pendingRegeneration.current = null;
    }
  }
  return true;
}
