import { useEffect, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import type { ChatModes } from "@/chatModes.ts";
import { StreamingTicker } from "./StreamingTicker.tsx";

export function UserMessage({ children }: { children: ReactNode }) {
  // A div rather than a p: Markdown renders block elements (paragraphs, lists)
  // and nesting those inside a paragraph is invalid HTML.
  return (
    <div className="user-message ml-auto w-fit max-w-[80%] rounded-2xl bg-[var(--accent-subtle)] px-4 py-3 text-body font-medium text-[var(--text-primary)]">
      {children}
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

function ThinkingPanel({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  // Open while reasoning streams in; collapse once the answer is finished.
  const [isOpen, setIsOpen] = useState<boolean>(isStreaming);

  useEffect(() => {
    if (!isStreaming) setIsOpen(false);
  }, [isStreaming]);

  return (
    <details
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
      className="rounded-md border border-[var(--border)] bg-[var(--bg-muted)] px-3 py-2"
    >
      <summary className="cursor-pointer select-none text-meta text-secondary">
        Reasoning
      </summary>
      <div className="mt-2 whitespace-pre-wrap text-sec text-secondary">
        {text || "…"}
      </div>
    </details>
  );
}

interface AssistantMessageProps {
  children: ReactNode;
  isStreaming?: boolean;
  elapsedSeconds?: number;
  thinkingText?: string;
  stepText?: string;
  showThinking?: boolean;
  modes: ChatModes;
  isExtractive?: boolean;
  rawContent?: string;
}

export function AssistantMessage({
  children,
  isStreaming = false,
  elapsedSeconds = 0,
  thinkingText = "",
  stepText = "",
  showThinking = false,
  modes,
  isExtractive = false,
  rawContent = "",
}: AssistantMessageProps) {
  const [hasStreamed, setHasStreamed] = useState(isStreaming);
  const [isCopied, setIsCopied] = useState(false);
  const hasContent = children !== "" && children !== null && children !== undefined;
  const hasThinking = thinkingText.trim().length > 0;
  useEffect(() => {
    if (isStreaming) setHasStreamed(true);
  }, [isStreaming]);

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
  const showPanel = hasThinking || (isStreaming && showThinking);

  return (
    <div className="pb-4 text-body text-primary">
      {hasStreamed && (
        <div className="h-[30px]">
          {isStreaming && (
            <StreamingTicker
              modes={modes}
              currentStep={stepText}
              isExtractive={isExtractive}
            />
          )}
        </div>
      )}

      {isStreaming && (
        <div className="space-y-2">
          {!hasContent && (
            <div
              className="streaming-indicator !inline-flex !h-auto !flex-wrap !items-center !gap-1 !px-0 text-body"
              role="status"
              aria-label={`Thinking for ${elapsedSeconds} seconds`}
            >
              <span>Thinking... {elapsedSeconds}s</span>
              <StreamingDots />
            </div>
          )}
          {showPanel && (
            <ThinkingPanel text={thinkingText} isStreaming={true} />
          )}
        </div>
      )}

      {!isStreaming && showPanel && (
        <ThinkingPanel text={thinkingText} isStreaming={false} />
      )}

      {hasContent && (
        <div className={showPanel ? "mt-2 mb-4" : "mb-4"}>{children}</div>
      )}
      {!isStreaming && rawContent.length > 0 && (
        <button
          type="button"
          aria-label={isCopied ? "Copied" : "Copy message"}
          title={isCopied ? "Copied" : "Copy message"}
          onClick={() => void copyMessage()}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-meta text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]"
        >
          {isCopied ? (
            <Check size={13} aria-hidden="true" />
          ) : (
            <Copy size={13} aria-hidden="true" />
          )}
          {isCopied ? "Copied" : "Copy"}
        </button>
      )}
    </div>
  );
}

export function Refusal({ children }: { children: ReactNode }) {
  return (
    <p className="text-body italic text-secondary">{children}</p>
  );
}
