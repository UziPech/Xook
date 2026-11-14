"""
XOOK PDF Engine Slice:
Lectura inteligente de PDFs (texto, tablas y fallback OCR local)
y generación declarativa de documentos PDF profesionales con portada,
títulos, subtítulos, tablas, métricas e imágenes del workspace.
"""

from slices.pdf_engine.editor import (
    load_pdf_editable_spec,
    modify_or_append_pdf_by_agent,
    save_edited_pdf_document,
)
from slices.pdf_engine.generator import generate_pdf_document
from slices.pdf_engine.office_reader import (
    is_supported_universal_document,
    read_universal_document,
)
from slices.pdf_engine.preview import render_pdf_preview
from slices.pdf_engine.reader import inspect_pdf_summary, read_pdf_document

__all__ = [
    "generate_pdf_document",
    "inspect_pdf_summary",
    "is_supported_universal_document",
    "load_pdf_editable_spec",
    "modify_or_append_pdf_by_agent",
    "read_pdf_document",
    "read_universal_document",
    "render_pdf_preview",
    "save_edited_pdf_document",
]

