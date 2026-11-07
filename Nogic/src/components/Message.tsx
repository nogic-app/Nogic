import { useEffect, useState, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Pencil,
  RefreshCw,
  X,
} from "lucide-react";
import type { ChatModes } from "@/chatModes.ts";
import { Markdown } from "./Markdown.tsx";
import { UnverifiedWebBadge } from "./UnverifiedWebBadge.tsx";
import { StreamingTicker } from "./StreamingTicker.tsx";

interface UserMessageProps {
  content: string;
  children: ReactNode;
  isEditing: boolean;
  onEditingChange: (isEditing: boolean) => void;
  onSave?: (content: string) => Promise<void>;
  branchNavigation?: BranchNavigationProps;
}

interface BranchNavigationProps {
  current: number;
  total: number;
  onPrevious: () => void;
  onNext: () => void;
}

function BranchNavigation({
  current,
  total,
  onPrevious,
  onNext,
}: BranchNavigationProps) {
  return (
    <div className="mt-1 flex items-center justify-end gap-1 text-meta text-[var(--text-secondary)]">
      <button
        type="button"
        aria-label="Previous message branch"
        title="Previous branch"
        disabled={current === 1}
        onClick={onPrevious}
        className="rounded p-0.5 hover:bg-[var(--bg-muted)] disabled:opacity-40"
      >
        <ChevronLeft size={14} aria-hidden="true" />
      </button>
      <span aria-live="polite">{current} / {total}</span>
      <button
        type="button"
        aria-label="Next message branch"
        title="Next branch"
        disabled={current === total}
        onClick={onNext}
        className="rounded p-0.5 hover:bg-[var(--bg-muted)] disabled:opacity-40"
      >
        <ChevronRight size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

export function UserMessage({
  content,
  children,
  isEditing,
  onEditingChange,
  onSave,
  branchNavigation,
}: UserMessageProps) {
  const [draft, setDraft] = useState(content);

  if (isEditing) {
    return (
      <div className="ml-auto w-full max-w-[80%]">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="w-full rounded-md border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-3 py-2 text-body text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--focus)]"
          rows={Math.min(8, Math.max(2, draft.split("\n").length))}
          autoFocus
        />
        <div className="mt-1 flex justify-end gap-1">
          <button
            type="button"
            aria-label="Cancel edit"
            title="Cancel"
            onClick={() => {
              setDraft(content);
              onEditingChange(false);
            }}
            className="rounded-md p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-muted)]"
          >
            <X size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Save edit"
            title="Save"
            disabled={!onSave}
            onClick={() => {
              if (!onSave) return;
              const trimmedDraft = draft.trim();
              if (!trimmedDraft) {
                setDraft(content);
                onEditingChange(false);
                return;
              }
              onEditingChange(false);
              void onSave(trimmedDraft).catch(() => undefined);
            }}
            className="rounded-md p-1.5 text-[var(--accent)] hover:bg-[var(--accent-subtle)] disabled:text-[var(--text-tertiary)]"
          >
            <Check size={14} aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }

  // A div rather than a p: Markdown renders block elements (paragraphs, lists)
  // and nesting those inside a paragraph is invalid HTML.
  return (
    <div className="group relative ml-auto w-fit max-w-[80%]">
      <div className="user-message rounded-2xl bg-[var(--accent-subtle)] px-4 py-3 text-body font-medium text-[var(--text-primary)]">
        {children}
      </div>
      {branchNavigation && <BranchNavigation {...branchNavigation} />}
      {onSave && (
        <button
          type="button"
          aria-label="Edit message"
          title="Edit message"
          onClick={() => {
            setDraft(content);
            onEditingChange(true);
          }}
          className="absolute -left-8 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-[var(--text-secondary)] opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)] focus:opacity-100"
        >
          <Pencil size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function StreamingDots() {
  return (
    <span className="streaming-dots ml-1 flex items-center gap-1" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

function ThinkingPanel({ text }: { text: string }) {
  const [isOpen, setIsOpen] = useState(true);
  return (
    <details
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
      className="group text-[var(--text-secondary)]"
    >
      <summary className="flex list-none cursor-pointer select-none items-center gap-1 text-xs opacity-60 transition-opacity duration-200 hover:opacity-100">
        Reasoning
        <ChevronDown
          size={12}
          aria-hidden="true"
          className="transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="mt-1 opacity-70 text-xs">
        <Markdown>{text}</Markdown>
      </div>
    </details>
  );
}

interface AssistantMessageProps {
  children: ReactNode;
  isStreaming?: boolean;
  elapsedSeconds?: number;
  thinkingText?: string;
  isReasoningStreaming?: boolean;
  stepText?: string;
  showThinking?: boolean;
  modes: ChatModes;
  isExtractive?: boolean;
  rawContent?: string;
  persistedMessageId?: string;
  isCached?: boolean;
  unverifiedWeb?: boolean;
  onRegenerate?: (messageId: string) => void;
  branchNavigation?: BranchNavigationProps;
}

export function AssistantMessage({
  children,
  isStreaming = false,
  elapsedSeconds = 0,
  thinkingText = "",
  isReasoningStreaming = false,
  stepText = "",
  showThinking = false,
  modes,
  isExtractive = false,
  rawContent = "",
  persistedMessageId,
  isCached = false,
  unverifiedWeb = false,
  onRegenerate,
  branchNavigation,
}: AssistantMessageProps) {
  const [isCopied, setIsCopied] = useState(false);
  const hasContent = children !== "" && children !== null && children !== undefined;
  const hasThinking = thinkingText.trim().length > 0;

  useEffect(() => {
    if (!isCopied) return;
    const timeout = window.setTimeout(() => setIsCopied(false), 2000);
    return () => window.clearTimeout(timeout);
  }, [isCopied]);

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(rawContent);
      setIsCopied(true);
    } catch (error) {
      console.error("Could not copy the assistant message to the clipboard.", error);
    }
  }

  // Think mode opens the panel before text arrives; after that its content
  // alone keeps it visible, so reasoning survives the end of streaming.
  const showPanel =
    !unverifiedWeb && (hasThinking || (isStreaming && showThinking));

  return (
    <div className="group relative pb-4 text-body text-primary">
      {unverifiedWeb && <UnverifiedWebBadge />}
      {isStreaming && !unverifiedWeb && (
        <div className="mb-2">
          <StreamingTicker
            modes={modes}
            currentStep={stepText}
            isReasoningStreaming={
              isReasoningStreaming && isStreaming && hasThinking
            }
            isExtractive={isExtractive}
          />
        </div>
      )}

      <div className="flex flex-col">
        {showPanel && <ThinkingPanel key="thinking-panel" text={thinkingText} />}
        {isStreaming && !unverifiedWeb && !hasContent && (
          <div
            className="streaming-indicator !inline-flex !h-auto !flex-wrap !items-center !gap-1 !px-0 text-body"
            role="status"
            aria-label={`Thinking for ${elapsedSeconds} seconds`}
          >
            <span>Thinking... {elapsedSeconds}s</span>
            <StreamingDots />
          </div>
        )}
        {hasContent && <div className="mb-4">{children}</div>}
      </div>
      {!isStreaming && rawContent.length > 0 && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={isCopied ? "Copied" : "Copy message"}
            title={isCopied ? "Copied" : "Copy message"}
            onClick={() => void copyMessage()}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-meta text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]"
          >
            {isCopied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
            {isCopied ? "Copied" : "Copy"}
          </button>
          {isCached && (
            <span className="rounded bg-[var(--bg-muted)] px-1.5 py-0.5 text-[10px] text-[var(--text-tertiary)]">
              Cached
            </span>
          )}
          {onRegenerate && persistedMessageId && (
            <button
              type="button"
              aria-label="Regenerate response"
              title="Regenerate response"
              onClick={() => onRegenerate(persistedMessageId)}
              className="rounded-md p-1.5 text-[var(--text-secondary)] opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)] focus:opacity-100"
            >
              <RefreshCw size={13} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
      {!isStreaming && branchNavigation && (
        <BranchNavigation {...branchNavigation} />
      )}
    </div>
  );
}

export function Refusal({ children }: { children: ReactNode }) {
  return (
    <p className="text-body italic text-secondary">{children}</p>
  );
}
