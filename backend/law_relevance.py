"""Relevance checks for law retrieval before showing local citations."""

import re
import unicodedata
from typing import Any

# FTS5 BM25 scores are negative; values closer to zero are weaker matches.
MIN_BM25_SCORE = -4.0

JURISDICTION_CODES = {
    "morocco": "MA",
    "moroccan": "MA",
    "japan": "JP",
    "france": "FR",
    "united states": "US",
    "usa": "US",
    "america": "US",
    "united kingdom": "GB",
    "spain": "ES",
    "germany": "DE",
    "canada": "CA",
    "italy": "IT",
    "china": "CN",
    "india": "IN",
    "australia": "AU",
    "south korea": "KR",
    "korea": "KR",
    "netherlands": "NL",
    "belgium": "BE",
    "turkey": "TR",
    "egypt": "EG",
    "south africa": "ZA",
    "brazil": "BR",
    "mexico": "MX",
    "argentina": "AR",
    "nigeria": "NG",
    "new zealand": "NZ",
    "russia": "RU",
    "indonesia": "ID",
    "pakistan": "PK",
    "philippines": "PH",
    "sweden": "SE",
    "norway": "NO",
    "denmark": "DK",
    "switzerland": "CH",
    "greece": "GR",
    "ireland": "IE",
    "poland": "PL",
    "austria": "AT",
    "thailand": "TH",
    "vietnam": "VN",
    "singapore": "SG",
    "taiwan": "TW",
    "united arab emirates": "AE",
    "uae": "AE",
}

CITY_CODES = {
    "tokyo": "JP",
    "rabat": "MA",
    "casablanca": "MA",
    "marrakech": "MA",
    "marrakesh": "MA",
    "fes": "MA",
    "fez": "MA",
    "tangier": "MA",
    "tanger": "MA",
    "meknes": "MA",
    "agadir": "MA",
    "oujda": "MA",
    "chefchaouen": "MA",
    "tetouan": "MA",
    "kenitra": "MA",
    "el jadida": "MA",
    "essaouira": "MA",
    "nador": "MA",
    "safi": "MA",
    "taza": "MA",
    "paris": "FR",
    "london": "GB",
    "new york": "US",
    "washington": "US",
    "berlin": "DE",
    "madrid": "ES",
    "rome": "IT",
    "beijing": "CN",
    "delhi": "IN",
    "sydney": "AU",
    "toronto": "CA",
    "seoul": "KR",
    "amsterdam": "NL",
    "brussels": "BE",
    "istanbul": "TR",
    "cairo": "EG",
    "sao paulo": "BR",
    "mexico city": "MX",
    "buenos aires": "AR",
    "lagos": "NG",
    "auckland": "NZ",
    "moscow": "RU",
    "jakarta": "ID",
    "karachi": "PK",
    "manila": "PH",
    "stockholm": "SE",
    "oslo": "NO",
    "copenhagen": "DK",
    "zurich": "CH",
    "athens": "GR",
    "dublin": "IE",
    "warsaw": "PL",
    "vienna": "AT",
    "bangkok": "TH",
    "hanoi": "VN",
    "singapore": "SG",
    "taipei": "TW",
    "dubai": "AE",
}

_LOCATION_WORDS = frozenset({
    "agricultural", "area", "areas", "building", "city", "coastal",
    "commercial", "construction", "country", "district", "environment",
    "industrial", "law", "laws", "legislation", "local", "metropolitan",
    "municipal", "national", "permit", "permits", "planning", "protected",
    "region", "regional", "regulation", "regulations", "residential",
    "rural", "setback", "setbacks", "site", "urban", "zone", "zones",
    "zoning",
})


def _normalize(value: str) -> str:
    decomposed = unicodedata.normalize("NFD", value.casefold())
    without_accents = "".join(
        character
        for character in decomposed
        if unicodedata.category(character) != "Mn"
    )
    return " ".join(re.sub(r"[^a-z0-9]+", " ", without_accents).split())


def _explicit_jurisdiction(question: str) -> str | None:
    normalized = _normalize(question)
    aliases = {**JURISDICTION_CODES, **CITY_CODES}
    for alias in sorted(aliases, key=len, reverse=True):
        if re.search(rf"\b{re.escape(alias)}\b", normalized):
            return alias

    match = re.search(
        r"\b(?:in|within|near|around)\s+(?:the\s+city\s+of\s+)?"
        r"([a-z][a-z -]{1,40})",
        question,
        re.IGNORECASE,
    )
    if not match:
        return None

    candidate = _normalize(match.group(1))
    words = [word for word in candidate.split() if word not in _LOCATION_WORDS]
    if not words:
        return None
    candidate = " ".join(words[:3])
    return candidate or None


def is_law_retrieval_relevant(
    question: str,
    results: list[dict[str, Any]],
) -> bool:
    """Reject law matches for a different jurisdiction or weak BM25 evidence."""
    if not results:
        return False

    countries = {
        str(result.get("country") or "").strip().upper()
        for result in results
        if result.get("country")
    }
    jurisdiction = _explicit_jurisdiction(question)
    if jurisdiction:
        normalized_jurisdiction = _normalize(jurisdiction)
        expected_country = (
            JURISDICTION_CODES.get(normalized_jurisdiction)
            or CITY_CODES.get(normalized_jurisdiction)
        )
        if expected_country and countries and expected_country not in countries:
            return False
        if (
            expected_country
            and expected_country in countries
            and expected_country != "MA"
            and normalized_jurisdiction in CITY_CODES
            and not re.search(
                rf"\b{re.escape(normalized_jurisdiction)}\b",
                _normalize(str(results[0].get("content") or "")),
            )
        ):
            return False
        if not expected_country:
            corpus_text = " ".join(
                _normalize(
                    " ".join(
                        str(result.get(field) or "")
                        for field in ("law_name", "content")
                    )
                )
                for result in results
            )
            if normalized_jurisdiction not in corpus_text:
                return False

    score = results[0].get("bm25_score")
    return not (
        isinstance(score, (int, float)) and score > MIN_BM25_SCORE
    )
