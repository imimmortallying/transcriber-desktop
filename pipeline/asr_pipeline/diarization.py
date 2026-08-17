"""Stage 3: pyannote speaker diarization and ASR-segment reconciliation."""

import json
from dataclasses import asdict, dataclass, replace
from pathlib import Path
from typing import Iterable, List

import numpy as np
import soundfile as sf
import torch

from .asr import AsrSegment
from .config import PipelineConfig


@dataclass(frozen=True)
class DiarizationTurn:
    start: float
    end: float
    speaker: str


def assign_speakers(
    asr_segments: Iterable[AsrSegment], turns: Iterable[DiarizationTurn]
) -> List[AsrSegment]:
    """Assign each ASR segment the speaker with the largest time overlap.

    A segment with no overlap deliberately keeps ``speaker=None``. Ties retain
    pyannote's first chronological turn, making the result deterministic.
    """
    turns = list(turns)
    assigned = []
    for segment in asr_segments:
        best_speaker = None
        best_overlap = 0.0
        for turn in turns:
            overlap = max(0.0, min(segment.end, turn.end) - max(segment.start, turn.start))
            if overlap > best_overlap:
                best_overlap = overlap
                best_speaker = turn.speaker
        assigned.append(replace(segment, speaker=best_speaker))
    return assigned


def _validate_token(token: str | None) -> str:
    if not token or token == "REPLACE_ME":
        raise ValueError(
            "Не задан HF-токен для диаризации. Укажите diarization.hf_token "
            "в pipeline/config.json."
        )
    return token


def run_diarization(
    normalized_wav: Path, asr_segments_path: Path, run_dir: Path, config: PipelineConfig
) -> Path:
    """Run pyannote on a normalized WAV and write speaker-labelled ASR segments."""
    from pyannote.audio import Pipeline

    token = _validate_token(config.diarization.hf_token)
    audio, sample_rate = sf.read(str(normalized_wav), dtype="float32", always_2d=True)
    if sample_rate != config.ffmpeg.sample_rate:
        raise ValueError(
            f"Expected {config.ffmpeg.sample_rate}Hz audio, got {sample_rate}Hz "
            f"from {normalized_wav}."
        )

    waveform = torch.from_numpy(np.ascontiguousarray(audio.T))
    pipeline = Pipeline.from_pretrained(config.diarization.model_name, token=token)
    output = pipeline({"waveform": waveform, "sample_rate": sample_rate})
    turns = [
        DiarizationTurn(start=turn.start, end=turn.end, speaker=speaker)
        for turn, speaker in output.speaker_diarization
    ]

    raw_segments = json.loads(asr_segments_path.read_text(encoding="utf-8"))
    asr_segments = [AsrSegment(**segment) for segment in raw_segments]
    diarized_segments = assign_speakers(asr_segments, turns)

    output_path = run_dir / "segments_diarized.json"
    output_path.write_text(
        json.dumps([asdict(segment) for segment in diarized_segments], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return output_path
