"""
Motor local de voz en español basado en Pocket TTS (ONNX INT8).
Cero dependencias Apache-2.0 o GPL: usa únicamente stdlib de Python,
NumPy (BSD-3-Clause) y ONNX Runtime (MIT).
"""

from __future__ import annotations

import gc
import io
import json
import math
import os
import re
import ssl
import struct
import subprocess
import time
import unicodedata
import urllib.request
import wave
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

MODEL_BASE_URL = "https://huggingface.co/KevinAHM/pocket-tts-onnx/resolve/main/onnx/spanish"
VOICE_BASE_URL = "https://huggingface.co/lunahr/pocket-tts-ungated/resolve/main/languages/spanish/embeddings"

CORE_FILES: List[Dict[str, Any]] = [
    {"filename": "bundle.json", "url": f"{MODEL_BASE_URL}/bundle.json", "bytes": 24365, "label": "Configuración de voz"},
    {"filename": "tokenizer.model", "url": f"{MODEL_BASE_URL}/tokenizer.model", "bytes": 60895, "label": "Vocabulario en español"},
    {"filename": "text_conditioner_int8.onnx", "url": f"{MODEL_BASE_URL}/text_conditioner_int8.onnx", "bytes": 16388384, "label": "Procesador de texto"},
    {"filename": "flow_lm_flow_int8.onnx", "url": f"{MODEL_BASE_URL}/flow_lm_flow_int8.onnx", "bytes": 9962530, "label": "Módulo de entonación"},
    {"filename": "mimi_decoder_int8.onnx", "url": f"{MODEL_BASE_URL}/mimi_decoder_int8.onnx", "bytes": 22684077, "label": "Sintetizador de audio"},
    {"filename": "flow_lm_main_int8.onnx", "url": f"{MODEL_BASE_URL}/flow_lm_main_int8.onnx", "bytes": 76341079, "label": "Modelo acústico principal"},
]

VOICE_CATALOG: List[Dict[str, Any]] = [
    {
        "id": "lola",
        "name": "Lola",
        "gender": "femenina",
        "description": "Cálida, expresiva y muy natural",
        "bytes": 5948664,
        "default_bundle": True,
    },
    {
        "id": "rafael",
        "name": "Rafael",
        "gender": "masculina",
        "description": "Clara, firme y equilibrada",
        "bytes": 6194424,
        "default_bundle": True,
    },
    {
        "id": "alba",
        "name": "Alba",
        "gender": "femenina",
        "description": "Suave y profesional",
        "bytes": 6194424,
        "default_bundle": False,
    },
    {
        "id": "estelle",
        "name": "Estelle",
        "gender": "femenina",
        "description": "Cercana y conversacional",
        "bytes": 8258808,
        "default_bundle": False,
    },
    {
        "id": "marius",
        "name": "Marius",
        "gender": "masculina",
        "description": "Profunda y pausada",
        "bytes": 6194424,
        "default_bundle": False,
    },
    {
        "id": "jean",
        "name": "Jean",
        "gender": "masculina",
        "description": "Serena y directa",
        "bytes": 6194424,
        "default_bundle": False,
    },
]

VOICE_BY_ID: Dict[str, Dict[str, Any]] = {v["id"]: v for v in VOICE_CATALOG}


def get_process_rss_mb() -> float:
    try:
        out = subprocess.check_output(
            ["ps", "-o", "rss=", "-p", str(os.getpid())],
            stderr=subprocess.DEVNULL,
        ).decode().strip()
        return round(int(out) / 1024.0, 1)
    except Exception:
        return 0.0


def _read_varint(buf: bytes, i: int) -> Tuple[int, int]:
    shift = 0
    val = 0
    while True:
        b = buf[i]
        i += 1
        val |= (b & 0x7F) << shift
        if not (b & 0x80):
            return val, i
        shift += 7


class PureSentencePieceUnigram:
    """Decodificador y tokenizador Unigram + byte-fallback desde .model protobuf sin dependencias."""

    def __init__(self, model_path: Path) -> None:
        data = model_path.read_bytes()
        i = 0
        self.id_to_piece: List[str] = []
        self.piece_to_id: Dict[str, int] = {}
        self.scores: Dict[str, float] = {}
        self.byte_tokens: Dict[int, int] = {}
        self.unk_id = 0
        self.add_dummy_prefix = True
        self.remove_extra_whitespaces = True

        while i < len(data):
            tag, i = _read_varint(data, i)
            fn, wt = tag >> 3, tag & 7
            if wt == 2:
                ln, i = _read_varint(data, i)
                sub = data[i : i + ln]
                i += ln
                if fn == 1:
                    piece, score, ptype = self._parse_piece(sub)
                    idx = len(self.id_to_piece)
                    self.id_to_piece.append(piece)
                    self.piece_to_id[piece] = idx
                    if ptype == 2:
                        self.unk_id = idx
                    elif ptype == 6 and len(piece) == 6 and piece.startswith("<0x") and piece.endswith(">"):
                        self.byte_tokens[int(piece[3:5], 16)] = idx
                    elif ptype == 1:
                        self.scores[piece] = score
                elif fn == 3:
                    j = 0
                    while j < len(sub):
                        t2, j = _read_varint(sub, j)
                        f2, w2 = t2 >> 3, t2 & 7
                        if w2 == 0:
                            v, j = _read_varint(sub, j)
                            if f2 == 3:
                                self.add_dummy_prefix = bool(v)
                            elif f2 == 4:
                                self.remove_extra_whitespaces = bool(v)
                        elif w2 == 2:
                            l2, j = _read_varint(sub, j)
                            j += l2
                        elif w2 == 5:
                            j += 4
                        elif w2 == 1:
                            j += 8
            elif wt == 0:
                _, i = _read_varint(data, i)
            elif wt == 1:
                i += 8
            elif wt == 5:
                i += 4

        self.max_len = max((len(k) for k in self.scores), default=1)
        self.min_score = min(self.scores.values(), default=-10.0) - 10.0

    @staticmethod
    def _parse_piece(msg: bytes) -> Tuple[str, float, int]:
        i = 0
        piece = ""
        score = 0.0
        ptype = 1
        while i < len(msg):
            tag, i = _read_varint(msg, i)
            fn, wt = tag >> 3, tag & 7
            if wt == 2:
                ln, i = _read_varint(msg, i)
                if fn == 1:
                    piece = msg[i : i + ln].decode("utf-8", errors="replace")
                i += ln
            elif wt == 5:
                if fn == 2:
                    score = struct.unpack("<f", msg[i : i + 4])[0]
                i += 4
            elif wt == 0:
                val, i = _read_varint(msg, i)
                if fn == 3:
                    ptype = val
            elif wt == 1:
                i += 8
        return piece, score, ptype

    def encode(self, text: str) -> List[int]:
        if not text:
            return []
        cleaned = re.sub(r"\s+", " ", text.strip()) if self.remove_extra_whitespaces else text.strip()
        if not cleaned:
            return []
        if self.add_dummy_prefix and not cleaned.startswith(" "):
            cleaned = " " + cleaned
        norm = cleaned.replace(" ", "▁")
        n = len(norm)
        best_score = [-1e30] * (n + 1)
        best_len = [0] * (n + 1)
        best_id = [0] * (n + 1)
        best_fb = [False] * (n + 1)
        best_score[0] = 0.0

        for i in range(n):
            if best_score[i] <= -1e29:
                continue
            matched = False
            limit = min(n, i + self.max_len)
            for j in range(i + 1, limit + 1):
                sub = norm[i:j]
                if sub in self.scores:
                    cand = best_score[i] + self.scores[sub]
                    if cand > best_score[j]:
                        best_score[j] = cand
                        best_len[j] = j - i
                        best_id[j] = self.piece_to_id[sub]
                        best_fb[j] = False
                    if j == i + 1:
                        matched = True
            if not matched:
                cand = best_score[i] + self.min_score
                if cand > best_score[i + 1]:
                    best_score[i + 1] = cand
                    best_len[i + 1] = 1
                    best_id[i + 1] = -1
                    best_fb[i + 1] = True

        tokens: List[int] = []
        pos = n
        while pos > 0:
            ln = best_len[pos]
            if best_fb[pos]:
                ch = norm[pos - 1]
                b_ids = [self.byte_tokens.get(b, self.unk_id) for b in ch.encode("utf-8")]
                tokens.extend(reversed(b_ids))
            else:
                tokens.append(best_id[pos])
            pos -= ln
        tokens.reverse()
        return tokens


_KNOWN_FILE_EXTS: Tuple[str, ...] = (
    # Código y web
    "tsx", "ts", "jsx", "js", "mjs", "cjs", "pyw", "py", "rs", "go", "java", "kt",
    "swift", "cpp", "hpp", "cc", "cs", "rb", "php", "bash", "zsh", "sh", "ps1",
    "bat", "cmd", "lua", "scala", "dart", "vue", "svelte", "astro", "html", "htm",
    "scss", "sass", "less", "css", "sql", "graphql", "gql", "wasm", "proto",
    # Configuración y datos
    "jsonc", "jsonl", "json", "yaml", "yml", "toml", "ini", "cfg", "conf", "env",
    "xml", "plist", "lock", "csv", "tsv", "parquet", "sqlite3", "sqlite", "db",
    "log", "bak", "tmp", "part", "safetensors", "onnx", "gguf", "bin", "dat", "model",
    # Documentos y oficina
    "mdx", "markdown", "md", "txt", "rtf", "pdf", "docx", "doc", "xlsx", "xls",
    "pptx", "ppt", "odt", "ods", "odp", "epub", "tex", "pages", "numbers", "key",
    # Media, archivos e instaladores
    "jpeg", "jpg", "png", "gif", "webp", "svg", "ico", "bmp", "tiff", "heic", "avif",
    "mp3", "wav", "ogg", "flac", "aac", "m4a", "mp4", "mov", "avi", "mkv", "webm",
    "zip", "tar", "tgz", "gz", "bz2", "xz", "7z", "rar", "dmg", "pkg", "app",
    "exe", "msi", "deb", "rpm", "apk", "ipa", "iso", "ttf", "otf", "woff2", "woff",
)
_KNOWN_EXT_SET = set(_KNOWN_FILE_EXTS)
_KNOWN_EXT_PATTERN = "|".join(_KNOWN_FILE_EXTS)

_CLI_COMMAND_HEADS = {
    "npm", "npx", "yarn", "pnpm", "bun", "git", "cargo", "rustc", "rustup",
    "python", "python3", "pip", "pip3", "uv", "node", "deno", "curl", "wget",
    "bash", "zsh", "sh", "cd", "ls", "ll", "rm", "cp", "mv", "mkdir", "touch",
    "cat", "head", "tail", "grep", "rg", "find", "chmod", "chown", "sudo",
    "docker", "kubectl", "gcloud", "bq", "gsutil", "firebase", "supabase",
    "sqlite3", "psql", "mysql", "brew", "tauri", "vite", "tsc", "eslint",
    "prettier", "vitest", "jest", "pytest", "make", "cmake", "ssh", "scp",
    "rsync", "tar", "unzip", "kill", "pkill", "ps", "lsof", "export", "source",
}

_KNOWN_BRAND_CAMEL = {
    "iphone", "ipad", "imac", "icloud", "ios", "macos", "watchos", "tvos",
    "ipados", "ebay", "ebook", "email", "mrna", "javascript", "typescript",
    "github", "gitlab", "openai", "chatgpt", "youtube", "whatsapp", "linkedin",
    "tiktok", "powerpoint", "onedrive", "sharepoint", "wordpress", "postgresql",
    "mysql", "graphql", "nextjs", "nuxtjs", "nodejs", "openrouter", "deepseek",
    "webkit", "playstation", "xbox", "quickbar", "tailwind", "airpods", "macbook",
}

_TECH_PATH_DIR_PREFIXES = {
    "src", "src-ui", "src-brain", "src-tauri", "dist", "build", "public", "assets",
    "scripts", "skills", "slices", "features", "components", "utils", "hooks",
    "config", "docs", "tests", "test", "node_modules", "target", "app", "api",
    "lib", "pkg", "cmd", "internal", "empresa", "habilidades", "context",
    "users", "home", "desktop", "documents", "downloads", "library", "applications",
    "volumes", "var", "tmp", "etc", "opt", "usr",
}

_CODE_PASCAL_SUFFIX_RE = re.compile(
    r"(?:Modal|Panel|View|Card|Client|Store|Worker|Engine|Schema|Helper|Service|Handler|"
    r"Manager|Controller|Provider|Context|Props|State|Config|Utils|Types|Api|Dto|Impl|"
    r"Error|Exception|Hook|Router|Parser|Builder|Factory|Adapter|Guard|Runner|Watcher|"
    r"Overlay|Dialog|Popover|Dropdown|Button|Input|Form|Table|List|Item|Menu|Dock|Tray|"
    r"Track|Session|Snapshot|Payload|Message|Response|Request|Result|Event|Token|Chunk|"
    r"Buffer|Stream|Cache|Index|Registry|Manifest|Element|Node|Tree|Graph|Layer|Backdrop|"
    r"Preview|Editor|Viewer|Reader|Writer|Generator|Loader|Sanitizer|Formatter|Validator|"
    r"Resolver|Executor|Dispatcher|Scheduler|Monitor|Logger|Metrics|Status|Preset|Settings|"
    r"Options|Params|Args)$"
)

_SPANISH_MONTHS = (
    "", "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
)

_FILE_NOUN_RE = (
    r"(?:archivos?|documentos?|ficheros?|reportes?|informes?|scripts?|m[óo]dulos?|"
    r"componentes?|pdfs?|excels?|words?|presentaci[óo]n|presentaciones|hojas?|"
    r"im[áa]genes?|imagen|fotos?|videos?|audios?|contratos?|presupuestos?|facturas?|"
    r"notas?|plantillas?|configuraci[óo]n|configuraciones|registros?|logs?|respaldos?|"
    r"backups?|datasets?|bases?\s+de\s+datos)"
)

_DIR_NOUN_RE = (
    r"(?:carpetas?|directorios?|rutas?|ubicaciones?|ubicaci[óo]n|repositorios?|"
    r"repos?|proyectos?|workspaces?|espacios?)"
)

_CODE_NOUN_RE = (
    r"(?:funci[óo]n|funciones|m[ée]todos?|variables?|par[áa]metros?|propiedades?|"
    r"propiedad|clases?|componentes?|comandos?|s[íi]mbolos?|constantes?|campos?|"
    r"columnas?|eventos?|atributos?|tipos?|interfaz|interfaces|hooks?|objetos?|"
    r"arreglos?|arrays?|expresi[óo]n|expresiones|reglas?|etiquetas?|valores?|valor|"
    r"claves?|llaves?|opci[óo]n|opciones|banderas?|flags?|paquetes?|librer[íi]as?|"
    r"bibliotecas?|dependencias?|endpoints?|commits?|ramas?|branch(?:es)?|"
    r"identificadores?|identificador|c[óo]digos?|nombres?|usuarios?|errores?|error|"
    r"estados?|tablas?|instancias?|sesiones?|sesi[óo]n|colores?|color)"
)

_URL_NOUN_RE = (
    r"(?:enlaces?|links?|p[áa]ginas?|sitios?|direcciones?|direcci[óo]n|urls?|"
    r"correos?|emails?|cuentas?)"
)

_SENTINEL_ANY = r"§(?:FILE|FILES|DIR|DIRS|CODE|CODES|CMD|CMDS|URL|URLS|EMAIL|EMAILS|HANDLE)§"

_ARTICLE_BEFORE_RE = (
    r"(?:el|la|los|las|un|una|unos|unas|este|esta|estos|estas|ese|esa|esos|esas|"
    r"tu|tus|mi|mis|su|sus|nuestro|nuestra|nuestros|nuestras|del|al|otro|otra|"
    r"otros|otras|cada|alg[úu]n|alguna|ning[úu]n|ninguna|dicho|dicha|dichos|dichas)"
)

# Caracteres EXACTOS soportados de forma nativa por tokenizer.model (cero byte-fallback)
_NATIVE_VOCAB_ALLOWED_RE = re.compile(r"[^a-zA-JL-WYáéíóúñ0-9 ,.?¿]")

_FOREIGN_DIACRITICS_MAP = str.maketrans({
    "à": "a", "â": "a", "ä": "a", "ã": "a", "å": "a",
    "À": "a", "Â": "a", "Ä": "a", "Ã": "a", "Å": "a",
    "è": "e", "ê": "e", "ë": "e", "È": "e", "Ê": "e", "Ë": "e",
    "ì": "i", "î": "i", "ï": "i", "Ì": "i", "Î": "i", "Ï": "i",
    "ò": "o", "ô": "o", "ö": "o", "õ": "o", "ø": "o",
    "Ò": "o", "Ô": "o", "Ö": "o", "Õ": "o", "Ø": "o",
    "ù": "u", "û": "u", "ü": "u", "Ù": "u", "Û": "u", "Ü": "u",
    "ç": "s", "Ç": "s", "ý": "y", "ÿ": "y", "Ý": "y",
    "Á": "á", "É": "é", "Í": "í", "Ó": "ó", "Ú": "ú", "Ñ": "ñ",
    "K": "k", "X": "x", "Z": "z",
})

_FEMININE_UNIT_NOUNS = {
    "hora", "horas", "carpeta", "carpetas", "página", "páginas", "línea", "líneas",
    "tabla", "tablas", "semana", "semanas", "libra", "libras", "tarea", "tareas",
    "vez", "veces", "opción", "opciones", "imagen", "imágenes", "foto", "fotos",
    "nota", "notas", "factura", "facturas", "hoja", "hojas", "ruta", "rutas",
    "función", "funciones", "clase", "clases", "variable", "variables", "rama",
    "ramas", "versión", "versiones", "sesión", "sesiones", "lista", "listas",
    "parte", "partes", "persona", "personas", "cuenta", "cuentas", "tarjeta",
    "tarjetas", "ventana", "ventanas", "pestaña", "pestañas", "fila", "filas",
    "columna", "columnas", "celda", "celdas", "palabra", "palabras", "frase",
    "frases", "regla", "reglas", "clave", "claves", "llave", "llaves", "etiqueta",
    "etiquetas", "propiedad", "propiedades", "habilidad", "habilidades", "unidad",
    "unidades", "pieza", "piezas", "copia", "copias", "sección", "secciones",
}

_MASCULINE_UNIT_NOUNS = {
    "archivo", "archivos", "documento", "documentos", "peso", "pesos", "dólar",
    "dólares", "euro", "euros", "centavo", "centavos", "céntimo", "céntimos",
    "año", "años", "mes", "meses", "día", "días", "minuto", "minutos", "segundo",
    "segundos", "milisegundo", "milisegundos", "kilobyte", "kilobytes", "megabyte",
    "megabytes", "gigabyte", "gigabytes", "terabyte", "terabytes", "grado", "grados",
    "kilómetro", "kilómetros", "metro", "metros", "centímetro", "centímetros",
    "kilogramo", "kilogramos", "píxel", "píxeles", "cuadro", "cuadros", "paso",
    "pasos", "punto", "puntos", "cambio", "cambios", "error", "errores", "elemento",
    "elementos", "comando", "comandos", "usuario", "usuarios", "correo", "correos",
    "enlace", "enlaces", "bloque", "bloques", "mensaje", "mensajes", "proyecto",
    "proyectos", "reporte", "reportes", "informe", "informes", "módulo", "módulos",
    "componente", "componentes", "dato", "datos", "registro", "registros", "campo",
    "campos", "parámetro", "parámetros", "valor", "valores", "producto", "productos",
    "artículo", "artículos", "cliente", "clientes", "proveedor", "proveedores",
    "pedido", "pedidos", "por", "ciento",
}


def _int_to_spanish(n: int, *, apocopate: bool = False, feminine: bool = False) -> str:
    """Convierte un entero (0..999_999_999) a palabras en español natural."""
    if n < 0:
        return f"menos {_int_to_spanish(-n, apocopate=apocopate, feminine=feminine)}"
    if n == 0:
        return "cero"

    units = (
        "", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve",
        "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis",
        "diecisiete", "dieciocho", "diecinueve",
    )
    twenties = (
        "veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro",
        "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve",
    )
    tens = (
        "", "", "", "treinta", "cuarenta", "cincuenta",
        "sesenta", "setenta", "ochenta", "noventa",
    )
    hundreds_m = (
        "", "ciento", "doscientos", "trescientos", "cuatrocientos",
        "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos",
    )
    hundreds_f = (
        "", "ciento", "doscientas", "trescientas", "cuatrocientas",
        "quinientas", "seiscientas", "setecientas", "ochocientas", "novecientas",
    )

    if n < 20:
        if n == 1:
            if feminine:
                return "una"
            return "un" if apocopate else "uno"
        return units[n]

    if n < 30:
        if n == 21:
            if feminine:
                return "veintiuna"
            return "veintiún" if apocopate else "veintiuno"
        return twenties[n - 20]

    if n < 100:
        t, u = divmod(n, 10)
        if u == 0:
            return tens[t]
        u_word = _int_to_spanish(u, apocopate=apocopate, feminine=feminine)
        return f"{tens[t]} y {u_word}"

    if n == 100:
        return "cien"

    if n < 1000:
        h, r = divmod(n, 100)
        h_word = hundreds_f[h] if feminine else hundreds_m[h]
        if r == 0:
            return h_word
        return f"{h_word} {_int_to_spanish(r, apocopate=apocopate, feminine=feminine)}"

    if n < 1_000_000:
        q, r = divmod(n, 1000)
        if q == 1:
            prefix = "mil"
        else:
            prefix = f"{_int_to_spanish(q, apocopate=True, feminine=feminine and q % 100 != 1)} mil"
        if r == 0:
            return prefix
        return f"{prefix} {_int_to_spanish(r, apocopate=apocopate, feminine=feminine)}"

    if n < 1_000_000_000:
        q, r = divmod(n, 1_000_000)
        if q == 1:
            prefix = "un millón"
        else:
            prefix = f"{_int_to_spanish(q, apocopate=True)} millones"
        if r == 0:
            return prefix
        return f"{prefix} {_int_to_spanish(r, apocopate=apocopate, feminine=feminine)}"

    return str(n)


def _decimal_digits_to_spanish(dec_str: str) -> str:
    """Convierte la parte decimal a palabras claras (ej. '05' -> 'cero cinco', '5' -> 'cinco')."""
    if not dec_str:
        return ""
    if len(dec_str) <= 2:
        if dec_str.startswith("0") and len(dec_str) == 2:
            return f"cero {_int_to_spanish(int(dec_str[1]))}"
        return _int_to_spanish(int(dec_str))
    # Para decimales largos (ej. 3.1416), leer solo los primeros 2-4 dígitos sin desbordar
    trimmed = dec_str[:4]
    if trimmed.startswith("0"):
        return " ".join(_int_to_spanish(int(d)) for d in trimmed)
    if len(trimmed) <= 3:
        return _int_to_spanish(int(trimmed))
    return f"{_int_to_spanish(int(trimmed[:2]))} {_int_to_spanish(int(trimmed[2:]))}"


def _looks_like_known_filename(value: str) -> bool:
    trimmed = value.strip().strip("\"'«“»”")
    if not trimmed or len(trimmed) > 180:
        return False
    cleaned = re.sub(r"(?::\d+(?::\d+)?|#L\d+(?:-L?\d+)?)$", "", trimmed, flags=re.IGNORECASE)
    if re.fullmatch(
        r"\.(?:env(?:\.[\w-]+)?|gitignore|gitattributes|ds_store|eslintrc(?:\.\w+)?|"
        r"prettierrc(?:\.\w+)?|babelrc|npmrc|nvmrc|editorconfig|dockerignore|bashrc|zshrc|profile|xook)",
        cleaned,
        flags=re.IGNORECASE,
    ):
        return True
    m = re.search(r"\.([A-Za-z0-9]{2,11})$", cleaned)
    return bool(m and m.group(1).lower() in _KNOWN_EXT_SET)


def _looks_like_path(value: str) -> bool:
    t = value.strip()
    if not t or "  " in t:
        return False
    if re.match(r"^(?:file://|/|~/|\.\.?/|[A-Za-z]:\\)", t, flags=re.IGNORECASE):
        return True
    if "\\" in t and re.search(r"[A-Za-z0-9._-]\\[A-Za-z0-9._-]", t):
        return True
    slash_parts = [p for p in t.split("/") if p]
    if len(slash_parts) >= 3 and not re.search(r"\s", t):
        return True
    if len(slash_parts) == 2 and not re.search(r"\s", t):
        first, second = slash_parts
        if (
            first.startswith(".")
            or first.startswith("@")
            or first.lower() in _TECH_PATH_DIR_PREFIXES
            or _looks_like_known_filename(second)
            or ("_" in first or "-" in first)
            or ("_" in second or "." in second)
        ):
            return True
    return False


def _looks_like_url(value: str) -> bool:
    t = value.strip()
    return bool(
        re.match(
            r"^(?:https?://|ftp://|wss?://|www\.|localhost(?::\d+)?(?:/|$)|127\.0\.0\.1(?::\d+)?(?:/|$)|"
            r"(?:github\.com|gitlab\.com|huggingface\.co|npmjs\.com|docs\.rs|vercel\.com)/)",
            t,
            flags=re.IGNORECASE,
        )
    )


def _looks_like_email(value: str) -> bool:
    return bool(
        re.fullmatch(r"(?:mailto:)?[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", value.strip(), flags=re.IGNORECASE)
    )


def _is_code_identifier_token(token: str) -> bool:
    t = token.strip()
    if not t or t.lower() in _KNOWN_BRAND_CAMEL:
        return False
    if re.fullmatch(r"[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+", t):
        return True
    if re.fullmatch(r"[a-z]+[A-Z][A-Za-z0-9]*", t):
        return True
    if re.fullmatch(r"[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+){2,}", t):
        return True
    if re.fullmatch(r"[A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*", t) and _CODE_PASCAL_SUFFIX_RE.search(t):
        return True
    if re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", t, flags=re.IGNORECASE):
        return True
    if re.fullmatch(r"0x[0-9a-f]+|#[0-9a-f]{3,8}", t, flags=re.IGNORECASE):
        return True
    if re.fullmatch(r"[0-9a-f]{7,40}", t) and re.search(r"[0-9]", t) and re.search(r"[a-f]", t):
        return True
    if re.fullmatch(r"[a-z_][A-Za-z0-9_]*\.[a-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*", t):
        return True
    if re.fullmatch(r"[A-Za-z_]\w*(?:::[A-Za-z_]\w*)+", t):
        return True
    return False


def _classify_inline_code(content: str) -> str:
    t = content.strip()
    if not t:
        return ""
    if _looks_like_url(t):
        return "§URL§"
    if _looks_like_email(t):
        return "§EMAIL§"
    if re.match(r"^file://", t, flags=re.IGNORECASE):
        return "§DIR§" if t.endswith("/") else "§FILE§"
    if _looks_like_path(t):
        if t.endswith("/") or t.endswith("\\"):
            return "§DIR§"
        last_seg = [p for p in re.split(r"[/\\]", t) if p][-1]
        return "§FILE§" if _looks_like_known_filename(last_seg) else "§DIR§"
    if _looks_like_known_filename(t):
        return "§FILE§"

    first_word = t.split()[0].lower()
    if first_word in _CLI_COMMAND_HEADS and (" " in t or "-" in t or len(t) <= 8):
        return "§CMD§"
    if re.fullmatch(r"--?[a-zA-Z][\w-]*(?:=\S+)?", t):
        return "§CMD§"
    if re.search(r"[_{}\[\]()<>\\|~$^*=;]|->|=>|::|&&|\|\||!=|==", t):
        return "§CODE§"
    if re.fullmatch(r"[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+", t) and not re.fullmatch(r"wi-fi", t, flags=re.IGNORECASE):
        parts = t.lower().split("-")
        if len(parts) >= 3 or re.search(r"\d", t) or parts[0] in _TECH_PATH_DIR_PREFIXES or any(p in _KNOWN_EXT_SET for p in parts):
            return "§CODE§"
    if " " not in t and _is_code_identifier_token(t):
        return "§CODE§"
    words = t.split()
    if len(words) >= 2 and any(
        _is_code_identifier_token(w) or _looks_like_known_filename(w) or _looks_like_path(w)
        for w in words
    ):
        return "§CODE§"
    return t


def _split_trailing_punct(raw: str) -> Tuple[str, str]:
    m = re.search(r"([.,;:!?]+)$", raw)
    if not m:
        return raw, ""
    return raw[: -len(m.group(1))], m.group(1)


def _classify_path_match(raw: str) -> str:
    core, trail = _split_trailing_punct(raw)
    if not core:
        return raw
    if core.endswith("/") or core.endswith("\\"):
        return f"§DIR§{trail}"
    parts = [p for p in re.split(r"[/\\]", core) if p]
    last_seg = parts[-1] if parts else ""
    return f"{'§FILE§' if _looks_like_known_filename(last_seg) else '§DIR§'}{trail}"


def _strip_unicode_symbols_and_emojis(text: str) -> str:
    """Elimina emojis, pictogramas y símbolos Unicode no pronunciables."""
    out: List[str] = []
    for ch in text:
        if ch in "§,.?¿¡!:;-–—()[]/\"'«»“”‘’%+$€£°×÷±≈~=#@*_&<>|\\`^\n\r\t ":
            out.append(ch)
            continue
        cat = unicodedata.category(ch)
        if cat in ("So", "Sk", "Cs", "Cf", "Co", "Cn"):
            out.append(" ")
            continue
        out.append(ch)
    return "".join(out)


def _is_pure_sentinel_line(line: str) -> bool:
    rest = re.sub(r"^\s*(?:[-*•▪▫▸▹◆◇■□✓✔✕✖→➜➡]+|\d+[.)])\s+", "", line)
    rest = rest.replace("**", "").replace("__", "").replace("~~", "")
    rest = re.sub(
        r"\(\s*\d+(?:[.,]\d+)?\s*(?:B|KB|MB|GB|TB|bytes?|líneas?|págs?|páginas?)\s*\)",
        "",
        rest,
        flags=re.IGNORECASE,
    )
    rest = re.sub(r"\(\s*(?:L\d+(?:\s*[-–]\s*L?\d+)?|#L\d+(?:-L?\d+)?)\s*\)", "", rest, flags=re.IGNORECASE)
    rest = _strip_unicode_symbols_and_emojis(rest).strip()
    if not rest or not re.search(_SENTINEL_ANY, rest):
        return False
    without = re.sub(_SENTINEL_ANY, "", rest)
    without = re.sub(
        r"\b(?:y|e|o|u|ok|listo|nuevo|editado|modificado|creado|eliminado|actualizado)\b",
        "",
        without,
        flags=re.IGNORECASE,
    )
    without = re.sub(r"[\s,.;:()\[\]—–\-/|]+", "", without)
    return len(without) == 0


def _replace_markdown_tables(text: str) -> str:
    lines = text.splitlines()
    out: List[str] = []
    i = 0

    def is_sep(ln: str) -> bool:
        return bool(re.fullmatch(r"\s*\|?[\s:|-]+\|[\s:|-]*", ln) and "-" in ln)

    def is_pipe_row(ln: str) -> bool:
        s = ln.strip()
        return "|" in s and (s.startswith("|") or s.endswith("|") or s.count("|") >= 2)

    while i < len(lines):
        cur = lines[i]
        nxt = lines[i + 1] if i + 1 < len(lines) else ""
        if is_pipe_row(cur) and is_sep(nxt):
            i += 2
            while i < len(lines) and is_pipe_row(lines[i]):
                i += 1
            out.append("§TABLE§")
            continue
        if is_sep(cur):
            i += 1
            continue
        out.append(cur)
        i += 1

    return "\n".join(out)


def _resolve_sentinels_spanish(text: str) -> str:
    text = re.sub(r"§FILE§(?:\s*(?:,|y|e|o|u|ni(?:\s+en)?)\s*§FILE§)+", "§FILES§", text, flags=re.IGNORECASE)
    text = re.sub(r"§DIR§(?:\s*(?:,|y|e|o|u|ni(?:\s+en)?)\s*§DIR§)+", "§DIRS§", text, flags=re.IGNORECASE)
    text = re.sub(r"§CODE§(?:\s*(?:,|y|e|o|u|ni(?:\s+en)?)\s*§CODE§)+", "§CODES§", text, flags=re.IGNORECASE)
    text = re.sub(r"§CMD§(?:\s*(?:,|y|e|o|u|ni(?:\s+en)?)\s*§CMD§)+", "§CMDS§", text, flags=re.IGNORECASE)
    text = re.sub(r"§URL§(?:\s*(?:,|y|e|o|u|ni(?:\s+en)?)\s*§URL§)+", "§URLS§", text, flags=re.IGNORECASE)
    text = re.sub(r"§EMAIL§(?:\s*(?:,|y|e|o|u|ni(?:\s+en)?)\s*§EMAIL§)+", "§EMAILS§", text, flags=re.IGNORECASE)
    text = re.sub(r"§(?:FILE|DIR)§(?:\s*(?:,|y|e|o|u)\s*§(?:FILE|DIR|FILES|DIRS)§)+", "§FILES§", text, flags=re.IGNORECASE)
    text = re.sub(r"§(?:CODE|CMD)§(?:\s*(?:,|y|e|o|u)\s*§(?:CODE|CMD|CODES|CMDS)§)+", "§CODES§", text, flags=re.IGNORECASE)

    # Quitar paréntesis que solo contienen sentinels técnicos: "(pocket_es.py)" -> ""
    text = re.sub(
        rf"\(\s*{_SENTINEL_ANY}(?:\s*(?:,|y|o|;)\s*{_SENTINEL_ANY})*\s*\)",
        " ",
        text,
        flags=re.IGNORECASE,
    )

    text = re.sub(rf"\bse\s+llama\s+{_SENTINEL_ANY}", "está en pantalla", text, flags=re.IGNORECASE)

    def _llamado_repl(m: re.Match[str]) -> str:
        low = m.group(1).lower()
        if low == "llamada":
            return "indicada en pantalla"
        if low == "llamados":
            return "indicados en pantalla"
        if low == "llamadas":
            return "indicadas en pantalla"
        return "indicado en pantalla"

    text = re.sub(rf"\b(llamad[oa]s?)\s+{_SENTINEL_ANY}", _llamado_repl, text, flags=re.IGNORECASE)

    # Deduplicar con sustantivo inmediatamente anterior
    text = re.sub(rf"\b({_FILE_NOUN_RE})\s*:?\s*§FILES?§", r"\1", text, flags=re.IGNORECASE)
    text = re.sub(rf"\b({_DIR_NOUN_RE})\s*:?\s*§(?:DIRS?|FILES?)§", r"\1", text, flags=re.IGNORECASE)
    text = re.sub(rf"\b({_CODE_NOUN_RE})\s*:?\s*§(?:CODES?|CMDS?|HANDLE)§", r"\1", text, flags=re.IGNORECASE)
    text = re.sub(rf"\b({_URL_NOUN_RE})\s*:?\s*§(?:URLS?|EMAILS?)§", r"\1", text, flags=re.IGNORECASE)

    text = re.sub(r"\b(ejecut[éeaá]\w*|corr[íie]\w*|lanz[éeaá]\w*|usa(?:r|ndo)?)\s+§CODE§", r"\1 §CMD§", text, flags=re.IGNORECASE)
    text = re.sub(r"\b(ejecut[éeaá]\w*|corr[íie]\w*|lanz[éeaá]\w*|usa(?:r|ndo)?)\s+§CODES§", r"\1 §CMDS§", text, flags=re.IGNORECASE)

    def _replace_with_article(src: str, sentinel: str, without_art: str, with_art: str) -> str:
        src = re.sub(rf"\b({_ARTICLE_BEFORE_RE})\s+{sentinel}", rf"\1 {without_art}", src, flags=re.IGNORECASE)
        return src.replace(sentinel, with_art)

    text = _replace_with_article(text, "§FILE§", "archivo", "el archivo")
    text = _replace_with_article(text, "§FILES§", "archivos indicados", "los archivos indicados")
    text = _replace_with_article(text, "§DIR§", "carpeta indicada", "la carpeta indicada")
    text = _replace_with_article(text, "§DIRS§", "carpetas indicadas", "las carpetas indicadas")
    text = _replace_with_article(text, "§CMD§", "comando", "el comando")
    text = _replace_with_article(text, "§CMDS§", "comandos en pantalla", "los comandos en pantalla")
    text = _replace_with_article(text, "§CODE§", "código indicado", "el código indicado")
    text = _replace_with_article(text, "§CODES§", "elementos en pantalla", "los elementos en pantalla")
    text = _replace_with_article(text, "§URL§", "enlace en pantalla", "el enlace en pantalla")
    text = _replace_with_article(text, "§URLS§", "enlaces en pantalla", "los enlaces en pantalla")
    text = _replace_with_article(text, "§EMAIL§", "correo indicado", "el correo indicado")
    text = _replace_with_article(text, "§EMAILS§", "correos indicados", "los correos indicados")
    text = _replace_with_article(text, "§HANDLE§", "usuario indicado", "el usuario indicado")

    text = re.sub(r"(?:§CODEBLOCK§\s*){2,}", "§CODEBLOCK§ ", text)
    text = re.sub(r"(?:§TABLE§\s*){2,}", "§TABLE§ ", text)
    text = re.sub(r"(?:§LIST_ON_SCREEN§\s*){2,}", "§LIST_ON_SCREEN§ ", text)

    text = text.replace("§CODEBLOCK§", "Consulta el código en pantalla.")
    text = text.replace("§TABLE§", "Consulta la tabla en pantalla.")
    text = text.replace("§LIST_ON_SCREEN§", "Puedes ver la lista en pantalla.")

    text = re.sub(r"\bde el\b", "del", text)
    text = re.sub(r"\bDe el\b", "Del", text)
    text = re.sub(r"\ba el\b", "al", text)
    text = re.sub(r"\bA el\b", "Al", text)
    text = re.sub(r"\b(el|la|los|las|en|de)\s+\1\b", r"\1", text, flags=re.IGNORECASE)
    text = re.sub(r"(en pantalla)\s*[,.]?\s*\1", r"\1", text, flags=re.IGNORECASE)
    return text


def _format_currency_spanish(text: str) -> str:
    def _build(int_raw: str, dec_raw: Optional[str], sing: str, plur: str, cent_unit: str, *, feminine: bool = False) -> str:
        n = int(int_raw.replace(",", ""))
        if n >= 1_000_000_000:
            return f"{n} {plur}"
        unit = sing if n == 1 else plur
        int_words = _int_to_spanish(n, apocopate=not feminine, feminine=feminine)
        if dec_raw and len(dec_raw) <= 2 and int(dec_raw) > 0:
            cents = int(dec_raw + "0") if len(dec_raw) == 1 else int(dec_raw)
            cent_words = _int_to_spanish(cents, apocopate=True)
            return f"{int_words} {unit} con {cent_words} {cent_unit}"
        if dec_raw and len(dec_raw) > 2 and int(dec_raw) > 0:
            return f"{int_words} punto {_decimal_digits_to_spanish(dec_raw)} {plur}"
        return f"{int_words} {unit}"

    num_p = r"(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?"
    text = re.sub(
        rf"(?:US\$\s*|\$\s*){num_p}\s*(?:USD|d[óo]lares?)\b",
        lambda m: _build(m.group(1), m.group(2), "dólar", "dólares", "centavos"),
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        rf"US\$\s*{num_p}",
        lambda m: _build(m.group(1), m.group(2), "dólar", "dólares", "centavos"),
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        rf"\$\s*{num_p}\s*(?:MXN|pesos?)\b",
        lambda m: _build(m.group(1), m.group(2), "peso", "pesos", "centavos"),
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        rf"\$\s*{num_p}",
        lambda m: _build(m.group(1), m.group(2), "peso", "pesos", "centavos"),
        text,
    )
    text = re.sub(
        rf"€\s*{num_p}",
        lambda m: _build(m.group(1), m.group(2), "euro", "euros", "céntimos"),
        text,
    )
    text = re.sub(
        rf"{num_p}\s*(?:€|EUR)\b",
        lambda m: _build(m.group(1), m.group(2), "euro", "euros", "céntimos"),
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        rf"£\s*{num_p}",
        lambda m: _build(m.group(1), m.group(2), "libra", "libras", "peniques", feminine=True),
        text,
    )
    return text


def _convert_numbers_to_spanish_words(text: str) -> str:
    """Convierte números cardinales, decimales y largos a español natural para evitar tropiezos acústicos."""
    # Decimales remanentes: 3.14 -> tres punto catorce
    def _dec_repl(m: re.Match[str]) -> str:
        int_v = int(m.group(1))
        if int_v >= 1_000_000_000:
            return f"{m.group(1)} punto {_decimal_digits_to_spanish(m.group(2))}"
        return f"{_int_to_spanish(int_v)} punto {_decimal_digits_to_spanish(m.group(2))}"

    text = re.sub(r"\b(\d+)\.(\d+)\b", _dec_repl, text)

    # Números enteros con género/apócope según el sustantivo siguiente
    def _int_repl(m: re.Match[str]) -> str:
        raw_num = m.group(1)
        next_word = (m.group(2) or "").lower()
        # Evitar leer timestamps o IDs opacos de 9+ dígitos
        if len(raw_num) >= 10:
            return "el número indicado"
        val = int(raw_num)
        if val >= 1_000_000_000:
            return "el número indicado"
        fem = next_word in _FEMININE_UNIT_NOUNS
        apoc = next_word in _MASCULINE_UNIT_NOUNS
        word = _int_to_spanish(val, apocopate=apoc, feminine=fem)
        return f"{word}{m.group(0)[len(raw_num):]}"

    text = re.sub(r"\b(\d+)(?:\s+([A-Za-zÁÉÍÓÚáéíóúñÑ]+))?", _int_repl, text)
    return text


def _normalize_spanish_vocab_chars(text: str) -> str:
    """Normaliza puntuación y garantiza 100% caracteres nativos del vocabulario (cero byte-fallback)."""
    text = text.replace("¡", "")
    # Evita cortes bruscos en saludos o exclamaciones cortas ("Hola! ..." -> "Hola, ...")
    text = re.sub(r"(^|[.?]\s+)([^\s.?!]{1,20})!\s+", r"\1\2, ", text)
    text = text.replace("!", ".")
    text = text.replace("...", ".").replace("…", ".")
    text = text.replace(";", ",").replace(":", ",")
    text = text.replace("—", ", ").replace("–", ", ")
    text = re.sub(r"\s+-\s+", ", ", text)
    text = text.replace("(", ", ").replace(")", ", ")
    text = text.replace("[", ", ").replace("]", ", ")
    for q in ('"', "'", "“", "”", "‘", "’", "«", "»", "`"):
        text = text.replace(q, "")

    # Siglas en MAYÚSCULAS que contienen K, X o Z: pasar toda la sigla a minúsculas para evitar "Ok" / "ONNx"
    text = re.sub(
        r"\b[A-Z]{2,8}\b",
        lambda m: m.group(0).lower() if any(c in "KXZ" for c in m.group(0)) else m.group(0),
        text,
    )

    text = text.translate(_FOREIGN_DIACRITICS_MAP)

    # Eliminar cualquier carácter fuera del vocabulario nativo de tokenizer.model
    text = _NATIVE_VOCAB_ALLOWED_RE.sub(" ", text)

    # Garantizar cero puntos pegados en medio de palabras (rompen el EOS de Pocket TTS)
    text = re.sub(r"([a-zA-JL-WYáéíóúñ])\.([A-JL-WY][a-záéíóúñ])", r"\1. \2", text)
    text = re.sub(r"([a-zA-JL-WYáéíóúñ0-9])\.+([a-zA-JL-WYáéíóúñ0-9])", r"\1 \2", text)

    text = re.sub(r",\s*,+", ",", text)
    text = re.sub(r"\.\s*\.+", ".", text)
    text = re.sub(r",\s*\.", ".", text)
    text = re.sub(r"\.\s*,", ".", text)
    text = re.sub(r"^\s*[,.?]+\s*", "", text)
    text = re.sub(r"\s+([,.?])", r"\1", text)
    text = re.sub(r"¿\s+", "¿", text)
    text = re.sub(r"\s+", " ", text).strip()

    if not re.search(r"[a-zA-JL-WYáéíóúñ0-9]", text):
        return ""
    return text


def prepare_spoken_text(raw: str) -> str:
    """Convierte respuestas en Markdown a español limpio y natural apto para Pocket TTS."""
    text = raw or ""

    # 1. Bloques ocultos de razonamiento / protocolo y etiquetas HTML
    text = re.sub(
        r"<(?:think|thought|analysis|analisis|canvas|lienzo|acciones|actions)\b[^>]*>[\s\S]*?"
        r"</(?:think|thought|analysis|analisis|canvas|lienzo|acciones|actions)>",
        " ",
        text,
        flags=re.IGNORECASE,
    )
    text = (
        text.replace("&nbsp;", " ")
        .replace("&amp;", " y ")
        .replace("&lt;", " ")
        .replace("&gt;", " ")
        .replace("&quot;", "")
        .replace("&#39;", "")
        .replace("&apos;", "")
        .replace("&mdash;", ", ")
        .replace("&ndash;", ", ")
        .replace("&hellip;", ".")
    )
    text = re.sub(r"</?[a-zA-Z][a-zA-Z0-9-]*(?:\s+[^<>]*)?>", " ", text)

    # 2. Bloques de código cercados y tablas Markdown
    text = re.sub(r"```[\s\S]*?```", "\n§CODEBLOCK§\n", text)
    text = re.sub(r"~~~[\s\S]*?~~~", "\n§CODEBLOCK§\n", text)
    text = _replace_markdown_tables(text)

    # 3. Imágenes y enlaces Markdown
    text = re.sub(r"!\[[^\]]*\]\([^)]+\)", "", text)

    def _md_link_repl(m: re.Match[str]) -> str:
        label = m.group(1).strip().strip("`")
        target = m.group(2).strip()
        if re.match(r"^file://", target, flags=re.IGNORECASE) or _looks_like_path(label) or _looks_like_known_filename(label):
            return "§DIR§" if (target.endswith("/") or label.endswith("/")) else "§FILE§"
        if _looks_like_url(label):
            return "§URL§"
        if _looks_like_email(label):
            return "§EMAIL§"
        if " " not in label and _is_code_identifier_token(label):
            return "§CODE§"
        return label

    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", _md_link_repl, text)

    # 4. Código inline entre backticks
    def _inline_code_repl(m: re.Match[str]) -> str:
        classified = _classify_inline_code(m.group(1))
        return f" {classified} " if classified else " "

    text = re.sub(r"`([^`\n]+)`", _inline_code_repl, text)
    text = text.replace("`", "")

    # 5. URLs, correos, rutas y nombres de archivo sin backticks
    text = re.sub(r"file:///[^\s,;()\[\]{}\"'<>]+", lambda m: _classify_path_match(m.group(0)), text, flags=re.IGNORECASE)
    text = re.sub(
        r"(?:https?|ftp|wss?)://[^\s,;()\[\]{}\"'<>]+",
        lambda m: f"§URL§{_split_trailing_punct(m.group(0))[1]}",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"mailto:[^\s,;()\[\]{}\"'<>]+",
        lambda m: f"§EMAIL§{_split_trailing_punct(m.group(0))[1]}",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"\bwww\.[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:/[^\s,;()\[\]{}\"'<>]*)?",
        lambda m: f"§URL§{_split_trailing_punct(m.group(0))[1]}",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(?:/[^\s,;()\[\]{}\"'<>]*)?",
        lambda m: f"§URL§{_split_trailing_punct(m.group(0))[1]}",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"\b(?:github\.com|gitlab\.com|huggingface\.co|npmjs\.com|docs\.rs|vercel\.com)/[^\s,;()\[\]{}\"'<>]+",
        lambda m: f"§URL§{_split_trailing_punct(m.group(0))[1]}",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b", "§EMAIL§", text)

    # Paquetes scoped y menciones (@tauri-apps/api, @usuario)
    text = re.sub(
        r"(?<!\w)@[A-Za-z0-9._-]+/[A-Za-z0-9._/-]+",
        lambda m: f"§CODE§{_split_trailing_punct(m.group(0))[1]}",
        text,
    )
    text = re.sub(r"(?<!\w)@[A-Za-z0-9_.-]{2,}\b", "§HANDLE§", text)

    # Archivos entrecomillados con espacios ("Reporte de Ventas 2026.pdf")
    text = re.sub(
        rf'["\'«“]([^"\'»”\n]{{1,120}}\.(?:{_KNOWN_EXT_PATTERN}))["\'»”]',
        "§FILE§",
        text,
        flags=re.IGNORECASE,
    )

    # Rutas Windows y Unix/macOS absolutas, home y relativas
    text = re.sub(r"\b[A-Za-z]:\\[^\s,;()\[\]{}\"'<>]+", lambda m: _classify_path_match(m.group(0)), text)
    text = re.sub(
        r"(?<![\w/:])(?:~/|\.\.?/|/(?:Users|home|var|tmp|etc|opt|usr|Applications|Library|System|Volumes|Desktop|Documents|Downloads|src|dist|app|api)/)[A-Za-z0-9._@+/-]+(?::\d+(?::\d+)?)?(?:#L\d+(?:-L?\d+)?)?",
        lambda m: _classify_path_match(m.group(0)),
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"(?<![\w/])\.?[A-Za-z0-9_-]+(?:/[A-Za-z0-9._-]+){2,}(?::\d+(?::\d+)?)?(?:#L\d+(?:-L?\d+)?)?/?",
        lambda m: _classify_path_match(m.group(0)),
        text,
    )
    text = re.sub(
        rf"(?<![\w/])\.?[A-Za-z0-9_-]+/[A-Za-z0-9._-]+\.(?:{_KNOWN_EXT_PATTERN})(?::\d+(?::\d+)?)?(?:#L\d+(?:-L?\d+)?)?(?![\w/])",
        "§FILE§",
        text,
        flags=re.IGNORECASE,
    )

    def _one_slash_tech_repl(m: re.Match[str]) -> str:
        core, trail = _split_trailing_punct(m.group(0))
        parts = [p for p in core.split("/") if p]
        last_seg = parts[-1] if parts else ""
        if _looks_like_known_filename(last_seg):
            return f"§FILE§{trail}"
        if re.match(r"^(?:feat|fix|chore|docs|refactor)/", core, flags=re.IGNORECASE):
            return f"§CODE§{trail}"
        return f"§DIR§{trail}"

    text = re.sub(
        r"(?<![\w/])(?:\.[A-Za-z0-9_-]+|(?:src-[a-z]+|src|dist|scripts|skills|slices|features|components|utils|config|assets|public|node_modules|target|feat|fix|chore|docs|refactor))/[A-Za-z0-9._-]+/?",
        _one_slash_tech_repl,
        text,
        flags=re.IGNORECASE,
    )

    # Dotfiles y nombres de archivo sueltos con extensión conocida
    text = re.sub(
        r"(?<![\w/])\.(?:env(?:\.[A-Za-z0-9_-]+)?|gitignore|gitattributes|DS_Store|eslintrc(?:\.[A-Za-z]+)?|prettierrc(?:\.[A-Za-z]+)?|babelrc|npmrc|nvmrc|editorconfig|dockerignore|bashrc|zshrc|profile|xook)\b",
        "§FILE§",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        rf"(?<![\w/.])[A-Za-z0-9][A-Za-z0-9._-]*\.(?:{_KNOWN_EXT_PATTERN})(?::\d+(?::\d+)?)?(?:#L\d+(?:-L?\d+)?)?(?![\w/])",
        "§FILE§",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(r"\(\s*#?L\d+(?:\s*[-–]\s*L?\d+)?\s*\)", " ", text, flags=re.IGNORECASE)

    # 6. Identificadores técnicos, hashes, llamadas a función y flags fuera de backticks
    text = re.sub(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", "§CODE§", text, flags=re.IGNORECASE)
    text = re.sub(r"\b0x[0-9a-f]{2,}\b", "§CODE§", text, flags=re.IGNORECASE)
    text = re.sub(r"(?<!\w)#[0-9a-f]{3,8}\b", "§CODE§", text, flags=re.IGNORECASE)
    text = re.sub(r"\b(?=[0-9a-f]*[0-9])(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b", "§CODE§", text)
    text = re.sub(r"\b[A-Za-z_][A-Za-z0-9_.]*\(\s*\)", "§CODE§", text)
    text = re.sub(
        r"\b(?:[a-z]+[A-Z][A-Za-z0-9]*|[A-Za-z0-9]+_[A-Za-z0-9_]+|[a-z_]\w*\.[a-z_]\w*)\([^)\n]{0,60}\)",
        "§CODE§",
        text,
    )
    text = re.sub(r"\b[A-Za-z_]\w*(?:::[A-Za-z_]\w*)+\b", "§CODE§", text)
    text = re.sub(r"(?<!\w)--[a-zA-Z][a-zA-Z0-9-]*(?:=\S+)?\b", "§CMD§", text)
    text = re.sub(
        r"\b[a-z_][A-Za-z0-9_]*\.[a-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*\b",
        lambda m: m.group(0) if re.fullmatch(r"e\.g|i\.e|p\.ej|a\.m|p\.m", m.group(0), flags=re.IGNORECASE) else "§CODE§",
        text,
    )
    text = re.sub(r"\b[A-Z]{2,}(?:_[A-Z0-9]+)+\b", "§CODE§", text)
    text = re.sub(r"\b[a-z0-9]+(?:_[a-z0-9]+)+\b", "§CODE§", text, flags=re.IGNORECASE)
    text = re.sub(
        r"\b[a-z]+[A-Z][A-Za-z0-9]*\b",
        lambda m: m.group(0) if m.group(0).lower() in _KNOWN_BRAND_CAMEL else "§CODE§",
        text,
    )

    def _pascal_repl(m: re.Match[str]) -> str:
        tok = m.group(0)
        if tok.lower() in _KNOWN_BRAND_CAMEL:
            return tok
        humps = re.findall(r"[A-Z][a-z0-9]+", tok)
        if len(humps) >= 3 or _CODE_PASCAL_SUFFIX_RE.search(tok):
            return "§CODE§"
        return tok

    text = re.sub(r"\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+){1,}\b", _pascal_repl, text)

    # 7. Procesamiento por líneas: encabezados, viñetas, listas puras de archivos y pausas
    processed_lines: List[str] = []
    skipped_pure_items = False

    def _flush_pure_list() -> None:
        nonlocal skipped_pure_items
        if not skipped_pure_items:
            return
        skipped_pure_items = False
        prev = processed_lines[-1] if processed_lines else ""
        if not re.search(r"en pantalla[.!?]?$", prev.strip(), flags=re.IGNORECASE):
            processed_lines.append("§LIST_ON_SCREEN§")

    for raw_line in text.splitlines():
        s = raw_line.strip()
        if not s:
            _flush_pure_list()
            continue
        if re.fullmatch(r"[-*_]{3,}", s):
            _flush_pure_list()
            continue
        if s in ("§CODEBLOCK§", "§TABLE§"):
            _flush_pure_list()
            processed_lines.append(s)
            continue

        is_heading = bool(re.match(r"^#{1,6}\s+", s))
        is_list_item = bool(re.match(r"^(?:[-*•▪▫▸▹◆◇■□✓✔✕✖→➜➡]+|\d+[.)])\s+", s))

        if is_list_item and _is_pure_sentinel_line(s):
            skipped_pure_items = True
            continue

        _flush_pure_list()

        s = re.sub(r"^#{1,6}\s+", "", s)
        s = re.sub(r"^>\s*", "", s)
        s = re.sub(r"^(?:[-*•▪▫▸▹◆◇■□✓✔✕✖→➜➡]+|\d+[.)])\s+", "", s)
        s = re.sub(rf"^[*_]*\s*{_SENTINEL_ANY}\s*[*_]*\s*(?::|—|–|-)\s*(.+)$", r"\1", s, flags=re.IGNORECASE)

        if not is_heading and _is_pure_sentinel_line(s) and processed_lines:
            skipped_pure_items = True
            continue

        s = re.sub(r"\|+", ", ", s)

        if (is_heading or is_list_item) and s:
            if s.endswith(":"):
                s = s[:-1] + "."
            elif s[-1] not in ".!?…,;":
                s = s + "."

        processed_lines.append(s)
    _flush_pure_list()

    joined = " ".join(processed_lines)

    # 8. Resolver sentinels con gramática española natural
    joined = _resolve_sentinels_spanish(joined)

    # 9. Formato Markdown residual
    joined = joined.replace("**", "").replace("__", "").replace("~~", "")
    joined = re.sub(r"(?<!\w)[*_]([^*_]+)[*_](?!\w)", r"\1", joined)
    joined = re.sub(r"[-_]{3,}", " ", joined)

    # 10. Fechas, horas, moneda, versiones, porcentajes, unidades, abreviaturas y símbolos
    def _iso_date_repl(m: re.Match[str]) -> str:
        yr, mo, dy = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if 1 <= mo <= 12 and 1 <= dy <= 31:
            return f"{_int_to_spanish(dy)} de {_SPANISH_MONTHS[mo]} de {_int_to_spanish(yr)}"
        return m.group(0)

    def _dmy_date_repl(m: re.Match[str]) -> str:
        dy, mo, yr = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if 1 <= mo <= 12 and 1 <= dy <= 31:
            return f"{_int_to_spanish(dy)} de {_SPANISH_MONTHS[mo]} de {_int_to_spanish(yr)}"
        return m.group(0)

    joined = re.sub(r"\b((?:19|20)\d{2})-(\d{2})-(\d{2})\b", _iso_date_repl, joined)
    joined = re.sub(r"\b(\d{1,2})[/-](\d{1,2})[/-]((?:19|20)\d{2})\b", _dmy_date_repl, joined)

    def _time_repl(m: re.Match[str]) -> str:
        hh, mm = int(m.group(1)), int(m.group(2))
        mer = m.group(3)
        if hh > 23 or mm > 59:
            return m.group(0)
        suffix = ""
        if mer:
            suffix = " de la mañana" if mer.strip().lower().startswith("a") else " de la tarde"
        h_word = "una" if hh == 1 else _int_to_spanish(hh)
        if mm == 0:
            return f"{h_word} en punto{suffix}"
        if mm == 30 and hh <= 12:
            return f"{h_word} y media{suffix}"
        return f"{h_word} con {_int_to_spanish(mm)}{suffix}"

    joined = re.sub(
        r"\b(\d{1,2}):(\d{2})(?::\d{2})?(?:\s*(a\.?\s*m\.?|p\.?\s*m\.?))?(?!\d)",
        _time_repl,
        joined,
        flags=re.IGNORECASE,
    )

    joined = _format_currency_spanish(joined)

    # Versiones
    def _ver_repl(m: re.Match[str]) -> str:
        label = "Versión" if m.group(0).startswith("V") else "versión"
        maj, mn, pt = int(m.group(2)), int(m.group(3)), m.group(4)
        p_txt = f" punto {_int_to_spanish(int(pt))}" if pt and int(pt) > 0 else ""
        return f"{label} {_int_to_spanish(maj)} punto {_int_to_spanish(mn)}{p_txt}"

    joined = re.sub(
        r"\b(versi[óo]n\s+)?v(\d+)\.(\d+)(?:\.(\d+))?(?:-[A-Za-z0-9.]+)?\b",
        _ver_repl,
        joined,
        flags=re.IGNORECASE,
    )
    joined = re.sub(
        r"\b(\d+)\.(\d+)\.(\d+)(?:-[A-Za-z0-9.]+)?\b",
        lambda m: (
            f"{_int_to_spanish(int(m.group(1)))} punto {_int_to_spanish(int(m.group(2)))}"
            + (f" punto {_int_to_spanish(int(m.group(3)))}" if int(m.group(3)) > 0 else "")
        ),
        joined,
    )

    # Porcentajes, multiplicadores y dimensiones
    def _pct_repl(m: re.Match[str]) -> str:
        sign, num = m.group(1), m.group(2).replace(",", ".")
        pref = "más " if sign == "+" else ("menos " if sign == "-" else "")
        return f"{pref}{num} por ciento"

    joined = re.sub(r"([+-]?)\s*(\d+(?:[.,]\d+)?)\s*%", _pct_repl, joined)
    joined = re.sub(r"\b(\d+)\s*[×x]\s*(\d+)\b", r"\1 por \2", joined, flags=re.IGNORECASE)
    joined = re.sub(r"\b(\d+(?:\.\d+)?)x\b", lambda m: m.group(1), joined, flags=re.IGNORECASE)

    # Unidades
    joined = re.sub(r"\b(\d+(?:[.,]\d+)?)\s*TB\b", r"\1 terabytes", joined)
    joined = re.sub(r"\b(\d+(?:[.,]\d+)?)\s*GB\b", r"\1 gigabytes", joined)
    joined = re.sub(r"\b(\d+(?:[.,]\d+)?)\s*MB\b", r"\1 megabytes", joined)
    joined = re.sub(r"\b(\d+(?:[.,]\d+)?)\s*KB\b", r"\1 kilobytes", joined)
    joined = re.sub(r"\b(\d+(?:[.,]\d+)?)\s*ms\b", r"\1 milisegundos", joined)
    joined = re.sub(r"\b(\d+(?:[.,]\d+)?)\s*fps\b", r"\1 cuadros por segundo", joined, flags=re.IGNORECASE)
    joined = re.sub(r"\b(\d+(?:[.,]\d+)?)\s*°\s*[CF]?\b", r"\1 grados", joined)
    joined = re.sub(r"\b(\d+(?:[.,]\d+)?)\s*km\b", r"\1 kilómetros", joined, flags=re.IGNORECASE)
    joined = re.sub(r"\b(\d+(?:[.,]\d+)?)\s*cm\b", r"\1 centímetros", joined, flags=re.IGNORECASE)
    joined = re.sub(r"\b(\d+(?:[.,]\d+)?)\s*kg\b", r"\1 kilogramos", joined, flags=re.IGNORECASE)
    joined = re.sub(r"\b(\d+(?:[.,]\d+)?)\s*px\b", r"\1 píxeles", joined, flags=re.IGNORECASE)

    # Rangos, fracciones, separadores de miles y signos numéricos
    joined = re.sub(r"\b(\d+)\s*[-–—]\s*(\d+)\b", r"\1 a \2", joined)
    joined = re.sub(r"\b(\d+)\s*/\s*(\d+)\b", r"\1 de \2", joined)
    joined = re.sub(r"\b(\d{1,3}(?:,\d{3})+)\b", lambda m: m.group(1).replace(",", ""), joined)
    joined = re.sub(r"(?<!\w)\+(\d+)", r"más \1", joined)
    joined = re.sub(r"(?<![\w)])-(\d+)", r"menos \1", joined)
    joined = re.sub(r"(?<!\w)#(\d+)\b", r"número \1", joined)
    joined = re.sub(r"(?:~|≈)\s*(\d+)", r"aproximadamente \1", joined)

    # Abreviaturas en español
    abbrev_subs = (
        (r"\bp\.\s*ej\.", "por ejemplo", re.IGNORECASE),
        (r"\bej\.", "por ejemplo", re.IGNORECASE),
        (r"\betc\.", "etcétera", re.IGNORECASE),
        (r"\bvs\.", "contra", re.IGNORECASE),
        (r"\baprox\.", "aproximadamente", re.IGNORECASE),
        (r"\bm[íi]n\.", "mínimo", re.IGNORECASE),
        (r"\bm[áa]x\.", "máximo", re.IGNORECASE),
        (r"\bn[úu]m\.", "número", re.IGNORECASE),
        (r"\bn\.?º|\bn°", "número", re.IGNORECASE),
        (r"\bp[áa]gs\.", "páginas", re.IGNORECASE),
        (r"\bp[áa]g\.", "página", re.IGNORECASE),
        (r"\bDr\.", "Doctor", 0),
        (r"\bDra\.", "Doctora", 0),
        (r"\bSr\.", "Señor", 0),
        (r"\bSra\.", "Señora", 0),
        (r"\bSrta\.", "Señorita", 0),
        (r"\bIng\.", "Ingeniero", 0),
        (r"\bLic\.", "Licenciado", 0),
        (r"\bArq\.", "Arquitecto", 0),
        (r"\bProf\.", "Profesor", 0),
        (r"\ba\.\s*m\.", "de la mañana", re.IGNORECASE),
        (r"\bp\.\s*m\.", "de la tarde", re.IGNORECASE),
        (r"\bEE\.\s*UU\.", "Estados Unidos", 0),
    )
    for pat, repl, flg in abbrev_subs:
        joined = re.sub(pat, repl, joined, flags=flg)

    # Marcas y nombres propios frecuentes
    joined = re.sub(r"\bXOOK\b", "Shok", joined, flags=re.IGNORECASE)
    joined = re.sub(r"\bXox\b", "Shox", joined, flags=re.IGNORECASE)
    joined = re.sub(r"\bWi-?Fi\b", "wifi", joined, flags=re.IGNORECASE)
    joined = re.sub(r"\bQuickBar\b", "barra rápida", joined)
    joined = re.sub(r"\bXLSX?\b", "Excel", joined)
    joined = re.sub(r"\bDOCX?\b", "Word", joined)
    joined = re.sub(r"\bPPTX?\b", "PowerPoint", joined)

    # Flechas, operadores y símbolos
    joined = re.sub(r"<->|->|=>|<-|[→⇒←➜➡↔]", ", ", joined)
    joined = re.sub(r">=|≥", " mayor o igual que ", joined)
    joined = re.sub(r"<=|≤", " menor o igual que ", joined)
    joined = re.sub(r"!==?|≠", " distinto de ", joined)
    joined = re.sub(r"===?|=", " igual a ", joined)
    joined = joined.replace("&&", " y ").replace("||", " o ").replace("&", " y ")
    joined = joined.replace("±", " más menos ").replace("÷", " entre ").replace("+", " más ").replace("°", " grados ")

    # Pares de palabras con barra y guiones internos
    joined = re.sub(r"\b([A-Za-zÁÉÍÓÚáéíóúñÑ]{2,})\s*/\s*([A-Za-zÁÉÍÓÚáéíóúñÑ]{2,})\b", r"\1 o \2", joined)
    joined = re.sub(r"([A-Za-zÁÉÍÓÚáéíóúñÑ])-([A-Za-zÁÉÍÓÚáéíóúñÑ])", r"\1 \2", joined)

    # Convertir números a palabras en español natural (evita que Pocket TTS salte dígitos)
    joined = _convert_numbers_to_spanish_words(joined)

    # Eliminar emojis y símbolos Unicode
    joined = _strip_unicode_symbols_and_emojis(joined)

    # Normalización final estricta al vocabulario nativo de tokenizer.model
    joined = _normalize_spanish_vocab_chars(joined)

    if len(joined) > 1800:
        cut = joined[:1800]
        last_punct = max(cut.rfind("."), cut.rfind("?"))
        if last_punct > 400:
            joined = cut[: last_punct + 1]
        else:
            last_space = cut.rfind(" ")
            joined = (cut[:last_space] if last_space > 200 else cut).rstrip(",;:") + "."

    return joined


def split_into_chunks(
    tokenizer: PureSentencePieceUnigram, text: str, max_tokens: int = 44
) -> List[str]:
    """Divide texto en oraciones/cláusulas limpias sin mezclar puntos internos que afecten el EOS."""
    sentences = [s.strip() for s in re.split(r"(?<=[.!?…])\s+", text) if s.strip()]
    raw_chunks: List[str] = []

    for sent in sentences:
        if not re.search(r"[a-zA-JL-WYáéíóúñ0-9]", sent):
            continue
        toks = tokenizer.encode(sent)
        if len(toks) <= max_tokens:
            raw_chunks.append(sent)
            continue

        # Dividir oraciones largas por comas y reagrupar solo cláusulas de la MISMA oración
        sub_clauses = [c.strip() for c in re.split(r"(?<=[,:])\s+", sent) if c.strip()]
        clause_pieces: List[Tuple[int, str]] = []
        for clause in sub_clauses:
            ctoks = tokenizer.encode(clause)
            if len(ctoks) <= max_tokens:
                clause_pieces.append((len(ctoks), clause))
                continue
            word_buf = ""
            for word in clause.split():
                cand = f"{word_buf} {word}".strip() if word_buf else word
                if len(tokenizer.encode(cand)) <= max_tokens:
                    word_buf = cand
                else:
                    if word_buf:
                        clause_pieces.append((len(tokenizer.encode(word_buf)), word_buf))
                    word_buf = word
            if word_buf:
                clause_pieces.append((len(tokenizer.encode(word_buf)), word_buf))

        cur_text = ""
        cur_count = 0
        for count, seg in clause_pieces:
            if not cur_text:
                cur_text = seg
                cur_count = count
            elif cur_count + count <= max_tokens:
                cur_text = f"{cur_text} {seg}"
                cur_count += count
            else:
                raw_chunks.append(cur_text)
                cur_text = seg
                cur_count = count
        if cur_text:
            raw_chunks.append(cur_text)

    normalized: List[str] = []
    for p in raw_chunks:
        p = p.strip().lstrip(",. ")
        if not p or not re.search(r"[a-zA-JL-WYáéíóúñ0-9]", p):
            continue
        if p.startswith("¿") and len(p) > 1 and "a" <= p[1] <= "z" and p[1] not in ("k", "x", "z"):
            p = "¿" + p[1].upper() + p[2:]
        elif "a" <= p[0] <= "z" and p[0] not in ("k", "x", "z"):
            p = p[0].upper() + p[1:]
        # Nunca terminar un chunk con coma suelta (deja el modelo esperando continuación)
        if p.endswith(","):
            p = p[:-1].rstrip() + "."
        elif p[-1].isalnum():
            p += "."
        normalized.append(p)
    return normalized


def _download_file(
    url: str,
    dest: Path,
    expected_bytes: int,
    on_progress: Optional[Callable[[int, int], None]] = None,
) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0:
        if expected_bytes <= 0 or abs(dest.stat().st_size - expected_bytes) <= max(1024, expected_bytes * 0.05):
            if on_progress:
                on_progress(dest.stat().st_size, dest.stat().st_size)
            return

    tmp = dest.with_name(dest.name + ".part")
    ctx = ssl.create_default_context()
    req = urllib.request.Request(url, headers={"User-Agent": "XOOK-Desktop/1.0"})
    downloaded = 0
    with urllib.request.urlopen(req, timeout=180, context=ctx) as resp, open(tmp, "wb") as out:
        total = int(resp.headers.get("Content-Length") or expected_bytes or 0)
        while True:
            chunk = resp.read(256 * 1024)
            if not chunk:
                break
            out.write(chunk)
            downloaded += len(chunk)
            if on_progress:
                on_progress(downloaded, total)
    os.replace(tmp, dest)


def download_spanish_models(
    models_dir: Path,
    voice_ids: Optional[List[str]] = None,
    emit_progress: Optional[Callable[[Dict[str, Any]], None]] = None,
) -> Dict[str, Any]:
    """Descarga los modelos principales y las voces solicitadas de forma atómica sin cargar ORT en RAM."""
    models_dir.mkdir(parents=True, exist_ok=True)
    voices_dir = models_dir / "voices"
    voices_dir.mkdir(parents=True, exist_ok=True)

    selected_voices = voice_ids or [v["id"] for v in VOICE_CATALOG if v.get("default_bundle")]
    plan: List[Tuple[str, Path, int, str]] = []
    for item in CORE_FILES:
        plan.append((item["url"], models_dir / item["filename"], item["bytes"], item["label"]))
    for vid in selected_voices:
        vmeta = VOICE_BY_ID.get(vid)
        if not vmeta:
            continue
        plan.append(
            (
                f"{VOICE_BASE_URL}/{vid}.safetensors",
                voices_dir / f"{vid}.safetensors",
                int(vmeta["bytes"]),
                f"Voz de {vmeta['name']}",
            )
        )

    total_expected = sum(p[2] for p in plan)
    completed_bytes = 0

    for idx, (url, dest, exp_bytes, label) in enumerate(plan):
        def _cb(cur: int, cur_total: int, base=completed_bytes, lbl=label, file_idx=idx) -> None:
            if not emit_progress:
                return
            overall = base + cur
            pct = min(99.9, (overall / max(total_expected, 1)) * 100.0)
            emit_progress(
                {
                    "event": "download_progress",
                    "progress": round(pct, 1),
                    "label": lbl,
                    "step": file_idx + 1,
                    "totalSteps": len(plan),
                    "downloadedBytes": overall,
                    "totalBytes": total_expected,
                }
            )

        _download_file(url, dest, exp_bytes, _cb)
        completed_bytes += dest.stat().st_size

    if emit_progress:
        emit_progress(
            {
                "event": "download_progress",
                "progress": 100.0,
                "label": "Paquete de voz listo",
                "step": len(plan),
                "totalSteps": len(plan),
                "downloadedBytes": completed_bytes,
                "totalBytes": max(total_expected, completed_bytes),
            }
        )

    return {
        "ok": True,
        "downloadedBytes": completed_bytes,
        "voices": selected_voices,
    }


def load_safetensors(path: Path) -> Dict[str, Any]:
    """Lector puro Python + NumPy para archivos .safetensors (sin dependencia Apache-2.0)."""
    import numpy as np

    dtype_map = {
        "F32": np.float32,
        "F16": np.float16,
        "I64": np.int64,
        "I32": np.int32,
        "U8": np.uint8,
        "BOOL": np.bool_,
    }
    with open(path, "rb") as f:
        hlen = struct.unpack("<Q", f.read(8))[0]
        header = json.loads(f.read(hlen).decode("utf-8"))
        data_start = 8 + hlen
        out: Dict[str, Any] = {}
        for key, meta in header.items():
            if key == "__metadata__":
                continue
            s0, s1 = meta["data_offsets"]
            f.seek(data_start + s0)
            raw = f.read(s1 - s0)
            if meta["dtype"] == "BF16":
                u16 = np.frombuffer(raw, dtype=np.uint16)
                arr = (u16.astype(np.uint32) << 16).view(np.float32)
            else:
                arr = np.frombuffer(raw, dtype=dtype_map[meta["dtype"]]).copy()
            out[key] = arr.reshape(meta["shape"])
    return out


class PocketTtsSpanishEngine:
    """Motor de síntesis neuronal Pocket TTS ONNX INT8 en español."""

    def __init__(self, models_dir: Path, lsd_steps: int = 3, temperature: float = 0.62) -> None:
        import numpy as np
        import onnxruntime as ort

        self._np = np
        self.models_dir = models_dir
        self.voices_dir = models_dir / "voices"
        self.lsd_steps = max(1, int(lsd_steps))
        self.temperature = float(temperature)

        bundle_path = models_dir / "bundle.json"
        if not bundle_path.exists():
            raise FileNotFoundError("Los modelos de voz aún no están descargados.")

        self.meta = json.loads(bundle_path.read_text(encoding="utf-8"))
        self.sample_rate = int(self.meta["sample_rate"])
        self.frame_rate = float(self.meta["frame_rate"])
        self.latent_dim = int(self.meta["latent_dim"])
        self.conditioning_dim = int(self.meta["conditioning_dim"])
        self.max_token_per_chunk = min(int(self.meta.get("max_token_per_chunk", 50)), 46)
        self.flow_manifest = self.meta["flow_lm_state_manifest"]
        self.mimi_manifest = self.meta["mimi_state_manifest"]

        self.tokenizer = PureSentencePieceUnigram(models_dir / "tokenizer.model")

        opts = ort.SessionOptions()
        opts.intra_op_num_threads = min(os.cpu_count() or 4, 4)
        opts.inter_op_num_threads = 1
        opts.enable_cpu_mem_arena = False
        opts.enable_mem_pattern = False
        opts.enable_mem_reuse = True
        providers = ["CPUExecutionProvider"]

        self.tc = ort.InferenceSession(str(models_dir / "text_conditioner_int8.onnx"), opts, providers=providers)
        self.fm = ort.InferenceSession(str(models_dir / "flow_lm_main_int8.onnx"), opts, providers=providers)
        self.ff = ort.InferenceSession(str(models_dir / "flow_lm_flow_int8.onnx"), opts, providers=providers)
        self.md = ort.InferenceSession(str(models_dir / "mimi_decoder_int8.onnx"), opts, providers=providers)

        dt = 1.0 / self.lsd_steps
        self._st_pairs = [
            (np.array([[j * dt]], dtype=np.float32), np.array([[(j + 1) * dt]], dtype=np.float32))
            for j in range(self.lsd_steps)
        ]
        self._dt = dt
        self._dtype_lu = {
            "float32": np.float32,
            "float16": np.float16,
            "int64": np.int64,
            "bool": np.bool_,
        }
        # Cachear únicamente la voz activa para acotar la huella en memoria
        self._cached_voice_id: Optional[str] = None
        self._cached_voice_state: Optional[Dict[str, Any]] = None

    def _init_state(self, manifest: List[Dict[str, Any]]) -> Dict[str, Any]:
        np = self._np
        state: Dict[str, Any] = {}
        for entry in manifest:
            dt = self._dtype_lu[entry["dtype"]]
            fill = entry["fill"]
            if fill == "nan":
                state[entry["input_name"]] = np.full(entry["shape"], np.nan, dtype=dt)
            elif fill == "ones":
                state[entry["input_name"]] = np.ones(entry["shape"], dtype=dt)
            else:
                state[entry["input_name"]] = np.zeros(entry["shape"], dtype=dt)
        return state

    def _load_voice_state(self, voice_id: str) -> Dict[str, Any]:
        np = self._np
        if voice_id not in VOICE_BY_ID:
            voice_id = "lola"

        if self._cached_voice_id == voice_id and self._cached_voice_state is not None:
            return self._cached_voice_state

        voice_file = self.voices_dir / f"{voice_id}.safetensors"
        if not voice_file.exists():
            vmeta = VOICE_BY_ID[voice_id]
            _download_file(
                f"{VOICE_BASE_URL}/{voice_id}.safetensors",
                voice_file,
                int(vmeta["bytes"]),
            )

        tensors = load_safetensors(voice_file)
        state = self._init_state(self.flow_manifest)
        for entry in self.flow_manifest:
            src = tensors.get(f"{entry['module']}/{entry['key']}")
            if src is None and entry["key"] == "step":
                off = tensors.get(f"{entry['module']}/offset")
                if off is not None:
                    src = off.reshape(1)
            if src is None:
                continue
            buf = state[entry["input_name"]]
            arr = np.asarray(src, dtype=self._dtype_lu[entry["dtype"]])
            if arr.shape == buf.shape:
                state[entry["input_name"]] = arr.copy()
            else:
                sl = tuple(slice(0, min(a, b)) for a, b in zip(arr.shape, buf.shape))
                buf[sl] = arr[sl]

        del tensors
        self._cached_voice_id = voice_id
        self._cached_voice_state = state
        return state

    def synthesize_wav_bytes(self, text: str, voice_id: str = "lola") -> Tuple[bytes, int, int]:
        np = self._np
        t0 = time.time()
        spoken = prepare_spoken_text(text)
        if not spoken:
            raise ValueError("No hay texto legible para convertir a voz.")

        chunks = split_into_chunks(self.tokenizer, spoken, self.max_token_per_chunk)
        if not chunks:
            raise ValueError("El texto no contiene contenido pronunciable.")

        base_state = self._load_voice_state(voice_id)
        empty_seq = np.zeros((1, 0, self.latent_dim), dtype=np.float32)
        empty_text = np.zeros((1, 0, self.conditioning_dim), dtype=np.float32)
        pause = np.zeros((int(self.sample_rate * 0.11),), dtype=np.float32)
        fade_len = int(self.sample_rate * 0.005)

        audio_segments: List[Any] = []
        for idx_chunk, chunk_text in enumerate(chunks):
            words = len(chunk_text.split())
            frames_after_eos = 5 if words <= 4 else 3
            tids = self.tokenizer.encode(chunk_text)
            if not tids:
                continue

            state = {k: v.copy() for k, v in base_state.items()}
            ids_arr = np.array(tids, dtype=np.int64).reshape(1, -1)
            text_emb = self.tc.run(None, {"token_ids": ids_arr})[0]
            if text_emb.ndim == 2:
                text_emb = text_emb[None]

            res = self.fm.run(None, {"sequence": empty_seq, "text_embeddings": text_emb, **state})
            for e in self.flow_manifest:
                state[e["input_name"]] = res[2 + e["index"]]

            curr = np.full((1, 1, self.latent_dim), np.nan, dtype=np.float32)
            eos_step: Optional[int] = None
            latents: List[Any] = []
            max_frames = int(math.ceil((len(tids) / 3.0 + 2.5) * self.frame_rate))
            noise_std = math.sqrt(self.temperature)

            for step in range(max_frames):
                res = self.fm.run(None, {"sequence": curr, "text_embeddings": empty_text, **state})
                cond = res[0]
                eos_logit = float(res[1][0][0])
                for e in self.flow_manifest:
                    state[e["input_name"]] = res[2 + e["index"]]

                if eos_logit > -4.0 and eos_step is None:
                    eos_step = step
                if eos_step is not None and step >= eos_step + frames_after_eos:
                    break

                x = np.random.normal(0.0, noise_std, (1, self.latent_dim)).astype(np.float32)
                for s_arr, t_arr in self._st_pairs:
                    flow = self.ff.run(None, {"c": cond, "s": s_arr, "t": t_arr, "x": x})[0]
                    x = x + flow * self._dt
                curr = x.reshape(1, 1, self.latent_dim)
                latents.append(curr)

            if not latents:
                continue

            lat_cat = np.concatenate(latents, axis=1)
            mimi_state = self._init_state(self.mimi_manifest)
            chunk_waves: List[Any] = []
            for pos in range(0, lat_cat.shape[1], 12):
                sub = lat_cat[:, pos : pos + 12, :]
                out = self.md.run(None, {"latent": sub, **mimi_state})
                chunk_waves.append(out[0].reshape(-1))
                for e in self.mimi_manifest:
                    mimi_state[e["input_name"]] = out[1 + e["index"]]

            if chunk_waves:
                seg = np.concatenate(chunk_waves)
                if len(seg) > fade_len * 2:
                    ramp = np.linspace(0.0, 1.0, fade_len, dtype=np.float32)
                    seg[:fade_len] *= ramp
                    seg[-fade_len:] *= ramp[::-1]
                audio_segments.append(seg)
                if idx_chunk < len(chunks) - 1:
                    audio_segments.append(pause)

        if not audio_segments:
            raise RuntimeError("No se generó audio válido para el texto.")

        full_audio = np.concatenate(audio_segments)
        peak = float(np.max(np.abs(full_audio)))
        if peak > 1e-4:
            gain = min(2.2, max(0.5, 0.84 / peak))
            full_audio = full_audio * gain

        pcm = np.clip(full_audio * 32767.0, -32768, 32767).astype(np.int16)
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(self.sample_rate)
            wav.writeframes(pcm.tobytes())

        duration_ms = int(round((len(full_audio) / self.sample_rate) * 1000.0))
        gen_ms = int(round((time.time() - t0) * 1000.0))
        gc.collect()
        return buf.getvalue(), duration_ms, gen_ms
