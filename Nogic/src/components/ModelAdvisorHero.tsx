import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import type { ModelOption } from "@/modelCatalog.ts";
import type { HardwareInfo } from "@/types/hardware";
import type { ErrorPayload } from "@/types/errors.ts";
import { ErrorSurface } from "@/components/ErrorSurface.tsx";
import { useTranslation } from "react-i18next";

interface ModelAdvisorHeroProps {
  hardwareInfo: HardwareInfo | null;
  hardwareLoading: boolean;
  hardwareError: ErrorPayload | null;
  onRefreshHardware: () => void;
  recommendedModel: ModelOption | null;
  activeModel: string;
  installedModels: string[];
  isRefreshing: boolean;
  onUse: (model: string) => void;
  onPull: (model: ModelOption) => void;
  onCancel: () => void;
  pullingModel: string | null;
  isCancelling: boolean;
  status: "checking" | "running" | "offline";
  pullStatus: string;
}

function formatGb(value: number | null | undefined): string {
  return value == null ? "—" : `${value.toFixed(1)} GB`;
}

function hasDetectedHardware(info: HardwareInfo | null): info is HardwareInfo {
  if (!info) return false;
  return Boolean(info.cpu_name.trim() || info.gpu_name) || (info.total_ram_gb ?? 0) > 0;
}

export function ModelAdvisorHero({
  hardwareInfo,
  hardwareLoading,
  hardwareError,
  onRefreshHardware,
  recommendedModel,
  activeModel,
  installedModels,
  isRefreshing,
  onUse,
  onPull,
  onCancel,
  pullingModel,
  isCancelling,
  status,
  pullStatus,
}: ModelAdvisorHeroProps) {
  const { t } = useTranslation();
  const hardwareDetected = hasDetectedHardware(hardwareInfo);
  const recommendedInstalled = recommendedModel
    ? installedModels.includes(recommendedModel.name)
    : false;
  const isPulling = recommendedModel?.name === pullingModel;
  const progressMatch = /(\d{1,3})%/.exec(pullStatus);
  const percent = progressMatch ? Math.min(Number(progressMatch[1]), 100) : null;

  return (
    <div className="space-y-2">
      <section className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg p-4 mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-title font-semibold text-[var(--text-primary)]">
          {t("settings.yourHardware")}
        </h3>
        <div className="flex min-w-0 items-center justify-between gap-4 sm:flex-1 sm:justify-end">
          <div className="flex min-w-0 flex-1 items-center justify-between gap-3 sm:flex-initial sm:justify-end sm:gap-6">
            <div className="min-w-0 flex-1 sm:flex-initial">
              <p className="text-meta text-[var(--text-secondary)]">
                {t("settings.gpu")}
              </p>
              <p className="mt-0.5 truncate font-mono text-sec text-[var(--text-primary)]">
                {hardwareLoading
                  ? t("settings.detectingHardware")
                  : hardwareDetected
                    ? hardwareInfo.gpu_name || t("settings.gpuNotDetected")
                    : t("settings.gpuNotDetected")}
              </p>
            </div>
            <div className="shrink-0">
              <p className="text-meta text-[var(--text-secondary)]">
                {t("settings.vram")}
              </p>
              <p className="mt-0.5 font-mono text-sec text-[var(--text-primary)]">
                {hardwareLoading ? "—" : formatGb(hardwareInfo?.vram_gb)}
              </p>
            </div>
            <div className="shrink-0">
              <p className="text-meta text-[var(--text-secondary)]">
                {t("settings.ram")}
              </p>
              <p className="mt-0.5 font-mono text-sec text-[var(--text-primary)]">
                {hardwareLoading ? "—" : formatGb(hardwareInfo?.total_ram_gb)}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label={t("settings.refresh")}
            title={t("settings.refresh")}
            disabled={hardwareLoading}
            onClick={onRefreshHardware}
            className="inline-flex h-8 shrink-0 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2.5 text-meta text-[var(--text-secondary)] transition-colors hover:text-[var(--accent)] disabled:text-[var(--text-tertiary)]"
          >
            <RefreshCw
              size={14}
              className={hardwareLoading ? "animate-spin" : ""}
              aria-hidden="true"
            />
            {t("settings.refresh")}
          </button>
        </div>
      </section>
      {hardwareInfo?.detection_warnings.length ? (
        <p className="text-meta italic text-[var(--text-secondary)]">
          {hardwareInfo.detection_warnings.join(" ")}
        </p>
      ) : null}

      {hardwareError ? (
        <div>
          <ErrorSurface payload={hardwareError} onRetry={onRefreshHardware} />
        </div>
      ) : null}

      <section className="border-b border-[var(--border)] py-4">
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <div className="min-w-0">
            <h3 className="text-title font-semibold text-[var(--text-primary)]">
              {t("settings.recommendedForYou")}
            </h3>
            {hardwareLoading ? (
              <p className="mt-0.5 text-sec text-[var(--text-secondary)]">
                {t("settings.detectingHardware")}
              </p>
            ) : recommendedModel ? (
              <>
                <p className="mt-0.5 font-mono text-sm font-medium text-[var(--text-primary)]">
                  {recommendedModel.name}
                </p>
                <p className="mt-0.5 text-meta text-[var(--text-secondary)]">
                  {recommendedModel.sizeLabel}
                  {activeModel === recommendedModel.name
                    ? ` · ${t("settings.active")}`
                    : ""}
                </p>
                <p className="mt-0.5 text-sec text-[var(--text-secondary)]">
                  {hardwareInfo?.vram_gb
                    ? t("settings.recommendedFitsGpu", {
                        vram: hardwareInfo.vram_gb.toFixed(1),
                      })
                    : t("settings.recommendedCpuOnly")}
                </p>
              </>
            ) : (
              <p className="mt-0.5 text-sec text-[var(--text-secondary)]">
                {t("settings.hardwareNotDetected")}
              </p>
            )}
          </div>
          {recommendedModel && !hardwareLoading ? (
            isPulling ? (
              <Button
                variant="outline"
                disabled={isCancelling}
                onClick={onCancel}
              >
                {isCancelling ? t("settings.cancelling") : t("settings.cancel")}
              </Button>
            ) : recommendedInstalled ? (
              <Button
                variant={activeModel === recommendedModel.name ? "outline" : "accent"}
                onClick={() => onUse(recommendedModel.name)}
              >
                {t("settings.use")}
              </Button>
            ) : (
              <Button
                variant="accent"
                disabled={status !== "running" || pullingModel !== null || isRefreshing}
                onClick={() => onPull(recommendedModel)}
              >
                {t("settings.pull")}
              </Button>
            )
          ) : null}
        </div>
        {recommendedModel && isPulling ? (
          <div className="mt-3">
            <div
              role="progressbar"
              aria-label={`Pulling ${recommendedModel.name}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent ?? undefined}
              className="h-1 overflow-hidden rounded-full bg-[var(--accent-subtle)]"
            >
              <div
                className={`h-full rounded-full bg-[var(--accent)] ${
                  percent === null ? "w-1/3 animate-pulse" : ""
                }`}
                style={percent === null ? undefined : { width: `${percent}%` }}
              />
            </div>
            <p className="mt-1 text-meta text-[var(--text-secondary)]">
              {t("settings.pulling")} · {pullStatus}
            </p>
          </div>
        ) : null}
      </section>
    </div>
  );
}
