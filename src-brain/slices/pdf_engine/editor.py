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
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

import pdfplumber
import pypdfium2 as pdfium
from pypdf import PdfReader, PdfWriter
from reportlab.lib import colors
from reportlab.lib.utils import simpleSplit
from reportlab.pdfgen import canvas as rl_canvas

from slices.pdf_engine.generator import (
    _FONT_FAMILY,
    _ensure_fonts,
    _normalize_blocks_input,
    _parse_markdown_to_blocks,
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
        elif btype == "divider":
            lines.append("---")
            lines.append("")
    return "\n".join(lines).strip()


def save_pdf_spec_metadata(
    workspace_root: Path,
    rel_path: str,
    spec_data: Dict[str, Any],
    pdf_abs: Optional[Path] = None,
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

        payload: Dict[str, Any] = {
            "path": rel_path,
            "title": str(spec_data.get("title") or existing.get("title") or "Documento XOOK").strip(),
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
            "blocks": blocks,
            "page_patches": (
                spec_data.get("page_patches")
                if isinstance(spec_data.get("page_patches"), list)
                else (existing.get("page_patches") if isinstance(existing.get("page_patches"), list) else [])
            ),
        }
        paths["json"].write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

        if pdf_abs and pdf_abs.is_file():
            try:
                if not paths["base_pdf"].is_file():
                    shutil.copy2(pdf_abs, paths["base_pdf"])
                reader = PdfReader(str(pdf_abs))
                if len(reader.pages) >= 1 and (payload["has_cover"] or payload["preserve_first_page"]):
                    if not paths["cover_pdf"].is_file():
                        writer = PdfWriter()
                        writer.add_page(reader.pages[0])
                        with open(paths["cover_pdf"], "wb") as f:
                            writer.write(f)
            except Exception:
                pass
    except Exception:
        pass


_HEADER_FOOTER_RE = re.compile(
    r"^(?:XOOK(?:\s*·.*)?|P[áa]gina\s+\d+\s+de\s+\d+|XOOK\s*·.*P[áa]gina\s+\d+\s+de\s+\d+)$",
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
    if pdf_abs.is_file() and not paths["base_pdf"].is_file():
        try:
            shutil.copy2(pdf_abs, paths["base_pdf"])
        except Exception:
            pass

    source_for_boxes = paths["base_pdf"] if paths["base_pdf"].is_file() else pdf_abs
    base_interactive_items = _extract_interactive_text_items(source_for_boxes)

    summary = inspect_pdf_summary(pdf_abs)
    page_count = int(summary.get("page_count") or 1)

    if paths["json"].is_file():
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
            blocks = [{"type": "paragraph", "text": str(payload.get("title") or "Documento XOOK")}]

        preserve_first = bool(payload.get("preserve_first_page"))
        prepend_cover_path = paths["cover_pdf"] if (preserve_first and paths["cover_pdf"].is_file()) else None

        gen_spec: Dict[str, Any] = {
            "title": str(payload.get("title") or pdf_abs.stem).strip() or "Documento XOOK",
            "subtitle": str(payload.get("subtitle") or "").strip(),
            "author": str(payload.get("author") or "").strip(),
            "date": str(payload.get("date") or "").strip(),
            "theme": str(payload.get("theme") or "executive").strip().lower(),
            "output_path": rel_path,
            "blocks": blocks,
            "skip_inline_title": bool(payload.get("skip_inline_title")),
            "cover": {"enabled": False} if prepend_cover_path else payload.get("cover"),
        }

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


def _find_existing_pdf_in_workspace(
    workspace_root: Path,
    raw_ref: str,
    resolve_path_fn: Callable,
) -> Optional[Tuple[Path, str]]:
    """Resuelve una referencia a un PDF existente del workspace por ruta exacta o por nombre de archivo."""
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

    target_name = Path(clean_ref_pdf).name.lower()
    for search_sub in ("agente/reportes", "agente", "context", ""):
        base_dir = (workspace_root / search_sub) if search_sub else workspace_root
        if not base_dir.is_dir():
            continue
        try:
            for found in base_dir.rglob("*.pdf"):
                if ".xook" in found.parts or "node_modules" in found.parts or "target" in found.parts:
                    continue
                if found.name.lower() == target_name:
                    rel_found = found.resolve().relative_to(workspace_root.resolve()).as_posix()
                    return found.resolve(), rel_found
        except Exception:
            pass
    return None


def modify_or_append_pdf_by_agent(
    workspace_root: Path,
    spec: Dict[str, Any],
    *,
    resolve_path_fn: Callable,
    default_author: Optional[str] = None,
    progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> Dict[str, Any]:
    """
    Permite a Xox modificar un PDF existente o agregarle nuevas páginas (`append_pages`)
    conservando la misma tipografía (`_FONT_FAMILY`), estilo visual (`theme`), encabezados,
    pies de página y portada original.
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
        )

    pdf_abs, rel_path = resolved_pair
    paths = get_spec_paths(workspace_root, rel_path)
    existing_spec = load_pdf_editable_spec(workspace_root, pdf_abs, rel_path)

    # Heredar diseño, tipografía y metadatos del PDF existente para mantener coherencia total
    theme = str(spec.get("theme") or existing_spec.get("theme") or "executive").strip().lower()
    title = str(spec.get("title") or existing_spec.get("title") or pdf_abs.stem).strip() or "Documento XOOK"
    subtitle = str(
        spec.get("subtitle") if "subtitle" in spec else (existing_spec.get("subtitle") or "")
    ).strip()
    author = str(
        spec.get("author") or spec.get("company") or existing_spec.get("author") or default_author or ""
    ).strip()
    date_str = str(spec.get("date") or existing_spec.get("date") or "").strip()

    edit_action = str(spec.get("edit_action") or spec.get("mode") or "").strip().lower()
    is_append = bool(spec.get("append_pages")) or edit_action in (
        "append_pages",
        "add_pages",
        "append",
        "agregar_paginas",
        "agregar",
    )

    # 1) Aplicar reemplazos puntuales sobre cajas de texto (`replacements`) si fueron indicados
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
                if find_txt in cur_t:
                    patch["text"] = cur_t.replace(find_txt, replace_txt)
                    replacements_applied += 1
                elif find_txt.lower() in cur_t.lower():
                    pattern = re.compile(re.escape(find_txt), re.IGNORECASE)
                    patch["text"] = pattern.sub(replace_txt, cur_t)
                    replacements_applied += 1

    new_blocks, _ = _normalize_blocks_input(spec)

    # 2) Modo `append_pages`: conserva intactas todas las páginas actuales (1..N) y agrega
    #    las páginas nuevas (N+1..N+K) con la misma tipografía, paleta y numeración continua.
    if is_append and new_blocks:
        if replacements_applied > 0:
            modified_only = [p for p in page_patches if isinstance(p, dict) and _is_patch_modified(p)]
            if modified_only and paths["base_pdf"].is_file():
                apply_page_patches_to_pdf(paths["base_pdf"], pdf_abs, modified_only)

        prev_all_tmp = paths["base_pdf"].with_name(f"{paths['base_pdf'].stem}.prev_all.pdf")
        shutil.copy2(pdf_abs, prev_all_tmp)
        prev_blocks = list(existing_spec.get("blocks") or [])
        combined_blocks = prev_blocks + [{"type": "page_break"}] + new_blocks

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
        try:
            res = generate_pdf_document(
                append_spec,
                workspace_root=workspace_root,
                resolve_path_fn=resolve_path_fn,
                default_author=default_author,
                progress_callback=progress_callback,
                allow_any_workspace_zone=True,
                prepend_all_pages_from=prev_all_tmp,
                save_spec_override={
                    "title": title,
                    "subtitle": subtitle,
                    "author": author,
                    "date": date_str,
                    "theme": theme,
                    "has_cover": bool(existing_spec.get("has_cover")),
                    "preserve_first_page": bool(existing_spec.get("preserve_first_page")),
                    "cover": existing_spec.get("cover"),
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

    # 3) Si solo enviaron `replacements` sin bloques nuevos, estampar los parches directamente
    if replacements_applied > 0 and not new_blocks:
        saved = save_edited_pdf_document(
            workspace_root,
            pdf_abs,
            rel_path,
            {"patches_only": True, "page_patches": page_patches},
            resolve_path_fn,
        )
        saved["edit_action"] = "replacements"
        return saved

    # 4) Modo `modify`: recompila el cuerpo del documento conservando la portada original (Página 1)
    #    y siguiendo la misma tipografía y estilo visual (`theme`).
    blocks_to_compile = new_blocks if new_blocks else list(existing_spec.get("blocks") or [])
    preserve_first = bool(existing_spec.get("preserve_first_page")) or bool(existing_spec.get("has_cover"))
    prepend_cover = paths["cover_pdf"] if (preserve_first and paths["cover_pdf"].is_file()) else None

    modify_spec: Dict[str, Any] = {
        "title": title,
        "subtitle": subtitle,
        "author": author,
        "date": date_str,
        "theme": theme,
        "output_path": rel_path,
        "blocks": blocks_to_compile,
        "skip_inline_title": bool(existing_spec.get("skip_inline_title")),
        "cover": {"enabled": False, "layout": "none"} if prepend_cover else (spec.get("cover") or existing_spec.get("cover")),
    }
    res = generate_pdf_document(
        modify_spec,
        workspace_root=workspace_root,
        resolve_path_fn=resolve_path_fn,
        default_author=default_author,
        progress_callback=progress_callback,
        allow_any_workspace_zone=True,
        prepend_first_page_from=prepend_cover,
        save_spec_override={
            **modify_spec,
            "has_cover": bool(prepend_cover) or bool(existing_spec.get("has_cover")),
            "preserve_first_page": preserve_first,
            "cover": existing_spec.get("cover"),
            "page_patches": [],
        },
    )
    if pdf_abs.is_file():
        shutil.copy2(pdf_abs, paths["base_pdf"])
        if replacements_applied > 0:
            cover_patches = [
                p for p in page_patches
                if isinstance(p, dict) and int(p.get("page_number") or 0) == 1 and _is_patch_modified(p)
            ]
            if cover_patches:
                apply_page_patches_to_pdf(paths["base_pdf"], pdf_abs, cover_patches)
    res["edit_action"] = "modify"
    return res

