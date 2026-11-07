import { useSettings } from "@/contexts/SettingsContext.tsx";
import { useTranslation } from "react-i18next";

export function ModelBehaviorSettings() {
  const { t } = useTranslation();
  const {
    temperature,
    contextWindow,
    modelKeepAlive,
    setTemperature,
    setContextWindow,
    setModelKeepAlive,
  } = useSettings();

  return (
    <section>
      <h3 className="text-title font-medium text-[var(--text-primary)]">
        {t("settings.modelBehavior")}
      </h3>
      <div className="mt-3 flex flex-col w-full">
        <div className="flex items-center justify-between py-4 border-b border-[var(--border)] w-full">
          <div className="flex flex-col pr-6 flex-1">
            <label
              htmlFor="settings-temperature"
              className="text-sm font-medium text-[var(--text-primary)]"
            >
              {t("settings.temperature")}
            </label>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              Lower is more factual, higher is more creative.
            </p>
          </div>
          <div className="w-48 flex-shrink-0 flex items-center gap-3">
            <output
              htmlFor="settings-temperature"
              className="w-8 flex-shrink-0 text-right font-mono text-xs text-[var(--text-secondary)]"
            >
              {temperature.toFixed(1)}
            </output>
            <input
              id="settings-temperature"
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={temperature}
              onChange={(event) => setTemperature(Number(event.target.value))}
              className="min-w-0 w-full accent-[var(--accent)]"
            />
          </div>
        </div>
        <div className="flex items-center justify-between py-4 border-b border-[var(--border)] w-full">
          <div className="flex flex-col pr-6 flex-1">
            <label
              htmlFor="settings-context-window"
              className="text-sm font-medium text-[var(--text-primary)]"
            >
              {t("settings.contextWindow")}
            </label>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              Larger context remembers more of the chat, but uses more VRAM.
            </p>
          </div>
          <div className="w-[200px] flex-shrink-0 flex items-center gap-3">
            <select
              id="settings-context-window"
              value={contextWindow}
              onChange={(event) => setContextWindow(Number(event.target.value))}
              className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-md text-sm text-[var(--text-primary)] p-2 min-w-[200px] w-full outline-none focus:border-[var(--border-strong)] focus:ring-2 focus:ring-[var(--focus)]"
            >
              {[2048, 4096, 8192, 16384].map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex items-center justify-between py-4 border-b border-[var(--border)] w-full">
          <div className="flex flex-col pr-6 flex-1">
            <label
              htmlFor="settings-model-keep-alive"
              className="text-sm font-medium text-[var(--text-primary)]"
            >
              {t("settings.keepModelInMemory")}
            </label>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              Keeping the model loaded uses VRAM but makes responses instant.
              Unloading frees VRAM for other apps.
            </p>
          </div>
          <div className="w-[200px] flex-shrink-0 flex items-center gap-3">
            <select
              id="settings-model-keep-alive"
              value={modelKeepAlive}
              onChange={(event) => setModelKeepAlive(event.target.value)}
              className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-md text-sm text-[var(--text-primary)] p-2 min-w-[200px] w-full outline-none focus:border-[var(--border-strong)] focus:ring-2 focus:ring-[var(--focus)]"
            >
              <option value="5m">5m (Default)</option>
              <option value="30m">30m</option>
              <option value="1h">1h</option>
              <option value="-1">Forever</option>
              <option value="0">Unload immediately</option>
            </select>
          </div>
        </div>
      </div>
    </section>
  );
}
