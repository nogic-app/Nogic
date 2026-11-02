import { useSettings } from "@/contexts/SettingsContext.tsx";

export function ModelBehaviorSettings() {
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
      <h3 className="text-sec font-medium text-[var(--text-primary)]">
        Model Behavior
      </h3>
      <div className="mt-2 divide-y divide-[var(--border)] border-y border-[var(--border)]">
        <div className="py-3">
          <div className="flex items-center justify-between gap-4">
            <label
              htmlFor="settings-temperature"
              className="text-sec font-medium text-[var(--text-primary)]"
            >
              Temperature
            </label>
            <output
              htmlFor="settings-temperature"
              className="font-mono text-sec text-[var(--text-secondary)]"
            >
              {temperature.toFixed(1)}
            </output>
          </div>
          <p className="mt-0.5 text-meta text-[var(--text-secondary)]">
            Lower is more factual, higher is more creative.
          </p>
          <input
            id="settings-temperature"
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={temperature}
            onChange={(event) => setTemperature(Number(event.target.value))}
            className="mt-3 w-full accent-[var(--accent)]"
          />
        </div>
        <div className="py-3">
          <label
            htmlFor="settings-context-window"
            className="text-sec font-medium text-[var(--text-primary)]"
          >
            Context Window
          </label>
          <p className="mt-0.5 text-meta text-[var(--text-secondary)]">
            Larger context remembers more of the chat, but uses more VRAM.
          </p>
          <select
            id="settings-context-window"
            value={contextWindow}
            onChange={(event) => setContextWindow(Number(event.target.value))}
            className="mt-2 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1.5 text-sec text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)] focus:ring-2 focus:ring-[var(--focus)]"
          >
            {[2048, 4096, 8192, 16384].map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <div className="py-3">
          <label
            htmlFor="settings-model-keep-alive"
            className="text-sec font-medium text-[var(--text-primary)]"
          >
            Keep model in memory
          </label>
          <p className="mt-0.5 text-meta text-[var(--text-secondary)]">
            Keeping the model loaded uses VRAM but makes responses instant.
            Unloading frees VRAM for other apps.
          </p>
          <select
            id="settings-model-keep-alive"
            value={modelKeepAlive}
            onChange={(event) => setModelKeepAlive(event.target.value)}
            className="mt-2 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1.5 text-sec text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)] focus:ring-2 focus:ring-[var(--focus)]"
          >
            <option value="5m">5m (Default)</option>
            <option value="30m">30m</option>
            <option value="1h">1h</option>
            <option value="-1">Forever</option>
            <option value="0">Unload immediately</option>
          </select>
        </div>
      </div>
    </section>
  );
}
