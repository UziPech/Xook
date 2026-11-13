"""
OCR local sin costo de API para PDFs escaneados e imágenes adjuntas.
En macOS utiliza Apple Vision (VNRecognizeTextRequest) vía `swift`.
En otros sistemas degrada limpiamente devolviendo texto vacío.
"""

from __future__ import annotations

import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from typing import Dict, List

import pypdfium2 as pdfium


_SWIFT_VISION_OCR_SCRIPT = r"""
import Foundation
import Vision
import AppKit

let args = Array(CommandLine.arguments.dropFirst())
var output: [String: String] = [:]

for path in args {
    guard let img = NSImage(contentsOfFile: path),
          let cgImg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        output[path] = ""
        continue
    }
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.usesLanguageCorrection = true
    req.recognitionLanguages = ["es-MX", "es-ES", "en-US"]
    let handler = VNImageRequestHandler(cgImage: cgImg, options: [:])
    do {
        try handler.perform([req])
        let lines = (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }
        output[path] = lines.joined(separator: "\n")
    } catch {
        output[path] = ""
    }
}

if let data = try? JSONSerialization.data(withJSONObject: output, options: []),
   let text = String(data: data, encoding: .utf8) {
    print(text)
} else {
    print("{}")
}
"""


def is_local_ocr_available() -> bool:
    return sys.platform == "darwin" and bool(shutil.which("swift"))


def extract_text_from_images_macos(
    image_paths: List[Path],
    *,
    timeout_sec: int = 35,
) -> Dict[str, str]:
    """Ejecuta OCR local sobre una lista de imágenes en macOS con Vision Framework."""
    if not image_paths or not is_local_ocr_available():
        return {}

    valid_paths = [str(p.resolve()) for p in image_paths if p.is_file()]
    if not valid_paths:
        return {}

    try:
        proc = subprocess.run(
            ["swift", "-", *valid_paths],
            input=_SWIFT_VISION_OCR_SCRIPT,
            text=True,
            capture_output=True,
            timeout=timeout_sec,
        )
        if proc.returncode != 0 or not proc.stdout.strip():
            return {}
        parsed = json.loads(proc.stdout.strip())
        if isinstance(parsed, dict):
            return {str(k): str(v or "").strip() for k, v in parsed.items()}
    except Exception:
        return {}
    return {}


def ocr_pdf_pages(
    pdf_path: Path,
    page_numbers_1based: List[int],
    *,
    scale: float = 2.0,
) -> Dict[int, str]:
    """Renderiza páginas concretas de un PDF a PNG temporal y extrae texto con OCR local."""
    if not page_numbers_1based or not pdf_path.is_file() or not is_local_ocr_available():
        return {}

    out: Dict[int, str] = {}
    doc = None
    try:
        doc = pdfium.PdfDocument(str(pdf_path))
        total = len(doc)
        with tempfile.TemporaryDirectory(prefix="xook_ocr_") as tmp_dir:
            tmp_root = Path(tmp_dir)
            page_to_img: Dict[int, Path] = {}
            for p_num in page_numbers_1based:
                if p_num < 1 or p_num > total:
                    continue
                page = doc[p_num - 1]
                try:
                    bitmap = page.render(scale=scale)
                    pil_img = bitmap.to_pil()
                    img_path = tmp_root / f"page_{p_num}.png"
                    pil_img.save(img_path, format="PNG")
                    page_to_img[p_num] = img_path
                finally:
                    page.close()

            if not page_to_img:
                return {}

            ocr_map = extract_text_from_images_macos(list(page_to_img.values()))
            for p_num, img_path in page_to_img.items():
                txt = ocr_map.get(str(img_path.resolve())) or ocr_map.get(str(img_path)) or ""
                if txt:
                    out[p_num] = txt
    except Exception:
        return {}
    finally:
        if doc is not None:
            try:
                doc.close()
            except Exception:
                pass

    return out

