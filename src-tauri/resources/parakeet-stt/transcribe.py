#!/usr/bin/env python3
"""Local NVIDIA Parakeet ASR sidecar for NoteLoom (Apple Silicon / MLX)."""

from __future__ import annotations

import argparse
import json
import os
import sys
import traceback
from pathlib import Path


DEFAULT_MODEL = "mlx-community/parakeet-tdt-0.6b-v2"
ALLOWED_MODELS = {
    "mlx-community/parakeet-tdt-0.6b-v2",
    "mlx-community/parakeet-tdt-0.6b-v3",
    "mlx-community/parakeet-ctc-0.6b",
}


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    sys.stdout.write("\n")
    sys.stdout.flush()


def fail(code: str, message: str, *, details: str | None = None) -> int:
    payload = {"ok": False, "error": code, "message": message}
    if details:
        payload["details"] = details
    emit(payload)
    return 1


def cmd_status(args: argparse.Namespace) -> int:
    python_version = ".".join(map(str, sys.version_info[:3]))
    platform = sys.platform
    mlx_ok = False
    parakeet_ok = False
    mlx_error = None
    try:
        import mlx.core as mx  # noqa: F401

        mlx_ok = True
    except Exception as exc:  # pragma: no cover - environment dependent
        mlx_error = str(exc)

    try:
        import parakeet_mlx  # noqa: F401

        parakeet_ok = True
    except Exception as exc:  # pragma: no cover - environment dependent
        if mlx_error is None:
            mlx_error = str(exc)

    cache_dir = Path(args.cache_dir).expanduser() if args.cache_dir else None
    model_cached = False
    if cache_dir and args.model:
        # Hugging Face hub layout: models--org--name
        slug = f"models--{args.model.replace('/', '--')}"
        model_dir = cache_dir / slug
        model_cached = model_dir.is_dir() and any(model_dir.rglob("*.safetensors"))

    emit(
        {
            "ok": True,
            "pythonVersion": python_version,
            "platform": platform,
            "mlxAvailable": mlx_ok,
            "parakeetAvailable": parakeet_ok,
            "model": args.model,
            "modelCached": model_cached,
            "cacheDir": str(cache_dir) if cache_dir else None,
            "ready": bool(mlx_ok and parakeet_ok),
            "error": None if (mlx_ok and parakeet_ok) else (mlx_error or "Parakeet runtime is incomplete"),
        }
    )
    return 0


def cmd_transcribe(args: argparse.Namespace) -> int:
    audio_path = Path(args.audio).expanduser()
    if not audio_path.is_file():
        return fail("audio_not_found", f"Audio file not found: {audio_path}")

    model_id = args.model or DEFAULT_MODEL
    if model_id not in ALLOWED_MODELS:
        return fail(
            "unsupported_model",
            f"Unsupported Parakeet model: {model_id}",
            details=f"Allowed: {', '.join(sorted(ALLOWED_MODELS))}",
        )

    cache_dir = Path(args.cache_dir).expanduser() if args.cache_dir else None
    if cache_dir:
        cache_dir.mkdir(parents=True, exist_ok=True)
        os.environ.setdefault("HF_HOME", str(cache_dir.parent if cache_dir.name == "hub" else cache_dir))
        os.environ.setdefault("HUGGINGFACE_HUB_CACHE", str(cache_dir))

    try:
        from parakeet_mlx import from_pretrained
    except Exception as exc:
        return fail(
            "import_failed",
            "Failed to import parakeet-mlx. Install the local Parakeet runtime from Settings → Audio.",
            details=str(exc),
        )

    try:
        model = from_pretrained(model_id, cache_dir=str(cache_dir) if cache_dir else None)
        # Local attention reduces peak memory for longer clips.
        if args.local_attention and hasattr(model, "encoder") and hasattr(model.encoder, "layers"):
            try:
                # parakeet-mlx CLI exposes --local-attention; mirror via env when supported.
                os.environ["PARAKEET_LOCAL_ATTENTION"] = "1"
            except Exception:
                pass

        chunk_duration = float(args.chunk_duration) if args.chunk_duration else None
        result = model.transcribe(
            str(audio_path),
            chunk_duration=chunk_duration,
        )
        text = (getattr(result, "text", None) or "").strip()
        emit(
            {
                "ok": True,
                "text": text,
                "model": model_id,
                "language": args.language or "en",
            }
        )
        return 0
    except Exception as exc:
        return fail(
            "transcription_failed",
            f"Parakeet transcription failed: {exc}",
            details=traceback.format_exc(),
        )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="NoteLoom Parakeet STT sidecar")
    sub = parser.add_subparsers(dest="command", required=True)

    status = sub.add_parser("status", help="Report runtime readiness")
    status.add_argument("--model", default=DEFAULT_MODEL)
    status.add_argument("--cache-dir", default=None)
    status.set_defaults(func=cmd_status)

    transcribe = sub.add_parser("transcribe", help="Transcribe an audio file")
    transcribe.add_argument("--audio", required=True)
    transcribe.add_argument("--model", default=DEFAULT_MODEL)
    transcribe.add_argument("--cache-dir", default=None)
    transcribe.add_argument("--language", default="en")
    transcribe.add_argument("--chunk-duration", default=None)
    transcribe.add_argument("--local-attention", action="store_true")
    transcribe.set_defaults(func=cmd_transcribe)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
