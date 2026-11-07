"""Shared definitions for PDF and Word memo layouts."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class MemoTemplate:
    label: str
    title_size: float
    body_size: float
    section_size: float
    citation_size: float
    section_order: tuple[str, ...]
    include_plants: bool
    include_law: bool
    include_site: bool
    checklist: bool = False
    prompt_instruction: str = ""


MEMO_TEMPLATES: dict[str, MemoTemplate] = {
    "default": MemoTemplate(
        "Default Memo", 25, 9.5, 12, 9.5,
        ("Legal Constraints", "Plant Palette", "Site Context"),
        True, True, True,
    ),
    "client_summary": MemoTemplate(
        "Client Summary", 21, 10.5, 11, 9.5,
        ("Recommendations", "Site Context", "Plant Palette"),
        True, False, True,
        prompt_instruction=(
            "Write in plain language for a client. Avoid legal jargon and focus "
            "on clear recommendations, using site and plant details when present."
        ),
    ),
    "legal_reference": MemoTemplate(
        "Legal Reference", 24, 10, 14, 12.5,
        ("Legal Constraints",),
        False, True, False,
        prompt_instruction=(
            "Focus on laws, articles, and prominent citations found in the "
            "conversation. Do not include plant or site sections, and do not "
            "invent legal authorities or citations."
        ),
    ),
    "checklist": MemoTemplate(
        "Checklist", 22, 10, 12, 10.5,
        ("Checklist", "Legal Constraints", "Site Context"),
        False, True, True,
        checklist=True,
        prompt_instruction=(
            "Do not invent filing requirements."
        ),
    ),
}

_INTENTS = (
    ("checklist", re.compile(
        r"\bchecklist\b|\bsteps?\b|what\s+do\s+i\s+need\s+to\s+file",
        re.IGNORECASE,
    )),
    ("client_summary", re.compile(r"\bclient\b", re.IGNORECASE)),
    ("legal_reference", re.compile(r"\b(?:legal|laws?|articles?)\b", re.IGNORECASE)),
)


def get_template_type(template_type: str | None = None) -> str:
    """Validate a template key; omitted keys retain the legacy default."""
    selected = "default" if template_type is None else template_type
    if not isinstance(selected, str):
        raise TypeError("The memo template must be a string.")
    if selected not in MEMO_TEMPLATES:
        raise ValueError(f"Unknown memo template: {selected}")
    return selected


def resolve_template_type(prompt: str, explicit: str | None = None) -> str:
    """Use an explicit selection when present, otherwise infer from the prompt."""
    if explicit is not None:
        return get_template_type(explicit)
    for template_type, pattern in _INTENTS:
        if pattern.search(prompt):
            return template_type
    return "default"


def format_template_markdown(markdown: str, template_type: str) -> str:
    """Normalize generated checklist content while preserving its sections."""
    if not MEMO_TEMPLATES[template_type].checklist:
        return markdown
    lines = markdown.splitlines()
    first_content = next(
        (index for index, line in enumerate(lines) if line.strip()),
        None,
    )
    formatted: list[str] = []
    seen_items: set[str] = set()
    current_section = ""
    section_headings = {
        "summary",
        "checklist",
        "legal constraints",
        "site context",
    }
    for index, line in enumerate(lines):
        if not line.strip():
            formatted.append(line)
            continue
        if line.lstrip().startswith("#"):
            heading = re.sub(r"^\s*#+\s*", "", line).strip().rstrip(":")
            if heading.casefold() in section_headings:
                current_section = heading.casefold()
            formatted.append(line)
            continue
        heading = re.sub(
            r"^\s*(?:\[\s*\d+[.)]\s*\]?\s*|\d+[.)]\s*)",
            "",
            line,
        ).strip().strip("*_# \t:").rstrip(":")
        if heading.casefold() in section_headings:
            current_section = heading.casefold()
            formatted.append(f"## {heading}")
            continue
        if re.match(r"^\s*\*\*[^*\n].*(?:\*\*)?\s*$", line):
            heading = line.strip().strip("*_# \t:").rstrip(":")
            if heading.casefold() in section_headings:
                current_section = heading.casefold()
            formatted.append(line)
            continue
        if current_section in {"summary", "legal constraints", "site context"}:
            formatted.append(line)
            continue
        is_list_item = re.match(
            r"^\s*(?:[-*+]\s*|\[?\d+[.)]\s*|\[\s*[xX]?\s*\]\s*)",
            line,
        )
        next_nonempty = next(
            (item for item in lines[index + 1 :] if item.strip()),
            "",
        )
        if (
            not is_list_item
            and (
                index == first_content and re.match(r"^\s*[-*+\d]", next_nonempty)
                or line.rstrip().endswith(":")
            )
        ):
            formatted.append(line)
            continue
        is_checked = bool(
            re.match(r"^\s*(?:[-*+]\s*)?\[\s*[xX]\s*\]", line)
        )
        item = re.sub(
            r"^\s*(?:(?:[-*+]\s*)|(?:\[\s*\d+[.)]\s*\]?\s*)|(?:\d+[.)]\s*)|(?:\[\s*[xX]?\s*\]\s*))+",
            "",
            line,
        )
        item = re.sub(
            r"^\s*(?:\[\s*(?:\[\s*)?[xX]?\s*\]\s*\]?\s*)+",
            "",
            item,
        )
        normalized_item = " ".join(item.split()).casefold()
        if not normalized_item or normalized_item in seen_items:
            continue
        seen_items.add(normalized_item)
        formatted.append(f"- [{'x' if is_checked else ' '}] {item}")
    return "\n".join(formatted)


def messages_for_template(
    messages: list[dict[str, Any]], template_type: str
) -> list[dict[str, Any]]:
    """Remove structured memo data that a selected layout must not expose."""
    template = MEMO_TEMPLATES[get_template_type(template_type)]
    if template.include_plants and template.include_law and template.include_site:
        return messages
    filtered: list[dict[str, Any]] = []
    for message in messages:
        item = dict(message)
        if not template.include_plants:
            item["plant_data"] = []
        if not template.include_law:
            item["sources"] = []
        if not template.include_site:
            item["site_data"] = None
        filtered.append(item)
    return filtered
