# Запуск Python-пайплайна

`src/runtime/resolveRuntime.js` формализует ASR Runtime как единый компонент:
embedded Python и зависимости, Python-пайплайн, ffmpeg, веса GigaAM и packaged
runtime-конфигурацию. В packaged-режиме он получает явный `installationRoot`,
выводит из него shared `<installationRoot>/Runtime`, возвращает Client пути к
Runtime и перед запуском
`src/recognition/runRecognition.js` проверяет manifest, идентичность,
поддерживаемую API-версию и наличие ключевых ресурсов, включая фактический
entrypoint `pipeline/asr_pipeline/cli.py`. Проверка не импортирует Python и не
проверяет здоровье модели или внутренних зависимостей.

`src/recognition/runRecognition.js` запускает `asr_pipeline.cli` для
`preprocess` и `asr` через этот Runtime. В dev-режиме используются исходные
`pipeline/`, `pipeline/.venv` и `resources/`; в packaged-режиме Runtime находится
в sibling-каталоге `<ASR root>/Runtime`, а Client — в
`<ASR root>/Clients/<client version>`.
Stable launch infrastructure уже выбирает Client через fixed Coordinator и
`InstallationState`. Сам запущенный Client пока передаёт Runtime resolver свой
`installationRoot`, который
`src/runtime/resolveCurrentClientInstallationRoot.js` выводит из текущего
`<ASR root>/Clients/<client version>/resources` layout. Это единственное место,
знающее эту геометрию; оно не выбирает Client, а Runtime resolver не зависит от
глубины Client-каталога и не получает путь Runtime от пользователя.
`ASR_PYTHON` — явный development override с полным
путём к интерпретатору. Packaged production Client его игнорирует и использует
только Python из определённого приложением Runtime.

`runtime-manifest.json` — неизменяемая часть Runtime. В нём находятся только
`manifestFormatVersion`, `runtimeId`, `runtimeVersion` и `runtimeApiVersion`;
пользователь не создаёт и не редактирует этот файл. Runtime физически отделён от
Client package; resolver выводит его путь из `installationRoot`, а не из
пользовательской настройки. Client можно заменить независимо от Runtime.
Реализованный local/offline Client Update использует уже установленный Runtime,
проверяя совместимость candidate; Runtime по-прежнему устанавливает или
восстанавливает только Full Offline Setup. Runtime auto-update не реализован.

Текущая `runtimeApiVersion` — реализованный compatibility contract для
local/offline Client Update: manifest candidate обязан ей соответствовать.
Принципиальные границы lifecycle описаны в
[Client Update Lifecycle](../client-update/module.md).

У embedded Python есть `python311._pth`, который полностью задаёт `sys.path`.
Поэтому `cwd` и `PYTHONPATH` нельзя использовать для поиска `asr_pipeline`: перед
запуском CLI JS передаёт корень `pipeline` отдельным аргументом, Python-обёртка добавляет его в
`sys.path`, а затем вызывает тот же модуль через `runpy.run_module`. `python311._pth` не менять:
он локальный ресурс сборки.

## Незавершённые прогоны

Препроцессинг создаёт каталог run и его промежуточные артефакты до появления
`segments_asr.json`. Список сохранённых прогонов Electron показывает только
каталоги с этим итоговым файлом, поэтому прерванный или завершившийся ошибкой
run в список не попадает, но его артефакты могут остаться в папке результатов.
Политика очистки, отображения статуса и диагностики таких runs пока не
реализована и требует отдельного решения.

## Source media reference и timeline validation

После успешного recognition Client записывает рядом с итоговыми ASR-артефактами
`source_media.json`. Это run-level metadata исходного файла, а не Runtime или
Python artifact: Python по-прежнему получает путь лишь для текущего запуска и
не копирует source в run. Metadata нужна будущему Client playback foundation;
состав и security boundary определены в [документе расшифровки](../editor/module.md)
и [security-модели](../security/module.md).

VAD/ASR timestamps измеряются относительно `normalized.wav`. Перед включением
Transcript Sync их соответствие original media проверяет
`npm run test:timeline-alignment`: две generated fixture (audio и video) имеют
signal на известной секунде и проходят тот же `normalize_audio`. Это automated
evidence для zero-offset path, но реальные VFR/повреждённые/экзотические source
остаются отдельной packaged validation.
