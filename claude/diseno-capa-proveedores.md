# Diseño — Capa de proveedores agnóstica (Fase 0)

Estado: **en ejecución**. Hechos: la red de seguridad, los pasos 2 y 3 dentro del cliente, y dos correcciones que salieron en el camino (la URL propia de OpenRouter y el razonamiento de DeepSeek). Ver "Plan de migración".

## Diagnóstico (2026-11-21)

`src-brain/slices/ai_service/openrouter_client.py` tiene 8.057 líneas y mezcla el loop del agente con los detalles de cada proveedor.

| Hallazgo | Dónde | Consecuencia |
|---|---|---|
| La llamada al proveedor está copiada **4 veces** con el mismo `if anthropic / if openrouter / else compat` | `_call_with_fallbacks` (en `run_agent_completion`), apertura del stream en `stream_agent_completion`, `_call_sub` (subagentes), `_make_compact_llm_caller` | Agregar un proveedor obliga a tocar 4 lugares; es fácil olvidar uno |
| 38 ramas `provider == "..."` | todo el archivo | El núcleo conoce detalles que no le tocan |
| El reenvío de `reasoning_content` de DeepSeek está repetido ~6 veces | loop de stream (reparación de Canvas, continuaciones, follow-ups) | Un proveedor nuevo con la misma necesidad (Kimi, modelos locales con razonamiento) repetiría el parche |
| Heurística de `max_tokens` por proveedor dentro del loop | `stream_agent_completion` | Límite de salida decidido en el lugar equivocado |
| `temperature: 0.3` fijo | payload del stream | Algunos modelos de razonamiento la rechazan; hoy se parcha en `build_openai_compat_chat_payload` |
| Dos loops del agente: síncrono (~800 líneas) y stream (~2.000) | `run_agent_completion`, `stream_agent_completion` | Lógica del agente duplicada que diverge con el tiempo |
| Un proveedor desconocido cae en `openrouter` sin avisar | `normalize_provider_id` | Un error de configuración se vuelve un error de API confuso |
| No hay proveedor local | `PROVIDER_SPECS` | Sin opción gratuita y sin opción offline |

Lo que ya está bien y se conserva: `PROVIDER_SPECS` con capacidades por modelo, la cadena de failover con `select_equivalent_model_for_provider`, `build_openai_compat_chat_payload` y `parse_rate_limit_headers`.

## Diseño objetivo

```text
src-brain/slices/ai_service/
├── providers/
│   ├── base.py           # ProviderAdapter (Protocol) + tipos internos
│   ├── openai_compat.py  # OpenAI, DeepSeek, Groq, Gemini, Kimi, local (Ollama / LM Studio)
│   ├── openrouter.py     # headers y endpoints propios de OpenRouter (créditos, /key)
│   ├── anthropic.py      # envuelve anthropic_adapter.py
│   └── registry.py       # get_adapter(provider_id) -> ProviderAdapter
├── agent_loop.py         # un solo loop; la versión síncrona consume el stream
└── openrouter_client.py  # fachada RPC mientras se migra; al final solo delega
```

```python
class ProviderAdapter(Protocol):
    id: str

    def complete(self, req: ChatRequest) -> ChatResponse: ...
    def stream(self, req: ChatRequest) -> Iterator[StreamEvent]: ...

    # Cómo se guarda un turno del asistente en el historial. Aquí vive el
    # reenvío de `reasoning_content` de DeepSeek, y cualquier caso futuro igual.
    def history_message(self, turn: AssistantTurn) -> Dict[str, Any]: ...

    def output_token_limit(self, model: str, wants_long_output: bool) -> int: ...
    def test_key(self) -> KeyStatus: ...
    def list_models(self) -> List[ModelInfo]: ...
```

El núcleo solo conoce `ChatRequest` / `ChatResponse` / `StreamEvent` (formato interno, hoy de facto el de OpenAI) y la matriz de capacidades. Nunca pregunta por el nombre de un proveedor.

## Plan de migración

Pasos pequeños; cada uno deja los tests y las evals en verde.

0. **Red de seguridad** *(hecho)*: `slices/ai_service/provider_requests_tests.py` congela lo que sale a la red (URL, autenticación, timeout y campos que dependen del proveedor) en los cuatro caminos y por familia de proveedor. Se comprobó con mutaciones que detecta cambios.
1. Crear `providers/` con los adaptadores y sus tests. *Va después del paso 2*: la suite heredada `test_sidecar.py` parchea `_http_json` y `_provider_http_json` dentro de `openrouter_client`, así que mover el transporte a otro módulo rompería esos parches sin avisar. Antes hay que llevar esos parches a `urlopen`, como hacen los tests de caracterización.
2. Reemplazar las 4 llamadas duplicadas. *(Hecho dentro del cliente)*: `_provider_chat_completion` y `_open_provider_chat_stream`; las evals también las usan (eran la quinta copia). Al hacerlo apareció y se corrigió un desvío: el loop normal y los subagentes ignoraban la URL propia de OpenRouter y mandaban la clave a `openrouter.ai`.
3. Reunir las reglas de cada proveedor. *(Hecho dentro del cliente)*: `_provider_supports_response_format`, `_stream_max_output_tokens`, `_iter_provider_stream_events`, `_provider_accepts_model_id` y `_provider_replays_reasoning`; el loop ya no compara nombres de proveedor salvo para el failover. Al cubrirlas con tests apareció un defecto: el razonamiento nativo de DeepSeek (`reasoning_content`) se le reenviaba vacío en el loop de herramientas. Corregido; además, si una ronda solo trae razonamiento, el agente ahora pide la respuesta final en vez de dar un texto genérico. Pendiente: el loop no-streaming tampoco reenvía el razonamiento; se resuelve al unificar los loops (paso 5).
4. Agregar el proveedor `local` (Ollama / LM Studio en `localhost`, protocolo OpenAI). Hacer que `normalize_provider_id` falle con un mensaje claro ante un proveedor desconocido.
5. Unificar los dos loops: `run_agent_completion` consume `stream_agent_completion`. Es el paso más riesgoso; va al final y con las evals corriendo antes y después.

Criterio de salida: `grep -n 'provider == "' src-brain/slices/ai_service/*.py` no devuelve nada fuera de `providers/`, y las evals de proveedores dan el mismo resultado antes y después.

## Relación con las evals

`slices/provider_evals/` mide qué tan bien usa las herramientas reales de XOOK cada modelo. Desde el paso 2 su transporte usa `_provider_chat_completion`, así que cada modelo se mide con la misma petición que hace el agente.
