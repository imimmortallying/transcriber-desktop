# Локальные технические отчёты

Этот документ — source of truth для Support Report v1: локальной диагностики
критических сбоев без отправки пользовательских материалов или фоновой сети.
Он не определяет будущий сервис поддержки и не заменяет security-модель.

## Назначение

Отчёт помогает устранить сбой на удалённом рабочем ПК, когда разработчик не
имеет к нему доступа. Он создаётся автоматически, но отправляется пользователю
вручную: приложение открывает готовый один `.txt`-файл, который пользователь
или посредник прикладывает к письму `imimmortallyingwork@yandex.ru`.

Кнопки автоматической сетевой отправки в этой версии нет. Она появится только
вместе с отдельным явно спроектированным endpoint поддержки.

## Два источника ошибок

- **Recognition Support Report** создаётся при неудачном запуске или выполнении
  распознавания. Renderer показывает краткую ошибку и кнопку «Открыть файл
  отчёта», а не Python traceback.
- **Install Report** создаётся текущим per-user Full Setup на его критических
  fail-closed ветках: legacy/неизвестная зарегистрированная установка,
  compatibility preflight, Runtime archive/staging/extraction и provisioning
  InstallationState. Он особенно нужен, поскольку Electron Client при таком
  сбое может не запуститься.

Оба вида сохраняются в принадлежащую текущему пользователю папку
`%LOCALAPPDATA%\Local ASR\support-reports\`. Если `LOCALAPPDATA` недоступна
у Electron, Recognition Report использует его `userData` только как fallback.
Папка «Загрузки» не является частью контракта.

## Состав Support Report v1

Один UTF-8 `.txt` содержит format version, случайный report ID, timestamp,
Client version, contact, Windows/platform/architecture/locale, Node/Electron
версии, код сбоя и безопасный текст ошибки. Для распознавания он дополнительно
фиксирует только расширение исходного медиа, Runtime manifest identity/version/API
и результат отдельных import probes `torch`, `torchaudio`, `soundfile` и
`onnxruntime`, а также наличие Python, ffmpeg, `libtorchaudio.pyd` и
`torch_cpu.dll`. Probes не читают медиа и не передают данные по сети.

Install Report фиксирует версию Setup, per-user scope, этап и техническую
причину. Полные install paths не записываются.

Отчёт **не содержит** аудио, видео, текста расшифровки, проекта редактора,
имён исходных файлов, полных путей, имени пользователя, IP/MAC-адресов,
аппаратных идентификаторов, списка программ или memory dump. Ошибка и stack
санитизируются от Windows и POSIX user paths перед записью.

## Коды и обработка

Recognition сейчас классифицирует `ASR-RUNTIME-NATIVE-LOAD` (в том числе
`torch`/`torchaudio`), `ASR-ACCESS-DENIED`, `ASR-FFMPEG-FAILED` и fallback
`ASR-RECOGNITION-FAILED`. Код позволяет сопоставить обращения от разных
пользователей, но сам по себе не является root cause.

Отчёт не заменяет исправление: для каждого полученного report ID владелец
фиксирует отдельно symptom, root cause, затронутые версии, исправляющий релиз и
evidence проверки. Если локальный файл не удалось создать, UI показывает только
код и контакт; исходная ошибка распознавания не подменяется вторичным сбоем
диагностики.

## Будущий delivery

Будущий «Отправить отчёт» — новая outbound network trust boundary. Он может
появиться только по явному действию пользователя, через HTTPS, с отдельным
документированием endpoint, аутентификации/anti-abuse, retention, доступа к
отчётам и failure fallback. Локальный файл остаётся обязательным fallback;
никаких фоновых или автоматических retries не предполагается.
