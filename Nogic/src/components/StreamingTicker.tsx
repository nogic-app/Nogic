import type { ChatModes } from "@/chatModes.ts";

function formatStep(step: string): string {
  const label = step.trim().replace(/\.{3}$/, "");
  if (!label) return "Thinking...";
  return `${label[0].toUpperCase()}${label.slice(1)}...`;
}

export function StreamingTicker({
  modes,
  currentStep = "",
  isReasoningStreaming = false,
  isExtractive = false,
}: {
  modes: ChatModes;
  currentStep?: string;
  isReasoningStreaming?: boolean;
  isExtractive?: boolean;
}) {
  const initialStep = modes.web
    ? "Searching web"
    : modes.deep_think
      ? "Planning"
      : "Thinking";
  const displayStep = isReasoningStreaming
    ? "Reasoning..."
    : formatStep(currentStep || initialStep);

  return (
    <p
      aria-live="polite"
      className="whitespace-nowrap font-mono text-meta text-tertiary"
      aria-label={displayStep}
    >
      <span className="inline-block animate-shimmer">{displayStep}</span>
      {isExtractive && (
        <span className="ml-2">· Extractive mode (small model)</span>
      )}
    </p>
  );
}
