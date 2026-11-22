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
from slices.pdf_engine.inspector import (
    DEFAULT_DESIGN_SPEC,
    DESIGN_SPEC_VERSION,
    inspect_document_design,
    inspect_pdf_design,
    merge_design_spec,
    normalize_design_spec,
    resolve_design_skill_spec,
    save_design_skill_bundle,
)
from slices.pdf_engine.office_inspector import inspect_office_design
from slices.pdf_engine.office_reader import (
    is_supported_universal_document,
    read_universal_document,
)
from slices.pdf_engine.preview import render_pdf_preview
from slices.pdf_engine.reader import inspect_pdf_summary, read_pdf_document

__all__ = [
    "DEFAULT_DESIGN_SPEC",
    "DESIGN_SPEC_VERSION",
    "generate_pdf_document",
    "inspect_document_design",
    "inspect_office_design",
    "inspect_pdf_design",
    "inspect_pdf_summary",
    "is_supported_universal_document",
    "load_pdf_editable_spec",
    "merge_design_spec",
    "modify_or_append_pdf_by_agent",
    "normalize_design_spec",
    "read_pdf_document",
    "read_universal_document",
    "render_pdf_preview",
    "resolve_design_skill_spec",
    "save_design_skill_bundle",
    "save_edited_pdf_document",
]

