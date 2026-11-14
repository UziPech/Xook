"""
Registro centralizado de proveedores IA soportados por XOOK:
- OpenRouter (`openrouter`)
- DeepSeek (`deepseek`)
- OpenAI (`openai`)
- Anthropic (`anthropic`)
- Groq (`groq`)
- Google Gemini (`gemini`)

Incluye metadatos de endpoints, tarifas de referencia por millón de tokens (USD/1M),
normalización y detección segura de claves, y clasificación de errores de cuota/límite
para activar el failover automático entre proveedores.
"""

from __future__ import annotations

import re
import time
from typing import Any, Dict, Iterable, List, Optional, Tuple


PROVIDER_ORDER: Tuple[str, ...] = (
    "openrouter",
    "deepseek",
    "groq",
    "gemini",
    "openai",
    "anthropic",
)


# Tarifas de referencia USD / 1M tokens (entrada, salida, lectura caché opcional)
MODEL_TARIFF_HINTS: Dict[str, Dict[str, Any]] = {
    # OpenRouter
    "openrouter/free": {"prompt": 0.0, "completion": 0.0, "cache": None, "free": True},
    "openrouter/auto": {"prompt": None, "completion": None, "cache": None, "free": False},
    # DeepSeek Directo (caché en disco automático hasta 90%+ de ahorro)
    "deepseek-flash": {"prompt": 0.15, "completion": 0.60, "cache": 0.003, "free": False},
    "deepseek-v4-flash": {"prompt": 0.15, "completion": 0.60, "cache": 0.003, "free": False},
    "deepseek-v4-pro": {"prompt": 0.66, "completion": 1.98, "cache": 0.066, "free": False},
    "deepseek-chat": {"prompt": 0.15, "completion": 0.60, "cache": 0.014, "free": False},
    "deepseek-reasoner": {"prompt": 0.55, "completion": 2.19, "cache": 0.14, "free": False},
    # Groq (LPU ultra-rápido; capa gratis sin tarjeta ~30 RPM + pago por uso)
    "openai/gpt-oss-120b": {"prompt": 0.15, "completion": 0.60, "cache": 0.075, "free": False},
    "openai/gpt-oss-20b": {"prompt": 0.075, "completion": 0.30, "cache": 0.0375, "free": False},
    "qwen/qwen3-32b": {"prompt": 0.29, "completion": 0.59, "cache": None, "free": False},
    "qwen/qwen3.6-27b": {"prompt": 0.25, "completion": 0.50, "cache": None, "free": False},
    "meta-llama/llama-4-scout-17b-16e-instruct": {"prompt": 0.11, "completion": 0.34, "cache": None, "free": False},
    "meta-llama/llama-4-maverick-17b-128e-instruct": {"prompt": 0.20, "completion": 0.60, "cache": None, "free": False},
    "llama-3.1-8b-instant": {"prompt": 0.05, "completion": 0.08, "cache": None, "free": False},
    # Google Gemini (AI Studio — nivel gratuito sin tarjeta limitado + pago por uso)
    "gemini-2.5-flash-lite": {"prompt": 0.10, "completion": 0.40, "cache": 0.025, "free": True},
    "gemini-2.5-flash": {"prompt": 0.30, "completion": 2.50, "cache": 0.075, "free": True},
    "gemini-2.5-pro": {"prompt": 1.25, "completion": 10.0, "cache": 0.31, "free": False},
    # OpenAI (pago directo)
    "gpt-4.1-nano": {"prompt": 0.10, "completion": 0.40, "cache": 0.025, "free": False},
    "gpt-4.1-mini": {"prompt": 0.40, "completion": 1.60, "cache": 0.10, "free": False},
    "gpt-4.1": {"prompt": 2.00, "completion": 8.00, "cache": 0.50, "free": False},
    "gpt-4o-mini": {"prompt": 0.15, "completion": 0.60, "cache": 0.075, "free": False},
    "gpt-4o": {"prompt": 2.50, "completion": 10.00, "cache": 1.25, "free": False},
    "gpt-5": {"prompt": 1.25, "completion": 10.00, "cache": 0.125, "free": False},
    "gpt-5-mini": {"prompt": 0.25, "completion": 2.00, "cache": 0.025, "free": False},
    "o4-mini": {"prompt": 1.10, "completion": 4.40, "cache": 0.275, "free": False},
    # Anthropic (pago directo con Prompt Caching nativo)
    "claude-haiku-4-5": {"prompt": 1.00, "completion": 5.00, "cache": 0.10, "free": False},
    "claude-haiku-5-5": {"prompt": 0.10, "completion": 0.50, "cache": 0.01, "free": False},
    "claude-3-5-haiku-latest": {"prompt": 0.80, "completion": 4.00, "cache": 0.08, "free": False},
    "claude-sonnet-4-6": {"prompt": 3.00, "completion": 15.00, "cache": 0.30, "free": False},
    "claude-sonnet-5-5": {"prompt": 2.00, "completion": 10.00, "cache": 0.20, "free": False},
    "claude-opus-4-1": {"prompt": 15.00, "completion": 75.00, "cache": 1.50, "free": False},
    "claude-opus-5-5": {"prompt": 4.00, "completion": 20.00, "cache": 0.40, "free": False},
}


PROVIDER_SPECS: Dict[str, Dict[str, Any]] = {
    "openrouter": {
        "id": "openrouter",
        "name": "OpenRouter",
        "base_url": "https://openrouter.ai/api/v1",
        "protocol": "openai",
        "default_model": "openrouter/free",
        "tier_badge": "Gratis + Multimodelo",
        "tariff_short": "Gratis (50–1k req/día) · Prepago +5.5%",
        "rate_limit_note": "Cuenta gratis: 20 RPM / 50 req día · Con $10+ recargados: 1,000 req gratis/día",
        "key_prefix_hint": "sk-or-v1-...",
        "default_models": [
            {
                "id": "openrouter/free",
                "name": "Automático (Gratis)",
                "provider_name": "OpenRouter",
                "provider_id": "openrouter",
                "hint": "Enruta al mejor modelo gratuito disponible",
                "is_free": True,
                "context_length": 200000,
                "prompt_price_per_million": 0.0,
                "completion_price_per_million": 0.0,
                "supports_tools": True,
                "supports_reasoning": True,
                "supports_structured": True,
                "supports_vision": True,
            },
            {
                "id": "openrouter/auto",
                "name": "Automático (Estándar)",
                "provider_name": "OpenRouter",
                "provider_id": "openrouter",
                "hint": "Elige automáticamente según costo y tarea",
                "is_free": False,
                "context_length": 1000000,
                "supports_tools": True,
                "supports_reasoning": True,
                "supports_structured": True,
                "supports_vision": True,
            },
        ],
    },
    "deepseek": {
        "id": "deepseek",
        "name": "DeepSeek",
        "base_url": "https://api.deepseek.com",
        "protocol": "openai",
        "default_model": "deepseek-flash",
        "tier_badge": "Ultra económico",
        "tariff_short": "$0.15 in · $0.60 out /1M · Caché $0.003",
        "rate_limit_note": "Sin límite RPM estricto · Caché automático en disco con descuento >90%",
        "key_prefix_hint": "sk-...",
        "default_models": [
            {
                "id": "deepseek-flash",
                "name": "DeepSeek Flash",
                "provider_name": "DeepSeek",
                "provider_id": "deepseek",
                "hint": "DeepSeek · $0.15/$0.60 · Caché $0.003 · Multimodal",
                "is_free": False,
                "context_length": 128000,
                "prompt_price_per_million": 0.15,
                "completion_price_per_million": 0.60,
                "cache_price_per_million": 0.003,
                "supports_tools": True,
                "supports_reasoning": True,
                "supports_structured": True,
                "supports_vision": True,
            },
            {
                "id": "deepseek-v4-pro",
                "name": "DeepSeek V4 Pro",
                "provider_name": "DeepSeek",
                "provider_id": "deepseek",
                "hint": "DeepSeek · $0.66/$1.98 · Razonamiento profundo",
                "is_free": False,
                "context_length": 128000,
                "prompt_price_per_million": 0.66,
                "completion_price_per_million": 1.98,
                "cache_price_per_million": 0.066,
                "supports_tools": True,
                "supports_reasoning": True,
                "supports_structured": True,
                "supports_vision": False,
            },
            {
                "id": "deepseek-chat",
                "name": "DeepSeek Chat (Alias)",
                "provider_name": "DeepSeek",
                "provider_id": "deepseek",
                "hint": "DeepSeek · $0.15/$0.60 · Alias compatible",
                "is_free": False,
                "context_length": 128000,
                "prompt_price_per_million": 0.15,
                "completion_price_per_million": 0.60,
                "cache_price_per_million": 0.014,
                "supports_tools": True,
                "supports_reasoning": False,
                "supports_structured": True,
                "supports_vision": False,
            },
            {
                "id": "deepseek-reasoner",
                "name": "DeepSeek Reasoner (Alias)",
                "provider_name": "DeepSeek",
                "provider_id": "deepseek",
                "hint": "DeepSeek · $0.55/$2.19 · Modo pensamiento",
                "is_free": False,
                "context_length": 128000,
                "prompt_price_per_million": 0.55,
                "completion_price_per_million": 2.19,
                "cache_price_per_million": 0.14,
                "supports_tools": True,
                "supports_reasoning": True,
                "supports_structured": False,
                "supports_vision": False,
            },
        ],
    },
    "groq": {
        "id": "groq",
        "name": "Groq",
        "base_url": "https://api.groq.com/openai/v1",
        "protocol": "openai",
        "default_model": "openai/gpt-oss-120b",
        "tier_badge": "Gratis + LPU veloz",
        "tariff_short": "Gratis 30 RPM · Pago desde $0.05/1M",
        "rate_limit_note": "Gratis sin tarjeta: ~30 RPM y 6k–12k TPM · Latencia instantánea (~500 tok/s)",
        "key_prefix_hint": "gsk_...",
        "default_models": [
            {
                "id": "openai/gpt-oss-120b",
                "name": "GPT-OSS 120B (Groq)",
                "provider_name": "Groq",
                "provider_id": "groq",
                "hint": "Groq · Gratis / $0.15-$0.60 · ~500 tok/s · Tools",
                "is_free": False,
                "context_length": 131072,
                "prompt_price_per_million": 0.15,
                "completion_price_per_million": 0.60,
                "cache_price_per_million": 0.075,
                "supports_tools": True,
                "supports_reasoning": True,
                "supports_structured": True,
                "supports_vision": False,
            },
            {
                "id": "openai/gpt-oss-20b",
                "name": "GPT-OSS 20B (Groq)",
                "provider_name": "Groq",
                "provider_id": "groq",
                "hint": "Groq · Gratis / $0.075-$0.30 · Ultra rápido",
                "is_free": False,
                "context_length": 131072,
                "prompt_price_per_million": 0.075,
                "completion_price_per_million": 0.30,
                "cache_price_per_million": 0.0375,
                "supports_tools": True,
                "supports_reasoning": True,
                "supports_structured": True,
                "supports_vision": False,
            },
            {
                "id": "meta-llama/llama-4-scout-17b-16e-instruct",
                "name": "Llama 4 Scout 17B (Groq)",
                "provider_name": "Groq",
                "provider_id": "groq",
                "hint": "Groq · Gratis / $0.11-$0.34 · Visión + Tools",
                "is_free": False,
                "context_length": 131072,
                "prompt_price_per_million": 0.11,
                "completion_price_per_million": 0.34,
                "supports_tools": True,
                "supports_reasoning": False,
                "supports_structured": True,
                "supports_vision": True,
            },
            {
                "id": "llama-3.1-8b-instant",
                "name": "Llama 3.1 8B Instant",
                "provider_name": "Groq",
                "provider_id": "groq",
                "hint": "Groq · Gratis / $0.05-$0.08 · Respuestas al instante",
                "is_free": False,
                "context_length": 131072,
                "prompt_price_per_million": 0.05,
                "completion_price_per_million": 0.08,
                "supports_tools": True,
                "supports_reasoning": False,
                "supports_structured": True,
                "supports_vision": False,
            },
        ],
    },
    "gemini": {
        "id": "gemini",
        "name": "Google Gemini",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
        "protocol": "openai",
        "default_model": "gemini-2.5-flash-lite",
        "tier_badge": "Gratis con cuota",
        "tariff_short": "Gratis (cuota RPM/TPM) · Desde $0.10/1M",
        "rate_limit_note": "Nivel gratuito limitado en tokens/min · Ideal con auto-respaldo activado",
        "key_prefix_hint": "AIza...",
        "default_models": [
            {
                "id": "gemini-2.5-flash-lite",
                "name": "Gemini 2.5 Flash-Lite",
                "provider_name": "Google Gemini",
                "provider_id": "gemini",
                "hint": "Gemini · Gratis (15 RPM) · Pago $0.10/$0.40 · 1M ctx",
                "is_free": True,
                "context_length": 1048576,
                "prompt_price_per_million": 0.10,
                "completion_price_per_million": 0.40,
                "cache_price_per_million": 0.025,
                "supports_tools": True,
                "supports_reasoning": True,
                "supports_structured": True,
                "supports_vision": True,
            },
            {
                "id": "gemini-2.5-flash",
                "name": "Gemini 2.5 Flash",
                "provider_name": "Google Gemini",
                "provider_id": "gemini",
                "hint": "Gemini · Gratis limitado · Pago $0.30/$2.50 · Multimodal",
                "is_free": True,
                "context_length": 1048576,
                "prompt_price_per_million": 0.30,
                "completion_price_per_million": 2.50,
                "cache_price_per_million": 0.075,
                "supports_tools": True,
                "supports_reasoning": True,
                "supports_structured": True,
                "supports_vision": True,
            },
            {
                "id": "gemini-2.5-pro",
                "name": "Gemini 2.5 Pro",
                "provider_name": "Google Gemini",
                "provider_id": "gemini",
                "hint": "Gemini · Pago $1.25/$10.00 · Razonamiento complejo",
                "is_free": False,
                "context_length": 1048576,
                "prompt_price_per_million": 1.25,
                "completion_price_per_million": 10.0,
                "cache_price_per_million": 0.31,
                "supports_tools": True,
                "supports_reasoning": True,
                "supports_structured": True,
                "supports_vision": True,
            },
        ],
    },
    "openai": {
        "id": "openai",
        "name": "OpenAI",
        "base_url": "https://api.openai.com/v1",
        "protocol": "openai",
        "default_model": "gpt-4.1-mini",
        "tier_badge": "Pago directo",
        "tariff_short": "Desde $0.10 in / $0.40 out (Nano · Mini · GPT-4.1/5)",
        "rate_limit_note": "Facturación directa en platform.openai.com · Prompt cache automático (-50% a -90%)",
        "key_prefix_hint": "sk-proj-...",
        "default_models": [
            {
                "id": "gpt-4.1-mini",
                "name": "GPT-4.1 Mini",
                "provider_name": "OpenAI",
                "provider_id": "openai",
                "hint": "OpenAI · $0.40/$1.60 · 1M ctx · Preciso en tools",
                "is_free": False,
                "context_length": 1047576,
                "prompt_price_per_million": 0.40,
                "completion_price_per_million": 1.60,
                "cache_price_per_million": 0.10,
                "supports_tools": True,
                "supports_reasoning": False,
                "supports_structured": True,
                "supports_vision": True,
            },
            {
                "id": "gpt-4.1-nano",
                "name": "GPT-4.1 Nano",
                "provider_name": "OpenAI",
                "provider_id": "openai",
                "hint": "OpenAI · $0.10/$0.40 · Económico y muy veloz",
                "is_free": False,
                "context_length": 1047576,
                "prompt_price_per_million": 0.10,
                "completion_price_per_million": 0.40,
                "cache_price_per_million": 0.025,
                "supports_tools": True,
                "supports_reasoning": False,
                "supports_structured": True,
                "supports_vision": True,
            },
            {
                "id": "gpt-4.1",
                "name": "GPT-4.1",
                "provider_name": "OpenAI",
                "provider_id": "openai",
                "hint": "OpenAI · $2.00/$8.00 · 1M ctx · Alta precisión",
                "is_free": False,
                "context_length": 1047576,
                "prompt_price_per_million": 2.00,
                "completion_price_per_million": 8.00,
                "cache_price_per_million": 0.50,
                "supports_tools": True,
                "supports_reasoning": False,
                "supports_structured": True,
                "supports_vision": True,
            },
            {
                "id": "gpt-4o-mini",
                "name": "GPT-4o Mini",
                "provider_name": "OpenAI",
                "provider_id": "openai",
                "hint": "OpenAI · $0.15/$0.60 · Ligero y multimodal",
                "is_free": False,
                "context_length": 128000,
                "prompt_price_per_million": 0.15,
                "completion_price_per_million": 0.60,
                "cache_price_per_million": 0.075,
                "supports_tools": True,
                "supports_reasoning": False,
                "supports_structured": True,
                "supports_vision": True,
            },
            {
                "id": "o4-mini",
                "name": "o4-mini (Razonamiento)",
                "provider_name": "OpenAI",
                "provider_id": "openai",
                "hint": "OpenAI · $1.10/$4.40 · Razonamiento STEM y código",
                "is_free": False,
                "context_length": 200000,
                "prompt_price_per_million": 1.10,
                "completion_price_per_million": 4.40,
                "cache_price_per_million": 0.275,
                "supports_tools": True,
                "supports_reasoning": True,
                "supports_structured": True,
                "supports_vision": True,
            },
        ],
    },
    "anthropic": {
        "id": "anthropic",
        "name": "Anthropic",
        "base_url": "https://api.anthropic.com/v1",
        "protocol": "anthropic",
        "default_model": "claude-sonnet-4-6",
        "tier_badge": "Pago directo",
        "tariff_short": "Haiku desde $0.10/$0.50 · Sonnet $2–$3 /1M",
        "rate_limit_note": "API Messages nativa con Prompt Caching (-90% lectura) · Excelente en agentes",
        "key_prefix_hint": "sk-ant-...",
        "default_models": [
            {
                "id": "claude-sonnet-4-6",
                "name": "Claude Sonnet 4.6",
                "provider_name": "Anthropic",
                "provider_id": "anthropic",
                "hint": "Anthropic · $3.00/$15.00 · Caché $0.30 · Insignia agentes",
                "is_free": False,
                "context_length": 200000,
                "prompt_price_per_million": 3.00,
                "completion_price_per_million": 15.00,
                "cache_price_per_million": 0.30,
                "supports_tools": True,
                "supports_reasoning": True,
                "supports_structured": True,
                "supports_vision": True,
            },
            {
                "id": "claude-haiku-4-5",
                "name": "Claude Haiku 4.5",
                "provider_name": "Anthropic",
                "provider_id": "anthropic",
                "hint": "Anthropic · $1.00/$5.00 · Caché $0.10 · Rápido",
                "is_free": False,
                "context_length": 200000,
                "prompt_price_per_million": 1.00,
                "completion_price_per_million": 5.00,
                "cache_price_per_million": 0.10,
                "supports_tools": True,
                "supports_reasoning": True,
                "supports_structured": True,
                "supports_vision": True,
            },
            {
                "id": "claude-sonnet-5-5",
                "name": "Claude Sonnet 5.5",
                "provider_name": "Anthropic",
                "provider_id": "anthropic",
                "hint": "Anthropic · $2.00/$10.00 · Caché $0.20 · Nueva gen.",
                "is_free": False,
                "context_length": 200000,
                "prompt_price_per_million": 2.00,
                "completion_price_per_million": 10.00,
                "cache_price_per_million": 0.20,
                "supports_tools": True,
                "supports_reasoning": True,
                "supports_structured": True,
                "supports_vision": True,
            },
            {
                "id": "claude-haiku-5-5",
                "name": "Claude Haiku 5.5",
                "provider_name": "Anthropic",
                "provider_id": "anthropic",
                "hint": "Anthropic · $0.10/$0.50 · Caché $0.01 · Ultra rápido",
                "is_free": False,
                "context_length": 200000,
                "prompt_price_per_million": 0.10,
                "completion_price_per_million": 0.50,
                "cache_price_per_million": 0.01,
                "supports_tools": True,
                "supports_reasoning": True,
                "supports_structured": True,
                "supports_vision": True,
            },
        ],
    },
}


def normalize_provider_id(provider: Optional[str]) -> str:
    raw = str(provider or "").strip().lower()
    aliases = {
        "openrouter": "openrouter",
        "open-router": "openrouter",
        "deepseek": "deepseek",
        "openai": "openai",
        "chatgpt": "openai",
        "anthropic": "anthropic",
        "claude": "anthropic",
        "groq": "groq",
        "gemini": "gemini",
        "google": "gemini",
        "google-gemini": "gemini",
        "google_gemini": "gemini",
    }
    return aliases.get(raw, "openrouter")


def get_provider_spec(provider: Optional[str]) -> Dict[str, Any]:
    return PROVIDER_SPECS[normalize_provider_id(provider)]


def detect_provider_from_key(api_key: Optional[str]) -> Optional[str]:
    key = normalize_provider_api_key(api_key)
    if not key:
        return None
    if key.startswith("sk-or-"):
        return "openrouter"
    if key.startswith("sk-ant-"):
        return "anthropic"
    if key.startswith("gsk_"):
        return "groq"
    if key.startswith("AIza"):
        return "gemini"
    if key.startswith(("sk-proj-", "sk-svcacct-", "sk-live-")):
        return "openai"
    return None


def normalize_provider_api_key(api_key: Optional[str]) -> str:
    key = (api_key or "").strip().strip("'\"`").rstrip(",;.").strip("'\"`")
    if key.lower().startswith("bearer "):
        key = key[7:].strip().strip("'\"`").rstrip(",;.").strip("'\"`")
    embedded = re.search(
        r"(?<![A-Za-z0-9_-])("
        r"sk-or-(?:v1-)?[A-Za-z0-9_-]{12,}"
        r"|sk-ant-[A-Za-z0-9_-]{12,}"
        r"|sk-proj-[A-Za-z0-9_-]{14,}"
        r"|sk-svcacct-[A-Za-z0-9_-]{14,}"
        r"|gsk_[A-Za-z0-9_-]{14,}"
        r"|AIza[0-9A-Za-z_-]{20,}"
        r"|sk-[A-Za-z0-9_-]{16,}"
        r")(?![A-Za-z0-9_-])",
        key,
    )
    if embedded:
        return embedded.group(1)
    return key


def build_provider_headers(provider: str, api_key: Optional[str] = None, *, referer: str = "https://xook.app", title: str = "XOOK Enterprise Agentic Orchestrator") -> Dict[str, str]:
    pid = normalize_provider_id(provider)
    clean_key = normalize_provider_api_key(api_key)
    headers: Dict[str, str] = {
        "Content-Type": "application/json",
        "User-Agent": "XOOK-Agent/0.1",
    }
    if pid == "openrouter":
        headers["HTTP-Referer"] = referer
        headers["X-Title"] = title
        if clean_key:
            headers["Authorization"] = f"Bearer {clean_key}"
    elif pid == "anthropic":
        headers["anthropic-version"] = "2023-06-01"
        if clean_key:
            headers["x-api-key"] = clean_key
    else:
        if clean_key:
            headers["Authorization"] = f"Bearer {clean_key}"
    return headers


def build_openai_compat_chat_payload(
    provider: str,
    model_id: str,
    base_payload: Dict[str, Any],
) -> Dict[str, Any]:
    """Ajusta campos específicos de cada API compatible con OpenAI (razonamiento/tokens/stream_options)."""
    pid = normalize_provider_id(provider)
    payload = dict(base_payload)
    low_model = (model_id or "").lower()

    if pid == "openai":
        # Modelos de razonamiento OpenAI (o1/o3/o4/gpt-5) prefieren max_completion_tokens
        if any(low_model.startswith(p) or f"/{p}" in low_model for p in ("o1", "o3", "o4", "gpt-5")):
            max_tok = payload.pop("max_tokens", None)
            if max_tok is not None:
                payload["max_completion_tokens"] = max_tok
            # o1/o3/o4 suelen rechazar temperature distinto de 1
            if low_model.startswith(("o1", "o3", "o4")):
                payload.pop("temperature", None)
    elif pid == "gemini":
        # El endpoint OpenAI-compat de Gemini en algunos casos rechaza stream_options si incluye campos extra
        if "stream_options" in payload:
            payload["stream_options"] = {"include_usage": True}
        # DeepSeek / Gemini no usan `max_completion_tokens`
    elif pid == "deepseek":
        # deepseek-reasoner no soporta response_format json_object en versiones legacy o temperature
        if "reasoner" in low_model:
            payload.pop("response_format", None)
            payload.pop("temperature", None)
    elif pid == "groq":
        # Groq restringe max_tokens en ciertos modelos (ej. 8192 máx típico seguro)
        if isinstance(payload.get("max_tokens"), int) and payload["max_tokens"] > 8192:
            payload["max_tokens"] = 8192
    return payload


def classify_provider_error(err_msg: str, provider: Optional[str] = None) -> Dict[str, Any]:
    """
    Clasifica errores HTTP/SDK de proveedores para decidir cooldown y failover automático.
    Retorna:
      kind: quota_exhausted | rate_limited | auth_error | model_unavailable | transient | invalid_request
      is_quota_or_rate: bool
      should_failover_provider: bool
      cooldown_seconds: int
      friendly_message: str
    """
    pid = normalize_provider_id(provider)
    pname = PROVIDER_SPECS[pid]["name"]
    raw = str(err_msg or "").strip()
    low = raw.lower()

    if any(
        tok in low
        for tok in (
            "401",
            "unauthorized",
            "invalid api key",
            "invalid x-api-key",
            "incorrect api key",
            "api_key_invalid",
            "api key not valid",
            "authentication_error",
            "no auth",
        )
    ):
        return {
            "kind": "auth_error",
            "is_quota_or_rate": False,
            "should_failover_provider": True,
            "cooldown_seconds": 600,
            "friendly_message": f"La clave API de {pname} no es válida o fue revocada.",
        }

    # Agotamiento de saldo / cuota diaria o mensual
    if any(
        tok in low
        for tok in (
            "402",
            "insufficient credits",
            "more credits",
            "insufficient_quota",
            "exceeded your current quota",
            "credit balance is too low",
            "balance is insufficient",
            "insufficient balance",
            "billing",
            "payment required",
            "quota exceeded",
            "daily limit",
            "tokens per day",
            "requests per day",
            "free limit",
        )
    ):
        return {
            "kind": "quota_exhausted",
            "is_quota_or_rate": True,
            "should_failover_provider": True,
            "cooldown_seconds": 3600,
            "friendly_message": f"Se agotó la cuota o saldo disponible en {pname}.",
        }

    # Saturación RPM/TPM (429 / resource_exhausted)
    if any(
        tok in low
        for tok in (
            "429",
            "rate limit",
            "rate_limit",
            "too many requests",
            "resource_exhausted",
            "tokens per minute",
            "requests per minute",
            "rpm",
            "tpm",
        )
    ):
        return {
            "kind": "rate_limited",
            "is_quota_or_rate": True,
            "should_failover_provider": True,
            "cooldown_seconds": 90,
            "friendly_message": f"{pname} alcanzó su límite temporal de velocidad (RPM/TPM).",
        }

    if any(tok in low for tok in ("404", "model_not_found", "not_found_error", "does not exist", "no endpoints")):
        return {
            "kind": "model_unavailable",
            "is_quota_or_rate": False,
            "should_failover_provider": True,
            "cooldown_seconds": 60,
            "friendly_message": f"El modelo solicitado no está disponible en {pname}.",
        }

    if any(
        tok in low
        for tok in (
            "500",
            "502",
            "503",
            "504",
            "overloaded",
            "bad gateway",
            "temporarily",
            "timeout",
            "timed out",
            "network",
            "conexión",
            "connection",
        )
    ):
        return {
            "kind": "transient",
            "is_quota_or_rate": False,
            "should_failover_provider": True,
            "cooldown_seconds": 45,
            "friendly_message": f"Interrupción temporal al conectar con {pname}.",
        }

    return {
        "kind": "invalid_request",
        "is_quota_or_rate": False,
        "should_failover_provider": False,
        "cooldown_seconds": 0,
        "friendly_message": raw or f"No se pudo completar la consulta con {pname}.",
    }


def enrich_model_with_tariffs(provider: str, entry: Dict[str, Any]) -> Dict[str, Any]:
    pid = normalize_provider_id(provider)
    spec = PROVIDER_SPECS[pid]
    out = dict(entry)
    mid = str(out.get("id") or "").strip()
    out["provider_id"] = pid
    out.setdefault("provider_name", spec["name"])

    ref = MODEL_TARIFF_HINTS.get(mid)
    if ref is None:
        # Búsqueda parcial para versiones fechadas (ej. claude-sonnet-4-6-2026xxxx)
        low_mid = mid.lower()
        for k, v in MODEL_TARIFF_HINTS.items():
            if low_mid.startswith(k):
                ref = v
                break

    if ref:
        if out.get("prompt_price_per_million") is None and ref.get("prompt") is not None:
            out["prompt_price_per_million"] = ref["prompt"]
        if out.get("completion_price_per_million") is None and ref.get("completion") is not None:
            out["completion_price_per_million"] = ref["completion"]
        if out.get("cache_price_per_million") is None and ref.get("cache") is not None:
            out["cache_price_per_million"] = ref["cache"]
        if ref.get("free"):
            out["is_free"] = True
    elif pid == "gemini" and ("flash" in mid.lower()):
        out["is_free"] = True

    p_in = out.get("prompt_price_per_million")
    p_out = out.get("completion_price_per_million")
    c_in = out.get("cache_price_per_million")
    if not out.get("hint") or out.get("hint") == "Modelo estándar":
        parts = [spec["name"]]
        if out.get("is_free") and pid in ("openrouter", "gemini"):
            parts.append("Gratis (con límite)")
        if isinstance(p_in, (int, float)) and isinstance(p_out, (int, float)) and (p_in > 0 or p_out > 0):
            parts.append(f"${p_in:g}/${p_out:g} /1M")
        elif out.get("is_free"):
            parts.append("Gratis")
        if isinstance(c_in, (int, float)):
            parts.append(f"Caché ${c_in:g}")
        out["hint"] = " · ".join(parts)

    return out


# Estado efímero en memoria por proceso sobre salud de cada proveedor
_PROVIDER_COOLDOWNS: Dict[str, Tuple[float, str, str]] = {}


def mark_provider_cooldown(provider: str, reason: str, kind: str = "quota_exhausted", ttl_sec: int = 3600) -> int:
    pid = normalize_provider_id(provider)
    until = time.time() + max(15, int(ttl_sec))
    _PROVIDER_COOLDOWNS[pid] = (until, reason[:240], kind)
    return int(until * 1000)


def clear_provider_cooldown(provider: str) -> None:
    _PROVIDER_COOLDOWNS.pop(normalize_provider_id(provider), None)


def get_provider_cooldown(provider: str) -> Optional[Dict[str, Any]]:
    pid = normalize_provider_id(provider)
    rec = _PROVIDER_COOLDOWNS.get(pid)
    if not rec:
        return None
    until, reason, kind = rec
    if time.time() >= until:
        _PROVIDER_COOLDOWNS.pop(pid, None)
        return None
    return {
        "provider": pid,
        "cooldown_until_ms": int(until * 1000),
        "reason": reason,
        "kind": kind,
    }


def is_provider_in_cooldown(provider: str, *, extra_cooldown_until_ms: Optional[int] = None) -> bool:
    if extra_cooldown_until_ms and extra_cooldown_until_ms > int(time.time() * 1000):
        return True
    return get_provider_cooldown(provider) is not None


def select_equivalent_model_for_provider(
    target_provider: str,
    configured_model: Optional[str],
    *,
    needs_reasoning: bool = False,
    needs_vision: bool = False,
) -> str:
    pid = normalize_provider_id(target_provider)
    spec = PROVIDER_SPECS[pid]
    clean_cfg = str(configured_model or "").strip()
    if clean_cfg and (pid != "openrouter" or "/" in clean_cfg):
        return clean_cfg
    defaults: List[Dict[str, Any]] = spec["default_models"]
    if needs_vision:
        for m in defaults:
            if m.get("supports_vision"):
                return str(m["id"])
    if needs_reasoning:
        for m in defaults:
            if m.get("supports_reasoning") and m["id"] != "openrouter/free":
                return str(m["id"])
    return str(spec["default_model"])


def order_provider_failover_chain(
    primary_provider: str,
    provider_credentials: Optional[Dict[str, Dict[str, Any]]],
    *,
    failover_order: Optional[Iterable[str]] = None,
    auto_failover: bool = True,
) -> List[str]:
    """Construye la lista ordenada de proveedores con clave configurada para intentar en turno."""
    primary = normalize_provider_id(primary_provider)
    creds = provider_credentials or {}
    configured = [
        pid
        for pid, info in creds.items()
        if isinstance(info, dict) and normalize_provider_api_key(str(info.get("api_key") or ""))
    ]
    if not auto_failover:
        return [primary] if primary in configured or not configured else [primary]

    ordered: List[str] = [primary]
    custom_seq = [normalize_provider_id(p) for p in (failover_order or [])]
    # Luego proveedores con capa gratuita/ultra económica primero si el usuario no definió otro orden
    default_priority = ("openrouter", "groq", "gemini", "deepseek", "openai", "anthropic")
    for candidate in (*custom_seq, *default_priority):
        if candidate in configured and candidate not in ordered:
            ordered.append(candidate)

    # Mueve al final proveedores que ya están en cooldown activo (salvo el primario si todos están en cooldown)
    now_ms = int(time.time() * 1000)
    healthy: List[str] = []
    cooled: List[str] = []
    for pid in ordered:
        info = creds.get(pid) if isinstance(creds.get(pid), dict) else {}
        cd_ms = info.get("cooldown_until_ms")
        if is_provider_in_cooldown(pid, extra_cooldown_until_ms=int(cd_ms) if cd_ms else None):
            cooled.append(pid)
        else:
            healthy.append(pid)

    # Si el primario está en cooldown pero hay otro proveedor saludable, priorizar saludables primero
    if healthy:
        return [*healthy, *cooled]
    return ordered
