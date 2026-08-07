"""Stage 1: ffmpeg normalization + Silero VAD segmentation.

Denoising is intentionally NOT applied by default: spectral denoising
distorts the signal in ways that often hurt ASR accuracy more than the
background noise itself would. It's exposed as an opt-in config flag
(ffmpeg.denoise) for cases where it's worth the tradeoff, never on by
default.

Segments with no meaningful speech are not explicitly filtered here
because get_speech_timestamps() already only returns speech regions
(gated by vad.threshold / min_speech_duration_ms) - a silence-dominant
stretch of audio simply never becomes a segment in the first place.
"""

import json
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import List

from .config import PipelineConfig


@dataclass(frozen=True)
class VadSegment:
    start: float
    end: float


def normalize_audio(input_path: Path, output_path: Path, config: PipelineConfig) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)

    filters = [f"loudnorm={config.ffmpeg.loudnorm}"]
    if config.ffmpeg.denoise:
        filters.insert(0, "afftdn")

    args = [
        str(config.ffmpeg.exe),
        "-y",
        "-i",
        str(input_path),
        "-ac",
        "1",
        "-ar",
        str(config.ffmpeg.sample_rate),
        "-af",
        ",".join(filters),
        "-c:a",
        "pcm_s16le",
        str(output_path),
    ]
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"ffmpeg normalization failed (exit {result.returncode}):\n{result.stderr}"
        )


def detect_speech_segments(wav_path: Path, config: PipelineConfig) -> List[VadSegment]:
    # Imported lazily: these pull in torch, keep module import light for
    # callers that only need normalize_audio().
    import soundfile as sf
    import torch
    from silero_vad import get_speech_timestamps, load_silero_vad

    # Loaded directly via soundfile rather than silero_vad's own
    # read_audio(): that helper goes through torchaudio, whose recent
    # versions require the separate torchcodec package for file I/O.
    # soundfile is already a hard dependency for stage 2 (segment
    # slicing), so reusing it here avoids adding torchcodec just for this.
    audio, sample_rate = sf.read(str(wav_path), dtype="float32")
    if sample_rate != config.ffmpeg.sample_rate:
        raise ValueError(
            f"Expected {config.ffmpeg.sample_rate}Hz audio, got {sample_rate}Hz "
            f"from {wav_path} - normalize_audio() should have resampled it."
        )
    wav = torch.from_numpy(audio)

    model = load_silero_vad(onnx=True)
    timestamps = get_speech_timestamps(
        wav,
        model,
        threshold=config.vad.threshold,
        sampling_rate=config.ffmpeg.sample_rate,
        min_speech_duration_ms=config.vad.min_speech_duration_ms,
        min_silence_duration_ms=config.vad.min_silence_duration_ms,
        speech_pad_ms=config.vad.speech_pad_ms,
        max_speech_duration_s=config.vad.max_speech_duration_s,
        return_seconds=True,
    )
    return [VadSegment(start=ts["start"], end=ts["end"]) for ts in timestamps]


def run_preprocess(input_path: Path, run_dir: Path, config: PipelineConfig) -> Path:
    """Runs ffmpeg normalization + VAD segmentation, writes normalized.wav
    and vad_segments.json under run_dir. Returns the path to
    vad_segments.json."""
    run_dir.mkdir(parents=True, exist_ok=True)
    normalized_path = run_dir / "normalized.wav"
    segments_path = run_dir / "vad_segments.json"

    normalize_audio(input_path, normalized_path, config)
    segments = detect_speech_segments(normalized_path, config)

    segments_path.write_text(
        json.dumps([asdict(s) for s in segments], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return segments_path
