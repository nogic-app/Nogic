import { useEffect, useState } from "react";
import { useSettings } from "@/contexts/SettingsContext.tsx";
import { isRecord, requestSidecar } from "@/sidecarRequest.ts";
import { useTranslation } from "react-i18next";

const MODEL_NAME = "nomic-embed-text";
const CHECK_TIMEOUT_MS = 15_000;
const PULL_TIMEOUT_MS = 15 * 60 * 1_000;

type ModelStatus = "checking" | "installed" | "missing" | "downloading" | "error";

function isModelStatus(value: unknown): value is { installed: boolean } {
  return isRecord(value) && typeof value.installed === "boolean";
}

function isPullResult(value: unknown): value is { success: boolean } {
  return isRecord(value) && typeof value.success === "boolean";
}

function isSuccessfulAction(value: unknown): value is { success: true } {
  return isRecord(value) && value.success === true;
}

export function EmbeddingRequirement() {
  const { t } = useTranslation();
  const {
    semantic_auto_save,
    setSemanticAutoSave,
    settingsLoaded,
  } = useSettings();
  const [status, setStatus] = useState<ModelStatus>("checking");
  const [error, setError] = useState("");
  const [isRemoving, setIsRemoving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void requestSidecar(
      "check_embedding_model",
      {},
      isModelStatus,
      CHECK_TIMEOUT_MS,
    )
      .then((result) => {
        if (!cancelled) setStatus(result.installed ? "installed" : "missing");
      })
      .catch((checkError: unknown) => {
        console.error("Could not check the embeddings model.", checkError);
        if (!cancelled) {
          setStatus("error");
          setError(t("settings.requirementCheckFailed"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const downloadModel = async () => {
    setStatus("downloading");
    setError("");
    try {
      const result = await requestSidecar(
        "pull_model",
        { model_name: MODEL_NAME },
        isPullResult,
        PULL_TIMEOUT_MS,
        `embedding-pull:${crypto.randomUUID()}`,
      );
      if (!result.success) {
        throw new Error(`Ollama could not pull ${MODEL_NAME}.`);
      }
      const installed = await requestSidecar(
        "check_embedding_model",
        {},
        isModelStatus,
        CHECK_TIMEOUT_MS,
      );
      if (!installed.installed) {
        throw new Error(`${MODEL_NAME} was not found after the download.`);
      }
      setStatus("installed");
    } catch (downloadError) {
      console.error(`Could not download ${MODEL_NAME}.`, downloadError);
      setStatus("missing");
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : t("settings.tesseractDownloadFailed"),
      );
    }
  };

  const removeModel = async () => {
    setIsRemoving(true);
    setError("");
    try {
      await requestSidecar(
        "delete_model",
        { model_name: MODEL_NAME },
        isSuccessfulAction,
        CHECK_TIMEOUT_MS,
      );
      setStatus("missing");
    } catch (removeError) {
      console.error(`Could not remove ${MODEL_NAME}.`, removeError);
      setError(
        removeError instanceof Error
          ? removeError.message
          : t("settings.tesseractRemoveFailed"),
      );
    } finally {
      setIsRemoving(false);
    }
  };

  const isInstalled = status === "installed";
  return (
    <>
      <div className="flex items-center justify-between gap-4 border-b border-[var(--border)] py-3">
        <div className="min-w-0">
          <p className="text-sec text-[var(--text-primary)]">
            Embeddings Model ({MODEL_NAME})
          </p>
          <p className="mt-0.5 text-meta text-[var(--text-secondary)]">
            Used for semantic prompt auto-saving. Runs on CPU to save VRAM (~274MB).
          </p>
        </div>
        {isInstalled ? (
          <div className="flex shrink-0 items-center gap-3">
            <span className="rounded-full border border-[var(--border)] bg-[var(--bg-muted)] px-2.5 py-1 text-meta text-[var(--text-secondary)]">
              {t("settings.installed")}
            </span>
            <button
              type="button"
              onClick={() => void removeModel()}
              disabled={isRemoving}
              className="text-meta text-[var(--text-secondary)] underline-offset-2 hover:text-[var(--text-primary)] hover:underline disabled:cursor-wait disabled:opacity-60"
            >
              {isRemoving ? "Removing..." : t("settings.removeTesseract")}
            </button>
          </div>
        ) : status === "missing" ? (
          <button
            type="button"
            onClick={() => void downloadModel()}
            className="h-8 shrink-0 rounded-md bg-[var(--accent)] px-3 text-meta text-white transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            {t("settings.download")}
          </button>
        ) : (
          <span className="shrink-0 text-meta text-[var(--text-secondary)]">
            {status === "downloading"
              ? "Downloading..."
              : t(status === "checking" ? "settings.checking" : "settings.requirementUnavailable")}
          </span>
        )}
      </div>
      <label
        title={!isInstalled ? "Install the model first." : undefined}
        className="mt-3 flex w-fit items-center gap-2 py-1 text-meta text-[var(--text-secondary)]"
      >
        <input
          type="checkbox"
          checked={semantic_auto_save}
          onChange={(event) => setSemanticAutoSave(event.target.checked)}
          disabled={!isInstalled || !settingsLoaded}
          className="h-4 w-4 accent-[var(--accent)] disabled:cursor-not-allowed"
        />
        Semantic auto-save
      </label>
      {error && (
        <p role="alert" className="mt-2 text-meta text-[var(--danger)]">
          {error}
        </p>
      )}
    </>
  );
}
