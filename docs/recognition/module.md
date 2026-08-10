# Запуск Python-пайплайна

`src/recognition/runRecognition.js` запускает `asr_pipeline.cli` для
`preprocess` и `asr`. В dev-режиме используется `pipeline/.venv`, в packaged-режиме —
embedded Python из `resources/python` и пакет из `resources/pipeline`.

У embedded Python есть `python311._pth`, который полностью задаёт `sys.path`.
Поэтому `cwd` и `PYTHONPATH` нельзя использовать для поиска `asr_pipeline`: перед
запуском CLI JS передаёт корень `pipeline` отдельным аргументом, Python-обёртка добавляет его в
`sys.path`, а затем вызывает тот же модуль через `runpy.run_module`. `python311._pth` не менять:
он локальный ресурс сборки.
