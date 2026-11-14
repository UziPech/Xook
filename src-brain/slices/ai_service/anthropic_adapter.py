"""
Adaptador nativo de Anthropic Messages API (`/v1/messages`) para XOOK.

Traduce peticiones y streams SSE entre el formato unificado estilo OpenAI usado por el
orquestador de XOOK y el protocolo nativo de Anthropic (`x-api-key`, `anthropic-version`,
Prompt Caching con `cache_control`, `tool_use` / `tool_result`, imágenes base64 y `thinking`).
"""

from __future__ import annotations

import json
import ssl
import threading
import urllib.error
import urllib.request
from typing import Any, Dict, Iterator, List, Optional, Tuple

from slices.ai_service.provider_registry import build_provider_headers, parse_rate_limit_headers


ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1"
_TLS = threading.local()


def _store_anthropic_headers(raw_headers: Any) -> Optional[Dict[str, Any]]:
    parsed = parse_rate_limit_headers("anthropic", raw_headers) if raw_headers is not None else None
    if parsed is not None:
        _TLS.last_rate_limits = parsed
    return parsed


def consume_last_anthropic_rate_limits() -> Optional[Dict[str, Any]]:
    val = getattr(_TLS, "last_rate_limits", None)
    _TLS.last_rate_limits = None
    return val


def _ssl_context() -> ssl.SSLContext:
    return ssl.create_default_context()


def _parse_data_image_url(url: str) -> Optional[Tuple[str, str]]:
    if not url.startswith("data:") or ";base64," not in url:
        return None
    header, b64_data = url.split(";base64,", 1)
    media_type = header[5:].strip() or "image/png"
    if not b64_data.strip():
        return None
    return media_type, b64_data.strip()


def _convert_content_to_anthropic_blocks(content: Any) -> List[Dict[str, Any]]:
    if isinstance(content, str):
        return [{"type": "text", "text": content}] if content else []
    if not isinstance(content, list):
        text = str(content or "").strip()
        return [{"type": "text", "text": text}] if text else []

    blocks: List[Dict[str, Any]] = []
    for part in content:
        if isinstance(part, str):
            if part:
                blocks.append({"type": "text", "text": part})
            continue
        if not isinstance(part, dict):
            continue
        ptype = str(part.get("type") or "").lower()
        if ptype == "text":
            txt = str(part.get("text") or "")
            if txt:
                blocks.append({"type": "text", "text": txt})
        elif ptype == "image_url":
            img_obj = part.get("image_url") if isinstance(part.get("image_url"), dict) else {}
            url = str(img_obj.get("url") or "").strip()
            parsed = _parse_data_image_url(url)
            if parsed:
                media_type, b64_data = parsed
                blocks.append({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": media_type,
                        "data": b64_data,
                    },
                })
            elif url.startswith(("https://", "http://")):
                blocks.append({
                    "type": "image",
                    "source": {
                        "type": "url",
                        "url": url,
                    },
                })
    return blocks


def build_anthropic_request_payload(openai_payload: Dict[str, Any], *, stream: bool = False) -> Dict[str, Any]:
    raw_messages = openai_payload.get("messages") or []
    system_parts: List[str] = []
    converted_messages: List[Dict[str, Any]] = []

    def _append_msg(role: str, blocks: List[Dict[str, Any]]) -> None:
        if not blocks:
            return
        # Anthropic exige alternancia estricta user/assistant
        if converted_messages and converted_messages[-1]["role"] == role:
            existing = converted_messages[-1]["content"]
            if isinstance(existing, list):
                existing.extend(blocks)
            else:
                converted_messages[-1]["content"] = [{"type": "text", "text": str(existing)}, *blocks]
        else:
            converted_messages.append({"role": role, "content": blocks})

    for msg in raw_messages:
        if not isinstance(msg, dict):
            continue
        role = str(msg.get("role") or "user").strip().lower()
        if role == "system":
            txt = msg.get("content")
            if isinstance(txt, str) and txt.strip():
                system_parts.append(txt)
            elif isinstance(txt, list):
                for p in txt:
                    if isinstance(p, dict) and p.get("type") == "text" and p.get("text"):
                        system_parts.append(str(p["text"]))
            continue

        if role == "tool":
            tc_id = str(msg.get("tool_call_id") or "call_0")
            raw_res = msg.get("content")
            if isinstance(raw_res, list):
                tool_blocks = _convert_content_to_anthropic_blocks(raw_res)
                content_val: Any = tool_blocks or str(raw_res)
            else:
                content_val = str(raw_res or "")
            _append_msg(
                "user",
                [
                    {
                        "type": "tool_result",
                        "tool_use_id": tc_id,
                        "content": content_val,
                    }
                ],
            )
            continue

        if role == "assistant":
            blocks = _convert_content_to_anthropic_blocks(msg.get("content"))
            for tc in msg.get("tool_calls") or []:
                if not isinstance(tc, dict):
                    continue
                fn = tc.get("function") if isinstance(tc.get("function"), dict) else {}
                tc_id = str(tc.get("id") or "call_0")
                name = str(fn.get("name") or "tool")
                raw_args = fn.get("arguments")
                if isinstance(raw_args, dict):
                    inp_obj = raw_args
                elif isinstance(raw_args, str) and raw_args.strip():
                    try:
                        parsed_inp = json.loads(raw_args)
                        inp_obj = parsed_inp if isinstance(parsed_inp, dict) else {}
                    except Exception:
                        inp_obj = {}
                else:
                    inp_obj = {}
                blocks.append({
                    "type": "tool_use",
                    "id": tc_id,
                    "name": name,
                    "input": inp_obj,
                })
            _append_msg("assistant", blocks or [{"type": "text", "text": "..."}])
            continue

        user_blocks = _convert_content_to_anthropic_blocks(msg.get("content"))
        _append_msg("user", user_blocks or [{"type": "text", "text": " "}])

    if not converted_messages or converted_messages[0]["role"] != "user":
        converted_messages.insert(0, {"role": "user", "content": [{"type": "text", "text": "Hola"}]})

    out: Dict[str, Any] = {
        "model": str(openai_payload.get("model") or "claude-sonnet-4-6"),
        "messages": converted_messages,
        "max_tokens": int(openai_payload.get("max_tokens") or 6144),
        "stream": stream,
    }
    if openai_payload.get("temperature") is not None:
        out["temperature"] = openai_payload["temperature"]

    system_text = "\n\n".join(p for p in system_parts if p).strip()
    if system_text:
        # Marca el bloque estático superior del sistema como candidato de Prompt Caching
        out["system"] = [
            {
                "type": "text",
                "text": system_text,
                "cache_control": {"type": "ephemeral"},
            }
        ]

    raw_tools = openai_payload.get("tools")
    if isinstance(raw_tools, list) and raw_tools:
        ant_tools: List[Dict[str, Any]] = []
        for idx, t in enumerate(raw_tools):
            if not isinstance(t, dict):
                continue
            fn = t.get("function") if isinstance(t.get("function"), dict) else t
            name = str(fn.get("name") or "").strip()
            if not name:
                continue
            tool_def: Dict[str, Any] = {
                "name": name,
                "description": str(fn.get("description") or name),
                "input_schema": fn.get("parameters") or {"type": "object", "properties": {}},
            }
            if idx == len(raw_tools) - 1:
                tool_def["cache_control"] = {"type": "ephemeral"}
            ant_tools.append(tool_def)
        if ant_tools:
            out["tools"] = ant_tools
            out["tool_choice"] = {"type": "auto"}

    return out


def _map_anthropic_stop_reason(stop_reason: Optional[str]) -> str:
    if stop_reason == "max_tokens":
        return "length"
    if stop_reason == "tool_use":
        return "tool_calls"
    return "stop"


def _translate_anthropic_usage(usage_raw: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not isinstance(usage_raw, dict):
        return {}
    inp = int(usage_raw.get("input_tokens") or 0)
    cache_read = int(usage_raw.get("cache_read_input_tokens") or 0)
    cache_create = int(usage_raw.get("cache_creation_input_tokens") or 0)
    out_tok = int(usage_raw.get("output_tokens") or 0)
    prompt_total = inp + cache_read + cache_create
    res: Dict[str, Any] = {
        "prompt_tokens": prompt_total,
        "completion_tokens": out_tok,
        "total_tokens": prompt_total + out_tok,
    }
    if cache_read > 0:
        res["prompt_tokens_details"] = {"cached_tokens": cache_read}
    return res


def anthropic_chat_completion(
    api_key: str,
    openai_payload: Dict[str, Any],
    timeout: int = 60,
) -> Dict[str, Any]:
    """Ejecuta POST /v1/messages (no streaming) y devuelve respuesta estilo OpenAI."""
    ant_payload = build_anthropic_request_payload(openai_payload, stream=False)
    headers = build_provider_headers("anthropic", api_key)
    req = urllib.request.Request(
        f"{ANTHROPIC_BASE_URL}/messages",
        data=json.dumps(ant_payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=_ssl_context()) as resp:
            _TLS.last_rate_limits = None
            _store_anthropic_headers(getattr(resp, "headers", None))
            raw = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        _TLS.last_rate_limits = None
        _store_anthropic_headers(getattr(err, "headers", None))
        body = err.read().decode("utf-8", errors="replace")
        detail = body
        try:
            parsed = json.loads(body)
            detail = parsed.get("error", {}).get("message") or body
        except Exception:
            pass
        raise RuntimeError(f"HTTP {err.code}: {detail}") from err
    except urllib.error.URLError as err:
        raise RuntimeError(f"Error de red al conectar con Anthropic: {err.reason}") from err

    text_parts: List[str] = []
    thinking_parts: List[str] = []
    tool_calls: List[Dict[str, Any]] = []
    for blk in raw.get("content") or []:
        if not isinstance(blk, dict):
            continue
        btype = blk.get("type")
        if btype == "text":
            text_parts.append(str(blk.get("text") or ""))
        elif btype == "thinking":
            thinking_parts.append(str(blk.get("thinking") or ""))
        elif btype == "tool_use":
            tool_calls.append({
                "id": str(blk.get("id") or f"call_{len(tool_calls)}"),
                "type": "function",
                "function": {
                    "name": str(blk.get("name") or ""),
                    "arguments": json.dumps(blk.get("input") or {}, ensure_ascii=False),
                },
            })

    msg: Dict[str, Any] = {
        "role": "assistant",
        "content": "".join(text_parts),
    }
    if thinking_parts:
        msg["reasoning_content"] = "".join(thinking_parts)
    if tool_calls:
        msg["tool_calls"] = tool_calls

    return {
        "model": raw.get("model") or ant_payload["model"],
        "choices": [
            {
                "index": 0,
                "message": msg,
                "finish_reason": _map_anthropic_stop_reason(raw.get("stop_reason")),
            }
        ],
        "usage": _translate_anthropic_usage(raw.get("usage")),
    }


def open_anthropic_stream(
    api_key: str,
    openai_payload: Dict[str, Any],
    timeout_sec: int = 60,
) -> Any:
    ant_payload = build_anthropic_request_payload(openai_payload, stream=True)
    headers = build_provider_headers("anthropic", api_key)
    req = urllib.request.Request(
        f"{ANTHROPIC_BASE_URL}/messages",
        data=json.dumps(ant_payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    return urllib.request.urlopen(req, timeout=timeout_sec, context=_ssl_context())


def iter_anthropic_sse_as_openai_events(resp: Any, default_model: str = "") -> Iterator[Dict[str, Any]]:
    """
    Parsea una respuesta SSE nativa de Anthropic `/v1/messages` y produce eventos
    idénticos a los chunks OpenAI Chat Completions (`/chat/completions`).
    """
    active_model = default_model
    tool_index_by_block: Dict[int, int] = {}
    next_tool_idx = 0
    base_usage: Dict[str, Any] = {}

    with resp:
        for raw_line in resp:
            line = raw_line.decode("utf-8", errors="replace").strip()
            if not line or line.startswith(":") or line.startswith("event:"):
                continue
            if not line.startswith("data:"):
                continue
            data_str = line[5:].strip()
            if not data_str or data_str == "[DONE]":
                continue
            try:
                evt = json.loads(data_str)
            except Exception:
                continue

            etype = evt.get("type")
            if etype == "error":
                err_obj = evt.get("error") or {}
                raise RuntimeError(str(err_obj.get("message") or evt))

            if etype == "message_start":
                msg_meta = evt.get("message") or {}
                if isinstance(msg_meta.get("model"), str) and msg_meta["model"]:
                    active_model = msg_meta["model"]
                if isinstance(msg_meta.get("usage"), dict):
                    base_usage = dict(msg_meta["usage"])
                yield {
                    "model": active_model,
                    "choices": [{"index": 0, "delta": {}, "finish_reason": None}],
                }
                continue

            if etype == "content_block_start":
                blk_idx = int(evt.get("index") or 0)
                blk = evt.get("content_block") or {}
                if blk.get("type") == "tool_use":
                    tc_idx = next_tool_idx
                    next_tool_idx += 1
                    tool_index_by_block[blk_idx] = tc_idx
                    yield {
                        "model": active_model,
                        "choices": [
                            {
                                "index": 0,
                                "delta": {
                                    "tool_calls": [
                                        {
                                            "index": tc_idx,
                                            "id": str(blk.get("id") or f"call_{tc_idx}"),
                                            "type": "function",
                                            "function": {
                                                "name": str(blk.get("name") or ""),
                                                "arguments": "",
                                            },
                                        }
                                    ]
                                },
                                "finish_reason": None,
                            }
                        ],
                    }
                continue

            if etype == "content_block_delta":
                blk_idx = int(evt.get("index") or 0)
                delta_obj = evt.get("delta") or {}
                dtype = delta_obj.get("type")
                if dtype == "text_delta":
                    txt = str(delta_obj.get("text") or "")
                    if txt:
                        yield {
                            "model": active_model,
                            "choices": [{"index": 0, "delta": {"content": txt}, "finish_reason": None}],
                        }
                elif dtype == "thinking_delta":
                    th = str(delta_obj.get("thinking") or "")
                    if th:
                        yield {
                            "model": active_model,
                            "choices": [{"index": 0, "delta": {"reasoning_content": th}, "finish_reason": None}],
                        }
                elif dtype == "input_json_delta":
                    partial_json = str(delta_obj.get("partial_json") or "")
                    tc_idx = tool_index_by_block.get(blk_idx, 0)
                    if partial_json:
                        yield {
                            "model": active_model,
                            "choices": [
                                {
                                    "index": 0,
                                    "delta": {
                                        "tool_calls": [
                                            {
                                                "index": tc_idx,
                                                "function": {"arguments": partial_json},
                                            }
                                        ]
                                    },
                                    "finish_reason": None,
                                }
                            ],
                        }
                continue

            if etype == "message_delta":
                d_meta = evt.get("delta") or {}
                stop_r = _map_anthropic_stop_reason(d_meta.get("stop_reason"))
                merged_usage = dict(base_usage)
                if isinstance(evt.get("usage"), dict):
                    merged_usage.update(evt["usage"])
                norm_usage = _translate_anthropic_usage(merged_usage)
                out_evt: Dict[str, Any] = {
                    "model": active_model,
                    "choices": [{"index": 0, "delta": {}, "finish_reason": stop_r}],
                }
                if norm_usage:
                    out_evt["usage"] = norm_usage
                yield out_evt
                continue
