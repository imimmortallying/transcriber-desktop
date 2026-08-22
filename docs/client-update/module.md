# Client Update Lifecycle

Этот документ — source of truth для Client Update без повторной доставки тяжёлого
ASR Runtime. Реализован общий lifecycle local/offline update и Online Acquisition
v1: Client по явному действию пользователя либо выбирает локальный `.asrupdate`,
либо проверяет и скачивает подписанный online release в свой temporary location.
Coordinator в обоих случаях получает только локальный artifact, проверяет подпись
и payload, готовит side-by-side candidate, а после явно подтверждённого restart
выполняет activation, READY, commit либо rollback. Runtime update и combined
upgrade по-прежнему вне этого блока.
Фактические Full Setup, Runtime repair и uninstall описаны в
[документе упаковки](../packaging/module.md).
Наблюдаемое текущее поведение и статус его validation собраны в
[behavioral validation matrix](validation.md); она не определяет архитектуру
следующего milestone.

## Current checkpoint — local/offline lifecycle + Online Acquisition v1

Coordinator starts the selected GUI Client, including an update candidate, with
the normal Windows show state. It must not pass `windowsHide`: that flag leaves
Electron subprocesses alive while suppressing the user-facing window.

This checkpoint is complete. It covers a locally supplied signed `.asrupdate`,
an explicit main-process-only online acquisition path, Coordinator-owned
side-by-side staging, durable v2 prepare/activate/commit/rollback state,
correlated inherited-IPC READY from the packaged Client, and ordinary launch
from the resulting durable selection. It does not make Full Setup an
update-transaction owner. The explicitly deferred directions, without an
implied priority, are listed in
[Намеренно вне scope](#намеренно-вне-scope).

В текущем Full Setup чистая Client installation размещается в
`<ASR root>/Clients/<client version>`, а stable infrastructure — в ASR root.
Windows shortcuts указывают на root-level launcher; он валидирует fixed
`<ASR root>/Coordinator/asr-coordinator.exe` target и передаёт ему запуск.
Launcher не сканирует `Clients` и не выбирает версию. Full Setup собирает и
доставляет этот Coordinator как root-owned infrastructure, а не как Client-version
content. Registration `InstallLocation` и uninstaller временно остаются
принадлежностью текущего Client.

Standalone Coordinator реализован как отдельный GUI-subsystem SEA executable. Его
ordinary launch из validated `<root>/Coordinator/asr-coordinator.exe` geometry
по-прежнему только читает state, валидирует и создаёт `activeClient`. Отдельные
явные update-команды принадлежат Coordinator: они подготавливают candidate,
публикуют v2 transaction, запускают candidate через private inherited Node IPC,
ждут READY и выполняют commit или rollback. Ordinary launcher не передаёт
update-аргументы и не сканирует `Clients`.

Slice 5 добавляет root-owned foundation
`<ASR root>/InstallationState/slot-a.json` и `slot-b.json`. Schema v1 содержит
только `schemaVersion`, positive `generation`, равные `activeClient` и
`knownGoodClient`; transaction/candidate semantics в ней намеренно отсутствуют.
Reader читает только два slot-а, отвергает unknown schema и uninspectable state и
не выбирает Client по геометрии файловой системы. Full Setup временно provision/reconcile-ит state
через internal non-UI mode установленного Client; это не делает Client будущим
update coordinator, которым остаётся stable launch/update infrastructure.
В v1 `knownGoodClient` — bootstrap designation successful Full Setup. В v2 после
успешного update commit он означает Client, подтвердивший ограниченный READY.

## Граница milestone

Client release создаётся независимо от Runtime. Официальный artifact Client —
`local-asr-prototype-client-<client-version>-win-x64.zip`: ZIP с одним unpacked
Windows x64 Client bundle без Runtime, user/application data и provider-specific
update metadata. Он подходит как минимум для двух способов доставки: online и
offline с физического носителя. После получения artifact способ доставки не
влияет на дальнейший lifecycle.

Обычный Client update изменяет только Client и использует установленный Runtime
лишь при соответствии явному compatibility contract. Он не переустанавливает,
не модифицирует и не начинает автоматически обновлять Runtime. Runtime update
или combined upgrade остаются отдельным будущим lifecycle.

Full Setup / repair обслуживает переход к здоровой установке и восстановление
серьёзно повреждённой установки; Client updater не является универсальным
repair-механизмом.

## Lifecycle

```text
release/build
  -> publish
  -> acquire
  -> verify
  -> Client/Runtime compatibility check
  -> staging
  -> handoff
  -> activation
  -> launch candidate
  -> startup validation / READY
  -> commit | rollback
  -> non-critical cleanup
```

`acquire` получает artifact из online или offline Update Source. `verify` и
compatibility check происходят до staging и activation. Большие или
потенциально ненадёжные операции выполняются до activation; это короткое,
устойчивое к внезапному прерыванию логическое переключение installation state.
Slice 5 реализует staged initial publication и two-slot snapshots только для
steady schema v1. File flush + rename дают process/interrupted-write recovery
при normal Windows filesystem assumptions; это не доказанная гарантия hard
power-loss durability directory metadata. Transactional activation/recovery is
implemented through schema v2; this statement does not claim stronger
hard-power-loss atomicity.

## Release Tooling v1

Routine production release composition lives in `npm run release:client --
<version>`. It first validates external signing-path configuration, then writes
the version into package metadata, runs the existing Client ZIP build and the
existing signed package/metadata scripts. It places the three upload-ready files
in `dist/release-<version>/`: the verified `.asrupdate`, `latest.json` and
`latest.sig`. Publishing them to the version tag and latest GitHub Release is a
manual step. The private key and optional passphrase contents are
never repository or release-output inputs. `npm run release:full -- <version>`
is intentionally separate and invokes the existing Full Setup build only when
Runtime or installation infrastructure must be rebuilt. See
[`release-guide.md`](../release-guide.md) for the release procedure.

## Online Acquisition v1

The production path was manually exercised once from `0.1.2` through public
GitHub discovery/download, prepare, restart, READY and commit to `0.1.3`; the
resulting schema-v2 slots selected `0.1.3` as both active and known-good. This
is validation evidence, not a new lifecycle rule; the complete evidence and
remaining coverage are recorded in [the validation matrix](validation.md).

Online check is an explicit user action in the working packaged Client; it does
not run at ordinary application startup and has no background scheduler. The
renderer can invoke only `check-online` and `download-online` IPC actions with
no URL argument. `src/main.js` owns the short-lived outbound HTTPS requests and
keeps metadata selected by a check only in main-process memory.

Production Clients embed the stable public metadata asset
`https://github.com/imimmortallying/asr-desktop-releases/releases/latest/download/latest.json`.
`ASR_ONLINE_RELEASE_METADATA_URL` is only a development/test override; it never
supplies a token or other distribution secret. The discovery URL and signed
artifact URL are HTTPS GitHub Releases asset paths. Redirects are bounded and
allowed only to the GitHub release-host set; a signed artifact URL must be
version-specific, not `latest`.

The compact JSON metadata has exact schema-v1 fields: `schemaVersion`, purpose
`asr-client-online-release-v1`, `keyId`, product `local-asr-prototype`, target
`win-x64`, Client version, immutable artifact URL and artifact SHA-256/byte
count. Its adjacent stable `latest.sig` asset contains only the Ed25519
signature. Client fetches both during the same explicit check, before any
version decision. It reuses `PRODUCTION_TRUSTED_SIGNERS`, but signs canonical
metadata with the distinct `ASR online release metadata v1\0` purpose prefix.
The package signature is therefore not valid metadata and vice versa. Remote
version must be numerically newer than the installed Client; same and older
versions never download or prepare a downgrade.

Release process first creates and production-verifies the official `.asrupdate`,
then runs `scripts/createOnlineReleaseMetadata.js` with that artifact, its
immutable version-specific GitHub Releases asset URL, matching `keyId`, and an
external production private-key file. The script derives package bytes/hash,
uses the existing production trust anchor, refuses non-GitHub/non-immutable
artifact URLs and produces sibling `latest.json` and `latest.sig` without
overwriting either. Neither private key nor passphrase is copied into the
repository, generated output or Client.

The package script stages its archive in the OS temporary directory. If that
directory is on another volume, its final no-overwrite move falls back to an
exclusive copy after the same production verification.

The main process creates that unique application-owned temporary directory once
with `mkdtemp`; download writes `client.asrupdate.partial` inside it, verifies
signed size and SHA-256, flushes it, then
renames it to `.asrupdate`. Network error, interruption, redirect failure,
overflow or integrity mismatch removes the temporary directory and does not
touch InstallationState. Completion still does not trust or execute content:
the unchanged Coordinator `prepare` command performs the existing package
signature, ZIP, payload and Runtime-compatibility verification before staging.
The temporary artifact is removed after that prepare attempt.

## Термины и ownership

| Термин | Значение и ответственность |
| --- | --- |
| **Client release artifact** | Официальный артефакт конкретной версии Client; создаётся и публикуется release process, а затем может быть получен из любого Update Source. |
| **Update Source** | Канал получения artifact: online delivery или offline физический носитель. После `acquire` не участвует в lifecycle. |
| **candidate** | Полностью подготовленная рядом с текущей новая версия Client; до подтверждённого запуска не является known-good. |
| **active** | Версия, которую должна запускать стабильная точка входа. |
| **known-good** | Последняя версия Client с подтверждённым READY; до commit предыдущая known-good остаётся восстанавливаемой. |
| **stable launch/update infrastructure** | Стабильная роль вне заменяемой версии Client: root `asr-launch.exe` передаёт ordinary launch standalone Coordinator, а explicit Coordinator update commands own activation, READY, recovery and rollback. |
| **working Client** | Выполняет user-facing flow, discovery/acquisition и подготовку update; перед activation завершает работу и делает handoff stable infrastructure. |

После handoff transaction обязана завершаться или восстанавливаться без старого
Client process. The stable executables are fixed: root `asr-launch.exe` invokes
`<ASR root>/Coordinator/asr-coordinator.exe`; Coordinator owns the explicit
local/offline transaction commands.

## Ownership этапов

| Этап | Владелец |
| --- | --- |
| release/build и publish | Release process создаёт и публикует Client artifact независимо от Runtime. |
| acquire | Working Client принимает artifact из выбранного Update Source. |
| verify, compatibility check и staging | Update flow отвечает за проверку artifact, совместимости Client/Runtime и полную подготовку candidate. |
| handoff | Working Client завершает работу и передаёт transaction stable launch/update infrastructure. |
| activation, launch, READY, commit, rollback и recovery | Stable launch/update infrastructure переключает active, запускает candidate, ждёт READY и сохраняет либо восстанавливает installation state. |
| non-critical cleanup | Может выполняться после commit и не влияет на успешность transaction. |

Security является частью этой архитектуры с самого начала: проверка недоверенного
artifact — обязательный этап lifecycle, а не post-factum дополнение.

## Инварианты

- Внешний artifact недоверен независимо от источника — сети, USB или другого
  носителя — пока не прошёл проверку аутентичности и целостности.
- До activation candidate совместим с установленным Runtime согласно явному
  compatibility contract. При несовместимости update прекращается, а текущая
  установка остаётся рабочей.
- Client versions готовятся side-by-side; замена файлов поверх текущей версии
  не является базовой моделью.
- Activation меняет только active state после полного staging. До commit
  previous known-good остаётся восстанавливаемой.
- Запуск процесса candidate не равен успеху update. Успех наступает только
  после critical initialization и явного READY / healthy startup, затем commit.
- После commit новая версия становится одновременно active и known-good.
  Cleanup предыдущей версии не входит в критический commit.
- Client binaries, Runtime и application/user data — разные lifecycle domains.
  Binary rollback не считается полноценным, если новая версия необратимо
  изменила persistent data так, что known-good Client больше не может её читать.
- Online Acquisition is explicit, outbound-only and short-lived: no startup or
  background check, listening socket, renderer-controlled remote URL, remote
  command channel or execution of downloaded content exists in this lifecycle.

### InstallationState schema v1

```json
{
  "schemaVersion": 1,
  "generation": 1,
  "activeClient": { "version": "0.1.0" },
  "knownGoodClient": { "version": "0.1.0" }
}
```

`version` — validated single path segment: protocol строит только
`<ASR root>/Clients/<version>`, а arbitrary paths не хранит. Bootstrap создаёт
две semantically identical generation-1 snapshots. Higher generation побеждает
только между valid snapshots; equal generation с разным semantic content —
ошибка, не выбор по имени slot-а или времени файла. Один valid slot может
восстановить redundancy с generation + 1. Только JSON object, явно помеченный
`schemaVersion: 1`, но не проходящий v1 validation, считается repairable under
explicit Full Setup authority. Unknown/newer schema, oversized/uninspectable
slot и structurally ambiguous JSON (включая duplicate keys) имеют приоритет над
valid v1 и приводят к read-only abort: старый Full Setup не удаляет и не
перезаписывает такие state files.

### InstallationState schema v2 transaction protocol

Schema v2 stores the durable Coordinator-owned transaction:

```json
{
  "schemaVersion": 2,
  "generation": 1,
  "activeClient": { "version": "0.1.0" },
  "knownGoodClient": { "version": "0.1.0" },
  "updateTransaction": null
}
```

`updateTransaction` is either `null`, or an exact object with `phase`
(`prepared` or `activated`) and `candidateClient` using the same bounded
`{ "version" }` Client identity. Steady state has matching active and
known-good Clients. A prepared transaction keeps active equal to known-good and
uses a different candidate; an activated transaction makes active equal to the
candidate while retaining a different known-good Client.

Coordinator upgrades a steady v1 state only for a verified prepared candidate,
then durably writes `prepared`, `activated`, and a v2 steady state after commit
or rollback. Prepared keeps active equal to known-good; activated makes the
candidate active while preserving the prior known-good. An ordinary Coordinator
launch rolls back interrupted activated state before it creates a Client process;
prepared state continues to launch known-good and can be explicitly cancelled.

Full Setup remains readonly v1/v2-aware but has no v2 mutation or recovery
authority. Any valid v2 state, including either transaction phase, fails closed
before Full Setup replacement. Bootstrap, provision and reconcile remain v1-only;
Full Setup handoff and cross-version Full Setup delivery are future work.

## Failure, rollback и recovery

| Момент отказа | Обязательный результат |
| --- | --- |
| До activation, включая verify или compatibility check | Update прекращается; current installation не изменяется. |
| Между activation и commit, включая отсутствие READY | Active возвращается к previous known-good; выполняется rollback/recovery. |
| После commit | Ошибка non-critical cleanup не должна ломать рабочую установку. |
| Crash или power loss при незавершённой transaction | Persistent installation/update state позволяет распознать состояние и детерминированно завершить recovery. |

## Trust и security responsibilities

Trust boundary проходит между installation/update infrastructure и каждым
внешним update artifact до его verification; канал доставки не делает artifact
доверенным. До staging/activation security-модель требует ответственности за
аутентичность и целостность artifact, корректную обработку недоверенного или
повреждённого результата и сохранение рабочей known-good версии.

`.asrupdate` format v1 has exactly `manifest.json`, `manifest.sig` and
`client.zip`. Its canonical signed manifest contains a format version, `keyId`,
bounded Client version, Runtime API version, payload SHA-256 and payload size.
Production verification accepts only the pinned Ed25519 public trust anchor in
`src/update/productionTrust.js`; its private key remains outside this repository,
build outputs and test fixtures. Tests use a separate trust root that production
verification never accepts. The key ID supports additive future key rotation.

READY uses dedicated inherited Node IPC only for candidate validation. Coordinator
sends a random attempt ID and one-time token over IPC (never argv), and accepts
one exact matching response after the packaged Electron Client has validated the
Runtime and loaded its BrowserWindow. It proves minimum UI/Runtime startup, not
transcription correctness or long-term health.

## Намеренно вне scope

This completed checkpoint explicitly defers the following directions, without
selecting their order or design:

- Runtime update lifecycle and combined Client/Runtime upgrade;
- Coordinator/launcher self-update;
- staged rollout, channels and delta updates;
- retention policy and a complete application-data migration strategy;
- online backend or storage;
- Full Setup handoff and cross-version delivery through this transaction;
- candidate code signing and Authenticode.

The implemented boundaries do not preclude these directions, but Client Update
remains intentionally narrow.
