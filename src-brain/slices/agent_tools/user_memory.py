"""
Persistencia atómica, deduplicada y multi-ventana de perfil y memoria del usuario.

Comparte formato exacto JSON (camelCase) con `src-tauri/src/workspace_store.rs` y
`@xook/contracts/src/userDataStore.ts` para evitar desincronización entre Rust,
Python sidecar y las ventanas independientes de XOOK (`main`, `quick`, `document`).
"""

from __future__ import annotations

import json
import os
import re
import time
import unicodedata
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple


LOCAL_USER_FILENAME = "local-user.json"
USER_MEMORY_FILENAME = "user-memory.json"
MAX_USER_MEMORY_FACTS = 120
MAX_USER_MEMORY_VALUE_CHARS = 400
MAX_PROFILE_FIELD_CHARS = 240
MAX_PROFILE_NOTES_CHARS = 600

VALID_CATEGORIES = ("identity", "preference", "work", "contact", "routine", "project", "other")
VALID_WINDOW_SCOPES = ("main", "quick", "document", "settings")

_SECRET_PATTERNS: Tuple[re.Pattern[str], ...] = (
    re.compile(r"-----BEGIN\s+[A-Z0-9 ]*PRIVATE KEY-----", re.IGNORECASE),
    re.compile(r"\bsk-or-[A-Za-z0-9_-]{10,}\b"),
    re.compile(r"\bsk-(?:ant|proj|live|test|svcacct)-[A-Za-z0-9_-]{12,}\b"),
    re.compile(r"\bsk-[A-Za-z0-9]{20,}\b"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{16,}\b"),
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}\b"),
    re.compile(r"\bAIza[0-9A-Za-z_-]{20,}\b"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\bgsk_[0-9A-Za-z]{20,}\b"),
    re.compile(r"\bxox[bpars]-[0-9A-Za-z-]{12,}\b"),
    re.compile(r"\bbearer\s+[A-Za-z0-9._-]{20,}\b", re.IGNORECASE),
)

_TIMESTAMP_PREFIX_RE = re.compile(r"^\[(\d{4}-\d{2}-\d{2}[^\]]*)\]\s*(.*)$")
_CAT_PAREN_RE = re.compile(r"^\(([^)\n]{1,40})\)\s*(.*)$")
_CAT_BRACKET_RE = re.compile(r"^\[([^\]\n]{1,40})\]\s*(.*)$")
_KEY_BRACKET_RE = re.compile(r"^\[key:([a-z0-9_-]{1,64})\]\s*(.*)$")

_QUERY_STOPWORDS = frozenset({
    "hola",
    "hey",
    "hello",
    "buenos",
    "buenas",
    "dias",
    "tardes",
    "noches",
    "que",
    "tal",
    "como",
    "estas",
    "esta",
    "estoy",
    "para",
    "por",
    "con",
    "sin",
    "sobre",
    "entre",
    "hasta",
    "desde",
    "una",
    "uno",
    "unos",
    "unas",
    "los",
    "las",
    "del",
    "al",
    "pero",
    "mas",
    "todo",
    "toda",
    "todos",
    "todas",
    "este",
    "estos",
    "estas",
    "ese",
    "esa",
    "esos",
    "esas",
    "mio",
    "mia",
    "tuyo",
    "suyo",
    "nuestro",
    "nuestra",
    "tiene",
    "tienen",
    "tengo",
    "hacer",
    "hace",
    "hago",
    "puedes",
    "puede",
    "puedo",
    "quiero",
    "necesito",
    "favor",
    "gracias",
    "ayuda",
    "ayudame",
    "dime",
    "cual",
    "cuales",
    "donde",
    "cuando",
    "quien",
    "porque",
    "algo",
    "muy",
    "bien",
    "mal",
    "hoy",
    "ayer",
    "manana",
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "from",
    "have",
    "has",
    "what",
    "how",
    "can",
    "you",
    "please",
    "thanks",
    "good",
    "morning",
    "afternoon",
    "evening",
    "about",
    "into",
    "your",
    "xox",
})

_CATEGORY_SYNONYMS: Dict[str, str] = {
    "identity": "identity identidad perfil nombre",
    "preference": "preference preferencia preferencias estilo gusto",
    "work": "work trabajo rol oficio negocio empresa",
    "contact": "contact contacto equipo persona cliente proveedor",
    "routine": "routine rutina horario agenda",
    "project": "project proyecto meta objetivo",
    "other": "other otro general",
}


def contains_secret_material(text: Optional[str]) -> bool:
    if not text or not isinstance(text, str):
        return False
    return any(pat.search(text) for pat in _SECRET_PATTERNS)


def normalize_category(raw: Optional[str]) -> str:
    clean = str(raw or "other").strip().lower()
    if clean in VALID_CATEGORIES:
        return clean
    if clean in ("identidad", "perfil", "nombre"):
        return "identity"
    if clean in ("preferencia", "preferencias", "estilo"):
        return "preference"
    if clean in ("trabajo", "rol", "oficio", "negocio"):
        return "work"
    if clean in ("contacto", "equipo", "persona"):
        return "contact"
    if clean in ("rutina", "horario", "agenda"):
        return "routine"
    if clean in ("proyecto", "meta"):
        return "project"
    return "other"


def normalize_window_scope(raw: Optional[str]) -> str:
    clean = str(raw or "main").strip().lower()
    return clean if clean in VALID_WINDOW_SCOPES else "main"


def _ascii_fold(text: str) -> str:
    norm = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in norm if not unicodedata.combining(ch))


def normalize_memory_key(raw_key: Optional[str], category: str, value: str) -> str:
    custom = str(raw_key or "").strip()
    base = custom or f"{category or 'other'}_{value[:48]}"
    folded = _ascii_fold(base).lower()
    slug = re.sub(r"[^a-z0-9_-]+", "_", folded)
    slug = re.sub(r"_{2,}", "_", slug).strip("_-")[:64].rstrip("_-")
    return slug or f"{normalize_category(category)}_item"


def _fnv1a_fact_id(key: str) -> str:
    h = 2166136261
    for b in key.encode("utf-8"):
        h ^= b
        h = (h * 16777619) & 0xFFFFFFFF
    return f"umem_{h:x}"


def _backup_path(path: Path) -> Path:
    return Path(f"{path}.bak")


def _atomic_write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(obj, ensure_ascii=False, indent=2) + "\n"
    if path.is_file():
        try:
            prev = path.read_text(encoding="utf-8", errors="replace")
            json.loads(prev)
            bak = _backup_path(path)
            tmp_bak = path.parent / f".{bak.name}.tmp.{os.getpid()}.{time.time_ns()}"
            tmp_bak.write_text(prev, encoding="utf-8")
            try:
                os.chmod(tmp_bak, 0o600)
            except Exception:
                pass
            os.replace(tmp_bak, bak)
        except Exception:
            pass
    tmp = path.parent / f".{path.name}.tmp.{os.getpid()}.{time.time_ns()}"
    tmp.write_text(serialized, encoding="utf-8")
    try:
        os.chmod(tmp, 0o600)
    except Exception:
        pass
    os.replace(tmp, path)


def _read_json_with_backup(path: Path) -> Any:
    for candidate in (path, _backup_path(path)):
        if candidate.is_file():
            try:
                return json.loads(candidate.read_text(encoding="utf-8", errors="replace"))
            except Exception:
                continue
    return None


def _atomic_write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.parent / f".{path.name}.tmp.{os.getpid()}.{time.time_ns()}"
    tmp.write_text(content, encoding="utf-8")
    os.replace(tmp, path)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def load_global_user_memory(xox_config_dir: Optional[Path]) -> List[Dict[str, Any]]:
    if xox_config_dir is None:
        return []
    data = _read_json_with_backup(xox_config_dir / USER_MEMORY_FILENAME)
    if isinstance(data, dict) and isinstance(data.get("facts"), list):
        return [item for item in data["facts"] if isinstance(item, dict)]
    return []


def upsert_global_user_memory_fallback(
    xox_config_dir: Optional[Path],
    *,
    value: str,
    category: str = "other",
    key: Optional[str] = None,
    pinned: bool = False,
    source_window: str = "main",
) -> Dict[str, Any]:
    if xox_config_dir is None:
        return {"ok": False, "error": "Falta `xox_config_dir` para guardar memoria global del usuario."}
    collapsed = " ".join(str(value or "").split()).strip()
    if not collapsed:
        return {"ok": False, "error": "El dato a recordar no puede estar vacío."}
    if contains_secret_material(collapsed):
        return {
            "ok": False,
            "error": "Por seguridad, no se guardan claves API, tokens ni llaves privadas en memoria del usuario.",
        }
    clean_val = collapsed[:MAX_USER_MEMORY_VALUE_CHARS].strip()
    cat = normalize_category(category)
    win = normalize_window_scope(source_window)
    norm_key = normalize_memory_key(key, cat, clean_val)
    norm_val_low = clean_val.lower()
    now = _now_iso()

    path = xox_config_dir / USER_MEMORY_FILENAME
    raw_store = _read_json_with_backup(path)
    facts: List[Dict[str, Any]] = (
        [f for f in raw_store.get("facts", []) if isinstance(f, dict)]
        if isinstance(raw_store, dict) and isinstance(raw_store.get("facts"), list)
        else []
    )

    key_match_idx = -1
    val_match_idx = -1
    for idx, item in enumerate(facts):
        item_key = str(item.get("key") or "").strip().lower()
        item_val = " ".join(str(item.get("value") or "").split()).strip().lower()
        if key_match_idx < 0 and item_key == norm_key:
            key_match_idx = idx
            break
        if val_match_idx < 0 and item_val and item_val == norm_val_low:
            val_match_idx = idx

    match_idx = key_match_idx if key_match_idx >= 0 else val_match_idx
    matched_by_value_only = key_match_idx < 0 and val_match_idx >= 0
    existing = facts[match_idx] if match_idx >= 0 else None
    custom_key_given = bool(str(key or "").strip())
    saved: Dict[str, Any] = {
        "id": str(existing.get("id") or _fnv1a_fact_id(norm_key)) if existing else _fnv1a_fact_id(norm_key),
        "key": (
            str(existing.get("key") or norm_key)
            if existing and (matched_by_value_only or not custom_key_given) and str(existing.get("key") or "").strip()
            else norm_key
        ),
        "category": cat,
        "value": clean_val,
        "scope": "global",
        "sourceWindow": win,
        "pinned": bool(pinned or (existing.get("pinned") if existing else False)),
        "createdAt": str(existing.get("createdAt") or now) if existing else now,
        "updatedAt": now,
    }

    remaining = [item for idx, item in enumerate(facts) if idx != match_idx]
    combined = [saved, *remaining]
    if len(combined) > MAX_USER_MEMORY_FACTS:
        pinned_cnt = sum(1 for f in combined if f.get("pinned"))
        unpinned_budget = max(0, MAX_USER_MEMORY_FACTS - pinned_cnt)
        kept: List[Dict[str, Any]] = []
        for f in combined:
            if f.get("pinned"):
                if len(kept) < MAX_USER_MEMORY_FACTS:
                    kept.append(f)
            elif unpinned_budget > 0:
                unpinned_budget -= 1
                kept.append(f)
        combined = kept

    _atomic_write_json(path, {"version": 1, "updatedAt": now, "facts": combined})
    return {"ok": True, "fact": saved, "total": len(combined)}


def delete_global_user_memory_fallback(
    xox_config_dir: Optional[Path],
    id_or_key: str,
) -> Dict[str, Any]:
    if xox_config_dir is None:
        return {"ok": False, "error": "Falta `xox_config_dir` para consultar memoria global del usuario."}
    target = str(id_or_key or "").strip()
    if not target:
        return {"ok": False, "error": "Indica `id_or_key` del dato a olvidar."}
    target_low = target.lower()

    path = xox_config_dir / USER_MEMORY_FILENAME
    raw_store = _read_json_with_backup(path)
    facts: List[Dict[str, Any]] = (
        [f for f in raw_store.get("facts", []) if isinstance(f, dict)]
        if isinstance(raw_store, dict) and isinstance(raw_store.get("facts"), list)
        else []
    )
    filtered = [
        item
        for item in facts
        if str(item.get("id") or "") != target and str(item.get("key") or "").strip().lower() != target_low
    ]
    if len(filtered) != len(facts):
        _atomic_write_json(path, {"version": 1, "updatedAt": _now_iso(), "facts": filtered})
    return {"ok": True, "removed": len(facts) - len(filtered), "total": len(filtered)}


def patch_local_user_fallback(
    xox_config_dir: Optional[Path],
    patch: Dict[str, Any],
) -> Dict[str, Any]:
    if xox_config_dir is None:
        return {"ok": False, "error": "Falta `xox_config_dir` para guardar el perfil del usuario."}

    for raw_val in patch.values():
        if isinstance(raw_val, str) and contains_secret_material(raw_val):
            return {
                "ok": False,
                "error": "Por seguridad, no se guardan claves API, tokens ni llaves privadas en el perfil.",
            }

    path = xox_config_dir / LOCAL_USER_FILENAME
    existing = _read_json_with_backup(path)
    existing_dict = existing if isinstance(existing, dict) else {}
    now = _now_iso()

    def _pick_str(*keys: str) -> Optional[str]:
        for k in keys:
            if k in patch and isinstance(patch[k], str):
                return " ".join(patch[k].split()).strip()
        return None

    name_in = _pick_str("name")
    pref_in = _pick_str("preferred_name", "preferredName")
    resolved_name = name_in or str(existing_dict.get("name") or "").strip() or pref_in or ""
    if not resolved_name:
        return {
            "ok": False,
            "error": "Aún no existe un perfil local con nombre para actualizar.",
        }

    store_in = _pick_str("store_name", "storeName")
    role_in = _pick_str("role")
    profile: Dict[str, Any] = {
        "id": str(existing_dict.get("id") or f"usr_{int(time.time() * 1000)}"),
        "name": resolved_name[:120],
        "storeName": store_in or str(existing_dict.get("storeName") or "Mi Tienda"),
        "role": role_in or str(existing_dict.get("role") or "Administrador"),
        "createdAt": str(existing_dict.get("createdAt") or now),
        "updatedAt": now,
    }

    optional_specs = (
        (("preferred_name", "preferredName"), "preferredName", 80),
        (("occupation",), "occupation", MAX_PROFILE_FIELD_CHARS),
        (("work_context", "workContext"), "workContext", MAX_PROFILE_FIELD_CHARS),
        (("language",), "language", 64),
        (("timezone",), "timezone", 64),
        (("notes",), "notes", MAX_PROFILE_NOTES_CHARS),
    )
    for in_keys, out_key, max_len in optional_specs:
        incoming = _pick_str(*in_keys)
        if incoming is not None:
            if incoming:
                profile[out_key] = incoming[:max_len].strip()
        elif isinstance(existing_dict.get(out_key), str) and existing_dict[out_key].strip():
            profile[out_key] = existing_dict[out_key].strip()[:max_len]

    _atomic_write_json(path, profile)
    return {"ok": True, "profile": profile}


def upsert_workspace_fact_md(
    workspace_root: Path,
    *,
    fact: str,
    category: str = "negocio",
    key: Optional[str] = None,
) -> Dict[str, Any]:
    clean_fact = " ".join(str(fact or "").split()).strip()
    if not clean_fact:
        return {"ok": False, "error": "Falta el contenido del hecho a registrar."}
    if contains_secret_material(clean_fact):
        return {
            "ok": False,
            "error": "Por seguridad, no se guardan claves API, tokens ni llaves privadas en memoria.",
        }

    clean_cat = " ".join(str(category or "negocio").split()).strip()[:40] or "negocio"
    norm_key = normalize_memory_key(key, clean_cat, clean_fact) if str(key or "").strip() else ""
    now_str = datetime.now().astimezone().strftime("%Y-%m-%d %H:%M")
    key_prefix = f"[key:{norm_key}] " if norm_key else ""
    new_line = f"- [{now_str}] ({clean_cat}) {key_prefix}{clean_fact}"

    target = workspace_root / "memoria" / "hechos.md"
    existing = target.read_text(encoding="utf-8") if target.is_file() else "# Hechos del negocio\n\n"
    lines = existing.splitlines()

    def _extract_body_and_key(raw_line: str) -> Tuple[str, str]:
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("#") or stripped == "---":
            return "", ""
        body = stripped.lstrip("-*• ").strip()
        ts_m = _TIMESTAMP_PREFIX_RE.match(body)
        if ts_m:
            body = ts_m.group(2).strip()
        cat_m = _CAT_PAREN_RE.match(body) or _CAT_BRACKET_RE.match(body)
        if cat_m:
            body = cat_m.group(2).strip()
        found_key = ""
        key_m = _KEY_BRACKET_RE.match(body)
        if key_m:
            found_key = key_m.group(1)
            body = key_m.group(2).strip()
        return found_key, " ".join(body.split()).lower()

    target_val_low = clean_fact.lower()
    replaced = False
    new_lines: List[str] = []
    for ln in lines:
        line_key, line_val = _extract_body_and_key(ln)
        same_key = bool(norm_key and line_key and line_key == norm_key)
        same_val = bool(line_val and line_val == target_val_low)
        if not replaced and (same_key or same_val):
            new_lines.append(new_line)
            replaced = True
        elif same_key or same_val:
            continue
        else:
            new_lines.append(ln)

    if not replaced:
        if not new_lines:
            new_lines = ["# Hechos del negocio", ""]
        new_lines.append(new_line)

    _atomic_write_text(target, "\n".join(new_lines).rstrip() + "\n")
    return {
        "ok": True,
        "path": "memoria/hechos.md",
        "recorded": new_line,
        "deduplicated": replaced,
    }


def _format_user_fact_line(item: Dict[str, Any]) -> str:
    val = " ".join(str(item.get("value") or "").split()).strip()
    if not val or contains_secret_material(val):
        return ""
    cat = normalize_category(item.get("category"))
    key = str(item.get("key") or "").strip()
    if key and contains_secret_material(key):
        return ""
    return f"- [{cat}] ({key}): {val}" if key else f"- [{cat}] {val}"


def _extract_query_keywords(query: str) -> List[str]:
    if not query or not isinstance(query, str):
        return []
    folded = _ascii_fold(query).lower()
    raw_tokens = re.findall(r"[a-z0-9_]{3,}", folded)
    out: List[str] = []
    seen = set()
    for tok in raw_tokens:
        if len(tok) < 3 or tok in _QUERY_STOPWORDS:
            continue
        if tok not in seen:
            seen.add(tok)
            out.append(tok)
    return out


def _token_matches_haystack(token: str, haystack: str) -> bool:
    if not token or not haystack:
        return False
    if token in haystack:
        return True
    if len(token) >= 5 and token.endswith("s") and token[:-1] in haystack:
        return True
    return False


def _score_fact_query_match(item: Dict[str, Any], query_tokens: List[str]) -> int:
    if not query_tokens:
        return 0
    key_fold = _ascii_fold(str(item.get("key") or "")).lower()
    val_fold = _ascii_fold(str(item.get("value") or "")).lower()
    cat = normalize_category(item.get("category"))
    cat_fold = _CATEGORY_SYNONYMS.get(cat, cat)
    score = 0
    for tok in query_tokens:
        if _token_matches_haystack(tok, key_fold):
            score += 3
        if _token_matches_haystack(tok, val_fold):
            score += 2
        if _token_matches_haystack(tok, cat_fold):
            score += 1
    return score


def format_user_memory_block(facts: Optional[List[Dict[str, Any]]], max_chars: int = 1800) -> str:
    if not isinstance(facts, list) or not facts or max_chars <= 0:
        return ""
    valid = [f for f in facts if isinstance(f, dict) and str(f.get("value") or "").strip()]
    ordered = sorted(
        valid,
        key=lambda item: (
            1 if item.get("pinned") else 0,
            str(item.get("updatedAt") or item.get("updated_at") or ""),
        ),
        reverse=True,
    )
    out_lines: List[str] = []
    used = 0
    for item in ordered:
        line = _format_user_fact_line(item)
        if not line:
            continue
        add_len = len(line) + (1 if out_lines else 0)
        if used + add_len > max_chars:
            break
        out_lines.append(line)
        used += add_len
    return "\n".join(out_lines)


def select_startup_user_memory_block(
    facts: Optional[List[Dict[str, Any]]],
    query: str = "",
    l0_max_chars: int = 450,
    l1_max_chars: int = 650,
) -> str:
    """
    Selección jerárquica de memoria global del usuario para el prompt inicial:
    - L0 Core (Always-On): hechos con `pinned=True` o categoría `identity`, hasta `l0_max_chars`.
    - L1 Contextual (Query-Activated): hechos restantes con coincidencia (`score > 0`) con `query`, hasta `l1_max_chars`.
      Si `query` está vacía, es un saludo o no tiene coincidencias, L1 inyecta 0 caracteres.
    - L2 On-Demand Index: los hechos restantes no inyectan su texto; se resumen en 1 línea compacta.
    """
    if not isinstance(facts, list) or not facts:
        return ""

    valid_items: List[Tuple[Dict[str, Any], str]] = []
    for raw in facts:
        if not isinstance(raw, dict):
            continue
        line = _format_user_fact_line(raw)
        if not line:
            continue
        valid_items.append((raw, line))

    if not valid_items:
        return ""

    def _recency_key(pair: Tuple[Dict[str, Any], str]) -> Tuple[int, str]:
        item = pair[0]
        return (
            1 if item.get("pinned") else 0,
            str(item.get("updatedAt") or item.get("updated_at") or ""),
        )

    l0_candidates: List[Tuple[Dict[str, Any], str]] = []
    non_l0_candidates: List[Tuple[Dict[str, Any], str]] = []
    for item, line in valid_items:
        cat = normalize_category(item.get("category"))
        if bool(item.get("pinned")) or cat == "identity":
            l0_candidates.append((item, line))
        else:
            non_l0_candidates.append((item, line))

    l0_candidates.sort(key=_recency_key, reverse=True)

    l0_lines: List[str] = []
    l0_used = 0
    overflow_from_l0: List[Tuple[Dict[str, Any], str]] = []
    for item, line in l0_candidates:
        add_len = len(line) + (1 if l0_lines else 0)
        if l0_max_chars > 0 and l0_used + add_len <= l0_max_chars:
            l0_lines.append(line)
            l0_used += add_len
        else:
            overflow_from_l0.append((item, line))

    remaining_pool = [*overflow_from_l0, *non_l0_candidates]
    query_tokens = _extract_query_keywords(query)

    scored_l1: List[Tuple[int, str, Dict[str, Any], str]] = []
    unmatched_for_l2: List[Dict[str, Any]] = []
    for item, line in remaining_pool:
        score = _score_fact_query_match(item, query_tokens)
        if score > 0 and l1_max_chars > 0:
            updated = str(item.get("updatedAt") or item.get("updated_at") or "")
            scored_l1.append((score, updated, item, line))
        else:
            unmatched_for_l2.append(item)

    scored_l1.sort(key=lambda entry: (entry[0], 1 if entry[2].get("pinned") else 0, entry[1]), reverse=True)

    l1_lines: List[str] = []
    l1_used = 0
    l2_items: List[Dict[str, Any]] = []
    for _score, _updated, item, line in scored_l1:
        add_len = len(line) + (1 if l1_lines else 0)
        if l1_used + add_len <= l1_max_chars:
            l1_lines.append(line)
            l1_used += add_len
        else:
            l2_items.append(item)

    l2_items.extend(unmatched_for_l2)

    out_lines: List[str] = [*l0_lines, *l1_lines]
    if l2_items:
        cats_ordered = list(dict.fromkeys(normalize_category(item.get("category")) for item in l2_items))
        cats_csv = ", ".join(cats_ordered) if cats_ordered else "other"
        out_lines.append(
            f"- [índice_memoria_l2] ({len(l2_items)} dato(s) adicionales en {cats_csv}; usa memory_search si necesitas consultarlos)"
        )

    return "\n".join(out_lines)


def select_startup_workspace_facts_block(
    raw_facts_md: str,
    query: str = "",
    max_chars: int = 700,
) -> str:
    """
    Compacta `memoria/hechos.md` para el prompt inicial:
    - Conserva los 2 hechos más recientes (últimos 2 bullets) MÁS cualquier bullet relevante a `query`, hasta `max_chars`.
    - Si se omitieron bullets, agrega una línea compacta indicando cuántos hechos adicionales hay bajo demanda.
    """
    if not raw_facts_md or not isinstance(raw_facts_md, str) or max_chars <= 0:
        return ""

    bullets: List[str] = []
    for raw_ln in raw_facts_md.splitlines():
        stripped = raw_ln.strip()
        if not stripped or stripped.startswith("#") or stripped == "---":
            continue
        if stripped.startswith(("-", "*", "•")):
            body = stripped.lstrip("-*• ").strip()
            if body and not contains_secret_material(body):
                bullets.append(f"- {body}")

    if not bullets:
        return ""

    query_tokens = _extract_query_keywords(query)
    scores: List[int] = []
    for line in bullets:
        folded = _ascii_fold(line).lower()
        sc = sum(2 for tok in query_tokens if _token_matches_haystack(tok, folded))
        scores.append(sc)

    recent_idxs: List[int] = []
    for idx in (len(bullets) - 1, len(bullets) - 2):
        if idx >= 0 and idx not in recent_idxs:
            recent_idxs.append(idx)

    matching_idxs = sorted(
        [idx for idx, sc in enumerate(scores) if sc > 0],
        key=lambda idx: (scores[idx], idx),
        reverse=True,
    )

    priority_idxs: List[int] = []
    if matching_idxs:
        # Garantizar el mejor match y los 2 hechos más recientes primero, luego el resto de matches
        for candidate in (matching_idxs[0], *recent_idxs, *matching_idxs[1:]):
            if candidate not in priority_idxs:
                priority_idxs.append(candidate)
    else:
        priority_idxs.extend(recent_idxs)

    chosen_set = set()
    used = 0
    for idx in priority_idxs:
        line = bullets[idx]
        add_len = len(line) + (1 if chosen_set else 0)
        if used + add_len <= max_chars:
            chosen_set.add(idx)
            used += add_len

    if not chosen_set and bullets:
        chosen_set.add(len(bullets) - 1)
        bullets[len(bullets) - 1] = bullets[len(bullets) - 1][:max_chars]

    ordered_idxs = sorted(chosen_set)
    out_lines = [bullets[idx] for idx in ordered_idxs]
    omitted_count = len(bullets) - len(ordered_idxs)
    if omitted_count > 0:
        out_lines.append(
            f"- [+{omitted_count} hecho(s) en memoria/hechos.md disponibles bajo demanda con memory_search]"
        )

    return "\n".join(out_lines)


def execute_user_memory_tool(
    tool_name: str,
    args: Dict[str, Any],
    *,
    xox_config_dir: Optional[Path] = None,
    workspace_root: Optional[Path] = None,
    command_bridge: Optional[Callable[[Dict[str, Any]], Dict[str, Any]]] = None,
    source_window: str = "main",
    emit_event: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> Dict[str, Any]:
    """Ejecuta `save_user_info` o `forget_user_info` con o sin workspace activo."""
    win_scope = normalize_window_scope(source_window)
    args = args if isinstance(args, dict) else {}

    def _call_bridge(rpc_name: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        if command_bridge is None:
            return {"ok": False, "error": "Puente IPC no disponible."}
        return command_bridge({
            "rpc_callback": rpc_name,
            "request_id": f"umem_{uuid.uuid4().hex[:12]}",
            **payload,
        })

    if tool_name == "forget_user_info":
        id_or_key = str(args.get("id_or_key") or args.get("key") or "").strip()
        if not id_or_key:
            return {"ok": False, "error": "Indica `id_or_key` con el dato o clave a olvidar."}
        if command_bridge is not None:
            res = _call_bridge(
                "delete_user_memory_fact",
                {"id_or_key": id_or_key, "source_window": win_scope},
            )
        else:
            res = delete_global_user_memory_fallback(xox_config_dir, id_or_key)
        if res.get("ok") and emit_event is not None:
            emit_event({"type": "user_memory_updated", "action": "forget_user_info", "key": id_or_key})
        return res

    if tool_name != "save_user_info":
        return {"ok": False, "error": f"Herramienta no soportada: {tool_name}"}

    profile_fields = (
        "name",
        "preferred_name",
        "role",
        "store_name",
        "occupation",
        "work_context",
        "language",
        "timezone",
        "notes",
    )
    profile_patch: Dict[str, Any] = {}
    for field in profile_fields:
        val = args.get(field)
        if isinstance(val, str) and val.strip():
            profile_patch[field] = val.strip()

    raw_fact = str(args.get("value") or args.get("fact") or "").strip()
    scope = str(args.get("scope") or "global").strip().lower()
    if scope not in ("global", "workspace"):
        scope = "global"
    raw_cat = str(args.get("category") or ("identity" if profile_patch and not raw_fact else "other")).strip()
    raw_key = str(args.get("key") or "").strip()
    pinned = bool(args.get("pinned", False))

    if not profile_patch and not raw_fact:
        return {
            "ok": False,
            "error": "Indica al menos un dato en `value` o un campo del perfil (`name`, `occupation`, `work_context`, etc.).",
        }

    for blob in [*profile_patch.values(), raw_fact]:
        if isinstance(blob, str) and contains_secret_material(blob):
            return {
                "ok": False,
                "error": "Por seguridad, no se guardan claves API, tokens ni llaves privadas en memoria del usuario.",
            }

    out: Dict[str, Any] = {"ok": True, "source_window": win_scope}

    # 1. Actualización del perfil si se enviaron campos de perfil
    if profile_patch:
        if command_bridge is not None:
            prof_res = _call_bridge("update_local_user_profile", profile_patch)
        else:
            prof_res = patch_local_user_fallback(xox_config_dir, profile_patch)

        if prof_res.get("ok"):
            out["profile"] = prof_res.get("profile")
            out["profile_updated"] = True
        else:
            # Si aún no hay nombre creado en local-user.json, NO perdemos el dato: lo guardamos como hecho global.
            err_msg = str(prof_res.get("error") or "")
            if not raw_fact and "no existe" in err_msg.lower():
                raw_fact = ", ".join(f"{k}: {v}" for k, v in profile_patch.items())
                raw_cat = "identity"
                if not raw_key:
                    raw_key = "user_profile_context"
                out["profile_deferred_note"] = err_msg
            else:
                return prof_res

    # 2. Guardado de hecho estructurado (global o workspace)
    if raw_fact:
        if scope == "workspace":
            if workspace_root is None:
                # Si no hay workspace abierto, caer de forma segura a memoria global en lugar de fallar.
                scope = "global"
            else:
                ws_res = upsert_workspace_fact_md(
                    workspace_root,
                    fact=raw_fact,
                    category=raw_cat or "negocio",
                    key=raw_key or None,
                )
                if not ws_res.get("ok"):
                    return ws_res
                out["fact_recorded"] = ws_res
                out["scope"] = "workspace"
                if emit_event is not None:
                    emit_event({"type": "workspace_changed", "path": "memoria/hechos.md", "action": "save_user_info"})
                return out

        if command_bridge is not None:
            mem_res = _call_bridge(
                "save_user_memory_fact",
                {
                    "value": raw_fact,
                    "key": raw_key or None,
                    "category": normalize_category(raw_cat),
                    "scope": "global",
                    "source_window": win_scope,
                    "pinned": pinned,
                },
            )
        else:
            mem_res = upsert_global_user_memory_fallback(
                xox_config_dir,
                value=raw_fact,
                category=raw_cat,
                key=raw_key or None,
                pinned=pinned,
                source_window=win_scope,
            )
        if not mem_res.get("ok"):
            return mem_res
        out["fact_recorded"] = mem_res.get("fact")
        out["total_facts"] = mem_res.get("total")
        out["memory_updated"] = True
        out["scope"] = "global"

    if emit_event is not None and (out.get("profile_updated") or out.get("memory_updated")):
        emit_event({
            "type": "user_memory_updated",
            "action": "save_user_info",
            "profile_updated": bool(out.get("profile_updated")),
            "memory_updated": bool(out.get("memory_updated")),
        })
    return out
