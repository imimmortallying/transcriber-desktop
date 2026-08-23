# Security-архитектура

Этот документ — source of truth для security-модели ASR: активов, угроз,
границ доверия, выбранных controls и их проверки. Он не является полным
security audit и не утверждает наличие уязвимости только из-за существования
границы. Техническое поведение модулей остаётся описанным в их собственных
документах.

## Как читать и обновлять модель

Для каждой чувствительной зоны фиксируются:

- **Asset** — что защищается;
- **Threat** — от чего нужна защита или что требует оценки;
- **Trust boundary** — где меняется уровень доверия;
- **Control** — выбранный механизм либо явно открытое решение;
- **Implementation** — конкретный модуль реализации, если он уже есть;
- **Verification** — существующая автоматическая проверка, ручная или
  ревью-проверка и отсутствующие проверки.

Статусы «реализовано», «открыто» и «не проверено» намеренно не смешиваются.
При отсутствии Control, Implementation или Verification это не следует
додумывать как защиту.

## Текущие границы и controls

### Electron renderer, preload, main и IPC

- **Asset:** локальные файлы, результаты и возможности приложения, доступные
  из интерфейса.
- **Threat:** renderer мог бы получить больше прав, чем требуется, или передать
  main-процессу некорректные данные.
- **Trust boundary:** renderer → preload → main/IPC.
- **Control:** renderer изолирован от Node, а preload предоставляет конечный
  набор операций `window.asr`; обработчики main выполняют проверку типов и
  контекстные проверки для отдельных операций.
- **Implementation:** `src/main.js` создаёт окно с `contextIsolation: true` и
  `nodeIntegration: false`; `src/preload.js` определяет доступные IPC-методы.
- **Verification:** автоматическая security-проверка не настроена; ручная или
  ревью-проверка — сверить настройки окна и публичный preload API с
  `src/preload.js`; отсутствие отдельного негативного теста IPC следует
  фиксировать при проектировании соответствующего control.

### Пользовательские пути, файлы и lifecycle run

- **Asset:** входные аудио/видео, папка результатов, `segments_asr.json`,
  транскрипты и `segments_asr.edits.json`.
- **Threat:** неожиданный путь мог бы привести к чтению, раскрытию или удалению
  данных вне управляемого run.
- **Trust boundary:** выбранные пользователем путь к входному файлу или папке
  результатов → IPC/main → файловая система и Python-пайплайн.
- **Control:** перед запуском распознавания main проверяет, что входной путь —
  файл; выбранная папка результатов проверяется на запись. Операции открытия,
  показа в проводнике и удаления run разрешены только для прямой дочерней папки
  текущей папки результатов и требуют существующий `segments_asr.json`;
  удаление требует явного подтверждения.
- **Implementation:** `src/main.js`: `validateWritableDataDirectory`,
  `getExistingManagedRunDirectory`, IPC `recognition:run`, `runs:open`,
  `run:reveal-in-folder` и `run:delete`. Формат и состав данных run — в
  [документе редактора](../editor/module.md).
- **Verification:** автоматических тестов этих security-инвариантов не найдено;
  ручная или ревью-проверка — проверить допустимые и недопустимые пути, включая
  подтверждение удаления; отдельная негативная проверка обхода границы run пока
  не определена.

### Client и ASR Runtime

- **Asset:** выбранный Client Runtime и возможность запускать его Python-код.
- **Threat:** отсутствующий, повреждённый или несовместимый Runtime мог бы
  привести к запуску неподходящего subprocess либо неясной ошибке во время
  распознавания.
- **Trust boundary:** stable launcher → fixed Coordinator → selected локальный Client → локальный ASR Runtime.
- **Control:** `src/runtime/resolveRuntime.js` определяет Runtime только из
  application-controlled packaged/dev layout: в packaged-режиме он получает
  `installationRoot` и выводит shared `<installationRoot>/Runtime`, а
  development использует исходный layout. Root-level `asr-launch.exe` выводит
  installation root из собственного каталога, валидирует только fixed
  `<ASR root>/Coordinator/asr-coordinator.exe` и передаёт ему ordinary launch без
  аргументов. Launcher не выбирает Client по filesystem. Coordinator читает
  `InstallationState` и запускает только его validated `activeClient`; он не
  принимает arbitrary executable path и не использует shell. Запущенный Client
  всё ещё получает `installationRoot` через
  `src/runtime/resolveCurrentClientInstallationRoot.js` из собственного
  `<ASR root>/Clients/<client version>/resources` layout; этот resolver не
  выбирает Client. Runtime resolver не зависит от глубины Client-каталога и не
  получает путь Runtime от пользователя. Перед
  запуском Python Client
  читает `runtime-manifest.json`, проверяет format, identity и API version, а
  также наличие Python, pipeline/config, фактического CLI entrypoint и ffmpeg.
  Имена и состав файлов модели остаются деталями реализации Runtime: Client их
  не знает. Это не криптографическая проверка целостности и не проверка
  внутренних Python зависимостей или здоровья модели. Пользовательская
  настройка пути Runtime не добавлена. Служебный uninstall/reinstall Client
  сохраняет Runtime, тогда как обычный ручной uninstall пользователя намеренно
  удаляет Runtime как внутренний компонент приложения. В поддерживаемой
  per-user установке Runtime всё ещё доступен на запись владельцу учётной записи.
- **Implementation:** `runtime-manifest.json`;
  `src/runtime/resolveCurrentClientInstallationRoot.js`;
  `src/runtime/resolveRuntime.js`; `src/recognition/runRecognition.js` вызывает
  preflight перед `spawn`.
- **Verification:** `npm run test:runtime` проверяет совместимый Runtime,
  неверные identity/API, отсутствующий или некорректный manifest, отсутствующий
  ключевой ресурс и разделение production/development Python resolution.

### InstallationState

- **Asset:** root-owned selection foundation for installed Client versions and
  the ability to recover a consistent steady installation state.
- **Threat:** malformed JSON, path traversal, attacker-controlled Client
  directory names, reparse-point escape, unknown schema downgrade, or a partial
  write could make installation infrastructure select or overwrite an unsafe
  Client path.
- **Trust boundary:** per-user installation filesystem → root launcher bootstrap
  → fixed Coordinator → InstallationState protocol → selected Client executable.
  Full Setup remains a temporary provisioning authority and deploys the
  root-owned Coordinator before launcher and state provisioning.
- **Control:** `InstallationState` contains only two bounded JSON snapshots.
  Schema v1 accepts exact typed fields, a positive generation and equal
  active/known-good single-segment Client keys. Coordinator's explicit readonly
  launch reader additionally accepts only protocol-valid schema-v2 steady,
  prepared or activated state. Before replacement Full Setup's installed-Client
  inspect receives a bounded build-time deployed-schema capability (`2`);
  absent capability is legacy v1. A `25` exit from an older installed Client is
  only a provisional schema-v2 handoff result: NSIS does not modify state, and
  the newly installed Client canonically re-reads it before writing. That Client
  may replace a valid steady, prepared or activated v2 record with a new steady
  v2 record selecting itself; it never commits the old candidate. Ambiguous,
  invalid, uninspectable and newer state fail closed without a write. Coordinator
  alone writes protocol-valid v2 prepare/activate/commit/rollback transitions.
  It derives Client paths only as `<root>/Clients/<key>`, validates canonical containment, rejects reparse
  points and requires the expected Client executable. Reader never scans
  `Clients`; unsupported schema, oversized/uninspectable slot and duplicate JSON
  keys in either slot win over otherwise valid v1 and remain read-only. Initial
  bootstrap is prepared in an internal staged directory before the complete
  two-slot state is published. Full Setup is a temporary provisioning authority
  for explicitly recognized schema-v1 corruption and the narrowly defined
  post-install schema-v2 handoff; root launcher derives its
  root only from `$EXEDIR`, validates the fixed Coordinator target for expected
  type and reparse points, and passes no arguments. Coordinator derives root only
  from its own validated
  `<root>/Coordinator/asr-coordinator.exe` geometry, reads state and validates
  only `activeClient` before ordinary process creation. Its explicit update
  command path may recover activated state to known-good and validates a
  candidate READY over inherited private IPC; it still does not scan `Clients`.
  After commit and after a valid ordinary-start state read, a separate retention
  pass derives protected Client keys only from active, known-good and any
  prepared/activated candidate reference. It may remove only a direct,
  unreferenced Client directory after validating the complete tree as ordinary,
  canonically contained non-reparse files and directories. Unsafe, incomplete,
  foreign or deletion-failed entries are retained; cleanup cannot fail an update
  or launch.
  State
  consistency does not establish selected executable authenticity. Coordinator
  remains unsigned and, like the per-user writable installation, does not resist
  same-user local tampering after installation.
- **Implementation:** `src/update/installationState.js`; early internal mode in
  `src/main.js`; `src/coordinator/main.js`; invocation and narrowly targeted
  uninstall cleanup in `build/installer.nsh`.
- **Verification:** `npm run test:update-state` covers schema, recovery,
  containment, state publication failure and unsupported-schema precedence.
  Full Setup preflight/uninstall integration has static coverage and still
  requires clean-VM validation.

Supported per-user installation remains writable by its owner. The signed update
package establishes release authenticity before extraction, but does not prevent
same-user post-install tampering, replace Authenticode, or establish long-term
Client health.

### Online Acquisition and signed Client Update package

- **Asset:** authenticity and integrity of externally supplied `.asrupdate`
  Client payload before side-by-side staging.
- **Threat:** a malicious/incorrect hosted metadata or artifact, redirect,
  unavailable/interrupted network, malformed ZIP, duplicate entry, untrusted
  signer, altered payload, unsafe extraction path, stale READY, or unrelated
  local process could make Coordinator accept arbitrary code as a Client update.
- **Control:** format v1 admits exactly `manifest.json`, `manifest.sig` and
  `client.zip`; strict duplicate-key manifest parsing, canonical Ed25519
  signature verification by `keyId`, SHA-256 and size verification happen before
  extraction. Production trusts only the pinned public Ed25519 set in
  `src/update/productionTrust.js`; production private signing material is not in
  the repository, artifacts or tests. ZIP paths, duplicates, symlinks and size
  limits fail closed. Candidate identity remains a bounded Client version, never
  an arbitrary executable path. READY uses a random attempt ID and one-time
  token over inherited private Node IPC, never argv or a public endpoint.
  Online metadata has a separate exact schema, product/Windows-x64 identity,
  bounded SHA-256/bytes and a sibling `latest.sig` canonical Ed25519 signature
  made with a distinct purpose prefix under the same pinned production key set.
  HTTPS is transport protection only; metadata signature and then package
  verification establish release authenticity. The main process fetches only a deployment-configured
  public GitHub Releases metadata asset, accepts bounded HTTPS redirects only
  among GitHub release hosts, and accepts a signed immutable GitHub Releases
  artifact URL. It writes a partial file in an application-owned temporary
  directory, validates bytes/hash, flushes and renames only on success; all
  failed/incomplete work is deleted before Coordinator is called. After a
  prepare attempt, main removes only that recorded ASR-owned temporary
  directory, never the Coordinator package-path argument; offline package files
  therefore remain user-owned.
- **Security invariant:** Online Acquisition is available only after an explicit
  user action and is outbound-only and short-lived. There are no startup or
  background requests, listening socket, arbitrary renderer-controlled URL
  fetching, remote command channel, or execution of downloaded content.
  Renderer IPC exposes parameterless check/download actions; only the existing
  local-artifact Coordinator prepare flow can consume a completed download.
- **Limits:** generated Coordinator and Client remain unsigned; local per-user
  writable installation has no post-install tamper resistance. READY means
  Runtime validation plus BrowserWindow load, not transcription or long-term
  health. Production Client embeds only the public stable
  `imimmortallying/asr-desktop-releases` latest-metadata URL;
  `ASR_ONLINE_RELEASE_METADATA_URL` is a development/test override, and no
  credential fallback exists. Electron Builder publishing is explicitly `null`,
  so it cannot infer the source repository as an auto-updater channel or embed
  `app-update.yml`; Online Acquisition is the only packaged network update path.
- **Verification:** `npm run test:update-package`, `npm run test:update-state`
  and `npm run test:coordinator` cover distinct test trust, signature/payload
  rejection, durable transitions, strict READY correlation and rollback logic.
  `npm run test:client-update-e2e` additionally exercises a real SEA
  Coordinator and packaged Electron candidate through signed test-package
  staging, READY commit, failed-READY rollback and subsequent ordinary launch.
  It never receives production signing material. `npm run test:online-update`
  uses a controlled local HTTP server through a test-only transport seam to
  cover signed/tampered/wrong-identity metadata, version decision, unavailable,
  oversized and interrupted responses, temporary-file cleanup, existing package
  verifier rejection, and static no-listener/no-renderer-URL IPC evidence. It
  is not manual GitHub Release validation.

### Python, ffmpeg и другие subprocess

- **Asset:** возможность исполнения локального кода и целостность обработки
  пользовательского медиа.
- **Threat:** некорректные пути и аргументы, недоверенный исполняемый файл или
  обработка специально подготовленного медиа требуют оценки при изменениях.
- **Trust boundary:** Electron main → Python CLI; Python pipeline → ffmpeg и
  библиотеки обработки медиа.
- **Control:** Node запускает Python через `spawn` с массивом аргументов, а
  Python запускает ffmpeg через `subprocess.run` с массивом аргументов; shell
  не используется. Production Python определяется Runtime resolver и не может
  быть заменён `ASR_PYTHON`; этот явный доверенный override работает только в
  development. Путь к ffmpeg приходит из packaged runtime-конфигурации.
- **Implementation:** `src/recognition/runRecognition.js`: `runPython` и
  `runRecognition`; `pipeline/asr_pipeline/preprocess.py`: `normalize_audio`;
  `pipeline/asr_pipeline/config.py`: `load_config`.
- **Verification:** автоматической проверки command-injection или обработки
  враждебных медиа нет; ручная или ревью-проверка — убедиться, что вызовы
  сохраняют массивы аргументов без shell и что источники executable/config
  осознанно доверены; security review декодеров и внешних компонентов ещё не
  проводился в рамках этой документации.

### Локальные данные, privacy и диагностика

- **Asset:** аудио/видео, нормализованное аудио, транскрипты, проекты правок,
  имена файлов и пути.
- **Threat:** непреднамеренное раскрытие или потеря пользовательских данных,
  включая будущие логи с путями и именами файлов.
- **Trust boundary:** локальная файловая система пользователя. Будущая передача
  диагностики создаст отдельную сетевую границу; текущий Support Report v1
  остаётся локальным до ручного вложения пользователем в письмо.
- **Control:** основное распознавание и работа с материалами остаются
  локальными. Удаление run требует подтверждения и удаляет его папку. При
  критическом recognition/Setup failure создаётся минимальный локальный
  Support Report в per-user `LOCALAPPDATA`; он исключает материалы,
  расшифровки, проекты, имена/полные пути файлов, user identifiers, IP/MAC и
  memory dump. Автоматической отправки материалов или диагностики нет.
- **Implementation:** `src/diagnostics/supportReport.js`,
  `src/recognition/runRecognition.js`, `src/main.js` и `build/installer.nsh`;
  состав, UI fallback и future delivery описаны в
  [документе диагностики](../diagnostics/module.md). Утверждённые privacy-
  принципы — в [документе продукта](../product/module.md).
- **Verification:** `npm run test:diagnostics` проверяет sanitization и
  application-owned path, `npm run test:ui-version` — narrow IPC/UI handoff,
  `npm run test:packaging` — NSIS contract. Реальный packaged failure на
  ограниченном рабочем ПК пока не validated; network sender отсутствует, а
  future retention/access/endpoint остаются отдельным решением.

### Локальные конфигурации и секреты

- **Asset:** локальные конфигурации, в том числе возможный токен диаризации.
- **Threat:** попадание секрета в Git, архив или дистрибутив.
- **Trust boundary:** локальная dev-конфигурация → исходный код и артефакт
  поставки.
- **Control:** `pipeline/config.json` исключён из Git; packaged-приложение
  получает `pipeline/config.app.example.json` как `pipeline/config.json`, а не
  локальный dev-файл.
- **Implementation:** `.gitignore`; `build/installer.nsh` и `package.json`;
  правила сборки — в [документе упаковки](../packaging/module.md).
- **Verification:** автоматического сканирования артефакта или секретов нет;
  ручная проверка состава перед внешней передачей описана в документе упаковки;
  контроль секретов в локальных архивах и каналах передачи требует отдельного
  решения.

### Windows-дистрибутив и supply chain

- **Asset:** исполняемый код, Python runtime, ffmpeg, модели и сторонние npm/
  Python-зависимости, входящие в дистрибутив, compiler, создающий stable
  launcher, и build inputs для standalone coordinator SEA executable.
- **Threat:** подмена, уязвимая или непреднамеренно изменённая зависимость либо
  ресурс сборки, включая compiler archive для stable launcher и Node host для
  coordinator SEA build.
- **Trust boundary:** внешние источники зависимостей и ресурсов → среда сборки
  → stable launcher, coordinator SEA executable и Windows-дистрибутив.
  Получение NSIS compiler и pinned Node host для coordinator — build-time
  supply-chain boundaries, отдельные от будущей verification Client update
  artifact. Node host не загружается на машинах пользователей во время runtime.
- **Control:** Node-зависимости зафиксированы `package-lock.json`; Python
  runtime-зависимости закреплены в `pipeline/requirements-app.txt`, а GigaAM
  указан commit Git-репозитория. Документ сборки задаёт источники ffmpeg,
  embeddable Python и моделей, а также проверку полного offline-дистрибутива на
  чистой машине. Stable launcher компилируется из repository-owned
  `build/stable-launcher.nsi`: `scripts/buildStableLauncher.js` получает только
  определённый в repository URL archive pinned NSIS version и сверяет bytes с
  repository-defined SHA-512 до извлечения или запуска compiler. Unverified или
  corrupted archive не используется. Machine-specific electron-builder cache и
  undocumented/private electron-builder internals не являются provenance compiler.
  Этот control защищает provenance и integrity compiler, но не устанавливает
  cryptographic trust для установленных Client releases; their signed local/offline
  verification is part of the Client Update Lifecycle. Изменение compiler origin, version,
  checksum или acquisition mechanism security-relevant и требует обновления
  этого документа. `scripts/buildCoordinator.js` получает только pinned
  Windows x64 Node `v24.16.0` по fixed official `nodejs.org` release URL,
  сверяет repository-defined SHA-256 перед использованием cached `node.exe`;
  downloaded host публикуется в cache только после успешной проверки. Hash
  mismatch aborts build; downloaded host не исполняется до успешной проверки,
  а redirects и alternate origins не принимаются. `esbuild` `0.28.2` и
  `postject` `1.0.0-alpha.6` — direct locked
  dev dependencies, а не transitive build inputs: первый bundle-ит coordinator
  JS, второй inject-ит SEA blob в verified Node host. Их package-lock integrity
  участвует в integrity зависимостей, но не равнозначна publisher/code-signing
  trust. Текущая build chain: source JS → locked esbuild bundle → SEA blob,
  generated using pinned verified Node host → locked postject injection → local
  fail-closed PE `WINDOWS_GUI` subsystem transform → `asr-coordinator.exe`.
  `dist:win` заново создаёт этот final artifact до packaging, а Full Setup
  доставляет его в root-owned `Coordinator/asr-coordinator.exe`. Slice 6A не
  вводит Authenticode signing: coordinator unsigned; verification Node build input
  не даёт local tamper resistance после установки, а per-user writable installation
  tampering остаётся отдельной future concern. Future signing, if introduced,
  belongs after SEA injection and PE transformation.
- **Implementation:** `package-lock.json`, `pipeline/requirements-app.txt`,
  `build/installer.nsh`, `build/stable-launcher.nsi`,
  `scripts/buildStableLauncher.js`, `scripts/buildCoordinator.js` и
  [документ упаковки](../packaging/module.md).
- **Verification:** автоматического vulnerability scanning, SBOM, проверки
  происхождения или подписи артефакта в проекте не зафиксировано; ручная
  проверка — действия по сборке и проверка на чистой offline VM из документа
  упаковки. `npm run build:launcher` проверяет SHA-512 до compiler use, а
  `npm run test:packaging` фиксирует pinned version, origin, checksum и отказ от
  machine-specific cache/private electron-builder internals. `npm run
  build:coordinator` verifies Node SHA-256 before host use; `npm run
  test:coordinator-sea` builds and directly runs `asr-coordinator.exe` with Node
  unavailable from its PATH. Автоматического vulnerability scanning, SBOM,
  publisher/code-signing trust или проверки local post-install tamper resistance
  для coordinator не зафиксировано. Выбор дополнительных supply-chain controls
  остаётся открытым.

## Будущие сетевые компоненты

Добровольная отправка диагностики/обратной связи и возможное лицензирование
создадут отдельные будущие сетевые trust boundaries. Их нужно проектировать
вместе с security model; они не реализованы. Online update delivery реализована
только в узкой explicit/outbound-only форме, описанной выше.

### Release Tooling v1

- **Asset:** production private signing key and optional passphrase.
- **Trust boundary:** release operator environment to repository release tooling.
- **Control:** only external file paths are supplied through
  `ASR_RELEASE_PRIVATE_KEY_FILE` and optional
  `ASR_RELEASE_PRIVATE_KEY_PASSPHRASE_FILE`. Before expensive Client work, the
  release command loads the key only to verify that it matches the pinned public
  production signer. The existing package and metadata scripts use the same
  validation. No private-key or passphrase material is written to repository
  files, command output or `dist/release-<version>`. The ignore policy also
  excludes the optional local `release-signing/` directory and common private
  key/passphrase extensions; release material still belongs outside the
  working tree whenever possible. A separate plaintext passphrase file is an
  accepted current local convenience, not a final secret-management design:
  access to both it and the encrypted key permits signing. **Future hardening
  (not implemented):** retain encrypted private keys, avoid permanent plaintext
  passphrase storage, and move to interactive passphrase input or OS-backed
  secret storage. The current release workflow is intentionally unchanged.
- **Traceability:** the precise PKCS#8 loading, key-to-pinned-public-key match,
  Ed25519 signing payloads and application verification call sites are recorded
  in [the release guide](../release-guide.md#signing-implementation-and-verification).
- **Verification:** `npm run test:release` verifies early configuration failure,
  version propagation and the allowlisted release directory contents. It does
  not receive production signing material; release-owner validation remains
  manual.

### Updater

- **Asset:** исполняемый код приложения и доверие пользователя к установленной
  версии, а также доступность последней known-good установки.
- **Threat:** подмена, повреждение или неполнота внешнего artifact,
  несанкционированная activation, failure после activation и потеря доступности
  сети.
- **Trust boundary:** installation/update infrastructure ↔ каждый внешний
  update artifact. Сеть, USB и другой физический носитель остаются внешними
  источниками; после `acquire` способ доставки не влияет на lifecycle.
- **Control:** до staging/activation artifact обязан пройти проверку
  аутентичности и целостности; несовместимый с Runtime candidate не
  активируется; previous known-good сохраняется до commit, а отсутствие READY
  приводит к rollback. Полная принципиальная модель зафиксирована в
  [Client Update Lifecycle](../client-update/module.md).
- **Implementation / Verification:** Client Update implements signed metadata
  acquisition in `src/update/onlineRelease.js`, main-owned IPC handoff in
  `src/main.js`, the existing signed-package trust model, persistent v2
  transaction, inherited private READY IPC and deterministic rollback/recovery.
  Its automated evidence and the manual `0.1.2 → GitHub → 0.1.3` production
  path are recorded in the [validation matrix](../client-update/validation.md).
  Full Setup handoff and self-update remain separate decisions.

### Диагностика, обратная связь и лицензирование

- **Asset:** технические логи, пользовательские данные и будущие сведения о
  лицензировании.
- **Threat:** неявная передача чувствительных данных, чрезмерный сбор данных
  или неясное доверие к удалённому сервису.
- **Trust boundary:** локальный ASR ↔ будущие сервисы диагностики, обратной
  связи или лицензирования.
- **Control:** утверждённая продуктовая граница — передача диагностики должна
  быть добровольной и явной, а аудио/видео, транскрипты и проекты не должны
  отправляться автоматически; логи требуют минимизации данных.
- **Implementation / Verification:** не выбраны. Конкретные протоколы,
  аутентификация, состав данных, сроки хранения, согласие и проверки должны
  быть добавлены сюда одновременно с проектированием компонента.

## Обязательное правило для изменений

Если изменение создаёт новую сетевую границу, новую trust boundary, работу с
секретами, исполнением внешнего кода или процессов либо новый класс
чувствительных данных, security-документация обновляется в том же изменении.
Если решение ещё не принято, в ней явно фиксируется открытый security-вопрос.
