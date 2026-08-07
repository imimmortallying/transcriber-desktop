import requests

from asr_pipeline.config import OllamaConfig
from asr_pipeline.structuring.base import STRUCTURING_SYSTEM_PROMPT
from asr_pipeline.structuring.ollama_backend import OllamaBackend, build_request_payload

SAMPLE_TRANSCRIPT = (
    "Добрый день. [неразборчиво 00:00:12-00:00:15] "
    "Обсудили план на неделю."
)
SAMPLE_TEMPLATE = "## Тема\n...\n## Неразборчивые фрагменты\n..."


def test_payload_preserves_markers_verbatim():
    config = OllamaConfig(host="http://localhost:11434", model="test-model")
    payload = build_request_payload(config, SAMPLE_TRANSCRIPT, SAMPLE_TEMPLATE)

    assert "[неразборчиво 00:00:12-00:00:15]" in payload["prompt"]
    assert payload["stream"] is False
    assert payload["model"] == "test-model"


def test_system_prompt_states_hard_rules():
    assert "нельзя восстанавливать" in STRUCTURING_SYSTEM_PROMPT
    assert "Нельзя добавлять факты" in STRUCTURING_SYSTEM_PROMPT


def _ollama_reachable(host: str) -> bool:
    try:
        requests.get(host, timeout=1)
        return True
    except requests.exceptions.RequestException:
        return False


def test_ollama_backend_smoke():
    """Integration smoke test - skipped if no local Ollama server is
    running, since standing one up is an external precondition this
    pipeline documents but does not automate (see pipeline/README.md)."""
    config = OllamaConfig(host="http://localhost:11434", model="REPLACE_ME")
    if not _ollama_reachable(config.host):
        import pytest

        pytest.skip("Ollama is not running on localhost:11434")

    backend = OllamaBackend(config)
    result = backend.structure(SAMPLE_TRANSCRIPT, SAMPLE_TEMPLATE)
    assert isinstance(result, str)
    assert len(result) > 0
