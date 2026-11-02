import { useEffect } from "react";
import { useSettings } from "@/contexts/SettingsContext.tsx";

interface KeyboardShortcutActions {
  onOpenSettings: () => void;
  onCreateChat: () => void;
  onCreateProject: () => void;
  onToggleSearch: () => void;
  onEscape: () => void;
}

export function useKeyboardShortcuts(actions: KeyboardShortcutActions): void {
  const { enableShortcuts } = useSettings();

  useEffect(() => {
    if (!enableShortcuts) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        const activeElement = document.activeElement;
        if (
          activeElement instanceof HTMLInputElement ||
          activeElement instanceof HTMLTextAreaElement ||
          activeElement instanceof HTMLElement && activeElement.isContentEditable
        ) {
          activeElement.blur();
        } else {
          actions.onEscape();
        }
        event.preventDefault();
        return;
      }

      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;

      switch (event.key.toLowerCase()) {
        case ",":
          if (event.shiftKey) return;
          event.preventDefault();
          actions.onOpenSettings();
          break;
        case "l":
          if (event.shiftKey) return;
          event.preventDefault();
          document.getElementById("chat-composer")?.focus();
          break;
        case "n":
          event.preventDefault();
          if (event.shiftKey) {
            actions.onCreateProject();
          } else {
            actions.onCreateChat();
          }
          break;
        case "k":
          if (event.shiftKey) return;
          event.preventDefault();
          actions.onToggleSearch();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [actions, enableShortcuts]);
}
