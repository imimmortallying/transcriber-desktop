# Client Update Lifecycle

Этот документ — source of truth для утверждённой принципиальной архитектуры
обновления Client без повторной доставки тяжёлого ASR Runtime. Он описывает
целевую модель следующего milestone, а не реализованное поведение: Client
updater, update source и соответствующая инфраструктура пока отсутствуют. Уже
реализована только release/build граница: `npm run dist:client` создаёт один
provider-neutral ZIP Client bundle без Runtime. Получение, verification, staging,
activation и запуск этого artifact пока не реализованы.
Фактические Full Setup, Runtime repair и uninstall описаны в
[документе упаковки](../packaging/module.md).

В текущем Full Setup чистая Client installation уже размещается в
`<ASR root>/Clients/<client version>`, но это не является реализацией Client
update lifecycle: versioned directory пока принадлежит обычному Full Setup, а
registration, direct shortcuts и uninstaller временно принадлежат текущему Client.

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
Конкретный атомарный механизм пока не выбран.

## Термины и ownership

| Термин | Значение и ответственность |
| --- | --- |
| **Client release artifact** | Официальный артефакт конкретной версии Client; создаётся и публикуется release process, а затем может быть получен из любого Update Source. |
| **Update Source** | Канал получения artifact: online delivery или offline физический носитель. После `acquire` не участвует в lifecycle. |
| **candidate** | Полностью подготовленная рядом с текущей новая версия Client; до подтверждённого запуска не является known-good. |
| **active** | Версия, которую должна запускать стабильная точка входа. |
| **known-good** | Последняя версия Client с подтверждённым READY; до commit предыдущая known-good остаётся восстанавливаемой. |
| **stable launch/update infrastructure** | Стабильная роль вне заменяемой версии Client: определяет active, запускает его и участвует в activation, recovery и rollback. Это архитектурная роль, а не выбранный executable layout. |
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
механизм атомарной записи. Архитектурные границы не должны закрывать путь к этим
возможностям, но первая реализация остаётся простой.
