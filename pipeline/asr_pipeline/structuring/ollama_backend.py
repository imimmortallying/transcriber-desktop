"""Local Ollama backend for the structuring stage. Talks to a locally
running Ollama server over plain HTTP on localhost - nothing here makes
a request to anything other than the configured local host."""

from typing import Any, Dict

import requests

from ..config import OllamaConfig
from .base import STRUCTURING_SYSTEM_PROMPT


def build_prompt(transcript: str, template: str) -> str:
    return (
        "Шаблон документа:\n"
        f"{template}\n\n"
        "Транскрипция:\n"
        f"{transcript}\n"
    )


def build_request_payload(config: OllamaConfig, transcript: str, template: str) -> Dict[str, Any]:
    """Pure request-building step, split out so prompt assembly (and the
    fact that [неразборчиво ...] markers survive it unmodified) can be
    unit-tested without a running Ollama server."""
    return {
        "model": config.model,
        "system": STRUCTURING_SYSTEM_PROMPT,
        "prompt": build_prompt(transcript, template),
        "stream": False,
    }


class OllamaBackend:
    def __init__(self, config: OllamaConfig, timeout_s: int = 600):
        self._config = config
        self._timeout_s = timeout_s

    def structure(self, transcript: str, template: str) -> str:
        payload = build_request_payload(self._config, transcript, template)
        response = requests.post(
            f"{self._config.host}/api/generate",
            json=payload,
            timeout=self._timeout_s,
        )
        response.raise_for_status()
        return response.json()["response"]
