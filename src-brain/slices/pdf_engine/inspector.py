"""
Motor de inspección de diseño visual y estructural de documentos PDF para XOOK.

Extrae el ADN visual real de un PDF (geometría de página, márgenes, columnas,
paleta real de colores vectoriales/píxel, tipografía, jerarquía de encabezados,
encabezados/pies repetitivos, portada, estilos de tabla y estructura genérica de
secciones) sin copiar datos personales ni información confidencial del contenido.

Reglas de privacidad y seguridad:
- Cero persistencia de capturas crudas en disco: las vistas previas para visión
  permanecen únicamente en RAM (`data:image/jpeg;base64,...`).
- Extracción opcional y acotada de logotipos/activos limpios solo cuando
  `extract_assets=True` y dentro de `assets_dir`.
- Nunca copia PII, nombres propios de clientes, montos, correos, teléfonos,
  RFC/CURP ni valores de negocio en `design_spec` ni `sections_blueprint`.
"""

from __future__ import annotations

import base64
from collections import Counter
import copy
import io
import json
import math
import os
from pathlib import Path
import re
import statistics
import time
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple
import unicodedata

import pdfplumber
from PIL import Image
from pypdf import PdfReader
import pypdfium2 as pdfium

DESIGN_SPEC_VERSION = 1

DOCUMENT_TYPES: Tuple[str, ...] = (
    "report",
    "invoice",
    "quote",
    "academic",
    "contract",
    "letter",
    "proposal",
    "manual",
    "form",
    "custom",
)
PAGE_SIZE_NAMES: Tuple[str, ...] = ("letter", "a4", "custom")
ORIENTATIONS: Tuple[str, ...] = ("portrait", "landscape")
FONT_FAMILIES: Tuple[str, ...] = ("sans", "serif", "mono")
TEXT_ALIGNS: Tuple[str, ...] = ("left", "justify", "center", "right")
HEADING_DECORATIONS: Tuple[str, ...] = ("underline", "left_bar", "band", "plain")
LOGO_POSITIONS: Tuple[str, ...] = ("left", "right", "center")
COVER_LAYOUTS: Tuple[str, ...] = (
    "none",
    "minimal",
    "centered",
    "split",
    "hero_top",
    "full_bleed",
    "full_page",
    "academic_centered",
    "band_top",
)
TABLE_STYLES: Tuple[str, ...] = (
    "striped",
    "bordered",
    "minimal_rules",
    "clean",
    "invoice",
)
SOURCE_FORMATS: Tuple[str, ...] = (
    "pdf",
    "docx",
    "xlsx",
    "pptx",
    "csv",
    "other",
)
SUPPORTED_OUTPUT_FORMATS: Tuple[str, ...] = ("pdf", "docx", "xlsx")
SPREADSHEET_BORDER_STYLES: Tuple[str, ...] = (
    "thin",
    "medium",
    "none",
    "horizontal",
)
DEFAULT_SUPPORTED_OUTPUTS_BY_SOURCE: Dict[str, List[str]] = {
    "pdf": ["pdf", "docx"],
    "docx": ["docx", "pdf"],
    "xlsx": ["xlsx", "pdf"],
    "pptx": ["pdf", "docx"],
    "csv": ["xlsx", "pdf"],
    "other": ["pdf", "docx"],
}

STANDARD_PAGE_SIZES: Dict[str, Tuple[float, float]] = {
    "letter": (612.0, 792.0),
    "a4": (595.28, 841.89),
}

DEFAULT_DESIGN_SPEC: Dict[str, Any] = {
    "version": DESIGN_SPEC_VERSION,
    "name": "",
    "slug": "",
    "source_pdf": "",
    "source_format": "pdf",
    "supported_outputs": ["pdf"],
    "document_type": "report",
    "page": {
        "width_pt": 612.0,
        "height_pt": 792.0,
        "size_name": "letter",
        "orientation": "portrait",
        "margins_pt": {"top": 58.0, "right": 56.0, "bottom": 52.0, "left": 56.0},
        "background_hex": "#FFFFFF",
        "border": {
            "enabled": False,
            "color": "#CBD5E1",
            "width_pt": 0.75,
            "inset_pt": 18.0,
        },
        "stationery_asset": None,
        "columns": 1,
        "column_gap_pt": 18.0,
    },
    "palette": {
        "page_bg": "#FFFFFF",
        "text": "#1E293B",
        "heading": "#0F172A",
        "muted": "#64748B",
        "accent": "#2563EB",
        "accent_dark": "#1E3A8A",
        "accent_soft": "#EFF6FF",
        "border": "#CBD5E1",
        "surface": "#F8FAFC",
        "table_head_bg": "#0F172A",
        "table_head_fg": "#FFFFFF",
        "table_alt": "#F8FAFC",
    },
    "typography": {
        "body_family": "sans",
        "heading_family": "sans",
        "font_hint": "",
        "body_size": 10.0,
        "body_leading": 14.8,
        "body_align": "left",
        "space_after": 7.0,
        "h1": {
            "size": 16.0,
            "leading": 21.0,
            "color": None,
            "uppercase": False,
            "decoration": "underline",
            "align": "left",
        },
        "h2": {
            "size": 12.5,
            "leading": 16.5,
            "color": None,
            "uppercase": False,
            "decoration": "plain",
            "align": "left",
        },
        "h3": {
            "size": 10.8,
            "leading": 14.5,
            "color": None,
            "uppercase": False,
            "decoration": "plain",
            "align": "left",
        },
    },
    "header": {
        "enabled": True,
        "skip_first_page": True,
        "height_pt": 28.0,
        "border_bottom": True,
        "border_color": None,
        "background_hex": None,
        "left": "{title}",
        "center": "",
        "right": "{author}",
        "logo_asset": None,
        "logo_position": "left",
        "logo_height_pt": 24.0,
    },
    "footer": {
        "enabled": True,
        "skip_first_page": True,
        "height_pt": 26.0,
        "border_top": True,
        "border_color": None,
        "left": "{date}",
        "center": "",
        "right": "Página {page} de {total}",
    },
    "cover": {
        "enabled": False,
        "layout": "none",
        "top_band": False,
        "top_band_height_pt": 16.0,
        "logo_asset": None,
        "background_asset": None,
    },
    "tables": {
        "style": "striped",
        "header_bg": None,
        "header_fg": None,
        "alt_row_bg": None,
        "border_color": None,
        "font_size": 8.8,
        "cell_padding_v": 5.5,
        "cell_padding_h": 7.0,
    },
    "docx": {
        "style_names": {
            "h1": "Heading1",
            "h2": "Heading2",
            "h3": "Heading3",
            "body": "Normal",
        },
        "different_first_page": False,
        "section_break_pages": False,
    },
    "spreadsheet": {
        "sheets_blueprint": [],
        "header_bg": "#0F172A",
        "header_fg": "#FFFFFF",
        "header_bold": True,
        "header_font_size": 10.0,
        "body_font_name": "Calibri",
        "body_font_size": 10.0,
        "alt_row_bg": "#F8FAFC",
        "total_row_bg": "#EFF6FF",
        "total_row_fg": "#0F172A",
        "total_row_bold": True,
        "border_style": "thin",
        "border_color": "#CBD5E1",
        "freeze_header": True,
        "auto_filter": False,
        "show_gridlines": True,
        "default_col_width": 16.0,
        "number_formats": {
            "currency": "$#,##0.00",
            "percent": "0.0%",
            "date": "yyyy-mm-dd",
            "integer": "#,##0",
        },
        "print_orientation": "portrait",
    },
    "presentation": {
        "slide_width_pt": 720.0,
        "slide_height_pt": 405.0,
        "aspect_ratio": "16:9",
        "slide_count": 0,
        "layouts_detected": [],
    },
    "sections_blueprint": [],
    "notes": "",
}

_MAX_DESIGN_SPEC_BYTES = 512_000
_MAX_ASSET_DIM_PX = 800
_MAX_ASSET_BYTES = 512_000
_SAFE_SLUG_RE = re.compile(r"^[a-z0-9._-]+$")
_SAFE_ASSET_REL_RE = re.compile(r"^[A-Za-z0-9._/-]+$")

# Patrones estrictos de privacidad / PII que nunca deben pasar al diseño ni blueprint
_EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
_URL_RE = re.compile(r"(?:https?://|www\.)\S+", re.IGNORECASE)
_RFC_RE = re.compile(r"\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b", re.IGNORECASE)
_CURP_RE = re.compile(
    r"\b[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d\b",
    re.IGNORECASE,
)
_SSN_TIN_RE = re.compile(r"\b(?:\d{3}-\d{2}-\d{4}|\d{2}-\d{7})\b")
_PHONE_RE = re.compile(r"(?:\+?\d[\d\s().-]{7,}\d)")
_MONEY_RE = re.compile(
    r"(?:[$€£¥]\s*\d[\d,.]*|\b\d[\d,.]*\s*(?:mxn|usd|eur|gbp|cad|pesos?|d[óo]lares?)\b)",
    re.IGNORECASE,
)
_LONG_NUM_RE = re.compile(r"\b\d{5,}\b")
_DATE_NUM_RE = re.compile(r"\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b\d{4}[/-]\d{1,2}[/-]\d{1,2}\b")
_COMPANY_LEGAL_RE = re.compile(
    r"\b(?:s\.?\s*a\.?\s*de\s*c\.?\s*v\.?|s\.?\s*de\s*r\.?\s*l\.?|s\.?\s*a\.?\s*p\.?\s*i\.?|"
    r"s\.?\s*c\.?|a\.?\s*c\.?|llc|inc\.?|corp\.?|ltd\.?|ltda\.?|gmbh|s\.?\s*l\.?)\b",
    re.IGNORECASE,
)
_PII_LABEL_RE = re.compile(
    r"^\s*(?:cliente|raz[óo]n\s+social|contribuyente|rfc|curp|nss|ssn|tel[ée]fono|tel\.?|"
    r"celular|m[óo]vil|correo|e-?mail|domicilio|direcci[óo]n|contacto|atenci[óo]n|para|de|"
    r"folio(?:\s+fiscal)?|uuid|factura\s*(?:no\.?|n[úu]m\.?|#)|cotizaci[óo]n\s*(?:no\.?|#)|"
    r"cuenta|clabe|iban|swift|tarjeta|sr\.?|sra\.?|lic\.?|ing\.?|dr\.?|dra\.?)\b",
    re.IGNORECASE,
)
_ADDRESS_RE = re.compile(
    r"\b(?:calle|av\.?|avenida|blvd\.?|boulevard|col\.?|colonia|c\.?\s*p\.?|cp\s*\d|"
    r"int\.?\s*\d|ext\.?\s*\d|street|st\.?\s+\d|ave\.?\s+\d|suite\s+\d)\b",
    re.IGNORECASE,
)
_LEADING_SECTION_NUM_RE = re.compile(
    r"^\s*(?:(?:cap[íi]tulo|secci[óo]n|parte|anexo|cl[áa]usula|section|chapter|part)\s+[0-9ivxlcdm]+[\s.:–—-]+|"
    r"(?:\d+(?:\.\d+)*|[ivxlcdm]+|[a-z])[.)]\s+)",
    re.IGNORECASE,
)
_MONTH_WORDS_RE = re.compile(
    r"\b(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|"
    r"octubre|noviembre|diciembre|january|february|march|april|may|june|july|august|"
    r"september|october|november|december)\b",
    re.IGNORECASE,
)

# Patrones de clasificación de fuentes
_MONO_FONT_TOKENS = (
    "mono",
    "courier",
    "consolas",
    "menlo",
    "monaco",
    "inconsolata",
    "fira code",
    "firacode",
    "jetbrains",
    "sourcecode",
    "source code",
    "dejavusansmono",
    "liberationmono",
    "xookmono",
    "typewriter",
    "andale",
    "lucida console",
    "cmtt",
)
_SERIF_FONT_TOKENS = (
    "times",
    "georgia",
    "garamond",
    "palatino",
    "cambria",
    "baskerville",
    "bookman",
    "bodoni",
    "didot",
    "caslon",
    "century",
    "merriweather",
    "playfair",
    "lora",
    "crimson",
    "minion",
    "charter",
    "hoefler",
    "ptserif",
    "notoserif",
    "liberationserif",
    "dejavuserif",
    "xookserif",
    "ebgaramond",
    "source serif",
    "sourceserif",
    "libre baskerville",
    "spectral",
    "bitter",
    "rockwell",
    "clarendon",
    "cmr",
    "cmbx",
    "cmti",
    "lmroman",
    "ecrm",
    "nimbusrom",
    "utopia",
    "charter",
    "book antiqua",
    "antiqua",
)


# ---------------------------------------------------------------------------
# Utilidades básicas, colores y saneamiento
# ---------------------------------------------------------------------------


def _slugify_design_name(raw: str) -> str:
    norm = unicodedata.normalize("NFKD", (raw or "").strip())
    ascii_str = norm.encode("ascii", "ignore").decode("ascii").lower()
    cleaned = re.sub(r"[^a-z0-9]+", "-", ascii_str).strip("-")
    return cleaned[:64]


def _clamp_float(value: Any, default: float, min_val: float, max_val: float) -> float:
    try:
        if isinstance(value, bool):
            return default
        num = float(value)
        if not math.isfinite(num):
            return default
        return round(max(min_val, min(max_val, num)), 2)
    except (TypeError, ValueError):
        return default


def _clamp_int(value: Any, default: int, min_val: int, max_val: int) -> int:
    try:
        if isinstance(value, bool):
            return default
        num = int(round(float(value)))
        return max(min_val, min(max_val, num))
    except (TypeError, ValueError):
        return default


def _coerce_bool(value: Any, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and value in (0, 1):
        return bool(value)
    if isinstance(value, str):
        low = value.strip().lower()
        if low in ("true", "1", "yes", "si", "sí"):
            return True
        if low in ("false", "0", "no"):
            return False
    return default


def _coerce_enum(value: Any, allowed: Sequence[str], default: str) -> str:
    if isinstance(value, str):
        cleaned = value.strip().lower()
        if cleaned in allowed:
            return cleaned
    return default


def _rgb_to_hex(r: float, g: float, b: float) -> str:
    ri = max(0, min(255, int(round(r))))
    gi = max(0, min(255, int(round(g))))
    bi = max(0, min(255, int(round(b))))
    return f"#{ri:02X}{gi:02X}{bi:02X}"


def _hex_to_rgb(hex_color: str) -> Tuple[int, int, int]:
    cleaned = hex_color.strip().lstrip("#")
    if len(cleaned) == 3:
        cleaned = "".join(ch * 2 for ch in cleaned)
    return int(cleaned[0:2], 16), int(cleaned[2:4], 16), int(cleaned[4:6], 16)


def _normalize_hex_color(
    value: Any,
    default: Optional[str],
    *,
    allow_none: bool = False,
) -> Optional[str]:
    if value is None:
        return None if allow_none else default
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return None if allow_none else default
        if s.startswith("#"):
            s = s[1:]
        if re.fullmatch(r"[0-9a-fA-F]{3}", s):
            s = "".join(ch * 2 for ch in s)
        elif re.fullmatch(r"[0-9a-fA-F]{8}", s):
            s = s[:6]
        if re.fullmatch(r"[0-9a-fA-F]{6}", s):
            return f"#{s.upper()}"
        return default
    if isinstance(value, (tuple, list)) and len(value) in (1, 3, 4):
        converted = _pdf_color_to_hex(value)
        if converted:
            return converted
    return default


def _pdf_color_to_hex(color_val: Any) -> Optional[str]:
    """Convierte un color PDF (Gray, RGB, CMYK o hex) a `#RRGGBB`."""
    if color_val is None or isinstance(color_val, bool):
        return None
    if isinstance(color_val, str):
        return _normalize_hex_color(color_val, None, allow_none=True)
    if isinstance(color_val, (int, float)):
        val = float(color_val)
        if not math.isfinite(val):
            return None
        g = val * 255.0 if val <= 1.0 else val
        return _rgb_to_hex(g, g, g)
    if isinstance(color_val, (tuple, list)):
        nums: List[float] = []
        for item in color_val:
            try:
                f = float(item)
                if not math.isfinite(f):
                    return None
                nums.append(f)
            except (TypeError, ValueError):
                return None
        if len(nums) == 1:
            g = nums[0] * 255.0 if nums[0] <= 1.0 else nums[0]
            return _rgb_to_hex(g, g, g)
        if len(nums) == 3:
            scale = 255.0 if max(nums) <= 1.0 else 1.0
            return _rgb_to_hex(nums[0] * scale, nums[1] * scale, nums[2] * scale)
        if len(nums) == 4:
            c, m, y, k = [max(0.0, min(1.0, v / 100.0 if v > 1.0 else v)) for v in nums]
            r = (1.0 - c) * (1.0 - k) * 255.0
            g = (1.0 - m) * (1.0 - k) * 255.0
            b = (1.0 - y) * (1.0 - k) * 255.0
            return _rgb_to_hex(r, g, b)
    return None


def _luminance(hex_color: str) -> float:
    r, g, b = _hex_to_rgb(hex_color)
    channels: List[float] = []
    for c in (r / 255.0, g / 255.0, b / 255.0):
        channels.append(c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]


def _contrast_ratio(c1: str, c2: str) -> float:
    l1 = _luminance(c1)
    l2 = _luminance(c2)
    hi, lo = (l1, l2) if l1 >= l2 else (l2, l1)
    return (hi + 0.05) / (lo + 0.05)


def _saturation(hex_color: str) -> float:
    r, g, b = [c / 255.0 for c in _hex_to_rgb(hex_color)]
    hi = max(r, g, b)
    lo = min(r, g, b)
    if hi <= 1e-6:
        return 0.0
    return (hi - lo) / hi


def _chroma(hex_color: str) -> float:
    r, g, b = [c / 255.0 for c in _hex_to_rgb(hex_color)]
    return max(r, g, b) - min(r, g, b)


def _is_chromatic_accent(hex_color: str) -> bool:
    """Distingue colores cromáticos reales de grises/pizarra oscuros (como #1E293B)."""
    return _saturation(hex_color) >= 0.24 and _chroma(hex_color) >= 0.16


def _color_distance(c1: str, c2: str) -> float:
    r1, g1, b1 = _hex_to_rgb(c1)
    r2, g2, b2 = _hex_to_rgb(c2)
    return math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2)


def _mix_hex(c1: str, c2: str, t: float) -> str:
    t = max(0.0, min(1.0, t))
    r1, g1, b1 = _hex_to_rgb(c1)
    r2, g2, b2 = _hex_to_rgb(c2)
    return _rgb_to_hex(
        r1 + (r2 - r1) * t,
        g1 + (g2 - g1) * t,
        b1 + (b2 - b1) * t,
    )


def _darken_hex(hex_color: str, factor: float = 0.25) -> str:
    return _mix_hex(hex_color, "#000000", factor)


def _lighten_hex(hex_color: str, factor: float = 0.25) -> str:
    return _mix_hex(hex_color, "#FFFFFF", factor)


def _quantize_hex(hex_color: str, step: int = 8) -> str:
    r, g, b = _hex_to_rgb(hex_color)
    return _rgb_to_hex(
        round(r / step) * step,
        round(g / step) * step,
        round(b / step) * step,
    )


def _sanitize_asset_rel(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip().replace("\\", "/")
    if not text or len(text) > 180:
        return None
    if text.startswith("/") or "\x00" in text:
        return None
    parts = [p for p in text.split("/") if p]
    if not parts or any(p in (".", "..") for p in parts):
        return None
    normalized = "/".join(parts)
    if not _SAFE_ASSET_REL_RE.match(normalized):
        return None
    return normalized


def _sanitize_section_title(raw: Any) -> Optional[str]:
    """
    Limpia y valida un encabezado de sección para `sections_blueprint`.
    Rechaza estrictamente PII, nombres de cliente/empresa, correos, teléfonos,
    RFC/CURP, montos, direcciones y valores literales de negocio.
    """
    if isinstance(raw, dict):
        raw = raw.get("title") or raw.get("name") or raw.get("label") or ""
    if not isinstance(raw, str):
        return None
    text = " ".join(raw.replace("\r", " ").replace("\n", " ").split()).strip()
    if not text:
        return None

    # Rechazar cualquier cadena con patrones de PII, montos, IDs o direcciones
    for pattern in (
        _EMAIL_RE,
        _URL_RE,
        _RFC_RE,
        _CURP_RE,
        _SSN_TIN_RE,
        _PHONE_RE,
        _MONEY_RE,
        _LONG_NUM_RE,
        _DATE_NUM_RE,
        _COMPANY_LEGAL_RE,
        _PII_LABEL_RE,
        _ADDRESS_RE,
    ):
        if pattern.search(text):
            return None

    # Quitar numeración inicial de sección (ej. "1.2 ", "Capítulo 1: ")
    text = _LEADING_SECTION_NUM_RE.sub("", text).strip()
    text = text.strip(":;|-–—•·* ")

    if not text or len(text) < 3 or len(text) > 72:
        return None

    # Si tras quitar numeración inicial aún quedan números (montos, años específicos, folios),
    # eliminar o rechazar para no filtrar valores de negocio.
    if re.search(r"\d", text):
        return None

    words = text.split()
    if len(words) > 9:
        return None

    # Debe contener letras reales
    alpha_count = sum(1 for ch in text if ch.isalpha())
    if alpha_count < 3 or (alpha_count / max(1, len(text.replace(" ", "")))) < 0.65:
        return None

    return text


_HONORIFIC_RE = re.compile(r"^\s*(?:sr\.?|sra\.?|srta\.?|lic\.?|ing\.?|dr\.?|dra\.?|mr\.?|mrs\.?|ms\.?)\b", re.IGNORECASE)
_FORMULA_NAME_RE = re.compile(r"^[A-Z][A-Z0-9_.]{1,24}$")
_SAFE_NUMFMT_RE = re.compile(r"^[A-Za-z0-9#$€£¥%.,:;/_+\-()\[\]\s?*@\"'\\]+$")


def _sanitize_spreadsheet_label(raw: Any, *, max_len: int = 48) -> Optional[str]:
    """
    Sanea un nombre de hoja o encabezado de columna para `sheets_blueprint`.
    Rechaza estrictamente PII (correos, teléfonos, RFC/CURP, direcciones,
    razones sociales, valores monetarios o numéricos literales).
    """
    if not isinstance(raw, str):
        return None
    text = " ".join(raw.replace("\r", " ").replace("\n", " ").split()).strip()
    if not text or len(text) > max_len:
        return None

    for pattern in (
        _EMAIL_RE,
        _URL_RE,
        _RFC_RE,
        _CURP_RE,
        _SSN_TIN_RE,
        _PHONE_RE,
        _MONEY_RE,
        _LONG_NUM_RE,
        _DATE_NUM_RE,
        _COMPANY_LEGAL_RE,
        _ADDRESS_RE,
        _HONORIFIC_RE,
    ):
        if pattern.search(text):
            return None

    words = text.split()
    if len(words) > 6:
        return None

    # Permitir etiquetas genéricas simples como "Cliente" o "Folio", pero rechazar
    # pares clave-valor o frases con nombres propios como "Cliente: María González".
    if _PII_LABEL_RE.search(text) and (":" in text or len(words) >= 2):
        return None

    # Rechazar cualquier número de 2+ dígitos (montos, años, folios, precios)
    if re.search(r"\d{2,}", text):
        return None

    # Si tiene 1 dígito, solo permitir patrones estructurales tipo "Hoja 1", "Sheet 2", "Q1", "T1", "Col 1"
    if re.search(r"\d", text):
        if not re.fullmatch(
            r"(?:hoja|sheet|col(?:umna)?|nivel|fase|paso|parte|secci[óo]n|grupo|mes|trimestre)\s*[1-9]"
            r"|[qQtT][1-4]",
            text,
            flags=re.IGNORECASE,
        ):
            return None

    text = text.strip(":;|-–—•·* ")
    if not text:
        return None

    alpha_count = sum(1 for ch in text if ch.isalpha())
    if alpha_count < 2:
        return None

    return text


def _sanitize_formula_pattern(raw: Any) -> Optional[str]:
    if not isinstance(raw, str):
        return None
    token = raw.strip().upper()
    if token.startswith("_XLNM.") or token.startswith("_XLFN."):
        token = token.split(".", 1)[1]
    if _FORMULA_NAME_RE.fullmatch(token):
        return token
    return None


def _sanitize_num_fmt(raw: Any, default: str) -> str:
    if not isinstance(raw, str):
        return default
    cleaned = raw.strip()[:48]
    if not cleaned:
        return default
    if any(p.search(cleaned) for p in (_EMAIL_RE, _URL_RE, _RFC_RE, _PHONE_RE)):
        return default
    if not _SAFE_NUMFMT_RE.fullmatch(cleaned):
        return default
    return cleaned


def _detect_page_size_name(width_pt: float, height_pt: float) -> str:
    lo = min(width_pt, height_pt)
    hi = max(width_pt, height_pt)
    if abs(lo - 612.0) <= 4.5 and abs(hi - 792.0) <= 4.5:
        return "letter"
    if abs(lo - 595.28) <= 4.5 and abs(hi - 841.89) <= 4.5:
        return "a4"
    return "custom"


# ---------------------------------------------------------------------------
# Normalización y fusión del contrato `design-spec.json` v1
# ---------------------------------------------------------------------------


def _normalize_heading_spec(
    raw_heading: Any,
    defaults: Dict[str, Any],
    *,
    min_size: float,
    max_size: float,
) -> Dict[str, Any]:
    src = raw_heading if isinstance(raw_heading, dict) else {}
    size = _clamp_float(src.get("size"), float(defaults["size"]), min_size, max_size)
    raw_leading = src.get("leading")
    if raw_leading is None and "size" in src:
        default_leading = round(size * 1.32, 1)
    else:
        default_leading = float(defaults["leading"])
    leading = _clamp_float(
        raw_leading,
        default_leading,
        round(size * 1.05, 2),
        max(max_size * 1.5, 64.0),
    )
    color = _normalize_hex_color(src.get("color"), defaults["color"], allow_none=True)
    uppercase = _coerce_bool(src.get("uppercase"), bool(defaults["uppercase"]))
    decoration = _coerce_enum(src.get("decoration"), HEADING_DECORATIONS, str(defaults["decoration"]))
    align = _coerce_enum(src.get("align"), TEXT_ALIGNS, str(defaults["align"]))
    return {
        "size": size,
        "leading": leading,
        "color": color,
        "uppercase": uppercase,
        "decoration": decoration,
        "align": align,
    }


def normalize_design_spec(raw: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Valida, coacciona límites/colores/enums y devuelve una copia profunda y
    limpia conforme al contrato `design-spec.json` v1.
    """
    src = raw if isinstance(raw, dict) else {}
    d = DEFAULT_DESIGN_SPEC

    # --- Top level ---
    name = str(src.get("name") or "").strip()[:120]
    raw_slug = str(src.get("slug") or "").strip()
    slug = _slugify_design_name(raw_slug) if raw_slug else (_slugify_design_name(name) if name else "")
    source_pdf_raw = str(src.get("source_pdf") or "").strip()
    source_pdf = Path(source_pdf_raw).name[:180] if source_pdf_raw else ""
    has_explicit_source_fmt = (
        isinstance(src.get("source_format"), str)
        and src["source_format"].strip().lower() in SOURCE_FORMATS
    )
    source_format = _coerce_enum(src.get("source_format"), SOURCE_FORMATS, str(d["source_format"]))

    raw_outputs = src.get("supported_outputs")
    parsed_outputs: List[str] = []
    if isinstance(raw_outputs, (list, tuple)):
        for item in raw_outputs:
            if isinstance(item, str):
                tok = item.strip().lower()
                if tok in SUPPORTED_OUTPUT_FORMATS and tok not in parsed_outputs:
                    parsed_outputs.append(tok)
    elif isinstance(raw_outputs, str) and raw_outputs.strip():
        for part in re.split(r"[,;\s]+", raw_outputs.strip()):
            tok = part.strip().lower()
            if tok in SUPPORTED_OUTPUT_FORMATS and tok not in parsed_outputs:
                parsed_outputs.append(tok)
    if parsed_outputs:
        supported_outputs = parsed_outputs
    elif has_explicit_source_fmt:
        supported_outputs = list(DEFAULT_SUPPORTED_OUTPUTS_BY_SOURCE.get(source_format, ["pdf"]))
    else:
        supported_outputs = list(d["supported_outputs"])

    document_type = _coerce_enum(src.get("document_type"), DOCUMENT_TYPES, str(d["document_type"]))

    # --- Page ---
    raw_page = src.get("page") if isinstance(src.get("page"), dict) else {}
    dp = d["page"]

    has_explicit_size_name = (
        isinstance(raw_page.get("size_name"), str)
        and raw_page["size_name"].strip().lower() in PAGE_SIZE_NAMES
    )
    has_explicit_w = raw_page.get("width_pt") is not None
    has_explicit_h = raw_page.get("height_pt") is not None
    has_explicit_orient = (
        isinstance(raw_page.get("orientation"), str)
        and raw_page["orientation"].strip().lower() in ORIENTATIONS
    )

    size_name = _coerce_enum(raw_page.get("size_name"), PAGE_SIZE_NAMES, str(dp["size_name"]))
    if has_explicit_size_name and size_name in STANDARD_PAGE_SIZES and not (has_explicit_w and has_explicit_h):
        std_w, std_h = STANDARD_PAGE_SIZES[size_name]
        width_pt = _clamp_float(raw_page.get("width_pt"), std_w, 144.0, 2400.0)
        height_pt = _clamp_float(raw_page.get("height_pt"), std_h, 144.0, 2400.0)
    else:
        width_pt = _clamp_float(raw_page.get("width_pt"), float(dp["width_pt"]), 144.0, 2400.0)
        height_pt = _clamp_float(raw_page.get("height_pt"), float(dp["height_pt"]), 144.0, 2400.0)

    if has_explicit_orient:
        orientation = _coerce_enum(raw_page.get("orientation"), ORIENTATIONS, "portrait")
        if orientation == "landscape" and width_pt < height_pt:
            width_pt, height_pt = height_pt, width_pt
        elif orientation == "portrait" and width_pt > height_pt:
            width_pt, height_pt = height_pt, width_pt
    else:
        orientation = "landscape" if width_pt > height_pt else "portrait"

    if not has_explicit_size_name:
        size_name = _detect_page_size_name(width_pt, height_pt)

    raw_margins = raw_page.get("margins_pt") if isinstance(raw_page.get("margins_pt"), dict) else {}
    dm = dp["margins_pt"]
    m_top = _clamp_float(raw_margins.get("top"), float(dm["top"]), 12.0, 180.0)
    m_right = _clamp_float(raw_margins.get("right"), float(dm["right"]), 12.0, 180.0)
    m_bottom = _clamp_float(raw_margins.get("bottom"), float(dm["bottom"]), 12.0, 180.0)
    m_left = _clamp_float(raw_margins.get("left"), float(dm["left"]), 12.0, 180.0)

    # Evitar márgenes imposibles mayores al área útil
    if m_left + m_right > width_pt - 72.0:
        scale_x = max(0.2, (width_pt - 72.0) / max(1.0, m_left + m_right))
        m_left = round(max(12.0, m_left * scale_x), 1)
        m_right = round(max(12.0, m_right * scale_x), 1)
    if m_top + m_bottom > height_pt - 72.0:
        scale_y = max(0.2, (height_pt - 72.0) / max(1.0, m_top + m_bottom))
        m_top = round(max(12.0, m_top * scale_y), 1)
        m_bottom = round(max(12.0, m_bottom * scale_y), 1)

    raw_palette = src.get("palette") if isinstance(src.get("palette"), dict) else {}
    dpal = d["palette"]

    # Sincronización limpia entre page.background_hex y palette.page_bg
    raw_page_bg = _normalize_hex_color(raw_page.get("background_hex"), None, allow_none=True)
    raw_pal_bg = _normalize_hex_color(raw_palette.get("page_bg"), None, allow_none=True)
    if raw_page_bg and not raw_pal_bg:
        page_bg = raw_page_bg
    elif raw_pal_bg and not raw_page_bg:
        page_bg = raw_pal_bg
    elif raw_page_bg:
        page_bg = raw_page_bg
    else:
        page_bg = str(dpal["page_bg"])

    raw_border = raw_page.get("border") if isinstance(raw_page.get("border"), dict) else {}
    dborder = dp["border"]
    page_border = {
        "enabled": _coerce_bool(raw_border.get("enabled"), bool(dborder["enabled"])),
        "color": _normalize_hex_color(raw_border.get("color"), str(dborder["color"])),
        "width_pt": _clamp_float(raw_border.get("width_pt"), float(dborder["width_pt"]), 0.25, 12.0),
        "inset_pt": _clamp_float(raw_border.get("inset_pt"), float(dborder["inset_pt"]), 0.0, 72.0),
    }

    page = {
        "width_pt": width_pt,
        "height_pt": height_pt,
        "size_name": size_name,
        "orientation": orientation,
        "margins_pt": {
            "top": m_top,
            "right": m_right,
            "bottom": m_bottom,
            "left": m_left,
        },
        "background_hex": page_bg,
        "border": page_border,
        "stationery_asset": _sanitize_asset_rel(raw_page.get("stationery_asset")),
        "columns": _clamp_int(raw_page.get("columns"), int(dp["columns"]), 1, 2),
        "column_gap_pt": _clamp_float(raw_page.get("column_gap_pt"), float(dp["column_gap_pt"]), 6.0, 72.0),
    }

    # --- Palette ---
    palette = {
        "page_bg": page_bg,
        "text": _normalize_hex_color(raw_palette.get("text"), str(dpal["text"])),
        "heading": _normalize_hex_color(raw_palette.get("heading"), str(dpal["heading"])),
        "muted": _normalize_hex_color(raw_palette.get("muted"), str(dpal["muted"])),
        "accent": _normalize_hex_color(raw_palette.get("accent"), str(dpal["accent"])),
        "accent_dark": _normalize_hex_color(raw_palette.get("accent_dark"), str(dpal["accent_dark"])),
        "accent_soft": _normalize_hex_color(raw_palette.get("accent_soft"), str(dpal["accent_soft"])),
        "border": _normalize_hex_color(raw_palette.get("border"), str(dpal["border"])),
        "surface": _normalize_hex_color(raw_palette.get("surface"), str(dpal["surface"])),
        "table_head_bg": _normalize_hex_color(raw_palette.get("table_head_bg"), str(dpal["table_head_bg"])),
        "table_head_fg": _normalize_hex_color(raw_palette.get("table_head_fg"), str(dpal["table_head_fg"])),
        "table_alt": _normalize_hex_color(raw_palette.get("table_alt"), str(dpal["table_alt"])),
    }

    # --- Typography ---
    raw_typo = src.get("typography") if isinstance(src.get("typography"), dict) else {}
    dt = d["typography"]
    body_size = _clamp_float(raw_typo.get("body_size"), float(dt["body_size"]), 6.5, 22.0)
    raw_body_leading = raw_typo.get("body_leading")
    default_body_leading = round(body_size * 1.45, 1) if (raw_body_leading is None and "body_size" in raw_typo) else float(dt["body_leading"])
    body_leading = _clamp_float(raw_body_leading, default_body_leading, round(body_size * 1.05, 2), 40.0)

    typography = {
        "body_family": _coerce_enum(raw_typo.get("body_family"), FONT_FAMILIES, str(dt["body_family"])),
        "heading_family": _coerce_enum(raw_typo.get("heading_family"), FONT_FAMILIES, str(dt["heading_family"])),
        "font_hint": str(raw_typo.get("font_hint") or "").strip()[:100],
        "body_size": body_size,
        "body_leading": body_leading,
        "body_align": _coerce_enum(raw_typo.get("body_align"), TEXT_ALIGNS, str(dt["body_align"])),
        "space_after": _clamp_float(raw_typo.get("space_after"), float(dt["space_after"]), 0.0, 36.0),
        "h1": _normalize_heading_spec(raw_typo.get("h1"), dt["h1"], min_size=10.0, max_size=48.0),
        "h2": _normalize_heading_spec(raw_typo.get("h2"), dt["h2"], min_size=8.5, max_size=36.0),
        "h3": _normalize_heading_spec(raw_typo.get("h3"), dt["h3"], min_size=7.5, max_size=28.0),
    }

    # --- Header ---
    raw_header = src.get("header") if isinstance(src.get("header"), dict) else {}
    dh = d["header"]
    header = {
        "enabled": _coerce_bool(raw_header.get("enabled"), bool(dh["enabled"])),
        "skip_first_page": _coerce_bool(raw_header.get("skip_first_page"), bool(dh["skip_first_page"])),
        "height_pt": _clamp_float(raw_header.get("height_pt"), float(dh["height_pt"]), 12.0, 140.0),
        "border_bottom": _coerce_bool(raw_header.get("border_bottom"), bool(dh["border_bottom"])),
        "border_color": _normalize_hex_color(raw_header.get("border_color"), dh["border_color"], allow_none=True),
        "background_hex": _normalize_hex_color(raw_header.get("background_hex"), dh["background_hex"], allow_none=True),
        "left": str(dh["left"] if "left" not in raw_header or raw_header.get("left") is None else raw_header.get("left"))[:120],
        "center": str(dh["center"] if "center" not in raw_header or raw_header.get("center") is None else raw_header.get("center"))[:120],
        "right": str(dh["right"] if "right" not in raw_header or raw_header.get("right") is None else raw_header.get("right"))[:120],
        "logo_asset": _sanitize_asset_rel(raw_header.get("logo_asset")),
        "logo_position": _coerce_enum(raw_header.get("logo_position"), LOGO_POSITIONS, str(dh["logo_position"])),
        "logo_height_pt": _clamp_float(raw_header.get("logo_height_pt"), float(dh["logo_height_pt"]), 10.0, 96.0),
    }

    # --- Footer ---
    raw_footer = src.get("footer") if isinstance(src.get("footer"), dict) else {}
    df = d["footer"]
    footer = {
        "enabled": _coerce_bool(raw_footer.get("enabled"), bool(df["enabled"])),
        "skip_first_page": _coerce_bool(raw_footer.get("skip_first_page"), bool(df["skip_first_page"])),
        "height_pt": _clamp_float(raw_footer.get("height_pt"), float(df["height_pt"]), 12.0, 110.0),
        "border_top": _coerce_bool(raw_footer.get("border_top"), bool(df["border_top"])),
        "border_color": _normalize_hex_color(raw_footer.get("border_color"), df["border_color"], allow_none=True),
        "left": str(df["left"] if "left" not in raw_footer or raw_footer.get("left") is None else raw_footer.get("left"))[:120],
        "center": str(df["center"] if "center" not in raw_footer or raw_footer.get("center") is None else raw_footer.get("center"))[:120],
        "right": str(df["right"] if "right" not in raw_footer or raw_footer.get("right") is None else raw_footer.get("right"))[:120],
    }

    # --- Cover ---
    raw_cover = src.get("cover") if isinstance(src.get("cover"), dict) else {}
    dc = d["cover"]
    cover_enabled = _coerce_bool(raw_cover.get("enabled"), bool(dc["enabled"]))
    cover_layout = _coerce_enum(raw_cover.get("layout"), COVER_LAYOUTS, str(dc["layout"]))
    if cover_enabled and cover_layout == "none":
        cover_layout = "minimal"
    elif not cover_enabled and "layout" not in raw_cover:
        cover_layout = "none"

    cover = {
        "enabled": cover_enabled,
        "layout": cover_layout,
        "top_band": _coerce_bool(raw_cover.get("top_band"), bool(dc["top_band"])),
        "top_band_height_pt": _clamp_float(raw_cover.get("top_band_height_pt"), float(dc["top_band_height_pt"]), 2.0, 180.0),
        "logo_asset": _sanitize_asset_rel(raw_cover.get("logo_asset")),
        "background_asset": _sanitize_asset_rel(raw_cover.get("background_asset")),
    }

    # --- Tables ---
    raw_tables = src.get("tables") if isinstance(src.get("tables"), dict) else {}
    dtbl = d["tables"]
    tables = {
        "style": _coerce_enum(raw_tables.get("style"), TABLE_STYLES, str(dtbl["style"])),
        "header_bg": _normalize_hex_color(raw_tables.get("header_bg"), dtbl["header_bg"], allow_none=True),
        "header_fg": _normalize_hex_color(raw_tables.get("header_fg"), dtbl["header_fg"], allow_none=True),
        "alt_row_bg": _normalize_hex_color(raw_tables.get("alt_row_bg"), dtbl["alt_row_bg"], allow_none=True),
        "border_color": _normalize_hex_color(raw_tables.get("border_color"), dtbl["border_color"], allow_none=True),
        "font_size": _clamp_float(raw_tables.get("font_size"), float(dtbl["font_size"]), 6.0, 16.0),
        "cell_padding_v": _clamp_float(raw_tables.get("cell_padding_v"), float(dtbl["cell_padding_v"]), 1.0, 20.0),
        "cell_padding_h": _clamp_float(raw_tables.get("cell_padding_h"), float(dtbl["cell_padding_h"]), 1.5, 24.0),
    }

    # --- DOCX ---
    raw_docx = src.get("docx") if isinstance(src.get("docx"), dict) else {}
    ddocx = d["docx"]
    raw_style_names = raw_docx.get("style_names") if isinstance(raw_docx.get("style_names"), dict) else {}
    dstyles = ddocx["style_names"]

    def _clean_docx_style_name(val: Any, fallback: str) -> str:
        s = re.sub(r"[\x00-\x1f<>\"']", "", str(val or "")).strip()[:60]
        return s or fallback

    docx_spec = {
        "style_names": {
            "h1": _clean_docx_style_name(raw_style_names.get("h1"), str(dstyles["h1"])),
            "h2": _clean_docx_style_name(raw_style_names.get("h2"), str(dstyles["h2"])),
            "h3": _clean_docx_style_name(raw_style_names.get("h3"), str(dstyles["h3"])),
            "body": _clean_docx_style_name(raw_style_names.get("body"), str(dstyles["body"])),
        },
        "different_first_page": _coerce_bool(
            raw_docx.get("different_first_page"),
            bool(ddocx["different_first_page"]),
        ),
        "section_break_pages": _coerce_bool(
            raw_docx.get("section_break_pages"),
            bool(ddocx["section_break_pages"]),
        ),
    }

    # --- Spreadsheet ---
    raw_ss = src.get("spreadsheet") if isinstance(src.get("spreadsheet"), dict) else {}
    dss = d["spreadsheet"]
    raw_sheets_bp = raw_ss.get("sheets_blueprint")
    sheets_blueprint: List[Dict[str, Any]] = []
    if isinstance(raw_sheets_bp, list):
        for s_idx, item in enumerate(raw_sheets_bp[:8], start=1):
            if not isinstance(item, dict):
                continue
            clean_sheet_name = _sanitize_spreadsheet_label(item.get("name"), max_len=31) or f"Hoja {s_idx}"
            raw_cols = item.get("columns") if isinstance(item.get("columns"), list) else []
            clean_cols: List[str] = []
            for c_idx, col_item in enumerate(raw_cols[:24], start=1):
                clean_col = _sanitize_spreadsheet_label(col_item, max_len=48)
                if clean_col:
                    clean_cols.append(clean_col)
                elif isinstance(col_item, str) and col_item.strip():
                    # Evitar fuga de PII conservando el slot estructural cuando existía columna
                    clean_cols.append(f"Columna {c_idx}")
            raw_widths = item.get("col_widths") if isinstance(item.get("col_widths"), list) else []
            clean_widths = [
                _clamp_float(w_val, float(dss["default_col_width"]), 4.0, 80.0)
                for w_val in raw_widths[:24]
            ]
            raw_patterns = item.get("formula_patterns") if isinstance(item.get("formula_patterns"), list) else []
            formula_patterns: List[str] = []
            for fp in raw_patterns:
                clean_fp = _sanitize_formula_pattern(fp)
                if clean_fp and clean_fp not in formula_patterns:
                    formula_patterns.append(clean_fp)
                    if len(formula_patterns) >= 12:
                        break
            sheets_blueprint.append(
                {
                    "name": clean_sheet_name,
                    "columns": clean_cols,
                    "col_widths": clean_widths,
                    "has_title_banner": _coerce_bool(item.get("has_title_banner"), False),
                    "header_row": _clamp_int(item.get("header_row"), 1, 1, 20),
                    "has_totals_row": _coerce_bool(item.get("has_totals_row"), False),
                    "formula_patterns": formula_patterns,
                }
            )

    raw_nfmts = raw_ss.get("number_formats") if isinstance(raw_ss.get("number_formats"), dict) else {}
    dnfmts = dss["number_formats"]
    number_formats = {
        "currency": _sanitize_num_fmt(raw_nfmts.get("currency"), str(dnfmts["currency"])),
        "percent": _sanitize_num_fmt(raw_nfmts.get("percent"), str(dnfmts["percent"])),
        "date": _sanitize_num_fmt(raw_nfmts.get("date"), str(dnfmts["date"])),
        "integer": _sanitize_num_fmt(raw_nfmts.get("integer"), str(dnfmts["integer"])),
    }

    body_font_name_raw = re.sub(r"[\x00-\x1f<>\"']", "", str(raw_ss.get("body_font_name") or "")).strip()[:60]
    if "alt_row_bg" in raw_ss and raw_ss.get("alt_row_bg") is None:
        ss_alt_row_bg: Optional[str] = None
    else:
        ss_alt_row_bg = _normalize_hex_color(raw_ss.get("alt_row_bg"), str(dss["alt_row_bg"]))

    spreadsheet_spec = {
        "sheets_blueprint": sheets_blueprint,
        "header_bg": _normalize_hex_color(raw_ss.get("header_bg"), str(dss["header_bg"])),
        "header_fg": _normalize_hex_color(raw_ss.get("header_fg"), str(dss["header_fg"])),
        "header_bold": _coerce_bool(raw_ss.get("header_bold"), bool(dss["header_bold"])),
        "header_font_size": _clamp_float(raw_ss.get("header_font_size"), float(dss["header_font_size"]), 6.0, 28.0),
        "body_font_name": body_font_name_raw or str(dss["body_font_name"]),
        "body_font_size": _clamp_float(raw_ss.get("body_font_size"), float(dss["body_font_size"]), 6.0, 24.0),
        "alt_row_bg": ss_alt_row_bg,
        "total_row_bg": _normalize_hex_color(raw_ss.get("total_row_bg"), str(dss["total_row_bg"])),
        "total_row_fg": _normalize_hex_color(raw_ss.get("total_row_fg"), str(dss["total_row_fg"])),
        "total_row_bold": _coerce_bool(raw_ss.get("total_row_bold"), bool(dss["total_row_bold"])),
        "border_style": _coerce_enum(raw_ss.get("border_style"), SPREADSHEET_BORDER_STYLES, str(dss["border_style"])),
        "border_color": _normalize_hex_color(raw_ss.get("border_color"), str(dss["border_color"])),
        "freeze_header": _coerce_bool(raw_ss.get("freeze_header"), bool(dss["freeze_header"])),
        "auto_filter": _coerce_bool(raw_ss.get("auto_filter"), bool(dss["auto_filter"])),
        "show_gridlines": _coerce_bool(raw_ss.get("show_gridlines"), bool(dss["show_gridlines"])),
        "default_col_width": _clamp_float(raw_ss.get("default_col_width"), float(dss["default_col_width"]), 4.0, 80.0),
        "number_formats": number_formats,
        "print_orientation": _coerce_enum(raw_ss.get("print_orientation"), ORIENTATIONS, str(dss["print_orientation"])),
    }

    # --- Presentation ---
    raw_pres = src.get("presentation") if isinstance(src.get("presentation"), dict) else {}
    dpres = d["presentation"]
    slide_w = _clamp_float(raw_pres.get("slide_width_pt"), float(dpres["slide_width_pt"]), 144.0, 2400.0)
    slide_h = _clamp_float(raw_pres.get("slide_height_pt"), float(dpres["slide_height_pt"]), 144.0, 2400.0)
    raw_ar = str(raw_pres.get("aspect_ratio") or "").strip()[:16]
    if re.fullmatch(r"\d{1,2}:\d{1,2}", raw_ar):
        aspect_ratio = raw_ar
    else:
        ratio = slide_w / max(1.0, slide_h)
        if abs(ratio - (16.0 / 9.0)) <= 0.08:
            aspect_ratio = "16:9"
        elif abs(ratio - (4.0 / 3.0)) <= 0.08:
            aspect_ratio = "4:3"
        elif abs(ratio - (16.0 / 10.0)) <= 0.08:
            aspect_ratio = "16:10"
        else:
            aspect_ratio = str(dpres["aspect_ratio"])

    raw_layouts = raw_pres.get("layouts_detected")
    layouts_detected: List[str] = []
    if isinstance(raw_layouts, list):
        seen_layouts: Set[str] = set()
        for item in raw_layouts:
            if not isinstance(item, str):
                continue
            cand = " ".join(item.split()).strip()[:48]
            if not cand:
                continue
            if any(p.search(cand) for p in (_EMAIL_RE, _URL_RE, _RFC_RE, _PHONE_RE, _MONEY_RE, _LONG_NUM_RE)):
                continue
            if re.fullmatch(r"[A-Za-zÁÉÍÓÚáéíóúÑñÜü0-9 _/+-]{2,48}", cand):
                lk = cand.lower()
                if lk not in seen_layouts:
                    seen_layouts.add(lk)
                    layouts_detected.append(cand)
                    if len(layouts_detected) >= 16:
                        break

    presentation_spec = {
        "slide_width_pt": slide_w,
        "slide_height_pt": slide_h,
        "aspect_ratio": aspect_ratio,
        "slide_count": _clamp_int(raw_pres.get("slide_count"), int(dpres["slide_count"]), 0, 500),
        "layouts_detected": layouts_detected,
    }

    # --- Sections blueprint (saneado anti-PII) ---
    raw_sections = src.get("sections_blueprint")
    sections_blueprint: List[str] = []
    seen_sections: Set[str] = set()
    if isinstance(raw_sections, list):
        for item in raw_sections:
            cleaned_title = _sanitize_section_title(item)
            if cleaned_title:
                key = cleaned_title.lower()
                if key not in seen_sections:
                    seen_sections.add(key)
                    sections_blueprint.append(cleaned_title)
                    if len(sections_blueprint) >= 20:
                        break

    notes = str(src.get("notes") or "").strip()[:600]

    return {
        "version": DESIGN_SPEC_VERSION,
        "name": name,
        "slug": slug,
        "source_pdf": source_pdf,
        "source_format": source_format,
        "supported_outputs": supported_outputs,
        "document_type": document_type,
        "page": page,
        "palette": palette,
        "typography": typography,
        "header": header,
        "footer": footer,
        "cover": cover,
        "tables": tables,
        "docx": docx_spec,
        "spreadsheet": spreadsheet_spec,
        "presentation": presentation_spec,
        "sections_blueprint": sections_blueprint,
        "notes": notes,
    }


def _deep_merge_dicts(base: Dict[str, Any], overrides: Dict[str, Any]) -> Dict[str, Any]:
    merged = copy.deepcopy(base)
    for key, val in overrides.items():
        if isinstance(val, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge_dicts(merged[key], val)
        else:
            merged[key] = copy.deepcopy(val)
    return merged


def merge_design_spec(
    base: Optional[Dict[str, Any]],
    overrides: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Fusiona recursivamente diccionarios anidados sobre `base` permitiendo
    sobrescrituras explícitas con `None` o `False`, y normaliza el resultado.
    Preserva metadatos internos (`_skill_slug`, `_skill_dir`, `_resolved_assets`)
    cuando provienen de `resolve_design_skill_spec`, podando activos anulados.
    """
    internal_meta: Dict[str, Any] = {}
    for src_meta in (base, overrides):
        if isinstance(src_meta, dict):
            for k in ("_skill_slug", "_skill_dir", "_resolved_assets"):
                if k in src_meta and src_meta[k] is not None:
                    internal_meta[k] = copy.deepcopy(src_meta[k])

    norm_base = normalize_design_spec(base)
    if not isinstance(overrides, dict) or not overrides:
        out = norm_base
    else:
        clean_overrides = {k: v for k, v in overrides.items() if not str(k).startswith("_")}
        merged = _deep_merge_dicts(norm_base, clean_overrides)

        ov_page = clean_overrides.get("page") if isinstance(clean_overrides.get("page"), dict) else {}
        ov_pal = clean_overrides.get("palette") if isinstance(clean_overrides.get("palette"), dict) else {}

        # Sincronizar overrides de fondo de página entre page.background_hex y palette.page_bg
        if "background_hex" in ov_page and "page_bg" not in ov_pal:
            merged.setdefault("palette", {})["page_bg"] = ov_page["background_hex"]
        elif "page_bg" in ov_pal and "background_hex" not in ov_page:
            merged.setdefault("page", {})["background_hex"] = ov_pal["page_bg"]

        # Si solo cambiaron size_name sin width_pt/height_pt, ajustar dimensiones estándar
        if (
            "size_name" in ov_page
            and "width_pt" not in ov_page
            and "height_pt" not in ov_page
        ):
            sname = str(ov_page["size_name"] or "").strip().lower()
            if sname in STANDARD_PAGE_SIZES:
                w, h = STANDARD_PAGE_SIZES[sname]
                orient = merged.get("page", {}).get("orientation", "portrait")
                if orient == "landscape":
                    w, h = h, w
                merged["page"]["width_pt"] = w
                merged["page"]["height_pt"] = h

        # Si cambiaron width_pt/height_pt sin cambiar size_name, recalcular size_name
        if ("width_pt" in ov_page or "height_pt" in ov_page) and "size_name" not in ov_page:
            merged["page"]["size_name"] = _detect_page_size_name(
                float(merged["page"]["width_pt"]),
                float(merged["page"]["height_pt"]),
            )
            if "orientation" not in ov_page:
                merged["page"]["orientation"] = (
                    "landscape"
                    if float(merged["page"]["width_pt"]) > float(merged["page"]["height_pt"])
                    else "portrait"
                )

        out = normalize_design_spec(merged)

    if internal_meta:
        if "_skill_slug" in internal_meta:
            out["_skill_slug"] = internal_meta["_skill_slug"]
        if "_skill_dir" in internal_meta:
            out["_skill_dir"] = internal_meta["_skill_dir"]
        if "_resolved_assets" in internal_meta and isinstance(internal_meta["_resolved_assets"], dict):
            resolved_assets = dict(internal_meta["_resolved_assets"])
            # Si el override puso explícitamente un asset en None, retirarlo de _resolved_assets
            asset_field_map = {
                "logo_asset": out["header"]["logo_asset"],
                "cover_logo_asset": out["cover"]["logo_asset"],
                "cover_background_asset": out["cover"]["background_asset"],
                "stationery_asset": out["page"]["stationery_asset"],
            }
            for asset_key, rel_val in asset_field_map.items():
                if not rel_val:
                    resolved_assets.pop(asset_key, None)
            out["_resolved_assets"] = resolved_assets

    return out


# ---------------------------------------------------------------------------
# Análisis de fuentes, líneas, colores, layout, tablas y activos PDF
# ---------------------------------------------------------------------------


def _clean_font_name(fontname: str) -> str:
    raw = str(fontname or "").strip()
    if not raw:
        return ""
    if "+" in raw:
        prefix, rest = raw.split("+", 1)
        if len(prefix) == 6 and prefix.isalpha():
            raw = rest
    return raw.strip()


def _base_font_hint(fontname: str) -> str:
    clean = _clean_font_name(fontname)
    if not clean:
        return ""
    # Quitar sufijos de estilo/peso para presentar un nombre limpio
    hint = re.sub(
        r"[-_, ]?(?:BoldItalic|BoldOblique|SemiBold|DemiBold|ExtraBold|UltraBold|"
        r"Bold|Italic|Oblique|Regular|Roman|Medium|Light|Thin|Black|Heavy|MT|PSMT|PS)$",
        "",
        clean,
        flags=re.IGNORECASE,
    )
    hint = re.sub(r"([a-z])([A-Z])", r"\1 \2", hint)
    hint = hint.replace("_", " ").replace("-", " ")
    hint = " ".join(hint.split()).strip()
    return hint or clean


def _classify_font_family(fontname: str) -> str:
    clean = _clean_font_name(fontname).lower()
    if not clean:
        return "sans"
    for token in _MONO_FONT_TOKENS:
        if token in clean:
            return "mono"
    if "sans" in clean:
        return "sans"
    if "serif" in clean:
        return "serif"
    for token in _SERIF_FONT_TOKENS:
        if token in clean:
            return "serif"
    return "sans"


def _is_bold_font(fontname: str) -> bool:
    low = _clean_font_name(fontname).lower()
    return any(
        tok in low
        for tok in ("bold", "black", "heavy", "semibold", "demi", "extrabold", "cmbx", "-b")
    )


def _group_chars_into_lines(chars: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Agrupa caracteres de pdfplumber en líneas visuales con métricas exactas."""
    valid_chars = [
        c
        for c in chars
        if isinstance(c, dict)
        and c.get("text") is not None
        and c.get("top") is not None
        and c.get("x0") is not None
        and c.get("x1") is not None
    ]
    if not valid_chars:
        return []

    # Ordenar por y (top) y luego x0
    valid_chars.sort(key=lambda c: (round(float(c["top"]), 1), float(c["x0"])))

    raw_clusters: List[List[Dict[str, Any]]] = []
    for ch in valid_chars:
        top = float(ch["top"])
        size = max(4.0, float(ch.get("size") or 10.0))
        tol = max(2.2, size * 0.42)
        if raw_clusters:
            last_cluster = raw_clusters[-1]
            ref_top = float(last_cluster[0]["top"])
            if abs(top - ref_top) <= tol:
                last_cluster.append(ch)
                continue
        raw_clusters.append([ch])

    lines: List[Dict[str, Any]] = []
    for cluster in raw_clusters:
        cluster.sort(key=lambda c: float(c["x0"]))
        # Separar si hay dos columnas claramente distantes en la misma fila visual
        sub_clusters: List[List[Dict[str, Any]]] = []
        current: List[Dict[str, Any]] = []
        for ch in cluster:
            if current:
                prev = current[-1]
                avg_sz = max(6.0, float(prev.get("size") or 10.0))
                gap = float(ch["x0"]) - float(prev["x1"])
                if gap > max(22.0, avg_sz * 2.6):
                    sub_clusters.append(current)
                    current = [ch]
                    continue
            current.append(ch)
        if current:
            sub_clusters.append(current)

        for seg in sub_clusters:
            # Reconstruir texto insertando espacio cuando hay brecha horizontal
            parts: List[str] = []
            prev_x1: Optional[float] = None
            non_space_chars: List[Dict[str, Any]] = []
            for ch in seg:
                t = str(ch.get("text") or "")
                x0 = float(ch["x0"])
                x1 = float(ch["x1"])
                sz = max(5.0, float(ch.get("size") or 10.0))
                if prev_x1 is not None and (x0 - prev_x1) > max(1.4, sz * 0.18):
                    if parts and not parts[-1].endswith(" ") and not t.startswith(" "):
                        parts.append(" ")
                parts.append(t)
                prev_x1 = max(prev_x1 or x1, x1)
                if t.strip():
                    non_space_chars.append(ch)

            text = " ".join("".join(parts).split()).strip()
            if not text or not non_space_chars:
                continue

            sizes = Counter(round(float(c.get("size") or 10.0) * 2.0) / 2.0 for c in non_space_chars)
            dom_size = sizes.most_common(1)[0][0]
            fonts = Counter(_clean_font_name(str(c.get("fontname") or "")) for c in non_space_chars)
            dom_font = fonts.most_common(1)[0][0]
            bold_ratio = sum(1 for c in non_space_chars if _is_bold_font(str(c.get("fontname") or ""))) / len(non_space_chars)
            colors_cnt: Counter = Counter()
            for c in non_space_chars:
                hx = _pdf_color_to_hex(c.get("non_stroking_color"))
                if hx:
                    colors_cnt[hx] += 1
            dom_color = colors_cnt.most_common(1)[0][0] if colors_cnt else None

            alpha_chars = [ch for ch in text if ch.isalpha()]
            upper_ratio = (
                sum(1 for ch in alpha_chars if ch.isupper()) / len(alpha_chars)
                if alpha_chars
                else 0.0
            )

            x0_min = min(float(c["x0"]) for c in non_space_chars)
            x1_max = max(float(c["x1"]) for c in non_space_chars)
            top_min = min(float(c["top"]) for c in non_space_chars)
            bot_max = max(float(c.get("bottom") or (float(c["top"]) + dom_size)) for c in non_space_chars)

            lines.append(
                {
                    "text": text,
                    "x0": x0_min,
                    "x1": x1_max,
                    "top": top_min,
                    "bottom": bot_max,
                    "width": max(0.0, x1_max - x0_min),
                    "size": float(dom_size),
                    "fontname": dom_font,
                    "family": _classify_font_family(dom_font),
                    "is_bold": bold_ratio >= 0.55,
                    "color": dom_color,
                    "upper_ratio": upper_ratio,
                    "char_count": len(non_space_chars),
                }
            )

    lines.sort(key=lambda ln: (round(ln["top"], 1), ln["x0"]))
    return lines


def _extract_horizontal_rules(page: Any, page_w: float) -> List[Dict[str, Any]]:
    """Extrae líneas horizontales y rectángulos muy delgados que actúan como reglas."""
    rules: List[Dict[str, Any]] = []
    for ln in getattr(page, "lines", None) or []:
        try:
            top = float(ln["top"])
            bottom = float(ln["bottom"])
            x0 = float(ln["x0"])
            x1 = float(ln["x1"])
            if abs(bottom - top) <= 3.0 and (x1 - x0) >= 24.0:
                color = _pdf_color_to_hex(ln.get("stroking_color")) or _pdf_color_to_hex(
                    ln.get("non_stroking_color")
                )
                rules.append(
                    {
                        "x0": x0,
                        "x1": x1,
                        "y": (top + bottom) / 2.0,
                        "width": x1 - x0,
                        "thickness": max(float(ln.get("linewidth") or 0.75), abs(bottom - top)),
                        "color": color,
                    }
                )
        except Exception:
            continue

    for rc in getattr(page, "rects", None) or []:
        try:
            top = float(rc["top"])
            bottom = float(rc["bottom"])
            x0 = float(rc["x0"])
            x1 = float(rc["x1"])
            h = bottom - top
            w = x1 - x0
            if 0.0 <= h <= 4.5 and w >= 24.0:
                color = _pdf_color_to_hex(rc.get("non_stroking_color")) or _pdf_color_to_hex(
                    rc.get("stroking_color")
                )
                rules.append(
                    {
                        "x0": x0,
                        "x1": x1,
                        "y": (top + bottom) / 2.0,
                        "width": w,
                        "thickness": max(h, float(rc.get("linewidth") or 0.75)),
                        "color": color,
                    }
                )
        except Exception:
            continue

    # Filtrar reglas fuera de página
    return [r for r in rules if r["width"] <= page_w * 1.05]


def _extract_filled_rects(page: Any) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for rc in getattr(page, "rects", None) or []:
        try:
            fill_hex = _pdf_color_to_hex(rc.get("non_stroking_color")) if rc.get("fill") else None
            stroke_hex = _pdf_color_to_hex(rc.get("stroking_color")) if rc.get("stroke") else None
            if not fill_hex and not stroke_hex:
                continue
            x0 = float(rc["x0"])
            x1 = float(rc["x1"])
            top = float(rc["top"])
            bottom = float(rc["bottom"])
            w = max(0.0, x1 - x0)
            h = max(0.0, bottom - top)
            if w <= 0.2 and h <= 0.2:
                continue
            out.append(
                {
                    "x0": x0,
                    "x1": x1,
                    "top": top,
                    "bottom": bottom,
                    "width": w,
                    "height": h,
                    "fill": fill_hex,
                    "stroke": stroke_hex,
                    "linewidth": float(rc.get("linewidth") or 0.75),
                }
            )
        except Exception:
            continue
    return out


def _render_pages_in_ram(
    pdf_path: Path,
    page_numbers: Sequence[int],
    *,
    scale: float = 1.4,
) -> Dict[int, Image.Image]:
    """Renderiza páginas PDF únicamente en memoria RAM (cero escritura en disco)."""
    rendered: Dict[int, Image.Image] = {}
    if not page_numbers:
        return rendered
    doc = None
    try:
        doc = pdfium.PdfDocument(str(pdf_path))
        total = len(doc)
        for p_num in page_numbers:
            if p_num < 1 or p_num > total:
                continue
            page = doc[p_num - 1]
            bitmap = None
            try:
                bitmap = page.render(scale=scale)
                pil_img = bitmap.to_pil().copy()
                if pil_img.mode in ("RGBA", "LA") or (
                    pil_img.mode == "P" and "transparency" in pil_img.info
                ):
                    rgba = pil_img.convert("RGBA")
                    bg = Image.new("RGB", rgba.size, (255, 255, 255))
                    bg.paste(rgba, mask=rgba.split()[-1])
                    pil_img = bg
                elif pil_img.mode != "RGB":
                    pil_img = pil_img.convert("RGB")
                rendered[p_num] = pil_img
            finally:
                if bitmap is not None:
                    try:
                        bitmap.close()
                    except Exception:
                        pass
                try:
                    page.close()
                except Exception:
                    pass
    except Exception:
        return rendered
    finally:
        if doc is not None:
            try:
                doc.close()
            except Exception:
                pass
    return rendered


def _pil_to_jpeg_data_url(
    pil_img: Image.Image,
    *,
    max_width_px: int = 900,
    quality: int = 78,
) -> Tuple[str, int, int]:
    img = pil_img
    if img.mode != "RGB":
        img = img.convert("RGB")
    if max_width_px > 0 and img.width > max_width_px:
        ratio = max_width_px / float(img.width)
        new_h = max(1, int(round(img.height * ratio)))
        resampling = Image.Resampling.LANCZOS if hasattr(Image, "Resampling") else Image.LANCZOS
        img = img.resize((max_width_px, new_h), resampling)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality, optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/jpeg;base64,{b64}", img.width, img.height


def _sample_pixel_palette(pil_img: Image.Image) -> Dict[str, Any]:
    """
    Muestreo ligero en RAM sobre imagen renderizada para detectar fondo real
    (p. ej. temas oscuros o PDFs escaneados), márgenes aproximados y color acento.
    """
    resampling = Image.Resampling.BILINEAR if hasattr(Image, "Resampling") else Image.BILINEAR
    target_w = min(260, max(80, pil_img.width))
    target_h = max(80, int(round(pil_img.height * (target_w / float(max(1, pil_img.width))))))
    small = pil_img.convert("RGB").resize((target_w, target_h), resampling)
    pixels = small.load()
    if pixels is None:
        return {}

    # Muestrear bordes/esquinas para detectar el color real de fondo de página
    edge_samples: Counter = Counter()
    margin_x = max(2, target_w // 25)
    margin_y = max(2, target_h // 25)
    coords: List[Tuple[int, int]] = []
    for dx in range(2, margin_x + 4):
        for dy in range(2, margin_y + 4):
            coords.extend(
                [
                    (dx, dy),
                    (target_w - 1 - dx, dy),
                    (dx, target_h - 1 - dy),
                    (target_w - 1 - dx, target_h - 1 - dy),
                ]
            )
    # También muestrear bordes laterales a media altura (evita top_band en y=0)
    for y_frac in (0.35, 0.5, 0.65, 0.8):
        y_pos = int(target_h * y_frac)
        for dx in range(2, margin_x + 4):
            coords.append((dx, y_pos))
            coords.append((target_w - 1 - dx, y_pos))

    for x, y in coords:
        if 0 <= x < target_w and 0 <= y < target_h:
            r, g, b = pixels[x, y]
            edge_samples[_quantize_hex(_rgb_to_hex(r, g, b), step=6)] += 1

    if not edge_samples:
        return {}

    bg_hex = edge_samples.most_common(1)[0][0]
    if _color_distance(bg_hex, "#FFFFFF") <= 14:
        bg_hex = "#FFFFFF"

    # Recolectar colores no-fondo y bounding box visual (útil para escaneados)
    fg_counts: Counter = Counter()
    accent_counts: Counter = Counter()
    min_x, max_x = target_w, 0
    min_y, max_y = target_h, 0
    for y in range(0, target_h, 2):
        for x in range(0, target_w, 2):
            r, g, b = pixels[x, y]
            hx = _rgb_to_hex(r, g, b)
            dist = _color_distance(hx, bg_hex)
            if dist >= 22:
                if x < min_x:
                    min_x = x
                if x > max_x:
                    max_x = x
                if y < min_y:
                    min_y = y
                if y > max_y:
                    max_y = y
                q = _quantize_hex(hx, step=12)
                fg_counts[q] += 1
                if _is_chromatic_accent(hx) and dist >= 35:
                    accent_counts[q] += 1

    text_hex: Optional[str] = None
    if fg_counts:
        # Elegir color frecuente con mayor contraste respecto a bg_hex
        best_fg = max(
            fg_counts.most_common(12),
            key=lambda kv: _contrast_ratio(kv[0], bg_hex) * math.log1p(kv[1]),
        )
        if _contrast_ratio(best_fg[0], bg_hex) >= 3.0:
            text_hex = best_fg[0]

    accent_hex: Optional[str] = None
    if accent_counts:
        best_acc = max(
            accent_counts.most_common(12),
            key=lambda kv: (_saturation(kv[0]) ** 1.5) * math.log1p(kv[1]),
        )
        accent_hex = best_acc[0]

    margins_ratio: Optional[Dict[str, float]] = None
    if max_x > min_x and max_y > min_y:
        margins_ratio = {
            "left": min_x / float(target_w),
            "right": (target_w - 1 - max_x) / float(target_w),
            "top": min_y / float(target_h),
            "bottom": (target_h - 1 - max_y) / float(target_h),
        }

    return {
        "page_bg": bg_hex,
        "text": text_hex,
        "accent": accent_hex,
        "margins_ratio": margins_ratio,
    }


def _tokenize_running_text(
    raw_text: str,
    *,
    is_footer: bool,
    page_num: int,
    slot: str,
    used_tokens: Set[str],
) -> str:
    """
    Convierte texto real de encabezado/pie a tokens estructurales seguros
    (`{title}`, `{author}`, `{date}`, `Página {page} de {total}`, etc.) sin
    copiar nunca texto literal ni datos personales.
    """
    txt = " ".join((raw_text or "").split()).strip()
    if not txt:
        return ""

    low = txt.lower()
    if re.search(r"(?:p[áa]gina|p[áa]g\.?)\s*\d+\s*(?:de|/)\s*\d+", low):
        return "Página {page} de {total}"
    if re.search(r"(?:page|p\.)\s*\d+\s*(?:of|/)\s*\d+", low):
        return "Page {page} of {total}"
    if re.fullmatch(r"\d+\s*/\s*\d+", txt):
        return "{page} / {total}"
    if re.search(r"(?:p[áa]gina|p[áa]g\.?)\s*\d+", low):
        return "Página {page}"
    if re.search(r"\bpage\s*\d+\b", low):
        return "Page {page}"
    if re.fullmatch(r"[-–—\s]*\d+[-–—\s]*", txt):
        try:
            num = int(re.sub(r"\D", "", txt))
            if abs(num - page_num) <= 2:
                return "{page}"
        except ValueError:
            pass

    if _DATE_NUM_RE.search(txt) or _MONTH_WORDS_RE.search(txt) or re.search(r"\b20[12]\d\b", txt):
        used_tokens.add("{date}")
        return "{date}"

    if is_footer:
        if "{date}" not in used_tokens and slot == "left":
            used_tokens.add("{date}")
            return "{date}"
        if "{title}" not in used_tokens:
            used_tokens.add("{title}")
            return "{title}"
        return "{author}" if "{author}" not in used_tokens else ""

    # Encabezado: asignar tokens estructurales según posición sin copiar nombres reales
    if "{title}" not in used_tokens and slot in ("left", "center"):
        used_tokens.add("{title}")
        return "{title}"
    if "{author}" not in used_tokens:
        used_tokens.add("{author}")
        return "{author}"
    return "{title}" if "{title}" not in used_tokens else ""


def _detect_header_footer(
    pages_data: List[Dict[str, Any]],
    page_w: float,
    page_h: float,
    page_bg: str,
) -> Tuple[Dict[str, Any], Dict[str, Any], Dict[int, Tuple[float, float]]]:
    """
    Detecta encabezados y pies de página reales en zonas superior/inferior (~12%),
    incluyendo líneas divisoras, fondo de barra, posición de logo y `skip_first_page`.
    Retorna `(header_spec, footer_spec, body_y_bounds_by_page)`.
    """
    top_band_limit = min(72.0, page_h * 0.095)
    bottom_band_start = max(page_h - 76.0, page_h * 0.90)

    def _zone_info(pdata: Dict[str, Any]) -> Dict[str, Any]:
        top_lines = [
            ln
            for ln in pdata["lines"]
            if ln["top"] <= top_band_limit and ln["size"] <= 12.5
        ]
        # Evitar capturar subrayados de un H1 que inicia cerca del margen superior
        first_large_top = min(
            (ln["top"] for ln in pdata["lines"] if ln["size"] >= 13.0),
            default=page_h,
        )
        top_rule_ceiling = min(top_band_limit + 6.0, first_large_top - 4.0)
        if top_lines:
            max_header_bot = max(ln["bottom"] for ln in top_lines)
            top_rule_ceiling = min(top_rule_ceiling, max_header_bot + 18.0)

        bot_lines = [
            ln
            for ln in pdata["lines"]
            if ln["bottom"] >= bottom_band_start and ln["size"] <= 12.5
        ]
        top_rules = [
            r
            for r in pdata["rules"]
            if r["y"] <= top_rule_ceiling and r["width"] >= page_w * 0.42
        ]
        bot_rules = [
            r
            for r in pdata["rules"]
            if r["y"] >= bottom_band_start - 14.0 and r["width"] >= page_w * 0.42
        ]
        top_bg_rects = [
            rc
            for rc in pdata["rects"]
            if rc["fill"]
            and _color_distance(rc["fill"], page_bg) > 16
            and rc["top"] <= 28.0
            and 14.0 <= rc["height"] <= 95.0
            and rc["width"] >= page_w * 0.65
        ]
        header_logos = [
            img
            for img in pdata["images"]
            if img["top"] <= top_band_limit + 16.0
            and 14.0 <= img["height"] <= 72.0
            and 18.0 <= img["width"] <= page_w * 0.45
        ]
        return {
            "top_lines": top_lines,
            "bot_lines": bot_lines,
            "top_rules": top_rules,
            "bot_rules": bot_rules,
            "top_bg_rects": top_bg_rects,
            "header_logos": header_logos,
        }

    zones = {pd["page_num"]: _zone_info(pd) for pd in pages_data}
    interior_pages = [pd for pd in pages_data if pd["page_num"] >= 2]
    ref_pages = interior_pages if interior_pages else pages_data

    # --- Header ---
    header_hits = 0
    for pd in ref_pages:
        z = zones[pd["page_num"]]
        has_top_signal = bool(z["top_rules"]) or bool(z["header_logos"]) or bool(z["top_bg_rects"])
        if len(ref_pages) >= 2 and z["top_lines"]:
            has_top_signal = True
        elif len(ref_pages) == 1 and z["top_lines"]:
            # En 1 sola página, exigir señal de encabezado (regla, barra o texto muy pequeño arriba)
            if z["top_rules"] or z["top_bg_rects"] or all(ln["size"] <= 9.2 for ln in z["top_lines"]):
                has_top_signal = True
        if has_top_signal:
            header_hits += 1

    header_enabled = header_hits >= max(1, math.ceil(len(ref_pages) * 0.5))
    # Evitar marcar encabezado si en interior solo hay un título grande (no running header)
    if header_enabled and len(ref_pages) >= 2:
        has_consistent_header = False
        for pd in ref_pages:
            z = zones[pd["page_num"]]
            if z["top_rules"] or z["header_logos"] or z["top_bg_rects"]:
                has_consistent_header = True
                break
        if not has_consistent_header:
            # Comprobar que las posiciones Y de líneas superiores coincidan entre páginas interiores
            y_positions = [
                round(z["top_lines"][0]["top"] / 4.0) * 4.0
                for pd in ref_pages
                for z in [zones[pd["page_num"]]]
                if z["top_lines"]
            ]
            if len(y_positions) >= 2 and Counter(y_positions).most_common(1)[0][1] >= 2:
                has_consistent_header = True
            else:
                header_enabled = False

    first_zone = zones[pages_data[0]["page_num"]]
    first_has_header = bool(
        first_zone["top_rules"]
        or first_zone["header_logos"]
        or (
            first_zone["top_lines"]
            and any(ln["size"] <= 9.5 for ln in first_zone["top_lines"])
        )
    )
    if len(pages_data) >= 2 and not first_has_header:
        header_skip_first = True
    elif len(pages_data) >= 2 and first_has_header:
        # Comparar con página 2 para confirmar si página 1 tiene el mismo running header
        p2_zone = zones[interior_pages[0]["page_num"]]
        if p2_zone["top_lines"] and first_zone["top_lines"]:
            y_diff = abs(p2_zone["top_lines"][0]["top"] - first_zone["top_lines"][0]["top"])
            header_skip_first = y_diff > 14.0
        elif p2_zone["top_rules"] and not first_zone["top_rules"]:
            header_skip_first = True
        else:
            header_skip_first = False
    else:
        header_skip_first = False

    # Construir detalles del encabezado
    h_left, h_center, h_right = "", "", ""
    h_border_bottom = False
    h_border_color: Optional[str] = None
    h_bg_hex: Optional[str] = None
    h_height = 28.0
    h_logo_pos = "left"
    h_logo_height = 24.0

    if header_enabled:
        sample_pd = next(
            (
                pd
                for pd in ref_pages
                if zones[pd["page_num"]]["top_lines"]
                or zones[pd["page_num"]]["top_rules"]
                or zones[pd["page_num"]]["header_logos"]
            ),
            ref_pages[0],
        )
        sz = zones[sample_pd["page_num"]]
        used_tokens: Set[str] = set()
        slots: Dict[str, str] = {"left": "", "center": "", "right": ""}
        for ln in sorted(sz["top_lines"], key=lambda item: item["x0"]):
            cx = (ln["x0"] + ln["x1"]) / 2.0
            if cx < page_w * 0.36:
                slot = "left"
            elif cx > page_w * 0.64:
                slot = "right"
            else:
                slot = "center"
            if not slots[slot]:
                slots[slot] = _tokenize_running_text(
                    ln["text"],
                    is_footer=False,
                    page_num=sample_pd["page_num"],
                    slot=slot,
                    used_tokens=used_tokens,
                )
        h_left, h_center, h_right = slots["left"], slots["center"], slots["right"]

        if sz["top_rules"]:
            rule = max(sz["top_rules"], key=lambda r: r["y"])
            h_border_bottom = True
            h_border_color = rule.get("color")
            h_height = round(max(18.0, min(90.0, rule["y"] - 8.0)), 1)
        elif sz["top_lines"]:
            max_bot = max(ln["bottom"] for ln in sz["top_lines"])
            h_height = round(max(18.0, min(80.0, max_bot - 6.0)), 1)

        if sz["top_bg_rects"]:
            # Si es una banda muy delgada arriba sin texto dentro, pertenece a cover.top_band, no header background
            bg_rect = sz["top_bg_rects"][0]
            if bg_rect["height"] >= 22.0:
                h_bg_hex = bg_rect["fill"]
                h_height = round(max(h_height, min(95.0, bg_rect["height"])), 1)

        if sz["header_logos"]:
            lg = sz["header_logos"][0]
            cx = (lg["x0"] + lg["x1"]) / 2.0
            if cx < page_w * 0.36:
                h_logo_pos = "left"
            elif cx > page_w * 0.64:
                h_logo_pos = "right"
            else:
                h_logo_pos = "center"
            h_logo_height = round(max(14.0, min(56.0, lg["height"])), 1)

    header_spec = {
        "enabled": header_enabled,
        "skip_first_page": header_skip_first,
        "height_pt": h_height,
        "border_bottom": h_border_bottom,
        "border_color": h_border_color,
        "background_hex": h_bg_hex,
        "left": h_left,
        "center": h_center,
        "right": h_right,
        "logo_asset": None,
        "logo_position": h_logo_pos,
        "logo_height_pt": h_logo_height,
    }

    # --- Footer ---
    footer_hits = 0
    for pd in ref_pages:
        z = zones[pd["page_num"]]
        has_bot = bool(z["bot_rules"])
        if z["bot_lines"]:
            if len(ref_pages) >= 2:
                has_bot = True
            else:
                # 1 sola página: detectar pie si tiene patrón de página o regla o tamaño pequeño
                for ln in z["bot_lines"]:
                    if (
                        re.search(r"(?:p[áa]gina|page|\d+\s*/\s*\d+)", ln["text"], re.IGNORECASE)
                        or re.fullmatch(r"[-–—\s]*\d+[-–—\s]*", ln["text"])
                        or ln["size"] <= 9.0
                    ):
                        has_bot = True
                        break
        if has_bot:
            footer_hits += 1

    footer_enabled = footer_hits >= max(1, math.ceil(len(ref_pages) * 0.5))
    if footer_enabled and len(ref_pages) >= 2:
        has_consistent_footer = any(zones[pd["page_num"]]["bot_rules"] for pd in ref_pages)
        if not has_consistent_footer:
            y_bots = [
                round(z["bot_lines"][-1]["bottom"] / 4.0) * 4.0
                for pd in ref_pages
                for z in [zones[pd["page_num"]]]
                if z["bot_lines"]
            ]
            if len(y_bots) >= 2 and Counter(y_bots).most_common(1)[0][1] >= 2:
                has_consistent_footer = True
            else:
                # También aceptar si contiene numeración de página explícita
                has_page_num = any(
                    re.search(r"(?:p[áa]gina|page|\d+\s*/\s*\d+|^\s*\d+\s*$)", ln["text"], re.IGNORECASE)
                    for pd in ref_pages
                    for ln in zones[pd["page_num"]]["bot_lines"]
                )
                if not has_page_num:
                    footer_enabled = False

    first_has_footer = bool(
        first_zone["bot_rules"]
        or (
            first_zone["bot_lines"]
            and any(
                re.search(r"(?:p[áa]gina|page|\d+\s*/\s*\d+|^\s*\d+\s*$)", ln["text"], re.IGNORECASE)
                or ln["size"] <= 9.5
                for ln in first_zone["bot_lines"]
            )
        )
    )
    footer_skip_first = bool(len(pages_data) >= 2 and not first_has_footer)

    f_left, f_center, f_right = "", "", ""
    f_border_top = False
    f_border_color: Optional[str] = None
    f_height = 26.0

    if footer_enabled:
        sample_pd = next(
            (
                pd
                for pd in ref_pages
                if zones[pd["page_num"]]["bot_lines"] or zones[pd["page_num"]]["bot_rules"]
            ),
            ref_pages[0],
        )
        sz = zones[sample_pd["page_num"]]
        used_tokens_f: Set[str] = set()
        slots_f: Dict[str, str] = {"left": "", "center": "", "right": ""}
        for ln in sorted(sz["bot_lines"], key=lambda item: item["x0"]):
            cx = (ln["x0"] + ln["x1"]) / 2.0
            if cx < page_w * 0.36:
                slot = "left"
            elif cx > page_w * 0.64:
                slot = "right"
            else:
                slot = "center"
            if not slots_f[slot]:
                slots_f[slot] = _tokenize_running_text(
                    ln["text"],
                    is_footer=True,
                    page_num=sample_pd["page_num"],
                    slot=slot,
                    used_tokens=used_tokens_f,
                )
        f_left, f_center, f_right = slots_f["left"], slots_f["center"], slots_f["right"]

        if sz["bot_rules"]:
            rule = min(sz["bot_rules"], key=lambda r: r["y"])
            f_border_top = True
            f_border_color = rule.get("color")
            f_height = round(max(18.0, min(85.0, page_h - rule["y"])), 1)
        elif sz["bot_lines"]:
            min_top = min(ln["top"] for ln in sz["bot_lines"])
            f_height = round(max(18.0, min(80.0, page_h - min_top)), 1)

    footer_spec = {
        "enabled": footer_enabled,
        "skip_first_page": footer_skip_first,
        "height_pt": f_height,
        "border_top": f_border_top,
        "border_color": f_border_color,
        "left": f_left,
        "center": f_center,
        "right": f_right,
    }

    # Calcular cotas verticales del cuerpo excluyendo encabezado y pie detectados
    body_bounds: Dict[int, Tuple[float, float]] = {}
    for pd in pages_data:
        pnum = pd["page_num"]
        z = zones[pnum]
        y_min = 0.0
        y_max = page_h
        if header_enabled and not (pnum == 1 and header_skip_first):
            candidates_top = [ln["bottom"] + 3.0 for ln in z["top_lines"]] + [
                r["y"] + 3.0 for r in z["top_rules"]
            ]
            if candidates_top:
                y_min = min(top_band_limit + 14.0, max(candidates_top))
        if footer_enabled and not (pnum == 1 and footer_skip_first):
            candidates_bot = [ln["top"] - 3.0 for ln in z["bot_lines"]] + [
                r["y"] - 3.0 for r in z["bot_rules"]
            ]
            if candidates_bot:
                y_max = max(bottom_band_start - 14.0, min(candidates_bot))
        body_bounds[pnum] = (y_min, y_max)

    return header_spec, footer_spec, body_bounds


def _detect_cover(
    pages_data: List[Dict[str, Any]],
    *,
    body_size: float,
    body_family: str,
    page_w: float,
    page_h: float,
    page_bg: str,
    header_spec: Dict[str, Any],
    footer_spec: Dict[str, Any],
) -> Dict[str, Any]:
    """Detecta si la página 1 es una portada dedicada, su layout y banda superior."""
    p1 = pages_data[0]
    p1_rects = p1["rects"]
    p1_lines = p1["lines"]

    # Detectar banda superior decorativa en página 1 (incluso si no es portada completa)
    top_band = False
    top_band_height = 16.0
    for rc in p1_rects:
        if (
            rc["fill"]
            and _color_distance(rc["fill"], page_bg) > 18
            and rc["top"] <= 20.0
            and 4.0 <= rc["height"] <= 48.0
            and rc["width"] >= page_w * 0.75
        ):
            top_band = True
            top_band_height = round(rc["height"], 1)
            break

    if len(pages_data) < 2:
        return {
            "enabled": False,
            "layout": "none",
            "top_band": top_band,
            "top_band_height_pt": top_band_height,
            "logo_asset": None,
            "background_asset": None,
        }

    p1_words = sum(len(ln["text"].split()) for ln in p1_lines)
    interior = pages_data[1:]
    avg_interior_words = sum(sum(len(ln["text"].split()) for ln in pd["lines"]) for pd in interior) / max(
        1, len(interior)
    )
    p1_max_size = max((ln["size"] for ln in p1_lines), default=body_size)

    # Contar párrafos densos en página 1 (líneas largas tamaño cuerpo)
    p1_dense_body_lines = sum(
        1
        for ln in p1_lines
        if abs(ln["size"] - body_size) <= 1.5 and ln["width"] >= page_w * 0.45
    )

    score = 0
    if p1_words <= 90 and (avg_interior_words >= 75 and p1_words < avg_interior_words * 0.55):
        score += 2
    elif p1_words <= 65 and p1_dense_body_lines <= 3:
        score += 2
    if p1_max_size >= max(body_size * 1.65, 17.5):
        score += 1
    if (header_spec["enabled"] and header_spec["skip_first_page"]) or (
        footer_spec["enabled"] and footer_spec["skip_first_page"]
    ):
        score += 1
    if p1_dense_body_lines >= 10:
        score -= 2

    # Verificar rectángulos/imágenes grandes de portada
    full_bleed_rect = any(
        rc["fill"]
        and _color_distance(rc["fill"], page_bg) > 20
        and rc["width"] >= page_w * 0.85
        and rc["height"] >= page_h * 0.72
        for rc in p1_rects
    )
    full_bleed_img = any(
        img["width"] >= page_w * 0.82 and img["height"] >= page_h * 0.65
        for img in p1["images"]
    )
    hero_top_rect = any(
        rc["fill"]
        and _color_distance(rc["fill"], page_bg) > 20
        and rc["top"] <= 30.0
        and rc["width"] >= page_w * 0.80
        and page_h * 0.20 <= rc["height"] <= page_h * 0.58
        for rc in p1_rects
    )
    split_rect = any(
        rc["fill"]
        and _color_distance(rc["fill"], page_bg) > 20
        and rc["height"] >= page_h * 0.65
        and page_w * 0.25 <= rc["width"] <= page_w * 0.58
        for rc in p1_rects
    )
    if full_bleed_rect or full_bleed_img or hero_top_rect or split_rect:
        score += 2

    cover_enabled = score >= 3
    if not cover_enabled:
        return {
            "enabled": False,
            "layout": "none",
            "top_band": top_band,
            "top_band_height_pt": top_band_height,
            "logo_asset": None,
            "background_asset": None,
        }

    # Clasificar layout de portada
    centered_lines = sum(
        1
        for ln in p1_lines
        if abs(((ln["x0"] + ln["x1"]) / 2.0) - (page_w / 2.0)) <= page_w * 0.08
    )
    mostly_centered = bool(p1_lines) and (centered_lines / len(p1_lines)) >= 0.6

    if full_bleed_rect or full_bleed_img:
        layout = "full_bleed"
    elif hero_top_rect:
        layout = "hero_top"
    elif split_rect:
        layout = "split"
    elif top_band:
        layout = "band_top"
    elif mostly_centered:
        layout = "academic_centered" if body_family == "serif" else "centered"
    else:
        layout = "minimal"

    return {
        "enabled": True,
        "layout": layout,
        "top_band": top_band,
        "top_band_height_pt": top_band_height,
        "logo_asset": None,
        "background_asset": None,
    }


def _detect_columns(
    body_lines_by_page: Dict[int, List[Dict[str, Any]]],
    page_w: float,
    left_margin: float,
    right_margin: float,
) -> Tuple[int, float]:
    """Detecta maquetación de 1 o 2 columnas y mide `column_gap_pt` real."""
    content_left = left_margin
    content_right = page_w - right_margin
    content_w = content_right - content_left
    if content_w < 240.0:
        return 1, 18.0

    mid_x = (content_left + content_right) / 2.0
    gutter_half = 2.0
    left_count = 0
    right_count = 0
    cross_count = 0
    overlap_pairs = 0
    left_x1s: List[float] = []
    right_x0s: List[float] = []

    for lines in body_lines_by_page.values():
        p_left: List[Dict[str, Any]] = []
        p_right: List[Dict[str, Any]] = []
        for ln in lines:
            # Ignorar títulos muy cortos de 1 palabra o líneas muy angostas
            if ln["char_count"] < 6:
                continue
            if ln["x1"] <= mid_x - gutter_half:
                p_left.append(ln)
                left_x1s.append(ln["x1"])
            elif ln["x0"] >= mid_x + gutter_half:
                p_right.append(ln)
                right_x0s.append(ln["x0"])
            else:
                cross_count += 1

        left_count += len(p_left)
        right_count += len(p_right)
        for l_ln in p_left:
            if any(abs(l_ln["top"] - r_ln["top"]) <= 18.0 for r_ln in p_right):
                overlap_pairs += 1

    total_split = left_count + right_count
    if (
        left_count >= 5
        and right_count >= 5
        and overlap_pairs >= 4
        and cross_count <= max(3, int(total_split * 0.25))
    ):
        left_edge = sorted(left_x1s)[int(len(left_x1s) * 0.90)]
        right_edge = sorted(right_x0s)[int(len(right_x0s) * 0.10)]
        gap = round(max(8.0, min(48.0, right_edge - left_edge)), 1)
        if gap >= 8.0:
            return 2, gap

    return 1, 18.0


def _detect_heading_decoration(
    heading_lines: Sequence[Dict[str, Any]],
    pages_by_num: Dict[int, Dict[str, Any]],
    page_bg: str,
) -> str:
    """Detecta si un nivel de encabezado usa `band`, `left_bar`, `underline` o `plain`."""
    votes: Counter = Counter()
    for h in heading_lines:
        pdata = pages_by_num.get(h["page_num"])
        if not pdata:
            continue
        found = "plain"

        # 1. Banda de fondo (rect relleno envolviendo el encabezado)
        for rc in pdata["rects"]:
            if not rc["fill"] or _color_distance(rc["fill"], page_bg) <= 14:
                continue
            if (
                rc["top"] <= h["top"] + 4.0
                and rc["bottom"] >= h["bottom"] - 4.0
                and rc["height"] <= max(46.0, h["size"] * 3.0)
                and rc["width"] >= max(h["width"] * 0.85, 80.0)
                and rc["x0"] <= h["x0"] + 6.0
            ):
                found = "band"
                break

        # 2. Barra lateral izquierda (rect vertical angosto o línea vertical gruesa a la izquierda)
        if found == "plain":
            for rc in pdata["rects"]:
                if not rc["fill"] or _color_distance(rc["fill"], page_bg) <= 14:
                    continue
                if (
                    1.0 <= rc["width"] <= 10.0
                    and rc["height"] >= h["size"] * 0.75
                    and rc["height"] <= h["size"] * 3.5
                    and h["x0"] - 20.0 <= rc["x1"] <= h["x0"] + 3.0
                    and rc["top"] <= h["bottom"]
                    and rc["bottom"] >= h["top"]
                ):
                    found = "left_bar"
                    break

        if found == "plain":
            for ln in pdata.get("vlines") or []:
                if (
                    ln["height"] >= h["size"] * 0.75
                    and ln["height"] <= h["size"] * 3.5
                    and h["x0"] - 20.0 <= ln["x"] <= h["x0"] + 3.0
                    and ln["top"] <= h["bottom"]
                    and ln["bottom"] >= h["top"]
                ):
                    found = "left_bar"
                    break

        # 3. Subrayado (regla horizontal justo debajo del encabezado)
        if found == "plain":
            for rule in pdata["rules"]:
                if (
                    h["bottom"] - 2.0 <= rule["y"] <= h["bottom"] + 13.0
                    and rule["x0"] <= h["x0"] + 14.0
                    and rule["width"] >= min(h["width"] * 0.55, 80.0)
                ):
                    found = "underline"
                    break

        votes[found] += 1

    if not votes:
        return "plain"
    non_plain = [(k, v) for k, v in votes.items() if k != "plain"]
    if non_plain:
        best_k, best_v = max(non_plain, key=lambda kv: kv[1])
        if best_v >= max(1, math.ceil(len(heading_lines) * 0.45)):
            return best_k
    return "plain"


def _detect_table_styling(
    pages_data: List[Dict[str, Any]],
    page_bg: str,
    document_type: str,
) -> Tuple[Dict[str, Any], List[Tuple[int, Tuple[float, float, float, float]]]]:
    """Inspecciona tablas reales para estilo, colores de cabecera/filas alternas, bordes y padding."""
    table_bboxes: List[Tuple[int, Tuple[float, float, float, float]]] = []
    header_bgs: Counter = Counter()
    header_fgs: Counter = Counter()
    alt_bgs: Counter = Counter()
    border_colors: Counter = Counter()
    font_sizes: List[float] = []
    pad_vs: List[float] = []
    pad_hs: List[float] = []
    style_votes: Counter = Counter()

    for pd in pages_data:
        pnum = pd["page_num"]
        for tbl in pd["tables"]:
            bbox = tbl["bbox"]
            table_bboxes.append((pnum, bbox))
            tx0, ttop, tx1, tbot = bbox
            tw = max(1.0, tx1 - tx0)
            th = max(1.0, tbot - ttop)
            rows_meta = tbl.get("rows_bbox") or []
            row0_bot = rows_meta[0][3] if rows_meta else (ttop + min(26.0, th * 0.25))

            # Colores de fondo dentro de la tabla
            row_fills: List[Tuple[float, str]] = []
            for rc in pd["rects"]:
                if not rc["fill"]:
                    continue
                if (
                    rc["x0"] >= tx0 - 4.0
                    and rc["x1"] <= tx1 + 4.0
                    and rc["top"] >= ttop - 4.0
                    and rc["bottom"] <= tbot + 4.0
                    and rc["width"] >= tw * 0.25
                    and rc["height"] >= 6.0
                ):
                    if _color_distance(rc["fill"], page_bg) > 10:
                        if rc["top"] <= row0_bot + 2.0 and rc["bottom"] <= row0_bot + 6.0:
                            header_bgs[rc["fill"]] += 1
                        else:
                            row_fills.append((rc["top"], rc["fill"]))
                            alt_bgs[rc["fill"]] += 1
                if (
                    rc["stroke"]
                    and rc["x0"] >= tx0 - 4.0
                    and rc["x1"] <= tx1 + 4.0
                    and rc["top"] >= ttop - 4.0
                    and rc["bottom"] <= tbot + 4.0
                ):
                    border_colors[rc["stroke"]] += 1

            # Contar reglas horizontales y verticales en la tabla
            h_rules_in = [
                r
                for r in pd["rules"]
                if r["x0"] >= tx0 - 5.0
                and r["x1"] <= tx1 + 5.0
                and ttop - 4.0 <= r["y"] <= tbot + 4.0
                and r["width"] >= tw * 0.45
            ]
            v_lines_in = [
                vl
                for vl in pd["vlines"]
                if tx0 - 5.0 <= vl["x"] <= tx1 + 5.0
                and vl["top"] >= ttop - 5.0
                and vl["bottom"] <= tbot + 5.0
                and vl["height"] >= th * 0.35
            ]
            for r in h_rules_in:
                if r.get("color"):
                    border_colors[r["color"]] += 1
            for vl in v_lines_in:
                if vl.get("color"):
                    border_colors[vl["color"]] += 1

            # Texto dentro de la tabla (tamaño y color de cabecera)
            for ln in pd["lines"]:
                if (
                    ln["x0"] >= tx0 - 3.0
                    and ln["x1"] <= tx1 + 3.0
                    and ln["top"] >= ttop - 3.0
                    and ln["bottom"] <= tbot + 3.0
                ):
                    if ln["top"] <= row0_bot + 2.0:
                        if ln["color"]:
                            header_fgs[ln["color"]] += 1
                    else:
                        font_sizes.append(ln["size"])

            # Padding estimado desde celdas
            for cell_bbox in tbl.get("sample_cells") or []:
                cx0, ctop, cx1, cbot = cell_bbox
                inner = [
                    ln
                    for ln in pd["lines"]
                    if ln["x0"] >= cx0 - 1.0
                    and ln["x1"] <= cx1 + 1.0
                    and ln["top"] >= ctop - 1.0
                    and ln["bottom"] <= cbot + 1.0
                ]
                if inner:
                    pad_l = inner[0]["x0"] - cx0
                    pad_t = inner[0]["top"] - ctop
                    if 1.0 <= pad_l <= 24.0:
                        pad_hs.append(pad_l)
                    if 1.0 <= pad_t <= 20.0:
                        pad_vs.append(pad_t)

            # Clasificación de estilo de tabla
            has_v_grid = len(v_lines_in) >= 3
            has_h_rules = len(h_rules_in) >= 2
            has_alt = len(row_fills) >= 1

            if document_type in ("invoice", "quote") and not has_v_grid:
                style_votes["invoice"] += 1
            elif has_v_grid and has_h_rules:
                style_votes["bordered"] += 1
            elif has_alt:
                style_votes["striped"] += 1
            elif has_h_rules:
                style_votes["minimal_rules"] += 1
            else:
                style_votes["clean"] += 1

    style = style_votes.most_common(1)[0][0] if style_votes else (
        "invoice" if document_type in ("invoice", "quote") else "striped"
    )

    return (
        {
            "style": style,
            "header_bg": header_bgs.most_common(1)[0][0] if header_bgs else None,
            "header_fg": header_fgs.most_common(1)[0][0] if header_fgs else None,
            "alt_row_bg": alt_bgs.most_common(1)[0][0] if alt_bgs else None,
            "border_color": border_colors.most_common(1)[0][0] if border_colors else None,
            "font_size": round(statistics.median(font_sizes), 1) if font_sizes else 8.8,
            "cell_padding_v": round(statistics.median(pad_vs), 1) if pad_vs else 5.5,
            "cell_padding_h": round(statistics.median(pad_hs), 1) if pad_hs else 7.0,
        },
        table_bboxes,
    )


def _classify_document_type(
    all_lines: Sequence[Dict[str, Any]],
    *,
    has_tables: bool,
    body_family: str,
    columns: int,
    page_count: int,
) -> str:
    """Heurística de tipo de documento usando señales estructurales (sin almacenar contenido)."""
    joined = " ".join(ln["text"].lower() for ln in all_lines[:180])
    scores: Dict[str, int] = {dt: 0 for dt in DOCUMENT_TYPES}

    keyword_groups: Dict[str, Tuple[str, ...]] = {
        "invoice": (
            "factura",
            "invoice",
            "cfdi",
            "folio fiscal",
            "subtotal",
            "total a pagar",
            "importe",
            "i.v.a",
            "iva",
            "bill to",
            "amount due",
        ),
        "quote": (
            "cotización",
            "cotizacion",
            "presupuesto",
            "quotation",
            "quote",
            "vigencia",
            "propuesta económica",
            "propuesta economica",
            "precio unitario",
        ),
        "contract": (
            "contrato",
            "cláusula",
            "clausula",
            "cláusulas",
            "clausulas",
            "declaraciones",
            "convenio",
            "acuerdo",
            "obligaciones",
            "jurisdicción",
            "agreement",
            "hereby",
            "witnesseth",
            "arrendamiento",
            "confidencialidad",
        ),
        "academic": (
            "abstract",
            "resumen",
            "metodología",
            "metodologia",
            "bibliografía",
            "bibliografia",
            "referencias",
            "hipótesis",
            "hipotesis",
            "universidad",
            "tesis",
            "ensayo",
            "palabras clave",
            "keywords",
            "doi:",
            "introducción",
        ),
        "proposal": (
            "propuesta",
            "alcance",
            "entregables",
            "cronograma",
            "inversión",
            "inversion",
            "objetivos del proyecto",
            "proposal",
            "deliverables",
            "roadmap",
        ),
        "manual": (
            "manual",
            "guía de usuario",
            "guia de usuario",
            "instrucciones",
            "instalación",
            "instalacion",
            "requisitos",
            "paso a paso",
            "solución de problemas",
            "troubleshooting",
            "user guide",
        ),
        "letter": (
            "estimado",
            "estimada",
            "atentamente",
            "asunto:",
            "presente",
            "cordialmente",
            "dear ",
            "sincerely",
            "oficio",
        ),
        "form": (
            "formulario",
            "solicitud",
            "marque con",
            "llenar con",
            "firma del solicitante",
            "fecha de nacimiento",
            "application form",
            "check all",
        ),
        "report": (
            "informe",
            "reporte",
            "resumen ejecutivo",
            "executive summary",
            "análisis",
            "analisis",
            "conclusiones",
            "recomendaciones",
            "resultados",
            "indicadores",
            "kpi",
        ),
    }

    for dtype, keywords in keyword_groups.items():
        for kw in keywords:
            if kw in joined:
                scores[dtype] += 2

    if has_tables:
        scores["invoice"] += 1
        scores["quote"] += 1
        scores["report"] += 1
    if body_family == "serif" and columns == 2:
        scores["academic"] += 2
    if page_count == 1 and scores["letter"] >= 2:
        scores["letter"] += 2

    best_type, best_score = max(scores.items(), key=lambda kv: kv[1])
    if best_score >= 2:
        return best_type
    return "report" if page_count >= 2 else "custom"


def _extract_logo_assets(
    pdf_path: Path,
    pages_data: List[Dict[str, Any]],
    assets_dir: Path,
    *,
    cover_enabled: bool,
    page_w: float,
    page_h: float,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """
    Extrae de forma segura logotipos candidatos (encabezado o portada) como PNG
    acotado dentro de `assets_dir`. Nunca guarda capturas de página completa.
    """
    extracted: List[Dict[str, Any]] = []
    updates: Dict[str, Any] = {}

    if not pages_data:
        return extracted, updates

    candidates: List[Tuple[str, int, Dict[str, Any]]] = []

    def _is_logo_bbox(img: Dict[str, Any], *, zone: str) -> bool:
        w = img["width"]
        h = img["height"]
        if w < 18.0 or h < 14.0:
            return False
        if w > page_w * 0.58 or h > page_h * 0.28:
            return False
        ratio = w / max(1.0, h)
        if not (0.2 <= ratio <= 8.5):
            return False
        if zone == "header":
            return img["top"] <= page_h * 0.22
        return img["top"] <= page_h * 0.55 or img["bottom"] >= page_h * 0.72

    # 1. Buscar logo de encabezado (priorizando páginas interiores, luego página 1)
    header_candidate: Optional[Tuple[int, Dict[str, Any]]] = None
    for pd in pages_data[1:] + pages_data[:1]:
        imgs = [im for im in pd["images"] if _is_logo_bbox(im, zone="header")]
        if imgs:
            header_candidate = (pd["page_num"], min(imgs, key=lambda im: (im["top"], im["x0"])))
            break

    if header_candidate is not None:
        candidates.append(("header_logo", header_candidate[0], header_candidate[1]))

    # 2. Si hay portada, buscar logo en página 1
    if cover_enabled:
        p1_imgs = [im for im in pages_data[0]["images"] if _is_logo_bbox(im, zone="cover")]
        if p1_imgs:
            chosen = min(p1_imgs, key=lambda im: (im["top"], im["x0"]))
            # Si ya es la misma imagen en p1 que header_logo, reutilizar el archivo
            if header_candidate and header_candidate[0] == 1 and abs(chosen["x0"] - header_candidate[1]["x0"]) < 4.0 and abs(chosen["top"] - header_candidate[1]["top"]) < 4.0:
                updates["reuse_header_for_cover"] = True
            else:
                candidates.append(("cover_logo", 1, chosen))

    if not candidates:
        return extracted, updates

    assets_dir.mkdir(parents=True, exist_ok=True)
    rel_prefix = assets_dir.name if re.fullmatch(r"[A-Za-z0-9._-]+", assets_dir.name) else "assets"

    # Intentar extracción de alta fidelidad (pypdf para preservar alfa si coincide, o recorte en RAM con pypdfium2)
    pages_needed = sorted({pnum for _, pnum, _ in candidates})
    hi_renders = _render_pages_in_ram(pdf_path, pages_needed, scale=2.5)
    pypdf_reader: Optional[PdfReader] = None
    try:
        pypdf_reader = PdfReader(str(pdf_path))
        if pypdf_reader.is_encrypted:
            pypdf_reader.decrypt("")
    except Exception:
        pypdf_reader = None

    for role, pnum, bbox in candidates:
        filename = "logo.png" if role == "header_logo" else "cover-logo.png"
        pil_crop: Optional[Image.Image] = None

        # Intento 1: extraer imagen incrustada directamente desde pypdf si hay coincidencia clara de aspecto
        if pypdf_reader is not None and 1 <= pnum <= len(pypdf_reader.pages):
            try:
                target_ratio = bbox["width"] / max(1.0, bbox["height"])
                page_imgs = list(pypdf_reader.pages[pnum - 1].images)
                for pimg in page_imgs:
                    im_obj = getattr(pimg, "image", None)
                    if im_obj is None:
                        continue
                    iw, ih = im_obj.size
                    if iw < 16 or ih < 16 or iw > 3000 or ih > 3000:
                        continue
                    iratio = iw / max(1.0, float(ih))
                    if abs(iratio - target_ratio) / max(0.1, target_ratio) <= 0.15:
                        if im_obj.mode in ("RGB", "RGBA"):
                            pil_crop = im_obj.copy()
                            break
            except Exception:
                pil_crop = None

        # Intento 2: recorte exacto del bbox del logo desde render en RAM (maneja SMask/CMYK/vectores)
        if pil_crop is None and pnum in hi_renders:
            full_img = hi_renders[pnum]
            sx = full_img.width / max(1.0, page_w)
            sy = full_img.height / max(1.0, page_h)
            left = max(0, int(math.floor(bbox["x0"] * sx)))
            top = max(0, int(math.floor(bbox["top"] * sy)))
            right = min(full_img.width, int(math.ceil(bbox["x1"] * sx)))
            bottom = min(full_img.height, int(math.ceil(bbox["bottom"] * sy)))
            if right - left >= 12 and bottom - top >= 12:
                pil_crop = full_img.crop((left, top, right, bottom))

        if pil_crop is None:
            continue

        # Acotar dimensiones para mantener activos ligeros
        if max(pil_crop.width, pil_crop.height) > _MAX_ASSET_DIM_PX:
            scale_down = _MAX_ASSET_DIM_PX / float(max(pil_crop.width, pil_crop.height))
            new_size = (
                max(1, int(round(pil_crop.width * scale_down))),
                max(1, int(round(pil_crop.height * scale_down))),
            )
            resampling = Image.Resampling.LANCZOS if hasattr(Image, "Resampling") else Image.LANCZOS
            pil_crop = pil_crop.resize(new_size, resampling)

        buf = io.BytesIO()
        pil_crop.save(buf, format="PNG", optimize=True)
        png_bytes = buf.getvalue()
        if len(png_bytes) > _MAX_ASSET_BYTES:
            # Reducir un poco más si supera el límite seguro
            resampling = Image.Resampling.LANCZOS if hasattr(Image, "Resampling") else Image.LANCZOS
            pil_crop = pil_crop.resize(
                (max(1, pil_crop.width // 2), max(1, pil_crop.height // 2)),
                resampling,
            )
            buf = io.BytesIO()
            pil_crop.save(buf, format="PNG", optimize=True)
            png_bytes = buf.getvalue()
            if len(png_bytes) > _MAX_ASSET_BYTES:
                continue

        dest = assets_dir / filename
        tmp = assets_dir / f".{filename}.tmp.{os.getpid()}.{time.time_ns()}"
        try:
            tmp.write_bytes(png_bytes)
            os.replace(str(tmp), str(dest))
        finally:
            if tmp.exists():
                try:
                    tmp.unlink()
                except Exception:
                    pass

        rel_path = f"{rel_prefix}/{filename}"
        extracted.append(
            {
                "role": role,
                "relative_path": rel_path,
                "path": str(dest),
                "width_px": pil_crop.width,
                "height_px": pil_crop.height,
            }
        )

        cx = (bbox["x0"] + bbox["x1"]) / 2.0
        pos = "left" if cx < page_w * 0.36 else ("right" if cx > page_w * 0.64 else "center")
        if role == "header_logo":
            updates["header_logo_asset"] = rel_path
            updates["header_logo_position"] = pos
            updates["header_logo_height_pt"] = round(max(14.0, min(56.0, bbox["height"])), 1)
            if updates.get("reuse_header_for_cover"):
                updates["cover_logo_asset"] = rel_path
        elif role == "cover_logo":
            updates["cover_logo_asset"] = rel_path

    return extracted, updates


def _build_human_summary(spec: Dict[str, Any], *, page_count: int, is_scanned: bool) -> str:
    page = spec["page"]
    pal = spec["palette"]
    typo = spec["typography"]
    hdr = spec["header"]
    ftr = spec["footer"]
    cov = spec["cover"]
    tbl = spec["tables"]

    size_label = {"letter": "Carta", "a4": "A4", "custom": "Personalizado"}.get(page["size_name"], "Carta")
    orient_label = "horizontal" if page["orientation"] == "landscape" else "vertical"
    fam_map = {"sans": "sans-serif", "serif": "serif", "mono": "monoespaciada"}
    body_fam = fam_map.get(typo["body_family"], typo["body_family"])
    hint = f" ({typo['font_hint']})" if typo.get("font_hint") else ""
    align_map = {"left": "izquierda", "justify": "justificado", "center": "centrado", "right": "derecha"}
    align_lbl = align_map.get(typo["body_align"], "izquierda")
    cols_lbl = "2 columnas" if page["columns"] == 2 else "1 columna"

    parts = [
        f"Página {size_label} {orient_label} ({page['width_pt']:.0f}×{page['height_pt']:.0f} pt, {page_count} pág., {cols_lbl})",
        f"tipografía {body_fam}{hint} cuerpo {typo['body_size']} pt ({align_lbl})",
        f"paleta fondo {pal['page_bg']} / texto {pal['text']} / acento {pal['accent']}",
    ]
    if cov["enabled"]:
        parts.append(f"portada activa ({cov['layout']})")
    if hdr["enabled"] or ftr["enabled"]:
        hf_bits = []
        if hdr["enabled"]:
            hf_bits.append("encabezado")
        if ftr["enabled"]:
            hf_bits.append("pie de página")
        parts.append(" y ".join(hf_bits) + " activos")
    else:
        parts.append("sin encabezado ni pie de página")
    parts.append(f"tablas estilo {tbl['style']}")
    if is_scanned:
        parts.append("detección apoyada en análisis visual (bajo texto seleccionable)")
    return "; ".join(parts) + "."


# ---------------------------------------------------------------------------
# API principal: inspect_pdf_design
# ---------------------------------------------------------------------------


def inspect_pdf_design(
    pdf_path: Path,
    *,
    sample_pages: int = 4,
    extract_assets: bool = False,
    assets_dir: Optional[Path] = None,
    include_preview_images: bool = True,
    max_preview_pages: int = 2,
) -> Dict[str, Any]:
    """
    Inspecciona el diseño visual y estructural real de un archivo PDF.
    """
    pdf_path = Path(pdf_path)
    if not pdf_path.is_file():
        return {"ok": False, "error": f"No existe el archivo PDF: {pdf_path.name}"}

    warnings: List[str] = []
    try:
        pypdf_reader = PdfReader(str(pdf_path))
        if pypdf_reader.is_encrypted:
            res = pypdf_reader.decrypt("")
            if res == 0:
                return {
                    "ok": False,
                    "error": "El archivo PDF está protegido con contraseña y no se puede inspeccionar.",
                }
        page_count = len(pypdf_reader.pages)
    except Exception as exc:
        return {"ok": False, "error": f"No se pudo abrir el PDF ({exc})."}

    if page_count <= 0:
        return {"ok": False, "error": "El archivo PDF no contiene páginas."}

    safe_sample = max(1, min(12, int(sample_pages or 4)))
    if page_count <= safe_sample:
        sampled_nums = list(range(1, page_count + 1))
    else:
        # Incluir siempre p.1, p.2, p.3 (portada + confirmación de running headers/footers) y páginas interiores
        base_nums = [1, 2, 3][:safe_sample]
        remaining = safe_sample - len(base_nums)
        if remaining > 0:
            step = max(1, (page_count - 3) // (remaining + 1))
            extra = [min(page_count, 3 + step * (i + 1)) for i in range(remaining)]
            sampled_nums = sorted(set(base_nums + extra))
        else:
            sampled_nums = base_nums

    pages_data: List[Dict[str, Any]] = []
    total_non_space_chars = 0

    try:
        with pdfplumber.open(str(pdf_path)) as doc:
            for p_num in sampled_nums:
                if p_num < 1 or p_num > len(doc.pages):
                    continue
                p_obj = doc.pages[p_num - 1]
                pw = float(p_obj.width)
                ph = float(p_obj.height)
                chars = list(getattr(p_obj, "chars", None) or [])
                total_non_space_chars += sum(1 for c in chars if str(c.get("text") or "").strip())
                lines = _group_chars_into_lines(chars)
                for ln in lines:
                    ln["page_num"] = p_num
                rules = _extract_horizontal_rules(p_obj, pw)
                rects = _extract_filled_rects(p_obj)

                # Líneas verticales (para tablas y barras laterales de encabezado)
                vlines: List[Dict[str, Any]] = []
                for ln in getattr(p_obj, "lines", None) or []:
                    try:
                        x0, x1 = float(ln["x0"]), float(ln["x1"])
                        top, bot = float(ln["top"]), float(ln["bottom"])
                        if abs(x1 - x0) <= 3.5 and (bot - top) >= 8.0:
                            vlines.append(
                                {
                                    "x": (x0 + x1) / 2.0,
                                    "top": top,
                                    "bottom": bot,
                                    "height": bot - top,
                                    "color": _pdf_color_to_hex(ln.get("stroking_color"))
                                    or _pdf_color_to_hex(ln.get("non_stroking_color")),
                                }
                            )
                    except Exception:
                        continue

                # Imágenes embebidas
                images_meta: List[Dict[str, Any]] = []
                for im in getattr(p_obj, "images", None) or []:
                    try:
                        x0, x1 = float(im["x0"]), float(im["x1"])
                        top, bot = float(im["top"]), float(im["bottom"])
                        if (x1 - x0) >= 8.0 and (bot - top) >= 8.0:
                            images_meta.append(
                                {
                                    "x0": x0,
                                    "x1": x1,
                                    "top": top,
                                    "bottom": bot,
                                    "width": x1 - x0,
                                    "height": bot - top,
                                }
                            )
                    except Exception:
                        continue

                # Tablas detectadas
                tables_meta: List[Dict[str, Any]] = []
                try:
                    found_tables = p_obj.find_tables() or []
                    for tbl in found_tables[:6]:
                        bbox = tuple(float(v) for v in tbl.bbox)
                        rows_bbox = [tuple(float(v) for v in r.bbox) for r in (tbl.rows or []) if getattr(r, "bbox", None)]
                        sample_cells = [tuple(float(v) for v in c) for c in (tbl.cells or [])[:12] if c]
                        tables_meta.append(
                            {
                                "bbox": bbox,
                                "rows_bbox": rows_bbox,
                                "sample_cells": sample_cells,
                            }
                        )
                except Exception:
                    tables_meta = []

                pages_data.append(
                    {
                        "page_num": p_num,
                        "width": pw,
                        "height": ph,
                        "chars": chars,
                        "lines": lines,
                        "rules": rules,
                        "vlines": vlines,
                        "rects": rects,
                        "images": images_meta,
                        "tables": tables_meta,
                    }
                )
    except Exception as exc:
        return {"ok": False, "error": f"Error al analizar la estructura del PDF ({exc})."}

    if not pages_data:
        return {"ok": False, "error": "No se pudieron leer páginas del PDF."}

    is_scanned_or_low_text = total_non_space_chars < max(35, 25 * len(pages_data))
    if is_scanned_or_low_text:
        warnings.append(
            "El PDF tiene muy poco texto seleccionable o parece escaneado; se utilizó análisis visual de píxeles en RAM como respaldo."
        )

    # Renderizado en RAM (usado para vistas previas y verificación de fondo/colores en temas oscuros/escaneados)
    safe_max_preview = max(0, min(4, int(max_preview_pages if include_preview_images else 0)))
    preview_page_nums = [p for p in range(1, min(page_count, safe_max_preview) + 1)] if include_preview_images else []
    pixel_check_pages = sorted(
        set(preview_page_nums + ([1] if is_scanned_or_low_text else []) + ([min(2, page_count)]))
    )
    rendered_ram = _render_pages_in_ram(pdf_path, pixel_check_pages, scale=1.35)

    preview_images: List[Dict[str, Any]] = []
    if include_preview_images and safe_max_preview > 0:
        for p_num in preview_page_nums:
            pil_img = rendered_ram.get(p_num)
            if pil_img is not None:
                data_url, out_w, out_h = _pil_to_jpeg_data_url(pil_img, max_width_px=900, quality=78)
                preview_images.append(
                    {
                        "page": p_num,
                        "width": out_w,
                        "height": out_h,
                        "data_url": data_url,
                    }
                )

    # --- 1. Geometría de página ---
    interior_or_all = pages_data[1:] if len(pages_data) >= 2 else pages_data
    page_w = round(statistics.median(pd["width"] for pd in interior_or_all), 2)
    page_h = round(statistics.median(pd["height"] for pd in interior_or_all), 2)
    size_name = _detect_page_size_name(page_w, page_h)
    orientation = "landscape" if page_w > page_h else "portrait"

    # --- 2. Fondo real de página (vector + pixel fallback) ---
    bg_candidates: Counter = Counter()
    for pd in interior_or_all:
        for rc in pd["rects"]:
            if (
                rc["fill"]
                and rc["width"] >= pd["width"] * 0.85
                and rc["height"] >= pd["height"] * 0.85
            ):
                bg_candidates[rc["fill"]] += 1

    pixel_ref_page = 2 if 2 in rendered_ram else (1 if 1 in rendered_ram else None)
    pixel_info = _sample_pixel_palette(rendered_ram[pixel_ref_page]) if pixel_ref_page else {}

    if bg_candidates:
        page_bg = bg_candidates.most_common(1)[0][0]
    elif pixel_info.get("page_bg") and _color_distance(pixel_info["page_bg"], "#FFFFFF") > 16:
        page_bg = pixel_info["page_bg"]
    else:
        page_bg = "#FFFFFF"

    is_dark_page = _luminance(page_bg) < 0.22

    # --- 3. Borde de página ---
    border_enabled = False
    border_color = "#CBD5E1" if not is_dark_page else "#334155"
    border_width = 0.75
    border_inset = 18.0
    for pd in interior_or_all:
        for rc in pd["rects"]:
            if (
                rc["stroke"]
                and (not rc["fill"] or _color_distance(rc["fill"], page_bg) <= 12)
                and _color_distance(rc["stroke"], page_bg) > 15
                and rc["width"] >= pd["width"] * 0.78
                and rc["height"] >= pd["height"] * 0.78
            ):
                insets = [
                    rc["x0"],
                    pd["width"] - rc["x1"],
                    rc["top"],
                    pd["height"] - rc["bottom"],
                ]
                if all(3.0 <= ins <= 56.0 for ins in insets):
                    border_enabled = True
                    border_color = rc["stroke"]
                    border_width = round(max(0.25, min(6.0, rc["linewidth"])), 2)
                    border_inset = round(statistics.mean(insets), 1)
                    break
        if border_enabled:
            break

    # --- 4. Encabezados y pies de página ---
    header_spec, footer_spec, body_bounds = _detect_header_footer(
        pages_data,
        page_w,
        page_h,
        page_bg,
    )

    # --- 5. Recopilar líneas del cuerpo y tamaño base ---
    all_lines = [ln for pd in pages_data for ln in pd["lines"]]
    body_lines_all: List[Dict[str, Any]] = []
    body_lines_by_page: Dict[int, List[Dict[str, Any]]] = {}
    for pd in pages_data:
        pnum = pd["page_num"]
        y_min, y_max = body_bounds.get(pnum, (0.0, page_h))
        p_body = [ln for ln in pd["lines"] if ln["top"] >= y_min - 1.0 and ln["bottom"] <= y_max + 1.0]
        body_lines_by_page[pnum] = p_body
        body_lines_all.extend(p_body)

    # Tamaño modal del cuerpo (ponderado por número de caracteres)
    body_size_counts: Counter = Counter()
    all_size_counts: Counter = Counter()
    size_source_pages = [pd["page_num"] for pd in interior_or_all]
    for pnum in size_source_pages:
        for ln in body_lines_by_page.get(pnum, []):
            sz = round(ln["size"] * 2.0) / 2.0
            all_size_counts[sz] += ln["char_count"]
            if 7.0 <= sz <= 14.5:
                body_size_counts[sz] += ln["char_count"]

    if body_size_counts:
        body_size = float(body_size_counts.most_common(1)[0][0])
    elif all_size_counts:
        body_size = float(all_size_counts.most_common(1)[0][0])
    else:
        body_size = 10.0

    # --- 6. Portada ---
    body_family_counts: Counter = Counter()
    body_font_hints: Counter = Counter()
    for pnum in size_source_pages:
        for ln in body_lines_by_page.get(pnum, []):
            if abs(ln["size"] - body_size) <= 1.2:
                body_family_counts[ln["family"]] += ln["char_count"]
                hint = _base_font_hint(ln["fontname"])
                if hint:
                    body_font_hints[hint] += ln["char_count"]

    body_family = body_family_counts.most_common(1)[0][0] if body_family_counts else "sans"
    cover_spec = _detect_cover(
        pages_data,
        body_size=body_size,
        body_family=body_family,
        page_w=page_w,
        page_h=page_h,
        page_bg=page_bg,
        header_spec=header_spec,
        footer_spec=footer_spec,
    )

    # Páginas de contenido real (excluir portada si existe)
    content_pages = [pd for pd in pages_data if not (cover_spec["enabled"] and pd["page_num"] == 1)]
    if not content_pages:
        content_pages = pages_data
    content_page_nums = {pd["page_num"] for pd in content_pages}

    # --- 7. Márgenes reales de contenido ---
    content_table_boxes = [
        (pd["page_num"], tbl["bbox"])
        for pd in content_pages
        for tbl in pd["tables"]
    ]

    # Límites horizontales estructurales (reglas, tablas y bandas de contenido que reflejan el ancho útil real)
    struct_x0s: List[float] = []
    struct_x1s: List[float] = []
    for pd in content_pages:
        for rule in pd["rules"]:
            rw = rule["width"]
            if 0.45 * page_w <= rw < 0.94 * page_w and rule["x0"] >= 14.0 and (page_w - rule["x1"]) >= 14.0:
                struct_x0s.append(rule["x0"])
                struct_x1s.append(rule["x1"])
        for tbl in pd["tables"]:
            tx0, _, tx1, _ = tbl["bbox"]
            tw = tx1 - tx0
            if 0.45 * page_w <= tw < 0.94 * page_w and tx0 >= 14.0 and (page_w - tx1) >= 14.0:
                struct_x0s.append(tx0)
                struct_x1s.append(tx1)
        for rc in pd["rects"]:
            if not rc["fill"] or _color_distance(rc["fill"], page_bg) <= 12:
                continue
            rw = rc["width"]
            rh = rc["height"]
            if (
                0.45 * page_w <= rw < 0.94 * page_w
                and rh <= page_h * 0.45
                and rc["x0"] >= 14.0
                and (page_w - rc["x1"]) >= 14.0
            ):
                struct_x0s.append(rc["x0"])
                struct_x1s.append(rc["x1"])

    content_body_lines = [
        ln
        for pnum in content_page_nums
        for ln in body_lines_by_page.get(pnum, [])
        if ln["char_count"] >= 2
    ]
    if content_body_lines:
        x0s = sorted(ln["x0"] for ln in content_body_lines)
        x1s = sorted(ln["x1"] for ln in content_body_lines)
        line_left = x0s[int(len(x0s) * 0.05)]
        if struct_x0s:
            struct_left = min(struct_x0s)
            if abs(struct_left - line_left) <= 24.0:
                line_left = min(line_left, struct_left)
        left_margin = round(max(18.0, min(144.0, line_left)), 1)

        text_right_x1 = x1s[min(len(x1s) - 1, int((len(x1s) - 1) * 0.98))]
        if struct_x1s:
            effective_right_x1 = max(text_right_x1, max(struct_x1s))
            right_margin = round(max(18.0, min(144.0, page_w - effective_right_x1)), 1)
        else:
            right_margin = round(max(18.0, min(144.0, page_w - text_right_x1)), 1)
            # Sin borde estructural derecho, párrafos alineados a la izquierda (ragged-left)
            # o listas cortas terminan antes del margen real: igualar simétricamente al izquierdo.
            if right_margin > left_margin + 24.0:
                right_margin = left_margin

        per_page_tops: List[float] = []
        per_page_bots: List[float] = []
        for pnum in content_page_nums:
            p_lines = body_lines_by_page.get(pnum) or []
            p_tbls = [bbox for tpnum, bbox in content_table_boxes if tpnum == pnum]
            top_vals = [ln["top"] for ln in p_lines] + [b[1] for b in p_tbls]
            bot_vals = [ln["bottom"] for ln in p_lines] + [b[3] for b in p_tbls]
            if top_vals:
                per_page_tops.append(min(top_vals))
            if bot_vals:
                per_page_bots.append(page_h - max(bot_vals))

        raw_top = min(per_page_tops) if per_page_tops else 58.0
        top_margin = round(max(20.0, min(144.0, raw_top)), 1)

        raw_bottom = min(per_page_bots) if per_page_bots else None
        if raw_bottom is None or raw_bottom > 108.0:
            # Todas las páginas muestreadas están parcialmente vacías: inferir margen inferior realista
            if footer_spec["enabled"]:
                bottom_margin = round(max(36.0, min(96.0, float(footer_spec["height_pt"]) + 16.0)), 1)
            else:
                bottom_margin = round(max(24.0, min(top_margin, 72.0)), 1)
        else:
            bottom_margin = round(max(20.0, min(108.0, raw_bottom)), 1)
    elif pixel_info.get("margins_ratio"):
        mr = pixel_info["margins_ratio"]
        left_margin = round(max(20.0, min(120.0, mr["left"] * page_w)), 1)
        right_margin = round(max(20.0, min(120.0, mr["right"] * page_w)), 1)
        top_margin = round(max(24.0, min(120.0, mr["top"] * page_h)), 1)
        bottom_margin = round(max(24.0, min(120.0, mr["bottom"] * page_h)), 1)
    else:
        left_margin, right_margin, top_margin, bottom_margin = 56.0, 56.0, 58.0, 52.0

    # --- 8. Columnas (excluyendo áreas de tabla) ---

    def _in_table(pnum: int, ln: Dict[str, Any]) -> bool:
        for tpnum, (tx0, ttop, tx1, tbot) in content_table_boxes:
            if tpnum == pnum and ln["x0"] >= tx0 - 4.0 and ln["x1"] <= tx1 + 4.0 and ln["top"] >= ttop - 4.0 and ln["bottom"] <= tbot + 4.0:
                return True
        return False

    non_table_body_by_page = {
        pnum: [ln for ln in body_lines_by_page.get(pnum, []) if not _in_table(pnum, ln)]
        for pnum in content_page_nums
    }
    columns, column_gap_pt = _detect_columns(
        non_table_body_by_page,
        page_w,
        left_margin,
        right_margin,
    )

    # --- 9. Tipo de documento y tablas ---
    has_any_tables = any(pd["tables"] for pd in pages_data)
    document_type = _classify_document_type(
        all_lines,
        has_tables=has_any_tables,
        body_family=body_family,
        columns=columns,
        page_count=page_count,
    )
    tables_spec, _ = _detect_table_styling(pages_data, page_bg, document_type)

    # --- 10. Interlineado, espaciado y alineación del cuerpo ---
    line_deltas: List[float] = []
    para_gaps: List[float] = []
    content_w = max(80.0, page_w - left_margin - right_margin)
    col_w = (content_w - column_gap_pt) / 2.0 if columns == 2 else content_w

    body_align_lines: List[Dict[str, Any]] = []
    for pnum, lines in non_table_body_by_page.items():
        # Ordenar por columna si hay 2 columnas
        mid_x = left_margin + content_w / 2.0
        col_buckets: List[List[Dict[str, Any]]] = [lines]
        if columns == 2:
            col_buckets = [
                [ln for ln in lines if (ln["x0"] + ln["x1"]) / 2.0 < mid_x],
                [ln for ln in lines if (ln["x0"] + ln["x1"]) / 2.0 >= mid_x],
            ]

        for bucket in col_buckets:
            bucket_sorted = sorted(bucket, key=lambda item: item["top"])
            for idx, ln in enumerate(bucket_sorted):
                if abs(ln["size"] - body_size) <= 1.2 and not ln["is_bold"]:
                    body_align_lines.append(ln)
                if idx + 1 < len(bucket_sorted):
                    nxt = bucket_sorted[idx + 1]
                    if (
                        abs(ln["size"] - body_size) <= 1.2
                        and abs(nxt["size"] - body_size) <= 1.2
                    ):
                        dy = nxt["top"] - ln["top"]
                        if body_size * 0.98 <= dy <= body_size * 2.05:
                            line_deltas.append(dy)
                        elif body_size * 2.05 < dy <= body_size * 4.2:
                            para_gaps.append(dy)

    body_leading = round(statistics.median(line_deltas), 1) if line_deltas else round(body_size * 1.45, 1)
    body_leading = max(round(body_size * 1.08, 1), min(36.0, body_leading))

    if para_gaps:
        raw_space_after = statistics.median(para_gaps) - body_leading
        space_after = round(max(2.0, min(24.0, raw_space_after)), 1)
    else:
        space_after = 7.0

    # Detectar alineación del cuerpo
    body_align = "left"
    wrapped_lines = [ln for ln in body_align_lines if ln["width"] >= col_w * 0.62 and len(ln["text"].split()) >= 5]
    if wrapped_lines:
        justify_hits = 0
        right_hits = 0
        center_hits = 0
        for ln in wrapped_lines:
            frame_l = left_margin
            frame_r = left_margin + col_w
            if columns == 2 and (ln["x0"] + ln["x1"]) / 2.0 >= left_margin + content_w / 2.0:
                frame_l = left_margin + col_w + column_gap_pt
                frame_r = page_w - right_margin
            near_left = abs(ln["x0"] - frame_l) <= 6.5
            near_right = abs(ln["x1"] - frame_r) <= 6.5
            if near_left and near_right:
                justify_hits += 1
            elif near_right and not near_left:
                right_hits += 1
            elif abs(((ln["x0"] + ln["x1"]) / 2.0) - ((frame_l + frame_r) / 2.0)) <= 8.0 and not near_left:
                center_hits += 1

        if justify_hits / len(wrapped_lines) >= 0.55 and len(wrapped_lines) >= 3:
            body_align = "justify"
        elif center_hits / len(wrapped_lines) >= 0.65:
            body_align = "center"
        elif right_hits / len(wrapped_lines) >= 0.65:
            body_align = "right"
    elif body_align_lines:
        # Revisar centrado en bloques cortos
        center_hits = sum(
            1
            for ln in body_align_lines
            if abs(((ln["x0"] + ln["x1"]) / 2.0) - (page_w / 2.0)) <= 10.0
            and abs(ln["x0"] - left_margin) > 16.0
        )
        if len(body_align_lines) >= 3 and center_hits / len(body_align_lines) >= 0.7:
            body_align = "center"

    # --- 11. Encabezados (h1, h2, h3) y secciones genéricas ---
    pages_by_num = {pd["page_num"]: pd for pd in pages_data}
    heading_candidates: List[Dict[str, Any]] = []
    for pnum, lines in non_table_body_by_page.items():
        for ln in lines:
            text = ln["text"]
            words = text.split()
            if len(text) < 3 or len(text) > 110 or len(words) > 16:
                continue
            is_larger = ln["size"] >= body_size + 1.1
            is_bold_heading = (
                ln["is_bold"]
                and ln["size"] >= body_size - 0.3
                and len(words) <= 10
                and not text.endswith(".")
            )
            is_caps_heading = (
                ln["upper_ratio"] >= 0.85
                and ln["size"] >= body_size - 0.2
                and 3 <= len(text) <= 65
                and len(words) <= 8
            )
            if is_larger or is_bold_heading or is_caps_heading:
                heading_candidates.append(ln)

    # Agrupar encabezados por niveles de tamaño (redondeado a 0.5 pt)
    tier_buckets: Dict[float, List[Dict[str, Any]]] = {}
    for h in heading_candidates:
        key_sz = round(h["size"] * 2.0) / 2.0
        # Agrupar tamaños muy cercanos (<= 0.8 pt)
        matched_key = None
        for existing_sz in tier_buckets:
            if abs(existing_sz - key_sz) <= 0.8:
                matched_key = existing_sz
                break
        if matched_key is None:
            tier_buckets[key_sz] = [h]
        else:
            tier_buckets[matched_key].append(h)

    sorted_tiers = sorted(tier_buckets.items(), key=lambda kv: kv[0], reverse=True)
    # Separar un título gigante de portada/documento de los h1 reales si hay >= 3 niveles grandes
    if len(sorted_tiers) >= 4 and sorted_tiers[0][0] >= body_size * 2.2 and len(sorted_tiers[0][1]) == 1:
        sorted_tiers = sorted_tiers[1:]

    h1_lines = sorted_tiers[0][1] if len(sorted_tiers) >= 1 else []
    h2_lines = sorted_tiers[1][1] if len(sorted_tiers) >= 2 else []
    h3_lines = sorted_tiers[2][1] if len(sorted_tiers) >= 3 else []

    heading_family_counts: Counter = Counter()
    heading_font_hints: Counter = Counter()
    for h in h1_lines + h2_lines + h3_lines:
        heading_family_counts[h["family"]] += h["char_count"]
        hint = _base_font_hint(h["fontname"])
        if hint:
            heading_font_hints[hint] += h["char_count"]

    heading_family = heading_family_counts.most_common(1)[0][0] if heading_family_counts else body_family
    body_hint = body_font_hints.most_common(1)[0][0] if body_font_hints else ""
    head_hint = heading_font_hints.most_common(1)[0][0] if heading_font_hints else ""
    if head_hint and body_hint and head_hint.lower() != body_hint.lower():
        font_hint = f"{head_hint} / {body_hint}"
    else:
        font_hint = body_hint or head_hint

    # --- 12. Paleta real de colores ---
    body_text_colors: Counter = Counter()
    heading_text_colors: Counter = Counter()
    muted_text_colors: Counter = Counter()
    chromatic_scores: Dict[str, float] = {}
    neutral_border_colors: Counter = Counter()
    surface_colors: Counter = Counter()

    for pnum in content_page_nums:
        for ln in body_lines_by_page.get(pnum, []):
            col = ln.get("color")
            if not col or _color_distance(col, page_bg) <= 14:
                continue
            if abs(ln["size"] - body_size) <= 1.2 and not ln["is_bold"]:
                body_text_colors[col] += ln["char_count"]
            elif ln["size"] <= body_size - 1.0:
                muted_text_colors[col] += ln["char_count"]

    for pd in pages_data:
        for ln in pd["lines"]:
            col = ln.get("color")
            if col and _color_distance(col, page_bg) > 14 and ln["size"] <= body_size - 1.0:
                muted_text_colors[col] += ln["char_count"]

    for h in h1_lines + h2_lines + h3_lines:
        col = h.get("color")
        if col and _color_distance(col, page_bg) > 14:
            heading_text_colors[col] += h["char_count"]
            if _is_chromatic_accent(col):
                chroma_boost = 1.0 + _chroma(col) * 3.0
                chromatic_scores[col] = chromatic_scores.get(col, 0.0) + h["char_count"] * 3.0 * chroma_boost

    # Inspeccionar rectángulos y líneas para acento, borde y superficies
    for pd in pages_data:
        for rc in pd["rects"]:
            fill = rc.get("fill")
            if fill and _color_distance(fill, page_bg) > 10:
                # Ignorar fondo completo de página
                if rc["width"] >= pd["width"] * 0.85 and rc["height"] >= pd["height"] * 0.85:
                    continue
                sat = _saturation(fill)
                chroma = _chroma(fill)
                dist = _color_distance(fill, page_bg)
                if _is_chromatic_accent(fill) and dist > 22:
                    weight = min(180.0, math.sqrt(max(1.0, rc["width"] * rc["height"])))
                    chromatic_scores[fill] = chromatic_scores.get(fill, 0.0) + weight * (chroma ** 1.2) * (1.0 + sat)
                elif 8 <= dist <= 56 and chroma < 0.16:
                    surface_colors[fill] += 1
            stroke = rc.get("stroke")
            if stroke and _color_distance(stroke, page_bg) > 12:
                if _is_chromatic_accent(stroke):
                    chromatic_scores[stroke] = chromatic_scores.get(stroke, 0.0) + 30.0 * _chroma(stroke)
                else:
                    neutral_border_colors[stroke] += 1

        for rule in pd["rules"]:
            col = rule.get("color")
            if col and _color_distance(col, page_bg) > 12:
                if _is_chromatic_accent(col):
                    chromatic_scores[col] = chromatic_scores.get(col, 0.0) + 45.0 * _chroma(col)
                else:
                    neutral_border_colors[col] += 1

    # Elegir texto principal
    if body_text_colors:
        text_color = body_text_colors.most_common(1)[0][0]
    elif pixel_info.get("text"):
        text_color = pixel_info["text"]
    else:
        text_color = "#E2E8F0" if is_dark_page else "#1E293B"

    # Elegir color de encabezados
    if heading_text_colors:
        heading_color = heading_text_colors.most_common(1)[0][0]
    else:
        heading_color = "#F8FAFC" if is_dark_page else _darken_hex(text_color, 0.2)

    # Elegir color de acento (si es monocromático, conservar tono neutro real sin inventar azul)
    if chromatic_scores:
        accent_color = max(chromatic_scores.items(), key=lambda kv: kv[1])[0]
    elif pixel_info.get("accent") and _saturation(pixel_info["accent"]) >= 0.28:
        accent_color = pixel_info["accent"]
    else:
        # Documento monocromático / sobrio: usar el color real de encabezados/texto oscuro
        accent_color = heading_color

    # Derivar colores secundarios armónicos cuando no aparecen explícitamente
    if muted_text_colors:
        # Preferir un color distinto a text_color con menor contraste
        muted_pick = next(
            (c for c, _ in muted_text_colors.most_common(5) if _color_distance(c, text_color) > 20),
            None,
        )
        muted_color = muted_pick or _mix_hex(text_color, page_bg, 0.42)
    else:
        muted_color = _mix_hex(text_color, page_bg, 0.42)

    accent_dark = _darken_hex(accent_color, 0.28) if not is_dark_page else _darken_hex(accent_color, 0.18)
    accent_soft = _mix_hex(page_bg, accent_color, 0.10 if not is_dark_page else 0.20)
    border_pal = (
        neutral_border_colors.most_common(1)[0][0]
        if neutral_border_colors
        else (_mix_hex(page_bg, text_color, 0.22))
    )
    surface_pal = (
        surface_colors.most_common(1)[0][0]
        if surface_colors
        else (_mix_hex(page_bg, text_color, 0.04) if not is_dark_page else _mix_hex(page_bg, "#FFFFFF", 0.06))
    )

    # Tabla: sincronizar con paleta si se detectaron colores reales en tablas
    table_head_bg = tables_spec["header_bg"] or (
        accent_color if _saturation(accent_color) >= 0.25 else heading_color
    )
    if tables_spec["header_fg"]:
        table_head_fg = tables_spec["header_fg"]
    else:
        table_head_fg = "#FFFFFF" if _luminance(table_head_bg) < 0.45 else "#0F172A"
    table_alt = tables_spec["alt_row_bg"] or surface_pal

    # Construir métricas finales de h1, h2, h3
    def _build_tier(
        tier_lines: List[Dict[str, Any]],
        fallback_size: float,
        fallback_decoration: str,
    ) -> Dict[str, Any]:
        if not tier_lines:
            sz = round(fallback_size, 1)
            return {
                "size": sz,
                "leading": round(sz * 1.32, 1),
                "color": None,
                "uppercase": False,
                "decoration": fallback_decoration,
                "align": "left",
            }
        sz = round(statistics.median(h["size"] for h in tier_lines), 1)
        upper_votes = sum(1 for h in tier_lines if h["upper_ratio"] >= 0.72)
        is_upper = upper_votes >= max(1, math.ceil(len(tier_lines) * 0.6))
        colors_tier = Counter(h["color"] for h in tier_lines if h.get("color"))
        tier_color = colors_tier.most_common(1)[0][0] if colors_tier else None
        if tier_color and _color_distance(tier_color, heading_color) <= 12:
            tier_color = None

        # Alineación del encabezado
        centered = sum(
            1
            for h in tier_lines
            if abs(((h["x0"] + h["x1"]) / 2.0) - (page_w / 2.0)) <= 14.0
            and abs(h["x0"] - left_margin) > 16.0
        )
        right_aligned = sum(
            1
            for h in tier_lines
            if abs(h["x1"] - (page_w - right_margin)) <= 12.0
            and abs(h["x0"] - left_margin) > 24.0
        )
        if centered >= max(1, math.ceil(len(tier_lines) * 0.6)):
            h_align = "center"
        elif right_aligned >= max(1, math.ceil(len(tier_lines) * 0.6)):
            h_align = "right"
        else:
            h_align = "left"

        decoration = _detect_heading_decoration(tier_lines, pages_by_num, page_bg)
        return {
            "size": sz,
            "leading": round(sz * 1.32, 1),
            "color": tier_color,
            "uppercase": is_upper,
            "decoration": decoration,
            "align": h_align,
        }

    h1_spec = _build_tier(h1_lines, max(body_size * 1.55, 14.5), "plain")
    h2_spec = _build_tier(h2_lines, max(body_size * 1.25, 12.0), "plain")
    h3_spec = _build_tier(h3_lines, max(body_size * 1.08, 10.5), "plain")

    # --- 13. Blueprint de secciones genéricas (estrictamente sin PII) ---
    sections_blueprint: List[str] = []
    seen_sec: Set[str] = set()
    # Priorizar encabezados h1/h2 en orden de lectura y opcionalmente bookmarks del PDF
    ordered_headings = sorted(
        h1_lines + h2_lines,
        key=lambda item: (item["page_num"], item["top"], item["x0"]),
    )
    for h in ordered_headings:
        cleaned = _sanitize_section_title(h["text"])
        if cleaned:
            key = cleaned.lower()
            if key not in seen_sec:
                seen_sec.add(key)
                sections_blueprint.append(cleaned)
                if len(sections_blueprint) >= 16:
                    break

    # --- 14. Extracción opcional de activos/logos ---
    extracted_assets: List[Dict[str, Any]] = []
    if extract_assets and assets_dir is not None:
        extracted_assets, logo_updates = _extract_logo_assets(
            pdf_path,
            pages_data,
            Path(assets_dir),
            cover_enabled=cover_spec["enabled"],
            page_w=page_w,
            page_h=page_h,
        )
        if logo_updates.get("header_logo_asset"):
            header_spec["logo_asset"] = logo_updates["header_logo_asset"]
            header_spec["logo_position"] = logo_updates.get("header_logo_position", header_spec["logo_position"])
            header_spec["logo_height_pt"] = logo_updates.get("header_logo_height_pt", header_spec["logo_height_pt"])
            header_spec["enabled"] = True
        if logo_updates.get("cover_logo_asset"):
            cover_spec["logo_asset"] = logo_updates["cover_logo_asset"]

    raw_design_spec: Dict[str, Any] = {
        "version": DESIGN_SPEC_VERSION,
        "name": "",
        "slug": "",
        "source_pdf": pdf_path.name,
        "source_format": "pdf",
        "supported_outputs": ["pdf", "docx"],
        "document_type": document_type,
        "page": {
            "width_pt": page_w,
            "height_pt": page_h,
            "size_name": size_name,
            "orientation": orientation,
            "margins_pt": {
                "top": top_margin,
                "right": right_margin,
                "bottom": bottom_margin,
                "left": left_margin,
            },
            "background_hex": page_bg,
            "border": {
                "enabled": border_enabled,
                "color": border_color,
                "width_pt": border_width,
                "inset_pt": border_inset,
            },
            "stationery_asset": None,
            "columns": columns,
            "column_gap_pt": column_gap_pt,
        },
        "palette": {
            "page_bg": page_bg,
            "text": text_color,
            "heading": heading_color,
            "muted": muted_color,
            "accent": accent_color,
            "accent_dark": accent_dark,
            "accent_soft": accent_soft,
            "border": border_pal,
            "surface": surface_pal,
            "table_head_bg": table_head_bg,
            "table_head_fg": table_head_fg,
            "table_alt": table_alt,
        },
        "typography": {
            "body_family": body_family,
            "heading_family": heading_family,
            "font_hint": font_hint,
            "body_size": body_size,
            "body_leading": body_leading,
            "body_align": body_align,
            "space_after": space_after,
            "h1": h1_spec,
            "h2": h2_spec,
            "h3": h3_spec,
        },
        "header": header_spec,
        "footer": footer_spec,
        "cover": cover_spec,
        "tables": tables_spec,
        "sections_blueprint": sections_blueprint,
        "notes": "",
    }

    design_spec = normalize_design_spec(raw_design_spec)

    # Calcular nivel de confianza real
    if is_scanned_or_low_text:
        confidence = 0.52 if rendered_ram else 0.35
    else:
        confidence = 0.78
        if body_size_counts:
            confidence += 0.06
        if h1_lines:
            confidence += 0.05
        if len(pages_data) >= 2:
            confidence += 0.05
        if has_any_tables or chromatic_scores:
            confidence += 0.04
        confidence = round(min(0.98, confidence), 2)

    summary = _build_human_summary(
        design_spec,
        page_count=page_count,
        is_scanned=is_scanned_or_low_text,
    )

    return {
        "ok": True,
        "file_name": pdf_path.name,
        "source_format": "pdf",
        "page_count": page_count,
        "is_scanned_or_low_text": is_scanned_or_low_text,
        "confidence": confidence,
        "design_spec": design_spec,
        "summary": summary,
        "extracted_assets": extracted_assets,
        "preview_images": preview_images,
        "warnings": warnings,
    }


OFFICE_INSPECTABLE_EXTS: Set[str] = {
    ".docx",
    ".xlsx",
    ".pptx",
    ".csv",
    ".tsv",
    ".doc",
    ".rtf",
    ".odt",
    ".xls",
    ".ods",
}


def inspect_document_design(
    file_path: Path,
    *,
    sample_pages: int = 4,
    extract_assets: bool = False,
    assets_dir: Optional[Path] = None,
    include_preview_images: bool = True,
    max_preview_pages: int = 2,
) -> Dict[str, Any]:
    """
    Punto de entrada universal de inspección de diseño para documentos PDF y Office:
    - `.pdf` -> `inspect_pdf_design(...)` (asegurando `source_format="pdf"`, `supported_outputs=["pdf", "docx"]`)
    - `.docx`, `.xlsx`, `.pptx`, `.csv`, `.tsv`, `.doc`, `.rtf`, `.odt`, `.xls`, `.ods`
      -> `office_inspector.inspect_office_design(...)`
    """
    path = Path(file_path)
    if not path.is_file():
        return {"ok": False, "error": f"No existe el archivo: {path.name}"}

    ext = path.suffix.lower()
    if ext == ".pdf":
        result = inspect_pdf_design(
            path,
            sample_pages=sample_pages,
            extract_assets=extract_assets,
            assets_dir=assets_dir,
            include_preview_images=include_preview_images,
            max_preview_pages=max_preview_pages,
        )
        if result.get("ok"):
            result["source_format"] = "pdf"
            spec = result.get("design_spec")
            if isinstance(spec, dict):
                spec["source_format"] = "pdf"
                if not spec.get("supported_outputs") or spec.get("supported_outputs") == ["pdf"]:
                    spec["supported_outputs"] = ["pdf", "docx"]
                result["design_spec"] = normalize_design_spec(spec)
        return result

    if ext in OFFICE_INSPECTABLE_EXTS:
        from slices.pdf_engine.office_inspector import inspect_office_design

        return inspect_office_design(
            path,
            extract_assets=extract_assets,
            assets_dir=assets_dir,
        )

    return {
        "ok": False,
        "error": (
            f"Formato no soportado para inspección de diseño ({ext or 'sin extensión'}). "
            "Usa PDF, Word (.docx/.doc/.rtf/.odt), Excel (.xlsx/.xls/.ods), PowerPoint (.pptx) o CSV/TSV."
        ),
    }


# ---------------------------------------------------------------------------
# Resolución y persistencia segura de habilidades de diseño
# ---------------------------------------------------------------------------


def _is_path_within(candidate: Path, base_dir: Path) -> bool:
    try:
        resolved_candidate = candidate.resolve()
        resolved_base = base_dir.resolve()
        return resolved_candidate == resolved_base or resolved_candidate.is_relative_to(resolved_base)
    except Exception:
        return False


def _read_skill_design_spec_rel(skill_dir: Path) -> str:
    """Lee opcionalmente `design_spec:` del frontmatter de SKILL.md si existe."""
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.is_file():
        return "design-spec.json"
    try:
        head = skill_md.read_text(encoding="utf-8", errors="replace")[:4000]
        if head.startswith("---"):
            end_idx = head.find("\n---", 3)
            if end_idx != -1:
                fm = head[3:end_idx]
                for line in fm.splitlines():
                    if ":" in line:
                        k, v = line.split(":", 1)
                        if k.strip().lower() == "design_spec":
                            rel = _sanitize_asset_rel(v.strip().strip('"').strip("'"))
                            if rel and rel.endswith(".json"):
                                return rel
    except Exception:
        pass
    return "design-spec.json"


def resolve_design_skill_spec(
    skill_ref: str,
    *,
    workspace_root: Optional[Path] = None,
    global_skills_dir: Optional[Path] = None,
) -> Optional[Dict[str, Any]]:
    """
    Resuelve `skill_ref` (slug o nombre, saneado sin path traversal) buscando primero
    en `global_skills_dir/<slug>/design-spec.json` y luego en
    `workspace_root/habilidades/<slug>/design-spec.json`.

    Devuelve la especificación normalizada enriquecida con `_skill_slug`,
    `_skill_dir` (str) y `_resolved_assets` mapeando claves de activos a rutas
    absolutas verificadas dentro de `skill_dir`.
    """
    if not isinstance(skill_ref, str):
        return None
    raw_ref = skill_ref.strip()
    if not raw_ref or len(raw_ref) > 140:
        return None
    # Bloquear explícitamente cualquier intento de path traversal o separadores de ruta
    if ".." in raw_ref or "/" in raw_ref or "\\" in raw_ref or "\x00" in raw_ref:
        return None

    candidates: List[str] = []
    exact_low = raw_ref.lower()
    if _SAFE_SLUG_RE.match(exact_low) and exact_low not in (".", ".."):
        candidates.append(exact_low)
    slugged = _slugify_design_name(raw_ref)
    if slugged and slugged not in candidates:
        candidates.append(slugged)

    if not candidates:
        return None

    search_roots: List[Path] = []
    if global_skills_dir is not None:
        search_roots.append(Path(global_skills_dir))
    if workspace_root is not None:
        search_roots.append(Path(workspace_root) / "habilidades")

    for base_root in search_roots:
        if not base_root.is_dir():
            continue
        for cand_slug in candidates:
            skill_dir = base_root / cand_slug
            if not skill_dir.is_dir() or not _is_path_within(skill_dir, base_root):
                continue

            spec_rel = _read_skill_design_spec_rel(skill_dir)
            spec_path = skill_dir / spec_rel
            if not spec_path.is_file() or not _is_path_within(spec_path, skill_dir):
                continue
            try:
                if spec_path.stat().st_size > _MAX_DESIGN_SPEC_BYTES:
                    continue
                raw_json = json.loads(spec_path.read_text(encoding="utf-8"))
                if not isinstance(raw_json, dict):
                    continue
            except Exception:
                continue

            spec = normalize_design_spec(raw_json)
            if not spec["slug"]:
                spec["slug"] = cand_slug

            resolved_skill_dir = skill_dir.resolve()
            asset_pairs = (
                ("logo_asset", spec["header"]["logo_asset"]),
                ("cover_logo_asset", spec["cover"]["logo_asset"]),
                ("cover_background_asset", spec["cover"]["background_asset"]),
                ("stationery_asset", spec["page"]["stationery_asset"]),
            )
            resolved_assets: Dict[str, str] = {}
            for asset_key, rel_asset in asset_pairs:
                if not rel_asset:
                    continue
                asset_candidate = resolved_skill_dir / rel_asset
                if asset_candidate.is_file() and _is_path_within(asset_candidate, resolved_skill_dir):
                    resolved_assets[asset_key] = str(asset_candidate.resolve())

            spec["_skill_slug"] = cand_slug
            spec["_skill_dir"] = str(resolved_skill_dir)
            spec["_resolved_assets"] = resolved_assets
            return spec

    return None


def save_design_skill_bundle(
    skill_dir: Path,
    design_spec: Dict[str, Any],
    *,
    source_pdf: Optional[Path] = None,
    source_file: Optional[Path] = None,
    extract_assets: bool = True,
) -> Dict[str, Any]:
    """
    Guarda atómicamente `skill_dir / "design-spec.json"` y extrae opcionalmente
    activos limpios (logotipos) desde `source_file` (o `source_pdf`) — soportando
    PDF, Word (`.docx`), Excel (`.xlsx`) y PowerPoint (`.pptx`) — hacia `skill_dir / "assets/"`.
    """
    skill_dir = Path(skill_dir)
    skill_dir.mkdir(parents=True, exist_ok=True)

    effective_source: Optional[Path] = (
        Path(source_file)
        if source_file is not None
        else (Path(source_pdf) if source_pdf is not None else None)
    )

    spec = normalize_design_spec(design_spec)
    if not spec["slug"]:
        spec["slug"] = _slugify_design_name(skill_dir.name)
    if effective_source is not None and not spec["source_pdf"]:
        spec["source_pdf"] = effective_source.name

    extracted_assets: List[Dict[str, Any]] = []
    if extract_assets and effective_source is not None and effective_source.is_file():
        assets_dir = skill_dir / "assets"
        inspect_res = inspect_document_design(
            effective_source,
            sample_pages=2,
            extract_assets=True,
            assets_dir=assets_dir,
            include_preview_images=False,
            max_preview_pages=0,
        )
        if inspect_res.get("ok"):
            extracted_assets = list(inspect_res.get("extracted_assets") or [])
            inspected_spec = inspect_res.get("design_spec") or {}
            insp_header = inspected_spec.get("header") or {}
            insp_cover = inspected_spec.get("cover") or {}
            if insp_header.get("logo_asset") and not spec["header"].get("logo_asset"):
                spec["header"]["logo_asset"] = insp_header["logo_asset"]
                if insp_header.get("logo_position"):
                    spec["header"]["logo_position"] = insp_header["logo_position"]
                if insp_header.get("logo_height_pt"):
                    spec["header"]["logo_height_pt"] = insp_header["logo_height_pt"]
            if insp_cover.get("logo_asset") and not spec["cover"].get("logo_asset"):
                spec["cover"]["logo_asset"] = insp_cover["logo_asset"]
            # Si el diseño entrante no traía source_format explícito, preservar el detectado del archivo fuente
            if not (isinstance(design_spec, dict) and design_spec.get("source_format")) and inspected_spec.get("source_format"):
                spec["source_format"] = inspected_spec["source_format"]
                if not (isinstance(design_spec, dict) and design_spec.get("supported_outputs")) and inspected_spec.get("supported_outputs"):
                    spec["supported_outputs"] = list(inspected_spec["supported_outputs"])
            spec = normalize_design_spec(spec)

    spec_path = skill_dir / "design-spec.json"
    tmp_path = skill_dir / f".design-spec.json.tmp.{os.getpid()}.{time.time_ns()}"
    payload = json.dumps(spec, ensure_ascii=False, indent=2) + "\n"
    try:
        tmp_path.write_text(payload, encoding="utf-8")
        os.replace(str(tmp_path), str(spec_path))
    finally:
        if tmp_path.exists():
            try:
                tmp_path.unlink()
            except Exception:
                pass

    return {
        "ok": True,
        "design_spec_path": str(spec_path),
        "design_spec": spec,
        "extracted_assets": extracted_assets,
    }
