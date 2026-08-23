# Support Report v1 — behavioral validation matrix

Матрица фиксирует evidence локальной диагностики, а не определяет её
архитектуру. Источник поведения — [module.md](module.md).

| Scenario | Expected observable behavior | Automated coverage | Manual validation | Remaining gap / note |
| --- | --- | --- | --- | --- |
| Recognition failure with Runtime native-load error | A local report is created; UI shows a concise failure, code and «Открыть файл отчёта», without raw traceback. | `npm run test:diagnostics` checks report content/path sanitization; `npm run test:ui-version` checks the narrow IPC/UI handoff statically. | Not yet validated in a packaged Client on a restricted work PC. | Need real `torchaudio` failure report to identify the missing dependency. |
| Report privacy boundary | Report excludes source media name/path and sanitizes paths from diagnostic error text. | `npm run test:diagnostics`. | Not manually reviewed from packaged artifact. | Sanitization is bounded best effort, not a proof against every future third-party error format. |
| Runtime evidence | Recognition failure records manifest identity/version/API and isolated package import outcomes when Runtime can be inspected. | Contract implemented; import probes are exercised only after a real failure. | Not yet validated on the affected PCs. | No native dependency walker or memory dump is collected. |
| Setup failure | Current custom Full Setup fail-closed branches create a per-user Install Report before their error dialog. | `npm run test:packaging` asserts the NSIS contract statically. | Not yet run on a real failed Setup. | electron-builder failures before custom NSIS code cannot produce this report. |
| Delivery | No network transmission occurs. User or intermediary manually sends the prepared `.txt` file. | Source/config review; no network sender is implemented. | Not applicable. | Future endpoint remains undefined. |
