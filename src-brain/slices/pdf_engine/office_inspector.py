"""
Motor de inspección de diseño visual y estructural para documentos Office y
archivos universales en XOOK:
- Word (`.docx`) vía inspección profunda de OOXML (`document.xml`, `styles.xml`,
  `theme1.xml`, `header*.xml`, `footer*.xml`, `word/media/*`).
- Excel (`.xlsx`) vía inspección profunda de OOXML (`theme1.xml` + resolución
  exacta de `theme`/`tint`, `styles.xml`, `workbook.xml`, `sharedStrings.xml`,
  `sheet*.xml`, `xl/media/*`).
- PowerPoint (`.pptx`) vía inspección de `presentation.xml`, `theme1.xml`,
  `slideLayouts`, `slides` y `ppt/media/*`.
- Fallback limpio para `.csv`, `.tsv`, `.doc`, `.rtf`, `.odt`, `.xls`, `.ods`
  apoyado en `office_reader.read_universal_document`.

Reglas estrictas (AGENTS.md):
- Cero dependencias externas nuevas (solo Python stdlib + `Pillow` ya instalada).
- Privacidad: NUNCA copia PII, nombres de clientes, correos, teléfonos, RFC/CURP
  ni valores numéricos/monetarios literales en `design_spec`, `sections_blueprint`
  ni `sheets_blueprint`.
- Cero persistencia de capturas crudas en disco.
"""

from __future__ import annotations

from collections import Counter
import colorsys
import io
import math
import os
from pathlib import Path
import re
import statistics
import time
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple
import xml.etree.ElementTree as ET
import zipfile

from PIL import Image

from slices.pdf_engine.inspector import (
    DEFAULT_DESIGN_SPEC,
    DESIGN_SPEC_VERSION,
    _MAX_ASSET_BYTES,
    _MAX_ASSET_DIM_PX,
    _base_font_hint,
    _classify_document_type,
    _classify_font_family,
    _color_distance,
    _darken_hex,
    _detect_page_size_name,
    _hex_to_rgb,
    _is_chromatic_accent,
    _luminance,
    _mix_hex,
    _rgb_to_hex,
    _sanitize_formula_pattern,
    _sanitize_num_fmt,
    _sanitize_section_title,
    _sanitize_spreadsheet_label,
    _saturation,
    _tokenize_running_text,
    normalize_design_spec,
)
from slices.pdf_engine.office_reader import read_universal_document

_MAX_XML_BYTES = 25_000_000
_MAX_MEDIA_BYTES = 5_000_000
_OLE2_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".tif", ".tiff"}

# Paleta de tema Office por defecto (ECMA-376) cuando theme1.xml está ausente
_DEFAULT_THEME_COLORS: Dict[str, str] = {
    "lt1": "#FFFFFF",
    "dk1": "#000000",
    "lt2": "#E7E6E6",
    "dk2": "#44546A",
    "accent1": "#4472C4",
    "accent2": "#ED7D31",
    "accent3": "#A5A5A5",
    "accent4": "#FFC000",
    "accent5": "#5B9BD5",
    "accent6": "#70AD47",
    "hlink": "#0563C1",
    "folHlink": "#954F72",
}

# Mapeo oficial de índices `theme="N"` en Excel OOXML (nótese lt/dk invertidos vs clrScheme)
_XL_THEME_INDEX_MAP: Dict[int, str] = {
    0: "lt1",
    1: "dk1",
    2: "lt2",
    3: "dk2",
    4: "accent1",
    5: "accent2",
    6: "accent3",
    7: "accent4",
    8: "accent5",
    9: "accent6",
    10: "hlink",
    11: "folHlink",
}

_WORD_THEME_COLOR_MAP: Dict[str, str] = {
    "dark1": "dk1",
    "light1": "lt1",
    "dark2": "dk2",
    "light2": "lt2",
    "text1": "dk1",
    "background1": "lt1",
    "text2": "dk2",
    "background2": "lt2",
    "dk1": "dk1",
    "lt1": "lt1",
    "dk2": "dk2",
    "lt2": "lt2",
    "tx1": "dk1",
    "bg1": "lt1",
    "tx2": "dk2",
    "bg2": "lt2",
    "accent1": "accent1",
    "accent2": "accent2",
    "accent3": "accent3",
    "accent4": "accent4",
    "accent5": "accent5",
    "accent6": "accent6",
    "hyperlink": "hlink",
    "followedhyperlink": "folHlink",
    "hlink": "hlink",
    "folhlink": "folHlink",
}

# Paleta indexada estándar de Excel (ECMA-376 §18.8.27)
_XL_INDEXED_COLORS: Dict[int, str] = {
    0: "#000000", 1: "#FFFFFF", 2: "#FF0000", 3: "#00FF00", 4: "#0000FF",
    5: "#FFFF00", 6: "#FF00FF", 7: "#00FFFF", 8: "#000000", 9: "#FFFFFF",
    10: "#FF0000", 11: "#00FF00", 12: "#0000FF", 13: "#FFFF00", 14: "#FF00FF",
    15: "#00FFFF", 16: "#800000", 17: "#008000", 18: "#000080", 19: "#808000",
    20: "#800080", 21: "#008080", 22: "#C0C0C0", 23: "#808080", 24: "#9999FF",
    25: "#993366", 26: "#FFFFCC", 27: "#CCFFFF", 28: "#660066", 29: "#FF8080",
    30: "#0066CC", 31: "#CCCCFF", 32: "#000080", 33: "#FF00FF", 34: "#FFFF00",
    35: "#00FFFF", 36: "#800080", 37: "#800000", 38: "#008080", 39: "#0000FF",
    40: "#00CCFF", 41: "#CCFFFF", 42: "#CCFFCC", 43: "#FFFF99", 44: "#99CCFF",
    45: "#FF99CC", 46: "#CC99FF", 47: "#FFCC99", 48: "#3366FF", 49: "#33CCCC",
    50: "#99CC00", 51: "#FFCC00", 52: "#FF9900", 53: "#FF6600", 54: "#666699",
    55: "#969696", 56: "#003366", 57: "#339966", 58: "#003300", 59: "#333300",
    60: "#993300", 61: "#993366", 62: "#333399", 63: "#333333",
}

# Formatos numéricos integrados de Excel (ECMA-376 §18.8.30)
_BUILTIN_XL_NUMFMTS: Dict[int, str] = {
    0: "General",
    1: "0",
    2: "0.00",
    3: "#,##0",
    4: "#,##0.00",
    5: "$#,##0;($#,##0)",
    6: "$#,##0;[Red]($#,##0)",
    7: "$#,##0.00;($#,##0.00)",
    8: "$#,##0.00;[Red]($#,##0.00)",
    9: "0%",
    10: "0.00%",
    11: "0.00E+00",
    14: "mm-dd-yy",
    15: "d-mmm-yy",
    16: "d-mmm",
    17: "mmm-yy",
    22: "m/d/yy h:mm",
    37: "#,##0;(#,##0)",
    38: "#,##0;[Red](#,##0)",
    39: "#,##0.00;(#,##0.00)",
    40: "#,##0.00;[Red](#,##0.00)",
    41: "$#,##0",
    42: "$#,##0",
    43: "$#,##0.00",
    44: "$#,##0.00",
}

_TOTAL_LABEL_RE = re.compile(
    r"^\s*(?:total(?:es)?|subtotal|gran\s+total|suma(?:\s+total)?|grand\s+total|"
    r"net\s+total|resumen\s+total|importe\s+total)\b",
    re.IGNORECASE,
)
_FORMULA_FUNC_RE = re.compile(r"(?:_xlfn\.|_xlnm\.)?([A-Za-z][A-Za-z0-9_.]{1,24})\s*\(")
_CELL_REF_RE = re.compile(r"^([A-Za-z]+)(\d+)$")


# ---------------------------------------------------------------------------
# Utilidades XML, colores OOXML y extracción segura de logotipos
# ---------------------------------------------------------------------------


def _local_tag(tag: str) -> str:
    if "}" in tag:
        return tag.split("}", 1)[1]
    return tag


def _get_attr(elem: ET.Element, local_name: str, default: Optional[str] = None) -> Optional[str]:
    if local_name in elem.attrib:
        return elem.attrib[local_name]
    for k, v in elem.attrib.items():
        if _local_tag(k) == local_name:
            return v
    return default


def _find_child(elem: ET.Element, local_name: str) -> Optional[ET.Element]:
    for child in elem:
        if _local_tag(child.tag) == local_name:
            return child
    return None


def _find_children(elem: ET.Element, local_name: str) -> List[ET.Element]:
    return [child for child in elem if _local_tag(child.tag) == local_name]


def _iter_local(elem: ET.Element, local_name: str):
    for node in elem.iter():
        if _local_tag(node.tag) == local_name:
            yield node


def _read_zip_xml(zf: zipfile.ZipFile, member: str) -> Optional[ET.Element]:
    try:
        info = zf.getinfo(member)
    except KeyError:
        return None
    if info.file_size > _MAX_XML_BYTES:
        return None
    try:
        raw = zf.read(member)
        return ET.fromstring(raw)
    except Exception:
        return None


def _safe_int(val: Any, default: Optional[int] = None) -> Optional[int]:
    if val is None:
        return default
    try:
        return int(round(float(str(val).strip())))
    except (TypeError, ValueError):
        return default


def _safe_float(val: Any, default: Optional[float] = None) -> Optional[float]:
    if val is None:
        return default
    try:
        num = float(str(val).strip())
        return num if math.isfinite(num) else default
    except (TypeError, ValueError):
        return default


def _xml_bool_on(elem: Optional[ET.Element], default: bool = False) -> bool:
    """Evalúa etiquetas booleanas OOXML como `<w:b/>`, `<w:caps w:val='0'/>`, `<b/>`."""
    if elem is None:
        return default
    val = _get_attr(elem, "val")
    if val is None:
        return True
    low = val.strip().lower()
    return low not in ("0", "false", "off", "none")


def _ooxml_rgb_to_hex(raw: Optional[str]) -> Optional[str]:
    """Convierte colores OOXML (`AARRGGBB`, `RRGGBB`, `#RRGGBB`) a `#RRGGBB`."""
    if not raw or not isinstance(raw, str):
        return None
    s = raw.strip().lstrip("#")
    low = s.lower()
    if not s or low in ("auto", "none", "nil", "transparent"):
        return None
    if len(s) == 8 and re.fullmatch(r"[0-9a-fA-F]{8}", s):
        if s == "00000000":
            return None
        return f"#{s[2:8].upper()}"
    if len(s) == 6 and re.fullmatch(r"[0-9a-fA-F]{6}", s):
        return f"#{s.upper()}"
    if len(s) == 3 and re.fullmatch(r"[0-9a-fA-F]{3}", s):
        return f"#{''.join(ch * 2 for ch in s).upper()}"
    return None


def _apply_xl_tint(hex_color: str, tint: float) -> str:
    """Aplica la fórmula oficial ECMA-376 de `tint` sobre un color RGB en espacio HLS."""
    if abs(tint) < 1e-6:
        return hex_color
    r, g, b = [c / 255.0 for c in _hex_to_rgb(hex_color)]
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    if tint < 0.0:
        l_new = l * (1.0 + tint)
    else:
        l_new = l * (1.0 - tint) + tint
    l_new = max(0.0, min(1.0, l_new))
    nr, ng, nb = colorsys.hls_to_rgb(h, l_new, s)
    return _rgb_to_hex(nr * 255.0, ng * 255.0, nb * 255.0)


def _apply_word_tint_shade(
    hex_color: str,
    tint_hex: Optional[str] = None,
    shade_hex: Optional[str] = None,
) -> str:
    r, g, b = _hex_to_rgb(hex_color)
    if tint_hex and re.fullmatch(r"[0-9a-fA-F]{2}", tint_hex.strip()):
        t = int(tint_hex.strip(), 16) / 255.0
        r = int(round(r * t + 255.0 * (1.0 - t)))
        g = int(round(g * t + 255.0 * (1.0 - t)))
        b = int(round(b * t + 255.0 * (1.0 - t)))
    if shade_hex and re.fullmatch(r"[0-9a-fA-F]{2}", shade_hex.strip()):
        s = int(shade_hex.strip(), 16) / 255.0
        r = int(round(r * s))
        g = int(round(g * s))
        b = int(round(b * s))
    return _rgb_to_hex(r, g, b)


def _parse_ooxml_theme(zf: zipfile.ZipFile, theme_path: str) -> Dict[str, Any]:
    """Extrae `a:clrScheme` y `a:fontScheme` de `*/theme/theme1.xml`."""
    colors: Dict[str, str] = dict(_DEFAULT_THEME_COLORS)
    major_font = ""
    minor_font = ""
    has_theme = False

    root = _read_zip_xml(zf, theme_path)
    if root is None:
        return {
            "colors": colors,
            "major_font": major_font,
            "minor_font": minor_font,
            "has_theme": False,
        }

    has_theme = True
    for clr_scheme in _iter_local(root, "clrScheme"):
        for slot in clr_scheme:
            slot_name = _local_tag(slot.tag)
            srgb = _find_child(slot, "srgbClr")
            if srgb is not None:
                hx = _ooxml_rgb_to_hex(_get_attr(srgb, "val"))
                if hx:
                    colors[slot_name] = hx
                    continue
            sys_clr = _find_child(slot, "sysClr")
            if sys_clr is not None:
                hx = _ooxml_rgb_to_hex(_get_attr(sys_clr, "lastClr"))
                if not hx:
                    sys_val = (_get_attr(sys_clr, "val") or "").lower()
                    if sys_val == "windowtext":
                        hx = "#000000"
                    elif sys_val == "window":
                        hx = "#FFFFFF"
                if hx:
                    colors[slot_name] = hx
        break

    for font_scheme in _iter_local(root, "fontScheme"):
        maj = _find_child(font_scheme, "majorFont")
        if maj is not None:
            latin = _find_child(maj, "latin")
            if latin is not None:
                tf = (_get_attr(latin, "typeface") or "").strip()
                if tf and not tf.startswith("+"):
                    major_font = tf
        mn = _find_child(font_scheme, "minorFont")
        if mn is not None:
            latin = _find_child(mn, "latin")
            if latin is not None:
                tf = (_get_attr(latin, "typeface") or "").strip()
                if tf and not tf.startswith("+"):
                    minor_font = tf
        break

    return {
        "colors": colors,
        "major_font": major_font,
        "minor_font": minor_font,
        "has_theme": has_theme,
    }


def _resolve_xl_color(elem: Optional[ET.Element], theme_colors: Dict[str, str]) -> Optional[str]:
    if elem is None:
        return None
    auto = _get_attr(elem, "auto")
    if auto and auto.strip().lower() in ("1", "true"):
        return None

    base: Optional[str] = None
    rgb_attr = _get_attr(elem, "rgb")
    if rgb_attr:
        base = _ooxml_rgb_to_hex(rgb_attr)

    if base is None:
        theme_attr = _get_attr(elem, "theme")
        if theme_attr is not None:
            t_idx = _safe_int(theme_attr)
            if t_idx is not None and t_idx in _XL_THEME_INDEX_MAP:
                slot = _XL_THEME_INDEX_MAP[t_idx]
                base = theme_colors.get(slot) or _DEFAULT_THEME_COLORS.get(slot)

    if base is None:
        idx_attr = _get_attr(elem, "indexed")
        if idx_attr is not None:
            i_val = _safe_int(idx_attr)
            if i_val is not None and i_val in _XL_INDEXED_COLORS:
                base = _XL_INDEXED_COLORS[i_val]

    if base is None:
        return None

    tint_attr = _get_attr(elem, "tint")
    if tint_attr is not None:
        tint_val = _safe_float(tint_attr)
        if tint_val is not None and -1.0 <= tint_val <= 1.0:
            base = _apply_xl_tint(base, tint_val)

    return base


def _resolve_word_color(
    val: Optional[str],
    theme_color: Optional[str],
    theme_tint: Optional[str],
    theme_shade: Optional[str],
    theme_colors: Dict[str, str],
) -> Optional[str]:
    direct = _ooxml_rgb_to_hex(val)
    if direct:
        return direct
    if theme_color:
        slot = _WORD_THEME_COLOR_MAP.get(theme_color.strip().lower())
        if slot and slot in theme_colors:
            return _apply_word_tint_shade(theme_colors[slot], theme_tint, theme_shade)
    return None


def _resolve_drawing_fill_color(elem: ET.Element, theme_colors: Dict[str, str]) -> Optional[str]:
    """Resuelve `<a:solidFill>` (usado en PPTX y gráficos DrawingML)."""
    srgb = _find_child(elem, "srgbClr")
    if srgb is not None:
        base = _ooxml_rgb_to_hex(_get_attr(srgb, "val"))
        if base:
            return _apply_drawing_color_mods(base, srgb)
    scheme = _find_child(elem, "schemeClr")
    if scheme is not None:
        sval = (_get_attr(scheme, "val") or "").strip().lower()
        slot = _WORD_THEME_COLOR_MAP.get(sval, sval)
        base = theme_colors.get(slot)
        if base:
            return _apply_drawing_color_mods(base, scheme)
    return None


def _apply_drawing_color_mods(base_hex: str, clr_elem: ET.Element) -> str:
    lum_mod = _find_child(clr_elem, "lumMod")
    lum_off = _find_child(clr_elem, "lumOff")
    tint_el = _find_child(clr_elem, "tint")
    shade_el = _find_child(clr_elem, "shade")
    if lum_mod is None and lum_off is None and tint_el is None and shade_el is None:
        return base_hex
    r, g, b = [c / 255.0 for c in _hex_to_rgb(base_hex)]
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    if lum_mod is not None:
        m = _safe_float(_get_attr(lum_mod, "val"))
        if m is not None:
            l = l * (m / 100000.0)
    if lum_off is not None:
        o = _safe_float(_get_attr(lum_off, "val"))
        if o is not None:
            l = l + (o / 100000.0)
    if tint_el is not None:
        tv = _safe_float(_get_attr(tint_el, "val"))
        if tv is not None:
            f = tv / 100000.0
            l = l * f + (1.0 - f)
    if shade_el is not None:
        sv = _safe_float(_get_attr(shade_el, "val"))
        if sv is not None:
            l = l * (sv / 100000.0)
    l = max(0.0, min(1.0, l))
    nr, ng, nb = colorsys.hls_to_rgb(h, l, s)
    return _rgb_to_hex(nr * 255.0, ng * 255.0, nb * 255.0)


def _extract_ooxml_logo(
    zf: zipfile.ZipFile,
    media_prefix: str,
    assets_dir: Path,
    *,
    preferred_members: Optional[Sequence[str]] = None,
) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    """
    Extrae de forma segura un logotipo candidato desde `<prefix>/media/*` como PNG
    acotado dentro de `assets_dir`. Valida dimensiones/peso con Pillow y escribe
    atómicamente sin guardar nunca capturas de página completa.
    """
    all_names = set(zf.namelist())
    ordered_candidates: List[str] = []
    seen: Set[str] = set()

    for pref in preferred_members or []:
        norm = pref.lstrip("/")
        if norm in all_names and norm not in seen:
            seen.add(norm)
            ordered_candidates.append(norm)

    for name in sorted(all_names):
        if name.startswith(media_prefix) and name not in seen:
            ext = Path(name).suffix.lower()
            if ext in _IMAGE_EXTS:
                seen.add(name)
                ordered_candidates.append(name)

    if not ordered_candidates:
        return [], None

    best_pil: Optional[Image.Image] = None
    for member in ordered_candidates[:16]:
        ext = Path(member).suffix.lower()
        if ext not in _IMAGE_EXTS:
            continue
        try:
            info = zf.getinfo(member)
            if info.file_size <= 0 or info.file_size > _MAX_MEDIA_BYTES:
                continue
            raw_bytes = zf.read(member)
            with Image.open(io.BytesIO(raw_bytes)) as opened:
                opened.load()
                iw, ih = opened.size
                if iw < 24 or ih < 16 or iw > 2400 or ih > 1400:
                    continue
                if iw >= 1400 and ih >= 1100:
                    continue
                ratio = iw / max(1.0, float(ih))
                if not (0.25 <= ratio <= 9.0):
                    continue
                if opened.mode in ("RGB", "RGBA"):
                    best_pil = opened.copy()
                elif opened.mode in ("LA", "PA", "P"):
                    best_pil = opened.convert("RGBA")
                else:
                    best_pil = opened.convert("RGB")
                break
        except Exception:
            continue

    if best_pil is None:
        return [], None

    if max(best_pil.width, best_pil.height) > _MAX_ASSET_DIM_PX:
        scale = _MAX_ASSET_DIM_PX / float(max(best_pil.width, best_pil.height))
        new_sz = (
            max(1, int(round(best_pil.width * scale))),
            max(1, int(round(best_pil.height * scale))),
        )
        resampling = Image.Resampling.LANCZOS if hasattr(Image, "Resampling") else Image.LANCZOS
        best_pil = best_pil.resize(new_sz, resampling)

    buf = io.BytesIO()
    best_pil.save(buf, format="PNG", optimize=True)
    png_bytes = buf.getvalue()
    if len(png_bytes) > _MAX_ASSET_BYTES:
        resampling = Image.Resampling.LANCZOS if hasattr(Image, "Resampling") else Image.LANCZOS
        best_pil = best_pil.resize(
            (max(1, best_pil.width // 2), max(1, best_pil.height // 2)),
            resampling,
        )
        buf = io.BytesIO()
        best_pil.save(buf, format="PNG", optimize=True)
        png_bytes = buf.getvalue()
        if len(png_bytes) > _MAX_ASSET_BYTES:
            return [], None

    assets_dir = Path(assets_dir)
    assets_dir.mkdir(parents=True, exist_ok=True)
    rel_prefix = assets_dir.name if re.fullmatch(r"[A-Za-z0-9._-]+", assets_dir.name) else "assets"
    filename = "logo.png"
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
    return (
        [
            {
                "role": "header_logo",
                "relative_path": rel_path,
                "path": str(dest),
                "width_px": best_pil.width,
                "height_px": best_pil.height,
            }
        ],
        rel_path,
    )


def _is_encrypted_ole2(file_path: Path) -> bool:
    try:
        with file_path.open("rb") as fh:
            return fh.read(8) == _OLE2_MAGIC
    except Exception:
        return False


def _parse_rels_map(zf: zipfile.ZipFile, rels_path: str, base_dir: str) -> Dict[str, str]:
    root = _read_zip_xml(zf, rels_path)
    out: Dict[str, str] = {}
    if root is None:
        return out
    for rel in _iter_local(root, "Relationship"):
        rid = _get_attr(rel, "Id") or ""
        target = (_get_attr(rel, "Target") or "").strip()
        if not rid or not target or target.startswith("http://") or target.startswith("https://"):
            continue
        if target.startswith("/"):
            resolved = target.lstrip("/")
        else:
            parts: List[str] = [p for p in base_dir.split("/") if p]
            for seg in target.split("/"):
                if not seg or seg == ".":
                    continue
                if seg == "..":
                    if parts:
                        parts.pop()
                else:
                    parts.append(seg)
            resolved = "/".join(parts)
        out[rid] = resolved
    return out


# ---------------------------------------------------------------------------
# Inspección profunda de Word (`.docx`)
# ---------------------------------------------------------------------------


def _normalize_word_jc(val: Optional[str]) -> Optional[str]:
    if not val:
        return None
    low = val.strip().lower()
    if low in ("both", "distribute", "thaidistribute"):
        return "justify"
    if low in ("center",):
        return "center"
    if low in ("right", "end"):
        return "right"
    if low in ("left", "start"):
        return "left"
    return None


def _parse_word_rpr(
    rpr: Optional[ET.Element],
    theme_colors: Dict[str, str],
    major_font: str,
    minor_font: str,
) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    if rpr is None:
        return out

    rfonts = _find_child(rpr, "rFonts")
    if rfonts is not None:
        font = (
            _get_attr(rfonts, "ascii")
            or _get_attr(rfonts, "hAnsi")
            or _get_attr(rfonts, "cs")
        )
        if not font:
            theme_f = (_get_attr(rfonts, "asciiTheme") or _get_attr(rfonts, "hAnsiTheme") or "").lower()
            if "major" in theme_f and major_font:
                font = major_font
            elif "minor" in theme_f and minor_font:
                font = minor_font
        if font and font.strip():
            out["font"] = font.strip()

    sz = _find_child(rpr, "sz")
    if sz is not None:
        half_pts = _safe_float(_get_attr(sz, "val"))
        if half_pts is not None and half_pts > 0:
            out["size"] = round(half_pts / 2.0, 1)

    color_el = _find_child(rpr, "color")
    if color_el is not None:
        hx = _resolve_word_color(
            _get_attr(color_el, "val"),
            _get_attr(color_el, "themeColor"),
            _get_attr(color_el, "themeTint"),
            _get_attr(color_el, "themeShade"),
            theme_colors,
        )
        if hx:
            out["color"] = hx

    b_el = _find_child(rpr, "b")
    if b_el is not None:
        out["bold"] = _xml_bool_on(b_el)

    caps_el = _find_child(rpr, "caps")
    if caps_el is not None:
        out["caps"] = _xml_bool_on(caps_el)

    shd_el = _find_child(rpr, "shd")
    if shd_el is not None:
        fill = _resolve_word_color(
            _get_attr(shd_el, "fill"),
            _get_attr(shd_el, "themeFill"),
            _get_attr(shd_el, "themeFillTint"),
            _get_attr(shd_el, "themeFillShade"),
            theme_colors,
        )
        if fill:
            out["shd_fill"] = fill

    return out


def _parse_word_ppr(
    ppr: Optional[ET.Element],
    theme_colors: Dict[str, str],
) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    if ppr is None:
        return out

    jc_el = _find_child(ppr, "jc")
    if jc_el is not None:
        al = _normalize_word_jc(_get_attr(jc_el, "val"))
        if al:
            out["align"] = al

    spacing_el = _find_child(ppr, "spacing")
    if spacing_el is not None:
        after_twips = _safe_float(_get_attr(spacing_el, "after"))
        if after_twips is not None and after_twips >= 0:
            out["space_after"] = round(after_twips / 20.0, 1)
        line_val = _safe_float(_get_attr(spacing_el, "line"))
        line_rule = (_get_attr(spacing_el, "lineRule") or "auto").strip().lower()
        if line_val is not None and line_val > 0:
            out["line_val"] = line_val
            out["line_rule"] = line_rule

    shd_el = _find_child(ppr, "shd")
    if shd_el is not None:
        fill = _resolve_word_color(
            _get_attr(shd_el, "fill"),
            _get_attr(shd_el, "themeFill"),
            _get_attr(shd_el, "themeFillTint"),
            _get_attr(shd_el, "themeFillShade"),
            theme_colors,
        )
        if fill:
            out["shd_fill"] = fill

    pbdr_el = _find_child(ppr, "pBdr")
    if pbdr_el is not None:
        for side in ("bottom", "left", "top", "right"):
            s_el = _find_child(pbdr_el, side)
            if s_el is not None:
                bval = (_get_attr(s_el, "val") or "").strip().lower()
                if bval and bval not in ("none", "nil"):
                    out[f"border_{side}"] = True
                    bcol = _resolve_word_color(
                        _get_attr(s_el, "color"),
                        _get_attr(s_el, "themeColor"),
                        _get_attr(s_el, "themeTint"),
                        _get_attr(s_el, "themeShade"),
                        theme_colors,
                    )
                    if bcol:
                        out[f"border_{side}_color"] = bcol

    return out


def _compute_word_leading(style_props: Dict[str, Any], font_size: float, default_ratio: float = 1.4) -> float:
    line_val = style_props.get("line_val")
    line_rule = style_props.get("line_rule") or "auto"
    if line_val is not None:
        if line_rule in ("exact", "atleast"):
            return round(max(font_size * 1.08, min(40.0, float(line_val) / 20.0)), 1)
        mult = max(0.95, min(2.6, float(line_val) / 240.0))
        return round(max(font_size * 1.1, min(40.0, font_size * mult * 1.2)), 1)
    return round(font_size * default_ratio, 1)


def _heading_decoration_from_props(props: Dict[str, Any], page_bg: str) -> str:
    shd = props.get("shd_fill")
    if shd and _color_distance(shd, page_bg) > 14:
        return "band"
    if props.get("border_left"):
        return "left_bar"
    if props.get("border_bottom"):
        return "underline"
    return "plain"


def _parse_docx_styles(
    zf: zipfile.ZipFile,
    theme_colors: Dict[str, str],
    major_font: str,
    minor_font: str,
) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, str]]:
    """
    Parsea `word/styles.xml` resolviendo herencia (`docDefaults` + `basedOn`) y
    identifica los `styleId` reales de `body`, `h1`, `h2`, `h3`, `title`.
    """
    root = _read_zip_xml(zf, "word/styles.xml")
    if root is None:
        return {}, {"h1": "Heading1", "h2": "Heading2", "h3": "Heading3", "body": "Normal"}

    doc_defaults: Dict[str, Any] = {}
    dd_el = _find_child(root, "docDefaults")
    if dd_el is not None:
        rdef = _find_child(dd_el, "rPrDefault")
        if rdef is not None:
            doc_defaults.update(_parse_word_rpr(_find_child(rdef, "rPr"), theme_colors, major_font, minor_font))
        pdef = _find_child(dd_el, "pPrDefault")
        if pdef is not None:
            doc_defaults.update(_parse_word_ppr(_find_child(pdef, "pPr"), theme_colors))

    raw_styles: Dict[str, Dict[str, Any]] = {}
    style_meta: Dict[str, Dict[str, Any]] = {}
    for st in _find_children(root, "style"):
        sid = _get_attr(st, "styleId") or ""
        if not sid:
            continue
        stype = (_get_attr(st, "type") or "paragraph").lower()
        name_el = _find_child(st, "name")
        sname = (_get_attr(name_el, "val") if name_el is not None else "") or sid
        based_el = _find_child(st, "basedOn")
        based_on = (_get_attr(based_el, "val") if based_el is not None else "") or ""

        props: Dict[str, Any] = {}
        props.update(_parse_word_ppr(_find_child(st, "pPr"), theme_colors))
        props.update(_parse_word_rpr(_find_child(st, "rPr"), theme_colors, major_font, minor_font))
        raw_styles[sid] = props
        style_meta[sid] = {
            "name": sname,
            "type": stype,
            "based_on": based_on,
            "is_default": _get_attr(st, "default") in ("1", "true"),
        }

    resolved: Dict[str, Dict[str, Any]] = {}

    def _resolve(sid: str, depth: int = 0) -> Dict[str, Any]:
        if sid in resolved:
            return resolved[sid]
        if depth > 12 or sid not in raw_styles:
            return dict(doc_defaults)
        parent_id = style_meta[sid]["based_on"]
        base = dict(_resolve(parent_id, depth + 1)) if parent_id and parent_id != sid else dict(doc_defaults)
        base.update(raw_styles[sid])
        resolved[sid] = base
        return base

    for sid in raw_styles:
        _resolve(sid)

    role_ids: Dict[str, str] = {"h1": "Heading1", "h2": "Heading2", "h3": "Heading3", "body": "Normal"}
    found_roles: Set[str] = set()

    for sid, meta in style_meta.items():
        if meta["type"] != "paragraph":
            continue
        low_id = sid.lower().replace(" ", "")
        low_name = meta["name"].lower().replace(" ", "")
        if "body" not in found_roles and (low_id == "normal" or low_name == "normal" or meta["is_default"]):
            role_ids["body"] = sid
            found_roles.add("body")
        elif "h1" not in found_roles and (
            low_id in ("heading1", "ttulo1", "titulo1", "h1")
            or low_name in ("heading1", "título1", "titulo1")
        ):
            role_ids["h1"] = sid
            found_roles.add("h1")
        elif "h2" not in found_roles and (
            low_id in ("heading2", "ttulo2", "titulo2", "h2")
            or low_name in ("heading2", "título2", "titulo2")
        ):
            role_ids["h2"] = sid
            found_roles.add("h2")
        elif "h3" not in found_roles and (
            low_id in ("heading3", "ttulo3", "titulo3", "h3")
            or low_name in ("heading3", "título3", "titulo3")
        ):
            role_ids["h3"] = sid
            found_roles.add("h3")
        elif "title" not in found_roles and (low_id == "title" or low_name in ("title", "título", "titulo")):
            role_ids["title"] = sid
            found_roles.add("title")

    return resolved, role_ids


def _parse_docx_hf_part(
    zf: zipfile.ZipFile,
    xml_path: str,
    theme_colors: Dict[str, str],
    *,
    is_footer: bool,
) -> Dict[str, Any]:
    """Inspecciona `word/header*.xml` o `word/footer*.xml` sin filtrar PII."""
    root = _read_zip_xml(zf, xml_path)
    if root is None:
        return {"has_content": False}

    slots: Dict[str, List[str]] = {"left": [], "center": [], "right": []}
    used_tokens: Set[str] = set()
    border_active = False
    border_color: Optional[str] = None
    background_hex: Optional[str] = None
    has_drawing = False
    logo_pos = "left"
    logo_height_pt = 24.0
    preferred_logo_rids: List[str] = []

    def _analyze_fields_and_text(elem: ET.Element) -> Tuple[str, Set[str]]:
        texts: List[str] = []
        fields: Set[str] = set()
        for node in elem.iter():
            tag = _local_tag(node.tag)
            if tag == "t" and node.text:
                texts.append(node.text)
            elif tag == "instrText" and node.text:
                up = node.text.upper()
                for fld in ("NUMPAGES", "PAGE", "DATE", "TITLE", "AUTHOR"):
                    if fld in up:
                        fields.add(fld)
            elif tag == "fldSimple":
                instr = (_get_attr(node, "instr") or "").upper()
                for fld in ("NUMPAGES", "PAGE", "DATE", "TITLE", "AUTHOR"):
                    if fld in instr:
                        fields.add(fld)
            elif tag == "blip":
                rid = _get_attr(node, "embed") or _get_attr(node, "link")
                if rid:
                    preferred_logo_rids.append(rid)
            elif tag == "extent":
                cy = _safe_float(_get_attr(node, "cy"))
                if cy and cy > 0:
                    nonlocal logo_height_pt
                    logo_height_pt = round(max(12.0, min(64.0, cy / 12700.0)), 1)
        return " ".join("".join(texts).split()).strip(), fields

    def _slot_token(raw_txt: str, fields: Set[str], slot: str) -> str:
        low = raw_txt.lower()
        if "PAGE" in fields and "NUMPAGES" in fields:
            if "page" in low and "of" in low:
                return "Page {page} of {total}"
            if "/" in raw_txt and "pág" not in low and "pag" not in low:
                return "{page} / {total}"
            return "Página {page} de {total}"
        if "PAGE" in fields:
            if "page" in low:
                return "Page {page}"
            return "Página {page}"
        if "DATE" in fields:
            used_tokens.add("{date}")
            return "{date}"
        if "TITLE" in fields:
            used_tokens.add("{title}")
            return "{title}"
        if "AUTHOR" in fields:
            used_tokens.add("{author}")
            return "{author}"
        if not raw_txt:
            return ""
        return _tokenize_running_text(
            raw_txt,
            is_footer=is_footer,
            page_num=2,
            slot=slot,
            used_tokens=used_tokens,
        )

    tables = _find_children(root, "tbl")
    if tables:
        tbl = tables[0]
        for bnode in _iter_local(tbl, "bottom" if not is_footer else "top"):
            bval = (_get_attr(bnode, "val") or "").strip().lower()
            if bval and bval not in ("none", "nil"):
                border_active = True
                border_color = border_color or _resolve_word_color(
                    _get_attr(bnode, "color"),
                    _get_attr(bnode, "themeColor"),
                    _get_attr(bnode, "themeTint"),
                    _get_attr(bnode, "themeShade"),
                    theme_colors,
                )
        for tr in _find_children(tbl, "tr"):
            tcs = _find_children(tr, "tc")
            n_cols = len(tcs)
            for idx, tc in enumerate(tcs):
                if n_cols == 1:
                    slot = "left"
                elif n_cols == 2:
                    slot = "left" if idx == 0 else "right"
                else:
                    slot = "left" if idx == 0 else ("right" if idx == n_cols - 1 else "center")
                tcpr = _find_child(tc, "tcPr")
                if tcpr is not None:
                    shd = _find_child(tcpr, "shd")
                    if shd is not None and not background_hex:
                        fill = _resolve_word_color(
                            _get_attr(shd, "fill"),
                            _get_attr(shd, "themeFill"),
                            _get_attr(shd, "themeFillTint"),
                            _get_attr(shd, "themeFillShade"),
                            theme_colors,
                        )
                        if fill and _color_distance(fill, "#FFFFFF") > 14:
                            background_hex = fill
                if any(_local_tag(n.tag) in ("drawing", "pict") for n in tc.iter()):
                    has_drawing = True
                    logo_pos = slot
                raw_txt, fields = _analyze_fields_and_text(tc)
                tok = _slot_token(raw_txt, fields, slot)
                if tok:
                    slots[slot].append(tok)

    for p in _find_children(root, "p"):
        ppr = _find_child(p, "pPr")
        pprops = _parse_word_ppr(ppr, theme_colors)
        align = pprops.get("align") or "left"
        slot = align if align in ("left", "center", "right") else "left"

        if not is_footer and pprops.get("border_bottom"):
            border_active = True
            border_color = border_color or pprops.get("border_bottom_color")
        elif is_footer and pprops.get("border_top"):
            border_active = True
            border_color = border_color or pprops.get("border_top_color")

        if pprops.get("shd_fill") and not background_hex and _color_distance(pprops["shd_fill"], "#FFFFFF") > 14:
            background_hex = pprops["shd_fill"]

        if any(_local_tag(n.tag) in ("drawing", "pict") for n in p.iter()):
            has_drawing = True
            logo_pos = slot
            for node in p.iter():
                tag = _local_tag(node.tag)
                if tag == "blip":
                    rid = _get_attr(node, "embed") or _get_attr(node, "link")
                    if rid and rid not in preferred_logo_rids:
                        preferred_logo_rids.append(rid)
                elif tag == "extent":
                    cy = _safe_float(_get_attr(node, "cy"))
                    if cy and cy > 0:
                        logo_height_pt = round(max(12.0, min(64.0, cy / 12700.0)), 1)

        has_tabs = any(_local_tag(n.tag) == "tab" for n in p.iter())
        if has_tabs:
            segments: List[Tuple[str, Set[str]]] = []
            cur_texts: List[str] = []
            cur_fields: Set[str] = set()
            for node in p.iter():
                tag = _local_tag(node.tag)
                if tag == "tab":
                    segments.append((" ".join("".join(cur_texts).split()).strip(), set(cur_fields)))
                    cur_texts = []
                    cur_fields = set()
                elif tag == "t" and node.text:
                    cur_texts.append(node.text)
                elif tag == "instrText" and node.text:
                    up = node.text.upper()
                    for fld in ("NUMPAGES", "PAGE", "DATE", "TITLE", "AUTHOR"):
                        if fld in up:
                            cur_fields.add(fld)
                elif tag == "fldSimple":
                    instr = (_get_attr(node, "instr") or "").upper()
                    for fld in ("NUMPAGES", "PAGE", "DATE", "TITLE", "AUTHOR"):
                        if fld in instr:
                            cur_fields.add(fld)
            segments.append((" ".join("".join(cur_texts).split()).strip(), set(cur_fields)))
            non_empty_segs = [(i, txt, flds) for i, (txt, flds) in enumerate(segments) if txt or flds]
            if len(segments) >= 3:
                slot_map = {0: "left", 1: "center", 2: "right"}
            elif len(segments) == 2:
                slot_map = {0: "left", 1: "right"}
            else:
                slot_map = {0: slot}
            for seg_idx, txt, flds in non_empty_segs:
                s_key = slot_map.get(min(seg_idx, max(slot_map)), "right")
                tok = _slot_token(txt, flds, s_key)
                if tok:
                    slots[s_key].append(tok)
        else:
            raw_txt, fields = _analyze_fields_and_text(p)
            tok = _slot_token(raw_txt, fields, slot)
            if tok:
                slots[slot].append(tok)

    preferred_media: List[str] = []
    if preferred_logo_rids:
        part_name = Path(xml_path).name
        rels_path = f"word/_rels/{part_name}.rels"
        hf_rels = _parse_rels_map(zf, rels_path, "word")
        for rid in preferred_logo_rids:
            if rid in hf_rels:
                preferred_media.append(hf_rels[rid])

    has_content = bool(
        any(slots[k] for k in ("left", "center", "right"))
        or border_active
        or background_hex
        or has_drawing
    )
    return {
        "has_content": has_content,
        "left": slots["left"][0] if slots["left"] else "",
        "center": slots["center"][0] if slots["center"] else "",
        "right": slots["right"][0] if slots["right"] else "",
        "border": border_active,
        "border_color": border_color,
        "background_hex": background_hex,
        "has_drawing": has_drawing,
        "logo_position": logo_pos,
        "logo_height_pt": logo_height_pt,
        "preferred_media": preferred_media,
    }


def _inspect_docx(
    file_path: Path,
    *,
    extract_assets: bool = False,
    assets_dir: Optional[Path] = None,
) -> Dict[str, Any]:
    if _is_encrypted_ole2(file_path):
        return {
            "ok": False,
            "error": "El archivo Word (.docx) está protegido con contraseña o cifrado y no se puede inspeccionar.",
        }

    warnings: List[str] = []
    try:
        zf_ctx = zipfile.ZipFile(file_path, "r")
    except Exception as exc:
        return {"ok": False, "error": f"No se pudo abrir el documento Word ({exc})."}

    with zf_ctx as zf:
        doc_root = _read_zip_xml(zf, "word/document.xml")
        if doc_root is None:
            return {"ok": False, "error": "El archivo .docx no contiene un word/document.xml válido."}

        theme = _parse_ooxml_theme(zf, "word/theme/theme1.xml")
        theme_colors: Dict[str, str] = theme["colors"]
        major_font: str = theme["major_font"]
        minor_font: str = theme["minor_font"]

        styles, role_ids = _parse_docx_styles(zf, theme_colors, major_font, minor_font)
        doc_rels = _parse_rels_map(zf, "word/_rels/document.xml.rels", "word")

        page_bg = "#FFFFFF"
        bg_el = _find_child(doc_root, "background")
        if bg_el is not None:
            bg_col = _resolve_word_color(
                _get_attr(bg_el, "color"),
                _get_attr(bg_el, "themeColor"),
                _get_attr(bg_el, "themeTint"),
                _get_attr(bg_el, "themeShade"),
                theme_colors,
            )
            if bg_col:
                page_bg = bg_col
        is_dark_page = _luminance(page_bg) < 0.22

        body = _find_child(doc_root, "body") or doc_root

        all_sect_prs = list(_iter_local(body, "sectPr"))
        section_break_pages = len(all_sect_prs) > 1
        primary_sect = _find_child(body, "sectPr") or (all_sect_prs[-1] if all_sect_prs else None)

        page_w = 612.0
        page_h = 792.0
        orientation = "portrait"
        margins_pt = {"top": 58.0, "right": 56.0, "bottom": 52.0, "left": 56.0}
        columns = 1
        column_gap_pt = 18.0
        border_enabled = False
        border_color = "#CBD5E1" if not is_dark_page else "#334155"
        border_width = 0.75
        border_inset = 18.0
        different_first_page = False
        header_refs: Dict[str, str] = {}
        footer_refs: Dict[str, str] = {}
        header_dist_pt = 28.0
        footer_dist_pt = 26.0

        if primary_sect is not None:
            pgsz = _find_child(primary_sect, "pgSz")
            if pgsz is not None:
                w_tw = _safe_float(_get_attr(pgsz, "w"))
                h_tw = _safe_float(_get_attr(pgsz, "h"))
                if w_tw and w_tw > 0:
                    page_w = round(w_tw / 20.0, 2)
                if h_tw and h_tw > 0:
                    page_h = round(h_tw / 20.0, 2)
                orient_attr = (_get_attr(pgsz, "orient") or "").strip().lower()
                if orient_attr == "landscape" or page_w > page_h:
                    orientation = "landscape"
                    if page_w < page_h:
                        page_w, page_h = page_h, page_w
                else:
                    orientation = "portrait"

            pgmar = _find_child(primary_sect, "pgMar")
            if pgmar is not None:
                for side in ("top", "right", "bottom", "left"):
                    v_tw = _safe_float(_get_attr(pgmar, side))
                    if v_tw is not None and v_tw > 0:
                        margins_pt[side] = round(v_tw / 20.0, 1)
                hdr_tw = _safe_float(_get_attr(pgmar, "header"))
                ftr_tw = _safe_float(_get_attr(pgmar, "footer"))
                if hdr_tw is not None and hdr_tw > 0:
                    header_dist_pt = round(max(16.0, min(80.0, hdr_tw / 20.0)), 1)
                if ftr_tw is not None and ftr_tw > 0:
                    footer_dist_pt = round(max(16.0, min(80.0, ftr_tw / 20.0)), 1)

            cols_el = _find_child(primary_sect, "cols")
            if cols_el is not None:
                c_num = _safe_int(_get_attr(cols_el, "num"), 1) or 1
                columns = 2 if c_num >= 2 else 1
                c_space = _safe_float(_get_attr(cols_el, "space"))
                if c_space is not None and c_space > 0:
                    column_gap_pt = round(c_space / 20.0, 1)

            pgbdr = _find_child(primary_sect, "pgBorders")
            if pgbdr is not None:
                for side in ("top", "bottom", "left", "right"):
                    s_el = _find_child(pgbdr, side)
                    if s_el is not None:
                        bval = (_get_attr(s_el, "val") or "").strip().lower()
                        if bval and bval not in ("none", "nil"):
                            border_enabled = True
                            bcol = _resolve_word_color(
                                _get_attr(s_el, "color"),
                                _get_attr(s_el, "themeColor"),
                                _get_attr(s_el, "themeTint"),
                                _get_attr(s_el, "themeShade"),
                                theme_colors,
                            )
                            if bcol:
                                border_color = bcol
                            bsz = _safe_float(_get_attr(s_el, "sz"))
                            if bsz is not None and bsz > 0:
                                border_width = round(max(0.25, min(6.0, bsz / 8.0)), 2)
                            bsp = _safe_float(_get_attr(s_el, "space"))
                            if bsp is not None and bsp >= 0:
                                border_inset = round(max(4.0, min(48.0, bsp)), 1)
                            break

            title_pg = _find_child(primary_sect, "titlePg")
            if title_pg is not None and _xml_bool_on(title_pg, True):
                different_first_page = True

            for href in _find_children(primary_sect, "headerReference"):
                htype = (_get_attr(href, "type") or "default").strip().lower()
                rid = _get_attr(href, "id") or ""
                if rid in doc_rels:
                    header_refs[htype] = doc_rels[rid]
            for fref in _find_children(primary_sect, "footerReference"):
                ftype = (_get_attr(fref, "type") or "default").strip().lower()
                rid = _get_attr(fref, "id") or ""
                if rid in doc_rels:
                    footer_refs[ftype] = doc_rels[rid]

        size_name = _detect_page_size_name(page_w, page_h)

        if not header_refs:
            for name in sorted(zf.namelist()):
                if re.fullmatch(r"word/header\d+\.xml", name):
                    header_refs["default"] = name
                    break
        if not footer_refs:
            for name in sorted(zf.namelist()):
                if re.fullmatch(r"word/footer\d+\.xml", name):
                    footer_refs["default"] = name
                    break

        default_hdr_info = (
            _parse_docx_hf_part(zf, header_refs["default"], theme_colors, is_footer=False)
            if "default" in header_refs
            else {"has_content": False}
        )
        first_hdr_info = (
            _parse_docx_hf_part(zf, header_refs["first"], theme_colors, is_footer=False)
            if "first" in header_refs
            else {"has_content": False}
        )
        active_hdr = default_hdr_info if default_hdr_info.get("has_content") else first_hdr_info
        header_enabled = bool(active_hdr.get("has_content"))
        header_skip_first = bool(different_first_page and not first_hdr_info.get("has_content")) if header_enabled else False

        default_ftr_info = (
            _parse_docx_hf_part(zf, footer_refs["default"], theme_colors, is_footer=True)
            if "default" in footer_refs
            else {"has_content": False}
        )
        first_ftr_info = (
            _parse_docx_hf_part(zf, footer_refs["first"], theme_colors, is_footer=True)
            if "first" in footer_refs
            else {"has_content": False}
        )
        active_ftr = default_ftr_info if default_ftr_info.get("has_content") else first_ftr_info
        footer_enabled = bool(active_ftr.get("has_content"))
        footer_skip_first = bool(different_first_page and not first_ftr_info.get("has_content")) if footer_enabled else False

        body_style_id = role_ids.get("body", "Normal")
        h1_style_id = role_ids.get("h1", "Heading1")
        h2_style_id = role_ids.get("h2", "Heading2")
        h3_style_id = role_ids.get("h3", "Heading3")
        title_style_id = role_ids.get("title", "Title")

        body_style = styles.get(body_style_id) or styles.get("Normal") or {}
        h1_style = styles.get(h1_style_id) or {}
        h2_style = styles.get(h2_style_id) or {}
        h3_style = styles.get(h3_style_id) or {}

        body_font_counts: Counter = Counter()
        body_size_counts: Counter = Counter()
        body_color_counts: Counter = Counter()
        body_align_counts: Counter = Counter()
        body_space_afters: List[float] = []
        body_leadings: List[float] = []

        heading_buckets: Dict[str, List[Dict[str, Any]]] = {"h1": [], "h2": [], "h3": []}
        fallback_headings: List[Dict[str, Any]] = []
        raw_lines_for_classify: List[Dict[str, Any]] = []
        chromatic_scores: Dict[str, float] = {}
        neutral_borders: Counter = Counter()

        explicit_page_breaks = 0
        early_cover_signal = False
        para_idx = 0
        total_chars = 0

        has_tables = False
        tbl_head_bgs: Counter = Counter()
        tbl_head_fgs: Counter = Counter()
        tbl_alt_bgs: Counter = Counter()
        tbl_border_colors: Counter = Counter()
        tbl_font_sizes: List[float] = []
        tbl_pad_vs: List[float] = []
        tbl_pad_hs: List[float] = []
        tbl_has_v_borders = 0
        tbl_has_h_borders = 0
        tbl_has_zebra = 0

        for child in list(body):
            ctag = _local_tag(child.tag)
            if ctag == "p":
                para_idx += 1
                ppr = _find_child(child, "pPr")
                pstyle_id = ""
                if ppr is not None:
                    ps_el = _find_child(ppr, "pStyle")
                    if ps_el is not None:
                        pstyle_id = _get_attr(ps_el, "val") or ""
                    if _find_child(ppr, "pageBreakBefore") is not None:
                        explicit_page_breaks += 1
                        if para_idx <= 6:
                            early_cover_signal = True

                for br in _iter_local(child, "br"):
                    if (_get_attr(br, "type") or "").lower() == "page":
                        explicit_page_breaks += 1
                        if para_idx <= 6:
                            early_cover_signal = True
                for _ in _iter_local(child, "lastRenderedPageBreak"):
                    explicit_page_breaks += 1

                eff_props = dict(styles.get(pstyle_id) or body_style)
                inline_ppr = _parse_word_ppr(ppr, theme_colors)
                eff_props.update(inline_ppr)

                run_texts: List[str] = []
                run_fonts: Counter = Counter()
                run_sizes: Counter = Counter()
                run_colors: Counter = Counter()
                bold_chars = 0
                caps_chars = 0
                run_char_total = 0

                for r_el in _find_children(child, "r"):
                    r_txt = "".join((t.text or "") for t in _iter_local(r_el, "t"))
                    if not r_txt:
                        continue
                    run_texts.append(r_txt)
                    n_ch = len(r_txt.strip())
                    if n_ch <= 0:
                        continue
                    run_char_total += n_ch
                    rpr_props = _parse_word_rpr(_find_child(r_el, "rPr"), theme_colors, major_font, minor_font)
                    rf = rpr_props.get("font") or eff_props.get("font") or minor_font
                    rsz = rpr_props.get("size") or eff_props.get("size")
                    rcol = rpr_props.get("color") or eff_props.get("color")
                    rbold = rpr_props.get("bold") if "bold" in rpr_props else eff_props.get("bold", False)
                    rcaps = rpr_props.get("caps") if "caps" in rpr_props else eff_props.get("caps", False)

                    if rf:
                        run_fonts[rf] += n_ch
                    if rsz:
                        run_sizes[rsz] += n_ch
                    if rcol:
                        run_colors[rcol] += n_ch
                    if rbold:
                        bold_chars += n_ch
                    if rcaps:
                        caps_chars += n_ch

                para_text = " ".join("".join(run_texts).split()).strip()
                if not para_text:
                    continue
                total_chars += len(para_text)
                raw_lines_for_classify.append({"text": para_text})

                dom_font = run_fonts.most_common(1)[0][0] if run_fonts else (eff_props.get("font") or minor_font)
                dom_size = run_sizes.most_common(1)[0][0] if run_sizes else eff_props.get("size")
                dom_color = run_colors.most_common(1)[0][0] if run_colors else eff_props.get("color")
                alpha_chars = [ch for ch in para_text if ch.isalpha()]
                text_upper_ratio = (
                    sum(1 for ch in alpha_chars if ch.isupper()) / len(alpha_chars)
                    if alpha_chars
                    else 0.0
                )
                is_caps = (
                    (caps_chars / max(1, run_char_total)) >= 0.55
                    or bool(eff_props.get("caps"))
                    or (len(alpha_chars) >= 4 and text_upper_ratio >= 0.85)
                )

                for bside in ("border_bottom_color", "border_left_color", "shd_fill"):
                    bcol = eff_props.get(bside)
                    if bcol and _color_distance(bcol, page_bg) > 14:
                        if _is_chromatic_accent(bcol):
                            chromatic_scores[bcol] = chromatic_scores.get(bcol, 0.0) + 55.0
                        else:
                            neutral_borders[bcol] += 1

                low_sid = pstyle_id.lower().replace(" ", "")
                tier: Optional[str] = None
                if pstyle_id == h1_style_id or low_sid in ("heading1", "ttulo1", "titulo1", "h1"):
                    tier = "h1"
                elif pstyle_id == h2_style_id or low_sid in ("heading2", "ttulo2", "titulo2", "h2"):
                    tier = "h2"
                elif pstyle_id == h3_style_id or low_sid in ("heading3", "ttulo3", "titulo3", "h3"):
                    tier = "h3"
                elif pstyle_id == title_style_id or low_sid in ("title", "titulo", "ttulo"):
                    if para_idx <= 4:
                        early_cover_signal = True
                    tier = None
                    if dom_color and _is_chromatic_accent(dom_color):
                        chromatic_scores[dom_color] = chromatic_scores.get(dom_color, 0.0) + 45.0

                if tier:
                    heading_buckets[tier].append(
                        {
                            "text": para_text,
                            "font": dom_font,
                            "size": dom_size,
                            "color": dom_color,
                            "uppercase": is_caps,
                            "align": eff_props.get("align") or "left",
                            "decoration": _heading_decoration_from_props(eff_props, page_bg),
                            "char_count": len(para_text),
                        }
                    )
                    if dom_color and _color_distance(dom_color, page_bg) > 14 and _is_chromatic_accent(dom_color):
                        chromatic_scores[dom_color] = chromatic_scores.get(dom_color, 0.0) + len(para_text) * 4.0
                else:
                    if (
                        dom_size is not None
                        and dom_size >= (body_style.get("size") or 10.0) + 2.0
                        and len(para_text) <= 95
                        and len(para_text.split()) <= 14
                    ):
                        fallback_headings.append(
                            {
                                "text": para_text,
                                "font": dom_font,
                                "size": dom_size,
                                "color": dom_color,
                                "uppercase": is_caps,
                                "align": eff_props.get("align") or "left",
                                "decoration": _heading_decoration_from_props(eff_props, page_bg),
                                "char_count": len(para_text),
                            }
                        )
                        if dom_color and _is_chromatic_accent(dom_color):
                            chromatic_scores[dom_color] = chromatic_scores.get(dom_color, 0.0) + len(para_text) * 3.0
                    else:
                        weight = max(1, run_char_total)
                        if dom_font:
                            body_font_counts[dom_font] += weight
                        if dom_size and 6.5 <= dom_size <= 16.0:
                            body_size_counts[dom_size] += weight
                        if dom_color and _color_distance(dom_color, page_bg) > 14:
                            body_color_counts[dom_color] += weight
                        if eff_props.get("align") and len(para_text) >= 24:
                            body_align_counts[eff_props["align"]] += weight
                        if eff_props.get("space_after") is not None:
                            body_space_afters.append(float(eff_props["space_after"]))
                        if eff_props.get("line_val") is not None and dom_size:
                            body_leadings.append(_compute_word_leading(eff_props, float(dom_size)))

            elif ctag == "tbl":
                has_tables = True
                tbl_pr = _find_child(child, "tblPr")
                v_bdr = False
                h_bdr = False
                if tbl_pr is not None:
                    tbdrs = _find_child(tbl_pr, "tblBorders")
                    if tbdrs is not None:
                        for side in ("top", "bottom", "insideH"):
                            b_el = _find_child(tbdrs, side)
                            if b_el is not None:
                                bv = (_get_attr(b_el, "val") or "").strip().lower()
                                if bv and bv not in ("none", "nil"):
                                    h_bdr = True
                                    bc = _resolve_word_color(
                                        _get_attr(b_el, "color"),
                                        _get_attr(b_el, "themeColor"),
                                        _get_attr(b_el, "themeTint"),
                                        _get_attr(b_el, "themeShade"),
                                        theme_colors,
                                    )
                                    if bc:
                                        tbl_border_colors[bc] += 1
                                        neutral_borders[bc] += 1
                        for side in ("left", "right", "insideV"):
                            b_el = _find_child(tbdrs, side)
                            if b_el is not None:
                                bv = (_get_attr(b_el, "val") or "").strip().lower()
                                if bv and bv not in ("none", "nil"):
                                    v_bdr = True
                                    bc = _resolve_word_color(
                                        _get_attr(b_el, "color"),
                                        _get_attr(b_el, "themeColor"),
                                        _get_attr(b_el, "themeTint"),
                                        _get_attr(b_el, "themeShade"),
                                        theme_colors,
                                    )
                                    if bc:
                                        tbl_border_colors[bc] += 1
                    tmar = _find_child(tbl_pr, "tblCellMar")
                    if tmar is not None:
                        for side, bucket in (("top", tbl_pad_vs), ("bottom", tbl_pad_vs), ("left", tbl_pad_hs), ("right", tbl_pad_hs)):
                            m_el = _find_child(tmar, side)
                            if m_el is not None:
                                mv = _safe_float(_get_attr(m_el, "w"))
                                if mv is not None and mv >= 0:
                                    bucket.append(round(mv / 20.0, 1))

                trs = _find_children(child, "tr")
                row_fills: List[Optional[str]] = []
                for r_idx, tr in enumerate(trs[:40]):
                    tcs = _find_children(tr, "tc")
                    r_fill_cnt: Counter = Counter()
                    for tc in tcs:
                        tcpr = _find_child(tc, "tcPr")
                        if tcpr is not None:
                            shd = _find_child(tcpr, "shd")
                            if shd is not None:
                                fc = _resolve_word_color(
                                    _get_attr(shd, "fill"),
                                    _get_attr(shd, "themeFill"),
                                    _get_attr(shd, "themeFillTint"),
                                    _get_attr(shd, "themeFillShade"),
                                    theme_colors,
                                )
                                if fc:
                                    r_fill_cnt[fc] += 1
                            tcb = _find_child(tcpr, "tcBorders")
                            if tcb is not None:
                                for side in ("top", "bottom"):
                                    be = _find_child(tcb, side)
                                    if be is not None and (_get_attr(be, "val") or "").lower() not in ("", "none", "nil"):
                                        h_bdr = True
                                        bc = _resolve_word_color(
                                            _get_attr(be, "color"),
                                            _get_attr(be, "themeColor"),
                                            _get_attr(be, "themeTint"),
                                            _get_attr(be, "themeShade"),
                                            theme_colors,
                                        )
                                        if bc:
                                            tbl_border_colors[bc] += 1
                                for side in ("left", "right"):
                                    be = _find_child(tcb, side)
                                    if be is not None and (_get_attr(be, "val") or "").lower() not in ("", "none", "nil"):
                                        v_bdr = True
                        cell_txt_parts: List[str] = []
                        for r_el in _iter_local(tc, "r"):
                            rprops = _parse_word_rpr(_find_child(r_el, "rPr"), theme_colors, major_font, minor_font)
                            if rprops.get("size"):
                                tbl_font_sizes.append(float(rprops["size"]))
                            if r_idx == 0 and rprops.get("color"):
                                tbl_head_fgs[rprops["color"]] += 1
                            for t_el in _iter_local(r_el, "t"):
                                if t_el.text:
                                    cell_txt_parts.append(t_el.text)
                        if cell_txt_parts and r_idx < 10:
                            raw_lines_for_classify.append({"text": " ".join(cell_txt_parts)})

                    dom_r_fill = r_fill_cnt.most_common(1)[0][0] if r_fill_cnt else None
                    row_fills.append(dom_r_fill)
                    if r_idx == 0 and dom_r_fill and _color_distance(dom_r_fill, page_bg) > 14:
                        tbl_head_bgs[dom_r_fill] += 1
                        if _is_chromatic_accent(dom_r_fill):
                            chromatic_scores[dom_r_fill] = chromatic_scores.get(dom_r_fill, 0.0) + 60.0

                if h_bdr:
                    tbl_has_h_borders += 1
                if v_bdr:
                    tbl_has_v_borders += 1

                body_fills = row_fills[1:]
                non_bg_body = [f for f in body_fills if f and _color_distance(f, page_bg) > 6]
                if non_bg_body and len(non_bg_body) < len(body_fills):
                    tbl_has_zebra += 1
                    tbl_alt_bgs[Counter(non_bg_body).most_common(1)[0][0]] += 1
                elif len(set(f for f in body_fills if f)) >= 2:
                    tbl_has_zebra += 1
                    alt_cand = next((f for f in body_fills if f and _color_distance(f, page_bg) > 6), None)
                    if alt_cand:
                        tbl_alt_bgs[alt_cand] += 1

        if not heading_buckets["h1"] and fallback_headings:
            distinct_sizes = sorted({round(h["size"], 1) for h in fallback_headings if h.get("size")}, reverse=True)
            for h in fallback_headings:
                sz = round(h["size"], 1)
                if distinct_sizes and abs(sz - distinct_sizes[0]) <= 0.8:
                    heading_buckets["h1"].append(h)
                elif len(distinct_sizes) >= 2 and abs(sz - distinct_sizes[1]) <= 0.8:
                    heading_buckets["h2"].append(h)
                else:
                    heading_buckets["h3"].append(h)

        raw_body_font = (
            body_font_counts.most_common(1)[0][0]
            if body_font_counts
            else (body_style.get("font") or minor_font or "Calibri")
        )
        body_family = _classify_font_family(raw_body_font)
        body_size = float(
            body_size_counts.most_common(1)[0][0]
            if body_size_counts
            else (body_style.get("size") or 10.5)
        )
        body_leading = (
            round(statistics.median(body_leadings), 1)
            if body_leadings
            else _compute_word_leading(body_style, body_size, default_ratio=1.42)
        )
        body_align = (
            body_align_counts.most_common(1)[0][0]
            if body_align_counts
            else (body_style.get("align") or "left")
        )
        space_after = (
            round(statistics.median(body_space_afters), 1)
            if body_space_afters
            else float(body_style.get("space_after") if body_style.get("space_after") is not None else 7.0)
        )

        head_font_counts: Counter = Counter()
        for tier_key, st_obj in (("h1", h1_style), ("h2", h2_style), ("h3", h3_style)):
            for item in heading_buckets[tier_key]:
                if item.get("font"):
                    head_font_counts[item["font"]] += item["char_count"]
            if st_obj.get("font"):
                head_font_counts[st_obj["font"]] += 5
        raw_head_font = (
            head_font_counts.most_common(1)[0][0]
            if head_font_counts
            else (major_font or raw_body_font)
        )
        heading_family = _classify_font_family(raw_head_font)

        body_hint = _base_font_hint(raw_body_font)
        head_hint = _base_font_hint(raw_head_font)
        if head_hint and body_hint and head_hint.lower() != body_hint.lower():
            font_hint = f"{head_hint} / {body_hint}"
        else:
            font_hint = body_hint or head_hint

        text_color = (
            body_color_counts.most_common(1)[0][0]
            if body_color_counts
            else (body_style.get("color") or ("#E2E8F0" if is_dark_page else "#1E293B"))
        )

        h_colors: Counter = Counter()
        for item in heading_buckets["h1"] + heading_buckets["h2"]:
            if item.get("color") and _color_distance(item["color"], page_bg) > 14:
                h_colors[item["color"]] += item["char_count"]
        if not h_colors and h1_style.get("color"):
            h_colors[h1_style["color"]] += 10
        heading_color = (
            h_colors.most_common(1)[0][0]
            if h_colors
            else ("#F8FAFC" if is_dark_page else _darken_hex(text_color, 0.2))
        )

        for st_obj in (h1_style, h2_style):
            for k in ("color", "border_bottom_color", "border_left_color", "shd_fill"):
                c = st_obj.get(k)
                if c and _color_distance(c, page_bg) > 14 and _is_chromatic_accent(c):
                    chromatic_scores[c] = chromatic_scores.get(c, 0.0) + 40.0

        if chromatic_scores:
            accent_color = max(chromatic_scores.items(), key=lambda kv: kv[1])[0]
        elif theme["has_theme"] and theme_colors.get("accent1") and _is_chromatic_accent(theme_colors["accent1"]):
            accent_color = theme_colors["accent1"]
        else:
            accent_color = heading_color

        muted_color = _mix_hex(text_color, page_bg, 0.42)
        accent_dark = _darken_hex(accent_color, 0.28 if not is_dark_page else 0.18)
        accent_soft = _mix_hex(page_bg, accent_color, 0.10 if not is_dark_page else 0.20)
        border_pal = (
            neutral_borders.most_common(1)[0][0]
            if neutral_borders
            else _mix_hex(page_bg, text_color, 0.22)
        )
        surface_pal = _mix_hex(page_bg, text_color, 0.04) if not is_dark_page else _mix_hex(page_bg, "#FFFFFF", 0.06)

        table_head_bg = (
            tbl_head_bgs.most_common(1)[0][0]
            if tbl_head_bgs
            else (accent_color if _saturation(accent_color) >= 0.25 else heading_color)
        )
        if tbl_head_fgs:
            table_head_fg = tbl_head_fgs.most_common(1)[0][0]
        else:
            table_head_fg = "#FFFFFF" if _luminance(table_head_bg) < 0.45 else "#0F172A"
        table_alt = tbl_alt_bgs.most_common(1)[0][0] if tbl_alt_bgs else surface_pal

        def _build_docx_tier(tier_key: str, st_obj: Dict[str, Any], fallback_size: float) -> Dict[str, Any]:
            items = heading_buckets[tier_key]
            sizes = [float(i["size"]) for i in items if i.get("size")]
            sz = round(statistics.median(sizes), 1) if sizes else float(st_obj.get("size") or fallback_size)
            leading = _compute_word_leading(st_obj, sz, default_ratio=1.32)

            if items:
                upper = sum(1 for i in items if i.get("uppercase")) >= math.ceil(len(items) * 0.6)
                align_c = Counter(i.get("align") or "left" for i in items).most_common(1)[0][0]
                deco_c = Counter(i.get("decoration") or "plain" for i in items).most_common(1)[0][0]
                col_c = Counter(i["color"] for i in items if i.get("color"))
                col = col_c.most_common(1)[0][0] if col_c else st_obj.get("color")
            else:
                upper = bool(st_obj.get("caps", False))
                align_c = st_obj.get("align") or "left"
                deco_c = _heading_decoration_from_props(st_obj, page_bg)
                col = st_obj.get("color")

            if deco_c == "plain" and st_obj:
                st_deco = _heading_decoration_from_props(st_obj, page_bg)
                if st_deco != "plain":
                    deco_c = st_deco
            if col and _color_distance(col, heading_color) <= 10:
                col = None
            return {
                "size": sz,
                "leading": leading,
                "color": col,
                "uppercase": upper,
                "decoration": deco_c,
                "align": align_c,
            }

        h1_spec = _build_docx_tier("h1", h1_style, max(body_size * 1.55, 15.0))
        h2_spec = _build_docx_tier("h2", h2_style, max(body_size * 1.25, 12.5))
        h3_spec = _build_docx_tier("h3", h3_style, max(body_size * 1.08, 10.8))

        if tbl_has_zebra:
            tbl_style = "striped"
        elif tbl_has_v_borders and tbl_has_h_borders:
            tbl_style = "bordered"
        elif tbl_has_h_borders:
            tbl_style = "minimal_rules"
        elif has_tables:
            tbl_style = "clean"
        else:
            tbl_style = "striped"

        tables_spec = {
            "style": tbl_style,
            "header_bg": tbl_head_bgs.most_common(1)[0][0] if tbl_head_bgs else None,
            "header_fg": tbl_head_fgs.most_common(1)[0][0] if tbl_head_fgs else None,
            "alt_row_bg": tbl_alt_bgs.most_common(1)[0][0] if tbl_alt_bgs else None,
            "border_color": tbl_border_colors.most_common(1)[0][0] if tbl_border_colors else None,
            "font_size": round(statistics.median(tbl_font_sizes), 1) if tbl_font_sizes else round(max(8.0, body_size - 1.0), 1),
            "cell_padding_v": round(statistics.median(tbl_pad_vs), 1) if tbl_pad_vs else 5.5,
            "cell_padding_h": round(statistics.median(tbl_pad_hs), 1) if tbl_pad_hs else 7.0,
        }

        page_count = max(1, 1 + explicit_page_breaks)
        app_root = _read_zip_xml(zf, "docProps/app.xml")
        if app_root is not None:
            for pnode in _iter_local(app_root, "Pages"):
                pv = _safe_int(pnode.text)
                if pv and pv >= 1:
                    page_count = max(page_count, pv)
                    break

        document_type = _classify_document_type(
            raw_lines_for_classify,
            has_tables=has_tables,
            body_family=body_family,
            columns=columns,
            page_count=page_count,
        )

        sections_blueprint: List[str] = []
        seen_sec: Set[str] = set()
        for item in heading_buckets["h1"] + heading_buckets["h2"]:
            cleaned = _sanitize_section_title(item["text"])
            if cleaned and cleaned.lower() not in seen_sec:
                seen_sec.add(cleaned.lower())
                sections_blueprint.append(cleaned)
                if len(sections_blueprint) >= 16:
                    break

        extracted_assets: List[Dict[str, Any]] = []
        header_logo_rel: Optional[str] = None
        if extract_assets and assets_dir is not None:
            preferred_media = list(active_hdr.get("preferred_media") or [])
            extracted_assets, header_logo_rel = _extract_ooxml_logo(
                zf,
                "word/media/",
                Path(assets_dir),
                preferred_members=preferred_media,
            )

        header_spec = {
            "enabled": header_enabled,
            "skip_first_page": header_skip_first,
            "height_pt": header_dist_pt,
            "border_bottom": bool(active_hdr.get("border")),
            "border_color": active_hdr.get("border_color"),
            "background_hex": active_hdr.get("background_hex"),
            "left": active_hdr.get("left", "") if header_enabled else "",
            "center": active_hdr.get("center", "") if header_enabled else "",
            "right": active_hdr.get("right", "") if header_enabled else "",
            "logo_asset": header_logo_rel,
            "logo_position": active_hdr.get("logo_position", "left"),
            "logo_height_pt": active_hdr.get("logo_height_pt", 24.0),
        }
        footer_spec = {
            "enabled": footer_enabled,
            "skip_first_page": footer_skip_first,
            "height_pt": footer_dist_pt,
            "border_top": bool(active_ftr.get("border")),
            "border_color": active_ftr.get("border_color"),
            "left": active_ftr.get("left", "") if footer_enabled else "",
            "center": active_ftr.get("center", "") if footer_enabled else "",
            "right": active_ftr.get("right", "") if footer_enabled else "",
        }
        cover_spec = {
            "enabled": bool(early_cover_signal),
            "layout": "centered" if (early_cover_signal and h1_spec["align"] == "center") else ("minimal" if early_cover_signal else "none"),
            "top_band": False,
            "top_band_height_pt": 16.0,
            "logo_asset": header_logo_rel if (early_cover_signal and header_logo_rel) else None,
            "background_asset": None,
        }

        raw_spec: Dict[str, Any] = {
            "version": DESIGN_SPEC_VERSION,
            "name": "",
            "slug": "",
            "source_pdf": file_path.name,
            "source_format": "docx",
            "supported_outputs": ["docx", "pdf"],
            "document_type": document_type,
            "page": {
                "width_pt": page_w,
                "height_pt": page_h,
                "size_name": size_name,
                "orientation": orientation,
                "margins_pt": margins_pt,
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
            "docx": {
                "style_names": {
                    "h1": h1_style_id,
                    "h2": h2_style_id,
                    "h3": h3_style_id,
                    "body": body_style_id,
                },
                "different_first_page": different_first_page,
                "section_break_pages": section_break_pages,
            },
            "spreadsheet": {
                "header_bg": table_head_bg,
                "header_fg": table_head_fg,
                "alt_row_bg": table_alt,
                "total_row_bg": accent_soft,
                "total_row_fg": heading_color,
                "border_color": border_pal,
                "body_font_name": body_hint or "Calibri",
                "body_font_size": body_size,
                "print_orientation": orientation,
            },
            "sections_blueprint": sections_blueprint,
            "notes": "",
        }

        design_spec = normalize_design_spec(raw_spec)
        confidence = 0.86
        if styles:
            confidence += 0.05
        if theme["has_theme"] or chromatic_scores:
            confidence += 0.04
        if has_tables or header_enabled or footer_enabled:
            confidence += 0.03
        confidence = round(min(0.98, confidence), 2)

        summary = _build_office_summary(design_spec, page_count=page_count, source_format="docx")
        return {
            "ok": True,
            "file_name": file_path.name,
            "source_format": "docx",
            "page_count": page_count,
            "is_scanned_or_low_text": total_chars < 20,
            "confidence": confidence,
            "design_spec": design_spec,
            "summary": summary,
            "extracted_assets": extracted_assets,
            "preview_images": [],
            "warnings": warnings,
        }


# ---------------------------------------------------------------------------
# Inspección profunda de Excel (`.xlsx`)
# ---------------------------------------------------------------------------


def _col_letters_to_1based(letters: str) -> int:
    idx = 0
    for ch in letters.upper():
        if "A" <= ch <= "Z":
            idx = idx * 26 + (ord(ch) - ord("A") + 1)
    return max(1, idx)


def _parse_cell_ref(ref: str) -> Tuple[int, int]:
    """Devuelve `(row_1based, col_1based)` para una referencia como `'C4'`."""
    m = _CELL_REF_RE.match((ref or "").strip())
    if not m:
        return 0, 0
    return int(m.group(2)), _col_letters_to_1based(m.group(1))


def _parse_merge_range(ref: str) -> Optional[Tuple[int, int, int, int]]:
    if ":" not in ref:
        return None
    left, right = ref.split(":", 1)
    r1, c1 = _parse_cell_ref(left)
    r2, c2 = _parse_cell_ref(right)
    if r1 > 0 and c1 > 0 and r2 >= r1 and c2 >= c1:
        return r1, c1, r2, c2
    return None


def _classify_xl_numfmt(fmt_code: str) -> Optional[Tuple[str, str]]:
    """Clasifica un `formatCode` de Excel en `currency | percent | date | integer`."""
    if not fmt_code:
        return None
    cleaned = fmt_code.strip()
    low = cleaned.lower()
    if low in ("general", "@", ""):
        return None

    pos_sec = cleaned.split(";", 1)[0].strip()
    no_color = re.sub(r"\[(?:black|blue|cyan|green|magenta|red|white|yellow|color\d+)\]", "", pos_sec, flags=re.IGNORECASE)

    if (
        any(sym in pos_sec for sym in ("$", "€", "£", "¥"))
        or re.search(r"\[\$[^\]]+\]", pos_sec)
        or re.search(r"\b(?:mxn|usd|eur|gbp|cad)\b", low)
    ):
        norm_fmt = re.sub(r"\[\$([^-\]]+)(?:-[0-9A-Fa-f]+)?\]", r"\1", pos_sec)
        return "currency", _sanitize_num_fmt(norm_fmt, "$#,##0.00")

    if "%" in pos_sec:
        return "percent", _sanitize_num_fmt(pos_sec, "0.0%")

    no_quotes = re.sub(r'"[^"]*"', "", no_color)
    if (
        re.search(r"(?:yyyy|yy)", no_quotes, flags=re.IGNORECASE)
        and re.search(r"(?:mm|m|dd|d)", no_quotes, flags=re.IGNORECASE)
        and "#" not in no_quotes
    ):
        return "date", _sanitize_num_fmt(pos_sec, "yyyy-mm-dd")

    if ("#" in no_quotes or "0" in no_quotes) and "." not in no_quotes and "e+" not in low:
        return "integer", _sanitize_num_fmt(pos_sec, "#,##0")

    return None


def _parse_xlsx_styles(
    zf: zipfile.ZipFile,
    theme_colors: Dict[str, str],
) -> List[Dict[str, Any]]:
    """Parsea `xl/styles.xml` (`numFmts`, `fonts`, `fills`, `borders`, `cellXfs`)."""
    root = _read_zip_xml(zf, "xl/styles.xml")
    if root is None:
        return []

    num_fmts: Dict[int, str] = dict(_BUILTIN_XL_NUMFMTS)
    nf_node = _find_child(root, "numFmts")
    if nf_node is not None:
        for nf in _find_children(nf_node, "numFmt"):
            nid = _safe_int(_get_attr(nf, "numFmtId"))
            code = _get_attr(nf, "formatCode")
            if nid is not None and code:
                num_fmts[nid] = code

    fonts: List[Dict[str, Any]] = []
    fonts_node = _find_child(root, "fonts")
    if fonts_node is not None:
        for f_el in _find_children(fonts_node, "font"):
            name_el = _find_child(f_el, "name")
            sz_el = _find_child(f_el, "sz")
            b_el = _find_child(f_el, "b")
            clr_el = _find_child(f_el, "color")
            fonts.append(
                {
                    "name": (_get_attr(name_el, "val") or "").strip() if name_el is not None else "",
                    "size": _safe_float(_get_attr(sz_el, "val")) if sz_el is not None else None,
                    "bold": _xml_bool_on(b_el, False),
                    "color": _resolve_xl_color(clr_el, theme_colors),
                }
            )

    fills: List[Optional[str]] = []
    fills_node = _find_child(root, "fills")
    if fills_node is not None:
        for fill_el in _find_children(fills_node, "fill"):
            pf = _find_child(fill_el, "patternFill")
            bg_hex: Optional[str] = None
            if pf is not None:
                ptype = (_get_attr(pf, "patternType") or "").strip().lower()
                if ptype == "solid":
                    fg = _find_child(pf, "fgColor")
                    bg = _find_child(pf, "bgColor")
                    bg_hex = _resolve_xl_color(fg, theme_colors) or _resolve_xl_color(bg, theme_colors)
                elif ptype not in ("", "none", "gray125", "gray0625"):
                    bg = _find_child(pf, "bgColor")
                    fg = _find_child(pf, "fgColor")
                    bg_hex = _resolve_xl_color(bg, theme_colors) or _resolve_xl_color(fg, theme_colors)
            fills.append(bg_hex)

    borders: List[Dict[str, Any]] = []
    borders_node = _find_child(root, "borders")
    if borders_node is not None:
        for b_el in _find_children(borders_node, "border"):
            sides: Dict[str, Tuple[str, Optional[str]]] = {}
            for side in ("left", "right", "top", "bottom"):
                s_el = _find_child(b_el, side)
                if s_el is not None:
                    st = (_get_attr(s_el, "style") or "").strip().lower()
                    if st and st != "none":
                        sc = _resolve_xl_color(_find_child(s_el, "color"), theme_colors)
                        sides[side] = (st, sc)
            borders.append(sides)

    xfs: List[Dict[str, Any]] = []
    xfs_node = _find_child(root, "cellXfs")
    if xfs_node is not None:
        for xf in _find_children(xfs_node, "xf"):
            font_id = _safe_int(_get_attr(xf, "fontId"), 0) or 0
            fill_id = _safe_int(_get_attr(xf, "fillId"), 0) or 0
            border_id = _safe_int(_get_attr(xf, "borderId"), 0) or 0
            numfmt_id = _safe_int(_get_attr(xf, "numFmtId"), 0) or 0

            apply_fill = _get_attr(xf, "applyFill")
            apply_border = _get_attr(xf, "applyBorder")

            font_info = fonts[font_id] if 0 <= font_id < len(fonts) else {}
            fill_hex = (
                fills[fill_id]
                if (0 <= fill_id < len(fills) and apply_fill != "0")
                else None
            )
            border_info = (
                borders[border_id]
                if (0 <= border_id < len(borders) and apply_border != "0")
                else {}
            )
            fmt_code = num_fmts.get(numfmt_id, "")

            align_el = _find_child(xf, "alignment")
            h_align = (_get_attr(align_el, "horizontal") or "").strip().lower() if align_el is not None else ""

            xfs.append(
                {
                    "font": font_info,
                    "fill": fill_hex,
                    "borders": border_info,
                    "num_fmt": fmt_code,
                    "h_align": h_align,
                }
            )

    return xfs


def _inspect_xlsx(
    file_path: Path,
    *,
    extract_assets: bool = False,
    assets_dir: Optional[Path] = None,
) -> Dict[str, Any]:
    if _is_encrypted_ole2(file_path):
        return {
            "ok": False,
            "error": "El libro Excel (.xlsx) está protegido con contraseña o cifrado y no se puede inspeccionar.",
        }

    warnings: List[str] = []
    try:
        zf_ctx = zipfile.ZipFile(file_path, "r")
    except Exception as exc:
        return {"ok": False, "error": f"No se pudo abrir el libro Excel ({exc})."}

    with zf_ctx as zf:
        names = set(zf.namelist())
        theme = _parse_ooxml_theme(zf, "xl/theme/theme1.xml")
        theme_colors: Dict[str, str] = theme["colors"]
        xfs = _parse_xlsx_styles(zf, theme_colors)

        shared_strings: List[str] = []
        ss_root = _read_zip_xml(zf, "xl/sharedStrings.xml")
        if ss_root is not None:
            for si in _find_children(ss_root, "si"):
                parts = [t.text for t in _iter_local(si, "t") if t.text is not None]
                shared_strings.append("".join(parts))

        rels_map = _parse_rels_map(zf, "xl/_rels/workbook.xml.rels", "xl")
        sheet_entries: List[Tuple[str, str]] = []
        wb_root = _read_zip_xml(zf, "xl/workbook.xml")
        if wb_root is not None:
            for sh in _iter_local(wb_root, "sheet"):
                s_name = _get_attr(sh, "name") or f"Hoja {len(sheet_entries) + 1}"
                rid = _get_attr(sh, "id") or ""
                target = rels_map.get(rid, "")
                if target in names:
                    sheet_entries.append((s_name, target))
        if not sheet_entries:
            for nm in sorted(names):
                if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", nm):
                    sheet_entries.append((f"Hoja {len(sheet_entries) + 1}", nm))

        if not sheet_entries:
            return {"ok": False, "error": "El archivo .xlsx no contiene hojas de cálculo válidas."}

        total_sheets_count = len(sheet_entries)
        sampled_sheets = sheet_entries[:8]

        sheets_blueprint: List[Dict[str, Any]] = []
        header_bg_counts: Counter = Counter()
        header_fg_counts: Counter = Counter()
        header_bold_votes: List[bool] = []
        header_font_sizes: List[float] = []
        header_font_names: Counter = Counter()

        body_font_names: Counter = Counter()
        body_font_sizes: List[float] = []
        body_text_colors: Counter = Counter()
        alt_row_bg_counts: Counter = Counter()

        total_row_bg_counts: Counter = Counter()
        total_row_fg_counts: Counter = Counter()
        total_row_bold_votes: List[bool] = []

        border_h_hits = 0
        border_v_hits = 0
        border_medium_hits = 0
        border_thin_hits = 0
        border_color_counts: Counter = Counter()

        any_freeze = False
        any_auto_filter = False
        gridlines_votes: List[bool] = []
        all_col_widths: List[float] = []
        default_col_widths: List[float] = []
        orient_counts: Counter = Counter()
        margins_in_pt: Dict[str, List[float]] = {"top": [], "right": [], "bottom": [], "left": []}

        detected_numfmts: Dict[str, Counter] = {
            "currency": Counter(),
            "percent": Counter(),
            "date": Counter(),
            "integer": Counter(),
        }
        banner_bg_counts: Counter = Counter()
        raw_lines_for_classify: List[Dict[str, Any]] = []
        total_cells_seen = 0

        for s_idx, (raw_sheet_name, xml_path) in enumerate(sampled_sheets, start=1):
            ws_root = _read_zip_xml(zf, xml_path)
            if ws_root is None:
                continue

            svs = _find_child(ws_root, "sheetViews")
            if svs is not None:
                for sv in _find_children(svs, "sheetView"):
                    sg = _get_attr(sv, "showGridLines")
                    if sg is not None:
                        gridlines_votes.append(sg.strip().lower() not in ("0", "false"))
                    else:
                        gridlines_votes.append(True)
                    pane = _find_child(sv, "pane")
                    if pane is not None:
                        pstate = (_get_attr(pane, "state") or "").strip().lower()
                        ysplit = _safe_float(_get_attr(pane, "ySplit"), 0.0) or 0.0
                        if ysplit >= 1.0 and pstate in ("frozen", "frozensplit", ""):
                            any_freeze = True

            sfp = _find_child(ws_root, "sheetFormatPr")
            sheet_default_w = 16.0
            if sfp is not None:
                dcw = _safe_float(_get_attr(sfp, "defaultColWidth"))
                if dcw is not None and 4.0 <= dcw <= 80.0:
                    sheet_default_w = round(dcw, 1)
                    default_col_widths.append(sheet_default_w)

            col_width_map: Dict[int, float] = {}
            cols_node = _find_child(ws_root, "cols")
            if cols_node is not None:
                for col_el in _find_children(cols_node, "col"):
                    c_min = _safe_int(_get_attr(col_el, "min"), 1) or 1
                    c_max = _safe_int(_get_attr(col_el, "max"), c_min) or c_min
                    c_w = _safe_float(_get_attr(col_el, "width"))
                    if c_w is not None and 2.0 <= c_w <= 120.0:
                        capped_max = min(c_max, c_min + 48)
                        for ci in range(max(1, c_min), capped_max + 1):
                            col_width_map[ci] = round(min(80.0, max(4.0, c_w)), 1)

            merged_ranges: List[Tuple[int, int, int, int]] = []
            mc_node = _find_child(ws_root, "mergeCells")
            if mc_node is not None:
                for mc in _find_children(mc_node, "mergeCell"):
                    parsed_m = _parse_merge_range(_get_attr(mc, "ref") or "")
                    if parsed_m is not None:
                        merged_ranges.append(parsed_m)

            if _find_child(ws_root, "autoFilter") is not None:
                any_auto_filter = True

            ps_el = _find_child(ws_root, "pageSetup")
            if ps_el is not None:
                ori = (_get_attr(ps_el, "orientation") or "").strip().lower()
                if ori in ("portrait", "landscape"):
                    orient_counts[ori] += 1
            pm_el = _find_child(ws_root, "pageMargins")
            if pm_el is not None:
                for side in ("top", "right", "bottom", "left"):
                    inches = _safe_float(_get_attr(pm_el, side))
                    if inches is not None and 0.15 <= inches <= 2.5:
                        margins_in_pt[side].append(round(inches * 72.0, 1))

            sd_node = _find_child(ws_root, "sheetData")
            rows_parsed: List[Dict[str, Any]] = []
            sheet_formula_patterns: List[str] = []

            if sd_node is not None:
                for row_el in _find_children(sd_node, "row")[:400]:
                    row_num = _safe_int(_get_attr(row_el, "r"), len(rows_parsed) + 1) or (len(rows_parsed) + 1)
                    cells_in_row: List[Dict[str, Any]] = []
                    cur_col = 1

                    for c_el in _find_children(row_el, "c"):
                        ref = _get_attr(c_el, "r") or ""
                        if ref:
                            _, col_idx = _parse_cell_ref(ref)
                            if col_idx <= 0:
                                col_idx = cur_col
                        else:
                            col_idx = cur_col
                        cur_col = col_idx + 1

                        s_idx_val = _safe_int(_get_attr(c_el, "s"), 0) or 0
                        xf = xfs[s_idx_val] if 0 <= s_idx_val < len(xfs) else {}
                        ctype = (_get_attr(c_el, "t") or "").strip()

                        f_el = _find_child(c_el, "f")
                        formula_txt = (f_el.text or "").strip() if f_el is not None else ""
                        if formula_txt:
                            for m_fn in _FORMULA_FUNC_RE.findall(formula_txt):
                                clean_fp = _sanitize_formula_pattern(m_fn)
                                if clean_fp and clean_fp not in sheet_formula_patterns:
                                    sheet_formula_patterns.append(clean_fp)

                        text_val = ""
                        is_text = False
                        is_numeric = False

                        if ctype == "inlineStr":
                            parts = [t.text for t in _iter_local(c_el, "t") if t.text is not None]
                            text_val = "".join(parts).strip()
                            is_text = bool(text_val)
                        else:
                            v_el = _find_child(c_el, "v")
                            raw_v = (v_el.text or "").strip() if v_el is not None else ""
                            if ctype == "s" and raw_v != "":
                                ssi = _safe_int(raw_v)
                                if ssi is not None and 0 <= ssi < len(shared_strings):
                                    text_val = shared_strings[ssi].strip()
                                    is_text = bool(text_val)
                            elif ctype == "str" and raw_v != "":
                                text_val = raw_v
                                is_text = True
                            elif ctype == "b" and raw_v != "":
                                is_text = True
                            elif raw_v != "":
                                is_numeric = True

                        has_value = bool(is_text or is_numeric or formula_txt or f_el is not None)
                        if not has_value and not xf.get("fill") and not xf.get("borders"):
                            continue
                        total_cells_seen += 1

                        cells_in_row.append(
                            {
                                "col": col_idx,
                                "text": text_val,
                                "is_text": is_text,
                                "is_numeric": is_numeric,
                                "has_formula": bool(formula_txt or f_el is not None),
                                "formula": formula_txt,
                                "xf": xf,
                                "has_value": has_value,
                            }
                        )

                    if any(c["has_value"] for c in cells_in_row):
                        rows_parsed.append({"row_num": row_num, "cells": cells_in_row})

            if not rows_parsed:
                clean_s_name = _sanitize_spreadsheet_label(raw_sheet_name, max_len=31) or f"Hoja {s_idx}"
                sheets_blueprint.append(
                    {
                        "name": clean_s_name,
                        "columns": [],
                        "col_widths": [],
                        "has_title_banner": False,
                        "header_row": 1,
                        "has_totals_row": False,
                        "formula_patterns": [],
                    }
                )
                continue

            merged_rows_wide = {r1 for (r1, c1, r2, c2) in merged_ranges if c2 > c1 and r1 <= 6}

            def _row_stats(row_obj: Dict[str, Any]) -> Dict[str, Any]:
                val_cells = [c for c in row_obj["cells"] if c["has_value"]]
                txt_cells = [c for c in val_cells if c["is_text"]]
                num_cells = [c for c in val_cells if c["is_numeric"] or c["has_formula"]]
                styled_fill = sum(
                    1
                    for c in val_cells
                    if c["xf"].get("fill") and _color_distance(c["xf"]["fill"], "#FFFFFF") > 12
                )
                bold_cnt = sum(1 for c in val_cells if c["xf"].get("font", {}).get("bold"))
                return {
                    "row_num": row_obj["row_num"],
                    "val_cnt": len(val_cells),
                    "txt_cnt": len(txt_cells),
                    "num_cnt": len(num_cells),
                    "styled_fill": styled_fill,
                    "bold_cnt": bold_cnt,
                    "is_merged_wide": row_obj["row_num"] in merged_rows_wide,
                }

            top_rows = rows_parsed[: min(8, len(rows_parsed))]
            header_row_idx_in_list = 0
            best_header_score = -1.0

            for idx_r, r_obj in enumerate(top_rows):
                st = _row_stats(r_obj)
                if st["is_merged_wide"] and st["val_cnt"] <= 2:
                    continue
                if st["val_cnt"] == 1 and idx_r + 1 < len(top_rows):
                    if any(_row_stats(later)["txt_cnt"] >= 2 for later in top_rows[idx_r + 1 :]):
                        continue
                if st["txt_cnt"] >= 2 and st["txt_cnt"] >= st["num_cnt"]:
                    score = (
                        st["txt_cnt"] * 2.5
                        + (3.0 if st["styled_fill"] >= 2 else 0.0)
                        + (2.0 if st["bold_cnt"] >= 2 else 0.0)
                        - idx_r * 0.4
                    )
                    if score > best_header_score:
                        best_header_score = score
                        header_row_idx_in_list = idx_r

            header_row_obj = rows_parsed[header_row_idx_in_list]
            header_row_num = header_row_obj["row_num"]
            has_title_banner = header_row_idx_in_list > 0 or any(r1 < header_row_num for (r1, _, _, _) in merged_ranges)

            for b_row in rows_parsed[:header_row_idx_in_list]:
                for bc in b_row["cells"]:
                    if bc["is_text"] and bc["text"]:
                        raw_lines_for_classify.append({"text": bc["text"]})
                    bfill = bc["xf"].get("fill")
                    if bfill and _color_distance(bfill, "#FFFFFF") > 16:
                        banner_bg_counts[bfill] += 1

            hdr_cells = sorted(
                [c for c in header_row_obj["cells"] if c["has_value"]],
                key=lambda c: c["col"],
            )
            sheet_columns: List[str] = []
            sheet_col_widths: List[float] = []

            for c_pos, hc in enumerate(hdr_cells[:24], start=1):
                if hc["text"]:
                    raw_lines_for_classify.append({"text": hc["text"]})
                clean_col = _sanitize_spreadsheet_label(hc["text"], max_len=48)
                if not clean_col:
                    clean_col = f"Columna {c_pos}"
                sheet_columns.append(clean_col)
                cw = col_width_map.get(hc["col"], sheet_default_w)
                sheet_col_widths.append(cw)
                all_col_widths.append(cw)

                xf = hc["xf"]
                hfill = xf.get("fill")
                if hfill:
                    header_bg_counts[hfill] += 1
                hfont = xf.get("font") or {}
                if hfont.get("color"):
                    header_fg_counts[hfont["color"]] += 1
                header_bold_votes.append(bool(hfont.get("bold")))
                if hfont.get("size"):
                    header_font_sizes.append(float(hfont["size"]))
                if hfont.get("name"):
                    header_font_names[hfont["name"]] += 1

            data_rows = rows_parsed[header_row_idx_in_list + 1 :]
            totals_row_indices: Set[int] = set()
            n_data = len(data_rows)

            for d_idx, r_obj in enumerate(data_rows):
                val_cells = [c for c in r_obj["cells"] if c["has_value"]]
                if not val_cells:
                    continue
                first_txt = next((c["text"] for c in val_cells if c["is_text"]), "")
                has_sum_formula = any(
                    any(fn in (c["formula"] or "").upper() for fn in ("SUM(", "SUBTOTAL(", "AVERAGE("))
                    for c in val_cells
                    if c["has_formula"]
                )
                has_total_label = bool(first_txt and _TOTAL_LABEL_RE.search(first_txt))
                is_near_end = d_idx >= max(0, n_data - 3)
                any_bold_or_fill = any(
                    c["xf"].get("font", {}).get("bold")
                    or (c["xf"].get("fill") and _color_distance(c["xf"]["fill"], "#FFFFFF") > 12)
                    or ("double" in (c["xf"].get("borders", {}).get("bottom", ("", None))[0]))
                    for c in val_cells
                )

                if (has_total_label and (has_sum_formula or any_bold_or_fill or is_near_end)) or (
                    is_near_end and has_sum_formula and (has_total_label or any_bold_or_fill)
                ):
                    totals_row_indices.add(d_idx)
                    if first_txt:
                        raw_lines_for_classify.append({"text": first_txt})
                    for tc in val_cells:
                        txf = tc["xf"]
                        if txf.get("fill") and _color_distance(txf["fill"], "#FFFFFF") > 6:
                            total_row_bg_counts[txf["fill"]] += 1
                        tfont = txf.get("font") or {}
                        if tfont.get("color"):
                            total_row_fg_counts[tfont["color"]] += 1
                        total_row_bold_votes.append(bool(tfont.get("bold")))

            body_row_dom_fills: List[Optional[str]] = []
            for d_idx, r_obj in enumerate(data_rows):
                is_tot = d_idx in totals_row_indices
                r_fills: Counter = Counter()
                for c in r_obj["cells"]:
                    xf = c["xf"]
                    nf_code = xf.get("num_fmt") or ""
                    if nf_code and (c["is_numeric"] or c["has_formula"]):
                        classified = _classify_xl_numfmt(nf_code)
                        if classified:
                            cat, clean_code = classified
                            detected_numfmts[cat][clean_code] += 1

                    borders = xf.get("borders") or {}
                    for bside, (bstyle, bcol) in borders.items():
                        if bside in ("top", "bottom"):
                            border_h_hits += 1
                        elif bside in ("left", "right"):
                            border_v_hits += 1
                        if bstyle in ("medium", "thick"):
                            border_medium_hits += 1
                        else:
                            border_thin_hits += 1
                        if bcol:
                            border_color_counts[bcol] += 1

                    if is_tot:
                        continue

                    font = xf.get("font") or {}
                    if font.get("name"):
                        body_font_names[font["name"]] += 1
                    if font.get("size"):
                        body_font_sizes.append(float(font["size"]))
                    if font.get("color"):
                        body_text_colors[font["color"]] += 1

                    fill = xf.get("fill")
                    if fill:
                        r_fills[fill] += 1

                if not is_tot:
                    body_row_dom_fills.append(r_fills.most_common(1)[0][0] if r_fills else None)

            non_white_body_fills = [
                f for f in body_row_dom_fills if f and _color_distance(f, "#FFFFFF") > 5
            ]
            if non_white_body_fills:
                if len(non_white_body_fills) < len(body_row_dom_fills) or len(set(non_white_body_fills)) >= 2:
                    alt_cand = Counter(non_white_body_fills).most_common(1)[0][0]
                    alt_row_bg_counts[alt_cand] += 1

            for hc in hdr_cells:
                for bside, (bstyle, bcol) in (hc["xf"].get("borders") or {}).items():
                    if bside in ("top", "bottom"):
                        border_h_hits += 1
                    elif bside in ("left", "right"):
                        border_v_hits += 1
                    if bstyle in ("medium", "thick"):
                        border_medium_hits += 1
                    else:
                        border_thin_hits += 1
                    if bcol:
                        border_color_counts[bcol] += 1

            clean_sheet_name = _sanitize_spreadsheet_label(raw_sheet_name, max_len=31) or f"Hoja {s_idx}"
            raw_lines_for_classify.append({"text": clean_sheet_name})
            sheets_blueprint.append(
                {
                    "name": clean_sheet_name,
                    "columns": sheet_columns,
                    "col_widths": sheet_col_widths,
                    "has_title_banner": has_title_banner,
                    "header_row": header_row_num,
                    "has_totals_row": bool(totals_row_indices),
                    "formula_patterns": sheet_formula_patterns[:12],
                }
            )

        header_bg = (
            header_bg_counts.most_common(1)[0][0]
            if header_bg_counts
            else (
                banner_bg_counts.most_common(1)[0][0]
                if banner_bg_counts
                else (theme_colors.get("accent1") if theme["has_theme"] else "#0F172A")
            )
        )
        if header_fg_counts:
            header_fg = header_fg_counts.most_common(1)[0][0]
        else:
            header_fg = "#FFFFFF" if _luminance(header_bg) < 0.45 else "#0F172A"
        header_bold = (
            sum(1 for v in header_bold_votes if v) >= max(1, math.ceil(len(header_bold_votes) * 0.5))
            if header_bold_votes
            else True
        )
        header_font_size = round(statistics.median(header_font_sizes), 1) if header_font_sizes else 10.0

        body_font_name = (
            body_font_names.most_common(1)[0][0]
            if body_font_names
            else (
                header_font_names.most_common(1)[0][0]
                if header_font_names
                else (theme["minor_font"] or "Calibri")
            )
        )
        body_font_size = round(statistics.median(body_font_sizes), 1) if body_font_sizes else 10.0
        body_text_color = body_text_colors.most_common(1)[0][0] if body_text_colors else "#1E293B"
        alt_row_bg = alt_row_bg_counts.most_common(1)[0][0] if alt_row_bg_counts else "#F8FAFC"

        if total_row_bg_counts:
            total_row_bg = total_row_bg_counts.most_common(1)[0][0]
        else:
            total_row_bg = _mix_hex("#FFFFFF", header_bg, 0.12)
        if total_row_fg_counts:
            total_row_fg = total_row_fg_counts.most_common(1)[0][0]
        else:
            total_row_fg = "#FFFFFF" if _luminance(total_row_bg) < 0.45 else "#0F172A"
        total_row_bold = (
            sum(1 for v in total_row_bold_votes if v) >= max(1, math.ceil(len(total_row_bold_votes) * 0.5))
            if total_row_bold_votes
            else True
        )

        if border_h_hits == 0 and border_v_hits == 0:
            border_style = "none"
        elif border_h_hits > 0 and border_v_hits == 0:
            border_style = "horizontal"
        elif border_medium_hits > border_thin_hits:
            border_style = "medium"
        else:
            border_style = "thin"
        border_color = border_color_counts.most_common(1)[0][0] if border_color_counts else "#CBD5E1"

        show_gridlines = (
            sum(1 for g in gridlines_votes if g) >= math.ceil(len(gridlines_votes) * 0.5)
            if gridlines_votes
            else True
        )
        default_col_width = (
            round(statistics.median(default_col_widths), 1)
            if default_col_widths
            else (round(statistics.median(all_col_widths), 1) if all_col_widths else 16.0)
        )
        print_orientation = orient_counts.most_common(1)[0][0] if orient_counts else "portrait"

        number_formats = {
            "currency": detected_numfmts["currency"].most_common(1)[0][0] if detected_numfmts["currency"] else "$#,##0.00",
            "percent": detected_numfmts["percent"].most_common(1)[0][0] if detected_numfmts["percent"] else "0.0%",
            "date": detected_numfmts["date"].most_common(1)[0][0] if detected_numfmts["date"] else "yyyy-mm-dd",
            "integer": detected_numfmts["integer"].most_common(1)[0][0] if detected_numfmts["integer"] else "#,##0",
        }

        accent_candidates: List[str] = []
        for cand in (
            banner_bg_counts.most_common(1)[0][0] if banner_bg_counts else None,
            header_bg,
            theme_colors.get("accent1") if theme["has_theme"] else None,
            total_row_bg,
        ):
            if cand and _is_chromatic_accent(cand):
                accent_candidates.append(cand)
        accent_color = accent_candidates[0] if accent_candidates else header_bg
        heading_color = header_bg if _luminance(header_bg) < 0.45 else "#0F172A"
        accent_dark = _darken_hex(accent_color, 0.25)
        accent_soft = _mix_hex("#FFFFFF", accent_color, 0.10)
        muted_color = _mix_hex(body_text_color, "#FFFFFF", 0.42)

        body_family = _classify_font_family(body_font_name)
        head_font_name = header_font_names.most_common(1)[0][0] if header_font_names else body_font_name
        heading_family = _classify_font_family(head_font_name)

        page_w, page_h = (792.0, 612.0) if print_orientation == "landscape" else (612.0, 792.0)
        page_margins = {
            side: round(statistics.median(vals), 1) if vals else DEFAULT_DESIGN_SPEC["page"]["margins_pt"][side]
            for side, vals in margins_in_pt.items()
        }

        extracted_assets: List[Dict[str, Any]] = []
        logo_rel: Optional[str] = None
        if extract_assets and assets_dir is not None:
            extracted_assets, logo_rel = _extract_ooxml_logo(zf, "xl/media/", Path(assets_dir))

        document_type = _classify_document_type(
            raw_lines_for_classify,
            has_tables=True,
            body_family=body_family,
            columns=1,
            page_count=total_sheets_count,
        )
        sections_blueprint = [
            s["name"]
            for s in sheets_blueprint
            if _sanitize_section_title(s["name"]) or s["name"]
        ]

        tbl_style_unified = (
            "striped"
            if alt_row_bg_counts
            else ("bordered" if border_style in ("thin", "medium") else ("minimal_rules" if border_style == "horizontal" else "clean"))
        )

        raw_spec: Dict[str, Any] = {
            "version": DESIGN_SPEC_VERSION,
            "name": "",
            "slug": "",
            "source_pdf": file_path.name,
            "source_format": "xlsx",
            "supported_outputs": ["xlsx", "pdf"],
            "document_type": document_type,
            "page": {
                "width_pt": page_w,
                "height_pt": page_h,
                "size_name": "letter",
                "orientation": print_orientation,
                "margins_pt": page_margins,
                "background_hex": "#FFFFFF",
                "columns": 1,
                "column_gap_pt": 18.0,
            },
            "palette": {
                "page_bg": "#FFFFFF",
                "text": body_text_color,
                "heading": heading_color,
                "muted": muted_color,
                "accent": accent_color,
                "accent_dark": accent_dark,
                "accent_soft": accent_soft,
                "border": border_color,
                "surface": alt_row_bg,
                "table_head_bg": header_bg,
                "table_head_fg": header_fg,
                "table_alt": alt_row_bg,
            },
            "typography": {
                "body_family": body_family,
                "heading_family": heading_family,
                "font_hint": _base_font_hint(body_font_name),
                "body_size": body_font_size,
                "body_leading": round(body_font_size * 1.4, 1),
                "body_align": "left",
                "space_after": 6.0,
                "h1": {
                    "size": max(15.0, round(header_font_size * 1.5, 1)),
                    "leading": round(max(15.0, header_font_size * 1.5) * 1.3, 1),
                    "color": heading_color,
                    "uppercase": False,
                    "decoration": "underline",
                    "align": "left",
                },
            },
            "header": {
                "enabled": bool(logo_rel),
                "skip_first_page": False,
                "logo_asset": logo_rel,
            },
            "footer": {
                "enabled": True,
                "skip_first_page": False,
                "left": "{date}",
                "center": "",
                "right": "Página {page} de {total}",
            },
            "tables": {
                "style": tbl_style_unified,
                "header_bg": header_bg,
                "header_fg": header_fg,
                "alt_row_bg": alt_row_bg,
                "border_color": border_color,
                "font_size": round(min(12.0, body_font_size), 1),
                "cell_padding_v": 5.0,
                "cell_padding_h": 6.5,
            },
            "spreadsheet": {
                "sheets_blueprint": sheets_blueprint,
                "header_bg": header_bg,
                "header_fg": header_fg,
                "header_bold": header_bold,
                "header_font_size": header_font_size,
                "body_font_name": body_font_name,
                "body_font_size": body_font_size,
                "alt_row_bg": alt_row_bg,
                "total_row_bg": total_row_bg,
                "total_row_fg": total_row_fg,
                "total_row_bold": total_row_bold,
                "border_style": border_style,
                "border_color": border_color,
                "freeze_header": any_freeze,
                "auto_filter": any_auto_filter,
                "show_gridlines": show_gridlines,
                "default_col_width": default_col_width,
                "number_formats": number_formats,
                "print_orientation": print_orientation,
            },
            "sections_blueprint": sections_blueprint,
            "notes": "",
        }

        design_spec = normalize_design_spec(raw_spec)
        confidence = 0.84
        if xfs:
            confidence += 0.06
        if header_bg_counts:
            confidence += 0.04
        if any(s["columns"] for s in sheets_blueprint):
            confidence += 0.04
        confidence = round(min(0.98, confidence), 2)

        summary = _build_office_summary(design_spec, page_count=total_sheets_count, source_format="xlsx")
        return {
            "ok": True,
            "file_name": file_path.name,
            "source_format": "xlsx",
            "page_count": total_sheets_count,
            "is_scanned_or_low_text": total_cells_seen == 0,
            "confidence": confidence,
            "design_spec": design_spec,
            "summary": summary,
            "extracted_assets": extracted_assets,
            "preview_images": [],
            "warnings": warnings,
        }


# ---------------------------------------------------------------------------
# Inspección profunda de PowerPoint (`.pptx`)
# ---------------------------------------------------------------------------


def _compute_aspect_ratio_label(width_pt: float, height_pt: float) -> str:
    ratio = width_pt / max(1.0, height_pt)
    if abs(ratio - (16.0 / 9.0)) <= 0.08:
        return "16:9"
    if abs(ratio - (4.0 / 3.0)) <= 0.08:
        return "4:3"
    if abs(ratio - (16.0 / 10.0)) <= 0.08:
        return "16:10"
    if abs(ratio - 1.0) <= 0.08:
        return "1:1"
    w_i = max(1, int(round(width_pt)))
    h_i = max(1, int(round(height_pt)))
    g = math.gcd(w_i, h_i)
    rw, rh = w_i // g, h_i // g
    if rw <= 32 and rh <= 32:
        return f"{rw}:{rh}"
    return "16:9" if ratio >= 1.5 else "4:3"


def _inspect_pptx(
    file_path: Path,
    *,
    extract_assets: bool = False,
    assets_dir: Optional[Path] = None,
) -> Dict[str, Any]:
    if _is_encrypted_ole2(file_path):
        return {
            "ok": False,
            "error": "La presentación PowerPoint (.pptx) está protegida con contraseña y no se puede inspeccionar.",
        }

    warnings: List[str] = []
    try:
        zf_ctx = zipfile.ZipFile(file_path, "r")
    except Exception as exc:
        return {"ok": False, "error": f"No se pudo abrir la presentación PowerPoint ({exc})."}

    with zf_ctx as zf:
        names = set(zf.namelist())
        pres_root = _read_zip_xml(zf, "ppt/presentation.xml")
        if pres_root is None:
            return {"ok": False, "error": "El archivo .pptx no contiene ppt/presentation.xml válido."}

        theme = _parse_ooxml_theme(zf, "ppt/theme/theme1.xml")
        theme_colors: Dict[str, str] = theme["colors"]
        major_font: str = theme["major_font"] or "Calibri"
        minor_font: str = theme["minor_font"] or "Calibri"

        slide_w = 720.0
        slide_h = 405.0
        for sld_sz in _iter_local(pres_root, "sldSz"):
            cx = _safe_float(_get_attr(sld_sz, "cx"))
            cy = _safe_float(_get_attr(sld_sz, "cy"))
            if cx and cx > 0 and cy and cy > 0:
                slide_w = round(cx / 12700.0, 2)
                slide_h = round(cy / 12700.0, 2)
            break
        aspect_ratio = _compute_aspect_ratio_label(slide_w, slide_h)

        layouts_detected: List[str] = []
        for nm in sorted(names):
            if re.fullmatch(r"ppt/slideLayouts/slideLayout\d+\.xml", nm):
                lroot = _read_zip_xml(zf, nm)
                if lroot is not None:
                    csld = _find_child(lroot, "cSld")
                    lname = (_get_attr(csld, "name") if csld is not None else "") or ""
                    if lname.strip() and lname.strip() not in layouts_detected:
                        layouts_detected.append(lname.strip())

        slide_files: List[Tuple[int, str]] = []
        for nm in names:
            m = re.fullmatch(r"ppt/slides/slide(\d+)\.xml", nm)
            if m:
                slide_files.append((int(m.group(1)), nm))
        slide_files.sort(key=lambda x: x[0])
        slide_count = len(slide_files)

        bg_counts: Counter = Counter()
        title_colors: Counter = Counter()
        body_colors: Counter = Counter()
        title_sizes: List[float] = []
        body_sizes: List[float] = []
        title_fonts: Counter = Counter()
        body_fonts: Counter = Counter()
        sections_blueprint: List[str] = []
        seen_sec: Set[str] = set()
        raw_lines_for_classify: List[Dict[str, Any]] = []

        for _, spath in slide_files[:30]:
            sroot = _read_zip_xml(zf, spath)
            if sroot is None:
                continue

            for bg_el in _iter_local(sroot, "bgPr"):
                sf = _find_child(bg_el, "solidFill")
                if sf is not None:
                    bcol = _resolve_drawing_fill_color(sf, theme_colors)
                    if bcol:
                        bg_counts[bcol] += 1
                break

            for sp in _iter_local(sroot, "sp"):
                is_title = False
                for ph in _iter_local(sp, "ph"):
                    ptype = (_get_attr(ph, "type") or "").strip().lower()
                    if ptype in ("title", "ctrtitle", "subtitle"):
                        is_title = True
                sp_texts: List[str] = []
                for r_el in _iter_local(sp, "r"):
                    t_el = _find_child(r_el, "t")
                    txt = (t_el.text or "").strip() if t_el is not None else ""
                    if txt:
                        sp_texts.append(txt)
                    rpr = _find_child(r_el, "rPr")
                    if rpr is not None:
                        sz_hundredths = _safe_float(_get_attr(rpr, "sz"))
                        sz_pt = round(sz_hundredths / 100.0, 1) if sz_hundredths and sz_hundredths > 0 else None
                        sf = _find_child(rpr, "solidFill")
                        rcol = _resolve_drawing_fill_color(sf, theme_colors) if sf is not None else None
                        latin = _find_child(rpr, "latin")
                        rf = (_get_attr(latin, "typeface") or "").strip() if latin is not None else ""
                        if rf.startswith("+"):
                            rf = major_font if "mj" in rf.lower() else minor_font
                        if is_title:
                            if sz_pt:
                                title_sizes.append(sz_pt)
                            if rcol:
                                title_colors[rcol] += max(1, len(txt))
                            if rf:
                                title_fonts[rf] += max(1, len(txt))
                        else:
                            if sz_pt:
                                body_sizes.append(sz_pt)
                            if rcol:
                                body_colors[rcol] += max(1, len(txt))
                            if rf:
                                body_fonts[rf] += max(1, len(txt))

                joined = " ".join(sp_texts).strip()
                if joined:
                    raw_lines_for_classify.append({"text": joined})
                    if is_title:
                        clean_t = _sanitize_section_title(joined)
                        if clean_t and clean_t.lower() not in seen_sec:
                            seen_sec.add(clean_t.lower())
                            sections_blueprint.append(clean_t)

        page_bg = bg_counts.most_common(1)[0][0] if bg_counts else (theme_colors.get("lt1") or "#FFFFFF")
        is_dark = _luminance(page_bg) < 0.22
        text_color = (
            body_colors.most_common(1)[0][0]
            if body_colors
            else ("#E2E8F0" if is_dark else (theme_colors.get("dk1") or "#1E293B"))
        )
        heading_color = (
            title_colors.most_common(1)[0][0]
            if title_colors
            else ("#F8FAFC" if is_dark else (theme_colors.get("dk2") or "#0F172A"))
        )
        accent_color = (
            theme_colors.get("accent1")
            if theme["has_theme"] and theme_colors.get("accent1")
            else heading_color
        )
        accent_dark = _darken_hex(accent_color, 0.25)
        accent_soft = _mix_hex(page_bg, accent_color, 0.12 if not is_dark else 0.22)
        muted_color = _mix_hex(text_color, page_bg, 0.40)
        border_pal = _mix_hex(page_bg, text_color, 0.22)
        surface_pal = _mix_hex(page_bg, text_color, 0.05) if not is_dark else _mix_hex(page_bg, "#FFFFFF", 0.08)

        head_font = title_fonts.most_common(1)[0][0] if title_fonts else major_font
        body_font = body_fonts.most_common(1)[0][0] if body_fonts else minor_font
        body_family = _classify_font_family(body_font)
        heading_family = _classify_font_family(head_font)
        h_hint = _base_font_hint(head_font)
        b_hint = _base_font_hint(body_font)
        font_hint = f"{h_hint} / {b_hint}" if (h_hint and b_hint and h_hint.lower() != b_hint.lower()) else (b_hint or h_hint)

        raw_body_sz = statistics.median(body_sizes) if body_sizes else 14.0
        raw_h1_sz = statistics.median(title_sizes) if title_sizes else 26.0
        body_sz = round(max(9.5, min(14.0, raw_body_sz * 0.72 if raw_body_sz > 15 else raw_body_sz)), 1)
        h1_sz = round(max(15.0, min(28.0, raw_h1_sz * 0.72 if raw_h1_sz > 28 else raw_h1_sz)), 1)

        extracted_assets: List[Dict[str, Any]] = []
        logo_rel: Optional[str] = None
        if extract_assets and assets_dir is not None:
            extracted_assets, logo_rel = _extract_ooxml_logo(zf, "ppt/media/", Path(assets_dir))

        document_type = _classify_document_type(
            raw_lines_for_classify,
            has_tables=False,
            body_family=body_family,
            columns=1,
            page_count=max(1, slide_count),
        )

        raw_spec: Dict[str, Any] = {
            "version": DESIGN_SPEC_VERSION,
            "name": "",
            "slug": "",
            "source_pdf": file_path.name,
            "source_format": "pptx",
            "supported_outputs": ["pdf", "docx"],
            "document_type": document_type,
            "page": {
                "width_pt": slide_w,
                "height_pt": slide_h,
                "size_name": "custom",
                "orientation": "landscape" if slide_w >= slide_h else "portrait",
                "margins_pt": {"top": 42.0, "right": 48.0, "bottom": 40.0, "left": 48.0},
                "background_hex": page_bg,
                "columns": 1,
                "column_gap_pt": 18.0,
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
                "table_head_bg": accent_color,
                "table_head_fg": "#FFFFFF" if _luminance(accent_color) < 0.45 else "#0F172A",
                "table_alt": surface_pal,
            },
            "typography": {
                "body_family": body_family,
                "heading_family": heading_family,
                "font_hint": font_hint,
                "body_size": body_sz,
                "body_leading": round(body_sz * 1.4, 1),
                "body_align": "left",
                "h1": {
                    "size": h1_sz,
                    "leading": round(h1_sz * 1.25, 1),
                    "color": heading_color,
                    "uppercase": False,
                    "decoration": "underline",
                    "align": "left",
                },
            },
            "header": {
                "enabled": bool(logo_rel),
                "skip_first_page": True,
                "logo_asset": logo_rel,
            },
            "footer": {
                "enabled": True,
                "skip_first_page": True,
                "left": "{title}",
                "center": "",
                "right": "{page} / {total}",
            },
            "cover": {
                "enabled": slide_count >= 2,
                "layout": "centered" if slide_count >= 2 else "none",
                "logo_asset": logo_rel,
            },
            "presentation": {
                "slide_width_pt": slide_w,
                "slide_height_pt": slide_h,
                "aspect_ratio": aspect_ratio,
                "slide_count": slide_count,
                "layouts_detected": layouts_detected[:16],
            },
            "sections_blueprint": sections_blueprint[:16],
            "notes": "",
        }

        design_spec = normalize_design_spec(raw_spec)
        confidence = round(min(0.95, 0.80 + (0.06 if theme["has_theme"] else 0.0) + (0.05 if slide_count >= 1 else 0.0)), 2)
        summary = _build_office_summary(design_spec, page_count=max(1, slide_count), source_format="pptx")
        return {
            "ok": True,
            "file_name": file_path.name,
            "source_format": "pptx",
            "page_count": max(1, slide_count),
            "is_scanned_or_low_text": slide_count == 0,
            "confidence": confidence,
            "design_spec": design_spec,
            "summary": summary,
            "extracted_assets": extracted_assets,
            "preview_images": [],
            "warnings": warnings,
        }


# ---------------------------------------------------------------------------
# Fallback limpio para `.csv`, `.tsv`, `.doc`, `.rtf`, `.odt`, `.xls`, `.ods`
# ---------------------------------------------------------------------------


def _infer_csv_number_formats(rows: Sequence[Sequence[str]]) -> Dict[str, str]:
    """Detecta tipos de formato numérico en RAM sin almacenar ningún valor."""
    fmts = dict(DEFAULT_DESIGN_SPEC["spreadsheet"]["number_formats"])
    for row in rows[:50]:
        for cell in row[:24]:
            s = (cell or "").strip()
            if not s:
                continue
            if re.fullmatch(r"[$€£¥]\s*-?\d[\d,]*(?:\.\d+)?", s):
                sym = s[0]
                fmts["currency"] = f"{sym}#,##0.00"
            elif re.fullmatch(r"-?\d+(?:\.\d+)?\s*%", s):
                fmts["percent"] = "0.0%"
            elif re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
                fmts["date"] = "yyyy-mm-dd"
            elif re.fullmatch(r"\d{1,2}/\d{1,2}/\d{2,4}", s):
                fmts["date"] = "dd/mm/yyyy"
    return fmts


def _inspect_fallback_office(file_path: Path) -> Dict[str, Any]:
    ext = file_path.suffix.lower()
    parsed = read_universal_document(file_path)
    if not parsed.get("ok"):
        return {
            "ok": False,
            "error": str(parsed.get("error") or f"No se pudo leer el documento {file_path.name}."),
        }

    warnings: List[str] = []
    if ext in (".csv", ".tsv", ".xls", ".ods"):
        source_fmt = "csv" if ext in (".csv", ".tsv") else "xlsx"
        warnings.append(
            f"El formato {ext.upper().lstrip('.')} no contiene estilos visuales embebidos; "
            "se extrajo la estructura de columnas saneada y se aplicó una base visual profesional editable."
        )
        sheets_blueprint: List[Dict[str, Any]] = []
        all_rows_sample: List[List[str]] = []
        raw_lines_for_classify: List[Dict[str, Any]] = []

        for s_idx, sh in enumerate((parsed.get("sheets") or [])[:8], start=1):
            clean_name = _sanitize_spreadsheet_label(sh.get("name"), max_len=31) or f"Hoja {s_idx}"
            raw_headers = sh.get("headers") or []
            clean_cols: List[str] = []
            col_widths: List[float] = []
            for c_idx, h in enumerate(raw_headers[:24], start=1):
                if isinstance(h, str) and h.strip():
                    raw_lines_for_classify.append({"text": h})
                clean_c = _sanitize_spreadsheet_label(h, max_len=48) or f"Columna {c_idx}"
                clean_cols.append(clean_c)
                col_widths.append(round(max(12.0, min(32.0, len(clean_c) * 1.35 + 5.0)), 1))

            rows = sh.get("rows") or []
            all_rows_sample.extend(rows[:30])
            has_totals = False
            for r in rows[-3:]:
                if r and isinstance(r[0], str) and _TOTAL_LABEL_RE.search(r[0]):
                    has_totals = True
                    break

            sheets_blueprint.append(
                {
                    "name": clean_name,
                    "columns": clean_cols,
                    "col_widths": col_widths,
                    "has_title_banner": False,
                    "header_row": 1,
                    "has_totals_row": has_totals,
                    "formula_patterns": ["SUM"] if has_totals else [],
                }
            )

        num_fmts = _infer_csv_number_formats(all_rows_sample)
        document_type = _classify_document_type(
            raw_lines_for_classify,
            has_tables=True,
            body_family="sans",
            columns=1,
            page_count=max(1, len(sheets_blueprint)),
        )
        raw_spec: Dict[str, Any] = {
            "version": DESIGN_SPEC_VERSION,
            "source_pdf": file_path.name,
            "source_format": source_fmt,
            "supported_outputs": ["xlsx", "pdf"],
            "document_type": document_type,
            "spreadsheet": {
                "sheets_blueprint": sheets_blueprint,
                "number_formats": num_fmts,
                "freeze_header": True,
                "auto_filter": len(sheets_blueprint) > 0 and len(sheets_blueprint[0]["columns"]) >= 2,
            },
            "sections_blueprint": [s["name"] for s in sheets_blueprint],
        }
        design_spec = normalize_design_spec(raw_spec)
        page_count = max(1, len(sheets_blueprint))
        return {
            "ok": True,
            "file_name": file_path.name,
            "source_format": source_fmt,
            "page_count": page_count,
            "is_scanned_or_low_text": False,
            "confidence": 0.62,
            "design_spec": design_spec,
            "summary": _build_office_summary(design_spec, page_count=page_count, source_format=source_fmt),
            "extracted_assets": [],
            "preview_images": [],
            "warnings": warnings,
        }

    warnings.append(
        f"El formato {ext.upper().lstrip('.')} se inspeccionó por estructura de secciones "
        "(sin estilos OOXML nativos); se asignó una base visual editorial editable."
    )
    sections_blueprint: List[str] = []
    seen_sec: Set[str] = set()
    raw_lines: List[Dict[str, Any]] = []
    has_tables = False
    for blk in parsed.get("blocks") or []:
        btype = blk.get("type")
        if btype == "heading":
            txt = str(blk.get("text") or "")
            raw_lines.append({"text": txt})
            cleaned = _sanitize_section_title(txt)
            if cleaned and cleaned.lower() not in seen_sec:
                seen_sec.add(cleaned.lower())
                sections_blueprint.append(cleaned)
        elif btype == "paragraph":
            raw_lines.append({"text": str(blk.get("text") or "")})
        elif btype == "table":
            has_tables = True

    page_count = max(1, int(parsed.get("page_count") or 1))
    document_type = _classify_document_type(
        raw_lines,
        has_tables=has_tables,
        body_family="sans",
        columns=1,
        page_count=page_count,
    )
    raw_spec = {
        "version": DESIGN_SPEC_VERSION,
        "source_pdf": file_path.name,
        "source_format": "docx",
        "supported_outputs": ["docx", "pdf"],
        "document_type": document_type,
        "sections_blueprint": sections_blueprint[:16],
    }
    design_spec = normalize_design_spec(raw_spec)
    return {
        "ok": True,
        "file_name": file_path.name,
        "source_format": "docx",
        "page_count": page_count,
        "is_scanned_or_low_text": not bool(parsed.get("text")),
        "confidence": 0.60,
        "design_spec": design_spec,
        "summary": _build_office_summary(design_spec, page_count=page_count, source_format="docx"),
        "extracted_assets": [],
        "preview_images": [],
        "warnings": warnings,
    }


# ---------------------------------------------------------------------------
# Resumen humano Zero-Jargon
# ---------------------------------------------------------------------------


def _build_office_summary(spec: Dict[str, Any], *, page_count: int, source_format: str) -> str:
    pal = spec["palette"]
    typo = spec["typography"]

    if source_format in ("xlsx", "csv"):
        ss = spec["spreadsheet"]
        sheets = ss.get("sheets_blueprint") or []
        n_sheets = max(page_count, len(sheets))
        orient_lbl = "horizontal" if ss["print_orientation"] == "landscape" else "vertical"
        cols_preview = ""
        if sheets and sheets[0].get("columns"):
            cols_preview = f" ({len(sheets[0]['columns'])} columnas en la primera hoja)"
        parts = [
            f"Libro {'Excel' if source_format == 'xlsx' else 'tabular CSV'} de {n_sheets} hoja(s){cols_preview}",
            f"tipografía {ss['body_font_name']} {ss['body_font_size']} pt",
            f"cabecera {ss['header_bg']} / texto {ss['header_fg']} y filas cebradas {ss['alt_row_bg'] or 'sin relleno'}",
            f"bordes {ss['border_style']} ({ss['border_color']})",
            f"orientación de impresión {orient_lbl}",
        ]
        extras: List[str] = []
        if ss["freeze_header"]:
            extras.append("encabezado congelado")
        if ss["auto_filter"]:
            extras.append("autofiltro activo")
        all_formulas = sorted({fp for s in sheets for fp in (s.get("formula_patterns") or [])})
        if all_formulas:
            extras.append(f"fórmulas {', '.join(all_formulas[:4])}")
        if extras:
            parts.append(", ".join(extras))
        return "; ".join(parts) + "."

    if source_format == "pptx":
        pres = spec["presentation"]
        hint = f" ({typo['font_hint']})" if typo.get("font_hint") else ""
        parts = [
            f"Presentación {pres['aspect_ratio']} ({pres['slide_width_pt']:.0f}×{pres['slide_height_pt']:.0f} pt, {pres['slide_count']} diapositiva(s))",
            f"tipografía {typo['body_family']}{hint}",
            f"paleta fondo {pal['page_bg']} / texto {pal['text']} / acento {pal['accent']}",
        ]
        if pres.get("layouts_detected"):
            parts.append(f"{len(pres['layouts_detected'])} diseños de diapositiva detectados")
        return "; ".join(parts) + "."

    page = spec["page"]
    hdr = spec["header"]
    ftr = spec["footer"]
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
        f"Documento Word {size_label} {orient_label} ({page['width_pt']:.0f}×{page['height_pt']:.0f} pt, {page_count} pág., {cols_lbl})",
        f"tipografía {body_fam}{hint} cuerpo {typo['body_size']} pt ({align_lbl})",
        f"paleta fondo {pal['page_bg']} / texto {pal['text']} / acento {pal['accent']}",
    ]
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
    return "; ".join(parts) + "."


# ---------------------------------------------------------------------------
# API principal: inspect_office_design
# ---------------------------------------------------------------------------


def inspect_office_design(
    file_path: Path,
    *,
    extract_assets: bool = False,
    assets_dir: Optional[Path] = None,
) -> Dict[str, Any]:
    """
    Inspecciona el diseño visual y estructural real de un documento Office
    (`.docx`, `.xlsx`, `.pptx`) o formato tabular/legado (`.csv`, `.tsv`,
    `.doc`, `.rtf`, `.odt`, `.xls`, `.ods`).

    Devuelve la misma estructura de nivel superior que `inspect_pdf_design`:
    `{ok, file_name, source_format, page_count, is_scanned_or_low_text,
    confidence, design_spec, summary, extracted_assets, preview_images, warnings}`.
    """
    path = Path(file_path)
    if not path.is_file():
        return {"ok": False, "error": f"No existe el archivo: {path.name}"}

    ext = path.suffix.lower()
    if ext == ".docx":
        return _inspect_docx(path, extract_assets=extract_assets, assets_dir=assets_dir)
    if ext == ".xlsx":
        return _inspect_xlsx(path, extract_assets=extract_assets, assets_dir=assets_dir)
    if ext == ".pptx":
        return _inspect_pptx(path, extract_assets=extract_assets, assets_dir=assets_dir)
    if ext in (".csv", ".tsv", ".doc", ".rtf", ".odt", ".xls", ".ods"):
        return _inspect_fallback_office(path)

    return {
        "ok": False,
        "error": f"Formato Office no soportado para inspección de diseño: {ext or '(sin extensión)'}.",
    }
