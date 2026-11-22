"""
Edición interactiva de documentos PDF para XOOK:
- Persistencia y reconstrucción inteligente de la especificación editable (`blocks`, `markdown`, `cover`, metadata)
  para cualquier PDF generado por el agente o abierto desde el workspace.
- Conservación íntegra de la portada original (Página 1) al recompilar el cuerpo del documento.
- Parches visuales directos sobre páginas (`page_patches`) para corregir o agregar textos/recuadros
  en cualquier coordenada de una página existente (incluyendo carátulas e imágenes).
"""

from __future__ import annotations

import hashlib
import io
import json
import re
import shutil
import subprocess
import tempfile
import time
import unicodedata
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

import pdfplumber
import pypdfium2 as pdfium
from pypdf import PdfReader, PdfWriter
from reportlab.lib import colors
from reportlab.lib.utils import simpleSplit
from reportlab.pdfgen import canvas as rl_canvas

from slices.pdf_engine.generator import (
    THEMES,
    _FONT_FAMILY,
    _ensure_fonts,
    _json_safe_copy,
    _normalize_blocks_input,
    _parse_markdown_to_blocks,
    _resolve_inspector_funcs,
    _sanitize_text_for_pdf,
    generate_pdf_document,
)
from slices.pdf_engine.ocr import is_local_ocr_available
from slices.pdf_engine.preview import render_pdf_preview
from slices.pdf_engine.reader import inspect_pdf_summary, read_pdf_document


def _spec_dir(workspace_root: Path) -> Path:
    d = workspace_root / ".xook" / "pdf_specs"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _spec_key(rel_path: str) -> str:
    norm = rel_path.strip().replace("\\", "/").lstrip("./").lower()
    return hashlib.sha1(norm.encode("utf-8")).hexdigest()[:16]


def get_spec_paths(workspace_root: Path, rel_path: str) -> Dict[str, Path]:
    base = _spec_dir(workspace_root)
    key = _spec_key(rel_path)
    return {
        "json": base / f"{key}.json",
        "cover_pdf": base / f"{key}.cover.pdf",
        "base_pdf": base / f"{key}.base.pdf",
    }


def blocks_to_markdown(blocks: List[Dict[str, Any]]) -> str:
    """Convierte una lista de bloques normalizados de XOOK a Markdown limpio y editable."""
    lines: List[str] = []
    for blk in blocks:
        if not isinstance(blk, dict):
            continue
        btype = str(blk.get("type") or "").strip().lower()
        if btype == "heading":
            lvl = max(1, min(3, int(blk.get("level") or 1)))
            txt = str(blk.get("text") or blk.get("title") or "").strip()
            if txt:
                lines.append(f"{'#' * lvl} {txt}")
                lines.append("")
        elif btype == "paragraph":
            txt = str(blk.get("text") or blk.get("content") or "").strip()
            if txt:
                lines.append(txt)
                lines.append("")
        elif btype in ("bullets", "bullet_list", "unordered_list", "ul", "list"):
            items = blk.get("items") or []
            for item in items:
                s = str(item).strip()
                if s:
                    lines.append(f"- {s}")
            if items:
                lines.append("")
        elif btype in ("numbered_list", "ordered_list", "ol"):
            items = blk.get("items") or []
            for idx, item in enumerate(items, start=1):
                s = str(item).strip()
                if s:
                    lines.append(f"{idx}. {s}")
            if items:
                lines.append("")
        elif btype in ("callout", "summary", "quote"):
            title = str(blk.get("title") or "").strip()
            txt = str(blk.get("text") or blk.get("content") or "").strip()
            if title and txt:
                lines.append(f"> **{title}**: {txt}")
            elif title:
                lines.append(f"> **{title}**")
            elif txt:
                lines.append(f"> {txt}")
            lines.append("")
        elif btype in ("code", "code_block", "pre"):
            lang = str(blk.get("language") or blk.get("lang") or "").strip()
            code = str(blk.get("code") or blk.get("text") or blk.get("content") or "").rstrip()
            lines.append(f"```{lang}")
            lines.append(code)
            lines.append("```")
            lines.append("")
        elif btype == "table":
            headers = [str(h).strip() for h in (blk.get("headers") or blk.get("columns") or [])]
            rows = blk.get("rows") or []
            if headers:
                lines.append("| " + " | ".join(headers) + " |")
                lines.append("| " + " | ".join(["---"] * len(headers)) + " |")
                for r in rows:
                    if isinstance(r, list):
                        cells = [str(r[i] if i < len(r) else "").strip() for i in range(len(headers))]
                        lines.append("| " + " | ".join(cells) + " |")
                lines.append("")
        elif btype in ("kv_grid", "header_band"):
            kv_title = str(blk.get("title") or "").strip()
            if kv_title:
                lines.append(f"### {kv_title}")
            raw_items = blk.get("items") or []
            if isinstance(raw_items, dict):
                raw_items = [{"label": k, "value": v} for k, v in raw_items.items()]
            for item in raw_items if isinstance(raw_items, list) else []:
                if isinstance(item, dict):
                    lbl = str(item.get("label") or item.get("key") or "").strip()
                    val = str(item.get("value") or "").strip()
                    if lbl or val:
                        lines.append(f"- **{lbl}**: {val}" if lbl else f"- {val}")
            if kv_title or raw_items:
                lines.append("")
        elif btype == "columns":
            raw_cols = blk.get("columns") or blk.get("cols") or []
            for col_items in raw_cols if isinstance(raw_cols, list) else []:
                if isinstance(col_items, list) and col_items:
                    col_md = blocks_to_markdown(col_items)
                    if col_md:
                        lines.append(col_md)
                        lines.append("")
        elif btype in ("signature_block", "signatures"):
            signers = blk.get("signers") or blk.get("items") or []
            added_sig = False
            for s in signers if isinstance(signers, list) else []:
                if not isinstance(s, dict):
                    continue
                name = str(s.get("name") or "").strip()
                role = str(s.get("role") or s.get("title") or "").strip()
                date_v = str(s.get("date") or "").strip()
                parts = [p for p in [name, f"({role})" if role else "", date_v] if p]
                if parts:
                    lines.append(f"- **Firma**: {' — '.join(parts)}")
                    added_sig = True
            if added_sig:
                lines.append("")
        elif btype in ("box", "panel", "card"):
            b_title = str(blk.get("title") or "").strip()
            b_txt = str(blk.get("text") or blk.get("content") or "").strip()
            if b_title:
                lines.append(f"> **{b_title}**")
            if b_txt:
                lines.append(f"> {b_txt}")
            inner = blk.get("blocks")
            if isinstance(inner, list) and inner:
                inner_md = blocks_to_markdown(inner)
                for ln in inner_md.splitlines():
                    lines.append(f"> {ln}" if ln.strip() else ">")
            if b_title or b_txt or (isinstance(inner, list) and inner):
                lines.append("")
        elif btype == "divider":
            lines.append("---")
            lines.append("")
    return "\n".join(lines).strip()


def save_pdf_spec_metadata(
    workspace_root: Path,
    rel_path: str,
    spec_data: Dict[str, Any],
    pdf_abs: Optional[Path] = None,
    *,
    overwrite_base: bool = False,
    overwrite_cover: bool = False,
) -> None:
    """Guarda la especificación editable asociada a un PDF del workspace."""
    try:
        paths = get_spec_paths(workspace_root, rel_path)
        existing: Dict[str, Any] = {}
        if paths["json"].is_file():
            try:
                existing = json.loads(paths["json"].read_text(encoding="utf-8"))
            except Exception:
                existing = {}

        blocks = spec_data.get("blocks")
        if not isinstance(blocks, list):
            blocks, _ = _normalize_blocks_input(spec_data)

        raw_design_spec = (
            spec_data.get("design_spec")
            if "design_spec" in spec_data
            else existing.get("design_spec")
        )
        raw_design_overrides = (
            spec_data.get("design_overrides")
            if "design_overrides" in spec_data
            else existing.get("design_overrides")
        )
        raw_design_skill = (
            spec_data.get("design_skill")
            if "design_skill" in spec_data
            else existing.get("design_skill")
        )
        pdf_stat = pdf_abs.stat() if (pdf_abs and pdf_abs.is_file()) else None
        payload: Dict[str, Any] = {
            "path": rel_path,
            "title": str(spec_data.get("title") or existing.get("title") or "Documento").strip(),
            "subtitle": str(spec_data.get("subtitle") if "subtitle" in spec_data else (existing.get("subtitle") or "")).strip(),
            "author": str(spec_data.get("author") if "author" in spec_data else (existing.get("author") or "")).strip(),
            "date": str(spec_data.get("date") if "date" in spec_data else (existing.get("date") or "")).strip(),
            "theme": str(spec_data.get("theme") or existing.get("theme") or "executive").strip().lower(),
            "has_cover": bool(spec_data.get("has_cover") if "has_cover" in spec_data else existing.get("has_cover", False)),
            "preserve_first_page": bool(
                spec_data.get("preserve_first_page")
                if "preserve_first_page" in spec_data
                else existing.get("preserve_first_page", False)
            ),
            "skip_inline_title": bool(
                spec_data.get("skip_inline_title")
                if "skip_inline_title" in spec_data
                else existing.get("skip_inline_title", False)
            ),
            "cover": spec_data.get("cover") if "cover" in spec_data else existing.get("cover"),
            "footer_text": spec_data.get("footer_text") if "footer_text" in spec_data else existing.get("footer_text"),
            "watermark": spec_data.get("watermark") if "watermark" in spec_data else existing.get("watermark"),
            "design_skill": str(raw_design_skill).strip() if raw_design_skill else None,
            "design_spec": _json_safe_copy(raw_design_spec) if isinstance(raw_design_spec, dict) else None,
            "design_overrides": _json_safe_copy(raw_design_overrides) if isinstance(raw_design_overrides, dict) else None,
            "blocks": blocks,
            "page_patches": (
                spec_data.get("page_patches")
                if isinstance(spec_data.get("page_patches"), list)
                else ([] if overwrite_base else (existing.get("page_patches") if isinstance(existing.get("page_patches"), list) else []))
            ),
            "revision": int(spec_data.get("revision") or int(time.time() * 1000)),
            "pdf_mtime": float(pdf_stat.st_mtime) if pdf_stat else existing.get("pdf_mtime"),
            "pdf_size": int(pdf_stat.st_size) if pdf_stat else existing.get("pdf_size"),
        }
        paths["json"].write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

        if pdf_abs and pdf_abs.is_file():
            try:
                if overwrite_base or not paths["base_pdf"].is_file():
                    shutil.copy2(pdf_abs, paths["base_pdf"])
                reader = PdfReader(str(pdf_abs))
                wants_cover = bool(payload["has_cover"] or payload["preserve_first_page"])
                if len(reader.pages) >= 1 and wants_cover:
                    if overwrite_cover or not paths["cover_pdf"].is_file():
                        writer = PdfWriter()
                        writer.add_page(reader.pages[0])
                        with open(paths["cover_pdf"], "wb") as f:
                            writer.write(f)
                elif overwrite_cover and not wants_cover and paths["cover_pdf"].is_file():
                    paths["cover_pdf"].unlink(missing_ok=True)
            except Exception:
                pass
    except Exception:
        pass


_HEADER_FOOTER_RE = re.compile(
    r"^(?:XOOK(?:\s*·.*)?|P[áa]gina\s+\d+\s+de\s+\d+|XOOK\s*·.*P[áa]gina\s+\d+\s+de\s+\d+|"
    r"\d{1,2}\s+de\s+[a-záéíóú]+\s+de\s+\d{4}(?:\s+(?:·\s+)?P[áa]gina\s+\d+\s+de\s+\d+)?)$",
    re.IGNORECASE,
)


def _extract_blocks_from_pdf_pages(
    pages_data: List[Dict[str, Any]],
    doc_title: str,
) -> List[Dict[str, Any]]:
    """Convierte el texto y tablas extraídos de páginas PDF en bloques estructurados editables."""
    blocks: List[Dict[str, Any]] = []
    title_clean = doc_title.strip().lower()

    for page_obj in pages_data:
        raw_text = str(page_obj.get("text") or "").strip()
        page_tables = page_obj.get("tables") or []

        if raw_text:
            lines = [ln.strip() for ln in raw_text.splitlines()]
            cleaned_lines: List[str] = []
            for idx, ln in enumerate(lines):
                if not ln:
                    cleaned_lines.append("")
                    continue
                if _HEADER_FOOTER_RE.match(ln):
                    continue
                # Omitir la línea de cabecera repetida si coincide con el título del documento
                if idx == 0 and title_clean and ln.lower().startswith(title_clean[:40]):
                    continue
                cleaned_lines.append(ln)

            para_buf: List[str] = []
            bullet_buf: List[str] = []
            num_buf: List[str] = []

            def _flush_all() -> None:
                if para_buf:
                    blocks.append({"type": "paragraph", "text": " ".join(para_buf).strip()})
                    para_buf.clear()
                if bullet_buf:
                    blocks.append({"type": "bullets", "items": list(bullet_buf)})
                    bullet_buf.clear()
                if num_buf:
                    blocks.append({"type": "numbered_list", "items": list(num_buf)})
                    num_buf.clear()

            for ln in cleaned_lines:
                if not ln:
                    _flush_all()
                    continue

                b_match = re.match(r"^(?:[•●▪▸\-\*])\s+(.+)$", ln)
                if b_match:
                    if para_buf or num_buf:
                        _flush_all()
                    bullet_buf.append(b_match.group(1).strip())
                    continue

                n_match = re.match(r"^(\d+)[\.\)]\s+(.+)$", ln)
                if n_match:
                    rest = n_match.group(2).strip()
                    # Si es corto y sin punto final y estamos fuera de una lista, puede ser un subtítulo numerado
                    if not num_buf and len(rest) <= 68 and not rest.endswith("."):
                        _flush_all()
                        blocks.append({"type": "heading", "level": 2, "text": f"{n_match.group(1)}. {rest}"})
                    else:
                        if para_buf or bullet_buf:
                            _flush_all()
                        num_buf.append(rest)
                    continue

                # Detectar encabezados de sección (cortos, sin punto final)
                is_short_heading = (
                    len(ln) <= 72
                    and not ln.endswith(".")
                    and not ln.endswith(",")
                    and not ln.endswith(";")
                    and (ln.isupper() or (ln[0].isupper() and len(ln.split()) <= 9))
                    and not para_buf
                )
                if is_short_heading:
                    _flush_all()
                    lvl = 1 if (ln.isupper() or len(ln) <= 38) else 2
                    blocks.append({"type": "heading", "level": lvl, "text": ln})
                    continue

                if bullet_buf or num_buf:
                    _flush_all()
                para_buf.append(ln)

            _flush_all()

        for tbl in page_tables:
            if not isinstance(tbl, dict):
                continue
            rows = tbl.get("rows") or []
            if isinstance(rows, list) and len(rows) >= 2:
                headers = [str(c or "").strip() for c in rows[0]]
                body_rows = [[str(c or "").strip() for c in r] for r in rows[1:] if isinstance(r, list)]
                if any(headers):
                    blocks.append({
                        "type": "table",
                        "headers": headers,
                        "rows": body_rows,
                    })

    return blocks


_SWIFT_VISION_BBOX_SCRIPT = r"""
import Foundation
import Vision
import AppKit

let args = Array(CommandLine.arguments.dropFirst())
var output: [String: [[String: Any]]] = [:]

for path in args {
    guard let img = NSImage(contentsOfFile: path),
          let cgImg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        output[path] = []
        continue
    }
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.usesLanguageCorrection = true
    req.recognitionLanguages = ["es-MX", "es-ES", "en-US"]
    let handler = VNImageRequestHandler(cgImage: cgImg, options: [:])
    var boxes: [[String: Any]] = []
    if (try? handler.perform([req])) != nil {
        for obs in (req.results ?? []) {
            guard let cand = obs.topCandidates(1).first else { continue }
            let bb = obs.boundingBox
            let xPct = bb.origin.x * 100.0
            let wPct = bb.size.width * 100.0
            let hPct = bb.size.height * 100.0
            let yPct = (1.0 - bb.origin.y - bb.size.height) * 100.0
            boxes.append([
                "text": cand.string,
                "x_pct": xPct,
                "y_pct": yPct,
                "w_pct": wPct,
                "h_pct": hPct
            ])
        }
    }
    output[path] = boxes
}

if let data = try? JSONSerialization.data(withJSONObject: output, options: []),
   let text = String(data: data, encoding: .utf8) {
    print(text)
} else {
    print("{}")
}
"""


def _sample_box_colors(
    pil_img: Any,
    x_pct: float,
    y_pct: float,
    w_pct: float,
    h_pct: float,
) -> Tuple[str, str]:
    """
    Muestrea el color de fondo real (blanco, gris claro, o cabecera oscura de tabla)
    y el color de texto de la región en la página renderizada.
    """
    try:
        iw, ih = pil_img.size
        x0 = max(0, min(iw - 1, int((x_pct / 100.0) * iw)))
        y0 = max(0, min(ih - 1, int((y_pct / 100.0) * ih)))
        x1 = max(x0 + 1, min(iw, int(((x_pct + w_pct) / 100.0) * iw)))
        y1 = max(y0 + 1, min(ih, int(((y_pct + h_pct) / 100.0) * ih)))
        crop = pil_img.crop((x0, y0, x1, y1)).convert("RGB")
        w_c, h_c = crop.size
        if w_c <= 0 or h_c <= 0:
            return "#FFFFFF", "#0F172A"

        border: List[Tuple[int, int, int]] = []
        for bx in range(w_c):
            border.append(crop.getpixel((bx, 0)))
            border.append(crop.getpixel((bx, h_c - 1)))
        for by in range(h_c):
            border.append(crop.getpixel((0, by)))
            border.append(crop.getpixel((w_c - 1, by)))

        border_sorted = sorted(border, key=lambda rgb: 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2])
        med_border = border_sorted[len(border_sorted) // 2]
        lum_border = 0.299 * med_border[0] + 0.587 * med_border[1] + 0.114 * med_border[2]

        if lum_border < 95:
            # Fondo oscuro (ej. cabecera de tabla #0F172A)
            bg_rgb = border_sorted[int(len(border_sorted) * 0.2)]
            bg_hex = f"#{bg_rgb[0]:02X}{bg_rgb[1]:02X}{bg_rgb[2]:02X}"
            return bg_hex, "#FFFFFF"

        bg_rgb = border_sorted[int(len(border_sorted) * 0.85)]
        # Si es casi blanco puro, normalizar a #FFFFFF
        if bg_rgb[0] >= 246 and bg_rgb[1] >= 246 and bg_rgb[2] >= 246:
            bg_hex = "#FFFFFF"
        else:
            bg_hex = f"#{bg_rgb[0]:02X}{bg_rgb[1]:02X}{bg_rgb[2]:02X}"
        return bg_hex, "#0F172A"
    except Exception:
        return "#FFFFFF", "#0F172A"


def _extract_ocr_boxes_for_image_page(
    pil_img: Any,
    page_num: int,
    page_height_pt: float,
) -> List[Dict[str, Any]]:
    """
    Extrae cajas de texto interactivas con Apple Vision cuando una página
    es una imagen rasterizada (por ejemplo una portada escaneada), excluyendo logos.
    """
    if not is_local_ocr_available():
        return []
    out: List[Dict[str, Any]] = []
    try:
        with tempfile.TemporaryDirectory(prefix="xook_bbox_") as tmp_dir:
            img_path = Path(tmp_dir) / f"p_{page_num}.png"
            pil_img.save(img_path, format="PNG")
            proc = subprocess.run(
                ["swift", "-", str(img_path)],
                input=_SWIFT_VISION_BBOX_SCRIPT,
                text=True,
                capture_output=True,
                timeout=15,
            )
            if proc.returncode != 0 or not proc.stdout.strip():
                return []
            parsed = json.loads(proc.stdout.strip())
            raw_boxes = list(parsed.values())[0] if isinstance(parsed, dict) and parsed else []
            seq = 0
            for b in raw_boxes:
                txt = str(b.get("text") or "").strip()
                if not txt:
                    continue
                x_pct = float(b.get("x_pct") or 0.0)
                y_pct = float(b.get("y_pct") or 0.0)
                w_pct = float(b.get("w_pct") or 10.0)
                h_pct = float(b.get("h_pct") or 3.0)

                # Excluir textos incrustados dentro de logotipos institucionales en la esquina superior
                if y_pct < 10.5 and x_pct > 54.0:
                    continue

                # Reparar recorte de inicial si una línea vertical decorativa tocó la primera letra
                if txt == "CTIVIDAD 3":
                    txt = "ACTIVIDAD 3"
                    x_pct = max(1.0, x_pct - 2.2)
                    w_pct = min(96.0 - x_pct, w_pct + 2.8)

                seq += 1
                pad_x = max(0.5, x_pct - 0.6)
                pad_y = max(0.5, y_pct - 0.35)
                pad_w = min(99.0 - pad_x, w_pct + 1.4)
                pad_h = min(99.0 - pad_y, h_pct + 0.7)

                bg_hex, fg_hex = _sample_box_colors(pil_img, pad_x, pad_y, pad_w, pad_h)
                est_font_pt = max(9.0, min(28.0, round((h_pct / 100.0) * page_height_pt * 0.72, 1)))
                is_bold = txt.isupper() or est_font_pt >= 15.0

                out.append({
                    "id": f"p{page_num}_ocr{seq}",
                    "page_number": page_num,
                    "x_pct": round(pad_x, 2),
                    "y_pct": round(pad_y, 2),
                    "w_pct": round(pad_w, 2),
                    "h_pct": round(pad_h, 2),
                    "orig_x_pct": round(pad_x, 2),
                    "orig_y_pct": round(pad_y, 2),
                    "orig_w_pct": round(pad_w, 2),
                    "orig_h_pct": round(pad_h, 2),
                    "text": txt,
                    "original_text": txt,
                    "font_size": est_font_pt,
                    "font_weight": "bold" if is_bold else "normal",
                    "text_color": fg_hex,
                    "bg_color": bg_hex,
                    "align": "left",
                    "deleted": False,
                    "is_new": False,
                })
    except Exception:
        return []
    return out


def _extract_interactive_text_items(pdf_abs: Path, max_pages: int = 25) -> List[Dict[str, Any]]:
    """
    Extrae todas las regiones de texto reales de cada página del PDF con sus coordenadas
    exactas en porcentaje (`x_pct`, `y_pct`, `w_pct`, `h_pct`), tamaño de fuente, peso y color
    de fondo muestreado, permitiendo editar o borrar cualquier texto directamente sobre la vista previa.
    """
    if not pdf_abs.is_file():
        return []

    items_out: List[Dict[str, Any]] = []
    pdfium_doc = None
    try:
        pdfium_doc = pdfium.PdfDocument(str(pdf_abs))
        with pdfplumber.open(str(pdf_abs)) as plumber_doc:
            total = min(len(plumber_doc.pages), max_pages)
            for p_idx in range(total):
                page_num = p_idx + 1
                p_page = plumber_doc.pages[p_idx]
                pw = float(p_page.width or 595.0)
                ph = float(p_page.height or 842.0)

                pil_img = None
                try:
                    p_bitmap = pdfium_doc[p_idx].render(scale=1.25)
                    pil_img = p_bitmap.to_pil()
                except Exception:
                    pil_img = None

                words = []
                try:
                    words = p_page.extract_words(
                        x_tolerance=2,
                        y_tolerance=3,
                        extra_attrs=["fontname", "size"],
                    ) or []
                except Exception:
                    words = []

                if not words:
                    if pil_img is not None:
                        items_out.extend(_extract_ocr_boxes_for_image_page(pil_img, page_num, ph))
                    continue

                words_sorted = sorted(words, key=lambda w: (round(float(w.get("top", 0.0)), 1), float(w.get("x0", 0.0))))

                # 1) Agrupar palabras en segmentos de línea (separando columnas de tablas y cabeceras)
                segments: List[Dict[str, Any]] = []
                cur_seg: List[Dict[str, Any]] = []

                def _flush_seg(seg_words: List[Dict[str, Any]]) -> None:
                    if not seg_words:
                        return
                    x0 = min(float(w["x0"]) for w in seg_words)
                    top = min(float(w["top"]) for w in seg_words)
                    x1 = max(float(w["x1"]) for w in seg_words)
                    bottom = max(float(w["bottom"]) for w in seg_words)
                    avg_size = sum(float(w.get("size") or 10.0) for w in seg_words) / len(seg_words)
                    is_bold = any(
                        "bold" in str(w.get("fontname") or "").lower()
                        for w in seg_words
                    )
                    txt = " ".join(str(w.get("text") or "").strip() for w in seg_words).strip()
                    if txt:
                        segments.append({
                            "x0": x0,
                            "top": top,
                            "x1": x1,
                            "bottom": bottom,
                            "w": x1 - x0,
                            "h": bottom - top,
                            "size": avg_size,
                            "bold": is_bold,
                            "text": txt,
                        })

                for w in words_sorted:
                    if not cur_seg:
                        cur_seg = [w]
                        continue
                    prev_w = cur_seg[-1]
                    prev_size = float(prev_w.get("size") or 10.0)
                    same_line = abs(float(w["top"]) - float(prev_w["top"])) <= max(3.5, prev_size * 0.42)
                    horiz_gap = float(w["x0"]) - float(prev_w["x1"])
                    max_word_gap = max(prev_size * 1.35, 11.5)
                    if same_line and horiz_gap <= max_word_gap:
                        cur_seg.append(w)
                    else:
                        _flush_seg(cur_seg)
                        cur_seg = [w]
                _flush_seg(cur_seg)

                # 2) Unir líneas consecutivas que forman un mismo párrafo de cuerpo
                merged_blocks: List[Dict[str, Any]] = []
                for seg in segments:
                    if not merged_blocks:
                        merged_blocks.append(dict(seg))
                        continue
                    prev = merged_blocks[-1]
                    v_gap = seg["top"] - prev["bottom"]
                    same_size = abs(seg["size"] - prev["size"]) <= 1.2
                    same_bold = seg["bold"] == prev["bold"]
                    same_left = abs(seg["x0"] - prev["x0"]) <= 8.5
                    starts_list = bool(re.match(r"^(?:[•●▪▸\-\*]|\d+[\.\)])\s+", seg["text"]))
                    is_body_width = prev["w"] >= pw * 0.40

                    if (
                        same_size
                        and same_bold
                        and same_left
                        and not starts_list
                        and is_body_width
                        and -2.0 <= v_gap <= prev["size"] * 0.92
                    ):
                        prev["x0"] = min(prev["x0"], seg["x0"])
                        prev["x1"] = max(prev["x1"], seg["x1"])
                        prev["bottom"] = max(prev["bottom"], seg["bottom"])
                        prev["w"] = prev["x1"] - prev["x0"]
                        prev["h"] = prev["bottom"] - prev["top"]
                        prev["text"] = prev["text"] + "\n" + seg["text"]
                    else:
                        merged_blocks.append(dict(seg))

                for b_idx, blk in enumerate(merged_blocks, start=1):
                    x_pct = max(0.2, min(98.5, (blk["x0"] / pw) * 100.0))
                    y_pct = max(0.2, min(98.5, (blk["top"] / ph) * 100.0))
                    w_pct = max(2.2, min(99.5 - x_pct, (blk["w"] / pw) * 100.0))
                    h_pct = max(1.6, min(99.5 - y_pct, (blk["h"] / ph) * 100.0))

                    bg_hex, fg_hex = (
                        _sample_box_colors(pil_img, x_pct, y_pct, w_pct, h_pct)
                        if pil_img is not None
                        else ("#FFFFFF", "#0F172A")
                    )

                    items_out.append({
                        "id": f"p{page_num}_t{b_idx}",
                        "page_number": page_num,
                        "x_pct": round(x_pct, 2),
                        "y_pct": round(y_pct, 2),
                        "w_pct": round(w_pct, 2),
                        "h_pct": round(h_pct, 2),
                        "orig_x_pct": round(x_pct, 2),
                        "orig_y_pct": round(y_pct, 2),
                        "orig_w_pct": round(w_pct, 2),
                        "orig_h_pct": round(h_pct, 2),
                        "text": blk["text"],
                        "original_text": blk["text"],
                        "font_size": round(float(blk["size"]), 1),
                        "font_weight": "bold" if blk["bold"] else "normal",
                        "text_color": fg_hex,
                        "bg_color": bg_hex,
                        "align": "left",
                        "deleted": False,
                        "is_new": False,
                    })
    except Exception:
        pass
    finally:
        if pdfium_doc is not None:
            try:
                pdfium_doc.close()
            except Exception:
                pass

    return items_out


def _merge_interactive_patches(
    base_items: List[Dict[str, Any]],
    saved_patches: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    Combina las regiones de texto extraídas del PDF base con cualquier edición,
    eliminación (`deleted`) o texto nuevo (`is_new`) guardado previamente.
    """
    if not saved_patches:
        return base_items
    if not base_items:
        return saved_patches

    saved_by_id: Dict[str, Dict[str, Any]] = {}
    custom_new: List[Dict[str, Any]] = []
    for sp in saved_patches:
        if not isinstance(sp, dict):
            continue
        pid = str(sp.get("id") or "")
        if pid:
            saved_by_id[pid] = sp
        if sp.get("is_new") or pid.startswith("patch_"):
            custom_new.append(sp)

    merged: List[Dict[str, Any]] = []
    seen_ids = set()
    for item in base_items:
        iid = str(item.get("id") or "")
        seen_ids.add(iid)
        if iid in saved_by_id:
            ov = saved_by_id[iid]
            merged.append({
                **item,
                "x_pct": float(ov.get("x_pct", item["x_pct"])),
                "y_pct": float(ov.get("y_pct", item["y_pct"])),
                "w_pct": float(ov.get("w_pct", item["w_pct"])),
                "h_pct": float(ov.get("h_pct", item["h_pct"])),
                "text": str(ov.get("text") if "text" in ov else item["text"]),
                "font_size": float(ov.get("font_size") or item["font_size"]),
                "font_weight": str(ov.get("font_weight") or item["font_weight"]),
                "text_color": str(ov.get("text_color") or item["text_color"]),
                "bg_color": str(ov.get("bg_color") or item["bg_color"]),
                "align": str(ov.get("align") or item["align"]),
                "deleted": bool(ov.get("deleted", False)),
            })
        else:
            merged.append(item)

    for cn in custom_new:
        cid = str(cn.get("id") or "")
        if cid not in seen_ids and not cn.get("deleted"):
            merged.append({
                **cn,
                "is_new": True,
                "deleted": False,
            })

    return merged


def _is_patch_modified(patch: Dict[str, Any]) -> bool:
    """Determina si una región de texto fue editada, borrada, movida o agregada por el usuario."""
    if bool(patch.get("deleted")):
        return True
    if bool(patch.get("is_new")) or str(patch.get("id") or "").startswith("patch_"):
        return True
    orig_txt = patch.get("original_text")
    cur_txt = patch.get("text")
    if orig_txt is not None and str(cur_txt or "") != str(orig_txt):
        return True
    for k, ok_key in (("x_pct", "orig_x_pct"), ("y_pct", "orig_y_pct"), ("w_pct", "orig_w_pct"), ("h_pct", "orig_h_pct")):
        if ok_key in patch and patch.get(ok_key) is not None:
            if abs(float(patch.get(k) or 0.0) - float(patch.get(ok_key) or 0.0)) > 0.25:
                return True
    return False


def load_pdf_editable_spec(
    workspace_root: Path,
    pdf_abs: Path,
    rel_path: str,
) -> Dict[str, Any]:
    """
    Carga la especificación editable de un PDF del workspace junto con todas las
    regiones interactivas de texto por página (`page_patches`) para editar y borrar
    directamente sobre la misma vista previa.
    """
    paths = get_spec_paths(workspace_root, rel_path)
    external_overwrite = False
    if pdf_abs.is_file() and paths["json"].is_file():
        try:
            saved_probe = json.loads(paths["json"].read_text(encoding="utf-8"))
            rec_mtime = saved_probe.get("pdf_mtime")
            rec_size = saved_probe.get("pdf_size")
            st = pdf_abs.stat()
            if (
                isinstance(rec_mtime, (int, float))
                and isinstance(rec_size, int)
                and (abs(st.st_mtime - float(rec_mtime)) > 1.5 or st.st_size != rec_size)
            ):
                external_overwrite = True
        except Exception:
            pass

    if pdf_abs.is_file() and (external_overwrite or not paths["base_pdf"].is_file()):
        try:
            shutil.copy2(pdf_abs, paths["base_pdf"])
            if external_overwrite and paths["cover_pdf"].is_file():
                paths["cover_pdf"].unlink(missing_ok=True)
        except Exception:
            pass

    source_for_boxes = paths["base_pdf"] if paths["base_pdf"].is_file() else pdf_abs
    base_interactive_items = _extract_interactive_text_items(source_for_boxes)

    summary = inspect_pdf_summary(pdf_abs)
    page_count = int(summary.get("page_count") or 1)

    if paths["json"].is_file() and not external_overwrite:
        try:
            saved = json.loads(paths["json"].read_text(encoding="utf-8"))
            blocks = saved.get("blocks") if isinstance(saved.get("blocks"), list) else []
            has_cover = bool(saved.get("has_cover"))
            preserve_first = bool(saved.get("preserve_first_page")) or has_cover
            if preserve_first and not paths["cover_pdf"].is_file() and page_count >= 1:
                try:
                    reader = PdfReader(str(source_for_boxes))
                    writer = PdfWriter()
                    writer.add_page(reader.pages[0])
                    with open(paths["cover_pdf"], "wb") as f:
                        writer.write(f)
                except Exception:
                    pass
            saved_patches = saved.get("page_patches") if isinstance(saved.get("page_patches"), list) else []
            merged_patches = _merge_interactive_patches(base_interactive_items, saved_patches)
            return {
                "ok": True,
                "source": "saved_spec",
                "path": rel_path,
                "filename": pdf_abs.name,
                "page_count": page_count,
                "title": str(saved.get("title") or summary.get("title") or pdf_abs.stem),
                "subtitle": str(saved.get("subtitle") or ""),
                "author": str(saved.get("author") or summary.get("author") or ""),
                "date": str(saved.get("date") or ""),
                "theme": str(saved.get("theme") or "executive"),
                "has_cover": has_cover,
                "preserve_first_page": preserve_first,
                "skip_inline_title": bool(saved.get("skip_inline_title")),
                "cover": saved.get("cover"),
                "footer_text": saved.get("footer_text"),
                "watermark": saved.get("watermark"),
                "design_skill": saved.get("design_skill"),
                "design_spec": saved.get("design_spec") if isinstance(saved.get("design_spec"), dict) else None,
                "design_overrides": saved.get("design_overrides") if isinstance(saved.get("design_overrides"), dict) else None,
                "blocks": blocks,
                "markdown": blocks_to_markdown(blocks),
                "page_patches": merged_patches,
            }
        except Exception:
            pass

    # Reconstruir especificación desde el PDF existente
    read_res = read_pdf_document(
        pdf_abs,
        start_page=1,
        end_page=min(30, max(1, page_count)),
        include_tables=True,
        max_chars=48000,
        enable_ocr_fallback=True,
    )
    pages_list = read_res.get("pages") if isinstance(read_res.get("pages"), list) else []

    has_cover_page = False
    if page_count >= 2 and len(pages_list) >= 2:
        p1_text = str(pages_list[0].get("text") or "").strip()
        p2_text = str(pages_list[1].get("text") or "").strip()
        p1_has_footer = bool(re.search(r"P[áa]gina\s+1\s+de\s+\d+", p1_text, re.IGNORECASE))
        p2_has_footer = bool(re.search(r"P[áa]gina\s+2\s+de\s+\d+", p2_text, re.IGNORECASE))
        p1_images_count = 0
        try:
            reader = PdfReader(str(pdf_abs))
            p1_images_count = len(reader.pages[0].images)
        except Exception:
            p1_images_count = 0

        if (not p1_has_footer and p2_has_footer) or (p1_images_count >= 1 and len(p1_text) < 420):
            has_cover_page = True

    doc_title = str(summary.get("title") or pdf_abs.stem.replace("-", " ").replace("_", " ")).strip()
    doc_author = str(summary.get("author") or "").strip()
    if doc_author.upper() == "XOOK":
        doc_author = ""

    content_pages = pages_list[1:] if (has_cover_page and len(pages_list) >= 2) else pages_list
    extracted_blocks = _extract_blocks_from_pdf_pages(content_pages, doc_title)

    if not extracted_blocks:
        fallback_txt = str(read_res.get("full_text") or "").strip()
        if fallback_txt:
            extracted_blocks = _parse_markdown_to_blocks(fallback_txt)
        else:
            extracted_blocks = [
                {"type": "heading", "level": 1, "text": doc_title},
                {"type": "paragraph", "text": "Escribe aquí el contenido del documento."},
            ]

    if has_cover_page and not paths["cover_pdf"].is_file():
        try:
            reader = PdfReader(str(pdf_abs))
            if len(reader.pages) >= 1:
                writer = PdfWriter()
                writer.add_page(reader.pages[0])
                with open(paths["cover_pdf"], "wb") as f:
                    writer.write(f)
        except Exception:
            pass

    reconstructed = {
        "ok": True,
        "source": "extracted_pdf",
        "path": rel_path,
        "filename": pdf_abs.name,
        "page_count": page_count,
        "title": doc_title,
        "subtitle": "",
        "author": doc_author,
        "date": "",
        "theme": "executive",
        "has_cover": has_cover_page,
        "preserve_first_page": has_cover_page,
        "skip_inline_title": False,
        "cover": {"enabled": has_cover_page, "layout": "full_page" if has_cover_page else "none"},
        "design_skill": None,
        "design_spec": None,
        "design_overrides": None,
        "blocks": extracted_blocks,
        "markdown": blocks_to_markdown(extracted_blocks),
        "page_patches": base_interactive_items,
    }
    save_pdf_spec_metadata(workspace_root, rel_path, reconstructed, pdf_abs=pdf_abs)
    return reconstructed


def apply_page_patches_to_pdf(
    src_pdf: Path,
    dst_pdf: Path,
    page_patches: List[Dict[str, Any]],
) -> None:
    """
    Estampa en el PDF únicamente las regiones que fueron editadas, borradas (`deleted=True`),
    movidas o agregadas sobre la vista previa:
    1. Cubre la caja original (`orig_x_pct`, `orig_y_pct`, `orig_w_pct`, `orig_h_pct`) con el color de fondo
       de esa zona (`bg_color`) para borrar limpiamente el texto anterior sin tocar imágenes ni gráficas.
    2. Si el elemento no fue eliminado (`not deleted`) y tiene texto, dibuja el nuevo texto envuelto
       en su coordenada actual (`x_pct`, `y_pct`, `w_pct`, `h_pct`).
    """
    _ensure_fonts()
    reader = PdfReader(str(src_pdf))
    writer = PdfWriter()

    patches_by_page: Dict[int, List[Dict[str, Any]]] = {}
    for p in page_patches:
        if not isinstance(p, dict):
            continue
        if not _is_patch_modified(p):
            continue
        pnum = int(p.get("page_number") or 1)
        patches_by_page.setdefault(pnum, []).append(p)

    for idx, page in enumerate(reader.pages):
        page_num = idx + 1
        items = patches_by_page.get(page_num) or []
        if not items:
            writer.add_page(page)
            continue

        mbox = page.mediabox
        pw = float(mbox.width)
        ph = float(mbox.height)

        overlay_buf = io.BytesIO()
        canv = rl_canvas.Canvas(overlay_buf, pagesize=(pw, ph))

        for patch in items:
            deleted = bool(patch.get("deleted"))
            is_new = bool(patch.get("is_new")) or str(patch.get("id") or "").startswith("patch_")
            text = _sanitize_text_for_pdf(str(patch.get("text") or ""))
            bg_color_str = str(patch.get("bg_color") or "#FFFFFF").strip()
            text_color_str = str(patch.get("text_color") or "#0F172A").strip()
            font_size = max(6.0, min(48.0, float(patch.get("font_size") or 11.0)))
            is_bold = str(patch.get("font_weight") or "normal").lower() in ("bold", "700", "600")
            align = str(patch.get("align") or "left").lower()

            x_pct = max(0.0, min(98.5, float(patch.get("x_pct") or 10.0)))
            y_pct = max(0.0, min(98.5, float(patch.get("y_pct") or 10.0)))
            w_pct = max(1.5, min(100.0 - x_pct, float(patch.get("w_pct") or 26.0)))
            h_pct = max(1.2, min(100.0 - y_pct, float(patch.get("h_pct") or 4.0)))

            canv.saveState()

            # 1) Cubrir caja original si es un texto existente del PDF que fue editado, movido o borrado
            if not is_new:
                ox_pct = float(patch.get("orig_x_pct", x_pct))
                oy_pct = float(patch.get("orig_y_pct", y_pct))
                ow_pct = float(patch.get("orig_w_pct", w_pct))
                oh_pct = float(patch.get("orig_h_pct", h_pct))

                orig_x = (ox_pct / 100.0) * pw - 2.0
                orig_w = (ow_pct / 100.0) * pw + 4.0
                orig_h = (oh_pct / 100.0) * ph + 3.0
                orig_y = ph - ((oy_pct / 100.0) * ph) - orig_h + 1.5

                cover_bg = bg_color_str if bg_color_str.lower() not in ("transparent", "none", "") else "#FFFFFF"
                try:
                    canv.setFillColor(colors.HexColor(cover_bg))
                except Exception:
                    canv.setFillColor(colors.HexColor("#FFFFFF"))
                canv.rect(orig_x, orig_y, orig_w, orig_h, stroke=0, fill=1)

            # 2) Si no está borrado y tiene texto, dibujar en la posición actual
            if not deleted and text.strip():
                font_name = _FONT_FAMILY["bold"] if is_bold else _FONT_FAMILY["regular"]
                canv.setFont(font_name, font_size)

                box_x = (x_pct / 100.0) * pw
                box_w = (w_pct / 100.0) * pw
                box_h = (h_pct / 100.0) * ph

                # Envolver líneas automáticamente al ancho de la caja
                wrapped_lines: List[str] = []
                for raw_ln in text.splitlines() or [text]:
                    if not raw_ln.strip():
                        wrapped_lines.append("")
                        continue
                    split_lns = simpleSplit(raw_ln, font_name, font_size, max(24.0, box_w + 4.0))
                    wrapped_lines.extend(split_lns or [raw_ln])

                line_h = font_size * 1.24
                if len(wrapped_lines) > 1 and box_h > font_size * 1.2:
                    natural_lh = (box_h - font_size) / max(1, len(wrapped_lines) - 1)
                    if font_size * 1.02 <= natural_lh <= font_size * 1.65:
                        line_h = natural_lh

                total_text_h = font_size + max(0, len(wrapped_lines) - 1) * line_h
                effective_h = max(box_h, total_text_h + 2.0)
                box_y = ph - ((y_pct / 100.0) * ph) - effective_h

                # Cubrir fondo de la ubicación nueva si se movió o si creció el párrafo
                if bg_color_str and bg_color_str.lower() not in ("transparent", "none"):
                    try:
                        canv.setFillColor(colors.HexColor(bg_color_str))
                        canv.rect(box_x - 1.5, box_y - 1.0, box_w + 3.0, effective_h + 2.5, stroke=0, fill=1)
                    except Exception:
                        pass

                try:
                    canv.setFillColor(colors.HexColor(text_color_str))
                except Exception:
                    canv.setFillColor(colors.HexColor("#0F172A"))

                top_y_pdf = ph - ((y_pct / 100.0) * ph)
                start_baseline_y = top_y_pdf - font_size * 0.84

                for l_idx, ln in enumerate(wrapped_lines):
                    cur_y = start_baseline_y - l_idx * line_h
                    if align == "center":
                        canv.drawCentredString(box_x + box_w / 2.0, cur_y, ln)
                    elif align == "right":
                        canv.drawRightString(box_x + box_w, cur_y, ln)
                    else:
                        canv.drawString(box_x, cur_y, ln)

            canv.restoreState()

        canv.showPage()
        canv.save()
        overlay_buf.seek(0)
        overlay_reader = PdfReader(overlay_buf)
        page.merge_page(overlay_reader.pages[0])
        writer.add_page(page)

    tmp_dst = dst_pdf.with_name(f".{dst_pdf.name}.patch.tmp")
    with open(tmp_dst, "wb") as f:
        writer.write(f)
    tmp_dst.replace(dst_pdf)


def save_edited_pdf_document(
    workspace_root: Path,
    pdf_abs: Path,
    rel_path: str,
    payload: Dict[str, Any],
    resolve_path_fn: Callable,
) -> Dict[str, Any]:
    """
    Guarda los cambios realizados sobre un documento PDF en el visor:
    - Si `patches_only=True` (edición directa sobre la vista previa), aplica los cambios
      de texto y borrados (`page_patches`) sobre `.base.pdf` conservando intactas imágenes,
      logos y diseño original.
    """
    paths = get_spec_paths(workspace_root, rel_path)
    page_patches = payload.get("page_patches") if isinstance(payload.get("page_patches"), list) else []
    patches_only = bool(payload.get("patches_only", True))

    if pdf_abs.is_file() and not paths["base_pdf"].is_file():
        shutil.copy2(pdf_abs, paths["base_pdf"])

    if pdf_abs.is_file() and not paths["cover_pdf"].is_file():
        try:
            reader = PdfReader(str(paths["base_pdf"]))
            if len(reader.pages) >= 1:
                writer = PdfWriter()
                writer.add_page(reader.pages[0])
                with open(paths["cover_pdf"], "wb") as f:
                    writer.write(f)
        except Exception:
            pass

    if patches_only and pdf_abs.is_file():
        modified_only = [p for p in page_patches if isinstance(p, dict) and _is_patch_modified(p)]
        if modified_only:
            apply_page_patches_to_pdf(paths["base_pdf"], pdf_abs, modified_only)
        else:
            shutil.copy2(paths["base_pdf"], pdf_abs)

        existing_meta: Dict[str, Any] = {}
        if paths["json"].is_file():
            try:
                existing_meta = json.loads(paths["json"].read_text(encoding="utf-8"))
            except Exception:
                existing_meta = {}
        existing_meta["page_patches"] = modified_only
        save_pdf_spec_metadata(workspace_root, rel_path, existing_meta, pdf_abs=pdf_abs)
    else:
        edit_mode = str(payload.get("edit_mode") or "blocks").strip().lower()
        raw_md = str(payload.get("markdown") or "").strip()
        if edit_mode == "markdown" and raw_md:
            blocks = _parse_markdown_to_blocks(raw_md)
        else:
            raw_blocks = payload.get("blocks")
            if isinstance(raw_blocks, list) and len(raw_blocks) > 0:
                blocks, _ = _normalize_blocks_input({"blocks": raw_blocks})
            elif raw_md:
                blocks = _parse_markdown_to_blocks(raw_md)
            else:
                blocks = []

        if not blocks:
            blocks = [{"type": "paragraph", "text": str(payload.get("title") or "Documento")}]

        preserve_first = bool(payload.get("preserve_first_page"))
        prepend_cover_path = paths["cover_pdf"] if (preserve_first and paths["cover_pdf"].is_file()) else None

        existing_meta_edit: Dict[str, Any] = {}
        if paths["json"].is_file():
            try:
                existing_meta_edit = json.loads(paths["json"].read_text(encoding="utf-8"))
            except Exception:
                existing_meta_edit = {}

        gen_spec: Dict[str, Any] = {
            "title": str(payload.get("title") or pdf_abs.stem).strip() or "Documento",
            "subtitle": str(payload.get("subtitle") or "").strip(),
            "author": str(payload.get("author") or "").strip(),
            "date": str(payload.get("date") or "").strip(),
            "theme": str(payload.get("theme") or "executive").strip().lower(),
            "output_path": rel_path,
            "blocks": blocks,
            "skip_inline_title": bool(payload.get("skip_inline_title")),
            "cover": {"enabled": False} if prepend_cover_path else payload.get("cover"),
        }
        if "footer_text" in payload:
            gen_spec["footer_text"] = payload.get("footer_text")
        if "watermark" in payload:
            gen_spec["watermark"] = payload.get("watermark")
        elif "branding" in payload:
            gen_spec["branding"] = payload.get("branding")
        eff_edit_skill = payload.get("design_skill") if "design_skill" in payload else existing_meta_edit.get("design_skill")
        eff_edit_spec = payload.get("design_spec") if "design_spec" in payload else existing_meta_edit.get("design_spec")
        eff_edit_overrides = payload.get("design_overrides") if "design_overrides" in payload else existing_meta_edit.get("design_overrides")
        if eff_edit_skill:
            gen_spec["design_skill"] = eff_edit_skill
        if isinstance(eff_edit_spec, dict) and eff_edit_spec:
            gen_spec["design_spec"] = eff_edit_spec
        if isinstance(eff_edit_overrides, dict) and eff_edit_overrides:
            gen_spec["design_overrides"] = eff_edit_overrides

        modified_only = [p for p in page_patches if isinstance(p, dict) and _is_patch_modified(p)]
        generate_pdf_document(
            gen_spec,
            workspace_root=workspace_root,
            resolve_path_fn=resolve_path_fn,
            allow_any_workspace_zone=True,
            prepend_first_page_from=prepend_cover_path,
            save_spec_override={
                **gen_spec,
                "has_cover": bool(prepend_cover_path) or bool((payload.get("cover") or {}).get("enabled")),
                "preserve_first_page": preserve_first,
                "cover": payload.get("cover"),
                "page_patches": modified_only,
            },
        )

        if pdf_abs.is_file():
            shutil.copy2(pdf_abs, paths["base_pdf"])
            if modified_only:
                apply_page_patches_to_pdf(paths["base_pdf"], pdf_abs, modified_only)

    reader = PdfReader(str(pdf_abs))
    page_count = len(reader.pages)
    size_bytes = pdf_abs.stat().st_size
    preview = render_pdf_preview(pdf_abs, start_page=1, max_pages=8)
    editable_spec = load_pdf_editable_spec(workspace_root, pdf_abs, rel_path)

    return {
        "ok": True,
        "path": rel_path,
        "filename": pdf_abs.name,
        "title": editable_spec.get("title") or pdf_abs.stem,
        "theme": editable_spec.get("theme") or "executive",
        "page_count": page_count,
        "size_bytes": size_bytes,
        "preview_pages": preview.get("pages") if preview.get("ok") else [],
        "preview_has_more": bool(preview.get("has_more")) if preview.get("ok") else False,
        "editable_spec": editable_spec,
    }


def _normalize_doc_lookup_text(text: str) -> str:
    """Normaliza texto eliminando tildes y separadores para búsqueda flexible de documentos y secciones."""
    norm = unicodedata.normalize("NFD", str(text or ""))
    norm = "".join(ch for ch in norm if unicodedata.category(ch) != "Mn")
    return re.sub(r"[\s_./:,-]+", " ", norm.lower()).strip()


def _heading_level(block: Dict[str, Any]) -> Optional[int]:
    if not isinstance(block, dict):
        return None
    b_type = str(block.get("type") or "").strip().lower()
    if b_type == "h1":
        return 1
    if b_type == "h2":
        return 2
    if b_type == "h3":
        return 3
    if b_type == "heading":
        try:
            lvl = int(block.get("level") or 1)
        except (TypeError, ValueError):
            lvl = 1
        return max(1, min(3, lvl))
    return None


def _collect_headings(blocks: List[Dict[str, Any]]) -> List[str]:
    headings: List[str] = []
    for blk in blocks:
        if _heading_level(blk) is not None:
            t = str(blk.get("text") or "").strip()
            if t:
                headings.append(t)
    return headings


def _extract_block_text_preview(blocks: List[Dict[str, Any]], limit: int = 8) -> List[str]:
    snippets: List[str] = []
    for blk in blocks:
        if not isinstance(blk, dict):
            continue
        t = str(blk.get("text") or blk.get("title") or "").strip()
        if not t and isinstance(blk.get("items"), list):
            t = " | ".join(str(x) for x in blk["items"][:3] if str(x).strip())
        if t:
            snippets.append(t[:120] + ("…" if len(t) > 120 else ""))
        if len(snippets) >= limit:
            break
    return snippets


def _sub_pattern_in_text(text: str, find_txt: str, replace_txt: str) -> Tuple[str, int]:
    if not find_txt or not text:
        return text, 0
    if find_txt in text:
        cnt = text.count(find_txt)
        return text.replace(find_txt, replace_txt), cnt
    if find_txt.lower() in text.lower():
        pattern = re.compile(re.escape(find_txt), re.IGNORECASE)
        return pattern.subn(lambda _m: replace_txt, text)
    parts = [re.escape(p) for p in find_txt.split() if p]
    if len(parts) > 1:
        ws_pattern = re.compile(r"\s+".join(parts), re.IGNORECASE)
        return ws_pattern.subn(lambda _m: replace_txt, text)
    return text, 0


def _apply_replacements_to_blocks(
    blocks: List[Dict[str, Any]],
    replacements: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], int]:
    """Aplica reemplazos puntuales sobre una copia profunda de `blocks`."""
    import copy

    updated = copy.deepcopy(blocks or [])
    total_applied = 0
    for rep in replacements:
        if not isinstance(rep, dict):
            continue
        find_txt = str(rep.get("find") or rep.get("old") or "").strip()
        replace_txt = str(rep.get("replace") or rep.get("new") or "")
        if not find_txt:
            continue
        for blk in updated:
            if not isinstance(blk, dict):
                continue
            for key in ("text", "title", "caption", "code", "label"):
                if isinstance(blk.get(key), str):
                    new_val, cnt = _sub_pattern_in_text(blk[key], find_txt, replace_txt)
                    if cnt:
                        blk[key] = new_val
                        total_applied += cnt
            for list_key in ("items", "headers"):
                lst = blk.get(list_key)
                if isinstance(lst, list):
                    for idx, item in enumerate(lst):
                        if isinstance(item, str):
                            new_val, cnt = _sub_pattern_in_text(item, find_txt, replace_txt)
                            if cnt:
                                lst[idx] = new_val
                                total_applied += cnt
                        elif isinstance(item, dict):
                            for sub_k in ("label", "value", "note", "text"):
                                if isinstance(item.get(sub_k), str):
                                    new_val, cnt = _sub_pattern_in_text(item[sub_k], find_txt, replace_txt)
                                    if cnt:
                                        item[sub_k] = new_val
                                        total_applied += cnt
            rows = blk.get("rows")
            if isinstance(rows, list):
                for r_idx, row in enumerate(rows):
                    if isinstance(row, list):
                        for c_idx, cell in enumerate(row):
                            if isinstance(cell, str):
                                new_val, cnt = _sub_pattern_in_text(cell, find_txt, replace_txt)
                                if cnt:
                                    row[c_idx] = new_val
                                    total_applied += cnt
            signers = blk.get("signers")
            if isinstance(signers, list):
                for s_item in signers:
                    if isinstance(s_item, dict):
                        for sub_k in ("name", "role", "title", "date"):
                            if isinstance(s_item.get(sub_k), str):
                                new_val, cnt = _sub_pattern_in_text(s_item[sub_k], find_txt, replace_txt)
                                if cnt:
                                    s_item[sub_k] = new_val
                                    total_applied += cnt
            inner_blks = blk.get("blocks")
            if isinstance(inner_blks, list) and inner_blks:
                new_inner, inner_cnt = _apply_replacements_to_blocks(inner_blks, [rep])
                if inner_cnt:
                    blk["blocks"] = new_inner
                    total_applied += inner_cnt
            raw_cols = blk.get("columns")
            if isinstance(raw_cols, list) and raw_cols and isinstance(raw_cols[0], list):
                for col_i, col_blks in enumerate(raw_cols):
                    if isinstance(col_blks, list):
                        new_col, col_cnt = _apply_replacements_to_blocks(col_blks, [rep])
                        if col_cnt:
                            raw_cols[col_i] = new_col
                            total_applied += col_cnt
    return updated, total_applied


def _apply_section_updates_to_blocks(
    blocks: List[Dict[str, Any]],
    section_updates: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], int, List[str]]:
    """Aplica ediciones quirúrgicas por sección/encabezado sin borrar el resto del documento."""
    import copy

    cur_blocks = copy.deepcopy(blocks or [])
    applied = 0
    unmatched: List[str] = []

    for upd in section_updates:
        if not isinstance(upd, dict):
            continue
        action = str(upd.get("action") or upd.get("mode") or "replace").strip().lower()
        target_sec = str(
            upd.get("section") or upd.get("heading") or upd.get("target") or upd.get("match") or ""
        ).strip()
        raw_idx = upd.get("block_index")

        # Construir bloques nuevos para esta actualización
        upd_spec: Dict[str, Any] = {}
        if isinstance(upd.get("blocks"), list):
            upd_spec["blocks"] = upd["blocks"]
        elif isinstance(upd.get("markdown"), str) and upd["markdown"].strip():
            upd_spec["markdown"] = upd["markdown"]
        elif isinstance(upd.get("content"), str) and upd["content"].strip():
            upd_spec["markdown"] = upd["content"]
        elif isinstance(upd.get("text"), str) and upd["text"].strip():
            upd_spec["markdown"] = upd["text"]
        sec_blocks, _ = _normalize_blocks_input(upd_spec) if upd_spec else ([], False)

        is_delete = action in ("delete", "remove", "eliminar", "quitar")
        if not is_delete and not sec_blocks:
            continue

        start_idx: Optional[int] = None
        end_idx: Optional[int] = None
        is_heading_anchor = False

        if isinstance(raw_idx, int) and 0 <= raw_idx < len(cur_blocks):
            start_idx = raw_idx
            lvl = _heading_level(cur_blocks[raw_idx])
            if lvl is not None:
                is_heading_anchor = True
                end_idx = len(cur_blocks)
                for j in range(raw_idx + 1, len(cur_blocks)):
                    j_lvl = _heading_level(cur_blocks[j])
                    if j_lvl is not None and j_lvl <= lvl:
                        end_idx = j
                        break
            else:
                end_idx = raw_idx + 1
        elif target_sec:
            norm_target = _normalize_doc_lookup_text(target_sec)
            tokens = [t for t in norm_target.split() if len(t) >= 2]
            best_h_idx: Optional[int] = None
            best_h_score = -1

            for idx, blk in enumerate(cur_blocks):
                lvl = _heading_level(blk)
                if lvl is None:
                    continue
                h_norm = _normalize_doc_lookup_text(str(blk.get("text") or ""))
                if not h_norm:
                    continue
                score = -1
                if h_norm == norm_target:
                    score = 100
                elif norm_target and norm_target in h_norm:
                    score = 80 - abs(len(h_norm) - len(norm_target))
                elif tokens and all(tok in h_norm for tok in tokens):
                    score = 60
                if score > best_h_score:
                    best_h_score = score
                    best_h_idx = idx

            if best_h_idx is not None:
                start_idx = best_h_idx
                is_heading_anchor = True
                lvl = _heading_level(cur_blocks[best_h_idx]) or 1
                end_idx = len(cur_blocks)
                for j in range(best_h_idx + 1, len(cur_blocks)):
                    j_lvl = _heading_level(cur_blocks[j])
                    if j_lvl is not None and j_lvl <= lvl:
                        end_idx = j
                        break
            else:
                # Fallback: coincidencia por contenido de bloque o inicio del documento
                if norm_target in ("inicio", "intro", "introduccion", "portada cuerpo", "encabezado") and cur_blocks:
                    first_h = next((i for i, b in enumerate(cur_blocks) if _heading_level(b) is not None), len(cur_blocks))
                    if first_h > 0:
                        start_idx, end_idx = 0, first_h
                if start_idx is None:
                    for idx, blk in enumerate(cur_blocks):
                        raw_txt = str(blk.get("text") or blk.get("title") or "")
                        if not raw_txt and isinstance(blk.get("items"), list):
                            raw_txt = " ".join(str(x) for x in blk["items"])
                        b_norm = _normalize_doc_lookup_text(raw_txt)
                        if b_norm and (
                            (norm_target and norm_target in b_norm)
                            or (tokens and all(tok in b_norm for tok in tokens))
                        ):
                            start_idx = idx
                            end_idx = idx + 1
                            break

        if start_idx is None or end_idx is None:
            if target_sec:
                unmatched.append(target_sec)
            continue

        if is_delete:
            del cur_blocks[start_idx:end_idx]
            applied += 1
        elif action in ("append", "insert_after", "after", "agregar_despues"):
            cur_blocks[end_idx:end_idx] = sec_blocks
            applied += 1
        elif action in ("prepend", "insert_before", "before", "agregar_antes"):
            insert_pos = start_idx + 1 if (is_heading_anchor and action == "prepend") else start_idx
            cur_blocks[insert_pos:insert_pos] = sec_blocks
            applied += 1
        else:
            # replace / update / rewrite
            if is_heading_anchor and sec_blocks and _heading_level(sec_blocks[0]) is None:
                cur_blocks[start_idx + 1 : end_idx] = sec_blocks
            else:
                cur_blocks[start_idx:end_idx] = sec_blocks
            applied += 1

    return cur_blocks, applied, unmatched


def _find_existing_pdf_in_workspace(
    workspace_root: Path,
    raw_ref: str,
    resolve_path_fn: Callable,
) -> Optional[Tuple[Path, str]]:
    """
    Resuelve una referencia a un PDF existente del workspace por ruta exacta, nombre de archivo,
    título guardado en `.xook/pdf_specs/*.json` o coincidencia flexible sin tildes/guiones.
    """
    clean_ref = str(raw_ref or "").strip()
    if not clean_ref:
        return None
    if not clean_ref.lower().endswith(".pdf"):
        clean_ref_pdf = f"{clean_ref}.pdf"
    else:
        clean_ref_pdf = clean_ref

    for candidate in (clean_ref, clean_ref_pdf):
        try:
            abs_p, rel_p, _ = resolve_path_fn(workspace_root, candidate)
            if abs_p.is_file() and abs_p.suffix.lower() == ".pdf":
                return abs_p, rel_p
        except Exception:
            pass

    # Indexar títulos conocidos en `.xook/pdf_specs/*.json` para resolver por título natural
    spec_titles: Dict[str, str] = {}
    specs_dir = workspace_root / ".xook" / "pdf_specs"
    if specs_dir.is_dir():
        for spec_file in specs_dir.glob("*.json"):
            try:
                data = json.loads(spec_file.read_text(encoding="utf-8"))
                if isinstance(data, dict) and data.get("path") and data.get("title"):
                    spec_titles[str(data["path"]).replace("\\", "/")] = str(data["title"])
            except Exception:
                continue

    ws_resolved = workspace_root.resolve()
    target_name = Path(clean_ref_pdf).name.lower()
    raw_stem = Path(clean_ref).stem if clean_ref.lower().endswith(".pdf") else clean_ref
    norm_query = _normalize_doc_lookup_text(raw_stem)
    stopwords = {"el", "la", "los", "las", "de", "del", "en", "un", "una", "pdf", "documento", "archivo", "reporte", "informe"}
    sig_tokens = [t for t in norm_query.split() if len(t) >= 2 and t not in stopwords]
    if not sig_tokens:
        sig_tokens = [t for t in norm_query.split() if len(t) >= 2]

    candidates: List[Tuple[int, int, float, Path, str]] = []
    seen_rel: set[str] = set()
    for zone_rank, search_sub in enumerate(("agente/reportes", "agente", "context", "")):
        base_dir = (workspace_root / search_sub) if search_sub else workspace_root
        if not base_dir.is_dir():
            continue
        try:
            for found in base_dir.rglob("*.pdf"):
                if ".xook" in found.parts or "node_modules" in found.parts or "target" in found.parts or ".venv" in found.parts:
                    continue
                abs_found = found.resolve()
                try:
                    rel_found = abs_found.relative_to(ws_resolved).as_posix()
                except ValueError:
                    continue
                if rel_found in seen_rel:
                    continue
                seen_rel.add(rel_found)

                fname_low = abs_found.name.lower()
                norm_stem = _normalize_doc_lookup_text(abs_found.stem)
                norm_rel = _normalize_doc_lookup_text(rel_found)
                norm_title = _normalize_doc_lookup_text(spec_titles.get(rel_found, ""))

                tier = 0
                if fname_low == target_name:
                    tier = 4
                elif norm_query and (norm_stem == norm_query or norm_title == norm_query):
                    tier = 3
                elif sig_tokens and (
                    all(tok in norm_stem for tok in sig_tokens)
                    or (norm_title and all(tok in norm_title for tok in sig_tokens))
                    or all(tok in norm_rel for tok in sig_tokens)
                ):
                    tier = 2
                elif norm_query and len(norm_query) >= 4 and (norm_query in norm_stem or (norm_title and norm_query in norm_title)):
                    tier = 1

                if tier > 0:
                    try:
                        mtime = abs_found.stat().st_mtime
                    except OSError:
                        mtime = 0.0
                    candidates.append((tier, -zone_rank, mtime, abs_found, rel_found))
        except Exception:
            pass

    if not candidates:
        return None
    candidates.sort(key=lambda item: (item[0], item[1], item[2]), reverse=True)
    _, _, _, best_abs, best_rel = candidates[0]
    return best_abs, best_rel


def modify_or_append_pdf_by_agent(
    workspace_root: Path,
    spec: Dict[str, Any],
    *,
    resolve_path_fn: Callable,
    default_author: Optional[str] = None,
    progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
    global_skills_dir: Optional[Path] = None,
) -> Dict[str, Any]:
    """
    Permite a Xox modificar un PDF existente o agregarle nuevas páginas (`append_pages`)
    conservando la misma tipografía (`_FONT_FAMILY`), estilo visual (`theme`), `design_spec`,
    encabezados, pies de página y portada original. Soporta reemplazos puntuales, ediciones quirúrgicas
    por sección (`section_updates`), cambios de diseño (`design_overrides`), reemplazo completo o anexado.
    """
    source_ref = str(
        spec.get("source_pdf_path")
        or spec.get("target_pdf_path")
        or spec.get("existing_pdf_path")
        or spec.get("output_path")
        or ""
    ).strip()

    resolved_pair = _find_existing_pdf_in_workspace(workspace_root, source_ref, resolve_path_fn)
    if resolved_pair is None:
        return generate_pdf_document(
            spec,
            workspace_root=workspace_root,
            resolve_path_fn=resolve_path_fn,
            default_author=default_author,
            progress_callback=progress_callback,
            global_skills_dir=global_skills_dir,
        )

    pdf_abs, rel_path = resolved_pair
    paths = get_spec_paths(workspace_root, rel_path)
    existing_spec = load_pdf_editable_spec(workspace_root, pdf_abs, rel_path)

    # Heredar diseño, tipografía y metadatos del PDF existente para mantener coherencia total
    has_explicit_theme = "theme" in spec and bool(str(spec.get("theme") or "").strip())
    theme = str(spec.get("theme") or existing_spec.get("theme") or "executive").strip().lower()
    title = str(spec.get("title") or existing_spec.get("title") or pdf_abs.stem).strip() or "Documento"
    subtitle = str(
        spec.get("subtitle") if "subtitle" in spec else (existing_spec.get("subtitle") or "")
    ).strip()
    author = str(
        spec.get("author") or spec.get("company") or existing_spec.get("author") or default_author or ""
    ).strip()
    date_str = str(spec.get("date") if "date" in spec else (existing_spec.get("date") or "")).strip()
    footer_text = (
        spec.get("footer_text")
        if "footer_text" in spec
        else existing_spec.get("footer_text")
    )
    watermark_cfg = (
        spec.get("watermark")
        if "watermark" in spec
        else (spec.get("branding") if "branding" in spec else (existing_spec.get("watermark") if "watermark" in existing_spec else existing_spec.get("branding")))
    )

    # Heredar o sobrescribir design_skill / design_spec / design_overrides
    has_new_design_skill = bool(str(spec.get("design_skill") or "").strip())
    has_new_design_spec = isinstance(spec.get("design_spec"), dict) and bool(spec.get("design_spec"))
    has_new_design_overrides = isinstance(spec.get("design_overrides"), dict) and bool(spec.get("design_overrides"))
    prev_design_skill = str(existing_spec.get("design_skill") or "").strip() or None
    effective_design_skill = (
        str(spec.get("design_skill") or "").strip() or None
        if "design_skill" in spec
        else prev_design_skill
    )
    inherited_design_spec: Optional[Dict[str, Any]] = (
        _json_safe_copy(existing_spec.get("design_spec"))
        if isinstance(existing_spec.get("design_spec"), dict) and existing_spec.get("design_spec")
        else None
    )

    edit_action = str(spec.get("edit_action") or spec.get("mode") or "").strip().lower()
    is_append = bool(spec.get("append_pages")) or edit_action in (
        "append_pages",
        "add_pages",
        "append",
        "agregar_paginas",
        "agregar",
    )

    # 1) Aplicar reemplazos puntuales sobre cajas de texto (`page_patches`) y bloques guardados (`blocks`)
    replacements = spec.get("replacements") if isinstance(spec.get("replacements"), list) else []
    page_patches = list(existing_spec.get("page_patches") or [])
    replacements_applied = 0
    if replacements and page_patches:
        for rep in replacements:
            if not isinstance(rep, dict):
                continue
            find_txt = str(rep.get("find") or rep.get("old") or "").strip()
            replace_txt = str(rep.get("replace") or rep.get("new") or "")
            target_page = int(rep.get("page_number") or 0)
            if not find_txt:
                continue
            for patch in page_patches:
                if not isinstance(patch, dict) or patch.get("deleted"):
                    continue
                if target_page > 0 and int(patch.get("page_number") or 0) != target_page:
                    continue
                cur_t = str(patch.get("text") or "")
                new_t, cnt = _sub_pattern_in_text(cur_t, find_txt, replace_txt)
                if cnt > 0:
                    patch["text"] = new_t
                    replacements_applied += cnt

    existing_blocks = list(existing_spec.get("blocks") or [])
    block_replacements_applied = 0
    if replacements and existing_blocks:
        existing_blocks, block_replacements_applied = _apply_replacements_to_blocks(existing_blocks, replacements)

    section_updates = spec.get("section_updates") if isinstance(spec.get("section_updates"), list) else []
    section_updates_applied = 0
    unmatched_sections: List[str] = []
    if section_updates:
        existing_blocks, section_updates_applied, unmatched_sections = _apply_section_updates_to_blocks(
            existing_blocks,
            section_updates,
        )
        if unmatched_sections and section_updates_applied == 0:
            return {
                "ok": False,
                "path": rel_path,
                "error": (
                    f"No se encontró la sección solicitada ({', '.join(unmatched_sections)}) en {rel_path}. "
                    "Revisa los encabezados reales del documento con `pdf_read`."
                ),
                "available_headings": _collect_headings(existing_blocks),
                "sample_snippets": _extract_block_text_preview(existing_blocks),
            }

    new_blocks, _ = _normalize_blocks_input(spec)

    # Detectar intento fallido de reemplazo sin otro cambio válido para evitar falsos "ok: True"
    metadata_changed = (
        ("title" in spec and str(spec.get("title") or "").strip() != str(existing_spec.get("title") or "").strip())
        or ("theme" in spec and str(spec.get("theme") or "").strip().lower() != str(existing_spec.get("theme") or "").strip().lower())
        or ("subtitle" in spec and str(spec.get("subtitle") or "").strip() != str(existing_spec.get("subtitle") or "").strip())
        or ("footer_text" in spec)
        or ("watermark" in spec)
        or ("branding" in spec)
        or has_new_design_skill
        or has_new_design_spec
        or has_new_design_overrides
    )
    if (
        replacements
        and replacements_applied == 0
        and block_replacements_applied == 0
        and not new_blocks
        and section_updates_applied == 0
        and not metadata_changed
    ):
        return {
            "ok": False,
            "path": rel_path,
            "error": (
                f"Ninguno de los textos indicados en `replacements` coincidió en {rel_path}. "
                "Lee el documento o usa `section_updates` / `markdown`."
            ),
            "available_headings": _collect_headings(existing_blocks),
            "sample_snippets": _extract_block_text_preview(existing_blocks),
        }

    # 3) Si solo enviaron `replacements` sin bloques estructurados modificados (ej. PDF escaneado o portada),
    #    estampar parches directos; si sí coincidieron `blocks`, dejar que el modo `modify` recompile limpio.
    if (
        not is_append
        and replacements_applied > 0
        and block_replacements_applied == 0
        and not new_blocks
        and section_updates_applied == 0
        and not metadata_changed
    ):
        saved = save_edited_pdf_document(
            workspace_root,
            pdf_abs,
            rel_path,
            {"patches_only": True, "page_patches": page_patches},
            resolve_path_fn,
        )
        saved["edit_action"] = "replacements"
        return saved

    # Captura perezosa del diseño visual real de PDFs externos sin design_spec guardado
    should_lazy_inspect = (
        (existing_spec.get("source") == "extracted_pdf" or inherited_design_spec is None)
        and not has_explicit_theme
        and not has_new_design_skill
        and not has_new_design_spec
        and not prev_design_skill
    )
    if should_lazy_inspect:
        try:
            from slices.pdf_engine.inspector import inspect_pdf_design

            inspected = inspect_pdf_design(pdf_abs, include_preview_images=False)
            if isinstance(inspected, dict) and inspected.get("ok") and isinstance(inspected.get("design_spec"), dict):
                inherited_design_spec = inspected["design_spec"]
        except Exception:
            pass

    def _attach_design_fields(target_spec: Dict[str, Any]) -> None:
        switched_skill = has_new_design_skill and (effective_design_skill != prev_design_skill)
        if effective_design_skill:
            target_spec["design_skill"] = effective_design_skill
        if switched_skill:
            if has_new_design_spec:
                target_spec["design_spec"] = spec["design_spec"]
            if has_new_design_overrides:
                target_spec["design_overrides"] = spec["design_overrides"]
            return

        base_ds = _json_safe_copy(inherited_design_spec) if isinstance(inherited_design_spec, dict) else None
        if (
            base_ds is not None
            and has_explicit_theme
            and theme != str(existing_spec.get("theme") or "").strip().lower()
            and not has_new_design_spec
            and theme in THEMES
        ):
            t_pal = THEMES[theme]
            pal_d = base_ds.setdefault("palette", {})
            for pk in (
                "page_bg", "text", "heading", "muted", "accent", "accent_dark",
                "accent_soft", "border", "surface", "table_head_bg", "table_head_fg", "table_alt",
            ):
                if pk in t_pal:
                    pal_d[pk] = t_pal[pk]
            base_ds.setdefault("page", {})["background_hex"] = t_pal["page_bg"]

        if has_new_design_spec:
            if base_ds is not None:
                _, merge_fn, _ = _resolve_inspector_funcs()
                priv_dir = base_ds.get("_skill_dir")
                priv_assets = base_ds.get("_resolved_assets")
                priv_slug = base_ds.get("_skill_slug")
                base_ds = merge_fn(base_ds, spec["design_spec"])
                if priv_dir and "_skill_dir" not in base_ds:
                    base_ds["_skill_dir"] = priv_dir
                if priv_assets and "_resolved_assets" not in base_ds:
                    base_ds["_resolved_assets"] = priv_assets
                if priv_slug and "_skill_slug" not in base_ds:
                    base_ds["_skill_slug"] = priv_slug
            else:
                base_ds = _json_safe_copy(spec["design_spec"])

        if base_ds is not None:
            target_spec["design_spec"] = base_ds
        if has_new_design_overrides:
            target_spec["design_overrides"] = spec["design_overrides"]

    # 2) Modo `append_pages`: conserva intactas todas las páginas actuales (1..N) y agrega
    #    las páginas nuevas (N+1..N+K) con la misma tipografía, paleta y numeración continua.
    if is_append and new_blocks:
        if replacements_applied > 0:
            modified_only = [p for p in page_patches if isinstance(p, dict) and _is_patch_modified(p)]
            if modified_only and paths["base_pdf"].is_file():
                apply_page_patches_to_pdf(paths["base_pdf"], pdf_abs, modified_only)

        prev_all_tmp = paths["base_pdf"].with_name(f"{paths['base_pdf'].stem}.prev_all.pdf")
        shutil.copy2(pdf_abs, prev_all_tmp)
        combined_blocks = existing_blocks + [{"type": "page_break"}] + new_blocks

        append_spec: Dict[str, Any] = {
            "title": title,
            "subtitle": subtitle,
            "author": author,
            "date": date_str,
            "theme": theme,
            "output_path": rel_path,
            "blocks": new_blocks,
            "skip_inline_title": True,
            "cover": {"enabled": False, "layout": "none"},
        }
        if footer_text is not None:
            append_spec["footer_text"] = footer_text
        if watermark_cfg is not None:
            append_spec["watermark"] = watermark_cfg
        _attach_design_fields(append_spec)
        try:
            res = generate_pdf_document(
                append_spec,
                workspace_root=workspace_root,
                resolve_path_fn=resolve_path_fn,
                default_author=default_author,
                progress_callback=progress_callback,
                allow_any_workspace_zone=True,
                prepend_all_pages_from=prev_all_tmp,
                global_skills_dir=global_skills_dir,
                save_spec_override={
                    "title": title,
                    "subtitle": subtitle,
                    "author": author,
                    "date": date_str,
                    "theme": theme,
                    "has_cover": bool(existing_spec.get("has_cover")),
                    "preserve_first_page": bool(existing_spec.get("preserve_first_page")),
                    "cover": existing_spec.get("cover"),
                    "footer_text": footer_text,
                    "watermark": watermark_cfg,
                    "design_skill": effective_design_skill,
                    "blocks": combined_blocks,
                    "page_patches": [],
                },
            )
            if pdf_abs.is_file():
                shutil.copy2(pdf_abs, paths["base_pdf"])
            res["edit_action"] = "append_pages"
            return res
        finally:
            prev_all_tmp.unlink(missing_ok=True)

    # 4) Modo `modify`: recompila el cuerpo del documento conservando la portada original (Página 1)
    #    salvo que el usuario/agente haya pedido cambiarla o quitarla explícitamente.
    blocks_to_compile = new_blocks if new_blocks else existing_blocks
    explicit_cover_arg = spec.get("cover")
    explicit_cover_img = spec.get("cover_image") or spec.get("coverImage") or spec.get("portada_imagen")
    override_cover_cfg = (
        spec["design_overrides"].get("cover")
        if has_new_design_overrides and isinstance(spec["design_overrides"].get("cover"), dict)
        else None
    )
    wants_new_or_removed_cover = (
        bool(explicit_cover_img)
        or (isinstance(explicit_cover_arg, bool))
        or (
            isinstance(explicit_cover_arg, dict)
            and (
                explicit_cover_arg.get("enabled") is False
                or bool(explicit_cover_arg.get("image_path") or explicit_cover_arg.get("image") or explicit_cover_arg.get("path"))
                or str(explicit_cover_arg.get("layout") or "").strip().lower() not in ("", "keep")
            )
        )
        or (
            isinstance(override_cover_cfg, dict)
            and ("enabled" in override_cover_cfg or "layout" in override_cover_cfg or "top_band" in override_cover_cfg)
        )
    )
    preserve_first = (
        False
        if wants_new_or_removed_cover
        else (bool(existing_spec.get("preserve_first_page")) or bool(existing_spec.get("has_cover")))
    )
    prepend_cover = paths["cover_pdf"] if (preserve_first and paths["cover_pdf"].is_file()) else None

    modify_spec: Dict[str, Any] = {
        "title": title,
        "subtitle": subtitle,
        "author": author,
        "date": date_str,
        "theme": theme,
        "output_path": rel_path,
        "blocks": blocks_to_compile,
        "skip_inline_title": False if wants_new_or_removed_cover else bool(existing_spec.get("skip_inline_title")),
        "cover": {"enabled": False, "layout": "none"} if prepend_cover else (spec.get("cover") if "cover" in spec else existing_spec.get("cover")),
    }
    if explicit_cover_img:
        modify_spec["cover_image"] = explicit_cover_img
    if footer_text is not None:
        modify_spec["footer_text"] = footer_text
    if watermark_cfg is not None:
        modify_spec["watermark"] = watermark_cfg
    _attach_design_fields(modify_spec)

    res = generate_pdf_document(
        modify_spec,
        workspace_root=workspace_root,
        resolve_path_fn=resolve_path_fn,
        default_author=default_author,
        progress_callback=progress_callback,
        allow_any_workspace_zone=True,
        prepend_first_page_from=prepend_cover,
        global_skills_dir=global_skills_dir,
        save_spec_override=(
            None
            if wants_new_or_removed_cover
            else {
                **modify_spec,
                "has_cover": bool(prepend_cover) or bool(existing_spec.get("has_cover")),
                "preserve_first_page": preserve_first,
                "cover": existing_spec.get("cover"),
                "page_patches": [],
            }
        ),
    )
    if pdf_abs.is_file():
        shutil.copy2(pdf_abs, paths["base_pdf"])
        if replacements_applied > 0 and prepend_cover is not None:
            cover_patches = [
                p for p in page_patches
                if isinstance(p, dict) and int(p.get("page_number") or 0) == 1 and _is_patch_modified(p)
            ]
            if cover_patches:
                apply_page_patches_to_pdf(paths["base_pdf"], pdf_abs, cover_patches)
    res["edit_action"] = "section_updates" if section_updates_applied > 0 and not new_blocks else "modify"
    if section_updates_applied > 0:
        res["section_updates_applied"] = section_updates_applied
    if unmatched_sections:
        res["unmatched_sections"] = unmatched_sections
    return res

