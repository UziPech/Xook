"""
XOOK PDF Engine Slice:
Lectura inteligente de PDFs (texto, tablas y fallback OCR local)
y generación declarativa de documentos PDF profesionales con portada,
títulos, subtítulos, tablas, métricas e imágenes del workspace.
"""

from slices.pdf_engine.generator import generate_pdf_document
from slices.pdf_engine.preview import render_pdf_preview
from slices.pdf_engine.reader import inspect_pdf_summary, read_pdf_document

__all__ = [
    "generate_pdf_document",
    "inspect_pdf_summary",
    "read_pdf_document",
    "render_pdf_preview",
]

