# Client Update Lifecycle

Этот документ — source of truth для утверждённой принципиальной архитектуры
обновления Client без повторной доставки тяжёлого ASR Runtime. Он описывает
целевую модель следующего milestone, а не реализованное поведение: Client
updater, update source, verification, staging и activation coordination пока
отсутствуют. Уже реализованы release/build граница — `npm run dist:client` создаёт
один provider-neutral ZIP Client bundle без Runtime — и ограниченный stable launch
stub. Получение, verification, staging, activation и запуск полученного artifact
пока не реализованы.
Фактические Full Setup, Runtime repair и uninstall описаны в
[документе упаковки](../packaging/module.md).
Наблюдаемое текущее поведение и статус его validation собраны в
[behavioral validation matrix](validation.md); она не определяет архитектуру
следующего milestone.

В текущем Full Setup чистая Client installation размещается в
`<ASR root>/Clients/<client version>`. Также реализован root-level stable launch
stub: Windows shortcuts указывают на него, а он временно запускает единственный
каталог Client под `Clients`. Это ещё не является реализацией Client update lifecycle:
stub не хранит active/candidate/known-good, не выполняет READY, activation, recovery
или rollback. Registration `InstallLocation` и uninstaller временно остаются
принадлежностью текущего Client.

Standalone Coordinator уже реализован как отдельный SEA executable: при запуске
только из validated `<root>/Coordinator/asr-coordinator.exe` geometry он
read-only читает `InstallationState`, выбирает `activeClient`, валидирует и
создаёт его процесс. Он не делает READY/health check, repair, known-good
fallback или Client scan. Coordinator ещё не входит в normal root launcher,
Full Setup или production launch path.

Slice 5 добавляет root-owned foundation
`<ASR root>/InstallationState/slot-a.json` и `slot-b.json`. Schema v1 содержит
только `schemaVersion`, positive `generation`, равные `activeClient` и
`knownGoodClient`; transaction/candidate semantics в ней намеренно отсутствуют.
Reader читает только два slot-а, отвергает unknown schema и uninspectable state и
не выбирает Client по геометрии файловой системы. Full Setup временно provision/reconcile-ит state
через internal non-UI mode установленного Client; это не делает Client будущим
update coordinator, которым остаётся stable launch/update infrastructure.
В v1 `knownGoodClient` — bootstrap designation successful Full Setup, а не
подтверждение READY; READY semantics появится только с будущим coordinator.

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
power-loss durability directory metadata. Transactional activation/recovery
format остаётся будущей работой.

## Термины и ownership

| Термин | Значение и ответственность |
| --- | --- |
| **Client release artifact** | Официальный артефакт конкретной версии Client; создаётся и публикуется release process, а затем может быть получен из любого Update Source. |
| **Update Source** | Канал получения artifact: online delivery или offline физический носитель. После `acquire` не участвует в lifecycle. |
| **candidate** | Полностью подготовленная рядом с текущей новая версия Client; до подтверждённого запуска не является known-good. |
| **active** | Версия, которую должна запускать стабильная точка входа. |
| **known-good** | Последняя версия Client с подтверждённым READY; до commit предыдущая known-good остаётся восстанавливаемой. |
| **stable launch/update infrastructure** | Стабильная роль вне заменяемой версии Client: определяет active, запускает его и участвует в activation, recovery и rollback. Текущий `asr-launch.exe` реализует только ограниченную launch-часть этой роли: временно принимает ровно один Client и не определяет active. |
| **working Client** | Выполняет user-facing flow, discovery/acquisition и подготовку update; перед activation завершает работу и делает handoff stable infrastructure. |

После handoff transaction обязана завершаться или восстанавливаться без старого
Client process. Конкретные launcher/updater executables и их размещение не
зафиксированы.

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

Конкретные cryptographic/signing scheme, ключевая модель, storage provider,
сетевой протокол, update framework и IPC для READY намеренно не выбраны. Эти
implementation-level решения, их controls и verification будут зафиксированы
вместе с реализацией в [security-документе](../security/module.md).

## Намеренно вне scope

Этот milestone не проектирует: Runtime update lifecycle, combined upgrade,
updater self-update, update channels, staged rollout, delta updates, retention
policy, полноценную migration strategy application data, конкретный online
backend или storage, concrete launcher/updater layout, IPC, криптографию и
transaction/activation schema. Архитектурные границы не должны закрывать путь к
этим возможностям, но первая реализация остаётся простой.
