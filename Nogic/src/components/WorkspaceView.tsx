import {
  useLayoutEffect,
  useRef,
  useState,
  type UIEvent,
  type ReactNode,
} from "react";
import { Eraser } from "lucide-react";
import type { ChatModes } from "@/chatModes.ts";
import { Composer } from "./Composer.tsx";
import type { SkillTag } from "./Composer.tsx";
import type { FileAttachment } from "./FilePill.tsx";
import { Sidebar, type ChatItem } from "./Sidebar.tsx";
import { useKeyboardShortcuts } from "@/useKeyboardShortcuts.ts";
import { ErrorSurface } from "@/components/ErrorSurface.tsx";
import type { ErrorPayload } from "@/types/errors.ts";
import type { TokenUsage } from "@/types/tokenUsage.ts";

interface WorkspaceViewProps {
  chatTitle: string;
  onClearContext: () => Promise<void>;
  input: string;
  onInputChange: (value: string) => void;
  isStreaming: boolean;
  onSend: (modes: ChatModes, attachments: FileAttachment[], skill: SkillTag | null) => void;
  onStop: () => void;
  activeChatId: string | null;
  onSelectChat: (chat: ChatItem) => void;
  onChatDeleted: (chatId: string) => void;
  onProjectDeleted: (projectId: string) => void;
  onCreateChat: (projectId: string | null) => void;
  onProjectCreated: (projectId: string) => void;
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  sidebarRefreshToken: number;
  onOpenSettings: () => void;
  onCreateChatShortcut: () => void;
  onCreateProjectShortcut: () => void;
  onToggleSearchShortcut: () => void;
  isChatSearchOpen: boolean;
  chatSearch: string;
  onCloseChatSearch: () => void;
  onChatSearchChange: (value: string) => void;
  onEscapeShortcut: () => void;
  onOpenUsage: () => void;
  supportsVision: boolean;
  modelCapabilities: string[] | null;
  supportsThinking: boolean;
  isWelcome: boolean;
  welcome: ReactNode;
  conversation: ReactNode;
  errorPayload: ErrorPayload | null;
  onRetryError: () => void;
  lastTokenUsage: TokenUsage | null;
}

export function WorkspaceView(props: WorkspaceViewProps) {
  const [contextToast, setContextToast] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const conversationScrollRef = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef<Map<string, number>>(new Map());

  useLayoutEffect(() => {
    const container = conversationScrollRef.current;
    if (!container || !props.activeChatId) return;
    const savedPosition = scrollPositions.current.get(props.activeChatId);
    if (savedPosition !== undefined) {
      container.scrollTop = savedPosition;
    }
  }, [props.activeChatId]);

  const handleConversationScroll = (event: UIEvent<HTMLDivElement>) => {
    if (!props.activeChatId) return;
    scrollPositions.current.set(props.activeChatId, event.currentTarget.scrollTop);
  };

  const handleClearContext = async () => {
    try {
      await props.onClearContext();
      setContextToast(
        "Context cleared. The AI will only remember new messages from this point.",
      );
    } catch (error) {
      console.error("Could not clear the chat context.", error);
      setContextToast("Could not clear context. Please try again.");
    }
    window.setTimeout(() => setContextToast(null), 4000);
  };

  useKeyboardShortcuts({
    onOpenSettings: props.onOpenSettings,
    onCreateChat: props.onCreateChatShortcut,
    onCreateProject: props.onCreateProjectShortcut,
    onToggleSearch: props.onToggleSearchShortcut,
    onEscape: props.onEscapeShortcut,
  });

  return (
    <div className="flex h-full bg-bg">
      {props.errorPayload ? (
        <ErrorSurface
          payload={props.errorPayload}
          onRetry={props.onRetryError}
          onOpenSettings={props.onOpenSettings}
        />
      ) : null}
      <Sidebar
        activeChatId={props.activeChatId}
        onSelectChat={props.onSelectChat}
        onChatDeleted={props.onChatDeleted}
        onProjectDeleted={props.onProjectDeleted}
        onCreateChat={props.onCreateChat}
        onProjectCreated={props.onProjectCreated}
        isOpen={props.isSidebarOpen}
        onToggle={props.onToggleSidebar}
        refreshToken={props.sidebarRefreshToken}
        onOpenSettings={props.onOpenSettings}
        searchInputRef={searchInputRef}
        isChatSearchOpen={props.isChatSearchOpen}
        chatSearch={props.chatSearch}
        onToggleChatSearch={props.onToggleSearchShortcut}
        onCloseChatSearch={props.onCloseChatSearch}
        onChatSearchChange={props.onChatSearchChange}
        onOpenUsage={props.onOpenUsage}
      />

      <main className="flex min-w-0 flex-1 flex-col" onClick={props.onCloseChatSearch}>
        <header className="border-b border-border">
          <div className="mx-auto flex max-w-column items-center justify-between px-6 py-3">
            <div className="flex items-center gap-2">
              <span className="text-sec text-secondary">{props.chatTitle}</span>
              {props.activeChatId && (
                <button
                  type="button"
                  aria-label="Clear memory"
                  title="Clear memory (keep visible history)"
                  className="rounded-md p-1 text-secondary hover:bg-[var(--bg-muted)] hover:text-primary"
                  onClick={() => void handleClearContext()}
                >
                  <Eraser size={16} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </header>

        <div
          ref={conversationScrollRef}
          className="flex-1 overflow-y-auto"
          onScroll={handleConversationScroll}
        >
          <div
            className={`mx-auto max-w-column px-6 py-8 ${
              props.isWelcome ? "flex min-h-full flex-col justify-center" : ""
            }`}
          >
            {props.isWelcome ? props.welcome : <div className="flex flex-col space-y-8">{props.conversation}</div>}
          </div>
        </div>

        <div className="mx-auto w-full max-w-column px-6 pb-6 pt-2">
          {props.lastTokenUsage && (
            <p className="mb-1 text-[11px] text-[var(--text-tertiary)]">
              Tokens: {formatTokenCount(props.lastTokenUsage.prompt_tokens)} in /{" "}
              {formatTokenCount(props.lastTokenUsage.completion_tokens)} out
            </p>
          )}
          <Composer
            value={props.input}
            onChange={props.onInputChange}
            isStreaming={props.isStreaming}
            onSend={props.onSend}
            onStop={props.onStop}
            supportsVision={props.supportsVision}
            modelCapabilities={props.modelCapabilities}
            supportsThinking={props.supportsThinking}
          />
        </div>
      </main>
      {contextToast && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-md border border-border bg-[var(--bg-elevated)] px-4 py-2 text-sec text-primary shadow-xl"
        >
          {contextToast}
        </div>
      )}
    </div>
  );
}

function formatTokenCount(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);
}
