# Desktop distribution lifecycle playbook

Этот playbook собирает переносимые решения для desktop-приложений с тяжёлым
локальным компонентом. Он не описывает фактическое поведение ASR и не заменяет
source-of-truth документы конкретного продукта.

## Начинать с ownership, а не с installer tooling

До выбора installer ответьте на следующие вопросы.

1. Какие компоненты поставляются: Client, Runtime, User Data, shared services?
2. Кто владеет каждым компонентом и кто вправе его заменить или удалить?
3. Какие artefacts выполняют clean install, full reinstall, client-only update,
   repair и manual uninstall?
4. Что считается успехом установки: достаточно ли Client или обязательны все
   компоненты, нужные для первого полезного действия пользователя?
5. Как поступать с legacy layout: мигрировать, блокировать или временно
   поддерживать сосуществование?

Installer выбирают после этой модели. Иначе его стандартные upgrade/uninstall
пути незаметно становятся продуктовой политикой.

## Матрица artefacts и lifecycle

| Операция | Client | Runtime | User Data |
| --- | --- | --- | --- |
| Clean install | Создать. | Доставить и проверить. | Не считать installation payload. |
| Full reinstall | Заменить. | Явно определить: заменить, сохранить или repair. | Сохранить. |
| Client-only update | Заменить. | Не затрагивать. | Сохранить. |
| Repair | Оставить либо заменить по явному правилу. | Восстановить из проверенного full artefact. | Сохранить. |
| Manual uninstall | Удалить. | Удалить, если это внутренний компонент продукта. | Не удалять без отдельного явного решения. |
| Service uninstall | Выполнить ровно необходимое для update/reinstall. | Не удалять по умолчанию. | Не удалять. |

Эта матрица должна быть утверждена до реализации. Особенно важно различать
manual uninstall, вызванный пользователем, и служебный uninstall, запускаемый
установщиком.

## Staging и transactional promotion

Большой обязательный Runtime не следует распаковывать сразу поверх рабочего
состояния.

```text
verified artefact -> staging -> validate -> promote -> active Runtime
                                      \-> retain diagnostics on failure
old Runtime -------------------------> temporary backup -> remove after success
```

Сначала распакуйте новую кандидатную копию, затем выполните минимальную
проверку контрактных ресурсов и только после этого переключайте active Runtime.
Старую рабочую копию держите как временный backup до успешного promotion. Это
защищает reinstall от повреждения уже работающей версии и делает failure
диагностируемым.

## Failure, compensating cleanup и repair

Если installer успевает зарегистрировать Client, создать shortcuts или показать
его как установленный до доставки обязательного Runtime, частичный успех — это
ошибка установки. Нужен компенсирующий путь:

```text
Client installed -> Runtime failure -> remove new Client registration/files
                                  -> preserve previous Runtime and diagnostics
```

Пользуйтесь штатным uninstaller Client, когда это возможно: так не нужно
повторять и расходить cleanup files, shortcuts и registry. Заранее зафиксируйте
ограничения: compensating cleanup может не восстановить уже заменённый Client,
а миграцию из удалённого legacy приложения обычно нельзя безопасно отменить.

Repair — самостоятельный сценарий. Registered Client с отсутствующим Runtime не
обязан считаться неизвестной установкой, если full artefact может безопасно
вернуть обязательный Runtime без удаления user data.

## Legacy strategy

Выберите один из режимов, не смешивая их неявно:

- **Migrate:** только при проверяемом исходном layout, понятной identity и
  обратимом либо приемлемом failure path.
- **Block:** попросить удалить legacy приложение вручную, затем выполнить clean
  install. Это часто наиболее надёжно для небольшой legacy-популяции.
- **Coexist:** поддерживать обе версии только при доказанной изоляции identities,
  файлов и user data.

Unknown или повреждённый registered layout безопаснее block, чем destructive
guesswork.

## Disk space и tooling probes

Планируйте три разных размера:

1. final installed size;
2. peak size на target drive во время staging и backup;
3. temporary-drive size для скачивания или materialization artefact.

Получайте размеры из build process, а не из вручную записанной константы. До
выпуска проверьте инструменты реальным большим payload: extraction, exit status,
diagnostics, promotion и cleanup. Unit tests не доказывают поведение упаковщика,
файловой системы и locks на целевой ОС.

## Manual installer verification matrix

Минимальная ручная матрица для настоящего release artefact:

- clean install в default и custom location;
- full reinstall при работающем Runtime;
- repair отсутствующего/повреждённого Runtime;
- failure во время обязательной component delivery;
- manual uninstall и service uninstall;
- legacy migrate/block/coexist сценарий, который выбран продуктом;
- сохранность user data и внешних user-owned directories;
- первое реальное полезное действие приложения после установки.

## Practical checklist для нового проекта

1. Нарисовать layout и ownership компонентов.
2. Утвердить матрицу artefacts/lifecycle и поведение failures.
3. Отделить user data от installation directories.
4. Выбрать legacy strategy до первого upgrade.
5. Спроектировать staging, validation, promotion и diagnostic retention.
6. Посчитать final, peak и temporary disk space на build.
7. Проверить реальный artefact на чистой целевой ОС.
8. Зафиксировать policy в source-of-truth документации и держать playbook
   отдельно от продуктовой специфики.

## Симптом, причина, переносимый урок

| Симптом | Корневая причина | Переносимый урок |
| --- | --- | --- |
| Setup показывает маленький required space, но падает при большой поставке. | Учтён только compressed artefact, а не staging/backup и temporary drive. | Планируйте final, peak и temporary requirements отдельно. |
| Пользователь выбирает root, а компоненты появляются рядом или вложенными неверно. | Root пользователя смешан с install directory одного компонента. | Храните root и component install path как разные явные значения. |
| Archive распакован, но компонент не появляется. | Extraction, validation и promotion считались одной неразличимой операцией. | Проверяйте и диагностируйте каждую фазу отдельно. |
| После failed install виден зарегистрированный, но неработоспособный Client. | Обязательный Runtime доставляется после Client registration. | Добавляйте compensating cleanup и тестируйте его на реальном artefact. |
| Reinstall уничтожает рабочий Runtime. | Новая копия пишет поверх active состояния без staging/backup. | Переключайте Runtime только после validation, временно сохраняя previous copy. |
| Automatic upgrade повреждает непонятный legacy layout. | Installer сделал предположение о старой установке. | Для unknown legacy layout fail closed; выбирайте migration только при доказуемом контракте. |
