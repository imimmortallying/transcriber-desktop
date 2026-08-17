# Сборка Windows-установщика

Эта инструкция собирает установщик из чистого checkout на Windows x64. Она
готовит локальные ресурсы, которые намеренно исключены из Git, и запускает
`electron-builder`. Все команды ниже выполняются из корня репозитория в
PowerShell; для скачивания и установки Python-зависимостей нужен интернет.

## Что получится

После подготовки ресурсов структура должна содержать:

```text
resources/
  runtime-manifest.json
  bin/ffmpeg/ffmpeg.exe
  models/gigaam/v3_e2e_rnnt.ckpt
  models/gigaam/v3_e2e_rnnt_tokenizer.model
  python/python.exe
  python/python311._pth
  python/Lib/site-packages/...
```

`npm run dist:win` включит эти ресурсы в приложение и создаст NSIS-установщик
`*.exe` в `dist/`.

Это текущий полный offline-дистрибутив: он устанавливает Electron-клиент,
Python runtime, зависимости, ffmpeg и веса вместе. Runtime уже формализован
логически: `runtime-manifest.json` попадает в корень packaged resources вместе
с Python, pipeline, ffmpeg, весами и packaged config. Manifest задаёт
идентичность и базовую совместимость Runtime, но не содержит путей, секретов
или metadata обновлений.

Client и Runtime пока физически используют тот же packaged resources layout;
независимый lifecycle, отдельный Runtime installer и небольшие Client-only
обновления ещё не реализованы. Полный offline installer продолжает содержать
всё необходимое для работы без сети. Продуктовое направление зафиксировано в
[документе продукта](../product/module.md).

## Конфигурации и секреты

В сборку должен попадать только `pipeline/config.app.example.json`, который
electron-builder копирует как `pipeline/config.json`. Локальный
`pipeline/config.json` предназначен для разработки, исключён из Git и не должен
попадать в передаваемые архивы или дистрибутивы: он может содержать секреты,
например токен диаризации. Перед внешней передачей проверьте состав артефакта и
не добавляйте локальные конфигурации вручную.

## 1. FFmpeg

Нужна **статическая Windows x64 LGPL-сборка**: все нужные библиотеки находятся
в `ffmpeg.exe`, поэтому в установщик не требуется подбирать отдельные DLL. Не
берите shared-сборку, если не планируете отдельно доставлять и проверять её DLL.

Выбирайте именно LGPL-вариант, а не GPL: GPL-сборка включает GPL-only
библиотеки (например, `libx264` и `libx265`) и не соответствует лицензионному
выбору этого дистрибутива. LGPL не отменяет обязанностей по уведомлениям и
лицензиям — перед внешней раздачей проверьте их с ответственным за лицензии.

Рекомендуемый источник — [BtbN/FFmpeg-Builds releases](https://github.com/BtbN/FFmpeg-Builds/releases):
скачайте актуальный архив `ffmpeg-*-win64-lgpl.zip` **без** суффикса
`-shared`. В BtbN вариант `lgpl` исключает GPL-only зависимости, а вариант без
`-shared` содержит статические исполняемые файлы. Не используйте текущие
статические сборки gyan.dev для этого требования: их страница указывает GPLv3.

После распаковки архива скопируйте исполняемый файл в ожидаемое место. Замените
`<распакованная-папка>` на каталог из скачанного архива:

```powershell
New-Item -ItemType Directory -Force .\resources\bin\ffmpeg | Out-Null
Copy-Item <распакованная-папка>\bin\ffmpeg.exe .\resources\bin\ffmpeg\ffmpeg.exe
& .\resources\bin\ffmpeg\ffmpeg.exe -filters | findstr loudnorm
```

Последняя команда обязана вывести строку с `loudnorm`: пайплайн использует этот
фильтр при нормализации аудио. Не продолжайте сборку, если фильтра нет.

## 2. Embeddable Python 3.11.9 x64

Скачайте с [страницы Python 3.11.9](https://www.python.org/downloads/release/python-3119/)
файл **Windows embeddable package (64-bit)**. Нужна именно версия 3.11.9:
это последняя bugfix-версия ветки 3.11 с официальными Windows-бинарниками.
Более новые 3.11.x выходят только как security-фиксы в исходниках, без
инсталляторов и embeddable package.

```powershell
$pythonArchive = Join-Path $env:TEMP 'python-3.11.9-embed-amd64.zip'
Invoke-WebRequest `
  -Uri 'https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip' `
  -OutFile $pythonArchive
New-Item -ItemType Directory -Force .\resources\python | Out-Null
Expand-Archive -Path $pythonArchive -DestinationPath .\resources\python -Force
```

У embeddable Python файл `python311._pth` полностью задаёт `sys.path`. Включите
обработку `site` и добавьте место для пакетов, не меняя других строк:

```powershell
$pthPath = '.\resources\python\python311._pth'
$pth = Get-Content -Path $pthPath
$pth = $pth | ForEach-Object { if ($_ -eq '#import site') { 'import site' } else { $_ } }
if ($pth -notcontains 'Lib\site-packages') {
  $pth += 'Lib\site-packages'
}
Set-Content -Path $pthPath -Value $pth -Encoding ascii
Get-Content -Path $pthPath
```

Скачайте `get-pip.py`, установите pip и runtime-зависимости приложения. В
`requirements-app.txt` уже зафиксированы версии для CPython 3.11 x64 и CPU-колёс
PyTorch; dev-зависимости и диаризация сюда не входят.

```powershell
Invoke-WebRequest -Uri 'https://bootstrap.pypa.io/get-pip.py' -OutFile .\resources\python\get-pip.py
Push-Location .\resources\python
.\python.exe .\get-pip.py
.\python.exe -m pip install -r ..\..\pipeline\requirements-app.txt
.\python.exe -m pip check
Remove-Item .\get-pip.py
Pop-Location
```

Важно: `python311._pth` не позволяет искать `asr_pipeline` через `cwd` или
`PYTHONPATH`. Это уже обработано в `src/recognition/runRecognition.js`: он
передаёт корень пайплайна отдельным аргументом и добавляет его в `sys.path`.
Подробности — в [документе модуля запуска](../recognition/module.md). Не
пытайтесь исправлять будущую ошибку импорта правкой `PYTHONPATH`.

## 3. Веса GigaAM

В dev-режиме выполните хотя бы одно реальное распознавание: GigaAM скачает
веса в кеш `~/.cache/gigaam`. Затем скопируйте два файла модели в ресурсы
сборки:

```powershell
$gigaamCache = Join-Path $env:USERPROFILE '.cache\gigaam'
New-Item -ItemType Directory -Force .\resources\models\gigaam | Out-Null
Copy-Item (Join-Path $gigaamCache 'v3_e2e_rnnt.ckpt') .\resources\models\gigaam\v3_e2e_rnnt.ckpt
Copy-Item (Join-Path $gigaamCache 'v3_e2e_rnnt_tokenizer.model') .\resources\models\gigaam\v3_e2e_rnnt_tokenizer.model
Get-ChildItem .\resources\models\gigaam\v3_e2e_rnnt*
```

Не заменяйте эти файлы заглушками: итоговая проверка должна работать без сети.

## 4. Собрать установщик

Установите Node-зависимости и запустите Windows-сборку:

```powershell
npm install
npm run dist:win
Get-ChildItem .\dist\*.exe
```

Результат — NSIS-установщик `*.exe` в `dist/`. В текущей конфигурации
`electron-builder` используется classic NSIS-мастер (`oneClick: false`) с
выбором каталога установки (`allowToChangeInstallationDirectory: true`).

## 5. Проверка перед раздачей

Проверьте установщик на отдельной Windows x64-машине или чистой VM, где нет
установленных Python, Node.js и доступа в интернет. Не ограничивайтесь открытием
окна: установите `.exe`, выберите реальный аудио- или видеофайл и дождитесь
успешного распознавания. Убедитесь, что созданы `segments_asr.json` и
`transcript.txt`, а текст открывается в редакторе.

Перед проверкой отключите сеть и убедитесь, что глобальные интерпретаторы не
участвуют в тесте:

```powershell
Get-Command python,node -ErrorAction SilentlyContinue
```

Пустой результат этой команды предпочтителен. Если `python` или `node` всё же
найдены, это не должно влиять на packaged-приложение, но чистая машина надёжнее
доказывает, что установщик использует только вендоренные ffmpeg, Python,
зависимости и веса.
