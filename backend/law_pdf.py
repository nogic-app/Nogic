import re

from law_ingest import law_filename_from_name, normalize_country_code
from runtime_paths import DATA_DIR


def _legacy_identifier(law_name: str) -> str:
    identifier = re.sub(r"^loi ", "", law_name, count=1, flags=re.IGNORECASE)
    sanitized: list[str] = []
    previous_was_separator = False
    for character in identifier:
        if character.isalnum() or character in ".-":
            sanitized.append(character)
            previous_was_separator = False
        elif not previous_was_separator:
            sanitized.append("_")
            previous_was_separator = True
    return "".join(sanitized).strip("_.-")


def get_law_pdf_path(law_name: str, country: str | None = None) -> str:
    if not isinstance(law_name, str) or not law_name.strip():
        raise ValueError("A law name is required.")
    country_code = normalize_country_code(country)
    name = law_name.strip()
    canonical = law_filename_from_name(name, country_code)
    legacy_identifier = _legacy_identifier(name)
    candidates = [
        canonical,
        f"Law_{legacy_identifier}.pdf",
        f"Law_{legacy_identifier}_fr.pdf",
        f"Law_{legacy_identifier}_ar.pdf",
    ]
    laws_directory = (DATA_DIR / "laws").resolve()
    for filename in candidates:
        candidate = (laws_directory / filename).resolve()
        if candidate.parent == laws_directory and candidate.is_file():
            return str(candidate)
    raise FileNotFoundError(f"Law PDF does not exist for: {law_name}")
