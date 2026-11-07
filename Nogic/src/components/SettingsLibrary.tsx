import { useEffect, useMemo, useState } from "react";
import { Search, Trash2 } from "lucide-react";
import { requestSidecar } from "@/sidecarRequest.ts";
import { useTranslation } from "react-i18next";

interface LawMetadata {
  name: string;
  country: string;
  article_count: number;
}

interface PlantMetadata {
  id: string;
  latin_name: string;
  common_name?: string | null;
  source_url: string;
  source_name?: string | null;
  verified: boolean;
}

type LibrarySection = "laws" | "plants";

function isLawMetadataList(value: unknown): value is LawMetadata[] {
  return Array.isArray(value) && value.every(
    (item) => typeof item === "object" && item !== null &&
      "name" in item && typeof item.name === "string" &&
      "country" in item && typeof item.country === "string" &&
      "article_count" in item && typeof item.article_count === "number",
  );
}

function isPlantMetadataList(value: unknown): value is PlantMetadata[] {
  return Array.isArray(value) && value.every(
    (item) => typeof item === "object" && item !== null &&
      "id" in item && typeof item.id === "string" &&
      "latin_name" in item && typeof item.latin_name === "string" &&
      (!("common_name" in item) || item.common_name === null || typeof item.common_name === "string") &&
      "source_url" in item && typeof item.source_url === "string" &&
      "verified" in item && typeof item.verified === "boolean" &&
      (!("source_name" in item) || item.source_name === null || typeof item.source_name === "string"),
  );
}

function isSuccess(value: unknown): value is { success: true } {
  return typeof value === "object" && value !== null &&
    "success" in value && value.success === true;
}

function sourceLabel(plant: PlantMetadata): string {
  if (plant.source_name?.trim()) return plant.source_name.trim();
  try {
    const host = new URL(plant.source_url).hostname.toLowerCase().replace(/^www\./, "");
    if (host.includes("kew.org")) return "Kew";
    if (host.includes("rhs.org.uk")) return "RHS";
    if (host.includes("ncsu.edu")) return "NC State Extension";
    return host;
  } catch {
    return plant.source_url;
  }
}

export function SettingsLibrary() {
  const { t } = useTranslation();
  const [section, setSection] = useState<LibrarySection>("laws");
  const [laws, setLaws] = useState<LawMetadata[]>([]);
  const [plants, setPlants] = useState<PlantMetadata[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const loadLibrary = async () => {
      const results = await Promise.allSettled([
        requestSidecar<LawMetadata[]>("get_library_laws", {}, isLawMetadataList),
        requestSidecar<PlantMetadata[]>("get_library_plants", {}, isPlantMetadataList),
      ]);
      if (!active) return;
      const errors: string[] = [];
      if (results[0].status === "fulfilled") setLaws(results[0].value);
      else errors.push(String(results[0].reason));
      if (results[1].status === "fulfilled") setPlants(results[1].value);
      else errors.push(String(results[1].reason));
      if (errors.length) {
        console.error("Could not load the library.", errors);
        setError(errors.join(" "));
      }
      setLoading(false);
    };
    void loadLibrary().catch((loadError: unknown) => {
      if (!active) return;
      console.error("Could not load the library.", loadError);
      setError(String(loadError));
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const visiblePlants = useMemo(() => plants.filter((plant) => {
    if (!plant.verified) return false;
    const query = search.trim().toLocaleLowerCase();
    return !query || `${plant.latin_name} ${plant.common_name} ${sourceLabel(plant)}`
      .toLocaleLowerCase().includes(query);
  }), [plants, search]);

  const removeLaw = async (law: LawMetadata) => {
    if (!window.confirm(t("settings.deleteLawConfirm", { name: law.name, country: law.country }))) return;
    const key = `${law.country}:${law.name}`;
    setBusyItem(key);
    setError(null);
    try {
      await requestSidecar("delete_library_law", { law_name: law.name, country: law.country }, isSuccess);
      setLaws((current) => current.filter((item) => item.name !== law.name || item.country !== law.country));
    } catch (deleteError) {
      console.error("Could not delete the law.", deleteError);
      setError(String(deleteError));
    } finally {
      setBusyItem(null);
    }
  };

  const removePlant = async (plant: PlantMetadata) => {
    if (!window.confirm(t("settings.deletePlantConfirm", { name: plant.latin_name }))) return;
    setBusyItem(plant.id);
    setError(null);
    try {
      await requestSidecar("delete_library_plant", { plant_id: plant.id }, isSuccess);
      setPlants((current) => current.filter((item) => item.id !== plant.id));
    } catch (deleteError) {
      console.error("Could not delete the plant.", deleteError);
      setError(String(deleteError));
    } finally {
      setBusyItem(null);
    }
  };

  const clearLaws = async () => {
    if (!window.confirm(t("settings.clearLawLibraryConfirm"))) return;
    setClearing(true);
    setError(null);
    try {
      await requestSidecar("clear_law_library", {}, isSuccess);
      setLaws([]);
    } catch (clearError) {
      console.error("Could not clear the law library.", clearError);
      setError(String(clearError));
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="w-full flex flex-col gap-5">
      <div role="tablist" aria-label={t("settings.library")} className="flex w-full gap-2 border-b border-[var(--border)]">
        {(["laws", "plants"] as const).map((item) => (
          <button key={item} type="button" role="tab" aria-selected={section === item}
            onClick={() => setSection(item)}
            className={`border-b-2 px-3 py-2 text-sm ${section === item ? "border-[var(--accent)] text-[var(--accent)]" : "border-transparent text-[var(--text-secondary)]"}`}>
            {t(`settings.${item}`)}
          </button>
        ))}
      </div>

      {error ? <p role="alert" className="text-meta text-[var(--danger)]">{t("settings.libraryError")} {error}</p> : null}
      {loading ? <p className="text-sec text-[var(--text-secondary)]">{t("settings.loadingLibrary")}</p> : null}

      {section === "laws" ? (
        <section className="w-full">
          <div className="grid w-full grid-cols-[minmax(0,1fr)_56px_100px_32px] gap-3 pb-2 text-meta text-[var(--text-secondary)]">
            <span>{t("settings.lawName")}</span>
            <span>{t("settings.country")}</span>
            <span>{t("settings.articleCountLabel")}</span>
            <span />
          </div>
          <ul className="w-full divide-y divide-[var(--border)] border-y border-[var(--border)]">
            {laws.map((law) => {
              const key = `${law.country}:${law.name}`;
              return (
                <li key={key} className="grid grid-cols-[minmax(0,1fr)_56px_100px_32px] items-center gap-3 py-3">
                  <p className="truncate text-sec font-medium text-[var(--text-primary)]">{law.name}</p>
                  <span className="text-meta text-[var(--text-secondary)]">{law.country}</span>
                  <span className="text-meta text-[var(--text-secondary)]">{law.article_count}</span>
                  <button type="button" aria-label={t("settings.deleteLibraryItem", { name: law.name })}
                    disabled={busyItem === key} onClick={() => void removeLaw(law)}
                    className="sidebar-icon-button rounded-md p-2 disabled:opacity-50">
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
          {!loading && laws.length === 0 ? <p className="py-4 text-sec text-[var(--text-secondary)]">{t("settings.noLaws")}</p> : null}
          <button type="button" disabled={clearing || loading || laws.length === 0} onClick={() => void clearLaws()}
            className="mt-4 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-sec text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50">
            {clearing ? t("settings.clearingLawLibrary") : t("settings.clearLawLibrary")}
          </button>
        </section>
      ) : (
        <section className="w-full">
          <label className="mb-3 flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2">
            <Search size={15} className="text-[var(--text-tertiary)]" aria-hidden="true" />
            <input value={search} onChange={(event) => setSearch(event.target.value)}
              placeholder={t("settings.searchPlants")} aria-label={t("settings.searchPlants")}
              className="w-full bg-transparent text-sec text-[var(--text-primary)] outline-none" />
          </label>
          <div className="grid w-full grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,.8fr)_32px] gap-3 pb-2 text-meta text-[var(--text-secondary)]">
            <span>{t("settings.latinName")}</span>
            <span>{t("settings.commonName")}</span>
            <span>{t("settings.source")}</span>
            <span />
          </div>
          <ul className="w-full divide-y divide-[var(--border)] border-y border-[var(--border)]">
            {visiblePlants.map((plant) => (
              <li key={plant.id} className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,.8fr)_32px] items-center gap-3 py-3">
                <p className="truncate font-mono text-sec text-[var(--text-primary)]">{plant.latin_name}</p>
                <span className="truncate text-meta text-[var(--text-secondary)]">{plant.common_name || "—"}</span>
                <span className="truncate text-meta text-[var(--text-secondary)]">{sourceLabel(plant)}</span>
                <button type="button" aria-label={t("settings.deleteLibraryItem", { name: plant.latin_name })}
                  disabled={busyItem === plant.id} onClick={() => void removePlant(plant)}
                  className="sidebar-icon-button rounded-md p-2 disabled:opacity-50">
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          {!loading && visiblePlants.length === 0 ? <p className="py-4 text-sec text-[var(--text-secondary)]">{t("settings.noPlants")}</p> : null}
        </section>
      )}
    </div>
  );
}
