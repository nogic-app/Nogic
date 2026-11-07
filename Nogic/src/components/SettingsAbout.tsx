import { useEffect, useState } from "react";
import { ArrowUpRight, CircleHelp } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { Button } from "./ui/button.tsx";
import { useTranslation } from "react-i18next";
import { resolveResource } from "@tauri-apps/api/path";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { collectDiagnostics } from "@/diagnostics.ts";
import { HelpModal } from "./HelpModal.tsx";
import { SettingsAboutUpdates } from "./SettingsAboutUpdates.tsx";

const ISSUES_URL = "https://github.com/nogic-app/nogic/issues";
const REPORT_URL_PREFIX = `${ISSUES_URL}/new?body=`;
const MAX_DIAGNOSTICS_CHARS = 4000;
const MAX_REPORT_URL_LENGTH = 8000;
interface AboutLink {
  key: string;
  /** Bundled documentation file, resolved from the app resources. */
  file?: string;
  /** External URL opened in the system browser. */
  url?: string;
}

const LINKS: AboutLink[] = [
  { key: "documentation", file: "docs/DOCUMENTATION.md" },
  { key: "licences", file: "docs/LICENSES.md" },
  { key: "releaseNotes", file: "docs/RELEASE_NOTES.md" },
  { key: "reportProblem", url: ISSUES_URL },
];

export function SettingsAbout({ onOpenChangelog }: { onOpenChangelog?: () => void }) {
  const { t } = useTranslation();
  const [appVersion, setAppVersion] = useState("1.2.0");
  const [helpOpen, setHelpOpen] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getVersion()
      .then((version) => {
        if (!cancelled) setAppVersion(version);
      })
      .catch((error: unknown) => {
        console.error("Could not read the Nogic app version.", error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const openAboutLink = async (link: AboutLink) => {
    setLinkError(null);
    setNotice(null);
    try {
      if (link.key === "reportProblem") {
        await reportProblem();
        return;
      }
      if (link.file) {
        await openPath(await resolveResource(link.file));
        return;
      }
      if (link.url) await openUrl(link.url);
    } catch (error) {
      console.error(`Could not open ${link.key}.`, error);
      setLinkError(t("settings.openFailed"));
    }
  };

  const reportProblem = async () => {
    try {
      const diagnostics = await collectDiagnostics();
      try {
        await writeText(diagnostics);
        setNotice(t("settings.diagnosticsCopied"));
      } catch (error) {
        console.warn("Could not copy diagnostics to the clipboard.", error);
      }

      let truncatedDiagnostics = "";
      let encodedLength = 0;
      let characterCount = 0;
      for (const character of diagnostics) {
        if (characterCount >= MAX_DIAGNOSTICS_CHARS) break;
        const characterLength = encodeURIComponent(character).length;
        if (
          REPORT_URL_PREFIX.length + encodedLength + characterLength >
          MAX_REPORT_URL_LENGTH
        ) {
          break;
        }
        truncatedDiagnostics += character;
        encodedLength += characterLength;
        characterCount += 1;
      }
      const reportUrl =
        `${REPORT_URL_PREFIX}${encodeURIComponent(truncatedDiagnostics)}`;
      await openUrl(reportUrl);
    } catch (err) {
      console.error("Diagnostics Error:", err);
      setNotice(null);
      setLinkError(t("settings.diagnosticsFailed"));
    }
  };

  return (
    <div className="max-w-2xl w-full flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <img
            src="/logo.png"
            alt=""
            aria-hidden="true"
            className="h-12 w-12 rounded-lg object-contain mix-blend-multiply"
          />
          <div>
            <p className="text-title font-medium text-[var(--text-primary)]">
              Nogic
            </p>
            <p className="text-meta text-[var(--text-secondary)]">
              <span>Version {appVersion}</span>
              <span aria-hidden="true"> · </span>
              <button type="button" onClick={onOpenChangelog} className="text-[var(--accent)] underline underline-offset-2">
                What's new?
              </button>
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => setHelpOpen(true)}
          className="inline-flex items-center gap-2"
        >
          <CircleHelp size={16} aria-hidden="true" />
          {t("settings.help")}
        </Button>
      </div>

      <p className="max-w-[52ch] text-sec text-[var(--text-secondary)]">
        {t("settings.aboutDescription")}
      </p>

      <SettingsAboutUpdates />

      <ul className="w-full divide-y divide-[var(--border)] border-y border-[var(--border)]">
        {LINKS.map((link) => (
          <li key={link.key} className="w-full">
            <button
              type="button"
              onClick={() => void openAboutLink(link)}
              className="group flex w-full items-center justify-between gap-4 py-2.5 text-start text-sec text-[var(--text-primary)] transition-colors duration-[120ms] hover:text-[var(--accent)]"
            >
              <span>{t(`settings.${link.key}`)}</span>
              <span className="flex items-center gap-1 text-meta text-[var(--text-tertiary)] transition-colors duration-[120ms] group-hover:text-[var(--accent)]">
                {t("settings.open")}
                <ArrowUpRight size={14} aria-hidden="true" />
              </span>
            </button>
          </li>
        ))}
      </ul>

      {linkError && (
        <p role="alert" className="text-meta text-[var(--text-secondary)]">
          {linkError}
        </p>
      )}
      {notice && (
        <p role="status" aria-live="polite" className="text-meta text-[var(--text-secondary)]">
          {notice}
        </p>
      )}

      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />

      <p className="text-meta text-[var(--text-tertiary)]">
        {t("settings.copyright")}
      </p>
    </div>
  );
}
