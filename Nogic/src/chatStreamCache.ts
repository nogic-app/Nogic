import type {
  Dispatch,
  MutableRefObject,
  RefObject,
  SetStateAction,
} from "react";
import { handleChatStreamEvent } from "@/chatStreamEvents.ts";
import type { ChatMessage } from "@/WorkspaceContent.tsx";
import type { ErrorPayload } from "@/types/errors.ts";

export function remapChatStream(
  oldChatId: string,
  newChatId: string,
  activeStreamsRef: RefObject<
    Record<string, { message: ChatMessage; requestId: string }>
  >,
  chatCache: RefObject<Record<string, ChatMessage[]>>,
): void {
  const stream = activeStreamsRef.current[oldChatId];
  if (stream) {
    activeStreamsRef.current[newChatId] = stream;
    delete activeStreamsRef.current[oldChatId];
  }
  const cachedMessages = chatCache.current[oldChatId];
  if (cachedMessages) {
    chatCache.current[newChatId] = cachedMessages;
    delete chatCache.current[oldChatId];
  }
}

/** Merge a tracked stream message into history without duplicating completion. */
export function mergeStreamMessage(
  messages: ChatMessage[],
  requestId: string,
  streamMessage: ChatMessage,
): ChatMessage[] {
  const persistedId = streamMessage.persistedId;
  const index = messages.findIndex(
    (message) =>
      message.role === "assistant" &&
      (message.id === requestId ||
        (persistedId !== undefined &&
          (message.id === persistedId || message.persistedId === persistedId))),
  );
  if (index < 0) return [...messages, streamMessage];
  return messages.map((message, messageIndex) =>
    messageIndex === index ? streamMessage : message,
  );
}

/** Apply a stream event synchronously to a message held outside React state. */
export function updateTrackedStreamMessage(
  message: ChatMessage,
  requestId: string,
  payload: Record<string, unknown>,
): ChatMessage {
  let messages = [message];
  const setTrackedMessages: Dispatch<SetStateAction<ChatMessage[]>> = (
    update,
  ) => {
    messages = typeof update === "function" ? update(messages) : update;
  };
  const trackedRequestId: MutableRefObject<string | null> = {
    current: requestId,
  };
  const ignoreStreaming: Dispatch<SetStateAction<boolean>> = () => undefined;
  const ignoreError: Dispatch<SetStateAction<ErrorPayload | null>> = () =>
    undefined;
  handleChatStreamEvent(
    payload,
    trackedRequestId,
    ignoreStreaming,
    setTrackedMessages,
    ignoreError,
  );
  return (
    messages.find(
      (candidate) =>
        candidate.role === "assistant" && candidate.id === requestId,
    ) ?? message
  );
}
