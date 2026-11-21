"""
XOOK Agent Trace Writer (JSONL aditivo v1).

Registra eventos estructurados de ejecución del agente en
`<workspace>/.xook/agent_traces/<session_id>.jsonl` para análisis posterior o en vivo
desde `@xook/agent-inspector`.

Inspirado conceptualmente en Trace Segments + presupuestos de escritura y redacción
de vercel-labs/agent-desktop (Apache-2.0), implementado nativamente para XOOK:
- Nunca persiste secretos ni capturas de pantalla crudas.
- Respeta presupuesto de tamaño por evento y por archivo para evitar inflación en disco.
- Cualquier error de E/S se maneja de forma segura sin interrumpir el turno del usuario.
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import threading
import uuid
from typing import Any, Dict, List, Optional

TRACE_SCHEMA_VERSION = 1
MAX_TRACE_FILE_BYTES = 2 * 1024 * 1024  # 2 MB por sesión
MAX_TRACE_FILES_PER_WORKSPACE = 40
MAX_TRACE_STR_CHARS = 500

_TRACE_SECRET_PATTERNS = [
    (
        re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----"),
        "[REDACTED_PRIVATE_KEY]",
    ),
    (re.compile(r"\bsk-or-v1-[A-Za-z0-9_-]{12,}\b"), "[REDACTED_API_KEY]"),
    (re.compile(r"\bsk-(?:ant|proj|live|test)-[A-Za-z0-9_-]{12,}\b"), "[REDACTED_API_KEY]"),
    (re.compile(r"\bAIza[0-9A-Za-z_-]{20,}\b"), "[REDACTED_API_KEY]"),
    (re.compile(r"\bgsk_[0-9A-Za-z]{20,}\b"), "[REDACTED_API_KEY]"),
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "[REDACTED_AWS_KEY]"),
    (re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b"), "[REDACTED_TOKEN]"),
]


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _sanitize_session_id(raw: Optional[str]) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", str(raw or "").strip()).strip("._-")
    if not cleaned:
        return "session_default"
    return cleaned[:64]


def _redact_and_clip(value: Any, active_secrets: Optional[List[str]] = None, max_len: int = MAX_TRACE_STR_CHARS) -> Any:
    if isinstance(value, str):
        txt = value
        for pat, repl in _TRACE_SECRET_PATTERNS:
            txt = pat.sub(repl, txt)
        if active_secrets:
            for secret in active_secrets:
                if secret and len(secret) >= 8 and secret in txt:
                    txt = txt.replace(secret, "[REDACTED_SESSION_SECRET]")
        if len(txt) > max_len:
            txt = txt[: max(0, max_len - 1)].rstrip() + "…"
        return txt
    if isinstance(value, dict):
        return {
            str(k): _redact_and_clip(v, active_secrets=active_secrets, max_len=max_len)
            for k, v in value.items()
            if str(k) not in ("imageDataUrl", "api_key", "apiKey", "provider_credentials")
        }
    if isinstance(value, list):
        return [_redact_and_clip(it, active_secrets=active_secrets, max_len=max_len) for it in value[:20]]
    return value


class AgentTraceWriter:
    """Escritor thread-safe y con presupuesto de eventos JSONL para un turno agéntico."""

    def __init__(
        self,
        workspace_root: Optional[Path],
        *,
        session_id: Optional[str] = None,
        turn_id: Optional[str] = None,
        active_secrets: Optional[List[str]] = None,
    ) -> None:
        self.workspace_root = workspace_root
        self.session_id = _sanitize_session_id(session_id)
        self.turn_id = str(turn_id or f"turn_{uuid.uuid4().hex[:10]}")
        self.active_secrets = list(active_secrets or [])
        self._lock = threading.Lock()
        self._budget_exhausted = False
        self.file_path: Optional[Path] = None

        if workspace_root is not None and workspace_root.is_dir():
            trace_dir = workspace_root / ".xook" / "agent_traces"
            try:
                trace_dir.mkdir(parents=True, exist_ok=True)
                self._gc_old_traces(trace_dir)
                self.file_path = trace_dir / f"{self.session_id}.jsonl"
                if not self.file_path.exists() or self.file_path.stat().st_size == 0:
                    self._append_raw(
                        {
                            "schema": TRACE_SCHEMA_VERSION,
                            "type": "trace.meta",
                            "ts": _utc_now_iso(),
                            "session_id": self.session_id,
                            "workspace": workspace_root.name,
                            "pid": os.getpid(),
                            "engine": "xook-brain",
                        }
                    )
            except Exception:
                self.file_path = None

    @staticmethod
    def _gc_old_traces(trace_dir: Path) -> None:
        try:
            files = sorted(
                trace_dir.glob("*.jsonl"),
                key=lambda p: p.stat().st_mtime,
                reverse=True,
            )
            for stale in files[MAX_TRACE_FILES_PER_WORKSPACE:]:
                try:
                    stale.unlink()
                except OSError:
                    pass
        except Exception:
            pass

    def _append_raw(self, payload: Dict[str, Any]) -> bool:
        if self.file_path is None or self._budget_exhausted:
            return False
        safe_payload = _redact_and_clip(payload, active_secrets=self.active_secrets)
        line = json.dumps(safe_payload, ensure_ascii=False) + "\n"
        encoded = line.encode("utf-8")
        with self._lock:
            try:
                cur_size = self.file_path.stat().st_size if self.file_path.exists() else 0
                if cur_size + len(encoded) > MAX_TRACE_FILE_BYTES:
                    self._budget_exhausted = True
                    return False
                with self.file_path.open("ab") as fh:
                    fh.write(encoded)
                return True
            except Exception:
                return False

    def emit(self, event_type: str, **fields: Any) -> bool:
        event: Dict[str, Any] = {
            "schema": TRACE_SCHEMA_VERSION,
            "type": event_type,
            "ts": _utc_now_iso(),
            "session_id": self.session_id,
            "turn_id": self.turn_id,
        }
        for k, v in fields.items():
            if v is not None:
                event[k] = v
        return self._append_raw(event)

    def record_turn_start(
        self,
        *,
        mode: Optional[str],
        scope: str,
        provider: str,
        model: str,
        history_count: int,
        has_checkpoint: bool,
        user_preview: str = "",
    ) -> None:
        self.emit(
            "turn.start",
            mode=mode or None,
            scope="document" if scope == "document" else "chat",
            provider=provider,
            model=model,
            history_count=int(history_count),
            has_checkpoint=bool(has_checkpoint),
            user_preview=str(user_preview or "")[:160],
        )

    def record_context_budget(
        self,
        *,
        model_context_window: int,
        system_prompt_tokens: int,
        history_tokens: int,
        checkpoint_tokens: int,
        tool_defs_count: int,
    ) -> None:
        win = max(1, int(model_context_window or 128000))
        used = int(system_prompt_tokens) + int(history_tokens) + int(checkpoint_tokens)
        util_pct = round(min(100.0, (used / win) * 100.0), 2)
        self.emit(
            "context.budget",
            model_context_window=win,
            system_prompt_tokens=int(system_prompt_tokens),
            history_tokens=int(history_tokens),
            checkpoint_tokens=int(checkpoint_tokens),
            tool_defs_count=int(tool_defs_count),
            utilization_pct=util_pct,
        )

    def record_compaction(self, compact_evt: Dict[str, Any]) -> None:
        ckpt = compact_evt.get("checkpoint") if isinstance(compact_evt.get("checkpoint"), dict) else {}
        method = str(
            compact_evt.get("compaction_method")
            or ckpt.get("compaction_method")
            or "deterministic_fallback"
        )
        fallback_reason = str(
            compact_evt.get("fallback_reason")
            or ckpt.get("fallback_reason")
            or ""
        ).strip()
        self.emit(
            "context.compacted",
            scope="document" if compact_evt.get("scope") == "document" else "chat",
            auto=bool(compact_evt.get("auto", True)),
            method=method,
            fallback_reason=fallback_reason or None,
            compacted_turns=int(compact_evt.get("compacted_turns_this_pass") or 0),
            kept_recent_turns=int(compact_evt.get("kept_recent_turns") or 0),
            tokens_before=int(compact_evt.get("tokens_before") or 0),
            tokens_after=int(compact_evt.get("tokens_after") or 0),
            saved_pct=int(compact_evt.get("saved_pct") or 0),
        )

    def record_tool_call(self, *, round_idx: int, tool_call_id: str, tool: str, target: str = "") -> None:
        self.emit(
            "tool.call",
            round=int(round_idx),
            tool_call_id=tool_call_id,
            tool=tool,
            target=target or None,
        )

    def record_tool_result(
        self,
        *,
        round_idx: int,
        tool_call_id: str,
        tool: str,
        target: str = "",
        ok: bool,
        duration_ms: int,
        output_chars: int,
        disposition: Optional[Dict[str, Any]] = None,
        error: Optional[str] = None,
    ) -> None:
        self.emit(
            "tool.result",
            round=int(round_idx),
            tool_call_id=tool_call_id,
            tool=tool,
            target=target or None,
            ok=bool(ok),
            duration_ms=int(duration_ms),
            output_chars=int(output_chars),
            disposition=disposition if isinstance(disposition, dict) else None,
            error=(str(error)[:240] if error else None),
        )

    def record_tool_pruned(self, *, round_idx: int, pruned_count: int, chars_before: int, chars_after: int) -> None:
        if pruned_count <= 0:
            return
        self.emit(
            "tool.pruned",
            round=int(round_idx),
            pruned_count=int(pruned_count),
            chars_before=int(chars_before),
            chars_after=int(chars_after),
        )

    def record_subagent_spawn(
        self,
        *,
        subagent_id: str,
        name: str,
        role: str,
        model: str,
        has_handoff_context: bool,
    ) -> None:
        self.emit(
            "subagent.spawn",
            subagent_id=subagent_id,
            name=name,
            role=role,
            model=model,
            has_handoff_context=bool(has_handoff_context),
        )

    def record_subagent_done(
        self,
        *,
        subagent_id: str,
        name: str,
        role: str,
        model: str,
        ok: bool,
        duration_ms: int,
        rounds_used: int,
        findings_chars: int,
        error: Optional[str] = None,
    ) -> None:
        self.emit(
            "subagent.done",
            subagent_id=subagent_id,
            name=name,
            role=role,
            model=model,
            ok=bool(ok),
            duration_ms=int(duration_ms),
            rounds_used=int(rounds_used),
            findings_chars=int(findings_chars),
            error=(str(error)[:240] if error else None),
        )

    def record_turn_end(
        self,
        *,
        provider: str,
        model: str,
        rounds: int,
        latency_ms: int,
        usage: Optional[Dict[str, Any]],
        tool_calls_count: int,
        workspace_mutated: bool,
    ) -> None:
        u = usage if isinstance(usage, dict) else {}
        self.emit(
            "turn.end",
            provider=provider,
            model=model,
            rounds=int(rounds),
            latency_ms=int(latency_ms),
            prompt_tokens=u.get("prompt_tokens"),
            completion_tokens=u.get("completion_tokens"),
            cached_tokens=u.get("cached_tokens") or u.get("prompt_cache_hit_tokens"),
            total_tokens=u.get("total_tokens"),
            estimated_cost_usd=u.get("estimated_cost_usd") or u.get("cost"),
            tool_calls_count=int(tool_calls_count),
            workspace_mutated=bool(workspace_mutated),
        )

    def record_turn_error(self, *, provider: str, model: str, error: str) -> None:
        self.emit(
            "turn.error",
            provider=provider or None,
            model=model or None,
            error=str(error or "Error desconocido")[:320],
        )
