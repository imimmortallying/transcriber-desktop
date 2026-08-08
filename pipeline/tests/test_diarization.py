from asr_pipeline.asr import AsrSegment
from asr_pipeline.diarization import DiarizationTurn, assign_speakers


def test_assign_speakers_uses_largest_time_overlap():
    segments = [AsrSegment(start=0.0, end=5.0, text="реплика", confidence=0.9)]
    turns = [
        DiarizationTurn(start=0.0, end=1.0, speaker="SPEAKER_00"),
        DiarizationTurn(start=1.0, end=5.0, speaker="SPEAKER_01"),
    ]

    diarized = assign_speakers(segments, turns)

    assert diarized[0].speaker == "SPEAKER_01"


def test_assign_speakers_keeps_none_when_no_turn_overlaps():
    segments = [AsrSegment(start=10.0, end=12.0, text="пауза", confidence=0.9)]
    turns = [DiarizationTurn(start=0.0, end=5.0, speaker="SPEAKER_00")]

    assert assign_speakers(segments, turns)[0].speaker is None


def test_assign_speakers_breaks_ties_by_first_chronological_turn():
    segments = [AsrSegment(start=1.0, end=3.0, text="реплика", confidence=0.9)]
    turns = [
        DiarizationTurn(start=0.0, end=2.0, speaker="SPEAKER_00"),
        DiarizationTurn(start=2.0, end=4.0, speaker="SPEAKER_01"),
    ]

    assert assign_speakers(segments, turns)[0].speaker == "SPEAKER_00"
