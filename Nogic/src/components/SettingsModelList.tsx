import { useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Pill } from "./Pill.tsx";
import { useTranslation } from "react-i18next";
import { recommendModels } from "@/modelRecommendations.ts";
import { MODEL_CATALOG, type ModelOption } from "@/modelCatalog.ts";
import type { HardwareInfo } from "@/types/hardware";

type CapabilityFilter = "all" | "vision" | "thinking" | "tools";

const CAPABILITY_FILTERS: ReadonlyArray<CapabilityFilter> = [
  "all",
  "tools",
  "thinking",
  "vision",
];

interface SettingsModelListProps {
  activeModel: string;
  recommendedModelName: string | null;
  error: string | null;
  hardwareInfo: HardwareInfo | null;
  installedModels: string[];
  isCancelling: boolean;
  onCancel: () => void;
  onPull: (model: ModelOption) => void;
  onDelete: (model: string) => void;
  onRefresh: () => void;
  onUse: (model: string) => void;
  isRefreshing: boolean;
  pullingModel: string | null;
  deletingModel: string | null;
  pullStatus: string;
  status: "checking" | "running" | "offline";
}

export function SettingsModelList({
  activeModel,
  recommendedModelName,
  error,
  hardwareInfo,
  installedModels,
  isCancelling,
  onCancel,
  onPull,
  onDelete,
  onRefresh,
  onUse,
  isRefreshing,
  pullingModel,
  deletingModel,
  pullStatus,
  status,
}: SettingsModelListProps) {
  const { t } = useTranslation();
  const recommendations = recommendModels(
    MODEL_CATALOG,
    hardwareInfo,
    installedModels,
  );
  const [capabilityFilter, setCapabilityFilter] =
    useState<CapabilityFilter>("all");
  const [showAll, setShowAll] = useState(false);
  const availableAlternatives = recommendations.filter(({ model }) => {
    if (model.name === recommendedModelName) return false;
    return (
      capabilityFilter === "all" ||
      model.capabilities.includes(capabilityFilter)
    );
  });
  const visibleRecommendations = showAll
    ? availableAlternatives
    : availableAlternatives.slice(0, 5);
  return (
    <section>
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-title font-semibold text-[var(--text-primary)]">
          {t("settings.availableModels")}
        </h4>
        <div className="flex items-center gap-2">
          <div
            role="group"
            aria-label={t("settings.filterByCapability")}
            className="flex flex-wrap items-center justify-end gap-1"
          >
            {CAPABILITY_FILTERS.map((filter) => (
              <button
                key={filter}
                type="button"
                aria-pressed={capabilityFilter === filter}
                onClick={() => {
                  setCapabilityFilter(filter);
                  setShowAll(false);
                }}
                className={`rounded-md px-2.5 py-1 text-meta transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus)] ${
                  capabilityFilter === filter
                    ? "bg-[var(--accent)] text-[var(--bg-elevated)]"
                    : "bg-[var(--bg-muted)] text-[var(--text-secondary)] hover:text-[var(--accent)]"
                }`}
              >
                {filter === "all"
                  ? t("settings.allCapabilities")
                  : t(`settings.${filter}`)}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-label={t("settings.refreshModels")}
            title={t("settings.refreshModels")}
            disabled={isRefreshing}
            onClick={onRefresh}
            className="rounded p-1 text-[var(--text-secondary)] transition-colors hover:text-[var(--accent)] disabled:text-[var(--text-tertiary)]"
          >
            <RefreshCw size={14} className={isRefreshing ? "animate-spin" : ""} />
          </button>
        </div>
      </div>
      <p className="mt-1 text-meta text-[var(--text-secondary)]">
        {t("settings.modelCount", { count: availableAlternatives.length })}
      </p>
      {error ? (
        <p role="alert" className="mt-2 text-meta text-[var(--text-secondary)]">
          {error}
        </p>
      ) : null}
      <ul className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
        {visibleRecommendations.map(({ model, fit, featured }) => {
          const isInstalled = installedModels.includes(model.name);
          const isPulling = pullingModel === model.name;
          const progressMatch = /(\d{1,3})%/.exec(pullStatus);
          const percent = progressMatch
            ? Math.min(Number(progressMatch[1]), 100)
            : null;
          const badge =
            fit === "recommended" && featured
              ? { label: t("settings.recommended"), variant: "accent" as const }
              : fit === "tight"
                ? { label: t("settings.tightFit"), variant: "warning" as const }
                : fit === "wont-fit"
                  ? { label: t("settings.wontFit"), variant: "danger" as const }
                  : null;
          return (
            <li
              key={model.name}
              className="flex h-full flex-col rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sec font-medium text-[var(--text-primary)]">
                    {model.name}
                  </span>
                  {badge ? (
                    <Pill variant={badge.variant}>{badge.label}</Pill>
                  ) : null}
                </div>
                <p className="mt-0.5 text-meta text-[var(--text-secondary)]">
                  {model.sizeLabel}
                  {activeModel === model.name ? ` · ${t("settings.active")}` : ""}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {model.capabilities.map((capability) => (
                    <span
                      key={capability}
                      className="rounded-full bg-[var(--accent-subtle)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--accent)]"
                    >
                      {capability}
                    </span>
                  ))}
                </div>
              </div>
              <div className="mt-auto flex items-center justify-end gap-1 pt-3">
                {isPulling ? (
                  <Button
                    variant="outline"
                    disabled={isCancelling}
                    onClick={onCancel}
                  >
                    {isCancelling ? t("settings.cancelling") : t("settings.cancel")}
                  </Button>
                ) : isInstalled ? (
                  <>
                    <Button
                      variant={activeModel === model.name ? "outline" : "accent"}
                      onClick={() => onUse(model.name)}
                    >
                      {t("settings.use")}
                    </Button>
                    <button
                      type="button"
                      aria-label={`Delete ${model.name}`}
                      title={`Delete ${model.name}`}
                      disabled={deletingModel !== null}
                      onClick={() => {
                        if (window.confirm("Are you sure you want to delete this model?")) {
                          onDelete(model.name);
                        }
                      }}
                      className="rounded-md p-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-muted)] hover:text-[var(--danger)] disabled:opacity-40"
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    disabled={status !== "running" || pullingModel !== null}
                    onClick={() => onPull(model)}
                  >
                    {t("settings.pull")}
                  </Button>
                )}
              </div>
              {isPulling ? (
                <div className="mt-2">
                  <div
                    role="progressbar"
                    aria-label={`Pulling ${model.name}`}
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
            </li>
          );
        })}
      </ul>
      {availableAlternatives.length > 5 ? (
        <button
          type="button"
          onClick={() => setShowAll((value) => !value)}
          className="mt-3 text-sec text-[var(--accent)] hover:underline"
        >
          {showAll
            ? t("settings.showLessModels")
            : t("settings.showAllModels", { count: availableAlternatives.length })}
        </button>
      ) : null}
    </section>
  );
}
