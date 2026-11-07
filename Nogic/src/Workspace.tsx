import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listenSidecar as listen } from "@/sidecarEvents.ts";
import { WorkspaceView } from "@/components/WorkspaceView.tsx";
import { ErrorBoundary } from "@/components/ErrorBoundary.tsx";
import type { ChatItem } from "@/components/Sidebar.tsx";
import { isChatItem } from "@/sidebarData.ts";
import {
  WelcomeScreen,
  activeBranchMessages,
  latestMessageId,
  messageNodeId,
  type ChatMessage,
} from "@/WorkspaceContent.tsx";
import { ChatConversation } from "@/components/ChatConversation.tsx";
import { usePythonMessages } from "@/usePythonMessages.ts";
import { mergeStreamMessage } from "@/chatStreamCache.ts";
import { useMemoryDeleted } from "@/useMemoryDeleted.ts";
import { useHardwareInfo } from "@/hooks/useHardwareInfo";
import { isExtractiveHardware } from "@/hardwareTier";
import { DEFAULT_CHAT_MODES, type ChatModes } from "@/chatModes.ts";
import { resolveActiveModel } from "@/activeModel.ts";
import { useSettings } from "@/contexts/SettingsContext.tsx";
import { ChangelogModal, CURRENT_APP_VERSION } from "@/components/ChangelogModal.tsx";
import type { SettingsTab } from "@/components/SettingsModal.tsx";
import {
  OnboardingWizard,
  hasCompletedOnboarding,
} from "@/components/OnboardingWizard.tsx";
import { StartupSplash } from "@/components/StartupSplash.tsx";
import { StartupError } from "@/components/StartupError.tsx";
import { useStartupHealthCheck } from "@/hooks/useStartupHealthCheck.ts";
import { useTranslation } from "react-i18next";
import type { FileAttachment } from "@/components/FilePill.tsx";
import type { SkillTag } from "@/components/Composer.tsx";
import type { MemoTemplateType } from "@/memoTemplates.ts";
import { useModelCapabilities } from "@/modelCapabilities.ts";
import {
  EMPTY_LAW_LIBRARY_MESSAGE,
  fetchLawStatus,
  isLawQuestion,
} from "@/lawLibrary.ts";
import {
  normalizeErrorPayload,
  type ErrorPayload,
} from "@/types/errors.ts";
import { requestSidecar } from "@/sidecarRequest.ts";
import type { TokenUsage } from "@/types/tokenUsage.ts";

const PdfViewerModal = lazy(() =>
  import("@/components/PdfViewerModal.tsx").then(({ PdfViewerModal }) => ({
    default: PdfViewerModal,
  })),
);
const SettingsModal = lazy(() =>
  import("@/components/SettingsModal.tsx").then(({ SettingsModal }) => ({
    default: SettingsModal,
  })),
);

/**
 * `/plant "name"` and `/plant name` both resolve to the bare name.
 * Returns null when the message is not a plant lookup command.
 */
function parsePlantCommand(content: string): string | null {
  const match = /^\/plant(?:\s+([\s\S]*))?$/.exec(content);
  if (!match) return null;
  let name = (match[1] ?? "").trim();
  if (name.length >= 2) {
    const first = name.charAt(0);
    const last = name.charAt(name.length - 1);
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      name = name.slice(1, -1).trim();
    }
  }
  return name;
}

const NEW_CHAT_DRAFT_ID = "__new__";

export default function Workspace() {
  const { t } = useTranslation();
  const {
    activeModel,
    setActiveModel,
    seen_version,
    setSeenVersion,
    settingsLoaded,
    temperature,
    contextWindow,
    modelKeepAlive,
    persona,
  } = useSettings();
  const startupHealth = useStartupHealthCheck();
  const { info: hardwareInfo } = useHardwareInfo();
  const isExtractive = isExtractiveHardware(hardwareInfo);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeLeafId, setActiveLeafId] = useState<string | null>(null);
  const activeMessages = useMemo(
    () => activeBranchMessages(messages, activeLeafId),
    [activeLeafId, messages],
  );
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [errorPayload, setErrorPayload] = useState<ErrorPayload | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [activeModes, setActiveModes] = useState<ChatModes>(DEFAULT_CHAT_MODES);
  const modelCapabilities = useModelCapabilities(activeModel ?? "");
  const supportsVision =
    modelCapabilities === null || modelCapabilities.includes("vision");
  const supportsThinking =
    modelCapabilities === null || modelCapabilities.includes("thinking");
  const [activeChat, setActiveChat] = useState<ChatItem | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isChatSearchOpen, setIsChatSearchOpen] = useState(false);
  const [chatSearch, setChatSearch] = useState("");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isChangelogOpen, setIsChangelogOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  // null until the sidecar answers; the wizard only renders for a confirmed
  // fresh install so an existing user never sees it flash.
  const [isOnboarded, setIsOnboarded] = useState<boolean | null>(null);
  const [sidebarRefreshToken, setSidebarRefreshToken] = useState(0);
  const [lastTokenUsage, setLastTokenUsage] = useState<TokenUsage | null>(null);
  const [pdfViewer, setPdfViewer] = useState<{
    filePath: string;
    page: number;
  } | null>(null);

  useEffect(() => {
    if (settingsLoaded && seen_version !== CURRENT_APP_VERSION) {
      setIsChangelogOpen(true);
    }
  }, [seen_version, settingsLoaded]);

  const closeChangelog = useCallback(() => {
    setSeenVersion(CURRENT_APP_VERSION);
    setIsChangelogOpen(false);
  }, [setSeenVersion]);
  const activeRequestId = useRef<string | null>(null);
  const historyRequestId = useRef<string | null>(null);
  const plantLookupRequestId = useRef<string | null>(null);
  const remappedChatId = useRef<string | null>(null);
  const activeChatId = useRef<string | null>(null);
  const activeStreamsRef = useRef<
    Record<string, { message: ChatMessage; requestId: string }>
  >({});
  const draftsRef = useRef<
    Record<string, { text: string; attachments: FileAttachment[] }>
  >({});
  const previousDraftChatId = useRef(NEW_CHAT_DRAFT_ID);
  const persistedNewChatId = useRef<string | null>(null);
  const contextStartIndex = useRef(0);
  const skipHistoryFetch = useRef(false);
  const chatCache = useRef<Record<string, ChatMessage[]>>({});
  const mutationRollback = useRef<(() => void) | null>(null);
  const pendingRegeneration = useRef<{
    requestId: string;
    parentId: string | null;
  } | null>(null);
  const skipCacheWrite = useRef(false);
  const retryRequest = useRef<{
    content: string;
    modes: ChatModes;
    attachments: FileAttachment[];
    skill: SkillTag | null;
    templateType?: MemoTemplateType;
  } | null>(null);

  useEffect(() => {
    if (!isStreaming) return;

    const intervalId = window.setInterval(() => {
      setElapsedSeconds((seconds) => seconds + 1);
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [isStreaming]);

  usePythonMessages(
    {
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
    },
    {
      setMessages,
      setActiveLeafId,
      setIsStreaming,
      setActiveChat,
      setErrorPayload,
      setLastTokenUsage,
    },
  );

  // Settings -> Memory deletes chats inside the sidecar. Reset the visible
  // workspace and bump the sidebar refresh token so the deleted chats vanish
  // immediately instead of only after the next interaction.
  const handleMemoryDeleted = useCallback(() => {
    activeChatId.current = null;
    contextStartIndex.current = 0;
    activeRequestId.current = null;
    historyRequestId.current = null;
    plantLookupRequestId.current = null;
    pendingRegeneration.current = null;
    remappedChatId.current = null;
    skipHistoryFetch.current = false;
    chatCache.current = {};
    activeStreamsRef.current = {};
    setActiveChat(null);
    setMessages([]);
    setActiveLeafId(null);
    setInput("");
    setAttachments([]);
    setIsStreaming(false);
    setSidebarRefreshToken((token) => token + 1);
  }, []);

  useMemoryDeleted(handleMemoryDeleted);

  // The first-run decision comes from SQLite (`get_settings`), not the WebView's
  // localStorage, so a reinstall that keeps the WebView profile still shows the
  // wizard. A sidecar failure must never gate the app, so it counts as onboarded.
  useEffect(() => {
    let cancelled = false;
    void hasCompletedOnboarding()
      .then((completed) => {
        if (!cancelled) setIsOnboarded(completed);
      })
      .catch((error: unknown) => {
        console.error("Could not read the onboarding state from SQLite.", error);
        if (!cancelled) setIsOnboarded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const chatId = activeChat?.id;
    const previousChatId = previousDraftChatId.current;
    const draftChatId = chatId ?? NEW_CHAT_DRAFT_ID;
    draftsRef.current[previousChatId] = { text: input, attachments };
    if (
      previousChatId === NEW_CHAT_DRAFT_ID &&
      persistedNewChatId.current === draftChatId
    ) {
      draftsRef.current[draftChatId] = draftsRef.current[NEW_CHAT_DRAFT_ID];
      delete draftsRef.current[NEW_CHAT_DRAFT_ID];
      persistedNewChatId.current = null;
    }
    previousDraftChatId.current = draftChatId;
    const draft = draftsRef.current[draftChatId];
    setInput(draft?.text ?? "");
    setAttachments(draft?.attachments ?? []);

    if (skipHistoryFetch.current) {
      skipHistoryFetch.current = false;
      return;
    }
    if (chatId && remappedChatId.current === chatId) {
      remappedChatId.current = null;
      return;
    }
    if (chatId?.startsWith("temp_")) return;
    historyRequestId.current = null;
    plantLookupRequestId.current = null;
    const activeStream = chatId ? activeStreamsRef.current[chatId] : undefined;
    activeRequestId.current = activeStream?.requestId ?? null;
    setIsStreaming(activeStream !== undefined);
    setElapsedSeconds(0);

    if (!chatId) {
      setMessages([]);
      setActiveLeafId(null);
      return;
    }

    const cachedMessages = chatCache.current[chatId];
    if (cachedMessages) {
      const restoredMessages = activeStream
        ? mergeStreamMessage(
            cachedMessages,
            activeStream.requestId,
            activeStream.message,
          )
        : cachedMessages;
      chatCache.current[chatId] = restoredMessages;
      skipCacheWrite.current = true;
      setMessages(restoredMessages);
      setActiveLeafId(
        activeStream?.requestId ?? latestMessageId(restoredMessages),
      );
      return;
    }
    skipCacheWrite.current = true;
    const initialMessages = activeStream
      ? mergeStreamMessage([], activeStream.requestId, activeStream.message)
      : [];
    setMessages(initialMessages);
    setActiveLeafId(
      activeStream?.requestId ?? latestMessageId(initialMessages),
    );

    const requestId = `history:${crypto.randomUUID()}`;
    historyRequestId.current = requestId;
    void invoke("send_to_sidecar", {
      message: JSON.stringify({ action: "get_history", id: requestId, chat_id: chatId }),
    }).catch((error: unknown) => {
      console.error("Failed to request chat history from the Python sidecar.", error);
    });

    return () => {
      if (historyRequestId.current === requestId) historyRequestId.current = null;
    };
  }, [activeChat?.id]);

  useEffect(() => {
    const chatId = activeChat?.id;
    if (!chatId || chatId.startsWith("temp_")) return;
    if (skipCacheWrite.current) {
      skipCacheWrite.current = false;
      return;
    }
    if (chatCache.current[chatId]) chatCache.current[chatId] = messages;
  }, [activeChat?.id, messages]);

  const handleSelectChat = useCallback((chat: ChatItem) => {
    setErrorPayload(null);
    contextStartIndex.current = 0;
    const currentChatId = activeChatId.current;
    if (currentChatId && !currentChatId.startsWith("temp_")) {
      const currentStream = activeStreamsRef.current[currentChatId];
      chatCache.current[currentChatId] = currentStream
        ? mergeStreamMessage(
            messages,
            currentStream.requestId,
            currentStream.message,
          )
        : messages;
    }
    activeChatId.current = chat.id;
    const selectedStream = activeStreamsRef.current[chat.id];
    activeRequestId.current = selectedStream?.requestId ?? null;
    setIsStreaming(selectedStream !== undefined);
    setElapsedSeconds(0);
    setActiveProjectId(chat.project_id);
    if (chat.id.startsWith("temp_")) {
      activeRequestId.current = null;
      historyRequestId.current = null;
      plantLookupRequestId.current = null;
      setIsStreaming(false);
      setMessages([]);
      setActiveLeafId(null);
    }
    setActiveChat(chat);
  }, [messages]);

  const handleChatDeleted = useCallback((chatId: string) => {
    delete chatCache.current[chatId];
    delete activeStreamsRef.current[chatId];
    if (activeChatId.current !== chatId) return;
    contextStartIndex.current = 0;
    activeChatId.current = null;
    activeRequestId.current = null;
    historyRequestId.current = null;
    plantLookupRequestId.current = null;
    setActiveChat(null);
    setMessages([]);
    setActiveLeafId(null);
    setIsStreaming(false);
  }, []);

  const handleProjectDeleted = useCallback((_projectId: string) => {
    activeChatId.current = null;
    activeRequestId.current = null;
    historyRequestId.current = null;
    plantLookupRequestId.current = null;
    remappedChatId.current = null;
    contextStartIndex.current = 0;
    skipHistoryFetch.current = false;
    chatCache.current = {};
    activeStreamsRef.current = {};
    setActiveProjectId(null);
    setActiveChat(null);
    setMessages([]);
    setActiveLeafId(null);
    setIsStreaming(false);
  }, []);

  const handleCreateChat = useCallback((projectId: string | null) => {
    setErrorPayload(null);
    const selectedProjectId = projectId ?? activeProjectId;
    setActiveProjectId(selectedProjectId);
    activeChatId.current = null;
    activeRequestId.current = null;
    contextStartIndex.current = 0;
    historyRequestId.current = null;
    plantLookupRequestId.current = null;
    setActiveChat(null);
    setMessages([]);
    setActiveLeafId(null);
    setIsStreaming(false);
  }, [activeProjectId]);

  const handleProjectCreated = useCallback((projectId: string) => {
    setActiveProjectId(projectId);
    activeChatId.current = null;
    contextStartIndex.current = 0;
    setActiveChat(null);
    setMessages([]);
    setActiveLeafId(null);
  }, []);

  const handleSend = async (
    modes: ChatModes = DEFAULT_CHAT_MODES,
    attachments: FileAttachment[] = [],
    skill: SkillTag | null = null,
    templateType?: MemoTemplateType,
    retryContent?: string,
  ) => {
    setEditingMessageId(null);
    const content = (retryContent ?? input).trim();
    if ((!content && attachments.length === 0 && skill === null) || isStreaming) return;
    setErrorPayload(null);
    retryRequest.current = {
      content,
      modes,
      attachments,
      skill,
      templateType,
    };
    setIsStreaming(true);

    const appendLocalCommandTurn = (
      assistantMessage: Omit<ChatMessage, "role" | "parent_id">,
    ) => {
      const userMessageId = crypto.randomUUID();
      const assistantMessageId = assistantMessage.id ?? crypto.randomUUID();
      const userMessage: ChatMessage = {
        role: "user",
        content,
        id: userMessageId,
        parent_id: latestMessageId(activeMessages),
        isEditable: false,
      };
      const responseMessage: ChatMessage = {
        ...assistantMessage,
        role: "assistant",
        id: assistantMessageId,
        parent_id: userMessageId,
      };

      setMessages((current) => [...current, userMessage]);
      setMessages((current) => [...current, responseMessage]);
      setActiveLeafId(assistantMessageId);
    };

    if (
      !content.startsWith("/") &&
      attachments.length === 0 &&
      skill === null &&
      isLawQuestion(content)
    ) {
      const status = await fetchLawStatus();
      if (status?.article_count === 0) {
        setIsStreaming(false);
        setMessages((current) => [
          ...current,
          { role: "user", content },
          { role: "assistant", content: EMPTY_LAW_LIBRARY_MESSAGE },
        ]);
        setInput("");
        return;
      }
    }

    if (content === "/add-law" || content === "/add-plant") {
      setIsStreaming(false);
      appendLocalCommandTurn({
        content: "",
        type: content === "/add-law" ? "law_upload" : "plant_upload",
      });
      setInput("");
      return;
    }

    if (content === "/help") {
      setIsStreaming(false);
      appendLocalCommandTurn({
        content: `Here are the commands you can use:

**Library Management**
- \`/add-law\` : Add a custom law PDF to your library.
- \`/add-plant\` : Add a plant with its source to the verified table.

**Lookups**
- \`/plant "name"\` : Instantly look up a plant card (e.g., \`/plant romarin\`).
- \`/site "location"\` : Fetch site data and a map.

**Chat Modes**
- Toggle **DeepThink** or **Web** using the buttons below the composer.
- Switch between **Fast** and **Think** using the dropdown.`,
      });
      setInput("");
      return;
    }

    let chatId = activeChatId.current;
    if (!chatId) {
      const requestId = `create_chat:${crypto.randomUUID()}`;
      let resolveCreate: (chat: ChatItem) => void = () => undefined;
      let rejectCreate: (error: Error) => void = () => undefined;
      const responsePromise = new Promise<ChatItem>((resolve, reject) => {
        resolveCreate = resolve;
        rejectCreate = reject;
      });
      const stopListening = await listen<string>("python-message", (event) => {
          let payload: unknown;
          try {
            payload = JSON.parse(event.payload);
          } catch (error) {
            console.error("Received invalid JSON while creating a chat.", error);
            return;
          }
          if (!payload || typeof payload !== "object") return;
          const message = payload as { type?: unknown; id?: unknown; data?: unknown; error?: unknown };
          if (message.id !== requestId) return;
          if (message.type === "response" && isChatItem(message.data)) {
            resolveCreate(message.data);
          } else {
            rejectCreate(new Error(typeof message.error === "string" ? message.error : "Unable to create chat."));
          }
      });
      try {
        await invoke("send_to_sidecar", {
          message: JSON.stringify({
            action: "create_chat",
            id: requestId,
            project_id: activeProjectId,
          }),
        });
        const newChat = await responsePromise;
        chatId = newChat.id;
        persistedNewChatId.current = newChat.id;
        chatCache.current[chatId] = messages;
        skipHistoryFetch.current = true;
        activeChatId.current = chatId;
        setActiveChat(newChat);
      } finally {
        stopListening();
      }
    }

    const plantName = parsePlantCommand(content);
    if (plantName !== null) {
      if (!plantName) {
        setIsStreaming(false);
        appendLocalCommandTurn({
          content: 'Use /plant "name" to look up a plant.',
        });
        setInput("");
        return;
      }

      const requestId = `plant_lookup:${crypto.randomUUID()}`;
      setIsStreaming(false);
      plantLookupRequestId.current = requestId;
      appendLocalCommandTurn({ content: "", id: requestId });
      setInput("");
      try {
        await invoke("send_to_sidecar", {
          message: JSON.stringify({
            action: "search_plants",
            id: requestId,
            query: plantName,
          }),
        });
      } catch (error) {
        if (plantLookupRequestId.current !== requestId) return;
        plantLookupRequestId.current = null;
        console.error("Failed to look up a plant in the Python sidecar.", error);
        setErrorPayload(normalizeErrorPayload(error));
        const detail = normalizeErrorPayload(error).message;
        setMessages((current) => {
          const last = current.at(-1);
          if (!last || last.role !== "assistant") return current;
          return [
            ...current.slice(0, -1),
            { ...last, content: `Unable to look up that plant: ${detail}` },
          ];
        });
      }
      return;
    }

    const model = await resolveActiveModel(activeModel);
    if (!model) {
      setIsStreaming(false);
      setMessages((current) => [
        ...current,
        {
          role: "user",
          content,
          attachments,
          skill: skill ?? undefined,
          template_type: templateType,
        },
        {
          role: "assistant",
          content:
            "Select a model in Settings → Models before sending a message.",
        },
      ]);
      setInput("");
      return;
    }
    if (model !== activeModel) setActiveModel(model);

    const userMessageId = crypto.randomUUID();
    const userMessage: ChatMessage = {
      role: "user",
      content,
      id: userMessageId,
      attachments,
      skill: skill ?? undefined,
      template_type: templateType,
    };
    userMessage.parent_id = [...activeMessages]
      .reverse()
      .map(messageNodeId)
      .find((id): id is string => id !== null) ?? null;
    const isSlashCommand = /^\/(?:site|help|plant)(?:\s|$)/.test(content);
    const conversation = [
      ...activeMessages.slice(contextStartIndex.current),
      userMessage,
    ];
    const requestId = `chat:${crypto.randomUUID()}`;
    activeRequestId.current = requestId;
    setActiveModes(modes);
    const assistantMessage: ChatMessage = {
      role: "assistant",
      content: "",
      id: requestId,
      parent_id: userMessageId,
      isStreaming: true,
      thinking: "",
      step: modes.web && !isSlashCommand ? "searching web" : "thinking",
    };
    activeStreamsRef.current[chatId] = {
      message: assistantMessage,
      requestId,
    };
    chatCache.current[chatId] = [
      ...(chatCache.current[chatId] ?? messages),
      userMessage,
      assistantMessage,
    ];
    setMessages((current) => [
      ...current,
      userMessage,
      assistantMessage,
    ]);
    setActiveLeafId(requestId);
    setElapsedSeconds(0);
    setInput("");

    try {
      await invoke("send_to_sidecar", {
        message: JSON.stringify({
          action: "chat",
          id: requestId,
          chat_id: chatId,
          model,
          messages: conversation,
          attachments,
          skill,
          template_type: templateType,
          user_message_id: userMessageId,
          modes,
          hardware: hardwareInfo,
          temperature,
          num_ctx: contextWindow,
          keep_alive: modelKeepAlive,
          persona,
        }),
      });
    } catch (error) {
      console.error("Failed to send a message to the Python sidecar.", error);
      if (activeRequestId.current !== requestId) {
        const stream = activeStreamsRef.current[chatId];
        if (stream?.requestId === requestId) {
          stream.message = {
            ...stream.message,
            content: `Unable to send message: ${normalizeErrorPayload(error).message}`,
            isStreaming: false,
          };
          chatCache.current[chatId] = mergeStreamMessage(
            chatCache.current[chatId] ?? [],
            requestId,
            stream.message,
          );
          delete activeStreamsRef.current[chatId];
        }
        if (activeChatId.current === chatId) setIsStreaming(false);
        return;
      }
      setErrorPayload(normalizeErrorPayload(error));
      const detail = normalizeErrorPayload(error).message;
      setMessages((current) => {
        const last = current.at(-1);
        if (!last || last.role !== "assistant") return current;
        return [
          ...current.slice(0, -1),
          {
            ...last,
            content: `Unable to send message: ${detail}`,
            isStreaming: false,
          },
        ];
      });
      activeRequestId.current = null;
      delete activeStreamsRef.current[chatId];
      setIsStreaming(false);
    }
  };

  const handleEditMessage = useCallback(
    async (messageId: string, newContent: string) => {
      const chatId = activeChatId.current;
      const model = await resolveActiveModel(activeModel);
      if (!chatId || !model) throw new Error("Select a model before editing a message.");
      const previousMessages = messages;
      const sourceMessage = activeMessages.find(
        (message) => message.id === messageId,
      );
      if (!sourceMessage) throw new Error("The message is no longer available.");
      const requestId = `chat:${crypto.randomUUID()}`;
      const optimisticUserId = crypto.randomUUID();
      const optimisticUser: ChatMessage = {
        role: "user",
        content: newContent,
        id: optimisticUserId,
        parent_id: sourceMessage.parent_id ?? null,
      };
      const optimisticAssistant: ChatMessage = {
        role: "assistant",
        content: "",
        id: requestId,
        parent_id: optimisticUserId,
        isStreaming: true,
        thinking: "",
      };
      activeStreamsRef.current[chatId] = {
        message: optimisticAssistant,
        requestId,
      };
      chatCache.current[chatId] = [
        ...(chatCache.current[chatId] ?? messages),
        optimisticUser,
        optimisticAssistant,
      ];
      const previousLeafId = activeLeafId;
      mutationRollback.current = () => {
        setMessages(previousMessages);
        setActiveLeafId(previousLeafId);
        setIsStreaming(false);
      };
      setMessages((current) => [...current, optimisticUser, optimisticAssistant]);
      setActiveLeafId(requestId);
      setIsStreaming(true);
      setElapsedSeconds(0);
      setActiveModes(activeModes);
      activeRequestId.current = requestId;
      try {
        await invoke("send_to_sidecar", {
          message: JSON.stringify({
            action: "edit_message_and_regenerate",
            id: requestId,
            chat_id: chatId,
            message_id: messageId,
            new_content: newContent,
            model,
            modes: activeModes,
            hardware: hardwareInfo,
            temperature,
            num_ctx: contextWindow,
            keep_alive: modelKeepAlive,
            persona,
          }),
        });
      } catch (error) {
        const stream = activeStreamsRef.current[chatId];
        if (stream?.requestId === requestId) {
          stream.message = {
            ...stream.message,
            content: `Unable to send message: ${normalizeErrorPayload(error).message}`,
            isStreaming: false,
          };
          chatCache.current[chatId] = mergeStreamMessage(
            chatCache.current[chatId] ?? [],
            requestId,
            stream.message,
          );
          delete activeStreamsRef.current[chatId];
        }
        if (activeChatId.current === chatId) {
          mutationRollback.current?.();
          mutationRollback.current = null;
        }
        if (activeRequestId.current === requestId) {
          activeRequestId.current = null;
        }
        if (activeChatId.current === chatId) {
          setErrorPayload(normalizeErrorPayload(error));
        }
      }
    },
    [
      activeModel,
      activeLeafId,
      activeMessages,
      activeModes,
      contextWindow,
      hardwareInfo,
      messages,
      modelKeepAlive,
      persona,
      temperature,
    ],
  );

  const handleRegenerateMessage = useCallback(
    async (messageId: string) => {
      const chatId = activeChatId.current;
      const model = await resolveActiveModel(activeModel);
      if (!chatId || !model) throw new Error("Select a model before regenerating a message.");
      const previousMessages = messages;
      const assistantMessage = activeMessages.find(
        (message) => message.persistedId === messageId,
      );
      if (!assistantMessage) throw new Error("The message is no longer available.");
      if (
        assistantMessage.role !== "assistant" ||
        assistantMessage.isStreaming ||
        assistantMessage.persistedId !== messageId
      ) {
        throw new Error("Only a completed assistant message can be regenerated.");
      }
      const requestId = `chat:${crypto.randomUUID()}`;
      pendingRegeneration.current = {
        requestId,
        parentId: assistantMessage.parent_id ?? null,
      };
      const previousLeafId = activeLeafId;
      mutationRollback.current = () => {
        setMessages(previousMessages);
        setActiveLeafId(previousLeafId);
        setIsStreaming(false);
      };
      const streamingMessage: ChatMessage = {
        role: "assistant",
        content: "",
        id: requestId,
        parent_id: assistantMessage.parent_id ?? null,
        isStreaming: true,
        thinking: "",
        step: "Regenerating...",
      };
      activeStreamsRef.current[chatId] = {
        message: streamingMessage,
        requestId,
      };
      chatCache.current[chatId] = [
        ...(chatCache.current[chatId] ?? messages),
        streamingMessage,
      ];
      setMessages((current) => [
        ...current,
        streamingMessage,
      ]);
      setActiveLeafId(requestId);
      setIsStreaming(true);
      setElapsedSeconds(0);
      setActiveModes(activeModes);
      activeRequestId.current = requestId;
      try {
        await invoke("send_to_sidecar", {
          message: JSON.stringify({
            action: "regenerate_message",
            id: requestId,
            chat_id: chatId,
            message_id: messageId,
            model,
            modes: activeModes,
            hardware: hardwareInfo,
            temperature,
            num_ctx: contextWindow,
            keep_alive: modelKeepAlive,
            persona,
          }),
        });
      } catch (error) {
        pendingRegeneration.current = null;
        const stream = activeStreamsRef.current[chatId];
        if (stream?.requestId === requestId) {
          stream.message = {
            ...stream.message,
            content: `Unable to send message: ${normalizeErrorPayload(error).message}`,
            isStreaming: false,
          };
          chatCache.current[chatId] = mergeStreamMessage(
            chatCache.current[chatId] ?? [],
            requestId,
            stream.message,
          );
          delete activeStreamsRef.current[chatId];
        }
        if (activeChatId.current === chatId) mutationRollback.current?.();
        if (activeChatId.current === chatId) {
          mutationRollback.current = null;
        }
        if (activeRequestId.current === requestId) {
          activeRequestId.current = null;
        }
        if (activeChatId.current === chatId) {
          setErrorPayload(normalizeErrorPayload(error));
        }
      }
    },
    [
      activeModel,
      activeLeafId,
      activeMessages,
      activeModes,
      contextWindow,
      hardwareInfo,
      messages,
      modelKeepAlive,
      persona,
      temperature,
    ],
  );

  const handleStop = () => {
    const chatId = activeChatId.current;
    if (chatId) delete activeStreamsRef.current[chatId];
    activeRequestId.current = null;
    setIsStreaming(false);
    setMessages((current) => {
      const last = current.at(-1);
      if (!last || last.role !== "assistant") return current;
      if (last.content.length === 0) return current.slice(0, -1);
      return [...current.slice(0, -1), { ...last, isStreaming: false }];
    });
  };

  const handleClearContext = async () => {
    const chatId = activeChatId.current;
    if (!chatId) throw new Error("Start a chat before clearing its context.");
    await requestSidecar<boolean>(
      "clear_context",
      { chat_id: chatId },
      (value): value is boolean => value === true,
    );
    contextStartIndex.current = activeMessages.length;
  };

  // A failed boot ping replaces the whole workspace: the sidecar is the app.
  if (startupHealth === "failed") return <StartupError />;

  // While the first-run flag is unknown (the packaged sidecar can take 10-15s
  // to unpack on a clean install) the workspace stays unmounted, so the
  // Welcome screen can never flash before the onboarding wizard.
  if (isOnboarded === null) return <StartupSplash />;

  if (!isOnboarded) {
    return <OnboardingWizard onFinish={() => setIsOnboarded(true)} />;
  }

  return (
    <div className="flex h-full w-full overflow-hidden bg-[var(--bg)]">
      <ErrorBoundary key={activeChat?.id ?? NEW_CHAT_DRAFT_ID}>
        <WorkspaceView
          chatTitle={activeChat?.title ?? "New Chat"}
          onClearContext={handleClearContext}
          input={input}
          onInputChange={setInput}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          isStreaming={isStreaming}
          onSend={handleSend}
          onStop={handleStop}
          activeChatId={activeChat?.id ?? null}
          onSelectChat={handleSelectChat}
          onChatDeleted={handleChatDeleted}
          onProjectDeleted={handleProjectDeleted}
          onCreateChat={handleCreateChat}
          onProjectCreated={handleProjectCreated}
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={() => setIsSidebarOpen((isOpen) => !isOpen)}
          isChatSearchOpen={isChatSearchOpen}
          chatSearch={chatSearch}
          onCloseChatSearch={() => {
            setIsChatSearchOpen(false);
            setChatSearch("");
          }}
          onChatSearchChange={setChatSearch}
          sidebarRefreshToken={sidebarRefreshToken}
          onOpenSettings={() => {
            setSettingsTab("general");
            setIsSettingsOpen(true);
          }}
          onCreateChatShortcut={() => handleCreateChat(null)}
          onCreateProjectShortcut={() => {
            document.getElementById("new-project-button")?.click();
          }}
          onToggleSearchShortcut={() => {
            if (!isSidebarOpen) {
              setIsSidebarOpen(true);
              setIsChatSearchOpen(true);
              return;
            }
            setIsChatSearchOpen((isOpen) => {
              if (isOpen) setChatSearch("");
              return !isOpen;
            });
          }}
          onEscapeShortcut={() => {
            setIsChatSearchOpen(false);
            setChatSearch("");
            setIsSettingsOpen(false);
            setIsChangelogOpen(false);
          }}
          onOpenUsage={() => {
            setSettingsTab("usage");
            setIsSettingsOpen(true);
          }}
          lastTokenUsage={lastTokenUsage}
          errorPayload={errorPayload}
          onRetryError={() => {
            const previous = retryRequest.current;
            if (previous) {
              void handleSend(
                previous.modes,
                previous.attachments,
                previous.skill,
                previous.templateType,
                previous.content,
              );
            }
          }}
          supportsVision={supportsVision}
          modelCapabilities={modelCapabilities}
          supportsThinking={supportsThinking}
          isWelcome={activeMessages.length === 0 && !isStreaming}
          welcome={<WelcomeScreen onPromptSelect={setInput} t={t} />}
          conversation={
            <ChatConversation
              messages={activeMessages}
              branchMessages={messages}
              isStreaming={isStreaming}
              editingMessageId={editingMessageId}
              elapsedSeconds={elapsedSeconds}
              isThinkMode={activeModes.think}
              modes={activeModes}
              isExtractive={isExtractive}
              onRetry={(prompt, skill, templateType) => {
                void handleSend(
                  activeModes,
                  [],
                  skill,
                  templateType ?? undefined,
                  prompt,
                );
              }}
              onEditMessage={handleEditMessage}
              onEditingMessageChange={setEditingMessageId}
              onRegenerateMessage={handleRegenerateMessage}
              onSelectBranch={(leafId) => {
                contextStartIndex.current = 0;
                setActiveLeafId(leafId);
              }}
              onOpenPdf={(filePath, page) => {
                console.log("Opening PDF modal:", filePath, page);
                setPdfViewer({ filePath, page });
              }}
            />
          }
        />
      </ErrorBoundary>
      {pdfViewer && (
        <div className="fixed inset-0 z-[100] isolate flex">
          <ErrorBoundary>
            <Suspense fallback={null}>
              <PdfViewerModal
                key={`${pdfViewer.filePath}:${pdfViewer.page}`}
                filePath={pdfViewer.filePath}
                initialPage={pdfViewer.page}
                t={t}
                onClose={() => setPdfViewer(null)}
              />
            </Suspense>
          </ErrorBoundary>
        </div>
      )}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex">
          <ErrorBoundary>
            <Suspense fallback={null}>
              <SettingsModal
                open={isSettingsOpen}
                initialTab={settingsTab}
                onClose={() => setIsSettingsOpen(false)}
                onOpenChangelog={() => setIsChangelogOpen(true)}
              />
            </Suspense>
          </ErrorBoundary>
        </div>
      )}
      <ChangelogModal open={isChangelogOpen} onClose={closeChangelog} />
    </div>
  );
}
