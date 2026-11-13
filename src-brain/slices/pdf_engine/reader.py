"""
Lector estructurado de PDFs para XOOK.
Extrae metadatos, índice, texto por página y tablas estructuradas usando
pdfplumber (MIT) + pypdf (BSD-3-Clause), con fallback OCR local opcional
para páginas escaneadas sin capa de texto.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional

import pdfplumber
from pypdf import PdfReader

from slices.pdf_engine.ocr import ocr_pdf_pages

DEFAULT_MAX_PAGES_PER_CALL = 8
HARD_MAX_PAGES_PER_CALL = 20
MAX_OCR_PAGES_PER_CALL = 6
MAX_TABLES_PER_PAGE = 6
MAX_TABLE_ROWS = 40
MAX_TABLE_COLS = 14


def _clean_cell(val: Any) -> str:
    if val is None:
        return ""
    return " ".join(str(val).replace("\r", " ").split()).strip()


def _clean_extracted_table(raw_table: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(raw_table, list) or not raw_table:
        return None
    cleaned_rows: List[List[str]] = []
    max_cols = 0
    for row in raw_table:
        if not isinstance(row, list):
            continue
        cells = [_clean_cell(c) for c in row[:MAX_TABLE_COLS]]
        if any(cells):
            cleaned_rows.append(cells)
            max_cols = max(max_cols, len(cells))

    if not cleaned_rows or max_cols == 0:
        return None

    normalized = [r + [""] * (max_cols - len(r)) for r in cleaned_rows]
    truncated_rows = len(normalized) > MAX_TABLE_ROWS
    if truncated_rows:
        normalized = normalized[:MAX_TABLE_ROWS]

    headers = normalized[0]
    body_rows = normalized[1:] if len(normalized) > 1 else []
    return {
        "headers": headers,
        "rows": body_rows,
        "row_count": len(body_rows),
        "col_count": max_cols,
        "truncated": truncated_rows,
    }


def _extract_outline_titles(reader: PdfReader, limit: int = 30) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    try:
        outline = getattr(reader, "outline", None)
        if not outline:
            return out
    except Exception:
        return out

    def _walk(items: Any, depth: int = 0) -> None:
        if len(out) >= limit or not isinstance(items, list):
            return
        for item in items:
            if len(out) >= limit:
                break
            if isinstance(item, list):
                _walk(item, depth + 1)
                continue
            title = str(getattr(item, "title", "") or "").strip()
            if not title:
                continue
            page_num: Optional[int] = None
            try:
                idx = reader.get_destination_page_number(item)
                if isinstance(idx, int) and idx >= 0:
                    page_num = idx + 1
            except Exception:
                page_num = None
            entry: Dict[str, Any] = {"title": title[:140], "level": depth + 1}
            if page_num is not None:
                entry["page"] = page_num
            out.append(entry)

    _walk(outline, 0)
    return out


def _open_pypdf_reader(pdf_path: Path) -> PdfReader:
    reader = PdfReader(str(pdf_path))
    if reader.is_encrypted:
        try:
            res = reader.decrypt("")
            if res == 0:
                raise ValueError("El archivo PDF está protegido con contraseña y no se puede leer.")
        except ValueError:
            raise
        except Exception as exc:
            raise ValueError("El archivo PDF está cifrado con contraseña y no se puede leer.") from exc
    return reader


def inspect_pdf_summary(pdf_path: Path) -> Dict[str, Any]:
    """Inspección ligera de metadatos y primeras páginas de un PDF."""
    if not pdf_path.is_file():
        raise FileNotFoundError(f"No existe el archivo PDF: {pdf_path.name}")

    reader = _open_pypdf_reader(pdf_path)
    meta = reader.metadata or {}
    page_count = len(reader.pages)
    sample_chars = 0
    for idx in range(min(page_count, 3)):
        try:
            sample_chars += len((reader.pages[idx].extract_text() or "").strip())
        except Exception:
            pass

    return {
        "file_name": pdf_path.name,
        "size_bytes": pdf_path.stat().st_size,
        "page_count": page_count,
        "title": str(meta.get("/Title") or "").strip() or None,
        "author": str(meta.get("/Author") or "").strip() or None,
        "has_selectable_text": sample_chars >= 20,
    }


def read_pdf_document(
    pdf_path: Path,
    *,
    start_page: int = 1,
    end_page: Optional[int] = None,
    include_tables: bool = True,
    max_chars: int = 24000,
    enable_ocr_fallback: bool = True,
) -> Dict[str, Any]:
    """
    Lee un PDF de forma estructurada y paginada.
    Devuelve metadatos, índice, texto por página y tablas extraídas.
    """
    if not pdf_path.is_file():
        return {"ok": False, "error": f"No existe el archivo PDF: {pdf_path.name}"}

    try:
        pypdf_reader = _open_pypdf_reader(pdf_path)
    except ValueError as err:
        return {"ok": False, "error": str(err)}
    except Exception as exc:
        return {"ok": False, "error": f"No se pudo abrir el PDF ({exc})."}

    total_pages = len(pypdf_reader.pages)
    if total_pages == 0:
        return {
            "ok": True,
            "file_name": pdf_path.name,
            "page_count": 0,
            "pages": [],
            "has_selectable_text": False,
            "warning": "El PDF no contiene páginas.",
        }

    s_page = max(1, min(total_pages, int(start_page or 1)))
    requested_end = int(end_page) if end_page is not None else (s_page + DEFAULT_MAX_PAGES_PER_CALL - 1)
    e_page = max(s_page, min(total_pages, requested_end, s_page + HARD_MAX_PAGES_PER_CALL - 1))
    char_budget = max(2000, min(60000, int(max_chars or 24000)))

    meta = pypdf_reader.metadata or {}
    outline = _extract_outline_titles(pypdf_reader) if s_page == 1 else []

    pages_out: List[Dict[str, Any]] = []
    scanned_candidates: List[int] = []
    total_chars_used = 0
    truncated_by_budget = False
    has_any_text_layer = False

    with pdfplumber.open(str(pdf_path)) as plumber_doc:
        for p_num in range(s_page, e_page + 1):
            p_idx = p_num - 1
            p_page = plumber_doc.pages[p_idx]
            text = ""
            try:
                text = (p_page.extract_text(x_tolerance=2, y_tolerance=3) or "").strip()
            except Exception:
                text = ""

            if not text:
                try:
                    text = (pypdf_reader.pages[p_idx].extract_text() or "").strip()
                except Exception:
                    text = ""

            tables_out: List[Dict[str, Any]] = []
            if include_tables:
                try:
                    raw_tables = p_page.extract_tables() or []
                    for raw_tbl in raw_tables[:MAX_TABLES_PER_PAGE]:
                        cleaned_tbl = _clean_extracted_table(raw_tbl)
                        if cleaned_tbl:
                            tables_out.append(cleaned_tbl)
                except Exception:
                    tables_out = []

            if len(text) >= 25 or tables_out:
                has_any_text_layer = True
            else:
                scanned_candidates.append(p_num)

            pages_out.append({
                "page": p_num,
                "source": "text_layer" if text else "empty",
                "text": text,
                "tables": tables_out,
            })

    # Si hay páginas sin capa de texto (escaneadas), intentar OCR local automático
    ocr_used = False
    if enable_ocr_fallback and scanned_candidates:
        ocr_targets = scanned_candidates[:MAX_OCR_PAGES_PER_CALL]
        ocr_results = ocr_pdf_pages(pdf_path, ocr_targets)
        if ocr_results:
            for p_entry in pages_out:
                p_num = int(p_entry["page"])
                ocr_txt = (ocr_results.get(p_num) or "").strip()
                if ocr_txt and not p_entry["text"]:
                    p_entry["text"] = ocr_txt
                    p_entry["source"] = "ocr"
                    ocr_used = True

    # Aplicar presupuesto de caracteres de manera limpia por página
    final_pages: List[Dict[str, Any]] = []
    for p_entry in pages_out:
        p_txt = p_entry["text"]
        tbl_cost = sum(len(str(t)) for t in p_entry["tables"])
        est_len = len(p_txt) + tbl_cost
        if final_pages and total_chars_used + est_len > char_budget:
            truncated_by_budget = True
            break
        if len(p_txt) > char_budget:
            p_entry = {**p_entry, "text": p_txt[:char_budget] + "\n...[texto recortado por límite]"}
            truncated_by_budget = True
        total_chars_used += len(p_entry["text"]) + tbl_cost
        final_pages.append(p_entry)

    last_delivered_page = int(final_pages[-1]["page"]) if final_pages else s_page - 1
    has_more_pages = last_delivered_page < total_pages
    next_start_page = (last_delivered_page + 1) if has_more_pages else None

    result: Dict[str, Any] = {
        "ok": True,
        "file_name": pdf_path.name,
        "size_bytes": pdf_path.stat().st_size,
        "page_count": total_pages,
        "range_read": {
            "start_page": s_page,
            "end_page": last_delivered_page,
        },
        "has_more_pages": has_more_pages,
        "next_start_page": next_start_page,
        "truncated_by_budget": truncated_by_budget,
        "has_selectable_text": has_any_text_layer,
        "ocr_applied": ocr_used,
        "metadata": {
            "title": str(meta.get("/Title") or "").strip() or None,
            "author": str(meta.get("/Author") or "").strip() or None,
            "subject": str(meta.get("/Subject") or "").strip() or None,
            "creator": str(meta.get("/Creator") or "").strip() or None,
        },
        "pages": final_pages,
    }
    if outline:
        result["outline"] = outline

    if not has_any_text_layer and not ocr_used and any(not p["text"] for p in final_pages):
        result["warning"] = (
            "Este PDF parece escaneado o basado en imágenes sin capa de texto seleccionable y no se pudo "
            "extraer texto automáticamente."
        )
    elif scanned_candidates and len(scanned_candidates) > MAX_OCR_PAGES_PER_CALL and not has_any_text_layer:
        result["warning"] = (
            f"PDF escaneado: se aplicó OCR hasta {MAX_OCR_PAGES_PER_CALL} páginas en este turno. "
            "Pide el siguiente rango de páginas si necesitas continuar."
        )

    return result

