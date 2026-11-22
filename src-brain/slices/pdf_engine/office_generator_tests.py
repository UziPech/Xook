"""
Tests unitarios e integración para el generador nativo Word (`.docx`) y Excel (`.xlsx`)
de XOOK (`office_generator.py`):
- Generación `.docx` estilizada (serif/Georgia, paleta personalizada, márgenes,
  encabezado/pie con campos nativos PAGE/NUMPAGES, logotipo PNG embebido, 2 columnas,
  borde de página, `kv_grid`, `table` con estilos, `signature_block`, `box`, `callout`,
  `columns`, `code`, formato inline **bold**/*italic*/`code`) + validación XML + lectura
  limpia con `office_reader.read_universal_document`.
- Generación `.xlsx` estilizada (múltiples hojas, banner de título combinado, cabecera con
  color/fuente, filas cebra, formatos numéricos currency/percent/integer/date, fórmulas
  reales `<f>` y `totals_row=True` con `SUM(...)`, paneles congelados, autofiltro, anchos de
  columna, orientación landscape) + validación XML + lectura con `read_universal_document`.
- Conversión automática fallback para `.xlsx` desde `headers`+`rows` y desde `blocks`.
- Resolución de `design_skill` + `design_overrides` (colores, fuentes, congelado, bordes)
  y replicación cross-format (habilidad PDF/Word aplicada a `.xlsx` y viceversa).
- `edit_action="modify"` preservando `design_spec` en ediciones iterativas de `.docx` y `.xlsx`,
  tanto con metadatos guardados en `.xook/office_specs/` como con archivos externos.
- Dispatcher unificado `generate_office_document`.
"""

from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
from typing import Tuple
import unittest
import xml.etree.ElementTree as ET
import zipfile

_SRC_BRAIN = Path(__file__).resolve().parents[2]
if str(_SRC_BRAIN) not in sys.path:
    sys.path.insert(0, str(_SRC_BRAIN))

if not (Path(__file__).resolve().parent / "office_inspector.py").is_file():
    import types

    sys.modules.setdefault(
        "slices.pdf_engine.office_inspector",
        types.SimpleNamespace(inspect_office_design=lambda *a, **k: {"ok": False}),
    )

from PIL import Image as PILImage

from slices.pdf_engine.inspector import save_design_skill_bundle
from slices.pdf_engine.office_generator import (
    generate_docx_document,
    generate_office_document,
    generate_xlsx_document,
)
from slices.pdf_engine.office_reader import read_universal_document


def _resolve_ws_path(workspace_root: Path, raw_path: str) -> Tuple[Path, str, str]:
    clean = str(raw_path or "").strip().lstrip("/")
    abs_p = (workspace_root / clean).resolve()
    ws_res = workspace_root.resolve()
    if abs_p != ws_res and ws_res not in abs_p.parents:
        raise ValueError("Path outside workspace")
    rel = abs_p.relative_to(ws_res).as_posix()
    top_zone = rel.split("/", 1)[0] if "/" in rel else ""
    return abs_p, rel, top_zone


def _make_sample_logo(path: Path, color_rgb: Tuple[int, int, int] = (30, 64, 175)) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    img = PILImage.new("RGBA", (180, 60), (*color_rgb, 255))
    img.save(path, format="PNG")
    return path


def _assert_all_xml_parts_valid(test_case: unittest.TestCase, zip_path: Path) -> zipfile.ZipFile:
    test_case.assertTrue(zip_path.is_file(), f"Archivo no encontrado: {zip_path}")
    zf = zipfile.ZipFile(zip_path, "r")
    bad = zf.testzip()
    test_case.assertIsNone(bad, f"ZIP corrupto en miembro: {bad}")
    for name in zf.namelist():
        if name.endswith(".xml") or name.endswith(".rels"):
            raw = zf.read(name)
            try:
                ET.fromstring(raw)
            except ET.ParseError as exc:
                test_case.fail(f"XML inválido en {name}: {exc}\n{raw[:400]!r}")
    return zf


class OfficeGeneratorTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory(prefix="xook_office_gen_test_")
        self.ws = Path(self._tmp.name) / "workspace"
        self.ws.mkdir(parents=True, exist_ok=True)
        self.global_skills = Path(self._tmp.name) / "global_skills"
        self.global_skills.mkdir(parents=True, exist_ok=True)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_docx_styled_full_features_and_reader(self) -> None:
        logo_path = _make_sample_logo(self.ws / "agente" / "adjuntos" / "acme_logo.png")
        res = generate_docx_document(
            {
                "title": "Propuesta Ejecutiva 2026",
                "subtitle": "Plan de Expansión Comercial",
                "author": "Dirección General",
                "date": "21 de noviembre de 2026",
                "output_path": "agente/reportes/propuesta_completa.docx",
                "design_spec": {
                    "page": {
                        "size_name": "a4",
                        "orientation": "portrait",
                        "margins_pt": {"top": 64.0, "right": 54.0, "bottom": 60.0, "left": 72.0},
                        "background_hex": "#FFFDF9",
                        "border": {"enabled": True, "color": "#1E40AF", "width_pt": 1.25, "inset_pt": 18.0},
                        "columns": 2,
                        "column_gap_pt": 20.0,
                    },
                    "palette": {
                        "page_bg": "#FFFDF9",
                        "text": "#1F2937",
                        "heading": "#1E3A8A",
                        "muted": "#6B7280",
                        "accent": "#1E40AF",
                        "accent_dark": "#1E3A8A",
                        "accent_soft": "#EFF6FF",
                        "border": "#BFDBFE",
                        "surface": "#F8FAFC",
                        "table_head_bg": "#1E3A8A",
                        "table_head_fg": "#FFFFFF",
                        "table_alt": "#EFF6FF",
                    },
                    "typography": {
                        "body_family": "serif",
                        "heading_family": "serif",
                        "font_hint": "Georgia",
                        "body_size": 11.0,
                        "body_leading": 16.5,
                        "body_align": "justify",
                        "space_after": 8.0,
                        "h1": {"size": 17.0, "leading": 22.0, "uppercase": True, "decoration": "underline"},
                        "h2": {"size": 13.0, "leading": 17.0, "decoration": "left_bar"},
                        "h3": {"size": 11.0, "leading": 15.0, "decoration": "band"},
                    },
                    "header": {
                        "enabled": True,
                        "skip_first_page": True,
                        "border_bottom": True,
                        "left": "{title}",
                        "right": "{author}",
                        "logo_asset": "agente/adjuntos/acme_logo.png",
                        "logo_position": "left",
                        "logo_height_pt": 20.0,
                    },
                    "footer": {
                        "enabled": True,
                        "skip_first_page": True,
                        "border_top": True,
                        "left": "{date}",
                        "right": "Página {page} de {total}",
                    },
                    "tables": {
                        "style": "striped",
                        "header_bg": "#1E3A8A",
                        "header_fg": "#FFFFFF",
                        "alt_row_bg": "#EFF6FF",
                    },
                },
                "blocks": [
                    {"type": "heading", "level": 1, "text": "Resumen Ejecutivo"},
                    {
                        "type": "paragraph",
                        "text": "Este informe incluye texto **en negrita**, énfasis *en cursiva* y código `v2.4` con acentos ñáéíóú.",
                    },
                    {
                        "type": "kv_grid",
                        "title": "Datos del Proyecto",
                        "columns": 2,
                        "items": [
                            {"label": "Cliente", "value": "Industrias Horizonte"},
                            {"label": "Vigencia", "value": "12 meses"},
                        ],
                    },
                    {"type": "heading", "level": 2, "text": "Presupuesto Estimado"},
                    {
                        "type": "table",
                        "headers": ["Concepto", "Unidades", "Monto"],
                        "rows": [
                            ["Consultoría inicial", "2", "$12,000.00"],
                            ["Implementación", "5", "$35,000.00"],
                            ["Total", "7", "$47,000.00"],
                        ],
                        "highlight_last_row": True,
                        "col_widths": [3, 1, 2],
                    },
                    {
                        "type": "bullets",
                        "items": ["Entrega **garantizada** en 4 semanas", "Soporte *dedicado* 24/7"],
                    },
                    {
                        "type": "numbered_list",
                        "items": ["Diagnóstico", "Despliegue", "Validación"],
                    },
                    {"type": "heading", "level": 3, "text": "Notas Clave"},
                    {
                        "type": "box",
                        "title": "Alcance incluido",
                        "text": "Incluye transferencia de conocimiento y documentación técnica.",
                    },
                    {
                        "type": "callout",
                        "tone": "warning",
                        "title": "Importante",
                        "text": "Sujeto a aprobación presupuestal antes de fin de mes.",
                    },
                    {
                        "type": "columns",
                        "columns": [
                            [{"type": "paragraph", "text": "Columna izquierda con detalle operativo."}],
                            [{"type": "paragraph", "text": "Columna derecha con métricas objetivo."}],
                        ],
                    },
                    {
                        "type": "code",
                        "language": "python",
                        "code": "def calcular_roi(ingresos, costo):\n    return (ingresos - costo) / costo",
                    },
                    {"type": "divider"},
                    {
                        "type": "signature_block",
                        "signers": [
                            {"name": "Ana López", "role": "Directora Comercial", "date": "Nov 2026"},
                            {"name": "Carlos Ruiz", "role": "Cliente", "date": "Nov 2026"},
                        ],
                    },
                ],
            },
            workspace_root=self.ws,
            resolve_path_fn=_resolve_ws_path,
        )

        self.assertTrue(res["ok"])
        self.assertEqual(res["format"], "docx")
        self.assertEqual(res["tables_count"], 1)
        self.assertGreater(res["size_bytes"], 2000)
        self.assertTrue(logo_path.is_file())

        docx_abs = self.ws / res["path"]
        with _assert_all_xml_parts_valid(self, docx_abs) as zf:
            names = set(zf.namelist())
            for req in (
                "[Content_Types].xml",
                "_rels/.rels",
                "docProps/core.xml",
                "word/_rels/document.xml.rels",
                "word/styles.xml",
                "word/numbering.xml",
                "word/document.xml",
                "word/header1.xml",
                "word/footer1.xml",
                "word/media/logo.png",
            ):
                self.assertIn(req, names, f"Falta parte OOXML requerida: {req}")

            doc_xml = zf.read("word/document.xml").decode("utf-8")
            styles_xml = zf.read("word/styles.xml").decode("utf-8")
            hdr_xml = zf.read("word/header1.xml").decode("utf-8")
            ftr_xml = zf.read("word/footer1.xml").decode("utf-8")

            # Geometría A4 + márgenes + 2 columnas + borde + titlePg + fondo
            self.assertIn('w:w="11906" w:h="16838"', doc_xml)
            self.assertIn('w:top="1280" w:right="1080" w:bottom="1200" w:left="1440"', doc_xml)
            self.assertIn('w:cols w:num="2"', doc_xml)
            self.assertIn("<w:pgBorders", doc_xml)
            self.assertIn("<w:titlePg/>", doc_xml)
            self.assertIn('<w:background w:color="FFFDF9"/>', doc_xml)

            # Tipografía Georgia, tamaño 11pt (22 half-pt), justificado, uppercase, decoraciones
            self.assertIn('w:ascii="Georgia"', styles_xml)
            self.assertIn('w:sz w:val="22"', styles_xml)
            self.assertIn('w:jc w:val="both"', styles_xml)
            self.assertIn("<w:caps/>", styles_xml)
            self.assertIn('w:color="1E40AF"', styles_xml)
            self.assertIn('w:fill="EFF6FF"', styles_xml)

            # Inline bold / italic / code en documento
            self.assertIn("<w:b/>", doc_xml)
            self.assertIn("<w:i/>", doc_xml)
            self.assertIn('w:ascii="Courier New"', doc_xml)

            # Header con logo y Footer con campos PAGE y NUMPAGES
            self.assertIn("Propuesta Ejecutiva 2026", hdr_xml)
            self.assertIn('r:embed="rIdLogo"', hdr_xml)
            self.assertIn("PAGE", ftr_xml)
            self.assertIn("NUMPAGES", ftr_xml)

        # Lectura limpia con office_reader
        universal = read_universal_document(docx_abs, res["path"])
        self.assertTrue(universal["ok"])
        self.assertEqual(universal["doc_kind"], "word")
        self.assertIn("Resumen Ejecutivo", universal["text"])
        self.assertIn("en negrita", universal["text"])
        self.assertIn("Consultoría inicial", universal["text"])
        self.assertIn("Ana López", universal["text"])
        self.assertGreaterEqual(universal["tables_count"], 1)

    def test_docx_markdown_input(self) -> None:
        res = generate_office_document(
            {
                "format": "docx",
                "title": "Manual Rápido",
                "output_path": "agente/reportes/manual_md.docx",
                "markdown": "# Introducción\n\nTexto con **énfasis**.\n\n- Punto uno\n- Punto dos\n\n| A | B |\n|---|---|\n| 1 | 2 |\n",
            },
            workspace_root=self.ws,
            resolve_path_fn=_resolve_ws_path,
        )
        self.assertTrue(res["ok"])
        self.assertEqual(res["format"], "docx")
        docx_abs = self.ws / res["path"]
        with _assert_all_xml_parts_valid(self, docx_abs):
            pass
        uni = read_universal_document(docx_abs, res["path"])
        self.assertTrue(uni["ok"])
        self.assertIn("Introducción", uni["text"])
        self.assertIn("Punto uno", uni["text"])

    def test_xlsx_styled_multi_sheet_formulas_and_reader(self) -> None:
        res = generate_xlsx_document(
            {
                "title": "Presupuesto Anual 2026",
                "author": "Finanzas XOOK",
                "output_path": "agente/reportes/presupuesto_2026.xlsx",
                "design_spec": {
                    "page": {"size_name": "letter", "orientation": "landscape"},
                    "palette": {
                        "accent": "#0F766E",
                        "heading": "#0F172A",
                        "text": "#1E293B",
                        "border": "#CBD5E1",
                    },
                    "spreadsheet": {
                        "header_bg": "#0F172A",
                        "header_fg": "#FFFFFF",
                        "header_bold": True,
                        "header_font_size": 11.0,
                        "body_font_name": "Calibri",
                        "body_font_size": 10.0,
                        "alt_row_bg": "#F1F5F9",
                        "total_row_bg": "#CCFBF1",
                        "total_row_fg": "#0F172A",
                        "total_row_bold": True,
                        "border_style": "thin",
                        "border_color": "#CBD5E1",
                        "freeze_header": True,
                        "auto_filter": True,
                        "show_gridlines": True,
                        "print_orientation": "landscape",
                    },
                },
                "sheets": [
                    {
                        "name": "Resumen Ventas",
                        "title_banner": "Resumen Financiero Q1",
                        "subtitle": "Cifras en USD",
                        "headers": ["Concepto", "Cantidad", "Precio", "Subtotal", "Margen"],
                        "rows": [
                            ["Licencias Enterprise", 4, 1250.0, "=B4*C4", 0.35],
                            ["Consultoría", 10, 180.0, "=B5*C5", 0.42],
                            ["Soporte Anual", 2, 950.0, "=B6*C6", 0.55],
                        ],
                        "totals_row": True,
                        "col_widths": [28.0, 12.0, 15.0, 16.0, 12.0],
                        "number_formats": {
                            "Cantidad": "integer",
                            "Precio": "currency",
                            "Subtotal": "currency",
                            4: "percent",
                        },
                        "freeze_header": True,
                        "auto_filter": True,
                    },
                    {
                        "name": "Metas / Regiones: 2026",
                        "headers": ["Región", "Meta", "Real", "Cumplimiento"],
                        "rows": [
                            ["Norte", "$50,000.00", "$54,500.00", "=C2/B2"],
                            ["Sur", "$30,000.00", "$28,500.00", "=C3/B3"],
                        ],
                        "totals_row": ["Total Global", "=SUM(B2:B3)", "=SUM(C2:C3)", "=C4/B4"],
                        "number_formats": {1: "currency", 2: "currency", 3: "percent"},
                        "freeze_header": True,
                        "auto_filter": False,
                    },
                ],
            },
            workspace_root=self.ws,
            resolve_path_fn=_resolve_ws_path,
        )

        self.assertTrue(res["ok"])
        self.assertEqual(res["format"], "xlsx")
        self.assertEqual(res["sheets_count"], 2)
        self.assertEqual(res["total_rows"], 5)

        xlsx_abs = self.ws / res["path"]
        with _assert_all_xml_parts_valid(self, xlsx_abs) as zf:
            names = set(zf.namelist())
            for req in (
                "[Content_Types].xml",
                "_rels/.rels",
                "docProps/core.xml",
                "xl/_rels/workbook.xml.rels",
                "xl/workbook.xml",
                "xl/styles.xml",
                "xl/sharedStrings.xml",
                "xl/worksheets/sheet1.xml",
                "xl/worksheets/sheet2.xml",
            ):
                self.assertIn(req, names, f"Falta parte OOXML en xlsx: {req}")

            styles_xml = zf.read("xl/styles.xml").decode("utf-8")
            ws1_xml = zf.read("xl/worksheets/sheet1.xml").decode("utf-8")
            ws2_xml = zf.read("xl/worksheets/sheet2.xml").decode("utf-8")
            wb_xml = zf.read("xl/workbook.xml").decode("utf-8")

            # Verificar fills obligatorios (none + gray125) + colores de estilo
            self.assertIn('patternType="none"', styles_xml)
            self.assertIn('patternType="gray125"', styles_xml)
            self.assertIn('rgb="FF0F172A"', styles_xml)
            self.assertIn('rgb="FFF1F5F9"', styles_xml)
            self.assertIn('rgb="FFCCFBF1"', styles_xml)
            self.assertIn('formatCode="$#,##0.00"', styles_xml)
            self.assertIn('formatCode="0.0%"', styles_xml)
            self.assertIn('style="double"', styles_xml)

            # Verificar banner merge, freeze pane en fila 3 (banner+subtitle+header), autoFilter, landscape
            self.assertIn('<mergeCell ref="A1:E1"/>', ws1_xml)
            self.assertIn('<mergeCell ref="A2:E2"/>', ws1_xml)
            self.assertIn('ySplit="3"', ws1_xml)
            self.assertIn('state="frozen"', ws1_xml)
            self.assertIn('<autoFilter ref="A3:E6"/>', ws1_xml)
            self.assertIn('width="28.0"', ws1_xml)
            self.assertIn('orientation="landscape"', ws1_xml)

            # Verificar fórmulas reales <f> SIN '=' inicial y valores cacheados exactos
            self.assertIn("<f>B4*C4</f><v>5000</v>", ws1_xml)
            self.assertIn("<f>SUM(D4:D6)</f><v>8700</v>", ws1_xml)
            self.assertIn("<f>SUM(B4:B6)</f><v>16</v>", ws1_xml)
            self.assertIn("<f>SUM(B2:B3)</f><v>80000</v>", ws2_xml)
            self.assertIn("<f>SUM(C2:C3)</f><v>83000</v>", ws2_xml)

            # Nombre de hoja 2 saneado sin '/' ni ':'
            self.assertNotIn(":", wb_xml.split("<sheets>")[1].split("</sheets>")[0].replace("r:id", ""))

        # Lectura limpia con office_reader
        uni = read_universal_document(xlsx_abs, res["path"])
        self.assertTrue(uni["ok"])
        self.assertEqual(uni["doc_kind"], "spreadsheet")
        self.assertEqual(len(uni["sheets"]), 2)
        self.assertIn("Resumen Financiero Q1", uni["text"])
        self.assertIn("8700", uni["text"])
        self.assertIn("83000", uni["text"])

    def test_xlsx_fallback_from_blocks_and_top_level_headers_rows(self) -> None:
        res_blocks = generate_office_document(
            {
                "format": "xlsx",
                "title": "Reporte desde Bloques",
                "output_path": "agente/reportes/desde_bloques.xlsx",
                "blocks": [
                    {"type": "heading", "level": 1, "text": "Ventas Mensuales"},
                    {
                        "type": "table",
                        "headers": ["Mes", "Ingreso"],
                        "rows": [["Enero", 1000], ["Febrero", 1500]],
                        "totals_row": True,
                    },
                    {
                        "type": "kv_grid",
                        "title": "Metadata",
                        "items": [{"label": "Moneda", "value": "MXN"}],
                    },
                ],
            },
            workspace_root=self.ws,
            resolve_path_fn=_resolve_ws_path,
        )
        self.assertTrue(res_blocks["ok"])
        self.assertEqual(res_blocks["sheets_count"], 2)
        with _assert_all_xml_parts_valid(self, self.ws / res_blocks["path"]):
            pass

        res_flat = generate_xlsx_document(
            {
                "title": "Lista Plana",
                "output_path": "agente/reportes/lista_plana.xlsx",
                "headers": ["Producto", "Stock"],
                "rows": [["A", 10], ["B", 25]],
                "totals_row": True,
            },
            workspace_root=self.ws,
            resolve_path_fn=_resolve_ws_path,
        )
        self.assertTrue(res_flat["ok"])
        self.assertEqual(res_flat["sheets_count"], 1)
        self.assertEqual(res_flat["total_rows"], 2)

    def test_design_skill_and_overrides_for_docx_and_xlsx(self) -> None:
        # Guardar una habilidad de diseño reutilizable con paleta corporativa y sección spreadsheet
        skill_dir = self.global_skills / "corporativo-azul"
        save_design_skill_bundle(
            skill_dir,
            {
                "name": "Corporativo Azul",
                "slug": "corporativo-azul",
                "palette": {
                    "accent": "#1E40AF",
                    "heading": "#1E3A8A",
                    "table_head_bg": "#1E3A8A",
                    "table_head_fg": "#FFFFFF",
                    "table_alt": "#EFF6FF",
                },
                "typography": {
                    "body_family": "serif",
                    "heading_family": "serif",
                    "font_hint": "Georgia",
                    "body_size": 10.5,
                },
            },
            extract_assets=False,
        )
        # Enriquecer design-spec.json con campos spreadsheet explícitos (simulando habilidad xlsx)
        spec_file = skill_dir / "design-spec.json"
        raw_spec = json.loads(spec_file.read_text(encoding="utf-8"))
        raw_spec["source_format"] = "xlsx"
        raw_spec["spreadsheet"] = {
            "header_bg": "#1E3A8A",
            "header_fg": "#FFFFFF",
            "alt_row_bg": "#EFF6FF",
            "body_font_name": "Georgia",
            "border_style": "thin",
            "freeze_header": True,
        }
        spec_file.write_text(json.dumps(raw_spec, indent=2), encoding="utf-8")

        # 1) Aplicar a `.docx` sobreescribiendo fuente y acento vía `design_overrides`
        res_docx = generate_docx_document(
            {
                "title": "Informe con Skill y Override",
                "output_path": "agente/reportes/skill_override.docx",
                "design_skill": "corporativo-azul",
                "design_overrides": {
                    "palette": {"accent": "#059669"},
                    "typography": {"body_family": "sans", "font_hint": "Calibri"},
                },
                "blocks": [
                    {"type": "heading", "level": 1, "text": "Resultados"},
                    {"type": "paragraph", "text": "Aplicando habilidad con override libre."},
                ],
            },
            workspace_root=self.ws,
            resolve_path_fn=_resolve_ws_path,
            global_skills_dir=self.global_skills,
        )
        self.assertTrue(res_docx["ok"])
        self.assertEqual(res_docx["design_skill"], "corporativo-azul")
        self.assertEqual(res_docx["design_spec"]["palette"]["accent"], "#059669")
        self.assertEqual(res_docx["design_spec"]["typography"]["body_family"], "sans")
        with _assert_all_xml_parts_valid(self, self.ws / res_docx["path"]) as zf:
            styles_xml = zf.read("word/styles.xml").decode("utf-8")
            self.assertIn('w:ascii="Calibri"', styles_xml)
            self.assertIn('w:color="059669"', styles_xml)

        # 2) Aplicar a `.xlsx` sobreescribiendo header_bg, freeze_header y border_style
        res_xlsx = generate_xlsx_document(
            {
                "title": "Excel con Skill y Override",
                "output_path": "agente/reportes/skill_override.xlsx",
                "design_skill": "corporativo-azul",
                "design_overrides": {
                    "spreadsheet": {
                        "header_bg": "#065F46",
                        "freeze_header": False,
                        "border_style": "none",
                    }
                },
                "sheets": [
                    {
                        "name": "Datos",
                        "headers": ["Item", "Valor"],
                        "rows": [["Uno", 100], ["Dos", 200]],
                    }
                ],
            },
            workspace_root=self.ws,
            resolve_path_fn=_resolve_ws_path,
            global_skills_dir=self.global_skills,
        )
        self.assertTrue(res_xlsx["ok"])
        self.assertEqual(res_xlsx["design_skill"], "corporativo-azul")
        self.assertEqual(res_xlsx["design_spec"]["spreadsheet"]["header_bg"], "#065F46")
        self.assertFalse(res_xlsx["design_spec"]["spreadsheet"]["freeze_header"])
        self.assertEqual(res_xlsx["design_spec"]["spreadsheet"]["border_style"], "none")
        with _assert_all_xml_parts_valid(self, self.ws / res_xlsx["path"]) as zf:
            styles_xml = zf.read("xl/styles.xml").decode("utf-8")
            ws_xml = zf.read("xl/worksheets/sheet1.xml").decode("utf-8")
            self.assertIn('rgb="FF065F46"', styles_xml)
            self.assertNotIn('state="frozen"', ws_xml)
            self.assertNotIn('style="thin"', styles_xml)

    def test_modify_preserves_design_spec_for_docx_and_xlsx(self) -> None:
        # --- DOCX: crear con diseño serif + accent #8B1E3F -> modificar contenido sin reenviar design_spec ---
        created_docx = generate_docx_document(
            {
                "title": "Contrato Marco",
                "output_path": "agente/reportes/contrato_marco.docx",
                "design_spec": {
                    "palette": {"accent": "#8B1E3F", "heading": "#4C0519"},
                    "typography": {"body_family": "serif", "font_hint": "Georgia", "body_size": 11.5},
                    "page": {"margins_pt": {"top": 72.0, "right": 60.0, "bottom": 72.0, "left": 80.0}},
                },
                "blocks": [
                    {"type": "heading", "level": 1, "text": "Cláusula Primera"},
                    {"type": "paragraph", "text": "Texto original con monto BORRADOR."},
                ],
            },
            workspace_root=self.ws,
            resolve_path_fn=_resolve_ws_path,
        )
        self.assertTrue(created_docx["ok"])

        modified_docx = generate_office_document(
            {
                "edit_action": "modify",
                "source_path": created_docx["path"],
                "replacements": [{"old": "BORRADOR", "new": "APROBADO"}],
                "append_blocks": [
                    {"type": "heading", "level": 1, "text": "Cláusula Segunda"},
                    {"type": "paragraph", "text": "Cláusula agregada preservando el diseño."},
                ],
            },
            workspace_root=self.ws,
            resolve_path_fn=_resolve_ws_path,
        )
        self.assertTrue(modified_docx["ok"])
        self.assertEqual(modified_docx["path"], created_docx["path"])
        self.assertEqual(modified_docx["design_spec"]["palette"]["accent"], "#8B1E3F")
        self.assertEqual(modified_docx["design_spec"]["typography"]["body_family"], "serif")
        self.assertEqual(modified_docx["design_spec"]["page"]["margins_pt"]["left"], 80.0)

        uni_docx = read_universal_document(self.ws / modified_docx["path"], modified_docx["path"])
        self.assertIn("APROBADO", uni_docx["text"])
        self.assertNotIn("BORRADOR", uni_docx["text"])
        self.assertIn("Cláusula Segunda", uni_docx["text"])

        # --- XLSX: crear con header_bg #7C2D12 -> modificar añadiendo fila y conservando diseño ---
        created_xlsx = generate_xlsx_document(
            {
                "title": "Flujo de Caja",
                "output_path": "agente/reportes/flujo_caja.xlsx",
                "design_spec": {
                    "spreadsheet": {
                        "header_bg": "#7C2D12",
                        "header_fg": "#FFFFFF",
                        "alt_row_bg": "#FFF7ED",
                        "freeze_header": True,
                        "auto_filter": True,
                    }
                },
                "sheets": [
                    {
                        "name": "Flujo",
                        "headers": ["Concepto", "Monto"],
                        "rows": [["Ventas", 5000], ["Servicios", 2500]],
                        "totals_row": True,
                        "number_formats": {1: "currency"},
                    }
                ],
            },
            workspace_root=self.ws,
            resolve_path_fn=_resolve_ws_path,
        )
        self.assertTrue(created_xlsx["ok"])

        modified_xlsx = generate_office_document(
            {
                "edit_action": "modify",
                "source_path": created_xlsx["path"],
                "append_rows": [["Bonos", 1500]],
            },
            workspace_root=self.ws,
            resolve_path_fn=_resolve_ws_path,
        )
        self.assertTrue(modified_xlsx["ok"])
        self.assertEqual(modified_xlsx["path"], created_xlsx["path"])
        self.assertEqual(modified_xlsx["total_rows"], 3)
        self.assertEqual(modified_xlsx["design_spec"]["spreadsheet"]["header_bg"], "#7C2D12")
        self.assertEqual(modified_xlsx["design_spec"]["spreadsheet"]["alt_row_bg"], "#FFF7ED")
        self.assertTrue(modified_xlsx["design_spec"]["spreadsheet"]["auto_filter"])

        with _assert_all_xml_parts_valid(self, self.ws / modified_xlsx["path"]) as zf:
            styles_xml = zf.read("xl/styles.xml").decode("utf-8")
            ws_xml = zf.read("xl/worksheets/sheet1.xml").decode("utf-8")
            self.assertIn('rgb="FF7C2D12"', styles_xml)
            self.assertIn("<f>SUM(B2:B4)</f><v>9000</v>", ws_xml)

        uni_xlsx = read_universal_document(self.ws / modified_xlsx["path"], modified_xlsx["path"])
        self.assertIn("Bonos", uni_xlsx["text"])
        self.assertIn("9000", uni_xlsx["text"])

    def test_cross_format_skill_and_external_file_modify_fallback(self) -> None:
        # 1) Habilidad de diseño creada desde PDF/Word (sin bloque spreadsheet explícito)
        #    aplicada para generar un Excel coordinado visualmente.
        skill_dir = self.global_skills / "editorial-vino"
        save_design_skill_bundle(
            skill_dir,
            {
                "name": "Editorial Vino",
                "slug": "editorial-vino",
                "page": {"orientation": "landscape"},
                "palette": {
                    "accent": "#8B1E3F",
                    "heading": "#4C0519",
                    "table_head_bg": "#4C0519",
                    "table_head_fg": "#FFFFFF",
                    "table_alt": "#FDF2F8",
                },
                "typography": {
                    "body_family": "serif",
                    "font_hint": "Georgia",
                    "body_size": 11.0,
                },
            },
            extract_assets=False,
        )

        xlsx_cross = generate_xlsx_document(
            {
                "title": "Tabulador Editorial",
                "output_path": "agente/reportes/cross_format.xlsx",
                "design_skill": "editorial-vino",
                "sheets": [
                    {
                        "name": "Tarifas",
                        "title_banner": "Tarifario 2026",
                        "headers": ["Servicio", "Costo"],
                        "rows": [["Edición", 1200], ["Corrección", 800]],
                        "totals_row": True,
                    }
                ],
            },
            workspace_root=self.ws,
            resolve_path_fn=_resolve_ws_path,
            global_skills_dir=self.global_skills,
        )
        self.assertTrue(xlsx_cross["ok"])
        self.assertEqual(xlsx_cross["design_spec"]["spreadsheet"]["header_bg"], "#4C0519")
        self.assertEqual(xlsx_cross["design_spec"]["spreadsheet"]["alt_row_bg"], "#FDF2F8")
        self.assertEqual(xlsx_cross["design_spec"]["spreadsheet"]["body_font_name"], "Georgia")
        self.assertEqual(xlsx_cross["design_spec"]["spreadsheet"]["print_orientation"], "landscape")

        # 2) Borrar `.xook/office_specs/` para simular archivo `.xlsx` externo subido por el usuario
        #    y verificar que `edit_action="modify"` reconstruye hojas, fórmulas y banner del XML.
        specs_dir = self.ws / ".xook" / "office_specs"
        if specs_dir.is_dir():
            for f in specs_dir.glob("*.json"):
                f.unlink()

        ext_mod = generate_office_document(
            {
                "edit_action": "modify",
                "source_path": xlsx_cross["path"],
                "append_rows": [["Maquetación", 1000]],
                "design_overrides": {"spreadsheet": {"header_bg": "#1E3A8A"}},
            },
            workspace_root=self.ws,
            resolve_path_fn=_resolve_ws_path,
        )
        self.assertTrue(ext_mod["ok"])
        self.assertEqual(ext_mod["total_rows"], 3)
        self.assertEqual(ext_mod["design_spec"]["spreadsheet"]["header_bg"], "#1E3A8A")
        with _assert_all_xml_parts_valid(self, self.ws / ext_mod["path"]) as zf:
            ws_xml = zf.read("xl/worksheets/sheet1.xml").decode("utf-8")
            self.assertIn("<f>SUM(B3:B5)</f><v>3000</v>", ws_xml)


if __name__ == "__main__":
    unittest.main()
