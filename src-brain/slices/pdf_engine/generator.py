"""
Generador adaptativo de documentos PDF para XOOK usando ReportLab (BSD) + Pillow.
Diseñado para que el agente componga libremente estructura (títulos, subtítulos,
párrafos, listas, tablas, métricas, callouts, imágenes y portada opcional)
interpretando la petición del usuario sin plantillas ni prompts rígidos.
"""

from __future__ import annotations

from datetime import datetime
from html import escape as xml_escape
import io
import json
import os
from pathlib import Path
import re
import textwrap
import time
from typing import Any, Callable, Dict, List, Optional, Tuple

from PIL import Image as PILImage, ImageDraw, ImageEnhance, ImageOps
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4, letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm, mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    HRFlowable,
    Image as RLImage,
    KeepTogether,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Preformatted,
    Spacer,
    Table,
    TableStyle,
)

_FONTS_REGISTERED = False
_FONT_FAMILY = {
    "regular": "Helvetica",
    "bold": "Helvetica-Bold",
    "italic": "Helvetica-Oblique",
    "bold_italic": "Helvetica-BoldOblique",
    "mono": "Courier",
    "unicode_ttf": False,
}
_FONT_FAMILIES: Dict[str, Dict[str, Any]] = {
    "sans": {
        "regular": "Helvetica",
        "bold": "Helvetica-Bold",
        "italic": "Helvetica-Oblique",
        "bold_italic": "Helvetica-BoldOblique",
        "unicode_ttf": False,
    },
    "serif": {
        "regular": "Times-Roman",
        "bold": "Times-Bold",
        "italic": "Times-Italic",
        "bold_italic": "Times-BoldItalic",
        "unicode_ttf": False,
    },
    "mono": {
        "regular": "Courier",
        "bold": "Courier-Bold",
        "italic": "Courier-Oblique",
        "bold_italic": "Courier-BoldOblique",
        "unicode_ttf": False,
    },
}

THEMES: Dict[str, Dict[str, Any]] = {
    "executive": {
        "dark_page": False,
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
        "callout_info": ("#EFF6FF", "#2563EB", "#1E3A8A"),
        "callout_success": ("#ECFDF5", "#059669", "#065F46"),
        "callout_warning": ("#FFFBEB", "#D97706", "#92400E"),
        "callout_critical": ("#FEF2F2", "#DC2626", "#991B1B"),
    },
    "minimal": {
        "dark_page": False,
        "page_bg": "#FFFFFF",
        "text": "#27272A",
        "heading": "#09090B",
        "muted": "#71717A",
        "accent": "#18181B",
        "accent_dark": "#09090B",
        "accent_soft": "#F4F4F5",
        "border": "#D4D4D8",
        "surface": "#FAFAFA",
        "table_head_bg": "#18181B",
        "table_head_fg": "#FFFFFF",
        "table_alt": "#FAFAFA",
        "callout_info": ("#F4F4F5", "#27272A", "#09090B"),
        "callout_success": ("#ECFDF5", "#059669", "#065F46"),
        "callout_warning": ("#FFFBEB", "#D97706", "#92400E"),
        "callout_critical": ("#FEF2F2", "#DC2626", "#991B1B"),
    },
    "emerald": {
        "dark_page": False,
        "page_bg": "#FFFFFF",
        "text": "#1E293B",
        "heading": "#064E3B",
        "muted": "#64748B",
        "accent": "#059669",
        "accent_dark": "#065F46",
        "accent_soft": "#ECFDF5",
        "border": "#CBD5E1",
        "surface": "#F8FAFC",
        "table_head_bg": "#064E3B",
        "table_head_fg": "#FFFFFF",
        "table_alt": "#F0FDF4",
        "callout_info": ("#ECFDF5", "#059669", "#064E3B"),
        "callout_success": ("#ECFDF5", "#059669", "#065F46"),
        "callout_warning": ("#FFFBEB", "#D97706", "#92400E"),
        "callout_critical": ("#FEF2F2", "#DC2626", "#991B1B"),
    },
    "warm": {
        "dark_page": False,
        "page_bg": "#FFFFFF",
        "text": "#292524",
        "heading": "#1C1917",
        "muted": "#78716C",
        "accent": "#B45309",
        "accent_dark": "#78350F",
        "accent_soft": "#FFFBEB",
        "border": "#D6D3D1",
        "surface": "#FAFAF9",
        "table_head_bg": "#292524",
        "table_head_fg": "#FFFFFF",
        "table_alt": "#FAFAF9",
        "callout_info": ("#FFFBEB", "#B45309", "#78350F"),
        "callout_success": ("#ECFDF5", "#059669", "#065F46"),
        "callout_warning": ("#FFFBEB", "#D97706", "#92400E"),
        "callout_critical": ("#FEF2F2", "#DC2626", "#991B1B"),
    },
    "midnight": {
        "dark_page": True,
        "page_bg": "#0B1120",
        "text": "#E2E8F0",
        "heading": "#F8FAFC",
        "muted": "#94A3B8",
        "accent": "#38BDF8",
        "accent_dark": "#0284C7",
        "accent_soft": "#1E293B",
        "border": "#334155",
        "surface": "#111827",
        "table_head_bg": "#1E293B",
        "table_head_fg": "#F8FAFC",
        "table_alt": "#0F172A",
        "callout_info": ("#1E293B", "#38BDF8", "#E0F2FE"),
        "callout_success": ("#064E3B", "#34D399", "#D1FAE5"),
        "callout_warning": ("#451A03", "#FBBF24", "#FEF3C7"),
        "callout_critical": ("#450A0A", "#F87171", "#FEE2E2"),
    },
}


def _register_ttf_family(
    family_name: str,
    family_key: str,
    candidates: List[Tuple[str, str, str, str]],
    *,
    require_bold: bool = True,
) -> bool:
    for reg, bold, italic, bitalic in candidates:
        if not Path(reg).is_file():
            continue
        if require_bold and not Path(bold).is_file():
            continue
        try:
            bold_path = bold if Path(bold).is_file() else reg
            italic_path = italic if Path(italic).is_file() else reg
            bitalic_path = bitalic if Path(bitalic).is_file() else bold_path

            bold_name = f"{family_name}-Bold"
            italic_name = f"{family_name}-Italic"
            bitalic_name = f"{family_name}-BoldItalic"

            pdfmetrics.registerFont(TTFont(family_name, reg))
            pdfmetrics.registerFont(TTFont(bold_name, bold_path))
            pdfmetrics.registerFont(TTFont(italic_name, italic_path))
            pdfmetrics.registerFont(TTFont(bitalic_name, bitalic_path))
            pdfmetrics.registerFontFamily(
                family_name,
                normal=family_name,
                bold=bold_name,
                italic=italic_name,
                boldItalic=bitalic_name,
            )
            _FONT_FAMILIES[family_key] = {
                "regular": family_name,
                "bold": bold_name,
                "italic": italic_name,
                "bold_italic": bitalic_name,
                "unicode_ttf": True,
            }
            return True
        except Exception:
            continue
    return False


def _ensure_fonts() -> None:
    global _FONTS_REGISTERED
    if _FONTS_REGISTERED:
        return
    _FONTS_REGISTERED = True

    sans_candidates = [
        # macOS Supplemental TrueType fonts (soporte completo de español y Unicode)
        (
            "/System/Library/Fonts/Supplemental/Arial.ttf",
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
            "/System/Library/Fonts/Supplemental/Arial Italic.ttf",
            "/System/Library/Fonts/Supplemental/Arial Bold Italic.ttf",
        ),
        # Linux / Docker DejaVu / Liberation
        (
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-BoldOblique.ttf",
        ),
        (
            "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Italic.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-BoldItalic.ttf",
        ),
    ]

    serif_candidates = [
        (
            "/System/Library/Fonts/Supplemental/Georgia.ttf",
            "/System/Library/Fonts/Supplemental/Georgia Bold.ttf",
            "/System/Library/Fonts/Supplemental/Georgia Italic.ttf",
            "/System/Library/Fonts/Supplemental/Georgia Bold Italic.ttf",
        ),
        (
            "/System/Library/Fonts/Supplemental/Times New Roman.ttf",
            "/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf",
            "/System/Library/Fonts/Supplemental/Times New Roman Italic.ttf",
            "/System/Library/Fonts/Supplemental/Times New Roman Bold Italic.ttf",
        ),
        (
            "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Italic.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSerif-BoldItalic.ttf",
        ),
        (
            "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSerif-Italic.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSerif-BoldItalic.ttf",
        ),
    ]

    mono_candidates = [
        (
            "/System/Library/Fonts/Supplemental/Courier New.ttf",
            "/System/Library/Fonts/Supplemental/Courier New Bold.ttf",
            "/System/Library/Fonts/Supplemental/Courier New Italic.ttf",
            "/System/Library/Fonts/Supplemental/Courier New Bold Italic.ttf",
        ),
        (
            "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Oblique.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-BoldOblique.ttf",
        ),
        (
            "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationMono-Italic.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationMono-BoldItalic.ttf",
        ),
    ]

    if _register_ttf_family("XookSans", "sans", sans_candidates, require_bold=True):
        _FONT_FAMILY["regular"] = _FONT_FAMILIES["sans"]["regular"]
        _FONT_FAMILY["bold"] = _FONT_FAMILIES["sans"]["bold"]
        _FONT_FAMILY["italic"] = _FONT_FAMILIES["sans"]["italic"]
        _FONT_FAMILY["bold_italic"] = _FONT_FAMILIES["sans"]["bold_italic"]
        _FONT_FAMILY["unicode_ttf"] = True

    _register_ttf_family("XookSerif", "serif", serif_candidates, require_bold=True)

    if _register_ttf_family("XookMono", "mono", mono_candidates, require_bold=False):
        _FONT_FAMILY["mono"] = _FONT_FAMILIES["mono"]["regular"]


def _resolve_font_set(family_key: str) -> Dict[str, str]:
    """Resuelve familia tipográfica (`sans`, `serif`, `mono`) a nombres registrados en ReportLab."""
    _ensure_fonts()
    key = str(family_key or "sans").strip().lower()
    if key in ("serif", "times", "georgia", "garamond", "palatino", "cambria"):
        key = "serif"
    elif key in ("mono", "monospace", "courier", "code", "consolas", "menlo"):
        key = "mono"
    else:
        key = "sans"
    fam = _FONT_FAMILIES.get(key) or _FONT_FAMILIES["sans"]
    return {
        "regular": str(fam["regular"]),
        "bold": str(fam["bold"]),
        "italic": str(fam["italic"]),
        "bold_italic": str(fam["bold_italic"]),
    }


_HEX_COLOR_RE = re.compile(r"^#?[0-9A-Fa-f]{6}$")


def _safe_hex_color(raw: Any, fallback: str = "#1E293B") -> str:
    txt = str(raw or "").strip()
    if _HEX_COLOR_RE.match(txt):
        return f"#{txt.lstrip('#').upper()}"
    return fallback


def _hex_to_rl_color(raw: Any, fallback: str = "#1E293B") -> colors.Color:
    return colors.HexColor(_safe_hex_color(raw, fallback))


def _is_dark_hex(hex_str: str) -> bool:
    clean = _safe_hex_color(hex_str, "#FFFFFF").lstrip("#")
    r = int(clean[0:2], 16)
    g = int(clean[2:4], 16)
    b = int(clean[4:6], 16)
    return (0.299 * r + 0.587 * g + 0.114 * b) < 115.0


def _map_align(raw: Any) -> int:
    key = str(raw or "left").strip().lower()
    if key in ("justify", "justified"):
        return TA_JUSTIFY
    if key in ("center", "centered", "centre"):
        return TA_CENTER
    if key == "right":
        return TA_RIGHT
    return TA_LEFT


def _json_safe_copy(obj: Any) -> Any:
    if isinstance(obj, Path):
        return str(obj)
    if isinstance(obj, dict):
        return {str(k): _json_safe_copy(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_json_safe_copy(v) for v in obj]
    return obj


def _strip_private_keys(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {k: _strip_private_keys(v) for k, v in obj.items() if not str(k).startswith("_")}
    if isinstance(obj, list):
        return [_strip_private_keys(v) for v in obj]
    if isinstance(obj, Path):
        return str(obj)
    return obj


def _deep_merge_fallback(base: Dict[str, Any], overrides: Dict[str, Any]) -> Dict[str, Any]:
    merged: Dict[str, Any] = _json_safe_copy(base)
    for k, v in overrides.items():
        if isinstance(v, dict) and isinstance(merged.get(k), dict):
            merged[k] = _deep_merge_fallback(merged[k], v)
        else:
            merged[k] = _json_safe_copy(v)
    return merged


def _resolve_inspector_funcs() -> Tuple[Callable, Callable, Callable]:
    try:
        from slices.pdf_engine.inspector import (
            merge_design_spec,
            normalize_design_spec,
            resolve_design_skill_spec,
        )
        return normalize_design_spec, merge_design_spec, resolve_design_skill_spec
    except Exception:
        def _norm(raw: Optional[Dict[str, Any]]) -> Dict[str, Any]:
            return _json_safe_copy(raw) if isinstance(raw, dict) else {}

        def _merge(base: Optional[Dict[str, Any]], overrides: Optional[Dict[str, Any]]) -> Dict[str, Any]:
            b = _norm(base)
            o = overrides if isinstance(overrides, dict) else {}
            return _deep_merge_fallback(b, o)

        def _resolve_skill(
            skill_ref: str,
            *,
            workspace_root: Optional[Path] = None,
            global_skills_dir: Optional[Path] = None,
        ) -> Optional[Dict[str, Any]]:
            return None

        return _norm, _merge, _resolve_skill


def _resolve_design_asset_path(
    asset_key: str,
    raw_val: Any,
    *,
    resolved_assets: Dict[str, Any],
    skill_dir: Optional[str],
    workspace_root: Path,
    resolve_path_fn: Callable[[Path, str], Tuple[Path, str, str]],
) -> Optional[Path]:
    """Resuelve un asset de diseño (logo, portada o papelería PDF) de forma segura."""
    if raw_val is None:
        return None
    raw_str = str(raw_val).strip()
    if not raw_str:
        return None

    skill_base = Path(skill_dir).resolve() if skill_dir else None

    # 1) Si apunta a una ruta dentro del skill_dir
    if skill_base is not None and skill_base.is_dir():
        cand = (skill_base / raw_str).resolve()
        if cand.is_file() and (cand == skill_base or skill_base in cand.parents):
            return cand

    # 2) Si coincide con _resolved_assets provisto por resolve_design_skill_spec
    mapped = resolved_assets.get(asset_key)
    if mapped:
        mapped_p = Path(str(mapped)).resolve()
        if mapped_p.is_file():
            if raw_str == str(mapped) or Path(raw_str).name == mapped_p.name:
                return mapped_p

    # 3) Ruta absoluta explícita dentro de skill_dir o workspace_root
    raw_p = Path(raw_str)
    if raw_p.is_absolute():
        abs_p = raw_p.resolve()
        ws_res = workspace_root.resolve()
        in_ws = abs_p == ws_res or ws_res in abs_p.parents
        in_skill = skill_base is not None and (abs_p == skill_base or skill_base in abs_p.parents)
        if abs_p.is_file() and (in_ws or in_skill):
            return abs_p

    # 4) Búsqueda tolerante en el workspace
    try:
        ws_abs, _ = _resolve_workspace_file_smart(workspace_root, raw_str, resolve_path_fn)
        if ws_abs.is_file():
            return ws_abs
    except Exception:
        pass
    return None


def _sanitize_text_for_pdf(raw: Any) -> str:
    text = str(raw or "")
    # Limpiar caracteres de control y emojis fuera de BMP que suelen verse como cuadros
    cleaned_chars: List[str] = []
    for ch in text:
        code = ord(ch)
        if ch in ("\n", "\t", "\r"):
            cleaned_chars.append(ch)
        elif code < 32:
            continue
        elif code > 0xFFFF:
            continue
        else:
            cleaned_chars.append(ch)
    out = "".join(cleaned_chars)
    if not _FONT_FAMILY["unicode_ttf"]:
        out = (
            out.replace("—", "-")
            .replace("–", "-")
            .replace("•", "*")
            .replace("→", "->")
            .replace("←", "<-")
            .replace("✓", "[ok]")
            .replace("✔", "[ok]")
            .replace("★", "*")
            .replace("“", '"')
            .replace("”", '"')
            .replace("’", "'")
            .replace("‘", "'")
        )
    return out


def _inline_md_to_rl_xml(raw: Any, mono_font: str) -> str:
    """Convierte **negrita**, *cursiva* y `código` a XML seguro para ReportLab Paragraph."""
    text = _sanitize_text_for_pdf(raw)
    escaped = xml_escape(text, quote=False)

    # Proteger `code` primero
    code_tokens: List[str] = []

    def _stash_code(m: re.Match[str]) -> str:
        idx = len(code_tokens)
        code_tokens.append(f'<font name="{mono_font}" size="9">{m.group(1)}</font>')
        return f"\x00CODE{idx}\x00"

    escaped = re.sub(r"`([^`\n]+)`", _stash_code, escaped)
    escaped = re.sub(r"\*\*([^\n*]+?)\*\*", r"<b>\1</b>", escaped)
    escaped = re.sub(r"(?<!\*)\*([^\n*]+?)\*(?!\*)", r"<i>\1</i>", escaped)
    escaped = escaped.replace("\r\n", "\n").replace("\r", "\n").replace("\n", "<br/>")

    for idx, token_html in enumerate(code_tokens):
        escaped = escaped.replace(f"\x00CODE{idx}\x00", token_html)
    return escaped


def _slugify(raw: str) -> str:
    chars: List[str] = []
    prev_dash = False
    for ch in raw.strip().lower():
        if ch.isalnum():
            chars.append(ch)
            prev_dash = False
        elif not prev_dash and chars:
            chars.append("-")
            prev_dash = True
    return "".join(chars).strip("-")[:48] or "documento"


def _spanish_date_label() -> str:
    months = (
        "enero", "febrero", "marzo", "abril", "mayo", "junio",
        "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
    )
    now = datetime.now().astimezone()
    return f"{now.day} de {months[now.month - 1]} de {now.year}"


def _resolve_workspace_file_smart(
    workspace_root: Path,
    raw_path: str,
    resolve_fn: Callable[[Path, str], Tuple[Path, str, str]],
) -> Tuple[Path, str]:
    clean = str(raw_path or "").strip()
    if not clean:
        raise ValueError("Ruta vacía.")

    try:
        abs_p, rel_p, _ = resolve_fn(workspace_root, clean)
        if abs_p.is_file():
            return abs_p, rel_p
    except Exception:
        pass

    # Búsqueda tolerante por nombre de archivo dentro de carpetas comunes si el modelo omitió el prefijo
    name_only = Path(clean.replace("\\", "/")).name
    if not name_only or "/" in clean.strip("/"):
        raise FileNotFoundError(f"No se encontró el archivo '{clean}' dentro del workspace.")

    search_dirs = [
        workspace_root / "agente" / "adjuntos",
        workspace_root / "datos" / "documentos",
        workspace_root / "agente",
        workspace_root / "datos",
        workspace_root / "empresa",
    ]
    matches: List[Path] = []
    seen = set()
    for base in search_dirs:
        if not base.is_dir():
            continue
        for cand in sorted(base.rglob("*")):
            if cand.is_file() and cand.name.lower() == name_only.lower():
                resolved = cand.resolve()
                if resolved not in seen and workspace_root.resolve() in resolved.parents:
                    seen.add(resolved)
                    matches.append(resolved)

    if matches:
        chosen = matches[0]
        rel = chosen.relative_to(workspace_root.resolve()).as_posix()
        return chosen, rel

    raise FileNotFoundError(f"No se encontró la imagen o archivo '{clean}' dentro del espacio de trabajo.")


def _load_pil_image(img_path: Path) -> PILImage.Image:
    with PILImage.open(img_path) as raw:
        transposed = ImageOps.exif_transpose(raw)
        if transposed.mode not in ("RGB", "RGBA"):
            transposed = transposed.convert("RGBA" if "A" in transposed.getbands() else "RGB")
        return transposed.copy()


def _pil_to_png_buffer(pil_img: PILImage.Image, bg_hex: Optional[str] = None) -> io.BytesIO:
    img = pil_img
    if img.mode == "RGBA" and bg_hex:
        bg = PILImage.new("RGB", img.size, bg_hex)
        bg.paste(img, mask=img.split()[3])
        img = bg
    elif img.mode == "RGBA":
        pass
    elif img.mode != "RGB":
        img = img.convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    buf.seek(0)
    return buf


def _make_full_bleed_cover_buffer(
    pil_img: PILImage.Image,
    page_w_pt: float,
    page_h_pt: float,
    *,
    dpi: int = 150,
) -> io.BytesIO:
    """Recorta al aspecto de página y aplica un degradado oscuro elegante para legibilidad."""
    target_w = max(800, int(page_w_pt / 72.0 * dpi))
    target_h = max(1000, int(page_h_pt / 72.0 * dpi))

    src = pil_img.convert("RGB")
    fitted = ImageOps.fit(src, (target_w, target_h), method=PILImage.Resampling.LANCZOS, centering=(0.5, 0.45))
    fitted = ImageEnhance.Brightness(fitted).enhance(0.86)

    overlay = PILImage.new("RGBA", (target_w, target_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    # Degradado sutil arriba y fuerte en mitad inferior donde vive el título
    for y in range(target_h):
        ratio = y / float(target_h)
        if ratio < 0.25:
            alpha = int(110 * (1.0 - ratio / 0.25))
        elif ratio < 0.42:
            alpha = 40
        else:
            t = (ratio - 0.42) / 0.58
            alpha = int(45 + 175 * (t ** 1.15))
        draw.line([(0, y), (target_w, y)], fill=(8, 13, 28, min(230, max(0, alpha))))

    composed = PILImage.alpha_composite(fitted.convert("RGBA"), overlay).convert("RGB")
    buf = io.BytesIO()
    composed.save(buf, format="JPEG", quality=88, optimize=True)
    buf.seek(0)
    return buf


_MD_FENCE_RE = re.compile(r"^([ \t]*)(`{3,}|~{3,})(.*)$")

_PDF_LANG_LABELS: Dict[str, str] = {
    "c": "C",
    "h": "C",
    "cpp": "C++",
    "c++": "C++",
    "cc": "C++",
    "cxx": "C++",
    "hpp": "C++",
    "cuda": "CUDA",
    "cs": "C#",
    "c#": "C#",
    "csharp": "C#",
    "dotnet": "C#",
    "fs": "F#",
    "f#": "F#",
    "fsharp": "F#",
    "vb": "VB.NET",
    "vbnet": "VB.NET",
    "vb.net": "VB.NET",
    "py": "Python",
    "py3": "Python",
    "python": "Python",
    "python3": "Python",
    "js": "JavaScript",
    "javascript": "JavaScript",
    "mjs": "JavaScript",
    "cjs": "JavaScript",
    "jsx": "JSX",
    "ts": "TypeScript",
    "typescript": "TypeScript",
    "tsx": "TSX",
    "rs": "Rust",
    "rust": "Rust",
    "go": "Go",
    "golang": "Go",
    "zig": "Zig",
    "java": "Java",
    "kt": "Kotlin",
    "kotlin": "Kotlin",
    "swift": "Swift",
    "scala": "Scala",
    "objc": "Objective-C",
    "objective-c": "Objective-C",
    "objectivec": "Objective-C",
    "rb": "Ruby",
    "ruby": "Ruby",
    "php": "PHP",
    "dart": "Dart",
    "ex": "Elixir",
    "elixir": "Elixir",
    "hs": "Haskell",
    "haskell": "Haskell",
    "lua": "Lua",
    "perl": "Perl",
    "r": "R",
    "jl": "Julia",
    "julia": "Julia",
    "matlab": "MATLAB",
    "sql": "SQL",
    "pgsql": "PostgreSQL",
    "postgres": "PostgreSQL",
    "postgresql": "PostgreSQL",
    "mysql": "MySQL",
    "sqlite": "SQLite",
    "tsql": "T-SQL",
    "html": "HTML",
    "css": "CSS",
    "scss": "SCSS",
    "less": "Less",
    "vue": "Vue",
    "svelte": "Svelte",
    "astro": "Astro",
    "xml": "XML",
    "svg": "SVG",
    "json": "JSON",
    "jsonc": "JSONC",
    "yaml": "YAML",
    "yml": "YAML",
    "toml": "TOML",
    "ini": "INI",
    "env": "Env",
    "dotenv": "Env",
    "sh": "Shell",
    "shell": "Shell",
    "bash": "Bash",
    "zsh": "Zsh",
    "fish": "Fish",
    "ps1": "PowerShell",
    "pwsh": "PowerShell",
    "powershell": "PowerShell",
    "bat": "Batch",
    "dos": "Batch",
    "dockerfile": "Dockerfile",
    "docker": "Dockerfile",
    "makefile": "Makefile",
    "make": "Makefile",
    "cmake": "CMake",
    "tf": "Terraform",
    "hcl": "Terraform",
    "terraform": "Terraform",
    "sol": "Solidity",
    "solidity": "Solidity",
    "prisma": "Prisma",
    "proto": "Protobuf",
    "protobuf": "Protobuf",
    "graphql": "GraphQL",
    "gql": "GraphQL",
    "glsl": "GLSL",
    "wgsl": "WGSL",
    "asm": "Assembly",
    "x86asm": "Assembly",
    "wasm": "WebAssembly",
    "md": "Markdown",
    "markdown": "Markdown",
    "mdx": "MDX",
    "tex": "LaTeX",
    "latex": "LaTeX",
    "mmd": "Mermaid",
    "mermaid": "Mermaid",
    "diff": "Diff",
    "patch": "Diff",
    "csv": "CSV",
    "tsv": "TSV",
    "plaintext": "Código",
    "text": "Código",
    "txt": "Código",
}


def _format_code_language_label(raw_lang: str) -> str:
    cleaned = (raw_lang or "").strip().strip("{}")
    cleaned = re.sub(r"^\.?language-", "", cleaned, flags=re.I)
    if not cleaned:
        return ""
    lower = cleaned.lower()
    if lower in _PDF_LANG_LABELS:
        return _PDF_LANG_LABELS[lower]
    return cleaned.upper() if len(cleaned) <= 4 else cleaned


def _parse_fence_info_for_pdf(raw_info: str) -> Tuple[str, str]:
    info = (raw_info or "").strip()
    if not info:
        return "", ""
    caption = ""
    attr = re.search(r'(?:title|file|filename|name|path)\s*=\s*(?:"([^"]+)"|\'([^\']+)\'|(\S+))', info, re.I)
    if attr:
        caption = (attr.group(1) or attr.group(2) or attr.group(3) or "").strip()
    parts = info.split()
    first = re.sub(r"^\.?language-", "", parts[0].strip("{}"), flags=re.I)
    lang = first
    if ":" in first:
        left, right = first.split(":", 1)
        if "." in right or right.lower() in ("dockerfile", "makefile", ".env"):
            lang = left or right
            if not caption:
                caption = right
    elif not caption and len(parts) > 1 and "." in parts[1] and "=" not in parts[1]:
        caption = parts[1].strip("\"'`")
    return lang, caption


def _parse_markdown_to_blocks(md_text: str) -> List[Dict[str, Any]]:
    blocks: List[Dict[str, Any]] = []
    lines = (md_text or "").replace("\r\n", "\n").split("\n")
    i = 0
    para_buf: List[str] = []

    def _flush_para() -> None:
        if para_buf:
            joined = " ".join(x.strip() for x in para_buf if x.strip()).strip()
            if joined:
                blocks.append({"type": "paragraph", "text": joined})
            para_buf.clear()

    while i < len(lines):
        raw = lines[i]
        stripped = raw.strip()
        if not stripped:
            _flush_para()
            i += 1
            continue

        if stripped in ("---", "***", "___"):
            _flush_para()
            blocks.append({"type": "divider"})
            i += 1
            continue

        h_match = re.match(r"^(#{1,3})\s+(.*)$", stripped)
        if h_match:
            _flush_para()
            blocks.append({
                "type": "heading",
                "level": len(h_match.group(1)),
                "text": h_match.group(2).strip(),
            })
            i += 1
            continue

        img_match = re.match(r"^!\[([^\]]*)\]\(([^)]+)\)$", stripped)
        if img_match:
            _flush_para()
            blocks.append({
                "type": "image",
                "caption": img_match.group(1).strip() or None,
                "path": img_match.group(2).strip(),
            })
            i += 1
            continue

        if (
            i + 1 < len(lines)
            and "|" in stripped
            and re.match(r"^\|?\s*:?-{2,}:?(?:\s*\|\s*:?-{2,}:?)*\s*\|?$", lines[i + 1].strip())
        ):
            _flush_para()
            headers = [c.strip() for c in stripped.strip("|").split("|")]
            i += 2
            rows: List[List[str]] = []
            while i < len(lines) and "|" in lines[i]:
                row_vals = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                if any(row_vals):
                    rows.append(row_vals)
                i += 1
            blocks.append({"type": "table", "headers": headers, "rows": rows})
            continue

        if re.match(r"^[-*•]\s+", stripped):
            _flush_para()
            items: List[str] = []
            while i < len(lines) and re.match(r"^\s*[-*•]\s+", lines[i]):
                items.append(re.sub(r"^\s*[-*•]\s+", "", lines[i]).strip())
                i += 1
            blocks.append({"type": "bullets", "items": items})
            continue

        if re.match(r"^\d+[.)]\s+", stripped):
            _flush_para()
            items_num: List[str] = []
            while i < len(lines) and re.match(r"^\s*\d+[.)]\s+", lines[i]):
                items_num.append(re.sub(r"^\s*\d+[.)]\s+", "", lines[i]).strip())
                i += 1
            blocks.append({"type": "numbered_list", "items": items_num})
            continue

        fence_match = _MD_FENCE_RE.match(raw)
        if fence_match and not (fence_match.group(2)[0] == "`" and "`" in fence_match.group(3)):
            _flush_para()
            indent_len = len(fence_match.group(1))
            fence_char = fence_match.group(2)[0]
            fence_len = len(fence_match.group(2))
            fence_lang, fence_cap = _parse_fence_info_for_pdf(fence_match.group(3))
            close_re = re.compile(rf"^\s*{re.escape(fence_char)}{{{fence_len},}}\s*$")
            code_lines: List[str] = []
            i += 1
            while i < len(lines) and not close_re.match(lines[i]):
                content_line = lines[i].rstrip("\r")
                if indent_len > 0:
                    strip_n = 0
                    while strip_n < indent_len and strip_n < len(content_line) and content_line[strip_n] == " ":
                        strip_n += 1
                    if strip_n > 0:
                        content_line = content_line[strip_n:]
                code_lines.append(content_line)
                i += 1
            if i < len(lines) and close_re.match(lines[i]):
                i += 1
            code_body = "\n".join(code_lines).strip("\n")
            if code_body:
                blk_item: Dict[str, Any] = {"type": "code", "language": fence_lang, "code": code_body}
                if fence_cap:
                    blk_item["caption"] = fence_cap
                blocks.append(blk_item)
            continue

        if stripped.startswith(">"):
            _flush_para()
            quote_lines: List[str] = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                quote_lines.append(lines[i].strip().lstrip(">").strip())
                i += 1
            blocks.append({"type": "callout", "text": " ".join(quote_lines)})
            continue

        para_buf.append(stripped)
        i += 1

    _flush_para()
    return blocks


def _image_has_transparency(pil_img: PILImage.Image) -> bool:
    """Detecta transparencia real (no un canal RGBA opaco con alfa=255)."""
    try:
        if "A" in pil_img.getbands():
            extrema = pil_img.getchannel("A").getextrema()
            return bool(extrema and extrema[0] < 245)
        if pil_img.mode == "P" and "transparency" in (pil_img.info or {}):
            return True
    except Exception:
        pass
    return False


def _extract_cover_ocr_text(img_abs: Optional[Path]) -> str:
    """Ejecuta OCR local ligero sobre una imagen candidata a portada si está disponible."""
    if img_abs is None or not img_abs.is_file():
        return ""
    try:
        from slices.pdf_engine.ocr import extract_text_from_images_macos, is_local_ocr_available

        if not is_local_ocr_available():
            return ""
        res = extract_text_from_images_macos([img_abs], timeout_sec=12)
        return str(res.get(str(img_abs.resolve())) or res.get(str(img_abs)) or "").strip()
    except Exception:
        return ""


def _image_looks_like_ready_cover(pil_img: PILImage.Image, img_abs: Optional[Path] = None) -> bool:
    """
    Detecta si la imagen adjunta ya es una portada o carátula diseñada (ej. hoja académica,
    portada corporativa con texto/logotipos incrustados) que debe insertarse limpia a página completa
    sin oscurecer ni encimar títulos encima.
    """
    try:
        w, h = pil_img.size
        if w < 320 or h < 420:
            return False
        aspect = w / float(max(1, h))
        if not (0.52 <= aspect <= 0.92):
            return False

        # Muestreo rápido de luminancia
        sample = pil_img.convert("RGB").resize((80, 80)).convert("L")
        pixels = list(sample.getdata())
        total = float(max(1, len(pixels)))
        very_light = sum(1 for p in pixels if p >= 220) / total
        dark_ink = sum(1 for p in pixels if p <= 95) / total
        midtones = sum(1 for p in pixels if 96 <= p <= 210) / total

        ocr_text = _extract_cover_ocr_text(img_abs)
        if ocr_text:
            alnum_count = len(re.findall(r"[A-Za-zÀ-ÿ0-9]", ocr_text))
            non_empty_lines = sum(1 for ln in ocr_text.splitlines() if ln.strip())
            if alnum_count >= 10 and very_light >= 0.30:
                return True
            if alnum_count >= 25 and non_empty_lines >= 3:
                return True

        # Respaldo heurístico cuando OCR no está disponible: hoja clara uniforme + trazos/texto oscuros
        if very_light >= 0.55 and dark_ink >= 0.015 and midtones <= 0.25:
            return True
    except Exception:
        pass
    return False


def _sample_cover_edge_hex(pil_img: PILImage.Image, fallback_hex: str = "#FFFFFF") -> str:
    """Obtiene el color dominante en las esquinas de la portada para fundir márgenes sin cortes."""
    try:
        rgb = pil_img.convert("RGB")
        w, h = rgb.size
        pts = [
            rgb.getpixel((min(w - 1, 2), min(h - 1, 2))),
            rgb.getpixel((max(0, w - 3), min(h - 1, 2))),
            rgb.getpixel((min(w - 1, 2), max(0, h - 3))),
            rgb.getpixel((max(0, w - 3), max(0, h - 3))),
        ]
        r = sum(p[0] for p in pts) // len(pts)
        g = sum(p[1] for p in pts) // len(pts)
        b = sum(p[2] for p in pts) // len(pts)
        # Si las esquinas son cercanas a blanco, usar blanco puro para evitar bordes sucios
        if r >= 235 and g >= 235 and b >= 235:
            return "#FFFFFF"
        return f"#{r:02X}{g:02X}{b:02X}"
    except Exception:
        return fallback_hex


def _make_full_page_cover_buffer(pil_img: PILImage.Image, fallback_bg_hex: str = "#FFFFFF") -> Tuple[io.BytesIO, str]:
    """Prepara la portada íntegra en alta calidad sin recortar, oscurecer ni aplicar velos."""
    edge_hex = _sample_cover_edge_hex(pil_img, fallback_bg_hex)
    if "A" in pil_img.getbands():
        canvas = PILImage.new("RGB", pil_img.size, edge_hex)
        canvas.paste(pil_img, mask=pil_img.split()[-1])
    else:
        canvas = pil_img.convert("RGB")
    buf = io.BytesIO()
    canvas.save(buf, format="PNG", optimize=True)
    buf.seek(0)
    return buf, edge_hex


def _recover_json_block_objects(raw_str: str) -> List[Dict[str, Any]]:
    """
    Recupera objetos bloque `{...}` válidos desde un string JSON de `blocks`
    incluso si quedó truncado al final o tiene comas sobrantes/saltos sin escapar.
    """
    txt = (raw_str or "").strip()
    if not txt:
        return []

    def _try_loads_list(candidate: str) -> Optional[List[Dict[str, Any]]]:
        try:
            loaded = json.loads(candidate)
            if isinstance(loaded, dict):
                return [loaded]
            if isinstance(loaded, list):
                return [item for item in loaded if isinstance(item, dict)]
        except Exception:
            pass
        return None

    direct = _try_loads_list(txt)
    if direct is not None:
        return direct

    cleaned = re.sub(r",\s*([}\]])", r"\1", txt)
    direct_clean = _try_loads_list(cleaned)
    if direct_clean is not None:
        return direct_clean

    # Escaneo incremental de objetos `{...}` con JSONDecoder (rescate ante truncamiento al final)
    decoder = json.JSONDecoder()
    recovered: List[Dict[str, Any]] = []
    idx = 0
    n = len(txt)
    while idx < n:
        pos = txt.find("{", idx)
        if pos == -1:
            break
        try:
            obj, end_idx = decoder.raw_decode(txt, pos)
            if isinstance(obj, dict):
                recovered.append(obj)
            idx = max(pos + 1, end_idx)
        except Exception:
            idx = pos + 1

    if recovered:
        return recovered

    # Último intento: normalizar saltos de línea literales dentro de cadenas JSON
    normalized_chars: List[str] = []
    in_str = False
    esc = False
    for ch in txt:
        if esc:
            normalized_chars.append(ch)
            esc = False
        elif ch == "\\" and in_str:
            normalized_chars.append(ch)
            esc = True
        elif ch == '"':
            normalized_chars.append(ch)
            in_str = not in_str
        elif in_str and ch == "\n":
            normalized_chars.append("\\n")
        elif in_str and ch == "\r":
            continue
        elif in_str and ch == "\t":
            normalized_chars.append("\\t")
        else:
            normalized_chars.append(ch)
    norm_txt = "".join(normalized_chars)
    norm_clean = _try_loads_list(re.sub(r",\s*([}\]])", r"\1", norm_txt))
    if norm_clean is not None:
        return norm_clean

    idx = 0
    n_norm = len(norm_txt)
    while idx < n_norm:
        pos = norm_txt.find("{", idx)
        if pos == -1:
            break
        try:
            obj, end_idx = decoder.raw_decode(norm_txt, pos)
            if isinstance(obj, dict):
                recovered.append(obj)
            idx = max(pos + 1, end_idx)
        except Exception:
            idx = pos + 1
    return recovered


def _coerce_block_list_value(raw_val: Any) -> Any:
    if isinstance(raw_val, str):
        stripped = raw_val.strip()
        if not stripped:
            return []
        looks_like_json_blocks = (
            stripped.startswith("[")
            and any(tok in stripped[:400] for tok in ('"type"', "'type'", '"heading"', '"paragraph"', '"bullet', '"code"', '"table"'))
        ) or (
            stripped.startswith("{")
            and ('"type"' in stripped[:250] or "'type'" in stripped[:250])
        )
        if looks_like_json_blocks or stripped.startswith("[") or stripped.startswith("{"):
            recovered = _recover_json_block_objects(stripped)
            if recovered:
                return recovered
            if looks_like_json_blocks:
                # Nunca volcar JSON crudo como párrafos literales dentro del PDF
                return []
        return _parse_markdown_to_blocks(stripped)
    return raw_val


def _preprocess_raw_block_items(raw_items: Any) -> List[Any]:
    """Expande variantes frecuentes de modelos (bullet_list, code, markdown, secciones anidadas)."""
    coerced = _coerce_block_list_value(raw_items)
    if isinstance(coerced, dict):
        coerced = [coerced]
    if not isinstance(coerced, list):
        return []

    expanded: List[Any] = []
    for item in coerced:
        if isinstance(item, str):
            text = item.strip()
            if text:
                expanded.extend(_parse_markdown_to_blocks(text))
            continue
        if not isinstance(item, dict):
            continue

        btype = str(item.get("type") or "").strip().lower()
        role = str(item.get("role") or "").strip().lower()
        if btype == "cover" or role == "cover":
            expanded.append(item)
            continue

        if btype in ("markdown", "md", "rich_text"):
            md_txt = str(item.get("text") or item.get("content") or item.get("markdown") or "").strip()
            if md_txt:
                expanded.extend(_parse_markdown_to_blocks(md_txt))
            continue

        if btype in ("bullet_list", "unordered_list", "ul", "bullet", "list_items", "bullets", "list"):
            cloned = dict(item)
            cloned["type"] = "bullets"
            if "items" not in cloned:
                cloned["items"] = cloned.get("bullets") or cloned.get("points") or []
            expanded.append(cloned)
            continue

        if btype in ("numbered_list", "ordered_list", "ol", "numbered"):
            cloned = dict(item)
            cloned["type"] = "numbered_list"
            if "items" not in cloned:
                cloned["items"] = cloned.get("points") or cloned.get("bullets") or []
            expanded.append(cloned)
            continue

        if btype in ("code", "code_block", "pre", "snippet", "source_code"):
            code_txt = str(item.get("code") or item.get("text") or item.get("content") or "")
            if code_txt.strip():
                expanded.append({
                    "type": "code",
                    "language": str(item.get("language") or item.get("lang") or "").strip(),
                    "caption": str(item.get("caption") or item.get("title") or "").strip(),
                    "code": code_txt,
                })
            continue

        if btype in ("text", "body", "p", "para", "paragraph"):
            txt = str(item.get("text") or item.get("content") or item.get("body") or "").strip()
            if txt:
                cloned = dict(item)
                cloned["type"] = "paragraph"
                cloned["text"] = txt
                expanded.append(cloned)
            continue

        if btype in ("note", "warning", "tip", "important", "blockquote"):
            tone_map = {"warning": "warning", "tip": "success", "important": "warning"}
            txt = str(item.get("text") or item.get("content") or item.get("body") or "").strip()
            if txt or item.get("title"):
                expanded.append({
                    "type": "callout",
                    "tone": str(item.get("tone") or tone_map.get(btype, "info")),
                    "title": str(item.get("title") or "").strip(),
                    "text": txt,
                })
            continue

        if btype in ("columns", "column_layout", "two_columns", "multi_column"):
            raw_cols = item.get("columns") or item.get("cols")
            if not isinstance(raw_cols, list) and (item.get("left") is not None or item.get("right") is not None):
                raw_cols = [item.get("left") or [], item.get("right") or []]
            if isinstance(raw_cols, list) and raw_cols:
                cloned = dict(item)
                cloned["type"] = "columns"
                cloned["columns"] = raw_cols
                expanded.append(cloned)
            continue

        if btype in ("kv_grid", "header_band", "metadata_grid", "info_box", "key_value"):
            cloned = dict(item)
            cloned["type"] = "header_band" if btype == "header_band" else "kv_grid"
            raw_kv = cloned.get("items")
            if raw_kv is None:
                raw_kv = cloned.get("fields") or cloned.get("pairs") or cloned.get("entries")
            if isinstance(raw_kv, dict):
                cloned["items"] = [{"label": str(k), "value": str(v)} for k, v in raw_kv.items()]
            elif isinstance(raw_kv, list):
                cloned["items"] = raw_kv
            else:
                cloned["items"] = []
            expanded.append(cloned)
            continue

        if btype in ("signature_block", "signatures", "signature"):
            cloned = dict(item)
            cloned["type"] = "signature_block"
            signers = cloned.get("signers")
            if not isinstance(signers, list):
                signers = cloned.get("items") or cloned.get("parties") or []
            cloned["signers"] = signers if isinstance(signers, list) else []
            expanded.append(cloned)
            continue

        if btype in ("box", "panel", "card", "container"):
            cloned = dict(item)
            cloned["type"] = "box"
            expanded.append(cloned)
            continue

        # Objeto tipo sección sin `type` explícito pero con campos compuestos (`paragraphs`, `bullets`, `code`, `subsections`)
        has_composite = any(
            k in item
            for k in ("paragraphs", "bullets", "code", "subsections", "children", "blocks")
        )
        if not btype and has_composite:
            sec_title = str(item.get("heading") or item.get("title") or "").strip()
            if sec_title:
                expanded.append({"type": "heading", "level": int(item.get("level") or 1), "text": sec_title})
            sec_sub = str(item.get("subtitle") or "").strip()
            if sec_sub:
                expanded.append({"type": "heading", "level": 2, "text": sec_sub})
            body_val = item.get("body") or item.get("content") or item.get("text")
            if isinstance(body_val, str) and body_val.strip():
                expanded.extend(_parse_markdown_to_blocks(body_val.strip()))
            elif isinstance(body_val, list):
                expanded.extend(_preprocess_raw_block_items(body_val))
            paras = item.get("paragraphs")
            if isinstance(paras, list):
                for p in paras:
                    if isinstance(p, str) and p.strip():
                        expanded.append({"type": "paragraph", "text": p.strip()})
                    elif isinstance(p, dict):
                        expanded.extend(_preprocess_raw_block_items([p]))
            blts = item.get("bullets") or item.get("items")
            if isinstance(blts, list) and blts:
                expanded.append({"type": "bullets", "items": blts})
            code_val = item.get("code")
            if isinstance(code_val, str) and code_val.strip():
                expanded.append({
                    "type": "code",
                    "language": str(item.get("language") or item.get("lang") or "").strip(),
                    "code": code_val,
                })
            sub_children = item.get("subsections") or item.get("children") or item.get("blocks")
            if sub_children:
                expanded.extend(_preprocess_raw_block_items(sub_children))
            continue

        expanded.append(item)

    return expanded


def _count_substantive_blocks(blocks: List[Dict[str, Any]]) -> int:
    """Cuenta cuántos bloques con contenido real (no solo separadores/saltos) tiene el documento."""
    count = 0
    for blk in blocks:
        if not isinstance(blk, dict):
            continue
        btype = str(blk.get("type") or "").strip().lower()
        if btype in ("divider", "spacer", "page_break"):
            continue
        if btype == "heading" and str(blk.get("text") or "").strip():
            count += 1
        elif btype in ("paragraph", "callout", "summary", "quote") and (
            str(blk.get("text") or blk.get("content") or blk.get("title") or "").strip()
        ):
            count += 1
        elif btype in ("bullets", "bullet_list", "unordered_list", "ul", "list", "numbered_list", "ordered_list", "ol") and (
            isinstance(blk.get("items"), list) and any(str(x).strip() for x in blk.get("items") or [])
        ):
            count += 1
        elif btype in ("code", "code_block", "pre") and str(blk.get("code") or blk.get("text") or "").strip():
            count += 1
        elif btype == "table" and ((blk.get("rows") or []) or (blk.get("headers") or [])):
            count += 1
        elif btype == "kpi_strip" and (blk.get("metrics") or blk.get("items")):
            count += 1
        elif btype == "image" and str(blk.get("path") or blk.get("image_path") or "").strip():
            count += 1
        elif btype == "columns":
            cols = blk.get("columns") or blk.get("cols") or []
            if isinstance(cols, list) and any(
                isinstance(col_items, list) and _count_substantive_blocks(col_items) > 0
                for col_items in cols
            ):
                count += 1
        elif btype in ("kv_grid", "header_band"):
            items = blk.get("items")
            if (isinstance(items, list) and len(items) > 0) or (isinstance(items, dict) and len(items) > 0) or str(blk.get("title") or "").strip():
                count += 1
        elif btype in ("signature_block", "signatures"):
            signers = blk.get("signers") or blk.get("items") or []
            if isinstance(signers, list) and len(signers) > 0:
                count += 1
        elif btype in ("box", "panel", "card"):
            inner_blks = blk.get("blocks")
            if (
                str(blk.get("text") or blk.get("content") or blk.get("title") or "").strip()
                or (isinstance(inner_blks, list) and _count_substantive_blocks(inner_blks) > 0)
            ):
                count += 1
    return count


def _normalize_blocks_input(spec: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """Normaliza `blocks`, `sections`, variantes de LLM y `markdown` en una lista plana tipada."""
    raw_blocks = spec.get("blocks")
    if raw_blocks is None:
        raw_blocks = spec.get("elements") or spec.get("body_blocks") or spec.get("pages")
    raw_blocks = _preprocess_raw_block_items(raw_blocks)

    raw_sections = spec.get("sections")
    if raw_sections is None:
        raw_sections = spec.get("chapters")
    raw_sections = _preprocess_raw_block_items(raw_sections)

    cover_override: Optional[Dict[str, Any]] = None
    out: List[Dict[str, Any]] = []

    def _push_item(item: Any) -> None:
        nonlocal cover_override
        if isinstance(item, str) and item.strip():
            out.extend(_parse_markdown_to_blocks(item))
            return
        if not isinstance(item, dict):
            return
        btype = str(item.get("type") or item.get("kind") or "").strip().lower()
        if btype == "cover":
            cover_override = item
            return
        if not btype:
            # Inferencia tolerante si viene formato de sección {title, subtitle, body, blocks}
            sec_title = str(item.get("title") or item.get("heading") or "").strip()
            sec_sub = str(item.get("subtitle") or "").strip()
            if sec_title:
                out.append({"type": "heading", "level": int(item.get("level") or 1), "text": sec_title})
            if sec_sub:
                out.append({"type": "heading", "level": 2, "text": sec_sub})
            body = item.get("body") or item.get("content") or item.get("text")
            if isinstance(body, str) and body.strip():
                out.extend(_parse_markdown_to_blocks(body))
            nested = item.get("blocks") or item.get("items")
            if isinstance(nested, list):
                for sub in nested:
                    _push_item(sub)
            return

        if btype in ("h1", "h2", "h3"):
            lvl = int(btype[1])
            out.append({"type": "heading", "level": lvl, "text": str(item.get("text") or item.get("title") or "")})
            return
        if btype in ("title", "subtitle"):
            lvl = 1 if btype == "title" else 2
            out.append({"type": "heading", "level": lvl, "text": str(item.get("text") or item.get("title") or "")})
            return
        if btype == "section":
            sec_title = str(item.get("title") or item.get("heading") or "").strip()
            sec_sub = str(item.get("subtitle") or "").strip()
            if sec_title:
                out.append({"type": "heading", "level": int(item.get("level") or 1), "text": sec_title})
            if sec_sub:
                out.append({"type": "heading", "level": 2, "text": sec_sub})
            body = item.get("body") or item.get("content") or item.get("text")
            if isinstance(body, str) and body.strip():
                out.extend(_parse_markdown_to_blocks(body))
            for sub in (item.get("blocks") or []):
                _push_item(sub)
            return

        if btype == "columns":
            raw_cols = item.get("columns") or item.get("cols") or []
            norm_cols: List[List[Dict[str, Any]]] = []
            if isinstance(raw_cols, list):
                for col_raw in raw_cols:
                    if isinstance(col_raw, list):
                        col_norm, _ = _normalize_blocks_input({"blocks": col_raw})
                    elif isinstance(col_raw, str):
                        col_norm = _parse_markdown_to_blocks(col_raw)
                    elif isinstance(col_raw, dict):
                        col_norm, _ = _normalize_blocks_input({"blocks": [col_raw]})
                    else:
                        col_norm = []
                    norm_cols.append(col_norm)
            if norm_cols:
                cloned_col = {**item, "type": "columns", "columns": norm_cols}
                out.append(cloned_col)
            return

        if btype in ("box", "panel", "card"):
            cloned_box = {**item, "type": "box"}
            if isinstance(item.get("blocks"), list):
                inner_norm, _ = _normalize_blocks_input({"blocks": item["blocks"]})
                cloned_box["blocks"] = inner_norm
            out.append(cloned_box)
            return

        if btype in ("kv_grid", "header_band"):
            cloned_kv = {**item, "type": btype}
            raw_kv = cloned_kv.get("items")
            if isinstance(raw_kv, dict):
                cloned_kv["items"] = [{"label": str(k), "value": str(v)} for k, v in raw_kv.items()]
            elif not isinstance(raw_kv, list):
                cloned_kv["items"] = []
            out.append(cloned_kv)
            return

        if btype in ("signature_block", "signatures"):
            cloned_sig = {**item, "type": "signature_block"}
            signers = cloned_sig.get("signers")
            if not isinstance(signers, list):
                signers = cloned_sig.get("items") or []
            cloned_sig["signers"] = signers if isinstance(signers, list) else []
            out.append(cloned_sig)
            return

        out.append({**item, "type": btype})

    if isinstance(raw_blocks, list):
        for blk in raw_blocks:
            _push_item(blk)

    if isinstance(raw_sections, list):
        for sec in raw_sections:
            _push_item(sec)

    if not out and isinstance(spec.get("markdown"), str) and spec["markdown"].strip():
        out.extend(_parse_markdown_to_blocks(spec["markdown"]))

    if not out and isinstance(spec.get("content"), str) and spec["content"].strip():
        out.extend(_parse_markdown_to_blocks(spec["content"]))

    if not out and isinstance(spec.get("body"), str) and spec["body"].strip():
        out.extend(_parse_markdown_to_blocks(spec["body"]))

    # Normalizar aliases de tipo que hayan llegado directo
    for blk in out:
        bt = str(blk.get("type") or "").strip().lower()
        if bt in ("bullet_list", "unordered_list", "ul"):
            blk["type"] = "bullets"
        elif bt in ("ordered_list", "ol"):
            blk["type"] = "numbered_list"
        elif bt in ("code_block", "pre", "snippet"):
            blk["type"] = "code"
        elif bt in ("panel", "card"):
            blk["type"] = "box"
        elif bt == "signatures":
            blk["type"] = "signature_block"

    return out, cover_override


class _NumberedCanvas(rl_canvas.Canvas):
    """Canvas de dos pasadas para numeración exacta 'Página X de Y'."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self._page_meta = kwargs.pop("xook_meta", {})
        super().__init__(*args, **kwargs)
        self._saved_page_states: List[Dict[str, Any]] = []

    def showPage(self) -> None:
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self) -> None:
        page_offset = int(self._page_meta.get("page_offset", 0))
        total_pages = len(self._saved_page_states) + page_offset
        for idx, state in enumerate(self._saved_page_states):
            self.__dict__.update(state)
            self._draw_chrome(idx + 1 + page_offset, total_pages)
            super().showPage()
        super().save()

    def _draw_chrome(self, page_num: int, total_pages: int) -> None:
        theme = self._page_meta.get("theme") or THEMES["executive"]
        has_cover = bool(self._page_meta.get("has_cover"))
        page_w, page_h = self._pagesize
        margin_x = float(self._page_meta.get("margin_x", 2.0 * cm))
        is_cover_page = has_cover and page_num == 1

        if is_cover_page:
            return

        design_spec = self._page_meta.get("design_spec")
        if isinstance(design_spec, dict):
            self._draw_design_chrome(page_num, total_pages, design_spec, theme, page_w, page_h)
            return

        self.saveState()
        muted_col = colors.HexColor(theme["muted"])
        border_col = colors.HexColor(theme["border"])
        accent_col = colors.HexColor(theme["accent"])

        doc_title = _sanitize_text_for_pdf(self._page_meta.get("title") or "")
        company = _sanitize_text_for_pdf(self._page_meta.get("author") or "")
        date_str = _sanitize_text_for_pdf(self._page_meta.get("date") or "")

        # Header sutil
        header_y = page_h - 1.25 * cm
        self.setStrokeColor(border_col)
        self.setLineWidth(0.5)
        self.line(margin_x, header_y - 4, page_w - margin_x, header_y - 4)

        self.setFont(_FONT_FAMILY["bold"], 8)
        self.setFillColor(accent_col)
        left_header = (doc_title[:64] + "…") if len(doc_title) > 64 else doc_title
        self.drawString(margin_x, header_y, left_header)

        if company:
            self.setFont(_FONT_FAMILY["regular"], 8)
            self.setFillColor(muted_col)
            self.drawRightString(page_w - margin_x, header_y, company[:48])

        # Footer sutil (sin marca de agua por defecto; branding/seguridad es opt-in)
        footer_y = 1.15 * cm
        self.setStrokeColor(border_col)
        self.setLineWidth(0.5)
        self.line(margin_x, footer_y + 10, page_w - margin_x, footer_y + 10)

        self.setFont(_FONT_FAMILY["regular"], 8)
        self.setFillColor(muted_col)
        custom_footer = _sanitize_text_for_pdf(self._page_meta.get("footer_text") or "").strip()
        wm_cfg = self._page_meta.get("watermark") if isinstance(self._page_meta.get("watermark"), dict) else {}
        wm_enabled = bool(wm_cfg.get("enabled"))
        wm_footer = _sanitize_text_for_pdf(wm_cfg.get("footer_text") or "").strip() if wm_enabled else ""
        if custom_footer:
            left_footer = f"{custom_footer} · {date_str}" if date_str else custom_footer
        elif wm_footer:
            left_footer = f"{wm_footer} · {date_str}" if date_str else wm_footer
        else:
            left_footer = date_str
        if left_footer:
            self.drawString(margin_x, footer_y, left_footer[:72])
        self.drawRightString(page_w - margin_x, footer_y, f"Página {page_num} de {total_pages}")

        # Marca de agua diagonal opcional (solo cuando se activa explícitamente)
        self._draw_optional_watermark(wm_cfg, muted_col, page_w, page_h)
        self.restoreState()

    def _draw_optional_watermark(
        self,
        wm_cfg: Dict[str, Any],
        muted_col: colors.Color,
        page_w: float,
        page_h: float,
    ) -> None:
        wm_enabled = bool(wm_cfg.get("enabled"))
        wm_diag = _sanitize_text_for_pdf(wm_cfg.get("diagonal_text") or "").strip() if wm_enabled else ""
        if not wm_diag:
            return
        self.saveState()
        try:
            opacity = float(wm_cfg.get("opacity", 0.07))
        except (TypeError, ValueError):
            opacity = 0.07
        opacity = max(0.02, min(0.35, opacity))
        if hasattr(self, "setFillAlpha"):
            self.setFillAlpha(opacity)
        self.setFillColor(muted_col)
        font_size = 40 if len(wm_diag) <= 18 else (28 if len(wm_diag) <= 32 else 20)
        bold_font = str(self._page_meta.get("heading_font_bold") or _FONT_FAMILY["bold"])
        self.setFont(bold_font, font_size)
        self.translate(page_w / 2.0, page_h / 2.0)
        self.rotate(38)
        self.drawCentredString(0, 0, wm_diag[:48])
        self.restoreState()

    def _draw_design_chrome(
        self,
        page_num: int,
        total_pages: int,
        design_spec: Dict[str, Any],
        theme: Dict[str, Any],
        page_w: float,
        page_h: float,
    ) -> None:
        """Renderiza encabezado y pie totalmente configurables desde `design_spec`."""
        self.saveState()
        margin_left = float(self._page_meta.get("margin_left", self._page_meta.get("margin_x", 56.0)))
        margin_right = float(self._page_meta.get("margin_right", self._page_meta.get("margin_x", 56.0)))
        margin_top = float(self._page_meta.get("margin_top", 58.0))
        margin_bottom = float(self._page_meta.get("margin_bottom", 52.0))

        body_reg = str(self._page_meta.get("body_font_reg") or _FONT_FAMILY["regular"])
        body_bold = str(self._page_meta.get("body_font_bold") or _FONT_FAMILY["bold"])

        muted_col = _hex_to_rl_color(theme.get("muted"), "#64748B")
        accent_col = _hex_to_rl_color(theme.get("accent"), "#2563EB")
        border_fallback = str(theme.get("border") or "#CBD5E1")

        doc_title = _sanitize_text_for_pdf(self._page_meta.get("title") or "")
        doc_subtitle = _sanitize_text_for_pdf(self._page_meta.get("subtitle") or "")
        company = _sanitize_text_for_pdf(self._page_meta.get("author") or "")
        date_str = _sanitize_text_for_pdf(self._page_meta.get("date") or "")

        def _subst(raw_tpl: Any) -> str:
            txt = str(raw_tpl or "")
            if not txt:
                return ""
            out = (
                txt.replace("{title}", doc_title)
                .replace("{subtitle}", doc_subtitle)
                .replace("{author}", company)
                .replace("{date}", date_str)
                .replace("{page}", str(page_num))
                .replace("{total}", str(total_pages))
            )
            return _sanitize_text_for_pdf(out).strip()

        # 1) Header configurable
        header_cfg = design_spec.get("header") if isinstance(design_spec.get("header"), dict) else {}
        header_enabled = bool(header_cfg.get("enabled", False))
        skip_header = page_num == 1 and bool(header_cfg.get("skip_first_page", False))
        if header_enabled and not skip_header:
            h_height = max(14.0, min(120.0, float(header_cfg.get("height_pt") or 28.0)))
            bg_hex_raw = header_cfg.get("background_hex")
            has_header_bg = isinstance(bg_hex_raw, str) and bool(_HEX_COLOR_RE.match(bg_hex_raw.strip()))
            header_bg_hex = _safe_hex_color(bg_hex_raw, "#FFFFFF") if has_header_bg else None

            if header_bg_hex:
                self.setFillColor(colors.HexColor(header_bg_hex))
                self.rect(0, page_h - h_height, page_w, h_height, stroke=0, fill=1)
                header_line_y = page_h - h_height
                text_y = page_h - (h_height * 0.5) - 3.0
                on_dark = _is_dark_hex(header_bg_hex)
                primary_fg = colors.white if on_dark else accent_col
                secondary_fg = colors.HexColor("#E2E8F0") if on_dark else muted_col
            else:
                header_line_y = page_h - max(18.0, min(margin_top - 8.0, h_height + 10.0))
                text_y = min(page_h - 12.0, header_line_y + 5.0)
                primary_fg = accent_col
                secondary_fg = muted_col

            if bool(header_cfg.get("border_bottom", False)):
                hb_col = _hex_to_rl_color(header_cfg.get("border_color"), border_fallback)
                self.setStrokeColor(hb_col)
                self.setLineWidth(0.55)
                if header_bg_hex:
                    self.line(0, header_line_y, page_w, header_line_y)
                else:
                    self.line(margin_left, header_line_y, page_w - margin_right, header_line_y)

            left_offset = 0.0
            right_offset = 0.0
            logo_info = self._page_meta.get("header_logo_reader")
            if isinstance(logo_info, tuple) and len(logo_info) == 3:
                logo_reader, iw, ih = logo_info
                max_logo_h = max(10.0, min(h_height - 4.0 if header_bg_hex else max(16.0, margin_top - 16.0), float(header_cfg.get("logo_height_pt") or 22.0)))
                logo_w = max_logo_h * (float(iw) / float(max(1, ih)))
                logo_w = min(logo_w, max(24.0, (page_w - margin_left - margin_right) * 0.35))
                logo_h = logo_w * (float(ih) / float(max(1, iw)))
                logo_pos = str(header_cfg.get("logo_position") or "left").strip().lower()
                if logo_pos == "right":
                    lx = page_w - margin_right - logo_w
                    right_offset = logo_w + 8.0
                elif logo_pos == "center":
                    lx = (page_w - logo_w) / 2.0
                else:
                    lx = margin_left
                    left_offset = logo_w + 8.0
                ly = (page_h - h_height + (h_height - logo_h) / 2.0) if header_bg_hex else (header_line_y + 3.0)
                try:
                    self.drawImage(logo_reader, lx, ly, width=logo_w, height=logo_h, preserveAspectRatio=True, mask="auto")
                except Exception:
                    pass

            left_hdr = _subst(header_cfg.get("left"))
            center_hdr = _subst(header_cfg.get("center"))
            right_hdr = _subst(header_cfg.get("right"))

            if left_hdr:
                self.setFont(body_bold, 8.0)
                self.setFillColor(primary_fg)
                self.drawString(margin_left + left_offset, text_y, left_hdr[:72])
            if center_hdr:
                self.setFont(body_reg, 8.0)
                self.setFillColor(secondary_fg)
                self.drawCentredString(page_w / 2.0, text_y, center_hdr[:64])
            if right_hdr:
                self.setFont(body_reg, 8.0)
                self.setFillColor(secondary_fg)
                self.drawRightString(page_w - margin_right - right_offset, text_y, right_hdr[:60])

        # 2) Footer configurable
        footer_cfg = design_spec.get("footer") if isinstance(design_spec.get("footer"), dict) else {}
        footer_enabled = bool(footer_cfg.get("enabled", False))
        skip_footer = page_num == 1 and bool(footer_cfg.get("skip_first_page", False))
        if footer_enabled and not skip_footer:
            f_height = max(14.0, min(90.0, float(footer_cfg.get("height_pt") or 26.0)))
            footer_y = max(12.0, min(margin_bottom - 14.0, f_height * 0.55 + 6.0))
            footer_line_y = footer_y + 10.5

            if bool(footer_cfg.get("border_top", False)):
                fb_col = _hex_to_rl_color(footer_cfg.get("border_color"), border_fallback)
                self.setStrokeColor(fb_col)
                self.setLineWidth(0.5)
                self.line(margin_left, footer_line_y, page_w - margin_right, footer_line_y)

            self.setFont(body_reg, 8.0)
            self.setFillColor(muted_col)
            left_ftr = _subst(footer_cfg.get("left"))
            center_ftr = _subst(footer_cfg.get("center"))
            right_ftr = _subst(footer_cfg.get("right"))

            custom_footer = _sanitize_text_for_pdf(self._page_meta.get("footer_text") or "").strip()
            if custom_footer and custom_footer not in left_ftr and custom_footer not in center_ftr:
                left_ftr = f"{custom_footer} · {left_ftr}" if left_ftr else custom_footer

            if left_ftr:
                self.drawString(margin_left, footer_y, left_ftr[:76])
            if center_ftr:
                self.drawCentredString(page_w / 2.0, footer_y, center_ftr[:68])
            if right_ftr:
                self.drawRightString(page_w - margin_right, footer_y, right_ftr[:64])

        # 3) Marca de agua diagonal opcional
        wm_cfg = self._page_meta.get("watermark") if isinstance(self._page_meta.get("watermark"), dict) else {}
        self._draw_optional_watermark(wm_cfg, muted_col, page_w, page_h)
        self.restoreState()


def generate_pdf_document(
    spec: Dict[str, Any],
    *,
    workspace_root: Path,
    resolve_path_fn: Callable[[Path, str], Tuple[Path, str, str]],
    autonomous_roots: Tuple[str, ...] = ("agente", "memoria"),
    default_author: Optional[str] = None,
    progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
    allow_any_workspace_zone: bool = False,
    prepend_first_page_from: Optional[Path] = None,
    prepend_all_pages_from: Optional[Path] = None,
    save_spec_override: Optional[Dict[str, Any]] = None,
    global_skills_dir: Optional[Path] = None,
) -> Dict[str, Any]:
    """
    Genera un documento PDF estructurado dentro de `agente/` del workspace activo.
    Retorna metadata del PDF creado (`ok`, `path`, `filename`, `page_count`, `size_bytes`, etc.).
    """
    _ensure_fonts()

    title = _sanitize_text_for_pdf(spec.get("title") or "Documento").strip() or "Documento"
    subtitle = _sanitize_text_for_pdf(spec.get("subtitle") or "").strip()
    author = _sanitize_text_for_pdf(spec.get("author") or spec.get("company") or default_author or "").strip()
    if spec.get("date") is False:
        date_label = ""
    else:
        date_label = _sanitize_text_for_pdf(spec.get("date") or _spanish_date_label()).strip()

    custom_footer_text = _sanitize_text_for_pdf(str(spec.get("footer_text") or "")).strip()
    raw_wm = spec.get("watermark") if "watermark" in spec else spec.get("branding")
    wm_enabled = False
    wm_footer = ""
    wm_diagonal = ""
    wm_opacity = 0.07
    if isinstance(raw_wm, bool):
        wm_enabled = raw_wm
        wm_footer = "XOOK" if wm_enabled else ""
    elif isinstance(raw_wm, str) and raw_wm.strip():
        low_wm = raw_wm.strip().lower()
        if low_wm not in ("false", "0", "none", "off", "no"):
            wm_enabled = True
            if low_wm in ("true", "1", "on", "yes", "xook"):
                wm_footer = "XOOK"
            else:
                wm_diagonal = _sanitize_text_for_pdf(raw_wm).strip()
    elif isinstance(raw_wm, dict):
        wm_footer = _sanitize_text_for_pdf(str(raw_wm.get("footer_text") or "")).strip()
        wm_diagonal = _sanitize_text_for_pdf(str(raw_wm.get("diagonal_text") or raw_wm.get("text") or "")).strip()
        wm_enabled = bool(raw_wm.get("enabled", bool(wm_footer or wm_diagonal)))
        if wm_enabled and not wm_footer and not wm_diagonal:
            wm_footer = "XOOK"
        try:
            wm_opacity = float(raw_wm.get("opacity", 0.07))
        except (TypeError, ValueError):
            wm_opacity = 0.07
    watermark_meta = {
        "enabled": wm_enabled,
        "footer_text": wm_footer,
        "diagonal_text": wm_diagonal,
        "opacity": wm_opacity,
    }

    theme_name = str(spec.get("theme") or "executive").strip().lower()
    base_theme = dict(THEMES.get(theme_name, THEMES["executive"]))
    warnings: List[str] = []

    # Resolución de diseño personalizado (`design_skill` + `design_spec` + `design_overrides`)
    design_skill_ref = str(spec.get("design_skill") or "").strip()
    raw_inline_design = spec.get("design_spec") if isinstance(spec.get("design_spec"), dict) and spec.get("design_spec") else None
    raw_design_overrides = spec.get("design_overrides") if isinstance(spec.get("design_overrides"), dict) and spec.get("design_overrides") else None

    active_design_spec: Optional[Dict[str, Any]] = None
    resolved_skill_slug: Optional[str] = None
    resolved_skill_dir: Optional[str] = None
    resolved_assets: Dict[str, Any] = {}

    if design_skill_ref or raw_inline_design is not None or raw_design_overrides is not None:
        norm_fn, merge_fn, resolve_skill_fn = _resolve_inspector_funcs()
        working_design: Optional[Dict[str, Any]] = None

        if design_skill_ref:
            loaded_skill = resolve_skill_fn(
                design_skill_ref,
                workspace_root=workspace_root,
                global_skills_dir=global_skills_dir,
            )
            if isinstance(loaded_skill, dict):
                resolved_skill_slug = str(loaded_skill.get("_skill_slug") or loaded_skill.get("slug") or design_skill_ref).strip()
                if loaded_skill.get("_skill_dir"):
                    resolved_skill_dir = str(loaded_skill["_skill_dir"])
                if isinstance(loaded_skill.get("_resolved_assets"), dict):
                    resolved_assets.update(loaded_skill["_resolved_assets"])
                working_design = norm_fn(loaded_skill)
            else:
                warnings.append(f"Habilidad de diseño no encontrada ({design_skill_ref}); se usará diseño base.")

        if raw_inline_design is not None:
            if raw_inline_design.get("_skill_dir") and not resolved_skill_dir:
                resolved_skill_dir = str(raw_inline_design["_skill_dir"])
            if isinstance(raw_inline_design.get("_resolved_assets"), dict):
                resolved_assets.update(raw_inline_design["_resolved_assets"])
            if working_design is not None:
                working_design = merge_fn(working_design, raw_inline_design)
            else:
                working_design = norm_fn(raw_inline_design)

        if raw_design_overrides is not None:
            if isinstance(raw_design_overrides.get("_resolved_assets"), dict):
                resolved_assets.update(raw_design_overrides["_resolved_assets"])
            if working_design is None:
                # Sembrar con el tema solicitado si no hubo skill/spec base
                palette_keys = (
                    "page_bg", "text", "heading", "muted", "accent", "accent_dark",
                    "accent_soft", "border", "surface", "table_head_bg", "table_head_fg", "table_alt",
                )
                seed_spec: Dict[str, Any] = {
                    "palette": {k: base_theme[k] for k in palette_keys if k in base_theme},
                    "page": {"background_hex": base_theme.get("page_bg", "#FFFFFF")},
                }
                working_design = merge_fn(seed_spec, raw_design_overrides)
            else:
                working_design = merge_fn(working_design, raw_design_overrides)

        if working_design is not None:
            # Sincronizar page.background_hex <-> palette.page_bg si solo uno fue modificado
            ov_page_bg = (
                (raw_design_overrides.get("page") or {}).get("background_hex")
                if isinstance(raw_design_overrides, dict) and isinstance(raw_design_overrides.get("page"), dict)
                else None
            )
            ov_pal_bg = (
                (raw_design_overrides.get("palette") or {}).get("page_bg")
                if isinstance(raw_design_overrides, dict) and isinstance(raw_design_overrides.get("palette"), dict)
                else None
            )
            page_d = working_design.setdefault("page", {})
            pal_d = working_design.setdefault("palette", {})
            if ov_page_bg and not ov_pal_bg:
                pal_d["page_bg"] = _safe_hex_color(ov_page_bg, "#FFFFFF")
            elif ov_pal_bg and not ov_page_bg:
                page_d["background_hex"] = _safe_hex_color(ov_pal_bg, "#FFFFFF")
            else:
                p_hex = _safe_hex_color(page_d.get("background_hex"), "#FFFFFF")
                pal_hex = _safe_hex_color(pal_d.get("page_bg"), "#FFFFFF")
                if p_hex != "#FFFFFF" and pal_hex == "#FFFFFF":
                    pal_d["page_bg"] = p_hex
                elif pal_hex != "#FFFFFF" and p_hex == "#FFFFFF":
                    page_d["background_hex"] = pal_hex

            active_design_spec = working_design

    # Derivar paleta efectiva (`theme`)
    theme = dict(base_theme)
    if active_design_spec is not None:
        pal = active_design_spec.get("palette") if isinstance(active_design_spec.get("palette"), dict) else {}
        page_d = active_design_spec.get("page") if isinstance(active_design_spec.get("page"), dict) else {}
        for pkey in (
            "page_bg", "text", "heading", "muted", "accent", "accent_dark",
            "accent_soft", "border", "surface", "table_head_bg", "table_head_fg", "table_alt",
        ):
            if pal.get(pkey):
                theme[pkey] = _safe_hex_color(pal[pkey], theme[pkey])
        eff_page_bg = _safe_hex_color(page_d.get("background_hex") or theme.get("page_bg"), "#FFFFFF")
        theme["page_bg"] = eff_page_bg
        theme["dark_page"] = _is_dark_hex(eff_page_bg)
        if theme["dark_page"]:
            dark_ref = THEMES["midnight"]
            theme["callout_success"] = dark_ref["callout_success"]
            theme["callout_warning"] = dark_ref["callout_warning"]
            theme["callout_critical"] = dark_ref["callout_critical"]
            theme["callout_info"] = (theme["accent_soft"], theme["accent"], theme["heading"])
        else:
            theme["callout_info"] = (theme["accent_soft"], theme["accent"], theme["accent_dark"])

    page_size_key = str(spec.get("page_size") or "letter").strip().lower()
    pagesize: Tuple[float, float] = A4 if page_size_key == "a4" else letter

    if active_design_spec is not None:
        page_cfg = active_design_spec.get("page") if isinstance(active_design_spec.get("page"), dict) else {}
        ds_size_name = str(page_cfg.get("size_name") or "letter").strip().lower()
        ds_w = page_cfg.get("width_pt")
        ds_h = page_cfg.get("height_pt")
        if isinstance(ds_w, (int, float)) and isinstance(ds_h, (int, float)) and ds_w >= 200 and ds_h >= 200:
            pw_d, ph_d = float(ds_w), float(ds_h)
        elif ds_size_name == "a4":
            pw_d, ph_d = A4
        else:
            pw_d, ph_d = letter
        ds_orient = str(page_cfg.get("orientation") or "portrait").strip().lower()
        if ds_orient == "landscape" and pw_d < ph_d:
            pw_d, ph_d = ph_d, pw_d
        elif ds_orient == "portrait" and pw_d > ph_d:
            pw_d, ph_d = ph_d, pw_d
        pagesize = (pw_d, ph_d)

    override_changed_pagesize = bool(
        isinstance(raw_design_overrides, dict)
        and isinstance(raw_design_overrides.get("page"), dict)
        and any(k in raw_design_overrides["page"] for k in ("width_pt", "height_pt", "size_name", "orientation"))
    )
    ref_pdf_for_size = prepend_all_pages_from if (prepend_all_pages_from and prepend_all_pages_from.is_file()) else (
        prepend_first_page_from if (prepend_first_page_from and prepend_first_page_from.is_file()) else None
    )
    if ref_pdf_for_size is not None and not override_changed_pagesize:
        try:
            from pypdf import PdfReader as _SizePR
            r_sz = _SizePR(str(ref_pdf_for_size))
            if len(r_sz.pages) >= 1:
                mb = r_sz.pages[-1].mediabox
                pw_cand, ph_cand = float(mb.width), float(mb.height)
                if pw_cand > 200 and ph_cand > 200:
                    pagesize = (pw_cand, ph_cand)
        except Exception:
            pass
    page_w, page_h = pagesize

    # Resolver ruta de salida dentro de zona autónoma (o zona del workspace si viene de edición manual)
    raw_out = str(spec.get("output_path") or "").strip()
    if raw_out:
        if not raw_out.lower().endswith(".pdf"):
            raw_out += ".pdf"
        out_abs, out_rel, top_zone = resolve_path_fn(workspace_root, raw_out)
        if top_zone not in autonomous_roots and not allow_any_workspace_zone:
            # Redirigir a agente/reportes conservando el nombre para cumplir sandbox autónomo
            safe_name = Path(raw_out).name
            out_rel = f"agente/reportes/{safe_name}"
            out_abs, out_rel, _ = resolve_path_fn(workspace_root, out_rel)
    else:
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        out_rel = f"agente/reportes/{_slugify(title)}_{stamp}.pdf"
        out_abs, out_rel, _ = resolve_path_fn(workspace_root, out_rel)

    out_abs.parent.mkdir(parents=True, exist_ok=True)

    blocks, block_cover_override = _normalize_blocks_input(spec)
    cover_only = bool(spec.get("cover_only"))
    if _count_substantive_blocks(blocks) == 0 and not cover_only:
        raise ValueError(
            "El documento PDF no contiene bloques de contenido desarrollado (`blocks`, `sections` o `markdown`). "
            "No se puede generar solo una portada vacía; incluye los títulos, párrafos, listas, ejemplos o tablas del documento."
        )

    # Resolver configuración de portada
    raw_cover = spec.get("cover")
    ds_cover_cfg = (
        active_design_spec.get("cover")
        if active_design_spec and isinstance(active_design_spec.get("cover"), dict)
        else {}
    )
    top_cover_img = (
        spec.get("cover_image")
        or spec.get("coverImage")
        or spec.get("portada_imagen")
    )
    if isinstance(raw_cover, bool):
        cover_cfg: Dict[str, Any] = {**ds_cover_cfg, "enabled": raw_cover}
    elif isinstance(raw_cover, dict):
        cover_cfg = {**ds_cover_cfg, **raw_cover}
    elif isinstance(block_cover_override, dict):
        cover_cfg = {**ds_cover_cfg, **block_cover_override}
    elif ds_cover_cfg:
        cover_cfg = dict(ds_cover_cfg)
    else:
        cover_cfg = {}

    if top_cover_img and not cover_cfg.get("image_path"):
        cover_cfg["image_path"] = top_cover_img
        cover_cfg.setdefault("enabled", True)

    explicit_cover_disabled = (
        raw_cover is False
        or (isinstance(raw_cover, dict) and raw_cover.get("enabled") is False)
        or str(cover_cfg.get("layout") or "").strip().lower() == "none"
    )
    if explicit_cover_disabled:
        has_cover = False
    else:
        has_cover = bool(cover_cfg.get("enabled")) or bool(
            cover_cfg.get("image_path") or cover_cfg.get("image") or cover_cfg.get("path") or cover_cfg.get("logo_path")
        )
    cover_layout = str(cover_cfg.get("layout") or "auto").strip().lower()
    cover_layout = {
        "fullpage": "full_page",
        "full-page": "full_page",
        "clean": "full_page",
        "image_only": "full_page",
        "standalone": "full_page",
        "poster": "full_page",
        "portada_completa": "full_page",
        "completa": "full_page",
    }.get(cover_layout, cover_layout)
    if cover_layout == "none":
        has_cover = False

    # Si no pidieron portada explícitamente y es un documento corto sin portada,
    # usamos cabecera ejecutiva directa en página 1; si pidieron portada o cover_image, creamos portada dedicada.
    cover_img_raw = str(
        cover_cfg.get("image_path")
        or cover_cfg.get("image")
        or cover_cfg.get("path")
        or cover_cfg.get("logo_path")
        or ""
    ).strip()

    resolved_cover_pil: Optional[PILImage.Image] = None
    resolved_cover_abs: Optional[Path] = None
    images_embedded = 0

    if has_cover and cover_img_raw:
        try:
            c_abs, _ = _resolve_workspace_file_smart(workspace_root, cover_img_raw, resolve_path_fn)
            resolved_cover_abs = c_abs
            resolved_cover_pil = _load_pil_image(c_abs)
        except Exception as exc:
            warnings.append(f"Imagen de portada omitida ({cover_img_raw}): {exc}")
            resolved_cover_pil = None
            resolved_cover_abs = None
    elif has_cover and active_design_spec is not None:
        # Auto-usar cover.background_asset o cover.logo_asset resueltos desde la habilidad de diseño
        cover_bg_path = _resolve_design_asset_path(
            "cover_background_asset",
            cover_cfg.get("background_asset"),
            resolved_assets=resolved_assets,
            skill_dir=resolved_skill_dir,
            workspace_root=workspace_root,
            resolve_path_fn=resolve_path_fn,
        )
        cover_logo_path = _resolve_design_asset_path(
            "cover_logo_asset",
            cover_cfg.get("logo_asset"),
            resolved_assets=resolved_assets,
            skill_dir=resolved_skill_dir,
            workspace_root=workspace_root,
            resolve_path_fn=resolve_path_fn,
        )
        chosen_cover_asset = (
            cover_bg_path
            if (cover_bg_path and cover_layout in ("full_bleed", "full_page", "hero_top", "auto"))
            else (cover_logo_path or cover_bg_path)
        )
        if chosen_cover_asset is not None:
            try:
                resolved_cover_abs = chosen_cover_asset
                resolved_cover_pil = _load_pil_image(chosen_cover_asset)
                cover_img_raw = str(chosen_cover_asset.name)
            except Exception as exc:
                warnings.append(f"Asset de portada omitido ({chosen_cover_asset.name}): {exc}")

    overlay_text_requested = cover_cfg.get("overlay_text") is True
    if has_cover and cover_layout == "auto":
        if resolved_cover_pil is not None:
            w, h = resolved_cover_pil.size
            has_alpha = _image_has_transparency(resolved_cover_pil)
            aspect = w / float(max(1, h))
            if not overlay_text_requested and _image_looks_like_ready_cover(resolved_cover_pil, resolved_cover_abs):
                cover_layout = "full_page"
            elif has_alpha or (w < 650 and h < 650) or (0.75 <= aspect <= 1.35 and w < 900):
                cover_layout = "centered"
            elif aspect >= 1.25:
                cover_layout = "hero_top"
            else:
                cover_layout = "split"
        else:
            cover_layout = "minimal"
    elif (
        has_cover
        and cover_layout == "full_bleed"
        and resolved_cover_pil is not None
        and not overlay_text_requested
        and _image_looks_like_ready_cover(resolved_cover_pil, resolved_cover_abs)
    ):
        cover_layout = "full_page"

    # Estilos tipográficos (multi-familia cuando hay design_spec)
    typo_cfg = (
        active_design_spec.get("typography")
        if active_design_spec and isinstance(active_design_spec.get("typography"), dict)
        else {}
    )
    tbl_cfg = (
        active_design_spec.get("tables")
        if active_design_spec and isinstance(active_design_spec.get("tables"), dict)
        else {}
    )
    body_fonts = _resolve_font_set(str(typo_cfg.get("body_family") or "sans")) if active_design_spec else _resolve_font_set("sans")
    heading_fonts = _resolve_font_set(str(typo_cfg.get("heading_family") or "sans")) if active_design_spec else body_fonts
    mono_fonts = _resolve_font_set("mono")

    f_reg = body_fonts["regular"]
    f_bold = body_fonts["bold"]
    f_ital = body_fonts["italic"]
    h_bold = heading_fonts["bold"]
    f_mono = mono_fonts["regular"]

    col_text = _hex_to_rl_color(theme["text"], "#1E293B")
    col_heading = _hex_to_rl_color(theme["heading"], "#0F172A")
    col_muted = _hex_to_rl_color(theme["muted"], "#64748B")
    col_accent = _hex_to_rl_color(theme["accent"], "#2563EB")
    col_accent_dark = _hex_to_rl_color(theme.get("accent_dark"), theme["accent"])
    col_border = _hex_to_rl_color(theme["border"], "#CBD5E1")
    col_surface = _hex_to_rl_color(theme["surface"], "#F8FAFC")
    col_accent_soft = _hex_to_rl_color(theme["accent_soft"], "#EFF6FF")

    body_size = float(typo_cfg.get("body_size") or 10.0) if active_design_spec else 10.0
    body_leading = float(typo_cfg.get("body_leading") or max(body_size * 1.48, 13.5)) if active_design_spec else 14.8
    body_align = _map_align(typo_cfg.get("body_align") or "left") if active_design_spec else TA_LEFT
    body_space_after = float(typo_cfg.get("space_after") if typo_cfg.get("space_after") is not None else 7.0) if active_design_spec else 7.0

    def _heading_cfg(lvl_key: str, def_size: float, def_lead: float, def_col: str, def_dec: str) -> Dict[str, Any]:
        raw_h = typo_cfg.get(lvl_key) if active_design_spec and isinstance(typo_cfg.get(lvl_key), dict) else {}
        return {
            "size": float(raw_h.get("size") or def_size),
            "leading": float(raw_h.get("leading") or def_lead),
            "color": _hex_to_rl_color(raw_h.get("color"), def_col) if raw_h.get("color") else _hex_to_rl_color(def_col),
            "uppercase": bool(raw_h.get("uppercase", False)),
            "decoration": str(raw_h.get("decoration") or def_dec).strip().lower(),
            "align": _map_align(raw_h.get("align") or "left"),
        }

    h1_cfg = _heading_cfg("h1", 15.5, 20.0, theme["heading"], "underline" if not active_design_spec else "plain")
    h2_cfg = _heading_cfg("h2", 12.5, 16.5, theme["accent"], "plain")
    h3_cfg = _heading_cfg("h3", 10.8, 14.5, theme["heading"], "plain")
    heading_cfgs = {"h1": h1_cfg, "h2": h2_cfg, "h3": h3_cfg}

    tbl_font_size = float(tbl_cfg.get("font_size") or 8.8) if active_design_spec else 8.8
    tbl_head_fg_hex = _safe_hex_color(
        (tbl_cfg.get("header_fg") if active_design_spec else None) or theme["table_head_fg"],
        "#FFFFFF",
    )

    styles = {
        "h1": ParagraphStyle(
            "XookH1",
            fontName=h_bold,
            fontSize=h1_cfg["size"],
            leading=h1_cfg["leading"],
            textColor=h1_cfg["color"],
            alignment=h1_cfg["align"],
            spaceBefore=14,
            spaceAfter=6,
            keepWithNext=True,
        ),
        "h2": ParagraphStyle(
            "XookH2",
            fontName=h_bold,
            fontSize=h2_cfg["size"],
            leading=h2_cfg["leading"],
            textColor=h2_cfg["color"],
            alignment=h2_cfg["align"],
            spaceBefore=10,
            spaceAfter=4,
            keepWithNext=True,
        ),
        "h3": ParagraphStyle(
            "XookH3",
            fontName=h_bold,
            fontSize=h3_cfg["size"],
            leading=h3_cfg["leading"],
            textColor=h3_cfg["color"],
            alignment=h3_cfg["align"],
            spaceBefore=8,
            spaceAfter=3,
            keepWithNext=True,
        ),
        "body": ParagraphStyle(
            "XookBody",
            fontName=f_reg,
            fontSize=body_size,
            leading=body_leading,
            textColor=col_text,
            alignment=body_align,
            spaceAfter=body_space_after,
        ),
        "bullet": ParagraphStyle(
            "XookBullet",
            fontName=f_reg,
            fontSize=body_size,
            leading=max(body_size * 1.38, body_leading - 0.6),
            textColor=col_text,
            alignment=TA_JUSTIFY if body_align == TA_JUSTIFY else TA_LEFT,
            leftIndent=14,
            firstLineIndent=-10,
            spaceAfter=4,
        ),
        "caption": ParagraphStyle(
            "XookCaption",
            fontName=f_ital,
            fontSize=8.5,
            leading=11.5,
            textColor=col_muted,
            alignment=TA_CENTER,
            spaceBefore=4,
            spaceAfter=10,
        ),
        "tbl_head": ParagraphStyle(
            "XookTblHead",
            fontName=f_bold,
            fontSize=max(tbl_font_size, 8.8),
            leading=max(tbl_font_size * 1.33, 12.0),
            textColor=colors.HexColor(tbl_head_fg_hex),
        ),
        "tbl_head_dark": ParagraphStyle(
            "XookTblHeadDark",
            fontName=f_bold,
            fontSize=max(tbl_font_size, 8.8),
            leading=max(tbl_font_size * 1.33, 12.0),
            textColor=col_heading,
        ),
        "tbl_cell": ParagraphStyle(
            "XookTblCell",
            fontName=f_reg,
            fontSize=tbl_font_size,
            leading=max(tbl_font_size * 1.35, 11.5),
            textColor=col_text,
        ),
        "tbl_cell_right": ParagraphStyle(
            "XookTblCellRight",
            fontName=f_reg,
            fontSize=tbl_font_size,
            leading=max(tbl_font_size * 1.35, 11.5),
            textColor=col_text,
            alignment=TA_RIGHT,
        ),
        "tbl_cell_bold": ParagraphStyle(
            "XookTblCellBold",
            fontName=f_bold,
            fontSize=tbl_font_size,
            leading=max(tbl_font_size * 1.35, 11.5),
            textColor=col_heading,
        ),
        "tbl_cell_right_bold": ParagraphStyle(
            "XookTblCellRightBold",
            fontName=f_bold,
            fontSize=tbl_font_size,
            leading=max(tbl_font_size * 1.35, 11.5),
            textColor=col_heading,
            alignment=TA_RIGHT,
        ),
    }

    # Márgenes, columnas y borde de página
    if active_design_spec is not None:
        page_cfg = active_design_spec.get("page") if isinstance(active_design_spec.get("page"), dict) else {}
        margins_cfg = page_cfg.get("margins_pt") if isinstance(page_cfg.get("margins_pt"), dict) else {}
        margin_top = max(18.0, float(margins_cfg.get("top") or 58.0))
        margin_right = max(18.0, float(margins_cfg.get("right") or 56.0))
        margin_bottom = max(18.0, float(margins_cfg.get("bottom") or 52.0))
        margin_left = max(18.0, float(margins_cfg.get("left") or 56.0))
        if margin_left + margin_right > page_w - 120.0:
            margin_left = margin_right = max(24.0, (page_w - 120.0) / 2.0)
        if margin_top + margin_bottom > page_h - 120.0:
            margin_top = margin_bottom = max(24.0, (page_h - 120.0) / 2.0)
        margin_x = margin_left
        header_cfg_eff = active_design_spec.get("header") if isinstance(active_design_spec.get("header"), dict) else {}
        if bool(header_cfg_eff.get("enabled")) and header_cfg_eff.get("background_hex"):
            h_bar_h = float(header_cfg_eff.get("height_pt") or 28.0)
            margin_top = max(margin_top, h_bar_h + 10.0)
        num_page_cols = 2 if int(page_cfg.get("columns") or 1) >= 2 else 1
        col_gap_pt = max(6.0, min(60.0, float(page_cfg.get("column_gap_pt") or 18.0)))
        page_border_cfg = page_cfg.get("border") if isinstance(page_cfg.get("border"), dict) else {}
        page_bg_hex = _safe_hex_color(page_cfg.get("background_hex") or theme["page_bg"], "#FFFFFF")
    else:
        margin_x = 2.0 * cm
        margin_left = margin_x
        margin_right = margin_x
        margin_top = 2.05 * cm
        margin_bottom = 1.85 * cm
        num_page_cols = 1
        col_gap_pt = 18.0
        page_border_cfg = {}
        page_bg_hex = theme["page_bg"]

    usable_w = page_w - margin_left - margin_right
    usable_h = page_h - margin_top - margin_bottom
    content_flow_w = ((usable_w - col_gap_pt) / 2.0) if num_page_cols == 2 else usable_w

    # Cargar logo de encabezado si está configurado en design_spec
    keep_buffers: List[io.BytesIO] = []
    header_logo_reader: Optional[Tuple[ImageReader, int, int]] = None
    if active_design_spec is not None:
        header_cfg_for_logo = active_design_spec.get("header") if isinstance(active_design_spec.get("header"), dict) else {}
        if bool(header_cfg_for_logo.get("enabled")) and header_cfg_for_logo.get("logo_asset"):
            h_logo_path = _resolve_design_asset_path(
                "logo_asset",
                header_cfg_for_logo.get("logo_asset"),
                resolved_assets=resolved_assets,
                skill_dir=resolved_skill_dir,
                workspace_root=workspace_root,
                resolve_path_fn=resolve_path_fn,
            )
            if h_logo_path is not None:
                try:
                    h_pil = _load_pil_image(h_logo_path)
                    h_buf = _pil_to_png_buffer(h_pil, bg_hex=None)
                    keep_buffers.append(h_buf)
                    header_logo_reader = (ImageReader(h_buf), h_pil.size[0], h_pil.size[1])
                    images_embedded += 1
                except Exception as exc:
                    warnings.append(f"Logo de encabezado omitido ({h_logo_path.name}): {exc}")

    full_bleed_reader: Optional[ImageReader] = None
    full_page_reader: Optional[ImageReader] = None
    full_page_bg_hex = "#FFFFFF" if not theme["dark_page"] else theme["page_bg"]
    full_page_box = (0.0, 0.0, page_w, page_h)
    if has_cover and cover_layout == "full_page" and resolved_cover_pil is not None:
        fp_buf, full_page_bg_hex = _make_full_page_cover_buffer(resolved_cover_pil, full_page_bg_hex)
        full_page_reader = ImageReader(fp_buf)
        iw, ih = resolved_cover_pil.size
        scale = min(page_w / float(max(1, iw)), page_h / float(max(1, ih)))
        draw_w = iw * scale
        draw_h = ih * scale
        full_page_box = ((page_w - draw_w) * 0.5, (page_h - draw_h) * 0.5, draw_w, draw_h)
        images_embedded += 1
    elif has_cover and cover_layout == "full_bleed" and resolved_cover_pil is not None:
        fb_buf = _make_full_bleed_cover_buffer(resolved_cover_pil, page_w, page_h)
        full_bleed_reader = ImageReader(fb_buf)
        images_embedded += 1

    cover_top_band_enabled = (
        True
        if active_design_spec is None
        else (bool(cover_cfg.get("top_band", False)) or cover_layout == "band_top")
    )
    cover_top_band_h = (
        float(cover_cfg.get("top_band_height_pt") or (64.0 if cover_layout == "band_top" else 16.0))
        if active_design_spec is not None
        else (0.55 * cm)
    )
    if cover_layout == "band_top":
        cover_top_band_h = max(cover_top_band_h, 54.0)

    def _draw_page_border(canv: rl_canvas.Canvas) -> None:
        if not bool(page_border_cfg.get("enabled")):
            return
        b_col = _hex_to_rl_color(page_border_cfg.get("color"), theme["border"])
        b_w = max(0.25, min(8.0, float(page_border_cfg.get("width_pt") or 0.75)))
        b_inset = max(4.0, min(min(page_w, page_h) * 0.25, float(page_border_cfg.get("inset_pt") or 18.0)))
        canv.setStrokeColor(b_col)
        canv.setLineWidth(b_w)
        canv.rect(b_inset, b_inset, page_w - 2 * b_inset, page_h - 2 * b_inset, stroke=1, fill=0)

    def _draw_cover_bg(canv: rl_canvas.Canvas, _doc: BaseDocTemplate) -> None:
        canv.saveState()
        if full_page_reader is not None:
            canv.setFillColor(colors.HexColor(full_page_bg_hex))
            canv.rect(0, 0, page_w, page_h, stroke=0, fill=1)
            dx, dy, dw, dh = full_page_box
            canv.drawImage(full_page_reader, dx, dy, width=dw, height=dh, preserveAspectRatio=True)
            canv.restoreState()
            return
        if theme["dark_page"] or page_bg_hex.upper() != "#FFFFFF":
            canv.setFillColor(colors.HexColor(page_bg_hex))
            canv.rect(0, 0, page_w, page_h, stroke=0, fill=1)
        if full_bleed_reader is not None:
            canv.drawImage(full_bleed_reader, 0, 0, width=page_w, height=page_h, preserveAspectRatio=False)
        elif has_cover and cover_top_band_enabled:
            canv.setFillColor(col_accent_dark if cover_layout == "band_top" else col_accent)
            canv.rect(0, page_h - cover_top_band_h, page_w, cover_top_band_h, stroke=0, fill=1)
            if cover_layout == "band_top":
                canv.setFillColor(col_accent)
                canv.rect(0, page_h - cover_top_band_h - 3.0, page_w, 3.0, stroke=0, fill=1)
        if full_bleed_reader is None:
            _draw_page_border(canv)
        canv.restoreState()

    def _draw_content_bg(canv: rl_canvas.Canvas, _doc: BaseDocTemplate) -> None:
        needs_bg = theme["dark_page"] or page_bg_hex.upper() != "#FFFFFF"
        needs_border = bool(page_border_cfg.get("enabled"))
        if not needs_bg and not needs_border:
            return
        canv.saveState()
        if needs_bg:
            canv.setFillColor(colors.HexColor(page_bg_hex))
            canv.rect(0, 0, page_w, page_h, stroke=0, fill=1)
        if needs_border:
            _draw_page_border(canv)
        canv.restoreState()

    templates: List[PageTemplate] = []
    if has_cover:
        cover_margin_left = 2.2 * cm if cover_layout == "full_bleed" else margin_left
        cover_margin_right = 2.2 * cm if cover_layout == "full_bleed" else margin_right
        cover_margin_y = 2.0 * cm
        cover_frame = Frame(
            cover_margin_left,
            cover_margin_y,
            page_w - cover_margin_left - cover_margin_right,
            page_h - 2 * cover_margin_y,
            leftPadding=0,
            rightPadding=0,
            topPadding=0,
            bottomPadding=0,
            id="cover_frame",
        )
        templates.append(PageTemplate(id="Cover", frames=[cover_frame], onPage=_draw_cover_bg))

    if num_page_cols == 2:
        col_w = (usable_w - col_gap_pt) / 2.0
        content_frames = [
            Frame(
                margin_left,
                margin_bottom,
                col_w,
                usable_h,
                leftPadding=0,
                rightPadding=0,
                topPadding=0,
                bottomPadding=0,
                id="content_col_1",
            ),
            Frame(
                margin_left + col_w + col_gap_pt,
                margin_bottom,
                col_w,
                usable_h,
                leftPadding=0,
                rightPadding=0,
                topPadding=0,
                bottomPadding=0,
                id="content_col_2",
            ),
        ]
    else:
        content_frames = [
            Frame(
                margin_left,
                margin_bottom,
                usable_w,
                usable_h,
                leftPadding=0,
                rightPadding=0,
                topPadding=0,
                bottomPadding=0,
                id="content_frame",
            )
        ]
    templates.append(PageTemplate(id="Content", frames=content_frames, onPage=_draw_content_bg))

    tmp_out = out_abs.with_name(f".{out_abs.name}.tmp.{os.getpid()}_{int(time.time() * 1000)}")
    doc_creator = _sanitize_text_for_pdf(
        str(spec.get("creator") or ("XOOK PDF Engine" if wm_enabled else (author or "")))
    ).strip()
    doc_producer = _sanitize_text_for_pdf(
        str(spec.get("producer") or ("XOOK PDF Engine" if wm_enabled else (author or "")))
    ).strip()

    doc = BaseDocTemplate(
        str(tmp_out),
        pagesize=pagesize,
        pageTemplates=templates,
        title=title,
        author=author or "",
        creator=doc_creator,
        producer=doc_producer,
    )

    story: List[Any] = []

    def _make_rl_image(
        pil_img: PILImage.Image,
        max_w: float,
        max_h: float,
        *,
        align: str = "CENTER",
    ) -> RLImage:
        buf = _pil_to_png_buffer(pil_img, bg_hex=theme["page_bg"] if pil_img.mode == "RGBA" else None)
        keep_buffers.append(buf)
        pw, ph = pil_img.size
        scale = min(max_w / float(max(1, pw)), max_h / float(max(1, ph)))
        draw_w = max(24.0, pw * scale)
        draw_h = max(24.0, ph * scale)
        img_flow = RLImage(buf, width=draw_w, height=draw_h)
        img_flow.hAlign = align.upper() if align.upper() in ("LEFT", "CENTER", "RIGHT") else "CENTER"
        return img_flow

    # 1) Construir portada o cabecera inicial
    badge_txt = _sanitize_text_for_pdf(
        cover_cfg.get("eyebrow") or cover_cfg.get("badge") or cover_cfg.get("kicker") or ""
    ).strip()

    def _compact_preview_blocks(raw_blks: List[Dict[str, Any]], limit: int = 24) -> List[Dict[str, Any]]:
        out_blks: List[Dict[str, Any]] = []
        for item in raw_blks[:limit]:
            bt = str(item.get("type") or "").lower()
            entry: Dict[str, Any] = {"type": bt}
            if bt == "heading":
                entry["level"] = int(item.get("level") or 1)
                entry["text"] = str(item.get("text") or item.get("title") or "")[:160]
            elif bt in ("paragraph", "callout", "summary", "quote"):
                if item.get("title"):
                    entry["title"] = str(item.get("title"))[:120]
                if item.get("tone"):
                    entry["tone"] = str(item.get("tone"))[:24]
                entry["text"] = str(item.get("text") or item.get("content") or "")[:240]
            elif bt in ("bullets", "bullet_list", "unordered_list", "ul", "list", "numbered_list", "ordered_list", "ol"):
                ordered = bool(item.get("ordered")) or bt in ("numbered_list", "ordered_list", "ol")
                entry["type"] = "numbered_list" if ordered else "bullet_list"
                items = item.get("items") or []
                entry["items"] = [str(x)[:110] for x in items[:5]]
                entry["total_items"] = len(items)
            elif bt in ("code", "code_block", "pre"):
                entry["type"] = "code"
                entry["language"] = str(item.get("language") or item.get("lang") or "")[:30]
                entry["text"] = str(item.get("code") or item.get("text") or item.get("content") or "")[:320]
            elif bt == "table":
                cols = item.get("headers") or item.get("columns") or []
                rows = item.get("rows") or []
                entry["columns"] = [str(c)[:40] for c in cols[:6]]
                entry["rows"] = [[str(c)[:40] for c in r[:6]] for r in rows[:4] if isinstance(r, list)]
                entry["total_rows"] = len(rows)
            elif bt == "image":
                entry["path"] = str(item.get("path") or item.get("image_path") or item.get("src") or "")
                entry["caption"] = str(item.get("caption") or "")[:100]
            elif bt == "kpi_strip":
                cards = item.get("metrics") or item.get("items") or []
                entry["metrics"] = [
                    {"label": str(c.get("label") or "")[:40], "value": str(c.get("value") or "")[:40]}
                    for c in cards[:4] if isinstance(c, dict)
                ]
            elif bt in ("kv_grid", "header_band"):
                kv_items = item.get("items") or []
                if item.get("title"):
                    entry["title"] = str(item.get("title"))[:100]
                entry["items"] = [
                    {"label": str(c.get("label") or "")[:40], "value": str(c.get("value") or "")[:60]}
                    for c in (kv_items[:6] if isinstance(kv_items, list) else [])
                    if isinstance(c, dict)
                ]
            elif bt == "columns":
                raw_cols = item.get("columns") or []
                entry["column_count"] = len(raw_cols) if isinstance(raw_cols, list) else 0
                entry["columns"] = [
                    _compact_preview_blocks(c, limit=6) for c in raw_cols[:3] if isinstance(c, list)
                ]
            elif bt in ("signature_block", "signatures"):
                signers = item.get("signers") or item.get("items") or []
                entry["signers"] = [
                    {"name": str(s.get("name") or "")[:60], "role": str(s.get("role") or "")[:60]}
                    for s in (signers[:4] if isinstance(signers, list) else [])
                    if isinstance(s, dict)
                ]
            elif bt in ("box", "panel", "card"):
                if item.get("title"):
                    entry["title"] = str(item.get("title"))[:100]
                if item.get("text"):
                    entry["text"] = str(item.get("text"))[:200]
                if isinstance(item.get("blocks"), list):
                    entry["blocks"] = _compact_preview_blocks(item["blocks"], limit=6)
            out_blks.append(entry)
        return out_blks

    def _emit_progress(stage: str, label: str, progress: float, **extra: Any) -> None:
        if not progress_callback:
            return
        payload: Dict[str, Any] = {
            "stage": stage,
            "step_label": label,
            "progress": round(min(1.0, max(0.0, progress)), 3),
            "title": title,
            "subtitle": subtitle,
            "theme": theme_name,
            "author": author,
            "date": date_label,
            "has_cover": has_cover,
            "cover": {
                "enabled": has_cover,
                "layout": cover_layout if has_cover else "none",
                "eyebrow": badge_txt,
                "image_path": cover_img_raw,
                "footer_note": str(cover_cfg.get("footer_note") or "").strip(),
            } if has_cover else None,
        }
        payload.update(extra)
        try:
            progress_callback(payload)
        except Exception:
            pass

    preview_blocks_cache = _compact_preview_blocks(blocks)
    _emit_progress(
        "building_cover" if has_cover else "preparing",
        "Diseñando portada del documento..." if has_cover else "Preparando tipografía y estructura...",
        0.28 if has_cover else 0.22,
        total_blocks=len(blocks),
        completed_blocks=0,
        blocks=preview_blocks_cache,
    )
    if has_cover:
        cover_usable_w = page_w - (4.4 * cm if cover_layout == "full_bleed" else (margin_left + margin_right))
        cover_fg = colors.white if cover_layout == "full_bleed" else col_heading
        cover_sub_fg = colors.HexColor("#E2E8F0") if cover_layout == "full_bleed" else col_muted
        cover_badge_fg = colors.HexColor("#7DD3FC") if cover_layout == "full_bleed" else col_accent
        cov_centered = cover_layout in ("centered", "academic_centered")

        s_badge = ParagraphStyle(
            "CovBadge",
            fontName=h_bold,
            fontSize=9.5,
            leading=13,
            textColor=cover_badge_fg,
            alignment=TA_CENTER if cov_centered else TA_LEFT,
            spaceAfter=8,
        )
        s_cov_title = ParagraphStyle(
            "CovTitle",
            fontName=h_bold,
            fontSize=28 if len(title) <= 45 else 23,
            leading=33 if len(title) <= 45 else 28,
            textColor=cover_fg,
            alignment=TA_CENTER if cov_centered else TA_LEFT,
            spaceAfter=12,
        )
        s_cov_sub = ParagraphStyle(
            "CovSub",
            fontName=f_reg,
            fontSize=13,
            leading=18.5,
            textColor=cover_sub_fg,
            alignment=TA_CENTER if cov_centered else TA_LEFT,
            spaceAfter=16,
        )
        s_cov_meta = ParagraphStyle(
            "CovMeta",
            fontName=f_reg,
            fontSize=10,
            leading=15,
            textColor=cover_sub_fg,
            alignment=TA_CENTER if cov_centered else TA_LEFT,
        )

        meta_parts = [p for p in [author, date_label] if p]
        meta_line = "  ·  ".join(meta_parts)

        if cover_layout == "full_page" and full_page_reader is not None:
            story.append(Spacer(1, 0.2 * cm))
        elif cover_layout == "full_bleed":
            story.append(Spacer(1, page_h * 0.44))
            if badge_txt:
                story.append(Paragraph(_inline_md_to_rl_xml(badge_txt.upper(), f_mono), s_badge))
            story.append(Paragraph(_inline_md_to_rl_xml(title, f_mono), s_cov_title))
            if subtitle:
                story.append(Paragraph(_inline_md_to_rl_xml(subtitle, f_mono), s_cov_sub))
            story.append(HRFlowable(width=3.2 * cm, thickness=2.5, color=colors.HexColor("#38BDF8"), hAlign="LEFT", spaceAfter=14))
            if meta_line:
                story.append(Paragraph(_inline_md_to_rl_xml(meta_line, f_mono), s_cov_meta))

        elif cover_layout == "academic_centered":
            story.append(Spacer(1, 1.4 * cm))
            if resolved_cover_pil is not None:
                c_img = _make_rl_image(resolved_cover_pil, cover_usable_w * 0.42, page_h * 0.18, align="CENTER")
                images_embedded += 1
                story.append(c_img)
                story.append(Spacer(1, 1.0 * cm))
            if badge_txt:
                story.append(Paragraph(_inline_md_to_rl_xml(badge_txt.upper(), f_mono), s_badge))
                story.append(Spacer(1, 0.6 * cm))
            story.append(Spacer(1, 1.6 * cm))
            story.append(Paragraph(_inline_md_to_rl_xml(title, f_mono), s_cov_title))
            if subtitle:
                story.append(Paragraph(_inline_md_to_rl_xml(subtitle, f_mono), s_cov_sub))
            story.append(HRFlowable(width=4.5 * cm, thickness=1.2, color=col_accent, hAlign="CENTER", spaceBefore=6, spaceAfter=18))
            if author:
                story.append(
                    Paragraph(
                        _inline_md_to_rl_xml(author, f_mono),
                        ParagraphStyle("CovAcadAuthor", parent=s_cov_meta, fontName=f_bold, textColor=col_heading, spaceAfter=6),
                    )
                )
            if date_label:
                story.append(Spacer(1, 2.2 * cm))
                story.append(Paragraph(_inline_md_to_rl_xml(date_label, f_mono), s_cov_meta))

        elif cover_layout == "band_top":
            top_clear = max(0.8 * cm, cover_top_band_h - 1.6 * cm + 24.0)
            story.append(Spacer(1, top_clear))
            if resolved_cover_pil is not None:
                c_img = _make_rl_image(resolved_cover_pil, cover_usable_w * 0.46, page_h * 0.22, align="LEFT")
                images_embedded += 1
                story.append(c_img)
                story.append(Spacer(1, 0.9 * cm))
            if badge_txt:
                story.append(Paragraph(_inline_md_to_rl_xml(badge_txt.upper(), f_mono), s_badge))
            story.append(Paragraph(_inline_md_to_rl_xml(title, f_mono), s_cov_title))
            if subtitle:
                story.append(Paragraph(_inline_md_to_rl_xml(subtitle, f_mono), s_cov_sub))
            story.append(HRFlowable(width=3.8 * cm, thickness=2.5, color=col_accent, hAlign="LEFT", spaceAfter=14))
            if meta_line:
                story.append(Paragraph(_inline_md_to_rl_xml(meta_line, f_mono), s_cov_meta))

        elif cover_layout == "hero_top" and resolved_cover_pil is not None:
            story.append(Spacer(1, 0.3 * cm))
            hero_img = _make_rl_image(resolved_cover_pil, cover_usable_w, page_h * 0.43, align="CENTER")
            images_embedded += 1
            story.append(hero_img)
            if cover_cfg.get("caption"):
                story.append(Paragraph(_inline_md_to_rl_xml(cover_cfg["caption"], f_mono), styles["caption"]))
            else:
                story.append(Spacer(1, 1.0 * cm))
            if badge_txt:
                story.append(Paragraph(_inline_md_to_rl_xml(badge_txt.upper(), f_mono), s_badge))
            story.append(Paragraph(_inline_md_to_rl_xml(title, f_mono), s_cov_title))
            if subtitle:
                story.append(Paragraph(_inline_md_to_rl_xml(subtitle, f_mono), s_cov_sub))
            story.append(HRFlowable(width=3.5 * cm, thickness=2.5, color=col_accent, hAlign="LEFT", spaceAfter=14))
            if meta_line:
                story.append(Paragraph(_inline_md_to_rl_xml(meta_line, f_mono), s_cov_meta))

        elif cover_layout == "split" and resolved_cover_pil is not None:
            story.append(Spacer(1, 2.2 * cm))
            left_flow: List[Any] = []
            if badge_txt:
                left_flow.append(Paragraph(_inline_md_to_rl_xml(badge_txt.upper(), f_mono), s_badge))
            left_flow.append(Paragraph(_inline_md_to_rl_xml(title, f_mono), s_cov_title))
            if subtitle:
                left_flow.append(Paragraph(_inline_md_to_rl_xml(subtitle, f_mono), s_cov_sub))
            left_flow.append(HRFlowable(width=2.8 * cm, thickness=2.5, color=col_accent, hAlign="LEFT", spaceAfter=12))
            if meta_line:
                left_flow.append(Paragraph(_inline_md_to_rl_xml(meta_line, f_mono), s_cov_meta))

            right_w = cover_usable_w * 0.44
            right_img = _make_rl_image(resolved_cover_pil, right_w - 0.3 * cm, page_h * 0.56, align="CENTER")
            images_embedded += 1
            split_tbl = Table(
                [[left_flow, right_img]],
                colWidths=[cover_usable_w * 0.56, right_w],
            )
            split_tbl.setStyle(TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (0, 0), 0),
                ("RIGHTPADDING", (0, 0), (0, 0), 14),
                ("LEFTPADDING", (1, 0), (1, 0), 8),
                ("RIGHTPADDING", (1, 0), (1, 0), 0),
            ]))
            story.append(split_tbl)

        else:
            # "centered" o "minimal"
            story.append(Spacer(1, 2.0 * cm if resolved_cover_pil else 3.2 * cm))
            if resolved_cover_pil is not None:
                c_img = _make_rl_image(resolved_cover_pil, cover_usable_w * 0.62, page_h * 0.32, align="CENTER")
                images_embedded += 1
                story.append(c_img)
                story.append(Spacer(1, 1.1 * cm))
            if badge_txt:
                story.append(Paragraph(_inline_md_to_rl_xml(badge_txt.upper(), f_mono), s_badge))
            story.append(Paragraph(_inline_md_to_rl_xml(title, f_mono), s_cov_title))
            if subtitle:
                story.append(Paragraph(_inline_md_to_rl_xml(subtitle, f_mono), s_cov_sub))
            story.append(
                HRFlowable(
                    width=3.2 * cm,
                    thickness=2.5,
                    color=col_accent,
                    hAlign="CENTER" if cover_layout == "centered" else "LEFT",
                    spaceAfter=16,
                )
            )
            if meta_line:
                story.append(Paragraph(_inline_md_to_rl_xml(meta_line, f_mono), s_cov_meta))

        if cover_cfg.get("footer_note") and cover_layout != "full_page":
            story.append(Spacer(1, 1.2 * cm))
            story.append(Paragraph(_inline_md_to_rl_xml(cover_cfg["footer_note"], f_mono), s_cov_meta))

        if blocks or not cover_only:
            story.append(NextPageTemplate("Content"))
            story.append(PageBreak())
    elif not spec.get("skip_inline_title"):
        inline_align = h1_cfg["align"] if (active_design_spec and h1_cfg["align"] == TA_CENTER) else TA_LEFT
        s_doc_title = ParagraphStyle(
            "DocTitle",
            fontName=h_bold,
            fontSize=20,
            leading=24.5,
            textColor=col_heading,
            alignment=inline_align,
            spaceAfter=4,
        )
        s_doc_sub = ParagraphStyle(
            "DocSub",
            fontName=f_reg,
            fontSize=11,
            leading=15,
            textColor=col_muted,
            alignment=inline_align,
            spaceAfter=6,
        )
        s_doc_meta = ParagraphStyle(
            "DocMeta",
            fontName=f_reg,
            fontSize=8.5,
            leading=12,
            textColor=col_muted,
            alignment=inline_align,
        )
        story.append(Paragraph(_inline_md_to_rl_xml(title, f_mono), s_doc_title))
        if subtitle:
            story.append(Paragraph(_inline_md_to_rl_xml(subtitle, f_mono), s_doc_sub))
        meta_parts = [p for p in [author, date_label] if p]
        if meta_parts:
            story.append(Paragraph(_inline_md_to_rl_xml(" · ".join(meta_parts), f_mono), s_doc_meta))
        story.append(Spacer(1, 6))
        story.append(HRFlowable(width="100%", thickness=1.5, color=col_accent, spaceAfter=14))

    # 2) Construir bloques de contenido (recursivo para soportar `columns`, `box` y páginas de 2 columnas)
    tables_count = 0
    total_blocks = len(blocks)

    def _render_blocks_to_flowables(
        block_list: List[Dict[str, Any]],
        avail_w: float,
        *,
        emit_progress_events: bool = False,
        depth: int = 0,
    ) -> List[Any]:
        nonlocal images_embedded, tables_count
        flow: List[Any] = []
        n_blks = len(block_list)
        for blk_idx, blk in enumerate(block_list):
            if not isinstance(blk, dict):
                continue
            btype = str(blk.get("type") or "").lower()
            if emit_progress_events and n_blks > 0 and (
                blk_idx == n_blks - 1
                or btype in ("heading", "table", "image", "kpi_strip", "columns", "kv_grid", "header_band")
                or blk_idx % 4 == 0
            ):
                frac = (blk_idx + 1) / float(max(1, n_blks))
                _emit_progress(
                    "building_blocks",
                    f"Maquetando contenido ({blk_idx + 1}/{n_blks})...",
                    0.34 + 0.44 * frac,
                    total_blocks=n_blks,
                    completed_blocks=blk_idx + 1,
                    blocks=preview_blocks_cache,
                )

            if btype == "heading":
                lvl = int(blk.get("level") or 1)
                txt = _sanitize_text_for_pdf(blk.get("text") or blk.get("title") or "").strip()
                if not txt:
                    continue
                style_key = "h1" if lvl <= 1 else ("h2" if lvl == 2 else "h3")
                h_meta = heading_cfgs[style_key]
                display_txt = txt.upper() if h_meta["uppercase"] else txt
                dec = h_meta["decoration"]

                if dec == "left_bar":
                    inner_st = ParagraphStyle(
                        f"XookHBar_{style_key}",
                        parent=styles[style_key],
                        spaceBefore=0,
                        spaceAfter=0,
                    )
                    bar_tbl = Table([[Paragraph(_inline_md_to_rl_xml(display_txt, f_mono), inner_st)]], colWidths=[avail_w])
                    bar_tbl.setStyle(TableStyle([
                        ("LINEBEFORE", (0, 0), (0, -1), 3.0, col_accent),
                        ("LEFTPADDING", (0, 0), (-1, -1), 8),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                        ("TOPPADDING", (0, 0), (-1, -1), 2),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                    ]))
                    flow.append(Spacer(1, styles[style_key].spaceBefore))
                    flow.append(bar_tbl)
                    flow.append(Spacer(1, styles[style_key].spaceAfter))
                elif dec == "band":
                    inner_st = ParagraphStyle(
                        f"XookHBand_{style_key}",
                        parent=styles[style_key],
                        spaceBefore=0,
                        spaceAfter=0,
                    )
                    band_tbl = Table([[Paragraph(_inline_md_to_rl_xml(display_txt, f_mono), inner_st)]], colWidths=[avail_w])
                    band_tbl.setStyle(TableStyle([
                        ("BACKGROUND", (0, 0), (-1, -1), col_accent_soft),
                        ("LINEBEFORE", (0, 0), (0, -1), 2.5, col_accent),
                        ("LEFTPADDING", (0, 0), (-1, -1), 9),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                        ("TOPPADDING", (0, 0), (-1, -1), 5),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                    ]))
                    flow.append(Spacer(1, styles[style_key].spaceBefore))
                    flow.append(band_tbl)
                    flow.append(Spacer(1, styles[style_key].spaceAfter))
                elif dec == "underline":
                    flow.append(Paragraph(_inline_md_to_rl_xml(display_txt, f_mono), styles[style_key]))
                    rule_col = col_border if (active_design_spec is None or style_key != "h1") else col_accent
                    flow.append(HRFlowable(width="100%", thickness=0.6 if active_design_spec is None else 0.85, color=rule_col, spaceBefore=0, spaceAfter=6))
                else:
                    # plain / none: sin línea decorativa
                    flow.append(Paragraph(_inline_md_to_rl_xml(display_txt, f_mono), styles[style_key]))

            elif btype == "paragraph":
                txt = _sanitize_text_for_pdf(blk.get("text") or blk.get("content") or "").strip()
                if txt:
                    flow.append(Paragraph(_inline_md_to_rl_xml(txt, f_mono), styles["body"]))

            elif btype in ("bullets", "bullet_list", "unordered_list", "ul", "list", "numbered_list", "ordered_list", "ol"):
                items = blk.get("items") or []
                if not isinstance(items, list):
                    continue
                ordered = bool(blk.get("ordered")) or btype in ("numbered_list", "ordered_list", "ol")
                for idx, item in enumerate(items, start=1):
                    item_txt = _sanitize_text_for_pdf(item).strip()
                    if not item_txt:
                        continue
                    prefix = f"{idx}." if ordered else "•"
                    bullet_xml = f'<font color="{theme["accent"]}"><b>{xml_escape(prefix)}</b></font>  {_inline_md_to_rl_xml(item_txt, f_mono)}'
                    flow.append(Paragraph(bullet_xml, styles["bullet"]))
                flow.append(Spacer(1, 4))

            elif btype == "table":
                headers = blk.get("headers") or blk.get("columns") or []
                rows = blk.get("rows") or []
                if not isinstance(headers, list) or not headers:
                    continue
                clean_headers = [_sanitize_text_for_pdf(h).strip() or f"Col {i+1}" for i, h in enumerate(headers)]
                num_cols = len(clean_headers)

                normalized_rows: List[List[str]] = []
                for r in rows if isinstance(rows, list) else []:
                    if isinstance(r, dict):
                        row_vals = [_sanitize_text_for_pdf(r.get(h, "")) for h in clean_headers]
                    elif isinstance(r, list):
                        row_vals = [_sanitize_text_for_pdf(r[i] if i < len(r) else "") for i in range(num_cols)]
                    else:
                        continue
                    normalized_rows.append(row_vals)

                if not normalized_rows:
                    continue

                numeric_cols = set()
                num_re = re.compile(r"^\s*[$€£]?\s*-?[\d.,]+\s*(?:%|mxn|usd|eur|un\.?|d[ií]as?)?\s*$", re.IGNORECASE)
                for c_idx in range(num_cols):
                    vals = [row[c_idx].strip() for row in normalized_rows if row[c_idx].strip()]
                    if vals and all(num_re.match(v) for v in vals):
                        numeric_cols.add(c_idx)

                # Anchos explícitos por tabla (`col_widths`) o proporcionales al contenido
                custom_ratios = blk.get("col_widths")
                if (
                    isinstance(custom_ratios, list)
                    and len(custom_ratios) == num_cols
                    and all(isinstance(x, (int, float)) and float(x) > 0 for x in custom_ratios)
                ):
                    total_r = sum(float(x) for x in custom_ratios)
                    col_widths = [avail_w * (float(x) / total_r) for x in custom_ratios]
                else:
                    col_weights: List[float] = []
                    for c_idx in range(num_cols):
                        sample_lens = [len(clean_headers[c_idx])] + [min(42, len(r[c_idx])) for r in normalized_rows[:20]]
                        avg_len = max(6.0, float(max(sample_lens)))
                        col_weights.append(avg_len)
                    total_weight = sum(col_weights) or float(num_cols)
                    col_widths = [max(avail_w * 0.08, avail_w * (w / total_weight)) for w in col_weights]
                    sum_w = sum(col_widths)
                    col_widths = [w * (avail_w / sum_w) for w in col_widths]

                t_style_name = str(
                    blk.get("style")
                    or (tbl_cfg.get("style") if active_design_spec else "striped")
                    or "striped"
                ).strip().lower()
                pad_v = max(2.0, min(16.0, float(tbl_cfg.get("cell_padding_v") or 5.5))) if active_design_spec else 5.5
                pad_h = max(2.0, min(18.0, float(tbl_cfg.get("cell_padding_h") or 7.0))) if active_design_spec else 7.0
                t_head_bg = _hex_to_rl_color(tbl_cfg.get("header_bg") if active_design_spec else None, theme["table_head_bg"])
                t_alt_bg = _hex_to_rl_color(tbl_cfg.get("alt_row_bg") if active_design_spec else None, theme["table_alt"])
                t_border = _hex_to_rl_color(tbl_cfg.get("border_color") if active_design_spec else None, theme["border"])

                use_dark_header_text = (
                    t_style_name == "minimal_rules"
                    or (t_style_name == "clean" and not (active_design_spec and tbl_cfg.get("header_bg")))
                )
                head_para_style = styles["tbl_head_dark"] if use_dark_header_text else styles["tbl_head"]

                highlight_last = bool(blk.get("highlight_last_row") or blk.get("totals_row"))
                table_data: List[List[Any]] = [
                    [Paragraph(_inline_md_to_rl_xml(h, f_mono), head_para_style) for h in clean_headers]
                ]
                last_row_idx = len(normalized_rows) - 1
                for r_i, r in enumerate(normalized_rows):
                    is_tot = highlight_last and r_i == last_row_idx
                    row_cells = []
                    for c_idx, cell_val in enumerate(r):
                        if is_tot:
                            st = styles["tbl_cell_right_bold"] if c_idx in numeric_cols else styles["tbl_cell_bold"]
                        else:
                            st = styles["tbl_cell_right"] if c_idx in numeric_cols else styles["tbl_cell"]
                        row_cells.append(Paragraph(_inline_md_to_rl_xml(cell_val or "—", f_mono), st))
                    table_data.append(row_cells)

                tbl = Table(table_data, colWidths=col_widths, repeatRows=1)
                tbl_style: List[Any] = [
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("TOPPADDING", (0, 0), (-1, 0), pad_v + 1.5),
                    ("BOTTOMPADDING", (0, 0), (-1, 0), pad_v + 1.5),
                    ("TOPPADDING", (0, 1), (-1, -1), pad_v),
                    ("BOTTOMPADDING", (0, 1), (-1, -1), pad_v),
                    ("LEFTPADDING", (0, 0), (-1, -1), pad_h),
                    ("RIGHTPADDING", (0, 0), (-1, -1), pad_h),
                ]

                if t_style_name == "minimal_rules":
                    tbl_style.extend([
                        ("LINEABOVE", (0, 0), (-1, 0), 1.2, col_heading),
                        ("LINEBELOW", (0, 0), (-1, 0), 0.85, col_heading),
                        ("LINEBELOW", (0, 1), (-1, -2), 0.3, t_border),
                        ("LINEBELOW", (0, -1), (-1, -1), 1.1, col_heading),
                    ])
                elif t_style_name == "bordered":
                    tbl_style.extend([
                        ("BACKGROUND", (0, 0), (-1, 0), t_head_bg),
                        ("BOX", (0, 0), (-1, -1), 0.85, t_border),
                        ("INNERGRID", (0, 0), (-1, -1), 0.55, t_border),
                        ("LINEBELOW", (0, 0), (-1, 0), 1.0, col_accent),
                    ])
                    for r_idx in range(1, len(table_data)):
                        if r_idx % 2 == 0:
                            tbl_style.append(("BACKGROUND", (0, r_idx), (-1, r_idx), t_alt_bg))
                elif t_style_name == "clean":
                    clean_head_bg = t_head_bg if (active_design_spec and tbl_cfg.get("header_bg")) else col_surface
                    tbl_style.extend([
                        ("BACKGROUND", (0, 0), (-1, 0), clean_head_bg),
                        ("LINEBELOW", (0, 0), (-1, 0), 0.9, col_border),
                        ("LINEBELOW", (0, 1), (-1, -1), 0.4, t_border),
                    ])
                elif t_style_name == "invoice":
                    tbl_style.extend([
                        ("BACKGROUND", (0, 0), (-1, 0), t_head_bg),
                        ("LINEBELOW", (0, 0), (-1, 0), 1.2, col_accent),
                        ("LINEBELOW", (0, 1), (-1, -2), 0.45, t_border),
                        ("LINEBELOW", (0, -1), (-1, -1), 1.2, col_accent),
                    ])
                    for r_idx in range(1, len(table_data)):
                        if r_idx % 2 == 0 and not (highlight_last and r_idx == len(table_data) - 1):
                            tbl_style.append(("BACKGROUND", (0, r_idx), (-1, r_idx), t_alt_bg))
                else:
                    # "striped" (predeterminado / legacy)
                    tbl_style.extend([
                        ("BACKGROUND", (0, 0), (-1, 0), t_head_bg),
                        ("LINEBELOW", (0, 0), (-1, 0), 1.0, col_accent),
                        ("LINEBELOW", (0, 1), (-1, -1), 0.4, t_border),
                        ("BOX", (0, 0), (-1, -1), 0.5, t_border),
                    ])
                    for r_idx in range(1, len(table_data)):
                        if r_idx % 2 == 0:
                            tbl_style.append(("BACKGROUND", (0, r_idx), (-1, r_idx), t_alt_bg))
                        elif theme["dark_page"]:
                            tbl_style.append(("BACKGROUND", (0, r_idx), (-1, r_idx), col_surface))

                if highlight_last and len(table_data) >= 2:
                    tbl_style.extend([
                        ("LINEABOVE", (0, -1), (-1, -1), 1.2, col_accent),
                        ("BACKGROUND", (0, -1), (-1, -1), col_accent_soft),
                    ])

                tbl.setStyle(TableStyle(tbl_style))

                caption_txt = _sanitize_text_for_pdf(blk.get("caption") or "").strip()
                flow.append(Spacer(1, 4))
                flow.append(tbl)
                if caption_txt:
                    flow.append(Paragraph(_inline_md_to_rl_xml(caption_txt, f_mono), styles["caption"]))
                else:
                    flow.append(Spacer(1, 10))
                tables_count += 1

            elif btype == "columns" and depth < 3:
                raw_cols = blk.get("columns") or blk.get("cols") or []
                if not isinstance(raw_cols, list) or not raw_cols:
                    continue
                cols_sliced = raw_cols[:3]
                n_cols = len(cols_sliced)
                if n_cols == 1 and isinstance(cols_sliced[0], list):
                    flow.extend(_render_blocks_to_flowables(cols_sliced[0], avail_w, depth=depth + 1))
                    continue

                raw_w = blk.get("widths")
                if (
                    isinstance(raw_w, list)
                    and len(raw_w) == n_cols
                    and all(isinstance(x, (int, float)) and float(x) > 0 for x in raw_w)
                ):
                    tot_w = sum(float(x) for x in raw_w)
                    ratios = [float(x) / tot_w for x in raw_w]
                else:
                    ratios = [1.0 / float(n_cols)] * n_cols

                gap_pt = max(6.0, min(32.0, float(blk.get("gap_pt") or 12.0)))
                col_widths_c = [avail_w * r for r in ratios]
                col_cells: List[Any] = []
                col_style: List[Any] = [
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("TOPPADDING", (0, 0), (-1, -1), 0),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                ]
                for c_idx, c_blocks in enumerate(cols_sliced):
                    l_pad = 0.0 if c_idx == 0 else gap_pt / 2.0
                    r_pad = 0.0 if c_idx == n_cols - 1 else gap_pt / 2.0
                    col_style.append(("LEFTPADDING", (c_idx, 0), (c_idx, 0), l_pad))
                    col_style.append(("RIGHTPADDING", (c_idx, 0), (c_idx, 0), r_pad))
                    inner_w = max(48.0, col_widths_c[c_idx] - l_pad - r_pad)
                    c_list = c_blocks if isinstance(c_blocks, list) else []
                    rendered_col = _render_blocks_to_flowables(c_list, inner_w, depth=depth + 1)
                    col_cells.append(rendered_col if rendered_col else [Spacer(1, 1)])

                cols_tbl = Table([col_cells], colWidths=col_widths_c)
                cols_tbl.setStyle(TableStyle(col_style))
                flow.append(Spacer(1, 4))
                flow.append(cols_tbl)
                flow.append(Spacer(1, 8))

            elif btype in ("kv_grid", "header_band"):
                raw_items = blk.get("items") or []
                if isinstance(raw_items, dict):
                    kv_items = [{"label": str(k), "value": str(v)} for k, v in raw_items.items()]
                elif isinstance(raw_items, list):
                    kv_items = [it for it in raw_items if isinstance(it, dict)]
                else:
                    kv_items = []
                kv_title = _sanitize_text_for_pdf(blk.get("title") or "").strip()
                if not kv_items and not kv_title:
                    continue

                n_kv_cols = max(1, min(4, int(blk.get("columns") or 2)))
                if avail_w < 260.0:
                    n_kv_cols = min(n_kv_cols, 2)
                kv_col_w = avail_w / float(n_kv_cols)

                s_kv_lbl = ParagraphStyle(
                    "XookKvLbl",
                    fontName=f_bold,
                    fontSize=7.5,
                    leading=10.0,
                    textColor=col_muted,
                    spaceAfter=2,
                )
                s_kv_val = ParagraphStyle(
                    "XookKvVal",
                    fontName=f_reg,
                    fontSize=max(body_size - 0.5, 8.8),
                    leading=max(body_size * 1.25, 11.8),
                    textColor=col_heading,
                )

                grid_rows: List[List[Any]] = []
                grid_styles: List[Any] = [
                    ("BACKGROUND", (0, 0), (-1, -1), col_accent_soft if btype == "header_band" else col_surface),
                    ("BOX", (0, 0), (-1, -1), 0.65, col_border),
                    ("INNERGRID", (0, 0), (-1, -1), 0.4, col_border),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("TOPPADDING", (0, 0), (-1, -1), 6),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                    ("LEFTPADDING", (0, 0), (-1, -1), 9),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                ]
                if btype == "header_band":
                    grid_styles.append(("LINEABOVE", (0, 0), (-1, 0), 2.0, col_accent))

                if kv_title:
                    hdr_para = Paragraph(
                        _inline_md_to_rl_xml(kv_title, f_mono),
                        ParagraphStyle(
                            "XookKvTitle",
                            fontName=h_bold,
                            fontSize=9.5,
                            leading=12.5,
                            textColor=col_heading,
                        ),
                    )
                    title_row: List[Any] = [hdr_para] + [""] * (n_kv_cols - 1)
                    grid_rows.append(title_row)
                    if n_kv_cols > 1:
                        grid_styles.append(("SPAN", (0, 0), (-1, 0)))
                    grid_styles.append(("BACKGROUND", (0, 0), (-1, 0), col_accent_soft))
                    grid_styles.append(("LINEBELOW", (0, 0), (-1, 0), 0.7, col_border))

                for start_i in range(0, len(kv_items), n_kv_cols):
                    chunk = kv_items[start_i : start_i + n_kv_cols]
                    row_cells_kv: List[Any] = []
                    for item in chunk:
                        lbl_s = _sanitize_text_for_pdf(item.get("label") or item.get("key") or "").strip()
                        val_s = _sanitize_text_for_pdf(item.get("value") or "").strip()
                        cell_parts: List[Any] = []
                        if lbl_s:
                            cell_parts.append(Paragraph(_inline_md_to_rl_xml(lbl_s.upper(), f_mono), s_kv_lbl))
                        cell_parts.append(Paragraph(_inline_md_to_rl_xml(val_s or "—", f_mono), s_kv_val))
                        row_cells_kv.append(cell_parts)
                    while len(row_cells_kv) < n_kv_cols:
                        row_cells_kv.append("")
                    grid_rows.append(row_cells_kv)

                kv_tbl = Table(grid_rows, colWidths=[kv_col_w] * n_kv_cols)
                kv_tbl.setStyle(TableStyle(grid_styles))
                flow.append(KeepTogether([Spacer(1, 4), kv_tbl, Spacer(1, 10)]))

            elif btype in ("signature_block", "signatures"):
                signers = blk.get("signers") or blk.get("items") or []
                clean_signers = [s for s in signers if isinstance(s, dict)] if isinstance(signers, list) else []
                if not clean_signers:
                    continue

                per_row = min(3, max(1, len(clean_signers)))
                if avail_w < 260.0:
                    per_row = min(per_row, 2)
                sig_col_w = avail_w / float(per_row)

                s_sig_name = ParagraphStyle(
                    "XookSigName",
                    fontName=f_bold,
                    fontSize=9.2,
                    leading=12.0,
                    textColor=col_heading,
                    alignment=TA_CENTER,
                )
                s_sig_role = ParagraphStyle(
                    "XookSigRole",
                    fontName=f_reg,
                    fontSize=8.2,
                    leading=11.0,
                    textColor=col_muted,
                    alignment=TA_CENTER,
                )

                sig_rows: List[List[Any]] = []
                for start_i in range(0, len(clean_signers), per_row):
                    chunk = clean_signers[start_i : start_i + per_row]
                    row_cells_sig: List[Any] = []
                    for signer in chunk:
                        s_name = _sanitize_text_for_pdf(signer.get("name") or "").strip()
                        s_role = _sanitize_text_for_pdf(signer.get("role") or signer.get("title") or "").strip()
                        s_date = _sanitize_text_for_pdf(signer.get("date") or "").strip()
                        cell_sig: List[Any] = [
                            Spacer(1, 24),
                            HRFlowable(width="82%", thickness=0.8, color=col_heading, hAlign="CENTER", spaceAfter=5),
                        ]
                        if s_name:
                            cell_sig.append(Paragraph(_inline_md_to_rl_xml(s_name, f_mono), s_sig_name))
                        if s_role:
                            cell_sig.append(Paragraph(_inline_md_to_rl_xml(s_role, f_mono), s_sig_role))
                        if s_date:
                            cell_sig.append(Paragraph(_inline_md_to_rl_xml(s_date, f_mono), s_sig_role))
                        row_cells_sig.append(cell_sig)
                    while len(row_cells_sig) < per_row:
                        row_cells_sig.append("")
                    sig_rows.append(row_cells_sig)

                sig_tbl = Table(sig_rows, colWidths=[sig_col_w] * per_row)
                sig_tbl.setStyle(TableStyle([
                    ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 8),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                    ("TOPPADDING", (0, 0), (-1, -1), 4),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ]))
                flow.append(KeepTogether([Spacer(1, 8), sig_tbl, Spacer(1, 10)]))

            elif btype in ("box", "panel", "card") and depth < 3:
                b_title = _sanitize_text_for_pdf(blk.get("title") or "").strip()
                b_text = _sanitize_text_for_pdf(blk.get("text") or blk.get("content") or "").strip()
                b_inner_blocks = blk.get("blocks") if isinstance(blk.get("blocks"), list) else []
                if not b_title and not b_text and not b_inner_blocks:
                    continue

                bg_col = _hex_to_rl_color(blk.get("bg_color"), theme["surface"])
                bd_col = _hex_to_rl_color(blk.get("border_color"), theme["border"])
                inner_w = max(60.0, avail_w - 22.0)

                inner_flow: List[Any] = []
                if b_title:
                    inner_flow.append(
                        Paragraph(
                            _inline_md_to_rl_xml(b_title, f_mono),
                            ParagraphStyle(
                                "XookBoxTitle",
                                fontName=h_bold,
                                fontSize=10.5,
                                leading=14.0,
                                textColor=col_heading,
                                spaceAfter=4,
                            ),
                        )
                    )
                if b_text:
                    inner_flow.append(Paragraph(_inline_md_to_rl_xml(b_text, f_mono), styles["body"]))
                if b_inner_blocks:
                    inner_flow.extend(_render_blocks_to_flowables(b_inner_blocks, inner_w, depth=depth + 1))

                if not inner_flow:
                    continue
                panel_tbl = Table([[inner_flow]], colWidths=[avail_w])
                panel_tbl.setStyle(TableStyle([
                    ("BACKGROUND", (0, 0), (-1, -1), bg_col),
                    ("BOX", (0, 0), (-1, -1), 0.75, bd_col),
                    ("TOPPADDING", (0, 0), (-1, -1), 9),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
                    ("LEFTPADDING", (0, 0), (-1, -1), 11),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 11),
                ]))
                if len(inner_flow) <= 6:
                    flow.append(KeepTogether([Spacer(1, 4), panel_tbl, Spacer(1, 10)]))
                else:
                    flow.append(Spacer(1, 4))
                    flow.append(panel_tbl)
                    flow.append(Spacer(1, 10))

            elif btype == "image":
                raw_img_path = str(blk.get("path") or blk.get("image_path") or blk.get("src") or "").strip()
                if not raw_img_path:
                    continue
                try:
                    img_abs, _ = _resolve_workspace_file_smart(workspace_root, raw_img_path, resolve_path_fn)
                    pil_img = _load_pil_image(img_abs)
                except Exception as exc:
                    warnings.append(f"Imagen omitida ({raw_img_path}): {exc}")
                    continue

                size_opt = str(blk.get("size") or "large").strip().lower()
                width_ratio = {
                    "small": 0.38,
                    "medium": 0.62,
                    "large": 0.88,
                    "full": 1.0,
                }.get(size_opt, 0.88)
                max_h_cm = blk.get("max_height_cm")
                max_h = (float(max_h_cm) * cm) if isinstance(max_h_cm, (int, float)) and max_h_cm > 1 else (usable_h * 0.58)
                max_h = min(max_h, usable_h - 1.5 * cm)
                align = str(blk.get("align") or "center").strip().upper()

                rl_img = _make_rl_image(pil_img, avail_w * width_ratio, max_h, align=align)
                images_embedded += 1

                caption = _sanitize_text_for_pdf(blk.get("caption") or "").strip()
                group: List[Any] = [Spacer(1, 6), rl_img]
                if caption:
                    group.append(Paragraph(_inline_md_to_rl_xml(caption, f_mono), styles["caption"]))
                else:
                    group.append(Spacer(1, 10))
                flow.append(KeepTogether(group))

            elif btype in ("code", "code_block", "pre"):
                raw_code = str(blk.get("code") or blk.get("text") or blk.get("content") or "").strip("\r\n")
                if not raw_code.strip():
                    continue
                raw_lang = str(blk.get("language") or blk.get("lang") or "").strip()
                formatted_lang = _format_code_language_label(raw_lang)
                lang_label = _sanitize_text_for_pdf(formatted_lang).strip()
                cap_label = _sanitize_text_for_pdf(blk.get("caption") or blk.get("title") or "").strip()
                max_code_chars = min(78, max(24, int((avail_w - 24.0) / 5.2)))
                wrapped_lines: List[str] = []
                for src_line in raw_code.replace("\t", "    ").splitlines():
                    if len(src_line) <= max_code_chars:
                        wrapped_lines.append(src_line)
                    else:
                        wrapped_lines.extend(
                            textwrap.wrap(
                                src_line,
                                width=max_code_chars,
                                break_long_words=True,
                                break_on_hyphens=False,
                                replace_whitespace=False,
                                drop_whitespace=False,
                            )
                            or [src_line]
                        )
                safe_code_text = _sanitize_text_for_pdf("\n".join(wrapped_lines))
                code_rows: List[List[Any]] = []
                if lang_label or cap_label:
                    hdr_txt = " · ".join([p for p in [lang_label, cap_label] if p])
                    code_rows.append([
                        Paragraph(
                            xml_escape(hdr_txt),
                            ParagraphStyle(
                                "XookCodeHdr",
                                fontName=f_bold,
                                fontSize=7.5,
                                leading=10,
                                textColor=colors.HexColor("#93C5FD"),
                            ),
                        )
                    ])
                code_rows.append([
                    Preformatted(
                        safe_code_text,
                        ParagraphStyle(
                            "XookCodeBody",
                            fontName=f_mono,
                            fontSize=8.4,
                            leading=11.8,
                            textColor=colors.HexColor("#E2E8F0"),
                        ),
                    )
                ])
                code_tbl = Table(code_rows, colWidths=[avail_w])
                code_styles = [
                    ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#0F172A")),
                    ("BOX", (0, 0), (-1, -1), 0.7, colors.HexColor("#334155")),
                    ("LINEABOVE", (0, 0), (-1, 0), 2.2, col_accent),
                    ("LEFTPADDING", (0, 0), (-1, -1), 11),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 11),
                    ("TOPPADDING", (0, -1), (-1, -1), 8),
                    ("BOTTOMPADDING", (0, -1), (-1, -1), 9),
                ]
                if len(code_rows) > 1:
                    code_styles.extend([
                        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1E293B")),
                        ("TOPPADDING", (0, 0), (-1, 0), 5),
                        ("BOTTOMPADDING", (0, 0), (-1, 0), 5),
                        ("LINEBELOW", (0, 0), (-1, 0), 0.5, colors.HexColor("#334155")),
                    ])
                code_tbl.setStyle(TableStyle(code_styles))
                if len(wrapped_lines) <= 18:
                    flow.append(KeepTogether([Spacer(1, 4), code_tbl, Spacer(1, 10)]))
                else:
                    flow.append(Spacer(1, 4))
                    flow.append(code_tbl)
                    flow.append(Spacer(1, 10))

            elif btype in ("callout", "summary", "quote"):
                tone = str(blk.get("tone") or "info").strip().lower()
                bg_hex, bar_hex, title_hex = theme.get(f"callout_{tone}", theme["callout_info"])
                c_title = _sanitize_text_for_pdf(blk.get("title") or "").strip()
                c_text = _sanitize_text_for_pdf(blk.get("text") or blk.get("content") or "").strip()
                if not c_text and not c_title:
                    continue

                inner_flow_c: List[Any] = []
                if c_title:
                    inner_flow_c.append(
                        Paragraph(
                            _inline_md_to_rl_xml(c_title, f_mono),
                            ParagraphStyle(
                                "CalloutTitle",
                                fontName=f_bold,
                                fontSize=10,
                                leading=13.5,
                                textColor=colors.HexColor(title_hex),
                                spaceAfter=3,
                            ),
                        )
                    )
                if c_text:
                    inner_flow_c.append(
                        Paragraph(
                            _inline_md_to_rl_xml(c_text, f_mono),
                            ParagraphStyle(
                                "CalloutBody",
                                fontName=f_reg,
                                fontSize=9.5,
                                leading=13.8,
                                textColor=col_text,
                            ),
                        )
                    )
                box_tbl = Table([[inner_flow_c]], colWidths=[avail_w])
                box_tbl.setStyle(TableStyle([
                    ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(bg_hex)),
                    ("LINEBEFORE", (0, 0), (0, -1), 3.2, colors.HexColor(bar_hex)),
                    ("TOPPADDING", (0, 0), (-1, -1), 9),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
                    ("LEFTPADDING", (0, 0), (-1, -1), 12),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 12),
                ]))
                flow.append(KeepTogether([Spacer(1, 4), box_tbl, Spacer(1, 10)]))

            elif btype == "kpi_strip":
                items = blk.get("metrics") or blk.get("items") or []
                if not isinstance(items, list) or not items:
                    continue
                cards = items[:4]
                card_w = avail_w / float(len(cards))
                row_cells_k: List[Any] = []
                for card in cards:
                    if not isinstance(card, dict):
                        continue
                    lbl = _sanitize_text_for_pdf(card.get("label") or "").strip()
                    val = _sanitize_text_for_pdf(card.get("value") or "").strip()
                    det = _sanitize_text_for_pdf(card.get("detail") or card.get("sub") or "").strip()
                    cell_flow: List[Any] = [
                        Paragraph(
                            _inline_md_to_rl_xml(lbl.upper(), f_mono),
                            ParagraphStyle("KpiLbl", fontName=f_bold, fontSize=7.5, leading=10, textColor=col_muted, spaceAfter=3),
                        ),
                        Paragraph(
                            _inline_md_to_rl_xml(val, f_mono),
                            ParagraphStyle("KpiVal", fontName=h_bold, fontSize=14, leading=17, textColor=col_heading),
                        ),
                    ]
                    if det:
                        cell_flow.append(
                            Paragraph(
                                _inline_md_to_rl_xml(det, f_mono),
                                ParagraphStyle("KpiDet", fontName=f_reg, fontSize=8, leading=11, textColor=col_accent, spaceBefore=2),
                            )
                        )
                    row_cells_k.append(cell_flow)

                if row_cells_k:
                    kpi_tbl = Table([row_cells_k], colWidths=[card_w] * len(row_cells_k))
                    kpi_tbl.setStyle(TableStyle([
                        ("BACKGROUND", (0, 0), (-1, -1), col_accent_soft if theme["dark_page"] else col_surface),
                        ("BOX", (0, 0), (-1, -1), 0.6, col_border),
                        ("INNERGRID", (0, 0), (-1, -1), 0.6, col_border),
                        ("VALIGN", (0, 0), (-1, -1), "TOP"),
                        ("TOPPADDING", (0, 0), (-1, -1), 9),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
                        ("LEFTPADDING", (0, 0), (-1, -1), 10),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                    ]))
                    flow.append(KeepTogether([Spacer(1, 4), kpi_tbl, Spacer(1, 10)]))

            elif btype == "divider":
                flow.append(HRFlowable(width="100%", thickness=0.7, color=col_border, spaceBefore=6, spaceAfter=10))

            elif btype == "spacer":
                flow.append(Spacer(1, 12))

            elif btype == "page_break":
                flow.append(PageBreak())

        return flow

    story.extend(_render_blocks_to_flowables(blocks, content_flow_w, emit_progress_events=True))

    if len(story) == 0:
        story.append(Paragraph("Documento sin contenido.", styles["body"]))

    _emit_progress(
        "rendering_pdf",
        "Compilando páginas del PDF...",
        0.84,
        total_blocks=total_blocks,
        completed_blocks=total_blocks,
        blocks=preview_blocks_cache,
    )

    has_prepend_all = bool(prepend_all_pages_from and prepend_all_pages_from.is_file())
    has_prepend_cover = bool(not has_prepend_all and prepend_first_page_from and prepend_first_page_from.is_file())
    prepend_page_offset = 0
    if has_prepend_all and prepend_all_pages_from is not None:
        try:
            from pypdf import PdfReader as _OffsetPR
            prepend_page_offset = len(_OffsetPR(str(prepend_all_pages_from)).pages)
        except Exception:
            prepend_page_offset = 0
    elif has_prepend_cover:
        prepend_page_offset = 1

    # Resolver papelería PDF opcional (stationery_asset)
    stationery_pdf_path: Optional[Path] = None
    if active_design_spec is not None:
        st_raw = (active_design_spec.get("page") or {}).get("stationery_asset")
        if st_raw:
            st_cand = _resolve_design_asset_path(
                "stationery_asset",
                st_raw,
                resolved_assets=resolved_assets,
                skill_dir=resolved_skill_dir,
                workspace_root=workspace_root,
                resolve_path_fn=resolve_path_fn,
            )
            if st_cand is not None and st_cand.suffix.lower() == ".pdf":
                stationery_pdf_path = st_cand
            elif st_cand is None:
                warnings.append(f"Papelería PDF omitida ({st_raw}): no encontrada.")

    try:
        doc.build(
            story,
            canvasmaker=lambda *args, **kwargs: _NumberedCanvas(
                *args,
                xook_meta={
                    "title": title,
                    "subtitle": subtitle,
                    "author": author,
                    "date": date_label,
                    "theme": theme,
                    "has_cover": has_cover,
                    "margin_x": margin_x,
                    "margin_left": margin_left,
                    "margin_right": margin_right,
                    "margin_top": margin_top,
                    "margin_bottom": margin_bottom,
                    "page_offset": prepend_page_offset,
                    "footer_text": custom_footer_text,
                    "watermark": watermark_meta,
                    "design_spec": active_design_spec,
                    "body_font_reg": f_reg,
                    "body_font_bold": f_bold,
                    "heading_font_bold": h_bold,
                    "header_logo_reader": header_logo_reader,
                },
                **kwargs,
            ),
        )

        # Aplicar papelería PDF de fondo (stationery_asset) si existe
        if stationery_pdf_path is not None and stationery_pdf_path.is_file():
            try:
                from pypdf import PdfReader as _StPR, PdfWriter as _StPW

                st_bytes = stationery_pdf_path.read_bytes()
                st_probe = _StPR(io.BytesIO(st_bytes))
                if len(st_probe.pages) >= 1:
                    gen_reader = _StPR(str(tmp_out))
                    st_writer = _StPW()
                    hdr_skip_first = bool(((active_design_spec or {}).get("header") or {}).get("skip_first_page", True))
                    for p_idx, gen_page in enumerate(gen_reader.pages):
                        if p_idx == 0 and has_cover and hdr_skip_first:
                            st_writer.add_page(gen_page)
                        else:
                            bg_page = st_writer.add_page(_StPR(io.BytesIO(st_bytes)).pages[0])
                            bg_page.merge_page(gen_page)
                    st_tmp = out_abs.with_name(f".{out_abs.name}.stationery.tmp.{os.getpid()}")
                    with open(st_tmp, "wb") as sf:
                        st_writer.write(sf)
                    st_tmp.replace(tmp_out)
            except Exception as exc:
                warnings.append(f"No se pudo aplicar papelería PDF ({stationery_pdf_path.name}): {exc}")

        if has_prepend_all and prepend_all_pages_from is not None:
            from pypdf import PdfReader as _PR, PdfWriter as _PW

            merged_tmp = out_abs.with_name(f".{out_abs.name}.merged_all.tmp.{os.getpid()}")
            prev_r = _PR(str(prepend_all_pages_from))
            body_r = _PR(str(tmp_out))
            writer = _PW()
            for ep in prev_r.pages:
                writer.add_page(ep)
            for bp in body_r.pages:
                writer.add_page(bp)
            with open(merged_tmp, "wb") as mf:
                writer.write(mf)
            tmp_out.unlink(missing_ok=True)
            merged_tmp.replace(out_abs)
        elif has_prepend_cover and prepend_first_page_from is not None:
            from pypdf import PdfReader as _PR, PdfWriter as _PW

            merged_tmp = out_abs.with_name(f".{out_abs.name}.merged.tmp.{os.getpid()}")
            cov_r = _PR(str(prepend_first_page_from))
            body_r = _PR(str(tmp_out))
            writer = _PW()
            if len(cov_r.pages) >= 1:
                writer.add_page(cov_r.pages[0])
            for bp in body_r.pages:
                writer.add_page(bp)
            with open(merged_tmp, "wb") as mf:
                writer.write(mf)
            tmp_out.unlink(missing_ok=True)
            merged_tmp.replace(out_abs)
        else:
            tmp_out.replace(out_abs)
    except Exception:
        if tmp_out.exists():
            try:
                tmp_out.unlink()
            except Exception:
                pass
        raise

    # Contar páginas reales del archivo final
    from pypdf import PdfReader

    page_count = len(PdfReader(str(out_abs)).pages)
    size_bytes = out_abs.stat().st_size

    effective_has_cover = has_cover or has_prepend_cover
    persisted_design_spec: Optional[Dict[str, Any]] = None
    if active_design_spec is not None:
        persisted_design_spec = _json_safe_copy(active_design_spec)
        if resolved_skill_dir:
            persisted_design_spec["_skill_dir"] = resolved_skill_dir
        if resolved_assets:
            persisted_design_spec["_resolved_assets"] = _json_safe_copy(resolved_assets)
        if resolved_skill_slug:
            persisted_design_spec["_skill_slug"] = resolved_skill_slug

    effective_design_skill = resolved_skill_slug or (design_skill_ref or None)
    try:
        from slices.pdf_engine.editor import save_pdf_spec_metadata

        if save_spec_override is not None:
            spec_to_save = dict(save_spec_override)
            if effective_design_skill and not spec_to_save.get("design_skill"):
                spec_to_save["design_skill"] = effective_design_skill
            if persisted_design_spec is not None:
                spec_to_save["design_spec"] = persisted_design_spec
            if raw_design_overrides is not None and "design_overrides" not in spec_to_save:
                spec_to_save["design_overrides"] = _json_safe_copy(raw_design_overrides)
        else:
            spec_to_save = {
                "title": title,
                "subtitle": subtitle,
                "author": author,
                "date": date_label,
                "theme": theme_name,
                "has_cover": effective_has_cover,
                "preserve_first_page": effective_has_cover,
                "cover": {
                    "enabled": effective_has_cover,
                    "layout": cover_layout if has_cover else ("full_page" if has_prepend_cover else "none"),
                    "eyebrow": badge_txt,
                    "image_path": cover_img_raw,
                    "footer_note": str(cover_cfg.get("footer_note") or "").strip(),
                } if effective_has_cover else {"enabled": False, "layout": "none"},
                "blocks": blocks,
                "design_skill": effective_design_skill,
                "design_spec": persisted_design_spec,
                "design_overrides": _json_safe_copy(raw_design_overrides) if raw_design_overrides else None,
            }
        fresh_cover_write = not has_prepend_cover and not has_prepend_all
        save_pdf_spec_metadata(
            workspace_root,
            out_rel,
            spec_to_save,
            pdf_abs=out_abs,
            overwrite_base=True,
            overwrite_cover=fresh_cover_write,
        )
    except Exception:
        pass

    out: Dict[str, Any] = {
        "ok": True,
        "path": out_rel,
        "filename": out_abs.name,
        "title": title,
        "page_count": page_count,
        "size_bytes": size_bytes,
        "images_embedded": images_embedded,
        "tables_count": tables_count,
        "has_cover": effective_has_cover,
        "cover_layout": cover_layout if has_cover else ("full_page" if has_prepend_cover else "none"),
        "theme": theme_name,
        "revision": int(out_abs.stat().st_mtime * 1000) if out_abs.is_file() else 0,
    }
    if effective_design_skill:
        out["design_skill"] = effective_design_skill
    if active_design_spec is not None:
        out["design_spec"] = _strip_private_keys(active_design_spec)
    if warnings:
        out["warnings"] = warnings
    return out
