"""Generate user-requested documents from a chat prompt."""

from __future__ import annotations

import logging
import os
import re
from datetime import date
from typing import Any
from xml.sax.saxutils import escape

import ollama
from db import get_settings
from docx import Document
from docx.shared import Pt
from export_paths import FORMAT_LABELS, export_path
from markdown_clean import clean_markdown, markdown_runs
from memo_pdf_components import CheckboxParagraph
from memo_templates import (
    MEMO_TEMPLATES,
    resolve_template_type,
)
from memo_templates import (
    format_template_markdown as _format_template_markdown,
)
from openpyxl import Workbook
from openpyxl.styles import Font
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

logger = logging.getLogger(__name__)

REPORT_TITLE = "Nogic Report"
MEMORY_ERROR = (
    "The model ran out of memory generating the report. "
    "Try asking for a shorter report."
)


def _response_text(response: Any) -> str:
    message = (
        response.get("message")
        if hasattr(response, "get")
        else getattr(response, "message", None)
    )
    content = (
        message.get("content")
        if hasattr(message, "get")
        else getattr(message, "content", None)
    )
    return content if isinstance(content, str) else ""


SKILL_FORMATS = {
    "pdf": "PDF",
    "word": "Word",
    "excel": "Excel",
}
REPORT_PROMPT = (
    "Generate a professional report based on this request: {user_prompt}. "
    "Use the provided conversation history for context. "
    "Write a concise summary (max 500 words)."
)
def _output_path(fmt: str, title: str) -> str:
    normalized_format = fmt
    suffix = (
        "docx" if normalized_format == "word" else "xlsx" if fmt == "excel" else fmt
    )
    directory = os.path.join(os.path.expanduser("~"), "Documents", "Nogic Exports")
    return export_path(FORMAT_LABELS[normalized_format], title, suffix, directory)


def _render_pdf(
    markdown: str,
    path: str,
    template_type: str,
    user_name: str = "",
    current_date: str = "",
) -> None:
    template = MEMO_TEMPLATES[template_type]
    styles = getSampleStyleSheet()
    body = ParagraphStyle(
        "SkillBody",
        parent=styles["BodyText"],
        fontSize=10.5 if template_type == "default" else template.body_size,
        leading=15 if template_type == "default" else template.body_size * 1.4,
        textColor=colors.HexColor("#2B2B28"),
        spaceAfter=8,
    )
    heading = ParagraphStyle(
        "SkillHeading",
        parent=body,
        fontName="Helvetica-Bold",
        fontSize=14 if template_type == "default" else template.section_size,
        leading=18 if template_type == "default" else template.section_size * 1.3,
        textColor=colors.HexColor("#1F1F1D"),
        spaceBefore=8,
    )
    title_style = styles["Title"]
    if template_type != "default":
        title_style.fontSize = template.title_size
        title_style.leading = template.title_size + 5
    metadata = ParagraphStyle(
        "SkillMetadata",
        parent=styles["BodyText"],
        fontSize=9,
        textColor=colors.HexColor("#6B6B66"),
        spaceAfter=4,
    )
    story: list[Any] = [Paragraph(REPORT_TITLE, title_style)]
    if user_name:
        story.append(Paragraph(f"Prepared by: {escape(user_name)}", metadata))
    if current_date:
        story.append(Paragraph(f"Date: {escape(current_date)}", metadata))
    if user_name or current_date:
        story.append(Spacer(1, 8))
    for line in clean_markdown(_format_template_markdown(
        markdown, template_type
    )).split("<br/>"):
        if not line.strip():
            story.append(Spacer(1, 5))
        elif line.startswith("<b>") and line.endswith("</b>"):
            story.append(Paragraph(line, heading))
        elif line.startswith(("\u2610 ", "\u2611 ")):
            story.append(
                CheckboxParagraph(
                    line[2:],
                    body,
                    checked=line.startswith("\u2611 "),
                )
            )
        else:
            story.append(Paragraph(line, body))
    document = SimpleDocTemplate(
        path,
        pagesize=A4,
        leftMargin=22 * mm,
        rightMargin=22 * mm,
        topMargin=20 * mm,
        bottomMargin=20 * mm,
        title=REPORT_TITLE,
    )
    document.build(story)


def _render_word(
    markdown: str,
    path: str,
    template_type: str,
    user_name: str = "",
    current_date: str = "",
) -> None:
    template = MEMO_TEMPLATES[template_type]
    document = Document()
    document.core_properties.title = REPORT_TITLE
    title = document.add_heading(REPORT_TITLE, level=0)
    if template_type != "default":
        title.runs[0].font.size = Pt(template.title_size)
        document.styles["Normal"].font.size = Pt(template.body_size)
        document.styles["Heading 1"].font.size = Pt(template.section_size)
    if user_name:
        document.add_paragraph(f"Prepared by: {user_name}")
    if current_date:
        document.add_paragraph(f"Date: {current_date}")
    paragraph = document.add_paragraph()
    for text, bold, italic in markdown_runs(
        _format_template_markdown(markdown, template_type)
    ):
        if text == "\n":
            paragraph.add_run().add_break()
            continue
        run = paragraph.add_run(text)
        run.bold = bold
        run.italic = italic
    document.save(path)


def _render_excel(markdown: str, path: str) -> None:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Report"
    sheet.append(["Nogic Report"])
    sheet["A1"].font = Font(bold=True, size=14)
    for line in markdown.replace("\r\n", "\n").split("\n"):
        if line.strip():
            sheet.append([re.sub(r"^[-*#>\s]+", "", line).strip()])
    sheet.column_dimensions["A"].width = 110
    workbook.save(path)


def generate_document(
    format: str,
    user_prompt: str,
    chat_history: list[dict[str, Any]],
    model: str,
    context: dict[str, Any] | None = None,
    title: str = "Report",
    modes: dict[str, bool] | None = None,
    template_type: str | None = None,
) -> str:
    """Generate Markdown with Ollama and convert it to the requested file."""
    logger.info(f"[SKILL-DEBUG] Received modes: {modes}")
    if format not in SKILL_FORMATS:
        raise ValueError("The skill must be one of: pdf, word, excel.")
    if not user_prompt.strip():
        raise ValueError("A document request is required.")
    template_type = (
        resolve_template_type(user_prompt, template_type)
        if format in {"pdf", "word"}
        else "default"
    )
    context_text = context.get("text", "") if isinstance(context, dict) else ""
    if not isinstance(context_text, str):
        context_text = ""
    history = "\n".join(
        f"{message.get('role', 'user').title()}: {message.get('content', '')}"
        for message in chat_history[-6:]
        if isinstance(message, dict) and message.get("content")
    )
    history = history[-4000:]
    user_name = str(get_settings().get("userName") or "").strip()
    current_date = date.today().strftime("%B %d, %Y").replace(" 0", " ")
    system_prompt = (
        "DO NOT include a title, date, or author name in your response. "
        "The system automatically adds a cover page. Start directly with the "
        "content. "
        "Do NOT use asterisks (`*`) for bold or italics. Use standard Markdown "
        "(e.g., `**bold**`)."
    )
    prompt = REPORT_PROMPT.format(user_prompt=user_prompt)
    section_order = MEMO_TEMPLATES[template_type].section_order
    if template_type == "checklist":
        section_order = ("Summary", "Checklist", "Legal Constraints")
    prompt += (
        "\n\nArrange the report sections in this order: "
        f"{'; '.join(section_order)}."
    )
    if MEMO_TEMPLATES[template_type].prompt_instruction:
        prompt += (
            "\n\nLayout instructions: "
            f"{MEMO_TEMPLATES[template_type].prompt_instruction}"
        )
    if template_type == "checklist":
        prompt += (
            "\n\nChecklist format: Output a clean Markdown checklist. "
            "Use the exact section headings `## Summary`, `## Checklist`, "
            "and `## Legal Constraints` in that order. "
            'Generate a step-by-step checklist using EXACTLY this format: '
            '"- [ ] Item text". '
            "Do NOT use numbered lists. "
            "You do NOT need specific law citations for a procedural checklist. "
            "Do not refuse solely because legal context is missing; provide "
            "general procedural steps and omit unverifiable "
            "jurisdiction-specific requirements. "
            "Do NOT use bold asterisks (`**`) for the checklist items."
        )
    elif template_type == "client_summary":
        prompt += (
            "\n\nWrite in plain language. Do NOT include legal citations or jargon."
        )
    elif template_type == "legal_reference":
        prompt += (
            '\n\nOnly output the legal citations and articles. If no laws are '
            'provided in the context, output: "No legal articles found in the '
            'provided context."'
        )
    if modes and modes.get("web") and context_text:
        prompt += f"\n\nResearch context:\n{context_text}"
    try:
        response = ollama.chat(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": system_prompt,
                },
                {
                    "role": "user",
                    "content": f"{prompt}\n\nConversation history:\n{history or '(none)'}",
                },
            ],
            think=False,
            options={"num_predict": 2048, "temperature": 0.1},
            stream=False,
        )
    except Exception as error:
        raise RuntimeError(MEMORY_ERROR) from error
    markdown = _response_text(response).strip()
    if not markdown:
        raise RuntimeError("The document skill returned no report content.")
    filename_title = title.strip()
    if not filename_title or filename_title.casefold() in {
        "chat",
        "new chat",
        "report",
    }:
        filename_title = user_prompt
    path = _output_path(format, filename_title)
    if format == "pdf":
        _render_pdf(markdown, path, template_type, user_name, current_date)
    elif format == "word":
        _render_word(markdown, path, template_type, user_name, current_date)
    else:
        _render_excel(markdown, path)
    return path
