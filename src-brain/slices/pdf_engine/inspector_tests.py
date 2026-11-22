"""Pruebas unitarias y de integración para `slices.pdf_engine.inspector`."""

from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import unittest

from PIL import Image, ImageDraw
from pypdf import PdfReader, PdfWriter
from reportlab.lib import colors
from reportlab.lib.enums import TA_JUSTIFY
from reportlab.lib.pagesizes import A4, landscape, letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

# Asegurar que `src-brain` esté en sys.path cuando se ejecuta directamente con unittest
_SRC_BRAIN = Path(__file__).resolve().parents[2]
if str(_SRC_BRAIN) not in sys.path:
    sys.path.insert(0, str(_SRC_BRAIN))

from slices.pdf_engine import (
    DEFAULT_DESIGN_SPEC,
    DESIGN_SPEC_VERSION,
    inspect_pdf_design,
    merge_design_spec,
    normalize_design_spec,
    resolve_design_skill_spec,
    save_design_skill_bundle,
)
from slices.pdf_engine.inspector import _color_distance, _pdf_color_to_hex


def _make_sample_logo_png(path: Path, bg=(13, 148, 136), fg=(255, 255, 255)) -> Path:
    img = Image.new("RGBA", (180, 60), (*bg, 255))
    draw = ImageDraw.Draw(img)
    draw.rectangle([10, 10, 50, 50], fill=(*fg, 255))
    draw.ellipse([65, 12, 105, 48], outline=(*fg, 255), width=4)
    draw.rectangle([120, 20, 168, 40], fill=(*fg, 255))
    img.save(str(path), format="PNG")
    return path


def _build_corporate_report_pdf(pdf_path: Path, logo_path: Path) -> Path:
    """Genera un reporte corporativo de 3 páginas con portada, encabezado, pie, H1 subrayado, logo y tabla cebrada."""
    w, h = letter
    c = rl_canvas.Canvas(str(pdf_path), pagesize=letter)

    # --- Página 1: Portada dedicada ---
    c.setFillColor(colors.HexColor("#0D9488"))
    c.rect(0, h - 18, w, 18, stroke=0, fill=1)
    c.drawImage(str(logo_path), 56, h - 90, width=96, height=32, mask="auto")
    c.setFillColor(colors.HexColor("#0F172A"))
    c.setFont("Helvetica-Bold", 26)
    c.drawString(56, h - 240, "Informe Estratégico Anual")
    c.setFillColor(colors.HexColor("#64748B"))
    c.setFont("Helvetica", 12)
    c.drawString(56, h - 270, "Evaluación de desempeño operativo y financiero")
    c.showPage()

    # --- Páginas 2 y 3: Contenido interior con encabezado/pie, H1 subrayado y tabla ---
    sections = [
        ("Resumen Ejecutivo", "Indicadores Operativos"),
        ("Análisis Regional", "Conclusiones"),
    ]
    for page_idx, (sec1, sec2) in enumerate(sections, start=2):
        # Header (solo páginas interiores)
        c.drawImage(str(logo_path), 56, h - 42, width=54, height=18, mask="auto")
        c.setFillColor(colors.HexColor("#64748B"))
        c.setFont("Helvetica", 8.5)
        c.drawRightString(w - 56, h - 35, "Dirección General")
        c.setStrokeColor(colors.HexColor("#CBD5E1"))
        c.setLineWidth(0.75)
        c.line(56, h - 48, w - 56, h - 48)

        # Footer
        c.setStrokeColor(colors.HexColor("#CBD5E1"))
        c.line(56, 44, w - 56, 44)
        c.setFillColor(colors.HexColor("#64748B"))
        c.setFont("Helvetica", 8.5)
        c.drawString(56, 30, "15/03/2026")
        c.drawRightString(w - 56, 30, f"Página {page_idx} de 3")

        # H1 con subrayado en color acento
        y = h - 84
        c.setFillColor(colors.HexColor("#0D9488"))
        c.setFont("Helvetica-Bold", 16)
        c.drawString(56, y, sec1)
        c.setStrokeColor(colors.HexColor("#0D9488"))
        c.setLineWidth(1.5)
        c.line(56, y - 5, w - 56, y - 5)

        # Párrafos cuerpo 10pt
        y -= 26
        c.setFillColor(colors.HexColor("#1E293B"))
        c.setFont("Helvetica", 10)
        body_lines = [
            "Durante el periodo analizado se consolidaron los procesos clave de operación con mejoras",
            "sostenidas en eficiencia, tiempos de respuesta y calidad de entrega en todas las unidades.",
            "La disciplina presupuestal permitió reforzar capacidades sin incrementar costos fijos.",
        ]
        for line_txt in body_lines:
            c.drawString(56, y, line_txt)
            y -= 15.0

        y -= 14
        # H2 sin decoración
        c.setFillColor(colors.HexColor("#0F172A"))
        c.setFont("Helvetica-Bold", 12.5)
        c.drawString(56, y, sec2)
        y -= 20

        # Tabla cebrada en página 2
        if page_idx == 2:
            tbl = Table(
                [
                    ["Unidad", "Meta", "Resultado", "Estado"],
                    ["Norte", "90%", "94%", "Cumplido"],
                    ["Centro", "88%", "91%", "Cumplido"],
                    ["Sur", "85%", "87%", "Cumplido"],
                    ["Occidente", "92%", "95%", "Cumplido"],
                ],
                colWidths=[130, 110, 120, 140],
            )
            tbl.setStyle(
                TableStyle(
                    [
                        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F172A")),
                        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                        ("FONTSIZE", (0, 0), (-1, -1), 9),
                        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F0FDFA")]),
                        ("LINEBELOW", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
                        ("TOPPADDING", (0, 0), (-1, -1), 6),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                        ("LEFTPADDING", (0, 0), (-1, -1), 8),
                    ]
                )
            )
            _, th = tbl.wrapOn(c, w - 112, 300)
            tbl.drawOn(c, 56, y - th)
        else:
            c.setFillColor(colors.HexColor("#1E293B"))
            c.setFont("Helvetica", 10)
            for idx in range(5):
                c.drawString(
                    56,
                    y - idx * 15,
                    "Las conclusiones confirman la viabilidad del plan y recomiendan escalar las prácticas.",
                )

        c.showPage()

    c.save()
    return pdf_path


def _build_academic_two_col_a4_pdf(pdf_path: Path) -> Path:
    """Genera un PDF académico A4 en 2 columnas, tipografía serif justificada, sin header/footer y H1 con barra izquierda."""
    page_w, page_h = A4
    margin_x = 50.0
    margin_y = 54.0
    gap = 20.0
    col_w = (page_w - 2 * margin_x - gap) / 2.0

    def _draw_left_bars(c, doc):
        # Barra vertical izquierda junto al encabezado principal en p.1
        if doc.page == 1:
            c.saveState()
            c.setFillColor(colors.HexColor("#111827"))
            c.rect(margin_x - 8, page_h - margin_y - 26, 3.5, 22, stroke=0, fill=1)
            c.restoreState()

    frame1 = Frame(margin_x, margin_y, col_w, page_h - 2 * margin_y, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id="col1")
    frame2 = Frame(margin_x + col_w + gap, margin_y, col_w, page_h - 2 * margin_y, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id="col2")

    doc = BaseDocTemplate(str(pdf_path), pagesize=A4)
    doc.addPageTemplates([PageTemplate(id="TwoCol", frames=[frame1, frame2], onPage=_draw_left_bars)])

    h1_style = ParagraphStyle(
        "AcadH1",
        fontName="Times-Bold",
        fontSize=15,
        leading=19,
        textColor=colors.HexColor("#111827"),
        spaceAfter=8,
    )
    body_style = ParagraphStyle(
        "AcadBody",
        fontName="Times-Roman",
        fontSize=10,
        leading=14,
        alignment=TA_JUSTIFY,
        textColor=colors.HexColor("#1F2937"),
        spaceAfter=7,
    )

    para_text = (
        "Este estudio académico evalúa la hipótesis central mediante una metodología reproducible "
        "y revisión sistemática de bibliografía especializada en sistemas de información contemporáneos. "
        "Los resultados empíricos demuestran consistencia estadística entre los modelos evaluados y "
        "aportan referencias sólidas para futuras investigaciones universitarias."
    )

    story = [Paragraph("Abstract y Metodología", h1_style)]
    for _ in range(14):
        story.append(Paragraph(para_text, body_style))
    story.append(Paragraph("Referencias", h1_style))
    for _ in range(8):
        story.append(Paragraph(para_text, body_style))

    doc.build(story)
    return pdf_path


def _build_dark_landscape_pdf(pdf_path: Path) -> Path:
    """Genera un PDF horizontal con fondo oscuro, borde de página y encabezado con banda."""
    w, h = landscape(letter)
    c = rl_canvas.Canvas(str(pdf_path), pagesize=(w, h))

    for pnum in (1, 2):
        # Fondo oscuro
        c.setFillColor(colors.HexColor("#0B1120"))
        c.rect(0, 0, w, h, stroke=0, fill=1)

        # Borde de página inset 18pt
        c.setStrokeColor(colors.HexColor("#334155"))
        c.setLineWidth(1.0)
        c.rect(18, 18, w - 36, h - 36, stroke=1, fill=0)

        # Banda detrás del H1
        c.setFillColor(colors.HexColor("#1E293B"))
        c.rect(56, h - 104, w - 112, 28, stroke=0, fill=1)
        c.setFillColor(colors.HexColor("#38BDF8"))
        c.setFont("Helvetica-Bold", 16)
        c.drawString(66, h - 95, "ARQUITECTURA DEL SISTEMA" if pnum == 1 else "MÉTRICAS CLAVE")

        # Texto claro
        c.setFillColor(colors.HexColor("#E2E8F0"))
        c.setFont("Helvetica", 10.5)
        y = h - 135
        for _ in range(8):
            c.drawString(
                56,
                y,
                "Diseño visual oscuro con alto contraste optimizado para presentaciones ejecutivas en pantalla.",
            )
            y -= 16

        c.showPage()

    c.save()
    return pdf_path


def _build_scanned_image_only_pdf(pdf_path: Path, tmp_dir: Path) -> Path:
    """Genera un PDF de 1 página puramente basado en imagen (sin capa de texto) con fondo crema y acento vino."""
    img = Image.new("RGB", (612, 792), (245, 239, 230))  # #F5EFE6
    draw = ImageDraw.Draw(img)
    # Banner vino en la parte superior
    draw.rectangle([48, 52, 564, 118], fill=(139, 30, 63))  # #8B1E3F
    # Simular líneas de texto oscuras
    for row in range(16):
        y = 155 + row * 28
        draw.rectangle([58, y, 540 if row % 4 != 3 else 360, y + 8], fill=(35, 31, 32))

    scan_img_path = tmp_dir / "_input_scan_fixture.png"
    img.save(str(scan_img_path), format="PNG")

    c = rl_canvas.Canvas(str(pdf_path), pagesize=letter)
    c.drawImage(str(scan_img_path), 0, 0, width=612, height=792)
    c.showPage()
    c.save()
    scan_img_path.unlink(missing_ok=True)
    return pdf_path


def _build_pii_heavy_pdf(pdf_path: Path) -> Path:
    """Genera un PDF lleno de PII en encabezados, pies y secciones para validar el saneamiento estricto."""
    w, h = letter
    c = rl_canvas.Canvas(str(pdf_path), pagesize=letter)
    for pnum in (1, 2):
        # Header con razón social y correo
        c.setFillColor(colors.HexColor("#475569"))
        c.setFont("Helvetica", 8.5)
        c.drawString(56, h - 34, "ACME Servicios S.A. de C.V. - juan.perez@acme.mx")
        c.setStrokeColor(colors.HexColor("#CBD5E1"))
        c.line(56, h - 42, w - 56, h - 42)

        # Footer con teléfono y página
        c.line(56, 44, w - 56, 44)
        c.drawString(56, 30, "Tel: +52 55 1234 5678")
        c.drawRightString(w - 56, 30, f"Página {pnum} de 2")

        y = h - 82
        headings = (
            [
                "Cliente: María González",
                "RFC: GOMM850101ABC",
                "Total a pagar: $14,500.00 MXN",
                "Av. Reforma 222 Col. Juárez",
                "Resumen de Servicios",
            ]
            if pnum == 1
            else [
                "Contacto juan.perez@acme.mx",
                "Condiciones Comerciales",
                "Alcance del Proyecto",
            ]
        )
        for heading in headings:
            c.setFillColor(colors.HexColor("#0F172A"))
            c.setFont("Helvetica-Bold", 14)
            c.drawString(56, y, heading)
            y -= 20
            c.setFillColor(colors.HexColor("#1E293B"))
            c.setFont("Helvetica", 10)
            c.drawString(56, y, "Descripción operativa de prueba para validar la extracción limpia de diseño.")
            y -= 34

        c.showPage()
    c.save()
    return pdf_path


class InspectorNormalizationTests(unittest.TestCase):
    def test_normalize_defaults_and_coercion(self) -> None:
        spec = normalize_design_spec(None)
        self.assertEqual(spec["version"], DESIGN_SPEC_VERSION)
        self.assertEqual(spec["page"]["size_name"], "letter")
        self.assertEqual(spec["page"]["width_pt"], 612.0)
        self.assertEqual(spec["page"]["height_pt"], 792.0)
        self.assertIsNot(spec, DEFAULT_DESIGN_SPEC)

        coerced = normalize_design_spec(
            {
                "name": "  Mi Estilo Ejecutivo  ",
                "source_pdf": "/Users/secret/private/factura-123.pdf",
                "document_type": "invalid_type",
                "page": {
                    "size_name": "a4",
                    "orientation": "landscape",
                    "margins_pt": {"top": 5, "right": 999, "bottom": 40, "left": 50},
                    "columns": 9,
                    "stationery_asset": "../../etc/passwd",
                },
                "palette": {
                    "page_bg": "#112233",
                    "accent": "#abc",
                    "text": (0.1, 0.2, 0.3),
                    "heading": "not-a-color",
                },
                "typography": {
                    "body_family": "serif",
                    "body_align": "justify",
                    "body_size": 11.0,
                    "h1": {"size": 20, "decoration": "band", "color": "#f0a"},
                },
                "header": {"logo_asset": "assets/logo.png", "logo_position": "center"},
                "sections_blueprint": [
                    "1. Resumen Ejecutivo",
                    "Cliente: Carlos Ruiz",
                    "correo@empresa.com",
                    "Total $9,500 MXN",
                    "2. Conclusiones",
                    "Resumen Ejecutivo",
                ],
            }
        )
        self.assertEqual(coerced["slug"], "mi-estilo-ejecutivo")
        self.assertEqual(coerced["source_pdf"], "factura-123.pdf")
        self.assertEqual(coerced["document_type"], "report")
        self.assertEqual(coerced["page"]["size_name"], "a4")
        self.assertEqual(coerced["page"]["orientation"], "landscape")
        self.assertGreater(coerced["page"]["width_pt"], coerced["page"]["height_pt"])
        self.assertEqual(coerced["page"]["margins_pt"]["top"], 12.0)
        self.assertEqual(coerced["page"]["margins_pt"]["right"], 180.0)
        self.assertEqual(coerced["page"]["columns"], 2)
        self.assertIsNone(coerced["page"]["stationery_asset"])
        self.assertEqual(coerced["page"]["background_hex"], "#112233")
        self.assertEqual(coerced["palette"]["page_bg"], "#112233")
        self.assertEqual(coerced["palette"]["accent"], "#AABBCC")
        self.assertEqual(coerced["palette"]["text"], "#1A334C")
        self.assertEqual(coerced["palette"]["heading"], DEFAULT_DESIGN_SPEC["palette"]["heading"])
        self.assertEqual(coerced["typography"]["h1"]["color"], "#FF00AA")
        self.assertEqual(coerced["typography"]["h1"]["decoration"], "band")
        self.assertEqual(coerced["header"]["logo_asset"], "assets/logo.png")
        self.assertEqual(coerced["sections_blueprint"], ["Resumen Ejecutivo", "Conclusiones"])

    def test_merge_design_spec_preserves_false_none_and_resolved_assets(self) -> None:
        base = normalize_design_spec(
            {
                "palette": {"accent": "#059669"},
                "header": {"enabled": True, "logo_asset": "assets/logo.png", "left": "{title}"},
                "footer": {"enabled": True},
                "typography": {"h1": {"color": "#059669", "decoration": "underline"}},
            }
        )
        base["_skill_slug"] = "mi-estilo"
        base["_skill_dir"] = "/tmp/mi-estilo"
        base["_resolved_assets"] = {
            "logo_asset": "/tmp/mi-estilo/assets/logo.png",
            "stationery_asset": "/tmp/mi-estilo/assets/bg.pdf",
        }
        base["page"]["stationery_asset"] = "assets/bg.pdf"

        merged = merge_design_spec(
            base,
            {
                "palette": {"page_bg": "#0F172A"},
                "header": {"enabled": False, "logo_asset": None},
                "footer": {"enabled": False},
                "typography": {"h1": {"color": None, "decoration": "plain"}},
                "page": {"size_name": "a4"},
            },
        )
        self.assertFalse(merged["header"]["enabled"])
        self.assertFalse(merged["footer"]["enabled"])
        self.assertIsNone(merged["header"]["logo_asset"])
        self.assertEqual(merged["header"]["left"], "{title}")
        self.assertIsNone(merged["typography"]["h1"]["color"])
        self.assertEqual(merged["typography"]["h1"]["decoration"], "plain")
        self.assertEqual(merged["palette"]["accent"], "#059669")
        self.assertEqual(merged["page"]["background_hex"], "#0F172A")
        self.assertEqual(merged["palette"]["page_bg"], "#0F172A")
        self.assertEqual(merged["page"]["size_name"], "a4")
        self.assertAlmostEqual(merged["page"]["width_pt"], 595.28, delta=0.5)
        self.assertEqual(merged["_skill_slug"], "mi-estilo")
        self.assertNotIn("logo_asset", merged["_resolved_assets"])
        self.assertIn("stationery_asset", merged["_resolved_assets"])

    def test_pdf_color_conversions(self) -> None:
        self.assertEqual(_pdf_color_to_hex(0.5), "#808080")
        self.assertEqual(_pdf_color_to_hex((0.0,)), "#000000")
        self.assertEqual(_pdf_color_to_hex((1.0, 0.0, 0.0)), "#FF0000")
        self.assertEqual(_pdf_color_to_hex((0.0, 1.0, 1.0, 0.0)), "#FF0000")
        self.assertEqual(_pdf_color_to_hex((0.0, 0.0, 0.0, 1.0)), "#000000")
        self.assertEqual(_pdf_color_to_hex("#0d9488"), "#0D9488")


class InspectorPdfExtractionTests(unittest.TestCase):
    def test_inspect_corporate_report_with_cover_logo_and_ram_previews(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            logo_path = _make_sample_logo_png(tmp_dir / "src_logo.png")
            pdf_path = _build_corporate_report_pdf(tmp_dir / "reporte_corporativo.pdf", logo_path)
            assets_dir = tmp_dir / "skill" / "assets"

            res = inspect_pdf_design(
                pdf_path,
                sample_pages=4,
                extract_assets=True,
                assets_dir=assets_dir,
                include_preview_images=True,
                max_preview_pages=2,
            )

            self.assertTrue(res["ok"], res.get("error"))
            self.assertEqual(res["page_count"], 3)
            self.assertFalse(res["is_scanned_or_low_text"])
            self.assertGreaterEqual(res["confidence"], 0.8)

            spec = res["design_spec"]
            self.assertEqual(spec["page"]["size_name"], "letter")
            self.assertEqual(spec["page"]["orientation"], "portrait")
            self.assertEqual(spec["page"]["columns"], 1)
            self.assertEqual(spec["palette"]["page_bg"], "#FFFFFF")
            self.assertLess(_color_distance(spec["palette"]["accent"], "#0D9488"), 12.0)
            self.assertEqual(spec["typography"]["body_family"], "sans")
            self.assertAlmostEqual(spec["typography"]["body_size"], 10.0, delta=0.5)
            self.assertEqual(spec["typography"]["h1"]["decoration"], "underline")

            self.assertTrue(spec["header"]["enabled"])
            self.assertTrue(spec["header"]["skip_first_page"])
            self.assertTrue(spec["header"]["border_bottom"])
            self.assertTrue(spec["footer"]["enabled"])
            self.assertTrue(spec["footer"]["skip_first_page"])
            self.assertTrue(spec["footer"]["border_top"])
            self.assertEqual(spec["footer"]["right"], "Página {page} de {total}")

            self.assertTrue(spec["cover"]["enabled"])
            self.assertTrue(spec["cover"]["top_band"])
            self.assertEqual(spec["tables"]["style"], "striped")
            self.assertEqual(spec["palette"]["table_head_bg"], "#0F172A")

            # Preview images en RAM (JPEG base64, máximo 2 páginas)
            self.assertEqual(len(res["preview_images"]), 2)
            for pv in res["preview_images"]:
                self.assertTrue(pv["data_url"].startswith("data:image/jpeg;base64,"))
                self.assertLessEqual(pv["width"], 900)

            # Logo extraído en assets/logo.png y ninguna captura cruda de página guardada
            self.assertEqual(spec["header"]["logo_asset"], "assets/logo.png")
            self.assertTrue((assets_dir / "logo.png").is_file())
            self.assertEqual(len(list(tmp_dir.glob("*.jpg"))), 0)
            self.assertEqual(len(list(tmp_dir.glob("*.jpeg"))), 0)

    def test_inspect_academic_two_column_a4_serif_justified(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            pdf_path = _build_academic_two_col_a4_pdf(Path(tmp) / "articulo_academico.pdf")
            res = inspect_pdf_design(pdf_path, include_preview_images=False)

            self.assertTrue(res["ok"], res.get("error"))
            spec = res["design_spec"]
            self.assertEqual(spec["page"]["size_name"], "a4")
            self.assertEqual(spec["page"]["columns"], 2)
            self.assertGreaterEqual(spec["page"]["column_gap_pt"], 12.0)
            self.assertEqual(spec["typography"]["body_family"], "serif")
            self.assertEqual(spec["typography"]["body_align"], "justify")
            self.assertEqual(spec["typography"]["h1"]["decoration"], "left_bar")
            self.assertFalse(spec["header"]["enabled"])
            self.assertFalse(spec["footer"]["enabled"])
            self.assertEqual(spec["document_type"], "academic")
            self.assertEqual(res["preview_images"], [])

    def test_inspect_dark_landscape_border_and_band_heading(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            pdf_path = _build_dark_landscape_pdf(Path(tmp) / "presentacion_oscura.pdf")
            res = inspect_pdf_design(pdf_path, include_preview_images=False)

            self.assertTrue(res["ok"], res.get("error"))
            spec = res["design_spec"]
            self.assertEqual(spec["page"]["orientation"], "landscape")
            self.assertEqual(spec["page"]["background_hex"], "#0B1120")
            self.assertEqual(spec["palette"]["page_bg"], "#0B1120")
            self.assertTrue(spec["page"]["border"]["enabled"])
            self.assertLess(_color_distance(spec["palette"]["accent"], "#38BDF8"), 12.0)
            self.assertLess(_color_distance(spec["palette"]["text"], "#E2E8F0"), 12.0)
            self.assertEqual(spec["typography"]["h1"]["decoration"], "band")
            self.assertTrue(spec["typography"]["h1"]["uppercase"])

    def test_inspect_scanned_pdf_pixel_fallback_and_zero_disk_writes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            pdf_path = _build_scanned_image_only_pdf(tmp_dir / "escaneado.pdf", tmp_dir)
            before_files = set(tmp_dir.rglob("*"))

            res = inspect_pdf_design(
                pdf_path,
                extract_assets=False,
                include_preview_images=True,
                max_preview_pages=1,
            )
            after_files = set(tmp_dir.rglob("*"))

            self.assertEqual(before_files, after_files)
            self.assertTrue(res["ok"], res.get("error"))
            self.assertTrue(res["is_scanned_or_low_text"])
            self.assertTrue(res["warnings"])
            self.assertEqual(len(res["preview_images"]), 1)
            spec = res["design_spec"]
            # Debe haber detectado fondo crema cálido (#F5EFE6) y tono acento vino (#8B1E3F)
            self.assertLess(_color_distance(spec["palette"]["page_bg"], "#F5EFE6"), 24.0)
            self.assertLess(_color_distance(spec["palette"]["accent"], "#8B1E3F"), 32.0)

    def test_privacy_strips_pii_from_design_spec_and_sections_blueprint(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            pdf_path = _build_pii_heavy_pdf(Path(tmp) / "cotizacion_sensible.pdf")
            res = inspect_pdf_design(pdf_path, include_preview_images=False)

            self.assertTrue(res["ok"], res.get("error"))
            spec = res["design_spec"]
            serialized = json.dumps(spec, ensure_ascii=False).lower()

            for forbidden in (
                "juan.perez",
                "acme",
                "1234 5678",
                "maría gonzález",
                "gomm850101abc",
                "14,500",
                "reforma 222",
                tmp.lower(),
            ):
                self.assertNotIn(forbidden, serialized)

            self.assertEqual(spec["source_pdf"], "cotizacion_sensible.pdf")
            self.assertIn("Resumen de Servicios", spec["sections_blueprint"])
            self.assertIn("Condiciones Comerciales", spec["sections_blueprint"])
            self.assertIn("Alcance del Proyecto", spec["sections_blueprint"])

    def test_inspect_burgundy_serif_custom_margins_and_bordered_table(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            pdf_path = Path(tmp) / "boletin_vino.pdf"
            w, h = letter
            c = rl_canvas.Canvas(str(pdf_path), pagesize=letter)
            for pnum in (1, 2):
                # Sin header, solo footer con regla
                c.setStrokeColor(colors.HexColor("#D6D3D1"))
                c.setLineWidth(0.75)
                c.line(76, 42, w - 76, 42)
                c.setFillColor(colors.HexColor("#78716C"))
                c.setFont("Times-Roman", 8.5)
                c.drawRightString(w - 76, 28, f"{pnum} / 2")

                y = h - 78
                c.setFillColor(colors.HexColor("#8B1E3F"))
                c.setFont("Times-Bold", 17)
                c.drawString(76, y, "Panorama General" if pnum == 1 else "Detalle Trimestral")
                y -= 26
                c.setFillColor(colors.HexColor("#292524"))
                c.setFont("Times-Roman", 11)
                for _ in range(4):
                    c.drawString(76, y, "Análisis editorial impreso con tipografía clásica serif y márgenes amplios.")
                    y -= 16

                if pnum == 1:
                    tbl = Table(
                        [
                            ["Concepto", "Periodo", "Variación"],
                            ["Ingresos", "T1", "+12%"],
                            ["Operación", "T1", "-4%"],
                            ["Margen", "T1", "+8%"],
                        ],
                        colWidths=[180, 140, 140],
                    )
                    tbl.setStyle(
                        TableStyle(
                            [
                                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#8B1E3F")),
                                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                                ("FONTNAME", (0, 0), (-1, 0), "Times-Bold"),
                                ("FONTNAME", (0, 1), (-1, -1), "Times-Roman"),
                                ("FONTSIZE", (0, 0), (-1, -1), 9.5),
                                ("GRID", (0, 0), (-1, -1), 0.75, colors.HexColor("#D6D3D1")),
                            ]
                        )
                    )
                    _, th = tbl.wrapOn(c, w - 152, 240)
                    tbl.drawOn(c, 76, y - th - 10)
                c.showPage()
            c.save()

            res = inspect_pdf_design(pdf_path, include_preview_images=True, max_preview_pages=2)
            self.assertTrue(res["ok"], res.get("error"))
            spec = res["design_spec"]
            self.assertEqual(spec["typography"]["body_family"], "serif")
            self.assertAlmostEqual(spec["typography"]["body_size"], 11.0, delta=0.5)
            self.assertLess(_color_distance(spec["palette"]["accent"], "#8B1E3F"), 10.0)
            self.assertAlmostEqual(spec["page"]["margins_pt"]["left"], 76.0, delta=4.0)
            self.assertFalse(spec["header"]["enabled"])
            self.assertTrue(spec["footer"]["enabled"])
            self.assertFalse(spec["footer"]["skip_first_page"])
            self.assertEqual(spec["footer"]["right"], "{page} / {total}")
            self.assertEqual(spec["tables"]["style"], "bordered")
            self.assertEqual(spec["palette"]["table_head_bg"], "#8B1E3F")
            self.assertEqual(len(res["preview_images"]), 2)

    def test_inspect_sparse_ragged_left_margins_with_rules_table_and_footer(self) -> None:
        """Verifica que márgenes derecho e inferior sean fieles en páginas parcialmente llenas y texto ragged-left."""
        with tempfile.TemporaryDirectory() as tmp:
            pdf_path = Path(tmp) / "resumen_corto.pdf"
            w, h = letter  # 612 x 792
            left_m, right_m, top_m, footer_rule_y = 72.0, 68.0, 64.0, 46.0
            content_w = w - left_m - right_m  # 472.0 -> x = 72..544

            c = rl_canvas.Canvas(str(pdf_path), pagesize=letter)
            for pnum in (1, 2):
                # Regla de pie a 46pt del borde inferior (sin header)
                c.setStrokeColor(colors.HexColor("#CBD5E1"))
                c.setLineWidth(0.75)
                c.line(left_m, footer_rule_y, w - right_m, footer_rule_y)
                c.setFillColor(colors.HexColor("#64748B"))
                c.setFont("Times-Roman", 8.5)
                c.drawRightString(w - right_m, 30, f"Página {pnum} de 2")

                # Encabezado subrayado spanning x=72..544
                y = h - top_m - 14
                c.setFillColor(colors.HexColor("#8B1E3F"))
                c.setFont("Times-Bold", 15)
                c.drawString(left_m, y, "Resumen Operativo" if pnum == 1 else "Siguientes Pasos")
                c.setStrokeColor(colors.HexColor("#8B1E3F"))
                c.setLineWidth(1.0)
                c.line(left_m, y - 5, w - right_m, y - 5)

                # Líneas cortas alineadas a la izquierda (ragged-left, página medio vacía)
                y -= 26
                c.setFillColor(colors.HexColor("#1E293B"))
                c.setFont("Times-Roman", 10.5)
                for txt in (
                    "Texto breve alineado a la izquierda que termina mucho antes del borde derecho.",
                    "Segunda línea corta con margen real de sesenta y ocho puntos.",
                    "Tercera línea de cierre del resumen.",
                ):
                    c.drawString(left_m, y, txt)
                    y -= 15

                if pnum == 1:
                    tbl = Table(
                        [
                            ["Concepto", "Detalle", "Estado"],
                            ["Fase inicial", "Revisión documental", "Listo"],
                            ["Entrega final", "Validación completa", "En curso"],
                        ],
                        colWidths=[content_w * 0.3, content_w * 0.45, content_w * 0.25],
                    )
                    tbl.setStyle(
                        TableStyle(
                            [
                                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#8B1E3F")),
                                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                                ("GRID", (0, 0), (-1, -1), 0.6, colors.HexColor("#CBD5E1")),
                                ("FONTSIZE", (0, 0), (-1, -1), 9),
                            ]
                        )
                    )
                    _, th = tbl.wrapOn(c, content_w, 200)
                    tbl.drawOn(c, left_m, y - th - 12)
                c.showPage()
            c.save()

            res = inspect_pdf_design(pdf_path, include_preview_images=False)
            self.assertTrue(res["ok"], res.get("error"))
            margins = res["design_spec"]["page"]["margins_pt"]
            self.assertAlmostEqual(margins["left"], 72.0, delta=4.0)
            self.assertAlmostEqual(margins["right"], 68.0, delta=4.0)
            self.assertAlmostEqual(margins["top"], 64.0, delta=6.0)
            self.assertAlmostEqual(margins["bottom"], 62.0, delta=8.0)

            # También validar fallback simétrico en página corta ragged-left SIN reglas ni tablas ni footer
            no_struct_pdf = Path(tmp) / "nota_simple.pdf"
            c2 = rl_canvas.Canvas(str(no_struct_pdf), pagesize=letter)
            c2.setFillColor(colors.HexColor("#1E293B"))
            c2.setFont("Helvetica", 10.5)
            y2 = h - 66
            for txt in (
                "Nota ejecutiva breve sin reglas ni tabla.",
                "Contenido corto con alineación izquierda.",
                "Cierre de una sola página.",
            ):
                c2.drawString(70, y2, txt)
                y2 -= 16
            c2.showPage()
            c2.save()

            res2 = inspect_pdf_design(no_struct_pdf, include_preview_images=False)
            self.assertTrue(res2["ok"], res2.get("error"))
            m2 = res2["design_spec"]["page"]["margins_pt"]
            self.assertAlmostEqual(m2["left"], 70.0, delta=3.0)
            self.assertAlmostEqual(m2["right"], 70.0, delta=3.0)
            self.assertLessEqual(m2["bottom"], 72.0)

    def test_error_handling_missing_and_encrypted_pdf(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            missing = inspect_pdf_design(tmp_dir / "no_existe.pdf")
            self.assertFalse(missing["ok"])

            plain_pdf = _build_academic_two_col_a4_pdf(tmp_dir / "plain.pdf")
            enc_pdf = tmp_dir / "encrypted.pdf"
            reader = PdfReader(str(plain_pdf))
            writer = PdfWriter()
            for page in reader.pages:
                writer.add_page(page)
            writer.encrypt("secreto123")
            with enc_pdf.open("wb") as fh:
                writer.write(fh)

            enc_res = inspect_pdf_design(enc_pdf)
            self.assertFalse(enc_res["ok"])
            self.assertIn("contraseña", enc_res["error"].lower())


class InspectorBundleAndResolutionTests(unittest.TestCase):
    def test_save_bundle_and_resolve_with_precedence_and_traversal_protection(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            global_dir = root / "global-skills"
            workspace_dir = root / "workspace"
            ws_skills_dir = workspace_dir / "habilidades"

            logo_src = _make_sample_logo_png(root / "brand.png")
            pdf_src = _build_corporate_report_pdf(root / "plantilla.pdf", logo_src)

            inspected = inspect_pdf_design(pdf_src, include_preview_images=False)
            self.assertTrue(inspected["ok"])

            # Guardar en habilidades del workspace
            ws_skill_dir = ws_skills_dir / "reporte-corporativo"
            ws_spec = merge_design_spec(
                inspected["design_spec"],
                {"name": "Reporte Corporativo", "palette": {"accent": "#DC2626"}},
            )
            saved_ws = save_design_skill_bundle(
                ws_skill_dir,
                ws_spec,
                source_pdf=pdf_src,
                extract_assets=True,
            )
            self.assertTrue(saved_ws["ok"])
            self.assertTrue((ws_skill_dir / "design-spec.json").is_file())
            self.assertTrue((ws_skill_dir / "assets" / "logo.png").is_file())
            # Sin archivos temporales residuales
            self.assertEqual([p.name for p in ws_skill_dir.glob("*.tmp.*")], [])

            # El JSON en disco no debe contener claves internas `_`
            disk_json = json.loads((ws_skill_dir / "design-spec.json").read_text(encoding="utf-8"))
            self.assertFalse(any(k.startswith("_") for k in disk_json))

            # Resolver por nombre legible desde workspace cuando global no lo tiene
            resolved_ws = resolve_design_skill_spec(
                "Reporte Corporativo",
                workspace_root=workspace_dir,
                global_skills_dir=global_dir,
            )
            self.assertIsNotNone(resolved_ws)
            assert resolved_ws is not None
            self.assertEqual(resolved_ws["palette"]["accent"], "#DC2626")
            self.assertEqual(resolved_ws["_skill_slug"], "reporte-corporativo")
            self.assertEqual(resolved_ws["_skill_dir"], str(ws_skill_dir.resolve()))
            self.assertIn("logo_asset", resolved_ws["_resolved_assets"])
            logo_resolved = Path(resolved_ws["_resolved_assets"]["logo_asset"])
            self.assertTrue(logo_resolved.is_absolute())
            self.assertTrue(logo_resolved.is_file())
            self.assertTrue(logo_resolved.is_relative_to(ws_skill_dir.resolve()))

            # Ahora guardar versión global con acento distinto y verificar precedencia global > workspace
            global_skill_dir = global_dir / "reporte-corporativo"
            global_spec = merge_design_spec(ws_spec, {"palette": {"accent": "#0D9488"}})
            save_design_skill_bundle(global_skill_dir, global_spec, extract_assets=False)

            resolved_global = resolve_design_skill_spec(
                "reporte-corporativo",
                workspace_root=workspace_dir,
                global_skills_dir=global_dir,
            )
            self.assertIsNotNone(resolved_global)
            assert resolved_global is not None
            self.assertEqual(resolved_global["palette"]["accent"], "#0D9488")
            self.assertEqual(resolved_global["_skill_dir"], str(global_skill_dir.resolve()))

            # Protección estricta contra path traversal
            for bad_ref in (
                "",
                "../reporte-corporativo",
                "../../etc/passwd",
                "/etc/passwd",
                "foo/bar",
                "foo\\bar",
                "..",
                ".",
            ):
                self.assertIsNone(
                    resolve_design_skill_spec(
                        bad_ref,
                        workspace_root=workspace_dir,
                        global_skills_dir=global_dir,
                    )
                )

            # Incluso si un JSON manipulado intenta escapar en logo_asset, debe ser bloqueado
            secret_file = root / "secret.png"
            secret_file.write_bytes(b"fake")
            tampered_dir = global_dir / "manipulado"
            tampered_dir.mkdir(parents=True, exist_ok=True)
            tampered = normalize_design_spec({})
            tampered["header"]["logo_asset"] = "../../secret.png"
            (tampered_dir / "design-spec.json").write_text(json.dumps(tampered), encoding="utf-8")

            resolved_tampered = resolve_design_skill_spec("manipulado", global_skills_dir=global_dir)
            self.assertIsNotNone(resolved_tampered)
            assert resolved_tampered is not None
            self.assertIsNone(resolved_tampered["header"]["logo_asset"])
            self.assertEqual(resolved_tampered["_resolved_assets"], {})


if __name__ == "__main__":
    unittest.main()
