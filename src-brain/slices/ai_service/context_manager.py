"""
XOOK Context Window & Auto-Compaction Engine
Gestiona:
1. Contexto aislado por ventana de documento (`.xook/doc_contexts/<hash>.json`),
   evitando que el feedback largo sobre un documento se mezcle con otros chats o documentos.
2. Inyección automática de la verdad actual del documento en disco (encabezados reales,
   secciones, tema, conteo de páginas y snapshot compacto).
3. Compactación automática y manual (`/compact`) estilo Claude Code / Antigravity:
   condensa turnos antiguos en un Checkpoint estructurado resolviendo contradicciones
   (conserva decisiones vigentes, marca instrucciones descartadas para no repetirlas
   y preserva siempre las reglas fijadas).
4. Poda inteligente de salidas repetidas de herramientas dentro de loops multi-paso.
"""

from __future__ import annotations

import hashlib
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple


# Umbrales de auto-compactación preventiva
DOC_AUTO_COMPACT_MIN_TURNS = 8          # 4 rondas de feedback usuario+Xox en un documento
DOC_AUTO_COMPACT_KEEP_RECENT = 4        # conservar últimos 2 intercambios literales
DOC_AUTO_COMPACT_TOKEN_TRIGGER = 4200   # o cuando el historial del doc supere ~4.2k tokens

CHAT_AUTO_COMPACT_MIN_TURNS = 14        # 7 rondas en chat general
CHAT_AUTO_COMPACT_KEEP_RECENT = 6       # conservar últimos 3 intercambios literales
CHAT_AUTO_COMPACT_CONTEXT_RATIO = 0.58  # o al superar 58% de la ventana efectiva del modelo
CHAT_AUTO_COMPACT_TOKEN_CAP = 28000     # tope práctico antes de degradación "lost in the middle"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def estimate_tokens(text: Any) -> int:
    """Estimación conservadora de tokens (~3.6 caracteres por token en español/Markdown/JSON)."""
    if text is None:
        return 0
    if not isinstance(text, str):
        try:
            text = json.dumps(text, ensure_ascii=False)
        except Exception:
            text = str(text)
    if not text:
        return 0
    return max(1, int(len(text) / 3.6 + 0.99))


def estimate_turns_tokens(turns: List[Dict[str, Any]]) -> int:
    total = 0
    for msg in turns or []:
        if not isinstance(msg, dict):
            continue
        total += 6 + estimate_tokens(msg.get("content") or "")
    return total


def normalize_doc_rel_path(rel_path: str) -> str:
    return str(rel_path or "").strip().replace("\\", "/").lstrip("./")


def _doc_context_dir(workspace_root: Path) -> Path:
    d = workspace_root / ".xook" / "doc_contexts"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _doc_context_key(rel_path: str) -> str:
    norm = normalize_doc_rel_path(rel_path).lower()
    return hashlib.sha1(norm.encode("utf-8")).hexdigest()[:16]


def _doc_context_file(workspace_root: Path, rel_path: str) -> Path:
    return _doc_context_dir(workspace_root) / f"{_doc_context_key(rel_path)}.json"


def _empty_doc_context(rel_path: str, title: str = "", file_kind: str = "pdf") -> Dict[str, Any]:
    norm = normalize_doc_rel_path(rel_path)
    return {
        "path": norm,
        "title": title or Path(norm).name or "Documento",
        "file_kind": file_kind or "pdf",
        "revision": 0,
        "pinned_rules": [],
        "checkpoint": None,
        "recent_turns": [],
        "total_turns_recorded": 0,
        "updated_at": _utc_now_iso(),
    }


def load_document_context(
    workspace_root: Optional[Path],
    rel_path: str,
    *,
    title: str = "",
    file_kind: str = "pdf",
) -> Dict[str, Any]:
    """Carga el contexto aislado persistido de un documento (o devuelve uno nuevo vacío)."""
    norm = normalize_doc_rel_path(rel_path)
    if workspace_root is None or not norm:
        return _empty_doc_context(norm, title=title, file_kind=file_kind)
    path = _doc_context_file(workspace_root, norm)
    if path.is_file():
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                base = _empty_doc_context(norm, title=title, file_kind=file_kind)
                base.update(raw)
                base["path"] = norm
                if title:
                    base["title"] = title
                if file_kind:
                    base["file_kind"] = file_kind
                if not isinstance(base.get("pinned_rules"), list):
                    base["pinned_rules"] = []
                if not isinstance(base.get("recent_turns"), list):
                    base["recent_turns"] = []
                return base
        except Exception:
            pass
    return _empty_doc_context(norm, title=title, file_kind=file_kind)


def save_document_context(
    workspace_root: Optional[Path],
    rel_path: str,
    ctx: Dict[str, Any],
) -> Dict[str, Any]:
    norm = normalize_doc_rel_path(rel_path)
    if not norm:
        return ctx
    payload = dict(ctx)
    payload["path"] = norm
    payload["updated_at"] = _utc_now_iso()
    # Limitar reglas y turnos almacenados para evitar archivos inflados
    rules = payload.get("pinned_rules")
    if isinstance(rules, list):
        clean_rules: List[str] = []
        seen: set[str] = set()
        for r in rules:
            s = str(r or "").strip()
            if s and s.lower() not in seen:
                seen.add(s.lower())
                clean_rules.append(s[:280])
        payload["pinned_rules"] = clean_rules[:20]
    else:
        payload["pinned_rules"] = []

    turns = payload.get("recent_turns")
    if isinstance(turns, list):
        clean_turns: List[Dict[str, Any]] = []
        for t in turns[-24:]:
            if not isinstance(t, dict):
                continue
            role = str(t.get("role") or "").strip()
            content = str(t.get("content") or "").strip()
            if role in ("user", "assistant") and content:
                entry: Dict[str, Any] = {
                    "role": role,
                    "content": content[:6000],
                    "ts": str(t.get("ts") or _utc_now_iso()),
                }
                if t.get("edit_action"):
                    entry["edit_action"] = str(t["edit_action"])
                clean_turns.append(entry)
        payload["recent_turns"] = clean_turns
    else:
        payload["recent_turns"] = []

    if workspace_root is not None and workspace_root.is_dir():
        try:
            fp = _doc_context_file(workspace_root, norm)
            fp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception:
            pass
    return payload


def update_document_rules(
    workspace_root: Optional[Path],
    rel_path: str,
    rules: List[str],
    *,
    title: str = "",
    file_kind: str = "pdf",
) -> Dict[str, Any]:
    ctx = load_document_context(workspace_root, rel_path, title=title, file_kind=file_kind)
    ctx["pinned_rules"] = [str(r).strip() for r in (rules or []) if str(r).strip()]
    return save_document_context(workspace_root, rel_path, ctx)


def reset_document_context(
    workspace_root: Optional[Path],
    rel_path: str,
    *,
    keep_rules: bool = True,
    title: str = "",
    file_kind: str = "pdf",
) -> Dict[str, Any]:
    existing = load_document_context(workspace_root, rel_path, title=title, file_kind=file_kind)
    fresh = _empty_doc_context(
        rel_path,
        title=title or str(existing.get("title") or ""),
        file_kind=file_kind or str(existing.get("file_kind") or "pdf"),
    )
    if keep_rules:
        fresh["pinned_rules"] = list(existing.get("pinned_rules") or [])
    fresh["revision"] = int(existing.get("revision") or 0)
    return save_document_context(workspace_root, rel_path, fresh)


def record_document_turn(
    workspace_root: Optional[Path],
    rel_path: str,
    user_message: str,
    assistant_reply: str,
    *,
    title: str = "",
    file_kind: str = "pdf",
    edit_action: Optional[str] = None,
    revision: Optional[int] = None,
    checkpoint_override: Optional[Dict[str, Any]] = None,
    turns_override: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    ctx = load_document_context(workspace_root, rel_path, title=title, file_kind=file_kind)
    if checkpoint_override is not None:
        ctx["checkpoint"] = checkpoint_override
    if turns_override is not None:
        turns = list(turns_override)
    else:
        turns = list(ctx.get("recent_turns") or [])

    now_iso = _utc_now_iso()
    u_txt = str(user_message or "").strip()
    a_txt = str(assistant_reply or "").strip()
    if u_txt:
        turns.append({"role": "user", "content": u_txt[:4000], "ts": now_iso})
    if a_txt:
        a_entry: Dict[str, Any] = {"role": "assistant", "content": a_txt[:3500], "ts": now_iso}
        if edit_action:
            a_entry["edit_action"] = str(edit_action)
        turns.append(a_entry)
    ctx["recent_turns"] = turns
    ctx["total_turns_recorded"] = int(ctx.get("total_turns_recorded") or 0) + (1 if u_txt else 0) + (1 if a_txt else 0)
    if revision:
        ctx["revision"] = int(revision)
    return save_document_context(workspace_root, rel_path, ctx)


def list_document_contexts(workspace_root: Optional[Path]) -> List[Dict[str, Any]]:
    if workspace_root is None or not workspace_root.is_dir():
        return []
    d = workspace_root / ".xook" / "doc_contexts"
    if not d.is_dir():
        return []
    out: List[Dict[str, Any]] = []
    for fp in d.glob("*.json"):
        try:
            raw = json.loads(fp.read_text(encoding="utf-8"))
            if isinstance(raw, dict) and raw.get("path"):
                out.append({
                    "path": raw.get("path"),
                    "title": raw.get("title") or Path(str(raw.get("path"))).name,
                    "file_kind": raw.get("file_kind") or "pdf",
                    "rules_count": len(raw.get("pinned_rules") or []),
                    "has_checkpoint": bool(raw.get("checkpoint")),
                    "recent_turns_count": len(raw.get("recent_turns") or []),
                    "updated_at": raw.get("updated_at"),
                })
        except Exception:
            continue
    out.sort(key=lambda x: str(x.get("updated_at") or ""), reverse=True)
    return out


# ---------------------------------------------------------------------------
# Live Ground Truth Loader (lee el estado REAL del archivo en disco)
# ---------------------------------------------------------------------------

def _extract_markdown_outline(md_text: str, max_headings: int = 32) -> List[Dict[str, Any]]:
    headings: List[Dict[str, Any]] = []
    for line_no, raw_ln in enumerate(md_text.splitlines(), start=1):
        m = re.match(r"^(#{1,4})\s+(.+?)\s*$", raw_ln.strip())
        if m:
            headings.append({
                "line": line_no,
                "level": len(m.group(1)),
                "text": m.group(2).strip()[:120],
            })
            if len(headings) >= max_headings:
                break
    return headings


def _compact_blocks_snapshot(blocks: List[Dict[str, Any]], max_chars: int = 5600) -> Tuple[List[Dict[str, Any]], str]:
    """Construye el índice exacto de encabezados + snapshot compacto por secciones desde bloques PDF."""
    headings: List[Dict[str, Any]] = []
    lines: List[str] = []
    for idx, blk in enumerate(blocks):
        if not isinstance(blk, dict):
            continue
        btype = str(blk.get("type") or "").strip().lower()
        if btype == "heading":
            lvl = max(1, min(3, int(blk.get("level") or 1)))
            txt = str(blk.get("text") or blk.get("title") or "").strip()
            if txt:
                headings.append({"block_index": idx, "level": lvl, "text": txt[:140]})
                lines.append(f"{'#' * lvl} {txt}")
        elif btype == "paragraph":
            txt = str(blk.get("text") or blk.get("content") or "").strip()
            if txt:
                lines.append(txt[:480] + ("…" if len(txt) > 480 else ""))
        elif btype in ("bullets", "bullet_list", "unordered_list", "ul", "list", "numbered_list", "ordered_list", "ol"):
            items = [str(it).strip() for it in (blk.get("items") or []) if str(it).strip()]
            for it in items[:8]:
                lines.append(f"- {it[:180]}")
            if len(items) > 8:
                lines.append(f"- … (+{len(items) - 8} elementos)")
        elif btype == "table":
            headers = [str(h).strip() for h in (blk.get("headers") or blk.get("columns") or [])]
            rows = blk.get("rows") or []
            if headers:
                lines.append(f"[Tabla: {' | '.join(headers[:8])} ({len(rows)} filas)]")
        elif btype in ("callout", "summary", "quote"):
            ct = str(blk.get("title") or "").strip()
            cx = str(blk.get("text") or blk.get("content") or "").strip()
            label = f"{ct}: {cx}" if ct and cx else (ct or cx)
            if label:
                lines.append(f"> {label[:260]}")
        elif btype in ("code", "code_block", "pre"):
            lang = str(blk.get("language") or blk.get("lang") or "").strip()
            code_txt = str(blk.get("code") or blk.get("text") or "").strip()
            first_ln = code_txt.splitlines()[0][:100] if code_txt else ""
            lines.append(f"[Código {lang}: {first_ln} ({len(code_txt.splitlines())} líneas)]")

    joined = "\n".join(lines).strip()
    if len(joined) > max_chars:
        head = joined[: int(max_chars * 0.68)].rstrip()
        tail = joined[-int(max_chars * 0.25):].lstrip()
        joined = f"{head}\n\n[… sección intermedia omitida para brevedad; usa `pdf_read` si necesitas texto literal completo …]\n\n{tail}"
    return headings, joined


def load_live_document_ground_truth(
    workspace_root: Optional[Path],
    rel_path: str,
    *,
    file_kind: Optional[str] = None,
    fallback_meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Lee desde disco el estado REAL vigente del documento abierto en ventana.
    Operación rápida y segura (sin OCR pesado) diseñada para ejecutarse antes de cada turno.
    """
    norm = normalize_doc_rel_path(rel_path)
    meta = dict(fallback_meta or {})
    out: Dict[str, Any] = {
        "path": norm,
        "exists": False,
        "file_kind": file_kind or meta.get("fileKind") or meta.get("file_kind") or "pdf",
        "title": str(meta.get("title") or Path(norm).name or "Documento"),
        "theme": str(meta.get("theme") or "executive"),
        "page_count": int(meta.get("pageCount") or meta.get("page_count") or 0),
        "has_cover": bool(meta.get("hasCover") or meta.get("has_cover")),
        "headings": [],
        "snapshot": "",
        "revision": int(meta.get("revision") or 0),
    }
    if workspace_root is None or not norm:
        return out

    try:
        from slices.agent_tools.toolkit import READ_SEARCH_EXCLUDED_ROOTS, resolve_workspace_path

        target, clean_rel, top_zone = resolve_workspace_path(workspace_root, norm)
        if top_zone in READ_SEARCH_EXCLUDED_ROOTS:
            return out
        out["path"] = clean_rel
        if not target.is_file():
            return out
        st = target.stat()
        out["exists"] = True
        out["size_bytes"] = int(st.st_size)
        out["mtime_ms"] = int(st.st_mtime * 1000)
        ext = target.suffix.lower()

        if ext == ".pdf" or out["file_kind"] == "pdf":
            out["file_kind"] = "pdf"
            # 1) Leer metadatos estructurados guardados en .xook/pdf_specs/<hash>.json (muy rápido)
            spec_loaded = False
            try:
                from slices.pdf_engine.editor import get_spec_paths

                spec_paths = get_spec_paths(workspace_root, clean_rel)
                if spec_paths["json"].is_file():
                    saved = json.loads(spec_paths["json"].read_text(encoding="utf-8"))
                    if isinstance(saved, dict):
                        rec_mtime = saved.get("pdf_mtime")
                        rec_size = saved.get("pdf_size")
                        spec_fresh = True
                        if (
                            isinstance(rec_mtime, (int, float))
                            and isinstance(rec_size, int)
                            and (abs(st.st_mtime - float(rec_mtime)) > 2.0 or st.st_size != rec_size)
                        ):
                            spec_fresh = False
                        if spec_fresh and isinstance(saved.get("blocks"), list) and saved["blocks"]:
                            out["title"] = str(saved.get("title") or out["title"])
                            out["subtitle"] = str(saved.get("subtitle") or "")
                            out["theme"] = str(saved.get("theme") or out["theme"] or "executive")
                            out["has_cover"] = bool(saved.get("has_cover"))
                            out["block_count"] = len(saved["blocks"])
                            if saved.get("revision"):
                                out["revision"] = int(saved["revision"])
                            headings, snap = _compact_blocks_snapshot(saved["blocks"])
                            out["headings"] = headings
                            out["snapshot"] = snap
                            spec_loaded = True
            except Exception:
                pass

            # Contar páginas reales directo del PDF
            try:
                from pypdf import PdfReader

                reader = PdfReader(str(target))
                out["page_count"] = len(reader.pages)
                if not spec_loaded:
                    # Extracción rápida de texto de las primeras páginas sin OCR pesado
                    quick_pages: List[str] = []
                    for p_idx, page in enumerate(reader.pages[:8], start=1):
                        ptxt = (page.extract_text() or "").strip()
                        if ptxt:
                            quick_pages.append(f"[Pág. {p_idx}]\n{ptxt[:900]}")
                    joined_q = "\n\n".join(quick_pages).strip()
                    if len(joined_q) > 4800:
                        joined_q = joined_q[:4800].rstrip() + "\n[…]"
                    out["snapshot"] = joined_q
            except Exception:
                pass
            return out

        if ext in (".md", ".markdown", ".txt", ".csv", ".tsv", ".json", ".yaml", ".yml", ".py", ".ts", ".tsx", ".js", ".jsx", ".rs", ".html", ".css", ".sql"):
            out["file_kind"] = "text"
            raw_text = target.read_text(encoding="utf-8", errors="replace")
            out["char_count"] = len(raw_text)
            out["line_count"] = len(raw_text.splitlines())
            if ext in (".md", ".markdown"):
                out["headings"] = _extract_markdown_outline(raw_text)
            if len(raw_text) > 5800:
                head = raw_text[:3800].rstrip()
                tail = raw_text[-1600:].lstrip()
                out["snapshot"] = f"{head}\n\n[… omitidas líneas intermedias; usa `workspace_read` con rangos para ver todo …]\n\n{tail}"
            else:
                out["snapshot"] = raw_text
            return out

        if ext in (".docx", ".doc", ".pptx", ".ppt", ".xlsx", ".xls", ".rtf", ".odt", ".odp", ".ods"):
            out["file_kind"] = "office"
            try:
                from slices.pdf_engine.office_reader import read_universal_document

                uni = read_universal_document(target, clean_rel)
                if isinstance(uni, dict) and uni.get("ok"):
                    out["title"] = str(uni.get("title") or out["title"])
                    out["page_count"] = int(uni.get("page_count") or 1)
                    out["format_label"] = str(uni.get("format_label") or ext.lstrip(".").upper())
                    md_or_txt = str(uni.get("markdown") or uni.get("text") or "").strip()
                    if len(md_or_txt) > 5200:
                        md_or_txt = md_or_txt[:5200].rstrip() + "\n[…]"
                    out["snapshot"] = md_or_txt
                    if isinstance(uni.get("blocks"), list):
                        out["headings"] = [
                            {"level": int(b.get("level") or 1), "text": str(b.get("text") or "")[:120]}
                            for b in uni["blocks"]
                            if isinstance(b, dict) and b.get("type") == "heading" and b.get("text")
                        ][:30]
            except Exception:
                pass
            return out

    except Exception:
        pass
    return out


# ---------------------------------------------------------------------------
# Formateo de Checkpoint y Bloque de Contexto de Ventana
# ---------------------------------------------------------------------------

def format_checkpoint_for_prompt(checkpoint: Optional[Dict[str, Any]], *, scope: str = "chat") -> str:
    """Convierte un Checkpoint estructurado en un bloque claro y conciso para el modelo."""
    if not isinstance(checkpoint, dict):
        return ""
    lines: List[str] = []
    header = (
        "CHECKPOINT COMPACTADO DE ESTA VENTANA DE DOCUMENTO (resumen consolidado de rondas previas):"
        if scope == "document"
        else "CHECKPOINT COMPACTADO DE LA CONVERSACIÓN (resumen consolidado de turnos anteriores):"
    )
    lines.append(header)

    obj = str(checkpoint.get("objective") or "").strip()
    if obj:
        lines.append(f"- Objetivo vigente: {obj}")

    decisions = [str(x).strip() for x in (checkpoint.get("active_decisions") or []) if str(x).strip()]
    if decisions:
        lines.append("- Decisiones y criterios VIGENTES (respetar siempre):")
        for d in decisions[:14]:
            lines.append(f"  * {d}")

    discarded = [str(x).strip() for x in (checkpoint.get("superseded_discarded") or []) if str(x).strip()]
    if discarded:
        lines.append("- Instrucciones ANTERIORES REEMPLAZADAS O DESCARTADAS (NO volver a aplicar):")
        for x in discarded[:10]:
            lines.append(f"  * {x}")

    doc_state = str(checkpoint.get("document_state") or "").strip()
    if doc_state:
        lines.append(f"- Estado alcanzado: {doc_state}")

    pending = [str(x).strip() for x in (checkpoint.get("pending_items") or []) if str(x).strip()]
    if pending:
        lines.append("- Pendientes abiertos:")
        for p in pending[:8]:
            lines.append(f"  * {p}")

    summary = str(checkpoint.get("summary") or "").strip()
    if summary and not (obj or decisions):
        lines.append(f"- Resumen: {summary}")

    if len(lines) <= 1:
        return ""
    return "\n".join(lines)


def format_document_window_prompt_block(
    doc_ctx: Dict[str, Any],
    ground_truth: Dict[str, Any],
) -> str:
    """Construye el bloque de contexto aislado y Ground Truth vivo para una ventana de documento."""
    rel_path = str(ground_truth.get("path") or doc_ctx.get("path") or "").strip()
    title = str(ground_truth.get("title") or doc_ctx.get("title") or Path(rel_path).name or "Documento").strip()
    file_kind = str(ground_truth.get("file_kind") or doc_ctx.get("file_kind") or "pdf").strip()
    theme = str(ground_truth.get("theme") or "executive").strip()
    page_count = int(ground_truth.get("page_count") or 0)
    has_cover = bool(ground_truth.get("has_cover"))
    exists = bool(ground_truth.get("exists"))

    parts: List[str] = [
        "=== VENTANA DE DOCUMENTO ACTIVA (CONTEXTO AISLADO DE ESTE ARCHIVO) ===",
        f"Archivo objetivo: `{rel_path}` | Título: \"{title}\" | Tipo: {file_kind}"
        + (f" | Tema visual: `{theme}`" if file_kind == "pdf" else "")
        + (f" | Páginas actuales: {page_count}" if page_count > 0 else "")
        + (" | Portada activa: Sí" if file_kind == "pdf" and has_cover else ""),
        "REGLAS DE ORO DE ESTA VENTANA:",
        "1. Este hilo pertenece EXCLUSIVAMENTE a este documento. Ignora temas de otros documentos o chats antiguos.",
        "2. La 'VERDAD ACTUAL EN DISCO' de abajo refleja exactamente lo que HOY contiene el archivo. Si el feedback reciente contradice algo previo, SIEMPRE manda la instrucción más reciente del usuario.",
    ]

    if file_kind == "pdf":
        parts.append(
            f"3. Para editar este PDF aplica el cambio REAL llamando a `pdf_generate` con `source_pdf_path='{rel_path}'`: "
            "usa `edit_action='modify'` + `section_updates` (usando los encabezados EXACTOS del índice de abajo) para cambios puntuales por sección sin tocar el resto, "
            "`replacements` para reemplazos breves, `edit_action='append_pages'` para añadir páginas nuevas al final, o `markdown`/`blocks` completos si el cambio es estructural. "
            "Si el usuario pide rehacerlo/regenerarlo desde cero con otro diseño o portada nueva, pasa `edit_action='create'` o el nuevo `cover` explícito. "
            "NO añadas marca de agua XOOK salvo que se pida explícitamente."
        )
    elif file_kind == "text":
        parts.append(
            f"3. Para modificar este archivo de texto/Markdown aplica el cambio directamente con `workspace_edit_file` (o `workspace_write_file` si se reescribe completo) sobre `{rel_path}`."
        )
    else:
        parts.append(
            f"3. Para modificar este documento Office usa `run_custom_script` (`python`) sobre `{rel_path}` verificando el resultado al terminar."
        )

    rules = [str(r).strip() for r in (doc_ctx.get("pinned_rules") or []) if str(r).strip()]
    if rules:
        parts.append("\nREGLAS FIJADAS DE ESTE DOCUMENTO (OBLIGATORIAS EN TODA REVISIÓN):")
        for idx, r in enumerate(rules, start=1):
            parts.append(f"  {idx}. {r}")

    ckpt_block = format_checkpoint_for_prompt(doc_ctx.get("checkpoint"), scope="document")
    if ckpt_block:
        parts.append("\n" + ckpt_block)

    if exists:
        headings = ground_truth.get("headings") or []
        if headings:
            parts.append("\nÍNDICE REAL DE SECCIONES ACTUALES EN DISCO (usa estos nombres exactos en `section_updates`):")
            for h in headings[:30]:
                lvl = int(h.get("level") or 1)
                indent = "  " * max(0, lvl - 1)
                parts.append(f"  {indent}- {'#' * lvl} {h.get('text')}")
        snap = str(ground_truth.get("snapshot") or "").strip()
        if snap:
            parts.append(f"\nVERDAD ACTUAL EN DISCO (`{rel_path}`):\n{snap}")
    else:
        parts.append("\n(Nota: el archivo todavía no existe en disco o fue movido; si el usuario pide regenerarlo, créalo limpio.)")

    parts.append("=== FIN VENTANA DE DOCUMENTO ACTIVA ===")
    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Compactación Estructurada (LLM + Fallback Determinístico Rápido)
# ---------------------------------------------------------------------------

def _extract_json_object(raw_text: str) -> Optional[Dict[str, Any]]:
    txt = str(raw_text or "").strip()
    if not txt:
        return None
    # Quitar cercas ```json ... ```
    m = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", txt, re.IGNORECASE)
    if m:
        txt = m.group(1).strip()
    try:
        obj = json.loads(txt)
        if isinstance(obj, dict):
            return obj
    except Exception:
        pass
    start = txt.find("{")
    end = txt.rfind("}")
    if start >= 0 and end > start:
        try:
            obj = json.loads(txt[start : end + 1])
            if isinstance(obj, dict):
                return obj
        except Exception:
            pass
    return None


def _normalize_checkpoint_obj(
    raw: Dict[str, Any],
    *,
    prev_checkpoint: Optional[Dict[str, Any]],
    compacted_count: int,
    tokens_before: int,
    auto: bool,
) -> Dict[str, Any]:
    def _clean_list(val: Any, limit: int = 12) -> List[str]:
        if not isinstance(val, list):
            return []
        out: List[str] = []
        seen: set[str] = set()
        for item in val:
            s = " ".join(str(item or "").split()).strip()
            if s and s.lower() not in seen:
                seen.add(s.lower())
                out.append(s[:240])
            if len(out) >= limit:
                break
        return out

    prev_total = int((prev_checkpoint or {}).get("compacted_turns") or 0)
    ckpt: Dict[str, Any] = {
        "objective": " ".join(str(raw.get("objective") or "").split()).strip()[:360],
        "active_decisions": _clean_list(raw.get("active_decisions"), 14),
        "superseded_discarded": _clean_list(raw.get("superseded_discarded"), 10),
        "document_state": " ".join(str(raw.get("document_state") or "").split()).strip()[:420],
        "pending_items": _clean_list(raw.get("pending_items"), 8),
        "summary": " ".join(str(raw.get("summary") or "").split()).strip()[:480],
        "compacted_turns": prev_total + max(0, compacted_count),
        "auto": bool(auto),
        "updated_at": _utc_now_iso(),
    }
    if not ckpt["summary"]:
        summary_parts = []
        if ckpt["objective"]:
            summary_parts.append(ckpt["objective"])
        if ckpt["active_decisions"]:
            summary_parts.append("Acuerdos vigentes: " + "; ".join(ckpt["active_decisions"][:3]))
        ckpt["summary"] = " · ".join(summary_parts)[:420] or "Contexto anterior compactado."

    tokens_after = estimate_tokens(format_checkpoint_for_prompt(ckpt))
    saved_pct = (
        max(0, min(98, int(round((1.0 - (tokens_after / max(1, tokens_before))) * 100))))
        if tokens_before > 0
        else 0
    )
    ckpt["tokens_before"] = int(tokens_before)
    ckpt["tokens_after"] = int(tokens_after)
    ckpt["saved_pct"] = int(saved_pct)
    return ckpt


def _deterministic_compact(
    turns_to_compact: List[Dict[str, Any]],
    *,
    prev_checkpoint: Optional[Dict[str, Any]],
    scope: str,
    doc_title: str = "",
    focus_hint: str = "",
    auto: bool = True,
) -> Dict[str, Any]:
    """Fallback instantáneo sin red que produce un Checkpoint limpio y estructurado."""
    tokens_before = estimate_turns_tokens(turns_to_compact) + (
        estimate_tokens(format_checkpoint_for_prompt(prev_checkpoint, scope=scope))
        if prev_checkpoint
        else 0
    )
    user_msgs = [
        " ".join(str(m.get("content") or "").split()).strip()
        for m in turns_to_compact
        if isinstance(m, dict) and m.get("role") == "user" and str(m.get("content") or "").strip()
    ]
    asst_msgs = [
        " ".join(str(m.get("content") or "").split()).strip()
        for m in turns_to_compact
        if isinstance(m, dict) and m.get("role") == "assistant" and str(m.get("content") or "").strip()
    ]

    objective = (
        str((prev_checkpoint or {}).get("objective") or "").strip()
        or (f"Iterar y perfeccionar el documento \"{doc_title}\"." if scope == "document" and doc_title else "")
        or (user_msgs[0][:220] if user_msgs else "Continuar trabajo en curso.")
    )
    if focus_hint:
        objective = f"{objective} (Foco: {focus_hint[:140]})".strip()

    # Conservar las instrucciones de usuario más recientes como decisiones activas (las más nuevas ganan)
    decisions: List[str] = list((prev_checkpoint or {}).get("active_decisions") or [])[-4:]
    for um in user_msgs[-6:]:
        short_u = um[:200] + ("…" if len(um) > 200 else "")
        if short_u not in decisions:
            decisions.append(short_u)

    doc_state = ""
    if asst_msgs:
        doc_state = asst_msgs[-1][:320] + ("…" if len(asst_msgs[-1]) > 320 else "")
    elif prev_checkpoint and prev_checkpoint.get("document_state"):
        doc_state = str(prev_checkpoint["document_state"])

    raw = {
        "objective": objective,
        "active_decisions": decisions[-10:],
        "superseded_discarded": list((prev_checkpoint or {}).get("superseded_discarded") or [])[-6:],
        "document_state": doc_state,
        "pending_items": list((prev_checkpoint or {}).get("pending_items") or [])[-5:],
        "summary": f"Compactados {len(turns_to_compact)} mensajes previos" + (f" sobre {doc_title}" if doc_title else "") + ".",
    }
    return _normalize_checkpoint_obj(
        raw,
        prev_checkpoint=prev_checkpoint,
        compacted_count=len(turns_to_compact),
        tokens_before=tokens_before,
        auto=auto,
    )


def compact_turns_to_checkpoint(
    turns_to_compact: List[Dict[str, Any]],
    *,
    prev_checkpoint: Optional[Dict[str, Any]] = None,
    scope: str = "chat",
    doc_title: str = "",
    doc_path: str = "",
    pinned_rules: Optional[List[str]] = None,
    focus_hint: str = "",
    auto: bool = True,
    call_llm_fn: Optional[Callable[[List[Dict[str, str]]], str]] = None,
) -> Dict[str, Any]:
    """
    Condensa una lista de turnos históricos + checkpoint previo en un nuevo Checkpoint estructurado.
    Usa el LLM activo cuando `call_llm_fn` está disponible, con fallback determinístico instantáneo.
    """
    clean_turns = [
        {"role": str(m.get("role") or ""), "content": str(m.get("content") or "").strip()}
        for m in (turns_to_compact or [])
        if isinstance(m, dict)
        and m.get("role") in ("user", "assistant")
        and str(m.get("content") or "").strip()
    ]
    if not clean_turns and prev_checkpoint:
        return dict(prev_checkpoint)

    tokens_before = estimate_turns_tokens(clean_turns) + (
        estimate_tokens(format_checkpoint_for_prompt(prev_checkpoint, scope=scope))
        if prev_checkpoint
        else 0
    )

    if call_llm_fn is None:
        return _deterministic_compact(
            clean_turns,
            prev_checkpoint=prev_checkpoint,
            scope=scope,
            doc_title=doc_title,
            focus_hint=focus_hint,
            auto=auto,
        )

    transcript_lines: List[str] = []
    if prev_checkpoint:
        transcript_lines.append("CHECKPOINT PREVIO:")
        transcript_lines.append(format_checkpoint_for_prompt(prev_checkpoint, scope=scope))
        transcript_lines.append("")
    if pinned_rules:
        transcript_lines.append("REGLAS FIJADAS VIGENTES (ya guardadas aparte, no contradecir):")
        for r in pinned_rules[:12]:
            transcript_lines.append(f"- {r}")
        transcript_lines.append("")

    transcript_lines.append("TURNOS A COMPACTAR (en orden cronológico, lo MÁS RECIENTE tiene prioridad):")
    total_chars = 0
    for idx, t in enumerate(clean_turns, start=1):
        who = "USUARIO" if t["role"] == "user" else "XOX"
        body = t["content"]
        if len(body) > 1400:
            body = body[:1100].rstrip() + " … " + body[-220:].lstrip()
        line = f"[{idx}] {who}: {body}"
        if total_chars + len(line) > 16000:
            transcript_lines.append("[… turnos intermedios resumidos por límite de longitud …]")
            break
        transcript_lines.append(line)
        total_chars += len(line)

    focus_clause = f"\nEnfoque prioritario pedido por el usuario: {focus_hint.strip()}" if focus_hint.strip() else ""
    scope_label = f"la edición del documento '{doc_title or doc_path}'" if scope == "document" else "esta conversación"

    sys_msg = (
        "Eres el motor de compactación de memoria de XOOK. Tu trabajo es comprimir el historial de "
        f"{scope_label} en un Checkpoint JSON ultra-claro para evitar que el agente se confunda tras muchas rondas de feedback.\n"
        "REGLAS ESTRICTAS:\n"
        "1. Si el usuario dio instrucciones contradictorias en distintos turnos (ej. primero pidió algo y luego cambió de opinión), "
        "conserva ÚNICAMENTE la decisión MÁS RECIENTE en `active_decisions` y anota la anterior en `superseded_discarded`.\n"
        "2. Elimina charla redundante, saludos, disculpas y borradores viejos.\n"
        "3. Conserva rutas de archivo, títulos, métricas, secciones y criterios de estilo que sigan vigentes.\n"
        "4. Responde ÚNICAMENTE con un objeto JSON válido con estas claves exactas:\n"
        '{"objective":"...", "active_decisions":["..."], "superseded_discarded":["..."], "document_state":"...", "pending_items":["..."], "summary":"..."}'
    )
    user_prompt = "\n".join(transcript_lines) + focus_clause

    try:
        raw_out = call_llm_fn([
            {"role": "system", "content": sys_msg},
            {"role": "user", "content": user_prompt},
        ])
        parsed = _extract_json_object(raw_out)
        if isinstance(parsed, dict) and any(
            parsed.get(k) for k in ("objective", "active_decisions", "document_state", "summary")
        ):
            return _normalize_checkpoint_obj(
                parsed,
                prev_checkpoint=prev_checkpoint,
                compacted_count=len(clean_turns),
                tokens_before=tokens_before,
                auto=auto,
            )
    except Exception:
        pass

    return _deterministic_compact(
        clean_turns,
        prev_checkpoint=prev_checkpoint,
        scope=scope,
        doc_title=doc_title,
        focus_hint=focus_hint,
        auto=auto,
    )


def maybe_auto_compact_turns(
    turns: List[Dict[str, Any]],
    *,
    prev_checkpoint: Optional[Dict[str, Any]] = None,
    scope: str = "chat",
    model_context_window: int = 128000,
    system_prompt_tokens: int = 2500,
    doc_title: str = "",
    doc_path: str = "",
    pinned_rules: Optional[List[str]] = None,
    call_llm_fn: Optional[Callable[[List[Dict[str, str]]], str]] = None,
) -> Tuple[List[Dict[str, Any]], Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """
    Evalúa si la ventana actual requiere compactación automática antes del turno.
    Devuelve `(effective_recent_turns, active_checkpoint, compaction_event_or_None)`.
    """
    clean_turns = [
        m for m in (turns or [])
        if isinstance(m, dict)
        and m.get("role") in ("user", "assistant")
        and isinstance(m.get("content"), str)
        and m.get("content", "").strip()
    ]
    if scope == "document":
        min_turns = DOC_AUTO_COMPACT_MIN_TURNS
        keep_recent = DOC_AUTO_COMPACT_KEEP_RECENT
        turns_tok = estimate_turns_tokens(clean_turns)
        should_compact = (
            len(clean_turns) >= min_turns
            or (len(clean_turns) > keep_recent and turns_tok >= DOC_AUTO_COMPACT_TOKEN_TRIGGER)
        )
    else:
        min_turns = CHAT_AUTO_COMPACT_MIN_TURNS
        keep_recent = CHAT_AUTO_COMPACT_KEEP_RECENT
        turns_tok = estimate_turns_tokens(clean_turns)
        ckpt_tok = estimate_tokens(format_checkpoint_for_prompt(prev_checkpoint, scope="chat")) if prev_checkpoint else 0
        eff_window = max(8192, int(model_context_window or 128000))
        tok_trigger = min(CHAT_AUTO_COMPACT_TOKEN_CAP, int(eff_window * CHAT_AUTO_COMPACT_CONTEXT_RATIO))
        should_compact = (
            len(clean_turns) >= min_turns
            or (len(clean_turns) > keep_recent and (system_prompt_tokens + ckpt_tok + turns_tok) >= tok_trigger)
        )

    if not should_compact or len(clean_turns) <= keep_recent:
        return clean_turns, prev_checkpoint, None

    older = clean_turns[:-keep_recent]
    kept = clean_turns[-keep_recent:]
    new_ckpt = compact_turns_to_checkpoint(
        older,
        prev_checkpoint=prev_checkpoint,
        scope=scope,
        doc_title=doc_title,
        doc_path=doc_path,
        pinned_rules=pinned_rules,
        auto=True,
        call_llm_fn=call_llm_fn,
    )
    compaction_event = {
        "auto": True,
        "scope": scope,
        "document_path": doc_path or None,
        "document_title": doc_title or None,
        "compacted_turns_this_pass": len(older),
        "kept_recent_turns": len(kept),
        "tokens_before": new_ckpt.get("tokens_before", 0),
        "tokens_after": new_ckpt.get("tokens_after", 0),
        "saved_pct": new_ckpt.get("saved_pct", 0),
        "checkpoint": new_ckpt,
    }
    return kept, new_ckpt, compaction_event


# ---------------------------------------------------------------------------
# Poda de salidas viejas de herramientas dentro de un mismo turno multi-paso
# ---------------------------------------------------------------------------

def prune_tool_loop_messages(loop_messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Limpia salidas voluminosas y ya superadas de `pdf_read` / `workspace_read` / `pdf_generate`
    en rondas anteriores del mismo turno, manteniendo intactos los resultados de la última ronda.
    """
    # Mapear tool_call_id -> (fn_name, path, msg_idx)
    tc_meta: Dict[str, Tuple[str, str]] = {}
    tool_indices: List[Tuple[int, str, str, str]] = []  # (idx, tc_id, fn_name, path)

    for idx, msg in enumerate(loop_messages):
        if not isinstance(msg, dict):
            continue
        role = msg.get("role")
        if role == "assistant" and isinstance(msg.get("tool_calls"), list):
            for tc in msg["tool_calls"]:
                if not isinstance(tc, dict):
                    continue
                tc_id = str(tc.get("id") or "")
                fn = tc.get("function") if isinstance(tc.get("function"), dict) else {}
                fn_name = str(fn.get("name") or "")
                raw_args = fn.get("arguments")
                arg_path = ""
                if isinstance(raw_args, dict):
                    arg_path = str(raw_args.get("path") or raw_args.get("source_pdf_path") or raw_args.get("output_path") or "")
                elif isinstance(raw_args, str):
                    try:
                        parsed = json.loads(raw_args)
                        if isinstance(parsed, dict):
                            arg_path = str(parsed.get("path") or parsed.get("source_pdf_path") or parsed.get("output_path") or "")
                    except Exception:
                        pass
                if tc_id:
                    tc_meta[tc_id] = (fn_name, normalize_doc_rel_path(arg_path).lower())
        elif role == "tool":
            tc_id = str(msg.get("tool_call_id") or "")
            fn_name, arg_path = tc_meta.get(tc_id, ("", ""))
            tool_indices.append((idx, tc_id, fn_name, arg_path))

    if len(tool_indices) <= 2:
        return loop_messages

    # Identificar el último índice por (path) y la última ronda de herramientas
    last_tool_msg_idx = tool_indices[-1][0]
    latest_by_path: Dict[str, int] = {}
    for idx, _, fn_name, arg_path in tool_indices:
        if arg_path:
            latest_by_path[arg_path] = idx

    out = list(loop_messages)
    for idx, _, fn_name, arg_path in tool_indices:
        # Nunca podar las 2 salidas de herramienta más recientes
        if idx >= last_tool_msg_idx - 1:
            continue
        raw_content = str(out[idx].get("content") or "")
        if len(raw_content) < 900:
            continue
        superseded_same_path = bool(arg_path and latest_by_path.get(arg_path, -1) > idx)
        is_heavy_read = fn_name in ("pdf_read", "workspace_read", "workspace_search") and len(raw_content) > 3500
        if superseded_same_path or is_heavy_read:
            stub: Dict[str, Any] = {
                "ok": True,
                "tool": fn_name or "tool",
                "path": arg_path or None,
                "_compacted_prev_tool_output": (
                    "Salida anterior compactada automáticamente porque este archivo ya fue leído/modificado en un paso posterior de este mismo turno."
                    if superseded_same_path
                    else f"Salida extensa previa ({len(raw_content)} chars) compactada para preservar la ventana de contexto."
                ),
            }
            out[idx] = {**out[idx], "content": json.dumps(stub, ensure_ascii=False)}
    return out
