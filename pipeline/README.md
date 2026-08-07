# Локальный ASR-пайплайн (препроцессинг → GigaAM → LLM-структурирование)

Отдельный Python-модуль, не связанный с Node/Electron-частью репозитория
(`src/`). Три независимо запускаемых этапа: препроцессинг аудио → распознавание
речи (GigaAM v3, `v3_e2e_rnnt`) с маркировкой неразборчивых мест → структурирование
в документ по шаблону через LLM. Всё выполняется локально; единственное
исключение — обращение к LLM-бэкенду на этапе структурирования (по умолчанию —
тоже локально, через Ollama).

Архитектурный контекст и обоснование ключевых решений — в
`C:\Users\PC_USER\.claude\plans\whimsical-scribbling-book.md` (согласованный план) и в
`../docs-audit.md` (аудит существующей документации репозитория).

## Установка

```bash
cd pipeline
python -m venv .venv
./.venv/Scripts/pip install -r requirements.txt   # Windows
# source .venv/bin/activate && pip install -r requirements.txt   # Linux/macOS
cp config.example.json config.json
```

В `config.json` обязательно укажите `structuring.ollama.model` — конкретную
модель, доступную в вашей локальной Ollama (в примере стоит `REPLACE_ME`,
намеренно невалидное значение, чтобы не подставлять по умолчанию непроверенную
модель).

GigaAM качает веса `v3_e2e_rnnt` сам при первом вызове `gigaam.load_model()`
(с проверкой хэша, официальный источник — `salute-developers/GigaAM`). ffmpeg
уже вендорен в репозитории (`../resources/bin/ffmpeg/ffmpeg.exe`), путь к нему
уже прописан в `config.example.json` — трогать не нужно.

### LLM-бэкенд (Ollama)

Нужен локально поднятый Ollama-сервер с заранее скачанной моделью:

```bash
ollama pull <модель, например qwen2.5:14b-instruct>
ollama serve
```

Пайплайн обращается к `http://localhost:11434` (или к другому хосту, если
переопределён в `config.json`) — сеть не используется, кроме loopback-запроса к
уже локально работающему серверу.

## Запуск

Каждый этап — отдельная подкоманда, каждая читает и пишет артефакты в
`data/pipeline/<run_id>/` (тот же принцип, что `data/results/<jobId>/` в
существующем воркере):

```bash
python -m asr_pipeline.cli preprocess path/to/audio.mp3
# -> run_id=..., vad_segments=data/pipeline/<run_id>/vad_segments.json

python -m asr_pipeline.cli asr <run_id>
# -> transcript=data/pipeline/<run_id>/transcript.txt

python -m asr_pipeline.cli structure <run_id>
# -> structured_document=data/pipeline/<run_id>/structured_document.md
```

Либо все три этапа сразу:

```bash
python -m asr_pipeline.cli run path/to/audio.mp3
```

## Тесты

```bash
./.venv/Scripts/pytest
```

Смоук-тесты гоняются на `tests/fixtures/sample_short.wav` — коротком (5с) реальном
образце речи, переиспользованном из `../data/uploads/smoke-short.mp3`
(тот же файл, что использовался для ручной проверки существующего воркера).
Тест LLM-бэкенда пропускается (skip), если Ollama не поднята локально — это
внешняя предпосылка, которую пайплайн документирует, но не автоматизирует.

## Известные отклонения от изначально предполагаемого плана

Зафиксированы явно, чтобы не потерялись как молчаливые допущения:

- **VAD:** `resources/models/vad/silero-vad.onnx`, уже лежащий в репозитории,
  этим пайплайном не используется. Официальный пакет `silero-vad`
  (`load_silero_vad()`) не принимает путь к произвольному файлу модели — он
  всегда грузит свою забандленную копию тех же официальных весов. Обе копии —
  official source (MIT), поэтому это не нарушает требование "веса только из
  официального источника", но вендоренный файл в `resources/` сейчас просто не
  задействован. Если это принципиально, альтернатива — писать собственный
  ONNX Runtime раннер поверх вендоренного файла, воспроизводя
  предобработку/постобработку `get_speech_timestamps()` вручную; не делали
  этого без явного запроса, поскольку это чистый дополнительный риск без
  функциональной выгоды.
- **Confidence:** `asr_pipeline/asr.py` реализует собственный decode-цикл поверх
  внутренних (не публичного API) компонентов GigaAM, а не через
  `model.transcribe()`. Причина и обоснование — в докстринге модуля.

## Точка расширения под диаризацию

Поле `speaker` в `AsrSegment`/`segments_asr.json` зарезервировано (`null`) и
никак не заполняется — диаризация вне скоупа этого пайплайна.
