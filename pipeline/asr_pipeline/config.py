"""Loads and validates pipeline/config.json. No thresholds, paths, or backend
choices are hardcoded outside this file's defaults for optional tunables."""

import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class FfmpegConfig:
    exe: Path
    sample_rate: int
    loudnorm: str
    denoise: bool


@dataclass(frozen=True)
class VadConfig:
    threshold: float
    min_speech_duration_ms: int
    min_silence_duration_ms: int
    speech_pad_ms: int
    max_speech_duration_s: float


@dataclass(frozen=True)
class AsrConfig:
    model_name: str
    language: str
    confidence_threshold: float
    max_symbols_per_step: int


@dataclass(frozen=True)
class OllamaConfig:
    host: str
    model: str


@dataclass(frozen=True)
class StructuringConfig:
    backend: str
    ollama: OllamaConfig
    template_path: Path


@dataclass(frozen=True)
class PipelineConfig:
    ffmpeg: FfmpegConfig
    vad: VadConfig
    asr: AsrConfig
    structuring: StructuringConfig
    data_dir: Path


def _resolve(base_dir: Path, value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else (base_dir / path).resolve()


def load_config(config_path: Path) -> PipelineConfig:
    """Relative paths inside the config file are resolved against the
    config file's own directory, not the process's current working
    directory, so the pipeline behaves the same regardless of where it's
    invoked from."""
    config_path = Path(config_path).resolve()
    if not config_path.exists():
        raise FileNotFoundError(
            f"Config file not found: {config_path}. "
            f"Copy config.example.json to config.json and edit it."
        )

    base_dir = config_path.parent
    raw = json.loads(config_path.read_text(encoding="utf-8"))

    try:
        ffmpeg_raw = raw["ffmpeg"]
        vad_raw = raw["vad"]
        asr_raw = raw["asr"]
        structuring_raw = raw["structuring"]
        ollama_raw = structuring_raw["ollama"]
    except KeyError as error:
        raise ValueError(f"Missing required config section: {error}") from error

    return PipelineConfig(
        ffmpeg=FfmpegConfig(
            exe=_resolve(base_dir, ffmpeg_raw["exe"]),
            sample_rate=int(ffmpeg_raw.get("sample_rate", 16000)),
            loudnorm=ffmpeg_raw.get("loudnorm", "I=-16:TP=-1.5:LRA=11"),
            denoise=bool(ffmpeg_raw.get("denoise", False)),
        ),
        vad=VadConfig(
            threshold=float(vad_raw.get("threshold", 0.5)),
            min_speech_duration_ms=int(vad_raw.get("min_speech_duration_ms", 250)),
            min_silence_duration_ms=int(vad_raw.get("min_silence_duration_ms", 300)),
            speech_pad_ms=int(vad_raw.get("speech_pad_ms", 30)),
            # Must stay under GigaAM's own LONGFORM_THRESHOLD (25s) - the
            # custom decode loop in asr.py bypasses transcribe()'s built-in
            # check for this, so it's enforced here instead. Default of 20s
            # leaves margin.
            max_speech_duration_s=float(vad_raw.get("max_speech_duration_s", 20.0)),
        ),
        asr=AsrConfig(
            model_name=asr_raw["model_name"],
            language=asr_raw.get("language", "ru"),
            confidence_threshold=float(asr_raw["confidence_threshold"]),
            max_symbols_per_step=int(asr_raw.get("max_symbols_per_step", 10)),
        ),
        structuring=StructuringConfig(
            backend=structuring_raw["backend"],
            ollama=OllamaConfig(
                host=ollama_raw["host"],
                model=ollama_raw["model"],
            ),
            template_path=_resolve(base_dir, structuring_raw["template_path"]),
        ),
        data_dir=_resolve(base_dir, raw.get("data_dir", "../data/pipeline")),
    )
