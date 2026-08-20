!include FileFunc.nsh

!ifndef BUILD_UNINSTALLER
  !include "${BUILD_RESOURCES_DIR}\runtime-size.nsh"

  Var legacyInstallLocation
  Var isExistingClientInstallation
  Var asrRootDirectory
  Var runtimeDirectory
  Var runtimeStagingDirectory
  Var runtimeBackupDirectory
  Var runtimeArchivePath
  Var runtimeArchiveSize
  Var runtimeExtractorPath
  Var runtimeExtractionExitCode
  Var runtimeExtractionOutput
  Var runtimeFailureStage
  Var runtimeFailureError
  Var runtimeCleanupUninstaller
  Var runtimeCleanupExitCode
  Var runtimeCleanupStatus
  Var stableLauncherPath
  Var installationStateClientExecutable
  Var installationStateExitCode
  Var installationStateProvisioningMode
  Var installationStateExistedBeforeInstall
!endif

!ifdef BUILD_UNINSTALLER
  Var uninstallAsrRootDirectory
  Var uninstallClientsDirectory
  Var uninstallManualRuntimeCleanupEligible
  Var uninstallRuntimeRemainingPath
!endif

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!ifdef BUILD_UNINSTALLER
  !macro customUnInstall
    StrCpy $uninstallAsrRootDirectory ""
    StrCpy $uninstallClientsDirectory ""
    StrCpy $uninstallManualRuntimeCleanupEligible "0"
    StrCpy $uninstallRuntimeRemainingPath ""

    ${if} ${isUpdated}
      Goto asrCustomUninstallDone
    ${endif}

    ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
    StrCmp "$0" "$INSTDIR" 0 asrCustomUninstallLocationValidationFailure

    ${GetFileName} "$INSTDIR" $1
    StrCmp $1 "${VERSION}" 0 asrCustomUninstallLocationValidationFailure

    ${StdUtils.GetParentPath} $uninstallClientsDirectory "$INSTDIR"
    StrCmp $uninstallClientsDirectory "" asrCustomUninstallLocationValidationFailure
    ${GetFileName} "$uninstallClientsDirectory" $1
    StrCmp $1 "Clients" 0 asrCustomUninstallLocationValidationFailure

    ${StdUtils.GetParentPath} $uninstallAsrRootDirectory "$uninstallClientsDirectory"
    StrCmp $uninstallAsrRootDirectory "" asrCustomUninstallLocationValidationFailure
    StrCpy $uninstallManualRuntimeCleanupEligible "1"

    SetOutPath "$PLUGINSDIR"
    Delete "$uninstallAsrRootDirectory\asr-launch.exe"
    RMDir /r "$uninstallAsrRootDirectory\InstallationState"
    RMDir /r "$uninstallAsrRootDirectory\Runtime"
    RMDir /r "$uninstallAsrRootDirectory\Runtime.staging"
    RMDir /r "$uninstallAsrRootDirectory\Runtime.previous"

    IfFileExists "$uninstallAsrRootDirectory\Runtime\NUL" asrCustomUninstallRuntimeRemaining asrCustomUninstallCheckStaging

    asrCustomUninstallCheckStaging:
      IfFileExists "$uninstallAsrRootDirectory\Runtime.staging\NUL" asrCustomUninstallStagingRemaining asrCustomUninstallCheckPrevious

    asrCustomUninstallCheckPrevious:
      IfFileExists "$uninstallAsrRootDirectory\Runtime.previous\NUL" asrCustomUninstallPreviousRemaining asrCustomUninstallDone

    asrCustomUninstallRuntimeRemaining:
      StrCpy $uninstallRuntimeRemainingPath "$uninstallAsrRootDirectory\Runtime"
      Goto asrCustomUninstallRuntimeCleanupWarning

    asrCustomUninstallStagingRemaining:
      StrCpy $uninstallRuntimeRemainingPath "$uninstallAsrRootDirectory\Runtime.staging"
      Goto asrCustomUninstallRuntimeCleanupWarning

    asrCustomUninstallPreviousRemaining:
      StrCpy $uninstallRuntimeRemainingPath "$uninstallAsrRootDirectory\Runtime.previous"

    asrCustomUninstallRuntimeCleanupWarning:
      MessageBox MB_OK|MB_ICONEXCLAMATION "The ASR Runtime could not be completely removed.$\r$\nASR root: $uninstallAsrRootDirectory$\r$\nRemaining path: $uninstallRuntimeRemainingPath$\r$\nClient uninstallation will continue."
      Goto asrCustomUninstallDone

    asrCustomUninstallLocationValidationFailure:
      MessageBox MB_OK|MB_ICONEXCLAMATION "The ASR Runtime was not removed because the Client install location could not be validated.$\r$\nClient directory: $INSTDIR$\r$\nRegistered directory: $0$\r$\nClient uninstallation will continue."

    asrCustomUninstallDone:
  !macroend

  Function un.onUninstSuccess
    StrCmp $uninstallManualRuntimeCleanupEligible "1" 0 asrUninstallRootCleanupDone
    StrCmp $uninstallClientsDirectory "" asrUninstallRootCleanupDone
    StrCmp $uninstallAsrRootDirectory "" asrUninstallRootCleanupDone
    SetOutPath "$PLUGINSDIR"
    RMDir "$uninstallClientsDirectory"
    RMDir "$uninstallAsrRootDirectory"

    asrUninstallRootCleanupDone:
  FunctionEnd
!endif

!ifndef BUILD_UNINSTALLER
  !macro preInit
    Call addRuntimeSpaceRequired
  !macroend
!endif

!macro customInit
  StrCpy $isExistingClientInstallation "0"
  StrCpy $asrRootDirectory ""
  StrCpy $installationStateProvisioningMode "reconcile"
  StrCpy $installationStateExistedBeforeInstall "0"

  ${if} $hasPerMachineInstallation == "1"
    MessageBox MB_OK|MB_ICONSTOP "A legacy all-users ASR installation was found. Remove the old all-users installation first, then run this per-user setup again."
    Quit
  ${endif}

  ReadRegStr $legacyInstallLocation HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${if} $legacyInstallLocation == ""
    Goto done
  ${endif}

  IfFileExists "$legacyInstallLocation\resources\python\python.exe" blockLegacyLayout classifyRegisteredClientLayout

  classifyRegisteredClientLayout:
    ${StdUtils.GetParentPath} $0 "$legacyInstallLocation"
    StrCmp $0 "" blockUnknownRegisteredLayout
    ${GetFileName} "$0" $1
    StrCmp $1 "Clients" 0 blockUnknownRegisteredLayout
    ${GetFileName} "$legacyInstallLocation" $1
    StrCmp $1 "" blockUnknownRegisteredLayout
    IfFileExists "$legacyInstallLocation\Uninstall ${PRODUCT_FILENAME}.exe" existingClientLayout blockUnknownRegisteredLayout

  blockLegacyLayout:
    MessageBox MB_OK|MB_ICONSTOP "Обнаружена предыдущая версия ASR в $legacyInstallLocation.$\r$\nСначала удалите её через Установленные приложения Windows, затем снова запустите Setup.$\r$\nПользовательские данные и результаты при этом сохраняются."
    Quit

  blockUnknownRegisteredLayout:
    MessageBox MB_OK|MB_ICONSTOP "Обнаружена нераспознанная или неполная предыдущая установка ASR в $legacyInstallLocation.$\r$\nАвтоматическая замена не выполняется. Сначала удалите эту установку через Установленные приложения Windows, затем снова запустите Setup."
    Quit

  existingClientLayout:
    StrCpy $isExistingClientInstallation "1"
    ${StdUtils.GetParentPath} $asrRootDirectory "$0"
    StrCmp $asrRootDirectory "" blockUnknownRegisteredLayout
    Call preflightInstallationState
    StrCpy $installationStateProvisioningMode "provision"

  done:
!macroend

!macro customPageAfterChangeDir
  !define MUI_PAGE_CUSTOMFUNCTION_PRE clientDirectoryPre
  !insertmacro MUI_PAGE_DIRECTORY
  !ifdef MUI_PAGE_CUSTOMFUNCTION_PRE
    !undef MUI_PAGE_CUSTOMFUNCTION_PRE
  !endif
  !define MUI_PAGE_CUSTOMFUNCTION_PRE clientInstFilesPre
!macroend

!ifndef BUILD_UNINSTALLER
  Function preflightInstallationState
    IfFileExists "$asrRootDirectory\InstallationState\NUL" 0 installationStatePreflightDone
    StrCpy $installationStateExistedBeforeInstall "1"
    StrCpy $installationStateClientExecutable "$legacyInstallLocation\${APP_FILENAME}.exe"
    IfFileExists "$installationStateClientExecutable" 0 installationStatePreflightUnavailable
    ClearErrors
    ExecWait '"$installationStateClientExecutable" --asr-installation-state=inspect' $installationStateExitCode
    IfErrors installationStatePreflightUnavailable
    StrCmp $installationStateExitCode "0" installationStatePreflightDone
    StrCmp $installationStateExitCode "21" installationStatePreflightUnsupported installationStatePreflightCheckUninspectable

    installationStatePreflightCheckUninspectable:
    StrCmp $installationStateExitCode "23" installationStatePreflightUninspectable installationStatePreflightUnavailable

    installationStatePreflightUnsupported:
      MessageBox MB_OK|MB_ICONSTOP "ASR installation state was created by a newer incompatible version.$\r$\nInstall a matching or newer Full Setup."
      Quit

    installationStatePreflightUnavailable:
      MessageBox MB_OK|MB_ICONSTOP "ASR installation state could not be inspected safely.$\r$\nInstall a matching or newer Full Setup."
      Quit

    installationStatePreflightUninspectable:
      MessageBox MB_OK|MB_ICONSTOP "ASR installation state is ambiguous or cannot be inspected safely.$\r$\nInstall a matching or newer Full Setup."
      Quit

    installationStatePreflightDone:
  FunctionEnd

  Function addRuntimeSpaceRequired
    ; electron-builder's only install section has index 0.
    SectionGetSize 0 $0
    IntOp $0 $0 + ${RUNTIME_UNPACKED_SIZE}
    SectionSetSize 0 $0
  FunctionEnd

  Function checkRuntimeArchiveSpace
    ClearErrors
    ${DriveSpace} "$PLUGINSDIR" "/D=F /S=K" $0
    IfErrors runtimeArchiveSpaceUnknown
    IntCmp $0 ${RUNTIME_ARCHIVE_SIZE} runtimeArchiveSpaceAvailable runtimeArchiveSpaceInsufficient runtimeArchiveSpaceAvailable

    runtimeArchiveSpaceUnknown:
      StrCpy $runtimeFailureStage "archive-space preflight"
      StrCpy $runtimeFailureError "Unable to determine free space on the system temporary drive for the bundled ASR Runtime."
      SetErrors
      Return

    runtimeArchiveSpaceInsufficient:
      StrCpy $runtimeFailureStage "archive-space preflight"
      StrCpy $runtimeFailureError "The system temporary drive does not have enough free space for the bundled ASR Runtime archive."
      SetErrors
      Return

    runtimeArchiveSpaceAvailable:
      ClearErrors
  FunctionEnd

  Function checkRuntimeStagingSpace
    ClearErrors
    ${DriveSpace} "$asrRootDirectory" "/D=F /S=K" $0
    IfErrors runtimeStagingSpaceUnknown
    IntCmp $0 ${RUNTIME_UNPACKED_SIZE} runtimeStagingSpaceAvailable runtimeStagingSpaceInsufficient runtimeStagingSpaceAvailable

    runtimeStagingSpaceUnknown:
      StrCpy $runtimeFailureStage "staging-space preflight"
      StrCpy $runtimeFailureError "Unable to determine free space on the selected installation drive for the ASR Runtime."
      SetErrors
      Return

    runtimeStagingSpaceInsufficient:
      StrCpy $runtimeFailureStage "staging-space preflight"
      StrCpy $runtimeFailureError "The selected installation drive does not have enough free space to stage the ASR Runtime. Reinstall requires free space for a second Runtime copy."
      SetErrors
      Return

    runtimeStagingSpaceAvailable:
      ClearErrors
  FunctionEnd

  Function cleanupFailedClientInstall
    StrCpy $runtimeCleanupStatus "Compensating Client cleanup completed. Electron user data was kept."
    SetOutPath "$PLUGINSDIR"
    StrCpy $runtimeCleanupUninstaller "$INSTDIR\Uninstall ${PRODUCT_FILENAME}.exe"
    IfFileExists "$runtimeCleanupUninstaller" 0 runtimeCleanupUninstallerMissing

    CopyFiles /SILENT "$runtimeCleanupUninstaller" "$PLUGINSDIR\runtime-failure-uninstaller.exe"
    IfErrors runtimeCleanupCopyFailure

    ClearErrors
    ExecWait '"$PLUGINSDIR\runtime-failure-uninstaller.exe" /S /KEEP_APP_DATA /currentuser --updated _?=$INSTDIR' $runtimeCleanupExitCode
    IfErrors runtimeCleanupLaunchFailure
    StrCmp $runtimeCleanupExitCode "0" +2
      Goto runtimeCleanupUninstallFailure
    Return

    runtimeCleanupUninstallerMissing:
      StrCpy $runtimeCleanupStatus "Compensating Client cleanup failed: the new Client uninstaller is missing."
      Return

    runtimeCleanupCopyFailure:
      StrCpy $runtimeCleanupStatus "Compensating Client cleanup failed: the new Client uninstaller could not be copied to temporary storage."
      Return

    runtimeCleanupLaunchFailure:
      StrCpy $runtimeCleanupStatus "Compensating Client cleanup failed: the new Client uninstaller could not be started."
      Return

    runtimeCleanupUninstallFailure:
      StrCpy $runtimeCleanupStatus "Compensating Client cleanup failed: the new Client uninstaller exited with code $runtimeCleanupExitCode."
  FunctionEnd

  Function cleanupFailedInstallationState
    StrCmp $installationStateExistedBeforeInstall "1" installationStateCleanupDone
    StrCpy $installationStateClientExecutable "$INSTDIR\${APP_FILENAME}.exe"
    IfFileExists "$installationStateClientExecutable" 0 installationStateDirectCleanup
    ClearErrors
    ExecWait '"$installationStateClientExecutable" --asr-installation-state=cleanup' $installationStateExitCode

    installationStateDirectCleanup:
      SetOutPath "$PLUGINSDIR"
      RMDir /r "$asrRootDirectory\InstallationState"

    installationStateCleanupDone:
    Return
  FunctionEnd

  Function clientDirectoryPre
    StrCmp $isExistingClientInstallation "1" 0 +2
    Abort
  FunctionEnd

  Function clientInstFilesPre
    StrCmp $asrRootDirectory "" 0 asrRootResolved
    StrCpy $asrRootDirectory "$INSTDIR"

    asrRootResolved:
    StrCpy $INSTDIR "$asrRootDirectory\Clients\${VERSION}"
  FunctionEnd
!endif

!macro customInstall
  StrCpy $runtimeDirectory "$asrRootDirectory\Runtime"
  StrCpy $runtimeStagingDirectory "$asrRootDirectory\Runtime.staging"
  StrCpy $runtimeBackupDirectory "$asrRootDirectory\Runtime.previous"

  RMDir /r "$runtimeStagingDirectory"
  RMDir /r "$runtimeBackupDirectory"

  Call checkRuntimeArchiveSpace
  IfErrors runtimeArchivePreflightFailure
  SetOutPath "$PLUGINSDIR"
  SetCompress off
  File /oname=runtime.7z "${BUILD_RESOURCES_DIR}\runtime.7z"
  File /oname=runtime-7za.exe "${BUILD_RESOURCES_DIR}\runtime-7za.exe"
  SetCompress auto

  StrCpy $runtimeArchivePath "$PLUGINSDIR\runtime.7z"
  StrCpy $runtimeExtractorPath "$PLUGINSDIR\runtime-7za.exe"
  IfFileExists "$runtimeArchivePath" 0 runtimeArchiveMissing
  IfFileExists "$runtimeExtractorPath" 0 runtimeExtractorMissing
  StrCpy $runtimeArchiveSize "${RUNTIME_ARCHIVE_SIZE}"

  Call checkRuntimeStagingSpace
  IfErrors runtimeStagingPreflightFailure
  SetOutPath "$runtimeStagingDirectory"
  IfFileExists "$runtimeStagingDirectory\NUL" 0 runtimeStagingMissing
  nsExec::ExecToStack /OEM '"$runtimeExtractorPath" x -y "-o$runtimeStagingDirectory" "$runtimeArchivePath"'
  Pop $runtimeExtractionExitCode
  Pop $runtimeExtractionOutput
  ${if} $runtimeExtractionExitCode != "0"
    Goto runtimeExtractionFailure
  ${endif}
  IfFileExists "$runtimeStagingDirectory\runtime-manifest.json" runtimeExtracted runtimePostExtractionValidationFailure

  runtimeArchivePreflightFailure:
    Call cleanupFailedClientInstall
    MessageBox MB_OK|MB_ICONSTOP "ASR Runtime installation failed.$\r$\nStage: $runtimeFailureStage$\r$\nError: $runtimeFailureError$\r$\n$runtimeCleanupStatus"
    Quit

  runtimeStagingPreflightFailure:
    Call cleanupFailedClientInstall
    MessageBox MB_OK|MB_ICONSTOP "ASR Runtime installation failed.$\r$\nStage: $runtimeFailureStage$\r$\nError: $runtimeFailureError$\r$\n$runtimeCleanupStatus"
    Quit

  runtimePostExtractionValidationFailure:
    Call cleanupFailedClientInstall
    MessageBox MB_OK|MB_ICONSTOP "ASR Runtime post-extraction validation failed.$\r$\nArchive path: $runtimeArchivePath$\r$\nArchive size (build metadata): $runtimeArchiveSize KiB$\r$\nDestination: $runtimeStagingDirectory$\r$\n7za.exe exit code: $runtimeExtractionExitCode$\r$\n7za.exe output: $runtimeExtractionOutput$\r$\nThe staging directory was kept for diagnostics.$\r$\n$runtimeCleanupStatus"
    Quit

  runtimeArchiveMissing:
    Call cleanupFailedClientInstall
    MessageBox MB_OK|MB_ICONSTOP "Unable to unpack the bundled ASR Runtime.$\r$\nStage: archive materialization$\r$\nArchive path: $runtimeArchivePath$\r$\nDestination: $runtimeStagingDirectory$\r$\nError: runtime.7z is missing before extraction.$\r$\n$runtimeCleanupStatus"
    Quit

  runtimeExtractorMissing:
    Call cleanupFailedClientInstall
    MessageBox MB_OK|MB_ICONSTOP "Unable to unpack the bundled ASR Runtime.$\r$\nStage: extractor materialization$\r$\nArchive path: $runtimeArchivePath$\r$\nDestination: $runtimeStagingDirectory$\r$\nError: bundled 7za.exe is missing before extraction.$\r$\n$runtimeCleanupStatus"
    Quit

  runtimeStagingMissing:
    Call cleanupFailedClientInstall
    MessageBox MB_OK|MB_ICONSTOP "Unable to unpack the bundled ASR Runtime.$\r$\nStage: staging directory creation$\r$\nArchive path: $runtimeArchivePath$\r$\nArchive size (build metadata): $runtimeArchiveSize KiB$\r$\nDestination: $runtimeStagingDirectory$\r$\nError: Runtime.staging was not created before extraction.$\r$\n$runtimeCleanupStatus"
    Quit

  runtimeExtractionFailure:
    Call cleanupFailedClientInstall
    MessageBox MB_OK|MB_ICONSTOP "ASR Runtime extraction failed.$\r$\nArchive path: $runtimeArchivePath$\r$\nArchive size (build metadata): $runtimeArchiveSize KiB$\r$\nDestination: $runtimeStagingDirectory$\r$\n7za.exe exit code: $runtimeExtractionExitCode$\r$\n7za.exe output: $runtimeExtractionOutput$\r$\nThe staging directory was kept for diagnostics.$\r$\n$runtimeCleanupStatus"
    Quit

  runtimeExtracted:
    ; Runtime.staging is the current output directory after extraction. Move
    ; outside both Runtime directories before any rename or cleanup operation.
    SetOutPath "$PLUGINSDIR"
    IfFileExists "$runtimeDirectory\*.*" replaceExistingRuntime installStagedRuntime

  replaceExistingRuntime:
    Rename "$runtimeDirectory" "$runtimeBackupDirectory"
    IfErrors runtimeBackupFailure

  installStagedRuntime:
    Rename "$runtimeStagingDirectory" "$runtimeDirectory"
    IfErrors runtimeStagingPromotionFailure
    RMDir /r "$runtimeBackupDirectory"
    Goto runtimeInstalled

  runtimeStagingPromotionFailure:
    IfFileExists "$runtimeBackupDirectory\*.*" 0 runtimeStagingPromotionCleanFailure
    Rename "$runtimeBackupDirectory" "$runtimeDirectory"
    IfErrors runtimeRestoreFailure

    Call cleanupFailedClientInstall
    MessageBox MB_OK|MB_ICONSTOP "ASR Runtime replacement failed. The previous Runtime was restored.$\r$\nStaging directory: $runtimeStagingDirectory$\r$\n$runtimeCleanupStatus"
    Quit

  runtimeBackupFailure:
    Call cleanupFailedClientInstall
    MessageBox MB_OK|MB_ICONSTOP "ASR Runtime replacement failed before staging activation. The existing Runtime was left unchanged.$\r$\nStaging directory: $runtimeStagingDirectory$\r$\n$runtimeCleanupStatus"
    Quit

  runtimeStagingPromotionCleanFailure:
    Call cleanupFailedClientInstall
    MessageBox MB_OK|MB_ICONSTOP "ASR Runtime replacement failed while activating the staged Runtime.$\r$\nStaging directory: $runtimeStagingDirectory$\r$\n$runtimeCleanupStatus"
    Quit

  runtimeRestoreFailure:
    Call cleanupFailedClientInstall
    MessageBox MB_OK|MB_ICONSTOP "ASR Runtime replacement failed and the previous Runtime could not be restored automatically.$\r$\nStaging directory: $runtimeStagingDirectory$\r$\nPrevious Runtime backup: $runtimeBackupDirectory$\r$\n$runtimeCleanupStatus"
    Quit

  runtimeInstalled:
    SetOutPath "$asrRootDirectory"
    File /oname=asr-launch.exe "${BUILD_RESOURCES_DIR}\stable-launcher.exe"
    StrCpy $stableLauncherPath "$asrRootDirectory\asr-launch.exe"
    IfFileExists "$stableLauncherPath" stableLauncherInstalled stableLauncherMissing

  stableLauncherMissing:
    MessageBox MB_OK|MB_ICONSTOP "ASR installation completed without its stable launcher. Run Full Setup again to repair the installation."
    Quit

  stableLauncherInstalled:
    IfFileExists "$newDesktopLink" 0 stableLauncherStartMenuShortcut
    Delete "$newDesktopLink"
    CreateShortCut "$newDesktopLink" "$stableLauncherPath" "" "$stableLauncherPath" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"

  stableLauncherStartMenuShortcut:
    IfFileExists "$newStartMenuLink" 0 stableLauncherShortcutsDone
    Delete "$newStartMenuLink"
    CreateShortCut "$newStartMenuLink" "$stableLauncherPath" "" "$stableLauncherPath" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"

  stableLauncherShortcutsDone:
    StrCpy $installationStateClientExecutable "$INSTDIR\${APP_FILENAME}.exe"
    IfFileExists "$installationStateClientExecutable" installationStateClientReady installationStateClientMissing

  installationStateClientReady:
    ClearErrors
    ExecWait '"$installationStateClientExecutable" --asr-installation-state=$installationStateProvisioningMode' $installationStateExitCode
    IfErrors installationStateProvisioningFailure
    StrCmp $installationStateExitCode "0" installationStateProvisioningDone
    StrCmp $installationStateExitCode "21" installationStateUnsupportedAfterInstall installationStateProvisioningCheckUninspectable

  installationStateProvisioningCheckUninspectable:
    StrCmp $installationStateExitCode "23" installationStateUninspectableAfterInstall installationStateProvisioningFailure

  installationStateUnsupportedAfterInstall:
    Call cleanupFailedClientInstall
    MessageBox MB_OK|MB_ICONSTOP "ASR installation state was created by a newer incompatible version. The installed Client was removed and state was preserved."
    Quit

  installationStateUninspectableAfterInstall:
    Call cleanupFailedClientInstall
    MessageBox MB_OK|MB_ICONSTOP "ASR installation state is ambiguous or cannot be inspected safely. The installed Client was removed and state was preserved."
    Quit

  installationStateClientMissing:
    StrCpy $runtimeCleanupStatus "Installation state provisioning failed: the installed Client executable is missing."
    Goto installationStateProvisioningFailure

  installationStateProvisioningFailure:
    Call cleanupFailedInstallationState
    Call cleanupFailedClientInstall
    MessageBox MB_OK|MB_ICONSTOP "ASR installation state provisioning failed.$\r$\nClient: $INSTDIR$\r$\n$runtimeCleanupStatus"
    Quit

  installationStateProvisioningDone:
!macroend
