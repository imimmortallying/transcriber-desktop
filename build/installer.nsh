!include FileFunc.nsh
!define ASR_SUPPORT_EMAIL "imimmortallyingwork@yandex.ru"
!define ASR_INSTALL_REPORT_HINT "$\r$\nТехнический отчёт сохранён в %LOCALAPPDATA%\\Local ASR\\support-reports. Отправьте этот файл на ${ASR_SUPPORT_EMAIL}."

!ifndef BUILD_UNINSTALLER
  !include "${BUILD_RESOURCES_DIR}\runtime-size.nsh"
  !define ASR_INSTALLATION_STATE_DEPLOYED_SCHEMA_MAX 2

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
  Var coordinatorDirectory
  Var coordinatorFinalExecutable
  Var coordinatorStagingExecutable
  Var coordinatorPreviousExecutable
  Var installationStateClientExecutable
  Var installationStateExitCode
  Var installationStateProvisioningMode
  Var installationStateExistedBeforeInstall
  Var fullSetupEstimatedSize
  Var installReportDirectory
  Var installReportPath
  Var installReportStage
  Var installReportError
!endif

!ifdef BUILD_UNINSTALLER
  Var uninstallAsrRootDirectory
  Var uninstallClientsDirectory
  Var uninstallManualRuntimeCleanupEligible
  Var uninstallRuntimeRemainingPath
  Var uninstallCoordinatorDirectory
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
    StrCpy $uninstallCoordinatorDirectory ""

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
    StrCpy $uninstallCoordinatorDirectory "$uninstallAsrRootDirectory\Coordinator"

    SetOutPath "$PLUGINSDIR"
    Delete "$uninstallAsrRootDirectory\asr-launch.exe"
    RMDir /r "$uninstallAsrRootDirectory\InstallationState"
    RMDir /r "$uninstallAsrRootDirectory\Runtime"
    RMDir /r "$uninstallAsrRootDirectory\Runtime.staging"
    RMDir /r "$uninstallAsrRootDirectory\Runtime.previous"
    IfFileExists "$uninstallCoordinatorDirectory" asrCustomUninstallCoordinatorExists asrCustomUninstallCheckRuntime

    asrCustomUninstallCoordinatorExists:
      ClearErrors
      ${GetFileAttributes} "$uninstallCoordinatorDirectory" "DIRECTORY" $0
      IfErrors asrCustomUninstallCoordinatorRetained
      StrCmp $0 1 +2
        Goto asrCustomUninstallCoordinatorRetained
      ClearErrors
      ${GetFileAttributes} "$uninstallCoordinatorDirectory" "REPARSE_POINT" $0
      IfErrors asrCustomUninstallCoordinatorRetained
      StrCmp $0 1 asrCustomUninstallCoordinatorRetained
      Delete "$uninstallCoordinatorDirectory\asr-coordinator.exe"
      Delete "$uninstallCoordinatorDirectory\asr-coordinator.staging.exe"
      Delete "$uninstallCoordinatorDirectory\asr-coordinator.previous.exe"
      RMDir "$uninstallCoordinatorDirectory"
      Goto asrCustomUninstallCheckRuntime

    asrCustomUninstallCoordinatorRetained:
      MessageBox MB_OK|MB_ICONEXCLAMATION "The ASR Coordinator directory was not removed because it is unsafe, locked, or contains foreign files.$\r$\nCoordinator directory: $uninstallCoordinatorDirectory$\r$\nClient uninstallation will continue."

    asrCustomUninstallCheckRuntime:
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
    IfFileExists "$uninstallClientsDirectory\NUL" asrUninstallClientsDirectoryExists asrUninstallRootCleanup

    asrUninstallClientsDirectoryExists:
      ClearErrors
      ${GetFileAttributes} "$uninstallClientsDirectory" "DIRECTORY" $0
      IfErrors asrUninstallClientsDirectoryRetained
      StrCmp $0 1 +2
        Goto asrUninstallClientsDirectoryRetained
      ClearErrors
      ${GetFileAttributes} "$uninstallClientsDirectory" "REPARSE_POINT" $0
      IfErrors asrUninstallClientsDirectoryRetained
      StrCmp $0 1 asrUninstallClientsDirectoryRetained
      RMDir /r "$uninstallClientsDirectory"
      IfFileExists "$uninstallClientsDirectory\NUL" asrUninstallClientsDirectoryRetained asrUninstallRootCleanup

    asrUninstallClientsDirectoryRetained:
      MessageBox MB_OK|MB_ICONEXCLAMATION "The ASR Clients directory was not removed because it is unsafe, locked, or could not be completely removed.$\r$\nClients directory: $uninstallClientsDirectory$\r$\nClient uninstallation will continue."

    asrUninstallRootCleanup:
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
    StrCpy $installReportStage "legacy all-users installation"
    StrCpy $installReportError "A legacy all-users ASR installation blocks this per-user Setup."
    Call writeInstallReport
    MessageBox MB_OK|MB_ICONSTOP "A legacy all-users ASR installation was found. Remove the old all-users installation first, then run this per-user setup again.${ASR_INSTALL_REPORT_HINT}"
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
    StrCpy $installReportStage "legacy per-user installation"
    StrCpy $installReportError "A legacy ASR installation blocks this Setup."
    Call writeInstallReport
    MessageBox MB_OK|MB_ICONSTOP "Обнаружена предыдущая версия ASR в $legacyInstallLocation.$\r$\nСначала удалите её через Установленные приложения Windows, затем снова запустите Setup.$\r$\nПользовательские данные и результаты при этом сохраняются.${ASR_INSTALL_REPORT_HINT}"
    Quit

  blockUnknownRegisteredLayout:
    StrCpy $installReportStage "unknown registered installation"
    StrCpy $installReportError "The registered ASR installation layout could not be classified safely."
    Call writeInstallReport
    MessageBox MB_OK|MB_ICONSTOP "Обнаружена нераспознанная или неполная предыдущая установка ASR в $legacyInstallLocation.$\r$\nАвтоматическая замена не выполняется. Сначала удалите эту установку через Установленные приложения Windows, затем снова запустите Setup.${ASR_INSTALL_REPORT_HINT}"
    Quit

  existingClientLayout:
    StrCpy $isExistingClientInstallation "1"
    ${StdUtils.GetParentPath} $asrRootDirectory "$0"
    StrCmp $asrRootDirectory "" blockUnknownRegisteredLayout
    Call preflightInstallationState
    StrCpy $installationStateProvisioningMode "provision"

  done:
  ${if} ${Silent}
    Call initializeClientInstallationGeometry
  ${endif}
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
    ExecWait '"$installationStateClientExecutable" --asr-installation-state=inspect --asr-installation-state-max-schema=${ASR_INSTALLATION_STATE_DEPLOYED_SCHEMA_MAX}' $installationStateExitCode
    IfErrors installationStatePreflightUnavailable
    StrCmp $installationStateExitCode "0" installationStatePreflightDone
    StrCmp $installationStateExitCode "21" installationStatePreflightUnsupported installationStatePreflightCheckUninspectable

    installationStatePreflightCheckUninspectable:
    StrCmp $installationStateExitCode "23" installationStatePreflightUninspectable installationStatePreflightCheckCapability

    installationStatePreflightCheckCapability:
    StrCmp $installationStateExitCode "24" installationStatePreflightCapabilityInsufficient installationStatePreflightCheckMutationAuthority

    installationStatePreflightCheckMutationAuthority:
    StrCmp $installationStateExitCode "25" installationStatePreflightDeferredV2Handoff installationStatePreflightUnavailable

    installationStatePreflightUnsupported:
      StrCpy $installReportStage "installation-state preflight"
      StrCpy $installReportError "The existing installation state was created by a newer incompatible version."
      Call writeInstallReport
      MessageBox MB_OK|MB_ICONSTOP "ASR installation state was created by a newer incompatible version.$\r$\nInstall a matching or newer Full Setup.${ASR_INSTALL_REPORT_HINT}"
      Quit

    installationStatePreflightUnavailable:
      StrCpy $installReportStage "installation-state preflight"
      StrCpy $installReportError "The existing installation state could not be inspected safely."
      Call writeInstallReport
      MessageBox MB_OK|MB_ICONSTOP "ASR installation state could not be inspected safely.$\r$\nInstall a matching or newer Full Setup.${ASR_INSTALL_REPORT_HINT}"
      Quit

    installationStatePreflightUninspectable:
      StrCpy $installReportStage "installation-state preflight"
      StrCpy $installReportError "The existing installation state is ambiguous or uninspectable."
      Call writeInstallReport
      MessageBox MB_OK|MB_ICONSTOP "ASR installation state is ambiguous or cannot be inspected safely.$\r$\nInstall a matching or newer Full Setup.${ASR_INSTALL_REPORT_HINT}"
      Quit

    installationStatePreflightCapabilityInsufficient:
      StrCpy $installReportStage "installation-state preflight"
      StrCpy $installReportError "The deployed Full Setup infrastructure cannot consume the existing installation state schema."
      Call writeInstallReport
      MessageBox MB_OK|MB_ICONSTOP "This Full Setup cannot safely deploy infrastructure for the existing ASR installation state.$\r$\nInstall a matching or newer Full Setup.${ASR_INSTALL_REPORT_HINT}"
      Quit

    installationStatePreflightDeferredV2Handoff:
      ; An older installed Client can report exit 25 for a schema-v2 result but
      ; cannot perform the handoff itself. The newly installed Client re-inspects
      ; and mutates state only after its own Client files are safely present.
      Goto installationStatePreflightDone

    installationStatePreflightDone:
  FunctionEnd

  Function writeInstallReport
    StrCpy $installReportDirectory "$LOCALAPPDATA\Local ASR\support-reports"
    CreateDirectory "$installReportDirectory"
    IfErrors installReportDone
    StrCpy $installReportPath "$installReportDirectory\ASR-install-report-${VERSION}.txt"
    ClearErrors
    FileOpen $0 "$installReportPath" w
    IfErrors installReportDone
    FileWrite $0 "ASR Support Report$\r$\n"
    FileWrite $0 "format_version=1$\r$\n"
    FileWrite $0 "kind=install$\r$\n"
    FileWrite $0 "app_version=${VERSION}$\r$\n"
    FileWrite $0 "installation_scope=per-user$\r$\n"
    FileWrite $0 "support_email=${ASR_SUPPORT_EMAIL}$\r$\n"
    FileWrite $0 "stage=$installReportStage$\r$\n"
    FileWrite $0 "error=$installReportError$\r$\n"
    FileWrite $0 "privacy=No audio, transcript, project contents, user paths, file names, IP addresses or hardware identifiers are collected.$\r$\n"
    FileClose $0

    installReportDone:
    ClearErrors
  FunctionEnd

  Function addRuntimeSpaceRequired
    ; electron-builder's only install section has index 0.
    SectionGetSize 0 $0
    IntOp $0 $0 + ${RUNTIME_UNPACKED_SIZE}
    SectionSetSize 0 $0
  FunctionEnd

  Function writeFullSetupEstimatedSize
    ; electron-builder registers only $INSTDIR (Clients/<version>) before
    ; customInstall deploys the shared ASR root. FileFunc.GetSize uses 32-bit
    ; FileSeek per file, so it loses files larger than 2 GiB.
    StrCpy $fullSetupEstimatedSize 0
    ${Locate} "$asrRootDirectory" "/L=F /G=1" addFullSetupFileSize
    IfErrors fullSetupEstimatedSizeFallback
    System::Int64Op $fullSetupEstimatedSize / 1024
    Pop $fullSetupEstimatedSize
    System::Int64Op $fullSetupEstimatedSize > 4294967295
    Pop $1
    StrCmp $1 0 +2
    StrCpy $fullSetupEstimatedSize 4294967295
    IntFmt $0 "0x%08X" $fullSetupEstimatedSize
    WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "EstimatedSize" "$0"
    ClearErrors
    Return

    fullSetupEstimatedSizeFallback:
      ; The section already contains the Client and the build-time Runtime size.
      SectionGetSize 0 $0
      IntFmt $0 "0x%08X" $0
      WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTALL_APP_KEY}" "EstimatedSize" "$0"
      ClearErrors
  FunctionEnd

  Function addFullSetupFileSize
    ; Locate places the file path in $R9. GetFileSizeEx yields a signed 64-bit
    ; value, unlike NSIS FileSeek's 32-bit result used by FileFunc.GetSize.
    System::Call 'kernel32::CreateFileW(w "$R9", i 0x80000000, i 7, p 0, i 3, i 0x80, p 0)p.r0'
    System::Call 'kernel32::GetFileSizeEx(p r0, *l .r1)i.r2'
    System::Call 'kernel32::CloseHandle(p r0)i'
    StrCmp $2 0 addFullSetupFileSizeFailure
    System::Int64Op $fullSetupEstimatedSize + $1
    Pop $fullSetupEstimatedSize
    ClearErrors
    StrCpy $0 ""
    Push $0
    Return

    addFullSetupFileSizeFailure:
      SetErrors
      StrCpy $0 ""
      Push $0
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

  Function coordinatorDirectoryIsSafe
    ClearErrors
    ${GetFileAttributes} "$0" "DIRECTORY" $1
    IfErrors coordinatorDirectoryUnsafe
    StrCmp $1 1 coordinatorDirectoryCheckReparse coordinatorDirectoryUnsafe

    coordinatorDirectoryCheckReparse:
    ClearErrors
    ${GetFileAttributes} "$0" "REPARSE_POINT" $1
    IfErrors coordinatorDirectoryUnsafe
    StrCmp $1 1 coordinatorDirectoryUnsafe coordinatorDirectorySafe

    coordinatorDirectoryUnsafe:
      SetErrors
      Return

    coordinatorDirectorySafe:
      ClearErrors
      Return
  FunctionEnd

  Function coordinatorFileIsSafe
    ClearErrors
    ${GetFileAttributes} "$0" "DIRECTORY" $1
    IfErrors coordinatorFileUnsafe
    StrCmp $1 1 coordinatorFileUnsafe coordinatorFileCheckReparse

    coordinatorFileCheckReparse:
    ClearErrors
    ${GetFileAttributes} "$0" "REPARSE_POINT" $1
    IfErrors coordinatorFileUnsafe
    StrCmp $1 1 coordinatorFileUnsafe coordinatorFileSafe

    coordinatorFileUnsafe:
      SetErrors
      Return

    coordinatorFileSafe:
      ClearErrors
      Return
  FunctionEnd

  Function recoverCoordinatorDeployment
    IfFileExists "$coordinatorPreviousExecutable" coordinatorRecoveryHasPrevious coordinatorRecoveryCheckFinal

    coordinatorRecoveryHasPrevious:
      StrCpy $0 "$coordinatorPreviousExecutable"
      Call coordinatorFileIsSafe
      IfErrors coordinatorRecoveryFailure
      IfFileExists "$coordinatorFinalExecutable" coordinatorRecoveryCommitted coordinatorRecoveryRestorePrevious

    coordinatorRecoveryCommitted:
      StrCpy $0 "$coordinatorFinalExecutable"
      Call coordinatorFileIsSafe
      IfErrors coordinatorRecoveryFailure
      ClearErrors
      Delete "$coordinatorPreviousExecutable"
      IfErrors coordinatorRecoveryFailure
      Goto coordinatorRecoveryCheckFinal

    coordinatorRecoveryRestorePrevious:
      Rename "$coordinatorPreviousExecutable" "$coordinatorFinalExecutable"
      IfErrors coordinatorRecoveryFailure

    coordinatorRecoveryCheckFinal:
      IfFileExists "$coordinatorFinalExecutable" coordinatorRecoveryValidateFinal coordinatorRecoveryCheckStaging

    coordinatorRecoveryValidateFinal:
      StrCpy $0 "$coordinatorFinalExecutable"
      Call coordinatorFileIsSafe
      IfErrors coordinatorRecoveryFailure

    coordinatorRecoveryCheckStaging:
      IfFileExists "$coordinatorStagingExecutable" coordinatorRecoveryHasStaging coordinatorRecoveryDone

    coordinatorRecoveryHasStaging:
      StrCpy $0 "$coordinatorStagingExecutable"
      Call coordinatorFileIsSafe
      IfErrors coordinatorRecoveryFailure
      IfFileExists "$coordinatorFinalExecutable" coordinatorRecoveryDiscardStaging coordinatorRecoveryPromoteStaging

    coordinatorRecoveryDiscardStaging:
      ClearErrors
      Delete "$coordinatorStagingExecutable"
      IfErrors coordinatorRecoveryFailure
      Goto coordinatorRecoveryDone

    coordinatorRecoveryPromoteStaging:
      Rename "$coordinatorStagingExecutable" "$coordinatorFinalExecutable"
      IfErrors coordinatorRecoveryFailure
      StrCpy $0 "$coordinatorFinalExecutable"
      Call coordinatorFileIsSafe
      IfErrors coordinatorRecoveryFailure

    coordinatorRecoveryDone:
      ClearErrors
      Return

    coordinatorRecoveryFailure:
      SetErrors
      Return
  FunctionEnd

  Function deployCoordinator
    StrCpy $coordinatorDirectory "$asrRootDirectory\Coordinator"
    StrCpy $coordinatorFinalExecutable "$coordinatorDirectory\asr-coordinator.exe"
    StrCpy $coordinatorStagingExecutable "$coordinatorDirectory\asr-coordinator.staging.exe"
    StrCpy $coordinatorPreviousExecutable "$coordinatorDirectory\asr-coordinator.previous.exe"

    StrCpy $0 "$asrRootDirectory"
    Call coordinatorDirectoryIsSafe
    IfErrors coordinatorDeploymentFunctionFailure
    IfFileExists "$coordinatorDirectory" coordinatorDeploymentExistingDirectory coordinatorDeploymentCreateDirectory

    coordinatorDeploymentCreateDirectory:
      SetOutPath "$coordinatorDirectory"
      IfErrors coordinatorDeploymentFunctionFailure

    coordinatorDeploymentExistingDirectory:
      StrCpy $0 "$coordinatorDirectory"
      Call coordinatorDirectoryIsSafe
      IfErrors coordinatorDeploymentFunctionFailure
      Call recoverCoordinatorDeployment
      IfErrors coordinatorDeploymentFunctionFailure
      IfFileExists "$coordinatorStagingExecutable" coordinatorDeploymentFunctionFailure

      SetOutPath "$coordinatorDirectory"
      ClearErrors
      File /oname=asr-coordinator.staging.exe "${BUILD_RESOURCES_DIR}\coordinator\asr-coordinator.exe"
      IfErrors coordinatorDeploymentStagingFailure
      IfFileExists "$coordinatorStagingExecutable" coordinatorDeploymentStaged coordinatorDeploymentStagingFailure

    coordinatorDeploymentStaged:
      StrCpy $0 "$coordinatorStagingExecutable"
      Call coordinatorFileIsSafe
      IfErrors coordinatorDeploymentStagingFailure
      IfFileExists "$coordinatorFinalExecutable" coordinatorDeploymentBackupExisting coordinatorDeploymentPromote

    coordinatorDeploymentBackupExisting:
      StrCpy $0 "$coordinatorFinalExecutable"
      Call coordinatorFileIsSafe
      IfErrors coordinatorDeploymentStagingFailure
      IfFileExists "$coordinatorPreviousExecutable" coordinatorDeploymentStagingFailure
      Rename "$coordinatorFinalExecutable" "$coordinatorPreviousExecutable"
      IfErrors coordinatorDeploymentBackupFailure

    coordinatorDeploymentPromote:
      Rename "$coordinatorStagingExecutable" "$coordinatorFinalExecutable"
      IfErrors coordinatorDeploymentPromotionFailure
      StrCpy $0 "$coordinatorFinalExecutable"
      Call coordinatorFileIsSafe
      IfErrors coordinatorDeploymentFunctionFailure
      IfFileExists "$coordinatorPreviousExecutable" 0 coordinatorDeploymentDone
      ClearErrors
      Delete "$coordinatorPreviousExecutable"

    coordinatorDeploymentDone:
      ClearErrors
      Return

    coordinatorDeploymentStagingFailure:
      ClearErrors
      Delete "$coordinatorStagingExecutable"
      SetErrors
      Return

    coordinatorDeploymentBackupFailure:
      ClearErrors
      Delete "$coordinatorStagingExecutable"
      SetErrors
      Return

    coordinatorDeploymentPromotionFailure:
      IfFileExists "$coordinatorPreviousExecutable" 0 coordinatorDeploymentFunctionFailure
      Rename "$coordinatorPreviousExecutable" "$coordinatorFinalExecutable"
      IfErrors coordinatorDeploymentFunctionFailure
      ClearErrors
      Delete "$coordinatorStagingExecutable"

    coordinatorDeploymentFunctionFailure:
      SetErrors
      Return
  FunctionEnd

  Function clientDirectoryPre
    StrCmp $isExistingClientInstallation "1" 0 +2
    Abort
  FunctionEnd

  Function initializeClientInstallationGeometry
    StrCmp $asrRootDirectory "" 0 asrRootResolved
    StrCpy $asrRootDirectory "$INSTDIR"

    asrRootResolved:
    StrCpy $INSTDIR "$asrRootDirectory\Clients\${VERSION}"
  FunctionEnd

  Function clientInstFilesPre
    Call initializeClientInstallationGeometry
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
    StrCpy $installReportStage "$runtimeFailureStage"
    StrCpy $installReportError "$runtimeFailureError"
    Call writeInstallReport
    MessageBox MB_OK|MB_ICONSTOP "ASR Runtime installation failed.$\r$\nStage: $runtimeFailureStage$\r$\nError: $runtimeFailureError$\r$\n$runtimeCleanupStatus${ASR_INSTALL_REPORT_HINT}"
    Quit

  runtimeStagingPreflightFailure:
    Call cleanupFailedClientInstall
    StrCpy $installReportStage "$runtimeFailureStage"
    StrCpy $installReportError "$runtimeFailureError"
    Call writeInstallReport
    MessageBox MB_OK|MB_ICONSTOP "ASR Runtime installation failed.$\r$\nStage: $runtimeFailureStage$\r$\nError: $runtimeFailureError$\r$\n$runtimeCleanupStatus${ASR_INSTALL_REPORT_HINT}"
    Quit

  runtimePostExtractionValidationFailure:
    Call cleanupFailedClientInstall
    StrCpy $installReportStage "runtime post-extraction validation"
    StrCpy $installReportError "The Runtime staging directory has no runtime manifest after extraction."
    Call writeInstallReport
    MessageBox MB_OK|MB_ICONSTOP "ASR Runtime post-extraction validation failed.$\r$\nArchive path: $runtimeArchivePath$\r$\nArchive size (build metadata): $runtimeArchiveSize KiB$\r$\nDestination: $runtimeStagingDirectory$\r$\n7za.exe exit code: $runtimeExtractionExitCode$\r$\n7za.exe output: $runtimeExtractionOutput$\r$\nThe staging directory was kept for diagnostics.$\r$\n$runtimeCleanupStatus${ASR_INSTALL_REPORT_HINT}"
    Quit

  runtimeArchiveMissing:
    Call cleanupFailedClientInstall
    StrCpy $installReportStage "runtime archive materialization"
    StrCpy $installReportError "The bundled Runtime archive is missing before extraction."
    Call writeInstallReport
    MessageBox MB_OK|MB_ICONSTOP "Unable to unpack the bundled ASR Runtime.$\r$\nStage: archive materialization$\r$\nArchive path: $runtimeArchivePath$\r$\nDestination: $runtimeStagingDirectory$\r$\nError: runtime.7z is missing before extraction.$\r$\n$runtimeCleanupStatus${ASR_INSTALL_REPORT_HINT}"
    Quit

  runtimeExtractorMissing:
    Call cleanupFailedClientInstall
    StrCpy $installReportStage "runtime extractor materialization"
    StrCpy $installReportError "The bundled Runtime extractor is missing before extraction."
    Call writeInstallReport
    MessageBox MB_OK|MB_ICONSTOP "Unable to unpack the bundled ASR Runtime.$\r$\nStage: extractor materialization$\r$\nArchive path: $runtimeArchivePath$\r$\nDestination: $runtimeStagingDirectory$\r$\nError: bundled 7za.exe is missing before extraction.$\r$\n$runtimeCleanupStatus${ASR_INSTALL_REPORT_HINT}"
    Quit

  runtimeStagingMissing:
    Call cleanupFailedClientInstall
    StrCpy $installReportStage "runtime staging directory creation"
    StrCpy $installReportError "The Runtime staging directory was not created before extraction."
    Call writeInstallReport
    MessageBox MB_OK|MB_ICONSTOP "Unable to unpack the bundled ASR Runtime.$\r$\nStage: staging directory creation$\r$\nArchive path: $runtimeArchivePath$\r$\nArchive size (build metadata): $runtimeArchiveSize KiB$\r$\nDestination: $runtimeStagingDirectory$\r$\nError: Runtime.staging was not created before extraction.$\r$\n$runtimeCleanupStatus${ASR_INSTALL_REPORT_HINT}"
    Quit

  runtimeExtractionFailure:
    Call cleanupFailedClientInstall
    StrCpy $installReportStage "runtime extraction"
    StrCpy $installReportError "The bundled Runtime archive could not be extracted."
    Call writeInstallReport
    MessageBox MB_OK|MB_ICONSTOP "ASR Runtime extraction failed.$\r$\nArchive path: $runtimeArchivePath$\r$\nArchive size (build metadata): $runtimeArchiveSize KiB$\r$\nDestination: $runtimeStagingDirectory$\r$\n7za.exe exit code: $runtimeExtractionExitCode$\r$\n7za.exe output: $runtimeExtractionOutput$\r$\nThe staging directory was kept for diagnostics.$\r$\n$runtimeCleanupStatus${ASR_INSTALL_REPORT_HINT}"
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
    Call deployCoordinator
    IfErrors coordinatorDeploymentFailure
    SetOutPath "$asrRootDirectory"
    File /oname=asr-launch.exe "${BUILD_RESOURCES_DIR}\stable-launcher.exe"
    StrCpy $stableLauncherPath "$asrRootDirectory\asr-launch.exe"
    IfFileExists "$stableLauncherPath" stableLauncherInstalled stableLauncherMissing

  stableLauncherMissing:
    MessageBox MB_OK|MB_ICONSTOP "ASR installation completed without its stable launcher. Run Full Setup again to repair the installation."
    Quit

  coordinatorDeploymentFailure:
    Call cleanupFailedClientInstall
    StrCpy $installReportStage "Coordinator deployment"
    StrCpy $installReportError "The stable Coordinator could not be deployed."
    Call writeInstallReport
    MessageBox MB_OK|MB_ICONSTOP "ASR Coordinator deployment failed.$\r$\nCoordinator directory: $asrRootDirectory\Coordinator$\r$\nA previous Coordinator was left unchanged or restored when possible.$\r$\n$runtimeCleanupStatus${ASR_INSTALL_REPORT_HINT}"
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
    StrCpy $installReportStage "installation-state provisioning"
    StrCpy $installReportError "$runtimeCleanupStatus"
    Call writeInstallReport
    MessageBox MB_OK|MB_ICONSTOP "ASR installation state provisioning failed.$\r$\nClient: $INSTDIR$\r$\n$runtimeCleanupStatus${ASR_INSTALL_REPORT_HINT}"
    Quit

  installationStateProvisioningDone:
    Call writeFullSetupEstimatedSize
!macroend
