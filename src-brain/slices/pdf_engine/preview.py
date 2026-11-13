"""
Renderizado rápido de páginas PDF a imágenes data-URL vía pypdfium2 + Pillow
para previsualización pixel-exacta en el panel derecho de la UI sin plugins del WebView.
"""

from __future__ import annotations

import base64
import io
from pathlib import Path
from typing import Any, Dict, List

import pypdfium2 as pdfium
from PIL import Image


def _pil_to_jpeg_data_url(
    pil_img: Image.Image,
    *,
    max_width_px: int = 1100,
    quality: int = 84,
) -> tuple[str, int, int]:
    """Convierte una imagen PIL a RGB sobre blanco y la codifica en JPEG base64 data URL."""
    img = pil_img
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        rgba = img.convert("RGBA")
        bg = Image.new("RGB", rgba.size, (255, 255, 255))
        bg.paste(rgba, mask=rgba.split()[-1])
        img = bg
    elif img.mode != "RGB":
        img = img.convert("RGB")

    if max_width_px > 0 and img.width > max_width_px:
        ratio = max_width_px / float(img.width)
        new_h = max(1, int(round(img.height * ratio)))
        resampling = Image.Resampling.LANCZOS if hasattr(Image, "Resampling") else Image.LANCZOS
        img = img.resize((max_width_px, new_h), resampling)

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality, optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/jpeg;base64,{b64}", img.width, img.height


def render_pdf_preview(
    pdf_path: Path,
    *,
    start_page: int = 1,
    max_pages: int = 8,
    scale: float = 1.65,
    max_width_px: int = 1100,
    jpeg_quality: int = 84,
) -> Dict[str, Any]:
    """Renderiza un rango de páginas PDF (1-based) a data URLs JPEG listas para <img>."""
    if not pdf_path.is_file():
        raise FileNotFoundError(f"Archivo PDF no encontrado: {pdf_path}")

    doc = pdfium.PdfDocument(str(pdf_path))
    pages_out: List[Dict[str, Any]] = []
    try:
        total_pages = len(doc)
        safe_start = max(1, int(start_page))
        safe_limit = max(1, min(int(max_pages), 24))
        end_page = min(total_pages, safe_start + safe_limit - 1)
        safe_scale = max(0.75, min(float(scale), 2.5))

        for page_num in range(safe_start, end_page + 1):
            page = doc[page_num - 1]
            bitmap = None
            try:
                bitmap = page.render(scale=safe_scale)
                pil_img = bitmap.to_pil()
                data_url, out_w, out_h = _pil_to_jpeg_data_url(
                    pil_img,
                    max_width_px=max_width_px,
                    quality=jpeg_quality,
                )
                pages_out.append({
                    "page": page_num,
                    "width": out_w,
                    "height": out_h,
                    "data_url": data_url,
                })
            finally:
                if bitmap is not None:
                    try:
                        bitmap.close()
                    except Exception:
                        pass
                try:
                    page.close()
                except Exception:
                    pass
    finally:
        try:
            doc.close()
        except Exception:
            pass

    return {
        "ok": True,
        "page_count": total_pages,
        "start_page": safe_start,
        "rendered_count": len(pages_out),
        "has_more": (safe_start + len(pages_out) - 1) < total_pages,
        "pages": pages_out,
    }

