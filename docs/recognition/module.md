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
в sibling-каталоге `<ASR root>/Runtime`, а Client — в `<ASR root>/Client`.
Пока stable launch infrastructure нет,
`src/runtime/resolveCurrentClientInstallationRoot.js` временно выводит
`installationRoot` из текущего `<ASR root>/Client/resources` layout. Это
единственное место, знающее эту временную геометрию; Runtime resolver от глубины
Client-каталога не зависит и позже может получить context от stable infrastructure.
`ASR_PYTHON` — явный development override с полным
путём к интерпретатору. Packaged production Client его игнорирует и использует
только Python из определённого приложением Runtime.

`runtime-manifest.json` — неизменяемая часть Runtime. В нём находятся только
`manifestFormatVersion`, `runtimeId`, `runtimeVersion` и `runtimeApiVersion`;
пользователь не создаёт и не редактирует этот файл. Runtime физически отделён от
Client package; resolver выводит его путь из `installationRoot`, а не из
пользовательской настройки. Client можно заменить независимо от Runtime. Runtime
пока устанавливает или восстанавливает только Full Offline Setup; Runtime auto-update
и Client updater не реализованы.

Текущая `runtimeApiVersion` отражает реализованную проверку Runtime и сама по
себе не является выбранным compatibility contract для будущего Client update.
Принципиальные границы этого lifecycle, включая обязательную проверку
совместимости candidate Client с установленным Runtime, описаны в
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
