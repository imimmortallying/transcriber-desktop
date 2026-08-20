# Client Update / Full Setup — behavioral validation matrix

Этот документ — review-инструмент для фактического поведения Full Setup и
переходных Slice 3–5. Он фиксирует ожидаемое наблюдаемое поведение и имеющееся
evidence, но не заменяет [архитектуру Client Update](module.md),
[упаковку](../packaging/module.md) или [security model](../security/module.md).

## Как читать статусы

- **Current / verified** — поведение реализовано; evidence приведено в таблице.
- **Automated** — тест выполняется автоматически. `Behavioral` означает запуск
  компонента; `static` означает проверку исходников/конфигурации, а не Setup.
- **Manual: validated** — сценарий был выполнен на built artifact в завершённой
  validation Slice 3, Slice 4 или Slice 5. Это не означает, что его автоматически
  повторяет CI.
- **Contract, not validated** — ожидаемое текущее поведение определено, но для
  него нет указанного validation evidence.
- **Future / undefined** — lifecycle ещё не реализован; документ намеренно не
  придумывает его implementation behavior.

## Current behavioral matrix

| Scenario | Initial state / action | Expected externally observable behavior | Automated coverage | Manual validation | Remaining gap / note |
| --- | --- | --- | --- | --- | --- |
| Slice 5 Full Setup build | Build the current Slice 5 Full Setup after the NSIS macro fix. | Current Setup executable and blockmap are produced. | `npm run dist:win`. | **Validated:** `dist/local-asr-prototype Setup 0.1.0.exe` was built (859,166,696 bytes) with its blockmap. | This records only the successful current build; the earlier invalid-macro build failure is not product behavior. |
| Clean Full Setup, versioned Client | No ASR installation; run current Full Setup. | Creates `<root>/Clients/<version>`, sibling `<root>/Runtime` and root-owned `<root>/Coordinator/asr-coordinator.exe`; Client is not installed at root. | Static packaging assertions. | **Validated** before Slice 6C for Client/Runtime only. | Real built-Setup Coordinator deployment remains to be exercised. |
| Silent Full Setup geometry initialization | No ASR installation; run a separately identified test Setup with `/S /currentuser /D=<nonce root>`. | Before `customInstall`, silent flow derives the same root and `Clients/<version>` geometry as the interactive Install Files flow; Client, Runtime, Coordinator, launcher and two valid identical state slots are present. | **Behavioral:** `npm run test:full-setup-e2e` uses a sanitized child environment (without `ELECTRON_RUN_AS_NODE`) and asserts the installed filesystem. Static callback coverage remains in `npm run test:packaging`. | Not manually performed for this test identity. | The tiny Runtime fixture validates installer lifecycle mechanics only; it does not represent the production Runtime payload. |
| Root-level stable launcher | Successful Full Setup. | `<root>/asr-launch.exe` exists outside versioned Client and its fixed Coordinator target is deployed. | Static packaging assertion; launcher and Coordinator are freshly built in `npm run dist:win`. | **Validated** before Slice 6C for launcher only. | Real built-Setup handoff remains to be exercised. |
| Desktop shortcut launch path | Successful Full Setup; open Desktop shortcut. | Shortcut targets root launcher, which can reach the deployed Coordinator. | Shortcut/deployment target: static only. | **Validated** before Slice 6C for shortcut target only. | Interactive installed launch remains unvalidated. |
| Start Menu shortcut launch path | Successful Full Setup; open Start Menu shortcut. | Shortcut targets root launcher, which can reach the deployed Coordinator. | Shortcut/deployment target: static only. | **Validated** before Slice 6C for shortcut target only. | Interactive installed launch remains unvalidated. |
| Clean InstallationState bootstrap | No state directory; successful Full Setup has installed Client, Runtime, launcher and shortcuts. | Internal non-UI Client mode publishes `InstallationState/slot-a.json` and `slot-b.json` as identical generation-1 schema-v1 snapshots. | **Behavioral:** `npm run test:update-state`; installer integration is static. | **Validated** on built Full Setup at `D:\ASR-Slice5-Test`: launcher, `Clients/0.1.0`, Runtime, state directory and both slots were present; both slots were identical v1 generation 1 with active/known-good `0.1.0`. | Hard-power-loss durability is not proven. |
| InstallationState v2 protocol reader foundation | Directly normalize v2 steady, prepared and activated document shapes. | The protocol model accepts only exact v2 fields and invariants; phase and candidate participate in semantic comparison. Current slot reader, Coordinator and Full Setup still classify v2 as unsupported, and all production writers remain v1. | **Behavioral:** `npm run test:update-state`. | Not manually performed; no v2 state is published in production. | Reader compatibility must be deployed before a future v2 writer; prepare/activate/READY/commit/rollback remain unimplemented. |
| Valid same-version state repair | Both valid schema-v1 slots select the installed version; run Full Setup repair. | State bytes remain unchanged. | **Behavioral:** `npm run test:update-state`; installer integration is static. | Not yet performed on a built Setup. | Runtime repair remains separately validated. |
| One-slot state recovery | One valid v1 slot and one missing/corrupt v1 slot identify installed Client. | Valid logical state is retained and damaged replica is written with generation + 1. | **Behavioral:** `npm run test:update-state`. | Not yet performed on a built Setup. | No Client-directory selection occurs. |
| Corrupt recognized-v1 state repair | No valid v1 slot, but each slot is a safely parsed object explicitly marked `schemaVersion: 1`; run explicit Full Setup repair. | Provisioning authority replaces it with fresh steady v1 state for its validated installed Client. | **Behavioral:** `npm run test:update-state`. | Not yet performed on a built Setup. | Coordinator must not perform this reconstruction. |
| Unsupported/newer-schema preflight | Existing state has `slot-a.schemaVersion = 2` and valid v1 `slot-b`; run the same Full Setup. | Full Setup read-only aborts with the newer-incompatible-version message before registered Client replacement. | Protocol precedence: **Behavioral** `npm run test:update-state`; installer preflight: static assertion. | **Validated** on built Full Setup: both slot hashes, launcher hash and Client executable hash were unchanged; slot-a remained v2 and slot-b v1. | Registry and shortcut preservation were not explicitly inspected manually. |
| Oversized/uninspectable preflight | Existing `slot-a` is 70,120 bytes (> 65,536 limit); `slot-b` remains valid v1. | Full Setup read-only aborts with the ambiguous/uninspectable-state message. | Protocol precedence: **Behavioral** `npm run test:update-state`; installer preflight: static assertion. | **Validated** on built Full Setup: oversized slot remained oversized, valid slot matched its backup hash, and Client, Runtime and root launcher remained present. | Registry and shortcut preservation were not explicitly inspected manually. |
| Duplicate-key/uninspectable preflight | Existing slot-a has duplicate top-level `schemaVersion` keys (`2`, then `1`); slot-b remains valid v1. | Full Setup read-only aborts with the ambiguous/uninspectable-state message. | Protocol precedence: **Behavioral** `npm run test:update-state`; installer preflight: static assertion. | **Validated** on built Full Setup: duplicate-key content was unchanged, valid slot matched its backup hash, and Client, Runtime and root launcher remained present. | Registry and shortcut preservation were not explicitly inspected manually. |
| InstallationState reparse preflight | InstallationState directory or one slot is a reparse/symlink; for a slot case the peer is valid v1. | Protocol classifies the directory/slot as uninspectable; a valid peer does not select state, and reconciliation read-only aborts without repair/write. Genuinely absent state remains distinguishable. | **Behavioral:** `npm run test:update-state` models reparse through the injected `lstat` seam. | Not manually performed with an on-disk Windows junction/symlink. | The automated test proves protocol classification and no-write behavior; built-artifact reparse validation remains absent. |
| Malformed/read-error uninspectable preflight | Existing state cannot be safely parsed or read. | Full Setup read-only aborts before registered Client replacement. | Installer preflight: static assertion; no direct automated malformed/read-error case. | Not manually exercised through a built Full Setup. | Direct protocol and built-artifact validation remain required for malformed JSON and generic read-error cases. |
| Selected Client validation categories | A selected Client directory or expected executable is absent, or its filesystem path is unsafe. | Missing directory/executable produces `SELECTED_CLIENT_UNAVAILABLE`; wrong type, reparse path and canonical escape produce `UNSAFE_SELECTED_CLIENT`; regular selected Client remains accepted. | **Behavioral:** `npm run test:update-state`. | Not manually performed on a built artifact. | Real on-disk Windows reparse and generic filesystem-access failure such as `EACCES` are not manually validated. |
| Standalone Coordinator readonly state launch | Run Coordinator from valid `<root>/Coordinator/asr-coordinator.exe` geometry with controlled state results. | Coordinator maps state and selected Client outcomes to stable exit codes; launches only validated `activeClient`, and success means confirmed process creation rather than READY/health. | **Behavioral:** `npm run test:coordinator`. | Not manually performed on a built Coordinator. | Full Setup now deploys Coordinator; built-Setup behavior remains separate evidence. |
| SEA Coordinator state integration | Build SEA Coordinator, copy it to temporary valid Coordinator geometry, and provide state selecting either a missing Client or normal `0.2.0` Client beside an unused `0.1.0` directory. | Missing Client exits `16` (`SELECTED_CLIENT_UNAVAILABLE`). A normal non-elevated NSIS Client is created only from selected `0.2.0`, writes its marker and gives Coordinator exit `0`; both state-slot byte sequences remain unchanged. | **Behavioral:** `npm run test:coordinator-sea` independently asserts final PE `WINDOWS_GUI` subsystem and exercises the real SEA directly and through a built test-mode launcher for exit `16` and success `0`. | **Validated** in an isolated Windows layout: real production root launcher invoked the final transformed SEA Coordinator; real state selected `0.2.0` despite an additional `0.1.0` directory; the normal selected Client created `CLIENT_LAUNCHED.txt` and launcher exited `0`, with no visible Coordinator console window/flash. Earlier exit `18` came from a temporary `requireAdministrator` fixture, not a Coordinator defect. | Test excludes normal Node PATH and covers real normal-Client process creation; it does not validate READY or deployment. Interactive no-console-flash evidence is now complete. |
| Stable launcher Coordinator handoff | Run built root launcher with a controlled Coordinator target and arbitrary `Clients` directories. | Launcher validates only fixed `<root>/Coordinator/asr-coordinator.exe`, rejects missing/unsafe/unstartable target with `20`/`21`/`22`, preserves Coordinator `0` and `10`–`19`, and maps unknown Coordinator non-zero to `23`. | **Behavioral:** `npm run test:launcher`; `npm run test:full-setup-e2e` starts the installed root launcher, real SEA Coordinator and a normal marker Client. | **Validated** in the isolated real-launch layout: real production root launcher invoked the final transformed SEA Coordinator, which launched selected `0.2.0` Client, returned `0`, and showed no visible Coordinator console window/flash. | E2E uses a test-identity Setup and marker Client; normal production Client launch remains separately evidenced above. |
| Full Setup Coordinator deployment and replacement | After Runtime promotion, materialize final Coordinator or replace an existing regular final executable through reserved staging/previous files. | Full Setup deploys `<root>/Coordinator/asr-coordinator.exe`; unsafe/reparse/wrong-type paths abort, previous final remains or is restored where possible, and recognized regular interruption residue is recovered deterministically. | **Behavioral:** `npm run test:full-setup-e2e` covers clean deployment, missing-final repair, and regular `previous`/`staging` recovery; final GUI SEA artifact: `npm run test:coordinator-sea`. | Not manually performed on a built Setup. | No hard-power-loss atomicity; unsafe/reparse/wrong-type built-Setup failure paths are not yet E2E-covered. |
| Coordinator uninstall lifecycle | Service uninstall or ordinary uninstall after registered Client/root ownership validation. | Service uninstall preserves Coordinator. Ordinary uninstall deletes only known Coordinator protocol files and removes its directory only when empty; foreign residue is retained. | **Behavioral:** `npm run test:full-setup-e2e` exercises both paths, including Coordinator foreign residue. | Not manually performed on a built Setup. | Locked/unsafe Coordinator cleanup remains to be exercised. |
| Existing-state reconcile/write failure | Existing state has one valid generation-1 v1 slot and one recognised-v1 invalid slot (`{"schemaVersion":1,"generation":0}`); inspect returns 0, then late state write is denied. | Setup fails; pre-existing state is retained, compensating cleanup may remove Client, and Runtime/root launcher remain. Retained state may be repair-required rather than a reason to scan for another Client. | Redundancy-write failure: **Behavioral** `npm run test:update-state`; installer preservation distinction: static assertion. | **Validated** on built Full Setup: both pre-Setup slot hashes remained unchanged; InstallationState, Runtime and root launcher remained; Client executable was removed. Root launcher then refused the incomplete Client. ACL and original slot were restored; a subsequent Full Setup restored Client and identical generation-1 state. | Registry and shortcut cleanup were not separately inspected. |
| Fresh bootstrap publish failure | No published InstallationState; inject `EACCES` on final bootstrap staging-directory → `InstallationState` rename. | No successfully published InstallationState remains; bootstrap staging residue is cleaned. Fresh installer cleanup removes only artifacts created by that attempt. | **Behavioral:** `node --test --test-name-pattern='failed staged bootstrap does not publish a partial InstallationState' test/update/installationState.test.js`; installer compensation branch: static assertion. | Not manually reproduced through the built Full Setup. | Deterministic built-Setup E2E injection for this exact final publish failure was unavailable; installer compensation remains static/source-covered. |
| Same-version Full Setup repair/reinstall | Existing valid versioned Client and Runtime; run same-version Full Setup. | Client is replaced through normal electron-builder flow; Runtime is redeployed through staging; root launcher is refreshed after Runtime promotion. | **Behavioral:** `npm run test:full-setup-e2e` repairs missing Coordinator and reinstalls Client after service uninstall. | **Validated.** | E2E uses a tiny Runtime fixture rather than production Runtime payload. |
| Runtime post-extraction validation failure | Existing Client and Runtime; bundled `runtime.7z` extracts but lacks `runtime-manifest.json`; run Setup. | Setup reports failure, keeps diagnostic staging, and starts compensating Client cleanup. | Installer branch: static packaging assertions. | **Validated.** | Failure injection is manual; see recipe below. |
| Failed staging does not promote Runtime | Same failure state as previous row. | `Runtime.staging` is not renamed to `Runtime`; existing Runtime remains unchanged. | Promotion ordering: static packaging assertion. | **Validated.** | No automated filesystem-level Setup execution. |
| No premature Runtime.previous | Same post-extraction validation failure. | `Runtime.previous` is not created because replacement/promotion was never reached. | Installer ordering: static source evidence. | **Validated.** | Coupled to manual failure-injection scenario. |
| Compensating Client cleanup | Runtime deployment failure after Client installation. | Failed Client binaries, Client-owned Windows registration and shortcuts are removed; user data is kept. | Installer branch: static source evidence. | **Validated.** | Cleanup may leave an empty `Clients/<version>` directory; see observations. |
| Stable launcher during service/compensating uninstall | Existing root launcher; `--updated` service uninstall runs, including compensating cleanup. | Root launcher, Runtime, `Runtime.staging` and `Runtime.previous` are preserved; versioned Client is removed. | Static packaging assertion for ordering. | **Validated.** | Direct end-to-end service-uninstall test is not automated. |
| InstallationState during service uninstall | Existing valid root state; version-owned uninstaller runs with `--updated`. | InstallationState is preserved with launcher, Coordinator and Runtime; Client and its version-owned uninstaller are removed. | **Behavioral:** `npm run test:full-setup-e2e`. | **Validated** on built artifact before Coordinator deployment: both slot hashes, Runtime and root launcher were unchanged/present; Client executable and version-owned uninstaller were removed. A subsequent Full Setup restored Client, Runtime, launcher and both slots. | E2E additionally proves Coordinator preservation in test identity; locked/unsafe cases remain outside scope. |
| Launcher after failed Client cleanup | Root launcher and Coordinator remain, but state selects an incomplete Client; run launcher. | Coordinator reports selected-Client-unavailable and launcher shows its mapped failure without scanning another Client. | Coordinator/launcher behavioral tests; Full Setup deployment ordering is static. | Not manually performed in an isolated real-SEA layout. | Built-Setup failure lifecycle remains to be exercised. |
| Manual uninstall | Current registered versioned Client; add `<root>/DO_NOT_DELETE.txt`, then perform ordinary version-owned uninstall. | Removes Client, InstallationState, Runtime, Runtime staging/previous, known Coordinator protocol files and root launcher after structural ownership validation; user data/results remain. | **Behavioral:** `npm run test:full-setup-e2e` retains a foreign Coordinator file while removing ASR-owned Coordinator files and other managed infrastructure. | **Validated** before Coordinator deployment: root contained only `DO_NOT_DELETE.txt` afterward. | Locked/unsafe cleanup remains outside current E2E scope. |
| Empty-container cleanup | Manual uninstall has removed managed contents and `Clients` / root are empty. | Uninstaller removes empty `Clients` and root without recursive root cleanup. | Static packaging assertion. | **Validated.** | Depends on successful ownership validation. |
| Unrelated root file | Add unrelated file under installation root before manual uninstall. | Unrelated file survives; root is not recursively deleted. | No automated filesystem test. | **Validated** on built artifact with `DO_NOT_DELETE.txt`. | Empty root cleanup consequently does not occur. |

### Runtime post-extraction failure: Given / When / Then

**Given** an installed versioned Client and a working sibling Runtime,
**when** Full Setup receives a Runtime archive that extracts successfully but
does not contain `runtime-manifest.json`, **then** the extracted staging copy is
not promoted, existing Runtime remains in place, `Runtime.previous` is not
created, and Setup invokes compensating cleanup for the newly installed Client.

### Slice 5 remaining validation gaps

- Malformed JSON and generic read-error uninspectable state were not manually
  exercised through a built Full Setup.
- Registry and shortcut preservation during unsupported/uninspectable preflight
  abort were not explicitly inspected manually.
- The exact fresh-bootstrap final publish failure was not manually reproduced
  through a built Full Setup; its protocol behavior is automated and installer
  compensation is static/source-covered.
- Hard-power-loss durability is not proven.

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
| active / candidate / known-good launch selection | **Future / undefined implementation.** | Root launcher delegates to Full Setup-deployed standalone Coordinator, which can read `activeClient` and create its process from validated geometry. Candidate/activation/known-good fallback lifecycle is not implemented. |
| Transaction, activation and atomic state change | **Future / undefined implementation.** | Schema v2 protocol normalization can represent steady/prepared/activated shapes, but no production writer or lifecycle action exists. |
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
