"""
Worker ligero de TTS local (line-delimited JSON sobre stdin/stdout).
- Modo `--download`: descarga modelos usando solo stdlib (~12 MB RSS) y sale al terminar.
- Modo `--serve`: mantiene las sesiones ONNX cargadas mientras la voz esté activa y sale en EOF o shutdown.
"""

from __future__ import annotations

import base64
import json
import sys
from pathlib import Path
from typing import Any, Dict, Optional

BRAIN_ROOT = Path(__file__).resolve().parents[2]
if str(BRAIN_ROOT) not in sys.path:
    sys.path.insert(0, str(BRAIN_ROOT))

from slices.tts_service.pocket_es import (  # noqa: E402
    PocketTtsSpanishEngine,
    download_spanish_models,
    get_process_rss_mb,
)


def _write_json_line(payload: Dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def run_download(models_dir: Path, voices_arg: Optional[str]) -> int:
    voices = [v.strip() for v in voices_arg.split(",") if v.strip()] if voices_arg else None
    try:
        res = download_spanish_models(
            models_dir=models_dir,
            voice_ids=voices,
            emit_progress=_write_json_line,
        )
        _write_json_line({"event": "download_done", **res})
        return 0
    except Exception as exc:
        _write_json_line({"event": "download_error", "error": str(exc)})
        return 1


def run_serve(models_dir: Path) -> int:
    engine: Optional[PocketTtsSpanishEngine] = None

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        req_id: Any = None
        try:
            req = json.loads(line)
            req_id = req.get("id")
            method = str(req.get("method") or "").strip()
            params = req.get("params") or {}

            if method == "shutdown":
                _write_json_line({"id": req_id, "ok": True, "result": {"stopped": True}})
                return 0

            if method == "ping":
                _write_json_line(
                    {
                        "id": req_id,
                        "ok": True,
                        "result": {
                            "loaded": engine is not None,
                            "rssMb": get_process_rss_mb(),
                        },
                    }
                )
                continue

            if method == "synthesize":
                if engine is None:
                    engine = PocketTtsSpanishEngine(models_dir)
                text = str(params.get("text") or "")
                voice_id = str(params.get("voiceId") or "lola")
                wav_bytes, duration_ms, gen_ms = engine.synthesize_wav_bytes(text, voice_id=voice_id)
                _write_json_line(
                    {
                        "id": req_id,
                        "ok": True,
                        "result": {
                            "wavBase64": base64.b64encode(wav_bytes).decode("ascii"),
                            "mimeType": "audio/wav",
                            "durationMs": duration_ms,
                            "generationMs": gen_ms,
                            "voiceId": voice_id,
                            "rssMb": get_process_rss_mb(),
                        },
                    }
                )
                continue

            _write_json_line({"id": req_id, "ok": False, "error": f"Método no soportado: {method}"})
        except Exception as exc:
            _write_json_line({"id": req_id, "ok": False, "error": str(exc)})

    return 0


def main() -> int:
    if len(sys.argv) < 3:
        sys.stderr.write("Uso: tts_worker.py [--download <dir> [voices] | --serve <dir>]\n")
        return 2

    mode = sys.argv[1]
    models_dir = Path(sys.argv[2])
    if mode == "--download":
        voices_arg = sys.argv[3] if len(sys.argv) > 3 else None
        return run_download(models_dir, voices_arg)
    if mode == "--serve":
        return run_serve(models_dir)

    sys.stderr.write(f"Modo desconocido: {mode}\n")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
