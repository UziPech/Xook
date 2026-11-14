"""Gestión segura de habilidades aprendidas, perfil del usuario y skills oficiales (`skills.sh`)."""

from __future__ import annotations

import datetime as _dt
import json
import os
import re
import ssl
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

# Solo organizaciones verificadas / publicadores oficiales reconocidos.
OFFICIAL_SKILL_PUBLISHERS: frozenset[str] = frozenset(
    {
        "anthropics",
        "vercel-labs",
        "google",
        "google-gemini",
        "modelcontextprotocol",
        "agentskills",
        "openai",
        "huggingface",
        "supabase",
        "stripe",
        "cloudflare",
        "tailwindlabs",
    }
)

SKILLS_SH_SEARCH_URL = "https://skills.sh/api/search"
USER_PROFILE_REL = "habilidades/perfil-usuario.md"
SKILLS_AUDIT_LOG_REL = "agente/logs/skills-audit.jsonl"
MAX_SKILL_BYTES = 240_000

_SLUG_REPO_RE = re.compile(r"^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$")
_SLUG_PART_RE = re.compile(r"^[A-Za-z0-9._-]+$")

# Caracteres invisibles o direccionales usados en ataques de inyección oculta (Trojan Source / Bidi)
_HIDDEN_UNICODE_RE = re.compile(
    r"[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]"
)

# Reglas estáticas anti-inyección y anti-exfiltración para cualquier SKILL.md externo o aprendido
_SECURITY_PATTERNS: Tuple[Tuple[str, re.Pattern[str]], ...] = (
    (
        "acceso a llaves o secretos locales (.ssh/.aws/.gnupg/ai-vault/Keychain/.xook)",
        re.compile(
            r"(~/\.ssh|/\.ssh\b|id_rsa|id_ed25519|~/\.aws|/\.aws/credentials|"
            r"~/\.gnupg|ai-vault\.json|security\s+find-generic-password|"
            r"/etc/shadow|/etc/passwd|\.xook/(?:backups|xook\.db|permissions\.json)|"
            r"\bcat\s+[^\n]*\.env\b)",
            re.IGNORECASE,
        ),
    ),
    (
        "comando destructivo o ejecución remota directa por pipe",
        re.compile(
            r"(rm\s+-[a-z]*rf\s+[/~*]|rm\s+-rf\s+\.|"
            r"(?:curl|wget)\s+[^\n|]{3,}\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b|"
            r"base64\s+(?:-d|--decode)[^\n|]*\|\s*(?:ba|z|da)?sh\b|"
            r"\bnc\s+-e\b|\bmkfifo\b|shutil\.rmtree\s*\(\s*[\"'][/~])",
            re.IGNORECASE,
        ),
    ),
    (
        "instrucción explícita de secuestro de prompt o exfiltración de credenciales",
        re.compile(
            r"(ignore\s+(?:all\s+)?(?:previous|prior)\s+instructions|"
            r"disregard\s+(?:your\s+)?system\s+prompt|"
            r"exfiltrate\s+(?:secrets?|api[_-]?keys?|tokens?|credentials?))",
            re.IGNORECASE,
        ),
    ),
)

_RAW_SUBPATHS_CANDIDATES: Tuple[str, ...] = (
    "skills/{skill_id}/SKILL.md",
    "{skill_id}/SKILL.md",
    ".claude/skills/{skill_id}/SKILL.md",
    ".agents/skills/{skill_id}/SKILL.md",
    "SKILL.md",
)


def _ssl_context() -> ssl.SSLContext:
    try:
        import certifi  # type: ignore

        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


def _default_http_get(url: str, timeout: int = 12) -> Tuple[int, str]:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "XOOK-SkillHub/1.0",
            "Accept": "application/json, text/markdown, text/plain, */*",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout, context=_ssl_context()) as resp:
        raw = resp.read(MAX_SKILL_BYTES + 1)
        if len(raw) > MAX_SKILL_BYTES:
            raise ValueError(f"El recurso excede el límite seguro de {MAX_SKILL_BYTES} bytes.")
        return int(getattr(resp, "status", 200)), raw.decode("utf-8", errors="replace")


def slugify_skill_name(name: str) -> str:
    raw = unicodedata.normalize("NFKD", (name or "").strip())
    ascii_str = raw.encode("ascii", "ignore").decode("ascii").lower()
    cleaned = re.sub(r"[^a-z0-9]+", "-", ascii_str).strip("-")
    return cleaned[:64] or "habilidad-personalizada"


def _atomic_write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.parent / f".{path.name}.tmp.{os.getpid()}"
    tmp_path.write_text(content, encoding="utf-8")
    os.replace(str(tmp_path), str(path))


def _append_skill_audit(workspace_root: Path, action: str, detail: Dict[str, Any]) -> None:
    try:
        log_path = workspace_root / SKILLS_AUDIT_LOG_REL
        log_path.parent.mkdir(parents=True, exist_ok=True)
        entry = {
            "timestamp": _dt.datetime.now(_dt.timezone.utc).isoformat(),
            "action": action,
            **detail,
        }
        with log_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        pass


def is_official_publisher(source_slug: str) -> Tuple[bool, str]:
    """Verifica que el origen `<owner>/<repo>` pertenezca a un publicador oficial permitido."""
    clean = (source_slug or "").strip()
    if not _SLUG_REPO_RE.match(clean):
        return False, ""
    owner = clean.split("/", 1)[0].lower()
    return (owner in OFFICIAL_SKILL_PUBLISHERS), owner


def scan_skill_security(raw_md: str) -> List[str]:
    """Escanea markdown de habilidades en busca de inyección oculta, acceso a secretos o RCE."""
    if not isinstance(raw_md, str) or not raw_md.strip():
        return ["contenido vacío"]
    if len(raw_md.encode("utf-8", errors="ignore")) > MAX_SKILL_BYTES:
        return [f"excede el tamaño máximo permitido ({MAX_SKILL_BYTES} bytes)"]

    check_body = raw_md[1:] if raw_md.startswith("\ufeff") else raw_md
    findings: List[str] = []
    if _HIDDEN_UNICODE_RE.search(check_body):
        findings.append("caracteres Unicode invisibles o bidireccionales ocultos")
    for label, pattern in _SECURITY_PATTERNS:
        if pattern.search(check_body):
            findings.append(label)
    return findings


def parse_skill_frontmatter(raw_md: str) -> Tuple[Dict[str, str], str]:
    """Parsea frontmatter YAML simple (`--- ... ---`) sin dependencias externas."""
    text = (raw_md or "").lstrip("\ufeff")
    if not text.startswith("---"):
        return {}, text.strip()
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, text.strip()
    end_idx = -1
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            end_idx = i
            break
    if end_idx <= 0:
        return {}, text.strip()

    meta: Dict[str, str] = {}
    current_key: Optional[str] = None
    for raw_line in lines[1:end_idx]:
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if ":" in raw_line and not raw_line[0].isspace():
            key_part, val_part = raw_line.split(":", 1)
            k = key_part.strip().lower()
            v = val_part.strip().strip('"').strip("'").strip()
            if k:
                current_key = k
                if v not in ("|", ">", "|-", ">-"):
                    meta[k] = v
                else:
                    meta[k] = ""
        elif current_key and raw_line[0].isspace():
            extra = stripped.strip("- ").strip()
            if extra:
                prev = meta.get(current_key, "")
                meta[current_key] = f"{prev} {extra}".strip() if prev else extra

    body = "\n".join(lines[end_idx + 1 :]).strip()
    return meta, body


def _normalize_clean_bullets(items: Optional[List[str]], *, max_items: int = 24) -> List[str]:
    seen = set()
    out: List[str] = []
    for raw in items or []:
        clean = re.sub(r"\s+", " ", str(raw or "").lstrip("-*• ").strip())
        if not clean:
            continue
        key = clean.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(clean)
        if len(out) >= max_items:
            break
    return out


def load_user_preferences_doc(workspace_root: Path) -> Dict[str, Any]:
    """Lee `habilidades/perfil-usuario.md` y extrae Gustos, Flujo y Qué NO hacer."""
    target = workspace_root / USER_PROFILE_REL
    if not target.is_file():
        return {
            "exists": False,
            "path": USER_PROFILE_REL,
            "raw": "",
            "likes": [],
            "workflows": [],
            "donts": [],
            "compact_prompt": "",
        }
    try:
        raw = target.read_text(encoding="utf-8", errors="replace")
    except Exception:
        raw = ""

    section = ""
    likes: List[str] = []
    workflows: List[str] = []
    donts: List[str] = []

    for line in raw.splitlines():
        s = line.strip()
        low = s.lower()
        if s.startswith("#"):
            if "gusto" in low or "estilo" in low or "preferencia" in low:
                section = "likes"
            elif "flujo" in low or "workflow" in low or "proceso" in low:
                section = "workflows"
            elif "no hacer" in low or "evitar" in low or "límite" in low or "limite" in low:
                section = "donts"
            else:
                section = ""
            continue
        if s.startswith(("-", "*", "•")):
            item = s.lstrip("-*• ").strip()
            if not item:
                continue
            if section == "likes":
                likes.append(item)
            elif section == "workflows":
                workflows.append(item)
            elif section == "donts":
                donts.append(item)

    parts: List[str] = []
    if likes:
        parts.append("Gustos y estilo: " + " | ".join(likes[:8]))
    if workflows:
        parts.append("Flujo preferido: " + " | ".join(workflows[:8]))
    if donts:
        parts.append("Qué NO hacer: " + " | ".join(donts[:10]))
    compact_prompt = "\n".join(parts)
    if not compact_prompt and raw.strip():
        compact_prompt = raw.strip()[:1000]

    return {
        "exists": True,
        "path": USER_PROFILE_REL,
        "raw": raw,
        "likes": likes,
        "workflows": workflows,
        "donts": donts,
        "compact_prompt": compact_prompt,
    }


def _snapshot_backup_if_dir(workspace_root: Path, rel_path: str, content: str) -> None:
    try:
        backups_dir = workspace_root / ".xook" / "backups"
        if (workspace_root / ".xook").is_dir():
            backups_dir.mkdir(parents=True, exist_ok=True)
            backup_name = rel_path.replace("/", "__").replace("\\", "__")
            (backups_dir / backup_name).write_text(content, encoding="utf-8")
    except Exception:
        pass


def update_user_preferences_doc(
    workspace_root: Path,
    *,
    likes: Optional[List[str]] = None,
    workflows: Optional[List[str]] = None,
    donts: Optional[List[str]] = None,
    mode: str = "merge",
) -> Dict[str, Any]:
    """Actualiza el espacio estructurado de gustos, flujo y reglas negativas del usuario."""
    current = load_user_preferences_doc(workspace_root)
    mode_norm = (mode or "merge").strip().lower()

    def _combine(existing: List[str], incoming: Optional[List[str]]) -> List[str]:
        if incoming is None:
            return list(existing)
        clean_in = _normalize_clean_bullets(incoming)
        if mode_norm == "replace":
            return clean_in
        if mode_norm == "remove":
            remove_keys = {i.lower() for i in clean_in}
            return [e for e in existing if e.lower() not in remove_keys]
        return _normalize_clean_bullets([*existing, *clean_in])

    next_likes = _combine(current["likes"], likes)
    next_workflows = _combine(current["workflows"], workflows)
    next_donts = _combine(current["donts"], donts)

    if not (next_likes or next_workflows or next_donts):
        return {
            "ok": False,
            "error": "El perfil del usuario debe conservar al menos un lineamiento activo.",
        }

    lines = [
        "# Perfil del Usuario, Gustos, Flujo y Límites",
        "",
        "Este espacio guía a **Xox** sobre tu forma de trabajar, preferencias y qué evitar.",
        "",
        "## Gustos y Estilo",
    ]
    for item in next_likes or ["Español claro, directo y práctico."]:
        lines.append(f"- {item}")
    lines.extend(["", "## Flujo de Trabajo Preferido"])
    for item in next_workflows or ["Validar datos reales del workspace antes de actuar."]:
        lines.append(f"- {item}")
    lines.extend(["", "## Qué NO Hacer"])
    for item in next_donts or ["Nunca inventar información ni borrar archivos clave sin confirmación."]:
        lines.append(f"- {item}")
    rendered = "\n".join(lines).rstrip() + "\n"

    findings = scan_skill_security(rendered)
    if findings:
        return {
            "ok": False,
            "error": "Contenido rechazado por el filtro de seguridad: " + "; ".join(findings),
        }

    target = workspace_root / USER_PROFILE_REL
    _atomic_write_text(target, rendered)
    _snapshot_backup_if_dir(workspace_root, USER_PROFILE_REL, rendered)
    _append_skill_audit(
        workspace_root,
        "user_preferences_updated",
        {
            "path": USER_PROFILE_REL,
            "mode": mode_norm,
            "counts": {
                "likes": len(next_likes),
                "workflows": len(next_workflows),
                "donts": len(next_donts),
            },
        },
    )
    return {
        "ok": True,
        "path": USER_PROFILE_REL,
        "likes": next_likes,
        "workflows": next_workflows,
        "donts": next_donts,
    }


def save_learned_skill(
    workspace_root: Path,
    *,
    name: str,
    description: str,
    instructions: str,
    role: str = "",
    domain: str = "general",
    user_preferences: Optional[List[str]] = None,
    workflow_steps: Optional[List[str]] = None,
    do_not_do: Optional[List[str]] = None,
    source: str = "learned-from-user",
) -> Dict[str, Any]:
    """Guarda o actualiza una skill aprendida en `habilidades/<slug>/SKILL.md`."""
    clean_name = re.sub(r"\s+", " ", (name or "").strip())
    clean_desc = re.sub(r"\s+", " ", (description or "").strip())
    clean_inst = (instructions or "").strip()
    if not clean_name or not clean_desc:
        return {"ok": False, "error": "`name` y `description` son obligatorios."}
    if not clean_inst and not (user_preferences or workflow_steps or do_not_do):
        return {
            "ok": False,
            "error": "Proporciona instrucciones, pasos de flujo o reglas claras para guardar la habilidad.",
        }

    slug = slugify_skill_name(clean_name)
    rel_path = f"habilidades/{slug}/SKILL.md"
    now_iso = _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%d")

    fm_lines = [
        "---",
        f'name: "{slug}"',
        f'description: "{clean_desc.replace(chr(34), chr(39))}"',
    ]
    if role.strip():
        fm_lines.append(f'role: "{role.strip().replace(chr(34), chr(39))}"')
    if domain.strip():
        fm_lines.append(f'domain: "{domain.strip().replace(chr(34), chr(39))}"')
    fm_lines.extend(
        [
            f'source: "{(source or "learned-from-user").strip()}"',
            f'updated_at: "{now_iso}"',
            "---",
            "",
            f"# {clean_name}",
            "",
            f"**Propósito:** {clean_desc}",
        ]
    )

    prefs = _normalize_clean_bullets(user_preferences)
    steps = _normalize_clean_bullets(workflow_steps)
    donts = _normalize_clean_bullets(do_not_do)

    if prefs:
        fm_lines.extend(["", "## Gustos y Estilo del Usuario", *[f"- {p}" for p in prefs]])
    if steps:
        fm_lines.extend(["", "## Flujo de Trabajo", *[f"- {s}" for s in steps]])
    if donts:
        fm_lines.extend(["", "## Qué NO Hacer", *[f"- {d}" for d in donts]])
    if clean_inst:
        fm_lines.extend(["", "## Criterios e Instrucciones", clean_inst])

    rendered = "\n".join(fm_lines).rstrip() + "\n"
    findings = scan_skill_security(rendered)
    if findings:
        return {
            "ok": False,
            "error": "La habilidad fue bloqueada por seguridad: " + "; ".join(findings),
            "security_findings": findings,
        }

    target = workspace_root / rel_path
    _atomic_write_text(target, rendered)
    _append_skill_audit(
        workspace_root,
        "skill_learned",
        {"path": rel_path, "slug": slug, "role": role.strip(), "domain": domain.strip()},
    )
    return {
        "ok": True,
        "slug": slug,
        "path": rel_path,
        "name": clean_name,
        "description": clean_desc,
        "role": role.strip(),
        "domain": domain.strip(),
    }


def index_workspace_skills(
    workspace_root: Path,
    *,
    built_in_skills_dir: Optional[Path] = None,
    active_role: str = "",
) -> Dict[str, Any]:
    """Genera un índice compacto de skills de `habilidades/` (progressive disclosure)."""
    entries: List[Dict[str, Any]] = []
    seen_rel = set()
    active_norm = slugify_skill_name(active_role) if active_role.strip() else ""
    active_low = active_role.strip().lower()

    def _collect_md(path: Path, rel_str: str, builtin: bool = False) -> None:
        if rel_str in seen_rel:
            return
        seen_rel.add(rel_str)
        try:
            raw = path.read_text(encoding="utf-8", errors="replace")
        except Exception:
            return
        if scan_skill_security(raw):
            return
        meta, body = parse_skill_frontmatter(raw)
        fallback_slug = path.parent.name if path.name.upper() == "SKILL.MD" else path.stem
        name = meta.get("name") or fallback_slug
        slug = slugify_skill_name(name)
        desc = meta.get("description") or ""
        if not desc and body:
            for line in body.splitlines():
                s = line.strip().lstrip("#").strip()
                if s:
                    desc = s[:180]
                    break
        role_val = meta.get("role", "")
        domain_val = meta.get("domain", "")
        is_active = bool(
            active_low
            and (
                active_low == role_val.lower()
                or active_low == name.lower()
                or active_norm == slug
                or (role_val and active_low in role_val.lower())
            )
        )
        entries.append(
            {
                "slug": slug,
                "name": name,
                "description": desc[:200],
                "role": role_val,
                "domain": domain_val,
                "source": meta.get("source", "builtin" if builtin else "workspace"),
                "rel_path": rel_str,
                "builtin": builtin,
                "active_match": is_active,
                "body": body[:2400] if is_active else "",
            }
        )

    hab_dir = workspace_root / "habilidades"
    if hab_dir.is_dir():
        for skill_md in sorted(hab_dir.glob("*/SKILL.md")):
            rel = f"habilidades/{skill_md.parent.name}/SKILL.md"
            _collect_md(skill_md, rel, builtin=False)
        for root_md in sorted(hab_dir.glob("*.md")):
            if root_md.name.lower() in ("perfil-usuario.md", "readme.md"):
                continue
            _collect_md(root_md, f"habilidades/{root_md.name}", builtin=False)

    if built_in_skills_dir is not None and built_in_skills_dir.is_dir():
        for skill_md in sorted(built_in_skills_dir.glob("*/SKILL.md")):
            rel = f"builtin:skills/{skill_md.parent.name}/SKILL.md"
            _collect_md(skill_md, rel, builtin=True)

    return {
        "skills": entries,
        "user_profile": load_user_preferences_doc(workspace_root),
    }


def discover_official_skills(
    query: str,
    *,
    limit: int = 8,
    http_get: Optional[Callable[[str, int], Tuple[int, str]]] = None,
) -> Dict[str, Any]:
    """Busca skills en `skills.sh` y filtra estrictamente a publicadores oficiales."""
    q = (query or "").strip()
    if not q:
        return {"ok": False, "error": "Indica un término o tema de búsqueda para `discover_official_skills`."}
    safe_limit = max(1, min(int(limit or 8), 20))
    fetch_limit = min(40, max(safe_limit * 4, 20))
    fetcher = http_get or _default_http_get
    url = f"{SKILLS_SH_SEARCH_URL}?q={urllib.parse.quote(q)}&limit={fetch_limit}"

    try:
        status, text = fetcher(url, 12)
        if status >= 400:
            return {"ok": False, "error": f"skills.sh devolvió HTTP {status}."}
        payload = json.loads(text)
    except Exception as exc:
        return {"ok": False, "error": f"No se pudo consultar skills.sh: {exc}"}

    raw_skills = payload.get("skills") if isinstance(payload, dict) else []
    if not isinstance(raw_skills, list):
        raw_skills = []

    official: List[Dict[str, Any]] = []
    filtered_unofficial = 0
    for item in raw_skills:
        if not isinstance(item, dict):
            continue
        source = str(item.get("source") or "").strip()
        skill_id = str(item.get("skillId") or item.get("name") or "").strip()
        if not source or not skill_id or not _SLUG_PART_RE.match(skill_id):
            continue
        is_off, owner = is_official_publisher(source)
        if not is_off:
            filtered_unofficial += 1
            continue
        official.append(
            {
                "id": str(item.get("id") or f"{source}/{skill_id}"),
                "source": source,
                "publisher": owner,
                "skill_id": skill_id,
                "name": str(item.get("name") or skill_id),
                "installs": int(item.get("installs") or 0),
                "skills_sh_url": f"https://skills.sh/{source}/{skill_id}",
            }
        )
        if len(official) >= safe_limit:
            break

    return {
        "ok": True,
        "query": q,
        "official_publishers": sorted(OFFICIAL_SKILL_PUBLISHERS),
        "results": official,
        "filtered_unofficial_count": filtered_unofficial,
    }


def _find_skill_path_via_github_tree(
    source: str,
    skill_id: str,
    fetcher: Callable[[str, int], Tuple[int, str]],
) -> Optional[str]:
    tree_url = f"https://api.github.com/repos/{source}/git/trees/HEAD?recursive=1"
    try:
        status, body = fetcher(tree_url, 10)
        if status >= 400:
            return None
        data = json.loads(body)
        tree = data.get("tree") if isinstance(data, dict) else None
        if not isinstance(tree, list):
            return None
        suffix = f"/{skill_id}/SKILL.md".lower()
        for node in tree:
            if not isinstance(node, dict):
                continue
            p = str(node.get("path") or "")
            if node.get("type") == "blob" and (
                p.lower().endswith(suffix) or p.lower() == f"{skill_id.lower()}/skill.md"
            ):
                return f"https://raw.githubusercontent.com/{source}/HEAD/{p}"
    except Exception:
        return None
    return None


def install_official_skill(
    workspace_root: Path,
    *,
    source: str,
    skill_id: str,
    local_slug: str = "",
    http_get: Optional[Callable[[str, int], Tuple[int, str]]] = None,
) -> Dict[str, Any]:
    """Descarga un `SKILL.md` oficial, ejecuta escaneo estático de seguridad y lo guarda en `habilidades/`."""
    clean_source = (source or "").strip().strip("/")
    clean_skill_id = (skill_id or "").strip().strip("/")

    # Permite pasar id completo `owner/repo/skill_id` en `source` si omiten `skill_id`
    if clean_source.count("/") == 2 and not clean_skill_id:
        parts = clean_source.split("/")
        clean_source = f"{parts[0]}/{parts[1]}"
        clean_skill_id = parts[2]

    is_off, owner = is_official_publisher(clean_source)
    if not is_off:
        return {
            "ok": False,
            "error": (
                f"Origen '{clean_source}' bloqueado: por seguridad solo se permiten "
                f"publicadores oficiales ({', '.join(sorted(OFFICIAL_SKILL_PUBLISHERS))})."
            ),
        }
    if not clean_skill_id or not _SLUG_PART_RE.match(clean_skill_id):
        return {"ok": False, "error": f"`skill_id` inválido: '{clean_skill_id}'."}

    fetcher = http_get or _default_http_get
    fetched_md = ""
    fetched_url = ""

    candidate_urls: List[str] = []
    for branch in ("main", "master"):
        for tpl in _RAW_SUBPATHS_CANDIDATES:
            rel_sub = tpl.format(skill_id=clean_skill_id)
            candidate_urls.append(f"https://raw.githubusercontent.com/{clean_source}/{branch}/{rel_sub}")

    for url in candidate_urls:
        try:
            status, text = fetcher(url, 10)
            if status < 400 and text.strip():
                fetched_md = text
                fetched_url = url
                break
        except urllib.error.HTTPError:
            continue
        except Exception:
            continue

    if not fetched_md:
        tree_raw_url = _find_skill_path_via_github_tree(clean_source, clean_skill_id, fetcher)
        if tree_raw_url:
            try:
                status, text = fetcher(tree_raw_url, 10)
                if status < 400 and text.strip():
                    fetched_md = text
                    fetched_url = tree_raw_url
            except Exception:
                pass

    if not fetched_md:
        return {
            "ok": False,
            "error": f"No se encontró `SKILL.md` descargable para `{clean_source}/{clean_skill_id}`.",
        }

    findings = scan_skill_security(fetched_md)
    if findings:
        return {
            "ok": False,
            "error": (
                f"Skill oficial `{clean_source}/{clean_skill_id}` rechazada por el escáner "
                f"de seguridad: {'; '.join(findings)}"
            ),
            "security_findings": findings,
        }

    meta, _ = parse_skill_frontmatter(fetched_md)
    slug = slugify_skill_name(local_slug or meta.get("name") or clean_skill_id)
    rel_path = f"habilidades/{slug}/SKILL.md"
    provenance_header = f"<!-- Fuente oficial verificada: https://skills.sh/{clean_source}/{clean_skill_id} ({fetched_url}) -->\n"
    if fetched_md.lstrip().startswith("---"):
        final_md = fetched_md.rstrip() + "\n\n" + provenance_header
    else:
        desc = meta.get("description") or f"Habilidad oficial importada desde {clean_source}/{clean_skill_id}"
        final_md = (
            f'---\nname: "{slug}"\ndescription: "{desc}"\n'
            f'source: "official:{clean_source}/{clean_skill_id}"\n---\n\n'
            f"{provenance_header}\n{fetched_md.rstrip()}\n"
        )

    _atomic_write_text(workspace_root / rel_path, final_md)
    _append_skill_audit(
        workspace_root,
        "official_skill_installed",
        {
            "path": rel_path,
            "source": clean_source,
            "publisher": owner,
            "skill_id": clean_skill_id,
            "fetched_url": fetched_url,
        },
    )
    return {
        "ok": True,
        "slug": slug,
        "path": rel_path,
        "source": clean_source,
        "publisher": owner,
        "skill_id": clean_skill_id,
        "description": meta.get("description") or "",
        "fetched_url": fetched_url,
    }
