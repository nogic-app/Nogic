import { useEffect, useRef, useState } from "react";
import { Library, Trash2 } from "lucide-react";
import { requestSidecar } from "@/sidecarRequest.ts";

interface SavedPrompt {
  id: string;
  title: string;
  content: string;
  created_at: string;
  auto_saved: boolean;
  usage_count: number;
}

type Panel = "library" | null;

function isSavedPrompts(value: unknown): value is SavedPrompt[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        "id" in item &&
        typeof item.id === "string" &&
        "title" in item &&
        typeof item.title === "string" &&
        "content" in item &&
        typeof item.content === "string" &&
        "created_at" in item &&
        typeof item.created_at === "string" &&
        "auto_saved" in item &&
        typeof item.auto_saved === "boolean" &&
        "usage_count" in item &&
        typeof item.usage_count === "number",
    )
  );
}

function isSuccess(value: unknown): value is { success: true } {
  return (
    typeof value === "object" &&
    value !== null &&
    "success" in value &&
    value.success === true
  );
}

interface PromptLibraryProps {
  value: string;
  onChange: (value: string) => void;
}

export function PromptLibrary({ value, onChange }: PromptLibraryProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [prompts, setPrompts] = useState<SavedPrompt[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!panel) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setPanel(null);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setPanel(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [panel]);

  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(""), 3000);
    return () => window.clearTimeout(timer);
  }, [status]);

  useEffect(() => {
    if (panel !== "library") return;

    let isCurrentRequest = true;
    setPrompts([]);
    setIsLoading(true);
    setStatus("");

    const loadPrompts = async () => {
      try {
        const result = await requestSidecar<SavedPrompt[]>(
          "get_prompts",
          {},
          isSavedPrompts,
        );
        if (isCurrentRequest) setPrompts(result);
      } catch (error) {
        if (!isCurrentRequest) return;
        console.error("Could not load the prompt library.", error);
        setStatus(`Could not load prompts: ${String(error)}`);
      } finally {
        if (isCurrentRequest) setIsLoading(false);
      }
    };

    void loadPrompts();
    return () => {
      isCurrentRequest = false;
    };
  }, [panel]);

  const openLibrary = () => {
    setPanel((current) => (current === "library" ? null : "library"));
  };

  const deletePrompt = async (promptId: string) => {
    try {
      await requestSidecar(
        "delete_prompt",
        { prompt_id: promptId },
        isSuccess,
      );
      setPrompts((current) => current.filter((prompt) => prompt.id !== promptId));
    } catch (error) {
      console.error("Could not delete the prompt.", error);
      setStatus(`Could not delete prompt: ${String(error)}`);
    }
  };

  const insertPrompt = (content: string) => {
    onChange(value.trim() ? `${value}\n\n${content}` : content);
    setPanel(null);
    setStatus("Prompt inserted into composer.");
  };

  return (
    <div ref={rootRef} className="relative flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        aria-label="Prompt library"
        aria-haspopup="dialog"
        aria-expanded={panel === "library"}
        onClick={openLibrary}
        className="flex h-8 w-8 items-center justify-center rounded-md text-secondary transition-colors hover:bg-[var(--bg-muted)] hover:text-primary"
      >
        <Library size={16} aria-hidden="true" />
      </button>
      {panel === "library" && (
        <div
          role="dialog"
          aria-label="Prompt library"
          className="absolute bottom-full start-0 z-30 mb-2 w-[min(90vw,360px)] rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
        >
          <h2 className="px-1 text-sec font-medium text-primary">Prompt library</h2>
          <div className="mt-2 max-h-64 overflow-y-auto">
            {isLoading ? (
              <p className="px-1 py-3 text-meta text-secondary">Loading prompts...</p>
            ) : prompts.length === 0 ? (
              <p className="px-1 py-3 text-meta text-secondary">No saved prompts yet.</p>
            ) : (
              <ul className="space-y-1">
                {prompts.map((prompt) => (
                  <li key={prompt.id} className="flex items-start gap-1">
                    <button
                      type="button"
                      onClick={() => insertPrompt(prompt.content)}
                      className="min-w-0 flex-1 rounded-md px-2 py-2 text-start hover:bg-[var(--bg-muted)]"
                    >
                      <span className="flex items-center gap-2">
                        <span className="block min-w-0 truncate text-sec text-primary">
                          {prompt.title}
                        </span>
                        {prompt.auto_saved && (
                          <span className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--bg-muted)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">
                            Auto
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block line-clamp-2 text-meta text-secondary">
                        {prompt.content}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${prompt.title}`}
                      onClick={() => void deletePrompt(prompt.id)}
                      className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-tertiary hover:bg-[var(--bg-muted)] hover:text-primary"
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {status && (
        <span
          role="status"
          className="absolute start-0 top-full z-30 mt-1 max-w-[min(90vw,360px)] rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1 text-meta text-secondary shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
        >
          {status}
        </span>
      )}
    </div>
  );
}
