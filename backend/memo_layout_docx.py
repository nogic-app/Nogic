"""python-docx renderer for chat exports and structured memo sections."""

from __future__ import annotations

from datetime import date
from typing import Any

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Mm, Pt, RGBColor
from memo_content import chat_message_items
from memo_docx_components import (
    add_bottom_border,
    add_conversation,
    add_files,
    align_for_text,
    docx_run,
    set_default_font,
)
from memo_docx_sections import add_memo_sections, add_sources
from memo_export_assets import app_icon_path
from memo_templates import MEMO_TEMPLATES, get_template_type, messages_for_template

INK = RGBColor(0x1F, 0x1F, 0x1D)
BODY = RGBColor(0x2B, 0x2B, 0x28)
SECONDARY = RGBColor(0x6B, 0x6B, 0x66)
ACCENT = RGBColor(0x4A, 0x6B, 0x4E)
RULE = "E5E3DD"
REPORT_TITLE = "Nogic Report"


def _add_header(
    document: Any,
    title: str,
    model_name: str,
    message_count: int,
    current_date: str,
    template_type: str,
) -> None:
    template = MEMO_TEMPLATES[template_type]
    header = document.add_table(rows=1, cols=2)
    header.alignment = WD_TABLE_ALIGNMENT.CENTER
    header.autofit = False
    header.columns[0].width = Inches(3.2)
    header.columns[1].width = Inches(3.2)
    left, right = header.rows[0].cells
    left.width = Inches(3.2)
    right.width = Inches(3.2)
    docx_run(left.paragraphs[0], "Nogic", 16, ACCENT, True)
    docx_run(right.paragraphs[0], "Chat export", 9.5, SECONDARY)
    right.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.RIGHT

    heading = document.add_paragraph()
    heading.paragraph_format.space_before = Pt(8)
    heading.paragraph_format.space_after = Pt(4)
    align_for_text(heading, REPORT_TITLE)
    docx_run(heading, REPORT_TITLE, template.title_size, INK, True)

    metadata = document.add_paragraph()
    metadata.paragraph_format.space_after = Pt(12)
    text = (
        f"Exported {current_date} · {message_count} messages · Model {model_name}"
    )
    align_for_text(metadata, text)
    docx_run(metadata, text, 9.5, SECONDARY)
    add_bottom_border(metadata, RULE)


def _append_field(paragraph: Any, field: str) -> None:
    begin_run = OxmlElement("w:r")
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    begin_run.append(begin)
    paragraph._p.append(begin_run)
    instruction_run = OxmlElement("w:r")
    instruction = OxmlElement("w:instrText")
    instruction.set(qn("xml:space"), "preserve")
    instruction.text = f" {field} "
    instruction_run.append(instruction)
    paragraph._p.append(instruction_run)
    end_run = OxmlElement("w:r")
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    end_run.append(end)
    paragraph._p.append(end_run)


def _add_footer(section: Any, current_date: str) -> None:
    paragraph = section.footer.paragraphs[0]
    paragraph.paragraph_format.tab_stops.add_tab_stop(
        int(section.page_width - section.left_margin - section.right_margin),
        WD_TAB_ALIGNMENT.RIGHT,
    )
    docx_run(paragraph, f"Exported from Nogic · {current_date}", 8, SECONDARY)
    docx_run(paragraph, "\t", 8, SECONDARY)
    docx_run(paragraph, "Page ", 8, SECONDARY)
    _append_field(paragraph, "PAGE")
    docx_run(paragraph, " of ", 8, SECONDARY)
    _append_field(paragraph, "NUMPAGES")


def _update_fields_on_open(document: Any) -> None:
    settings = document.settings.element
    update_fields = settings.find(qn("w:updateFields"))
    if update_fields is None:
        update_fields = OxmlElement("w:updateFields")
        settings.append(update_fields)
    update_fields.set(qn("w:val"), "true")


def render_docx(
    title: str,
    messages: list[dict[str, Any]],
    path: str,
    model_name: str,
    user_name: str = "",
    map_image_path: str | None = None,
    template_type: str = "default",
) -> None:
    """Render the chat and its memo references to a Word document."""
    template_type = get_template_type(template_type)
    template = MEMO_TEMPLATES[template_type]
    render_messages = messages_for_template(messages, template_type)
    current_date = date.today().strftime("%B %d, %Y").replace(" 0", " ")
    document = Document()
    set_default_font(document, template.body_size)
    document.core_properties.title = REPORT_TITLE
    _update_fields_on_open(document)
    for section in document.sections:
        section.page_width = Mm(210)
        section.page_height = Mm(297)
        section.left_margin = Mm(22)
        section.right_margin = Mm(22)
        section.top_margin = Mm(17)
        section.bottom_margin = Mm(20)
    _add_header(
        document,
        title,
        model_name,
        len(chat_message_items(render_messages)),
        current_date,
        template_type,
    )
    add_conversation(
        document,
        render_messages,
        BODY,
        user_name,
        app_icon_path(),
        template.body_size,
    )
    add_files(document, render_messages, ACCENT, BODY, template.body_size)
    add_memo_sections(document, render_messages, map_image_path, template_type)
    add_sources(document, render_messages, template_type)
    for section in document.sections:
        _add_footer(section, current_date)
    document.save(path)
