"""CLI entry point: python -m asr_pipeline.cli <preprocess|asr|diarize|run> ...

Each stage is independently invokable and reads/writes its artifacts
under <data_dir>/<run_id>/, so intermediate results can be inspected or
a stage re-run without repeating earlier ones.
"""

import argparse
import time
import uuid
from pathlib import Path

from .asr import run_asr
from .config import PipelineConfig, load_config
from .diarization import run_diarization
from .preprocess import run_preprocess


def _default_config_path() -> Path:
    return Path(__file__).resolve().parent.parent / "config.json"


def _make_run_id(input_path: Path) -> str:
    return f"{int(time.time())}-{input_path.stem}-{uuid.uuid4().hex[:8]}"


def _run_dir(config: PipelineConfig, run_id: str) -> Path:
    return config.data_dir / run_id


def cmd_preprocess(args: argparse.Namespace) -> None:
    config = load_config(args.config)
    run_id = args.run_id or _make_run_id(Path(args.input))
    run_dir = _run_dir(config, run_id)
    segments_path = run_preprocess(Path(args.input), run_dir, config)
    print(f"run_id={run_id}")
    print(f"vad_segments={segments_path}")


def cmd_asr(args: argparse.Namespace) -> None:
    config = load_config(args.config)
    run_dir = _run_dir(config, args.run_id)
    normalized_path = run_dir / "normalized.wav"
    segments_path = run_dir / "vad_segments.json"
    if not normalized_path.exists() or not segments_path.exists():
        raise FileNotFoundError(
            f"Missing stage-1 artifacts in {run_dir}. Run 'preprocess' first."
        )
    transcript_path = run_asr(normalized_path, segments_path, run_dir, config)
    print(f"transcript={transcript_path}")


def cmd_diarize(args: argparse.Namespace) -> None:
    config = load_config(args.config)
    run_dir = _run_dir(config, args.run_id)
    normalized_path = run_dir / "normalized.wav"
    segments_path = run_dir / "segments_asr.json"
    if not normalized_path.exists() or not segments_path.exists():
        raise FileNotFoundError(
            f"Missing ASR artifacts in {run_dir}. Run 'preprocess' and 'asr' first."
        )

    diarized_path = run_diarization(normalized_path, segments_path, run_dir, config)
    print(f"diarized_segments={diarized_path}")


def cmd_run(args: argparse.Namespace) -> None:
    config = load_config(args.config)
    run_id = args.run_id or _make_run_id(Path(args.input))
    run_dir = _run_dir(config, run_id)

    segments_path = run_preprocess(Path(args.input), run_dir, config)
    print(f"vad_segments={segments_path}")

    transcript_path = run_asr(run_dir / "normalized.wav", segments_path, run_dir, config)
    print(f"transcript={transcript_path}")

    print(f"run_id={run_id}")
    print(f"transcript={transcript_path}")


def main() -> None:
    parser = argparse.ArgumentParser(prog="asr_pipeline")
    parser.add_argument("--config", type=Path, default=_default_config_path())
    subparsers = parser.add_subparsers(dest="command", required=True)

    p_preprocess = subparsers.add_parser(
        "preprocess", help="ffmpeg normalize + Silero VAD segmentation"
    )
    p_preprocess.add_argument("input", help="path to source audio file")
    p_preprocess.add_argument("--run-id", default=None)
    p_preprocess.set_defaults(func=cmd_preprocess)

    p_asr = subparsers.add_parser(
        "asr", help="GigaAM transcription with confidence marking"
    )
    p_asr.add_argument("run_id", help="run_id produced by a prior 'preprocess' call")
    p_asr.set_defaults(func=cmd_asr)

    p_diarize = subparsers.add_parser(
        "diarize", help="pyannote speaker diarization over an existing ASR result"
    )
    p_diarize.add_argument("run_id", help="run_id produced by a prior 'asr' call")
    p_diarize.set_defaults(func=cmd_diarize)

    p_run = subparsers.add_parser("run", help="run preprocessing and ASR end to end")
    p_run.add_argument("input", help="path to source audio file")
    p_run.add_argument("--run-id", default=None)
    p_run.set_defaults(func=cmd_run)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
