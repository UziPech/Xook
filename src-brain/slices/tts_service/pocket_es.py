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


def _normalize_spanish_vocab_chars(text: str) -> str:
    """Reemplaza puntuación y mayúsculas fuera del vocabulario por equivalentes nativos."""
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
    for q in ('"', "'", "“", "”", "«", "»", "`"):
        text = text.replace(q, "")
    # Evitar byte-fallback en mayúsculas acentuadas y K/X/Z iniciales
    char_map = str.maketrans("ÁÉÍÓÚÜÑKXZ", "áéíóúuñkxz")
    text = text.translate(char_map)
    text = re.sub(r"ü", "u", text)
    text = re.sub(r"(\d+)\s*/\s*(\d+)", r"\1 entre \2", text)
    text = text.replace("/", " ").replace("+", " más ").replace("=", " igual a ")
    text = re.sub(r",\s*,+", ",", text)
    text = re.sub(r"\.\s*\.+", ".", text)
    text = re.sub(r",\s*\.", ".", text)
    text = re.sub(r"\s+([,.?])", r"\1", text)
    return re.sub(r"\s+", " ", text).strip()


def prepare_spoken_text(raw: str) -> str:
    """Convierte respuestas en Markdown a español limpio apto para lectura en voz alta."""
    text = raw or ""
    text = re.sub(r"<think>[\s\S]*?</think>", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"<thought>[\s\S]*?</thought>", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"```[\s\S]*?```", " consulta el bloque de código en pantalla. ", text)
    text = re.sub(r"!\[([^\]]*)\]\([^)]+\)", lambda m: m.group(1) or "", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"https?://\S+", "enlace en pantalla", text)

    lines: List[str] = []
    for line in text.splitlines():
        s = line.strip()
        if not s:
            continue
        if re.fullmatch(r"\|?[\s:\-|]+\|?", s) and "-" in s:
            continue
        if "|" in s and (s.startswith("|") or s.endswith("|")):
            cells = [c.strip() for c in s.strip("|").split("|") if c.strip()]
            if cells:
                lines.append(", ".join(cells) + ".")
            continue
        s = re.sub(r"^#{1,6}\s+", "", s)
        s = re.sub(r"^>\s*", "", s)
        s = re.sub(r"^(?:[-*•]+|\d+[.)])\s+", "", s)
        lines.append(s)

    joined = " ".join(lines)
    joined = re.sub(r"`([^`]+)`", r"\1", joined)
    joined = joined.replace("**", "").replace("__", "").replace("~~", "")
    joined = re.sub(r"(?<!\w)[*_]([^*_]+)[*_](?!\w)", r"\1", joined)
    joined = re.sub(r"(\d+)\s*%", r"\1 por ciento", joined)
    joined = re.sub(r"\bXOOK\b", "Shok", joined, flags=re.IGNORECASE)
    joined = re.sub(r"\bXox\b", "Shox", joined, flags=re.IGNORECASE)
    joined = re.sub(r"[•▪▫▸▹◆◇■□★☆→←↑↓✓✔✕✖⚠️💡🔍📌📁📄🚀✨]+", " ", joined)
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
    """Divide texto en segmentos naturales agrupando frases cortas hasta max_tokens."""
    sentences = [s.strip() for s in re.split(r"(?<=[.!?…])\s+", text) if s.strip()]
    refined: List[Tuple[int, str]] = []

    for sent in sentences:
        toks = tokenizer.encode(sent)
        if len(toks) <= max_tokens:
            refined.append((len(toks), sent))
            continue

        # Dividir oraciones muy largas por comas o pausas manteniendo fluidez
        sub_clauses = [c.strip() for c in re.split(r"(?<=[,:])\s+", sent) if c.strip()]
        for clause in sub_clauses:
            ctoks = tokenizer.encode(clause)
            if len(ctoks) <= max_tokens:
                refined.append((len(ctoks), clause))
                continue
            word_buf = ""
            for word in clause.split():
                cand = f"{word_buf} {word}".strip() if word_buf else word
                if len(tokenizer.encode(cand)) <= max_tokens:
                    word_buf = cand
                else:
                    if word_buf:
                        refined.append((len(tokenizer.encode(word_buf)), word_buf))
                    word_buf = word
            if word_buf:
                refined.append((len(tokenizer.encode(word_buf)), word_buf))

    merged: List[str] = []
    cur_text = ""
    cur_count = 0
    for count, seg in refined:
        if not cur_text:
            cur_text = seg
            cur_count = count
        elif cur_count + count <= max_tokens:
            cur_text = f"{cur_text} {seg}"
            cur_count += count
        else:
            merged.append(cur_text)
            cur_text = seg
            cur_count = count
    if cur_text:
        merged.append(cur_text)

    normalized: List[str] = []
    for p in merged:
        p = p.strip()
        if not p:
            continue
        if "a" <= p[0] <= "z" and p[0] not in ("k", "x", "z"):
            p = p[0].upper() + p[1:]
        if p[-1].isalnum():
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
