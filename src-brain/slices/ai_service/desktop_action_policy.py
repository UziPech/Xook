"""
Que Xox actúe en las otras apps del equipo en vez de decir que no puede.

Ante "revísame si en Teams tengo tareas" o "dile a Claude que…", un modelo tiende a contestar
"no tengo acceso a tu cuenta" y ofrecer un menú de opciones, aunque XOOK tenga con qué abrir la
app, leerla y escribir en ella. Aquí viven las dos defensas, iguales para cualquier proveedor:

- `desktop_action_rules`: la instrucción del prompt.
- `gave_up_on_desktop` + `ReplyHold`: si aun así el modelo se rinde sin haber intentado nada, la
  negativa no llega a la pantalla (ni a la voz) y se le exige el primer paso, una sola vez.

El permiso sigue siendo del Guardián: nada de esto salta su tarjeta ni el bloqueo de apps sensibles.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any, Callable, Dict, Iterable

from slices.agent_tools.system_capabilities import system_capabilities
from slices.agent_tools.tool_catalog import TOOLKIT_SPECS


DESKTOP_TOOLKIT = "desktop_ui"

# Con una sola de estas en el turno ya hubo intento: si después dice que no pudo, es un resultado.
DESKTOP_ATTEMPT_TOOLS = frozenset(TOOLKIT_SPECS[DESKTOP_TOOLKIT]["tools"]) | {"read_screen_now"}


_RULES = """- TRABAJO EN OTRAS APPS (cuando lo que pide vive en otra app o página: Teams, WhatsApp, Outlook, Claude, el navegador…):
  * Tu acceso es la app que ya tiene en este equipo con su sesión iniciada. No necesitas su cuenta, una API ni una integración. HAZLO en este turno, sin preguntar antes:
    1. `desktop_list_windows(query="<app>")`. Si no está abierta, `open_desktop_app`.
    2. Lee: `read_screen_now(mode="window")` para lo visible o `desktop_snapshot(window_id=...)` para sus controles.
    3. Si lo que busca está en otra sección, encuéntrala con `desktop_find`, entra con `desktop_act` y vuelve a leer.
    4. Responde con lo que encontraste (o con "no hay nada pendiente", si eso viste).
  * El permiso lo pide el Guardián con una tarjeta cuando actúas. No lo pidas por chat ni contestes con un menú de opciones.
  * "Dile a X", "pregúntale a X" o "mándale a X" es escribirle en la app donde está X. Redacta tú el mensaje con lo que ya se dijo en esta conversación. Si X es otro asistente (Claude, ChatGPT, Gemini), es su app o su página: no es un proveedor por configurar ni te está hablando a ti.
  * PROHIBIDO decir que no tienes acceso o no puedes sin haberlo intentado con herramientas. Si antes en esta conversación dijiste que no podías, inténtalo ahora. Si algo falla, di qué intentaste, dónde se detuvo y el único paso que le toca a la persona (iniciar sesión, dar un permiso)."""


def desktop_action_rules() -> str:
    """Bloque del prompt; vacío donde el sistema no puede operar otras apps."""
    return _RULES if "desktop_control" in system_capabilities() else ""


# Una negativa se anuncia al principio. Más adelante, "no puedo" suele ser parte de una explicación
# o de un texto que el usuario pidió redactar.
OPENING_CHARS = 240
# Lo que se retiene de una respuesta normal antes de mostrarla en vivo.
FIRST_LOOK_CHARS = 90

_NEGATION_RE = re.compile(r"\b(?:no|sin|lo siento|lamentablemente|desafortunadamente|disculpa|perdon)\b")
_CANNOT_RE = re.compile(
    r"\bno\s+(?:puedo|podria|me\s+es\s+posible|soy\s+capaz\s+de|"
    r"tengo\s+(?:la\s+)?(?:forma|manera|capacidad|posibilidad)\s+de)\s+(?:\w+\s+){0,3}?"
    r"(?:entrar|acceder|abrir|controlar|ver|leer|revisar|consultar|operar|interactuar|enviar|mandar|"
    r"escribir|usar|conectarme|iniciar)"
    r"|\bno\s+(?:tengo|cuento\s+con)\s+(?:\w+\s+){0,2}?(?:acceso|herramientas?|integracion|conexion)\b"
)
_OTHER_APP_RE = re.compile(
    r"\b(?:apps?|aplicacion(?:es)?|programas?|pantalla|ventanas?|escritorio|navegador|cuentas?|sesion|"
    r"chats?|buzon|bandeja|equipo|mac|computadora|teams|outlook|whatsapp|slack|discord|telegram|"
    r"gmail|classroom|moodle|claude|chatgpt)\b"
)
_MINE_RE = re.compile(r"\bmis?\b")
_OFFER_RE = re.compile(
    r"\b(?:quieres|prefieres|deseas|te\s+gustaria|te\s+parece\s+si|me\s+dejas)\s+(?:que\s+)?(?:yo\s+)?"
    r"(?:lea|leo|abra|abro|revise|reviso|mire|miro|vea|veo|entre|entro|busque|busco|"
    r"intente\s+(?:leer|abrir|revisar|ver|entrar))"
)
_ACTION_REQUEST_RE = re.compile(
    r"\b(?:revisa\w*|checa\w*|mira\w*|ve|velo|fijate|abre\w*|abrir|entra\w*|lee\w*|busca\w*|encuentra\w*|"
    r"dile\w*|diles|pregunta\w*|escribe\w*|manda\w*|envia\w*|responde\w*|contesta\w*|avisa\w*|publica\w*|"
    r"sube\w*|descarga\w*|haz\w*|pon\w*|quiero\s+que|puedes|podrias|necesito\s+que)\b"
)


def _fold(text: str) -> str:
    plain = unicodedata.normalize("NFD", str(text or "").lower())
    plain = "".join(ch for ch in plain if unicodedata.category(ch) != "Mn")
    return re.sub(r"[ \t]+", " ", re.sub(r"[*_`>#]+", "", plain)).strip()


def _opening_refuses(reply: str) -> bool:
    opening = _fold(reply)[:OPENING_CHARS]
    sentences = [s for s in re.split(r"(?<=[.!?;:])\s+|\n+", opening) if s.strip()]
    for idx, sentence in enumerate(sentences):
        if not _CANNOT_RE.search(sentence):
            continue
        # "No puedo entrar a mi cuenta" es la voz del usuario en un texto redactado para él.
        if _MINE_RE.search(sentence):
            continue
        nearby = " ".join(sentences[idx:idx + 2])
        if _OTHER_APP_RE.search(nearby):
            return True
    return False


def gave_up_on_desktop(reply: str, user_message: str) -> bool:
    """True si la respuesta se niega a operar otra app, u ofrece leerla cuando ya se lo pidieron."""
    if _opening_refuses(reply):
        return True
    folded = _fold(reply)
    return bool(
        _OFFER_RE.search(folded)
        and _OTHER_APP_RE.search(folded)
        and _ACTION_REQUEST_RE.search(_fold(user_message))
    )


def attempted_desktop(tool_records: Iterable[Dict[str, Any]]) -> bool:
    return any(str(rec.get("tool") or "") in DESKTOP_ATTEMPT_TOOLS for rec in tool_records)


DESKTOP_RETRY_LABEL = "Intentándolo en tus apps"

DESKTOP_RETRY_NUDGE = (
    "Contestaste que no puedes, o preguntaste si lo hacías, sin intentar nada. Sí tienes herramientas para ver, "
    "abrir y usar otras apps de este equipo, y ya están cargadas. El permiso lo pide el Guardián con una tarjeta "
    "cuando actúas: no lo pidas por chat. Da AHORA el primer paso con `tool_calls`: `desktop_list_windows` para ver "
    "si la app está abierta, `open_desktop_app` si no lo está, y `read_screen_now(mode=\"window\")` o "
    "`desktop_snapshot` para leerla. No repitas tu respuesta anterior ni ofrezcas opciones. "
    "Solo si la petición no trata de otra app, o es dinero, contraseñas o una app protegida, responde directo en "
    "una o dos frases."
)


class ReplyHold:
    """
    Retiene una respuesta en vivo mientras todavía pueda ser una negativa sin intento.

    Una respuesta normal se suelta a los `FIRST_LOOK_CHARS` caracteres; una que empieza negando,
    al terminar su apertura; y una negativa se queda retenida hasta que el loop decida.
    """

    def __init__(
        self,
        emit: Callable[[str], None],
        on_phase: Callable[[str], None],
        *,
        enabled: bool,
    ) -> None:
        self._emit = emit
        self._on_phase = on_phase
        self._holding = enabled
        self._text = ""
        self._talking_pending = False

    def phase(self, phase: str) -> None:
        # Mientras no se muestre texto, Xox sigue pensando.
        if phase == "talking" and self._holding:
            self._talking_pending = True
            return
        self._on_phase(phase)

    def feed(self, chunk: str) -> None:
        if not self._holding:
            self._emit(chunk)
            return
        self._text += chunk
        seen = len(self._text)
        if seen >= FIRST_LOOK_CHARS and not _NEGATION_RE.search(_fold(self._text)):
            self.release()
        elif seen >= OPENING_CHARS and not _opening_refuses(self._text):
            self.release()

    def replace(self, text: str) -> None:
        """Cambia lo retenido (p. ej. al quitarle marcas internas del proveedor)."""
        if self._holding:
            self._text = text

    def release(self) -> None:
        if not self._holding:
            return
        self._holding = False
        if self._talking_pending:
            self._talking_pending = False
            self._on_phase("talking")
        text, self._text = self._text, ""
        if text:
            self._emit(text)

    def discard(self) -> None:
        self._holding = False
        self._talking_pending = False
        self._text = ""
