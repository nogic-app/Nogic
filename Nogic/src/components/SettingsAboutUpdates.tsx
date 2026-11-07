import { useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button.tsx";

type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "upToDate"
  | "installing";

interface DownloadProgress {
  downloaded: number;
  total: number | null;
  finished: boolean;
}

export function SettingsAboutUpdates() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [version, setVersion] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const updateRef = useRef<Update | null>(null);

  useEffect(() => {
    return () => {
      const update = updateRef.current;
      if (update) {
        void update.close().catch((error: unknown) => {
          console.error("Could not release the pending updater resource.", error);
        });
      }
    };
  }, []);

  const checkForUpdates = async () => {
    setStatus("checking");
    setVersion(null);
    setErrorKey(null);
    setProgress(null);

    const previousUpdate = updateRef.current;
    updateRef.current = null;
    if (previousUpdate) {
      try {
        await previousUpdate.close();
      } catch (error) {
        console.error("Could not release the previous updater resource.", error);
      }
    }

    try {
      const update = await check();
      if (!update) {
        setStatus("upToDate");
        return;
      }
      updateRef.current = update;
      setVersion(update.version);
      setStatus("available");
    } catch (error) {
      console.error("Could not check for Nogic updates.", error);
      setErrorKey("settings.updateCheckFailed");
      setStatus("idle");
    }
  };

  const downloadAndInstall = async () => {
    const update = updateRef.current;
    if (!update) return;

    setStatus("installing");
    setErrorKey(null);
    setProgress({ downloaded: 0, total: null, finished: false });

    try {
      await update.downloadAndInstall(
        (event) => {
          if (event.event === "Started") {
            setProgress({
              downloaded: 0,
              total: event.data.contentLength ?? null,
              finished: false,
            });
          } else if (event.event === "Progress") {
            setProgress((current) => ({
              downloaded: (current?.downloaded ?? 0) + event.data.chunkLength,
              total: current?.total ?? null,
              finished: false,
            }));
          } else {
            setProgress((current) => ({
              downloaded: current?.downloaded ?? 0,
              total: current?.total ?? null,
              finished: true,
            }));
          }
        },
        { restartAfterInstall: false },
      );
      updateRef.current = null;
      await relaunch();
    } catch (error) {
      console.error("Could not download and install the Nogic update.", error);
      setErrorKey("settings.updateInstallFailed");
      setStatus("idle");
    }
  };

  const percentage = progress ? progressPercent(progress) : null;

  return (
    <div className="border-t border-[var(--border)] pt-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          disabled={status === "checking" || status === "installing"}
          onClick={() => void checkForUpdates()}
        >
          {status === "checking"
            ? t("settings.checkingUpdates")
            : t("settings.checkForUpdates")}
        </Button>
        {status === "available" && (
          <Button
            variant="outline"
            onClick={() => void downloadAndInstall()}
          >
            {t("settings.downloadAndInstall")}
          </Button>
        )}
        <p aria-live="polite" className="text-meta text-[var(--text-secondary)]">
          {status === "upToDate"
            ? t("settings.upToDate")
            : status === "available" && version
              ? t("settings.updateAvailable", { version })
              : status === "installing"
                ? t("settings.installingUpdate")
                : errorKey
                  ? t(errorKey)
                  : null}
        </p>
      </div>
      {status === "installing" && progress && (
        <div className="mt-4 space-y-2" aria-live="polite">
          <p className="text-meta text-[var(--text-secondary)]">
            {percentage === null
              ? t("settings.installingUpdate")
              : t("settings.updateProgress", { progress: percentage })}
          </p>
          <div
            role="progressbar"
            aria-label={t("settings.installingUpdate")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percentage ?? undefined}
            className="h-2 overflow-hidden rounded-sm bg-[var(--bg-muted)]"
          >
            <div
              className="h-full bg-[var(--accent)] transition-[width] duration-200"
              style={{ width: `${percentage ?? 30}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function progressPercent(progress: DownloadProgress): number | null {
  if (progress.finished) return 100;
  if (!progress.total || progress.total <= 0) return null;
  return Math.min(100, Math.round((progress.downloaded / progress.total) * 100));
}
