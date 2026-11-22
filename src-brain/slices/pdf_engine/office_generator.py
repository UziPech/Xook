"""
Generador y editor nativo cero-dependencias de documentos Word (`.docx`) y Excel (`.xlsx`)
para XOOK.

Construye archivos OOXML 100% válidos (ECMA-376) utilizando únicamente la biblioteca
estándar de Python (`zipfile`, `xml.etree.ElementTree`, `xml.sax.saxutils`, `json`,
`hashlib`, `os`, `re`, `datetime`, `pathlib`) + `Pillow` (ya instalada) para dimensiones
y normalización PNG de logotipos/imágenes.

Características principales:
- Replica fielmente cualquier `design-spec.json` (proveniente de PDF, Word, Excel o PPTX)
  y permite sobreescrituras libres mediante `design_overrides`.
- Genera `.docx` profesionales con `word/styles.xml`, `word/numbering.xml`,
  `word/theme/theme1.xml`, encabezados/pies con campos nativos `PAGE`/`NUMPAGES`,
  logotipos, tablas estilizadas, `kv_grid`, `columns`, `signature_block`, `callout`,
  `box`, `kpi_strip`, `code`, formato inline (`**negrita**`, `*cursiva*`, `` `código` ``).
- Genera `.xlsx` profesionales con múltiples hojas, banner de título combinado,
  cabeceras estilizadas, filas cebra, formatos numéricos (`currency`, `percent`,
  `integer`, `decimal`, `date` y personalizados), fórmulas reales `<f>` con valores
  cacheados `<v>`, fila automática de totales `SUM`, paneles congelados (`pane`),
  autofiltros, anchos de columna inteligentes y configuración de impresión.
- Persiste metadatos editables en `.xook/office_specs/<sha1>.json` para que
  `edit_action="modify"` conserve el diseño visual en ediciones iterativas.
"""

from __future__ import annotations

import ast
import copy
from datetime import datetime, timezone
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import time
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape as _sax_escape, quoteattr as _sax_quoteattr
import zipfile

from PIL import Image as PILImage

from slices.pdf_engine.generator import (
    THEMES,
    _is_dark_hex,
    _json_safe_copy,
    _load_pil_image,
    _normalize_blocks_input,
    _parse_markdown_to_blocks,
    _pil_to_png_buffer,
    _resolve_design_asset_path,
    _resolve_workspace_file_smart,
    _safe_hex_color,
    _slugify,
    _spanish_date_label,
    _strip_private_keys,
)
from slices.pdf_engine.inspector import (
    merge_design_spec,
    normalize_design_spec,
    resolve_design_skill_spec,
)

# ---------------------------------------------------------------------------
# Constantes OOXML y defaults de Word / Excel
# ---------------------------------------------------------------------------

_W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
_R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
_WP_NS = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
_A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
_PIC_NS = "http://schemas.openxmlformats.org/drawingml/2006/picture"
_CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
_PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
_CP_NS = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
_DC_NS = "http://purl.org/dc/elements/1.1/"
_DCTERMS_NS = "http://purl.org/dc/terms/"
_XSI_NS = "http://www.w3.org/2001/XMLSchema-instance"
_APP_NS = "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
_SML_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"

_DEFAULT_DOCX_SECTION: Dict[str, Any] = {
    "style_names": {
        "h1": "Heading1",
        "h2": "Heading2",
        "h3": "Heading3",
        "body": "Normal",
    },
    "different_first_page": False,
    "section_break_pages": False,
}

_DEFAULT_SPREADSHEET_SECTION: Dict[str, Any] = {
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
        "decimal": "#,##0.00",
    },
    "print_orientation": "portrait",
}

_SERIF_HINTS = (
    "serif", "georgia", "times", "garamond", "cambria", "palatino",
    "baskerville", "bookman", "merriweather", "playfair", "lora", "crimson",
    "charter", "minion", "book antiqua", "spectral", "bitter", "didot", "bodoni",
)
_MONO_HINTS = (
    "mono", "courier", "consolas", "menlo", "monaco", "fira code",
    "jetbrains", "inconsolata", "source code", "typewriter", "lucida console",
)
_XML_ILLEGAL_RE = re.compile(r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\uFFFE\uFFFF]")
_INVALID_SHEET_CHARS_RE = re.compile(r"[:\\/?*\[\]]")
_CELL_REF_RE = re.compile(r"\$?([A-Za-z]{1,3})\$?(\d+)")
_RANGE_REF_RE = re.compile(r"\$?([A-Za-z]{1,3})\$?(\d+):\$?([A-Za-z]{1,3})\$?(\d+)")


# ---------------------------------------------------------------------------
# Utilidades XML, color, tipografía y rutas
# ---------------------------------------------------------------------------


def _clean_xml_text(raw: Any) -> str:
    txt = str("" if raw is None else raw)
    txt = txt.replace("\r\n", "\n").replace("\r", "\n")
    return _XML_ILLEGAL_RE.sub("", txt)


def _xml_esc(raw: Any) -> str:
    return _sax_escape(_clean_xml_text(raw))


def _xml_attr(raw: Any) -> str:
    return _sax_quoteattr(_clean_xml_text(raw))


def _hex6(raw: Any, fallback: str = "1E293B") -> str:
    fb = fallback.lstrip("#").upper()
    if len(fb) != 6:
        fb = "1E293B"
    return _safe_hex_color(raw, f"#{fb}").lstrip("#").upper()


def _argb8(raw: Any, fallback: str = "1E293B") -> str:
    return f"FF{_hex6(raw, fallback)}"


def _pt_to_twips(pt: float) -> int:
    return max(0, int(round(float(pt) * 20.0)))


def _pt_to_half_pt(pt: float) -> int:
    return max(2, int(round(float(pt) * 2.0)))


def _pt_to_eighth_pt(pt: float) -> int:
    return max(2, min(96, int(round(float(pt) * 8.0))))


def _pt_to_emu(pt: float) -> int:
    return max(12700, int(round(float(pt) * 12700.0)))


def _classify_font_hint(font_name: str) -> str:
    low = (font_name or "").strip().lower()
    if not low:
        return ""
    for tok in _MONO_HINTS:
        if tok in low:
            return "mono"
    if "sans" in low:
        return "sans"
    for tok in _SERIF_HINTS:
        if tok in low:
            return "serif"
    return "sans"


def _resolve_office_font_name(
    family: str,
    font_hint: str = "",
    *,
    default_sans: str = "Arial",
) -> str:
    """Resuelve el nombre de fuente nativo para Word/Excel respetando `font_hint` si coincide."""
    fam = str(family or "sans").strip().lower()
    if fam not in ("sans", "serif", "mono"):
        fam = "sans"

    clean_hint = _clean_xml_text(font_hint).strip()[:64]
    # Ignorar nombres internos de ReportLab o tokens vacíos
    if clean_hint and not clean_hint.lower().startswith("xook") and not re.search(r"[<>\"&]", clean_hint):
        if _classify_font_hint(clean_hint) == fam:
            return clean_hint

    if fam == "serif":
        return "Georgia"
    if fam == "mono":
        return "Courier New"
    return default_sans


def _deep_merge(base: Dict[str, Any], over: Dict[str, Any]) -> Dict[str, Any]:
    out = copy.deepcopy(base)
    for k, v in over.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def _coerce_bool(val: Any, default: bool) -> bool:
    if isinstance(val, bool):
        return val
    if isinstance(val, (int, float)) and val in (0, 1):
        return bool(val)
    if isinstance(val, str):
        low = val.strip().lower()
        if low in ("true", "1", "yes", "si", "sí"):
            return True
        if low in ("false", "0", "no"):
            return False
    return default


def _clamp_float(val: Any, default: float, lo: float, hi: float) -> float:
    try:
        if isinstance(val, bool) or val is None:
            return default
        num = float(val)
        if not math.isfinite(num):
            return default
        return round(max(lo, min(hi, num)), 2)
    except (TypeError, ValueError):
        return default


def _local_tag(tag: str) -> str:
    return tag.split("}", 1)[1] if "}" in tag else tag


def _col_index_to_letters(idx: int) -> str:
    n = max(0, int(idx)) + 1
    chars: List[str] = []
    while n > 0:
        n, rem = divmod(n - 1, 26)
        chars.append(chr(ord("A") + rem))
    return "".join(reversed(chars))


def _col_letters_to_index(letters: str) -> int:
    clean = "".join(ch for ch in (letters or "") if ch.isalpha()).upper()
    if not clean:
        return 0
    idx = 0
    for ch in clean:
        idx = idx * 26 + (ord(ch) - ord("A") + 1)
    return max(0, idx - 1)


def _utc_iso_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _atomic_write_bytes(target_abs: Path, data: bytes) -> None:
    target_abs.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = target_abs.with_name(f".{target_abs.name}.tmp.{os.getpid()}.{time.time_ns()}")
    try:
        tmp_path.write_bytes(data)
        os.replace(str(tmp_path), str(target_abs))
    finally:
        if tmp_path.exists():
            try:
                tmp_path.unlink()
            except Exception:
                pass


def _office_spec_path(workspace_root: Path, rel_path: str) -> Path:
    spec_dir = workspace_root / ".xook" / "office_specs"
    spec_dir.mkdir(parents=True, exist_ok=True)
    norm = rel_path.strip().replace("\\", "/").lstrip("./").lower()
    key = hashlib.sha1(norm.encode("utf-8")).hexdigest()[:16]
    return spec_dir / f"{key}.json"


def _save_office_spec_metadata(workspace_root: Path, rel_path: str, payload: Dict[str, Any]) -> None:
    try:
        p = _office_spec_path(workspace_root, rel_path)
        clean = _json_safe_copy(payload)
        clean["saved_at"] = _utc_iso_now()
        clean["rel_path"] = rel_path
        raw = (json.dumps(clean, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        _atomic_write_bytes(p, raw)
    except Exception:
        pass


def _load_office_spec_metadata(workspace_root: Path, rel_path: str) -> Optional[Dict[str, Any]]:
    try:
        p = _office_spec_path(workspace_root, rel_path)
        if not p.is_file():
            return None
        loaded = json.loads(p.read_text(encoding="utf-8"))
        return loaded if isinstance(loaded, dict) else None
    except Exception:
        return None


def _resolve_output_path(
    raw_out: str,
    *,
    title: str,
    ext: str,
    workspace_root: Path,
    resolve_path_fn: Callable[[Path, str], Tuple[Path, str, str]],
    autonomous_roots: Tuple[str, ...],
    allow_any_workspace_zone: bool,
) -> Tuple[Path, str]:
    clean_ext = ext if ext.startswith(".") else f".{ext}"
    cleaned = str(raw_out or "").strip()
    if cleaned:
        if not cleaned.lower().endswith(clean_ext.lower()):
            cleaned += clean_ext
        out_abs, out_rel, top_zone = resolve_path_fn(workspace_root, cleaned)
        if top_zone not in autonomous_roots and not allow_any_workspace_zone:
            safe_name = Path(cleaned).name
            out_rel = f"agente/reportes/{safe_name}"
            out_abs, out_rel, _ = resolve_path_fn(workspace_root, out_rel)
    else:
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        out_rel = f"agente/reportes/{_slugify(title)}_{stamp}{clean_ext}"
        out_abs, out_rel, _ = resolve_path_fn(workspace_root, out_rel)
    out_abs.parent.mkdir(parents=True, exist_ok=True)
    return out_abs, out_rel


def _normalize_docx_section(raw: Any) -> Dict[str, Any]:
    src = raw if isinstance(raw, dict) else {}
    raw_names = src.get("style_names") if isinstance(src.get("style_names"), dict) else {}
    def_names = _DEFAULT_DOCX_SECTION["style_names"]
    return {
        "style_names": {
            "h1": str(raw_names.get("h1") or def_names["h1"]).strip()[:48] or "Heading1",
            "h2": str(raw_names.get("h2") or def_names["h2"]).strip()[:48] or "Heading2",
            "h3": str(raw_names.get("h3") or def_names["h3"]).strip()[:48] or "Heading3",
            "body": str(raw_names.get("body") or def_names["body"]).strip()[:48] or "Normal",
        },
        "different_first_page": _coerce_bool(src.get("different_first_page"), False),
        "section_break_pages": _coerce_bool(src.get("section_break_pages"), False),
    }


def _normalize_spreadsheet_section(
    raw: Any,
    *,
    design_spec: Dict[str, Any],
    explicit_keys: Optional[set] = None,
) -> Dict[str, Any]:
    """
    Normaliza la sección `spreadsheet` de `design_spec` con fallback inteligente hacia
    `tables`, `palette`, `typography` y `page` para que incluso una habilidad de diseño
    PDF/Word genere libros de Excel coordinados visualmente.
    """
    src = raw if isinstance(raw, dict) else {}
    exp = explicit_keys if explicit_keys is not None else set(src.keys())
    pal = design_spec.get("palette") if isinstance(design_spec.get("palette"), dict) else {}
    tbl = design_spec.get("tables") if isinstance(design_spec.get("tables"), dict) else {}
    typo = design_spec.get("typography") if isinstance(design_spec.get("typography"), dict) else {}
    page = design_spec.get("page") if isinstance(design_spec.get("page"), dict) else {}

    def _pick_color(ss_key: str, *fallbacks: Any, default: str) -> str:
        if ss_key in exp and src.get(ss_key):
            return _safe_hex_color(src.get(ss_key), default)
        for fb in fallbacks:
            if fb:
                return _safe_hex_color(fb, default)
        if src.get(ss_key):
            return _safe_hex_color(src.get(ss_key), default)
        return default

    header_bg = _pick_color("header_bg", tbl.get("header_bg"), pal.get("table_head_bg"), pal.get("accent_dark"), default="#0F172A")
    header_fg = _pick_color("header_fg", tbl.get("header_fg"), pal.get("table_head_fg"), default="#FFFFFF")
    alt_row_bg = _pick_color("alt_row_bg", tbl.get("alt_row_bg"), pal.get("table_alt"), pal.get("surface"), default="#F8FAFC")
    total_row_bg = _pick_color("total_row_bg", pal.get("accent_soft"), pal.get("surface"), default="#EFF6FF")
    total_row_fg = _pick_color("total_row_fg", pal.get("heading"), pal.get("text"), default="#0F172A")
    border_color = _pick_color("border_color", tbl.get("border_color"), pal.get("border"), default="#CBD5E1")

    if "body_font_name" in exp and str(src.get("body_font_name") or "").strip():
        body_font_name = _clean_xml_text(src.get("body_font_name")).strip()[:64]
    else:
        body_font_name = _resolve_office_font_name(
            str(typo.get("body_family") or "sans"),
            str(typo.get("font_hint") or ""),
            default_sans="Calibri",
        )

    body_font_size = _clamp_float(
        src.get("body_font_size") if "body_font_size" in exp else (typo.get("body_size") or src.get("body_font_size")),
        10.0,
        7.0,
        24.0,
    )
    header_font_size = _clamp_float(
        src.get("header_font_size") if "header_font_size" in exp else (src.get("header_font_size") or body_font_size),
        10.0,
        7.0,
        28.0,
    )

    raw_bstyle = str(src.get("border_style") or "").strip().lower() if "border_style" in exp else ""
    if raw_bstyle not in ("thin", "medium", "none", "horizontal"):
        tbl_style = str(tbl.get("style") or "striped").strip().lower()
        if tbl_style in ("minimal_rules", "clean", "invoice"):
            raw_bstyle = "horizontal"
        elif str(src.get("border_style") or "").strip().lower() in ("thin", "medium", "none", "horizontal"):
            raw_bstyle = str(src.get("border_style")).strip().lower()
        else:
            raw_bstyle = "thin"

    raw_orient = str(
        src.get("print_orientation")
        if "print_orientation" in exp
        else (page.get("orientation") or src.get("print_orientation") or "portrait")
    ).strip().lower()
    print_orientation = raw_orient if raw_orient in ("portrait", "landscape") else "portrait"

    def_fmts = dict(_DEFAULT_SPREADSHEET_SECTION["number_formats"])
    raw_fmts = src.get("number_formats") if isinstance(src.get("number_formats"), dict) else {}
    merged_fmts = dict(def_fmts)
    for k, v in raw_fmts.items():
        if isinstance(k, str) and isinstance(v, str) and v.strip():
            merged_fmts[k.strip().lower()] = _clean_xml_text(v).strip()[:80]

    raw_bp = src.get("sheets_blueprint")
    sheets_blueprint = copy.deepcopy(raw_bp) if isinstance(raw_bp, list) else []

    return {
        "sheets_blueprint": sheets_blueprint,
        "header_bg": header_bg,
        "header_fg": header_fg,
        "header_bold": _coerce_bool(src.get("header_bold"), True),
        "header_font_size": header_font_size,
        "body_font_name": body_font_name,
        "body_font_size": body_font_size,
        "alt_row_bg": alt_row_bg,
        "total_row_bg": total_row_bg,
        "total_row_fg": total_row_fg,
        "total_row_bold": _coerce_bool(src.get("total_row_bold"), True),
        "border_style": raw_bstyle,
        "border_color": border_color,
        "freeze_header": _coerce_bool(src.get("freeze_header"), True),
        "auto_filter": _coerce_bool(src.get("auto_filter"), False),
        "show_gridlines": _coerce_bool(src.get("show_gridlines"), True),
        "default_col_width": _clamp_float(src.get("default_col_width"), 16.0, 6.0, 64.0),
        "number_formats": merged_fmts,
        "print_orientation": print_orientation,
    }


def _resolve_office_design_spec(
    *,
    design_skill_ref: str,
    raw_inline_design: Optional[Dict[str, Any]],
    raw_design_overrides: Optional[Dict[str, Any]],
    base_design: Optional[Dict[str, Any]],
    target_format: str,
    workspace_root: Path,
    global_skills_dir: Optional[Path],
    warnings: List[str],
) -> Tuple[Dict[str, Any], Optional[str], Optional[str], Dict[str, Any]]:
    """
    Resuelve y fusiona la cadena completa de diseño:
    `base_design` / `design_skill` -> `design_spec` inline -> `design_overrides`,
    preservando las secciones aditivas (`spreadsheet`, `docx`, `source_format`,
    `supported_outputs`) incluso si `inspector.py` aún no las normaliza nativamente.
    """
    resolved_skill_slug: Optional[str] = None
    resolved_skill_dir: Optional[str] = None
    resolved_assets: Dict[str, Any] = {}

    working: Dict[str, Any] = normalize_design_spec(base_design) if isinstance(base_design, dict) else normalize_design_spec({})
    raw_docx_acc: Dict[str, Any] = copy.deepcopy(base_design.get("docx")) if isinstance(base_design, dict) and isinstance(base_design.get("docx"), dict) else {}
    raw_ss_acc: Dict[str, Any] = copy.deepcopy(base_design.get("spreadsheet")) if isinstance(base_design, dict) and isinstance(base_design.get("spreadsheet"), dict) else {}
    explicit_ss_keys: set = set(raw_ss_acc.keys())
    source_format = str(base_design.get("source_format") or target_format) if isinstance(base_design, dict) else target_format
    supported_outputs = list(base_design.get("supported_outputs") or []) if isinstance(base_design, dict) else []

    if isinstance(base_design, dict):
        if base_design.get("_skill_slug"):
            resolved_skill_slug = str(base_design["_skill_slug"])
        if base_design.get("_skill_dir"):
            resolved_skill_dir = str(base_design["_skill_dir"])
        if isinstance(base_design.get("_resolved_assets"), dict):
            resolved_assets.update(base_design["_resolved_assets"])

    def _read_raw_skill_json(skill_dir_str: Optional[str]) -> Optional[Dict[str, Any]]:
        if not skill_dir_str:
            return None
        cand = Path(skill_dir_str) / "design-spec.json"
        if not cand.is_file():
            return None
        try:
            data = json.loads(cand.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else None
        except Exception:
            return None

    def _capture_extras(layer: Optional[Dict[str, Any]], *, mark_ss_explicit: bool = True) -> None:
        nonlocal raw_docx_acc, raw_ss_acc, source_format, supported_outputs
        if not isinstance(layer, dict):
            return
        if isinstance(layer.get("docx"), dict):
            raw_docx_acc = _deep_merge(raw_docx_acc, layer["docx"])
        if isinstance(layer.get("spreadsheet"), dict):
            ss_layer = layer["spreadsheet"]
            raw_ss_acc = _deep_merge(raw_ss_acc, ss_layer)
            if mark_ss_explicit:
                explicit_ss_keys.update(ss_layer.keys())
        if layer.get("source_format"):
            source_format = str(layer["source_format"]).strip().lower()
        if isinstance(layer.get("supported_outputs"), list) and layer["supported_outputs"]:
            supported_outputs = [str(x).strip().lower() for x in layer["supported_outputs"] if str(x).strip()]

    if design_skill_ref:
        loaded_skill = resolve_design_skill_spec(
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
            working = normalize_design_spec(loaded_skill)
            # Leer también el JSON crudo por si inspector.py aún no preservó `spreadsheet`/`docx`
            raw_skill_json = _read_raw_skill_json(resolved_skill_dir)
            skill_src_fmt = str(
                (raw_skill_json or loaded_skill).get("source_format") or ""
            ).strip().lower()
            _capture_extras(raw_skill_json or loaded_skill, mark_ss_explicit=(skill_src_fmt == "xlsx"))
        else:
            warnings.append(f"Habilidad de diseño no encontrada ({design_skill_ref}); se usará diseño base.")

    if isinstance(raw_inline_design, dict) and raw_inline_design:
        if raw_inline_design.get("_skill_dir") and not resolved_skill_dir:
            resolved_skill_dir = str(raw_inline_design["_skill_dir"])
        if isinstance(raw_inline_design.get("_resolved_assets"), dict):
            resolved_assets.update(raw_inline_design["_resolved_assets"])
        working = merge_design_spec(working, raw_inline_design)
        _capture_extras(raw_inline_design, mark_ss_explicit=True)

    if isinstance(raw_design_overrides, dict) and raw_design_overrides:
        if isinstance(raw_design_overrides.get("_resolved_assets"), dict):
            resolved_assets.update(raw_design_overrides["_resolved_assets"])
        working = merge_design_spec(working, raw_design_overrides)
        ov_ss = raw_design_overrides.get("spreadsheet") if isinstance(raw_design_overrides.get("spreadsheet"), dict) else {}
        ov_pal = raw_design_overrides.get("palette") if isinstance(raw_design_overrides.get("palette"), dict) else {}
        ov_tbl = raw_design_overrides.get("tables") if isinstance(raw_design_overrides.get("tables"), dict) else {}
        ov_typo = raw_design_overrides.get("typography") if isinstance(raw_design_overrides.get("typography"), dict) else {}
        ov_page = raw_design_overrides.get("page") if isinstance(raw_design_overrides.get("page"), dict) else {}
        # Permitir que overrides de palette/tables/typography/page fluyan a spreadsheet si spreadsheet no los fijó
        if ("table_head_bg" in ov_pal or "header_bg" in ov_tbl) and "header_bg" not in ov_ss:
            explicit_ss_keys.discard("header_bg")
        if ("table_head_fg" in ov_pal or "header_fg" in ov_tbl) and "header_fg" not in ov_ss:
            explicit_ss_keys.discard("header_fg")
        if ("table_alt" in ov_pal or "alt_row_bg" in ov_tbl) and "alt_row_bg" not in ov_ss:
            explicit_ss_keys.discard("alt_row_bg")
        if ("border" in ov_pal or "border_color" in ov_tbl) and "border_color" not in ov_ss:
            explicit_ss_keys.discard("border_color")
        if "accent_soft" in ov_pal and "total_row_bg" not in ov_ss:
            explicit_ss_keys.discard("total_row_bg")
        if "heading" in ov_pal and "total_row_fg" not in ov_ss:
            explicit_ss_keys.discard("total_row_fg")
        if ("body_family" in ov_typo or "font_hint" in ov_typo) and "body_font_name" not in ov_ss:
            explicit_ss_keys.discard("body_font_name")
        if "body_size" in ov_typo and "body_font_size" not in ov_ss:
            explicit_ss_keys.discard("body_font_size")
        if "orientation" in ov_page and "print_orientation" not in ov_ss:
            explicit_ss_keys.discard("print_orientation")
        _capture_extras(raw_design_overrides, mark_ss_explicit=True)

    # Normalizar y adjuntar secciones aditivas de forma determinista
    working["source_format"] = source_format or target_format
    if not supported_outputs:
        supported_outputs = ["xlsx", "pdf"] if target_format == "xlsx" else ["docx", "pdf"]
    working["supported_outputs"] = supported_outputs
    working["docx"] = _normalize_docx_section(raw_docx_acc)
    working["spreadsheet"] = _normalize_spreadsheet_section(
        raw_ss_acc,
        design_spec=working,
        explicit_keys=explicit_ss_keys,
    )
    return working, resolved_skill_slug, resolved_skill_dir, resolved_assets


def _try_inspect_office_design(file_abs: Path) -> Optional[Dict[str, Any]]:
    """Intenta inspeccionar el diseño visual de un `.docx`/`.xlsx` existente de forma perezosa."""
    try:
        from slices.pdf_engine.office_inspector import inspect_office_design

        res = inspect_office_design(file_abs, extract_assets=False)
        if isinstance(res, dict) and res.get("ok") and isinstance(res.get("design_spec"), dict):
            return res["design_spec"]
    except Exception:
        pass
    return None


def _apply_replacements_to_value(val: Any, replacements: List[Tuple[str, str]]) -> Any:
    if not replacements:
        return val
    if isinstance(val, str):
        out = val
        for old_s, new_s in replacements:
            if old_s:
                out = out.replace(old_s, new_s)
        return out
    if isinstance(val, list):
        return [_apply_replacements_to_value(item, replacements) for item in val]
    if isinstance(val, dict):
        return {k: _apply_replacements_to_value(v, replacements) for k, v in val.items()}
    return val


def _normalize_replacements(raw: Any) -> List[Tuple[str, str]]:
    pairs: List[Tuple[str, str]] = []
    if isinstance(raw, dict):
        for k, v in raw.items():
            if str(k):
                pairs.append((str(k), str(v)))
    elif isinstance(raw, list):
        for item in raw:
            if isinstance(item, dict):
                old_v = item.get("old") if "old" in item else (item.get("find") or item.get("from"))
                new_v = item.get("new") if "new" in item else (item.get("replace") or item.get("to") or "")
                if old_v is not None and str(old_v):
                    pairs.append((str(old_v), str(new_v)))
    return pairs


# ---------------------------------------------------------------------------
# Propiedades comunes de paquete OOXML (`docProps/core.xml`, `app.xml`)
# ---------------------------------------------------------------------------


def _build_core_props_xml(title: str, author: str, subtitle: str = "") -> str:
    now_iso = _utc_iso_now()
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        f'<cp:coreProperties xmlns:cp="{_CP_NS}" xmlns:dc="{_DC_NS}" '
        f'xmlns:dcterms="{_DCTERMS_NS}" xmlns:xsi="{_XSI_NS}">'
        f"<dc:title>{_xml_esc(title)}</dc:title>"
        f"<dc:subject>{_xml_esc(subtitle)}</dc:subject>"
        f"<dc:creator>{_xml_esc(author or 'XOOK')}</dc:creator>"
        f"<cp:lastModifiedBy>{_xml_esc(author or 'XOOK')}</cp:lastModifiedBy>"
        f'<dcterms:created xsi:type="dcterms:W3CDTF">{now_iso}</dcterms:created>'
        f'<dcterms:modified xsi:type="dcterms:W3CDTF">{now_iso}</dcterms:modified>'
        "</cp:coreProperties>\n"
    )


def _build_app_props_xml(application: str) -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        f'<Properties xmlns="{_APP_NS}">'
        f"<Application>{_xml_esc(application)}</Application>"
        "</Properties>\n"
    )


# ===========================================================================
# MOTOR NATIVO WORD (`.docx`)
# ===========================================================================


_INLINE_MD_TOKEN_RE = re.compile(
    r"(`[^`\n]+`|\*\*[^\n*]+?\*\*|(?<!\*)\*[^\n*]+?\*(?!\*))"
)


def _parse_inline_markdown_runs(text: str) -> List[Tuple[str, bool, bool, bool]]:
    """
    Divide texto en segmentos `(texto, is_bold, is_italic, is_code)` soportando
    `**negrita**`, `*cursiva*` y `` `código` ``.
    """
    cleaned = _clean_xml_text(text)
    if not cleaned:
        return []
    parts: List[Tuple[str, bool, bool, bool]] = []
    pos = 0
    for m in _INLINE_MD_TOKEN_RE.finditer(cleaned):
        if m.start() > pos:
            parts.append((cleaned[pos:m.start()], False, False, False))
        tok = m.group(0)
        if tok.startswith("`") and tok.endswith("`") and len(tok) >= 2:
            parts.append((tok[1:-1], False, False, True))
        elif tok.startswith("**") and tok.endswith("**") and len(tok) >= 4:
            parts.append((tok[2:-2], True, False, False))
        elif tok.startswith("*") and tok.endswith("*") and len(tok) >= 2:
            parts.append((tok[1:-1], False, True, False))
        else:
            parts.append((tok, False, False, False))
        pos = m.end()
    if pos < len(cleaned):
        parts.append((cleaned[pos:], False, False, False))
    return parts


def _docx_align_val(raw: Any) -> str:
    key = str(raw or "left").strip().lower()
    if key in ("justify", "justified", "both"):
        return "both"
    if key in ("center", "centered", "centre"):
        return "center"
    if key == "right":
        return "right"
    return "left"


def _docx_rpr_xml(
    *,
    font_name: Optional[str] = None,
    size_pt: Optional[float] = None,
    color_hex: Optional[str] = None,
    bold: bool = False,
    italic: bool = False,
    caps: bool = False,
    shd_fill: Optional[str] = None,
) -> str:
    parts: List[str] = []
    if font_name:
        f = _xml_attr(font_name)
        parts.append(f'<w:rFonts w:ascii={f} w:hAnsi={f} w:cs={f}/>')
    if bold:
        parts.append("<w:b/><w:bCs/>")
    if italic:
        parts.append("<w:i/><w:iCs/>")
    if caps:
        parts.append("<w:caps/>")
    if color_hex:
        parts.append(f'<w:color w:val="{_hex6(color_hex)}"/>')
    if size_pt is not None:
        hp = _pt_to_half_pt(size_pt)
        parts.append(f'<w:sz w:val="{hp}"/><w:szCs w:val="{hp}"/>')
    if shd_fill:
        parts.append(f'<w:shd w:val="clear" w:color="auto" w:fill="{_hex6(shd_fill)}"/>')
    if not parts:
        return ""
    return f"<w:rPr>{''.join(parts)}</w:rPr>"


def _docx_text_run(text: str, rpr_xml: str = "") -> str:
    cleaned = _clean_xml_text(text)
    if "\n" not in cleaned:
        return f'<w:r>{rpr_xml}<w:t xml:space="preserve">{_xml_esc(cleaned)}</w:t></w:r>'
    lines = cleaned.split("\n")
    chunks: List[str] = []
    for idx, ln in enumerate(lines):
        if idx > 0:
            chunks.append("<w:br/>")
        if ln:
            chunks.append(f'<w:t xml:space="preserve">{_xml_esc(ln)}</w:t>')
    return f"<w:r>{rpr_xml}{''.join(chunks)}</w:r>"


def _docx_inline_runs(
    text: str,
    *,
    font_name: Optional[str] = None,
    mono_font: str = "Courier New",
    size_pt: Optional[float] = None,
    color_hex: Optional[str] = None,
    base_bold: bool = False,
    base_italic: bool = False,
    caps: bool = False,
    code_bg_hex: Optional[str] = None,
) -> str:
    segments = _parse_inline_markdown_runs(text)
    if not segments:
        return ""
    out: List[str] = []
    for seg_txt, is_b, is_i, is_code in segments:
        if not seg_txt:
            continue
        if is_code:
            code_sz = max(7.0, (size_pt - 0.8) if size_pt is not None else 9.0)
            rpr = _docx_rpr_xml(
                font_name=mono_font,
                size_pt=code_sz,
                color_hex=color_hex,
                bold=base_bold,
                italic=False,
                caps=False,
                shd_fill=code_bg_hex,
            )
        else:
            rpr = _docx_rpr_xml(
                font_name=font_name,
                size_pt=size_pt,
                color_hex=color_hex,
                bold=base_bold or is_b,
                italic=base_italic or is_i,
                caps=caps,
            )
        out.append(_docx_text_run(seg_txt, rpr))
    return "".join(out)


def _docx_drawing_run(
    rel_id: str,
    width_pt: float,
    height_pt: float,
    doc_pr_id: int,
    name: str,
) -> str:
    cx = _pt_to_emu(width_pt)
    cy = _pt_to_emu(height_pt)
    safe_name = _xml_attr(name)
    return (
        "<w:r><w:drawing>"
        '<wp:inline distT="0" distB="0" distL="0" distR="0">'
        f'<wp:extent cx="{cx}" cy="{cy}"/>'
        '<wp:effectExtent l="0" t="0" r="0" b="0"/>'
        f'<wp:docPr id="{doc_pr_id}" name={safe_name}/>'
        "<wp:cNvGraphicFramePr>"
        f'<a:graphicFrameLocks xmlns:a="{_A_NS}" noChangeAspect="1"/>'
        "</wp:cNvGraphicFramePr>"
        f'<a:graphic xmlns:a="{_A_NS}">'
        '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
        f'<pic:pic xmlns:pic="{_PIC_NS}">'
        "<pic:nvPicPr>"
        f'<pic:cNvPr id="{doc_pr_id + 1000}" name={safe_name}/>'
        "<pic:cNvPicPr/>"
        "</pic:nvPicPr>"
        "<pic:blipFill>"
        f'<a:blip r:embed="{rel_id}"/>'
        "<a:stretch><a:fillRect/></a:stretch>"
        "</pic:blipFill>"
        "<pic:spPr>"
        f'<a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
        "</pic:spPr>"
        "</pic:pic>"
        "</a:graphicData>"
        "</a:graphic>"
        "</wp:inline>"
        "</w:drawing></w:r>"
    )


def _docx_field_runs(instr: str, preview_val: str, rpr_xml: str) -> str:
    return (
        f'<w:r>{rpr_xml}<w:fldChar w:fldCharType="begin"/></w:r>'
        f'<w:r>{rpr_xml}<w:instrText xml:space="preserve"> {instr} </w:instrText></w:r>'
        f'<w:r>{rpr_xml}<w:fldChar w:fldCharType="separate"/></w:r>'
        f'<w:r>{rpr_xml}<w:t>{_xml_esc(preview_val)}</w:t></w:r>'
        f'<w:r>{rpr_xml}<w:fldChar w:fldCharType="end"/></w:r>'
    )


def _docx_template_runs(
    tpl: str,
    *,
    tokens: Dict[str, str],
    rpr_xml: str,
) -> str:
    """Expande `{title}`, `{subtitle}`, `{author}`, `{date}` y campos Word nativos `{page}`, `{total}`."""
    if not tpl:
        return ""
    s = (
        str(tpl)
        .replace("{title}", tokens.get("title", ""))
        .replace("{subtitle}", tokens.get("subtitle", ""))
        .replace("{author}", tokens.get("author", ""))
        .replace("{date}", tokens.get("date", ""))
    )
    parts = re.split(r"(\{page\}|\{total\})", s)
    chunks: List[str] = []
    for part in parts:
        if part == "{page}":
            chunks.append(_docx_field_runs("PAGE", "1", rpr_xml))
        elif part == "{total}":
            chunks.append(_docx_field_runs("NUMPAGES", "1", rpr_xml))
        elif part:
            chunks.append(_docx_text_run(part, rpr_xml))
    return "".join(chunks)


def _build_docx_theme_xml(design_spec: Dict[str, Any], body_font: str, heading_font: str) -> str:
    pal = design_spec["palette"]
    dk1 = _hex6(pal.get("heading"), "0F172A")
    lt1 = _hex6(pal.get("page_bg"), "FFFFFF")
    dk2 = _hex6(pal.get("text"), "1E293B")
    lt2 = _hex6(pal.get("surface"), "F8FAFC")
    acc1 = _hex6(pal.get("accent"), "2563EB")
    acc2 = _hex6(pal.get("accent_dark"), "1E3A8A")
    acc3 = _hex6(pal.get("muted"), "64748B")
    acc4 = _hex6(pal.get("border"), "CBD5E1")
    acc5 = _hex6(pal.get("table_head_bg"), "0F172A")
    acc6 = _hex6(pal.get("accent_soft"), "EFF6FF")
    hf = _xml_attr(heading_font)
    bf = _xml_attr(body_font)

    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        f'<a:theme xmlns:a="{_A_NS}" name="XOOK Theme">'
        "<a:themeElements>"
        '<a:clrScheme name="XOOK Palette">'
        f'<a:dk1><a:srgbClr val="{dk1}"/></a:dk1>'
        f'<a:lt1><a:srgbClr val="{lt1}"/></a:lt1>'
        f'<a:dk2><a:srgbClr val="{dk2}"/></a:dk2>'
        f'<a:lt2><a:srgbClr val="{lt2}"/></a:lt2>'
        f'<a:accent1><a:srgbClr val="{acc1}"/></a:accent1>'
        f'<a:accent2><a:srgbClr val="{acc2}"/></a:accent2>'
        f'<a:accent3><a:srgbClr val="{acc3}"/></a:accent3>'
        f'<a:accent4><a:srgbClr val="{acc4}"/></a:accent4>'
        f'<a:accent5><a:srgbClr val="{acc5}"/></a:accent5>'
        f'<a:accent6><a:srgbClr val="{acc6}"/></a:accent6>'
        f'<a:hlink><a:srgbClr val="{acc1}"/></a:hlink>'
        f'<a:folHlink><a:srgbClr val="{acc2}"/></a:folHlink>'
        "</a:clrScheme>"
        '<a:fontScheme name="XOOK Fonts">'
        f'<a:majorFont><a:latin typeface={hf}/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>'
        f'<a:minorFont><a:latin typeface={bf}/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>'
        "</a:fontScheme>"
        '<a:fmtScheme name="XOOK Format">'
        '<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
        '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
        '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>'
        '<a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>'
        '<a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>'
        '<a:ln w="25400"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>'
        "<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle>"
        "<a:effectStyle><a:effectLst/></a:effectStyle>"
        "<a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>"
        '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
        '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
        '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>'
        "</a:fmtScheme>"
        "</a:themeElements>"
        "</a:theme>\n"
    )


def _build_docx_settings_xml(*, has_page_bg: bool) -> str:
    bg_tag = "<w:displayBackgroundShape/>" if has_page_bg else ""
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        f'<w:settings xmlns:w="{_W_NS}">'
        '<w:zoom w:percent="100"/>'
        f"{bg_tag}"
        '<w:defaultTabStop w:val="720"/>'
        "<w:compat>"
        '<w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/>'
        "</w:compat>"
        "</w:settings>\n"
    )


def _build_docx_styles_xml(
    design_spec: Dict[str, Any],
    *,
    body_font: str,
    heading_font: str,
) -> str:
    pal = design_spec["palette"]
    typo = design_spec["typography"]
    docx_cfg = design_spec.get("docx") or _DEFAULT_DOCX_SECTION
    style_names = docx_cfg.get("style_names") or _DEFAULT_DOCX_SECTION["style_names"]

    normal_id = str(style_names.get("body") or "Normal")
    h1_id = str(style_names.get("h1") or "Heading1")
    h2_id = str(style_names.get("h2") or "Heading2")
    h3_id = str(style_names.get("h3") or "Heading3")

    text_hex = _hex6(pal.get("text"), "1E293B")
    heading_hex = _hex6(pal.get("heading"), "0F172A")
    muted_hex = _hex6(pal.get("muted"), "64748B")
    accent_hex = _hex6(pal.get("accent"), "2563EB")
    accent_soft_hex = _hex6(pal.get("accent_soft"), "EFF6FF")

    body_sz = float(typo.get("body_size") or 10.0)
    body_lead = float(typo.get("body_leading") or round(body_sz * 1.45, 1))
    body_align = _docx_align_val(typo.get("body_align") or "left")
    space_after_tw = _pt_to_twips(float(typo.get("space_after") if typo.get("space_after") is not None else 7.0))
    body_line_tw = _pt_to_twips(body_lead)

    def _heading_style_xml(
        style_id: str,
        display_name: str,
        outline_lvl: int,
        h_cfg: Dict[str, Any],
        default_color: str,
        space_before_pt: float,
        space_after_pt: float,
    ) -> str:
        sz = float(h_cfg.get("size") or 14.0)
        lead = float(h_cfg.get("leading") or round(sz * 1.32, 1))
        col = _hex6(h_cfg.get("color") or default_color, default_color)
        is_caps = bool(h_cfg.get("uppercase", False))
        dec = str(h_cfg.get("decoration") or "plain").strip().lower()
        align = _docx_align_val(h_cfg.get("align") or "left")

        ppr_parts: List[str] = ["<w:keepNext/>", "<w:keepLines/>"]
        if dec == "underline":
            ppr_parts.append(
                f'<w:pBdr><w:bottom w:val="single" w:sz="12" w:space="4" w:color="{accent_hex}"/></w:pBdr>'
            )
        elif dec == "left_bar":
            ppr_parts.append(
                f'<w:pBdr><w:left w:val="single" w:sz="24" w:space="8" w:color="{accent_hex}"/></w:pBdr>'
            )
        elif dec == "band":
            ppr_parts.append(
                f'<w:pBdr><w:left w:val="single" w:sz="18" w:space="6" w:color="{accent_hex}"/></w:pBdr>'
                f'<w:shd w:val="clear" w:color="auto" w:fill="{accent_soft_hex}"/>'
            )

        ppr_parts.append(
            f'<w:spacing w:before="{_pt_to_twips(space_before_pt)}" '
            f'w:after="{_pt_to_twips(space_after_pt)}" '
            f'w:line="{_pt_to_twips(lead)}" w:lineRule="atLeast"/>'
        )
        if dec == "left_bar":
            ppr_parts.append('<w:ind w:left="140"/>')
        ppr_parts.append(f'<w:jc w:val="{align}"/>')
        ppr_parts.append(f'<w:outlineLvl w:val="{outline_lvl}"/>')

        rpr = _docx_rpr_xml(
            font_name=heading_font,
            size_pt=sz,
            color_hex=col,
            bold=True,
            caps=is_caps,
        )
        return (
            f'<w:style w:type="paragraph" w:styleId={_xml_attr(style_id)}>'
            f'<w:name w:val={_xml_attr(display_name)}/>'
            f'<w:basedOn w:val={_xml_attr(normal_id)}/>'
            f'<w:next w:val={_xml_attr(normal_id)}/>'
            "<w:qFormat/>"
            f"<w:pPr>{''.join(ppr_parts)}</w:pPr>"
            f"{rpr}"
            "</w:style>"
        )

    h1_cfg = typo.get("h1") if isinstance(typo.get("h1"), dict) else {}
    h2_cfg = typo.get("h2") if isinstance(typo.get("h2"), dict) else {}
    h3_cfg = typo.get("h3") if isinstance(typo.get("h3"), dict) else {}

    title_sz = max(20.0, float(h1_cfg.get("size") or 16.0) + 6.0)
    subtitle_sz = max(11.0, body_sz + 1.5)

    bf_attr = _xml_attr(body_font)
    body_hp = _pt_to_half_pt(body_sz)

    normal_rpr = _docx_rpr_xml(font_name=body_font, size_pt=body_sz, color_hex=text_hex)
    title_rpr = _docx_rpr_xml(font_name=heading_font, size_pt=title_sz, color_hex=heading_hex, bold=True)
    subtitle_rpr = _docx_rpr_xml(font_name=body_font, size_pt=subtitle_sz, color_hex=muted_hex, italic=False)
    hf_rpr = _docx_rpr_xml(font_name=body_font, size_pt=8.5, color_hex=muted_hex)

    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        f'<w:styles xmlns:w="{_W_NS}">'
        "<w:docDefaults>"
        "<w:rPrDefault><w:rPr>"
        f'<w:rFonts w:ascii={bf_attr} w:hAnsi={bf_attr} w:cs={bf_attr}/>'
        f'<w:color w:val="{text_hex}"/>'
        f'<w:sz w:val="{body_hp}"/><w:szCs w:val="{body_hp}"/>'
        "</w:rPr></w:rPrDefault>"
        "<w:pPrDefault><w:pPr>"
        f'<w:spacing w:after="{space_after_tw}" w:line="{body_line_tw}" w:lineRule="atLeast"/>'
        "</w:pPr></w:pPrDefault>"
        "</w:docDefaults>"
        f'<w:style w:type="paragraph" w:default="1" w:styleId={_xml_attr(normal_id)}>'
        '<w:name w:val="Normal"/>'
        "<w:qFormat/>"
        "<w:pPr>"
        f'<w:spacing w:after="{space_after_tw}" w:line="{body_line_tw}" w:lineRule="atLeast"/>'
        f'<w:jc w:val="{body_align}"/>'
        "</w:pPr>"
        f"{normal_rpr}"
        "</w:style>"
        '<w:style w:type="paragraph" w:styleId="Title">'
        '<w:name w:val="Title"/>'
        f'<w:basedOn w:val={_xml_attr(normal_id)}/>'
        f'<w:next w:val={_xml_attr(normal_id)}/>'
        "<w:qFormat/>"
        "<w:pPr><w:keepNext/>"
        f'<w:spacing w:before="0" w:after="{_pt_to_twips(6.0)}" w:line="{_pt_to_twips(title_sz * 1.2)}" w:lineRule="atLeast"/>'
        '<w:jc w:val="left"/>'
        "</w:pPr>"
        f"{title_rpr}"
        "</w:style>"
        '<w:style w:type="paragraph" w:styleId="Subtitle">'
        '<w:name w:val="Subtitle"/>'
        f'<w:basedOn w:val={_xml_attr(normal_id)}/>'
        f'<w:next w:val={_xml_attr(normal_id)}/>'
        "<w:qFormat/>"
        "<w:pPr><w:keepNext/>"
        f'<w:spacing w:before="0" w:after="{_pt_to_twips(10.0)}" w:line="{_pt_to_twips(subtitle_sz * 1.3)}" w:lineRule="atLeast"/>'
        '<w:jc w:val="left"/>'
        "</w:pPr>"
        f"{subtitle_rpr}"
        "</w:style>"
        + _heading_style_xml(h1_id, "heading 1", 0, h1_cfg, heading_hex, 14.0, 6.0)
        + _heading_style_xml(h2_id, "heading 2", 1, h2_cfg, accent_hex, 11.0, 4.5)
        + _heading_style_xml(h3_id, "heading 3", 2, h3_cfg, heading_hex, 8.5, 3.0)
        + (
            '<w:style w:type="paragraph" w:styleId="ListParagraph">'
            '<w:name w:val="List Paragraph"/>'
            f'<w:basedOn w:val={_xml_attr(normal_id)}/>'
            "<w:pPr>"
            f'<w:spacing w:after="{_pt_to_twips(3.5)}" w:line="{body_line_tw}" w:lineRule="atLeast"/>'
            '<w:ind w:left="540" w:hanging="270"/>'
            "</w:pPr>"
            "</w:style>"
            '<w:style w:type="paragraph" w:styleId="Header">'
            '<w:name w:val="header"/>'
            f'<w:basedOn w:val={_xml_attr(normal_id)}/>'
            '<w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>'
            f"{hf_rpr}"
            "</w:style>"
            '<w:style w:type="paragraph" w:styleId="Footer">'
            '<w:name w:val="footer"/>'
            f'<w:basedOn w:val={_xml_attr(normal_id)}/>'
            '<w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>'
            f"{hf_rpr}"
            "</w:style>"
            '<w:style w:type="table" w:default="1" w:styleId="TableNormal">'
            '<w:name w:val="Normal Table"/>'
            '<w:tblPr><w:tblCellMar>'
            '<w:top w:w="60" w:type="dxa"/><w:left w:w="108" w:type="dxa"/>'
            '<w:bottom w:w="60" w:type="dxa"/><w:right w:w="108" w:type="dxa"/>'
            "</w:tblCellMar></w:tblPr>"
            "</w:style>"
            "</w:styles>\n"
        )
    )


def _build_docx_numbering_xml(numbered_list_count: int, body_font: str) -> str:
    bf = _xml_attr(body_font)
    abstract_bullet = (
        '<w:abstractNum w:abstractNumId="0">'
        '<w:multiLevelType w:val="singleLevel"/>'
        '<w:lvl w:ilvl="0">'
        '<w:start w:val="1"/>'
        '<w:numFmt w:val="bullet"/>'
        '<w:lvlText w:val="•"/>'
        '<w:lvlJc w:val="left"/>'
        '<w:pPr><w:ind w:left="540" w:hanging="270"/></w:pPr>'
        f'<w:rPr><w:rFonts w:ascii={bf} w:hAnsi={bf} w:hint="default"/></w:rPr>'
        "</w:lvl>"
        "</w:abstractNum>"
    )
    abstract_decimal = (
        '<w:abstractNum w:abstractNumId="1">'
        '<w:multiLevelType w:val="singleLevel"/>'
        '<w:lvl w:ilvl="0">'
        '<w:start w:val="1"/>'
        '<w:numFmt w:val="decimal"/>'
        '<w:lvlText w:val="%1."/>'
        '<w:lvlJc w:val="left"/>'
        '<w:pPr><w:ind w:left="540" w:hanging="270"/></w:pPr>'
        f'<w:rPr><w:rFonts w:ascii={bf} w:hAnsi={bf}/></w:rPr>'
        "</w:lvl>"
        "</w:abstractNum>"
    )
    nums: List[str] = ['<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>']
    total_dec = max(1, numbered_list_count)
    for idx in range(total_dec):
        num_id = 2 + idx
        nums.append(
            f'<w:num w:numId="{num_id}">'
            '<w:abstractNumId w:val="1"/>'
            '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride>'
            "</w:num>"
        )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        f'<w:numbering xmlns:w="{_W_NS}">'
        f"{abstract_bullet}{abstract_decimal}{''.join(nums)}"
        "</w:numbering>\n"
    )


def _build_docx_header_or_footer_xml(
    kind: str,
    cfg: Dict[str, Any],
    *,
    design_spec: Dict[str, Any],
    tokens: Dict[str, str],
    body_font: str,
    usable_w_twips: int,
    logo_rel_id: Optional[str] = None,
    logo_size_pt: Optional[Tuple[float, float]] = None,
) -> str:
    pal = design_spec["palette"]
    muted_hex = _hex6(pal.get("muted"), "64748B")
    accent_hex = _hex6(pal.get("accent"), "2563EB")
    border_hex = _hex6(cfg.get("border_color") or pal.get("border"), "CBD5E1")
    bg_raw = cfg.get("background_hex") if kind == "header" else None
    has_bg = isinstance(bg_raw, str) and bool(re.match(r"^#?[0-9A-Fa-f]{6}$", bg_raw.strip()))
    bg_hex = _hex6(bg_raw, "FFFFFF") if has_bg else None

    if has_bg and bg_hex and _is_dark_hex(f"#{bg_hex}"):
        primary_fg = "FFFFFF"
        secondary_fg = "E2E8F0"
    else:
        primary_fg = accent_hex if kind == "header" else muted_hex
        secondary_fg = muted_hex

    left_txt = str(cfg.get("left") or "")
    center_txt = str(cfg.get("center") or "")
    right_txt = str(cfg.get("right") or "")

    rpr_primary = _docx_rpr_xml(font_name=body_font, size_pt=8.5, color_hex=primary_fg, bold=(kind == "header"))
    rpr_secondary = _docx_rpr_xml(font_name=body_font, size_pt=8.2, color_hex=secondary_fg)

    center_tab = max(1440, usable_w_twips // 2)
    right_tab = max(2880, usable_w_twips)

    ppr_parts: List[str] = [f'<w:pStyle w:val="{"Header" if kind == "header" else "Footer"}"/>']
    if kind == "header" and bool(cfg.get("border_bottom", False)):
        ppr_parts.append(f'<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="{border_hex}"/></w:pBdr>')
    elif kind == "footer" and bool(cfg.get("border_top", False)):
        ppr_parts.append(f'<w:pBdr><w:top w:val="single" w:sz="6" w:space="4" w:color="{border_hex}"/></w:pBdr>')
    if bg_hex:
        ppr_parts.append(f'<w:shd w:val="clear" w:color="auto" w:fill="{bg_hex}"/>')
    ppr_parts.append(
        "<w:tabs>"
        f'<w:tab w:val="center" w:pos="{center_tab}"/>'
        f'<w:tab w:val="right" w:pos="{right_tab}"/>'
        "</w:tabs>"
    )
    ppr_parts.append('<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>')

    logo_xml = ""
    logo_pos = str(cfg.get("logo_position") or "left").strip().lower()
    if kind == "header" and logo_rel_id and logo_size_pt:
        logo_xml = _docx_drawing_run(logo_rel_id, logo_size_pt[0], logo_size_pt[1], 9001, "HeaderLogo")

    runs: List[str] = []
    if logo_xml and logo_pos == "left":
        runs.append(logo_xml)
        if left_txt:
            runs.append(_docx_text_run("  ", rpr_primary))
    if left_txt:
        runs.append(_docx_template_runs(left_txt, tokens=tokens, rpr_xml=rpr_primary))

    if center_txt or right_txt or (logo_xml and logo_pos in ("center", "right")):
        runs.append("<w:r><w:tab/></w:r>")
        if logo_xml and logo_pos == "center":
            runs.append(logo_xml)
            if center_txt:
                runs.append(_docx_text_run("  ", rpr_secondary))
        if center_txt:
            runs.append(_docx_template_runs(center_txt, tokens=tokens, rpr_xml=rpr_secondary))

    if right_txt or (logo_xml and logo_pos == "right"):
        runs.append("<w:r><w:tab/></w:r>")
        if right_txt:
            runs.append(_docx_template_runs(right_txt, tokens=tokens, rpr_xml=rpr_secondary))
        if logo_xml and logo_pos == "right":
            if right_txt:
                runs.append(_docx_text_run("  ", rpr_secondary))
            runs.append(logo_xml)

    root_tag = "w:hdr" if kind == "header" else "w:ftr"
    ns_attrs = (
        f'xmlns:w="{_W_NS}" xmlns:r="{_R_NS}" xmlns:wp="{_WP_NS}" '
        f'xmlns:a="{_A_NS}" xmlns:pic="{_PIC_NS}"'
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        f"<{root_tag} {ns_attrs}>"
        f"<w:p><w:pPr>{''.join(ppr_parts)}</w:pPr>{''.join(runs)}</w:p>"
        f"</{root_tag}>\n"
    )


def _table_border_xml(val: str, sz_eighths: int, color_hex: str) -> str:
    if val == "none":
        return 'w:val="none" w:sz="0" w:space="0" w:color="auto"'
    return f'w:val="{val}" w:sz="{sz_eighths}" w:space="0" w:color="{_hex6(color_hex)}"'


def _looks_numeric_cell(raw: Any) -> bool:
    s = str("" if raw is None else raw).strip()
    if not s:
        return False
    return bool(re.match(r"^[+\-]?[$€£¥]?\s*\d[\d,]*(?:\.\d+)?%?$", s))


def generate_docx_document(
    spec: Dict[str, Any],
    *,
    workspace_root: Path,
    resolve_path_fn: Callable[[Path, str], Tuple[Path, str, str]],
    autonomous_roots: Tuple[str, ...] = ("agente", "memoria"),
    default_author: Optional[str] = None,
    allow_any_workspace_zone: bool = False,
    global_skills_dir: Optional[Path] = None,
) -> Dict[str, Any]:
    """
    Genera o modifica un archivo Microsoft Word (`.docx`) nativo con estilo OOXML completo,
    replicando `design_skill` / `design_spec` y aplicando `design_overrides`.
    """
    if not isinstance(spec, dict):
        raise ValueError("`spec` debe ser un diccionario válido.")

    warnings: List[str] = []
    edit_action = str(spec.get("edit_action") or "create").strip().lower()
    source_path_raw = str(spec.get("source_path") or "").strip()

    saved_meta: Optional[Dict[str, Any]] = None
    source_abs: Optional[Path] = None
    source_rel: Optional[str] = None

    if source_path_raw and (edit_action == "modify" or spec.get("edit_action") is None):
        edit_action = "modify"
        try:
            source_abs, source_rel = _resolve_workspace_file_smart(workspace_root, source_path_raw, resolve_path_fn)
        except Exception:
            source_abs, source_rel, _ = resolve_path_fn(workspace_root, source_path_raw)
        if not source_abs.is_file():
            raise FileNotFoundError(f"No se encontró el documento Word origen: {source_path_raw}")

        saved_meta = _load_office_spec_metadata(workspace_root, source_rel)
        if saved_meta is None:
            # Reconstrucción perezosa de bloques + diseño desde un `.docx` existente
            from slices.pdf_engine.office_reader import read_universal_document

            read_res = read_universal_document(source_abs, source_rel)
            inspected_design = _try_inspect_office_design(source_abs)
            saved_meta = {
                "format": "docx",
                "title": str(read_res.get("title") or source_abs.stem),
                "subtitle": "",
                "author": default_author or "",
                "date": _spanish_date_label(),
                "blocks": list(read_res.get("blocks") or []),
                "design_spec": inspected_design,
                "design_skill": None,
            }

    # Resolver metadata textual (heredando de saved_meta en modify)
    title = str(spec.get("title") or (saved_meta.get("title") if saved_meta else "") or "Documento").strip()
    subtitle = str(
        spec["subtitle"]
        if "subtitle" in spec and spec.get("subtitle") is not None
        else (saved_meta.get("subtitle") if saved_meta else "")
    ).strip()
    author = str(
        spec["author"]
        if "author" in spec and spec.get("author") is not None
        else ((saved_meta.get("author") if saved_meta else "") or default_author or "")
    ).strip()
    date_label = str(
        spec["date"]
        if "date" in spec and spec.get("date") is not None
        else ((saved_meta.get("date") if saved_meta else "") or _spanish_date_label())
    ).strip()

    # Resolver diseño (heredando del documento original en modify si no se pasa un skill distinto)
    design_skill_ref = str(spec.get("design_skill") or "").strip()
    if not design_skill_ref and saved_meta and saved_meta.get("design_skill"):
        design_skill_ref = str(saved_meta["design_skill"]).strip()
    raw_inline_design = spec.get("design_spec") if isinstance(spec.get("design_spec"), dict) and spec.get("design_spec") else None
    raw_design_overrides = spec.get("design_overrides") if isinstance(spec.get("design_overrides"), dict) and spec.get("design_overrides") else None
    base_design = saved_meta.get("design_spec") if (saved_meta and isinstance(saved_meta.get("design_spec"), dict)) else None

    # Si en modify ya teníamos design_spec guardado y el caller NO cambió design_skill, usamos
    # el design_spec guardado como base (sin volver a pisarlo con el skill crudo) y encima
    # aplicamos nuevos inline/overrides.
    skill_to_load = design_skill_ref if (str(spec.get("design_skill") or "").strip() or base_design is None) else ""
    design_spec, resolved_skill_slug, resolved_skill_dir, resolved_assets = _resolve_office_design_spec(
        design_skill_ref=skill_to_load,
        raw_inline_design=raw_inline_design,
        raw_design_overrides=raw_design_overrides,
        base_design=base_design,
        target_format="docx",
        workspace_root=workspace_root,
        global_skills_dir=global_skills_dir,
        warnings=warnings,
    )
    effective_design_skill = resolved_skill_slug or (design_skill_ref or None)

    # Resolver bloques de contenido
    blocks, block_cover_override = _normalize_blocks_input(spec)
    if edit_action == "modify" and saved_meta is not None:
        if not blocks:
            blocks = copy.deepcopy(saved_meta.get("blocks") or [])
        append_raw = spec.get("append_blocks")
        if append_raw:
            appended, _ = _normalize_blocks_input({"blocks": append_raw})
            blocks.extend(appended)
        replacements = _normalize_replacements(spec.get("replacements"))
        if replacements:
            blocks = _apply_replacements_to_value(blocks, replacements)
            title = _apply_replacements_to_value(title, replacements)
            subtitle = _apply_replacements_to_value(subtitle, replacements)

    if not blocks:
        raise ValueError(
            "El documento Word no contiene contenido (`blocks` o `markdown`). "
            "Proporciona párrafos, encabezados, listas o tablas para generar el archivo `.docx`."
        )

    # Resolver ruta de salida
    raw_out = str(spec.get("output_path") or "").strip()
    if not raw_out and edit_action == "modify" and source_rel:
        raw_out = source_rel
    out_abs, out_rel = _resolve_output_path(
        raw_out,
        title=title,
        ext=".docx",
        workspace_root=workspace_root,
        resolve_path_fn=resolve_path_fn,
        autonomous_roots=autonomous_roots,
        allow_any_workspace_zone=allow_any_workspace_zone,
    )

    # Extraer parámetros visuales de `design_spec`
    page_cfg = design_spec["page"]
    pal = design_spec["palette"]
    typo = design_spec["typography"]
    header_cfg = design_spec["header"]
    footer_cfg = design_spec["footer"]
    cover_cfg = copy.deepcopy(design_spec["cover"])
    if isinstance(block_cover_override, dict):
        cover_cfg.update(block_cover_override)
    if isinstance(spec.get("cover"), dict):
        cover_cfg.update(spec["cover"])
    elif isinstance(spec.get("cover"), bool):
        cover_cfg["enabled"] = spec["cover"]
    tbl_cfg = design_spec["tables"]
    docx_cfg = design_spec["docx"]
    style_names = docx_cfg["style_names"]

    body_font = _resolve_office_font_name(typo.get("body_family", "sans"), typo.get("font_hint", ""), default_sans="Arial")
    heading_font = _resolve_office_font_name(typo.get("heading_family", "sans"), typo.get("font_hint", ""), default_sans="Arial")
    mono_font = "Courier New"

    page_w_pt = float(page_cfg.get("width_pt") or 612.0)
    page_h_pt = float(page_cfg.get("height_pt") or 792.0)
    orientation = str(page_cfg.get("orientation") or "portrait").strip().lower()
    if orientation == "landscape" and page_w_pt < page_h_pt:
        page_w_pt, page_h_pt = page_h_pt, page_w_pt
    elif orientation == "portrait" and page_w_pt > page_h_pt:
        page_w_pt, page_h_pt = page_h_pt, page_w_pt

    margins = page_cfg.get("margins_pt") or {}
    m_top = float(margins.get("top") or 58.0)
    m_right = float(margins.get("right") or 56.0)
    m_bottom = float(margins.get("bottom") or 52.0)
    m_left = float(margins.get("left") or 56.0)
    num_page_cols = 2 if int(page_cfg.get("columns") or 1) >= 2 else 1
    col_gap_pt = float(page_cfg.get("column_gap_pt") or 18.0)

    usable_w_pt = max(180.0, page_w_pt - m_left - m_right)
    flow_w_pt = ((usable_w_pt - col_gap_pt) / 2.0) if num_page_cols == 2 else usable_w_pt
    usable_w_twips = _pt_to_twips(usable_w_pt)

    text_hex = _hex6(pal.get("text"), "1E293B")
    heading_hex = _hex6(pal.get("heading"), "0F172A")
    muted_hex = _hex6(pal.get("muted"), "64748B")
    accent_hex = _hex6(pal.get("accent"), "2563EB")
    accent_dark_hex = _hex6(pal.get("accent_dark"), "1E3A8A")
    accent_soft_hex = _hex6(pal.get("accent_soft"), "EFF6FF")
    border_hex = _hex6(pal.get("border"), "CBD5E1")
    surface_hex = _hex6(pal.get("surface"), "F8FAFC")
    page_bg_hex = _hex6(page_cfg.get("background_hex") or pal.get("page_bg"), "FFFFFF")
    dark_page = _is_dark_hex(f"#{page_bg_hex}")

    body_sz = float(typo.get("body_size") or 10.0)
    body_align = _docx_align_val(typo.get("body_align") or "left")

    # Registro de medios embebidos (`word/media/...`) y relaciones del documento
    media_files: Dict[str, bytes] = {}
    doc_rels: List[Tuple[str, str, str]] = [
        ("rId1", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles", "styles.xml"),
        ("rId2", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering", "numbering.xml"),
        ("rId3", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings", "settings.xml"),
        ("rId4", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme", "theme/theme1.xml"),
    ]
    next_rel_num = 5
    next_doc_pr_id = 10
    header_rels: List[Tuple[str, str, str]] = []

    def _add_doc_image(img_path: Path, max_w_pt: float, max_h_pt: float, *, media_name: Optional[str] = None) -> Optional[Tuple[str, float, float]]:
        nonlocal next_rel_num
        try:
            pil = _load_pil_image(img_path)
            iw, ih = pil.size
            if iw <= 0 or ih <= 0:
                return None
            scale = min(max_w_pt / float(iw), max_h_pt / float(ih), 1.0)
            draw_w = max(12.0, iw * scale)
            draw_h = max(12.0, ih * scale)
            buf = _pil_to_png_buffer(pil)
            fname = media_name or f"image{next_rel_num}.png"
            media_files[f"word/media/{fname}"] = buf.getvalue()
            rid = f"rId{next_rel_num}"
            next_rel_num += 1
            doc_rels.append(
                (rid, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image", f"media/{fname}")
            )
            return rid, draw_w, draw_h
        except Exception as exc:
            warnings.append(f"Imagen omitida ({img_path.name}): {exc}")
            return None

    # Logo de encabezado opcional
    header_enabled = bool(header_cfg.get("enabled", False))
    footer_enabled = bool(footer_cfg.get("enabled", False))
    header_logo_rid: Optional[str] = None
    header_logo_dims: Optional[Tuple[float, float]] = None

    if header_enabled and header_cfg.get("logo_asset"):
        logo_p = _resolve_design_asset_path(
            "logo_asset",
            header_cfg.get("logo_asset"),
            resolved_assets=resolved_assets,
            skill_dir=resolved_skill_dir,
            workspace_root=workspace_root,
            resolve_path_fn=resolve_path_fn,
        )
        if logo_p is not None and logo_p.is_file():
            try:
                pil_logo = _load_pil_image(logo_p)
                lw, lh = pil_logo.size
                target_h = float(header_cfg.get("logo_height_pt") or 22.0)
                target_w = min(usable_w_pt * 0.35, target_h * (float(lw) / float(max(1, lh))))
                target_h = target_w * (float(lh) / float(max(1, lw)))
                media_files["word/media/logo.png"] = _pil_to_png_buffer(pil_logo).getvalue()
                header_logo_rid = "rIdLogo"
                header_logo_dims = (target_w, target_h)
                header_rels.append(
                    (header_logo_rid, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image", "media/logo.png")
                )
            except Exception as exc:
                warnings.append(f"Logo de encabezado omitido: {exc}")

    header_rid: Optional[str] = None
    footer_rid: Optional[str] = None
    if header_enabled:
        header_rid = f"rId{next_rel_num}"
        next_rel_num += 1
        doc_rels.append(
            (header_rid, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header", "header1.xml")
        )
    if footer_enabled:
        footer_rid = f"rId{next_rel_num}"
        next_rel_num += 1
        doc_rels.append(
            (footer_rid, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer", "footer1.xml")
        )

    # Renderizar bloques de contenido a XML de `<w:body>`
    body_xml_parts: List[str] = []
    tables_count = 0
    numbered_list_counter = 0
    estimated_lines = 0

    def _p_simple(
        text: str,
        *,
        style_id: Optional[str] = None,
        align: Optional[str] = None,
        space_before_pt: Optional[float] = None,
        space_after_pt: Optional[float] = None,
        font_name: Optional[str] = None,
        size_pt: Optional[float] = None,
        color_hex: Optional[str] = None,
        bold: bool = False,
        italic: bool = False,
        caps: bool = False,
        p_bdr_xml: str = "",
        shd_fill: Optional[str] = None,
        num_id: Optional[int] = None,
        inline_md: bool = True,
    ) -> str:
        ppr: List[str] = []
        if style_id:
            ppr.append(f'<w:pStyle w:val={_xml_attr(style_id)}/>')
        if num_id is not None:
            ppr.append(f'<w:numPr><w:ilvl w:val="0"/><w:numId w:val="{num_id}"/></w:numPr>')
        if p_bdr_xml:
            ppr.append(p_bdr_xml)
        if shd_fill:
            ppr.append(f'<w:shd w:val="clear" w:color="auto" w:fill="{_hex6(shd_fill)}"/>')
        if space_before_pt is not None or space_after_pt is not None:
            sb = f' w:before="{_pt_to_twips(space_before_pt)}"' if space_before_pt is not None else ""
            sa = f' w:after="{_pt_to_twips(space_after_pt)}"' if space_after_pt is not None else ""
            ppr.append(f"<w:spacing{sb}{sa}/>")
        if align:
            ppr.append(f'<w:jc w:val="{_docx_align_val(align)}"/>')
        ppr_xml = f"<w:pPr>{''.join(ppr)}</w:pPr>" if ppr else ""
        if inline_md:
            runs_xml = _docx_inline_runs(
                text,
                font_name=font_name,
                mono_font=mono_font,
                size_pt=size_pt,
                color_hex=color_hex,
                base_bold=bold,
                base_italic=italic,
                caps=caps,
                code_bg_hex=surface_hex if not dark_page else "1E293B",
            )
        else:
            rpr = _docx_rpr_xml(
                font_name=font_name,
                size_pt=size_pt,
                color_hex=color_hex,
                bold=bold,
                italic=italic,
                caps=caps,
            )
            runs_xml = _docx_text_run(text, rpr)
        return f"<w:p>{ppr_xml}{runs_xml}</w:p>"

    # Portada opcional o cabecera de título inicial
    cover_enabled = bool(cover_cfg.get("enabled", False)) and str(cover_cfg.get("layout") or "none").lower() != "none"
    if cover_enabled:
        if bool(cover_cfg.get("top_band", False)) or str(cover_cfg.get("layout") or "").lower() == "band_top":
            body_xml_parts.append(
                f'<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="36" w:space="0" w:color="{accent_hex}"/></w:pBdr>'
                f'<w:spacing w:before="0" w:after="{_pt_to_twips(24.0)}"/></w:pPr></w:p>'
            )
        cover_logo_raw = cover_cfg.get("logo_asset") or cover_cfg.get("image_path")
        if cover_logo_raw:
            cl_p = _resolve_design_asset_path(
                "cover_logo_asset",
                cover_logo_raw,
                resolved_assets=resolved_assets,
                skill_dir=resolved_skill_dir,
                workspace_root=workspace_root,
                resolve_path_fn=resolve_path_fn,
            )
            if cl_p is not None and cl_p.is_file():
                added = _add_doc_image(cl_p, flow_w_pt * 0.45, 110.0)
                if added:
                    rid, dw, dh = added
                    next_doc_pr_id += 1
                    body_xml_parts.append(
                        f'<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="{_pt_to_twips(24.0)}" w:after="{_pt_to_twips(18.0)}"/></w:pPr>'
                        f'{_docx_drawing_run(rid, dw, dh, next_doc_pr_id, "CoverLogo")}</w:p>'
                    )
        cover_align = "center" if "center" in str(cover_cfg.get("layout") or "").lower() else "left"
        body_xml_parts.append(_p_simple(title, style_id="Title", align=cover_align, space_before_pt=36.0, space_after_pt=10.0))
        if subtitle:
            body_xml_parts.append(_p_simple(subtitle, style_id="Subtitle", align=cover_align, space_after_pt=18.0))
        meta_line = "  ·  ".join([p for p in (author, date_label) if p])
        if meta_line:
            body_xml_parts.append(_p_simple(meta_line, align=cover_align, size_pt=9.5, color_hex=muted_hex, space_before_pt=12.0))
        body_xml_parts.append('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
        estimated_lines += 40
    else:
        first_blk = blocks[0] if blocks else {}
        first_is_same_title = (
            isinstance(first_blk, dict)
            and first_blk.get("type") == "heading"
            and int(first_blk.get("level") or 1) == 1
            and str(first_blk.get("text") or "").strip().lower() == title.strip().lower()
        )
        if title and not first_is_same_title:
            body_xml_parts.append(_p_simple(title, style_id="Title", space_after_pt=4.0))
            estimated_lines += 3
        if subtitle:
            body_xml_parts.append(_p_simple(subtitle, style_id="Subtitle", space_after_pt=6.0))
            estimated_lines += 2
        if author or date_label:
            meta_line = "  ·  ".join([p for p in (author, date_label) if p])
            body_xml_parts.append(
                _p_simple(
                    meta_line,
                    size_pt=8.8,
                    color_hex=muted_hex,
                    space_after_pt=10.0,
                    p_bdr_xml=f'<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="6" w:color="{border_hex}"/></w:pBdr>',
                )
            )
            estimated_lines += 2

    def _render_blocks_to_docx_xml(blk_list: List[Dict[str, Any]], avail_w_pt: float, depth: int = 0) -> List[str]:
        nonlocal tables_count, numbered_list_counter, estimated_lines, next_doc_pr_id
        out_xml: List[str] = []
        avail_tw = _pt_to_twips(avail_w_pt)

        for blk in blk_list:
            if not isinstance(blk, dict):
                continue
            btype = str(blk.get("type") or "").strip().lower()

            if btype == "heading":
                lvl = max(1, min(3, int(blk.get("level") or 1)))
                txt = str(blk.get("text") or blk.get("title") or "").strip()
                if not txt:
                    continue
                h_key = f"h{lvl}"
                h_style = style_names.get(h_key, f"Heading{lvl}")
                h_cfg = typo.get(h_key) if isinstance(typo.get(h_key), dict) else {}
                out_xml.append(
                    _p_simple(
                        txt,
                        style_id=h_style,
                        align=blk.get("align"),
                        caps=bool(h_cfg.get("uppercase", False)),
                    )
                )
                estimated_lines += 2

            elif btype == "paragraph":
                txt = str(blk.get("text") or blk.get("content") or "").strip()
                if not txt:
                    continue
                out_xml.append(
                    _p_simple(
                        txt,
                        style_id=style_names["body"],
                        align=blk.get("align") or body_align,
                    )
                )
                estimated_lines += max(1, math.ceil(len(txt) / max(32.0, avail_w_pt / 5.5)))

            elif btype in ("bullets", "bullet_list", "unordered_list", "ul", "list"):
                items = blk.get("items") or []
                for it in items if isinstance(items, list) else []:
                    s = str(it or "").strip()
                    if s:
                        out_xml.append(
                            _p_simple(
                                s,
                                style_id="ListParagraph",
                                align="both" if body_align == "both" else "left",
                                num_id=1,
                            )
                        )
                        estimated_lines += max(1, math.ceil(len(s) / 70.0))

            elif btype in ("numbered_list", "ordered_list", "ol"):
                items = blk.get("items") or []
                clean_items = [str(it or "").strip() for it in items if str(it or "").strip()] if isinstance(items, list) else []
                if not clean_items:
                    continue
                num_id = 2 + numbered_list_counter
                numbered_list_counter += 1
                for s in clean_items:
                    out_xml.append(
                        _p_simple(
                            s,
                            style_id="ListParagraph",
                            align="both" if body_align == "both" else "left",
                            num_id=num_id,
                        )
                    )
                    estimated_lines += max(1, math.ceil(len(s) / 70.0))

            elif btype == "table":
                headers = [str(h if h is not None else "").strip() for h in (blk.get("headers") or blk.get("columns") or [])]
                raw_rows = blk.get("rows") or []
                norm_rows: List[List[str]] = []
                max_cols = len(headers)
                for r in raw_rows if isinstance(raw_rows, list) else []:
                    if isinstance(r, list):
                        norm_rows.append([str("" if c is None else c).strip() for c in r])
                        max_cols = max(max_cols, len(r))
                if max_cols == 0:
                    continue
                if not headers:
                    headers = [f"Col {i + 1}" for i in range(max_cols)]
                elif len(headers) < max_cols:
                    headers = headers + [f"Col {i + 1}" for i in range(len(headers), max_cols)]

                t_style = str(blk.get("style") or tbl_cfg.get("style") or "striped").strip().lower()
                t_head_bg = _hex6(tbl_cfg.get("header_bg") or pal.get("table_head_bg"), "0F172A")
                t_head_fg = _hex6(tbl_cfg.get("header_fg") or pal.get("table_head_fg"), "FFFFFF")
                t_alt_bg = _hex6(tbl_cfg.get("alt_row_bg") or pal.get("table_alt"), "F8FAFC")
                t_border = _hex6(tbl_cfg.get("border_color") or pal.get("border"), "CBD5E1")
                t_font_sz = float(tbl_cfg.get("font_size") or 8.8)
                pad_v_tw = _pt_to_twips(float(tbl_cfg.get("cell_padding_v") or 5.5))
                pad_h_tw = _pt_to_twips(float(tbl_cfg.get("cell_padding_h") or 7.0))
                highlight_last = bool(blk.get("highlight_last_row") or blk.get("totals_row"))

                # Calcular anchos de columna en twips
                raw_cw = blk.get("col_widths")
                if (
                    isinstance(raw_cw, list)
                    and len(raw_cw) == max_cols
                    and all(isinstance(x, (int, float)) and float(x) > 0 for x in raw_cw)
                ):
                    tot = sum(float(x) for x in raw_cw)
                    col_twips = [max(400, int(round(avail_tw * (float(x) / tot)))) for x in raw_cw]
                else:
                    weights: List[float] = []
                    for ci in range(max_cols):
                        max_len = len(headers[ci])
                        for r in norm_rows[:40]:
                            if ci < len(r):
                                max_len = max(max_len, min(60, len(r[ci])))
                        weights.append(max(6.0, float(max_len)))
                    tot_w = sum(weights) or float(max_cols)
                    col_twips = [max(450, int(round(avail_tw * (w / tot_w)))) for w in weights]
                # Ajustar diferencia de redondeo en última columna
                diff_tw = avail_tw - sum(col_twips)
                col_twips[-1] = max(400, col_twips[-1] + diff_tw)

                # Bordes de tabla según `tables.style`
                if t_style == "bordered":
                    tbl_borders = (
                        "<w:tblBorders>"
                        f"<w:top {_table_border_xml('single', 6, t_border)}/>"
                        f"<w:left {_table_border_xml('single', 6, t_border)}/>"
                        f"<w:bottom {_table_border_xml('single', 6, t_border)}/>"
                        f"<w:right {_table_border_xml('single', 6, t_border)}/>"
                        f"<w:insideH {_table_border_xml('single', 4, t_border)}/>"
                        f"<w:insideV {_table_border_xml('single', 4, t_border)}/>"
                        "</w:tblBorders>"
                    )
                elif t_style in ("minimal_rules", "clean", "invoice"):
                    top_col = heading_hex if t_style == "minimal_rules" else (accent_hex if t_style == "invoice" else t_border)
                    tbl_borders = (
                        "<w:tblBorders>"
                        f"<w:top {_table_border_xml('single', 8 if t_style == 'minimal_rules' else 4, top_col)}/>"
                        f"<w:left {_table_border_xml('none', 0, t_border)}/>"
                        f"<w:bottom {_table_border_xml('single', 8, top_col)}/>"
                        f"<w:right {_table_border_xml('none', 0, t_border)}/>"
                        f"<w:insideH {_table_border_xml('single', 4, t_border)}/>"
                        f"<w:insideV {_table_border_xml('none', 0, t_border)}/>"
                        "</w:tblBorders>"
                    )
                else:
                    # "striped"
                    tbl_borders = (
                        "<w:tblBorders>"
                        f"<w:top {_table_border_xml('single', 4, t_border)}/>"
                        f"<w:left {_table_border_xml('single', 4, t_border)}/>"
                        f"<w:bottom {_table_border_xml('single', 4, t_border)}/>"
                        f"<w:right {_table_border_xml('single', 4, t_border)}/>"
                        f"<w:insideH {_table_border_xml('single', 4, t_border)}/>"
                        f"<w:insideV {_table_border_xml('none', 0, t_border)}/>"
                        "</w:tblBorders>"
                    )

                explicit_aligns = blk.get("alignments") if isinstance(blk.get("alignments"), list) else []
                col_aligns: List[str] = []
                for ci in range(max_cols):
                    if ci < len(explicit_aligns) and explicit_aligns[ci]:
                        col_aligns.append(_docx_align_val(explicit_aligns[ci]))
                    else:
                        col_vals = [r[ci] for r in norm_rows if ci < len(r) and r[ci]]
                        if col_vals and all(_looks_numeric_cell(v) for v in col_vals):
                            col_aligns.append("right")
                        else:
                            col_aligns.append("left")

                grid_xml = "".join(f'<w:gridCol w:w="{w}"/>' for w in col_twips)
                tbl_pr = (
                    "<w:tblPr>"
                    f'<w:tblW w:w="{avail_tw}" w:type="dxa"/>'
                    f"{tbl_borders}"
                    '<w:tblLayout w:type="fixed"/>'
                    "<w:tblCellMar>"
                    f'<w:top w:w="{pad_v_tw}" w:type="dxa"/>'
                    f'<w:left w:w="{pad_h_tw}" w:type="dxa"/>'
                    f'<w:bottom w:w="{pad_v_tw}" w:type="dxa"/>'
                    f'<w:right w:w="{pad_h_tw}" w:type="dxa"/>'
                    "</w:tblCellMar>"
                    "</w:tblPr>"
                )

                tr_parts: List[str] = []
                # Fila 0: encabezado
                use_header_fill = t_style != "minimal_rules"
                eff_head_bg = (surface_hex if (t_style == "clean" and not tbl_cfg.get("header_bg")) else t_head_bg) if use_header_fill else None
                eff_head_fg = (
                    heading_hex
                    if (not use_header_fill or (eff_head_bg and not _is_dark_hex(f"#{eff_head_bg}") and t_style == "clean" and not tbl_cfg.get("header_fg")))
                    else t_head_fg
                )
                head_cells: List[str] = []
                for ci, h_txt in enumerate(headers):
                    tc_pr_parts = [f'<w:tcW w:w="{col_twips[ci]}" w:type="dxa"/>']
                    if t_style in ("striped", "bordered", "invoice"):
                        tc_pr_parts.append(
                            f'<w:tcBorders><w:bottom {_table_border_xml("single", 10, accent_hex)}/></w:tcBorders>'
                        )
                    elif t_style == "minimal_rules":
                        tc_pr_parts.append(
                            f'<w:tcBorders><w:bottom {_table_border_xml("single", 8, heading_hex)}/></w:tcBorders>'
                        )
                    if eff_head_bg:
                        tc_pr_parts.append(f'<w:shd w:val="clear" w:color="auto" w:fill="{eff_head_bg}"/>')
                    tc_pr_parts.append('<w:vAlign w:val="center"/>')
                    cell_p = _p_simple(
                        h_txt,
                        align=col_aligns[ci],
                        space_before_pt=0.0,
                        space_after_pt=0.0,
                        font_name=body_font,
                        size_pt=max(t_font_sz, 8.8),
                        color_hex=eff_head_fg,
                        bold=True,
                    )
                    head_cells.append(f"<w:tc><w:tcPr>{''.join(tc_pr_parts)}</w:tcPr>{cell_p}</w:tc>")
                tr_parts.append(f"<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>{''.join(head_cells)}</w:tr>")

                # Filas de datos
                for r_idx, row in enumerate(norm_rows):
                    padded = (row + [""] * max_cols)[:max_cols]
                    is_last_hi = highlight_last and (r_idx == len(norm_rows) - 1)
                    is_zebra = (r_idx % 2 == 1) and t_style in ("striped", "bordered", "invoice") and not is_last_hi
                    row_fill: Optional[str] = None
                    if is_last_hi:
                        row_fill = accent_soft_hex
                    elif is_zebra:
                        row_fill = t_alt_bg
                    elif dark_page:
                        row_fill = surface_hex

                    row_cells: List[str] = []
                    for ci, val in enumerate(padded):
                        tc_pr_parts = [f'<w:tcW w:w="{col_twips[ci]}" w:type="dxa"/>']
                        if is_last_hi:
                            tc_pr_parts.append(
                                f'<w:tcBorders><w:top {_table_border_xml("single", 10, accent_hex)}/></w:tcBorders>'
                            )
                        if row_fill:
                            tc_pr_parts.append(f'<w:shd w:val="clear" w:color="auto" w:fill="{row_fill}"/>')
                        tc_pr_parts.append('<w:vAlign w:val="center"/>')
                        cell_p = _p_simple(
                            val,
                            align=col_aligns[ci],
                            space_before_pt=0.0,
                            space_after_pt=0.0,
                            font_name=body_font,
                            size_pt=t_font_sz,
                            color_hex=heading_hex if is_last_hi else text_hex,
                            bold=is_last_hi,
                        )
                        row_cells.append(f"<w:tc><w:tcPr>{''.join(tc_pr_parts)}</w:tcPr>{cell_p}</w:tc>")
                    tr_parts.append(f"<w:tr><w:trPr><w:cantSplit/></w:trPr>{''.join(row_cells)}</w:tr>")

                out_xml.append(f"<w:tbl>{tbl_pr}<w:tblGrid>{grid_xml}</w:tblGrid>{''.join(tr_parts)}</w:tbl>")
                caption_txt = str(blk.get("caption") or "").strip()
                if caption_txt:
                    out_xml.append(
                        _p_simple(
                            caption_txt,
                            align="center",
                            space_before_pt=3.0,
                            space_after_pt=8.0,
                            font_name=body_font,
                            size_pt=8.4,
                            color_hex=muted_hex,
                            italic=True,
                        )
                    )
                else:
                    out_xml.append('<w:p><w:pPr><w:spacing w:before="0" w:after="100"/></w:pPr></w:p>')
                tables_count += 1
                estimated_lines += 2 + len(norm_rows)

            elif btype in ("kv_grid", "header_band"):
                raw_items = blk.get("items") or []
                if isinstance(raw_items, dict):
                    kv_items = [{"label": str(k), "value": str(v)} for k, v in raw_items.items()]
                elif isinstance(raw_items, list):
                    kv_items = [it for it in raw_items if isinstance(it, dict)]
                else:
                    kv_items = []
                kv_title = str(blk.get("title") or "").strip()
                if not kv_items and not kv_title:
                    continue

                n_kv_cols = max(1, min(4, int(blk.get("columns") or 2)))
                cell_w_tw = avail_tw // n_kv_cols
                col_ws = [cell_w_tw] * n_kv_cols
                col_ws[-1] += avail_tw - sum(col_ws)
                bg_fill = accent_soft_hex if btype == "header_band" else surface_hex
                top_bdr = _table_border_xml("single", 16, accent_hex) if btype == "header_band" else _table_border_xml("single", 4, border_hex)

                tbl_pr = (
                    "<w:tblPr>"
                    f'<w:tblW w:w="{avail_tw}" w:type="dxa"/>'
                    "<w:tblBorders>"
                    f"<w:top {top_bdr}/>"
                    f"<w:left {_table_border_xml('single', 4, border_hex)}/>"
                    f"<w:bottom {_table_border_xml('single', 4, border_hex)}/>"
                    f"<w:right {_table_border_xml('single', 4, border_hex)}/>"
                    f"<w:insideH {_table_border_xml('single', 4, border_hex)}/>"
                    f"<w:insideV {_table_border_xml('single', 4, border_hex)}/>"
                    "</w:tblBorders>"
                    '<w:tblLayout w:type="fixed"/>'
                    '<w:tblCellMar><w:top w:w="90" w:type="dxa"/><w:left w:w="140" w:type="dxa"/>'
                    '<w:bottom w:w="90" w:type="dxa"/><w:right w:w="140" w:type="dxa"/></w:tblCellMar>'
                    "</w:tblPr>"
                )
                grid_xml = "".join(f'<w:gridCol w:w="{w}"/>' for w in col_ws)
                rows_xml: List[str] = []
                if kv_title:
                    span_xml = f'<w:gridSpan w:val="{n_kv_cols}"/>' if n_kv_cols > 1 else ""
                    title_p = _p_simple(
                        kv_title,
                        space_before_pt=0.0,
                        space_after_pt=0.0,
                        font_name=heading_font,
                        size_pt=9.8,
                        color_hex=heading_hex,
                        bold=True,
                    )
                    rows_xml.append(
                        f'<w:tr><w:tc><w:tcPr><w:tcW w:w="{avail_tw}" w:type="dxa"/>{span_xml}'
                        f'<w:shd w:val="clear" w:color="auto" w:fill="{accent_soft_hex}"/></w:tcPr>'
                        f"{title_p}</w:tc></w:tr>"
                    )
                for idx_start in range(0, len(kv_items), n_kv_cols):
                    chunk = kv_items[idx_start : idx_start + n_kv_cols]
                    cells: List[str] = []
                    for ci in range(n_kv_cols):
                        tc_pr = (
                            f'<w:tcPr><w:tcW w:w="{col_ws[ci]}" w:type="dxa"/>'
                            f'<w:shd w:val="clear" w:color="auto" w:fill="{bg_fill}"/>'
                            '<w:vAlign w:val="top"/></w:tcPr>'
                        )
                        if ci < len(chunk):
                            lbl = str(chunk[ci].get("label") or chunk[ci].get("key") or "").strip()
                            val = str(chunk[ci].get("value") or "—").strip() or "—"
                            cell_ps: List[str] = []
                            if lbl:
                                cell_ps.append(
                                    _p_simple(
                                        lbl,
                                        space_before_pt=0.0,
                                        space_after_pt=2.0,
                                        font_name=body_font,
                                        size_pt=7.5,
                                        color_hex=muted_hex,
                                        bold=True,
                                        caps=True,
                                    )
                                )
                            cell_ps.append(
                                _p_simple(
                                    val,
                                    space_before_pt=0.0,
                                    space_after_pt=0.0,
                                    font_name=body_font,
                                    size_pt=max(body_sz - 0.5, 8.8),
                                    color_hex=heading_hex,
                                )
                            )
                            cells.append(f"<w:tc>{tc_pr}{''.join(cell_ps)}</w:tc>")
                        else:
                            cells.append(f"<w:tc>{tc_pr}<w:p/></w:tc>")
                    rows_xml.append(f"<w:tr><w:trPr><w:cantSplit/></w:trPr>{''.join(cells)}</w:tr>")

                out_xml.append(f"<w:tbl>{tbl_pr}<w:tblGrid>{grid_xml}</w:tblGrid>{''.join(rows_xml)}</w:tbl>")
                out_xml.append('<w:p><w:pPr><w:spacing w:before="0" w:after="100"/></w:pPr></w:p>')
                estimated_lines += 2 + math.ceil(len(kv_items) / float(n_kv_cols))

            elif btype == "columns" and depth < 3:
                raw_cols = blk.get("columns") or blk.get("cols") or []
                if not isinstance(raw_cols, list) or not raw_cols:
                    continue
                cols_sliced = raw_cols[:3]
                n_cols = len(cols_sliced)
                raw_w = blk.get("widths")
                if (
                    isinstance(raw_w, list)
                    and len(raw_w) == n_cols
                    and all(isinstance(x, (int, float)) and float(x) > 0 for x in raw_w)
                ):
                    tot_r = sum(float(x) for x in raw_w)
                    ratios = [float(x) / tot_r for x in raw_w]
                else:
                    ratios = [1.0 / float(n_cols)] * n_cols
                col_ws = [max(720, int(round(avail_tw * r))) for r in ratios]
                col_ws[-1] = max(720, col_ws[-1] + (avail_tw - sum(col_ws)))

                tbl_pr = (
                    "<w:tblPr>"
                    f'<w:tblW w:w="{avail_tw}" w:type="dxa"/>'
                    "<w:tblBorders>"
                    '<w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/>'
                    '<w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/>'
                    '<w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/>'
                    '<w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/>'
                    '<w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/>'
                    '<w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/>'
                    "</w:tblBorders>"
                    '<w:tblLayout w:type="fixed"/>'
                    '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="80" w:type="dxa"/>'
                    '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar>'
                    "</w:tblPr>"
                )
                grid_xml = "".join(f'<w:gridCol w:w="{w}"/>' for w in col_ws)
                cells: List[str] = []
                for ci, col_items in enumerate(cols_sliced):
                    c_list = col_items if isinstance(col_items, list) else []
                    inner_xml = _render_blocks_to_docx_xml(c_list, max(80.0, col_ws[ci] / 20.0 - 8.0), depth=depth + 1)
                    if not inner_xml or not inner_xml[-1].endswith("</w:p>"):
                        inner_xml.append("<w:p/>")
                    cells.append(
                        f'<w:tc><w:tcPr><w:tcW w:w="{col_ws[ci]}" w:type="dxa"/><w:vAlign w:val="top"/></w:tcPr>'
                        f"{''.join(inner_xml)}</w:tc>"
                    )
                out_xml.append(f"<w:tbl>{tbl_pr}<w:tblGrid>{grid_xml}</w:tblGrid><w:tr>{''.join(cells)}</w:tr></w:tbl>")
                out_xml.append('<w:p><w:pPr><w:spacing w:before="0" w:after="100"/></w:pPr></w:p>')

            elif btype in ("signature_block", "signatures"):
                signers = blk.get("signers") or blk.get("items") or []
                clean_signers = [s for s in signers if isinstance(s, dict)] if isinstance(signers, list) else []
                if not clean_signers:
                    continue
                per_row = min(3, max(1, len(clean_signers)))
                col_w = avail_tw // per_row
                col_ws = [col_w] * per_row
                col_ws[-1] += avail_tw - sum(col_ws)
                tbl_pr = (
                    "<w:tblPr>"
                    f'<w:tblW w:w="{avail_tw}" w:type="dxa"/>'
                    "<w:tblBorders>"
                    '<w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/>'
                    '<w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/>'
                    '<w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/>'
                    '<w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/>'
                    '<w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/>'
                    '<w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/>'
                    "</w:tblBorders>"
                    '<w:tblLayout w:type="fixed"/>'
                    '<w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="180" w:type="dxa"/>'
                    '<w:bottom w:w="60" w:type="dxa"/><w:right w:w="180" w:type="dxa"/></w:tblCellMar>'
                    "</w:tblPr>"
                )
                grid_xml = "".join(f'<w:gridCol w:w="{w}"/>' for w in col_ws)
                rows_xml = []
                for idx_start in range(0, len(clean_signers), per_row):
                    chunk = clean_signers[idx_start : idx_start + per_row]
                    cells = []
                    for ci in range(per_row):
                        tc_pr = f'<w:tcPr><w:tcW w:w="{col_ws[ci]}" w:type="dxa"/><w:vAlign w:val="bottom"/></w:tcPr>'
                        if ci < len(chunk):
                            sg = chunk[ci]
                            s_name = str(sg.get("name") or "").strip()
                            s_role = str(sg.get("role") or sg.get("title") or "").strip()
                            s_date = str(sg.get("date") or "").strip()
                            ps = [
                                '<w:p><w:pPr><w:spacing w:before="360" w:after="40"/>'
                                f'<w:pBdr><w:bottom w:val="single" w:sz="8" w:space="2" w:color="{heading_hex}"/></w:pBdr></w:pPr></w:p>'
                            ]
                            if s_name:
                                ps.append(_p_simple(s_name, align="center", space_before_pt=2.0, space_after_pt=1.0, font_name=body_font, size_pt=9.5, color_hex=heading_hex, bold=True))
                            if s_role:
                                ps.append(_p_simple(s_role, align="center", space_before_pt=0.0, space_after_pt=1.0, font_name=body_font, size_pt=8.4, color_hex=muted_hex))
                            if s_date:
                                ps.append(_p_simple(s_date, align="center", space_before_pt=0.0, space_after_pt=0.0, font_name=body_font, size_pt=8.2, color_hex=muted_hex))
                            cells.append(f"<w:tc>{tc_pr}{''.join(ps)}</w:tc>")
                        else:
                            cells.append(f"<w:tc>{tc_pr}<w:p/></w:tc>")
                    rows_xml.append(f"<w:tr><w:trPr><w:cantSplit/></w:trPr>{''.join(cells)}</w:tr>")
                out_xml.append(f"<w:tbl>{tbl_pr}<w:tblGrid>{grid_xml}</w:tblGrid>{''.join(rows_xml)}</w:tbl>")
                out_xml.append('<w:p><w:pPr><w:spacing w:before="0" w:after="120"/></w:pPr></w:p>')
                estimated_lines += 4

            elif btype in ("callout", "summary", "quote", "box", "panel", "card") and depth < 3:
                is_box = btype in ("box", "panel", "card")
                tone = str(blk.get("tone") or "info").strip().lower()
                tone_palette = THEMES["midnight" if dark_page else "executive"].get(f"callout_{tone}")
                if is_box:
                    bg_c = _hex6(blk.get("bg_color") or surface_hex, surface_hex)
                    bar_c = _hex6(blk.get("border_color") or accent_hex, accent_hex)
                    bdr_c = _hex6(blk.get("border_color") or border_hex, border_hex)
                    ttl_c = heading_hex
                elif tone == "info" or not tone_palette:
                    bg_c = accent_soft_hex
                    bar_c = accent_hex
                    bdr_c = border_hex
                    ttl_c = accent_dark_hex if not dark_page else heading_hex
                else:
                    bg_c = _hex6(tone_palette[0], accent_soft_hex)
                    bar_c = _hex6(tone_palette[1], accent_hex)
                    bdr_c = _hex6(tone_palette[1], border_hex)
                    ttl_c = _hex6(tone_palette[2], heading_hex)

                c_title = str(blk.get("title") or "").strip()
                c_text = str(blk.get("text") or blk.get("content") or "").strip()
                inner_blks = blk.get("blocks") if isinstance(blk.get("blocks"), list) else []
                if not c_title and not c_text and not inner_blks:
                    continue

                inner_parts: List[str] = []
                if c_title:
                    inner_parts.append(
                        _p_simple(
                            c_title,
                            space_before_pt=0.0,
                            space_after_pt=3.0,
                            font_name=heading_font,
                            size_pt=10.2,
                            color_hex=ttl_c,
                            bold=True,
                        )
                    )
                if c_text:
                    inner_parts.append(
                        _p_simple(
                            c_text,
                            space_before_pt=0.0,
                            space_after_pt=2.0 if inner_blks else 0.0,
                            font_name=body_font,
                            size_pt=max(8.5, body_sz - 0.3),
                            color_hex=text_hex,
                        )
                    )
                if inner_blks:
                    inner_parts.extend(_render_blocks_to_docx_xml(inner_blks, max(120.0, avail_w_pt - 24.0), depth=depth + 1))
                if not inner_parts or not inner_parts[-1].endswith("</w:p>"):
                    inner_parts.append("<w:p/>")

                top_b = _table_border_xml("single", 4, bdr_c) if is_box else _table_border_xml("none", 0, bdr_c)
                right_b = _table_border_xml("single", 4, bdr_c) if is_box else _table_border_xml("none", 0, bdr_c)
                bottom_b = _table_border_xml("single", 4, bdr_c) if is_box else _table_border_xml("none", 0, bdr_c)
                tbl_pr = (
                    "<w:tblPr>"
                    f'<w:tblW w:w="{avail_tw}" w:type="dxa"/>'
                    "<w:tblBorders>"
                    f"<w:top {top_b}/>"
                    f"<w:left {_table_border_xml('single', 24, bar_c)}/>"
                    f"<w:bottom {bottom_b}/>"
                    f"<w:right {right_b}/>"
                    "</w:tblBorders>"
                    '<w:tblLayout w:type="fixed"/>'
                    '<w:tblCellMar><w:top w:w="120" w:type="dxa"/><w:left w:w="180" w:type="dxa"/>'
                    '<w:bottom w:w="120" w:type="dxa"/><w:right w:w="160" w:type="dxa"/></w:tblCellMar>'
                    "</w:tblPr>"
                )
                out_xml.append(
                    f"<w:tbl>{tbl_pr}<w:tblGrid><w:gridCol w:w=\"{avail_tw}\"/></w:tblGrid>"
                    f'<w:tr><w:tc><w:tcPr><w:tcW w:w="{avail_tw}" w:type="dxa"/>'
                    f'<w:shd w:val="clear" w:color="auto" w:fill="{bg_c}"/></w:tcPr>'
                    f"{''.join(inner_parts)}</w:tc></w:tr></w:tbl>"
                )
                out_xml.append('<w:p><w:pPr><w:spacing w:before="0" w:after="120"/></w:pPr></w:p>')
                estimated_lines += 3

            elif btype == "kpi_strip":
                items = blk.get("metrics") or blk.get("items") or []
                cards = [it for it in items[:4] if isinstance(it, dict)] if isinstance(items, list) else []
                if not cards:
                    continue
                n_cards = len(cards)
                col_w = avail_tw // n_cards
                col_ws = [col_w] * n_cards
                col_ws[-1] += avail_tw - sum(col_ws)
                tbl_pr = (
                    "<w:tblPr>"
                    f'<w:tblW w:w="{avail_tw}" w:type="dxa"/>'
                    "<w:tblBorders>"
                    f"<w:top {_table_border_xml('single', 4, border_hex)}/>"
                    f"<w:left {_table_border_xml('single', 4, border_hex)}/>"
                    f"<w:bottom {_table_border_xml('single', 4, border_hex)}/>"
                    f"<w:right {_table_border_xml('single', 4, border_hex)}/>"
                    f"<w:insideV {_table_border_xml('single', 4, border_hex)}/>"
                    "</w:tblBorders>"
                    '<w:tblLayout w:type="fixed"/>'
                    '<w:tblCellMar><w:top w:w="120" w:type="dxa"/><w:left w:w="140" w:type="dxa"/>'
                    '<w:bottom w:w="120" w:type="dxa"/><w:right w:w="140" w:type="dxa"/></w:tblCellMar>'
                    "</w:tblPr>"
                )
                grid_xml = "".join(f'<w:gridCol w:w="{w}"/>' for w in col_ws)
                cells = []
                for ci, card in enumerate(cards):
                    lbl = str(card.get("label") or "").strip()
                    val = str(card.get("value") or "").strip()
                    det = str(card.get("detail") or card.get("sub") or "").strip()
                    ps = []
                    if lbl:
                        ps.append(_p_simple(lbl, space_before_pt=0.0, space_after_pt=2.0, font_name=body_font, size_pt=7.5, color_hex=muted_hex, bold=True, caps=True))
                    ps.append(_p_simple(val or "—", space_before_pt=0.0, space_after_pt=2.0 if det else 0.0, font_name=heading_font, size_pt=13.5, color_hex=heading_hex, bold=True))
                    if det:
                        ps.append(_p_simple(det, space_before_pt=0.0, space_after_pt=0.0, font_name=body_font, size_pt=8.0, color_hex=accent_hex))
                    cells.append(
                        f'<w:tc><w:tcPr><w:tcW w:w="{col_ws[ci]}" w:type="dxa"/>'
                        f'<w:shd w:val="clear" w:color="auto" w:fill="{surface_hex}"/><w:vAlign w:val="top"/></w:tcPr>'
                        f"{''.join(ps)}</w:tc>"
                    )
                out_xml.append(f"<w:tbl>{tbl_pr}<w:tblGrid>{grid_xml}</w:tblGrid><w:tr>{''.join(cells)}</w:tr></w:tbl>")
                out_xml.append('<w:p><w:pPr><w:spacing w:before="0" w:after="120"/></w:pPr></w:p>')
                estimated_lines += 3

            elif btype in ("code", "code_block", "pre"):
                raw_code = str(blk.get("code") or blk.get("text") or blk.get("content") or "").strip("\r\n")
                if not raw_code.strip():
                    continue
                lang = str(blk.get("language") or blk.get("lang") or "").strip()
                cap = str(blk.get("caption") or blk.get("title") or "").strip()
                hdr = " · ".join([p for p in (lang.upper() if lang else "", cap) if p])

                code_bg = "0F172A"
                code_fg = "E2E8F0"
                code_ps: List[str] = []
                if hdr:
                    code_ps.append(
                        _p_simple(
                            hdr,
                            space_before_pt=0.0,
                            space_after_pt=4.0,
                            font_name=body_font,
                            size_pt=7.8,
                            color_hex="93C5FD",
                            bold=True,
                            inline_md=False,
                        )
                    )
                for line in raw_code.replace("\t", "    ").split("\n"):
                    code_ps.append(
                        _p_simple(
                            line if line else " ",
                            space_before_pt=0.0,
                            space_after_pt=0.0,
                            font_name=mono_font,
                            size_pt=8.4,
                            color_hex=code_fg,
                            inline_md=False,
                        )
                    )
                tbl_pr = (
                    "<w:tblPr>"
                    f'<w:tblW w:w="{avail_tw}" w:type="dxa"/>'
                    "<w:tblBorders>"
                    f"<w:top {_table_border_xml('single', 16, accent_hex)}/>"
                    f"<w:left {_table_border_xml('single', 4, '334155')}/>"
                    f"<w:bottom {_table_border_xml('single', 4, '334155')}/>"
                    f"<w:right {_table_border_xml('single', 4, '334155')}/>"
                    "</w:tblBorders>"
                    '<w:tblLayout w:type="fixed"/>'
                    '<w:tblCellMar><w:top w:w="110" w:type="dxa"/><w:left w:w="160" w:type="dxa"/>'
                    '<w:bottom w:w="110" w:type="dxa"/><w:right w:w="160" w:type="dxa"/></w:tblCellMar>'
                    "</w:tblPr>"
                )
                out_xml.append(
                    f"<w:tbl>{tbl_pr}<w:tblGrid><w:gridCol w:w=\"{avail_tw}\"/></w:tblGrid>"
                    f'<w:tr><w:tc><w:tcPr><w:tcW w:w="{avail_tw}" w:type="dxa"/>'
                    f'<w:shd w:val="clear" w:color="auto" w:fill="{code_bg}"/></w:tcPr>'
                    f"{''.join(code_ps)}</w:tc></w:tr></w:tbl>"
                )
                out_xml.append('<w:p><w:pPr><w:spacing w:before="0" w:after="120"/></w:pPr></w:p>')
                estimated_lines += 2 + len(raw_code.splitlines())

            elif btype == "image":
                raw_img = str(blk.get("path") or blk.get("image_path") or blk.get("src") or "").strip()
                if not raw_img:
                    continue
                try:
                    img_abs, _ = _resolve_workspace_file_smart(workspace_root, raw_img, resolve_path_fn)
                except Exception as exc:
                    warnings.append(f"Imagen omitida ({raw_img}): {exc}")
                    continue
                size_opt = str(blk.get("size") or "large").strip().lower()
                ratio = {"small": 0.4, "medium": 0.65, "large": 0.88, "full": 1.0}.get(size_opt, 0.88)
                added = _add_doc_image(img_abs, avail_w_pt * ratio, max(160.0, (page_h_pt - m_top - m_bottom) * 0.55))
                if added:
                    rid, dw, dh = added
                    next_doc_pr_id += 1
                    align_img = _docx_align_val(blk.get("align") or "center")
                    out_xml.append(
                        f'<w:p><w:pPr><w:spacing w:before="80" w:after="60"/><w:jc w:val="{align_img}"/></w:pPr>'
                        f'{_docx_drawing_run(rid, dw, dh, next_doc_pr_id, img_abs.name)}</w:p>'
                    )
                    cap = str(blk.get("caption") or "").strip()
                    if cap:
                        out_xml.append(
                            _p_simple(cap, align="center", space_before_pt=2.0, space_after_pt=8.0, size_pt=8.5, color_hex=muted_hex, italic=True)
                        )
                    estimated_lines += 10

            elif btype == "divider":
                out_xml.append(
                    f'<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="{border_hex}"/></w:pBdr>'
                    '<w:spacing w:before="80" w:after="120"/></w:pPr></w:p>'
                )
                estimated_lines += 1

            elif btype == "spacer":
                out_xml.append('<w:p><w:pPr><w:spacing w:before="120" w:after="120"/></w:pPr></w:p>')
                estimated_lines += 1

            elif btype == "page_break":
                out_xml.append('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
                estimated_lines += 38

        return out_xml

    body_xml_parts.extend(_render_blocks_to_docx_xml(blocks, flow_w_pt, depth=0))

    # Sección `<w:sectPr>` con geometría exacta en twips
    sect_parts: List[str] = []
    if header_rid:
        sect_parts.append(f'<w:headerReference w:type="default" r:id="{header_rid}"/>')
    if footer_rid:
        sect_parts.append(f'<w:footerReference w:type="default" r:id="{footer_rid}"/>')

    orient_attr = ' w:orient="landscape"' if orientation == "landscape" else ""
    sect_parts.append(f'<w:pgSz w:w="{_pt_to_twips(page_w_pt)}" w:h="{_pt_to_twips(page_h_pt)}"{orient_attr}/>')

    hdr_dist_tw = _pt_to_twips(max(18.0, min(m_top - 10.0, float(header_cfg.get("height_pt") or 28.0))))
    ftr_dist_tw = _pt_to_twips(max(18.0, min(m_bottom - 10.0, float(footer_cfg.get("height_pt") or 26.0))))
    sect_parts.append(
        f'<w:pgMar w:top="{_pt_to_twips(m_top)}" w:right="{_pt_to_twips(m_right)}" '
        f'w:bottom="{_pt_to_twips(m_bottom)}" w:left="{_pt_to_twips(m_left)}" '
        f'w:header="{hdr_dist_tw}" w:footer="{ftr_dist_tw}" w:gutter="0"/>'
    )

    page_border_cfg = page_cfg.get("border") if isinstance(page_cfg.get("border"), dict) else {}
    if bool(page_border_cfg.get("enabled", False)):
        pb_col = _hex6(page_border_cfg.get("color") or border_hex, border_hex)
        pb_sz = _pt_to_eighth_pt(float(page_border_cfg.get("width_pt") or 0.75))
        pb_sp = max(1, min(31, int(round(float(page_border_cfg.get("inset_pt") or 18.0)))))
        sect_parts.append(
            '<w:pgBorders w:offsetFrom="page">'
            f'<w:top w:val="single" w:sz="{pb_sz}" w:space="{pb_sp}" w:color="{pb_col}"/>'
            f'<w:left w:val="single" w:sz="{pb_sz}" w:space="{pb_sp}" w:color="{pb_col}"/>'
            f'<w:bottom w:val="single" w:sz="{pb_sz}" w:space="{pb_sp}" w:color="{pb_col}"/>'
            f'<w:right w:val="single" w:sz="{pb_sz}" w:space="{pb_sp}" w:color="{pb_col}"/>'
            "</w:pgBorders>"
        )

    if num_page_cols >= 2:
        sect_parts.append(f'<w:cols w:num="2" w:space="{_pt_to_twips(col_gap_pt)}"/>')
    else:
        sect_parts.append('<w:cols w:space="720"/>')

    use_title_pg = bool(
        (header_enabled and header_cfg.get("skip_first_page"))
        or (footer_enabled and footer_cfg.get("skip_first_page"))
        or docx_cfg.get("different_first_page")
        or cover_enabled
    )
    if use_title_pg:
        sect_parts.append("<w:titlePg/>")

    has_page_bg = page_bg_hex != "FFFFFF"
    bg_elem = f'<w:background w:color="{page_bg_hex}"/>' if has_page_bg else ""
    document_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        f'<w:document xmlns:w="{_W_NS}" xmlns:r="{_R_NS}" xmlns:wp="{_WP_NS}" '
        f'xmlns:a="{_A_NS}" xmlns:pic="{_PIC_NS}">'
        f"{bg_elem}"
        f"<w:body>{''.join(body_xml_parts)}<w:sectPr>{''.join(sect_parts)}</w:sectPr></w:body>"
        "</w:document>\n"
    )

    tokens = {"title": title, "subtitle": subtitle, "author": author, "date": date_label}
    header_xml = (
        _build_docx_header_or_footer_xml(
            "header",
            header_cfg,
            design_spec=design_spec,
            tokens=tokens,
            body_font=body_font,
            usable_w_twips=usable_w_twips,
            logo_rel_id=header_logo_rid,
            logo_size_pt=header_logo_dims,
        )
        if header_enabled
        else None
    )
    footer_xml = (
        _build_docx_header_or_footer_xml(
            "footer",
            footer_cfg,
            design_spec=design_spec,
            tokens=tokens,
            body_font=body_font,
            usable_w_twips=usable_w_twips,
        )
        if footer_enabled
        else None
    )

    # Ensamblar partes OOXML
    ct_overrides = [
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>',
        '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>',
        '<Override PartName="/word/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>',
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
    ]
    if header_enabled:
        ct_overrides.append(
            '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>'
        )
    if footer_enabled:
        ct_overrides.append(
            '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>'
        )

    ct_defaults = [
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
        '<Default Extension="xml" ContentType="application/xml"/>',
    ]
    if media_files:
        ct_defaults.append('<Default Extension="png" ContentType="image/png"/>')

    content_types_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        f'<Types xmlns="{_CT_NS}">'
        f"{''.join(ct_defaults)}{''.join(ct_overrides)}"
        "</Types>\n"
    )
    root_rels_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        f'<Relationships xmlns="{_PKG_REL_NS}">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>'
        "</Relationships>\n"
    )
    doc_rels_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        f'<Relationships xmlns="{_PKG_REL_NS}">'
        + "".join(
            f'<Relationship Id="{rid}" Type="{rtype}" Target="{target}"/>'
            for rid, rtype, target in doc_rels
        )
        + "</Relationships>\n"
    )

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types_xml)
        zf.writestr("_rels/.rels", root_rels_xml)
        zf.writestr("docProps/core.xml", _build_core_props_xml(title, author, subtitle))
        zf.writestr("docProps/app.xml", _build_app_props_xml("XOOK Office Generator"))
        zf.writestr("word/_rels/document.xml.rels", doc_rels_xml)
        zf.writestr("word/document.xml", document_xml)
        zf.writestr("word/styles.xml", _build_docx_styles_xml(design_spec, body_font=body_font, heading_font=heading_font))
        zf.writestr("word/numbering.xml", _build_docx_numbering_xml(numbered_list_counter, body_font))
        zf.writestr("word/settings.xml", _build_docx_settings_xml(has_page_bg=has_page_bg))
        zf.writestr("word/theme/theme1.xml", _build_docx_theme_xml(design_spec, body_font, heading_font))
        if header_xml is not None:
            zf.writestr("word/header1.xml", header_xml)
            if header_rels:
                h_rels_xml = (
                    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                    f'<Relationships xmlns="{_PKG_REL_NS}">'
                    + "".join(
                        f'<Relationship Id="{rid}" Type="{rtype}" Target="{target}"/>'
                        for rid, rtype, target in header_rels
                    )
                    + "</Relationships>\n"
                )
                zf.writestr("word/_rels/header1.xml.rels", h_rels_xml)
        if footer_xml is not None:
            zf.writestr("word/footer1.xml", footer_xml)
        for m_path, m_bytes in media_files.items():
            zf.writestr(m_path, m_bytes)

    _atomic_write_bytes(out_abs, buf.getvalue())
    size_bytes = out_abs.stat().st_size
    page_count = max(1, math.ceil(estimated_lines / 42.0))

    # Persistir especificación editable para futuras modificaciones
    persisted_ds = _json_safe_copy(design_spec)
    if resolved_skill_dir:
        persisted_ds["_skill_dir"] = resolved_skill_dir
    if resolved_assets:
        persisted_ds["_resolved_assets"] = _json_safe_copy(resolved_assets)
    if effective_design_skill:
        persisted_ds["_skill_slug"] = effective_design_skill

    _save_office_spec_metadata(
        workspace_root,
        out_rel,
        {
            "format": "docx",
            "title": title,
            "subtitle": subtitle,
            "author": author,
            "date": date_label,
            "blocks": blocks,
            "design_skill": effective_design_skill,
            "design_spec": persisted_ds,
            "design_overrides": _json_safe_copy(raw_design_overrides) if raw_design_overrides else None,
        },
    )

    result: Dict[str, Any] = {
        "ok": True,
        "format": "docx",
        "path": out_rel,
        "filename": out_abs.name,
        "size_bytes": size_bytes,
        "page_count": page_count,
        "tables_count": tables_count,
        "design_skill": effective_design_skill,
        "design_spec": _strip_private_keys(design_spec),
        "title": title,
        "revision": int(out_abs.stat().st_mtime * 1000),
    }
    if warnings:
        result["warnings"] = warnings
    return result


# ===========================================================================
# MOTOR NATIVO EXCEL (`.xlsx`)
# ===========================================================================


class _SharedStringsTable:
    def __init__(self) -> None:
        self._index: Dict[str, int] = {}
        self._strings: List[str] = []
        self._total_refs: int = 0

    def add(self, text: str) -> int:
        cleaned = _clean_xml_text(text)
        self._total_refs += 1
        idx = self._index.get(cleaned)
        if idx is None:
            idx = len(self._strings)
            self._index[cleaned] = idx
            self._strings.append(cleaned)
        return idx

    def to_xml(self) -> str:
        items = "".join(
            f'<si><t xml:space="preserve">{_xml_esc(s)}</t></si>'
            for s in self._strings
        )
        return (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            f'<sst xmlns="{_SML_NS}" count="{self._total_refs}" uniqueCount="{len(self._strings)}">'
            f"{items}"
            "</sst>\n"
        )


class _XlsxStyleRegistry:
    """Registro deduplicado de estilos SpreadsheetML 100% conforme a ECMA-376."""

    def __init__(self, ss_cfg: Dict[str, Any], palette: Dict[str, Any]) -> None:
        self.ss_cfg = ss_cfg
        self.palette = palette

        self._num_fmts: List[Tuple[int, str]] = []
        self._num_fmt_map: Dict[str, int] = {"general": 0, "": 0}
        self._next_num_fmt_id = 164

        fmts_cfg = ss_cfg.get("number_formats") if isinstance(ss_cfg.get("number_formats"), dict) else {}
        self._named_fmt_ids: Dict[str, int] = {"general": 0}
        for name_key, default_code in (
            ("currency", "$#,##0.00"),
            ("percent", "0.0%"),
            ("integer", "#,##0"),
            ("decimal", "#,##0.00"),
            ("date", "yyyy-mm-dd"),
        ):
            code = str(fmts_cfg.get(name_key) or default_code).strip()
            self._named_fmt_ids[name_key] = self.register_num_fmt(code)

        # Fonts (index 0 = cuerpo normal)
        self._fonts: List[str] = []
        self._font_map: Dict[Tuple[Any, ...], int] = {}

        # Fills (REGLA EXCEL: 0=none, 1=gray125 obligatorio)
        self._fills: List[str] = [
            '<fill><patternFill patternType="none"/></fill>',
            '<fill><patternFill patternType="gray125"/></fill>',
        ]
        self._fill_map: Dict[str, int] = {"": 0}

        # Borders (index 0 = sin bordes)
        self._borders: List[str] = [
            "<border><left/><right/><top/><bottom/><diagonal/></border>"
        ]
        self._border_map: Dict[Tuple[Any, ...], int] = {("none", "none", "none", "none", ""): 0}

        # CellXfs (index 0 = Normal)
        self._xfs: List[str] = []
        self._xf_map: Dict[Tuple[Any, ...], int] = {}

        body_font = str(ss_cfg.get("body_font_name") or "Calibri")
        body_sz = float(ss_cfg.get("body_font_size") or 10.0)
        body_fg = _hex6(palette.get("text"), "1E293B")
        base_font_id = self.register_font(body_font, body_sz, body_fg, bold=False, italic=False)
        self.default_xf = self.register_xf(
            font_id=base_font_id,
            fill_id=0,
            border_id=0,
            num_fmt_id=0,
            h_align="left",
            v_align="center",
            wrap_text=False,
        )

    def register_num_fmt(self, fmt_spec: Optional[str]) -> int:
        if not fmt_spec:
            return 0
        key = str(fmt_spec).strip()
        low = key.lower()
        if low in self._named_fmt_ids:
            return self._named_fmt_ids[low]
        if key in self._num_fmt_map:
            return self._num_fmt_map[key]
        fmt_id = self._next_num_fmt_id
        self._next_num_fmt_id += 1
        self._num_fmts.append((fmt_id, key))
        self._num_fmt_map[key] = fmt_id
        return fmt_id

    def register_font(
        self,
        name: str,
        size: float,
        color_hex: str,
        *,
        bold: bool = False,
        italic: bool = False,
    ) -> int:
        c = _argb8(color_hex)
        key = (name, round(float(size), 1), c, bool(bold), bool(italic))
        if key in self._font_map:
            return self._font_map[key]
        parts: List[str] = []
        if bold:
            parts.append("<b/>")
        if italic:
            parts.append("<i/>")
        parts.append(f'<sz val="{round(float(size), 1)}"/>')
        parts.append(f'<color rgb="{c}"/>')
        parts.append(f'<name val={_xml_attr(name)}/>')
        idx = len(self._fonts)
        self._fonts.append(f"<font>{''.join(parts)}</font>")
        self._font_map[key] = idx
        return idx

    def register_fill(self, bg_hex: Optional[str]) -> int:
        if not bg_hex:
            return 0
        argb = _argb8(bg_hex)
        if argb in self._fill_map:
            return self._fill_map[argb]
        idx = len(self._fills)
        self._fills.append(
            f'<fill><patternFill patternType="solid"><fgColor rgb="{argb}"/><bgColor indexed="64"/></patternFill></fill>'
        )
        self._fill_map[argb] = idx
        return idx

    def register_border(
        self,
        *,
        left: str = "none",
        right: str = "none",
        top: str = "none",
        bottom: str = "none",
        color_hex: str = "CBD5E1",
        top_color_hex: Optional[str] = None,
        bottom_color_hex: Optional[str] = None,
    ) -> int:
        if left == "none" and right == "none" and top == "none" and bottom == "none":
            return 0
        c = _argb8(color_hex)
        tc = _argb8(top_color_hex or color_hex)
        bc = _argb8(bottom_color_hex or color_hex)
        key = (left, right, top, bottom, c, tc, bc)
        if key in self._border_map:
            return self._border_map[key]

        def _edge(tag: str, style: str, edge_c: str) -> str:
            if not style or style == "none":
                return f"<{tag}/>"
            return f'<{tag} style="{style}"><color rgb="{edge_c}"/></{tag}>'

        xml = (
            "<border>"
            + _edge("left", left, c)
            + _edge("right", right, c)
            + _edge("top", top, tc)
            + _edge("bottom", bottom, bc)
            + "<diagonal/></border>"
        )
        idx = len(self._borders)
        self._borders.append(xml)
        self._border_map[key] = idx
        return idx

    def register_xf(
        self,
        *,
        font_id: int,
        fill_id: int,
        border_id: int,
        num_fmt_id: int,
        h_align: str = "left",
        v_align: str = "center",
        wrap_text: bool = False,
    ) -> int:
        key = (font_id, fill_id, border_id, num_fmt_id, h_align, v_align, bool(wrap_text))
        if key in self._xf_map:
            return self._xf_map[key]
        attrs = [
            f'numFmtId="{num_fmt_id}"',
            f'fontId="{font_id}"',
            f'fillId="{fill_id}"',
            f'borderId="{border_id}"',
            'xfId="0"',
        ]
        if num_fmt_id != 0:
            attrs.append('applyNumberFormat="1"')
        if font_id != 0:
            attrs.append('applyFont="1"')
        if fill_id != 0:
            attrs.append('applyFill="1"')
        if border_id != 0:
            attrs.append('applyBorder="1"')
        attrs.append('applyAlignment="1"')
        wrap_attr = ' wrapText="1"' if wrap_text else ""
        xml = (
            f'<xf {" ".join(attrs)}>'
            f'<alignment horizontal="{h_align}" vertical="{v_align}"{wrap_attr}/>'
            "</xf>"
        )
        idx = len(self._xfs)
        self._xfs.append(xml)
        self._xf_map[key] = idx
        return idx

    def to_xml(self) -> str:
        num_fmts_xml = ""
        if self._num_fmts:
            nf_items = "".join(
                f'<numFmt numFmtId="{nid}" formatCode={_xml_attr(code)}/>'
                for nid, code in self._num_fmts
            )
            num_fmts_xml = f'<numFmts count="{len(self._num_fmts)}">{nf_items}</numFmts>'

        return (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            f'<styleSheet xmlns="{_SML_NS}">'
            f"{num_fmts_xml}"
            f'<fonts count="{len(self._fonts)}">{"".join(self._fonts)}</fonts>'
            f'<fills count="{len(self._fills)}">{"".join(self._fills)}</fills>'
            f'<borders count="{len(self._borders)}">{"".join(self._borders)}</borders>'
            '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
            f'<cellXfs count="{len(self._xfs)}">{"".join(self._xfs)}</cellXfs>'
            '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
            "</styleSheet>\n"
        )


def _sanitize_sheet_name(raw: str, existing: set, fallback_idx: int) -> str:
    cleaned = _INVALID_SHEET_CHARS_RE.sub(" ", _clean_xml_text(raw)).strip().strip("'")
    cleaned = " ".join(cleaned.split())
    if not cleaned:
        cleaned = f"Hoja {fallback_idx}"
    base = cleaned[:31].rstrip("'") or f"Hoja {fallback_idx}"
    cand = base
    suffix = 2
    while cand.lower() in existing:
        tail = f" ({suffix})"
        cand = (base[: max(1, 31 - len(tail))] + tail).strip()
        suffix += 1
    existing.add(cand.lower())
    return cand


def _parse_numeric_cell(raw: Any, col_fmt: Optional[str]) -> Tuple[Optional[float], Optional[str]]:
    """
    Convierte valores numéricos o strings monetarios/porcentuales limpios a float,
    devolviendo `(valor_float, formato_inferido_opcional)`.
    No altera códigos postales/IDs con ceros a la izquierda ni fechas.
    """
    if isinstance(raw, bool) or raw is None:
        return None, None
    if isinstance(raw, (int, float)):
        f = float(raw)
        if math.isfinite(f):
            return f, None
        return None, None
    if not isinstance(raw, str):
        return None, None
    s = raw.strip()
    if not s or s.startswith("="):
        return None, None
    # Evitar convertir fechas tipo 2026-11-21 o 12/05/2026 o IDs con cero inicial tipo "00123"
    if re.match(r"^\d{1,4}[-/]\d{1,2}[-/]\d{1,4}$", s):
        return None, None
    if re.match(r"^0\d+$", s):
        return None, None

    # Porcentaje: "15.5%" -> 0.155
    m_pct = re.fullmatch(r"([+\-]?\d[\d,]*(?:\.\d+)?)\s*%", s)
    if m_pct:
        try:
            return float(m_pct.group(1).replace(",", "")) / 100.0, "percent"
        except ValueError:
            return None, None

    # Moneda: "$1,250.50", "-$400", "€ 99.90"
    m_cur = re.fullmatch(r"([+\-]?)\s*[$€£¥]\s*(\d[\d,]*(?:\.\d+)?)", s)
    if m_cur:
        try:
            sign = -1.0 if m_cur.group(1) == "-" else 1.0
            return sign * float(m_cur.group(2).replace(",", "")), "currency"
        except ValueError:
            return None, None

    # Número plano o con separadores de miles
    m_num = re.fullmatch(r"([+\-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)", s)
    if m_num:
        # Si la columna es explícitamente numérica o el valor no tiene ceros iniciales ambiguos
        is_numeric_col = bool(col_fmt and str(col_fmt).lower() in ("currency", "percent", "integer", "decimal") or (col_fmt and "#" in str(col_fmt)))
        if is_numeric_col or "," in s or "." in s or len(s.lstrip("+-")) <= 11:
            try:
                val = float(m_num.group(1).replace(",", ""))
                if math.isfinite(val):
                    return val, None
            except ValueError:
                return None, None
    return None, None


def _safe_eval_arith(expr: str) -> Optional[float]:
    """Evalúa de forma segura una expresión aritmética simple (`+ - * / ()`) vía AST."""
    try:
        node = ast.parse(expr, mode="eval")
    except Exception:
        return None

    def _eval_node(n: ast.AST) -> float:
        if isinstance(n, ast.Expression):
            return _eval_node(n.body)
        if isinstance(n, ast.Constant) and isinstance(n.value, (int, float)) and not isinstance(n.value, bool):
            return float(n.value)
        if isinstance(n, ast.UnaryOp):
            v = _eval_node(n.operand)
            if isinstance(n.op, ast.UAdd):
                return +v
            if isinstance(n.op, ast.USub):
                return -v
            raise ValueError("Unsupported unary op")
        if isinstance(n, ast.BinOp):
            l = _eval_node(n.left)
            r = _eval_node(n.right)
            if isinstance(n.op, ast.Add):
                return l + r
            if isinstance(n.op, ast.Sub):
                return l - r
            if isinstance(n.op, ast.Mult):
                return l * r
            if isinstance(n.op, ast.Div):
                if r == 0:
                    raise ZeroDivisionError()
                return l / r
            raise ValueError("Unsupported bin op")
        raise ValueError("Unsupported AST node")

    try:
        res = _eval_node(node)
        return res if math.isfinite(res) else None
    except Exception:
        return None


def _eval_cached_formula(formula_body: str, cell_values: Dict[Tuple[int, int], float]) -> Optional[float]:
    """
    Calcula opcionalmente el valor cacheado `<v>` para fórmulas comunes (`SUM`, `AVERAGE`,
    `COUNT`, `MIN`, `MAX` y aritmética simple `B2*C2`, `D2+D3`) para que lectores como
    `office_reader.read_universal_document` muestren resultados inmediatos mientras Excel
    recalcula la fórmula viva `<f>` al abrir.
    """
    f = (formula_body or "").strip()
    if not f:
        return None

    m_fn = re.fullmatch(r"(SUM|AVERAGE|AVG|COUNT|MIN|MAX)\(([^()]+)\)", f, re.IGNORECASE)
    if m_fn:
        fn_name = m_fn.group(1).upper()
        args_str = m_fn.group(2)
        vals: List[float] = []
        for token in args_str.split(","):
            tok = token.strip()
            rm = _RANGE_REF_RE.fullmatch(tok)
            if rm:
                c1, r1 = _col_letters_to_index(rm.group(1)), int(rm.group(2))
                c2, r2 = _col_letters_to_index(rm.group(3)), int(rm.group(4))
                for rr in range(min(r1, r2), max(r1, r2) + 1):
                    for cc in range(min(c1, c2), max(c1, c2) + 1):
                        if (cc, rr) in cell_values:
                            vals.append(cell_values[(cc, rr)])
                continue
            cm = _CELL_REF_RE.fullmatch(tok)
            if cm:
                cc, rr = _col_letters_to_index(cm.group(1)), int(cm.group(2))
                if (cc, rr) in cell_values:
                    vals.append(cell_values[(cc, rr)])
                continue
            try:
                vals.append(float(tok))
            except ValueError:
                return None
        if fn_name == "SUM":
            return sum(vals)
        if fn_name in ("AVERAGE", "AVG"):
            return (sum(vals) / len(vals)) if vals else 0.0
        if fn_name == "COUNT":
            return float(len(vals))
        if fn_name == "MIN":
            return min(vals) if vals else 0.0
        if fn_name == "MAX":
            return max(vals) if vals else 0.0

    # Aritmética simple con referencias de celda: ej. "B2*C2", "(D2-E2)/D2"
    if re.fullmatch(r"[\sA-Za-z0-9$+\-*/().]+", f) and not re.search(r"[A-Za-z_]+\s*\(", f):
        missing = False

        def _subst_ref(m: re.Match[str]) -> str:
            nonlocal missing
            cc = _col_letters_to_index(m.group(1))
            rr = int(m.group(2))
            if (cc, rr) not in cell_values:
                missing = True
                return "0"
            return repr(cell_values[(cc, rr)])

        replaced = _CELL_REF_RE.sub(_subst_ref, f)
        if not missing:
            return _safe_eval_arith(replaced)
    return None


def _format_num_for_xml(val: float) -> str:
    if float(val).is_integer() and abs(val) < 1e15:
        return str(int(val))
    if abs(val) < 1e15 and (abs(val) >= 1e-6 or val == 0.0):
        s = f"{round(val, 10):.10f}".rstrip("0").rstrip(".")
        return s if s not in ("", "-0") else "0"
    return repr(val)


def _extract_xlsx_sheets_for_modify(file_abs: Path) -> List[Dict[str, Any]]:
    """
    Lee hojas de un `.xlsx` existente conservando fórmulas (`=...`), valores numéricos,
    anchos de columna, paneles congelados y autofiltros para `edit_action="modify"`.
    """
    sheets: List[Dict[str, Any]] = []
    try:
        with zipfile.ZipFile(file_abs, "r") as zf:
            names = set(zf.namelist())
            shared_strings: List[str] = []
            if "xl/sharedStrings.xml" in names:
                ss_root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
                for si in ss_root:
                    if _local_tag(si.tag) == "si":
                        shared_strings.append(
                            "".join(t.text for t in si.iter() if _local_tag(t.tag) == "t" and t.text is not None)
                        )

            rels_map: Dict[str, str] = {}
            if "xl/_rels/workbook.xml.rels" in names:
                for rel in ET.fromstring(zf.read("xl/_rels/workbook.xml.rels")):
                    if _local_tag(rel.tag) == "Relationship":
                        rid = rel.attrib.get("Id", "")
                        tgt = rel.attrib.get("Target", "").lstrip("/")
                        if tgt and not tgt.startswith("xl/"):
                            tgt = f"xl/{tgt}"
                        if rid and tgt:
                            rels_map[rid] = tgt

            entries: List[Tuple[str, str]] = []
            if "xl/workbook.xml" in names:
                for elem in ET.fromstring(zf.read("xl/workbook.xml")).iter():
                    if _local_tag(elem.tag) == "sheet":
                        s_name = elem.attrib.get("name") or "Hoja"
                        rid = ""
                        for k, v in elem.attrib.items():
                            if _local_tag(k) == "id":
                                rid = v
                        tgt = rels_map.get(rid, "")
                        if tgt in names:
                            entries.append((s_name, tgt))

            for s_name, xml_path in entries:
                ws_root = ET.fromstring(zf.read(xml_path))
                freeze_header = False
                auto_filter = False
                col_widths_map: Dict[int, float] = {}
                merges: List[str] = []
                row_dicts: List[Tuple[int, Dict[int, Any]]] = []
                max_col = 0

                for elem in ws_root.iter():
                    lt = _local_tag(elem.tag)
                    if lt == "pane" and elem.attrib.get("state") == "frozen":
                        freeze_header = True
                    elif lt == "autoFilter":
                        auto_filter = True
                    elif lt == "col":
                        try:
                            cmin = int(elem.attrib.get("min", "1"))
                            cmax = int(elem.attrib.get("max", str(cmin)))
                            w = float(elem.attrib.get("width", "16"))
                            for c_i in range(cmin - 1, min(cmax, 40)):
                                col_widths_map[c_i] = round(w, 1)
                        except Exception:
                            pass
                    elif lt == "mergeCell" and elem.attrib.get("ref"):
                        merges.append(elem.attrib["ref"])
                    elif lt == "row":
                        r_num = int(elem.attrib.get("r", str(len(row_dicts) + 1)))
                        r_map: Dict[int, Any] = {}
                        cur_c = 0
                        for cell in elem:
                            if _local_tag(cell.tag) != "c":
                                continue
                            ref = cell.attrib.get("r", "")
                            ci = _col_letters_to_index(ref) if ref else cur_c
                            cur_c = ci + 1
                            ctype = cell.attrib.get("t", "")
                            f_node = None
                            v_node = None
                            for sub in cell:
                                st = _local_tag(sub.tag)
                                if st == "f":
                                    f_node = sub
                                elif st == "v":
                                    v_node = sub
                            if f_node is not None and f_node.text:
                                r_map[ci] = f"={f_node.text.strip()}"
                            elif ctype == "inlineStr":
                                r_map[ci] = "".join(
                                    t.text for t in cell.iter() if _local_tag(t.tag) == "t" and t.text is not None
                                )
                            elif v_node is not None and v_node.text is not None:
                                rv = v_node.text.strip()
                                if ctype == "s":
                                    try:
                                        si_i = int(rv)
                                        r_map[ci] = shared_strings[si_i] if 0 <= si_i < len(shared_strings) else rv
                                    except Exception:
                                        r_map[ci] = rv
                                elif ctype == "b":
                                    r_map[ci] = rv == "1"
                                else:
                                    try:
                                        fv = float(rv)
                                        r_map[ci] = int(fv) if fv.is_integer() else fv
                                    except ValueError:
                                        r_map[ci] = rv
                        if r_map:
                            max_col = max(max_col, max(r_map.keys()) + 1)
                            row_dicts.append((r_num, r_map))

                title_banner = ""
                subtitle = ""
                start_idx = 0
                if row_dicts and any(m.startswith("A1:") for m in merges) and len(row_dicts[0][1]) == 1:
                    title_banner = str(row_dicts[0][1].get(0, "")).strip()
                    start_idx = 1
                    if len(row_dicts) > 1 and any(m.startswith("A2:") for m in merges) and len(row_dicts[1][1]) == 1:
                        subtitle = str(row_dicts[1][1].get(0, "")).strip()
                        start_idx = 2

                usable_rows = row_dicts[start_idx:]
                if usable_rows and max_col > 0:
                    headers = [
                        str(usable_rows[0][1].get(c, "")).strip() or f"Col {c + 1}"
                        for c in range(max_col)
                    ]
                    body_rows = [
                        [r_map.get(c, "") for c in range(max_col)]
                        for _, r_map in usable_rows[1:]
                    ]
                else:
                    headers = []
                    body_rows = []

                totals_row: Any = None
                if body_rows and any(isinstance(v, str) and v.startswith("=") and "SUM(" in v.upper() for v in body_rows[-1]):
                    popped_tot = body_rows.pop()
                    first_lbl = str(popped_tot[0] if popped_tot else "").strip().lower()
                    other_cells = [str(v).strip() for v in popped_tot[1:] if v is not None and str(v).strip()]
                    if first_lbl in ("total", "totales") and other_cells and all(
                        re.fullmatch(r"=SUM\([A-Za-z]+\d+:[A-Za-z]+\d+\)", c, re.IGNORECASE)
                        for c in other_cells
                    ):
                        totals_row = True
                    else:
                        totals_row = popped_tot

                sheet_obj: Dict[str, Any] = {
                    "name": s_name,
                    "headers": headers,
                    "rows": body_rows,
                    "freeze_header": freeze_header,
                    "auto_filter": auto_filter,
                }
                if title_banner:
                    sheet_obj["title_banner"] = title_banner
                if subtitle:
                    sheet_obj["subtitle"] = subtitle
                if totals_row is not None:
                    sheet_obj["totals_row"] = totals_row
                if col_widths_map and max_col > 0:
                    sheet_obj["col_widths"] = [col_widths_map.get(c, 16.0) for c in range(max_col)]
                sheets.append(sheet_obj)
    except Exception:
        return []
    return sheets


def _extract_sheets_from_spec(spec: Dict[str, Any], title: str) -> List[Dict[str, Any]]:
    """
    Normaliza `sheets` desde el spec o convierte automáticamente `headers`+`rows` o
    `blocks` (`table`/`kv_grid`/texto) en hojas válidas.
    """
    raw_sheets = spec.get("sheets")
    if isinstance(raw_sheets, list) and raw_sheets:
        return [copy.deepcopy(s) for s in raw_sheets if isinstance(s, dict)]

    # Fallback 1: headers + rows a nivel raíz
    if isinstance(spec.get("headers"), list) or isinstance(spec.get("rows"), list):
        single: Dict[str, Any] = {
            "name": str(spec.get("sheet_name") or title or "Datos")[:31],
            "headers": list(spec.get("headers") or []),
            "rows": list(spec.get("rows") or []),
        }
        for opt_k in ("title_banner", "subtitle", "totals_row", "col_widths", "number_formats", "freeze_header", "auto_filter", "column_alignments"):
            if opt_k in spec and spec.get(opt_k) is not None:
                single[opt_k] = copy.deepcopy(spec[opt_k])
        return [single]

    # Fallback 2: convertir bloques XOOK (`table`, `kv_grid`, `markdown`)
    blocks, _ = _normalize_blocks_input(spec)
    if not blocks:
        return []

    derived: List[Dict[str, Any]] = []
    last_heading = ""
    fallback_text_rows: List[List[str]] = []

    for blk in blocks:
        btype = str(blk.get("type") or "").strip().lower()
        if btype == "heading":
            last_heading = str(blk.get("text") or blk.get("title") or "").strip()
        elif btype == "table":
            headers = list(blk.get("headers") or blk.get("columns") or [])
            rows = list(blk.get("rows") or [])
            if headers or rows:
                s_name = str(blk.get("caption") or last_heading or f"Tabla {len(derived) + 1}").strip()
                derived.append({
                    "name": s_name[:31],
                    "headers": headers,
                    "rows": rows,
                    "totals_row": bool(blk.get("totals_row") or blk.get("highlight_last_row")),
                })
        elif btype in ("kv_grid", "header_band"):
            raw_items = blk.get("items") or []
            if isinstance(raw_items, dict):
                kv_rows = [[str(k), str(v)] for k, v in raw_items.items()]
            elif isinstance(raw_items, list):
                kv_rows = [
                    [str(it.get("label") or it.get("key") or ""), str(it.get("value") or "")]
                    for it in raw_items
                    if isinstance(it, dict)
                ]
            else:
                kv_rows = []
            if kv_rows:
                s_name = str(blk.get("title") or last_heading or f"Resumen {len(derived) + 1}").strip()
                derived.append({
                    "name": s_name[:31],
                    "headers": ["Campo", "Valor"],
                    "rows": kv_rows,
                })
        elif btype == "paragraph":
            txt = str(blk.get("text") or "").strip()
            if txt:
                fallback_text_rows.append([last_heading or "Nota", txt])
        elif btype in ("bullets", "numbered_list"):
            for it in (blk.get("items") or []):
                s = str(it or "").strip()
                if s:
                    fallback_text_rows.append([last_heading or "Detalle", s])

    if derived:
        return derived
    if fallback_text_rows:
        return [{
            "name": (title or "Resumen")[:31],
            "headers": ["Sección", "Contenido"],
            "rows": fallback_text_rows,
        }]
    return []


def generate_xlsx_document(
    spec: Dict[str, Any],
    *,
    workspace_root: Path,
    resolve_path_fn: Callable[[Path, str], Tuple[Path, str, str]],
    autonomous_roots: Tuple[str, ...] = ("agente", "memoria"),
    default_author: Optional[str] = None,
    allow_any_workspace_zone: bool = False,
    global_skills_dir: Optional[Path] = None,
) -> Dict[str, Any]:
    """
    Genera o modifica un libro Microsoft Excel (`.xlsx`) nativo con estilo SpreadsheetML completo,
    fórmulas reales `<f>`, formatos numéricos, paneles congelados, autofiltros y replicación
    de `design_skill` / `design_spec` + `design_overrides`.
    """
    if not isinstance(spec, dict):
        raise ValueError("`spec` debe ser un diccionario válido.")

    warnings: List[str] = []
    edit_action = str(spec.get("edit_action") or "create").strip().lower()
    source_path_raw = str(spec.get("source_path") or "").strip()

    saved_meta: Optional[Dict[str, Any]] = None
    source_abs: Optional[Path] = None
    source_rel: Optional[str] = None

    if source_path_raw and (edit_action == "modify" or spec.get("edit_action") is None):
        edit_action = "modify"
        try:
            source_abs, source_rel = _resolve_workspace_file_smart(workspace_root, source_path_raw, resolve_path_fn)
        except Exception:
            source_abs, source_rel, _ = resolve_path_fn(workspace_root, source_path_raw)
        if not source_abs.is_file():
            raise FileNotFoundError(f"No se encontró el libro Excel origen: {source_path_raw}")

        saved_meta = _load_office_spec_metadata(workspace_root, source_rel)
        if saved_meta is None:
            parsed_sheets = _extract_xlsx_sheets_for_modify(source_abs)
            if not parsed_sheets:
                from slices.pdf_engine.office_reader import read_universal_document

                read_res = read_universal_document(source_abs, source_rel)
                parsed_sheets = list(read_res.get("sheets") or [])
            inspected_design = _try_inspect_office_design(source_abs)
            saved_meta = {
                "format": "xlsx",
                "title": source_abs.stem.replace("_", " ").replace("-", " ").strip() or source_abs.name,
                "subtitle": "",
                "author": default_author or "",
                "date": _spanish_date_label(),
                "sheets": parsed_sheets,
                "design_spec": inspected_design,
                "design_skill": None,
            }

    title = str(spec.get("title") or (saved_meta.get("title") if saved_meta else "") or "Libro de Datos").strip()
    subtitle = str(
        spec["subtitle"]
        if "subtitle" in spec and spec.get("subtitle") is not None
        else (saved_meta.get("subtitle") if saved_meta else "")
    ).strip()
    author = str(
        spec["author"]
        if "author" in spec and spec.get("author") is not None
        else ((saved_meta.get("author") if saved_meta else "") or default_author or "")
    ).strip()
    date_label = str(
        spec["date"]
        if "date" in spec and spec.get("date") is not None
        else ((saved_meta.get("date") if saved_meta else "") or _spanish_date_label())
    ).strip()

    design_skill_ref = str(spec.get("design_skill") or "").strip()
    if not design_skill_ref and saved_meta and saved_meta.get("design_skill"):
        design_skill_ref = str(saved_meta["design_skill"]).strip()
    raw_inline_design = spec.get("design_spec") if isinstance(spec.get("design_spec"), dict) and spec.get("design_spec") else None
    raw_design_overrides = spec.get("design_overrides") if isinstance(spec.get("design_overrides"), dict) and spec.get("design_overrides") else None
    base_design = saved_meta.get("design_spec") if (saved_meta and isinstance(saved_meta.get("design_spec"), dict)) else None

    skill_to_load = design_skill_ref if (str(spec.get("design_skill") or "").strip() or base_design is None) else ""
    design_spec, resolved_skill_slug, resolved_skill_dir, resolved_assets = _resolve_office_design_spec(
        design_skill_ref=skill_to_load,
        raw_inline_design=raw_inline_design,
        raw_design_overrides=raw_design_overrides,
        base_design=base_design,
        target_format="xlsx",
        workspace_root=workspace_root,
        global_skills_dir=global_skills_dir,
        warnings=warnings,
    )
    effective_design_skill = resolved_skill_slug or (design_skill_ref or None)

    sheets = _extract_sheets_from_spec(spec, title)
    if edit_action == "modify" and saved_meta is not None:
        if not sheets:
            sheets = copy.deepcopy(saved_meta.get("sheets") or [])
        # Opcional: añadir filas a una hoja existente (`append_rows` o `update_sheets`)
        append_rows = spec.get("append_rows")
        if isinstance(append_rows, list) and append_rows and sheets:
            target_sheet_name = str(spec.get("sheet_name") or "").strip().lower()
            target_sheet = sheets[0]
            if target_sheet_name:
                for sh in sheets:
                    if str(sh.get("name") or "").strip().lower() == target_sheet_name:
                        target_sheet = sh
                        break
            target_sheet.setdefault("rows", [])
            for r in append_rows:
                if isinstance(r, list):
                    target_sheet["rows"].append(r)

        replacements = _normalize_replacements(spec.get("replacements"))
        if replacements:
            sheets = _apply_replacements_to_value(sheets, replacements)
            title = _apply_replacements_to_value(title, replacements)
            subtitle = _apply_replacements_to_value(subtitle, replacements)

    if not sheets:
        raise ValueError(
            "El libro Excel no contiene hojas ni datos (`sheets`, `headers`+`rows` o `blocks`). "
            "Proporciona al menos una hoja con encabezados o filas."
        )

    raw_out = str(spec.get("output_path") or "").strip()
    if not raw_out and edit_action == "modify" and source_rel:
        raw_out = source_rel
    out_abs, out_rel = _resolve_output_path(
        raw_out,
        title=title,
        ext=".xlsx",
        workspace_root=workspace_root,
        resolve_path_fn=resolve_path_fn,
        autonomous_roots=autonomous_roots,
        allow_any_workspace_zone=allow_any_workspace_zone,
    )

    ss_cfg = design_spec["spreadsheet"]
    pal = design_spec["palette"]
    page_cfg = design_spec["page"]

    style_reg = _XlsxStyleRegistry(ss_cfg, pal)
    sst = _SharedStringsTable()

    body_font_name = str(ss_cfg["body_font_name"])
    body_font_size = float(ss_cfg["body_font_size"])
    header_font_size = float(ss_cfg["header_font_size"])
    header_bold = bool(ss_cfg["header_bold"])
    header_bg = str(ss_cfg["header_bg"])
    header_fg = str(ss_cfg["header_fg"])
    alt_row_bg = str(ss_cfg["alt_row_bg"])
    total_row_bg = str(ss_cfg["total_row_bg"])
    total_row_fg = str(ss_cfg["total_row_fg"])
    total_row_bold = bool(ss_cfg["total_row_bold"])
    border_style = str(ss_cfg["border_style"])
    border_color = str(ss_cfg["border_color"])
    default_freeze = bool(ss_cfg["freeze_header"])
    default_filter = bool(ss_cfg["auto_filter"])
    show_gridlines = bool(ss_cfg["show_gridlines"])
    default_col_width = float(ss_cfg["default_col_width"])
    print_orient = str(ss_cfg["print_orientation"])
    accent_hex = str(pal.get("accent") or "#2563EB")
    heading_hex = str(pal.get("heading") or "#0F172A")
    text_hex = str(pal.get("text") or "#1E293B")
    muted_hex = str(pal.get("muted") or "#64748B")
    accent_soft_hex = str(pal.get("accent_soft") or "#EFF6FF")

    # Registrar fuentes, rellenos y bordes reutilizables
    f_body = style_reg.register_font(body_font_name, body_font_size, text_hex, bold=False, italic=False)
    f_header = style_reg.register_font(body_font_name, header_font_size, header_fg, bold=header_bold, italic=False)
    f_total = style_reg.register_font(body_font_name, body_font_size, total_row_fg, bold=total_row_bold, italic=False)
    f_banner = style_reg.register_font(body_font_name, max(13.5, header_font_size + 3.5), heading_hex, bold=True, italic=False)
    f_subtitle = style_reg.register_font(body_font_name, max(9.0, body_font_size - 0.5), muted_hex, bold=False, italic=True)

    fill_header = style_reg.register_fill(header_bg)
    fill_alt = style_reg.register_fill(alt_row_bg)
    fill_total = style_reg.register_fill(total_row_bg)
    fill_banner = style_reg.register_fill(accent_soft_hex)

    if border_style == "none":
        bdr_body = 0
        bdr_header = 0
    elif border_style == "horizontal":
        bdr_body = style_reg.register_border(top="thin", bottom="thin", color_hex=border_color)
        bdr_header = style_reg.register_border(top="thin", bottom="medium", color_hex=border_color, bottom_color_hex=accent_hex)
    elif border_style == "medium":
        bdr_body = style_reg.register_border(left="thin", right="thin", top="thin", bottom="thin", color_hex=border_color)
        bdr_header = style_reg.register_border(left="medium", right="medium", top="medium", bottom="medium", color_hex=border_color)
    else:
        # "thin"
        bdr_body = style_reg.register_border(left="thin", right="thin", top="thin", bottom="thin", color_hex=border_color)
        bdr_header = style_reg.register_border(left="thin", right="thin", top="thin", bottom="medium", color_hex=border_color, bottom_color_hex=accent_hex)

    bdr_banner = style_reg.register_border(bottom="medium", color_hex=accent_hex)
    bdr_total = (
        0
        if border_style == "none"
        else style_reg.register_border(
            left="thin" if border_style in ("thin", "medium") else "none",
            right="thin" if border_style in ("thin", "medium") else "none",
            top="thin",
            bottom="double",
            color_hex=border_color,
            top_color_hex=heading_hex,
            bottom_color_hex=heading_hex,
        )
    )

    xf_banner = style_reg.register_xf(font_id=f_banner, fill_id=fill_banner, border_id=bdr_banner, num_fmt_id=0, h_align="left", v_align="center", wrap_text=False)
    xf_subtitle = style_reg.register_xf(font_id=f_subtitle, fill_id=0, border_id=0, num_fmt_id=0, h_align="left", v_align="center", wrap_text=False)

    # Márgenes de página en pulgadas desde `page.margins_pt`
    p_margins = page_cfg.get("margins_pt") if isinstance(page_cfg.get("margins_pt"), dict) else {}
    pm_left = round(max(0.25, float(p_margins.get("left") or 50.4) / 72.0), 2)
    pm_right = round(max(0.25, float(p_margins.get("right") or 50.4) / 72.0), 2)
    pm_top = round(max(0.25, float(p_margins.get("top") or 54.0) / 72.0), 2)
    pm_bottom = round(max(0.25, float(p_margins.get("bottom") or 54.0) / 72.0), 2)
    paper_size = "9" if str(page_cfg.get("size_name") or "").lower() == "a4" else "1"

    blueprint_sheets = ss_cfg.get("sheets_blueprint") if isinstance(ss_cfg.get("sheets_blueprint"), list) else []

    used_sheet_names: set = set()
    worksheet_xmls: List[Tuple[str, str]] = []
    total_data_rows = 0

    for sh_idx, raw_sheet in enumerate(sheets):
        s_name = _sanitize_sheet_name(str(raw_sheet.get("name") or f"Hoja {sh_idx + 1}"), used_sheet_names, sh_idx + 1)
        headers = [str("" if h is None else h).strip() for h in (raw_sheet.get("headers") or [])]
        raw_rows = raw_sheet.get("rows") if isinstance(raw_sheet.get("rows"), list) else []
        norm_rows: List[List[Any]] = [list(r) for r in raw_rows if isinstance(r, list)]

        max_cols = len(headers)
        for r in norm_rows:
            max_cols = max(max_cols, len(r))
        totals_spec = raw_sheet.get("totals_row")
        if isinstance(totals_spec, list):
            max_cols = max(max_cols, len(totals_spec))
        if max_cols == 0:
            headers = ["Datos"]
            max_cols = 1
        elif not headers:
            headers = [f"Col {i + 1}" for i in range(max_cols)]
        elif len(headers) < max_cols:
            headers = headers + [f"Col {i + 1}" for i in range(len(headers), max_cols)]

        total_data_rows += len(norm_rows)

        # Resolver formatos numéricos por columna (por índice o por nombre de encabezado)
        raw_nf = raw_sheet.get("number_formats") if isinstance(raw_sheet.get("number_formats"), dict) else {}
        col_fmt_spec: List[Optional[str]] = [None] * max_cols
        header_low_map = {h.strip().lower(): i for i, h in enumerate(headers)}
        for k, v in raw_nf.items():
            if v is None:
                continue
            fmt_str = str(v).strip()
            if not fmt_str:
                continue
            if isinstance(k, int) and 0 <= k < max_cols:
                col_fmt_spec[k] = fmt_str
            else:
                ks = str(k).strip()
                if ks.isdigit() and 0 <= int(ks) < max_cols:
                    col_fmt_spec[int(ks)] = fmt_str
                elif ks.lower() in header_low_map:
                    col_fmt_spec[header_low_map[ks.lower()]] = fmt_str

        # Resolver alineaciones explícitas por columna
        raw_aligns = raw_sheet.get("column_alignments") if isinstance(raw_sheet.get("column_alignments"), list) else []
        explicit_col_align: List[Optional[str]] = []
        for ci in range(max_cols):
            if ci < len(raw_aligns) and str(raw_aligns[ci] or "").strip().lower() in ("left", "center", "right"):
                explicit_col_align.append(str(raw_aligns[ci]).strip().lower())
            else:
                explicit_col_align.append(None)

        # Preparar filas tipadas y detectar columnas numéricas / formatos inferidos
        parsed_body_rows: List[List[Tuple[str, Any, Optional[str]]]] = []
        col_numeric_hits = [0] * max_cols
        col_inferred_fmt: List[Optional[str]] = [None] * max_cols

        for r in norm_rows:
            padded = (r + [None] * max_cols)[:max_cols]
            typed_row: List[Tuple[str, Any, Optional[str]]] = []
            for ci, cell_val in enumerate(padded):
                if cell_val is None or cell_val == "":
                    typed_row.append(("empty", None, None))
                elif isinstance(cell_val, bool):
                    typed_row.append(("bool", cell_val, None))
                elif isinstance(cell_val, str) and cell_val.strip().startswith("="):
                    typed_row.append(("formula", cell_val.strip()[1:], None))
                    col_numeric_hits[ci] += 1
                else:
                    num_v, inf_fmt = _parse_numeric_cell(cell_val, col_fmt_spec[ci])
                    if num_v is not None:
                        typed_row.append(("number", num_v, inf_fmt))
                        col_numeric_hits[ci] += 1
                        if inf_fmt and not col_fmt_spec[ci] and not col_inferred_fmt[ci]:
                            col_inferred_fmt[ci] = inf_fmt
                    else:
                        typed_row.append(("string", str(cell_val), None))
            parsed_body_rows.append(typed_row)

        col_eff_fmt: List[Optional[str]] = [
            col_fmt_spec[ci] or col_inferred_fmt[ci] for ci in range(max_cols)
        ]
        col_num_fmt_ids: List[int] = [
            style_reg.register_num_fmt(col_eff_fmt[ci]) for ci in range(max_cols)
        ]
        col_is_numeric: List[bool] = [
            col_numeric_hits[ci] > 0 or (col_eff_fmt[ci] is not None and str(col_eff_fmt[ci]).lower() in ("currency", "percent", "integer", "decimal"))
            for ci in range(max_cols)
        ]

        # Banner de título y subtítulo opcionales
        title_banner = str(raw_sheet.get("title_banner") or "").strip()
        sheet_subtitle = str(raw_sheet.get("subtitle") or "").strip()
        merges: List[str] = []
        rows_xml: List[str] = []
        cell_values_cache: Dict[Tuple[int, int], float] = {}
        current_row_num = 1
        last_col_letter = _col_index_to_letters(max_cols - 1)

        if title_banner:
            ss_idx = sst.add(title_banner)
            cells_b = [f'<c r="A{current_row_num}" s="{xf_banner}" t="s"><v>{ss_idx}</v></c>']
            for ci in range(1, max_cols):
                cells_b.append(f'<c r="{_col_index_to_letters(ci)}{current_row_num}" s="{xf_banner}"/>')
            rows_xml.append(f'<row r="{current_row_num}" ht="28" customHeight="1">{"".join(cells_b)}</row>')
            if max_cols > 1:
                merges.append(f"A{current_row_num}:{last_col_letter}{current_row_num}")
            current_row_num += 1

        if sheet_subtitle:
            ss_idx = sst.add(sheet_subtitle)
            cells_s = [f'<c r="A{current_row_num}" s="{xf_subtitle}" t="s"><v>{ss_idx}</v></c>']
            for ci in range(1, max_cols):
                cells_s.append(f'<c r="{_col_index_to_letters(ci)}{current_row_num}" s="{xf_subtitle}"/>')
            rows_xml.append(f'<row r="{current_row_num}" ht="20" customHeight="1">{"".join(cells_s)}</row>')
            if max_cols > 1:
                merges.append(f"A{current_row_num}:{last_col_letter}{current_row_num}")
            current_row_num += 1

        # Fila de encabezados
        header_row_num = current_row_num
        header_cells_xml: List[str] = []
        for ci, h_txt in enumerate(headers):
            h_align = explicit_col_align[ci] or ("right" if col_is_numeric[ci] else "left")
            xf_h = style_reg.register_xf(
                font_id=f_header,
                fill_id=fill_header,
                border_id=bdr_header,
                num_fmt_id=0,
                h_align=h_align,
                v_align="center",
                wrap_text=True,
            )
            ss_idx = sst.add(h_txt)
            header_cells_xml.append(f'<c r="{_col_index_to_letters(ci)}{header_row_num}" s="{xf_h}" t="s"><v>{ss_idx}</v></c>')
        rows_xml.append(f'<row r="{header_row_num}" ht="24" customHeight="1">{"".join(header_cells_xml)}</row>')
        current_row_num += 1

        # Filas de datos
        data_start_row = current_row_num
        max_col_char_lens: List[int] = [len(h) + 2 for h in headers]

        for r_idx, typed_row in enumerate(parsed_body_rows):
            is_zebra = (r_idx % 2 == 1)
            row_fill = fill_alt if is_zebra else 0
            row_cells_xml: List[str] = []
            max_lines_in_row = 1

            for ci, (kind, val, cell_inf_fmt) in enumerate(typed_row):
                col_let = _col_index_to_letters(ci)
                ref = f"{col_let}{current_row_num}"
                eff_nf = style_reg.register_num_fmt(cell_inf_fmt) if (cell_inf_fmt and col_num_fmt_ids[ci] == 0) else col_num_fmt_ids[ci]

                if kind in ("number", "formula"):
                    h_align = explicit_col_align[ci] or "right"
                    xf_c = style_reg.register_xf(
                        font_id=f_body,
                        fill_id=row_fill,
                        border_id=bdr_body,
                        num_fmt_id=eff_nf,
                        h_align=h_align,
                        v_align="center",
                        wrap_text=False,
                    )
                    if kind == "number":
                        cell_values_cache[(ci, current_row_num)] = float(val)
                        num_str = _format_num_for_xml(float(val))
                        row_cells_xml.append(f'<c r="{ref}" s="{xf_c}"><v>{num_str}</v></c>')
                        max_col_char_lens[ci] = max(max_col_char_lens[ci], len(num_str) + 4)
                    else:
                        f_body_str = str(val).strip()
                        cached = _eval_cached_formula(f_body_str, cell_values_cache)
                        if cached is not None:
                            cell_values_cache[(ci, current_row_num)] = cached
                            c_str = _format_num_for_xml(cached)
                            row_cells_xml.append(f'<c r="{ref}" s="{xf_c}"><f>{_xml_esc(f_body_str)}</f><v>{c_str}</v></c>')
                            max_col_char_lens[ci] = max(max_col_char_lens[ci], len(c_str) + 4)
                        else:
                            row_cells_xml.append(f'<c r="{ref}" s="{xf_c}"><f>{_xml_esc(f_body_str)}</f></c>')
                elif kind == "bool":
                    h_align = explicit_col_align[ci] or "center"
                    xf_c = style_reg.register_xf(
                        font_id=f_body,
                        fill_id=row_fill,
                        border_id=bdr_body,
                        num_fmt_id=0,
                        h_align=h_align,
                        v_align="center",
                        wrap_text=False,
                    )
                    row_cells_xml.append(f'<c r="{ref}" s="{xf_c}" t="b"><v>{"1" if val else "0"}</v></c>')
                elif kind == "string":
                    txt = str(val)
                    h_align = explicit_col_align[ci] or "left"
                    needs_wrap = ("\n" in txt) or (len(txt) > 36)
                    if "\n" in txt:
                        max_lines_in_row = max(max_lines_in_row, txt.count("\n") + 1)
                    xf_c = style_reg.register_xf(
                        font_id=f_body,
                        fill_id=row_fill,
                        border_id=bdr_body,
                        num_fmt_id=eff_nf if str(col_eff_fmt[ci] or "").lower() == "date" else 0,
                        h_align=h_align,
                        v_align="center",
                        wrap_text=needs_wrap,
                    )
                    ss_idx = sst.add(txt)
                    row_cells_xml.append(f'<c r="{ref}" s="{xf_c}" t="s"><v>{ss_idx}</v></c>')
                    longest_line = max((len(ln) for ln in txt.split("\n")), default=0)
                    max_col_char_lens[ci] = max(max_col_char_lens[ci], min(44, longest_line))
                else:
                    xf_c = style_reg.register_xf(
                        font_id=f_body,
                        fill_id=row_fill,
                        border_id=bdr_body,
                        num_fmt_id=0,
                        h_align=explicit_col_align[ci] or "left",
                        v_align="center",
                        wrap_text=False,
                    )
                    row_cells_xml.append(f'<c r="{ref}" s="{xf_c}"/>')

            row_ht = max(20, min(80, 18 * max_lines_in_row + 2))
            rows_xml.append(f'<row r="{current_row_num}" ht="{row_ht}" customHeight="1">{"".join(row_cells_xml)}</row>')
            current_row_num += 1

        data_end_row = max(header_row_num, current_row_num - 1)

        # Fila de totales opcional (`totals_row=True` o lista explícita)
        if totals_spec is True and len(parsed_body_rows) > 0:
            tot_cells: List[str] = []
            for ci in range(max_cols):
                col_let = _col_index_to_letters(ci)
                ref = f"{col_let}{current_row_num}"
                if ci == 0:
                    xf_t = style_reg.register_xf(
                        font_id=f_total, fill_id=fill_total, border_id=bdr_total,
                        num_fmt_id=0, h_align="left", v_align="center", wrap_text=False,
                    )
                    ss_idx = sst.add("Total")
                    tot_cells.append(f'<c r="{ref}" s="{xf_t}" t="s"><v>{ss_idx}</v></c>')
                elif col_numeric_hits[ci] > 0:
                    xf_t = style_reg.register_xf(
                        font_id=f_total, fill_id=fill_total, border_id=bdr_total,
                        num_fmt_id=col_num_fmt_ids[ci], h_align=explicit_col_align[ci] or "right",
                        v_align="center", wrap_text=False,
                    )
                    f_expr = f"SUM({col_let}{data_start_row}:{col_let}{data_end_row})"
                    cached = _eval_cached_formula(f_expr, cell_values_cache)
                    if cached is not None:
                        c_str = _format_num_for_xml(cached)
                        tot_cells.append(f'<c r="{ref}" s="{xf_t}"><f>{f_expr}</f><v>{c_str}</v></c>')
                        max_col_char_lens[ci] = max(max_col_char_lens[ci], len(c_str) + 4)
                    else:
                        tot_cells.append(f'<c r="{ref}" s="{xf_t}"><f>{f_expr}</f></c>')
                else:
                    xf_t = style_reg.register_xf(
                        font_id=f_total, fill_id=fill_total, border_id=bdr_total,
                        num_fmt_id=0, h_align="left", v_align="center", wrap_text=False,
                    )
                    tot_cells.append(f'<c r="{ref}" s="{xf_t}"/>')
            rows_xml.append(f'<row r="{current_row_num}" ht="22" customHeight="1">{"".join(tot_cells)}</row>')
            current_row_num += 1
        elif isinstance(totals_spec, list) and totals_spec:
            padded_tot = (list(totals_spec) + [None] * max_cols)[:max_cols]
            tot_cells = []
            for ci, tv in enumerate(padded_tot):
                col_let = _col_index_to_letters(ci)
                ref = f"{col_let}{current_row_num}"
                if isinstance(tv, str) and tv.strip().startswith("="):
                    f_expr = tv.strip()[1:]
                    xf_t = style_reg.register_xf(
                        font_id=f_total, fill_id=fill_total, border_id=bdr_total,
                        num_fmt_id=col_num_fmt_ids[ci], h_align=explicit_col_align[ci] or "right",
                        v_align="center", wrap_text=False,
                    )
                    cached = _eval_cached_formula(f_expr, cell_values_cache)
                    if cached is not None:
                        c_str = _format_num_for_xml(cached)
                        tot_cells.append(f'<c r="{ref}" s="{xf_t}"><f>{_xml_esc(f_expr)}</f><v>{c_str}</v></c>')
                    else:
                        tot_cells.append(f'<c r="{ref}" s="{xf_t}"><f>{_xml_esc(f_expr)}</f></c>')
                else:
                    num_v, inf_fmt = _parse_numeric_cell(tv, col_eff_fmt[ci])
                    if num_v is not None:
                        eff_nf = style_reg.register_num_fmt(inf_fmt) if (inf_fmt and col_num_fmt_ids[ci] == 0) else col_num_fmt_ids[ci]
                        xf_t = style_reg.register_xf(
                            font_id=f_total, fill_id=fill_total, border_id=bdr_total,
                            num_fmt_id=eff_nf, h_align=explicit_col_align[ci] or "right",
                            v_align="center", wrap_text=False,
                        )
                        tot_cells.append(f'<c r="{ref}" s="{xf_t}"><v>{_format_num_for_xml(num_v)}</v></c>')
                    elif tv is not None and str(tv).strip():
                        xf_t = style_reg.register_xf(
                            font_id=f_total, fill_id=fill_total, border_id=bdr_total,
                            num_fmt_id=0, h_align=explicit_col_align[ci] or "left",
                            v_align="center", wrap_text=False,
                        )
                        ss_idx = sst.add(str(tv))
                        tot_cells.append(f'<c r="{ref}" s="{xf_t}" t="s"><v>{ss_idx}</v></c>')
                    else:
                        xf_t = style_reg.register_xf(
                            font_id=f_total, fill_id=fill_total, border_id=bdr_total,
                            num_fmt_id=0, h_align="left", v_align="center", wrap_text=False,
                        )
                        tot_cells.append(f'<c r="{ref}" s="{xf_t}"/>')
            rows_xml.append(f'<row r="{current_row_num}" ht="22" customHeight="1">{"".join(tot_cells)}</row>')
            current_row_num += 1

        last_row_num = max(1, current_row_num - 1)

        # Anchos de columna (`sheet.col_widths` -> `sheets_blueprint` -> auto-fit)
        explicit_widths = raw_sheet.get("col_widths") if isinstance(raw_sheet.get("col_widths"), list) else None
        bp_widths: Optional[List[float]] = None
        if not explicit_widths and blueprint_sheets:
            for bp in blueprint_sheets:
                if isinstance(bp, dict) and str(bp.get("name") or "").strip().lower() == s_name.lower():
                    if isinstance(bp.get("col_widths"), list):
                        bp_widths = bp["col_widths"]
                        break
            if bp_widths is None and sh_idx < len(blueprint_sheets) and isinstance(blueprint_sheets[sh_idx], dict):
                if isinstance(blueprint_sheets[sh_idx].get("col_widths"), list):
                    bp_widths = blueprint_sheets[sh_idx]["col_widths"]

        cols_xml_parts: List[str] = []
        for ci in range(max_cols):
            w_val: Optional[float] = None
            if explicit_widths and ci < len(explicit_widths):
                w_val = _clamp_float(explicit_widths[ci], default_col_width, 6.0, 80.0)
            elif bp_widths and ci < len(bp_widths):
                w_val = _clamp_float(bp_widths[ci], default_col_width, 6.0, 80.0)
            else:
                auto_w = max(10.0, min(48.0, float(max_col_char_lens[ci]) * 1.15 + 3.5))
                w_val = round(max(auto_w, min(default_col_width, 12.0)), 1)
            cols_xml_parts.append(f'<col min="{ci + 1}" max="{ci + 1}" width="{w_val}" customWidth="1"/>')

        freeze_hdr = _coerce_bool(raw_sheet.get("freeze_header"), default_freeze)
        auto_flt = _coerce_bool(raw_sheet.get("auto_filter"), default_filter)

        tab_sel = ' tabSelected="1"' if sh_idx == 0 else ""
        grid_attr = ' showGridLines="1"' if show_gridlines else ' showGridLines="0"'
        if freeze_hdr and header_row_num >= 1:
            pane_xml = (
                f'<pane ySplit="{header_row_num}" topLeftCell="A{header_row_num + 1}" '
                'activePane="bottomLeft" state="frozen"/>'
                f'<selection pane="bottomLeft" activeCell="A{header_row_num + 1}" sqref="A{header_row_num + 1}"/>'
            )
        else:
            pane_xml = ""

        sheet_views_xml = (
            f'<sheetViews><sheetView{tab_sel}{grid_attr} workbookViewId="0">{pane_xml}</sheetView></sheetViews>'
        )
        auto_filter_xml = (
            f'<autoFilter ref="A{header_row_num}:{last_col_letter}{data_end_row}"/>'
            if (auto_flt and max_cols >= 1)
            else ""
        )
        merge_cells_xml = (
            f'<mergeCells count="{len(merges)}">'
            + "".join(f'<mergeCell ref="{m}"/>' for m in merges)
            + "</mergeCells>"
            if merges
            else ""
        )

        # Orden estricto ECMA-376 para CT_Worksheet
        ws_xml = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            f'<worksheet xmlns="{_SML_NS}">'
            f'<dimension ref="A1:{last_col_letter}{last_row_num}"/>'
            f"{sheet_views_xml}"
            '<sheetFormatPr defaultRowHeight="20"/>'
            f'<cols>{"".join(cols_xml_parts)}</cols>'
            f'<sheetData>{"".join(rows_xml)}</sheetData>'
            f"{auto_filter_xml}"
            f"{merge_cells_xml}"
            f'<pageMargins left="{pm_left}" right="{pm_right}" top="{pm_top}" bottom="{pm_bottom}" header="0.3" footer="0.3"/>'
            f'<pageSetup paperSize="{paper_size}" orientation="{print_orient}"/>'
            "</worksheet>\n"
        )
        worksheet_xmls.append((s_name, ws_xml))

    # Construir partes del paquete `.xlsx`
    ct_overrides = [
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
        '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>',
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
    ]
    wb_sheets_xml: List[str] = []
    wb_rels_xml_parts: List[str] = []

    for idx, (s_name, _ws_xml) in enumerate(worksheet_xmls, start=1):
        rid = f"rId{idx}"
        ct_overrides.append(
            f'<Override PartName="/xl/worksheets/sheet{idx}.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        )
        wb_sheets_xml.append(f'<sheet name={_xml_attr(s_name)} sheetId="{idx}" r:id="{rid}"/>')
        wb_rels_xml_parts.append(
            f'<Relationship Id="{rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{idx}.xml"/>'
        )

    styles_rid = f"rId{len(worksheet_xmls) + 1}"
    strings_rid = f"rId{len(worksheet_xmls) + 2}"
    wb_rels_xml_parts.append(
        f'<Relationship Id="{styles_rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    )
    wb_rels_xml_parts.append(
        f'<Relationship Id="{strings_rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>'
    )

    content_types_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        f'<Types xmlns="{_CT_NS}">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        f"{''.join(ct_overrides)}"
        "</Types>\n"
    )
    root_rels_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        f'<Relationships xmlns="{_PKG_REL_NS}">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>'
        "</Relationships>\n"
    )
    wb_rels_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        f'<Relationships xmlns="{_PKG_REL_NS}">{"".join(wb_rels_xml_parts)}</Relationships>\n'
    )
    workbook_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        f'<workbook xmlns="{_SML_NS}" xmlns:r="{_R_NS}">'
        f"<sheets>{''.join(wb_sheets_xml)}</sheets>"
        '<calcPr calcId="191029" fullCalcOnLoad="1"/>'
        "</workbook>\n"
    )

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types_xml)
        zf.writestr("_rels/.rels", root_rels_xml)
        zf.writestr("docProps/core.xml", _build_core_props_xml(title, author, subtitle))
        zf.writestr("docProps/app.xml", _build_app_props_xml("XOOK Office Generator"))
        zf.writestr("xl/_rels/workbook.xml.rels", wb_rels_xml)
        zf.writestr("xl/workbook.xml", workbook_xml)
        zf.writestr("xl/styles.xml", style_reg.to_xml())
        zf.writestr("xl/sharedStrings.xml", sst.to_xml())
        for idx, (_s_name, ws_xml) in enumerate(worksheet_xmls, start=1):
            zf.writestr(f"xl/worksheets/sheet{idx}.xml", ws_xml)

    _atomic_write_bytes(out_abs, buf.getvalue())
    size_bytes = out_abs.stat().st_size

    persisted_ds = _json_safe_copy(design_spec)
    if resolved_skill_dir:
        persisted_ds["_skill_dir"] = resolved_skill_dir
    if resolved_assets:
        persisted_ds["_resolved_assets"] = _json_safe_copy(resolved_assets)
    if effective_design_skill:
        persisted_ds["_skill_slug"] = effective_design_skill

    _save_office_spec_metadata(
        workspace_root,
        out_rel,
        {
            "format": "xlsx",
            "title": title,
            "subtitle": subtitle,
            "author": author,
            "date": date_label,
            "sheets": sheets,
            "design_skill": effective_design_skill,
            "design_spec": persisted_ds,
            "design_overrides": _json_safe_copy(raw_design_overrides) if raw_design_overrides else None,
        },
    )

    result: Dict[str, Any] = {
        "ok": True,
        "format": "xlsx",
        "path": out_rel,
        "filename": out_abs.name,
        "size_bytes": size_bytes,
        "sheets_count": len(worksheet_xmls),
        "total_rows": total_data_rows,
        "page_count": max(1, len(worksheet_xmls)),
        "design_skill": effective_design_skill,
        "design_spec": _strip_private_keys(design_spec),
        "title": title,
        "revision": int(out_abs.stat().st_mtime * 1000),
    }
    if warnings:
        result["warnings"] = warnings
    return result


# ===========================================================================
# DISPATCHER UNIFICADO
# ===========================================================================


def _infer_office_format(spec: Dict[str, Any]) -> str:
    raw_fmt = str(spec.get("format") or "").strip().lower().lstrip(".")
    if raw_fmt in ("docx", "word", "doc"):
        return "docx"
    if raw_fmt in ("xlsx", "excel", "spreadsheet", "xls"):
        return "xlsx"
    if raw_fmt:
        raise ValueError(f"Formato Office no soportado para generación nativa: '{raw_fmt}'. Usa 'docx' o 'xlsx'.")

    for path_key in ("output_path", "source_path"):
        p_val = str(spec.get(path_key) or "").strip().lower()
        if p_val.endswith(".xlsx"):
            return "xlsx"
        if p_val.endswith(".docx"):
            return "docx"

    if spec.get("sheets") or (spec.get("headers") is not None and spec.get("rows") is not None):
        return "xlsx"
    return "docx"


def generate_office_document(spec: Dict[str, Any], **kwargs: Any) -> Dict[str, Any]:
    """
    Punto de entrada unificado para generar o modificar documentos nativos Word (`.docx`)
    y Excel (`.xlsx`) respetando `design_skill`, `design_spec` y `design_overrides`.
    """
    if not isinstance(spec, dict):
        raise ValueError("`spec` debe ser un diccionario válido.")
    fmt = _infer_office_format(spec)
    if fmt == "xlsx":
        return generate_xlsx_document(spec, **kwargs)
    return generate_docx_document(spec, **kwargs)
