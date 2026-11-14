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
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
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


def _ensure_fonts() -> None:
    global _FONTS_REGISTERED
    if _FONTS_REGISTERED:
        return
    _FONTS_REGISTERED = True

    font_candidates = [
        # macOS Supplemental TrueType fonts (soporte completo de español y Unicode)
        (
            "/System/Library/Fonts/Supplemental/Arial.ttf",
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
            "/System/Library/Fonts/Supplemental/Arial Italic.ttf",
            "/System/Library/Fonts/Supplemental/Arial Bold Italic.ttf",
            "/System/Library/Fonts/Supplemental/Courier New.ttf",
        ),
        # Linux / Docker DejaVu / Liberation
        (
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-BoldOblique.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        ),
        (
            "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Italic.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-BoldItalic.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
        ),
    ]

    for reg, bold, italic, bitalic, mono in font_candidates:
        if Path(reg).is_file() and Path(bold).is_file():
            try:
                pdfmetrics.registerFont(TTFont("XookSans", reg))
                pdfmetrics.registerFont(TTFont("XookSans-Bold", bold))
                if Path(italic).is_file():
                    pdfmetrics.registerFont(TTFont("XookSans-Italic", italic))
                else:
                    pdfmetrics.registerFont(TTFont("XookSans-Italic", reg))
                if Path(bitalic).is_file():
                    pdfmetrics.registerFont(TTFont("XookSans-BoldItalic", bitalic))
                else:
                    pdfmetrics.registerFont(TTFont("XookSans-BoldItalic", bold))
                pdfmetrics.registerFontFamily(
                    "XookSans",
                    normal="XookSans",
                    bold="XookSans-Bold",
                    italic="XookSans-Italic",
                    boldItalic="XookSans-BoldItalic",
                )
                if Path(mono).is_file():
                    pdfmetrics.registerFont(TTFont("XookMono", mono))
                    _FONT_FAMILY["mono"] = "XookMono"
                _FONT_FAMILY["regular"] = "XookSans"
                _FONT_FAMILY["bold"] = "XookSans-Bold"
                _FONT_FAMILY["italic"] = "XookSans-Italic"
                _FONT_FAMILY["bold_italic"] = "XookSans-BoldItalic"
                _FONT_FAMILY["unicode_ttf"] = True
                return
            except Exception:
                continue


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

        if stripped.startswith("```"):
            _flush_para()
            fence_lang = stripped[3:].strip().split()[0] if len(stripped) > 3 and stripped[3:].strip() else ""
            code_lines: List[str] = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                code_lines.append(lines[i].rstrip("\r"))
                i += 1
            if i < len(lines) and lines[i].strip().startswith("```"):
                i += 1
            code_body = "\n".join(code_lines).strip("\n")
            if code_body:
                blocks.append({"type": "code", "language": fence_lang, "code": code_body})
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

        # Footer sutil
        footer_y = 1.15 * cm
        self.setStrokeColor(border_col)
        self.setLineWidth(0.5)
        self.line(margin_x, footer_y + 10, page_w - margin_x, footer_y + 10)

        self.setFont(_FONT_FAMILY["regular"], 8)
        self.setFillColor(muted_col)
        left_footer = f"XOOK · {date_str}" if date_str else "XOOK"
        self.drawString(margin_x, footer_y, left_footer)
        self.drawRightString(page_w - margin_x, footer_y, f"Página {page_num} de {total_pages}")
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
) -> Dict[str, Any]:
    """
    Genera un documento PDF estructurado dentro de `agente/` del workspace activo.
    Retorna metadata del PDF creado (`ok`, `path`, `filename`, `page_count`, `size_bytes`, etc.).
    """
    _ensure_fonts()

    title = _sanitize_text_for_pdf(spec.get("title") or "Documento XOOK").strip() or "Documento XOOK"
    subtitle = _sanitize_text_for_pdf(spec.get("subtitle") or "").strip()
    author = _sanitize_text_for_pdf(spec.get("author") or spec.get("company") or default_author or "").strip()
    date_label = _sanitize_text_for_pdf(spec.get("date") or _spanish_date_label()).strip()

    theme_name = str(spec.get("theme") or "executive").strip().lower()
    theme = THEMES.get(theme_name, THEMES["executive"])

    page_size_key = str(spec.get("page_size") or "letter").strip().lower()
    pagesize = A4 if page_size_key == "a4" else letter
    ref_pdf_for_size = prepend_all_pages_from if (prepend_all_pages_from and prepend_all_pages_from.is_file()) else (
        prepend_first_page_from if (prepend_first_page_from and prepend_first_page_from.is_file()) else None
    )
    if ref_pdf_for_size is not None:
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
    top_cover_img = (
        spec.get("cover_image")
        or spec.get("coverImage")
        or spec.get("portada_imagen")
    )
    if isinstance(raw_cover, bool):
        cover_cfg: Dict[str, Any] = {"enabled": raw_cover}
    elif isinstance(raw_cover, dict):
        cover_cfg = dict(raw_cover)
    elif isinstance(block_cover_override, dict):
        cover_cfg = dict(block_cover_override)
    else:
        cover_cfg = {}

    if top_cover_img and not cover_cfg.get("image_path"):
        cover_cfg["image_path"] = top_cover_img
        cover_cfg.setdefault("enabled", True)

    has_cover = bool(cover_cfg.get("enabled")) or bool(cover_cfg.get("image_path") or cover_cfg.get("image") or cover_cfg.get("path") or cover_cfg.get("logo_path"))
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
    warnings: List[str] = []

    if has_cover and cover_img_raw:
        try:
            c_abs, _ = _resolve_workspace_file_smart(workspace_root, cover_img_raw, resolve_path_fn)
            resolved_cover_abs = c_abs
            resolved_cover_pil = _load_pil_image(c_abs)
        except Exception as exc:
            warnings.append(f"Imagen de portada omitida ({cover_img_raw}): {exc}")
            resolved_cover_pil = None
            resolved_cover_abs = None

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
        # Si la imagen adjunta ya es una portada/carátula diseñada con su propio texto/logotipo,
        # evitar oscurecerla ni encimar texto blanco: mostrarla íntegra y nítida como página 1.
        cover_layout = "full_page"

    # Estilos tipográficos
    f_reg = _FONT_FAMILY["regular"]
    f_bold = _FONT_FAMILY["bold"]
    f_ital = _FONT_FAMILY["italic"]
    f_mono = _FONT_FAMILY["mono"]

    col_text = colors.HexColor(theme["text"])
    col_heading = colors.HexColor(theme["heading"])
    col_muted = colors.HexColor(theme["muted"])
    col_accent = colors.HexColor(theme["accent"])
    col_border = colors.HexColor(theme["border"])
    col_surface = colors.HexColor(theme["surface"])
    col_accent_soft = colors.HexColor(theme["accent_soft"])

    styles = {
        "h1": ParagraphStyle(
            "XookH1",
            fontName=f_bold,
            fontSize=15.5,
            leading=20,
            textColor=col_heading,
            spaceBefore=14,
            spaceAfter=6,
            keepWithNext=True,
        ),
        "h2": ParagraphStyle(
            "XookH2",
            fontName=f_bold,
            fontSize=12.5,
            leading=16.5,
            textColor=col_accent,
            spaceBefore=10,
            spaceAfter=4,
            keepWithNext=True,
        ),
        "h3": ParagraphStyle(
            "XookH3",
            fontName=f_bold,
            fontSize=10.8,
            leading=14.5,
            textColor=col_heading,
            spaceBefore=8,
            spaceAfter=3,
            keepWithNext=True,
        ),
        "body": ParagraphStyle(
            "XookBody",
            fontName=f_reg,
            fontSize=10.0,
            leading=14.8,
            textColor=col_text,
            spaceAfter=7,
        ),
        "bullet": ParagraphStyle(
            "XookBullet",
            fontName=f_reg,
            fontSize=10.0,
            leading=14.2,
            textColor=col_text,
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
            fontSize=9.0,
            leading=12.0,
            textColor=colors.HexColor(theme["table_head_fg"]),
        ),
        "tbl_cell": ParagraphStyle(
            "XookTblCell",
            fontName=f_reg,
            fontSize=8.8,
            leading=12.0,
            textColor=col_text,
        ),
        "tbl_cell_right": ParagraphStyle(
            "XookTblCellRight",
            fontName=f_reg,
            fontSize=8.8,
            leading=12.0,
            textColor=col_text,
            alignment=TA_RIGHT,
        ),
    }

    margin_x = 2.0 * cm
    margin_top = 2.05 * cm
    margin_bottom = 1.85 * cm
    usable_w = page_w - 2 * margin_x
    usable_h = page_h - margin_top - margin_bottom

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

    def _draw_cover_bg(canv: rl_canvas.Canvas, _doc: BaseDocTemplate) -> None:
        canv.saveState()
        if full_page_reader is not None:
            canv.setFillColor(colors.HexColor(full_page_bg_hex))
            canv.rect(0, 0, page_w, page_h, stroke=0, fill=1)
            dx, dy, dw, dh = full_page_box
            canv.drawImage(full_page_reader, dx, dy, width=dw, height=dh, preserveAspectRatio=True)
            canv.restoreState()
            return
        if theme["dark_page"]:
            canv.setFillColor(colors.HexColor(theme["page_bg"]))
            canv.rect(0, 0, page_w, page_h, stroke=0, fill=1)
        if full_bleed_reader is not None:
            canv.drawImage(full_bleed_reader, 0, 0, width=page_w, height=page_h, preserveAspectRatio=False)
        elif has_cover:
            # Banda superior elegante en portada editorial
            canv.setFillColor(col_accent)
            canv.rect(0, page_h - 0.55 * cm, page_w, 0.55 * cm, stroke=0, fill=1)
        canv.restoreState()

    def _draw_content_bg(canv: rl_canvas.Canvas, _doc: BaseDocTemplate) -> None:
        if theme["dark_page"]:
            canv.saveState()
            canv.setFillColor(colors.HexColor(theme["page_bg"]))
            canv.rect(0, 0, page_w, page_h, stroke=0, fill=1)
            canv.restoreState()

    templates: List[PageTemplate] = []
    if has_cover:
        cover_margin_x = 2.2 * cm if cover_layout == "full_bleed" else margin_x
        cover_margin_y = 2.0 * cm
        cover_frame = Frame(
            cover_margin_x,
            cover_margin_y,
            page_w - 2 * cover_margin_x,
            page_h - 2 * cover_margin_y,
            leftPadding=0,
            rightPadding=0,
            topPadding=0,
            bottomPadding=0,
            id="cover_frame",
        )
        templates.append(PageTemplate(id="Cover", frames=[cover_frame], onPage=_draw_cover_bg))

    content_frame = Frame(
        margin_x,
        margin_bottom,
        usable_w,
        usable_h,
        leftPadding=0,
        rightPadding=0,
        topPadding=0,
        bottomPadding=0,
        id="content_frame",
    )
    templates.append(PageTemplate(id="Content", frames=[content_frame], onPage=_draw_content_bg))

    tmp_out = out_abs.with_name(f".{out_abs.name}.tmp.{os.getpid()}_{int(time.time() * 1000)}")
    doc = BaseDocTemplate(
        str(tmp_out),
        pagesize=pagesize,
        pageTemplates=templates,
        title=title,
        author=author or "XOOK",
        creator="XOOK PDF Engine",
    )

    story: List[Any] = []
    keep_buffers: List[io.BytesIO] = []

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
        cover_usable_w = page_w - 2 * (2.2 * cm if cover_layout == "full_bleed" else margin_x)
        cover_fg = colors.white if cover_layout == "full_bleed" else col_heading
        cover_sub_fg = colors.HexColor("#E2E8F0") if cover_layout == "full_bleed" else col_muted
        cover_badge_fg = colors.HexColor("#7DD3FC") if cover_layout == "full_bleed" else col_accent

        s_badge = ParagraphStyle(
            "CovBadge",
            fontName=f_bold,
            fontSize=9.5,
            leading=13,
            textColor=cover_badge_fg,
            alignment=TA_CENTER if cover_layout == "centered" else TA_LEFT,
            spaceAfter=8,
        )
        s_cov_title = ParagraphStyle(
            "CovTitle",
            fontName=f_bold,
            fontSize=28 if len(title) <= 45 else 23,
            leading=33 if len(title) <= 45 else 28,
            textColor=cover_fg,
            alignment=TA_CENTER if cover_layout == "centered" else TA_LEFT,
            spaceAfter=12,
        )
        s_cov_sub = ParagraphStyle(
            "CovSub",
            fontName=f_reg,
            fontSize=13,
            leading=18.5,
            textColor=cover_sub_fg,
            alignment=TA_CENTER if cover_layout == "centered" else TA_LEFT,
            spaceAfter=16,
        )
        s_cov_meta = ParagraphStyle(
            "CovMeta",
            fontName=f_reg,
            fontSize=10,
            leading=15,
            textColor=cover_sub_fg,
            alignment=TA_CENTER if cover_layout == "centered" else TA_LEFT,
        )

        meta_parts = [p for p in [author, date_label] if p]
        meta_line = "  ·  ".join(meta_parts)

        if cover_layout == "full_page" and full_page_reader is not None:
            # Portada íntegra: se dibuja nítida en _draw_cover_bg sin textos encimados ni velos oscuros.
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
        # Sin portada separada: encabezado ejecutivo limpio al inicio de la página 1
        s_doc_title = ParagraphStyle(
            "DocTitle",
            fontName=f_bold,
            fontSize=20,
            leading=24.5,
            textColor=col_heading,
            spaceAfter=4,
        )
        s_doc_sub = ParagraphStyle(
            "DocSub",
            fontName=f_reg,
            fontSize=11,
            leading=15,
            textColor=col_muted,
            spaceAfter=6,
        )
        s_doc_meta = ParagraphStyle(
            "DocMeta",
            fontName=f_reg,
            fontSize=8.5,
            leading=12,
            textColor=col_muted,
        )
        story.append(Paragraph(_inline_md_to_rl_xml(title, f_mono), s_doc_title))
        if subtitle:
            story.append(Paragraph(_inline_md_to_rl_xml(subtitle, f_mono), s_doc_sub))
        meta_parts = [p for p in [author, date_label] if p]
        if meta_parts:
            story.append(Paragraph(_inline_md_to_rl_xml(" · ".join(meta_parts), f_mono), s_doc_meta))
        story.append(Spacer(1, 6))
        story.append(HRFlowable(width="100%", thickness=1.5, color=col_accent, spaceAfter=14))

    # 2) Construir bloques de contenido
    tables_count = 0
    total_blocks = len(blocks)

    for blk_idx, blk in enumerate(blocks):
        btype = str(blk.get("type") or "").lower()
        if total_blocks > 0 and (
            blk_idx == total_blocks - 1
            or btype in ("heading", "table", "image", "kpi_strip")
            or blk_idx % 4 == 0
        ):
            frac = (blk_idx + 1) / float(max(1, total_blocks))
            _emit_progress(
                "building_blocks",
                f"Maquetando contenido ({blk_idx + 1}/{total_blocks})...",
                0.34 + 0.44 * frac,
                total_blocks=total_blocks,
                completed_blocks=blk_idx + 1,
                blocks=preview_blocks_cache,
            )

        if btype == "heading":
            lvl = int(blk.get("level") or 1)
            txt = _sanitize_text_for_pdf(blk.get("text") or blk.get("title") or "").strip()
            if not txt:
                continue
            style_key = "h1" if lvl <= 1 else ("h2" if lvl == 2 else "h3")
            story.append(Paragraph(_inline_md_to_rl_xml(txt, f_mono), styles[style_key]))
            if lvl == 1:
                story.append(HRFlowable(width="100%", thickness=0.6, color=col_border, spaceBefore=0, spaceAfter=6))

        elif btype == "paragraph":
            txt = _sanitize_text_for_pdf(blk.get("text") or blk.get("content") or "").strip()
            if txt:
                story.append(Paragraph(_inline_md_to_rl_xml(txt, f_mono), styles["body"]))

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
                story.append(Paragraph(bullet_xml, styles["bullet"]))
            story.append(Spacer(1, 4))

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

            # Detectar columnas numéricas para alinear a la derecha
            numeric_cols = set()
            num_re = re.compile(r"^\s*[$€£]?\s*-?[\d.,]+\s*(?:%|mxn|usd|eur|un\.?|d[ií]as?)?\s*$", re.IGNORECASE)
            for c_idx in range(num_cols):
                vals = [row[c_idx].strip() for row in normalized_rows if row[c_idx].strip()]
                if vals and all(num_re.match(v) for v in vals):
                    numeric_cols.add(c_idx)

            # Calcular anchos proporcionales al contenido
            col_weights: List[float] = []
            for c_idx in range(num_cols):
                sample_lens = [len(clean_headers[c_idx])] + [min(42, len(r[c_idx])) for r in normalized_rows[:20]]
                avg_len = max(6.0, float(max(sample_lens)))
                col_weights.append(avg_len)
            total_weight = sum(col_weights) or float(num_cols)
            col_widths = [max(usable_w * 0.08, usable_w * (w / total_weight)) for w in col_weights]
            # Re-normalizar para ajustar exactamente a usable_w
            sum_w = sum(col_widths)
            col_widths = [w * (usable_w / sum_w) for w in col_widths]

            table_data: List[List[Any]] = [
                [Paragraph(_inline_md_to_rl_xml(h, f_mono), styles["tbl_head"]) for h in clean_headers]
            ]
            for r in normalized_rows:
                row_cells = []
                for c_idx, cell_val in enumerate(r):
                    st = styles["tbl_cell_right"] if c_idx in numeric_cols else styles["tbl_cell"]
                    row_cells.append(Paragraph(_inline_md_to_rl_xml(cell_val or "—", f_mono), st))
                table_data.append(row_cells)

            tbl = Table(table_data, colWidths=col_widths, repeatRows=1)
            tbl_style = [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(theme["table_head_bg"])),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, 0), 7),
                ("BOTTOMPADDING", (0, 0), (-1, 0), 7),
                ("TOPPADDING", (0, 1), (-1, -1), 5.5),
                ("BOTTOMPADDING", (0, 1), (-1, -1), 5.5),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("LINEBELOW", (0, 0), (-1, 0), 1.0, col_accent),
                ("LINEBELOW", (0, 1), (-1, -1), 0.4, col_border),
                ("BOX", (0, 0), (-1, -1), 0.5, col_border),
            ]
            for r_idx in range(1, len(table_data)):
                if r_idx % 2 == 0:
                    tbl_style.append(("BACKGROUND", (0, r_idx), (-1, r_idx), colors.HexColor(theme["table_alt"])))
                elif theme["dark_page"]:
                    tbl_style.append(("BACKGROUND", (0, r_idx), (-1, r_idx), col_surface))
            tbl.setStyle(TableStyle(tbl_style))

            caption_txt = _sanitize_text_for_pdf(blk.get("caption") or "").strip()
            story.append(Spacer(1, 4))
            story.append(tbl)
            if caption_txt:
                story.append(Paragraph(_inline_md_to_rl_xml(caption_txt, f_mono), styles["caption"]))
            else:
                story.append(Spacer(1, 10))
            tables_count += 1

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

            rl_img = _make_rl_image(pil_img, usable_w * width_ratio, max_h, align=align)
            images_embedded += 1

            caption = _sanitize_text_for_pdf(blk.get("caption") or "").strip()
            group: List[Any] = [Spacer(1, 6), rl_img]
            if caption:
                group.append(Paragraph(_inline_md_to_rl_xml(caption, f_mono), styles["caption"]))
            else:
                group.append(Spacer(1, 10))
            story.append(KeepTogether(group))

        elif btype in ("code", "code_block", "pre"):
            raw_code = str(blk.get("code") or blk.get("text") or blk.get("content") or "").strip("\r\n")
            if not raw_code.strip():
                continue
            lang_label = _sanitize_text_for_pdf(blk.get("language") or blk.get("lang") or "").strip()
            cap_label = _sanitize_text_for_pdf(blk.get("caption") or blk.get("title") or "").strip()
            wrapped_lines: List[str] = []
            for src_line in raw_code.replace("\t", "    ").splitlines():
                if len(src_line) <= 78:
                    wrapped_lines.append(src_line)
                else:
                    wrapped_lines.extend(
                        textwrap.wrap(
                            src_line,
                            width=78,
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
                hdr_txt = " · ".join([p for p in [lang_label.upper(), cap_label] if p])
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
            code_tbl = Table(code_rows, colWidths=[usable_w])
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
                story.append(KeepTogether([Spacer(1, 4), code_tbl, Spacer(1, 10)]))
            else:
                story.append(Spacer(1, 4))
                story.append(code_tbl)
                story.append(Spacer(1, 10))

        elif btype in ("callout", "summary", "quote"):
            tone = str(blk.get("tone") or "info").strip().lower()
            bg_hex, bar_hex, title_hex = theme.get(f"callout_{tone}", theme["callout_info"])
            c_title = _sanitize_text_for_pdf(blk.get("title") or "").strip()
            c_text = _sanitize_text_for_pdf(blk.get("text") or blk.get("content") or "").strip()
            if not c_text and not c_title:
                continue

            inner_flow: List[Any] = []
            if c_title:
                inner_flow.append(
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
                inner_flow.append(
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
            box = Table([[inner_flow]], colWidths=[usable_w])
            box.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(bg_hex)),
                ("LINEBEFORE", (0, 0), (0, -1), 3.2, colors.HexColor(bar_hex)),
                ("TOPPADDING", (0, 0), (-1, -1), 9),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
                ("LEFTPADDING", (0, 0), (-1, -1), 12),
                ("RIGHTPADDING", (0, 0), (-1, -1), 12),
            ]))
            story.append(KeepTogether([Spacer(1, 4), box, Spacer(1, 10)]))

        elif btype == "kpi_strip":
            items = blk.get("metrics") or blk.get("items") or []
            if not isinstance(items, list) or not items:
                continue
            cards = items[:4]
            card_w = usable_w / float(len(cards))
            row_cells: List[Any] = []
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
                        ParagraphStyle("KpiVal", fontName=f_bold, fontSize=14, leading=17, textColor=col_heading),
                    ),
                ]
                if det:
                    cell_flow.append(
                        Paragraph(
                            _inline_md_to_rl_xml(det, f_mono),
                            ParagraphStyle("KpiDet", fontName=f_reg, fontSize=8, leading=11, textColor=col_accent, spaceBefore=2),
                        )
                    )
                row_cells.append(cell_flow)

            if row_cells:
                kpi_tbl = Table([row_cells], colWidths=[card_w] * len(row_cells))
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
                story.append(KeepTogether([Spacer(1, 4), kpi_tbl, Spacer(1, 10)]))

        elif btype == "divider":
            story.append(HRFlowable(width="100%", thickness=0.7, color=col_border, spaceBefore=6, spaceAfter=10))

        elif btype == "spacer":
            story.append(Spacer(1, 12))

        elif btype == "page_break":
            story.append(PageBreak())

    if len(story) == 0:
        story.append(Paragraph("Documento generado con XOOK.", styles["body"]))

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

    try:
        doc.build(
            story,
            canvasmaker=lambda *args, **kwargs: _NumberedCanvas(
                *args,
                xook_meta={
                    "title": title,
                    "author": author,
                    "date": date_label,
                    "theme": theme,
                    "has_cover": has_cover,
                    "margin_x": margin_x,
                    "page_offset": prepend_page_offset,
                },
                **kwargs,
            ),
        )
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
    try:
        from slices.pdf_engine.editor import save_pdf_spec_metadata

        spec_to_save = save_spec_override or {
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
        }
        save_pdf_spec_metadata(workspace_root, out_rel, spec_to_save, pdf_abs=out_abs)
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
    }
    if warnings:
        out["warnings"] = warnings
    return out
