import json
from pathlib import Path

from asr_pipeline.asr import AsrSegment, format_timecode, mark_if_low_confidence, run_asr
from asr_pipeline.config import load_config
from asr_pipeline.preprocess import run_preprocess

FIXTURES_DIR = Path(__file__).parent / "fixtures"
CONFIG_PATH = Path(__file__).parent.parent / "config.example.json"


def test_format_timecode():
    assert format_timecode(0) == "00:00:00"
    assert format_timecode(75) == "00:01:15"
    assert format_timecode(3661) == "01:01:01"


def test_mark_if_low_confidence_below_threshold_wraps_marker():
    segment = AsrSegment(start=134.0, end=159.0, text="что-то невнятное", confidence=0.2)
    marked = mark_if_low_confidence(segment, threshold=0.5)
    assert marked == "[неразборчиво 00:02:14–00:02:39]"


def test_mark_if_low_confidence_above_threshold_keeps_text():
    segment = AsrSegment(start=0.0, end=2.0, text="добрый день", confidence=0.9)
    assert mark_if_low_confidence(segment, threshold=0.5) == "добрый день"


def test_run_asr_end_to_end_on_fixture(tmp_path):
    """Real smoke test: loads the actual GigaAM model (downloads weights
    on first run) and transcribes the real-speech fixture. Slow - this
    is deliberate per the project's testability requirement that every
    stage have a real smoke test, not a mocked one."""
    config = load_config(CONFIG_PATH)
    run_dir = tmp_path / "run"

    run_preprocess(FIXTURES_DIR / "sample_short.wav", run_dir, config)
    transcript_path = run_asr(
        run_dir / "normalized.wav", run_dir / "vad_segments.json", run_dir, config
    )

    segments_path = run_dir / "segments_asr.json"
    assert segments_path.exists()
    segments = json.loads(segments_path.read_text(encoding="utf-8"))
    assert len(segments) > 0

    for segment in segments:
        assert 0.0 <= segment["confidence"] <= 1.0
        assert segment["speaker"] is None

    assert transcript_path.exists()
    transcript = transcript_path.read_text(encoding="utf-8")
    assert len(transcript.strip()) > 0
    # At least one segment should produce real, non-empty text - a
    # transcript that's 100% [неразборчиво ...] on a clean speech
    # fixture would indicate the decode loop is broken, not that the
    # audio is genuinely unclear.
    assert any(seg["text"].strip() for seg in segments)
