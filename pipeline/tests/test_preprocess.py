import json
from pathlib import Path

from asr_pipeline.config import load_config
from asr_pipeline.preprocess import run_preprocess

FIXTURES_DIR = Path(__file__).parent / "fixtures"
CONFIG_PATH = Path(__file__).parent.parent / "config.example.json"


def test_preprocess_produces_artifacts(tmp_path):
    config = load_config(CONFIG_PATH)
    input_path = FIXTURES_DIR / "sample_short.wav"
    run_dir = tmp_path / "run"

    segments_path = run_preprocess(input_path, run_dir, config)

    normalized_path = run_dir / "normalized.wav"
    assert normalized_path.exists()
    assert segments_path.exists()

    segments = json.loads(segments_path.read_text(encoding="utf-8"))
    assert isinstance(segments, list)
    assert len(segments) > 0, "expected the fixture (real speech) to yield at least one VAD segment"
    for segment in segments:
        assert segment["end"] > segment["start"] >= 0
