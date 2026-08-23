const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "../..");

test("Full Offline Setup keeps Runtime outside the Client package", async () => {
  const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
  const installerScript = await readFile(path.join(projectRoot, "build", "installer.nsh"), "utf8");
  const stableLauncherSource = await readFile(path.join(projectRoot, "build", "stable-launcher.nsi"), "utf8");
  const stableLauncherBuilder = await readFile(path.join(projectRoot, "scripts", "buildStableLauncher.js"), "utf8");
  const coordinatorBuilder = await readFile(path.join(projectRoot, "scripts", "buildCoordinator.js"), "utf8");
  const runtimeArchiveBuilder = await readFile(path.join(projectRoot, "scripts", "buildRuntimeArchive.js"), "utf8");
  const mainSource = await readFile(path.join(projectRoot, "src", "main.js"), "utf8");
  const installationStateSource = await readFile(path.join(projectRoot, "src", "update", "installationState.js"), "utf8");
  const coordinatorSource = await readFile(path.join(projectRoot, "src", "coordinator", "main.js"), "utf8");
  const installerTemplate = await readFile(path.join(projectRoot, "node_modules", "app-builder-lib", "templates", "nsis", "installer.nsi"), "utf8");
  const installSectionTemplate = await readFile(path.join(projectRoot, "node_modules", "app-builder-lib", "templates", "nsis", "installSection.nsh"), "utf8");
  const multiUserTemplate = await readFile(path.join(projectRoot, "node_modules", "app-builder-lib", "templates", "nsis", "multiUser.nsh"), "utf8");
  const customInit = installerScript.slice(
    installerScript.indexOf("!macro customInit"),
    installerScript.indexOf("!macro customPageAfterChangeDir"),
  );
  const customUninstall = installerScript.slice(
    installerScript.indexOf("!macro customUnInstall"),
    installerScript.indexOf("Function un.onUninstSuccess"),
  );
  const successfulUninstall = installerScript.slice(
    installerScript.indexOf("Function un.onUninstSuccess"),
    installerScript.indexOf("!endif", installerScript.indexOf("Function un.onUninstSuccess")),
  );
  const fullSetupEstimatedSizeWriter = installerScript.slice(
    installerScript.indexOf("Function writeFullSetupEstimatedSize"),
    installerScript.indexOf("Function checkRuntimeArchiveSpace"),
  );
  const fullSetupFileSizeCallback = installerScript.slice(
    installerScript.indexOf("Function addFullSetupFileSize"),
    installerScript.indexOf("Function checkRuntimeArchiveSpace"),
  );

  assert.equal(packageJson.build.nsis.oneClick, false);
  assert.equal(packageJson.build.nsis.allowToChangeInstallationDirectory, false);
  assert.equal(packageJson.build.nsis.allowElevation, false);
  assert.equal(packageJson.build.nsis.include, "build/installer.nsh");
  assert.equal(packageJson.build.publish, null);
  assert.equal(packageJson.build.appId, "ru.sber.local-asr");
  assert.equal(packageJson.localAsr.supportEmail, "imimmortallyingwork@yandex.ru");
  assert.equal("extraResources" in packageJson.build, false);
  assert.equal(packageJson.scripts["prepare:runtime"], "node scripts/buildRuntimeArchive.js");
  assert.equal(packageJson.scripts["build:launcher"], "node scripts/buildStableLauncher.js");
  assert.equal(packageJson.scripts["build:coordinator"], "node scripts/buildCoordinator.js");
  assert.equal(packageJson.scripts["test:launcher"], "node --test test/launcher/stableLauncher.test.js");
  assert.equal(packageJson.scripts["test:update-state"], "node --test test/update/installationState.test.js");
  assert.equal(packageJson.scripts["test:packaging"], "node --test test/packaging/fullSetup.test.js test/packaging/fullSetupE2eCleanup.test.js");
  assert.equal(packageJson.scripts["test:diagnostics"], "node --test test/diagnostics/supportReport.test.js");
  assert.equal(packageJson.scripts["verify:distribution"], "npm run check && npm run test:diagnostics && npm run test:client-update && npm run test:ui-version && npm run test:packaging && npm run test:release");
  assert.equal(packageJson.scripts["test:full-setup-e2e"], "node test/packaging/fullSetupE2eHarness.js");
  assert.match(packageJson.scripts["dist:win"], /^npm run build:launcher && npm run build:coordinator && npm run prepare:runtime && electron-builder/);
  assert.equal(packageJson.devDependencies["7zip-bin"], "5.2.0");
  assert.match(runtimeArchiveBuilder, /require\("7zip-bin"\)/);
  assert.match(runtimeArchiveBuilder, /getDirectorySize\(stagingDirectory\)/);
  assert.match(runtimeArchiveBuilder, /runtime-size\.nsh/);
  assert.match(runtimeArchiveBuilder, /RUNTIME_UNPACKED_SIZE/);
  assert.match(runtimeArchiveBuilder, /RUNTIME_ARCHIVE_SIZE/);
  assert.match(runtimeArchiveBuilder, /cp\(archiver, runtimeExtractor\)/);
  assert.match(runtimeArchiveBuilder, /info\.isSymbolicLink\(\)/);
  assert.match(runtimeArchiveBuilder, /rm\(entryPath, \{ recursive: false, force: true \}\)/);
  assert.match(stableLauncherBuilder, /const nsisVersion = "3\.0\.4\.1"/);
  assert.match(stableLauncherBuilder, /electron-builder-binaries\/releases\/download\/nsis-\$\{nsisVersion\}/);
  assert.match(stableLauncherBuilder, /VKMiizYdmNdJOWpRGz4trl4lD\+\+BvYP2irAXpMilheUP0pc93iKlWAoP843Vlraj8YG19CVn0j\+dCo\/hURz9\+Q==/);
  assert.doesNotMatch(stableLauncherBuilder, /AppData|LOCALAPPDATA|ELECTRON_BUILDER_NSIS_DIR|app-builder-lib/);
  assert.match(stableLauncherSource, /StrCpy \$installationRoot "\$EXEDIR"/);
  assert.match(coordinatorBuilder, /transformToWindowsGuiExecutable\(stagedOutput\)/);

  assert.match(installerScript, /!include "\$\{BUILD_RESOURCES_DIR\}\\runtime-size\.nsh"/);
  assert.match(installerScript, /!define ASR_INSTALLATION_STATE_DEPLOYED_SCHEMA_MAX 2/);
  assert.match(installerScript, /StrCmp \$installationStateExitCode "25" installationStatePreflightDeferredV2Handoff installationStatePreflightUnavailable/);
  assert.match(installerScript, /installationStatePreflightDeferredV2Handoff:[\s\S]*newly installed Client re-inspects[\s\S]*and mutates state[\s\S]*Goto installationStatePreflightDone/);
  assert.match(installerScript, /SectionGetSize 0 \$0/);
  assert.match(installerScript, /IntOp \$0 \$0 \+ \$\{RUNTIME_UNPACKED_SIZE\}/);
  assert.match(fullSetupEstimatedSizeWriter, /\$\{Locate\} "\$asrRootDirectory" "\/L=F \/G=1" addFullSetupFileSize/);
  assert.match(fullSetupEstimatedSizeWriter, /System::Call 'kernel32::GetFileSizeEx\(p r0, \*l \.r1\)i\.r2'/);
  assert.match(fullSetupEstimatedSizeWriter, /System::Int64Op \$fullSetupEstimatedSize \+ \$1[\s\S]*Pop \$fullSetupEstimatedSize/);
  assert.match(fullSetupEstimatedSizeWriter, /System::Int64Op \$fullSetupEstimatedSize \/ 1024[\s\S]*Pop \$fullSetupEstimatedSize/);
  assert.match(fullSetupEstimatedSizeWriter, /System::Int64Op \$fullSetupEstimatedSize > 4294967295[\s\S]*StrCpy \$fullSetupEstimatedSize 4294967295/);
  assert.doesNotMatch(fullSetupEstimatedSizeWriter, /\$\{GetSize\}/);
  assert.match(fullSetupEstimatedSizeWriter, /WriteRegDWORD HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\\$\{UNINSTALL_APP_KEY\}" "EstimatedSize" "\$0"/);
  assert.match(fullSetupFileSizeCallback, /System::Int64Op \$fullSetupEstimatedSize \+ \$1[\s\S]*ClearErrors[\s\S]*StrCpy \$0 ""[\s\S]*Push \$0[\s\S]*Return/);
  assert.match(fullSetupFileSizeCallback, /addFullSetupFileSizeFailure:[\s\S]*SetErrors[\s\S]*StrCpy \$0 ""[\s\S]*Push \$0/);
  assert.doesNotMatch(installerScript, /\$\{UNINSTALL_REGISTRY_KEY\}/);
  assert.match(installerScript, /installationStateProvisioningDone:\s+Call writeFullSetupEstimatedSize/);
  assert.match(installerScript, /StrCpy \$isForceCurrentInstall "1"/);
  assert.match(installerScript, /!include FileFunc\.nsh/);
  assert.match(installerScript, /!define ASR_SUPPORT_EMAIL "imimmortallyingwork@yandex\.ru"/);
  assert.match(installerScript, /Function writeInstallReport[\s\S]*\$LOCALAPPDATA\\Local ASR\\support-reports[\s\S]*kind=install[\s\S]*installation_scope=per-user[\s\S]*support_email=\$\{ASR_SUPPORT_EMAIL\}/);
  assert.match(installerScript, /runtimeArchivePreflightFailure:[\s\S]*Call writeInstallReport/);
  assert.match(installerScript, /runtimeExtractionFailure:[\s\S]*Call writeInstallReport/);
  assert.match(installerScript, /installationStateProvisioningFailure:[\s\S]*Call writeInstallReport/);
  assert.match(installerScript, /legacy all-users ASR installation was found/);
  assert.match(installerScript, /\$legacyInstallLocation\\resources\\python\\python\.exe/);
  assert.match(customInit, /IfFileExists "\$legacyInstallLocation\\resources\\python\\python\.exe" blockLegacyLayout classifyRegisteredClientLayout/);
  assert.match(customInit, /\$\{StdUtils\.GetParentPath\} \$0 "\$legacyInstallLocation"[\s\S]*\$\{GetFileName\} "\$0" \$1[\s\S]*StrCmp \$1 "Clients" 0 blockUnknownRegisteredLayout[\s\S]*\$\{GetFileName\} "\$legacyInstallLocation" \$1[\s\S]*StrCmp \$1 "" blockUnknownRegisteredLayout[\s\S]*IfFileExists "\$legacyInstallLocation\\Uninstall \$\{PRODUCT_FILENAME\}\.exe" existingClientLayout blockUnknownRegisteredLayout/);
  assert.match(customInit, /existingClientLayout:[\s\S]*\$\{StdUtils\.GetParentPath\} \$asrRootDirectory "\$0"[\s\S]*StrCmp \$asrRootDirectory "" blockUnknownRegisteredLayout/);
  assert.match(customInit, /existingClientLayout:[\s\S]*Call preflightInstallationState[\s\S]*StrCpy \$installationStateProvisioningMode "provision"/);
  assert.match(installerTemplate, /Function \.onInit[\s\S]*!insertmacro customInit/);
  assert.match(installSectionTemplate, /!insertmacro uninstallOldVersion SHELL_CONTEXT[\s\S]*!ifmacrodef customInstall[\s\S]*!insertmacro customInstall/);
  assert.match(multiUserTemplate, /!define \/ifndef UNINSTALL_REGISTRY_KEY "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\\$\{UNINSTALL_APP_KEY\}"/);
  assert.doesNotMatch(customInit, /StrCmp \$0 "Client"/);
  assert.match(customInit, /Обнаружена предыдущая версия ASR в \$legacyInstallLocation/);
  assert.match(customInit, /Пользовательские данные и результаты при этом сохраняются\./);
  assert.match(customInit, /Обнаружена нераспознанная или неполная предыдущая установка ASR в \$legacyInstallLocation/);
  assert.doesNotMatch(customInit, /runtime-manifest\.json/);
  assert.doesNotMatch(installerScript, /legacy-uninstaller\.exe/);
  assert.doesNotMatch(installerScript, /isLegacyMigration/);
  assert.match(installerScript, /Function cleanupFailedClientInstall[\s\S]*SetOutPath "\$PLUGINSDIR"[\s\S]*CopyFiles \/SILENT "\$runtimeCleanupUninstaller" "\$PLUGINSDIR\\runtime-failure-uninstaller\.exe"[\s\S]*ExecWait '"\$PLUGINSDIR\\runtime-failure-uninstaller\.exe" \/S \/KEEP_APP_DATA \/currentuser --updated _\?=\$INSTDIR' \$runtimeCleanupExitCode/);
  assert.match(installerScript, /Compensating Client cleanup failed:[\s\S]*runtimeCleanupStatus/);
  assert.match(customUninstall, /\$\{if\} \$\{isUpdated\}[\s\S]*Goto asrCustomUninstallDone/);
  assert.match(customUninstall, /ReadRegStr \$0 HKCU "\$\{INSTALL_REGISTRY_KEY\}" InstallLocation[\s\S]*StrCmp "\$0" "\$INSTDIR" 0 asrCustomUninstallLocationValidationFailure/);
  assert.match(customUninstall, /\$\{GetFileName\} "\$INSTDIR" \$1[\s\S]*StrCmp \$1 "\$\{VERSION\}" 0 asrCustomUninstallLocationValidationFailure/);
  assert.match(customUninstall, /\$\{StdUtils\.GetParentPath\} \$uninstallClientsDirectory "\$INSTDIR"[\s\S]*\$\{GetFileName\} "\$uninstallClientsDirectory" \$1[\s\S]*StrCmp \$1 "Clients" 0 asrCustomUninstallLocationValidationFailure[\s\S]*\$\{StdUtils\.GetParentPath\} \$uninstallAsrRootDirectory "\$uninstallClientsDirectory"/);
  assert.match(customUninstall, /StrCpy \$uninstallManualRuntimeCleanupEligible "1"[\s\S]*Delete "\$uninstallAsrRootDirectory\\asr-launch\.exe"/);
  assert.match(customUninstall, /StrCpy \$uninstallCoordinatorDirectory "\$uninstallAsrRootDirectory\\Coordinator"/);
  assert.match(customUninstall, /\$\{if\} \$\{isUpdated\}[\s\S]*Goto asrCustomUninstallDone/);
  assert.match(customUninstall, /\$\{GetFileAttributes\} "\$uninstallCoordinatorDirectory" "DIRECTORY"[\s\S]*\$\{GetFileAttributes\} "\$uninstallCoordinatorDirectory" "REPARSE_POINT"/);
  assert.match(customUninstall, /Delete "\$uninstallCoordinatorDirectory\\asr-coordinator\.exe"[\s\S]*Delete "\$uninstallCoordinatorDirectory\\asr-coordinator\.staging\.exe"[\s\S]*Delete "\$uninstallCoordinatorDirectory\\asr-coordinator\.previous\.exe"[\s\S]*RMDir "\$uninstallCoordinatorDirectory"/);
  assert.doesNotMatch(customUninstall, /RMDir \/r "\$uninstallCoordinatorDirectory"/);
  assert.match(customUninstall, /Delete "\$uninstallAsrRootDirectory\\asr-launch\.exe"[\s\S]*RMDir \/r "\$uninstallAsrRootDirectory\\InstallationState"/);
  assert.ok(
    customUninstall.indexOf("Goto asrCustomUninstallDone") <
      customUninstall.indexOf('Delete "$uninstallAsrRootDirectory\\asr-launch.exe"'),
  );
  assert.match(customUninstall, /SetOutPath "\$PLUGINSDIR"[\s\S]*RMDir \/r "\$uninstallAsrRootDirectory\\Runtime"[\s\S]*RMDir \/r "\$uninstallAsrRootDirectory\\Runtime\.staging"[\s\S]*RMDir \/r "\$uninstallAsrRootDirectory\\Runtime\.previous"/);
  assert.match(installerScript, /IfFileExists "\$uninstallAsrRootDirectory\\Runtime\\NUL" asrCustomUninstallRuntimeRemaining/);
  assert.match(installerScript, /The ASR Runtime could not be completely removed\.[\s\S]*ASR root: \$uninstallAsrRootDirectory[\s\S]*Remaining path: \$uninstallRuntimeRemainingPath/);
  assert.match(successfulUninstall, /IfFileExists "\$uninstallClientsDirectory\\NUL" asrUninstallClientsDirectoryExists asrUninstallRootCleanup/);
  assert.match(successfulUninstall, /asrUninstallClientsDirectoryExists:[\s\S]*\$\{GetFileAttributes\} "\$uninstallClientsDirectory" "DIRECTORY"[\s\S]*\$\{GetFileAttributes\} "\$uninstallClientsDirectory" "REPARSE_POINT"[\s\S]*RMDir \/r "\$uninstallClientsDirectory"[\s\S]*IfFileExists "\$uninstallClientsDirectory\\NUL" asrUninstallClientsDirectoryRetained asrUninstallRootCleanup/);
  assert.match(successfulUninstall, /asrUninstallClientsDirectoryRetained:[\s\S]*The ASR Clients directory was not removed because it is unsafe, locked, or could not be completely removed/);
  assert.match(successfulUninstall, /asrUninstallRootCleanup:\s+RMDir "\$uninstallAsrRootDirectory"/);
  assert.doesNotMatch(installerScript, /RMDir \/r "\$uninstallAsrRootDirectory"(?!\\)/);
  assert.doesNotMatch(installerScript, /WriteRegStr HKCU "\$\{INSTALL_REGISTRY_KEY\}" InstallLocation/);
  assert.match(installerScript, /!insertmacro MUI_PAGE_DIRECTORY/);
  assert.match(installerScript, /!define MUI_PAGE_CUSTOMFUNCTION_PRE clientInstFilesPre/);
  assert.match(
    installerScript,
    /Function initializeClientInstallationGeometry[\s\S]*StrCmp \$asrRootDirectory "" 0 asrRootResolved[\s\S]*StrCpy \$asrRootDirectory "\$INSTDIR"[\s\S]*StrCpy \$INSTDIR "\$asrRootDirectory\\Clients\\\$\{VERSION\}"/,
  );
  assert.match(customInit, /\$\{if\} \$\{Silent\}[\s\S]*Call initializeClientInstallationGeometry/);
  assert.match(installerScript, /Function clientInstFilesPre\s+Call initializeClientInstallationGeometry\s+FunctionEnd/);
  assert.doesNotMatch(installerScript, /StrCpy \$INSTDIR "\$asrRootDirectory\\Client"/);
  assert.match(installerScript, /File \/oname=runtime\.7z/);
  assert.match(installerScript, /File \/oname=runtime-7za\.exe/);
  assert.match(installerScript, /Call checkRuntimeArchiveSpace/);
  assert.match(installerScript, /Call checkRuntimeArchiveSpace\s+IfErrors runtimeArchivePreflightFailure/);
  assert.match(installerScript, /\$\{DriveSpace\} "\$PLUGINSDIR" "\/D=F \/S=K" \$0/);
  assert.match(installerScript, /Call checkRuntimeStagingSpace/);
  assert.match(installerScript, /Call checkRuntimeStagingSpace\s+IfErrors runtimeStagingPreflightFailure/);
  assert.match(installerScript, /\$\{DriveSpace\} "\$asrRootDirectory" "\/D=F \/S=K" \$0/);
  assert.match(installerScript, /StrCpy \$runtimeDirectory "\$asrRootDirectory\\Runtime"/);
  assert.match(installerScript, /StrCpy \$runtimeStagingDirectory "\$asrRootDirectory\\Runtime\.staging"/);
  assert.doesNotMatch(installerScript, /\$INSTDIR\\\.\.\\Runtime/);
  assert.match(installerScript, /StrCpy \$runtimeArchivePath "\$PLUGINSDIR\\runtime\.7z"/);
  assert.match(installerScript, /StrCpy \$runtimeExtractorPath "\$PLUGINSDIR\\runtime-7za\.exe"/);
  assert.match(installerScript, /IfFileExists "\$runtimeArchivePath" 0 runtimeArchiveMissing/);
  assert.match(installerScript, /StrCpy \$runtimeArchiveSize "\$\{RUNTIME_ARCHIVE_SIZE\}"/);
  assert.doesNotMatch(installerScript, /\$\{GetSize\} "\$runtimeArchivePath"/);
  assert.match(installerScript, /IfFileExists "\$runtimeStagingDirectory\\NUL" 0 runtimeStagingMissing/);
  assert.match(installerScript, /nsExec::ExecToStack \/OEM '\"\$runtimeExtractorPath\" x -y "-o\$runtimeStagingDirectory" "\$runtimeArchivePath"'/);
  assert.match(installerScript, /Pop \$runtimeExtractionExitCode\s+Pop \$runtimeExtractionOutput/);
  assert.match(installerScript, /7za\.exe exit code: \$runtimeExtractionExitCode/);
  assert.match(installerScript, /7za\.exe output: \$runtimeExtractionOutput/);
  assert.doesNotMatch(installerScript, /Nsis7z::Extract/);
  assert.doesNotMatch(installerScript, /RMDir \/r "\$runtimeStagingDirectory"\s+MessageBox MB_OK\|MB_ICONSTOP "Unable to replace the ASR Runtime/);
  assert.doesNotMatch(installerScript, /RMDir \/r "\$runtimeDirectory"/);
  assert.match(
    installerScript,
    /runtimeExtracted:\s+; Runtime\.staging is the current output directory after extraction\.[\s\S]*SetOutPath "\$PLUGINSDIR"\s+IfFileExists "\$runtimeDirectory\\\*\.\*" replaceExistingRuntime installStagedRuntime/,
  );
  assert.match(installerScript, /Rename "\$runtimeDirectory" "\$runtimeBackupDirectory"/);
  assert.match(installerScript, /Rename "\$runtimeStagingDirectory" "\$runtimeDirectory"/);
  assert.doesNotMatch(installerScript, /RMDir \/r "\$INSTDIR\\\.\.\\Runtime"/);
  assert.match(
    installerScript,
    /runtimeInstalled:[\s\S]*Call deployCoordinator[\s\S]*SetOutPath "\$asrRootDirectory"[\s\S]*File \/oname=asr-launch\.exe "\$\{BUILD_RESOURCES_DIR\}\\stable-launcher\.exe"[\s\S]*StrCpy \$stableLauncherPath "\$asrRootDirectory\\asr-launch\.exe"/,
  );
  assert.match(installerScript, /Function deployCoordinator[\s\S]*File \/oname=asr-coordinator\.staging\.exe "\$\{BUILD_RESOURCES_DIR\}\\coordinator\\asr-coordinator\.exe"/);
  assert.match(installerScript, /Function deployCoordinator[\s\S]*Call coordinatorDirectoryIsSafe[\s\S]*Call recoverCoordinatorDeployment/);
  assert.match(installerScript, /Function deployCoordinator[\s\S]*Rename "\$coordinatorFinalExecutable" "\$coordinatorPreviousExecutable"[\s\S]*Rename "\$coordinatorStagingExecutable" "\$coordinatorFinalExecutable"/);
  assert.match(installerScript, /coordinatorDeploymentPromotionFailure:[\s\S]*Rename "\$coordinatorPreviousExecutable" "\$coordinatorFinalExecutable"/);
  assert.match(installerScript, /Function recoverCoordinatorDeployment[\s\S]*coordinatorRecoveryRestorePrevious:[\s\S]*Rename "\$coordinatorPreviousExecutable" "\$coordinatorFinalExecutable"/);
  assert.match(installerScript, /Function coordinatorFileIsSafe[\s\S]*"DIRECTORY"[\s\S]*"REPARSE_POINT"/);
  assert.match(installerScript, /CreateShortCut "\$newDesktopLink" "\$stableLauncherPath"/);
  assert.match(installerScript, /CreateShortCut "\$newStartMenuLink" "\$stableLauncherPath"/);
  assert.match(installerScript, /Function preflightInstallationState[\s\S]*IfFileExists "\$asrRootDirectory\\InstallationState\\NUL" 0 installationStatePreflightDone[\s\S]*StrCpy \$installationStateExistedBeforeInstall "1"[\s\S]*--asr-installation-state=inspect --asr-installation-state-max-schema=\$\{ASR_INSTALLATION_STATE_DEPLOYED_SCHEMA_MAX\}[\s\S]*StrCmp \$installationStateExitCode "21" installationStatePreflightUnsupported installationStatePreflightCheckUninspectable[\s\S]*StrCmp \$installationStateExitCode "23" installationStatePreflightUninspectable[\s\S]*StrCmp \$installationStateExitCode "24" installationStatePreflightCapabilityInsufficient[\s\S]*StrCmp \$installationStateExitCode "25" installationStatePreflightDeferredV2Handoff[\s\S]*installationStatePreflightCapabilityInsufficient:[\s\S]*Quit[\s\S]*installationStatePreflightDeferredV2Handoff:[\s\S]*newly installed Client re-inspects[\s\S]*and mutates state[\s\S]*Goto installationStatePreflightDone/);
  assert.match(installerScript, /Function cleanupFailedInstallationState[\s\S]*StrCmp \$installationStateExistedBeforeInstall "1" installationStateCleanupDone[\s\S]*RMDir \/r "\$asrRootDirectory\\InstallationState"[\s\S]*installationStateCleanupDone:\s+Return/);
  assert.match(installerScript, /stableLauncherShortcutsDone:[\s\S]*--asr-installation-state=\$installationStateProvisioningMode[\s\S]*StrCmp \$installationStateExitCode "23" installationStateUninspectableAfterInstall[\s\S]*installationStateProvisioningFailure:[\s\S]*Call cleanupFailedInstallationState[\s\S]*Call cleanupFailedClientInstall/);
  assert.match(mainSource, /--asr-installation-state=/);
  assert.match(mainSource, /\["inspect", "reconcile", "provision", "cleanup"\]/);
  assert.match(mainSource, /derivePackagedInstallation\(\)/);
  assert.match(mainSource, /mode === "inspect"[\s\S]*inspectInstallationStateForSetup\(installationRoot, process\.argv\)[\s\S]*result\.kind === "setup-schema-capability-insufficient"[\s\S]*SETUP_SCHEMA_CAPABILITY_INSUFFICIENT[\s\S]*result\.kind === "v2-state-requires-full-setup-mutation-authority"[\s\S]*V2_STATE_REQUIRES_FULL_SETUP_MUTATION_AUTHORITY/);
  assert.match(mainSource, /error\.code === "UNSUPPORTED_SCHEMA"[\s\S]*app\.exit\(21\)[\s\S]*error\.code === "UNINSPECTABLE_STATE"[\s\S]*app\.exit\(23\)[\s\S]*error\.code === "SETUP_SCHEMA_CAPABILITY_INSUFFICIENT"[\s\S]*app\.exit\(24\)[\s\S]*V2_STATE_REQUIRES_FULL_SETUP_MUTATION_AUTHORITY" \? 25 : 22/);
  assert.match(installationStateSource, /const SCHEMA_VERSION = 1;[\s\S]*const SCHEMA_VERSION_V2 = 2;[\s\S]*const MAX_LAUNCH_SCHEMA_VERSION = SCHEMA_VERSION_V2;/);
  assert.match(installationStateSource, /function readLaunchInstallationState[\s\S]*\[SCHEMA_VERSION, SCHEMA_VERSION_V2\]/);
  assert.match(coordinatorSource, /readLaunchInstallationState[\s\S]*readState = readLaunchInstallationState/);
  assert.doesNotMatch(installerScript, /\$\{APP_EXECUTABLE_FILENAME\}/);
  assert.doesNotMatch(installerScript, /CreateShortCut "\$newDesktopLink" "\$INSTDIR\\\$\{APP_EXECUTABLE_FILENAME\}"/);
  assert.ok(
    installerScript.indexOf('nsExec::ExecToStack /OEM \'"$runtimeExtractorPath" x -y "-o$runtimeStagingDirectory" "$runtimeArchivePath"\'') <
      installerScript.indexOf('Rename "$runtimeDirectory" "$runtimeBackupDirectory"'),
  );
});
