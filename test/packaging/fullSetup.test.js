const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "../..");

test("Full Offline Setup keeps Runtime outside the Client package", async () => {
  const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
  const installerScript = await readFile(path.join(projectRoot, "build", "installer.nsh"), "utf8");
  const runtimeArchiveBuilder = await readFile(path.join(projectRoot, "scripts", "buildRuntimeArchive.js"), "utf8");
  const customInit = installerScript.slice(
    installerScript.indexOf("!macro customInit"),
    installerScript.indexOf("!macro customPageAfterChangeDir"),
  );
  const customUninstall = installerScript.slice(
    installerScript.indexOf("!macro customUnInstall"),
    installerScript.indexOf("Function un.onUninstSuccess"),
  );

  assert.equal(packageJson.build.nsis.oneClick, false);
  assert.equal(packageJson.build.nsis.allowToChangeInstallationDirectory, false);
  assert.equal(packageJson.build.nsis.allowElevation, false);
  assert.equal(packageJson.build.nsis.include, "build/installer.nsh");
  assert.equal("extraResources" in packageJson.build, false);
  assert.equal(packageJson.scripts["prepare:runtime"], "node scripts/buildRuntimeArchive.js");
  assert.equal(packageJson.devDependencies["7zip-bin"], "5.2.0");
  assert.match(runtimeArchiveBuilder, /require\("7zip-bin"\)/);
  assert.match(runtimeArchiveBuilder, /getDirectorySize\(stagingDirectory\)/);
  assert.match(runtimeArchiveBuilder, /runtime-size\.nsh/);
  assert.match(runtimeArchiveBuilder, /RUNTIME_UNPACKED_SIZE/);
  assert.match(runtimeArchiveBuilder, /RUNTIME_ARCHIVE_SIZE/);
  assert.match(runtimeArchiveBuilder, /cp\(archiver, runtimeExtractor\)/);

  assert.match(installerScript, /!include "\$\{BUILD_RESOURCES_DIR\}\\runtime-size\.nsh"/);
  assert.match(installerScript, /SectionGetSize 0 \$0/);
  assert.match(installerScript, /IntOp \$0 \$0 \+ \$\{RUNTIME_UNPACKED_SIZE\}/);
  assert.match(installerScript, /StrCpy \$isForceCurrentInstall "1"/);
  assert.match(installerScript, /!include FileFunc\.nsh/);
  assert.match(installerScript, /legacy all-users ASR installation was found/);
  assert.match(installerScript, /\$legacyInstallLocation\\resources\\python\\python\.exe/);
  assert.match(customInit, /IfFileExists "\$legacyInstallLocation\\resources\\python\\python\.exe" blockLegacyLayout classifyRegisteredClientLayout/);
  assert.match(customInit, /\$\{StdUtils\.GetParentPath\} \$0 "\$legacyInstallLocation"[\s\S]*\$\{GetFileName\} "\$0" \$1[\s\S]*StrCmp \$1 "Clients" 0 blockUnknownRegisteredLayout[\s\S]*\$\{GetFileName\} "\$legacyInstallLocation" \$1[\s\S]*StrCmp \$1 "" blockUnknownRegisteredLayout[\s\S]*IfFileExists "\$legacyInstallLocation\\Uninstall \$\{PRODUCT_FILENAME\}\.exe" existingClientLayout blockUnknownRegisteredLayout/);
  assert.match(customInit, /existingClientLayout:[\s\S]*\$\{StdUtils\.GetParentPath\} \$asrRootDirectory "\$0"[\s\S]*StrCmp \$asrRootDirectory "" blockUnknownRegisteredLayout/);
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
  assert.match(customUninstall, /SetOutPath "\$PLUGINSDIR"[\s\S]*RMDir \/r "\$uninstallAsrRootDirectory\\Runtime"[\s\S]*RMDir \/r "\$uninstallAsrRootDirectory\\Runtime\.staging"[\s\S]*RMDir \/r "\$uninstallAsrRootDirectory\\Runtime\.previous"/);
  assert.match(installerScript, /IfFileExists "\$uninstallAsrRootDirectory\\Runtime\\NUL" asrCustomUninstallRuntimeRemaining/);
  assert.match(installerScript, /The ASR Runtime could not be completely removed\.[\s\S]*ASR root: \$uninstallAsrRootDirectory[\s\S]*Remaining path: \$uninstallRuntimeRemainingPath/);
  assert.match(installerScript, /Function un\.onUninstSuccess[\s\S]*SetOutPath "\$PLUGINSDIR"[\s\S]*RMDir "\$uninstallClientsDirectory"[\s\S]*RMDir "\$uninstallAsrRootDirectory"/);
  assert.doesNotMatch(installerScript, /RMDir \/r "\$uninstallAsrRootDirectory"(?!\\)/);
  assert.doesNotMatch(installerScript, /RMDir \/r "\$uninstallClientsDirectory"/);
  assert.doesNotMatch(installerScript, /WriteRegStr HKCU "\$\{INSTALL_REGISTRY_KEY\}" InstallLocation/);
  assert.match(installerScript, /!insertmacro MUI_PAGE_DIRECTORY/);
  assert.match(installerScript, /!define MUI_PAGE_CUSTOMFUNCTION_PRE clientInstFilesPre/);
  assert.match(
    installerScript,
    /Function clientInstFilesPre[\s\S]*StrCmp \$asrRootDirectory "" 0 asrRootResolved[\s\S]*StrCpy \$asrRootDirectory "\$INSTDIR"[\s\S]*StrCpy \$INSTDIR "\$asrRootDirectory\\Clients\\\$\{VERSION\}"/,
  );
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
  assert.ok(
    installerScript.indexOf('nsExec::ExecToStack /OEM \'"$runtimeExtractorPath" x -y "-o$runtimeStagingDirectory" "$runtimeArchivePath"\'') <
      installerScript.indexOf('Rename "$runtimeDirectory" "$runtimeBackupDirectory"'),
  );
});
