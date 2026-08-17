"""Stage 2: GigaAM v3_e2e_rnnt transcription with per-segment confidence.

GigaAM's public decode path (RNNTGreedyDecoding.decode(), in the
installed package's gigaam/decoding.py) does not expose token-level
confidence: it calls `head.joint.joint(f, g)[:, 0, 0, :].argmax(dim=-1)`
per emission step and keeps only the resulting token id, discarding the
log-softmax distribution `head.joint.joint(...)` actually returns.
`_decode_segment_with_confidence()` below replicates that same greedy
recurrence (verified by reading the installed package's decoding.py and
decoder.py directly, not from memory or documentation) against the
model's own public `head.decoder` / `head.joint` submodules, but keeps
the log-probability of each chosen token instead of throwing it away.

Simplification versus the library's RNNTGreedyDecoding.decode(): that
implementation is batched (handles many samples at once, with per-sample
active-list bookkeeping). Segments here are transcribed one at a time
(GigaAM's own 25s single-call ceiling - see LONGFORM_THRESHOLD in
gigaam/model.py - makes per-segment batching not worth the complexity
for an MVP), so the batching machinery is dropped; the emission
recurrence itself (predictor+joint per encoder step, advancing on
non-blank emissions up to max_symbols_per_step, moving to the next
encoder frame on blank) is unchanged.

transcribe_longform() is deliberately not used: it performs its own
segmentation via pyannote/segmentation-3.0, a gated Hugging Face model,
which would both bypass the required Silero VAD stage and add a
credential-gated dependency this pipeline shouldn't need. Segmentation
is done once, upstream, in preprocess.py.

GigaAM's own audio loader (gigaam.preprocess.load_audio) shells out to a
bare `ffmpeg` on PATH with no configurable path, which would bypass the
vendored ffmpeg binary the rest of this pipeline uses. It's not used
here: segments are already loaded as normalized float32 samples by
preprocess.py, so the model's input tensor is built directly from that
in-memory array (mirroring what prepare_wav() does internally) instead
of writing each segment back to disk and re-invoking ffmpeg.
"""

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np
import soundfile as sf
import torch

from .config import PipelineConfig
from .preprocess import VadSegment


def format_timecode(seconds: float) -> str:
    total_seconds = int(round(seconds))
    hours, remainder = divmod(total_seconds, 3600)
    minutes, secs = divmod(remainder, 60)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


@dataclass(frozen=True)
class AsrSegment:
    start: float
    end: float
    text: str
    confidence: float
    speaker: Optional[str] = None  # reserved for future diarization, unused for now


def mark_if_low_confidence(segment: AsrSegment, threshold: float) -> str:
    """Uses HH:MM:SS (not the spec example's MM:SS) so timecodes stay
    unambiguous past the first hour of a long recording; keeps the
    spec's en dash separator."""
    if segment.confidence >= threshold:
        return segment.text
    marker_range = f"{format_timecode(segment.start)}–{format_timecode(segment.end)}"
    return f"[неразборчиво {marker_range}]"


@torch.inference_mode()
def _decode_segment_with_confidence(model, wav_segment: np.ndarray) -> Tuple[str, float]:
    """Runs the encoder, then a single-sequence greedy RNNT decode that
    mirrors gigaam.decoding.RNNTGreedyDecoding.decode() (see module
    docstring), returning (text, confidence).

    confidence is exp(mean(log_prob)) over emitted tokens - i.e. the
    geometric mean of per-token probabilities. Geometric (not
    arithmetic) mean is used because probabilities combine
    multiplicatively along a token sequence; one low-probability token
    should pull the segment average down rather than being smoothed
    out by confident neighbors. A segment that emits no tokens (e.g. a
    VAD false positive on non-speech) gets confidence 0.0, which always
    triggers the [неразборчиво ...] marker - the conservative default.
    """
    wav_tensor = torch.from_numpy(wav_segment).to(model._device).to(model._dtype)
    wav_tensor = wav_tensor.unsqueeze(0)  # [1, samples], matches prepare_wav()
    length = torch.full([1], wav_tensor.shape[-1], device=model._device)

    encoded, encoded_len = model.forward(wav_tensor, length)  # encoded: [1, D, T]
    head = model.head
    decoding = model.decoding
    blank_id = decoding.blank_id
    max_symbols = decoding.max_symbols

    x = encoded.transpose(1, 2)  # [1, T, D]
    time_steps = min(x.shape[1], int(encoded_len[0].item()))
    device = x.device

    token_ids: List[int] = []
    token_logprobs: List[float] = []
    last_label: Optional[torch.Tensor] = None
    dec_state: Optional[Tuple[torch.Tensor, torch.Tensor]] = None

    for t in range(time_steps):
        for _ in range(max_symbols):
            frame = x[:, t : t + 1, :]  # [1, 1, D]
            if dec_state is None:
                g, hidden = head.decoder.predict(None, None, batch_size=1)
            else:
                g, hidden = head.decoder.predict(last_label, dec_state, batch_size=1)

            log_probs = head.joint.joint(frame, g)[:, 0, 0, :]  # [1, num_classes]
            token = int(log_probs.argmax(dim=-1).item())

            if token == blank_id:
                break

            token_ids.append(token)
            token_logprobs.append(float(log_probs[0, token].item()))
            last_label = torch.tensor([[token]], device=device, dtype=torch.long)
            dec_state = hidden

    text = decoding.tokenizer.decode(token_ids)
    if not token_logprobs:
        return text, 0.0

    mean_logprob = sum(token_logprobs) / len(token_logprobs)
    confidence = float(np.exp(mean_logprob))
    return text, confidence


def run_asr(
    normalized_wav: Path, vad_segments_path: Path, run_dir: Path, config: PipelineConfig
) -> Path:
    """Transcribes each VAD segment, applies confidence-based
    [неразборчиво ...] marking, and writes segments_asr.json +
    transcript.txt under run_dir. Returns the path to transcript.txt."""
    import gigaam

    raw_segments = json.loads(vad_segments_path.read_text(encoding="utf-8"))
    vad_segments = [VadSegment(**s) for s in raw_segments]

    model = gigaam.load_model(
        config.asr.model_name,
        download_root=str(config.asr.model_dir) if config.asr.model_dir else None,
    )
    model.decoding.max_symbols = config.asr.max_symbols_per_step

    audio, sample_rate = sf.read(str(normalized_wav), dtype="float32")
    if sample_rate != config.ffmpeg.sample_rate:
        raise ValueError(
            f"Expected {config.ffmpeg.sample_rate}Hz audio, got {sample_rate}Hz "
            f"from {normalized_wav}."
        )

    asr_segments: List[AsrSegment] = []
    for vad_segment in vad_segments:
        start_sample = int(vad_segment.start * sample_rate)
        end_sample = int(vad_segment.end * sample_rate)
        wav_segment = audio[start_sample:end_sample]

        text, confidence = _decode_segment_with_confidence(model, wav_segment)
        asr_segments.append(
            AsrSegment(
                start=vad_segment.start,
                end=vad_segment.end,
                text=text,
                confidence=confidence,
            )
        )

    segments_path = run_dir / "segments_asr.json"
    segments_path.write_text(
        json.dumps([asdict(s) for s in asr_segments], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    transcript_text = " ".join(
        mark_if_low_confidence(s, config.asr.confidence_threshold) for s in asr_segments
    )
    transcript_path = run_dir / "transcript.txt"
    transcript_path.write_text(transcript_text, encoding="utf-8")

    return transcript_path
