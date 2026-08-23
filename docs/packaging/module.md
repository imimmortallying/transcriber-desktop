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
своего Client и root-level stable launcher с Coordinator. Публикация, acquisition,
The local/offline Client Update lifecycle now verifies a separately signed
`.asrupdate` and uses Coordinator-owned staging, READY, commit and rollback.
Full Setup itself still has no v2 transaction mutation or Coordinator handoff.

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

The runtime archive builder stages junctions for these payload directories and
removes the links themselves before clearing its generated staging directory; it
never recursively follows a junction into a source payload directory.

`npm run dist:win` создаёт Full Offline NSIS Setup `*.exe` в `dist/`. Он содержит
Client, Runtime и Coordinator, но устанавливает их физически раздельно:

`dist/` вне durable direct-child папок с точным именем `release-X.Y.Z` является
воспроизводимым build/test workspace. `npm run clean:dist` удаляет его обычные
файлы и директории, не выходя за canonical project `dist/`, но сохраняет все
такие `release-X.Y.Z` папки со всем содержимым. Публичный
`npm run release:public -- <version>` сам сначала откажется перезаписывать
`dist/release-<version>`, затем очистит только disposable workspace; в durable
release directory остаются только Setup, `.asrupdate`, `latest.json` и
`latest.sig`.

```text
<ASR root>/
  asr-launch.exe          # stable launch stub; not a versioned Client
  Coordinator/            # root-owned stable infrastructure
    asr-coordinator.exe
  InstallationState/      # root-owned schema-v1 snapshots
    slot-a.json
    slot-b.json
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

For every public Client version, `npm run release:public -- <version>` performs
this Full Setup build after persisting that version and stages its
`local-asr-prototype Setup <version>.exe` beside the signed Client Update assets.
This makes the Setup the single offline/new-user download for that exact Client;
the `.asrupdate` remains only for existing installations.

Перед Full Setup `npm run dist:win` собирает root-level `asr-launch.exe` из
`build/stable-launcher.nsi` и final GUI-subsystem SEA Coordinator из
`scripts/buildCoordinator.js`. `npm run build:launcher` получает pinned NSIS 3.0.4.1
из electron-builder-binaries по repository-owned URL и проверяет его SHA-512 до
компиляции; machine-specific electron-builder cache не является входом сборки.

Поддерживается только per-user установка. NSIS сохраняет собственную страницу
выбора каталога и однозначно создаёт в выбранном root `Clients/<client version>`
и `Runtime` и `Coordinator`; выбор per-machine не предлагается. Client является independently
replaceable component: служебный uninstall с `--updated` удаляет только текущий
versioned Client, а Runtime и Coordinator остаются. Обычный ручной uninstall удаляет этот Client
вместе с sibling `Runtime`, `Runtime.staging`, `Runtime.previous` и known Coordinator files. После
проверки registered `Clients/<version>` layout весь обычный, non-reparse `Clients`
tree считается installation-owned и удаляется рекурсивно, включая historical
Client Update versions; затем Setup пытается без рекурсии удалить ASR root. Runtime installer и Runtime
auto-update пока не реализованы. Local/offline Client Update реализован отдельно;
Full Setup handoff в этот transaction остаётся deferred.

Full Setup размещает standalone `asr-launch.exe` непосредственно в ASR root и
`Coordinator/asr-coordinator.exe` рядом с ним. Desktop и Start Menu shortcuts
указывают на launcher, а не на `Clients/<client version>/local-asr-prototype.exe`.
Launcher выводит root из собственного расположения, валидирует только fixed
Coordinator target и не принимает Client selection. Ordinary Coordinator launch
read-only reads `InstallationState` and starts only validated `activeClient`.
Separate explicit update commands verify/stage signed Client-only packages and
perform v2 READY/commit/rollback; they never update Runtime and Full Setup does
not invoke them.

Client Update keeps side-by-side Client directories only while state/recovery
needs them. Coordinator removes obsolete, validated non-reparse Client trees
after commit and during later valid startup housekeeping; Full Setup ownership
of Runtime, launcher, Coordinator, registry and installer cleanup is unchanged.

Windows registration `InstallLocation` и штатный electron-builder uninstaller всё
ещё временно принадлежат текущему versioned Client. Service uninstall с `--updated`
сохраняет root-level launcher, Coordinator вместе с Runtime. Обычный ручной uninstall удаляет
launcher и known Coordinator files только после существующей structural validation зарегистрированного
`Clients/<client version>` layout; затем штатный uninstall удаляет shortcuts и Client.

### Windows installer identity and stale development entries

The current Full Setup has the stable electron-builder `appId`
`ru.sber.local-asr`, is per-user only, and uses electron-builder's normal NSIS
uninstall registration at `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}`
(currently `c80ccfc2-468e-5d36-8b1f-07b50a85b600`). Its registered `InstallLocation` is the current
`<ASR root>/Clients/<version>` directory; a Full Setup version replacement
uses that single upgrade identity. The custom NSIS code does not write a
second registry key. electron-builder initially calculates `EstimatedSize`
from `InstallLocation`, which is only `Clients/<version>`. After a successful
Full Setup has deployed Runtime, Coordinator, root launcher and state, NSIS
recalculates the whole ASR root and overwrites `EstimatedSize` in that same
uninstall key. It enumerates files with FileFunc `Locate` but reads each size
through Win32 `GetFileSizeEx`, so an individual file above 2 GiB is included;
the callback returns FileFunc's required control-stack value and converts the
64-bit byte total to KiB before it is registered.
`EstimatedSize` remains a DWORD count of KiB and is capped at 4 TiB. The
directory-page install-section size is also augmented with
the unpacked Runtime size. Thus Installed Apps reports a current Full Setup
root estimate, not only the Electron Client payload.

A Client Update changes only `Clients/<version>` selection in
`InstallationState`. It does not update Windows Installed Apps metadata, the
uninstaller, the root launcher, Coordinator, Runtime, or any other Full
Setup-owned state. Therefore a changed installer display/version, uninstaller
contract, Runtime or bootstrap requires a new Full Setup, not an
`.asrupdate`.

Several Installed Apps entries, an entry whose uninstall executable is gone,
or a registered directory in an older monolithic layout are historical
development artifacts rather than behavior produced by the current stable
identity. Diagnose them before cleanup: inspect the per-user uninstall key
derived from `UNINSTALL_APP_KEY` and its `DisplayName`, `DisplayVersion`,
`InstallLocation` and `UninstallString`; confirm that `InstallLocation` and
the uninstaller file actually exist; and check whether the path matches the
current `Clients/<version>` layout. Use the registered uninstaller first.
If it is missing, stop ASR, preserve userData/results and any needed logs,
export the exact stale registry key, and remove only that verified stale key
and its verified obsolete installation directory. Do not recursively remove a
shared ASR root merely because one historical entry is broken; a current
Full Setup can then be installed as a clean repair.

После успешной установки Client, Runtime, Coordinator, launcher и shortcuts Setup запускает
internal non-UI mode установленного Client. Он временно provision/reconcile-ит
root-owned `InstallationState`; normal Electron window не открывается. Before
replacement existing registered Client Setup read-only проверяет state и передаёт
build-time capability deployed infrastructure (`max schema 2`). Отсутствующий
capability argument трактуется установленным новым Client как legacy schema-v1
Setup. Unknown/newer schema, oversized/uninspectable state или duplicate JSON
keys, недостаточная capability (`24`) и known v2 state without Full Setup v2
mutation authority (`25`) from an older installed Client is a provisional
handoff result: NSIS continues without changing state, installs the new Client,
then that new Client re-inspects and resolves the valid v2 state. Steady v2 is
rebound to the new Client; `prepared` and `activated` are completed as steady
v2 selecting the new Client, never by committing the old candidate. Invalid,
ambiguous, uninspectable and newer state still stop Setup without a state write.
NSIS не парсит JSON, а launcher по-прежнему валидирует только fixed Coordinator target.

`Runtime.staging` и `Runtime.previous` ниже относятся только к реализованной
доставке Runtime внутри Full Offline Setup. Они не задают будущий lifecycle
Client-only update: его side-by-side candidate, activation, READY и rollback
зафиксированы отдельно в [Client Update Lifecycle](../client-update/module.md).

Перед ручным sibling cleanup uninstaller сверяет `$INSTDIR` с current-user
`InstallLocation`, version leaf с `${VERSION}` и структурный сегмент `Clients`.
Только затем он выводит ASR root; при несовпадении Runtime и Coordinator не удаляются, а Client
cleanup продолжается. Runtime cleanup является best-effort: при заблокированных
файлах пользователь получает предупреждение с ASR root и оставшимся путём.
Manual uninstall после той же ownership validation узко удаляет
`InstallationState`, а после штатного удаления current Client проверяет, что
`Clients` — normal non-reparse directory, и рекурсивно удаляет этот
installation-owned tree. Если `Clients` unsafe или locked, он остаётся, и ASR
root не удаляется; то же правило действует, если tree не удалось удалить
полностью. Root никогда не удаляется рекурсивно. Service uninstall
намеренно сохраняет `InstallationState` и весь `Clients` tree.
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

An official local update package is a separate release operation:
`npm run create:update-package -- --input <Client ZIP> --output <release.asrupdate> --version <version> --key-id asr-prod-ed25519-e4cb8825e9276bf0 --private-key-file <external PEM> --private-key-passphrase-file <external text file>`. The passphrase argument is optional only for an unencrypted key. The command refuses an unpinned key ID or a private key that does not match the pinned public production anchor, builds only in a temporary directory, then stages and verifies the complete package through the production Coordinator verifier before publishing the requested output. Private key and passphrase are never repository inputs.

## Lifecycle Full Setup и удаления

| Сценарий | Client | Runtime, Coordinator и staging | Пользовательские данные |
| --- | --- | --- | --- |
| Clean install | Создаётся в `<root>/Clients/<client version>`; затем internal provisioning mode создаёт две identical generation-1 state snapshots. | Full Setup распаковывает Runtime в `Runtime.staging`, проверяет manifest и продвигает его в `<root>/Runtime`; затем staged Coordinator становится `<root>/Coordinator/asr-coordinator.exe`. | Не создаются и не удаляются установщиком. |
| Full Setup reinstall | Заменяется штатным install flow only for compatible v1 state; any valid v2 transaction state fails closed before replacement because Full Setup has no transaction mutation/handoff authority. | Новый Runtime проходит staging/promotion; Coordinator replacement сохраняет old final до staged promotion и восстанавливает его при failure where possible. | Сохраняются. |
| Runtime or Coordinator deployment failure | Compensating cleanup удаляет новый Client, shortcuts и регистрацию штатным uninstaller; previously existing launcher, Runtime и Coordinator service uninstall не удаляет. | Existing Runtime и existing Coordinator остаются unchanged before their respective promotion; interrupted recognized Coordinator protocol files are recovered where safely possible. При reinstall previous Client автоматически не восстанавливается. | Сохраняются. |
| Manual user uninstall | Штатно удаляется current versioned Client; после validation ownership layout normal non-reparse `Clients` tree рекурсивно удаляется вместе со всеми historical Client Update versions. | Best-effort удаляются sibling Runtime files и only known Coordinator protocol files; `Coordinator` удаляется только если пуст, а root — только нерекурсивно, если после cleanup пуст. | Сохраняются. |
| Service uninstall | В служебной uninstall-фазе удаляет только текущий versioned Client. | Не затрагивает launcher, Coordinator, InstallationState, Runtime, staging и backup. | Сохраняются. |
| Full Setup repair | Existing Client допускается без проверки здоровья Runtime или Coordinator. | Full Setup заново доставляет Runtime и Coordinator; это repair отсутствующего или повреждённого owned infrastructure. | Сохраняются. |
| Legacy monolith | Не изменяется автоматически. | Setup блокируется до ручного удаления legacy приложения; последующий Setup — clean install. | Сохраняются при удалении legacy приложения. |

`Runtime.staging` — временная кандидатная копия. `Runtime.previous` — временный
backup уже рабочего Runtime на время promotion. Эти директории не считаются
пользовательскими данными: при обычном uninstall они удаляются вместе с Runtime,
а при ошибке deployment сохраняются для диагностики и защиты уже рабочего Runtime.

Coordinator replacement uses only reserved files inside a validated normal
`Coordinator` directory: `asr-coordinator.staging.exe` is prepared before an
existing final executable is renamed to `asr-coordinator.previous.exe`; failed
promotion restores that previous file where possible. A subsequent Full Setup
recovers regular recognized staging/previous residue deterministically, but this
does not claim hard-power-loss atomicity. Normal uninstall deletes only these known
Coordinator files and removes `Coordinator` only when it is empty.

State provisioning failure после fresh bootstrap удаляет только state artifacts,
созданные этой попыткой. Если `InstallationState` существовал до repair/reconcile,
generic failure cleanup его не удаляет: retained snapshot может ссылаться на
удалённый compensating Client и тогда является явным repair-required состоянием,
не поводом искать Client по filesystem.

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
