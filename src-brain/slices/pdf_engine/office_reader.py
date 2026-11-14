"""
Lector universal de documentos Office y archivos de texto/datos para XOOK:
- Soporta documentos Word (`.docx`, `.doc`, `.rtf`, `.odt`), PowerPoint (`.pptx`, `.ppt`),
  Excel/Tablas (`.xlsx`, `.xls`, `.csv`, `.tsv`) y archivos de texto/código (`.md`, `.txt`, `.json`, etc.).
- Utiliza exclusivamente librerías estándar de Python (`zipfile`, `xml.etree.ElementTree`, `csv`)
  y capacidades nativas de macOS (`/usr/bin/textutil`) sin dependencias pesadas externas.
"""

from __future__ import annotations

import csv
import io
import json
import re
import subprocess
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


OFFICE_WORD_EXTS = {".docx", ".doc", ".rtf", ".odt"}
OFFICE_PPT_EXTS = {".pptx", ".ppt", ".odp"}
OFFICE_SHEET_EXTS = {".xlsx", ".xls", ".csv", ".tsv", ".ods"}
TEXT_READABLE_EXTS = {
    ".md", ".markdown", ".txt", ".json", ".yaml", ".yml", ".toml",
    ".xml", ".html", ".htm", ".log", ".ini", ".cfg", ".conf",
    ".py", ".js", ".jsx", ".ts", ".tsx", ".rs", ".go", ".java",
    ".c", ".cpp", ".h", ".css", ".scss", ".sql", ".sh", ".zsh",
}


def is_supported_universal_document(ext: str) -> bool:
    e = ext.lower().strip()
    if not e.startswith("."):
        e = f".{e}"
    return (
        e in OFFICE_WORD_EXTS
        or e in OFFICE_PPT_EXTS
        or e in OFFICE_SHEET_EXTS
        or e in TEXT_READABLE_EXTS
    )


def _local_tag(tag: str) -> str:
    if "}" in tag:
        return tag.split("}", 1)[1]
    return tag


def _run_macos_textutil(file_abs: Path) -> Optional[str]:
    """Usa `/usr/bin/textutil` nativo de macOS para extraer texto limpio de .doc, .rtf, .odt, .docx."""
    textutil_bin = Path("/usr/bin/textutil")
    if not textutil_bin.is_file():
        return None
    try:
        proc = subprocess.run(
            [str(textutil_bin), "-convert", "txt", "-stdout", str(file_abs)],
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
        if proc.returncode == 0 and proc.stdout and proc.stdout.strip():
            return proc.stdout.strip()
    except Exception:
        pass
    return None


def _text_to_structured_blocks(text: str) -> List[Dict[str, Any]]:
    """Convierte texto plano o Markdown en bloques estructurados para el visor de documentos."""
    blocks: List[Dict[str, Any]] = []
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    bullet_buf: List[str] = []
    para_buf: List[str] = []

    def flush_bullets() -> None:
        nonlocal bullet_buf
        if bullet_buf:
            blocks.append({"type": "bullets", "items": list(bullet_buf)})
            bullet_buf = []

    def flush_para() -> None:
        nonlocal para_buf
        if para_buf:
            joined = " ".join(para_buf).strip()
            if joined:
                blocks.append({"type": "paragraph", "text": joined})
            para_buf = []

    for raw in lines:
        s = raw.strip()
        if not s:
            flush_bullets()
            flush_para()
            continue

        md_h = re.match(r"^(#{1,4})\s+(.+)$", s)
        if md_h:
            flush_bullets()
            flush_para()
            blocks.append({
                "type": "heading",
                "level": min(3, len(md_h.group(1))),
                "text": md_h.group(2).strip(),
            })
            continue

        bullet_m = re.match(r"^(?:[-*•▪‣]|\d+[.)])\s+(.+)$", s)
        if bullet_m:
            flush_para()
            bullet_buf.append(bullet_m.group(1).strip())
            continue

        # Detectar encabezados cortos en mayúsculas o numerados tipo "1. INTRODUCCIÓN"
        if len(s) <= 85 and not s.endswith(".") and (
            (s.isupper() and len(s) >= 4)
            or re.match(r"^(?:CAP[ÍI]TULO|SECCI[ÓO]N|TEMA|PARTE|UNIDAD)\s+\d+", s, re.IGNORECASE)
        ):
            flush_bullets()
            flush_para()
            blocks.append({"type": "heading", "level": 2, "text": s})
            continue

        flush_bullets()
        para_buf.append(s)

    flush_bullets()
    flush_para()
    return blocks


def _extract_docx(file_abs: Path) -> Dict[str, Any]:
    """Extrae párrafos, títulos y tablas de un archivo Word `.docx` vía XML nativo."""
    blocks: List[Dict[str, Any]] = []
    md_lines: List[str] = []
    tables_count = 0

    try:
        with zipfile.ZipFile(file_abs, "r") as zf:
            if "word/document.xml" not in zf.namelist():
                raise ValueError("No contiene word/document.xml")
            xml_bytes = zf.read("word/document.xml")
            root = ET.fromstring(xml_bytes)

            body = None
            for elem in root.iter():
                if _local_tag(elem.tag) == "body":
                    body = elem
                    break
            if body is None:
                body = root

            bullet_buf: List[str] = []

            def flush_bullets() -> None:
                nonlocal bullet_buf
                if bullet_buf:
                    blocks.append({"type": "bullets", "items": list(bullet_buf)})
                    for b in bullet_buf:
                        md_lines.append(f"- {b}")
                    md_lines.append("")
                    bullet_buf = []

            for child in list(body):
                ctag = _local_tag(child.tag)
                if ctag == "p":
                    style_val = ""
                    is_list = False
                    for sub in child.iter():
                        stag = _local_tag(sub.tag)
                        if stag == "pStyle":
                            for k, v in sub.attrib.items():
                                if _local_tag(k) == "val":
                                    style_val = str(v)
                        elif stag == "numPr":
                            is_list = True

                    runs: List[str] = []
                    for sub in child.iter():
                        stag = _local_tag(sub.tag)
                        if stag == "t" and sub.text:
                            runs.append(sub.text)
                        elif stag == "tab":
                            runs.append("\t")
                        elif stag in ("br", "cr"):
                            runs.append("\n")

                    para_text = "".join(runs).strip()
                    if not para_text:
                        continue

                    style_low = style_val.lower()
                    if "heading" in style_low or "titulo" in style_low or "title" in style_low:
                        flush_bullets()
                        lvl = 1
                        if "2" in style_low or "sub" in style_low:
                            lvl = 2
                        elif "3" in style_low or "4" in style_low:
                            lvl = 3
                        blocks.append({"type": "heading", "level": lvl, "text": para_text})
                        md_lines.append(f"{'#' * lvl} {para_text}")
                        md_lines.append("")
                    elif is_list or "list" in style_low:
                        bullet_buf.append(para_text)
                    else:
                        flush_bullets()
                        if len(para_text) <= 80 and para_text.isupper() and len(para_text) >= 4:
                            blocks.append({"type": "heading", "level": 2, "text": para_text})
                            md_lines.append(f"## {para_text}")
                        else:
                            blocks.append({"type": "paragraph", "text": para_text})
                            md_lines.append(para_text)
                        md_lines.append("")

                elif ctag == "tbl":
                    flush_bullets()
                    rows_data: List[List[str]] = []
                    for tr in child:
                        if _local_tag(tr.tag) != "tr":
                            continue
                        row_cells: List[str] = []
                        for tc in tr:
                            if _local_tag(tc.tag) != "tc":
                                continue
                            cell_texts: List[str] = []
                            for p in tc.iter():
                                if _local_tag(p.tag) == "p":
                                    p_runs = [
                                        t.text for t in p.iter()
                                        if _local_tag(t.tag) == "t" and t.text
                                    ]
                                    line_str = "".join(p_runs).strip()
                                    if line_str:
                                        cell_texts.append(line_str)
                            row_cells.append(" / ".join(cell_texts))
                        if any(c.strip() for c in row_cells):
                            rows_data.append(row_cells)

                    if rows_data:
                        tables_count += 1
                        headers = rows_data[0]
                        body_rows = rows_data[1:] if len(rows_data) > 1 else []
                        blocks.append({
                            "type": "table",
                            "headers": headers,
                            "rows": body_rows,
                        })
                        md_lines.append("| " + " | ".join(headers) + " |")
                        md_lines.append("| " + " | ".join(["---"] * len(headers)) + " |")
                        for r in body_rows:
                            padded = (r + [""] * len(headers))[:len(headers)]
                            md_lines.append("| " + " | ".join(padded) + " |")
                        md_lines.append("")

            flush_bullets()
    except Exception:
        fallback = _run_macos_textutil(file_abs)
        if fallback:
            blocks = _text_to_structured_blocks(fallback)
            md_lines = [fallback]

    full_text = "\n".join(md_lines).strip()
    if not full_text:
        fallback = _run_macos_textutil(file_abs) or ""
        full_text = fallback
        if fallback and not blocks:
            blocks = _text_to_structured_blocks(fallback)

    return {
        "doc_kind": "word",
        "format_label": file_abs.suffix.upper().lstrip(".") or "DOCX",
        "blocks": blocks,
        "markdown": full_text,
        "text": full_text,
        "tables_count": tables_count,
    }


def _extract_legacy_word_or_rtf(file_abs: Path) -> Dict[str, Any]:
    """Extrae texto y bloques de archivos `.doc`, `.rtf` o `.odt`."""
    txt = _run_macos_textutil(file_abs)
    if not txt:
        raw = file_abs.read_bytes()
        try:
            txt = raw.decode("utf-8", errors="ignore")
        except Exception:
            txt = raw.decode("latin-1", errors="ignore")
        # Si es binario antiguo .doc, filtrar cadenas legibles
        if "\x00" in txt:
            chunks = re.findall(r"[\x20-\x7EÁÉÍÓÚáéíóúÑñÜü¿¡]{5,}", txt)
            txt = "\n".join(chunks)

    txt = (txt or "").strip()
    blocks = _text_to_structured_blocks(txt) if txt else []
    return {
        "doc_kind": "word",
        "format_label": file_abs.suffix.upper().lstrip(".") or "DOC",
        "blocks": blocks,
        "markdown": txt,
        "text": txt,
        "tables_count": 0,
    }


def _extract_pptx(file_abs: Path) -> Dict[str, Any]:
    """Extrae todas las diapositivas, textos, tablas y notas de un archivo `.pptx`."""
    slides: List[Dict[str, Any]] = []
    md_lines: List[str] = []

    try:
        with zipfile.ZipFile(file_abs, "r") as zf:
            names = zf.namelist()
            slide_files: List[Tuple[int, str]] = []
            for name in names:
                m = re.match(r"^ppt/slides/slide(\d+)\.xml$", name)
                if m:
                    slide_files.append((int(m.group(1)), name))
            slide_files.sort(key=lambda x: x[0])

            for slide_num, slide_path in slide_files:
                xml_bytes = zf.read(slide_path)
                root = ET.fromstring(xml_bytes)

                slide_title = ""
                bullets: List[str] = []
                tables: List[Dict[str, Any]] = []

                for elem in root:
                    for sub in elem.iter():
                        stag = _local_tag(sub.tag)
                        if stag == "sp":
                            is_title = False
                            for ph in sub.iter():
                                if _local_tag(ph.tag) == "ph":
                                    ph_type = ph.attrib.get("type", "").lower()
                                    if ph_type in ("title", "ctrtitle"):
                                        is_title = True
                            sp_paras: List[str] = []
                            for p in sub.iter():
                                if _local_tag(p.tag) == "p":
                                    runs = [
                                        t.text for t in p.iter()
                                        if _local_tag(t.tag) == "t" and t.text
                                    ]
                                    line = "".join(runs).strip()
                                    if line:
                                        sp_paras.append(line)
                            if sp_paras:
                                if is_title and not slide_title:
                                    slide_title = sp_paras[0]
                                    bullets.extend(sp_paras[1:])
                                elif not slide_title and len(bullets) == 0 and len(sp_paras[0]) <= 90:
                                    slide_title = sp_paras[0]
                                    bullets.extend(sp_paras[1:])
                                else:
                                    bullets.extend(sp_paras)

                        elif stag == "tbl":
                            t_rows: List[List[str]] = []
                            for tr in sub:
                                if _local_tag(tr.tag) != "tr":
                                    continue
                                r_cells: List[str] = []
                                for tc in tr:
                                    if _local_tag(tc.tag) != "tc":
                                        continue
                                    c_runs = [
                                        t.text for t in tc.iter()
                                        if _local_tag(t.tag) == "t" and t.text
                                    ]
                                    r_cells.append(" ".join("".join(c_runs).split()))
                                if any(c.strip() for c in r_cells):
                                    t_rows.append(r_cells)
                            if t_rows:
                                tables.append({
                                    "headers": t_rows[0],
                                    "rows": t_rows[1:] if len(t_rows) > 1 else [],
                                })

                # Notas del orador si existen
                notes_text = ""
                notes_path = f"ppt/notesSlides/notesSlide{slide_num}.xml"
                if notes_path in names:
                    try:
                        n_root = ET.fromstring(zf.read(notes_path))
                        n_lines: List[str] = []
                        for p in n_root.iter():
                            if _local_tag(p.tag) == "p":
                                runs = [
                                    t.text for t in p.iter()
                                    if _local_tag(t.tag) == "t" and t.text
                                ]
                                ln = "".join(runs).strip()
                                if ln and not ln.isdigit():
                                    n_lines.append(ln)
                        notes_text = "\n".join(n_lines).strip()
                    except Exception:
                        pass

                # Deduplicar líneas consecutivas idénticas
                clean_bullets: List[str] = []
                for b in bullets:
                    if b != slide_title and (not clean_bullets or clean_bullets[-1] != b):
                        clean_bullets.append(b)

                if not slide_title:
                    slide_title = f"Diapositiva {slide_num}"

                slides.append({
                    "slide_number": slide_num,
                    "title": slide_title,
                    "bullets": clean_bullets,
                    "tables": tables,
                    "notes": notes_text,
                })

                md_lines.append(f"## Diapositiva {slide_num}: {slide_title}")
                for b in clean_bullets:
                    md_lines.append(f"- {b}")
                for tbl in tables:
                    headers = tbl.get("headers") or []
                    if headers:
                        md_lines.append("| " + " | ".join(headers) + " |")
                        md_lines.append("| " + " | ".join(["---"] * len(headers)) + " |")
                        for r in tbl.get("rows") or []:
                            padded = (r + [""] * len(headers))[:len(headers)]
                            md_lines.append("| " + " | ".join(padded) + " |")
                if notes_text:
                    md_lines.append(f"> Notas: {notes_text}")
                md_lines.append("")
    except Exception as exc:
        return {
            "doc_kind": "presentation",
            "format_label": file_abs.suffix.upper().lstrip(".") or "PPTX",
            "slides": [{
                "slide_number": 1,
                "title": file_abs.stem,
                "bullets": [f"No se pudo descomprimir la presentación: {exc}"],
                "tables": [],
                "notes": "",
            }],
            "markdown": "",
            "text": "",
        }

    full_md = "\n".join(md_lines).strip()
    return {
        "doc_kind": "presentation",
        "format_label": file_abs.suffix.upper().lstrip(".") or "PPTX",
        "slides": slides,
        "page_count": max(1, len(slides)),
        "markdown": full_md,
        "text": full_md,
    }


def _col_letters_to_index(cell_ref: str) -> int:
    """Convierte una referencia de celda Excel ('A1', 'BC12') en índice 0-based de columna."""
    letters = "".join(ch for ch in cell_ref if ch.isalpha()).upper()
    if not letters:
        return 0
    idx = 0
    for ch in letters:
        idx = idx * 26 + (ord(ch) - ord("A") + 1)
    return max(0, idx - 1)


def _extract_xlsx(file_abs: Path, max_rows_per_sheet: int = 250) -> Dict[str, Any]:
    """Extrae hojas y celdas de un libro Excel `.xlsx` sin dependencias pesadas."""
    sheets: List[Dict[str, Any]] = []
    md_lines: List[str] = []

    try:
        with zipfile.ZipFile(file_abs, "r") as zf:
            names = set(zf.namelist())
            shared_strings: List[str] = []
            if "xl/sharedStrings.xml" in names:
                ss_root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
                for si in ss_root:
                    if _local_tag(si.tag) == "si":
                        parts = [
                            t.text for t in si.iter()
                            if _local_tag(t.tag) == "t" and t.text is not None
                        ]
                        shared_strings.append("".join(parts))

            # Resolver nombres de hojas y rutas
            sheet_entries: List[Tuple[str, str]] = []
            rels_map: Dict[str, str] = {}
            if "xl/_rels/workbook.xml.rels" in names:
                rels_root = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
                for rel in rels_root:
                    if _local_tag(rel.tag) == "Relationship":
                        rid = rel.attrib.get("Id", "")
                        target = rel.attrib.get("Target", "").lstrip("/")
                        if target and not target.startswith("xl/"):
                            target = f"xl/{target}"
                        if rid and target:
                            rels_map[rid] = target

            if "xl/workbook.xml" in names:
                wb_root = ET.fromstring(zf.read("xl/workbook.xml"))
                for elem in wb_root.iter():
                    if _local_tag(elem.tag) == "sheet":
                        s_name = elem.attrib.get("name") or "Hoja"
                        rid = ""
                        for k, v in elem.attrib.items():
                            if _local_tag(k) == "id":
                                rid = v
                        target_path = rels_map.get(rid, "")
                        if target_path in names:
                            sheet_entries.append((s_name, target_path))

            if not sheet_entries:
                for name in sorted(names):
                    if re.match(r"^xl/worksheets/sheet\d+\.xml$", name):
                        sheet_entries.append((Path(name).stem.capitalize(), name))

            for sheet_name, xml_path in sheet_entries:
                ws_root = ET.fromstring(zf.read(xml_path))
                raw_rows: List[List[str]] = []
                total_rows_seen = 0
                max_cols = 0

                for elem in ws_root.iter():
                    if _local_tag(elem.tag) != "row":
                        continue
                    total_rows_seen += 1
                    if len(raw_rows) >= max_rows_per_sheet:
                        continue

                    row_map: Dict[int, str] = {}
                    cur_col = 0
                    for cell in elem:
                        if _local_tag(cell.tag) != "c":
                            continue
                        ref = cell.attrib.get("r", "")
                        col_idx = _col_letters_to_index(ref) if ref else cur_col
                        cur_col = col_idx + 1
                        c_type = cell.attrib.get("t", "")

                        val_str = ""
                        if c_type == "inlineStr":
                            t_parts = [
                                t.text for t in cell.iter()
                                if _local_tag(t.tag) == "t" and t.text is not None
                            ]
                            val_str = "".join(t_parts)
                        else:
                            v_node = None
                            for sub in cell:
                                if _local_tag(sub.tag) == "v":
                                    v_node = sub
                                    break
                            if v_node is not None and v_node.text is not None:
                                raw_v = v_node.text.strip()
                                if c_type == "s":
                                    try:
                                        s_idx = int(raw_v)
                                        val_str = shared_strings[s_idx] if 0 <= s_idx < len(shared_strings) else raw_v
                                    except Exception:
                                        val_str = raw_v
                                elif c_type == "b":
                                    val_str = "TRUE" if raw_v == "1" else "FALSE"
                                else:
                                    val_str = raw_v

                        if val_str != "":
                            row_map[col_idx] = val_str

                    if row_map:
                        row_width = min(40, max(row_map.keys()) + 1)
                        max_cols = max(max_cols, row_width)
                        row_list = [row_map.get(i, "") for i in range(row_width)]
                        raw_rows.append(row_list)

                if raw_rows and max_cols > 0:
                    normalized_rows = [
                        (r + [""] * max_cols)[:max_cols]
                        for r in raw_rows
                    ]
                    headers = [
                        h.strip() if h.strip() else f"Col {idx + 1}"
                        for idx, h in enumerate(normalized_rows[0])
                    ]
                    body_rows = normalized_rows[1:]
                else:
                    headers = []
                    body_rows = []

                sheets.append({
                    "name": sheet_name,
                    "headers": headers,
                    "rows": body_rows,
                    "total_rows": max(0, total_rows_seen - 1),
                    "truncated": total_rows_seen > max_rows_per_sheet,
                })

                md_lines.append(f"## Hoja: {sheet_name}")
                if headers:
                    md_lines.append("| " + " | ".join(headers) + " |")
                    md_lines.append("| " + " | ".join(["---"] * len(headers)) + " |")
                    for r in body_rows[:60]:
                        md_lines.append("| " + " | ".join(r) + " |")
                md_lines.append("")
    except Exception as exc:
        return {
            "doc_kind": "spreadsheet",
            "format_label": file_abs.suffix.upper().lstrip(".") or "XLSX",
            "sheets": [{
                "name": "Hoja 1",
                "headers": ["Aviso"],
                "rows": [[f"No se pudo leer la hoja de cálculo: {exc}"]],
                "total_rows": 1,
                "truncated": False,
            }],
            "markdown": "",
            "text": "",
        }

    full_md = "\n".join(md_lines).strip()
    return {
        "doc_kind": "spreadsheet",
        "format_label": file_abs.suffix.upper().lstrip(".") or "XLSX",
        "sheets": sheets,
        "page_count": max(1, len(sheets)),
        "markdown": full_md,
        "text": full_md,
    }


def _extract_csv_or_tsv(file_abs: Path, max_rows: int = 300) -> Dict[str, Any]:
    """Parsea archivos `.csv` o `.tsv` en una tabla estructurada y legible."""
    raw_bytes = file_abs.read_bytes()
    try:
        raw_text = raw_bytes.decode("utf-8-sig")
    except Exception:
        raw_text = raw_bytes.decode("latin-1", errors="replace")

    ext = file_abs.suffix.lower()
    delimiter = "\t" if ext == ".tsv" else ","
    sample = raw_text[:4096]
    if ext != ".tsv":
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
            delimiter = dialect.delimiter
        except Exception:
            if sample.count(";") > sample.count(","):
                delimiter = ";"

    reader = csv.reader(io.StringIO(raw_text), delimiter=delimiter)
    all_rows: List[List[str]] = []
    total_rows = 0
    max_cols = 0

    for row in reader:
        if not any(cell.strip() for cell in row):
            continue
        total_rows += 1
        if len(all_rows) < max_rows + 1:
            trimmed = [c.strip() for c in row[:40]]
            max_cols = max(max_cols, len(trimmed))
            all_rows.append(trimmed)

    if all_rows and max_cols > 0:
        norm = [(r + [""] * max_cols)[:max_cols] for r in all_rows]
        headers = [h if h else f"Col {i + 1}" for i, h in enumerate(norm[0])]
        body_rows = norm[1:]
    else:
        headers = []
        body_rows = []

    sheet = {
        "name": file_abs.stem,
        "headers": headers,
        "rows": body_rows,
        "total_rows": max(0, total_rows - 1),
        "truncated": total_rows > (max_rows + 1),
    }

    return {
        "doc_kind": "spreadsheet",
        "format_label": ext.upper().lstrip(".") or "CSV",
        "sheets": [sheet],
        "page_count": 1,
        "markdown": raw_text[:24000],
        "text": raw_text[:24000],
    }


def read_universal_document(file_abs: Path, rel_path: str = "") -> Dict[str, Any]:
    """
    Lee cualquier documento Office (`.docx`, `.doc`, `.pptx`, `.ppt`, `.xlsx`, `.xls`, `.rtf`, `.odt`)
    o archivo legible (`.csv`, `.tsv`, `.md`, `.txt`, `.json`, código, etc.) y devuelve una
    estructura unificada lista para el visor de documentos y para las herramientas de Xox.
    """
    if not file_abs.is_file():
        return {"ok": False, "error": f"Archivo no encontrado: {rel_path or file_abs.name}"}

    ext = file_abs.suffix.lower()
    size_bytes = file_abs.stat().st_size
    title = file_abs.stem.replace("_", " ").replace("-", " ").strip() or file_abs.name

    if ext == ".docx":
        parsed = _extract_docx(file_abs)
    elif ext in (".doc", ".rtf", ".odt"):
        parsed = _extract_legacy_word_or_rtf(file_abs)
    elif ext in OFFICE_PPT_EXTS:
        parsed = _extract_pptx(file_abs)
    elif ext in (".xlsx", ".xls", ".ods"):
        parsed = _extract_xlsx(file_abs)
    elif ext in (".csv", ".tsv"):
        parsed = _extract_csv_or_tsv(file_abs)
    else:
        raw_bytes = file_abs.read_bytes()
        try:
            text_content = raw_bytes.decode("utf-8")
        except Exception:
            text_content = raw_bytes.decode("latin-1", errors="replace")

        if ext == ".json":
            try:
                obj = json.loads(text_content)
                text_content = json.dumps(obj, indent=2, ensure_ascii=False)
            except Exception:
                pass

        is_md = ext in (".md", ".markdown")
        is_txt = ext in (".txt", ".log")
        blocks = _text_to_structured_blocks(text_content[:48000]) if (is_md or is_txt) else []
        parsed = {
            "doc_kind": "markdown" if is_md else ("text" if is_txt else "code"),
            "format_label": ext.upper().lstrip(".") or "TXT",
            "blocks": blocks,
            "markdown": text_content[:64000],
            "text": text_content[:64000],
        }

    return {
        "ok": True,
        "path": rel_path or file_abs.name,
        "filename": file_abs.name,
        "title": title,
        "size_bytes": size_bytes,
        "page_count": int(parsed.get("page_count") or 1),
        **parsed,
    }
