# Distribution lifecycle

Эта карта помогает быстро восстановить смысл установленной Windows-версии ASR.
Она объясняет модель, а не синтаксис установщика.

## Компоненты и ownership

```text
ASR root
├── Client      интерфейс и Electron application
├── Runtime     Python, pipeline, ffmpeg, модели и runtime manifest
└── User Data   settings, runs, transcripts, results — отдельно от install root
```

Client можно заменить независимо от тяжёлого Runtime. User Data принадлежат
пользователю, поэтому installation/uninstall flow не должен считать их payload.

## Clean install

```text
Full Setup -> <root>/Client + <root>/Runtime -> first application launch
```

Full Setup — проверенная полная поставка: он создаёт оба обязательных
компонента. Это нужно, чтобы Client не оказался установленным без возможности
распознавать аудио.

## Client находит Runtime

```text
packaged Client -> sibling Runtime -> manifest + compatibility preflight -> Python pipeline
```

Перед запуском Client проверяет Runtime contract: manifest, совместимость и
ключевые ресурсы. Он не знает внутреннее здоровье модели; это остаётся
ответственностью Runtime.

## Full Setup reinstall

```text
existing Client + Runtime -> Full Setup -> new Client + refreshed Runtime
```

Повторный Full Setup намеренно заменяет bundled Runtime. Это не Client updater:
network delivery и automatic updates пока не реализованы.

## Staging, promotion и backup

```text
new Runtime -> staging -> minimal validation -> promotion -> active Runtime
old Runtime ----------------------------------> previous backup -> remove after success
```

Новая копия сначала становится кандидатом. Так failure распаковки или проверки
не должен разрушить уже рабочий Runtime при reinstall.

## Failure и compensating cleanup

```text
Client installed -> Runtime deployment fails -> remove new Client -> keep Runtime diagnostics
```

Если обязательный Runtime не установлен, новый Client не должен оставаться
зарегистрированным как рабочее приложение. Cleanup удаляет новый Client, но не
трогает user data, существующий Runtime и диагностический staging. Previous
Client после failed reinstall автоматически не возвращается.

## Manual uninstall

```text
user chooses uninstall -> remove Client + Runtime -> try to remove empty ASR root
                         \-> keep User Data
```

Runtime — внутренний компонент продукта, поэтому при обычном ручном удалении
он удаляется вместе с Client. User Data, включая settings, transcripts и
results, остаются; неизвестные файлы в root не удаляются рекурсивно.

## Service uninstall

```text
setup/reinstall service action -> replace or remove Client only -> preserve Runtime + User Data
```

Служебный uninstall — часть install/update flow, а не желание пользователя
удалить продукт. Поэтому он не должен удалять Runtime, staging, backup или
пользовательские данные.

## Repair missing Runtime

```text
registered Client + missing Runtime -> Full Setup -> delivered Runtime -> recognition available
```

Runtime может отсутствовать или быть повреждён. Full Setup допускает этот
сценарий и восстанавливает Runtime, вместо того чтобы ошибочно считать Client
неизвестной установкой.

## Legacy monolith

```text
legacy monolith detected -> stop Setup -> user removes old app -> clean Full Setup
```

Старый монолитный layout не мигрируется автоматически. Такой block безопаснее,
чем угадывать состояние старой установки; user data и results при удалении
legacy приложения сохраняются.

## Ключевые термины

- **Ownership** — кто вправе заменять или удалять компонент.
- **Lifecycle** — что происходит с компонентом при install, reinstall, repair,
  failure и uninstall.
- **Staging** — временная кандидатная копия нового Runtime.
- **Promotion** — переключение проверенного кандидата в active Runtime.
- **Backup / previous** — временно сохранённый старый Runtime до успеха promotion.
- **Compensating cleanup** — удаление уже созданного частичного результата после
  failure обязательного шага.
- **Repair** — восстановление обязательного компонента без удаления user data.

## Куда идти глубже

1. Source of truth установки и lifecycle: [packaging](../docs/packaging/module.md).
2. Resolver/preflight contract: [recognition](../docs/recognition/module.md).
3. Trust boundary Client → Runtime: [security](../docs/security/module.md).
4. Реализация: `build/installer.nsh`, `src/runtime/resolveRuntime.js`,
   `scripts/buildRuntimeArchive.js`.
5. Проверки: `test/packaging/fullSetup.test.js` и runtime tests.
