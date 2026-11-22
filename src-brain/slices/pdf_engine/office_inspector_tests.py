"""
Pruebas unitarias e integrales para `slices.pdf_engine.office_inspector` y el
despacho universal `inspect_document_design` en `slices.pdf_engine.inspector`.
"""

from __future__ import annotations

import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
import zipfile

from PIL import Image, ImageDraw

# Asegurar que `src-brain` esté en sys.path cuando se ejecuta directamente con unittest
_SRC_BRAIN = Path(__file__).resolve().parents[2]
if str(_SRC_BRAIN) not in sys.path:
    sys.path.insert(0, str(_SRC_BRAIN))

from slices.pdf_engine import (
    DEFAULT_DESIGN_SPEC,
    inspect_document_design,
    inspect_office_design,
    merge_design_spec,
    normalize_design_spec,
    resolve_design_skill_spec,
    save_design_skill_bundle,
)
from slices.pdf_engine.inspector import _color_distance
from slices.pdf_engine.office_inspector import _apply_xl_tint, _resolve_xl_color


def _make_logo_bytes(bg=(30, 64, 175), fg=(255, 255, 255)) -> bytes:
    img = Image.new("RGBA", (160, 56), (*bg, 255))
    draw = ImageDraw.Draw(img)
    draw.rectangle([10, 10, 46, 46], fill=(*fg, 255))
    draw.ellipse([60, 12, 98, 44], outline=(*fg, 255), width=3)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _build_styled_docx_fixture(docx_path: Path) -> Path:
    """
    Construye un archivo `.docx` OOXML 100% válido con:
    - Tema (`word/theme/theme1.xml`) con `accent1=#1E40AF` y fuente `Georgia`.
    - Estilos (`word/styles.xml`) con `Normal` (Georgia 11pt, `#1E293B`, justificado),
      `Heading1` (Georgia 18pt, `accent1`, mayúsculas, borde inferior -> `underline`),
      `Heading2` (Georgia 14pt, `#0F172A`, borde izquierdo -> `left_bar`).
    - Geometría (`w:sectPr`): A4 horizontal (`16838x11906` twips), márgenes personalizados
      (`top=64pt, right=56pt, bottom=54pt, left=72pt`), 2 columnas (`space=20pt`),
      borde de página activo y `w:titlePg` (`different_first_page=True`).
    - Header con logo embebido (`word/media/image1.png`), regla inferior y PII.
    - Footer con regla superior, teléfono PII a la izquierda y campos `PAGE`/`NUMPAGES` a la derecha.
    - Tabla estilizada (`#1E40AF` cabecera, `#EFF6FF` filas alternas, bordes `#CBD5E1`).
    - Encabezados con PII para verificar filtrado estricto en `sections_blueprint`.
    """
    theme_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="XookEditorial">
  <a:themeElements>
    <a:clrScheme name="XookColors">
      <a:dk1><a:srgbClr val="0F172A"/></a:dk1>
      <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="1E293B"/></a:dk2>
      <a:lt2><a:srgbClr val="F8FAFC"/></a:lt2>
      <a:accent1><a:srgbClr val="1E40AF"/></a:accent1>
      <a:accent2><a:srgbClr val="0D9488"/></a:accent2>
      <a:accent3><a:srgbClr val="64748B"/></a:accent3>
      <a:accent4><a:srgbClr val="F59E0B"/></a:accent4>
      <a:accent5><a:srgbClr val="3B82F6"/></a:accent5>
      <a:accent6><a:srgbClr val="10B981"/></a:accent6>
      <a:hlink><a:srgbClr val="2563EB"/></a:hlink>
      <a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="XookFonts">
      <a:majorFont><a:latin typeface="Georgia"/></a:majorFont>
      <a:minorFont><a:latin typeface="Georgia"/></a:minorFont>
    </a:fontScheme>
  </a:themeElements>
</a:theme>"""

    styles_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/>
        <w:sz w:val="22"/>
        <w:color w:val="1E293B"/>
      </w:rPr>
    </w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:pPr>
      <w:jc w:val="both"/>
      <w:spacing w:after="160" w:line="320" w:lineRule="exact"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/>
      <w:sz w:val="22"/>
      <w:color w:val="1E293B"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:jc w:val="left"/>
      <w:pBdr>
        <w:bottom w:val="single" w:sz="12" w:space="4" w:color="1E40AF"/>
      </w:pBdr>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:caps/>
      <w:sz w:val="36"/>
      <w:color w:val="auto" w:themeColor="accent1"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:jc w:val="left"/>
      <w:pBdr>
        <w:left w:val="single" w:sz="18" w:space="6" w:color="1E40AF"/>
      </w:pBdr>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="28"/>
      <w:color w:val="0F172A"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:basedOn w:val="Normal"/>
    <w:rPr>
      <w:b/>
      <w:sz w:val="24"/>
      <w:color w:val="1E293B"/>
    </w:rPr>
  </w:style>
</w:styles>"""

    header_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
       xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:p>
    <w:pPr>
      <w:jc w:val="left"/>
      <w:pBdr><w:bottom w:val="single" w:sz="6" w:color="CBD5E1"/></w:pBdr>
    </w:pPr>
    <w:r>
      <w:drawing>
        <wp:inline>
          <wp:extent cx="914400" cy="355600"/>
          <a:graphic>
            <a:graphicData>
              <a:blip r:embed="rIdLogo1"/>
            </a:graphicData>
          </a:graphic>
        </wp:inline>
      </w:drawing>
    </w:r>
    <w:r><w:t>ACME Corporativo S.A. de C.V. - confidencial@acme.mx</w:t></w:r>
    <w:r><w:tab/><w:t>Dirección Jurídica</w:t></w:r>
  </w:p>
</w:hdr>"""

    header_rels_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdLogo1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>"""

    footer_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p>
    <w:pPr>
      <w:pBdr><w:top w:val="single" w:sz="6" w:color="CBD5E1"/></w:pBdr>
    </w:pPr>
    <w:r><w:t>Tel: +52 55 1234 5678</w:t></w:r>
    <w:r><w:tab/></w:r>
    <w:r><w:t>Página </w:t></w:r>
    <w:r><w:instrText> PAGE </w:instrText></w:r>
    <w:r><w:t> de </w:t></w:r>
    <w:r><w:instrText> NUMPAGES </w:instrText></w:r>
  </w:p>
</w:ftr>"""

    document_rels_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdHdr1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
  <Relationship Id="rIdFtr1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
</Relationships>"""

    document_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>1. Resumen Ejecutivo</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Normal"/></w:pPr>
      <w:r><w:t>Este documento evalúa la arquitectura operativa y los lineamientos estratégicos del periodo con texto editorial justificado en dos columnas.</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>Cliente: María González</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading2"/></w:pPr>
      <w:r><w:t>RFC: GOMM850101ABC</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading2"/></w:pPr>
      <w:r><w:t>Total a pagar: $48,500.00 MXN</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading2"/></w:pPr>
      <w:r><w:t>2. Metodología y Alcance</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Normal"/></w:pPr>
      <w:r><w:t>Se establecieron métricas de seguimiento continuo con revisiones trimestrales y controles de calidad verificables.</w:t></w:r>
    </w:p>
    <w:tbl>
      <w:tblPr>
        <w:tblBorders>
          <w:top w:val="single" w:sz="4" w:color="CBD5E1"/>
          <w:bottom w:val="single" w:sz="4" w:color="CBD5E1"/>
          <w:insideH w:val="single" w:sz="4" w:color="CBD5E1"/>
        </w:tblBorders>
        <w:tblCellMar>
          <w:top w:w="120" w:type="dxa"/>
          <w:bottom w:w="120" w:type="dxa"/>
          <w:left w:w="160" w:type="dxa"/>
          <w:right w:w="160" w:type="dxa"/>
        </w:tblCellMar>
      </w:tblPr>
      <w:tr>
        <w:tc>
          <w:tcPr><w:shd w:val="clear" w:fill="1E40AF"/></w:tcPr>
          <w:p><w:r><w:rPr><w:b/><w:sz w:val="19"/><w:color w:val="FFFFFF"/></w:rPr><w:t>Fase</w:t></w:r></w:p>
        </w:tc>
        <w:tc>
          <w:tcPr><w:shd w:val="clear" w:fill="1E40AF"/></w:tcPr>
          <w:p><w:r><w:rPr><w:b/><w:sz w:val="19"/><w:color w:val="FFFFFF"/></w:rPr><w:t>Estado</w:t></w:r></w:p>
        </w:tc>
      </w:tr>
      <w:tr>
        <w:tc>
          <w:tcPr><w:shd w:val="clear" w:fill="FFFFFF"/></w:tcPr>
          <w:p><w:r><w:rPr><w:sz w:val="19"/></w:rPr><w:t>Diagnóstico</w:t></w:r></w:p>
        </w:tc>
        <w:tc>
          <w:tcPr><w:shd w:val="clear" w:fill="FFFFFF"/></w:tcPr>
          <w:p><w:r><w:rPr><w:sz w:val="19"/></w:rPr><w:t>Completado</w:t></w:r></w:p>
        </w:tc>
      </w:tr>
      <w:tr>
        <w:tc>
          <w:tcPr><w:shd w:val="clear" w:fill="EFF6FF"/></w:tcPr>
          <w:p><w:r><w:rPr><w:sz w:val="19"/></w:rPr><w:t>Implementación</w:t></w:r></w:p>
        </w:tc>
        <w:tc>
          <w:tcPr><w:shd w:val="clear" w:fill="EFF6FF"/></w:tcPr>
          <w:p><w:r><w:rPr><w:sz w:val="19"/></w:rPr><w:t>En curso</w:t></w:r></w:p>
        </w:tc>
      </w:tr>
    </w:tbl>
    <w:sectPr>
      <w:headerReference w:type="default" r:id="rIdHdr1"/>
      <w:footerReference w:type="default" r:id="rIdFtr1"/>
      <w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>
      <w:pgMar w:top="1280" w:right="1120" w:bottom="1080" w:left="1440" w:header="560" w:footer="520"/>
      <w:pgBorders>
        <w:top w:val="single" w:sz="8" w:space="16" w:color="94A3B8"/>
        <w:bottom w:val="single" w:sz="8" w:space="16" w:color="94A3B8"/>
        <w:left w:val="single" w:sz="8" w:space="16" w:color="94A3B8"/>
        <w:right w:val="single" w:sz="8" w:space="16" w:color="94A3B8"/>
      </w:pgBorders>
      <w:cols w:num="2" w:space="400"/>
      <w:titlePg/>
    </w:sectPr>
  </w:body>
</w:document>"""

    with zipfile.ZipFile(docx_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("word/theme/theme1.xml", theme_xml)
        zf.writestr("word/styles.xml", styles_xml)
        zf.writestr("word/header1.xml", header_xml)
        zf.writestr("word/_rels/header1.xml.rels", header_rels_xml)
        zf.writestr("word/footer1.xml", footer_xml)
        zf.writestr("word/_rels/document.xml.rels", document_rels_xml)
        zf.writestr("word/document.xml", document_xml)
        zf.writestr("word/media/image1.png", _make_logo_bytes())

    return docx_path


def _build_styled_xlsx_fixture(xlsx_path: Path) -> Path:
    """
    Construye un archivo `.xlsx` OOXML 100% válido con 2 hojas:
    - Tema (`xl/theme/theme1.xml`) y estilos (`xl/styles.xml`) con:
      - Cabecera azul marino `#0F172A`, texto blanco `#FFFFFF`, negrita 11pt.
      - Cuerpo fuente `Inter` 10pt, color `#1E293B`.
      - Filas cebradas `#F1F5F9`.
      - Fila de totales `#EFF6FF`, texto `#0F172A`, negrita.
      - Formatos numéricos personalizados: moneda `$#,##0.00`, porcentaje `0.0%`,
        fecha `yyyy-mm-dd`, entero `#,##0`.
      - Bordes delgados `#CBD5E1`.
    - Hoja 1 (`Presupuesto`):
      - Banner de título fusionado en A1:D1 con PII (`Cliente: Juan Pérez - RFC: PEPJ800101XYZ`).
      - Fila de encabezados en fila 2 (`Concepto`, `Cantidad`, `Precio Unitario`, `Total`).
      - Anchos de columna `[28.0, 14.0, 16.0, 18.0]`.
      - Panel congelado (`ySplit="2" state="frozen"`), autofiltro (`A2:D6`),
        orientación horizontal (`landscape`).
      - Datos con montos confidenciales (`12500.50`, `54321.99`) y correo/teléfono PII.
      - Fila de totales con etiqueta `Total` y fórmula `<f>SUM(D3:D6)</f>`.
    - Hoja 2 (`Indicadores`):
      - Encabezados `Métrica`, `Resultado` y fórmula `<f>AVERAGE(B2:B4)</f>`.
    - Logo en `xl/media/logo1.png`.
    """
    theme_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="XookSheetTheme">
  <a:themeElements>
    <a:clrScheme name="XookSheetColors">
      <a:dk1><a:srgbClr val="0F172A"/></a:dk1>
      <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="1E293B"/></a:dk2>
      <a:lt2><a:srgbClr val="F8FAFC"/></a:lt2>
      <a:accent1><a:srgbClr val="2563EB"/></a:accent1>
      <a:accent2><a:srgbClr val="0D9488"/></a:accent2>
      <a:accent3><a:srgbClr val="64748B"/></a:accent3>
      <a:accent4><a:srgbClr val="F59E0B"/></a:accent4>
      <a:accent5><a:srgbClr val="3B82F6"/></a:accent5>
      <a:accent6><a:srgbClr val="10B981"/></a:accent6>
      <a:hlink><a:srgbClr val="2563EB"/></a:hlink>
      <a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="XookSheetFonts">
      <a:majorFont><a:latin typeface="Inter"/></a:majorFont>
      <a:minorFont><a:latin typeface="Inter"/></a:minorFont>
    </a:fontScheme>
  </a:themeElements>
</a:theme>"""

    styles_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="3">
    <numFmt numFmtId="164" formatCode="$#,##0.00"/>
    <numFmt numFmtId="165" formatCode="0.0%"/>
    <numFmt numFmtId="166" formatCode="yyyy-mm-dd"/>
  </numFmts>
  <fonts count="4">
    <font><sz val="10"/><color rgb="FF1E293B"/><name val="Inter"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Inter"/></font>
    <font><b/><sz val="10"/><color rgb="FF0F172A"/><name val="Inter"/></font>
    <font><b/><sz val="14"/><color rgb="FF0F172A"/><name val="Inter"/></font>
  </fonts>
  <fills count="5">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0F172A"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEFF6FF"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/></border>
    <border>
      <left style="thin"><color rgb="FFCBD5E1"/></left>
      <right style="thin"><color rgb="FFCBD5E1"/></right>
      <top style="thin"><color rgb="FFCBD5E1"/></top>
      <bottom style="thin"><color rgb="FFCBD5E1"/></bottom>
    </border>
  </borders>
  <cellXfs count="9">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="1" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="164" fontId="0" fillId="3" borderId="1" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="166" fontId="0" fillId="3" borderId="1" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="3" fontId="0" fillId="0" borderId="1" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="164" fontId="2" fillId="4" borderId="1" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
  </cellXfs>
</styleSheet>"""

    shared_strings = [
        "Cliente: Juan Pérez - RFC: PEPJ800101XYZ",  # 0 (banner con PII)
        "Concepto",                                   # 1
        "Cantidad",                                   # 2
        "Precio Unitario",                            # 3
        "Total",                                      # 4
        "Licencias Enterprise - juan.perez@acme.mx",  # 5 (dato con PII)
        "Soporte Técnico - Tel +52 55 9876 5432",     # 6 (dato con PII)
        "Capacitación Anual",                         # 7
        "Infraestructura Cloud",                      # 8
        "Métrica",                                    # 9
        "Resultado",                                  # 10
        "Satisfacción",                               # 11
    ]
    si_items = "".join(f"<si><t>{s}</t></si>" for s in shared_strings)
    ss_xml = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="{len(shared_strings)}" uniqueCount="{len(shared_strings)}">{si_items}</sst>"""

    wb_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Presupuesto" sheetId="1" r:id="rId1"/>
    <sheet name="Indicadores" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>"""

    wb_rels_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
</Relationships>"""

    sheet1_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews>
    <sheetView workbookViewId="0" showGridLines="1">
      <pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/>
    </sheetView>
  </sheetViews>
  <sheetFormatPr defaultColWidth="16.0" defaultRowHeight="18.0"/>
  <cols>
    <col min="1" max="1" width="28.0" customWidth="1"/>
    <col min="2" max="2" width="14.0" customWidth="1"/>
    <col min="3" max="3" width="16.0" customWidth="1"/>
    <col min="4" max="4" width="18.0" customWidth="1"/>
  </cols>
  <sheetData>
    <row r="1">
      <c r="A1" s="0" t="s"><v>0</v></c>
    </row>
    <row r="2">
      <c r="A2" s="1" t="s"><v>1</v></c>
      <c r="B2" s="1" t="s"><v>2</v></c>
      <c r="C2" s="1" t="s"><v>3</v></c>
      <c r="D2" s="1" t="s"><v>4</v></c>
    </row>
    <row r="3">
      <c r="A3" s="0" t="s"><v>5</v></c>
      <c r="B3" s="7"><v>45</v></c>
      <c r="C3" s="3"><v>12500.50</v></c>
      <c r="D3" s="3"><f>B3*C3</f><v>562522.50</v></c>
    </row>
    <row r="4">
      <c r="A4" s="2" t="s"><v>6</v></c>
      <c r="B4" s="6"><v>46127</v></c>
      <c r="C4" s="4"><v>9800.00</v></c>
      <c r="D4" s="4"><v>9800.00</v></c>
    </row>
    <row r="5">
      <c r="A5" s="0" t="s"><v>7</v></c>
      <c r="B5" s="5"><v>0.185</v></c>
      <c r="C5" s="3"><v>4200.00</v></c>
      <c r="D5" s="3"><v>4200.00</v></c>
    </row>
    <row r="6">
      <c r="A6" s="2" t="s"><v>8</v></c>
      <c r="B6" s="7"><v>12</v></c>
      <c r="C6" s="4"><v>3100.00</v></c>
      <c r="D6" s="4"><v>37200.00</v></c>
    </row>
    <row r="7">
      <c r="A7" s="8" t="s"><v>4</v></c>
      <c r="B7" s="8"/>
      <c r="C7" s="8"/>
      <c r="D7" s="8"><f>SUM(D3:D6)</f><v>54321.99</v></c>
    </row>
  </sheetData>
  <autoFilter ref="A2:D6"/>
  <mergeCells count="1">
    <mergeCell ref="A1:D1"/>
  </mergeCells>
  <pageMargins left="0.75" right="0.75" top="0.80" bottom="0.80" header="0.3" footer="0.3"/>
  <pageSetup orientation="landscape"/>
</worksheet>"""

    sheet2_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" s="1" t="s"><v>9</v></c>
      <c r="B1" s="1" t="s"><v>10</v></c>
    </row>
    <row r="2">
      <c r="A2" s="0" t="s"><v>11</v></c>
      <c r="B2" s="5"><v>0.94</v></c>
    </row>
    <row r="3">
      <c r="A3" s="8" t="s"><v>4</v></c>
      <c r="B3" s="8"><f>AVERAGE(B2:B2)</f><v>0.94</v></c>
    </row>
  </sheetData>
</worksheet>"""

    with zipfile.ZipFile(xlsx_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("xl/theme/theme1.xml", theme_xml)
        zf.writestr("xl/styles.xml", styles_xml)
        zf.writestr("xl/sharedStrings.xml", ss_xml)
        zf.writestr("xl/workbook.xml", wb_xml)
        zf.writestr("xl/_rels/workbook.xml.rels", wb_rels_xml)
        zf.writestr("xl/worksheets/sheet1.xml", sheet1_xml)
        zf.writestr("xl/worksheets/sheet2.xml", sheet2_xml)
        zf.writestr("xl/media/logo1.png", _make_logo_bytes(bg=(15, 23, 42)))

    return xlsx_path


def _build_styled_pptx_fixture(pptx_path: Path) -> Path:
    """Construye un archivo `.pptx` 16:9 (`960x540 pt`) con tema `#7C3AED`, 2 diapositivas y logo."""
    pres_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldSz cx="12192000" cy="6858000" type="screen16x9"/>
</p:presentation>"""

    theme_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="XookDeck">
  <a:themeElements>
    <a:clrScheme name="DeckColors">
      <a:dk1><a:srgbClr val="0F172A"/></a:dk1>
      <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="1E293B"/></a:dk2>
      <a:lt2><a:srgbClr val="F8FAFC"/></a:lt2>
      <a:accent1><a:srgbClr val="7C3AED"/></a:accent1>
      <a:accent2><a:srgbClr val="2563EB"/></a:accent2>
      <a:accent3><a:srgbClr val="64748B"/></a:accent3>
      <a:accent4><a:srgbClr val="F59E0B"/></a:accent4>
      <a:accent5><a:srgbClr val="3B82F6"/></a:accent5>
      <a:accent6><a:srgbClr val="10B981"/></a:accent6>
      <a:hlink><a:srgbClr val="2563EB"/></a:hlink>
      <a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="DeckFonts">
      <a:majorFont><a:latin typeface="Montserrat"/></a:majorFont>
      <a:minorFont><a:latin typeface="Inter"/></a:minorFont>
    </a:fontScheme>
  </a:themeElements>
</a:theme>"""

    layout1_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld name="Title Slide"/>
</p:sldLayout>"""

    layout2_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld name="Title and Content"/>
</p:sldLayout>"""

    slide1_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:nvSpPr><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr>
        <p:txBody>
          <a:p><a:r><a:rPr sz="3200"><a:solidFill><a:srgbClr val="7C3AED"/></a:solidFill></a:rPr><a:t>Visión Estratégica</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>"""

    slide2_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
        <p:txBody>
          <a:p><a:r><a:rPr sz="2800"/><a:t>Cliente: Carlos Ruiz - carlos@secreto.mx</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr>
        <p:txBody>
          <a:p><a:r><a:rPr sz="1600"/><a:t>Objetivos trimestrales y métricas operativas.</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>"""

    with zipfile.ZipFile(pptx_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("ppt/presentation.xml", pres_xml)
        zf.writestr("ppt/theme/theme1.xml", theme_xml)
        zf.writestr("ppt/slideLayouts/slideLayout1.xml", layout1_xml)
        zf.writestr("ppt/slideLayouts/slideLayout2.xml", layout2_xml)
        zf.writestr("ppt/slides/slide1.xml", slide1_xml)
        zf.writestr("ppt/slides/slide2.xml", slide2_xml)
        zf.writestr("ppt/media/logo.png", _make_logo_bytes(bg=(124, 58, 237)))

    return pptx_path


class OfficeInspectorTests(unittest.TestCase):
    def test_extended_design_spec_normalization_and_merging(self) -> None:
        default_spec = normalize_design_spec(None)
        self.assertEqual(default_spec["source_format"], "pdf")
        self.assertEqual(default_spec["supported_outputs"], ["pdf"])
        self.assertIn("docx", default_spec)
        self.assertIn("spreadsheet", default_spec)
        self.assertIn("presentation", default_spec)
        self.assertEqual(default_spec["spreadsheet"]["sheets_blueprint"], [])

        # Auto-derivación de supported_outputs según source_format y saneamiento de sheets_blueprint
        norm_xlsx = normalize_design_spec(
            {
                "source_format": "xlsx",
                "spreadsheet": {
                    "sheets_blueprint": [
                        {
                            "name": "Resumen",
                            "columns": [
                                "Concepto",
                                "Cliente: María González",
                                "Precio",
                                "juan@acme.mx",
                            ],
                            "col_widths": [28.0, 14.0, 999.0, 2.0],
                            "has_title_banner": True,
                            "header_row": 2,
                            "has_totals_row": True,
                            "formula_patterns": ["sum", "_xlfn.XLOOKUP", "B2*C2", "12345"],
                        }
                    ],
                    "header_bg": "#1e3a8a",
                    "border_style": "horizontal",
                    "freeze_header": False,
                    "auto_filter": True,
                },
            }
        )
        self.assertEqual(norm_xlsx["source_format"], "xlsx")
        self.assertEqual(norm_xlsx["supported_outputs"], ["xlsx", "pdf"])
        sheet0 = norm_xlsx["spreadsheet"]["sheets_blueprint"][0]
        self.assertEqual(sheet0["name"], "Resumen")
        self.assertEqual(sheet0["columns"], ["Concepto", "Columna 2", "Precio", "Columna 4"])
        self.assertEqual(sheet0["col_widths"], [28.0, 14.0, 80.0, 4.0])
        self.assertEqual(sheet0["formula_patterns"], ["SUM", "XLOOKUP"])
        self.assertEqual(norm_xlsx["spreadsheet"]["header_bg"], "#1E3A8A")
        self.assertEqual(norm_xlsx["spreadsheet"]["border_style"], "horizontal")
        self.assertFalse(norm_xlsx["spreadsheet"]["freeze_header"])
        self.assertTrue(norm_xlsx["spreadsheet"]["auto_filter"])

        # Fusión con overrides
        merged = merge_design_spec(
            norm_xlsx,
            {
                "spreadsheet": {
                    "header_bg": "#0D9488",
                    "alt_row_bg": None,
                    "number_formats": {"currency": "€#,##0.00"},
                },
                "docx": {"different_first_page": True},
            },
        )
        self.assertEqual(merged["spreadsheet"]["header_bg"], "#0D9488")
        self.assertIsNone(merged["spreadsheet"]["alt_row_bg"])
        self.assertEqual(merged["spreadsheet"]["number_formats"]["currency"], "€#,##0.00")
        self.assertEqual(merged["spreadsheet"]["number_formats"]["percent"], "0.0%")
        self.assertTrue(merged["docx"]["different_first_page"])

    def test_inspect_docx_deep_ooxml_styles_theme_header_footer_table_logo_and_pii(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            docx_path = _build_styled_docx_fixture(tmp_dir / "informe_editorial.docx")
            assets_dir = tmp_dir / "skill" / "assets"

            res = inspect_document_design(
                docx_path,
                extract_assets=True,
                assets_dir=assets_dir,
            )
            self.assertTrue(res["ok"], res.get("error"))
            self.assertEqual(res["source_format"], "docx")
            self.assertGreaterEqual(res["confidence"], 0.88)

            spec = res["design_spec"]
            self.assertEqual(spec["source_format"], "docx")
            self.assertEqual(spec["supported_outputs"], ["docx", "pdf"])

            # Geometría A4 horizontal, 2 columnas, márgenes y borde de página
            self.assertEqual(spec["page"]["size_name"], "a4")
            self.assertEqual(spec["page"]["orientation"], "landscape")
            self.assertEqual(spec["page"]["columns"], 2)
            self.assertAlmostEqual(spec["page"]["column_gap_pt"], 20.0, delta=0.5)
            self.assertAlmostEqual(spec["page"]["margins_pt"]["left"], 72.0, delta=0.5)
            self.assertAlmostEqual(spec["page"]["margins_pt"]["top"], 64.0, delta=0.5)
            self.assertAlmostEqual(spec["page"]["margins_pt"]["right"], 56.0, delta=0.5)
            self.assertAlmostEqual(spec["page"]["margins_pt"]["bottom"], 54.0, delta=0.5)
            self.assertTrue(spec["page"]["border"]["enabled"])
            self.assertEqual(spec["page"]["border"]["color"], "#94A3B8")

            # Tipografía y estilos de encabezados
            self.assertEqual(spec["typography"]["body_family"], "serif")
            self.assertEqual(spec["typography"]["heading_family"], "serif")
            self.assertEqual(spec["typography"]["font_hint"], "Georgia")
            self.assertAlmostEqual(spec["typography"]["body_size"], 11.0, delta=0.2)
            self.assertEqual(spec["typography"]["body_align"], "justify")
            self.assertAlmostEqual(spec["typography"]["space_after"], 8.0, delta=0.5)
            self.assertAlmostEqual(spec["typography"]["h1"]["size"], 18.0, delta=0.2)
            self.assertTrue(spec["typography"]["h1"]["uppercase"])
            self.assertEqual(spec["typography"]["h1"]["decoration"], "underline")
            self.assertEqual(spec["typography"]["h2"]["decoration"], "left_bar")

            # Paleta y tablas
            self.assertEqual(spec["palette"]["accent"], "#1E40AF")
            self.assertEqual(spec["palette"]["table_head_bg"], "#1E40AF")
            self.assertEqual(spec["palette"]["table_head_fg"], "#FFFFFF")
            self.assertEqual(spec["palette"]["table_alt"], "#EFF6FF")
            self.assertEqual(spec["tables"]["style"], "striped")

            # Header, Footer, Logo y metadata DOCX
            self.assertTrue(spec["header"]["enabled"])
            self.assertTrue(spec["header"]["skip_first_page"])
            self.assertTrue(spec["header"]["border_bottom"])
            self.assertEqual(spec["header"]["logo_asset"], "assets/logo.png")
            self.assertTrue((assets_dir / "logo.png").is_file())
            self.assertTrue(spec["footer"]["enabled"])
            self.assertTrue(spec["footer"]["skip_first_page"])
            self.assertTrue(spec["footer"]["border_top"])
            self.assertEqual(spec["footer"]["right"], "Página {page} de {total}")
            self.assertTrue(spec["docx"]["different_first_page"])
            self.assertEqual(spec["docx"]["style_names"]["h1"], "Heading1")

            # Privacidad estricta: secciones válidas presentes y cero PII filtrada
            self.assertIn("Resumen Ejecutivo", spec["sections_blueprint"])
            self.assertIn("Metodología y Alcance", spec["sections_blueprint"])
            serialized = json.dumps(spec, ensure_ascii=False).lower()
            for forbidden in (
                "maría gonzález",
                "gomm850101abc",
                "48,500",
                "acme",
                "confidencial@",
                "1234 5678",
            ):
                self.assertNotIn(forbidden, serialized)

    def test_inspect_xlsx_deep_ooxml_styles_sheets_formulas_formats_and_pii(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            xlsx_path = _build_styled_xlsx_fixture(tmp_dir / "presupuesto_anual.xlsx")
            assets_dir = tmp_dir / "skill" / "assets"

            res = inspect_document_design(
                xlsx_path,
                extract_assets=True,
                assets_dir=assets_dir,
            )
            self.assertTrue(res["ok"], res.get("error"))
            self.assertEqual(res["source_format"], "xlsx")
            self.assertEqual(res["page_count"], 2)

            spec = res["design_spec"]
            self.assertEqual(spec["source_format"], "xlsx")
            self.assertEqual(spec["supported_outputs"], ["xlsx", "pdf"])

            ss = spec["spreadsheet"]
            self.assertEqual(ss["header_bg"], "#0F172A")
            self.assertEqual(ss["header_fg"], "#FFFFFF")
            self.assertTrue(ss["header_bold"])
            self.assertAlmostEqual(ss["header_font_size"], 11.0, delta=0.2)
            self.assertEqual(ss["body_font_name"], "Inter")
            self.assertAlmostEqual(ss["body_font_size"], 10.0, delta=0.2)
            self.assertEqual(ss["alt_row_bg"], "#F1F5F9")
            self.assertEqual(ss["total_row_bg"], "#EFF6FF")
            self.assertEqual(ss["total_row_fg"], "#0F172A")
            self.assertTrue(ss["total_row_bold"])
            self.assertEqual(ss["border_style"], "thin")
            self.assertEqual(ss["border_color"], "#CBD5E1")
            self.assertTrue(ss["freeze_header"])
            self.assertTrue(ss["auto_filter"])
            self.assertTrue(ss["show_gridlines"])
            self.assertEqual(ss["print_orientation"], "landscape")

            # Formatos numéricos detectados
            self.assertEqual(ss["number_formats"]["currency"], "$#,##0.00")
            self.assertEqual(ss["number_formats"]["percent"], "0.0%")
            self.assertEqual(ss["number_formats"]["date"], "yyyy-mm-dd")
            self.assertEqual(ss["number_formats"]["integer"], "#,##0")

            # Blueprint de las 2 hojas
            self.assertEqual(len(ss["sheets_blueprint"]), 2)
            s1 = ss["sheets_blueprint"][0]
            self.assertEqual(s1["name"], "Presupuesto")
            self.assertEqual(s1["columns"], ["Concepto", "Cantidad", "Precio Unitario", "Total"])
            self.assertEqual(s1["col_widths"], [28.0, 14.0, 16.0, 18.0])
            self.assertTrue(s1["has_title_banner"])
            self.assertEqual(s1["header_row"], 2)
            self.assertTrue(s1["has_totals_row"])
            self.assertEqual(s1["formula_patterns"], ["SUM"])

            s2 = ss["sheets_blueprint"][1]
            self.assertEqual(s2["name"], "Indicadores")
            self.assertEqual(s2["columns"], ["Métrica", "Resultado"])
            self.assertTrue(s2["has_totals_row"])
            self.assertEqual(s2["formula_patterns"], ["AVERAGE"])

            # Sincronización con campos unificados para exportación cruzada a PDF
            self.assertEqual(spec["page"]["orientation"], "landscape")
            self.assertEqual(spec["palette"]["table_head_bg"], "#0F172A")
            self.assertEqual(spec["palette"]["table_alt"], "#F1F5F9")
            self.assertEqual(spec["header"]["logo_asset"], "assets/logo.png")
            self.assertTrue((assets_dir / "logo.png").is_file())

            # Cero fuga de montos numéricos ni PII de celdas
            serialized = json.dumps(spec, ensure_ascii=False).lower()
            for forbidden in (
                "juan pérez",
                "juan.perez",
                "pepj800101xyz",
                "12500",
                "562522",
                "54321",
                "9876 5432",
                "acme",
            ):
                self.assertNotIn(forbidden, serialized)

    def test_xlsx_theme_and_tint_color_resolution(self) -> None:
        theme_colors = {
            "lt1": "#FFFFFF",
            "dk1": "#0F172A",
            "lt2": "#F8FAFC",
            "dk2": "#1E293B",
            "accent1": "#2563EB",
        }
        # theme="1" en Excel es dk1 (#0F172A)
        el_dk1 = ET.fromstring('<color theme="1"/>')
        self.assertEqual(_resolve_xl_color(el_dk1, theme_colors), "#0F172A")

        # theme="4" en Excel es accent1 (#2563EB) con tint="0.80" (tono pastel claro)
        el_tinted = ET.fromstring('<color theme="4" tint="0.8"/>')
        resolved_tint = _resolve_xl_color(el_tinted, theme_colors)
        self.assertIsNotNone(resolved_tint)
        assert resolved_tint is not None
        expected_tint = _apply_xl_tint("#2563EB", 0.8)
        self.assertEqual(resolved_tint, expected_tint)
        self.assertLess(_color_distance(resolved_tint, "#D7E3FC"), 14.0)

        # tint negativo oscurece
        el_shaded = ET.fromstring('<color rgb="FF2563EB" tint="-0.25"/>')
        resolved_shade = _resolve_xl_color(el_shaded, theme_colors)
        self.assertIsNotNone(resolved_shade)
        assert resolved_shade is not None
        self.assertLess(_color_distance(resolved_shade, _apply_xl_tint("#2563EB", -0.25)), 2.0)

    def test_inspect_pptx_csv_and_save_bundle_for_office_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)

            # 1. PowerPoint (.pptx)
            pptx_path = _build_styled_pptx_fixture(tmp_dir / "estrategia.pptx")
            pptx_res = inspect_document_design(
                pptx_path,
                extract_assets=True,
                assets_dir=tmp_dir / "pptx_assets",
            )
            self.assertTrue(pptx_res["ok"], pptx_res.get("error"))
            self.assertEqual(pptx_res["source_format"], "pptx")
            self.assertEqual(pptx_res["page_count"], 2)
            pspec = pptx_res["design_spec"]
            self.assertEqual(pspec["source_format"], "pptx")
            self.assertEqual(pspec["supported_outputs"], ["pdf", "docx"])
            self.assertEqual(pspec["presentation"]["aspect_ratio"], "16:9")
            self.assertEqual(pspec["presentation"]["slide_width_pt"], 960.0)
            self.assertEqual(pspec["presentation"]["slide_height_pt"], 540.0)
            self.assertEqual(pspec["presentation"]["slide_count"], 2)
            self.assertIn("Title Slide", pspec["presentation"]["layouts_detected"])
            self.assertEqual(pspec["palette"]["accent"], "#7C3AED")
            self.assertIn("Visión Estratégica", pspec["sections_blueprint"])
            self.assertNotIn("carlos", json.dumps(pspec, ensure_ascii=False).lower())

            # 2. CSV (.csv) con PII en encabezados y celdas
            csv_path = tmp_dir / "ventas.csv"
            csv_path.write_text(
                "Concepto,Cantidad,Precio,Cliente: Ana López\n"
                "Servicio A,10,$1500.00,ana.lopez@cliente.mx\n"
                "Total,10,$1500.00,\n",
                encoding="utf-8",
            )
            csv_res = inspect_office_design(csv_path)
            self.assertTrue(csv_res["ok"])
            self.assertEqual(csv_res["source_format"], "csv")
            cspec = csv_res["design_spec"]
            self.assertEqual(cspec["supported_outputs"], ["xlsx", "pdf"])
            c_sheet = cspec["spreadsheet"]["sheets_blueprint"][0]
            self.assertEqual(c_sheet["columns"], ["Concepto", "Cantidad", "Precio", "Columna 4"])
            self.assertTrue(c_sheet["has_totals_row"])
            self.assertNotIn("ana", json.dumps(cspec, ensure_ascii=False).lower())
            self.assertNotIn("1500", json.dumps(cspec, ensure_ascii=False).lower())

            # 3. save_design_skill_bundle con source_file=.docx extrae logo y se resuelve con resolve_design_skill_spec
            docx_path = _build_styled_docx_fixture(tmp_dir / "plantilla_word.docx")
            docx_inspected = inspect_document_design(docx_path, extract_assets=False)
            skill_dir = tmp_dir / "skills" / "estilo-word-corporativo"
            saved = save_design_skill_bundle(
                skill_dir,
                docx_inspected["design_spec"],
                source_file=docx_path,
                extract_assets=True,
            )
            self.assertTrue(saved["ok"])
            self.assertTrue((skill_dir / "design-spec.json").is_file())
            self.assertTrue((skill_dir / "assets" / "logo.png").is_file())
            self.assertEqual(saved["design_spec"]["header"]["logo_asset"], "assets/logo.png")

            resolved = resolve_design_skill_spec(
                "estilo-word-corporativo",
                global_skills_dir=tmp_dir / "skills",
            )
            self.assertIsNotNone(resolved)
            assert resolved is not None
            self.assertEqual(resolved["source_format"], "docx")
            self.assertEqual(resolved["supported_outputs"], ["docx", "pdf"])
            self.assertIn("logo_asset", resolved["_resolved_assets"])

    def test_universal_dispatch_pdf_and_error_handling(self) -> None:
        from slices.pdf_engine.inspector_tests import _build_academic_two_col_a4_pdf

        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            # Despacho de PDF vía inspect_document_design
            pdf_path = _build_academic_two_col_a4_pdf(tmp_dir / "paper.pdf")
            pdf_res = inspect_document_design(pdf_path, include_preview_images=False)
            self.assertTrue(pdf_res["ok"])
            self.assertEqual(pdf_res["source_format"], "pdf")
            self.assertEqual(pdf_res["design_spec"]["source_format"], "pdf")
            self.assertEqual(pdf_res["design_spec"]["supported_outputs"], ["pdf", "docx"])

            # Archivo inexistente
            missing_res = inspect_document_design(tmp_dir / "no_existe.docx")
            self.assertFalse(missing_res["ok"])

            # Archivo Office cifrado (cabecera OLE2)
            enc_docx = tmp_dir / "protegido.docx"
            enc_docx.write_bytes(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 64)
            enc_res = inspect_document_design(enc_docx)
            self.assertFalse(enc_res["ok"])
            self.assertIn("contraseña", enc_res["error"].lower())


if __name__ == "__main__":
    unittest.main()
