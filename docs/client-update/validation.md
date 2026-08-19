# Client Update / Full Setup — behavioral validation matrix

Этот документ — review-инструмент для фактического поведения Full Setup и
переходных Slice 3–4. Он фиксирует ожидаемое наблюдаемое поведение и имеющееся
evidence, но не заменяет [архитектуру Client Update](module.md),
[упаковку](../packaging/module.md) или [security model](../security/module.md).

## Как читать статусы

- **Current / verified** — поведение реализовано; evidence приведено в таблице.
- **Automated** — тест выполняется автоматически. `Behavioral` означает запуск
  компонента; `static` означает проверку исходников/конфигурации, а не Setup.
- **Manual: validated** — сценарий был выполнен в завершённой validation Slice 3
  или Slice 4. Это не означает, что его автоматически повторяет CI.
- **Contract, not validated** — ожидаемое текущее поведение определено, но для
  него нет указанного validation evidence.
- **Future / undefined** — lifecycle ещё не реализован; документ намеренно не
  придумывает его implementation behavior.

## Current behavioral matrix

| Scenario | Initial state / action | Expected externally observable behavior | Automated coverage | Manual validation | Remaining gap / note |
| --- | --- | --- | --- | --- | --- |
| Clean Full Setup, versioned Client | No ASR installation; run current Full Setup. | Creates `<root>/Clients/<version>` and sibling `<root>/Runtime`; Client is not installed at root. | Static packaging assertions. | **Validated.** | A current Full Setup build remains a release gate, not a substitute for static evidence. |
| Root-level stable launcher | Successful Full Setup. | `<root>/asr-launch.exe` exists outside versioned Client. | Static packaging assertion; launcher is compiled in `npm run dist:win`. | **Validated.** | Full Setup artifact must be rebuilt after launcher/installer changes. |
| Desktop shortcut launch path | Successful Full Setup; open Desktop shortcut. | Shortcut targets root launcher; launcher starts expected Client. | Shortcut target: static only. Launcher selection: behavioral test. | **Validated.** | Needs manual recheck against each newly built Setup. |
| Start Menu shortcut launch path | Successful Full Setup; open Start Menu shortcut. | Shortcut targets root launcher; launcher starts expected Client. | Shortcut target: static only. Launcher selection: behavioral test. | **Validated.** | Needs manual recheck against each newly built Setup. |
| Exactly one Client | `<root>/Clients` has exactly one directory with `local-asr-prototype.exe`; run launcher. | Launcher starts that executable and exits after process creation. | **Behavioral:** `npm run test:launcher`. | **Validated.** | Test observes launcher success, not Client UI readiness; READY is future work. |
| Zero Clients | `Clients` is absent or contains no Client directories; run launcher. | Launcher refuses to launch and returns failure code 11; it does not select an arbitrary path. | **Behavioral:** `npm run test:launcher`. | **Validated.** | Missing `Clients` and an empty directory share the same user-facing failure. |
| Multiple Clients | `Clients` contains two Client directories; run launcher. | Launcher refuses to launch and returns failure code 12; it does not sort or select a release. | **Behavioral:** `npm run test:launcher`. | **Validated.** | This is a temporary Slice 4 rule, not active-version selection. |
| Expected Client executable missing | One Client directory lacks the expected executable; run launcher. | Launcher refuses to launch and returns failure code 13. | **Behavioral:** `npm run test:launcher`. | Not separately recorded. | A process-creation failure after a valid presence check has static-only coverage. |
| Same-version Full Setup repair/reinstall | Existing valid versioned Client and Runtime; run same-version Full Setup. | Client is replaced through normal electron-builder flow; Runtime is redeployed through staging; root launcher is refreshed after Runtime promotion. | Static packaging assertions. | **Validated.** | No end-to-end automated Setup test. |
| Runtime post-extraction validation failure | Existing Client and Runtime; bundled `runtime.7z` extracts but lacks `runtime-manifest.json`; run Setup. | Setup reports failure, keeps diagnostic staging, and starts compensating Client cleanup. | Installer branch: static packaging assertions. | **Validated.** | Failure injection is manual; see recipe below. |
| Failed staging does not promote Runtime | Same failure state as previous row. | `Runtime.staging` is not renamed to `Runtime`; existing Runtime remains unchanged. | Promotion ordering: static packaging assertion. | **Validated.** | No automated filesystem-level Setup execution. |
| No premature Runtime.previous | Same post-extraction validation failure. | `Runtime.previous` is not created because replacement/promotion was never reached. | Installer ordering: static source evidence. | **Validated.** | Coupled to manual failure-injection scenario. |
| Compensating Client cleanup | Runtime deployment failure after Client installation. | Failed Client binaries, Client-owned Windows registration and shortcuts are removed; user data is kept. | Installer branch: static source evidence. | **Validated.** | Cleanup may leave an empty `Clients/<version>` directory; see observations. |
| Stable launcher during service/compensating uninstall | Existing root launcher; `--updated` service uninstall runs, including compensating cleanup. | Root launcher, Runtime, `Runtime.staging` and `Runtime.previous` are preserved; versioned Client is removed. | Static packaging assertion for ordering. | **Validated.** | Direct end-to-end service-uninstall test is not automated. |
| Launcher after failed Client cleanup | Root launcher remains but no valid Client directory remains; run launcher. | Launcher safely refuses to start rather than launching another executable. | Zero-Client behavioral test. | **Validated.** | Exact filesystem residue may differ; required result is refusal. |
| Manual uninstall | Current registered versioned Client; user performs ordinary uninstall. | Removes Client, Runtime, Runtime staging/previous and root launcher after structural ownership validation; user data/results remain. | Static packaging assertion. | **Validated.** | Runtime deletion is best-effort; a locked Runtime produces a warning. |
| Empty-container cleanup | Manual uninstall has removed managed contents and `Clients` / root are empty. | Uninstaller removes empty `Clients` and root without recursive root cleanup. | Static packaging assertion. | **Validated.** | Depends on successful ownership validation. |
| Unrelated root file | Add unrelated file under installation root before manual uninstall. | Unrelated file survives; root is not recursively deleted. | No automated filesystem test. | **Validated.** | Empty root cleanup consequently does not occur. |

### Runtime post-extraction failure: Given / When / Then

**Given** an installed versioned Client and a working sibling Runtime,
**when** Full Setup receives a Runtime archive that extracts successfully but
does not contain `runtime-manifest.json`, **then** the extracted staging copy is
not promoted, existing Runtime remains in place, `Runtime.previous` is not
created, and Setup invokes compensating cleanup for the newly installed Client.

## Recorded observations, not contractual guarantees

- Compensating cleanup can leave an empty `Clients/<version>` directory.
- Windows Installed Apps currently reports approximately the Client-owned
  installation size rather than total Client plus shared Runtime size.

These observations must not be read as lifecycle guarantees or as a design for
future Client Update state.

## Manual failure-injection recipe

This is a test recipe, not production behavior. It is useful for repeating the
Runtime post-extraction validation scenario without changing installer code:

1. Create a normal `runtime.7z` and make a backup.
2. Remove `runtime-manifest.json` from a test copy of the archive.
3. Build Full Setup without rerunning Runtime preparation, so it consumes that
   test archive.
4. Run the validation scenario and inspect the states described above.
5. Restore the valid archive and rebuild the normal Full Setup.

## Coverage gaps / future scenarios

| Scenario | Status | Why no expected behavior is recorded here |
| --- | --- | --- |
| Client release ZIP composition | Current build boundary; automated artifact test exists. | Acquisition and installation of the ZIP are not implemented. |
| active / candidate / known-good selection | **Future / undefined implementation.** | Architecture defines roles, not current state storage or selection mechanism. |
| Activation and atomic state change | **Future / undefined implementation.** | Persistent storage and atomic-write mechanism are deliberately unselected. |
| Failure between activation and commit | **Future / undefined implementation.** | Recovery state and transaction implementation do not exist. |
| READY success or failure | **Future / undefined implementation.** | READY is required architecturally; its IPC/transport is unselected. |
| Client rollback | **Future / undefined implementation.** | Requires active/known-good state and READY coordination. |
| Client/Runtime compatibility rejection | **Future / undefined implementation.** | Compatibility contract is mandatory but its concrete form is not selected. |
| Corrupted or untrusted Client artifact | **Future / undefined implementation.** | Artifact verification scheme and key model are not selected. |
| Offline USB acquisition | **Future / undefined implementation.** | USB is a future Update Source; acquired artifacts remain untrusted before verification. |
| Online acquisition | **Future / undefined implementation.** | Provider/protocol and acquisition flow are not implemented. |
| Runtime update | **Future / separate lifecycle.** | Normal Client update must not modify Runtime. |
| Stable updater/coordinator self-update | **Future / undefined implementation.** | Current `asr-launch.exe` is a launch stub, not an updater or coordinator. |
| Launcher reparse-point handling | Current implementation, not explicitly hardened. | A junction can satisfy the directory check; decide/review this before untrusted update artifacts are introduced. |

When a future behavior is specified, its source of truth must first be updated
in `client-update/module.md` and `security/module.md`; then this matrix can add
the corresponding observable scenario and evidence.
