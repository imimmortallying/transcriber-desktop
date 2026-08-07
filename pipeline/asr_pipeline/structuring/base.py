"""Abstraction over LLM backends for the structuring stage. Every backend
must obey the same hard rules regardless of implementation, which is why
the rules live here once rather than being duplicated per backend."""

from typing import Protocol

STRUCTURING_SYSTEM_PROMPT = """\
Ты помогаешь структурировать транскрипцию аудиозаписи по заданному шаблону документа.

Жёсткие правила, которые нельзя нарушать:
1. Текст в маркерах вида [неразборчиво HH:MM:SS-HH:MM:SS] нельзя восстанавливать, \
додумывать или сглаживать. Переноси такие маркеры в итоговый документ дословно, \
вместе с таймкодами, на том месте, где они логически относятся по шаблону.
2. Нельзя добавлять факты, сведения или детали, которых нет в исходной транскрипции.
3. Можно и нужно: переставлять и группировать фрагменты текста по разделам шаблона, \
если это соответствует смыслу.
4. Нельзя менять смысл исходного текста при перестановке или сокращении.

Верни только заполненный документ по структуре шаблона, без пояснений от себя.
"""


class StructuringBackend(Protocol):
    def structure(self, transcript: str, template: str) -> str:
        """Takes the stage-2 transcript (with inline [неразборчиво ...]
        markers) and a template document, returns the filled-in
        structured document as text."""
        ...
