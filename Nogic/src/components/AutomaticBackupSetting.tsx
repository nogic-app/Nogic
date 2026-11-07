import { useEffect, useState } from "react";
import { requestSidecar } from "../sidecarRequest.ts";

type AutoBackupFrequency = "off" | "daily" | "weekly" | "monthly";

function isSettingsRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every((item) => typeof item === "string")
  );
}

function isAutoBackupFrequency(value: unknown): value is AutoBackupFrequency {
  return (
    value === "off" ||
    value === "daily" ||
    value === "weekly" ||
    value === "monthly"
  );
}

function isSuccessfulAction(value: unknown): value is { success: true } {
  return (
    typeof value === "object" &&
    value !== null &&
    "success" in value &&
    value.success === true
  );
}

export function AutomaticBackupSetting() {
  const [frequency, setFrequency] = useState<AutoBackupFrequency>("weekly");
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void requestSidecar("get_settings", {}, isSettingsRecord)
      .then((settings) => {
        const savedFrequency = settings.auto_backup_frequency;
        if (
          savedFrequency !== undefined &&
          !isAutoBackupFrequency(savedFrequency)
        ) {
          throw new Error("The saved automatic backup frequency is invalid.");
        }
        if (mounted && isAutoBackupFrequency(savedFrequency)) {
          setFrequency(savedFrequency);
        }
      })
      .catch((loadError: unknown) => {
        console.error("Could not load automatic backup settings.", loadError);
        if (mounted) {
          setError(
            loadError instanceof Error ? loadError.message : String(loadError),
          );
        }
      })
      .finally(() => {
        if (mounted) setSettingsLoaded(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  async function saveFrequency(value: string) {
    if (!isAutoBackupFrequency(value)) return;
    const previousFrequency = frequency;
    setFrequency(value);
    setIsSaving(true);
    setError(null);
    try {
      await requestSidecar(
        "save_setting",
        { key: "auto_backup_frequency", value },
        isSuccessfulAction,
      );
    } catch (saveError) {
      console.error("Could not save the automatic backup frequency.", saveError);
      setFrequency(previousFrequency);
      setError(
        saveError instanceof Error ? saveError.message : String(saveError),
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="mt-4 max-w-sm">
      <label
        htmlFor="auto-backup-frequency"
        className="block text-sec text-[var(--text-primary)]"
      >
        Automatic Backups
      </label>
      <select
        id="auto-backup-frequency"
        value={frequency}
        onChange={(event) => void saveFrequency(event.target.value)}
        disabled={!settingsLoaded || isSaving}
        className="mt-2 block w-full rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1.5 text-sec text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)] focus:ring-2 focus:ring-[var(--focus)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        <option value="off">Off</option>
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
        <option value="monthly">Monthly</option>
      </select>
      <p className="mt-1 text-meta text-[var(--text-secondary)]">
        Auto-backups are saved in your Nogic data folder.
      </p>
      {error ? (
        <p role="alert" className="mt-2 text-meta text-[var(--danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
