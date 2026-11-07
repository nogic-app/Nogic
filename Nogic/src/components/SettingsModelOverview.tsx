import { useTranslation } from "react-i18next";
import { ErrorSurface } from "@/components/ErrorSurface.tsx";
import type { ErrorPayload } from "@/types/errors.ts";

interface SettingsModelOverviewProps {
  activeModel: string;
  fallbackModel: string;
  installedModels: string[];
  isRefreshing: boolean;
  onFallbackModelChange: (model: string) => void;
  onModelChange: (model: string) => void;
  onUnloadModel: () => void;
  status: "checking" | "running" | "offline";
  modelError: ErrorPayload | null;
  onRetryModels: () => void;
}

const NETWORK_ERROR: ErrorPayload = {
  bucket: "network",
  message: "The Nogic engine isn't running. Click Retry.",
  action: { kind: "retry", label: "Retry" },
};

export function SettingsModelOverview({
  activeModel,
  fallbackModel,
  installedModels,
  isRefreshing,
  onFallbackModelChange,
  onModelChange,
  onUnloadModel,
  status,
  modelError,
  onRetryModels,
}: SettingsModelOverviewProps) {
  const { t } = useTranslation();
  const activeSelection = installedModels.includes(activeModel) ? activeModel : "";
  const fallbackSelection = installedModels.includes(fallbackModel)
    ? fallbackModel
    : "";

  return (
    <div className="space-y-6">
      {modelError ? (
        <ErrorSurface payload={modelError} onRetry={onRetryModels} />
      ) : status === "offline" ? (
        <ErrorSurface payload={NETWORK_ERROR} onRetry={onRetryModels} />
      ) : null}
      <section>
        <div className="flex items-center gap-3">
          <h3 className="text-title font-semibold text-[var(--text-primary)]">
            {t("settings.ollama")}
          </h3>
          <span
            className={`inline-flex items-center gap-2 rounded-full bg-[var(--bg-muted)] px-2.5 py-1 text-meta ${
              status === "offline"
                ? "text-[var(--danger)]"
                : "text-[var(--text-secondary)]"
            }`}
            aria-live="polite"
          >
            <span
              aria-hidden="true"
              className={`h-2 w-2 rounded-full ${
                status === "running"
                  ? "bg-[var(--accent)]"
                  : status === "offline"
                    ? "bg-[var(--danger)]"
                    : "bg-[var(--text-tertiary)]"
              }`}
            />
            {status === "checking"
              ? t("settings.checking")
              : status === "running"
                ? t("settings.running")
                : t("settings.offline")}
          </span>
        </div>
        <p className="mt-1 text-meta text-[var(--text-secondary)]">
          {t("settings.ollamaDescription")}
        </p>
      </section>

      <section className="flex w-full flex-col">
        <div className="flex flex-col items-start justify-between gap-3 border-b border-[var(--border)] py-4 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 flex-col pr-6">
            <label
              htmlFor="settings-model"
              className="text-sm font-medium text-[var(--text-primary)]"
            >
              {t("settings.model")}
            </label>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
              {t("settings.activeModelDescription")}
            </p>
          </div>
          <div className="flex w-full items-center gap-3 sm:w-auto">
            <select
              id="settings-model"
              aria-label={t("settings.model")}
              value={activeSelection}
              disabled={installedModels.length === 0 || isRefreshing}
              onChange={(event) => {
                if (event.target.value) onModelChange(event.target.value);
              }}
              className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-md text-sm text-[var(--text-primary)] p-2 min-w-[200px] w-[200px] outline-none focus:border-[var(--border-strong)] focus:ring-2 focus:ring-[var(--focus)] disabled:text-[var(--text-tertiary)]"
            >
              <option value="">
                {status === "offline"
                  ? t("settings.ollamaOffline")
                  : installedModels.length > 0
                    ? t("settings.chooseInstalledModel")
                    : t("settings.noInstalledModels")}
              </option>
              {installedModels.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={onUnloadModel}
              disabled={!activeSelection || status !== "running" || isRefreshing}
              className="shrink-0 text-meta text-[var(--accent)] hover:underline disabled:text-[var(--text-tertiary)] disabled:no-underline"
            >
              Unload Model
            </button>
          </div>
        </div>
        <div className="flex flex-col items-start justify-between gap-3 border-b border-[var(--border)] py-4 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 flex-col pr-6">
            <label
              htmlFor="settings-fallback-model"
              className="text-sm font-medium text-[var(--text-primary)]"
            >
              {t("settings.fallbackModel")}
            </label>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
              {t("settings.fallbackModelDescription")}
            </p>
          </div>
          <select
            id="settings-fallback-model"
            aria-label={t("settings.fallbackModel")}
            value={fallbackSelection}
            disabled={installedModels.length === 0 || isRefreshing}
            onChange={(event) => onFallbackModelChange(event.target.value)}
            className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-md text-sm text-[var(--text-primary)] p-2 min-w-[200px] w-[200px] outline-none focus:border-[var(--border-strong)] focus:ring-2 focus:ring-[var(--focus)] disabled:text-[var(--text-tertiary)]"
          >
            <option value="">
              {status === "offline"
                ? t("settings.ollamaOffline")
                : installedModels.length > 0
                  ? t("settings.chooseInstalledModel")
                  : t("settings.noInstalledModels")}
            </option>
            {installedModels.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </div>
      </section>
    </div>
  );
}
