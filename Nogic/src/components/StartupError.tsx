import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "./ui/button.tsx";

/** Calm full-screen fallback when the sidecar never answers the boot ping. */
export function StartupError() {
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleCopyDebugInfo = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const payload = {
        app_version: "1.0.1",
        error: "Sidecar failed to start",
        os: navigator.userAgent,
      };
      await navigator.clipboard.writeText(JSON.stringify(payload));
      setNotice("Debug info copied");
    } catch (error) {
      console.error("Could not copy startup debug info.", error);
      setNotice("Could not copy debug info");
    } finally {
      setBusy(false);
    }
  };

  const handleRestart = async () => {
    setNotice(null);
    try {
      await invoke("restart_app");
    } catch (error) {
      console.error("Could not restart Nogic.", error);
      setNotice("Could not restart the app");
    }
  };

  return (
    <section
      aria-label="Startup error"
      className="flex h-full w-full flex-col items-center justify-center gap-6 bg-[var(--bg)] px-6 text-center"
    >
      <img src="/logo.png" alt="" aria-hidden="true" className="h-12 w-auto opacity-90" />
      <div className="max-w-[48ch] space-y-2">
        <h1 className="text-title font-medium text-[var(--text-primary)]">
          The Nogic engine failed to start.
        </h1>
        <p className="text-sec text-[var(--text-secondary)]">
          Please check your antivirus or restart the app.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="outline" disabled={busy} onClick={() => void handleCopyDebugInfo()}>
          Copy debug info
        </Button>
        <Button variant="ghost" onClick={() => void handleRestart()}>
          Restart App
        </Button>
      </div>
      {notice && (
        <p role="status" aria-live="polite" className="text-meta text-[var(--text-secondary)]">
          {notice}
        </p>
      )}
    </section>
  );
}
