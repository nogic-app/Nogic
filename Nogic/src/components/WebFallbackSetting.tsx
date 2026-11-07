import { useTranslation } from "react-i18next";
import { useSettings } from "@/contexts/SettingsContext.tsx";

export function WebFallbackSetting() {
  const { t } = useTranslation();
  const {
    web_fallback_enabled,
    setWebFallbackEnabled,
    settingsLoaded,
  } = useSettings();

  return (
    <label className="mt-4 flex max-w-xl items-start gap-2">
      <input
        type="checkbox"
        checked={web_fallback_enabled}
        onChange={(event) => setWebFallbackEnabled(event.target.checked)}
        disabled={!settingsLoaded}
        className="mt-0.5 h-4 w-4 accent-[var(--accent)] disabled:cursor-not-allowed"
      />
      <span>
        <span className="block text-sec text-[var(--text-primary)]">
          {t("settings.webFallback")}
        </span>
        <span className="mt-0.5 block text-meta text-[var(--text-secondary)]">
          {t("settings.webFallbackDescription")}
        </span>
      </span>
    </label>
  );
}
