"""
Registro centralizado de proveedores IA soportados por XOOK:
- OpenRouter (`openrouter`)
- DeepSeek (`deepseek`)
- Kimi / Moonshot AI (`kimi`)
- OpenAI (`openai`)
- Anthropic (`anthropic`)
- Groq (`groq`)
- Google Gemini (`gemini`)

Incluye metadatos de endpoints, tarifas de referencia por millón de tokens (USD/1M),
normalización y detección segura de claves, parser unificado de headers de rate-limit/cuota,
cálculo de costo estimado por turno y clasificación de errores para failover automático.
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
import re
import time
from typing import Any, Dict, Iterable, List, Optional, Tuple


PROVIDER_ORDER: Tuple[str, ...] = (
    "openrouter",
    "deepseek",
    "kimi",
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
    # Moonshot AI / Kimi
    "kimi-k3.1-pro": {"prompt": 2.00, "completion": 10.00, "cache": 0.20, "free": False},
    "kimi-k3.1-pro-highspeed": {"prompt": 4.00, "completion": 20.00, "cache": 0.20, "free": False},
    "kimi-k3": {"prompt": 3.00, "completion": 15.00, "cache": 0.30, "free": False},
    "kimi-k2.5": {"prompt": 0.60, "completion": 3.00, "cache": 0.15, "free": False},
    "kimi-k2.6": {"prompt": 0.95, "completion": 4.00, "cache": 0.19, "free": False},
    "kimi-k2.7-code": {"prompt": 0.95, "completion": 4.00, "cache": 0.16, "free": False},
    "kimi-k2-0905-preview": {"prompt": 0.60, "completion": 2.50, "cache": 0.15, "free": False},
    "moonshot-v1-128k": {"prompt": 0.60, "completion": 2.50, "cache": 0.15, "free": False},
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
    "kimi": {
        "id": "kimi",
        "name": "Kimi (Moonshot)",
        "base_url": "https://api.moonshot.ai/v1",
        "cn_base_url": "https://api.moonshot.cn/v1",
        "protocol": "openai",
        "default_model": "kimi-k3.1-pro",
        "tier_badge": "Prepago · Saldo API",
        "tariff_short": "K3.1 Pro $2.00/$10.00 · Caché $0.20 · Ventana 1M",
        "rate_limit_note": "Consulta saldo real (/users/me/balance) + headers RPM/TPM por turno",
        "key_prefix_hint": "sk-...",
        "default_models": [
            {
                "id": "kimi-k3.1-pro",
                "name": "Kimi K3.1 Pro",
                "provider_name": "Kimi (Moonshot)",
                "provider_id": "kimi",
                "hint": "Kimi · $2.00/$10.00 · Caché $0.20 · Ventana 1M",
                "is_free": False,
                "context_length": 1000000,
                "prompt_price_per_million": 2.00,
                "completion_price_per_million": 10.00,
                "cache_price_per_million": 0.20,
                "supports_tools": True,
                "supports_reasoning": True,
                "supports_structured": True,
                "supports_vision": True,
            },
            {
                "id": "kimi-k3.1-pro-highspeed",
                "name": "Kimi K3.1 Pro Highspeed",
                "provider_name": "Kimi (Moonshot)",
                "provider_id": "kimi",
                "hint": "Kimi · $4.00/$20.00 · Alta velocidad · Ventana 1M",
                "is_free": False,
                "context_length": 1000000,
                "prompt_price_per_million": 4.00,
                "completion_price_per_million": 20.00,
                "cache_price_per_million": 0.20,
                "supports_tools": True,
                "supports_reasoning": True,
                "supports_structured": True,
                "supports_vision": True,
            },
            {
                "id": "kimi-k3",
                "name": "Kimi K3",
                "provider_name": "Kimi (Moonshot)",
                "provider_id": "kimi",
                "hint": "Kimi · $3.00/$15.00 · Estándar 1M",
                "is_free": False,
                "context_length": 1000000,
                "prompt_price_per_million": 3.00,
                "completion_price_per_million": 15.00,
                "cache_price_per_million": 0.30,
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
        "kimi": "kimi",
        "moonshot": "kimi",
        "moonshot-ai": "kimi",
        "moonshot_ai": "kimi",
        "moonshotai": "kimi",
        "moonshot-cn": "kimi",
        "moonshot_cn": "kimi",
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


def resolve_provider_base_url(provider: Optional[str], region_or_url: Optional[str] = None) -> str:
    pid = normalize_provider_id(provider)
    spec = PROVIDER_SPECS[pid]
    override = str(region_or_url or "").strip()
    if override.startswith(("https://", "http://")):
        return override.rstrip("/")
    if pid == "kimi" and override.lower() in ("cn", "china", "moonshot-cn", "moonshot.cn", "api.moonshot.cn"):
        return str(spec.get("cn_base_url") or "https://api.moonshot.cn/v1").rstrip("/")
    return str(spec["base_url"]).rstrip("/")


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


def _coerce_int_header(raw: Any) -> Optional[int]:
    if raw is None:
        return None
    try:
        val = int(float(str(raw).strip()))
        return val if val >= 0 else None
    except Exception:
        return None


def _coerce_float_header(raw: Any) -> Optional[float]:
    if raw is None:
        return None
    try:
        val = float(str(raw).strip())
        return val if val >= 0 else None
    except Exception:
        return None


def _parse_reset_timestamp_ms(raw: Any, ref_ms: int) -> Optional[int]:
    if raw is None:
        return None
    txt = str(raw).strip()
    if not txt:
        return None
    # ISO 8601 (ej. Anthropic: 2026-11-14T07:12:00Z)
    if "T" in txt or (txt.endswith("Z") and "-" in txt):
        try:
            normalized = txt[:-1] + "+00:00" if txt.endswith("Z") else txt
            dt = datetime.fromisoformat(normalized)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return int(dt.timestamp() * 1000)
        except Exception:
            pass
    # Numérico puro: epoch ms, epoch s, o segundos relativos
    try:
        num = float(txt)
        if num >= 1e12:
            return int(num)
        if num >= 1e9:
            return int(num * 1000)
        if num >= 0:
            return int(ref_ms + num * 1000)
    except Exception:
        pass
    # Duración compuesta tipo Go (OpenAI/Groq/Moonshot: "6m30s", "1s", "250ms", "1h2m3s")
    matches = re.findall(r"(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)", txt.lower())
    if matches:
        total_ms = 0.0
        unit_ms = {"ms": 1.0, "s": 1000.0, "m": 60_000.0, "h": 3_600_000.0, "d": 86_400_000.0}
        for amount_str, unit in matches:
            total_ms += float(amount_str) * unit_ms.get(unit, 1000.0)
        return int(ref_ms + total_ms)
    return None


def parse_rate_limit_headers(
    provider: Optional[str],
    headers_map: Any,
    *,
    now_ms: Optional[int] = None,
) -> Optional[Dict[str, Any]]:
    """
    Extrae límites reales y contadores restantes desde headers HTTP de respuesta/error:
    - Anthropic (`anthropic-ratelimit-*`)
    - OpenAI / Groq / DeepSeek / Kimi / OpenRouter (`x-ratelimit-*`, `retry-after`)
    Retorna None si la respuesta no incluyó headers de límite.
    """
    if headers_map is None:
        return None
    low_headers: Dict[str, str] = {}
    try:
        items = headers_map.items() if hasattr(headers_map, "items") else dict(headers_map).items()
        for k, v in items:
            lk = str(k).strip().lower()
            if lk:
                low_headers[lk] = str(v).strip()
    except Exception:
        return None

    if not low_headers:
        return None

    pid = normalize_provider_id(provider)
    ref_ms = int(now_ms if now_ms is not None else time.time() * 1000)

    def _first(*keys: str) -> Optional[str]:
        for k in keys:
            val = low_headers.get(k)
            if val is not None and val != "":
                return val
        return None

    rpm_limit = _coerce_int_header(_first(
        "anthropic-ratelimit-requests-limit",
        "x-ratelimit-limit-requests",
        "x-ratelimit-requests-limit",
        "x-ratelimit-limit",
    ))
    rpm_remaining = _coerce_int_header(_first(
        "anthropic-ratelimit-requests-remaining",
        "x-ratelimit-remaining-requests",
        "x-ratelimit-requests-remaining",
        "x-ratelimit-remaining",
    ))
    rpm_reset_at_ms = _parse_reset_timestamp_ms(
        _first(
            "anthropic-ratelimit-requests-reset",
            "x-ratelimit-reset-requests",
            "x-ratelimit-requests-reset",
            "x-ratelimit-reset",
        ),
        ref_ms,
    )

    tpm_limit = _coerce_int_header(_first(
        "anthropic-ratelimit-tokens-limit",
        "x-ratelimit-limit-tokens",
        "x-ratelimit-tokens-limit",
    ))
    tpm_remaining = _coerce_int_header(_first(
        "anthropic-ratelimit-tokens-remaining",
        "x-ratelimit-remaining-tokens",
        "x-ratelimit-tokens-remaining",
    ))
    tpm_reset_at_ms = _parse_reset_timestamp_ms(
        _first(
            "anthropic-ratelimit-tokens-reset",
            "x-ratelimit-reset-tokens",
            "x-ratelimit-tokens-reset",
        ),
        ref_ms,
    )

    itpm_limit = _coerce_int_header(_first("anthropic-ratelimit-input-tokens-limit"))
    itpm_remaining = _coerce_int_header(_first("anthropic-ratelimit-input-tokens-remaining"))
    otpm_limit = _coerce_int_header(_first("anthropic-ratelimit-output-tokens-limit"))
    otpm_remaining = _coerce_int_header(_first("anthropic-ratelimit-output-tokens-remaining"))

    retry_after_sec = _coerce_float_header(_first("retry-after"))
    if retry_after_sec is None:
        retry_ms = _coerce_float_header(_first("retry-after-ms"))
        if retry_ms is not None:
            retry_after_sec = round(retry_ms / 1000.0, 3)

    has_any = any(
        v is not None
        for v in (
            rpm_limit,
            rpm_remaining,
            rpm_reset_at_ms,
            tpm_limit,
            tpm_remaining,
            tpm_reset_at_ms,
            itpm_limit,
            itpm_remaining,
            otpm_limit,
            otpm_remaining,
            retry_after_sec,
        )
    )
    if not has_any:
        return None

    return {
        "provider": pid,
        "source": "api_headers",
        "updated_at_ms": ref_ms,
        "rpm_limit": rpm_limit,
        "rpm_remaining": rpm_remaining,
        "rpm_reset_at_ms": rpm_reset_at_ms,
        "tpm_limit": tpm_limit,
        "tpm_remaining": tpm_remaining,
        "tpm_reset_at_ms": tpm_reset_at_ms,
        "itpm_limit": itpm_limit,
        "itpm_remaining": itpm_remaining,
        "otpm_limit": otpm_limit,
        "otpm_remaining": otpm_remaining,
        "retry_after_sec": retry_after_sec,
    }


def parse_gemini_quota_error(err_body_or_detail: str) -> Optional[Dict[str, Any]]:
    """
    Extrae detalles reales de cuota/reintento cuando Gemini responde HTTP 429 RESOURCE_EXHAUSTED
    (`google.rpc.QuotaFailure` y `google.rpc.RetryInfo`).
    """
    raw = str(err_body_or_detail or "").strip()
    if not raw:
        return None

    parsed_json: Optional[Dict[str, Any]] = None
    json_start = raw.find("{")
    if json_start >= 0:
        try:
            candidate = json.loads(raw[json_start:])
            if isinstance(candidate, dict):
                parsed_json = candidate
        except Exception:
            parsed_json = None

    quota_metric: Optional[str] = None
    quota_id: Optional[str] = None
    quota_value: Optional[int] = None
    retry_after_sec: Optional[float] = None

    if parsed_json:
        err_obj = parsed_json.get("error") if isinstance(parsed_json.get("error"), dict) else parsed_json
        details = err_obj.get("details") if isinstance(err_obj, dict) else None
        if isinstance(details, list):
            for det in details:
                if not isinstance(det, dict):
                    continue
                dtype = str(det.get("@type") or "")
                if "QuotaFailure" in dtype:
                    violations = det.get("violations") or []
                    if isinstance(violations, list) and violations:
                        first_v = violations[0] if isinstance(violations[0], dict) else {}
                        quota_metric = str(first_v.get("quotaMetric") or "") or None
                        quota_id = str(first_v.get("quotaId") or "") or None
                        quota_value = _coerce_int_header(first_v.get("quotaValue"))
                elif "RetryInfo" in dtype:
                    rd = str(det.get("retryDelay") or "").strip()
                    m = re.match(r"^(\d+(?:\.\d+)?)s$", rd.lower())
                    if m:
                        retry_after_sec = float(m.group(1))

    if retry_after_sec is None:
        m_retry = re.search(r"retry(?:\s+in|\s+after)?\s+(\d+(?:\.\d+)?)\s*s", raw.lower())
        if m_retry:
            retry_after_sec = float(m_retry.group(1))
    if quota_value is None:
        m_lim = re.search(r"limit\s*[:=]\s*(\d+)", raw.lower())
        if m_lim:
            quota_value = int(m_lim.group(1))

    if not any(v is not None for v in (quota_metric, quota_id, quota_value, retry_after_sec)):
        return None

    low_scope = f"{quota_id or ''} {quota_metric or ''} {raw}".lower()
    is_daily = "perday" in low_scope or "per_day" in low_scope or "requests_per_day" in low_scope or "rpd" in low_scope
    is_rpm = "perminute" in low_scope or "per_minute" in low_scope or "rpm" in low_scope
    is_tokens = "token" in low_scope

    out: Dict[str, Any] = {
        "provider": "gemini",
        "source": "api_429_quota_detail",
        "updated_at_ms": int(time.time() * 1000),
        "quota_metric": quota_metric,
        "quota_id": quota_id,
        "quota_value": quota_value,
        "retry_after_sec": retry_after_sec,
    }
    if quota_value is not None:
        if is_tokens:
            out["tpm_limit"] = quota_value
            out["tpm_remaining"] = 0
        elif is_daily:
            out["daily_limit"] = quota_value
            out["daily_remaining"] = 0
        elif is_rpm:
            out["rpm_limit"] = quota_value
            out["rpm_remaining"] = 0
    return out


def _lookup_model_tariff(provider: str, model_id: str) -> Optional[Dict[str, Any]]:
    mid = str(model_id or "").strip()
    if not mid:
        return None
    candidates = [mid, mid.lower()]
    if "/" in mid:
        stripped = mid.split("/", 1)[1]
        candidates.extend([stripped, stripped.lower()])
    for key in candidates:
        if key in MODEL_TARIFF_HINTS:
            return MODEL_TARIFF_HINTS[key]
    low_mid = mid.lower()
    stripped_low = low_mid.split("/", 1)[1] if "/" in low_mid else low_mid
    for k, v in MODEL_TARIFF_HINTS.items():
        if low_mid.startswith(k.lower()) or stripped_low.startswith(k.lower()):
            return v
    return None


def estimate_turn_cost_usd(
    provider: Optional[str],
    model_id: str,
    usage: Optional[Dict[str, Any]],
) -> Optional[float]:
    """
    Calcula el costo real (si el proveedor lo reporta, ej. OpenRouter `usage.cost`) o estimado USD
    a partir de tokens de entrada, salida y caché lectura usando tarifas conocidas del modelo.
    """
    if not isinstance(usage, dict) or not usage:
        return None
    direct_cost = usage.get("cost")
    if direct_cost is None:
        direct_cost = usage.get("estimated_cost_usd")
    if direct_cost is not None:
        try:
            c = float(direct_cost)
            if c >= 0:
                return round(c, 8)
        except Exception:
            pass

    pid = normalize_provider_id(provider)
    tariff = _lookup_model_tariff(pid, model_id)
    if not tariff:
        return None
    if tariff.get("free"):
        return 0.0

    prompt_rate = tariff.get("prompt")
    completion_rate = tariff.get("completion")
    cache_rate = tariff.get("cache")
    if prompt_rate is None and completion_rate is None:
        return None

    prompt_tok = int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0)
    completion_tok = int(usage.get("completion_tokens") or usage.get("output_tokens") or 0)
    cached_tok = int(
        usage.get("cached_tokens")
        or usage.get("prompt_cache_hit_tokens")
        or usage.get("cache_read_input_tokens")
        or 0
    )
    if cached_tok <= 0 and isinstance(usage.get("prompt_tokens_details"), dict):
        cached_tok = int(usage["prompt_tokens_details"].get("cached_tokens") or 0)

    cached_applied = min(max(0, cached_tok), max(0, prompt_tok))
    uncached_prompt = max(0, prompt_tok - cached_applied)

    p_cost = (uncached_prompt / 1_000_000.0) * float(prompt_rate or 0.0)
    c_rate = float(cache_rate) if cache_rate is not None else float(prompt_rate or 0.0)
    cache_cost = (cached_applied / 1_000_000.0) * c_rate
    out_cost = (max(0, completion_tok) / 1_000_000.0) * float(completion_rate or 0.0)
    return round(p_cost + cache_cost + out_cost, 8)


def classify_provider_error(
    err_msg: str,
    provider: Optional[str] = None,
    *,
    retry_after_sec: Optional[float] = None,
) -> Dict[str, Any]:
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

    is_per_minute_rate = any(
        tok in low
        for tok in ("per minute", "per_minute", "requests_per_minute", "tokens_per_minute")
    )

    # Agotamiento de saldo / cuota diaria o mensual
    if not is_per_minute_rate and any(
        tok in low
        for tok in (
            "402",
            "insufficient credits",
            "more credits",
            "insufficient_quota",
            "exceeded your current quota",
            "exceeded_current_quota",
            "credit balance is too low",
            "balance is insufficient",
            "insufficient balance",
            "account suspended",
            "suspended",
            "recharge",
            "resource_package_exhausted",
            "billing",
            "payment required",
            "quota exceeded",
            "daily limit",
            "tokens per day",
            "requests per day",
            "per_day",
            "perday",
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
        gemini_detail = parse_gemini_quota_error(raw) if pid == "gemini" else None
        detected_retry = retry_after_sec
        if detected_retry is None and gemini_detail:
            detected_retry = gemini_detail.get("retry_after_sec")
        cd_secs = 90
        if detected_retry is not None and detected_retry > 0:
            cd_secs = max(5, min(3600, int(round(detected_retry))))
        out = {
            "kind": "rate_limited",
            "is_quota_or_rate": True,
            "should_failover_provider": True,
            "cooldown_seconds": cd_secs,
            "friendly_message": f"{pname} alcanzó su límite temporal de velocidad (RPM/TPM).",
        }
        if detected_retry is not None:
            out["retry_after_sec"] = detected_retry
        if gemini_detail:
            out["quota_detail"] = gemini_detail
        return out

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
    default_priority = ("openrouter", "groq", "gemini", "deepseek", "kimi", "openai", "anthropic")
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
