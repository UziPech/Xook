"""
Tests unitarios e integración para el motor desbloqueado de generación y edición de PDFs:
- Compatibilidad retroactiva con los 5 temas clásicos
- Fuentes multi-familia TTF (sans, serif, mono) y tipografía configurable (align justify, h1-h3 decorations)
- Geometría personalizada (landscape, A4, márgenes asimétricos, fondo, borde de página, 2 columnas)
- Encabezados y pies totalmente configurables (desactivados, tokens, fondo, logo, skip_first_page)
- Papelería PDF de fondo (`stationery_asset`)
- Nuevos bloques composicionales (`columns`, `kv_grid`, `header_band`, `signature_block`, `box`)
- Estilos de tabla (`striped`, `bordered`, `minimal_rules`, `clean`, `invoice`, `col_widths`, `totals_row`)
- Portadas (`academic_centered`, `band_top`, `top_band`, assets de skill)
- Resolución de `design_skill` + `design_overrides`
- Persistencia, herencia, reestilizado e inspección perezosa en `editor.py`
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Tuple

_SRC_BRAIN = Path(__file__).resolve().parents[2]
if str(_SRC_BRAIN) not in sys.path:
    sys.path.insert(0, str(_SRC_BRAIN))

import pdfplumber
from PIL import Image as PILImage
from pypdf import PdfReader
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas as rl_canvas

from slices.pdf_engine.editor import (
    blocks_to_markdown,
    load_pdf_editable_spec,
    modify_or_append_pdf_by_agent,
)
from slices.pdf_engine.generator import (
    _count_substantive_blocks,
    _ensure_fonts,
    _normalize_blocks_input,
    _resolve_font_set,
    generate_pdf_document,
)
from slices.pdf_engine.inspector import save_design_skill_bundle


def _resolve_ws_path(workspace_root: Path, raw_path: str) -> Tuple[Path, str, str]:
    clean = str(raw_path or "").strip().lstrip("/")
    abs_p = (workspace_root / clean).resolve()
    ws_res = workspace_root.resolve()
    if abs_p != ws_res and ws_res not in abs_p.parents:
        raise ValueError("Path outside workspace")
    rel = abs_p.relative_to(ws_res).as_posix()
    top_zone = rel.split("/", 1)[0] if "/" in rel else ""
    return abs_p, rel, top_zone


def _make_sample_png(path: Path, color_rgb: Tuple[int, int, int] = (139, 30, 63), size: Tuple[int, int] = (160, 60)) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    img = PILImage.new("RGBA", size, (*color_rgb, 255))
    img.save(path, format="PNG")
    return path


def _make_stationery_pdf(path: Path, marker_text: str = "MEMBRETE OFICIAL ACME") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    c = rl_canvas.Canvas(str(path), pagesize=letter)
    c.setFillColor(colors.HexColor("#8B1E3F"))
    c.rect(0, 772, 612, 20, stroke=0, fill=1)
    c.setFont("Helvetica-Bold", 9)
    c.setFillColor(colors.white)
    c.drawString(36, 779, marker_text)
    c.showPage()
    c.save()
    return path


class GeneratorDesignTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory(prefix="xook_pdf_renderer_test_")
        self.ws = Path(self._tmp.name) / "workspace"
        self.ws.mkdir(parents=True, exist_ok=True)
        self.global_skills = Path(self._tmp.name) / "global_skills"
        self.global_skills.mkdir(parents=True, exist_ok=True)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_backward_compatibility_legacy_theme(self) -> None:
        res = generate_pdf_document(
            {
                "title": "Reporte Legado",
                "author": "Equipo XOOK",
                "theme": "emerald",
                "output_path": "agente/reportes/legado.pdf",
                "blocks": [
                    {"type": "heading", "level": 1, "text": "Resumen Ejecutivo"},
                    {"type": "paragraph", "text": "Contenido tradicional compatible con versiones previas."},
                ],
            },
            workspace_root=self.ws,
            resolve_path_fn=_resolve_ws_path,
        )
        self.assertTrue(res["ok"])
        self.assertEqual(res["theme"], "emerald")
        self.assertNotIn("design_spec", res)
        self.assertNotIn("design_skill", res)

        pdf_abs = self.ws / res["path"]
        self.assertTrue(pdf_abs.is_file())
        with pdfplumber.open(str(pdf_abs)) as pdf:
            txt = pdf.pages[0].extract_text() or ""
            self.assertIn("Reporte Legado", txt)
            self.assertIn("Página 1 de 1", txt)

    def test_multi_family_fonts_and_serif_justify_typography(self) -> None:
        _ensure_fonts()
        sans_set = _resolve_font_set("sans")
        serif_set = _resolve_font_set("serif")
        mono_set = _resolve_font_set("mono")
        self.assertNotEqual(sans_set["regular"], serif_set["regular"])
        self.assertNotEqual(serif_set["regular"], mono_set["regular"])

        res = generate_pdf_document(
            {
                "title": "Ensayo Académico",
                "output_path": "agente/reportes/serif_justify.pdf",
                "design_spec": {
                    "palette": {
                        "accent": "#8B1E3F",
                        "heading": "#3B0A1A",
                        "text": "#222222",
                    },
                    "typography": {
                        "body_family": "serif",
                        "heading_family": "sans",
                        "body_size": 11.0,
                        "body_leading": 16.5,
                        "body_align": "justify",
                        "space_after": 8.0,
                        "h1": {"size": 17.0, "leading": 22.0, "uppercase": True, "decoration": "left_bar"},
                        "h2": {"size": 13.0, "leading": 17.0, "decoration": "band"},
                        "h3": {"size": 11.0, "leading": 14.5, "decoration": "plain"},
                    },
                    "header": {"enabled": False},
                    "footer": {"enabled": False},
                },
                "blocks": [
                    {"type": "heading", "level": 1, "text": "introducción general"},
                    {
                        "type": "paragraph",
                        "text": (
                            "Este párrafo largo está redactado con fuente serif y alineación justificada para "
                            "comprobar que el motor tipográfico aplica familia serif en cuerpo y sans en encabezados "
                            "con caracteres en español como ñ, á, é, í, ó, ú y signos de puntuación."
                        ),
                    },
                    {"type": "heading", "level": 2, "text": "Sección con banda"},
                    {"type": "heading", "level": 3, "text": "Subtítulo limpio"},
                    {"type": "paragraph", "text": "Texto adicional en cuerpo serif."},
                ],
            },
            workspace_root=self.ws,
            resolve_path_fn=_resolve_ws_path,
        )
        self.assertTrue(res["ok"])
        self.assertEqual(res["design_spec"]["typography"]["body_family"], "serif")
        self.assertEqual(res["design_spec"]["typography"]["body_align"], "justify")

        pdf_abs = self.ws / res["path"]
        with pdfplumber.open(str(pdf_abs)) as pdf:
            page = pdf.pages[0]
            txt = page.extract_text() or ""
            self.assertIn("INTRODUCCIÓN GENERAL", txt)
            font_names = {str(c.get("fontname") or "") for c in page.chars}
            # Debe haber al menos dos familias distintas (serif para cuerpo + sans para encabezados)
            has_serif = any("serif" in fn.lower() or "georgia" in fn.lower() or "times" in fn.lower() for fn in font_names)
            has_sans = any("sans" in fn.lower() or "arial" in fn.lower() or "helvetica" in fn.lower() for fn in font_names)
            self.assertTrue(has_serif, f"Expected serif font in {font_names}")
            self.assertTrue(has_sans, f"Expected sans font in {font_names}")

    def test_custom_geometry_landscape_margins_bg_and_border(self) -> None:
        res = generate_pdf_document(
            {
                "title": "Hoja Apaisada",
                "output_path": "agente/reportes/landscape_custom.pdf",
                "design_spec": {
                    "page": {
                        "size_name": "a4",
                        "orientation": "landscape",
                        "margins_pt": {"top": 72.0, "right": 50.0, "bottom": 60.0, "left": 84.0},
                        "background_hex": "#FAF5EE",
                        "border": {"enabled": True, "color": "#8B1E3F", "width_pt": 1.5, "inset_pt": 20.0},
                    },
                    "palette": {
                        "page_bg": "#FAF5EE",
                        "accent": "#8B1E3F",
                    },
                    "header": {"enabled": False},
                    "footer": {"enabled": False},
                },
                "blocks": [
                    {"type": "paragraph", "text": "Contenido dentro de una página A4 horizontal con borde y fondo crema."},
                ],
            },
            workspace_root=self.ws,
            resolve_path_fn=_resolve_ws_path,
        )
        self.assertTrue(res["ok"])
        pdf_abs = self.ws / res["path"]
        with pdfplumber.open(str(pdf_abs)) as pdf:
            p = pdf.pages[0]
            self.assertGreater(float(p.width), float(p.height))
            self.assertAlmostEqual(float(p.width), 841.89, delta=3.0)
            self.assertAlmostEqual(float(p.height), 595.28, delta=3.0)
            words = p.extract_words()
            self.assertTrue(words)
            min_x0 = min(float(w["x0"]) for w in words)
            self.assertGreaterEqual(min_x0, 80.0)
            # Debe haber rectángulo de fondo y rectángulo de borde
            self.assertGreaterEqual(len(p.rects), 2)

    def test_disabled_header_and_footer_draw_nothing(self) -> None:
        res = generate_pdf_document(
            {
                "title": "Sin Membrete",
                "author": "Autor Oculto",
                "output_path": "agente/reportes/no_chrome.pdf",
                "skip_inline_title": True,
                "design_spec": {
                    "header": {"enabled": False},
                    "footer": {"enabled": False},
                },
                "blocks": [
                    {"type": "paragraph", "text": "Bloque uno sin encabezado ni pie."},
                    {"type": "page_break"},
                    {"type": "paragraph", "text": "Bloque dos sin encabezado ni pie."},
                ],
            },
            workspace_root=self.ws,
            resolve_path_fn=_resolve_ws_path,
        )
        self.assertTrue(res["ok"])
        self.assertEqual(res["page_count"], 2)
        with pdfplumber.open(str(self.ws / res["path"])) as pdf:
            for idx, page in enumerate(pdf.pages):
                txt = page.extract_text() or ""
                self.assertNotIn("Sin Membrete", txt)
                self.assertNotIn("Autor Oculto", txt)
                self.assertNotIn("Página", txt)
                self.assertEqual(len(page.lines), 0, f"Unexpected header/footer lines on page {idx + 1}")

    def test_custom_header_footer_tokens_bg_and_logo(self) -> None:
        logo_path = _make_sample_png(self.ws / "empresa" / "logo.png")
        res = generate_pdf_document(
            {
                "title": "Contrato Marco",
                "subtitle": "Revisión Anual",
                "author": "Estudio Legal Vega",
                "date": "21 de noviembre de 2026",
                "output_path": "agente/reportes/custom_chrome.pdf",
                "design_spec": {
                    "header": {
                        "enabled": True,
                        "skip_first_page": True,
                        "height_pt": 32.0,
                        "background_hex": "#1E3A8A",
                        "border_bottom": True,
                        "left": "{title}",
                        "center": "{subtitle}",
                        "right": "{author}",
                        "logo_asset": "empresa/logo.png",
                        "logo_position": "left",
                        "logo_height_pt": 18.0,
                    },
                    "footer": {
                        "enabled": True,
                        "skip_first_page": True,
                        "border_top": True,
                        "left": "{date}",
                        "center": "Confidencial",
                        "right": "Hoja {page}/{total}",
                    },
                },
                "blocks": [
                    {"type": "paragraph", "text": "Primera hoja sin encabezado por skip_first_page."},
                    {"type": "page_break"},
                    {"type": "paragraph", "text": "Segunda hoja con encabezado azul, logo y tokens."},
                ],
            },
            workspace_root=self.ws,
            resolve_path_fn=_resolve_ws_path,
        )
        self.assertTrue(res["ok"])
        self.assertTrue(logo_path.is_file())
        self.assertEqual(res["page_count"], 2)
        with pdfplumber.open(str(self.ws / res["path"])) as pdf:
            p1_txt = pdf.pages[0].extract_text() or ""
            p2_txt = pdf.pages[1].extract_text() or ""
            self.assertNotIn("Hoja 1/2", p1_txt)
            self.assertNotIn("Confidencial", p1_txt)
            self.assertIn("Hoja 2/2", p2_txt)
            self.assertIn("Confidencial", p2_txt)
            self.assertIn("Revisión Anual", p2_txt)
            self.assertIn("Estudio Legal Vega", p2_txt)
            self.assertGreaterEqual(len(pdf.pages[1].images), 1)

    def test_two_column_page_layout(self) -> None:
        long_paras = [
            {
                "type": "paragraph",
                "text": (
                    f"Párrafo {i}: El diseño en dos columnas distribuye el contenido denso en dos marcos "
                    "paralelos dentro de la misma página, logrando lectura ágil similar a boletines y artículos "
                    "académicos publicados en revistas especializadas."
                ),
            }
            for i in range(1, 14)
        ]
        res = generate_pdf_document(
            {
                "title": "Boletín Científico",
                "output_path": "agente/reportes/two_cols.pdf",
                "skip_inline_title": True,
                "design_spec": {
                    "page": {"columns": 2, "column_gap_pt": 22.0},
                    "header": {"enabled": False},
                    "footer": {"enabled": False},
                },
                "blocks": long_paras,
            },
            workspace_root=self.ws,
            resolve_path_fn=_resolve_ws_path,
        )
        self.assertTrue(res["ok"])
        with pdfplumber.open(str(self.ws / res["path"])) as pdf:
            p1 = pdf.pages[0]
            mid_x = float(p1.width) / 2.0
            words = p1.extract_words()
            left_words = [w for w in words if float(w["x1"]) < mid_x - 4.0]
            right_words = [w for w in words if float(w["x0"]) > mid_x + 4.0]
            self.assertGreater(len(left_words), 20, "Expected substantial text in left column")
            self.assertGreater(len(right_words), 20, "Expected substantial text in right column")

    def test_compositional_blocks_columns_kv_grid_signature_and_box(self) -> None:
        raw_blocks = [
            {
                "type": "header_band",
                "title": "Datos de Cotización",
                "columns": 2,
                "items": [
                    {"label": "Folio", "value": "COT-2026-019"},
                    {"label": "Vigencia", "value": "30 días naturales"},
                ],
            },
            {
                "type": "kv_grid",
                "columns": 2,
                "items": [
                    {"label": "Cliente", "value": "Industrias Horizonte"},
                    {"label": "Moneda", "value": "MXN"},
                ],
            },
            {
                "type": "columns",
                "widths": [0.55, 0.45],
                "columns": [
                    [
                        {"type": "heading", "level": 2, "text": "Columna Izquierda"},
                        {"type": "paragraph", "text": "Descripción detallada en el panel izquierdo."},
                    ],
                    [
                        {"type": "heading", "level": 2, "text": "Columna Derecha"},
                        {"type": "bullets", "items": ["Entrega inmediata", "Soporte incluido"]},
                    ],
                ],
            },
            {
                "type": "box",
                "title": "Condiciones Comerciales",
                "text": "Anticipo del 50% al confirmar orden de compra.",
                "bg_color": "#FFFBEB",
                "border_color": "#D97706",
                "blocks": [
                    {"type": "paragraph", "text": "Saldo contra entrega de entregables finales."}
                ],
            },
            {
                "type": "signature_block",
                "signers": [
                    {"name": "Ana Morales", "role": "Directora Comercial", "date": "21/11/2026"},
                    {"name": "Luis Herrera", "role": "Cliente Autorizado", "date": "21/11/2026"},
                ],
            },
        ]

        norm_blocks, _ = _normalize_blocks_input({"blocks": raw_blocks})
        self.assertEqual(_count_substantive_blocks(norm_blocks), 5)

        md = blocks_to_markdown(norm_blocks)
        self.assertIn("COT-2026-019", md)
        self.assertIn("Columna Derecha", md)
        self.assertIn("Ana Morales", md)
        self.assertIn("Condiciones Comerciales", md)

        res = generate_pdf_document(
            {
                "title": "Cotización Modular",
                "output_path": "agente/reportes/compositional.pdf",
                "blocks": raw_blocks,
            },
            workspace_root=self.ws,
            resolve_path_fn=_resolve_ws_path,
        )
        self.assertTrue(res["ok"])
        with pdfplumber.open(str(self.ws / res["path"])) as pdf:
            p1 = pdf.pages[0]
            txt = p1.extract_text() or ""
            for expected in (
                "COT-2026-019",
                "Industrias Horizonte",
                "Columna Izquierda",
                "Columna Derecha",
                "Condiciones Comerciales",
                "Saldo contra entrega",
                "Ana Morales",
                "Luis Herrera",
            ):
                self.assertIn(expected, txt)

            words = p1.extract_words()
            left_x = min(float(w["x0"]) for w in words if w["text"] == "Izquierda")
            right_x = min(float(w["x0"]) for w in words if w["text"] == "Derecha")
            self.assertGreater(right_x, left_x + 120.0)

    def test_table_styles_col_widths_and_totals_row(self) -> None:
        for style_name in ("minimal_rules", "bordered", "clean", "invoice", "striped"):
            res = generate_pdf_document(
                {
                    "title": f"Tabla {style_name}",
                    "output_path": f"agente/reportes/tbl_{style_name}.pdf",
                    "design_spec": {
                        "tables": {"style": style_name, "font_size": 9.0},
                        "header": {"enabled": False},
                        "footer": {"enabled": False},
                    },
                    "blocks": [
                        {
                            "type": "table",
                            "headers": ["Concepto", "Cant.", "Importe"],
                            "col_widths": [0.55, 0.15, 0.30],
                            "totals_row": style_name == "invoice",
                            "rows": [
                                ["Consultoría técnica", "2", "$10,000"],
                                ["Implementación", "1", "$15,000"],
                                ["Total", "3", "$25,000"],
                            ],
                        }
                    ],
                },
                workspace_root=self.ws,
                resolve_path_fn=_resolve_ws_path,
            )
            self.assertTrue(res["ok"], f"Failed table style {style_name}")
            self.assertEqual(res["tables_count"], 1)
            with pdfplumber.open(str(self.ws / res["path"])) as pdf:
                txt = pdf.pages[0].extract_text() or ""
                self.assertIn("Consultoría técnica", txt)
                self.assertIn("$25,000", txt)

    def test_covers_academic_centered_and_band_top(self) -> None:
        res_acad = generate_pdf_document(
            {
                "title": "Tesis de Maestría",
                "subtitle": "Sistemas Distribuidos Resilientes",
                "author": "Universidad Nacional",
                "output_path": "agente/reportes/cover_academic.pdf",
                "design_spec": {
                    "cover": {"enabled": True, "layout": "academic_centered", "top_band": False},
                    "header": {"enabled": False},
                    "footer": {"enabled": False},
                },
                "blocks": [{"type": "paragraph", "text": "Capítulo uno."}],
            },
            workspace_root=self.ws,
            resolve_path_fn=_resolve_ws_path,
        )
        self.assertTrue(res_acad["ok"])
        self.assertEqual(res_acad["page_count"], 2)
        self.assertEqual(res_acad["cover_layout"], "academic_centered")
        with pdfplumber.open(str(self.ws / res_acad["path"])) as pdf:
            # Con top_band=False no debe pintarse banda llena arriba de la portada
            top_rects = [r for r in pdf.pages[0].rects if float(r["top"]) < 5.0 and float(r["width"]) > 500.0]
            self.assertEqual(len(top_rects), 0)

        res_band = generate_pdf_document(
            {
                "title": "Propuesta Corporativa",
                "output_path": "agente/reportes/cover_band.pdf",
                "design_spec": {
                    "palette": {"accent": "#8B1E3F", "accent_dark": "#5A1228"},
                    "cover": {"enabled": True, "layout": "band_top", "top_band": True, "top_band_height_pt": 72.0},
                },
                "blocks": [{"type": "paragraph", "text": "Contenido principal."}],
            },
            workspace_root=self.ws,
            resolve_path_fn=_resolve_ws_path,
        )
        self.assertTrue(res_band["ok"])
        self.assertEqual(res_band["page_count"], 2)
        self.assertEqual(res_band["cover_layout"], "band_top")
        with pdfplumber.open(str(self.ws / res_band["path"])) as pdf:
            top_rects = [r for r in pdf.pages[0].rects if float(r["top"]) < 5.0 and float(r["width"]) > 500.0]
            self.assertGreaterEqual(len(top_rects), 1)

    def test_heading_plain_decoration_omits_underline_and_skill_cover_logo_auto_loads(self) -> None:
        skill_dir = self.ws / "habilidades" / "institucional-limpio"
        _make_sample_png(skill_dir / "assets" / "escudo.png")
        save_design_skill_bundle(
            skill_dir,
            {
                "name": "Institucional Limpio",
                "slug": "institucional-limpio",
                "typography": {
                    "h1": {"decoration": "plain"},
                },
                "cover": {
                    "enabled": True,
                    "layout": "academic_centered",
                    "top_band": False,
                    "logo_asset": "assets/escudo.png",
                },
                "header": {"enabled": False},
                "footer": {"enabled": False},
            },
            extract_assets=False,
        )
        res = generate_pdf_document(
            {
                "title": "Memoria Anual",
                "output_path": "agente/reportes/plain_h1.pdf",
                "design_skill": "institucional-limpio",
                "blocks": [
                    {"type": "heading", "level": 1, "text": "Capítulo Sin Línea"},
                    {"type": "paragraph", "text": "Párrafo directo debajo de H1 sin subrayado."},
                ],
            },
            workspace_root=self.ws,
            resolve_path_fn=_resolve_ws_path,
        )
        self.assertTrue(res["ok"])
        self.assertEqual(res["page_count"], 2)
        with pdfplumber.open(str(self.ws / res["path"])) as pdf:
            # Portada auto-cargó cover.logo_asset desde habilidades/<slug>/assets/escudo.png
            self.assertGreaterEqual(len(pdf.pages[0].images), 1)
            # Página 2 (H1 plain + sin header/footer) no tiene líneas horizontales
            self.assertEqual(len(pdf.pages[1].lines), 0)

    def test_stationery_pdf_background_overlay(self) -> None:
        st_pdf = _make_stationery_pdf(self.ws / "empresa" / "papeleria.pdf", "MEMBRETE OFICIAL ACME")
        self.assertTrue(st_pdf.is_file())

        res = generate_pdf_document(
            {
                "title": "Carta con Membrete",
                "output_path": "agente/reportes/con_papeleria.pdf",
                "design_spec": {
                    "page": {"stationery_asset": "empresa/papeleria.pdf"},
                    "cover": {"enabled": True, "layout": "minimal"},
                    "header": {"enabled": False, "skip_first_page": True},
                    "footer": {"enabled": False},
                },
                "blocks": [{"type": "paragraph", "text": "Cuerpo del documento sobre papelería oficial."}],
            },
            workspace_root=self.ws,
            resolve_path_fn=_resolve_ws_path,
        )
        self.assertTrue(res["ok"])
        self.assertEqual(res["page_count"], 2)
        with pdfplumber.open(str(self.ws / res["path"])) as pdf:
            p1_txt = pdf.pages[0].extract_text() or ""
            p2_txt = pdf.pages[1].extract_text() or ""
            self.assertNotIn("MEMBRETE OFICIAL ACME", p1_txt)
            self.assertIn("MEMBRETE OFICIAL ACME", p2_txt)
            self.assertIn("Cuerpo del documento sobre papelería oficial.", p2_txt)

    def test_design_skill_resolution_and_design_overrides(self) -> None:
        skill_dir = self.global_skills / "formato-editorial"
        _make_sample_png(skill_dir / "assets" / "logo.png")
        save_design_skill_bundle(
            skill_dir,
            {
                "name": "Formato Editorial",
                "slug": "formato-editorial",
                "document_type": "report",
                "palette": {"accent": "#8B1E3F", "heading": "#3B0A1A"},
                "typography": {"body_family": "serif", "heading_family": "serif", "body_align": "justify"},
                "header": {
                    "enabled": True,
                    "skip_first_page": False,
                    "left": "{title}",
                    "logo_asset": "assets/logo.png",
                },
                "footer": {"enabled": True, "skip_first_page": False, "right": "Pág. {page}/{total}"},
            },
            extract_assets=False,
        )

        # 1) Uso directo de design_skill
        res1 = generate_pdf_document(
            {
                "title": "Edición Base",
                "output_path": "agente/reportes/skill_base.pdf",
                "design_skill": "formato-editorial",
                "blocks": [{"type": "paragraph", "text": "Texto replicado desde habilidad global."}],
            },
            workspace_root=self.ws,
            resolve_path_fn=_resolve_ws_path,
            global_skills_dir=self.global_skills,
        )
        self.assertTrue(res1["ok"])
        self.assertEqual(res1["design_skill"], "formato-editorial")
        self.assertEqual(res1["design_spec"]["palette"]["accent"], "#8B1E3F")
        self.assertEqual(res1["design_spec"]["typography"]["body_family"], "serif")
        with pdfplumber.open(str(self.ws / res1["path"])) as pdf:
            self.assertIn("Pág. 1/1", pdf.pages[0].extract_text() or "")
            self.assertGreaterEqual(len(pdf.pages[0].images), 1)

        # 2) Sobrescritura libre vía design_overrides
        res2 = generate_pdf_document(
            {
                "title": "Edición Modificada",
                "output_path": "agente/reportes/skill_override.pdf",
                "design_skill": "formato-editorial",
                "design_overrides": {
                    "palette": {"accent": "#0D9488"},
                    "header": {"enabled": False},
                    "page": {"columns": 2},
                },
                "blocks": [{"type": "paragraph", "text": "Texto con acento verde azulado y sin encabezado."}],
            },
            workspace_root=self.ws,
            resolve_path_fn=_resolve_ws_path,
            global_skills_dir=self.global_skills,
        )
        self.assertTrue(res2["ok"])
        self.assertEqual(res2["design_skill"], "formato-editorial")
        self.assertEqual(res2["design_spec"]["palette"]["accent"], "#0D9488")
        self.assertEqual(res2["design_spec"]["typography"]["body_family"], "serif")
        self.assertFalse(res2["design_spec"]["header"]["enabled"])
        self.assertEqual(res2["design_spec"]["page"]["columns"], 2)

    def test_editor_preserves_and_overrides_design_spec(self) -> None:
        skill_dir = self.global_skills / "estilo-firma"
        save_design_skill_bundle(
            skill_dir,
            {
                "name": "Estilo Firma",
                "slug": "estilo-firma",
                "palette": {"accent": "#8B1E3F", "heading": "#4A0E20"},
                "typography": {"body_family": "serif", "heading_family": "serif"},
                "header": {"enabled": True, "skip_first_page": False, "left": "{title}"},
                "footer": {"enabled": True, "skip_first_page": False, "right": "Página {page} de {total}"},
            },
            extract_assets=False,
        )

        created = generate_pdf_document(
            {
                "title": "Dictamen Original",
                "output_path": "agente/reportes/dictamen.pdf",
                "design_skill": "estilo-firma",
                "blocks": [
                    {"type": "heading", "level": 1, "text": "Antecedentes"},
                    {"type": "paragraph", "text": "Versión inicial del dictamen legal."},
                ],
            },
            workspace_root=self.ws,
            resolve_path_fn=_resolve_ws_path,
            global_skills_dir=self.global_skills,
        )
        self.assertTrue(created["ok"])
        pdf_abs = self.ws / created["path"]

        loaded = load_pdf_editable_spec(self.ws, pdf_abs, created["path"])
        self.assertEqual(loaded["design_skill"], "estilo-firma")
        self.assertIsInstance(loaded["design_spec"], dict)
        self.assertEqual(loaded["design_spec"]["palette"]["accent"], "#8B1E3F")

        # 1) Edición de texto SIN pasar diseño -> debe heredar y conservar design_skill y design_spec
        edited = modify_or_append_pdf_by_agent(
            self.ws,
            {
                "source_pdf_path": created["path"],
                "replacements": [{"find": "Versión inicial", "replace": "Versión revisada"}],
            },
            resolve_path_fn=_resolve_ws_path,
            global_skills_dir=self.global_skills,
        )
        self.assertTrue(edited["ok"])
        self.assertEqual(edited.get("design_skill"), "estilo-firma")
        self.assertEqual(edited["design_spec"]["palette"]["accent"], "#8B1E3F")
        self.assertEqual(edited["design_spec"]["typography"]["body_family"], "serif")
        with pdfplumber.open(str(pdf_abs)) as pdf:
            self.assertIn("Versión revisada", pdf.pages[0].extract_text() or "")

        # 2) Reestilizado puro con design_overrides SIN cambiar texto -> metadata_changed=True
        restyled = modify_or_append_pdf_by_agent(
            self.ws,
            {
                "source_pdf_path": created["path"],
                "design_overrides": {
                    "palette": {"accent": "#7C3AED"},
                    "header": {"enabled": False},
                },
            },
            resolve_path_fn=_resolve_ws_path,
            global_skills_dir=self.global_skills,
        )
        self.assertTrue(restyled["ok"])
        self.assertEqual(restyled["design_spec"]["palette"]["accent"], "#7C3AED")
        self.assertFalse(restyled["design_spec"]["header"]["enabled"])
        self.assertEqual(restyled["design_spec"]["typography"]["body_family"], "serif")

        reloaded = load_pdf_editable_spec(self.ws, pdf_abs, created["path"])
        self.assertEqual(reloaded["design_spec"]["palette"]["accent"], "#7C3AED")
        self.assertFalse(reloaded["design_spec"]["header"]["enabled"])

        # 3) Append pages conserva design_spec modificado
        appended = modify_or_append_pdf_by_agent(
            self.ws,
            {
                "source_pdf_path": created["path"],
                "edit_action": "append_pages",
                "blocks": [
                    {"type": "heading", "level": 1, "text": "Anexo Final"},
                    {"type": "paragraph", "text": "Información complementaria agregada al documento."},
                ],
            },
            resolve_path_fn=_resolve_ws_path,
            global_skills_dir=self.global_skills,
        )
        self.assertTrue(appended["ok"])
        self.assertEqual(appended["edit_action"], "append_pages")
        self.assertEqual(appended["page_count"], 2)
        self.assertEqual(appended["design_spec"]["palette"]["accent"], "#7C3AED")
        self.assertFalse(appended["design_spec"]["header"]["enabled"])

    def test_editor_lazy_inspects_external_pdf_without_saved_spec(self) -> None:
        ext_pdf = self.ws / "datos" / "externo_serif.pdf"
        ext_pdf.parent.mkdir(parents=True, exist_ok=True)
        c = rl_canvas.Canvas(str(ext_pdf), pagesize=letter)
        c.setFillColor(colors.HexColor("#8B1E3F"))
        c.setFont("Times-Bold", 16)
        c.drawString(72, 720, "INFORME EXTERNO")
        c.setFillColor(colors.HexColor("#1F2937"))
        c.setFont("Times-Roman", 11)
        c.drawString(72, 690, "Texto original creado fuera de XOOK con tipografía clásica.")
        c.showPage()
        c.save()

        res = modify_or_append_pdf_by_agent(
            self.ws,
            {
                "source_pdf_path": "datos/externo_serif.pdf",
                "section_updates": [
                    {
                        "section": "INFORME EXTERNO",
                        "action": "append",
                        "blocks": [{"type": "paragraph", "text": "Nota agregada preservando diseño."}],
                    }
                ],
            },
            resolve_path_fn=_resolve_ws_path,
        )
        self.assertTrue(res["ok"])
        self.assertIn("design_spec", res)
        self.assertEqual(res["design_spec"]["typography"]["body_family"], "serif")
        with pdfplumber.open(str(ext_pdf)) as pdf:
            txt = pdf.pages[0].extract_text() or ""
            self.assertIn("Nota agregada preservando diseño.", txt)


if __name__ == "__main__":
    unittest.main()
