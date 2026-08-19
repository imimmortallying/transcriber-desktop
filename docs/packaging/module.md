# Сборка Windows-установщика

Эта инструкция собирает установщик из чистого checkout на Windows x64. Она
готовит локальные ресурсы, которые намеренно исключены из Git, и запускает
`electron-builder`. Все команды ниже выполняются из корня репозитория в
PowerShell; для скачивания и установки Python-зависимостей нужен интернет.

## Что получится

### Client release artifact

`npm run dist:client` собирает provider-neutral Client-only artifact
`dist/local-asr-prototype-client-<client-version>-win-x64.zip`. В ZIP на корне
находится unpacked Windows x64 Client bundle: executable, `resources/app.asar`,
Electron runtime files и locales. Runtime, Python, модели, ffmpeg Runtime
payload, user/application data, Full Setup, NSIS helpers, blockmap, build
metadata и `app-update.yml` в него не входят. Поэтому этот ZIP является одним
release payload, который в будущем можно получить online или с физического
носителя, проверить до extraction и подготовить в version-specific Client
directory без повторной доставки Runtime.

Full Setup уже создаёт чистый versioned layout `Clients/<client-version>` для
своего Client и root-level stable launch stub. Публикация, acquisition,
authenticity verification, staging Client artifact, activation, rollback и READY
ещё не реализованы.

Перед сборкой Full Offline Setup исходный Runtime payload должен содержать:

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

`npm run dist:win` создаёт Full Offline NSIS Setup `*.exe` в `dist/`. Он содержит
Client и Runtime, но устанавливает их физически раздельно:

```text
<ASR root>/
  asr-launch.exe          # stable launch stub; not a versioned Client
  Clients/
    <client version>/     # NSIS application install directory
      local-asr-prototype.exe
      resources/app.asar
  Runtime/                # sibling; не входит в Client package
    runtime-manifest.json
    python/
    pipeline/
    bin/ffmpeg/
    models/gigaam/
```

Перед Full Setup `npm run dist:win` собирает root-level `asr-launch.exe` из
`build/stable-launcher.nsi`. `npm run build:launcher` получает pinned NSIS 3.0.4.1
из electron-builder-binaries по repository-owned URL и проверяет его SHA-512 до
компиляции; machine-specific electron-builder cache не является входом сборки.

Поддерживается только per-user установка. NSIS сохраняет собственную страницу
выбора каталога и однозначно создаёт в выбранном root `Clients/<client version>`
и `Runtime`; выбор per-machine не предлагается. Client является independently
replaceable component: служебный uninstall с `--updated` удаляет только текущий
versioned Client, а Runtime остаётся. Обычный ручной uninstall удаляет этот Client
вместе с sibling `Runtime`, `Runtime.staging` и `Runtime.previous`; затем пытается
без рекурсии удалить пустые `Clients` и ASR root. Runtime installer, Runtime
auto-update и Client updater пока не реализованы.

Full Setup теперь размещает standalone `asr-launch.exe` непосредственно в ASR root.
Desktop и Start Menu shortcuts указывают на него, а не на
`Clients/<client version>/local-asr-prototype.exe`. Это намеренно минимальный
stable launch stub: он выводит root из собственного расположения, временно принимает
ровно один каталог в `Clients` и запускает только его ожидаемый Client executable.
Он не хранит active/candidate/known-good state, не выполняет READY, verification,
activation, rollback или Runtime operations.

Windows registration `InstallLocation` и штатный electron-builder uninstaller всё
ещё временно принадлежат текущему versioned Client. Service uninstall с `--updated`
сохраняет root-level launcher вместе с Runtime. Обычный ручной uninstall удаляет
launcher только после существующей structural validation зарегистрированного
`Clients/<client version>` layout; затем штатный uninstall удаляет shortcuts и Client.

`Runtime.staging` и `Runtime.previous` ниже относятся только к реализованной
доставке Runtime внутри Full Offline Setup. Они не задают будущий lifecycle
Client-only update: его side-by-side candidate, activation, READY и rollback
зафиксированы отдельно в [Client Update Lifecycle](../client-update/module.md).

Перед ручным sibling cleanup uninstaller сверяет `$INSTDIR` с current-user
`InstallLocation`, version leaf с `${VERSION}` и структурный сегмент `Clients`.
Только затем он выводит ASR root; при несовпадении Runtime не удаляется, а Client
cleanup продолжается. Runtime cleanup является best-effort: при заблокированных
файлах пользователь получает предупреждение с ASR root и оставшимся путём.
Electron userData, settings, transcripts, default results и внешняя results
directory не относятся к installation lifecycle и не удаляются ни ручным, ни
служебным uninstall.

Размер Runtime для страницы выбора каталога не задан вручную: `npm run dist:win`
измеряет unpacked payload и генерирует временный `build/runtime-size.nsh`. Setup
показывает final размер Client + Runtime. Перед распаковкой он отдельно проверяет
свободное место для сжатого Runtime archive на системном temporary drive
(`$PLUGINSDIR`) и для unpacked staging-копии на выбранном ASR root. Поэтому при
reinstall на root должно быть свободно место ещё для одной Runtime-копии.

Runtime archive materialизуется в `$PLUGINSDIR\runtime.7z`, а bundled `7za.exe`
распаковывает его в `Runtime.staging`. Setup проверяет exit code и staging
`runtime-manifest.json`. При сбое сообщение содержит этап, archive path, его
размер из build metadata, destination path и краткий вывод `7za.exe`; staging
сохраняется для диагностики. Поскольку Client files, shortcuts и registry уже
созданы до Runtime deployment, Runtime failure запускает временную копию
штатного нового Client uninstaller с сохранением Electron userData. Он удаляет
только текущий versioned Client и его registration/shortcuts, не трогая sibling `Runtime`,
`Runtime.staging` или `Runtime.previous`.

Legacy per-user установка с тем же application identity не мигрируется
автоматически. При точном legacy marker
`<InstallLocation>\resources\python\python.exe` Setup останавливается и просит
сначала удалить старую версию через Установленные приложения Windows; userData и
results при этом сохраняются. После ручного удаления повторный Full Setup является
обычной clean install. Legacy all-users/per-machine установка также блокирует Setup
и требует ручного удаления.

Уже новая registered Client installation распознаётся только по
`<ASR root>\Clients\<client version>` и её штатному uninstaller: Setup проверяет
сегмент `Clients`, непустой version leaf и выводит root лишь после этой структурной
проверки. Здоровье sibling Runtime не проверяется, поэтому Full Setup может
восстановить отсутствующий или повреждённый Runtime. Промежуточный старый layout
`<ASR root>\Client` не поддерживается и не мигрируется; нераспознанный или
неполный registered layout блокируется без автоматического удаления. При failed
reinstall compensating cleanup сохраняет previous Runtime, но не восстанавливает
previous Client: штатный upgrade flow уже заменил Client до Runtime deployment.

## Lifecycle Full Setup и удаления

| Сценарий | Client | Runtime и staging | Пользовательские данные |
| --- | --- | --- | --- |
| Clean install | Создаётся в `<root>/Clients/<client version>`. | Full Setup распаковывает Runtime в `Runtime.staging`, проверяет manifest и продвигает его в `<root>/Runtime`. | Не создаются и не удаляются установщиком. |
| Full Setup reinstall | Заменяется штатным install flow. | Новый payload сначала проходит staging; существующий `Runtime` временно становится `Runtime.previous`, а после успешного promotion удаляется. | Сохраняются. |
| Runtime deployment failure | Compensating cleanup удаляет новый Client, shortcuts и регистрацию штатным uninstaller; launcher, существовавший до reinstall, service uninstall не удаляет. | Existing `Runtime`, `Runtime.previous` и диагностический `Runtime.staging` не удаляются. При reinstall previous Client автоматически не восстанавливается. | Сохраняются. |
| Manual user uninstall | Штатно удаляется текущий versioned Client; root-level launcher удаляется только после validation ownership layout. | Best-effort удаляются sibling `Runtime`, `Runtime.staging` и `Runtime.previous`; затем пустые `Clients` и root удаляются только без рекурсии. | Сохраняются. |
| Service uninstall | В служебной uninstall-фазе удаляет только текущий versioned Client. | Не затрагивает launcher, Runtime, staging и backup. | Сохраняются. |
| Full Setup repair | Existing Client допускается без проверки здоровья Runtime. | Full Setup заново доставляет Runtime; это repair отсутствующего или повреждённого Runtime. | Сохраняются. |
| Legacy monolith | Не изменяется автоматически. | Setup блокируется до ручного удаления legacy приложения; последующий Setup — clean install. | Сохраняются при удалении legacy приложения. |

`Runtime.staging` — временная кандидатная копия. `Runtime.previous` — временный
backup уже рабочего Runtime на время promotion. Эти директории не считаются
пользовательскими данными: при обычном uninstall они удаляются вместе с Runtime,
а при ошибке deployment сохраняются для диагностики и защиты уже рабочего Runtime.

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

Результат — Full Offline NSIS-установщик `*.exe` в `dist/`. В текущей
конфигурации `electron-builder` используется per-user classic NSIS-мастер
(`oneClick: false`, `allowElevation: false`) с собственной страницей выбора
каталога. `build/installer.nsh` доставляет
Runtime в sibling-каталог; Runtime не входит в `extraResources` Client package.

## 5. Проверка перед раздачей

На чистой Windows VM вручную проверьте clean per-user install, выбор другого
диска, блокировку legacy per-user для default и custom path с последующей clean
install, блокировку legacy per-machine, reinstall Full Setup, repair current Client
с отсутствующим Runtime, ручной uninstall с удалением Runtime и сохранностью
`userData`/результатов, а также service uninstall с сохранением Runtime. Эти сценарии
не покрываются Node-тестами.

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
