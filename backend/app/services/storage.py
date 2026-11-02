"""File storage behind a tiny interface. Local disk here; an S3-compatible class can implement the
same three methods for production without touching callers."""

import io
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps

from app.config import get_settings


class StorageError(ValueError):
    pass


class LocalStorage:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        p = (self.root / key).resolve()
        if self.root not in p.parents:
            raise StorageError("invalid storage key")
        return p

    def put(self, key: str, data: bytes) -> str:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
        return key

    def get(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def exists(self, key: str) -> bool:
        return self._path(key).exists()

    def version(self, key: str) -> float:
        return self._path(key).stat().st_mtime

    def delete_prefix(self, prefix: str) -> None:
        base = self._path(prefix)
        if base.is_dir():
            for f in sorted(base.rglob("*"), reverse=True):
                f.unlink() if f.is_file() else f.rmdir()
            base.rmdir()

    def url(self, key: str | None) -> str | None:
        return f"/media/{key}" if key else None


storage = LocalStorage(get_settings().storage_dir)


def put_image(key: str, image: np.ndarray, quality: int = 88) -> str:
    ext = Path(key).suffix.lower()
    params = [cv2.IMWRITE_JPEG_QUALITY, quality] if ext in (".jpg", ".jpeg") else [cv2.IMWRITE_PNG_COMPRESSION, 6]
    ok, buf = cv2.imencode(ext, image, params)
    if not ok:
        raise StorageError("could not encode image")
    return storage.put(key, buf.tobytes())


def load_image(key: str) -> np.ndarray:
    data = np.frombuffer(storage.get(key), np.uint8)
    img = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if img is None:
        raise StorageError(f"unreadable image at {key}")
    return img


def decode_upload(data: bytes, max_pixels: int) -> np.ndarray:
    """Validate an uploaded image by actually decoding it (not by extension), honour EXIF rotation,
    refuse decompression bombs, and return BGR pixels."""
    Image.MAX_IMAGE_PIXELS = max_pixels
    try:
        with Image.open(io.BytesIO(data)) as im:
            if im.format not in {"JPEG", "PNG", "TIFF", "WEBP", "BMP"}:
                raise StorageError(f"unsupported image format {im.format}")
            im = ImageOps.exif_transpose(im)
            if im.width * im.height > max_pixels:
                raise StorageError("image is too large")
            rgb = im.convert("RGB")
            return cv2.cvtColor(np.asarray(rgb), cv2.COLOR_RGB2BGR)
    except Image.DecompressionBombError as exc:
        raise StorageError("image is too large") from exc
    except StorageError:
        raise
    except Exception as exc:
        raise StorageError("file is not a readable image") from exc


def pdf_to_images(data: bytes, max_pages: int = 50, dpi: int = 200) -> list[np.ndarray]:
    import pypdfium2 as pdfium

    try:
        pdf = pdfium.PdfDocument(data)
    except Exception as exc:
        raise StorageError("file is not a readable PDF") from exc
    if len(pdf) > max_pages:
        raise StorageError(f"PDF has {len(pdf)} pages; the limit is {max_pages}")
    images = []
    for i in range(len(pdf)):
        bitmap = pdf[i].render(scale=dpi / 72)
        rgb = np.asarray(bitmap.to_pil().convert("RGB"))
        images.append(cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))
    return images
