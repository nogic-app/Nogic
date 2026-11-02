export interface AppUsage {
  model_vram: string | null;
  model_vram_gb: number | null;
  model_name: string | null;
}

export function isAppUsage(value: unknown): value is AppUsage {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    (record.model_vram === null || typeof record.model_vram === "string") &&
    (record.model_vram_gb === null ||
      (typeof record.model_vram_gb === "number" &&
        Number.isFinite(record.model_vram_gb) &&
        record.model_vram_gb >= 0)) &&
    (record.model_name === null || typeof record.model_name === "string")
  );
}
