"""Validate that the original media clock survives audio normalization.

VAD and ASR timing is measured on normalized.wav, while media review will seek
the original file. These fixtures deliberately place a tone at t=1.0 in both
an audio source and a video source, then assert that it remains there after the
same normalization path used by recognition.
"""

import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf

from asr_pipeline.config import load_config
from asr_pipeline.preprocess import normalize_audio


CONFIG_PATH = Path(__file__).parent.parent / "config.example.json"
EXPECTED_TONE_START_SECONDS = 1.0
ALIGNMENT_TOLERANCE_SECONDS = 0.05


def _run_ffmpeg(ffmpeg: Path, args: list[str]) -> None:
    subprocess.run([str(ffmpeg), "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def _first_signal_second(wav_path: Path) -> tuple[float, float]:
    audio, sample_rate = sf.read(str(wav_path), dtype="float32")
    signal_indices = np.flatnonzero(np.abs(audio) > 0.01)
    assert len(signal_indices), "expected the generated tone to survive normalization"
    return signal_indices[0] / sample_rate, len(audio) / sample_rate


def _assert_normalized_alignment(source_path: Path, output_path: Path, config) -> None:
    normalize_audio(source_path, output_path, config)
    signal_start, duration = _first_signal_second(output_path)
    assert abs(signal_start - EXPECTED_TONE_START_SECONDS) <= ALIGNMENT_TOLERANCE_SECONDS
    assert abs(duration - 3.0) <= ALIGNMENT_TOLERANCE_SECONDS


def test_normalized_audio_preserves_original_audio_timeline(tmp_path):
    config = load_config(CONFIG_PATH)
    source_path = tmp_path / "delayed-tone.wav"
    _run_ffmpeg(config.ffmpeg.exe, [
        "-f", "lavfi",
        "-i", "sine=frequency=1000:sample_rate=48000:duration=0.5",
        "-af", "adelay=1000:all=1,apad=pad_dur=1.5",
        "-t", "3",
        "-c:a", "pcm_s16le",
        str(source_path),
    ])

    _assert_normalized_alignment(source_path, tmp_path / "normalized-audio.wav", config)


def test_normalized_audio_preserves_original_video_timeline(tmp_path):
    config = load_config(CONFIG_PATH)
    source_path = tmp_path / "delayed-tone.mkv"
    _run_ffmpeg(config.ffmpeg.exe, [
        "-f", "lavfi",
        "-i", "testsrc=size=160x90:rate=25:duration=3",
        "-f", "lavfi",
        "-i", "sine=frequency=1000:sample_rate=48000:duration=0.5",
        "-filter_complex", "[1:a]adelay=1000:all=1,apad=pad_dur=1.5[a]",
        "-map", "0:v",
        "-map", "[a]",
        "-t", "3",
        "-c:v", "mpeg4",
        "-c:a", "pcm_s16le",
        str(source_path),
    ])

    _assert_normalized_alignment(source_path, tmp_path / "normalized-video.wav", config)
