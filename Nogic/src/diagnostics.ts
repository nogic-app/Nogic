import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { requestSidecar } from "@/sidecarRequest.ts";
import type { HardwareInfo } from "@/types/hardware";

/**
 * Collect the same diagnostics the About page uses for "Report a problem".
 * Shared by Settings → About and the startup error screen so both report the
 * version, detected hardware, active model, and recent sidecar log lines.
 */
export async function collectDiagnostics(): Promise<string> {
  const [version, hardware] = await Promise.all([
    getVersion(),
    invoke<HardwareInfo>("get_hardware_info"),
  ]);

  const rawDiagnostics = await requestSidecar(
    "get_diagnostics",
    {
      app_version: version,
      hardware: {
        vram_gb: hardware.vram_gb,
        total_ram_gb: hardware.total_ram_gb,
      },
    },
    (value): value is string => typeof value === "string",
    15000,
  );

  const diagnostics: Record<string, string | string[]> = {};
  const logLines: string[] = [];
  let inLogSection = false;
  for (const line of rawDiagnostics.split("\n")) {
    if (line.startsWith("Sidecar log (last ")) {
      inLogSection = true;
      continue;
    }
    if (inLogSection) {
      logLines.push(line);
      continue;
    }
    const separator = line.indexOf(": ");
    if (separator > 0) {
      diagnostics[line.slice(0, separator).toLowerCase().replaceAll(" ", "_")] =
        line.slice(separator + 2);
    }
  }
  if (logLines.length > 0) diagnostics.sidecar_log = logLines;

  return [
    "## Diagnostic snapshot",
    "",
    "```json",
    JSON.stringify(diagnostics, null, 2),
    "```",
  ].join("\n");
}
