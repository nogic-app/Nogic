"""Template-aware Word sections for structured memo exports."""

from __future__ import annotations

from typing import Any

from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor
from memo_content import (
    EMPTY_SECTION,
    legal_constraint_items,
    memo_sections,
    plant_table_items,
    site_context,
    source_items,
    split_site_notes,
)
from memo_docx_components import align_for_text, docx_run, shade_cell
from memo_templates import MEMO_TEMPLATES

INK = RGBColor(0x1F, 0x1F, 0x1D)
BODY = RGBColor(0x2B, 0x2B, 0x28)
SECONDARY = RGBColor(0x6B, 0x6B, 0x66)
ACCENT = RGBColor(0x4A, 0x6B, 0x4E)


def _add_plant_table(
    document: Any, messages: list[dict[str, Any]], body_size: float
) -> None:
    plants = plant_table_items(messages)
    if not plants:
        docx_run(document.add_paragraph(), EMPTY_SECTION)
        return
    table = document.add_table(rows=1, cols=5)
    table.style = "Table Grid"
    for cell, label in zip(
        table.rows[0].cells,
        ("Latin name", "Common name", "Water", "Sun", "Source"),
    ):
        shade_cell(cell, "E8EDE7")
        cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        docx_run(cell.paragraphs[0], label, max(7, body_size - 1.5), ACCENT, True)
    for row in plants:
        for cell, value in zip(table.add_row().cells, row):
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.TOP
            align_for_text(cell.paragraphs[0], value)
            docx_run(cell.paragraphs[0], value, max(7, body_size - 1.5), BODY)


def add_sources(
    document: Any, messages: list[dict[str, Any]], template_type: str
) -> None:
    template = MEMO_TEMPLATES[template_type]
    citation_size = (
        template.body_size + 1
        if template_type == "default"
        else template.citation_size
    )
    sources = source_items(messages)
    if not sources:
        return
    document.add_page_break()
    heading = document.add_paragraph()
    heading.paragraph_format.space_after = Pt(4)
    docx_run(heading, "Sources", 24, INK, True)
    subtitle = document.add_paragraph()
    subtitle.paragraph_format.space_after = Pt(12)
    docx_run(
        subtitle,
        "Every source cited in this chat, in order of first use.",
        9.5,
        SECONDARY,
    )
    for index, (label, details) in enumerate(sources, start=1):
        paragraph = document.add_paragraph()
        paragraph.paragraph_format.space_after = Pt(2)
        align_for_text(paragraph, label)
        docx_run(paragraph, f"[{index}] {label}", citation_size, INK, True)
        detail = details[0] if details else "Source details unavailable."
        paragraph = document.add_paragraph()
        paragraph.paragraph_format.left_indent = Pt(18)
        paragraph.paragraph_format.space_after = Pt(12)
        align_for_text(paragraph, detail)
        docx_run(paragraph, detail, template.body_size, BODY)


def add_memo_sections(
    document: Any,
    messages: list[dict[str, Any]],
    site_map_path: str | None,
    template_type: str,
) -> None:
    template = MEMO_TEMPLATES[template_type]
    section_items = dict(memo_sections(messages))
    for heading_text in template.section_order:
        items = section_items.get(heading_text)
        if items is None:
            continue
        if heading_text != "Site Context" or template_type != "default":
            heading = document.add_paragraph()
            heading.paragraph_format.space_before = Pt(16)
            docx_run(heading, heading_text, template.section_size, ACCENT, True)
        if heading_text == "Plant Palette":
            _add_plant_table(document, messages, template.body_size)
        elif heading_text == "Legal Constraints":
            citations = legal_constraint_items(messages)
            if not citations:
                docx_run(document.add_paragraph(), EMPTY_SECTION)
                continue
            citation_size = (
                template.body_size + 1
                if template_type == "default"
                else template.citation_size
            )
            for index, (citation, jurisdiction) in enumerate(citations, start=1):
                paragraph = document.add_paragraph()
                paragraph.paragraph_format.space_after = Pt(4)
                docx_run(
                    paragraph,
                    (
                        f"[ ] {index}. {citation} — {jurisdiction}"
                        if template.checklist
                        else citation
                    ),
                    citation_size,
                    ACCENT if template_type == "legal_reference" else BODY,
                    not template.checklist,
                )
        elif heading_text == "Site Context" and items:
            site = site_context(messages)
            if not site:
                continue
            lead = document.add_paragraph()
            docx_run(
                lead,
                f"Site Memo: {site['name']}",
                template.body_size + 1,
                INK,
                True,
            )
            if site_map_path:
                document.add_picture(site_map_path, width=Inches(4))
            if site["coords"]:
                coordinates = document.add_paragraph()
                docx_run(
                    coordinates,
                    f"Coordinates: {site['coords']}",
                    template.body_size,
                    BODY,
                )
                lat, lon = site["coords"].split(", ", 1)
                link = (
                    "https://www.openstreetmap.org/"
                    f"?mlat={lat}&mlon={lon}#map=13/{lat}/{lon}"
                )
                link_paragraph = document.add_paragraph()
                hyperlink = OxmlElement("w:hyperlink")
                hyperlink.set(
                    qn("r:id"),
                    document.part.relate_to(
                        link,
                        "http://schemas.openxmlformats.org/"
                        "officeDocument/2006/relationships/hyperlink",
                        is_external=True,
                    ),
                )
                run = OxmlElement("w:r")
                text = OxmlElement("w:t")
                text.text = "Open in OpenStreetMap"
                run.append(text)
                hyperlink.append(run)
                link_paragraph._p.append(hyperlink)
            for label, value in site["notes"].items():
                for index, note in enumerate(split_site_notes(value)):
                    bullet = document.add_paragraph(style="List Bullet")
                    bullet.alignment = WD_ALIGN_PARAGRAPH.LEFT
                    prefix = f"{label}: " if index == 0 else ""
                    docx_run(bullet, f"{prefix}{note}", template.body_size, BODY)
            attribution = document.add_paragraph()
            run = attribution.add_run("Map data © OpenStreetMap contributors")
            run.italic = True
            run.font.size = Pt(8)
            run.font.color.rgb = SECONDARY
        elif not items:
            docx_run(document.add_paragraph(), EMPTY_SECTION)
        else:
            for lines in items:
                lead = document.add_paragraph()
                lead.paragraph_format.space_after = Pt(1)
                docx_run(lead, lines[0], template.body_size + 1, INK, True)
                for line in lines[1:]:
                    detail = document.add_paragraph()
                    detail.paragraph_format.left_indent = Pt(18)
                    docx_run(detail, line, template.body_size, BODY)
