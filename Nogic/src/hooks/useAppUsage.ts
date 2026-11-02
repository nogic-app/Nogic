import { useEffect, useState } from "react";
import { requestSidecar } from "@/sidecarRequest.ts";
import { isAppUsage, type AppUsage } from "@/types/appUsage.ts";

export function useAppUsage(intervalMs: number): AppUsage | null {
  const [usage, setUsage] = useState<AppUsage | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const poll = async () => {
      try {
        const data = await requestSidecar(
          "get_app_usage",
          {},
          isAppUsage,
        );
        if (!cancelled) setUsage(data);
      } catch (error) {
        if (cancelled) return;
        console.error("Could not read Ollama model usage.", error);
        setUsage(null);
      }
    };

    void poll();
    timer = window.setInterval(() => void poll(), intervalMs);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [intervalMs]);

  return usage;
}
